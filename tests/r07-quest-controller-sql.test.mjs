import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {r07FixtureSetup,r07Seed,R07_KEY,R05_KEY,R07_LEASE,R07_OWNER} from './helpers/r07-sql-fixture.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const host=process.env.R07_SQL_TEST_HOST;
const digest=x=>createHash('sha256').update(x).digest('hex');
const migration='20261003184640_r07_quest_controller.sql';
test('R07 SQL rollback, immutable lineage, qualified R05 admission and crash recovery',{skip:!host},async t=>{
 const require=createRequire(path.resolve(host,'package.json'));
 const {PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
 const db=new PGlite({extensions:{pgcrypto}});
 const sql=file=>readFileSync(path.join(root,file),'utf8');
 const functions=`select p.oid::regprocedure::text id,md5(pg_get_functiondef(p.oid)) hash,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' order by 1`;
 let oldFunctions;
 try{
 await db.exec(r04SqlBootstrap);
 for(const file of readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')).sort()){
  let source=sql(`supabase/migrations/${file}`);
  if(file===migration){
   oldFunctions=(await db.query(functions)).rows;
   assert.equal(source.split(' to anon;\ncommit;').length,2);
   await assert.rejects(db.exec(source.replace(' to anon;\ncommit;',' to r07_missing_role;\ncommit;')));
   await db.exec('rollback');
   assert.equal((await db.query("select count(*)::int n from pg_tables where schemaname='private' and tablename like 'r07_%'")).rows[0].n,0);
  }
  try{await db.exec(source);}catch(error){throw new Error(`${file}: ${error.message}`,{cause:error});}
  if(file===migration){const immediatelyAfter=new Map((await db.query(functions)).rows.map(x=>[x.id,x]));for(const old of oldFunctions)assert.deepEqual(immediatelyAfter.get(old.id),old);}
 }
 // Check preservation immediately around R07 above. Later reviewed migrations
 // may intentionally extend prior accounting contracts (R12 shared funding).
 assert.equal((await db.query('select count(*)::int n from private.r07_adapters')).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from private.r07_server_keys')).rows[0].n,0);
 await db.exec(r07FixtureSetup(root));
 const server=async(scope,op,payload={},options={})=>(await db.query('select public.r07_controller($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9) result',[scope.businessId,scope.goalId,op,JSON.stringify(payload),options.submission??randomUUID(),options.key??R07_KEY,options.lease??R07_LEASE,options.epoch??1,R05_KEY])).rows[0].result;
 const read=scope=>server(scope,'read');
 const create=async()=>{const scope=await r07Seed(db);scope.created=await server(scope,'plan',{plan:scope.plan,expectedVersion:0,reason:'Initial qualified fixture',evidenceHash:'1'.repeat(64)});await server(scope,'claim',{seconds:120});return scope;};
 const schedule=async(scope,key='research',evidenceHash='2'.repeat(64))=>{const id=randomUUID();await server(scope,'schedule',{stepKey:key,attemptId:id,reason:'Fresh bounded evidence',evidenceHash,runtimeCapability:'inert-runtime-capability-'.repeat(3)});return id;};
 const reserve=async(scope,id)=>{
  const input=(await db.query('select public.r05_input($1,$2) x',[scope.businessId,`r07:${id}`])).rows[0].x;
  input.workflowRunId=id;delete input.runtimeCapability;
  return server(scope,'reserve',{attemptId:id,descriptor:input,runtimeCapability:'inert-runtime-capability-'.repeat(3)});
 };
 const dispatch=(scope,id,options)=>server(scope,'dispatch',{attemptId:id,wireHash:'f'.repeat(64)},options);
 const response=async(scope,id,outcome='accepted',actual='40')=>{
  const snap=await read(scope),attempt=snap.attempts.find(x=>x.id===id),step=snap.plan.steps.find(x=>x.key===attempt.stepKey);
  return server(scope,'response',{attemptId:id,planHash:snap.planHash,inputHash:attempt.inputHash,outcome,result:step.kind==='challenge'?{verdict:outcome==='accepted'?'pass':'reject'}:{evidence:'inert verified fixture'},checkedArtifacts:attempt.dependencyPins,settlement:{actualMicrounits:actual,providerRequestId:`inert:${id}`,receiptHash:digest(`${id}:${actual}`)}});
 };
 const complete=async(scope,key,outcome='accepted')=>{const id=await schedule(scope,key);assert.equal((await reserve(scope,id)).status,'reserved');assert.equal((await dispatch(scope,id)).shouldDispatch,true);await response(scope,id,outcome);await server(scope,'finish',{attemptId:id});return id;};
 let scope=await create();
 const id=await schedule(scope);assert.equal((await reserve(scope,id)).status,'reserved');
 const submission=randomUUID();assert.equal((await dispatch(scope,id,{submission})).shouldDispatch,true);
 assert.equal((await dispatch(scope,id,{submission})).shouldDispatch,false);
 assert.equal((await dispatch(scope,id)).shouldDispatch,false);
 await server(scope,'uncertain',{attemptId:id,evidenceHash:'3'.repeat(64)});
 assert.equal((await read(scope)).attempts[0].status,'uncertain');
 await response(scope,id,'accepted',null);
 assert.equal((await server(scope,'finish',{attemptId:id})).reason,'unresolved_liability');
 await server(scope,'settle',{attemptId:id,settlement:{actualMicrounits:'40',providerRequestId:`inert:${id}`,receiptHash:digest(`${id}:40`)}});
 await server(scope,'finish',{attemptId:id});
 await complete(scope,'challenge');await complete(scope,'work');
 assert.equal((await server(scope,'evaluate')).state,'completed');
 assert.equal((await read(scope)).head.dispatches,3);
 assert.equal((await read(scope)).targetAchievement,'unverified');
 await assert.rejects(schedule(scope,'research'),/controller_terminal/);
 const output=(await db.query('select artifact_id from private.r07_responses where attempt_id=$1',[id])).rows[0].artifact_id;
 await assert.rejects(db.query("update public.artifacts set content='{}' where id=$1",[output]),/immutable_output/);
 await assert.rejects(db.query('update public.workflow_runs set goal_id=null where id=$1',[id]),/core_rpc_required/);

 scope=await create();const reserved=await schedule(scope);await reserve(scope,reserved);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[R07_OWNER]);
 await db.query("select public.r05_policy_owner($1,'pause',$2::jsonb,gen_random_uuid())",[scope.businessId,JSON.stringify({kind:'business',id:scope.businessId})]);
 assert.equal((await dispatch(scope,reserved)).reason,'scope_paused');
 assert.equal((await db.query('select count(*)::int n from private.r07_markers where attempt_id=$1',[reserved])).rows[0].n,0);
 await server(scope,'cancel',{attemptId:reserved,evidenceHash:'4'.repeat(64)});
 assert.equal((await read(scope)).attempts[0].status,'cancelled');

 scope=await create();await complete(scope,'research');const rejected=await complete(scope,'challenge','rejected');
 await assert.rejects(schedule(scope,'work'),/prerequisites_required/);
 await assert.rejects(schedule(scope,'challenge'),/repair_exhausted_or_unchanged/);
 const repair=await schedule(scope,'challenge',(await read(scope)).attempts.find(a=>a.id===rejected).resultEvidenceHash);await reserve(scope,repair);await dispatch(scope,repair);await response(scope,repair);await server(scope,'finish',{attemptId:repair});
 assert.equal((await read(scope)).head.repairsUsed,1);
 assert.equal((await db.query('select content from private.r07_responses where attempt_id=$1',[rejected])).rows[0].content.outcome,'rejected');
 await assert.rejects(response(scope,rejected),/response_conflict/);

 scope=await create();const a=await schedule(scope);await reserve(scope,a);
 await db.query("update private.r07_heads set lease_expires_at=clock_timestamp()-interval '1 second' where goal_id=$1",[scope.goalId]);
 assert.equal((await server(scope,'claim',{seconds:120},{lease:'inert-new-process-lease-'.repeat(3)})).epoch,2);
 await assert.rejects(dispatch(scope,a),/stale_controller/);
 assert.equal((await dispatch(scope,a,{epoch:2,lease:'inert-new-process-lease-'.repeat(3)})).shouldDispatch,true);
 await response(scope,a);
 await assert.rejects(server(scope,'finish',{attemptId:a}),/stale_controller/);
 await server(scope,'finish',{attemptId:a},{epoch:2,lease:'inert-new-process-lease-'.repeat(3)});


 // SQL independently rejects malformed/null consequential fields.
 let invalid=await r07Seed(db);invalid.plan.steps[2].kind='measure';invalid.plan.steps[2].measurement={minimumObservations:1,closesAt:null};
 await assert.rejects(server(invalid,'plan',{plan:invalid.plan,expectedVersion:0,reason:'Invalid window',evidenceHash:'a'.repeat(64)}),/invalid_measurement/);
 invalid=await r07Seed(db);invalid.plan.steps[0].notBefore='tomorrow';
 await assert.rejects(server(invalid,'plan',{plan:invalid.plan,expectedVersion:0,reason:'Invalid time',evidenceHash:'a'.repeat(64)}),/invalid_time/);

 // Exact replay conflicts and off-context owner reads are not fallback selection.
 const other=await create();
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[R07_OWNER]);
 await assert.rejects(db.query('select public.r07_quest_read($1,$2)',[other.businessId,scope.goalId]),/quest_unavailable/);
 await assert.rejects(db.query('select public.r07_quest_read($1,$2,$3)',[other.businessId,other.goalId,scope.created.planId]),/plan_unavailable/);
 await assert.rejects(db.query('select public.r07_quest_read($1,$2,null,null,0)',[other.businessId,other.goalId]),/invalid_page/);
 await assert.rejects(server(other,'read',{}, {key:'wrong'}),/server_authority_required/);

 // The lower R07 cap survives known actual charges above the quote and old plans.
 const bounded=await r07Seed(db);bounded.plan.maximumMicrounits='180';bounded.plan.steps.forEach(x=>x.maximumMicrounits='60');
 await server(bounded,'plan',{plan:bounded.plan,expectedVersion:0,reason:'Lower R07 ceiling',evidenceHash:'a'.repeat(64)});await server(bounded,'claim',{seconds:120});
 for(const [key,actual] of [['research','100'],['challenge','70']]){const attempt=await schedule(bounded,key);await reserve(bounded,attempt);await dispatch(bounded,attempt);await response(bounded,attempt,'accepted',actual);await server(bounded,'finish',{attemptId:attempt});}
 const exhausted=await schedule(bounded,'work');assert.equal((await reserve(bounded,exhausted)).reason,'plan_budget_exhausted');
 assert.equal((await db.query('select sum(held)::text amount from private.r05_exposure($1)',[bounded.businessId])).rows[0].amount,'170');

 // Superseding a plan keeps its exact successful research and all counters.
 const pivot=await create();const research=await complete(pivot,'research');const rejection=await complete(pivot,'challenge','rejected');
 const before=await read(pivot),failureHash=before.attempts.find(x=>x.id===rejection).resultEvidenceHash;
 const replacement=structuredClone(pivot.plan);replacement.maximumPivots=1;replacement.steps[2].objective='Narrower work after rejection';
 const changed=await server(pivot,'plan',{plan:replacement,expectedVersion:1,reason:'Respond to rejected challenge',evidenceHash:failureHash});
 const afterPivot=await read(pivot);assert.equal(afterPivot.reused[0].attemptId,research);assert.equal(afterPivot.head.dispatches,2);assert.equal(afterPivot.head.pivotsUsed,1);
 assert.equal((await db.query('select count(*)::int n from private.r07_plans where goal_id=$1',[pivot.goalId])).rows[0].n,2);
 await assert.rejects(server(pivot,'plan',{plan:replacement,expectedVersion:2,reason:'Repeated rejected evidence',evidenceHash:failureHash}),/pivot_exhausted_or_unchanged/);
 await assert.rejects(server(pivot,'plan',{plan:pivot.plan,expectedVersion:0,reason:'Attempt reset',evidenceHash:'a'.repeat(64)}),/plan_compare_and_swap/);
 assert.equal((await db.query('select public.r07_quest_read($1,$2,$3) x',[pivot.businessId,pivot.goalId,pivot.created.planId])).rows[0].x.selected.version,1);
 assert.notEqual(changed.planId,pivot.created.planId);

 // No unbounded repair: unchanged rejected result is not fresh evidence.
 const repeating=await create();await complete(repeating,'research');const failOne=await complete(repeating,'challenge','rejected');
 const failure=(await read(repeating)).attempts.find(x=>x.id===failOne).resultEvidenceHash;
 const retry=await schedule(repeating,'challenge',failure);await reserve(repeating,retry);await dispatch(repeating,retry);await response(repeating,retry,'rejected');await server(repeating,'finish',{attemptId:retry});
 await assert.rejects(schedule(repeating,'challenge',failure),/repair_exhausted_or_unchanged/);
 assert.equal((await server(repeating,'evaluate')).reason,'no_permitted_work');
 assert.equal((await read(repeating)).head.dispatches,3);
 assert.ok((await read(repeating)).attempts.find(x=>x.id===retry).dependencyPins.some(x=>x.attemptId===failOne&&x.stepKey==='repair:challenge'));

 // Revoked policy and stale Knowledge stop before reserve; no authority by consent labels.
 const revoked=await create(),revAttempt=await schedule(revoked);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[R07_OWNER]);
 await db.query("select public.r05_policy_owner($1,'revoke',$2::jsonb,gen_random_uuid())",[revoked.businessId,JSON.stringify({policyId:revoked.plan.policyId,policyHash:revoked.plan.policyHash})]);
 assert.equal((await reserve(revoked,revAttempt)).reason,'policy_not_confirmed');
 const stale=await r07Seed(db),adapter=`fixture.expired.${randomUUID()}`;
 await db.query("insert into private.r07_adapters select $1,qualification_hash,workflow_definition_id,worker_definition_id,workflow_hash,worker_hash,operation_key,role,purpose,artifact_type,mode,clock_timestamp()-interval '2 hours',valid_until,clock_timestamp()-interval '1 hour' from private.r07_adapters where adapter_key='fixture.research'",[adapter]);
 stale.plan.steps[0].adapter=adapter;await server(stale,'plan',{plan:stale.plan,expectedVersion:0,reason:'Expired Knowledge fixture',evidenceHash:'a'.repeat(64)});await server(stale,'claim',{seconds:120});
 assert.equal((await server(stale,'schedule',{stepKey:'research',attemptId:randomUUID(),reason:'Attempt stale dispatch',evidenceHash:'a'.repeat(64),runtimeCapability:'inert-runtime-capability-'.repeat(3)})).reason,'qualification_or_knowledge_expired');
 assert.equal((await read(stale)).attempts.length,0);
 assert.equal((await db.query('select count(*)::int n from private.r07_core_admissions')).rows[0].n,0,'Mutation admission is not reusable after RPC return');

 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[R07_OWNER]);
 await db.exec('begin read only; set local role authenticated;');
 const ownerRead=(await db.query('select public.r07_quest_read($1,$2) x',[scope.businessId,scope.goalId])).rows[0].x;
 assert.equal(ownerRead.selected.plan.goalId,scope.goalId);assert.equal(JSON.stringify(ownerRead).includes(R07_KEY),false);
 await db.exec('rollback');
 await db.exec('set role authenticated');
 await assert.rejects(db.query("update public.task_contracts set objective='Forged' where workflow_run_id=$1",[a]),/core_rpc_required/);
 await assert.rejects(db.query("update public.worker_runs set output='{}',status='completed' where workflow_run_id=$1",[a]),/core_rpc_required/);
 await assert.rejects(db.query("update public.workflow_stage_runs set output='{}',status='completed' where workflow_run_id=$1",[a]),/core_rpc_required/);
 await assert.rejects(db.query("update public.workflow_runs set status='completed' where id=$1",[a]),/core_rpc_required/);

 await assert.rejects(db.query('select * from private.r07_plans'),/permission denied/);
 await db.query("select set_config('request.jwt.claim.sub','95050000-0000-4000-8000-000000000002',false)");
 await assert.rejects(db.query('select public.r07_quest_read($1,$2)',[scope.businessId,scope.goalId]),/owner_required/);
 await db.exec('reset role');
 t.diagnostic(`R07: ${oldFunctions.length} prior functions/grants preserved; empty live registries; bounded three-step recovery, R05 settlement, pause, repair, callbacks and stale-controller fencing verified`);
 }finally{await db.close();}
});
