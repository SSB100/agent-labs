/** Native PostgreSQL only: genuine four-plan history, independent sessions,
 * positively observed locks, and denied external transports. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {r04SqlBootstrap} from './r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './r10-sql-fixture.mjs';
import {validateOwnerInitialRaceEnvironment,orderedRace,asRole} from './r12-owner-initial-postgres-races.mjs';
import {prepareFourPlanAdaptiveFixture} from './r12-adaptive-activation-fixture.mjs';
import {readClosedResearchHistory} from './r12-adaptive-history-fixture.mjs';
import {appendOwnerGrantRootRevision} from './r12-owner-grant-extension-sql-fixture.mjs';
import {one} from './r12-owner-initial-sql-fixture.mjs';
import {ownerInitialRuntimeRpc} from './r12-owner-initial-sql-fixture.mjs';
import {compileQuestPlan} from '../../.core-tests/core/quest-plan.js';
import {readQuestKnowledge} from '../../.core-tests/core/reviewed-knowledge.js';
import {readAdaptivePhaseInputs} from '../../.core-tests/products/discovery-r12-adaptive-inputs.js';
import {buildAdaptivePhaseRequest} from '../../.core-tests/products/discovery-r12-adaptive-runtime.js';
import {createDiscoveryR12QuestAdapter} from '../../.core-tests/products/discovery-r12-adapter.js';
import {routeAdaptiveResearchRequest} from '../../.core-tests/products/discovery-r12-adaptive-wire.js';
import {discoveryV2Hash} from '../../.core-tests/products/discovery-v2.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const validateAdaptiveRaceEnvironment=validateOwnerInitialRaceEnvironment;
/** Genuine schedule and exact adapter descriptor, no reservation or transport. */
export async function startAdaptivePlanner(db,c){
 const activated=await c.confirm(),scopeId=c.prepared.scopeId;
 const controller='inert-adaptive-controller-'+scopeId,admission='inert-adaptive-admission-'+scopeId,
  lease='inert-adaptive-race-lease-'+scopeId,runtimeCapability='inert-adaptive-runtime-'+scopeId;
 const command=(op,payload,epoch=null)=>ownerInitialRuntimeRpc(db,'r07_controller',
  [c.f.businessId,c.f.goalId,op,payload,randomUUID(),controller,lease,epoch,admission]);
 const claim=await command('claim',{seconds:120});
 const action=await one(db,'select content_hash,content from private.r12_adaptive_actions where scope_id=$1 and ordinal=0',[scopeId]);
 const saved=await one(db,'select content,content_hash from private.r07_plans where id=$1',[activated.planId]);
 const attemptId=randomUUID();
 const scheduled=await command('schedule',{stepKey:'plan',attemptId,reason:saved.content.steps[0].reason,
  evidenceHash:saved.content_hash,actionHash:action.content_hash,actionOrdinal:0,runtimeCapability},claim.epoch);
 assert.equal(scheduled.status,'scheduled');
 const snapshot=await command('read',{}),plan=compileQuestPlan(snapshot.plan);
 const context={planId:snapshot.planId,planHash:snapshot.planHash,plan,step:plan.steps[0],
  attempt:snapshot.attempts.find(a=>a.id===attemptId),
  knowledge:readQuestKnowledge(snapshot.knowledge,snapshot.businessId,snapshot.planId)};
 assert.ok(context.attempt);
 const raw=await ownerInitialRuntimeRpc(db,'r12_discovery_server',[c.f.businessId,attemptId,'inputs',{},controller]);
 const inputs=readAdaptivePhaseInputs(context,raw),request=buildAdaptivePhaseRequest(inputs,inputs.validationAt);
 const operation=saved.content.steps[0].operationKey;
 const policy=await one(db,'select payload from private.r05_policies where id=$1',[c.prepared.policyId]);
 const dataClasses=policy.payload.operations.find(p=>p.operationKey===operation).dataClasses;
 const denied=async()=>{throw Error('No effects or HTTP while preparing adaptive race descriptor');};
 const adapter=createDiscoveryR12QuestAdapter({scope:raw.scope,adaptivePreview:raw.preview,phase:'plan',
  identity:{qualificationHash:context.step.qualificationHash,workflowDefinitionId:context.step.workflowDefinitionId,
   workerDefinitionId:context.step.workerDefinitionId,mode:'qualification'},dataClasses,
  store:{operation:denied,settle:denied,dispatchedAt:denied},request:async()=>request,quote:async()=>c.quote,
  project:denied,fetcher:denied,config:{apiKey:'inert-no-transport-adaptive-races',baseUrl:'https://openrouter.ai/api/v1',
   appUrl:'https://agent-labs.example.invalid',appName:'Inert adaptive PostgreSQL gate'}});
 const call=await adapter.prepare(context);
 assert.equal(Number(call.descriptor.liabilityMicrounits),c.quote.ceilings.plan);
 return {c,activated,scopeId,context,raw,request,call,adapter,controller,admission,lease,epoch:claim.epoch,
  payload:{attemptId,descriptor:call.descriptor,runtimeCapability}};
}
const adaptiveCommand=(client,c,started,operation,payload,epoch=null)=>asRole(client,'anon','r07_controller',
 [c.f.businessId,c.f.goalId,operation,payload,randomUUID(),started.controller,started.lease,epoch,started.admission]);
const adaptiveEffect=(client,c,started,operation,payload={})=>asRole(client,'anon','r12_discovery_server',
 [c.f.businessId,started.context.attempt.id,operation,payload,started.controller]);
/** Exact saved wire; caller chooses whether to reserve or create a send marker. */
export async function bindAdaptivePlanner(db,c,started,{reserve=true,marker=false}={}){
 const {context,call,raw,request}=started,attemptId=context.attempt.id,wireHash=call.descriptor.wireRequestHash;
 if(reserve){
  const result=await ownerInitialRuntimeRpc(db,'r07_controller',[c.f.businessId,c.f.goalId,'reserve',
   started.payload,randomUUID(),started.controller,started.lease,started.epoch,started.admission]);
  assert.equal(result.status,'reserved');
 }
 const snapshot=await ownerInitialRuntimeRpc(db,'r07_controller',[c.f.businessId,c.f.goalId,'read',{},
  randomUUID(),started.controller,started.lease,null,started.admission]);
 const attempt=snapshot.attempts.find(a=>a.id===attemptId);
 assert.ok(attempt?.requestId,'Exact adaptive reservation required before binding');
 const routed=routeAdaptiveResearchRequest(request,'plan',c.quote,Date.parse(raw.validationAt));
 const binding={version:c.quote.version==='r12.adaptive-quote.2'?'r12.adaptive-wire.2':'r12.adaptive-wire.1',scopeId:c.prepared.scopeId,scopeHash:discoveryV2Hash(raw.scope),
  attemptId,requestId:attempt.requestId,phase:'plan',actionHash:attempt.adaptiveActionHash,
  actionOrdinal:attempt.adaptiveActionOrdinal,requestJson:JSON.stringify(routed),
  requestHash:call.descriptor.requestHash,wireBody:call.wire.body,wireHash,quote:c.quote,
  dependencyPins:attempt.dependencyPins};
 const bound=await ownerInitialRuntimeRpc(db,'r12_discovery_server',[c.f.businessId,attemptId,'bind',
  {binding,bindingHash:discoveryV2Hash(binding)},started.controller]);
 assert.equal(bound.bound,true);
 if(marker){
  const dispatched=await ownerInitialRuntimeRpc(db,'r07_controller',[c.f.businessId,c.f.goalId,'dispatch',
   {attemptId,wireHash},randomUUID(),started.controller,started.lease,started.epoch,started.admission]);
  assert.equal(dispatched.shouldDispatch,true);
 }
 return {attemptId,requestId:attempt.requestId,wireHash,binding};
}
export async function exerciseAdaptivePostgresRaces(env=process.env,{prepareFixture=prepareFourPlanAdaptiveFixture}={}){
 const target=validateAdaptiveRaceEnvironment(env),req=createRequire(path.resolve(target.host,'package.json'));
 assert.equal(req('pg/package.json').version,'8.16.3');
 const {Client}=req('pg');
 const clients=['observer','holder','waiter'].map(label=>new Client({connectionString:target.url,ssl:false,
  application_name:'r12-adaptive-'+label,connectionTimeoutMillis:5000}));
 const [db,holder,waiter]=clients,connected=new Set(),races=[];
 const originalFetch=globalThis.fetch;let externalHttpAttempts=0,inertHistoryCalls=0;
 globalThis.fetch=async()=>{externalHttpAttempts++;throw Error('External HTTP forbidden in adaptive PostgreSQL gate');};
 const record=(name,result)=>{assert.equal(result.observedLockWait,true);races.push({name,observedLockWait:true,waitEvent:result.waitEvent});};
 const owner=(client,c,op,payload)=>asRole(client,'authenticated','r12_owner_adaptive_server',
  [c.f.businessId,op,payload,op==='stop'?'':c.key],c.f.ownerId);
 const stopPayload=c=>({businessId:c.f.businessId,setupId:c.prepared.setupId,
  setupHash:c.prepared.setupHash,submissionId:randomUUID()});
 const count=c=>one(db,`select
  (select count(*)::int from private.r12_adaptive_activations where goal_id=$1) activations,
  (select count(*)::int from private.r05_requests where business_id=$2) requests,
  (select count(*)::int from private.r05_markers where business_id=$2) markers,
  (select count(*)::int from private.r12_adaptive_actions where scope_id=$3) actions,
  (select count(*)::int from private.r12_adaptive_call_admissions where scope_id=$3) calls`,
  [c.f.goalId,c.f.businessId,c.prepared.scopeId]);
 const fixture=async legacy=>{const c=await prepareFixture(db,{legacy});inertHistoryCalls+=20;return c;};
 try{
  for(const client of clients){await client.connect();connected.add(client);client.exec=sql=>client.query(sql);
   await client.query("set timezone='UTC'");
   assert.deepEqual(await one(client,'select current_user actor,current_database() db,host(inet_server_addr()) address'),
    {actor:'r12_test',db:'r12_test',address:target.address});}
  assert.equal((await one(db,"select count(*)::int n from pg_tables where schemaname in ('public','private')")).n,0,'Fresh disposable database required');
  assert.deepEqual((await db.query("select rolname from pg_roles where rolname in ('anon','authenticated','service_role')")).rows,[]);
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const file of readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())
   await db.exec(readFileSync(path.join(root,'supabase/migrations',file),'utf8'));
  for(const legacy of [null,{committedMicrounits:1100,pending:false}]){
   const label=legacy?'legacy':'native',c=await fixture(legacy),old=await readClosedResearchHistory(db,c.f.goalId);
   const alternative=await c.prepare();
   const tamper=await orderedRace({observer:db,holder,waiter,first:async client=>{
    await client.query('select id from public.businesses where id=$1 for update',[c.f.businessId]);
    await client.query('update private.r07_heads set dispatches=dispatches+1 where goal_id=$1',[c.f.goalId]);return true;
   },second:client=>owner(client,c,'confirm',c.confirmPayload)});
   assert.ok(tamper.second.error,'Counter changes must invalidate exact predecessor closure');
   assert.match(tamper.second.error.message,/r12_.*(?:counter|predecessor|lineage)/);
   assert.equal((await count(c)).activations,0);record(label+'-stale-counter-cannot-confirm',tamper);
   await db.query('update private.r07_heads set dispatches=dispatches-1 where goal_id=$1',[c.f.goalId]);
   await assert.rejects(c.prepare({predecessorPlanHash:'f'.repeat(64)}),/predecessor|lineage|changed/);
   const competing=await orderedRace({observer:db,holder,waiter,
    first:client=>owner(client,c,'confirm',c.confirmPayload),
    second:client=>owner(client,c,'confirm',alternative.confirmPayload)});
   assert.equal(competing.first.activated,true);assert.ok(competing.second.error);
   assert.match(competing.second.error.message,/r12_.*(?:predecessor|successor|lineage)/);
   record(label+'-closed-predecessor-one-successor',competing);
   const replay=await orderedRace({observer:db,holder,waiter,
    first:client=>owner(client,c,'confirm',c.confirmPayload),second:client=>owner(client,c,'confirm',c.confirmPayload)});
   assert.equal(replay.second.error,undefined);assert.equal(replay.second.value.scopeId,replay.first.scopeId);
   assert.equal(replay.second.value.activated,true);record(label+'-idempotent-confirm-one-activation',replay);
   assert.deepEqual(await count(c),{activations:1,requests:20,markers:20,actions:1,calls:0});
   const stopped=await orderedRace({observer:db,holder,waiter,
    first:client=>owner(client,c,'confirm',c.confirmPayload),second:client=>owner(client,c,'stop',stopPayload(c))});
   assert.equal(stopped.second.error,undefined);assert.equal(stopped.second.value.stopped,true);
   assert.equal(stopped.second.value.activated,true);record(label+'-confirmation-replay-before-stop-preserves-consumed-run',stopped);
   assert.deepEqual(await count(c),{activations:1,requests:20,markers:20,actions:1,calls:0});
   assert.deepEqual(await readClosedResearchHistory(db,c.f.goalId),old,'Historical plans, attempts, responses and candidates stay immutable');
   assert.equal((await one(db,'select private.r12_adaptive_outstanding_hold($1) hold',[c.f.businessId])).hold,'0','Stop releases only unused action hold');
   await assert.rejects(db.query('update private.r12_adaptive_activations set content=content where scope_id=$1',[c.prepared.scopeId]),/immutable/);

   const firstActivation=await fixture(legacy);
   const activatedThenStopped=await orderedRace({observer:db,holder,waiter,
    first:client=>owner(client,firstActivation,'confirm',firstActivation.confirmPayload),
    second:client=>owner(client,firstActivation,'stop',stopPayload(firstActivation))});
   assert.equal(activatedThenStopped.first.activated,true);assert.equal(activatedThenStopped.second.error,undefined);
   assert.equal(activatedThenStopped.second.value.stopped,true);assert.equal(activatedThenStopped.second.value.activated,true);
   assert.deepEqual(await count(firstActivation),{activations:1,requests:20,markers:20,actions:1,calls:0});
   record(label+'-first-confirm-before-stop-consumes-zero-send-run',activatedThenStopped);

   const before=await fixture(legacy);
   const stopFirst=await orderedRace({observer:db,holder,waiter,
    first:client=>owner(client,before,'stop',stopPayload(before)),second:client=>owner(client,before,'confirm',before.confirmPayload)});
   assert.equal(stopFirst.first.stopped,true);assert.ok(stopFirst.second.error);
   assert.match(stopFirst.second.error.message,/r12_adaptive_setup_stopped/);
   assert.deepEqual(await count(before),{activations:0,requests:20,markers:20,actions:0,calls:0});
   record(label+'-stop-before-confirm-no-authority',stopFirst);

   const stale=await fixture(legacy);
   const extended=await orderedRace({observer:db,holder,waiter,lockRelation:'private.r12_owner_grant_roots',first:async client=>{
    await client.query('select id from private.r12_owner_grant_roots where id=$1 for update',[stale.f.rootId]);
    return appendOwnerGrantRootRevision(client,stale.f.rootId,{maximumScopes:6,maximumAllocationMicrounits:'28000000',expiresAt:stale.profile.validUntil});
   },second:client=>owner(client,stale,'confirm',stale.confirmPayload)});
   assert.ok(extended.second.error,'A new grant-root revision invalidates an unactivated packet');
   assert.match(extended.second.error.message,/r12_adaptive_grant_root_stale/);
   assert.deepEqual(await count(stale),{activations:0,requests:20,markers:20,actions:0,calls:0});
   record(label+'-stale-grant-root-cannot-confirm',extended);

   const reservedRun=await fixture(legacy),reservedStart=await startAdaptivePlanner(db,reservedRun);
   const reserveStop=await orderedRace({observer:db,holder,waiter,
    first:client=>adaptiveCommand(client,reservedRun,reservedStart,'reserve',reservedStart.payload,reservedStart.epoch),
    second:client=>owner(client,reservedRun,'stop',stopPayload(reservedRun))});
   assert.equal(reserveStop.first.status,'reserved');
   assert.equal(reserveStop.second.error,undefined);assert.equal(reserveStop.second.value.stopped,true);
   assert.deepEqual(await count(reservedRun),{activations:1,requests:21,markers:20,actions:1,calls:1});
   assert.equal((await one(db,'select private.r12_adaptive_outstanding_hold($1) hold',[reservedRun.f.businessId])).hold,'0');
   record(label+'-reserve-before-stop-no-send',reserveStop);

   const markedRun=await fixture(legacy),markedStart=await startAdaptivePlanner(db,markedRun);
   const marked=await bindAdaptivePlanner(db,markedRun,markedStart);
   const markerStop=await orderedRace({observer:db,holder,waiter,
    first:client=>adaptiveCommand(client,markedRun,markedStart,'dispatch',
     {attemptId:marked.attemptId,wireHash:marked.wireHash},markedStart.epoch),
    second:client=>owner(client,markedRun,'stop',stopPayload(markedRun))});
   assert.equal(markerStop.first.shouldDispatch,true);
   assert.equal(markerStop.second.error,undefined);assert.equal(markerStop.second.value.stopped,true);
   assert.deepEqual(await count(markedRun),{activations:1,requests:21,markers:21,actions:1,calls:1});
   await assert.rejects(ownerInitialRuntimeRpc(db,'r12_discovery_server',
    [markedRun.f.businessId,marked.attemptId,'send',{wireHash:marked.wireHash},markedStart.controller]),
    /r12_.*(?:current|gate|revoked|stopped)/);
   assert.equal((await one(db,`select count(*)::int n from private.r12_discovery_transport_claims t
    join private.r05_requests r on r.id=t.request_id where r.business_id=$1`,[markedRun.f.businessId])).n,0);
   record(label+'-marker-before-stop-denies-new-send',markerStop);

   const sentRun=await fixture(legacy),sentStart=await startAdaptivePlanner(db,sentRun);
   const sent=await bindAdaptivePlanner(db,sentRun,sentStart,{marker:true});
   const sendStop=await orderedRace({observer:db,holder,waiter,
    first:client=>adaptiveEffect(client,sentRun,sentStart,'send',{wireHash:sent.wireHash}),
    second:client=>owner(client,sentRun,'stop',stopPayload(sentRun))});
   assert.equal(sendStop.first.shouldDispatch,true);
   assert.equal(sendStop.second.error,undefined);assert.equal(sendStop.second.value.stopped,true);
   assert.deepEqual(await count(sentRun),{activations:1,requests:21,markers:21,actions:1,calls:1});
   const savedReceipt=await ownerInitialRuntimeRpc(db,'r12_discovery_server',
    [sentRun.f.businessId,sent.attemptId,'load',{},sentStart.controller]);
   assert.equal(savedReceipt.binding.requestId,sent.requestId,'Stop preserves marked paid receipt readback');
   assert.equal((await one(db,`select count(*)::int n from private.r12_discovery_transport_claims t
    join private.r05_requests r on r.id=t.request_id where r.business_id=$1`,[sentRun.f.businessId])).n,1);
   record(label+'-claimed-send-before-stop-preserves-receipt',sendStop);
  }
  assert.equal(externalHttpAttempts,0);
  return {passed:true,races,inertHistoryCalls,liveProviderCalls:0,externalHttpAttempts};
 }finally{
  globalThis.fetch=originalFetch;
  for(const client of connected)await client.end().catch(()=>{});
 }
}
