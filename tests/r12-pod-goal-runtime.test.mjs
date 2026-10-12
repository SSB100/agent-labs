// Inert contract evidence only. No search, paid model call, real demand or grant.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url), ts = require('typescript');
const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url)), modules = new Map();
// Read the current source, not a potentially stale .core-tests build. Relative
// dependencies use the same loader, including the real serializer/validators.
function source(file) {
  const filename = resolve(sourceRoot, file.endsWith('.ts') ? file : `${file}.ts`);
  assert.ok(filename.startsWith(sourceRoot.endsWith(sep) ? sourceRoot : sourceRoot + sep));
  if (modules.has(filename)) return modules.get(filename).exports;
  const loaded = { exports: {} };
  modules.set(filename, loaded);
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', code)(name => name.startsWith('.')
    ? source(resolve(dirname(filename), name)) : require(name), loaded, loaded.exports);
  return loaded.exports;
}

const {publicResearchHash:hash}=source('research/qualification');
const {acceptPodResearchPlan,validatePodResearchGoalScope,validatePodResearchCitationUrl,POD_GOAL_BOUNDS}=source('products/discovery-r12-pod-goal');
const {POD_DIMENSIONS,POD_REVIEW_CHECKS}=source('products/discovery-r12-pod-analysis');
const {readDiscoveryR12PhaseInputs,buildDiscoveryR12PhaseRequest,projectDiscoveryR12Phase}=source('products/discovery-r12-runtime');
const {reconstructPodResearchResult,buildPodResearchRequest}=source('products/discovery-r12-pod-runtime');
const {routeDiscoveryR12Request,inspectDiscoveryR12Wire}=source('products/discovery-r12-wire');
const {createDiscoveryR12Candidate,qualifyDiscoveryR12Candidate,discoveryR12ReceiptExpectation}=source('products/discovery-r12-receipt');
const {qualifyGenerationRouteProof}=source('research/generation-route');

const id=n=>`12120000-0000-4000-8000-${String(n).padStart(12,'0')}`,stamp=n=>new Date(n).toISOString();
const now=Date.parse('2026-10-12T01:00:00.000Z');
const clone=structuredClone;
const phases=['plan','search1','select1','strategy','review'];
function fixture(objective='Research viable print-on-demand products to sell on Etsy.') {
  const sourcePolicy={version:'r12.pod-source-policy.1',reviewId:id(9),method:'openrouter_exa_factual_snippets',purpose:'public_pod_market_research',excludedDomains:['etsy.com','etsy.me','etsystatic.com'],restrictionsRevision:'1'.repeat(64),termsReviewHash:'2'.repeat(64),independentReviewHash:'3'.repeat(64),recipients:{router:'openrouter.ai',search:'exa.ai',researcher:'azure/us',reviewer:'amazon-bedrock/us'},retention:{inference:'no_training_zdr',search:'query_retention_improvement_training_possible',application:'bounded_attributed_audit_evidence'},validFrom:stamp(now-60000),validUntil:stamp(now+3600000)};
  const scope={version:'r12.pod-research-goal.2',id:id(1),businessId:id(2),businessRevision:1,businessHash:'4'.repeat(64),goalId:id(3),goalRevision:1,goalHash:'5'.repeat(64),setupId:id(4),setupHash:'6'.repeat(64),authorityRootId:id(2),publicBrief:{objective,publicConstraints:[],fulfilmentContext:'printful_available'},sourcePolicy,sourcePolicyHash:hash(sourcePolicy),approvalHash:'7'.repeat(64),maximumMicrousd:10000000,createdAt:stamp(now-1000),expiresAt:stamp(now+1500000)};
  const plan={format:'r12.pod-research.2',discoveryScopeId:scope.id,discoveryScopeHash:hash(scope),businessId:scope.businessId,goalId:scope.goalId,goalRevision:1,goalHash:scope.goalHash,businessRevision:1,businessHash:scope.businessHash,policyId:id(5),policyHash:'8'.repeat(64),authorityRootId:scope.businessId,plannerWorkerDefinitionId:id(6),currency:'USD',maximumMicrounits:'10000000',deadline:scope.expiresAt,expiresAt:scope.expiresAt,maximumRepairs:0,maximumPivots:0,maximumChildren:5,maximumDispatches:25,requiredChecks:['review'],finishCondition:'all_required_outputs_verified',stopConditions:['no_permitted_work','deadline','repair_exhausted','owner_stopped'],steps:phases.map((key,i)=>({key,kind:key==='review'?'review':key==='search1'?'research':'work',objective:'Research the approved general POD goal.',reason:'Finite public-source research phase.',adapter:`r12.discovery.${scope.id}.${key}`,qualificationHash:'9'.repeat(64),installationId:id(7),packSnapshotHash:'a'.repeat(64),workflowDefinitionId:id(20+i),workerDefinitionId:key==='review'?id(8):id(6),role:key,operationKey:`research.r12.${scope.id}.${key}`,purpose:'Public POD product research',dependsOn:phases.slice(0,i),expectedArtifactType:`r12.discovery.${key}`,maximumMicrounits:'100000',expiresAt:scope.expiresAt,notBefore:scope.createdAt,measurement:null,maximumRepairs:0}))};
  const proposal={comparisonRationale:'Explore multiple POD product types through impersonal aggregate needs, production limitations and reasons ideas may fail.',query:'Compare aggregate consumer needs for made-to-order printed products and production limitations without assuming a product category.',sourceDomains:['census.gov','printful.com'],sourceChoiceRationale:'Compare primary aggregated public observations with official POD feasibility information.',hypotheses:[{productType:'Exploratory printed product',niche:'Unproven general niche',audience:'An aggregate buyer group',hypothesis:'A useful printed object may address an unmet practical need; no demand has yet been measured.',contraryExplanation:'The observed interest may not translate into purchases or a viable margin.'}]};
  return{scope,plan,proposal,pass:{ordinal:0,actionHash:'d'.repeat(64),history:null,historyHash:hash(null)}};
}
function ctx(f,key,dependencies) {const n=100+f.pass.ordinal*100+phases.indexOf(key)*10;return{planId:id(10),planHash:hash(f.plan),plan:f.plan,step:f.plan.steps.find(s=>s.key===key),attempt:{id:id(n),stepKey:key,status:'scheduled',attempt:f.pass.ordinal+1,adaptiveActionHash:f.pass.actionHash,adaptiveActionOrdinal:f.pass.ordinal,requestId:id(n+1),inputHash:'b'.repeat(64),dependencyPins:dependencies.map(d=>({stepKey:d.stepKey,attemptId:d.attemptId,resultHash:d.responseHash})),wireHash:null,responseHash:null},knowledge:{privateBusinessNotes:'PRIVATE_POD_CONTEXT_MUST_STAY_LOCAL',refinement:{secret:'OWNER_INJECTED_HISTORY_MUST_STAY_LOCAL'}}};}
function raw(f,context,dependencies,mode='dispatch'){return{version:'r12.pod-research-inputs.2',pass:clone(f.pass),businessId:f.scope.businessId,planId:context.planId,attemptId:context.attempt.id,knowledgeSnapshotHash:context.step.packSnapshotHash,hasUncertainCosts:false,amendment:f.scope,validationAt:stamp(now),inputMode:mode,committedMicrousd:dependencies.length*10,dependencies};}
const content='Synthetic technical fixture: these public observations do not measure Etsy sales, buyer willingness to pay, profitable fulfilment or commercial demand. They support only questions for further validation.';
function outputs(f){return{plan:f.proposal,search1:{annotations:[{type:'url_citation',url_citation:{url:'https://census.gov/contract-fixture',title:'Inert public-source fixture',content}}]},select1:{selections:[{sourceKey:'S1',quote:content.slice(0,150)}],limitations:['no_sales_metrics','no_current_prices']},strategy:{explorationSummary:'This inert report demonstrates evidence assessment without asserting real market observations or product demand.',candidates:[{productType:'Evidence-led printed object',niche:'A different unproven niche',audience:'An independently chosen aggregate audience',rationale:'The evidence changes the initial hypothesis but cannot establish actual willingness to buy a product.',support:[],counterevidence:['E1'],alternativeExplanation:'Generic interest and supplier availability are compatible with no profitable Etsy demand.',dimensions:POD_DIMENSIONS.map(dimension=>({dimension,verdict:'uncertain',rationale:'This synthetic source provides no candidate-specific measurement for the dimension.',evidence:[],missing:['Representative relevant observations remain unavailable.']}))}],recommendation:{outcome:'INSUFFICIENT_EVIDENCE',candidateIndex:null,rationale:'The actual retained source does not support a market recommendation beyond further evidence gathering.',nextTest:'Measure buyer intent and delivered costs before committing to any creative, listing or production work.'},limitations:['The source is a technical fixture, not evidence of real demand.'],etsyDemandVerified:false,commercialViabilityVerified:false},review:{outcome:'INSUFFICIENT_EVIDENCE',candidateIndex:null,rationale:'The independent review finds that the bounded source cannot establish candidate-specific buyer demand or margins.',checks:POD_REVIEW_CHECKS.map(check=>({check,verdict:'FAIL',rationale:'The available synthetic evidence does not satisfy a real commercial research requirement.',evidence:['E1']})),missingEvidence:['Actual buyer intent and fulfilment economics remain unmeasured.'],nextTest:'Obtain representative buyer evidence and current delivered costs before recommending a product test.',etsyDemandVerified:false,commercialViabilityVerified:false}};}
async function phase(f,key,dependencies,output){
  const context=ctx(f,key,dependencies),state=readDiscoveryR12PhaseInputs(context,raw(f,context,dependencies));
  const request=buildDiscoveryR12PhaseRequest(context,state),route={modelId:request.model.providerModelId,endpoint:key==='review'?'amazon-bedrock/us':'azure/us',priceLimit:{prompt:1,completion:1,request:0}};
  const routed=routeDiscoveryR12Request(request,key,route,false,false,true);await inspectDiscoveryR12Wire(routed,key,false,false,false,true);
  const binding={scopeId:f.scope.id,attemptId:context.attempt.id,requestId:context.attempt.requestId,phase:key,request:routed,maximumMicrousd:100000,dispatchedAt:stamp(now),receiptExpiresAt:stamp(now+1800000)};
  const candidate=createDiscoveryR12Candidate(binding,{providerModelId:key==='review'?'anthropic/claude-4.5-haiku-20251001':'openai/gpt-5.6-luna-20260709',providerRequestId:`gen-inert-pass-${f.pass.ordinal}-${key}`,usage:{reportedCostUsd:0.00001},metadata:{finishReason:'stop',...(key==='search1'?{searchRequests:1}:{})},output},stamp(now+1));
  const proof=qualifyGenerationRouteProof({data:{id:candidate.providerRequestId,provider_name:key==='review'?'Amazon Bedrock':'Azure',model:candidate.providerModelId}},discoveryR12ReceiptExpectation(candidate)),qualified=qualifyDiscoveryR12Candidate(candidate,binding,proof);
  const receipt=readDiscoveryR12PhaseInputs(context,raw(f,context,dependencies,'receipt')),projected=projectDiscoveryR12Phase(context,receipt,qualified,routed);
  const response={...projected,result:{...projected.result,candidateHash:hash(candidate),routeProofHash:proof.proofHash,outputHash:hash(candidate.output)},planHash:context.planHash,inputHash:context.attempt.inputHash};
  return{context,receipt,request:routed,current:{executingRelease:{version:'r12.executing-release.1',repository:'SSB100/agent-labs',environment:'production',commitSha:'c'.repeat(40),deploymentId:'dpl_inert_contract'},stepKey:key,attemptId:context.attempt.id,artifactId:id(2000+f.pass.ordinal*100+phases.indexOf(key)),responseHash:hash({response,sql:true}),responseCanonicalHash:hash(response),response,binding,candidate,proof}};
}

// This models the SQL-produced public history shape. It is not owner input or
// evidence that a real prior pass was accepted; SQL lineage is tested separately.
function refinementFixture(ordinal=1) {
  const f=fixture(),previous=outputs(f);
  const history={version:'r12.pod-refinement-history.2',previousPass:ordinal-1,
    previousReviewHash:hash(previous.review),reviewEvidenceNamespace:`pass-${ordinal-1}`,
    priorQueries:Array.from({length:ordinal},(_,pass)=>({pass,query:pass===0?f.proposal.query:`Earlier synthetic pass ${pass} compared different aggregate production constraints and missing buyer evidence.`,
      sourceDomains:pass===0?['census.gov','printful.com']:['ons.gov.uk','printful.com']})),
    review:previous.review,priorCandidates:previous.strategy.candidates.map(({productType,niche,audience})=>({productType,niche,audience}))};
  f.pass={ordinal,actionHash:hash({inertPass:ordinal,historyHash:hash(history)}),history,historyHash:hash(history)};
  f.proposal.query='Investigate independently measured delivered production failure rates and evidence that aggregate stated interest fails to become purchases.';
  return f;
}
test('new goal admits genuine planner-selected query, domains and exploratory candidates without fixed market/category',()=>{
  const f=fixture(),p=acceptPodResearchPlan(f.scope,f.proposal,now);
  assert.equal(p.query,f.proposal.query);assert.deepEqual(p.sourceDomains,f.proposal.sourceDomains);
  assert.notEqual(p.query,f.scope.publicBrief.objective);assert.equal(p.queryProvenance,'application_submitted_query');
  const changed=clone(f.proposal);changed.query='Compare independent aggregate motivations for functional customized print products and reasons buyers reject them.';changed.sourceDomains=['ons.gov.uk','printful.com'];
  assert.notEqual(acceptPodResearchPlan(f.scope,changed,now).planHash,p.planHash);
  assert.equal(f.scope.publicBrief.publicConstraints.length,0);assert.equal('markets' in f.scope,false);
});
test('policy, expiry, credentials, prohibited sources and post-return private paths fail closed',()=>{
  const f=fixture();assert.doesNotThrow(()=>validatePodResearchGoalScope(f.scope,now));
  for(const mutate of [s=>s.sourcePolicyHash='0'.repeat(64),s=>s.expiresAt=stamp(now),s=>s.publicBrief.objective='Find opportunities for alice@example.com private customer account.',s=>s.publicBrief.secret='never transmit this']){const s=clone(f.scope);mutate(s);assert.throws(()=>validatePodResearchGoalScope(s,now));}
  for(const domain of ['etsy.com','www.etsy.com','etsystatic.com','localhost','169.254.169.254','intranet.internal']){const p=clone(f.proposal);p.sourceDomains=[domain];assert.throws(()=>acceptPodResearchPlan(f.scope,p,now));}
  const p=acceptPodResearchPlan(f.scope,f.proposal,now);
  for(const url of ['https://census.gov/login', 'https://census.gov/%61ccount/orders', 'https://census.gov/account%2Forders', 'https://census.gov/login.php','https://census.gov/users/123','https://census.gov/data?session=secret','https://other.org/data','http://census.gov/data'])assert.throws(()=>validatePodResearchCitationUrl(url,p,f.scope.sourcePolicy));
});
test('real five-phase builders and serializer produce sourced insufficient result; no provider calls',async()=>{
  const f=fixture(),output=outputs(f),dependencies=[];let last;
  for(const key of phases){last=await phase(f,key,dependencies,output[key]);dependencies.push(last.current);if(key==='plan'){const data=JSON.parse(last.request.messages[1].content);assert.deepEqual(data.publicBrief,f.scope.publicBrief);assert.equal(JSON.stringify(data).includes(f.scope.businessId),false);assert.match(last.request.messages[0].content,/Discover product types/);}if(key==='search1')assert.equal(last.request.query,f.proposal.query);}
  const completed={...last.context,attempt:{...last.context.attempt,status:"completed",responseHash:last.current.responseHash}};
  const result=reconstructPodResearchResult(completed,last.receipt,last.current);
  for(const mutate of [c=>c.proof.proofHash="0".repeat(64),c=>c.candidate.scopeId=id(999),c=>c.candidate.providerRequestId="gen-other",c=>c.candidate.reportedMicrousd=null,c=>c.response.outcome="rejected"]){const current=clone(last.current);mutate(current);assert.throws(()=>reconstructPodResearchResult(completed,last.receipt,current));}
  assert.equal(result.review.outcome,'INSUFFICIENT_EVIDENCE');assert.equal(result.phaseReceipts.length,5);assert.equal(result.executionAuthorized,false);assert.equal(result.evidence[0].quote,output.select1.selections[0].quote);assert.equal(result.assessment.candidates[0].productType,'Evidence-led printed object');
});
test('accepted dependency substitution is rejected before another request',async()=>{
  const f=fixture(),first=await phase(f,'plan',[],outputs(f).plan),dependencies=[first.current];
  for(const mutate of [d=>d.candidate.output.query='A substituted question outside the accepted immutable dependency.',d=>d.response.result.researchPlanHash='0'.repeat(64),d=>d.proof.proofHash='0'.repeat(64)]){const deps=clone(dependencies);mutate(deps[0]);const context=ctx(f,'search1',deps);assert.throws(()=>buildDiscoveryR12PhaseRequest(context,readDiscoveryR12PhaseInputs(context,raw(f,context,deps))));}
});

test('POD .2 admits the USD 10 shared run with five passes and rejects widened bounds or old formats',()=>{
  const f=fixture(),context=ctx(f,'plan',[]);
  assert.equal(f.scope.maximumMicrousd,10000000);
  assert.equal(POD_GOAL_BOUNDS.maximumPasses,5);assert.equal(POD_GOAL_BOUNDS.maximumCalls,25);assert.equal(POD_GOAL_BOUNDS.maximumCollections,5);
  assert.equal(context.plan.maximumChildren,5);assert.equal(context.plan.maximumDispatches,25);
  assert.doesNotThrow(()=>readDiscoveryR12PhaseInputs(context,raw(f,context,[])));
  for(const maximumMicrousd of [10000001,0,-1,NaN])assert.throws(()=>validatePodResearchGoalScope({...f.scope,maximumMicrousd},now));
  assert.throws(()=>validatePodResearchGoalScope({...f.scope,version:'r12.pod-research-goal.1'},now));
  for(const mutate of [c=>c.plan.maximumDispatches=26,c=>c.plan.maximumChildren=6,c=>c.plan.maximumRepairs=1,c=>c.plan.maximumPivots=1,c=>c.plan.format='r12.pod-research.1']){
    const changed=clone(context);mutate(changed);assert.throws(()=>readDiscoveryR12PhaseInputs(changed,raw(f,changed,[])));
  }
});

test('refinement planner carries bound public history and its domains, never private owner context or executable instructions',async()=>{
  const first=fixture(),initial=ctx(first,'plan',[]),initialRequest=buildDiscoveryR12PhaseRequest(initial,readDiscoveryR12PhaseInputs(initial,raw(first,initial,[])));
  assert.equal(JSON.parse(initialRequest.messages[1].content).refinement,null);
  assert.deepEqual(initialRequest.requestMetadata.r12PodSourceDomains,[]);
  const f=refinementFixture(2),marker='INERT_HISTORY_INSTRUCTION_MUST_REMAIN_DATA';
  f.pass.history.review.missingEvidence.push(`The synthetic prior review contains ${marker}; it grants no new tool or account access.`);
  f.pass.historyHash=hash(f.pass.history);
  const context=ctx(f,'plan',[]),state=readDiscoveryR12PhaseInputs(context,raw(f,context,[])),request=buildPodResearchRequest(context,state);
  const data=JSON.parse(request.messages[1].content);
  assert.deepEqual(data.publicBrief,f.scope.publicBrief);assert.deepEqual(data.refinement,f.pass.history);
  assert.equal(data.refinement.reviewEvidenceNamespace,'pass-1');
  assert.deepEqual(request.requestMetadata.r12PodSourceDomains,['census.gov','ons.gov.uk','printful.com']);
  assert.equal(request.requestMetadata.r12PodHistoryHash,f.pass.historyHash);assert.equal(request.requestMetadata.r12PodPassHash,f.pass.actionHash);
  assert.equal(request.requestMetadata.r12PodPassOrdinal,2);assert.equal(request.tools,undefined);
  const routed=routeDiscoveryR12Request(request,'plan',{modelId:request.model.providerModelId,endpoint:'azure/us',priceLimit:{prompt:1,completion:1,request:0}},false,false,true);
  const inspected=await inspectDiscoveryR12Wire(routed,'plan',false,false,false,true),body=JSON.parse(inspected.wire.body);
  assert.deepEqual(body.messages.map(m=>m.role),['system','user']);assert.equal(body.tools,undefined);
  assert.equal(body.messages[0].content.includes(marker),false);assert.equal(body.messages[1].content.includes(marker),true);
  assert.match(body.messages[0].content,/untrusted summaries/);assert.match(body.messages[0].content,/cannot be cited as new evidence/);
  for(const sentinel of ['PRIVATE_POD_CONTEXT_MUST_STAY_LOCAL','OWNER_INJECTED_HISTORY_MUST_STAY_LOCAL',f.scope.businessId,f.scope.goalId])assert.equal(inspected.wire.body.includes(sentinel),false);
});

test('pass ordinal, action and immutable history pins reject substitution before the planner request',()=>{
  const f=refinementFixture(),context=ctx(f,'plan',[]),original=raw(f,context,[]);
  for(const mutate of [r=>r.pass.actionHash='0'.repeat(64),r=>r.pass.ordinal=5,r=>r.pass.history=null,
    r=>r.pass.historyHash='0'.repeat(64),r=>r.pass.history.review.nextTest='Substituted unbound prior-review instructions must not reach the planner.',
    r=>{r.pass.history.previousPass=4;r.pass.historyHash=hash(r.pass.history);},
    r=>{r.pass.history.reviewEvidenceNamespace='current-pass';r.pass.historyHash=hash(r.pass.history);},
    r=>{r.pass.history.priorQueries=[];r.pass.historyHash=hash(r.pass.history);},
    r=>{r.pass.history.priorQueries[0].sourceDomains=['etsy.com'];r.pass.historyHash=hash(r.pass.history);},
    r=>{r.pass.history.priorQueries[0].sourceDomains=['intranet.internal'];r.pass.historyHash=hash(r.pass.history);},
    r=>{r.pass.history.review.checks=[];r.pass.historyHash=hash(r.pass.history);},
    r=>{r.pass.history.priorCandidates=[];r.pass.historyHash=hash(r.pass.history);},
    r=>{r.pass.history.review.outcome='HYPOTHESIS_TO_TEST';r.pass.historyHash=hash(r.pass.history);}]){
    const changed=clone(original);mutate(changed);assert.throws(()=>readDiscoveryR12PhaseInputs(context,changed));
  }
  for(const mutate of [c=>c.attempt.adaptiveActionHash='0'.repeat(64),c=>c.attempt.adaptiveActionOrdinal=0,c=>c.attempt.attempt=1]){
    const changed=clone(context);mutate(changed);assert.throws(()=>readDiscoveryR12PhaseInputs(changed,original));
  }
  const first=fixture(),initial=ctx(first,'plan',[]),injected=raw(first,initial,[]);injected.pass.history=clone(f.pass.history);injected.pass.historyHash=hash(injected.pass.history);
  assert.throws(()=>readDiscoveryR12PhaseInputs(initial,injected));
});

test('a refinement pass rejects normalized replay of any prior query and accepts a materially different query',async()=>{
  const f=refinementFixture(2);
  for(const previous of f.pass.history.priorQueries){
    for(const query of [previous.query,previous.query.toUpperCase().replaceAll(' ','   ')]){
      await assert.rejects(phase(f,'plan',[],{...f.proposal,query}),/r12_pod_unchanged_query/);
    }
  }
  const accepted=await phase(f,'plan',[],f.proposal),dependencies=[accepted.current],context=ctx(f,'search1',dependencies);
  const request=buildDiscoveryR12PhaseRequest(context,readDiscoveryR12PhaseInputs(context,raw(f,context,dependencies)));
  assert.equal(request.query,f.proposal.query);assert.deepEqual(request.allowedDomains,f.proposal.sourceDomains);
  assert.equal('refinement' in request,false,'Prior review text is not sent to the search backend');
});

test('bounded four-prior-pass review history fits the separately priced 24 KiB planner wire and oversized history fails closed',async()=>{
  const f=refinementFixture(4),history=f.pass.history;
  history.priorQueries.forEach((q,i)=>{q.query=(`Synthetic earlier public investigation ${i} of aggregate needs and production constraints. `).repeat(12).slice(0,800);});
  history.review.rationale='Inert prior assessment context without any private source or verified demand. '.repeat(10).slice(0,600);
  history.review.checks.forEach(c=>{c.rationale='The bounded synthetic observations cannot establish the missing measurements. '.repeat(4).slice(0,240);});
  history.review.missingEvidence=Array.from({length:8},(_,i)=>(`Missing independent aggregate measurement ${i}; no commercial claim is established. `).repeat(4).slice(0,220));
  history.review.nextTest='Obtain independent aggregate buyer evidence and measured delivered costs before any product commitment. '.repeat(5).slice(0,400);
  history.priorCandidates=Array.from({length:3},(_,i)=>({productType:(`Synthetic candidate ${i} `).repeat(8).slice(0,120),niche:'An unproven public-interest segment '.repeat(6).slice(0,160),audience:'An aggregate adult research group '.repeat(6).slice(0,160)}));
  f.pass.historyHash=hash(history);f.pass.actionHash=hash({inertPass:4,historyHash:f.pass.historyHash});
  const context=ctx(f,'plan',[]),request=buildDiscoveryR12PhaseRequest(context,readDiscoveryR12PhaseInputs(context,raw(f,context,[])));
  const route={modelId:request.model.providerModelId,endpoint:'azure/us',priceLimit:{prompt:1,completion:1,request:0}};
  const routed=routeDiscoveryR12Request(request,'plan',route,false,false,true),inspected=await inspectDiscoveryR12Wire(routed,'plan',false,false,false,true);
  assert.ok(inspected.wireBytes>8192,'Regression input exceeds the original planner request limit');
  assert.ok(inspected.wireBytes<=24576);assert.equal(JSON.parse(inspected.wire.body).tools,undefined);
  const oversized=clone(routed);oversized.messages[1].content+='X'.repeat(24576);
  await assert.rejects(inspectDiscoveryR12Wire(oversized,'plan',false,false,false,true));
});

test('later-pass results remain backed only by current-pass evidence and retain prior review lineage',async()=>{
  const f=refinementFixture(),output=outputs(f),dependencies=[];let last;
  f.pass.history.review.missingEvidence.push('PRIOR_REVIEW_ONLY_SENTINEL remains historical missing evidence, never a new source citation.');
  f.pass.historyHash=hash(f.pass.history);
  for(const key of phases){last=await phase(f,key,dependencies,output[key]);dependencies.push(last.current);
    if(key==='strategy'||key==='review')assert.equal(JSON.stringify(last.request.messages).includes('PRIOR_REVIEW_ONLY_SENTINEL'),false);
  }
  const completed={...last.context,attempt:{...last.context.attempt,status:'completed',responseHash:last.current.responseHash}};
  const result=reconstructPodResearchResult(completed,last.receipt,last.current);
  assert.equal(result.version,'r12.pod-research-result.2');assert.equal(result.passNumber,2);assert.equal(result.maximumPasses,5);
  assert.equal(result.priorReviewHash,f.pass.history.previousReviewHash);assert.equal(result.phaseReceipts.length,5);
  assert.equal(result.evidence.length,1);assert.equal(result.evidence[0].quote,output.select1.selections[0].quote);
  const beforeStrategy=dependencies.slice(0,3),injected=clone(output.strategy);injected.candidates[0].support=['pass-0:E1'];
  await assert.rejects(phase(f,'strategy',beforeStrategy,injected),/did not match its JSON schema|r12_pod_assessment_unverified/);
});
