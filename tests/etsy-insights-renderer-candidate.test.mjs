import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {landingFixture,hash} from './helpers/etsy-insights-landing-fixture.mjs';
const load=name=>import(pathToFileURL(resolve(process.env.R12_INSIGHTS_CORE_DIR||'.core-tests','browser',name+'.js')).href);
const {ETSY_INSIGHTS_VERIFICATION_CANDIDATE_POLICY:P,validateEtsyInsightsVerificationCandidate:validate,etsyInsightsVerificationCandidateHash:policyHash,classifyEtsyInsightsVerificationCandidateRequest:classify}=await load('etsy-insights-renderer-candidate');
const {ETSY_INSIGHTS_CANDIDATE_MANIFEST:M,ETSY_INSIGHTS_CANDIDATE_MANIFEST_HASH:MH}=await load('etsy-insights-renderer-candidate-evidence');
const {createEtsyInsightsVerificationPort,createEtsyInsightsPlaywrightPort}=await load('etsy-insights-playwright');
const image='https://i.etsystatic.com/site-assets/images/seller-tools/mission-control/channel-icons/pattern-channel-inactive.svg';
const script='https://bat.bing.com/bat.js';
const queriedImage='https://i.etsystatic.com/site-assets/images/avatars/default_avatar.png?inert_value=never_retained';
const root='https://www.etsy.com/your/shops/me/marketplace-insights';
const request=(url,resourceType='script',changes={})=>({url,method:'GET',resourceType,navigation:false,...changes});
function candidateFixture(o={}){
 const f=landingFixture(o,true),input=f.verificationInput,old=input.qualifyRenderer,decisions=[];
 input.qualifyRenderer=async scope=>{const q=await old(scope),{qualificationHash:ignored,...oldBody}=q;void ignored;const body={...oldBody,policy:P,policyHash:policyHash(P),...o.qualification};return{...body,qualificationHash:hash(body)};};
 input.admitRenderer=async r=>{assert.equal(r.version,'etsy.insights-verification-renderer-request.3');assert.ok(Object.isFrozen(r));const{decisionHash,...body}=r;assert.equal(decisionHash,hash(body));decisions.push(structuredClone(r));if(o.deniedAck)throw Error('inert SQL denied');};
 const go=f.page.goto.bind(f.page);
 f.page.goto=async url=>{await f.request(url);for(const r of o.requests??[request(image,'image'),request(script),request(queriedImage,'image')]){const{url,method,resourceType,navigation,...rest}=r;void navigation;await f.request(url,{resourceType:resourceType[0].toUpperCase()+resourceType.slice(1),request:{url,method},...rest});}await go(url);};
 f.verifier=createEtsyInsightsVerificationPort(input);return{...f,decisions};
}

test('candidate manifest exposes only exact path hashes and honest observation limits',()=>{
 assert.equal(M.networkTrace,false);assert.equal(M.necessity,'unestablished');assert.equal(M.purpose,'etsy_insights_verify_only');assert.equal(M.allowedImages.length,4);assert.equal(M.blockedCandidates.length,26);assert.equal(hash(M),MH);
 for(const row of [...M.allowedImages,...M.blockedCandidates]){assert.deepEqual(Object.keys(row).sort(),['hasQuery','method','origin','pathnameHash','resourceType']);assert.match(row.pathnameHash,/^[a-f0-9]{64}$/);assert.equal(new URL(row.origin).origin,row.origin);}
 assert.equal(JSON.stringify(M).includes(new URL(image).pathname),false);assert.equal(JSON.stringify(M).includes(new URL(script).pathname),false);
});
test('only exact observed no-query image GET may pass; scripts and queried images stay blocked',()=>{
 assert.equal(classify(P,request(image,'image')).disposition,'allow');
 for(const r of [request(script),request(queriedImage,'image'),request('https://www.googletagmanager.com/gtm.js?inert_value=secret')]){
  const d=classify(P,r);assert.equal(d.disposition,'deny_candidate_ancillary');assert.equal(d.metadata.requestKind,'external');assert.equal(d.metadata.url,undefined);assert.equal(d.metadata.pathnameHash,hash(new URL(r.url).pathname));assert.equal(JSON.stringify(d).includes('inert_value'),false);
 }
});
for(const [label,r] of Object.entries({post:request(script,'script',{method:'POST'}),xhr:request(script,'xhr'),fetch:request(script,'fetch'),navigation:request(script,'document',{navigation:true}),unknownPath:request(script+'/other'),unknownOrigin:request('https://unknown.example/bat.js'),imageQuery:request(image+'?q=unapproved','image'),removedObservedQuery:request(queriedImage.split('?')[0],'image'),scriptAddedQuery:request(script+'?q=anything'),credentials:request('https://x:y@bat.bing.com/bat.js'),port:request('https://bat.bing.com:444/bat.js'),fragment:request(script+'#fragment'),login:request('https://www.etsy.com/signin','document',{navigation:true}),query:request(root+'/search?query=unapproved','document',{navigation:true}),privateApi:request('https://www.etsy.com/your/orders','xhr')}))test(`candidate boundary refuses ${label}`,()=>assert.throws(()=>classify(P,r)));
for(const change of [{purpose:'etsy_insights_read_only'},{extraction:'visible_aggregate_dom_only'},{provenanceHash:'0'.repeat(64)},{allowedImages:[P.blockedCandidates[0]]},{blockedCandidates:[{...P.blockedCandidates[0],pathnameHash:'0'.repeat(64)}]},{allowedImages:[P.allowedImages[0],P.allowedImages[0]]},{staticOrigins:['https://i.etsystatic.com']}])test('candidate validation refuses broadened or unobserved policy',()=>assert.throws(()=>validate({...P,...change})));
test('actual verification port records hash-only candidate blocks without dispatch and requires real visible readiness',async()=>{
 const f=candidateFixture(),r=await f.verifier.verify(f.authority,f.stop.signal);assert.equal(r.status,'verified');assert.equal(r.release.observersDisposed,true);assert.equal(f.events.includes('fill'),false);assert.equal(f.events.includes('submit'),false);
 assert.equal(f.decisions.length,4);assert.equal(f.decisions[0].requestKind,'same_origin');assert.equal(f.decisions[0].url,root);assert.equal(f.decisions.filter(d=>d.disposition==='deny_candidate_ancillary').length,2);
 assert.equal(f.cdpCommands.filter(c=>c.name==='Fetch.failRequest').length,2);assert.equal(f.cdpCommands.filter(c=>c.name==='Fetch.continueRequest').length,2);
 const external=f.decisions.filter(d=>d.requestKind==='external');assert.ok(external.every(d=>!('url'in d)));assert.equal(JSON.stringify(external).includes('never_retained'),false);assert.equal(JSON.stringify(external).includes('/site-assets/'),false);
});
for(const [label,o] of Object.entries({wrongShop:{shop:'Other Synthetic Shop'},missingInput:{missingInput:true},ambiguousInput:{duplicateInput:true},wrongHeading:{verificationHeading:'Other page'},labelChanged:{labelText:'Unverified label'},ownerDialog:{overlay:true},unknownRequest:{requests:[request(script),request('https://unknown.example/asset.js')]},materialXhr:{requests:[request(script,'xhr')]},redirect:{requests:[{...request(script),redirectedRequestId:'inert-previous'}]},denialUnrecorded:{deniedAck:true},blockAckFailed:{cdpFailCommand:'Fetch.failRequest'},releaseUnknown:{releaseFail:true},disposalIncomplete:{drainFail:true}}))test(`known candidate denial cannot mask ${label}`,async()=>{
 const f=candidateFixture(o),r=await f.verifier.verify(f.authority,f.stop.signal);assert.equal(r.status,'paused');assert.equal(r.verification,null);assert.equal(f.events.includes('submit'),false);assert.ok(f.events.includes('release'));
});
test('candidate .3 requires explicit landing .2 qualification before provider creation',async()=>{
 const f=candidateFixture({qualification:{version:'r12.etsy-insights-renderer-qualification.1'}}),r=await f.verifier.verify(f.authority,f.stop.signal);assert.equal(r.verification,null);assert.equal(f.events.includes('create'),false);
});
test('verification candidate never enables paid source acquisition automatically',async()=>{
 const f=landingFixture(),old=f.input.qualifyRenderer;f.input.qualifyRenderer=async scope=>{const q=await old(scope),{qualificationHash:ignored,...body}=q;void ignored;const next={...body,policy:P,policyHash:policyHash(P)};return{...next,qualificationHash:hash(next)};};
 const port=createEtsyInsightsPlaywrightPort(f.input);await assert.rejects(port.createSession(f.s,f.stop.signal));assert.equal(f.events.includes('create'),false);
});
