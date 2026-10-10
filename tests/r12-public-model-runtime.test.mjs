import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPublic,uid,h,hash,self,binding,publicPolicy} from './r12-public-fixtures.mjs';
import {NOW,ETSY_INSIGHTS_CAPTURE_POLICY_HASH,ETSY_INSIGHTS_SOURCE_POLICY_HASH} from './helpers/r12-public-insights-model-fixture.mjs';
import {r12CatalogFixture} from './helpers/r12-provider-fixture.mjs';
import {r12PhaseOutputFixture} from './helpers/r12-phase-output-fixture.mjs';
import {qualifyEtsyOwnerResearchQuote} from '../.core-tests/products/discovery-r12-adaptive-quote.js';
const runtime=await loadPublic('model-runtime'),m=await loadPublic('model'),prep=await loadPublic('preparation'),cycle=await loadPublic('cycle'),origin=await loadPublic('origin'),execution=await loadPublic('execution-quote');
function repinState(s,changes={}){const{stateHash,...body}=s;void stateHash;return self({...body,...changes},'stateHash');}
function quoteProof(f,phase,phaseAttemptId){const authority=self({version:'r12.public-execution-authority.1',businessId:f.policy.businessId,goalId:f.policy.goalId,authorityRootId:f.policy.authorityRootId,envelopeHash:f.policy.envelopeHash,policyHash:f.policy.policyHash,phaseAttemptId,knownActualMicrounits:'0',heldMaximumMicrounits:'20000',windowMaximumMicrounits:'10000000',rootHeadroomMicrounits:'10000000',businessHeadroomMicrounits:'10000000',allocationHeadroomMicrounits:'1000000',hasUnknownLiability:false,authorityActive:true,stopped:false,expiresAt:new Date(NOW+120000).toISOString()},'snapshotHash');return execution.qualifyPublicResearchExecutionQuote(f.approvedQuote??f.quote,f.quote,f.policy,{attemptOrdinal:f.state.attempts.at(-1).ordinal,windowAttemptOrdinal:f.state.attempts.at(-1).windowAttemptOrdinal,phase,phaseAttemptId},authority,h('current-authoritative-route'),f.now??NOW);}
function mkInput(f,phase){const d=f.state.attempts.at(-1).dispatches.at(-1),executionQuoteProof=quoteProof(f,phase,d.attemptId);d.executionQuoteHash=f.quote.quoteHash;d.executionQuoteProofHash=executionQuoteProof.compatibilityHash;f.state=repinState(f.state);return self({version:'r12.public-research-phase-inputs.1',format:'r12.discovery-direct.1',phase,phaseAttemptId:f.state.attempts.at(-1).dispatches.at(-1).attemptId,validationAt:f.now??NOW,planHash:h('real-plan'),policy:f.policy,approvedQuote:f.approvedQuote??f.quote,quote:f.quote,executionQuoteProof,profile:f.profile,state:f.state,originHistory:f.history,sourcePackets:f.packets,dependencies:{plan:phase==='plan'?null:f.dependencies.plan,strategy:phase==='review'?f.dependencies.strategy:null},reviewQualification:f.qualification},'inputHash');}
function expect(i){return{businessId:i.policy.businessId,goalId:i.policy.goalId,scopeId:i.policy.scopeId,scopeHash:i.policy.scopeHash,planHash:i.planHash,phaseAttemptId:i.phaseAttemptId,phase:i.phase,inputHash:i.inputHash,profileHash:i.profile.profileHash,reviewQualificationHash:hash(i.reviewQualification),quoteRouteEvidenceHash:i.executionQuoteProof.routeEvidenceHash,quoteAuthoritySnapshotHash:i.executionQuoteProof.authoritySnapshotHash,sourceReceiptHashes:i.sourcePackets.map(s=>s.receipt.receiptHash),dependencyResponseHashes:Object.values(i.dependencies).filter(Boolean).map(x=>x.responseHash)};}
function fixture(){
 const base=publicPolicy(10),history=self({version:'r12.public-research-origin-history.1',businessId:base.policy.businessId,goalId:base.policy.goalId,predecessorScopeId:uid(700),predecessorClosureHash:h('closed-history'),receipts:[],financialProofs:[],provenance:[],materialHistory:[],continuity:{seenQuestionHashes:[],seenEvidenceIdentityHashes:[],seenFactIdentityHashes:[],usedDiagnosticHashes:[],negativeFindingHashes:[],consecutiveNonprogress:2}},'historyHash');
 const inherited=origin.publicResearchInheritedHistory(history),continuation=base.policy.continuation;const{continuationHash,...cont}=continuation;void continuationHash;
 const account=binding({verifiedAt:new Date(NOW-1000).toISOString(),expiresAt:new Date(NOW+120000).toISOString()});
 const browser=self({version:'r12.public-browser-quote.1',provider:'steel',category:'browser',providerProjectId:account.providerProjectId,zeroCostQualificationHash:null,routeHash:h('route'),priceEvidenceHash:h('price'),settlementContractHash:h('settlement-contract'),tariffHash:h('tariff'),qualificationHash:h('qualified'),maximumMicrounits:'2500',verifiedAt:new Date(NOW-1000).toISOString(),validUntil:new Date(NOW+299000).toISOString(),qualified:true,retentionDisclosure:'Private aggregate viewport screenshots; approved opaque profile.'},'browserQuoteHash');
 const quote=prep.qualifyPublicResearchWindowQuote(qualifyEtsyOwnerResearchQuote(r12CatalogFixture(NOW),NOW),browser,'10000000',NOW,10);
 const nextCont=self({...cont,historyHash:hash(inherited)},'continuationHash'),{policyHash,...body}=base.policy;void policyHash;
 const policy=self({...body,quoteHash:quote.quoteHash,inheritedStateHash:hash(inherited),continuation:nextCont,window:{...body.window,continuationHash:nextCont.continuationHash},phaseMaximumMicrounits:quote.phaseMaximumMicrounits,sourcePolicyHash:ETSY_INSIGHTS_SOURCE_POLICY_HASH,sourceAccess:{allowedSource:'etsy_authenticated_insights',sourcePurpose:'etsy_insights_aggregate_research',accountBinding:account,capturePolicyHash:ETSY_INSIGHTS_CAPTURE_POLICY_HASH}},'policyHash');
 const profile=self({version:'r12.owner-research-profile.4',id:uid(800),businessId:policy.businessId,goalId:policy.goalId,goalHash:h('goal'),marketSetKey:'gb',topicKey:'adult interests',publicGoal:'Compare bounded adult apparel hypotheses with literal marketplace observations.',productFormat:'Original adult printed T-shirt',category:'Adult apparel',markets:[{countryCode:'GB',currency:'GBP'}],audience:'Adults interested in original apparel',sourceAccess:policy.sourceAccess,maximumAttemptsInWindow:10,originalRunMaximumMicrounits:'10000000',validUntil:new Date(NOW+120000).toISOString()},'profileHash');
 // Inject a server-authenticated inert scheduled snapshot. This does not invoke
 // live admission; the public cycle still explicitly gates unqualified Insights.
 let state=cycle.createPublicResearchState(policy,inherited,base.initial);state=repinState(state,{attempts:[{ordinal:1,windowAttemptOrdinal:1,attemptId:uid(810),kind:'initial',epochOrdinal:0,command:base.initial,dispatches:[{phase:'plan',attemptId:uid(811),requestHash:h('preflight-placeholder'),executionQuoteHash:quote.quoteHash,executionQuoteProofHash:h('preflight-proof'),receiptHash:null}],sourceProof:null,status:'running',review:null,failureHash:null}],windowAttemptsStarted:1,totalAttemptsStarted:1,modelDispatchesUsed:1,cumulativeDispatchesUsed:18,epochCriteriaHash:base.initial.criteriaHash,seenCriteriaHashes:[base.initial.criteriaHash],nextAttemptKind:null,pendingCommand:null,history:{...inherited,seenQuestionHashes:[base.initial.questionHash]}});
 cycle.validatePublicResearchState(state,policy);
 return{policy,profile,quote,history,state,packets:[],dependencies:{plan:null,strategy:null},qualification:{version:'r12.public-review-qualification.1',requirementHash:h('requirements'),comparativeConclusion:false,materialOpposingExplanation:true,sourceTemporalPrecisionSufficient:false,claimBoundariesRespected:true,missingCriticalRequirements:['No eligible exposure denominator'],supportingEvidenceVerified:false,refutingEvidenceVerified:false}};
}
function harness(options={}){
 const f=fixture(),first=mkInput(f,'plan'),attemptId=first.phaseAttemptId,requestId=uid(993),output=r12PhaseOutputFixture(f.profile.audience).plan;output.queryFocus=[];
 const authority={businessId:f.policy.businessId,goalId:f.policy.goalId,scopeId:f.policy.scopeId,scopeHash:f.policy.scopeHash,planHash:first.planHash,profileHash:f.profile.profileHash,policyHash:f.policy.policyHash};
 let now=NOW,dispatchClaimed=false;
 const events=[],a={attemptId,requestId,phase:'plan',ordinal:1,dependencyPins:[],inputs:first,status:'scheduled',dispatched:false,binding:null,candidate:null,completed:null,failure:null};
 const rpc=async(purpose,operation,payload)=>{
  events.push(`rpc:${operation}`);assert.equal(purpose,operation==='dispatch'?'admission':'controller');assert.equal(payload.attemptId,attemptId);
  if(operation==='attempt'){if(options.readError)throw Error('private error must not escape');return structuredClone(a);}
  if(operation==='dispatch'){
   if(options.denied||a.dispatched||dispatchClaimed)return{shouldDispatch:false,attemptId,requestId,reason:'already_marked'};dispatchClaimed=true;
   const request=JSON.parse(payload.binding.requestJson),ctx=m.readPublicResearchModelInputs(a.inputs,expect(a.inputs)),wire=await m.inspectPublicResearchModelWire(ctx);assert.equal(payload.binding.wireBody,wire.wire.body);
   f.state.attempts.at(-1).dispatches.at(-1).requestHash=wire.requestHash;f.state=repinState(f.state);a.inputs=mkInput(f,'plan');a.dispatched=true;a.status='dispatched';
   a.binding={scopeId:f.policy.scopeId,attemptId,requestId,phase:'plan',request,maximumMicrousd:Number(f.policy.phaseMaximumMicrounits.plan),dispatchedAt:new Date(NOW).toISOString(),receiptExpiresAt:new Date(NOW+3600000).toISOString()};
   if(options.dispatchLost)throw Error('lost marker response');
   const result={shouldDispatch:true,attemptId,requestId,requestHash:wire.requestHash,wireHash:wire.wireHash,inputs:a.inputs,binding:a.binding};
   if(options.changedFinal)result.binding={...a.binding,maximumMicrousd:1};
   return structuredClone(result);
  }
  if(operation==='candidate'){
   if(a.candidate)assert.deepEqual(payload.candidate,a.candidate);a.candidate=structuredClone(payload.candidate);
   if(options.candidateLost)throw Error('lost saved candidate response');
   return{recorded:true,candidateHash:hash(a.candidate),settled:false};
  }
  if(operation==='model_receipt'){
   assert.deepEqual(payload.candidate,a.candidate);const c=payload.candidate,proof=payload.proof;
   const rh=hash({version:'r12.public-model-receipt-pin.1',phase:a.phase,scopeId:f.policy.scopeId,phaseAttemptId:attemptId,requestId,requestHash:c.requestHash,candidateHash:hash(c),routeProofHash:proof.proofHash});
   const ctx=m.readPublicResearchModelInputs(a.inputs,expect(a.inputs));let result;
   try{result=m.projectPublicResearchModelPhase(ctx,c,a.binding,proof);}catch{
    a.status='failed';a.failure={version:'r12.direct-settled-failure.1',phaseAttemptId:attemptId,requestId,candidateHash:hash(c),routeProofHash:proof.proofHash,modelReceiptHash:rh,diagnostic:'r12_direct_response_schema',actualMicrounits:String(c.reportedMicrousd)};
    return{recorded:true,accepted:false,receiptHash:rh,diagnostic:a.failure.diagnostic};
   }
   const response={outcome:'accepted',result,checkedArtifacts:[],planHash:a.inputs.planHash,inputHash:h('actual-semantic-input')};
   a.completed={stepKey:'plan',attemptId,artifactId:uid(995),responseHash:hash(response),responseCanonicalHash:hash(response),response,binding:a.binding,candidate:c,proof};a.status='completed';
   if(options.receiptLost)throw Error('lost completed receipt response');
   return{recorded:true,accepted:true,receiptHash:rh,result,completed:a.completed};
  }
  throw Error('unsupported rpc');
 };
 let posts=0,gets=0;
 const fetcher=async(url,init)=>{
  if(String(url).includes('/generation?')){gets++;events.push('provider:proof');assert.ok(a.candidate,'persist before proof');if(options.proofError)return new Response('{}',{status:400});const model=f.quote.inference.luna;return Response.json({data:{id:a.candidate.providerRequestId,provider_name:options.badRoute?'Wrong Provider':model.providerName,model:model.modelId}});}
  posts++;events.push('provider:post');assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');assert.ok(a.dispatched);assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.equal(init.body,JSON.stringify(JSON.parse(init.body)));
  if(options.transportError)throw Error('do not leak provider details');
  if(options.oversizedEnvelope)return new Response('x'.repeat(262145));
  if(options.hangingCancel){return new Response(new ReadableStream({start(controller){if(options.hangingCancel==='stream')controller.enqueue(new Uint8Array(262145));},cancel(){options.cancelStarted=true;return new Promise(()=>{});}}),options.hangingCancel==='header'?{headers:{'content-length':'262145'}}:{});}
  if(options.hangingRead)return new Response(new ReadableStream({cancel(){return new Promise(()=>{});}}));
  const raw=options.raw??JSON.stringify(options.output??output),body={id:'gen-runtime-inert',model:options.wrongModel?'other/model':f.quote.inference.luna.modelId,choices:[{finish_reason:options.finishReason??'stop',message:{content:raw}}],usage:{cost:options.cost===undefined?0.000001:options.cost,prompt_tokens:10,completion_tokens:10}};
  return Response.json(body);
 };
 const provider=runtime.createPublicResearchModelProvider({config:{apiKey:'inert-test-key',baseUrl:'https://openrouter.ai/api/v1',appUrl:'https://example.invalid',appName:'inert'},fetcher,...(options.signal?{signal:options.signal}:{})});
 return{f,a,events,authority,attemptId,provider,rpc,options,get posts(){return posts;},get gets(){return gets;},setNow(value){now=value;},run:(mode='execute')=>runtime.runPublicResearchModelAttempt({authority,attemptId,mode},{rpc,provider,now:()=>now})};
}
test('real serializer and injected transport dispatch once, persist before proof, normalize genuine receipt',async()=>{
 const x=harness(),r=await x.run();assert.equal(r.status,'accepted');assert.equal(r.dispatchAdmittedThisInvocation,true);assert.equal(r.candidateSaved,true);assert.equal(x.posts,1);assert.equal(x.gets,1);assert.ok(x.events.indexOf('rpc:candidate')<x.events.indexOf('provider:proof'));assert.equal(r.completed.response.result.format,'r12.discovery-direct.1');
 for(let n=0;n<3;n++)assert.equal((await x.run('receipt_only')).status,'accepted');assert.equal(x.posts,1);assert.equal(x.gets,1);
});
test('schema-invalid raw object is durably billed and rejected after route qualification',async()=>{
 const x=harness({output:{unexpected:'actual malformed result'}}),r=await x.run();assert.equal(r.status,'failed_settled');assert.equal(r.candidateSaved,true);assert.deepEqual(x.a.candidate.output,{unexpected:'actual malformed result'});assert.equal(x.gets,1);assert.equal((await x.run()).status,'failed_settled');assert.equal(x.posts,1);
});
test('proof recovery after failure never resends model and retains original candidate',async()=>{
 const x=harness({proofError:true}),first=await x.run();assert.equal(first.diagnostic,'route_proof_pending');const saved=structuredClone(x.a.candidate);x.options.proofError=false;x.setNow(NOW+600000);const next=await x.run('receipt_only');assert.equal(next.status,'accepted');assert.deepEqual(x.a.candidate,saved);assert.equal(x.posts,1);assert.equal(x.gets,2);
});
for(const flag of ['candidateLost','receiptLost'])test(`${flag} reconciles immutable saved record without resend`,async()=>{const x=harness({[flag]:true});assert.equal((await x.run()).status,'accepted');assert.equal(x.posts,1);assert.equal((await x.run()).status,'accepted');assert.equal(x.posts,1);});
test('lost marker response and repeated calls cannot resend a marked attempt',async()=>{const x=harness({dispatchLost:true});assert.equal((await x.run()).diagnostic,'dispatch_unconfirmed');assert.equal(x.posts,0);assert.equal((await x.run()).diagnostic,'marked_without_saved_candidate');assert.equal(x.posts,0);});
test('receipt-only before dispatch performs no admission or provider work',async()=>{const x=harness();assert.equal((await x.run('receipt_only')).status,'not_dispatched');assert.deepEqual(x.events,['rpc:attempt']);assert.equal(x.posts,0);});
for(const flag of ['denied','changedFinal'])test(`${flag} blocks actual provider transport`,async()=>{const x=harness({[flag]:true});assert.equal((await x.run()).status,'pending');assert.equal(x.posts,0);assert.equal(x.gets,0);});
test('expired quote just before dispatch blocks without a marker',async()=>{const x=harness();x.setNow(NOW+300000);assert.equal((await x.run()).status,'not_dispatched');assert.equal(x.a.dispatched,false);assert.equal(x.posts,0);});
for(const [label,options,diagnostic]of[
 ['unknown billing',{cost:null},'billing_unknown'],['above-bound billing',{cost:10},'billing_above_reserved_bound'],
 ['invalid JSON',{raw:'not JSON'},'provider_response_unqualified'],['incomplete output',{finishReason:'length'},'provider_response_unqualified'],
 ['wrong model',{wrongModel:true},'provider_response_unqualified'],['oversized envelope',{oversizedEnvelope:true},'provider_response_unqualified'],
 ['sensitive key',{output:{password:'unretained'}},'provider_response_unqualified'],['transport ambiguity',{transportError:true},'provider_response_unqualified'],
 ])test(`${label} holds liability and cannot cause automatic paid retry`,async()=>{const x=harness(options),r=await x.run();assert.equal(r.status,'pending');assert.equal(r.diagnostic,diagnostic);assert.equal(x.posts,1);assert.equal(x.gets,0);await x.run();assert.equal(x.posts,1);});
test('served route mismatch retains paid candidate and rejects normalization',async()=>{const x=harness({badRoute:true});assert.equal((await x.run()).diagnostic,'route_proof_pending');assert.equal(x.a.completed,null);assert.ok(x.a.candidate);});
test('trusted setup pins and altered saved candidate cannot be replaced by self hashes',async()=>{const x=harness();x.authority.scopeHash=h('forged');assert.equal((await x.run()).diagnostic,'attempt_read_unverified');assert.equal(x.posts,0);const y=harness({proofError:true});await y.run();y.a.candidate.requestHash=h('changed');assert.equal((await y.run('receipt_only')).diagnostic,'attempt_read_unverified');assert.equal(y.posts,1);});
test('RPC composition scopes keys and uses only exact controller procedure',async()=>{
 const calls=[],controllerKey='c'.repeat(40),admissionKey='a'.repeat(40),rpc=runtime.createPublicResearchModelRpc({rpc(name,args){calls.push({name,args});return Promise.resolve({data:{saved:true},error:null});}},{businessId:uid(1),scopeId:uid(2),controllerKey,admissionKey});
 await rpc('controller','attempt',{attemptId:uid(3)});await rpc('admission','dispatch',{attemptId:uid(3)});assert.equal(calls[0].name,'r12_direct_controller_server');assert.equal(calls[0].args.p_server_key,controllerKey);assert.equal(calls[1].args.p_server_key,admissionKey);await assert.rejects(()=>rpc('controller','dispatch',{}));assert.equal(calls.length,2);
});
test('default provider rejects alternate credential destination before any transport',()=>{assert.throws(()=>runtime.createPublicResearchModelProvider({config:{apiKey:'inert',baseUrl:'https://example.invalid',appUrl:'https://example.invalid',appName:'inert'}}));});

test('concurrent executions compete for one atomic dispatch marker',async()=>{const x=harness();const outcomes=await Promise.all([x.run(),x.run()]);assert.equal(x.posts,1);assert.equal(outcomes.filter(r=>r.status==='accepted').length,1);assert.equal((await x.run('receipt_only')).status,'accepted');assert.equal(x.posts,1);});

for(const kind of ['header','stream'])test(`${kind} oversize cannot hang on an uncooperative body cancellation`,async()=>{const x=harness({hangingCancel:kind});const result=await Promise.race([x.run(),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('unbounded cancellation')),1000);timer.unref();})]);assert.equal(result.diagnostic,'provider_response_unqualified');assert.equal(x.options.cancelStarted,true);assert.equal(x.posts,1);assert.equal(x.a.candidate,null);await x.run('receipt_only');assert.equal(x.posts,1);});
test('shorter caller abort bounds body reads after response headers',async()=>{const controller=new AbortController(),x=harness({hangingRead:true,signal:controller.signal});const pending=x.run();const timer=setTimeout(()=>controller.abort(),20);const result=await Promise.race([pending,new Promise((_,reject)=>{const limit=setTimeout(()=>reject(Error('caller cancellation ignored')),1000);limit.unref();})]);clearTimeout(timer);assert.equal(result.diagnostic,'provider_response_unqualified');assert.equal(x.posts,1);assert.equal(x.a.candidate,null);});
