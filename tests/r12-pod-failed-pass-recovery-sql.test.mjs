// Isolated current-source qualification only. All transport is inert; no grants,
// provider network, live evidence, account access or production data are used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {validateOwnerInitialRaceEnvironment,orderedRace,asRole} from './helpers/r12-owner-initial-postgres-races.mjs';
import {POD_PHASES,podSource,podHash,podSha,podOne,podRpc,podQuoteFixture,podRuntimeFixture} from './helpers/r12-pod-sql-fixture.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const host=process.env.R12_SQL_TEST_HOST??process.env.R11_SQL_TEST_HOST;
const nativeRequested=process.env.R12_REQUIRE_POSTGRES==='1';
const runtime=podSource('products/discovery-r12-pod-runtime');

async function openDatabase(){
 if(!nativeRequested){
  const require=createRequire(path.resolve(host,'package.json')),{PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
  const db=new PGlite({extensions:{pgcrypto}});await db.exec("set timezone='UTC'");
  return{db,native:null};
 }
 // Reuse the guarded, already-existing native host contract. Never silently
 // replace native PostgreSQL race evidence with a PGlite run or reset here.
 const target=validateOwnerInitialRaceEnvironment(process.env),require=createRequire(path.resolve(target.host,'package.json'));
 assert.equal(require('pg/package.json').version,'8.16.3');
 const {Client}=require('pg'),clients=['observer','holder','waiter'].map(label=>new Client({connectionString:target.url,ssl:false,application_name:'r12-pod-recovery-'+label,connectionTimeoutMillis:5000}));
 const [db,holder,waiter]=clients;
 const close=async()=>{await Promise.all(clients.map(async c=>{await c.query('rollback').catch(()=>{});await c.end().catch(()=>{});}));};
 try{
  for(const client of clients){
   await client.connect();client.exec=sql=>client.query(sql);await client.query("set timezone='UTC'");
   assert.deepEqual(await podOne(client,'select current_user actor,current_database() db,host(inet_server_addr()) address'),{actor:'r12_test',db:'r12_test',address:target.address});
  }
  assert.equal((await podOne(db,"select count(*)::int n from pg_tables where schemaname in ('public','private')")).n,0,'Refuse populated native database; use the existing guarded fresh reset');
  assert.deepEqual((await db.query("select rolname from pg_roles where rolname in ('anon','authenticated','service_role')")).rows,[],'Fresh native bootstrap roles required');
  db.close=close;return{db,native:{observer:db,holder,waiter,races:[],coldDispatch:null,newColdClient:()=>new Client({connectionString:target.url,ssl:false,application_name:'r12-pod-recovery-cold-dispatch',connectionTimeoutMillis:5000}),address:target.address}};
 }catch(error){await close();throw error;}
}
function recordRace(native,name,race){
 assert.equal(race.observedLockWait,true);native.races.push({name,observedLockWait:true,waitEvent:race.waitEvent});
}

async function prepareReservedSuccessor(db,a,{checkMissingWire=false}={}){
 const before=await a.store.read(),attempt=before.attempts.find(x=>x.stepKey==='plan'&&x.status==='reserved');
 assert.ok(attempt);
 assert.equal((await podOne(db,'select count(*)::int n from private.r12_discovery_wires where attempt_id=$1',[attempt.id])).n,0);
 if(checkMissingWire){
  await assert.rejects(a.command('dispatch',{attemptId:attempt.id,wireHash:attempt.wireHash},before.head.epoch),/r12_source_dispatch_bridge_unavailable/,'Reservation alone cannot authorize a source dispatch');
  assert.equal((await podOne(db,'select count(*)::int n from private.r05_markers where request_id=$1',[attempt.requestId])).n,0);
  const unchanged=await a.store.read();assert.equal(unchanged.head.dispatches,before.head.dispatches);assert.equal(unchanged.attempts.find(x=>x.id===attempt.id).status,'reserved');
 }
 // Match the real controller's second prepare, after reserve assigned requestId.
 // This persists the actual validated source wire on the ordinary connection;
 // it neither sends nor warms the fresh native timing backend.
 const step=before.plan.steps.find(x=>x.key===attempt.stepKey);
 const context={planId:before.planId,planHash:before.planHash,plan:before.plan,step,attempt,knowledge:before.knowledge};
 const call=await a.registry[step.adapter].prepare(context);
 assert.equal(call.descriptor.wireRequestHash,attempt.wireHash);
 const wire=await podOne(db,"select request_id,binding->>'wireHash' wire_hash from private.r12_discovery_wires where attempt_id=$1",[attempt.id]);
 assert.deepEqual(wire,{request_id:attempt.requestId,wire_hash:attempt.wireHash});
 assert.equal(a.posted.length,0);assert.equal(a.got.length,0);
 return{snapshot:await a.store.read(),attempt};
}

async function qualifyColdSuccessorDispatch(db,native,a){
 const {snapshot,attempt}=await prepareReservedSuccessor(db,a,{checkMissingWire:true});
 // PGlite executes the identical prepared marker/rollback path as a functional
 // regression. Only an actual fresh PostgreSQL backend qualifies cold timing.
 const cold=native?native.newColdClient():db;
 try{
  if(native){
   await cold.connect();
   assert.deepEqual(await podOne(cold,'select current_user actor,current_database() db,host(inet_server_addr()) address'),{actor:'r12_test',db:'r12_test',address:native.address});
  }
  await cold.query('begin');await cold.query("set local timezone='UTC'");
  if(native)await cold.query("set local statement_timeout='3000ms'");
  await cold.query('set local role anon');
  assert.equal((await podOne(cold,'select current_user actor')).actor,'anon');
  if(native)assert.equal((await podOne(cold,"select current_setting('statement_timeout') timeout")).timeout,'3s');
  const start=performance.now();
  const marked=(await podOne(cold,'select public.r07_controller($1,$2,$3,$4,$5,$6,$7,$8,$9) result',[
   a.f.businessId,a.f.goalId,'dispatch',{attemptId:attempt.id,wireHash:attempt.wireHash},randomUUID(),a.controller,a.lease,snapshot.head.epoch,a.admission])).result;
  const elapsedMs=Math.round((performance.now()-start)*1000)/1000;
  assert.equal(marked.shouldDispatch,true,JSON.stringify(marked));
  if(native)native.coldDispatch={engine:'native-postgresql',session:'fresh-backend',role:'anon',phase:'successor-first-plan',statementTimeoutMs:3000,elapsedMs,shouldDispatch:true,rolledBack:true,providerCalls:0};
 }finally{await cold.query('rollback').catch(()=>{});if(native)await cold.end().catch(()=>{});}
 assert.equal((await podOne(db,'select count(*)::int n from private.r05_markers where request_id=$1',[attempt.requestId])).n,0,'Marker trial must roll back its dispatch marker');
 assert.equal((await podOne(db,'select count(*)::int n from private.r12_discovery_transport_claims where request_id=$1',[attempt.requestId])).n,0);
 const after=await a.store.read();assert.equal(after.head.dispatches,snapshot.head.dispatches);assert.equal(after.attempts.find(x=>x.id===attempt.id).status,'reserved');
 assert.equal(a.posted.length,0);assert.equal(a.got.length,0);
}

async function originalRecords(db,a){
 return (await podOne(db,`select jsonb_build_object(
 'setup',(select to_jsonb(s) from private.r12_pod_setups s where id=$1),
 'scope',(select to_jsonb(s) from private.r12_discovery_scopes s where id=$2),
 'policy',(select to_jsonb(p) from private.r05_policies p where id=$3),
 'plan',(select to_jsonb(p) from private.r07_plans p where id=$4),
 'passes',(select jsonb_agg(to_jsonb(d) order by ordinal) from private.r12_pod_passes d where scope_id=$2),
 'calls',(select jsonb_agg(to_jsonb(c) order by ordinal,phase) from private.r12_pod_pass_calls c where scope_id=$2),
 'attempts',(select jsonb_agg(to_jsonb(x) order by id) from private.r07_attempts x where plan_id=$4),
 'responses',(select jsonb_agg(to_jsonb(r) order by r.attempt_id) from private.r07_responses r join private.r07_attempts x on x.id=r.attempt_id where x.plan_id=$4),
 'candidates',(select jsonb_agg(to_jsonb(c) order by c.request_id) from private.r12_discovery_candidates c join private.r12_pod_pass_calls x on x.request_id=c.request_id where x.scope_id=$2),
 'observations',(select jsonb_agg(to_jsonb(o) order by o.request_id,o.kind) from private.r12_discovery_response_observations o join private.r12_pod_pass_calls x on x.request_id=o.request_id where x.scope_id=$2),
 'settlements',(select jsonb_agg(to_jsonb(z) order by z.request_id,z.id) from private.r05_settlements z join private.r12_pod_pass_calls x on x.request_id=z.request_id where x.scope_id=$2)
 ) records`,[a.prepared.setupId,a.scope.id,a.prepared.policyId,(await podOne(db,"select id from private.r07_plans where content->>'discoveryScopeId'=$1",[a.scope.id])).id])).records;
}

async function rejectedPass(db,{failureOrdinal=0}={}){
 assert.ok(Number.isInteger(failureOrdinal)&&failureOrdinal>=0&&failureOrdinal<4);
 const usedPasses=failureOrdinal+1,usedCalls=usedPasses*5,spent=usedCalls*10;
 const a=await podRuntimeFixture(db,{usefulPass:null}),failedOutput=a.outputsByPass[failureOrdinal];
 for(const i of [1,2,3,4,5])failedOutput.review.checks[i].rationale='The source does not establish relevant independent demand, competitive advantage, fulfilment reliability, delivered economics, or rights clearance. '.repeat(2);
 failedOutput.review.nextTest='Seek independent aggregate public evidence under the approved source policy before recommending a product test. '.repeat(4);
 const originalReview=structuredClone(failedOutput.review);
 let rejection;
 for(let i=0;i<usedPasses*30;i++){
  try{const tick=await a.tick();assert.equal(tick.status,'progress',JSON.stringify(tick));}
  catch(error){rejection=error;break;}
 }
 assert.ok(rejection,'The oversized independent review must be rejected');
 assert.match(rejection.message,/schema|characters|validation|output/i);
 assert.deepEqual(a.posted,Array.from({length:usedPasses},()=>POD_PHASES).flat());
 assert.deepEqual(a.got,Array.from({length:usedPasses},()=>POD_PHASES).flat().slice(0,-1),'A rejected reviewer response never becomes a route-qualified accepted candidate');
 const failed=await a.store.read();
 assert.equal(failed.attempts.length,usedCalls);
 assert.equal(failed.attempts.filter(x=>x.status==='completed').length,usedCalls-1);
 const review=failed.attempts.find(x=>x.stepKey==='review'&&x.adaptiveActionOrdinal===failureOrdinal);
 assert.notEqual(review.status,'completed');assert.equal(review.responseHash,null);
 assert.equal((await a.f.read()).finance.committedMicrounits,String(spent));
 assert.equal((await a.f.read()).finance.hasUnknown,false,'Even the rejected call remains settled and charged');
 await assert.rejects(podRpc(db,'authenticated',a.f.ownerId,'r12_pod_recovery_read',[a.f.businessId,a.prepared.setupId]),/stopped_failed_pass/);
 await a.f.server('stop',{setupId:a.prepared.setupId,setupHash:a.prepared.setupHash,submissionId:randomUUID()},'');
 assert.equal((await podRpc(db,'anon',null,'r12_pod_runtime_read',[a.f.businessId,a.scope.id,a.f.bootstrapKey])).activeWindow,false);
 assert.equal(a.posted.length,usedCalls);
 const c=await podRpc(db,'authenticated',a.f.ownerId,'r12_pod_recovery_read',[a.f.businessId,a.prepared.setupId]);
 assert.equal(c.proof.usedPasses,usedPasses);assert.equal(c.proof.usedCalls,usedCalls);assert.equal(c.proof.usedSearches,usedPasses);
 assert.equal(c.proof.spentMicrounits,String(spent));assert.equal(c.proof.originalMaximumMicrounits,'10000000');assert.equal(c.proof.remainingMaximumMicrounits,String(10000000-spent));
 assert.equal(c.history.previousPass,failureOrdinal);assert.equal(c.history.priorQueries.length,usedPasses);
 assert.equal((await podOne(db,'select count(*)::int n from private.r12_pod_pass_closures where scope_id=$1',[a.scope.id])).n,failureOrdinal);
 assert.equal(c.proof.originalDeadline,a.scope.expiresAt);
 assert.equal(c.proofHash,podHash(c.proof));assert.equal(c.historyHash,podHash(c.history));
 assert.equal(c.history.reviewAccepted,false);assert.equal(c.history.kind,'failed_pass_context');
 assert.deepEqual(c.history.untrustedCritique,originalReview);assert.deepEqual(JSON.parse(c.observation.content),originalReview);
 assert.equal(c.inputs.dependencies.length,4);assert.ok(c.inputs.dependencies.every(d=>d.response.outcome==='accepted'));
 const classified=runtime.inspectPodFailedReview(c.context,runtime.readPodResearchPhaseInputs(c.context,c.inputs),JSON.parse(c.observation.content));
 assert.deepEqual(classified.fields.map(f=>f.path),[1,2,3,4,5].map(i=>`$.checks[${i}].rationale`).concat('$.nextTest'));
 assert.equal(classified.originalHash,podHash(originalReview));
 assert.equal(c.classificationHash,podHash(classified),'Independent SQL classification must match current-source TypeScript exactly');
 return{a,c,classified,originalReview,records:await originalRecords(db,a)};
}

async function classifierAdversaries(db,failed){
 const {c,classified,originalReview}=failed,schema=podSource('products/discovery-r12-pod-analysis').podResearchSchema('review');
 const assessment=c.inputs.dependencies.find(d=>d.stepKey==='strategy').candidate.output;
 // pg encodes a top-level JS array as a PostgreSQL array literal. PGlite
 // accepts that same JS value as JSON, which previously hid native 22P02.
 // Explicit JSON text and casts keep every classifier JSON argument portable.
 const classifierArgs=raw=>[raw,schema,assessment,c.history.evidence].map(value=>JSON.stringify(value)).concat(classified.evidenceHash);
 const classify=raw=>podOne(db,'select private.r12_pod_length_classification($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb,$5::text) classified',classifierArgs(raw));
 const require=createRequire(path.resolve(host,'package.json'));
 assert.equal(require('pg/package.json').version,'8.16.3','Binding check uses the pinned native CI client');
 const {prepareValue}=require(path.join(path.dirname(require.resolve('pg')),'utils.js'));
 const args=classifierArgs(originalReview),bound=args.map(value=>prepareValue(value));
 assert.deepEqual(bound,args,'pg must send the explicit JSON texts unchanged');
 assert.deepEqual(bound.slice(0,4).map(value=>JSON.parse(value)),[originalReview,schema,assessment,c.history.evidence]);
 assert.notEqual(prepareValue(c.history.evidence),bound[3],'The original bare-array binding must remain distinguishable from JSON text');
 assert.deepEqual((await podOne(db,'select private.r12_pod_length_classification($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb,$5::text) classified',bound)).classified,classified,'Actual pg-bound text must satisfy the same SQL classifier');
 assert.deepEqual((await classify(originalReview)).classified,classified);
 const mutations=[
  ['owned extra key',r=>r.extra='unauthorized'],
  ...['__proto__','constructor','toString','hasOwnProperty'].map(key=>['owned '+key,r=>Object.defineProperty(r,key,{value:{executionAuthorized:true},enumerable:true,configurable:true})]),
  ['unknown evidence reference',r=>r.checks[1].evidence=['E999']],
  ['duplicate check',r=>r.checks[1].check=r.checks[0].check],
  ['invalid verdict',r=>r.checks[1].verdict='MAYBE'],
  ['mixed minimum and maximum defect',r=>r.rationale='Too short'],
 ];
 for(const [label,mutate] of mutations){const altered=structuredClone(originalReview);mutate(altered);await assert.rejects(classify(altered),/length_only_structure_and_domain_required/,label);}
 const valid=structuredClone(originalReview);valid.checks.forEach(x=>x.rationale='The retained synthetic evidence does not establish independent buyer demand or delivered economics.');valid.nextTest='Collect independent aggregate evidence and current delivered costs before recommending a product test.';
 await assert.rejects(classify(valid),/actual_length_failure_required/,'An already valid review is not a length-failed recovery');
 await assert.rejects(db.query("update private.r12_discovery_response_observations set payload_hash=$1 where request_id=$2 and kind='rejected'",['0'.repeat(64),c.context.attempt.requestId]),/immutable|append_only/,'Persisted rejection diagnostic hash cannot be changed');
 assert.deepEqual((await podRpc(db,'authenticated',failed.a.f.ownerId,'r12_pod_recovery_read',[failed.a.f.businessId,failed.a.prepared.setupId])).diagnostic,c.diagnostic);
}

async function installRecoveryTemplate(db,a){
 const templateId=randomUUID(),pins={...a.f.pins,schemas:runtime.podResearchSchemaPins(true)};
 const templateHash=podHash({version:'inert-pod-recovery-template-review.1',templateId,sourcePolicy:a.f.sourcePolicy,pins});
 await db.query(`insert into private.r12_pod_templates(id,version,source_policy,source_policy_hash,pins,pins_hash,server_key_hash,reviewed_bundle_hash,valid_from,valid_until)
 values($1,'r12.pod-template.3',$2,$3,$4,$5,$6,$7,$8,$9)`,[templateId,a.f.sourcePolicy,podHash(a.f.sourcePolicy),pins,podHash(pins),podSha(a.f.bootstrapKey),templateHash,a.f.sourcePolicy.validFrom,a.f.sourcePolicy.validUntil]);
 return{templateId,templateHash};
}

async function recoveryPreflight(prepared,quote,history){
 const wire=podSource('products/discovery-r12-wire');
 const request=runtime.buildPodPlannerRequest('0'.repeat(64),prepared.preview.sourcePolicyHash,prepared.preview.publicBrief,prepared.preview.sourcePolicy.excludedDomains,history);
 const inspected=await wire.inspectDiscoveryR12Wire(wire.routeDiscoveryR12Request(request,'plan',quote.luna,false,false,true),'plan',false,false,false,true);
 return{setupHash:prepared.setupHash,sourcePolicyHash:prepared.preview.sourcePolicyHash,requestHash:inspected.requestHash,wireHash:inspected.wireHash,wireBytes:inspected.wireBytes};
}

async function recoveryActivation(db,failed,prepared,activated){
 const {a,c}=failed;
 const controller='inert-pod-controller-'+prepared.scopeId,admission='inert-pod-admission-'+prepared.scopeId,lease='inert-pod-controller-lease-'+prepared.scopeId;
 const command=(operation,payload,epoch=null)=>podRpc(db,'anon',null,'r07_controller',[a.f.businessId,a.f.goalId,operation,payload,randomUUID(),controller,lease,epoch,admission]);
 const authority=await podOne(db,"select a.plan,p.payload->'operations' operations from private.r12_discovery_authorities a join private.r12_pod_setups s on s.scope_id=a.scope_id join private.r05_policies p on p.id=s.policy_id where a.scope_id=$1",[prepared.scopeId]);
 const pass=(operation,payload={})=>podRpc(db,'anon',null,'r12_pod_pass_server',[a.f.businessId,prepared.scopeId,operation,payload,controller]);
 const store={read:()=>command('read',{}),readAdaptiveAction:()=>pass('context'),command:(op,payload,epoch)=>op==='adaptive_complete_action'?pass('complete',payload):command(op,['schedule','reserve'].includes(op)?{...payload,runtimeCapability:'inert-pod-runtime-'+prepared.scopeId}:payload,epoch)};
 const inputs=attemptId=>podRpc(db,'anon',null,'r12_discovery_server',[a.f.businessId,attemptId,'inputs',{},controller]);
 const scope=(await podOne(db,'select amendment from private.r12_discovery_scopes where id=$1',[prepared.scopeId])).amendment;
 const podRecovery=(await podOne(db,'select private.r12_pod_recovery_state($1) recovery',[scope.id])).recovery;
 const activation={f:a.f,prepared,activated,controller,admission,lease,command,store,inputs,pass,operations:authority.operations,plan:authority.plan,scope,podRecovery};
 const next=await store.read();assert.equal(next.head.dispatches,c.proof.usedCalls);assert.equal(next.head.childrenCreated,5);assert.equal(next.head.repairsUsed,0);assert.equal(next.head.pivotsUsed,0);
 assert.equal(next.plan.maximumDispatches,25);assert.equal(next.plan.maximumChildren,10);assert.equal(next.plan.maximumMicrounits,'10000000');assert.equal(scope.maximumMicrousd,Number(c.proof.remainingMaximumMicrounits));
 assert.equal(next.plan.goalId,a.f.goalId);assert.equal(next.plan.authorityRootId,a.scope.authorityRootId);
 assert.equal((await podOne(db,'select count(*)::int n from private.r07_plans where business_id=$1 and goal_id=$2',[a.f.businessId,a.f.goalId])).n,2);
 assert.equal((await podOne(db,'select count(*)::int n from private.r12_pod_recoveries where business_id=$1',[a.f.businessId])).n,1);
 const successor=await podOne(db,'select version,previous_plan_id from private.r07_plans where id=$1',[next.planId]);
 assert.deepEqual(successor,{version:2,previous_plan_id:c.proof.predecessorPlanId});
 assert.deepEqual(await originalRecords(db,a),failed.records);
 return activation;
}

async function recover(db,failed,{native=null,confirmationRace=null}={}){
 const {a,c,classified}=failed,template=await installRecoveryTemplate(db,a);
 const server=(operation,payload)=>podRpc(db,'authenticated',a.f.ownerId,'r12_pod_recovery_owner_server',[a.f.businessId,operation,payload,a.f.bootstrapKey]);
 const input={...a.f.input,...template,maximumMicrounits:c.proof.remainingMaximumMicrounits,submissionId:randomUUID(),predecessorSetupId:a.prepared.setupId,proofHash:c.proofHash,historyHash:c.historyHash,classificationHash:podHash(classified),approveGoalDeadlineRevision:true};
 const quote=podQuoteFixture();
 await assert.rejects(server('prepare',{input:{...input,approveGoalDeadlineRevision:false,submissionId:randomUUID()},quote}),/goal_deadline_revision_consent_required/);
 await assert.rejects(server('prepare',{input:{...input,templateId:a.f.templateId,templateHash:a.f.input.templateHash,submissionId:randomUUID()},quote}),/recovery_template_required/);
 await assert.rejects(a.f.prepare({...template,submissionId:randomUUID()}),/recovery_requires_separate_approval/);
 await assert.rejects(server('prepare',{input:{...input,maximumMicrounits:'10000000',submissionId:randomUUID()},quote}),/budget_cannot_reset/);
 await assert.rejects(server('prepare',{input:{...input,proofHash:'0'.repeat(64),submissionId:randomUUID()},quote}),/predecessor_changed/);
 await assert.rejects(server('prepare',{input:{...input,classificationHash:'0'.repeat(64),submissionId:randomUUID()},quote}),/predecessor_changed/);
 let prepared;
 if(native&&confirmationRace==='competing'){
  const race=await orderedRace({...native,
   first:client=>asRole(client,'authenticated','r12_pod_recovery_owner_server',[a.f.businessId,'prepare',{input,quote},a.f.bootstrapKey],a.f.ownerId),
   second:client=>asRole(client,'authenticated','r12_pod_recovery_owner_server',[a.f.businessId,'prepare',{input:{...input,submissionId:randomUUID()},quote},a.f.bootstrapKey],a.f.ownerId)});
  prepared=race.first;assert.match(race.second.error?.message??'',/r12_pod_intent_changed/);
  recordRace(native,'competing-recovery-prepare-stale-goal-rejected',race);
 }else prepared=await server('prepare',{input,quote});
 assert.deepEqual(await server('prepare',{input,quote}),prepared,'The original prepare submission replays after its own Goal revision');
 await assert.rejects(server('prepare',{input:{...input,submissionId:randomUUID()},quote}),/r12_pod_intent_changed/,'A different submission cannot reuse stale original Goal consent');
 await assert.rejects(db.query("update private.r12_pod_setups set input=jsonb_set(input,'{classificationHash}',to_jsonb($1::text)) where id=$2",['0'.repeat(64),prepared.setupId]),/append_only/,'Persisted classification pin cannot be changed');
 assert.equal(prepared.activated,false);assert.equal(prepared.confirmed,false);assert.equal(prepared.goalId,a.f.goalId);
 assert.notEqual(prepared.policyId,a.prepared.policyId);assert.notEqual(prepared.setupId,a.prepared.setupId);
 assert.equal(prepared.preview.goalRevision,a.f.input.goalRevision+2);
 assert.equal(prepared.preview.maximumCalls,25);assert.equal(prepared.preview.maximumPasses,5);
 assert.equal(prepared.preview.recovery.originalReviewAccepted,false);
 assert.equal((await podOne(db,'select count(*)::int n from private.r12_pod_recoveries where business_id=$1',[a.f.businessId])).n,0);
 const controller='inert-pod-controller-'+prepared.scopeId,admission='inert-pod-admission-'+prepared.scopeId;
 const confirmation={setupId:prepared.setupId,setupHash:prepared.setupHash,submissionId:randomUUID(),controllerKeyHash:podSha(controller),admissionKeyHash:podSha(admission),quote,preflight:await recoveryPreflight(prepared,quote,c.history)};
 let activated;
 if(native&&confirmationRace==='duplicate'){
  const race=await orderedRace({...native,
   first:client=>asRole(client,'authenticated','r12_pod_recovery_owner_server',[a.f.businessId,'confirm',confirmation,a.f.bootstrapKey],a.f.ownerId),
   second:client=>asRole(client,'authenticated','r12_pod_recovery_owner_server',[a.f.businessId,'confirm',confirmation,a.f.bootstrapKey],a.f.ownerId)});
  activated=race.first;assert.equal(race.second.error,undefined,race.second.error?.message);assert.deepEqual(race.second.value,activated);
  recordRace(native,'duplicate-recovery-confirm-one-successor',race);
 }else activated=await server('confirm',confirmation);
 assert.equal(activated.activated,true);assert.equal(activated.confirmed,true);
 assert.deepEqual(await server('confirm',confirmation),activated);
 assert.deepEqual(await server('confirm',{...confirmation,submissionId:randomUUID()}),activated);
 return recoveryActivation(db,failed,prepared,activated);
}

test('stopped rejected POD pass gets one explicitly approved same-Goal recovery without accounting reset',{skip:!nativeRequested&&!host,timeout:240000},async t=>{
 const {db,native}=await openDatabase(),originalFetch=globalThis.fetch;let networkCalls=0;
 globalThis.fetch=async()=>{networkCalls++;throw Error('External HTTP forbidden in recovery SQL qualification');};
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const file of readdirSync(root+'/supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(root+'/supabase/migrations/'+file,'utf8'));
  const definitions=await podOne(db,`select
   pg_get_functiondef('private.r12_pod_scope_resolve(private.r12_discovery_scopes,timestamp with time zone,boolean)'::regprocedure) scope_resolve,
   (select proconfig from pg_proc where oid='private.r12_pod_bounded_source(uuid,text,bigint)'::regprocedure) bounded_config`);
  assert.doesNotMatch(definitions.scope_resolve,/r12_pod_finance|['"]finance['"]/,'Recovery must not restore the discarded hot-path finance projection');
  assert.deepEqual(definitions.bounded_config,['search_path=""','plan_cache_mode=force_generic_plan'],'Recovery preserves PR94 bounded-source plan cache configuration');
  const failed=await rejectedPass(db);await classifierAdversaries(db,failed);
  const activation=await recover(db,failed,{native,confirmationRace:'duplicate'});
  // Read-only row composites exercise the installed SQL accepted-plan guard
  // with a genuinely accepted predecessor dependency and the actual new scope.
  // No historical attempt, response, candidate or proof is modified.
  await assert.rejects(db.query(`select private.r12_pod_accepted_plan(
   jsonb_populate_record(null::private.r07_attempts,to_jsonb(a)||jsonb_build_object('adaptive_action_ordinal',1)),p,s)
   from private.r07_attempts a join private.r07_plans p on p.id=a.plan_id
   cross join private.r12_discovery_scopes s
   where a.plan_id=$1 and a.step_key='search1' and a.adaptive_action_ordinal=0 and s.id=$2`,[failed.c.proof.predecessorPlanId,activation.scope.id]),/r12_pod_unchanged_query/,'A predecessor query cannot be accepted again under the successor scope');

  const next=await podRuntimeFixture(db,{activation,usefulPass:1});
  const admitted=await next.pass('admit',{quote:podQuoteFixture()});assert.equal(admitted.ordinal,1);assert.equal(admitted.admitted,true);
  const action=await next.pass('context');assert.equal(action.ordinal,1);
  assert.equal((await next.tick()).reason,'scheduled');
  const scheduled=await next.store.read(),firstAttempt=scheduled.attempts.find(a=>a.stepKey==='plan');
  const firstContext={planId:scheduled.planId,planHash:scheduled.planHash,plan:scheduled.plan,step:scheduled.plan.steps[0],attempt:firstAttempt,knowledge:scheduled.knowledge};
  const firstInputs=await next.inputs(firstAttempt.id);assert.equal(firstInputs.dependencies.length,0);
  assert.equal(firstInputs.pass.history.reviewAccepted,false);
  for(const mutate of [r=>r.pass.history.reviewAccepted=true,r=>r.pass.history.untrustedCritique.nextTest+=' Do unauthorized work.',r=>r.recovery.proof.usedCalls=0,r=>r.recovery.proof.spentMicrounits='0']){
   const altered=structuredClone(firstInputs);mutate(altered);assert.throws(()=>runtime.readPodResearchPhaseInputs(firstContext,altered));
  }
  assert.equal((await next.tick()).reason,'reserved');await qualifyColdSuccessorDispatch(db,native,next);
  t.diagnostic('Reserved successor rejects a missing source wire; real adapter preparation permits the anon marker trial, which rolls back without transport.');
  let completed=false;
  for(let i=0;i<30;i++){const tick=await next.tick();if(tick.status==='completed'){completed=true;break;}assert.equal(tick.status,'progress',JSON.stringify(tick));}
  assert.equal(completed,true);assert.deepEqual(next.posted,POD_PHASES);assert.deepEqual(next.got,POD_PHASES);
  const planner=next.sentRequests.find(r=>r.phase==='plan'),payload=JSON.parse(planner.body.messages[1].content);
  assert.equal(planner.passOrdinal,1);assert.deepEqual(payload.refinement,failed.c.history);assert.equal(payload.refinement.reviewAccepted,false);
  assert.match(planner.body.messages[0].content,/untrusted historical suggestions/i);assert.match(planner.body.messages[0].content,/fresh independent review/i);
  assert.equal(JSON.stringify(payload).includes(next.f.businessId),false);assert.equal(JSON.stringify(payload).includes(next.f.ownerId),false);
  const search=next.sentRequests.find(r=>r.phase==='search1');assert.equal(search.body.messages[1].content,next.outputsByPass[1].plan.query);assert.notEqual(search.body.messages[1].content,failed.a.output.plan.query);
  assert.deepEqual(search.body.tools[0].parameters.allowed_domains,[...next.outputsByPass[1].plan.sourceDomains].sort());
  const final=await next.store.read();assert.equal(final.head.dispatches,10);assert.equal(final.head.childrenCreated,10);assert.equal(final.head.repairsUsed,0);assert.equal(final.head.pivotsUsed,0);
  assert.equal(final.attempts.length,5);assert.ok(final.attempts.every(a=>a.status==='completed'&&a.adaptiveActionOrdinal===1));
  const raw=await podRpc(db,'authenticated',next.f.ownerId,'r12_discovery_result_read',[next.f.businessId,next.scope.id]);
  const result=runtime.reconstructPodResearchResult(raw.context,runtime.readPodResearchPhaseInputs(raw.context,raw.inputs),raw.current);
  assert.equal(result.review.outcome,'HYPOTHESIS_TO_TEST');assert.equal(result.passNumber,2);assert.equal(result.maximumPasses,5);assert.equal(result.phaseReceipts.length,5);assert.equal(result.executionAuthorized,false);
  assert.equal(result.priorReviewHash,null,'The rejected reviewer response never becomes a prior accepted review');
  assert.ok(result.phaseReceipts.every(r=>r.providerRequestId.includes('-p1-')));
  const finance=(await next.f.read()).finance;assert.equal(finance.committedMicrounits,'100');assert.equal(finance.maximumMicrounits,'10000000');assert.equal(finance.hasUnknown,false);
  assert.deepEqual(await originalRecords(db,failed.a),failed.records);
  assert.equal((await podOne(db,'select count(*)::int n from private.r12_pod_pass_closures where scope_id=$1',[failed.a.scope.id])).n,0);
  assert.equal((await podOne(db,'select count(*)::int n from private.r07_responses where attempt_id=$1',[failed.c.proof.failedAttemptId])).n,0);
  await next.f.server('stop',{setupId:next.prepared.setupId,setupHash:next.prepared.setupHash,submissionId:randomUUID()},'');
  assert.equal((await podRpc(db,'anon',null,'r12_pod_runtime_read',[next.f.businessId,next.scope.id,next.f.bootstrapKey])).activeWindow,false);
  const afterStop=await podRpc(db,'authenticated',next.f.ownerId,'r12_discovery_result_read',[next.f.businessId,next.scope.id]);
  assert.deepEqual(runtime.reconstructPodResearchResult(afterStop.context,runtime.readPodResearchPhaseInputs(afterStop.context,afterStop.inputs),afterStop.current),result);
  assert.equal(next.posted.length+failed.a.posted.length,10);assert.equal((await next.f.read()).finance.committedMicrounits,'100');
  t.diagnostic('10 inert calls, 2 total pass admissions, original rejected pass untouched, fresh full five-phase result; 0 provider network calls.');

  // A second independent owner exhausts the unchanged allowance with four new
  // honest-insufficiency passes. The rejected predecessor still consumes one.
  const exhaustedFailure=await rejectedPass(db),exhaustedActivation=await recover(db,exhaustedFailure,{native,confirmationRace:'competing'});
  const exhausted=await podRuntimeFixture(db,{activation:exhaustedActivation,usefulPass:null});
  let bounded=false;
  for(let i=0;i<120;i++){
   const tick=await exhausted.tick();
   if(tick.status==='completed'){assert.match(tick.reason,/five_pass_limit|remaining_calls_below_complete_pass/);bounded=true;break;}
   assert.equal(tick.status,'progress',JSON.stringify(tick));
  }
  assert.equal(bounded,true);assert.equal(exhausted.posted.length,20);assert.equal(exhausted.got.length,20);
  assert.deepEqual(exhausted.sentRequests.filter(r=>r.phase==='plan').map(r=>r.passOrdinal),[1,2,3,4]);
  const atLimit=await exhausted.store.read();assert.equal(atLimit.head.dispatches,25);assert.equal(atLimit.head.childrenCreated,10);
  assert.equal(atLimit.attempts.length,20);assert.ok(atLimit.attempts.every(x=>x.status==='completed'));
  const cumulative=await podOne(db,`select
   (select count(*)::int from private.r12_pod_pass_calls where scope_id in($1,$2)) calls,
   (select count(*)::int from private.r12_pod_passes where scope_id in($1,$2)) passes,
   (select count(*)::int from private.r12_pod_pass_calls where scope_id in($1,$2) and phase='search1') searches`,[exhausted.scope.id,exhaustedFailure.a.scope.id]);
  assert.deepEqual(cumulative,{calls:25,passes:5,searches:5});
  assert.equal((await exhausted.f.read()).finance.committedMicrounits,'250');
  assert.equal((await exhausted.f.read()).finance.maximumMicrounits,'10000000');
  assert.deepEqual(await originalRecords(db,exhaustedFailure.a),exhaustedFailure.records);
  assert.equal((await exhausted.tick()).status,'completed');assert.equal(exhausted.posted.length,20);
  const exhaustedRaw=await podRpc(db,'authenticated',exhausted.f.ownerId,'r12_discovery_result_read',[exhausted.f.businessId,exhausted.scope.id]);
  const honest=runtime.reconstructPodResearchResult(exhaustedRaw.context,runtime.readPodResearchPhaseInputs(exhaustedRaw.context,exhaustedRaw.inputs),exhaustedRaw.current);
  assert.equal(honest.review.outcome,'INSUFFICIENT_EVIDENCE');assert.equal(honest.passNumber,5);assert.equal(honest.phaseReceipts.length,5);assert.equal(honest.executionAuthorized,false);
  t.diagnostic('Exhausted lineage stops at 25 inert calls / 5 searches / 5 total admissions with 250 synthetic microunits charged and no sixth pass.');

  // Stop a confirmed successor after its first reservation but before any paid
  // send. The fresh policy has no authority to outlive that owner decision.
  const stoppedFailure=await rejectedPass(db),stoppedActivation=await recover(db,stoppedFailure);
  const stopped=await podRuntimeFixture(db,{activation:stoppedActivation,usefulPass:1});
  assert.equal((await stopped.tick()).reason,'scheduled');assert.equal((await stopped.tick()).reason,'reserved');
  const {snapshot:reserved,attempt:unsent}=await prepareReservedSuccessor(db,stopped);assert.equal(unsent.status,'reserved');
  const stopPayload={setupId:stopped.prepared.setupId,setupHash:stopped.prepared.setupHash,submissionId:randomUUID()};
  let denied;
  if(native){
   const race=await orderedRace({...native,
    first:client=>asRole(client,'authenticated','r12_pod_owner_server',[stopped.f.businessId,'stop',stopPayload,''],stopped.f.ownerId),
    second:client=>asRole(client,'anon','r07_controller',[stopped.f.businessId,stopped.f.goalId,'dispatch',{attemptId:unsent.id,wireHash:unsent.wireHash},randomUUID(),stopped.controller,stopped.lease,reserved.head.epoch,stopped.admission])});
   assert.equal(race.first.stopped,true);assert.equal(race.second.error,undefined,race.second.error?.message);denied=race.second.value;
   recordRace(native,'stop-before-reserved-successor-dispatch-no-marker',race);
  }else{
   await stopped.f.server('stop',stopPayload,'');
   denied=await stopped.command('dispatch',{attemptId:unsent.id,wireHash:unsent.wireHash},reserved.head.epoch);
  }
  assert.equal(denied.shouldDispatch,false);assert.match(denied.reason,/revoked|stopped|policy|discovery_scope_unavailable/);
  await assert.rejects(stopped.inputs(unsent.id),/stopped|revoked|policy|scope_unavailable/);
  assert.equal(stopped.posted.length,0);assert.equal(stopped.got.length,0);
  assert.equal((await podOne(db,'select count(*)::int n from private.r05_markers where request_id=$1',[unsent.requestId])).n,0);
  const cancelled=await stopped.command('cancel',{attemptId:unsent.id,evidenceHash:podHash({kind:'inert-recovery-proven-unsent',requestId:unsent.requestId})},reserved.head.epoch);
  assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.shouldDispatch,false);
  assert.equal((await stopped.f.read()).finance.committedMicrounits,'50');assert.equal((await stopped.f.read()).finance.hasUnknown,false);
  assert.equal((await stopped.store.read()).head.dispatches,5);
  assert.deepEqual(await originalRecords(db,stoppedFailure.a),stoppedFailure.records);
  t.diagnostic('Stop blocks a reserved successor send and permits its proven-unsent cancellation while retaining all five predecessor charges.');
  // Near the original ceiling: three valid insufficient passes precede the
  // fourth pass's rejected review. Recovery has exactly one full pass left.
  const lateFailure=await rejectedPass(db,{failureOrdinal:3});
  assert.equal(lateFailure.c.proof.usedCalls,20);assert.equal(lateFailure.c.proof.usedPasses,4);assert.equal(lateFailure.c.proof.spentMicrounits,'200');
  const lateActivation=await recover(db,lateFailure),last=await podRuntimeFixture(db,{activation:lateActivation,usefulPass:null});
  const finalAdmission=await last.pass('admit',{quote:podQuoteFixture()});assert.equal(finalAdmission.admitted,true);assert.equal(finalAdmission.ordinal,4);
  let lastCompleted=false;
  for(let i=0;i<30;i++){
   const tick=await last.tick();
   if(tick.status==='completed'){assert.match(tick.reason,/five_pass_limit|remaining_calls_below_complete_pass/);lastCompleted=true;break;}
   assert.equal(tick.status,'progress',JSON.stringify(tick));
  }
  assert.equal(lastCompleted,true);assert.deepEqual(last.posted,POD_PHASES);assert.deepEqual(last.got,POD_PHASES);
  assert.ok(last.sentRequests.every(r=>r.passOrdinal===4));
  const finalHistory=JSON.parse(last.sentRequests.find(r=>r.phase==='plan').body.messages[1].content).refinement;
  assert.equal(finalHistory.reviewAccepted,false);assert.equal(finalHistory.previousPass,3);assert.equal(finalHistory.priorQueries.length,4);
  const lastState=await last.store.read();assert.equal(lastState.head.dispatches,25);assert.equal(lastState.head.childrenCreated,10);
  assert.equal(lastState.attempts.length,5);assert.ok(lastState.attempts.every(x=>x.status==='completed'&&x.adaptiveActionOrdinal===4&&x.attempt===5));
  const lateCounts=await podOne(db,`select
   (select count(*)::int from private.r12_pod_pass_calls where scope_id in($1,$2)) calls,
   (select count(*)::int from private.r12_pod_passes where scope_id in($1,$2)) passes,
   (select count(*)::int from private.r12_pod_pass_calls where scope_id in($1,$2) and phase='search1') searches`,[last.scope.id,lateFailure.a.scope.id]);
  assert.deepEqual(lateCounts,{calls:25,passes:5,searches:5});
  assert.equal((await last.f.read()).finance.committedMicrounits,'250');assert.equal((await last.f.read()).finance.maximumMicrounits,'10000000');
  assert.equal((await last.tick()).status,'completed');assert.equal(last.posted.length,5);
  const lateRaw=await podRpc(db,'authenticated',last.f.ownerId,'r12_discovery_result_read',[last.f.businessId,last.scope.id]);
  const lateResult=runtime.reconstructPodResearchResult(lateRaw.context,runtime.readPodResearchPhaseInputs(lateRaw.context,lateRaw.inputs),lateRaw.current);
  assert.equal(lateResult.review.outcome,'INSUFFICIENT_EVIDENCE');assert.equal(lateResult.passNumber,5);assert.equal(lateResult.phaseReceipts.length,5);assert.equal(lateResult.priorReviewHash,null);
  assert.equal((await podOne(db,'select count(*)::int n from private.r12_pod_pass_closures where scope_id=$1 and ordinal=3',[lateFailure.a.scope.id])).n,0);
  assert.equal((await podOne(db,'select count(*)::int n from private.r07_responses where attempt_id=$1',[lateFailure.c.proof.failedAttemptId])).n,0);
  assert.deepEqual(await originalRecords(db,lateFailure.a),lateFailure.records);
  t.diagnostic('Fourth-pass length rejection leaves exactly one final complete recovery pass: cumulative 25 calls / 5 searches / 5 admissions, with predecessor review still rejected.');
  assert.equal(networkCalls,0);
  if(native){assert.equal(native.races.length,3);assert.ok(native.coldDispatch);t.diagnostic('Native PostgreSQL observed-lock races: '+JSON.stringify(native.races));t.diagnostic('Disposable native fixture cold dispatch timing: '+JSON.stringify(native.coldDispatch));}
  else t.diagnostic('PGlite qualification only; native concurrent races remain unqualified in this run.');
 }finally{globalThis.fetch=originalFetch;await db.close();}
});

// This case alone uses PGlite's verified JS/WASM wall clock. Native race and
// deadline timing tests above retain unmodified PostgreSQL server time.
test('expired original Goal recovers through atomic deadline-only R04 revision',{skip:nativeRequested||!host,timeout:180000},async t=>{
 const {db}=await openDatabase(),realNow=Date.now,originalFetch=globalThis.fetch;
 let offset=0,httpCalls=0;Date.now=()=>realNow()+offset;
 globalThis.fetch=async()=>{httpCalls++;throw Error('External HTTP forbidden in expired-Goal recovery qualification');};
 const candidate='20261012200939_r12_pod_recovery_goal_deadline.sql';
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const file of readdirSync(root+'/supabase/migrations').filter(f=>f.endsWith('.sql')&&f<candidate).sort())await db.exec(readFileSync(root+'/supabase/migrations/'+file,'utf8'));
  const r05Before=(await podOne(db,"select pg_get_functiondef('private.r05_policy_validate(uuid,jsonb)'::regprocedure) definition")).definition;
  const originalDeadline=new Date(Math.floor((Date.now()+3600000)/1000)*1000).toISOString();
  // Set the genuine initial Goal deadline before its first save. No historical
  // Goal, policy, attempt, timestamp, function or migration is rewritten.
  const fixtureDb={exec:(...args)=>db.exec(...args),query:(sql,args)=>{
   if(sql.includes('public.r04_quest_transition(')&&args?.[1]==='quest.save'&&args[2]?.goalId===null){
    args=structuredClone(args);args[2].content.parsed.deadline={date:originalDeadline.slice(0,10),time:originalDeadline.slice(11,19),timezone:'UTC'};
   }
   return db.query(sql,args);
  }};
  const failed=await rejectedPass(fixtureDb),{a}=failed,template=await installRecoveryTemplate(db,a);
  const goalRows=async()=>(await db.query('select to_jsonb(v) row from private.r04_goal_versions v where goal_id=$1 and business_id=$2 order by revision',[a.f.goalId,a.f.businessId])).rows.map(x=>x.row);
  const originalGoals=await goalRows();assert.deepEqual(originalGoals.map(g=>[g.revision,g.preference]),[[1,'draft'],[2,'ready']]);
  assert.equal(originalGoals[1].content.parsed.deadline.date+'T'+originalGoals[1].content.parsed.deadline.time+'.000Z',originalDeadline);
  const sqlBefore=(await podOne(db,'select extract(epoch from clock_timestamp())::double precision*1000 ms')).ms;
  offset=3600000+5000;
  const sqlAfter=(await podOne(db,'select extract(epoch from clock_timestamp())::double precision*1000 ms')).ms;
  assert.ok(sqlAfter-sqlBefore>=3600000);assert.ok(Math.abs(sqlAfter-Date.now())<1000,'Both application and unmodified SQL clock advance together');
  assert.ok(sqlAfter>Date.parse(originalDeadline));assert.ok(sqlAfter+35*60000<Date.parse(a.f.sourcePolicy.validUntil));
  assert.deepEqual(await goalRows(),originalGoals,'Clock advance leaves original Goal revision 2 byte-identical');
  const c=await podRpc(db,'authenticated',a.f.ownerId,'r12_pod_recovery_read',[a.f.businessId,a.prepared.setupId]);
  assert.equal(c.proofHash,failed.c.proofHash);assert.equal(c.classificationHash,podHash(failed.classified));
  const input={...a.f.input,...template,maximumMicrounits:c.proof.remainingMaximumMicrounits,submissionId:randomUUID(),predecessorSetupId:a.prepared.setupId,proofHash:c.proofHash,historyHash:c.historyHash,classificationHash:c.classificationHash};
  const quote=podQuoteFixture(),server=(operation,payload)=>podRpc(db,'authenticated',a.f.ownerId,'r12_pod_recovery_owner_server',[a.f.businessId,operation,payload,a.f.bootstrapKey]);
  const state=async()=>({goals:await goalRows(),original:await originalRecords(db,a),rows:await podOne(db,`select
   (select to_jsonb(g) from private.r04_goal_state g where goal_id=$1) goal_state,
   (select to_jsonb(g) from public.goals g where id=$1) public_goal,
   (select count(*)::int from private.r04_submissions where business_id=$2) r04_submissions,
   (select count(*)::int from private.r12_pod_submissions where business_id=$2) pod_submissions,
   (select count(*)::int from private.r05_policies where business_id=$2) policies,
   (select count(*)::int from private.r12_pod_setups where business_id=$2) setups,
   (select count(*)::int from private.r12_pod_operation_sources where business_id=$2) operation_sources,
   (select count(*)::int from private.r12_discovery_scopes where business_id=$2) scopes,
   (select count(*)::int from private.r12_pod_recoveries where business_id=$2) recoveries,
   (select count(*)::int from private.r05_cap_versions where business_id=$2) cap_revisions,
   private.r12_pod_finance($2) finance`,[a.f.goalId,a.f.businessId])});
  const baseline=await state();
  await assert.rejects(server('prepare',{input,quote}),/r05_intent_deadline_exceeded/,'The unchanged original RPC reproduces the live expired-Goal failure');
  assert.deepEqual(await state(),baseline,'The original failed proposal creates no setup, Goal revision, grant or cost');
  await db.exec(readFileSync(root+'/supabase/migrations/'+candidate,'utf8'));
  assert.equal((await podOne(db,"select pg_get_functiondef('private.r05_policy_validate(uuid,jsonb)'::regprocedure) definition")).definition,r05Before,'R05 deadline validation is unchanged');
  await assert.rejects(server('prepare',{input,quote}),/r04_invalid_fields|goal_deadline_revision_consent_required/,'Old clients cannot silently revise the Goal deadline');
  await assert.rejects(server('prepare',{input:{...input,approveGoalDeadlineRevision:false},quote}),/goal_deadline_revision_consent_required/);
  const payload={input:{...input,approveGoalDeadlineRevision:true},quote};
  // Fault after the real R04 save+ready transitions and R05 validation. The
  // trigger only raises on this inert Business; no existing guard is weakened.
  await db.exec(`create function pg_temp.inert_pod_deadline_policy_failure() returns trigger language plpgsql as $$ begin
   if new.business_id='${a.f.businessId}'::uuid then
    if new.goal_revision<>4 or (select revision from private.r04_goal_state where goal_id='${a.f.goalId}'::uuid)<>4 then raise exception 'inert_deadline_proposal_wrong_revision';end if;
    raise exception 'inert_deadline_policy_proposal_failure';
   end if;return new;end $$;
   create trigger inert_pod_deadline_policy_failure before insert on private.r05_policies for each row execute function pg_temp.inert_pod_deadline_policy_failure();`);
  try{
   await assert.rejects(server('prepare',payload),/inert_deadline_policy_proposal_failure/);
   assert.deepEqual(await state(),baseline,'Proposal failure atomically rolls back both Goal revisions, R04 submissions and all setup/policy records');
  }finally{await db.exec('drop trigger inert_pod_deadline_policy_failure on private.r05_policies;drop function pg_temp.inert_pod_deadline_policy_failure();');}
  const prepared=await server('prepare',payload),afterPrepare=await state();
  assert.equal(prepared.activated,false);assert.equal(prepared.confirmed,false);assert.equal(prepared.goalId,a.f.goalId);assert.equal(prepared.preview.goalRevision,4);
  assert.deepEqual(afterPrepare.goals.slice(0,2),originalGoals);
  assert.deepEqual(afterPrepare.goals.slice(2).map(g=>[g.revision,g.preference]),[[3,'draft'],[4,'ready']]);
  const withoutDeadline=content=>{const copy=structuredClone(content);delete copy.parsed.deadline;return copy;};
  for(const goal of afterPrepare.goals.slice(2))assert.deepEqual(withoutDeadline(goal.content),withoutDeadline(originalGoals[1].content),'Only parsed.deadline changes');
  assert.deepEqual(afterPrepare.goals[2].content,afterPrepare.goals[3].content);
  const bound=await podOne(db,`select s.input,s.preview,s.cutoff::text cutoff,p.goal_revision,p.payload,
   ((g.content->'parsed'->'deadline'->>'date')||' '||(g.content->'parsed'->'deadline'->>'time'))::timestamp at time zone (g.content->'parsed'->'deadline'->>'timezone')=s.cutoff deadline_matches_cutoff
   from private.r12_pod_setups s join private.r05_policies p on p.id=s.policy_id join private.r04_goal_versions g on g.goal_id=s.goal_id and g.business_id=s.business_id and g.revision=4 where s.id=$1`,[prepared.setupId]);
  assert.equal(bound.input.goalRevision,4);assert.equal(bound.goal_revision,4);assert.equal(bound.payload.goalRevision,4);assert.equal(bound.preview.goalRevision,4);
  assert.equal(bound.deadline_matches_cutoff,true);assert.equal(Date.parse(bound.payload.expiresAt),Date.parse(bound.cutoff));assert.equal(new Date(bound.cutoff).getUTCMilliseconds(),0);
  assert.equal(afterPrepare.goals[3].content.parsed.deadline.timezone,'UTC');
  assert.ok(Date.parse(bound.cutoff)>Date.now()+30*60000);assert.ok(Date.parse(bound.cutoff)<=Date.now()+35*60000);
  assert.equal(afterPrepare.rows.recoveries,0);assert.equal(afterPrepare.rows.cap_revisions,baseline.rows.cap_revisions);assert.equal(afterPrepare.rows.scopes,baseline.rows.scopes);
  assert.deepEqual(afterPrepare.rows.finance,baseline.rows.finance);assert.deepEqual(afterPrepare.original,baseline.original);
  assert.deepEqual(await server('prepare',payload),prepared);assert.deepEqual(await state(),afterPrepare,'Duplicate prepare does not append another Goal revision');
  await assert.rejects(server('prepare',{...payload,input:{...payload.input,submissionId:randomUUID()}}),/r12_pod_intent_changed/);
  await assert.rejects(server('prepare',{...payload,input:{...payload.input,goalRevision:4,submissionId:randomUUID()}}),/r12_pod_recovery_prior_goal_changed/,'A new submission cannot treat the revised Goal as original consent');
  const confirmation={setupId:prepared.setupId,setupHash:prepared.setupHash,submissionId:randomUUID(),controllerKeyHash:podSha('inert-pod-controller-'+prepared.scopeId),admissionKeyHash:podSha('inert-pod-admission-'+prepared.scopeId),quote,preflight:await recoveryPreflight(prepared,quote,c.history)};
  const activated=await server('confirm',confirmation);assert.equal(activated.activated,true);
  const activation=await recoveryActivation(db,failed,prepared,activated),run=await podRuntimeFixture(db,{activation,usefulPass:1});
  let complete=false;for(let i=0;i<30;i++){const tick=await run.tick();if(tick.status==='completed'){complete=true;break;}assert.equal(tick.status,'progress',JSON.stringify(tick));}
  assert.equal(complete,true);assert.deepEqual(run.posted,POD_PHASES);assert.deepEqual(run.got,POD_PHASES);
  assert.equal(run.scope.goalRevision,4);assert.equal((await run.store.read()).head.dispatches,10);assert.equal((await run.f.read()).finance.committedMicrounits,'100');
  assert.deepEqual(await originalRecords(db,a),failed.records);assert.deepEqual((await goalRows()).slice(0,2),originalGoals);assert.equal((await goalRows()).length,4);
  assert.equal(httpCalls,0);
  t.diagnostic('Unmodified PGlite SQL clock advanced beyond genuine revision-2 Goal expiry; original RPC rejected, candidate appended only deadline save+ready, proposal fault rolled back completely, replay stayed singular, and full recovery completed. Native wall clock is not simulated.');
 }finally{Date.now=realNow;globalThis.fetch=originalFetch;await db.close();}
});
