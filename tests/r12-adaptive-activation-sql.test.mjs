/** Genuine owner history and grant; no adaptive provider or network calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {prepareFourPlanAdaptiveFixture} from './helpers/r12-adaptive-activation-fixture.mjs';
import {startAdaptivePlanner,bindAdaptivePlanner} from './helpers/r12-adaptive-postgres-races.mjs';
import {one,ownerInitialRuntimeRpc,sha} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {discoveryV2Hash} from '../.core-tests/products/discovery-v2.js';
import {observeR12ReviewResponse} from '../.core-tests/products/discovery-r12-observation.js';
import {driveQuestOnce} from '../.core-tests/core/quest-controller.js';
import {inspectAdaptiveResearchWire} from '../.core-tests/products/discovery-r12-adaptive-wire.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const host=process.env.R12_SQL_TEST_HOST;

test('four closed plans lead to paid-call admission, known-charge failure and bounded repair without transport',
 {skip:!host,timeout:120000},async()=>{
 const req=createRequire(path.resolve(host,'package.json'));
 const {PGlite}=req('@electric-sql/pglite'),{pgcrypto}=req('@electric-sql/pglite/contrib/pgcrypto');
 const db=new PGlite({extensions:{pgcrypto}});
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const file of readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())
   await db.exec(readFileSync(path.join(root,'supabase/migrations',file),'utf8'));
  const x=await prepareFourPlanAdaptiveFixture(db);
  assert.equal(x.prepared.preview.version,'r12.adaptive-research-preview.1');
  assert.equal(x.prepared.activated,false);
  assert.equal(x.preflight.inputHash,x.packet.inputHash);
  assert.equal((await one(db,'select count(*)::int n from private.r12_adaptive_activations')).n,0);
  assert.equal((await one(db,'select count(*)::int n from private.r05_requests where business_id=$1',[x.f.businessId])).n,20);
  const started=await startAdaptivePlanner(db,x),confirmed=started.activated;
  assert.equal(confirmed.activated,true);
  assert.equal((await one(db,'select count(*)::int n from private.r12_adaptive_activations')).n,1);
  assert.equal((await one(db,'select count(*)::int n from private.r07_children where plan_id=$1',[confirmed.planId])).n,5);
  assert.equal((await one(db,'select count(*)::int n from private.r12_adaptive_actions where scope_id=$1',[x.prepared.scopeId])).n,1);
  assert.equal((await one(db,'select count(*)::int n from private.r05_requests where business_id=$1',[x.f.businessId])).n,20);
  const {controller,admission,lease,epoch}=started;
  const ownerView=await x.f.rpc('r12_discovery_owner_read',
   [x.f.businessId,x.prepared.scopeId,true]);
  assert.equal(ownerView.activation.mode,'qualification');
  assert.equal(ownerView.activation.scope.version,'r12.discovery-owner-adaptive.1');
  assert.equal(ownerView.activation.scope.id,x.prepared.scopeId);
  assert.equal(ownerView.activation.planHash,confirmed.planHash);
  assert.equal(ownerView.activation.quote.quoteHash,x.quote.quoteHash);
  assert.equal(ownerView.activation.preview.version,'r12.adaptive-research-preview.1');
  assert.ok(Array.isArray(ownerView.activation.operations));
  assert.equal(ownerView.activation.controllerKeyHash,sha(controller));
  assert.equal(ownerView.activation.admissionKeyHash,sha(admission));
  const controllerSnapshot=await ownerInitialRuntimeRpc(db,'r07_controller',
   [x.f.businessId,x.f.goalId,'read',{},randomUUID(),controller,lease,null,admission]);
  assert.equal(controllerSnapshot.planHash,ownerView.activation.planHash);
  assert.equal(discoveryV2Hash(controllerSnapshot.plan),discoveryV2Hash(started.context.plan));
  assert.equal(discoveryV2Hash(controllerSnapshot.plan),discoveryV2Hash(ownerView.activation.plan));
  const adaptive=(operation,payload={})=>ownerInitialRuntimeRpc(db,'r12_adaptive_controller_server',
   [x.f.businessId,x.prepared.scopeId,operation,payload,controller]);
  await assert.rejects(ownerInitialRuntimeRpc(db,'r12_adaptive_controller_server',
   [x.f.businessId,x.prepared.scopeId,'action_context',{},'wrong-controller-key-is-not-enrolled']),
   /r12_adaptive_controller_capability_required/);
  const command=(op,payload,epoch=null)=>ownerInitialRuntimeRpc(db,'r07_controller',
   [x.f.businessId,x.f.goalId,op,payload,randomUUID(),controller,lease,epoch,admission]);
  const action=await one(db,'select content_hash,content from private.r12_adaptive_actions where scope_id=$1 and ordinal=0',[x.prepared.scopeId]);
  const {raw:phaseInput,context}=started;
  assert.equal(phaseInput.version,'r12.discovery-adaptive-inputs.1');
  assert.equal(phaseInput.actionHash,action.content_hash);
  const attempt=context.attempt;
  const firstTick=await driveQuestOnce({read:()=>command('read',{}),
   command:(operation,payload,claimEpoch)=>command(operation,
    operation==='reserve'?{...payload,runtimeCapability:started.payload.runtimeCapability}:payload,claimEpoch),
   readAdaptiveAction:()=>adaptive('action_context')},
  {adapters:{[context.step.adapter]:started.adapter},reconcile:true});
  assert.deepEqual(firstTick,{status:'progress',reason:'reserved'});
  const bound=await bindAdaptivePlanner(db,x,started,{reserve:false,marker:true}),wireHash=bound.wireHash;
  assert.deepEqual(await ownerInitialRuntimeRpc(db,'r12_discovery_server',
   [x.f.businessId,attempt.id,'inputs',{},controller]),{...phaseInput,inputMode:'receipt'});
  const reservedAttempt=(await command('read',{})).attempts.find(v=>v.id===attempt.id);
  assert.equal(reservedAttempt.requestId,bound.requestId);
  const marked=await ownerInitialRuntimeRpc(db,'r12_discovery_server',
   [x.f.businessId,attempt.id,'send',{wireHash},controller]);
  assert.equal(marked.shouldDispatch,true,JSON.stringify(marked));
  const savedWire=await ownerInitialRuntimeRpc(db,'r12_discovery_server',
   [x.f.businessId,attempt.id,'load',{},controller]);
  const inspectedWire=await inspectAdaptiveResearchWire(JSON.parse(savedWire.binding.requestJson),
   'plan',savedWire.binding.quote,Date.parse(savedWire.binding.quote.verifiedAt));
  assert.equal(inspectedWire.wire.body,savedWire.binding.wireBody);
  assert.equal((await one(db,'select count(*)::int n from private.r05_markers where business_id=$1',[x.f.businessId])).n,21);
  assert.equal((await adaptive('diagnosed_failure')).handled,false);
  const providerRequestId='gen-inert-adaptive-schema-failure';
  const observed=observeR12ReviewResponse({id:providerRequestId,model:'openai/gpt-5.6-luna-20260709',
   choices:[{finish_reason:'stop',message:{content:'not a JSON object'}}]},
   {scopeId:x.prepared.scopeId,attemptId:attempt.id,requestId:reservedAttempt.requestId},new Date().toISOString());
  await ownerInitialRuntimeRpc(db,'r12_discovery_server',
   [x.f.businessId,attempt.id,'observe',{observation:observed,observationHash:discoveryV2Hash(observed)},controller]);
  const diagnostic={scopeId:x.prepared.scopeId,attemptId:attempt.id,requestId:reservedAttempt.requestId,
   version:'r12.review-diagnostic.1',recordedAt:new Date().toISOString(),code:'json_parse',
   httpStatus:null,observationSaved:true,issues:[]};
  await ownerInitialRuntimeRpc(db,'r12_discovery_server',
   [x.f.businessId,attempt.id,'diagnose',{diagnostic,diagnosticHash:discoveryV2Hash(diagnostic)},controller]);
  assert.equal((await adaptive('diagnosed_failure')).handled,false,
   'A saved diagnostic alone cannot authorize repair while the charge is unresolved');
  const settlement={actualMicrounits:'10',providerRequestId,
   receiptHash:discoveryV2Hash({phase:'plan',providerRequestId,actualMicrounits:'10'})};
  await command('settle',{attemptId:attempt.id,settlement},epoch);
  const diagnosed=await adaptive('diagnosed_failure');
  assert.equal(diagnosed.handled,true,JSON.stringify(diagnosed));
  assert.equal((await adaptive('diagnosed_failure')).replayed,true);
  assert.equal((await one(db,'select status from private.r07_attempts where id=$1',[attempt.id])).status,'failed');
  assert.equal((await one(db,'select state from private.r12_adaptive_action_closures where scope_id=$1',[x.prepared.scopeId])).state,'failed');
  const repair=await adaptive('admit_next');
  assert.equal(repair.admitted,true,JSON.stringify(repair));
  const repairAction=await one(db,'select content from private.r12_adaptive_actions where scope_id=$1 and ordinal=1',[x.prepared.scopeId]);
  assert.equal(repairAction.content.kind,'repair');
  assert.deepEqual(repairAction.content.phases,['plan','search','select','strategy','review']);
  assert.equal(repairAction.content.repair.failureHash,diagnosed.failureHash);
 }finally{await db.close();}
});
