import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sql=file=>readFileSync(file,'utf8').replaceAll('\r\n','\n');
// Fixed, disposable loopback database only. No URL or host override; never resets existing data.
test('R05 real PostgreSQL admission, legacy cap, pause and settlement races',{skip:process.env.R05_PG_TEST!=='1',timeout:120000},async t=>{
 assert.ok(process.env.R04_SQL_TEST_HOST);assert.ok(process.env.R05_PG_PASSWORD);
 const port=Number(process.env.R05_PG_PORT??5432);assert.ok(Number.isInteger(port)&&port>=1024&&port<=65535);
 const require=createRequire(path.resolve(process.env.R04_SQL_TEST_HOST,'package.json')),{Client}=require('pg');
 const config={host:'127.0.0.1',port,user:'r05_test',database:'r05_test',password:process.env.R05_PG_PASSWORD,ssl:false,connectionTimeoutMillis:5000,statement_timeout:15000,application_name:'r05-isolated-concurrency'};
 const observer=new Client(config),left=new Client(config),right=new Client(config);
 const owner='95050000-0000-4000-8000-000000000001';
 const value=async(c,q,args=[])=>(await c.query(q,args)).rows[0]?.result;
 const input=(c,b,key)=>value(c,'select public.r05_input($1,$2) result',[b,key]);
 const server=(c,b,op,p)=>value(c,'select public.r05_server($1,$2,$3::jsonb) result',[b,op,JSON.stringify(p)]);
 const owned=(c,b,op,p)=>value(c,'select public.r05_policy_owner($1,$2,$3::jsonb,gen_random_uuid()) result',[b,op,JSON.stringify(p)]);
 async function begin(c){await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);}
 async function lockWait(){
  const until=Date.now()+10000;
  while(Date.now()<until){const state=(await observer.query('select wait_event_type,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',[right.processID])).rows[0];if(state?.wait_event_type==='Lock'&&state.blockers.includes(left.processID))return;await pause(15);}
  throw new Error('Competing operation never entered an observed PostgreSQL lock wait');
 }
 async function race(first,second){
  await begin(left);await begin(right);let pending;
  try{const a=await first();pending=second().then(result=>({result}),error=>({error}));await lockWait();await left.query('commit');const b=await pending;await right.query(b.error?'rollback':'commit');return {a,b};}
  catch(error){await left.query('rollback').catch(()=>{});if(pending)await pending;await right.query('rollback').catch(()=>{});throw error;}
 }
 const seed=()=>value(observer,'select public.r05_seed() result');
 try{
  await Promise.all([observer.connect(),left.connect(),right.connect()]);
  const target=(await observer.query('select current_database() db,current_user actor,inet_server_addr()::text address')).rows[0];
  assert.equal(target.db,'r05_test');assert.equal(target.actor,'r05_test');assert.ok(target.address);
  assert.equal((await observer.query("select count(*)::int n from pg_tables where schemaname in ('public','private','auth','storage')")).rows[0].n,0,'Refuse a nonempty database');
  await observer.query(r04SqlBootstrap);
  for(const f of readdirSync(path.join(root,'supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await observer.query(sql(path.join(root,'supabase/migrations',f)));
  // Reuse only the inert fixture definitions before the first assertion. Persist helper names
  // in this disposable database so independent sessions can see the same fixture state.
  const fixture=sql(path.join(root,'supabase/tests/r05_operating_envelope.sql'));
  const marker="select set_config('r05.a',pg_temp.r05_seed()::text,true);";assert.equal(fixture.split(marker).length,2);
  const prefix=fixture.split(marker)[0];assert.equal(prefix.split('\nbegin;').length,2);
  await observer.query(prefix.replace('\nbegin;','').replaceAll('pg_temp.','public.').replace('create temporary table r05_fixture','create table public.r05_fixture'));

  let business=await seed(),one=await input(observer,business,'duplicate');
  await observer.query('begin read only');await observer.query('set local role authenticated');
  await observer.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
  assert.equal((await value(observer,'select public.r05_admission_read($1) result',[business])).authorityRootId,business);
  await observer.query('commit');
  const duplicate=await race(()=>server(left,business,'guard',one),()=>server(right,business,'guard',one));
  assert.ifError(duplicate.b.error);assert.equal(duplicate.a.shouldDispatch,true);assert.equal(duplicate.b.result.shouldDispatch,false);assert.equal(duplicate.b.result.reason,'already_marked');
  assert.equal((await observer.query('select count(*)::int n from private.r05_markers where business_id=$1',[business])).rows[0].n,1);

  business=await seed();one=await input(observer,business,'split-one');const two=await input(observer,business,'split-two');
  const a=await server(observer,business,'prepare',one),b=await server(observer,business,'prepare',two);
  const split=await race(()=>server(left,business,'reserve',{requestId:a.requestId}),()=>server(right,business,'reserve',{requestId:b.requestId}));
  assert.ifError(split.b.error);assert.equal(split.a.reason,'reserved');assert.equal(split.b.result.reason,'financial_cap_exceeded');
  assert.equal((await observer.query('select sum(held)::text n from private.r05_exposure($1)',[business])).rows[0].n,'60');

  business=await seed();one=await input(observer,business,'pause-first');
  const paused=await race(()=>owned(left,business,'pause',{kind:'business',id:business}),()=>server(right,business,'guard',one));
  assert.ifError(paused.b.error);assert.equal(paused.b.result.reason,'scope_paused');
  assert.equal((await observer.query('select count(*)::int n from private.r05_markers where business_id=$1',[business])).rows[0].n,0);

  business=await seed();one=await input(observer,business,'marker-first');
  const sent=await race(()=>server(left,business,'guard',one),()=>owned(right,business,'pause',{kind:'business',id:business}));
  assert.ifError(sent.b.error);assert.equal(sent.a.shouldDispatch,true);assert.equal(sent.b.result.paused,true);
  assert.equal((await server(observer,business,'release_unsent',{requestId:sent.a.requestId,evidenceHash:'a'.repeat(64)})).reason,'marked_liability_cannot_release');

  business=await seed();one=await input(observer,business,'settle-first');const marked=await server(observer,business,'guard',one);const after=await input(observer,business,'settle-next');
  const settled=await race(()=>value(left,"select public.r05_settle($1,$2,'40','inert-concurrent-receipt') result",[business,marked.requestId]),()=>server(right,business,'guard',after));
  assert.ifError(settled.b.error);assert.equal(settled.a.reason,'settled');assert.equal(settled.b.result.shouldDispatch,true);
  assert.equal((await observer.query('select sum(held)::text n from private.r05_exposure($1)',[business])).rows[0].n,'100');

  business=await seed();
  // The first old-lane reservation acquires the same lock as the competing old-lane insert.
  // Use a parent experiment inserted by the first transaction, avoiding artificial fixture bypass.
  const legacy=await value(observer,'select public.r05_legacy($1) result',[business]);
  // Settle original to zero, leaving 100 available for two concurrent new reservations of 60 each.
  await observer.query("select public.r05_legacy_receipt($1,0,'inert-legacy-zero')",[business]);
  const reserve=(c,key)=>c.query("insert into public.product_research_cost_reservations(business_id,experiment_id,workflow_run_id,attempt_key,reserved_microusd,request_hash,estimate) select business_id,experiment_id,workflow_run_id,$2,60,repeat('e',64),'{}' from public.product_research_cost_reservations where id=$1",[legacy,key]);
  const old=await race(()=>reserve(left,'search:luna.standard'),()=>reserve(right,'search:gemini.flash.large'));
  assert.match(old.b.error?.message??'',/r05_business_cap_exceeded/);
  assert.equal((await observer.query('select sum(held)::text n from private.r05_exposure($1)',[business])).rows[0].n,'60');

  business=await seed();one=await input(observer,business,'revocation-race');
  const prepared=await server(observer,business,'prepare',one),policy=(await observer.query('select policy,hash from public.r05_fixture where b=$1',[business])).rows[0];
  const revoked=await race(()=>owned(left,business,'revoke',{policyId:policy.policy,policyHash:policy.hash}),()=>server(right,business,'dispatch',{requestId:prepared.requestId}));
  assert.ifError(revoked.b.error);assert.equal(revoked.b.result.reason,'policy_not_confirmed');

  business=await seed();const account=randomUUID(),revision=randomUUID();
  await observer.query("insert into private.connected_accounts(id,business_id,owner_id,provider,provider_account_id,status,connection_revision,verified_at) values($1,$2,$3,'printful','r05-concurrency-inert','connected',$4,clock_timestamp())",[account,business,owner,revision]);
  const next=(await observer.query('select payload from public.r05_fixture where b=$1',[business])).rows[0].payload;
  next.expectedCapRevision=1;next.operations[0].accountId=account;next.operations[0].accountRevision=revision;
  await begin(observer);const accountPolicy=await owned(observer,business,'propose',next);await owned(observer,business,'confirm',{policyId:accountPolicy.id,policyHash:accountPolicy.hash});await observer.query('commit');
  await observer.query("insert into private.r05_policy_proofs values($1,$2,repeat('c',64),clock_timestamp()+interval '1 day')",[accountPolicy.id,accountPolicy.hash]);
  one={...await input(observer,business,'account-race'),accountId:account,accountRevision:revision};
  const accountRequest=await server(observer,business,'prepare',one);
  const changed=await race(async()=>{await left.query('select id from public.businesses where id=$1 for update',[business]);await left.query('update private.connected_accounts set connection_revision=$1 where id=$2',[randomUUID(),account]);},()=>server(right,business,'dispatch',{requestId:accountRequest.requestId}));
  assert.ifError(changed.b.error);assert.equal(changed.b.result.reason,'account_unavailable');

  business=await seed();
  const transferred=await race(()=>left.query("update public.businesses set owner_user_id='95050000-0000-4000-8000-000000000002' where id=$1",[business]),()=>owned(right,business,'pause',{kind:'business',id:business}));
  assert.match(transferred.b.error?.message??'',/r05_owner_required/);
  assert.equal((await observer.query('select count(*)::int n from private.r05_pause_events where business_id=$1',[business])).rows[0].n,0);

  const receiptBusinessA=await seed(),receiptBusinessB=await seed();
  const requestA=await server(observer,receiptBusinessA,'guard',await input(observer,receiptBusinessA,'receipt-a'));
  const requestB=await server(observer,receiptBusinessB,'guard',await input(observer,receiptBusinessB,'receipt-b'));
  const receiptRace=await race(()=>value(left,"select public.r05_settle($1,$2,'40','inert-global-race') result",[receiptBusinessA,requestA.requestId]),()=>value(right,"select public.r05_settle($1,$2,'40','inert-global-race') result",[receiptBusinessB,requestB.requestId]));
  assert.match(receiptRace.b.error?.message??'',/r05_receipt_already_used/);
  assert.equal((await observer.query('select bool_or(unknown) uncertain from private.r05_exposure($1)',[receiptBusinessB])).rows[0].uncertain,true);

  const legacyBusiness=await seed(),newBusiness=await seed();
  await value(observer,'select public.r05_legacy($1) result',[legacyBusiness]);
  const newRequest=await server(observer,newBusiness,'guard',await input(observer,newBusiness,'legacy-receipt-race'));
  const legacyReceiptRace=await race(()=>value(left,"select public.r05_legacy_receipt($1,40,'inert-legacy-global-race') result",[legacyBusiness]),()=>value(right,"select public.r05_settle($1,$2,'40','inert-legacy-global-race') result",[newBusiness,newRequest.requestId]));
  assert.match(legacyReceiptRace.b.error?.message??'',/r05_receipt_already_used/);
  assert.equal((await observer.query('select count(*)::int n from private.r05_receipt_claims where provider_request_id=$1',['inert-legacy-global-race'])).rows[0].n,1);

  business=await seed();one=await input(observer,business,'eligibility-race');
  const eligibility=await race(()=>left.query("insert into private.r05_operation_revocations(operation_key) values('research.model')"),()=>server(right,business,'guard',one));
  assert.ifError(eligibility.b.error);assert.equal(eligibility.b.result.reason,'operation_evidence_unavailable');
  t.diagnostic('Twelve actual pg_stat_activity/pg_blocking_pids races passed: duplicate marker, split caps, both pause/marker orders, settlement/admission, legacy cap, revocation, account revision, ownership transfer, two cross-Business receipt claims, and registry eligibility revocation. No provider or remote database used.');
 }finally{await Promise.allSettled([left.end(),right.end(),observer.end()]);}
});
