import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2.js';
import {R04_RPC} from '../.core-tests/core/quest-contract.js';
import * as preparation from '../.core-tests/products/discovery-r12-pilot-preparation-contract.js';
import * as successor from '../.core-tests/products/discovery-r12-focused-successor.js';
import {focusedSuccessorFixture} from './helpers/r12-focused-successor-fixture.mjs';
import {parseR12ReviewOwnerWorkspace} from '../.core-tests/products/discovery-r12-review-preparation-contract.js';
const require=createRequire(import.meta.url),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const id=n=>`ffffffff-ffff-4fff-8fff-${String(n).padStart(12,'0')}`;
function source(file,deps){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(name=>{if(name==='server-only')return{};if(name==='react/jsx-runtime'||name==='node:crypto')return require(name);assert.ok(Object.hasOwn(deps,name),name);return deps[name];},m,m.exports);return m.exports;}
function fixture(){
 const input={businessId:id(1),sourceScopeId:id(2),preparationId:id(3),setupUntil:new Date(Math.floor((Date.now()+7200000)/1000)*1000).toISOString()};
 const root={hasUncertainCosts:false,pendingExposureMicrousd:0},cost={hasUnknown:false,heldMicrousd:'0',knownMicrousd:'21932'};
 const broad={businessId:id(1),scopeId:id(20),goalId:id(21),planId:id(22),planHash:'2'.repeat(64),planVersion:4,policyRevoked:true,activeWindow:false,cost,rootFunding:root,nextReviewScopeId:null,priorReviews:[{scopeId:id(23)}],budgetAuthorityRootId:id(24),priorRoundId:id(25)};
 const phase=(phase,status,knownMicrousd)=>({phase,status,knownMicrousd,heldMicrousd:'0',unknownCost:false,candidateSaved:true,artifactId:null,outcome:null,receipt:{status:'stopped',attempts:1},responseDiagnostic:null});
 const current={...broad,scopeId:input.sourceScopeId,goalId:id(4),planId:id(5),planHash:'5'.repeat(64),planVersion:1,state:'running',priorReviews:[],focusedPilot:{profileHash:'a'.repeat(64),closedScopeId:broad.scopeId,closedPlanId:broad.planId,acceptedReviewScopeId:id(23)},phases:[{...phase('strategy','completed','11932'),artifactId:id(6),outcome:'TEST'},{...phase('review','dispatched','10000'),responseObservation:{contentState:'complete'},responseDiagnostic:{code:'domain_validation',observationSaved:true}}]};
 const accepted={businessId:id(1),scopeId:id(23),goalId:broad.goalId,originalFundingRootId:id(24),review:{outcome:'NEEDS_MORE_EVIDENCE'}};
 const calls=[],reads=[],submissions=new Map();let goal=null;const context={userId:id(9),supabase:{auth:{getClaims:async()=>({data:{claims:{sub:id(9)}}})},rpc:async(name,args)=>{
  calls.push({name,args});if(name===R04_RPC.read)return{data:{selected:goal}};assert.equal(name,R04_RPC.transition);
  const contentHash=hash([args.p_operation,args.p_payload]),old=submissions.get(args.p_submission_id);if(old)return old.hash===contentHash?{data:old.result}:{error:{message:'submission conflict'}};
  if(args.p_operation==='quest.save'){assert.equal(args.p_payload.goalId,null);goal={id:id(10),businessId:input.businessId,revision:1,preference:'draft',content:args.p_payload.content,hash:hash(args.p_payload.content)};}
  else {assert.equal(args.p_operation,'quest.preference');assert.equal(args.p_payload.goalId,goal.id);goal={...goal,revision:2,preference:'ready'};}
  const result={operation:args.p_operation,id:goal.id,revision:goal.revision};submissions.set(args.p_submission_id,{hash:contentHash,result});return{data:result};
 }}};
 const api=source('src/products/discovery-r12-pilot-preparation-server.ts',{'../lib/core-ui/owner-business':{verifyOwnerBusiness:async()=>true},'../core/quest-contract':{R04_RPC},'./discovery-v2':{discoveryV2Hash:hash},'./discovery-r12-owner':{readDiscoveryR12Workspace:async(_c,_b,s)=>{reads.push(s);return{record:s===current.scopeId?current:s===broad.scopeId?broad:null};},readDiscoveryR12Result:async(_c,_b,s)=>{assert.equal(s,accepted.scopeId);return{record:accepted};}},'./discovery-r12-server':{prepareDiscoveryR12Authority:async()=>({controllerKeyHash:'b'.repeat(64),admissionKeyHash:'c'.repeat(64),authorityCreated:false})},'./discovery-r12-pilot-preparation-contract':preparation});
 return{input,current,broad,accepted,calls,reads,submissions,context,api};
}

test('real owner preparation creates one new Goal keyed to immediate plan with concurrent and refreshed recovery',async()=>{
 const f=fixture(),before=structuredClone({current:f.current,broad:f.broad,accepted:f.accepted}),[a,b]=await Promise.all([f.api.prepareR12PilotGoal(f.context,f.input),f.api.prepareR12PilotGoal(f.context,f.input)]);
 assert.deepEqual(a,b);assert.equal(a.closedPlanId,f.current.planId);assert.equal(a.closedPlanHash,f.current.planHash);assert.equal(a.originalClosedPlanId,f.broad.planId);assert.equal(a.originalGoalId,f.broad.goalId);assert.equal(a.predecessorGoalId,f.current.goalId);assert.equal(a.sourceScopeId,f.current.scopeId);assert.equal(a.authorityCreated,false);assert.equal(f.submissions.size,2);assert.deepEqual({current:f.current,broad:f.broad,accepted:f.accepted},before);
 assert.deepEqual(await f.api.prepareR12PilotGoal(f.context,f.input),a);await assert.rejects(f.api.prepareR12PilotGoal(f.context,{...f.input,preparationId:id(99)}));await assert.rejects(f.api.prepareR12PilotGoal(f.context,{...f.input,setupUntil:new Date(Date.parse(f.input.setupUntil)+1000).toISOString()}));assert.equal(f.submissions.size,2);assert.ok(f.reads.includes(f.broad.scopeId));
 const content=f.calls.find(c=>c.args.p_operation==='quest.save').args.p_payload.content;assert.match(content.title,/research-only successor/);assert.match(content.parsed.stopConstraints.join(' '),/Stop before the reviewer/);assert.match(content.parsed.stopConstraints.join(' '),/0.277907/);
});

test('preparation rejects unsettled, recursive, substituted broad history or unverified rejected review before saves',async()=>{
 for(const mutate of [f=>f.current.policyRevoked=false,f=>f.current.activeWindow=true,f=>f.current.focusedSuccessor={},f=>f.current.phases[1].knownMicrousd=null,f=>f.current.phases[1].unknownCost=true,f=>f.current.phases[1].receipt.status='awaiting_receipt',f=>f.current.phases[1].responseDiagnostic.code='response_schema',f=>f.current.phases[1].responseObservation=null,f=>f.current.phases[0].outcome='NEEDS_MORE_EVIDENCE',f=>f.broad.planId=id(99),f=>f.broad.focusedPilot={},f=>f.accepted.goalId=f.current.goalId,f=>f.accepted.review.outcome='TEST']){
  const f=fixture();mutate(f);await assert.rejects(f.api.prepareR12PilotGoal(f.context,f.input));assert.equal(f.calls.length,0);
 }
});

function workspace(){const f=focusedSuccessorFixture(),p={version:'r12.review-owner-proposal.1',scopeId:f.p.id,scopeHash:hash(f.envelope),businessId:f.p.businessId,ownerId:f.successor.authorization.ownerId,goalId:f.p.goalId,expectedBusinessRevision:2,expectedBusinessHash:'a'.repeat(64),expectedGoalRevision:2,expectedGoalHash:f.successor.authorization.preparedGoalHash,businessContent:{brandContext:'Fixture Business',operatingRules:'Research only',allowedActivity:'Only this successor',restrictions:'No image or store action'},goalContent:{...preparation.r12PilotGoalContent({businessId:f.p.businessId,sourceScopeId:f.closure.scopeId,preparationId:f.p.id,setupUntil:f.p.expiresAt},true),objective:f.p.intent.objective},operatingPolicy:{version:'r05.1',goalId:f.p.goalId,businessRevision:3,goalRevision:4,currency:'USD',maximumDispatches:2,policyLimitMicrounits:'277907',businessLifetimeLimitMicrounits:'1000000',operations:['strategy','review'].map((key,i)=>({operationKey:`research.r12.${f.p.id}.${key}`,maximumPerOperationMicrounits:i?'211236':'66671'})),expiresAt:f.p.expiresAt},interpretationHash:f.successor.authorizationHash};return{f,view:{version:'r12.review-owner-workspace.1',businessId:f.p.businessId,scopeId:f.p.id,scope:f.envelope,proposalHash:hash(p),proposal:p,confirmation:null,eligible:true,reason:null,successor:f.successor}};}

test('owner confirmation parser binds historical prepared revision and research-only exact proposal limits',()=>{
 const{f,view}=workspace();assert.deepEqual(parseR12ReviewOwnerWorkspace(view,f.p.businessId,f.p.id,f.successor.authorization.ownerId),view);
 const confirmed=structuredClone(view);confirmed.confirmation={policyId:id(75),policyHash:'a'.repeat(64),businessRevision:3,goalRevision:4};assert.doesNotThrow(()=>parseR12ReviewOwnerWorkspace(confirmed,f.p.businessId,f.p.id,f.successor.authorization.ownerId));
 for(const mutate of [v=>v.successor=null,v=>v.proposal.interpretationHash=v.scope.approvalHash,v=>v.proposal.expectedGoalHash='0'.repeat(64),v=>v.proposal.operatingPolicy.policyLimitMicrounits='277906',v=>v.proposal.operatingPolicy.operations[0].maximumPerOperationMicrounits='66670']){const v=structuredClone(view);mutate(v);v.proposalHash=hash(v.proposal);assert.throws(()=>parseR12ReviewOwnerWorkspace(v,f.p.businessId,f.p.id,f.successor.authorization.ownerId));}
});

test('real owner confirmation API recovers same confirmed receipt without paid work',async()=>{
 const {f,view}=workspace(),context={userId:f.successor.authorization.ownerId},calls=[];
 context.supabase={auth:{getClaims:async()=>({data:{claims:{sub:context.userId}}})},rpc:async(name,args)=>{calls.push(name);if(name==='r12_review_owner_read')return{data:view};assert.equal(name,'r12_review_owner_confirm');assert.equal(args.p_proposal_hash,view.proposalHash);view.confirmation={policyId:id(75),policyHash:'a'.repeat(64),businessRevision:3,goalRevision:4};return{data:{...view.confirmation,scopeId:f.p.id,executionAuthorized:false}};}};
 const api=source('src/products/discovery-r12-review-preparation-server.ts',{'../lib/core-ui/owner-business':{verifyOwnerBusiness:async()=>true},'./discovery-r12-server':{prepareDiscoveryR12Authority:async()=>({controllerKeyHash:'b'.repeat(64),admissionKeyHash:'c'.repeat(64),authorityCreated:false})},'./discovery-r12-review-preparation-contract':{parseR12ReviewOwnerWorkspace,r12ReviewUuid:v=>typeof v==='string'&&v.includes('-')}});
 const a=await api.confirmR12ReviewPreparation(context,f.p.businessId,f.p.id,view.proposalHash),b=await api.confirmR12ReviewPreparation(context,f.p.businessId,f.p.id,view.proposalHash);assert.deepEqual(a,b);assert.equal(a.executionAuthorized,false);assert.ok(calls.every(name=>['r12_review_owner_read','r12_review_owner_confirm'].includes(name)));
});

const owner=source('src/products/discovery-r12-owner.ts',{'../lib/core-ui/owner-business':{},'./discovery-r12-runtime':{},'./discovery-r12-observation':{validateR12ReviewOwnerEvidence:()=>{},r12ReviewDiagnosticSummary:()=>''},'./discovery-r12-focused-successor':successor});
test('negative accepted strategy disables Continue and renders exact stop reason without altering accepted status',()=>{
 const Link=({children,...p})=>React.createElement('a',p,children),pass=()=>null;
 const {ConsoleR12Progress}=source('src/components/console/console-r12-discovery.tsx',{'next/link':Link,'next/navigation':{},'@/lib/core-ui/console-data':{},'@/lib/core-ui/console-research-query':{},'@/products/discovery-r12-owner':owner,'@/app/dashboard/research-qualification/presentation':{formatResearchUsd:n=>`USD ${n/1e6}`},'./console-shell':{},'./console-r12-controls':{ConsoleR12Controls:({canContinue,canStop})=>React.createElement('div',null,React.createElement('button',{disabled:!canContinue},'Continue'),React.createElement('button',{disabled:!canStop},'Stop'))},'./console-r12-result':{ConsoleR12Result:pass},'@/products/discovery-r12-review-preparation-server':{},'@/products/discovery-r12-review-preparation-contract':{},'./console-workspace.css':{}});
 for(const outcome of ['NEEDS_MORE_EVIDENCE','REJECT']){const f=fixture(),record={...f.current,focusedSuccessor:{authorization:{predecessorClosure:{scopeId:id(80),goalId:id(81)}}},dispatchUntil:new Date(Date.now()+100000).toISOString(),receiptUntil:new Date(Date.now()+1900000).toISOString(),activeWindow:true,policyRevoked:false,paused:false};record.phases[0].outcome=outcome;record.phases[1]={phase:'review',status:'not_started',receipt:null};const before=structuredClone(record);assert.equal(owner.discoveryR12CanContinue(record),false);assert.match(owner.discoveryR12SuccessorStopReason(record),/stops before independent review/);const html=renderToStaticMarkup(React.createElement(ConsoleR12Progress,{record,observedAt:Date.now()}));assert.match(html,/<button disabled="">Continue<\/button>/);assert.match(html,/Use Stop to close remaining authority/);assert.match(html,/Inspect the closed focused predecessor/);assert.deepEqual(record,before);}
});


test('saved recovery progress waits for its finite lease and enables after expiry without changing the record',()=>{
 const now=Date.now(),record={...fixture().current,focusedSuccessor:{authorization:{version:'r12.focused-pilot-terminal-qualification-authorization.1'}},state:'running',policyRevoked:false,paused:false,activeWindow:true,continueAfter:new Date(now+30000).toISOString(),dispatchUntil:new Date(now+120000).toISOString(),receiptUntil:new Date(now+1920000).toISOString(),phases:[{phase:'strategy',status:'reserved',candidateSaved:false,outcome:null,receipt:null},{phase:'review',status:'not_started',candidateSaved:false,outcome:null,receipt:null}]},before=structuredClone(record);
 assert.equal(owner.discoveryR12CanContinue(record,now),false);assert.equal(owner.discoveryR12CanContinue(record,now+30001),true);assert.deepEqual(record,before);
 const receipt={...record,activeWindow:false,dispatchUntil:new Date(now-1000).toISOString(),phases:[{phase:'strategy',status:'dispatched',candidateSaved:true,outcome:null,receipt:{status:'awaiting_receipt',receiptExpiresAt:new Date(now+90000).toISOString(),nextCheckAt:new Date(now-1000).toISOString()}}]};
 assert.equal(owner.discoveryR12CanContinue(receipt,now),false);assert.equal(owner.discoveryR12CanContinue(receipt,now+30001),true);assert.equal(owner.discoveryR12CanContinue({...receipt,policyRevoked:true},now+30001),false);
});
