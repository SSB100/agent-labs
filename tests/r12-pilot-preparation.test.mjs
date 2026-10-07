import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {discoveryV2Hash} from '../.core-tests/products/discovery-v2.js';
import {R04_RPC} from '../.core-tests/core/quest-contract.js';
import {r12PilotGoalContent,validateR12PilotPreparation} from '../.core-tests/products/discovery-r12-pilot-preparation-contract.js';
const require=createRequire(import.meta.url),ts=require('typescript'),id=n=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`;
function fixture(){
 const input={businessId:id(1),sourceScopeId:id(2),preparationId:id(3),setupUntil:new Date(Math.floor((Date.now()+7200000)/1000)*1000).toISOString()};
 const source={businessId:id(1),goalId:id(4),planId:id(5),planHash:'a'.repeat(64),planVersion:4,policyRevoked:true,activeWindow:false,cost:{hasUnknown:false,heldMicrousd:'0'},rootFunding:{hasUncertainCosts:false,pendingExposureMicrousd:0},nextReviewScopeId:null,priorReviews:[{scopeId:id(6)}],budgetAuthorityRootId:id(7),priorRoundId:id(8)};
 const accepted={businessId:id(1),scopeId:id(6),goalId:id(4),originalFundingRootId:id(7),review:{outcome:'NEEDS_MORE_EVIDENCE',missingQuestions:['Demand and commercial readiness remain unresolved.']}};
 const calls=[],submissions=new Map();let goal=null;
 const context={userId:id(9),supabase:{auth:{getClaims:async()=>({data:{claims:{sub:id(9)}}})},rpc:async(name,args)=>{
  calls.push({name,args});if(name===R04_RPC.read)return {data:{businessId:id(1),selected:goal},error:null};
  assert.equal(name,R04_RPC.transition);assert.ok(['quest.save','quest.preference'].includes(args.p_operation),'No history reassociation or financial action');
  const hash=discoveryV2Hash([args.p_operation,args.p_payload]),saved=submissions.get(args.p_submission_id);if(saved)return saved.hash===hash?{data:saved.response,error:null}:{data:null,error:{message:'submission conflict'}};
  if(args.p_operation==='quest.save'){assert.equal(args.p_payload.goalId,null);goal={id:id(10),businessId:id(1),revision:1,preference:'draft',content:args.p_payload.content,hash:discoveryV2Hash(args.p_payload.content)};}
  else {assert.equal(goal.revision,1);assert.equal(args.p_payload.goalId,goal.id);goal={...goal,revision:2,preference:'ready'};}
  const response={operation:args.p_operation,id:goal.id,revision:goal.revision};submissions.set(args.p_submission_id,{hash,response});return{data:response,error:null};
 }}};
 const sourceText=ts.transpileModule(readFileSync('src/products/discovery-r12-pilot-preparation-server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,m={exports:{}};
 new Function('require','module','exports',sourceText)(name=>{
  if(name==='server-only')return{};if(name==='node:crypto')return require(name);
  if(name==='../lib/core-ui/owner-business')return{verifyOwnerBusiness:async(c,b)=>c===context&&b===id(1)};
  if(name==='../core/quest-contract')return{R04_RPC};if(name==='./discovery-v2')return{discoveryV2Hash};
  if(name==='./discovery-r12-owner')return{readDiscoveryR12Workspace:async()=>({available:true,record:source}),readDiscoveryR12Result:async()=>({available:true,record:accepted})};
  if(name==='./discovery-r12-server')return{prepareDiscoveryR12Authority:async()=>({controllerKeyHash:'b'.repeat(64),admissionKeyHash:'c'.repeat(64),authorityCreated:false})};
  if(name==='./discovery-r12-pilot-preparation-contract')return{r12PilotGoalContent,validateR12PilotPreparation};throw Error(`Unexpected dependency ${name}`);
 },m,m.exports);
 return{input,source,accepted,context,calls,submissions,api:m.exports};
}
test('focused preparation creates one separate owner Goal and retries without resetting old history or permission',async()=>{
 const f=fixture(),before=structuredClone(f.source),first=await f.api.prepareR12PilotGoal(f.context,f.input),again=await f.api.prepareR12PilotGoal(f.context,f.input);
 assert.deepEqual(first,again);assert.equal(first.authorityCreated,false);assert.notEqual(first.goalId,f.source.goalId);assert.equal(first.originalGoalId,f.source.goalId);assert.equal(first.rootId,f.source.budgetAuthorityRootId);
 assert.equal(f.submissions.size,2);assert.deepEqual(f.source,before);assert.deepEqual(r12PilotGoalContent(f.input).parsed.geography,['GB']);assert.deepEqual(r12PilotGoalContent(f.input).parsed.budget,{amount:'2',currency:'USD'});
 await assert.rejects(f.api.prepareR12PilotGoal(f.context,{...f.input,preparationId:id(11)}));assert.equal(f.submissions.size,2);
});
test('unsettled, active, nonfinal or non-NME histories cannot prepare a focused successor',async()=>{
 for(const mutate of [f=>f.source.policyRevoked=false,f=>f.source.activeWindow=true,f=>f.source.planVersion=3,f=>f.source.cost.heldMicrousd='1',f=>f.source.rootFunding.hasUncertainCosts=true,f=>f.source.nextReviewScopeId=id(15),f=>f.accepted.review.outcome='TEST']){
  const f=fixture();mutate(f);await assert.rejects(f.api.prepareR12PilotGoal(f.context,f.input));assert.equal(f.calls.length,0);
 }
});
test('focused preparation rejects too-short window or same-scope reset before owner state changes',async()=>{
 const f=fixture();await assert.rejects(f.api.prepareR12PilotGoal(f.context,{...f.input,setupUntil:new Date(Math.floor((Date.now()+1800000)/1000)*1000).toISOString()}));
 assert.throws(()=>validateR12PilotPreparation({...f.input,preparationId:f.input.sourceScopeId}));assert.equal(f.calls.length,0);
});
