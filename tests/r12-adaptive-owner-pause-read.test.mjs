import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {etsyObserved} from './helpers/r12-etsy-wire-fixture.mjs';
import {fixture as legacyFixture} from './helpers/r12-adaptive-inputs-fixture.mjs';
import {id,now} from './helpers/r12-adaptive-fixture.mjs';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2.js';
import {selectAdaptiveOwnerResearchPublicScope} from '../.core-tests/products/discovery-r12-goal-scope.js';
import {adaptiveOwnerSetupHash} from '../.core-tests/products/discovery-r12-adaptive-owner-contract.js';

// Exercise the actual server read validator and pure contracts. Only owner
// lookup, unused mutation/provider modules and server-only marker are inert.
const moduleUrl=new URL('../.core-tests/products/discovery-r12-adaptive-owner-server.js',import.meta.url);
const require=createRequire(moduleUrl),loaded={exports:{}};
const source=ts.transpileModule(readFileSync(new URL('../src/products/discovery-r12-adaptive-owner-server.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
new Function('require','module','exports',source)(name=>{
  if(['server-only','./discovery-r12-server','./discovery-r12-server-dependencies','./discovery-r12-owner-observation-server'].includes(name))return {};
  if(name==='../lib/core-ui/owner-business')return {verifyOwnerBusiness:async(context,businessId)=>context.businesses.some(b=>b.id===businessId)};
  return require(name);
},loaded,loaded.exports);
const {readAdaptiveOwnerResearch}=loaded.exports;

function fixture(legacy=false){
 const f=legacy?legacyFixture():etsyObserved(),{scope,preview,action}=f.raw;
 const choice=scope.selection,selection={...selectAdaptiveOwnerResearchPublicScope(scope.profile,choice,now),...choice};
 const receipt={version:'r12.owner-adaptive-receipt.1',businessId:preview.businessId,goalId:preview.goalId,setupId:id(801),scopeId:scope.id,
  profileId:scope.profile.id,grantId:id(802),submissionId:id(803),policyId:id(804),policyHash:'a'.repeat(64),approvalHash:'b'.repeat(64),
  preview,selection,quote:f.quote,ownerObservationRef:preview.ownerObservationRef,confirmed:true,activated:true,stopped:false,planId:f.raw.planId,planHash:f.raw.planHash,
  actions:[{action,actionHash:hash(action),state:'completed',outcome:'NEEDS_MORE_EVIDENCE',committedMicrounits:'30',unresolvedQuestions:[]}]};
 receipt.setupHash=adaptiveOwnerSetupHash(receipt);
 const catalog={version:'r12.owner-adaptive-catalog.1',businessId:receipt.businessId,goalId:receipt.goalId,eligible:false,reason:'closed_settled_lineage_required',
  predecessorClosure:null,predecessorClosureHash:null,imports:[],business:{...preview.business,revision:1,hash:'c'.repeat(64)},funding:null,deadline:preview.expiresAt,
  profiles:[{profile:scope.profile,profileHash:hash(scope.profile)}],grants:[],setups:[receipt],actions:receipt.actions,
  activation:{setupId:receipt.setupId,scopeId:receipt.scopeId,stopped:false,pendingReceiptReadback:false,pendingReceiptCount:0,pauseReason:legacy?null:'owner_source_operation_required'}};
 const calls=[],ownerId=id(900),context={userId:ownerId,businesses:[{id:receipt.businessId}],supabase:{auth:{getClaims:async()=>({data:{claims:{sub:ownerId}},error:null})},
  rpc:async(name,args)=>{calls.push({name,args});return {data:structuredClone(catalog),error:null};}}};
 return {catalog,receipt,calls,read:()=>readAdaptiveOwnerResearch(context,receipt.businessId,receipt.goalId,receipt.setupId)};
}

test('owner catalog preserves only exact authenticated typed source pause; legacy null remains readable',async()=>{
 for(const legacy of [false,true]){const f=fixture(legacy),result=await f.read();assert.equal(result.available,true);assert.equal(result.catalog.activation.pauseReason,legacy?null:'owner_source_operation_required');assert.deepEqual(f.calls.map(c=>c.name),['r12_owner_adaptive_read']);}
});

test('owner catalog rejects untyped, foreign, stopped, pending and still-running source-pause projections',async()=>{
 for(const change of [
  f=>delete f.catalog.activation.pauseReason,
  f=>f.catalog.activation.pauseReason='different_reason',
  f=>f.catalog.activation.pauseReason={reason:'owner_source_operation_required'},
  f=>f.catalog.activation.setupId=id(950),
  f=>f.catalog.activation.scopeId=id(951),
  f=>{f.catalog.activation.stopped=true;f.receipt.stopped=true;},
  f=>{f.catalog.activation.pendingReceiptReadback=true;f.catalog.activation.pendingReceiptCount=1;},
  f=>f.receipt.actions[0].state='running',
 ]){const f=fixture();change(f);assert.deepEqual(await f.read(),{available:false,catalog:null});}
 const legacy=fixture(true);legacy.catalog.activation.pauseReason='owner_source_operation_required';assert.deepEqual(await legacy.read(),{available:false,catalog:null});
});
