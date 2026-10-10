import test from 'node:test';import assert from 'node:assert/strict';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {researchRendererFixture,researchPolicy,researchReadiness} from './helpers/etsy-insights-research-renderer-fixture.mjs';
import {open,search,NOW,id,H,ROOT} from './helpers/etsy-insights-playwright-fixture.mjs';
import {landingFixture,hash} from './helpers/etsy-insights-landing-fixture.mjs';
const load=name=>import(pathToFileURL(resolve(process.env.R12_INSIGHTS_CORE_DIR||'.core-tests','browser',name+'.js')).href);
const {validateEtsyInsightsResearchRendererPolicy:validate,classifyEtsyInsightsResearchRendererRequest:classify}=await load('etsy-insights-renderer-research');
const {createEtsyInsightsVerificationPort}=await load('etsy-insights-playwright');

test('proof-bound research performs only its counted visible query and independently captures complete result facts',async()=>{
 const f=researchRendererFixture(),s=await open(f),page=await search(f,s),capture=await s.captureSameEpoch(page.documentEpoch,f.stop.signal);
 assert.equal(f.events.filter(x=>x==='create').length,1);assert.equal(f.events.filter(x=>x==='submit').length,1);assert.equal(capture.facts.find(x=>x.kind==='query').quote,f.s.query);assert.equal(capture.facts.find(x=>x.kind==='reporting_window').quote,'Last 30 days');
 assert.ok(f.rendererRequests.some(r=>r.disposition==='deny_candidate_ancillary'));assert.ok(f.rendererRequests.some(r=>r.requestKind==='same_origin'&&r.url.includes('/search?query=')));
 for(const r of f.rendererRequests){assert.equal(r.sourceAttemptId,f.s.sourceAttemptId);assert.equal(r.operationId,f.s.operationId);assert.equal(r.policyHash,hash(researchPolicy));}
 await assert.rejects(search(f,s));assert.equal(f.events.filter(x=>x==='submit').length,1);assert.equal((await s.close(s.sessionId)).observersDisposed,true);
});
for(const [label,change] of Object.entries({wrongVerification:{verificationHash:H(100)},wrongContext:{verifiedContextHash:H(101)},wrongPolicy:{candidatePolicyHash:H(102)},wrongProject:{providerProjectId:id(104)},wrongProfile:{profileBindingId:id(105)},wrongRevision:{profileBindingRevision:id(106)},wrongBinding:{accountBindingHash:H(107)},missingPriorOperation:{verificationOperationId:null},currentOperation:{verificationOperationId:id(90)},expired:{expiresAt:new Date(NOW-1).toISOString()},overScope:{expiresAt:new Date(NOW+60001).toISOString()},missingVersion:{version:null},extraKey:{untrusted:true}}))test(`${label} readiness cannot create research session`,async()=>{
 const f=researchRendererFixture({readiness:change});await assert.rejects(f.port.createSession(f.s,f.stop.signal));assert.equal(f.events.includes('create'),false);
});
for(const [label,qualification] of Object.entries({oldQualification:{version:'r12.etsy-insights-renderer-qualification.2'},missingReadiness:{readiness:undefined},oldPolicy:{policy:{version:'etsy.insights-renderer-policy.1'}},changedQueryHash:{requestHash:H(200)},changedPurpose:{policy:{...researchPolicy,purpose:'etsy_insights_verify_only'}}}))test(`${label} cannot silently inherit research purpose`,async()=>{
 const f=researchRendererFixture({qualification});await assert.rejects(f.port.createSession(f.s,f.stop.signal));assert.equal(f.events.includes('create'),false);
});
for(const [label,options] of Object.entries({wrongShop:{shop:'Other Synthetic Shop'},changedAfterFill:{changeShopAfterFill:true},missingLanding:{missingInput:true},wrongResultHeading:{headingQuery:'other'},wrongResultSummary:{summaryQuery:'other'},loading:{loading:true},unknownResultAsset:{resultRequest:{url:'https://unknown.example/results.js'}},materialResultXhr:{resultRequest:{url:'https://bat.bing.com/bat.js',resourceType:'XHR'}},changedCapture:{duringCapture:true}}))test(`prior verification never hides ${label}`,async()=>{
 const f=researchRendererFixture(options),s=await open(f);await assert.rejects(async()=>{const p=await search(f,s);await s.captureSameEpoch(p.documentEpoch,f.stop.signal);});assert.ok(f.events.filter(x=>x==='submit').length<=1);await s.close(s.sessionId);
});
test('readiness expiry and Stop fence later submit; cleanup remains available',async()=>{
 for(const expired of [false,true]){const f=researchRendererFixture(),s=await open(f);if(expired)f.setTime(NOW+60000);else f.stop.abort();await assert.rejects(search(f,s));assert.equal(f.events.includes('submit'),false);await s.close(s.sessionId);}
});
test('same verified resource policy cannot grow allowances or change candidate pins',()=>{
 for(const p of [{...researchPolicy,maximumRequests:researchPolicy.maximumRequests+1},{...researchPolicy,candidatePolicyHash:H(100)},{...researchPolicy,candidatePolicy:{...researchPolicy.candidatePolicy,allowedImages:[researchPolicy.candidatePolicy.blockedCandidates[0]]}}])assert.throws(()=>validate(p));
 assert.throws(()=>classify(researchPolicy,{url:ROOT+'/search?query=other',method:'GET',resourceType:'document',navigation:true},'approved'));
 assert.throws(()=>classify(researchPolicy,{url:ROOT,method:'POST',resourceType:'document',navigation:true},'approved'));
});
test('research qualification cannot be used to bypass separate no-query verification authority',async()=>{
 const f=landingFixture({},true),original=f.verificationInput.qualifyRenderer;f.verificationInput.qualifyRenderer=async scope=>{const q=await original(scope),{qualificationHash:ignored,...old}=q;void ignored;const body={...old,version:'r12.etsy-insights-renderer-qualification.3',readiness:researchReadiness(f.s)};return{...body,qualificationHash:hash(body)};};
 const r=await createEtsyInsightsVerificationPort(f.verificationInput).verify(f.authority,f.stop.signal);assert.equal(r.verification,null);assert.equal(f.events.includes('create'),false);
});
