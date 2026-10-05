import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { r04SqlBootstrap } from './helpers/r04-sql-bootstrap.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Opt-in CI service only. This intentionally accepts no database URL, host, user or database override.
// The database must be empty; the harness never clears, migrates or resets an existing project.
test('R04 PostgreSQL multi-session duplicate, CAS and confirmation/reference races', {skip:process.env.R04_PG_TEST!=='1',timeout:120000}, async(t)=>{
 assert.ok(process.env.R04_SQL_TEST_HOST,'An isolated dependency host is required');
 assert.ok(process.env.R04_PG_PASSWORD,'The disposable local database password is required');
 const port=Number(process.env.R04_PG_PORT??5432);assert.ok(Number.isInteger(port)&&port>=1024&&port<=65535);
 const require=createRequire(path.resolve(process.env.R04_SQL_TEST_HOST,'package.json'));
 const {Client}=require('pg');
 const config={host:'127.0.0.1',port,user:'r04_test',database:'r04_test',password:process.env.R04_PG_PASSWORD,ssl:false,connectionTimeoutMillis:5000,statement_timeout:15000,application_name:'r04-isolated-concurrency'};
 const observer=new Client(config),left=new Client(config),right=new Client(config);
 const owner=randomUUID(),business=randomUUID();
 const content={title:'Bounded research intent',originalIntent:'Research one market under a zero USD budget',objective:'Research one market',parsed:{target:{amount:'1',currency:null,metric:'units'},budget:{amount:'0',currency:'USD'},deadline:{date:'2027-01-01',time:'12:00',timezone:'UTC'},geography:['New Zealand'],scope:'Research planning',stopConstraints:['No paid operations']},ambiguities:[]};
 const businessContent={brandContext:'Original work',operatingRules:'No commerce',allowedActivity:'Research planning',restrictions:'No paid operations'};
 const envelope={purposes:['Research planning'],operations:['plan'],accounts:[],packs:[],dataSharing:[],limits:[{category:'all',currency:'USD',maximum:'0'}],startsAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),stopRules:['No dispatch']};
 const rpc=async(client,operation,payload,key=randomUUID())=>(await client.query('select public.r04_quest_transition($1,$2,$3::jsonb,$4) result',[business,operation,JSON.stringify(payload),key])).rows[0].result;
 async function begin(client,admin=false){await client.query('begin');if(!admin)await client.query('set local role authenticated');await client.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);}
 async function owned(operation,payload){await begin(left);try{const result=await rpc(left,operation,payload);await left.query('commit');return result;}catch(error){await left.query('rollback');throw error;}}
 async function read(){await begin(left);try{return (await left.query('select public.r04_quest_read($1) result',[business])).rows[0].result;}finally{await left.query('rollback');}}
 async function waitBlocked(pid){
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){
   // Poll an actual PostgreSQL lock wait. Time passing alone is never the synchronization condition.
   const state=(await observer.query("select wait_event_type,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1",[pid])).rows[0];
   if(state?.wait_event_type==='Lock'&&state.blockers.includes(left.processID))return;
   await pause(15);
  }
  throw new Error('Competing transaction never reached its expected PostgreSQL lock wait');
 }
 async function race(leftWork,rightWork,{adminLeft=false}={}){
  await begin(left,adminLeft);await begin(right);
  let pending;
  try{
   const first=await leftWork();
   pending=rightWork().then(value=>({value}),error=>({error}));
   await waitBlocked(right.processID);
   await left.query('commit');
   const second=await pending;
   await right.query(second.error?'rollback':'commit');
   return {first,second};
  }catch(error){
   await left.query('rollback').catch(()=>{});
   if(pending)await pending;
   await right.query('rollback').catch(()=>{});
   throw error;
  }
 }
 try{
  await Promise.all([observer.connect(),left.connect(),right.connect()]);
  const target=(await observer.query('select current_database() db,current_user actor,inet_server_addr()::text address')).rows[0];
  assert.equal(target.db,'r04_test');assert.equal(target.actor,'r04_test');
  assert.ok(target.address,'A TCP connection is required; the client host is fixed to loopback above');
  assert.equal((await observer.query("select count(*)::int n from pg_tables where schemaname in ('public','private','auth','storage')")).rows[0].n,0,'Refuse a nonempty database');
  await observer.query(r04SqlBootstrap);
  for(const file of readdirSync(path.join(root,'supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await observer.query(readFileSync(path.join(root,'supabase/migrations',file),'utf8').replaceAll('\r\n','\n'));
  await observer.query('insert into auth.users(id,email) values($1,$2)',[owner,'r04-races@example.invalid']);
  await observer.query('insert into public.businesses(id,owner_user_id,name) values($1,$2,$3)',[business,owner,'R04 disposable multi-session fixtures']);
  await owned('business.save',{expectedRevision:0,content:businessContent,preference:'setup'});

  const submission=randomUUID(),initial={goalId:null,expectedRevision:0,content};
  const duplicate=await race(()=>rpc(left,'quest.save',initial,submission),()=>rpc(right,'quest.save',initial,submission));
  assert.ifError(duplicate.second.error);assert.equal(duplicate.first.id,duplicate.second.value.id);assert.equal(duplicate.second.value.replayed,true);
  const goalId=duplicate.first.id;
  assert.equal((await observer.query('select count(*)::int n from private.r04_goal_state where business_id=$1',[business])).rows[0].n,1);

  const cas=await race(()=>rpc(left,'quest.save',{goalId,expectedRevision:1,content:{...content,title:'Winning revision'}}),()=>rpc(right,'quest.save',{goalId,expectedRevision:1,content:{...content,title:'Stale competing revision'}}));
  assert.equal(cas.first.revision,2);assert.match(cas.second.error?.message??'',/r04_stale_revision/);
  assert.equal((await read()).selected.title,'Winning revision');
  await owned('quest.preference',{goalId,expectedRevision:2,preference:'ready'});
  const proposed=await owned('envelope.propose',{goalId,expectedRevision:3,businessRevision:1,envelope});
  let proposal=(await read()).selected.proposals.find(p=>p.id===proposed.id);
  // A confirmation that commits first remains historical; the serialized rules edit invalidates it.
  const confirmFirst=await race(()=>rpc(left,'envelope.confirm',{proposalId:proposal.id,proposalHash:proposal.hash}),()=>rpc(right,'business.save',{expectedRevision:1,content:{...businessContent,restrictions:'No dispatch or paid operations'},preference:'paused'}));
  assert.ifError(confirmFirst.second.error);assert.equal(confirmFirst.first.status,'confirmed_intent_only');
  assert.equal((await read()).selected.proposals.find(p=>p.id===proposal.id).status,'stale');
  const proposedAgain=await owned('envelope.propose',{goalId,expectedRevision:3,businessRevision:2,envelope});
  proposal=(await read()).selected.proposals.find(p=>p.id===proposedAgain.id);
  // If the rules edit commits first, the waiting confirmation fails rather than confirming stale scope.
  const editFirst=await race(()=>rpc(left,'business.save',{expectedRevision:2,content:businessContent,preference:'paused'}),()=>rpc(right,'envelope.confirm',{proposalId:proposal.id,proposalHash:proposal.hash}));
  assert.match(editFirst.second.error?.message??'',/r04_proposal_stale/);
  assert.equal((await observer.query('select count(*)::int n from private.r04_confirmations where proposal_id=$1',[proposal.id])).rows[0].n,0);

  const account=randomUUID(),revision=randomUUID();
  await observer.query("insert into private.connected_accounts(id,business_id,owner_id,provider,provider_account_id,status,connection_revision,verified_at) values($1,$2,$3,'printful','r04-multi-session','connected',$4,clock_timestamp())",[account,business,owner,revision]);
  const accountEnvelope={...envelope,accounts:[{id:account,revision}]};
  const accountProposed=await owned('envelope.propose',{goalId,expectedRevision:3,businessRevision:3,envelope:accountEnvelope});
  proposal=(await read()).selected.proposals.find(p=>p.id===accountProposed.id);
  // Model the existing account mutator's documented Business-first lock order, with inert admin fixtures.
  const accountRace=await race(async()=>{
   await left.query('select id from public.businesses where id=$1 for update',[business]);
   await left.query('update private.connected_accounts set connection_revision=$1 where id=$2',[randomUUID(),account]);
  },()=>rpc(right,'envelope.confirm',{proposalId:proposal.id,proposalHash:proposal.hash}),{adminLeft:true});
  assert.match(accountRace.second.error?.message??'',/r04_proposal_stale/);
  assert.equal((await observer.query('select count(*)::int n from private.r04_confirmations where proposal_id=$1',[proposal.id])).rows[0].n,0);
  assert.equal((await observer.query('select count(*)::int n from public.workflow_runs where business_id=$1',[business])).rows[0].n,0);
  assert.equal((await read()).executionAvailable,false);
  t.diagnostic('Five actual lock-wait races passed: duplicate submission, stale CAS, both rule-edit/confirmation orders, and changed account revision. No dispatch or live data used.');
 }finally{await Promise.allSettled([left.end(),right.end(),observer.end()]);}
});
