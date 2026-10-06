import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {r07FixtureSetup,r07Seed,R07_KEY,R05_KEY,R07_LEASE,R07_OWNER} from './helpers/r07-sql-fixture.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const digest=x=>createHash('sha256').update(x).digest('hex');
test('R07 actual PostgreSQL lock races: scheduling, leases, markers, callbacks, pause and revocation',{skip:process.env.R07_PG_TEST!=='1'},async t=>{
 assert.ok(process.env.R07_SQL_TEST_HOST);assert.ok(process.env.R07_PG_PASSWORD);
 const port=Number(process.env.R07_PG_PORT??5432);assert.ok(Number.isInteger(port)&&port>=1024&&port<=65535);
 const require=createRequire(path.resolve(process.env.R07_SQL_TEST_HOST,'package.json')),{Client}=require('pg');
 const config={host:'127.0.0.1',port,user:'r07_test',database:'r07_test',password:process.env.R07_PG_PASSWORD,ssl:false,connectionTimeoutMillis:5000,statement_timeout:15000,application_name:'r07-isolated-concurrency'};
 const observer=new Client(config),left=new Client(config),right=new Client(config);
 const value=async(c,q,args=[])=>(await c.query(q,args)).rows[0]?.result;
 const server=(c,s,op,p={},o={})=>value(c,'select public.r07_controller($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9) result',[s.businessId,s.goalId,op,JSON.stringify(p),o.submission??randomUUID(),o.key??R07_KEY,o.lease??R07_LEASE,o.epoch??1,o.admissionKey??R05_KEY]);
 const read=s=>server(observer,s,'read');
 const seed=async()=>{const s=await r07Seed(observer);await server(observer,s,'plan',{plan:s.plan,expectedVersion:0,reason:'Finite concurrency fixture',evidenceHash:'a'.repeat(64)});await server(observer,s,'claim',{seconds:120});return s;};
 const schedulePayload=()=>({stepKey:'research',attemptId:randomUUID(),reason:'Bounded race fixture',evidenceHash:'b'.repeat(64),runtimeCapability:'inert-runtime-capability-'.repeat(3)});
 const reserve=async(s,id)=>{const d=await value(observer,'select public.r05_input($1,$2) result',[s.businessId,`r07:${id}`]);d.workflowRunId=id;delete d.runtimeCapability;return server(observer,s,'reserve',{attemptId:id,descriptor:d,runtimeCapability:'inert-runtime-capability-'.repeat(3)});};
 const scheduled=async()=>{const s=await seed(),p=schedulePayload();await server(observer,s,'schedule',p);await reserve(s,p.attemptId);return {s,id:p.attemptId};};
 const dispatch=(c,s,id,o)=>server(c,s,'dispatch',{attemptId:id,wireHash:'f'.repeat(64)},o);
 const ownerPause=(c,s)=>value(c,"select public.r05_policy_owner($1,'pause',$2::jsonb,gen_random_uuid()) result",[s.businessId,JSON.stringify({kind:'business',id:s.businessId})]);
 const receipt=async(s,id)=>{const snap=await read(s),a=snap.attempts.find(a=>a.id===id);return {attemptId:id,planHash:snap.planHash,inputHash:a.inputHash,outcome:'accepted',result:{evidence:'Observed inert effect'},checkedArtifacts:a.dependencyPins,settlement:{actualMicrounits:'40',providerRequestId:`race:${id}`,receiptHash:digest(id)}};};
 async function begin(c){await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[R07_OWNER]);}
 async function lockWait(){const until=Date.now()+10000;while(Date.now()<until){const state=(await observer.query('select wait_event_type,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',[right.processID])).rows[0];if(state?.wait_event_type==='Lock'&&state.blockers.includes(left.processID))return;await pause(15);}throw new Error('Competing R07 operation never reached an observed lock wait');}
 async function race(first,second,afterWait=async()=>{}){await begin(left);await begin(right);let pending;try{const a=await first();pending=second().then(result=>({result}),error=>({error}));await lockWait();await afterWait();await left.query('commit');const b=await pending;await right.query(b.error?'rollback':'commit');return {a,b};}catch(error){await left.query('rollback').catch(()=>{});if(pending)await pending;await right.query('rollback').catch(()=>{});throw error;}}
 let races=0;
 try{
 await Promise.all([observer.connect(),left.connect(),right.connect()]);
 const target=(await observer.query('select current_database() db,current_user actor')).rows[0];assert.equal(target.db,'r07_test');assert.equal(target.actor,'r07_test');
 assert.equal((await observer.query("select count(*)::int n from pg_tables where schemaname in ('public','private','auth','storage')")).rows[0].n,0,'Refuse a nonempty database');
 await observer.query(r04SqlBootstrap);
 for(const f of readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())await observer.query(readFileSync(path.join(root,'supabase/migrations',f),'utf8'));
 await observer.query(r07FixtureSetup(root));

 let s=await seed(),p1=schedulePayload(),p2=schedulePayload();
 let result=await race(()=>server(left,s,'schedule',p1),()=>server(right,s,'schedule',p2));races++;
 assert.equal(result.a.status,'scheduled');assert.match(result.b.error?.message??'',/attempt_already_pending/);assert.equal((await read(s)).head.childrenCreated,1);

 let pending=await scheduled();s=pending.s;
 result=await race(()=>dispatch(left,s,pending.id),()=>dispatch(right,s,pending.id));races++;
 assert.equal(result.a.shouldDispatch,true);assert.equal(result.b.result.shouldDispatch,false);assert.equal((await read(s)).head.dispatches,1);

 pending=await scheduled();s=pending.s;
 result=await race(()=>ownerPause(left,s),()=>dispatch(right,s,pending.id));races++;
 assert.equal(result.b.result.reason,'scope_paused');assert.equal((await read(s)).head.dispatches,0);

 pending=await scheduled();s=pending.s;
 result=await race(()=>dispatch(left,s,pending.id),()=>ownerPause(right,s));races++;
 assert.equal(result.a.shouldDispatch,true);assert.equal(result.b.result.paused,true);assert.equal((await read(s)).head.dispatches,1);
 const response=await receipt(s,pending.id);
 result=await race(()=>server(left,s,'response',response),()=>server(right,s,'response',response));races++;
 assert.equal(result.a.recorded,true);assert.equal(result.b.result.recorded,true);
 assert.equal((await observer.query('select count(*)::int n from private.r07_responses where attempt_id=$1',[pending.id])).rows[0].n,1);

 pending=await scheduled();s=pending.s;await dispatch(observer,s,pending.id);
 const accepted=await receipt(s,pending.id),conflict={...accepted,outcome:'rejected'};
 result=await race(()=>server(left,s,'response',accepted),()=>server(right,s,'response',conflict));races++;
 assert.match(result.b.error?.message??'',/response_conflict/);

 pending=await scheduled();s=pending.s;
 await observer.query("update private.r07_heads set lease_expires_at=clock_timestamp()-interval '1 second' where goal_id=$1",[s.goalId]);
 result=await race(()=>server(left,s,'claim',{seconds:120},{lease:'new-left-lease-'.repeat(4)}),()=>server(right,s,'claim',{seconds:120},{lease:'new-right-lease-'.repeat(4)}));races++;
 assert.equal(result.a.epoch,2);assert.match(result.b.error?.message??'',/lease_held/);
 await assert.rejects(dispatch(observer,s,pending.id),/stale_controller/);

 // Exact per-fixture clone avoids altering or deleting immutable shared qualification.
 s=await r07Seed(observer);const adapter=`fixture.revocation.${randomUUID()}`;
 await observer.query('insert into private.r07_adapters select $1,qualification_hash,workflow_definition_id,worker_definition_id,workflow_hash,worker_hash,operation_key,role,purpose,artifact_type,mode,valid_from,valid_until,knowledge_valid_until from private.r07_adapters where adapter_key=$2',[adapter,'fixture.research']);
 s.plan.steps[0].adapter=adapter;await server(observer,s,'plan',{plan:s.plan,expectedVersion:0,reason:'Revocation race',evidenceHash:'c'.repeat(64)});await server(observer,s,'claim',{seconds:120});
 const scheduledPayload=schedulePayload();await server(observer,s,'schedule',scheduledPayload);await reserve(s,scheduledPayload.attemptId);
 result=await race(()=>left.query('insert into private.r07_adapter_revocations(adapter_key) values($1)',[adapter]),()=>dispatch(right,s,scheduledPayload.attemptId));races++;
 assert.equal(result.b.result.reason,'adapter_unqualified');assert.equal((await read(s)).head.dispatches,0);

 pending=await scheduled();s=pending.s;const key='inert-r07-revocation-only-'.repeat(3);
 await observer.query('insert into private.r07_server_keys values($1,clock_timestamp()+interval \'1 hour\')',[digest(key)]);
 result=await race(()=>left.query('insert into private.r07_server_revocations(key_hash) values($1)',[digest(key)]),()=>dispatch(right,s,pending.id,{key}));races++;
 assert.match(result.b.error?.message??'',/server_authority_required/);assert.equal((await read(s)).head.dispatches,0);


 pending=await scheduled();s=pending.s;
 await observer.query("update private.r07_heads set lease_expires_at=clock_timestamp()+interval '1 second' where goal_id=$1",[s.goalId]);
 result=await race(()=>left.query("select * from private.r07_adapters where adapter_key='fixture.research' for update"),()=>dispatch(right,s,pending.id),()=>pause(1500));races++;
 assert.match(result.b.error?.message??'',/stale_controller/);
 assert.equal((await observer.query('select count(*)::int n from private.r05_markers m join private.r07_bindings b on b.request_id=m.request_id where b.attempt_id=$1',[pending.id])).rows[0].n,0,'An expired lease rolls back the nested R05 marker');

 pending=await scheduled();s=pending.s;
 await observer.query("update private.r07_heads set lease_expires_at=clock_timestamp()+interval '1 second' where goal_id=$1",[s.goalId]);
 result=await race(()=>left.query('select * from public.worker_runs where workflow_run_id=$1 for update',[pending.id]),()=>dispatch(right,s,pending.id),()=>pause(1500));races++;
 assert.match(result.b.error?.message??'',/stale_controller/);
 assert.equal((await observer.query('select count(*)::int n from private.r07_markers where attempt_id=$1',[pending.id])).rows[0].n,0,'Core-row wait cannot outlive the controller lease');

 pending=await scheduled();s=pending.s;const admissionKey='inert-r05-wrapper-revocation-'.repeat(3);
 await observer.query("insert into private.r05_server_keys values($1,clock_timestamp()+interval '1 hour')",[digest(admissionKey)]);
 result=await race(()=>left.query('insert into private.r05_server_revocations(key_hash) values($1)',[digest(admissionKey)]),()=>dispatch(right,s,pending.id,{admissionKey}));races++;
 assert.match(result.b.error?.message??'',/admission_authority_required/);assert.equal((await read(s)).head.dispatches,0);

 // R12 shares the original research root with the callable legacy ledger.
 // Both legacy entry points must wait on Business before touching that root.
 for(const operation of ['reserve','settle']){
  const businessId=(await observer.query('select public.r05_seed(1000) b')).rows[0].b;
  const f=(await observer.query('select * from public.r05_fixture where b=$1',[businessId])).rows[0],rootId=randomUUID();
  const intent={version:'pod-discovery-2.0',id:rootId,businessId,limits:{maximumMicrousd:500000}};
  const variables={intent,policyHash:(await observer.query('select private.stage14_hash($1) hash',[intent])).rows[0].hash,semanticGoalHash:'a'.repeat(64),budgetAuthorityRootId:rootId,ownerKickoff:{followUpBasis:null}};
  await observer.query(`insert into public.product_experiments(id,business_id,candidate_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan,discovery_version,failure,completed_at) values($1,$2,null,$3,$4,'Inert lock-order fixture',$5,'Adult audience','failed','{"version":"pod-discovery-2.0","testPlan":null}','pod-discovery-2.0','Historical inert failure',clock_timestamp())`,[rootId,businessId,f.w,digest(rootId),variables]);
  const effect=()=>operation==='reserve'
   ? right.query('select public.reserve_product_research_cost($1,$2,$3,$4,$5,$6,$7)',[f.w,businessId,'capability-'.repeat(5),'plan:1',1,'a'.repeat(64),{}])
   : right.query('select public.record_product_research_cost($1,$2,$3,$4,$5,$6)',[f.w,businessId,'capability-'.repeat(5),'plan:1',null,null]);
  const result=await race(()=>left.query('select id from public.businesses where id=$1 for update',[businessId]),effect,async()=>{
   await left.query("set local lock_timeout='2000ms'");
   await left.query('select id from public.product_experiments where id=$1 for update',[rootId]);
  });races++;
  assert.notEqual(result.b.error?.code,'40P01',`${operation} must not invert the Business/shared-root order`);
 }

 await observer.query('begin read only');await observer.query('set local role authenticated');await observer.query("select set_config('request.jwt.claim.sub',$1,true)",[R07_OWNER]);
 assert.ok(await value(observer,'select public.r07_quest_read($1,$2) result',[s.businessId,s.goalId]));await observer.query('commit');
 t.diagnostic(`${races} observed independent-session lock waits passed; stale leases, duplicate scheduling/dispatch/callbacks, pause ordering and authority/adapter revocation fenced`);
 }finally{await Promise.all([observer.end(),left.end(),right.end()]);}
});
