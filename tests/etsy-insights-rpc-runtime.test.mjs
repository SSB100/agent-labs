import {inertSteelCreateConfigurationGuard,inertSteelCreateConfigurationPermit} from './helpers/etsy-steel-create-config-fixture.mjs';
import {researchRendererFixture} from './helpers/etsy-insights-research-renderer-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
import {fixture as browserFixture,NOW,id,H,ROOT} from './helpers/etsy-insights-playwright-fixture.mjs';
const load=name=>import(pathToFileURL(resolve(process.env.R12_INSIGHTS_CORE_DIR||'.core-tests','browser',`${name}.js`)).href);
const {createEtsyInsightsRpcRuntime}=await load('etsy-insights-rpc-runtime');
const {insightsHash:hash}=await load('etsy-insights-policy');
const {ETSY_INSIGHTS_DEFAULT_RENDERER_POLICY:POLICY,etsyInsightsRendererPolicyHash}=await load('etsy-insights-renderer-policy');
const {ETSY_RENDERER_DOM_REFERENCE_MANIFEST:REFS,ETSY_RENDERER_DOM_REFERENCE_HASH:PROVENANCE}=await load('etsy-insights-renderer-evidence');
const TELEMETRY=REFS.optionalTelemetry.find(r=>r.origin==='https://bat.bing.com'&&r.path==='/bat.js');
const POLICY2={...POLICY,version:'etsy.insights-renderer-policy.2',staticAssets:[],optionalTelemetry:[TELEMETRY],provenanceHash:PROVENANCE};

// Actual runtime + confined Playwright port + provider parsing. All I/O endpoints
// are injected inert doubles, including the explicit create-configuration admission
// below. This leaf is not a private SQL attestation or current-chain 21300 proof.
// These tests are no substitute for migrated-SQL or live UI proof.
function fixture(o={}){
 const browserOptions={...o.browser},f=o.research?researchRendererFixture(browserOptions):browserFixture(browserOptions),s=f.s,calls=[],evidence=[],receipts=[],uploads=[],transports=[],rendererRequests=[];
 let admitted=0,bound=false,sourceReceipt=null,reconciled=false,gets=0;
 if(!o.research)browserOptions.beforeNavigate=async url=>{await f.request(url);if(o.telemetry)await f.request(TELEMETRY.origin+TELEMETRY.path+'?inert_private_value=redacted',{resourceType:'Script',...o.telemetryRequest});};
 if(!o.research)browserOptions.beforeSubmit=url=>f.request(url);
 f.page.screenshot=async({clip})=>{f.events.push('screenshot');assert.ok(clip.x>=300);return sharp({create:{width:clip.width,height:clip.height,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png({compressionLevel:9,palette:true}).toBuffer();};
 const q={providerProjectId:s.providerProjectId,providerAccountHash:H(60),routeHash:H(61),tariffHash:H(62),qualificationHash:H(63),maximumSessionMs:s.limits.maximumSessionMs,maximumSessionMicrounits:s.maximumBrowserMicrounits,revoked:false,
  usageBound:{version:'r12.steel-usage-bound.1',maximumProxyBytes:0,tariffCoversSessionAndProfileLifecycle:true,captchaDisabled:true,extraServicesDisabled:true},...o.route};
 async function sourceRpc(operation,payload){
  calls.push(`source:${operation}`);if(o.sourceDenied===operation)throw Error('inert denied');
  if(operation!=='source_admit')assert.equal(payload.attemptId,s.sourceAttemptId);
  if(operation==='source_admit'){
   const r=payload.request;assert.equal(r.sequence,admitted++);assert.equal(r.operationId,s.operationId);assert.equal(r.requestHash,hash(s));assert.equal(r.executionQuoteHash,s.executionQuoteHash);assert.equal(r.executionQuoteProofHash,s.executionQuoteProofHash);
   if(r.sequence>0)assert.equal(bound,true,'session ledger binding precedes first action');
   if(o.stopAt===r.operation){f.stop.abort();throw Error('stopped');}
   return{version:'r12.etsy-insights-source-permit.1',admissionHash:hash(r),reservationId:id(80),reservationHash:H(80),reservedBrowserMicrounits:s.maximumBrowserMicrounits,expiresAt:new Date(NOW+5000).toISOString(),...o.permit};
  }
  if(operation==='resolve_source')return{sourceAttemptId:s.sourceAttemptId,requestHash:hash(s),sessionId:s.operationId,profileId:id(91),providerProjectId:s.providerProjectId,accountBindingHash:s.accountBinding.bindingHash,profileBindingId:s.accountBinding.profileBindingId,profileBindingRevision:s.accountBinding.profileBindingRevision,...o.resolved};
  if(operation==='qualify_renderer'){
   if(o.research)return{...await f.input.qualifyRenderer(s),...o.rendererQualification};
   const policy=o.rendererPolicy??POLICY,body={version:'r12.etsy-insights-renderer-qualification.1',requestHash:hash(s),expiresAt:s.expiresAt,maximumRequests:policy.maximumRequests,policy,policyHash:etsyInsightsRendererPolicyHash(policy)};
   return{...body,qualificationHash:hash(body),...o.rendererQualification};
  }
  if(operation==='admit_renderer'){const r=payload.request;assert.ok(Object.isFrozen(r));assert.equal(r.requestHash,hash(s));rendererRequests.push(structuredClone(r));
   if(r.version==='r12.etsy-insights-renderer-request.3')return{accepted:true,allowed:r.disposition==='allow',sequence:r.sequence,disposition:r.disposition,decisionHash:r.decisionHash,qualificationHash:r.qualificationHash,policyHash:r.policyHash,provenanceHash:r.provenanceHash,...(r.disposition==='deny_candidate_ancillary'?o.denialAck:{}),...o.rendererAck};
   if(r.version==='r12.etsy-insights-renderer-request.2')return{accepted:true,allowed:r.disposition==='allow',sequence:r.sequence,disposition:r.disposition,...(r.disposition==='deny_optional_telemetry'?o.denialAck:{}),...o.rendererAck};
   return{allowed:!o.rendererDenied,sequence:r.sequence,...o.rendererAck};}
  if(operation==='source_transport'){transports.push(payload.request);if(payload.request.operation==='browser.etsy.insights.create')assert.equal(admitted,1);return{allowed:true,operationId:s.operationId,...o.transport};}
  if(operation==='source_screenshot'){
   const {capture,bytesBase64}=payload,bytes=Buffer.from(bytesBase64,'base64');assert.equal(admitted,8);assert.equal(capture.screenshotHash,createHash('sha256').update(bytes).digest('hex'));
   assert.equal(bytes.readUInt32BE(16),capture.viewport.width);assert.equal(bytes.readUInt32BE(20),capture.viewport.height);uploads.push(payload);
   const body={version:'r12.etsy-insights-screenshot-storage.1',captureHash:capture.captureHash,screenshotHash:capture.screenshotHash,byteLength:bytes.length,storageObjectId:id(81)};
   return{...body,storageReceiptHash:hash(body),...o.storage};
  }
  if(operation==='cleanup_complete'){assert.ok(evidence.some(e=>e.kind==='release'&&hash(e.content)===payload.releaseEvidenceHash));return{releaseVerified:true,billingStillRequiresLedger:true,...o.cleanupAck};}
  if(operation==='source_receipt'){
   sourceReceipt=payload.receipt;if(sourceReceipt.status==='completed'){assert.equal(admitted,9);assert.equal(uploads.length,1);assert.ok(evidence.some(e=>e.kind==='release'));}
   if(o.lostReceiptAck)throw Error('inert response lost after commit');
   return{receiptHash:sourceReceipt.receiptHash,persisted:true};
  }
  if(operation==='source_finish'){
   assert.ok(sourceReceipt&&reconciled,'no completion without persisted receipt and qualified accounting');
   return{recorded:true,accepted:sourceReceipt.status==='completed',receiptHash:sourceReceipt.receiptHash,sourceProof:{receiptHash:sourceReceipt.receiptHash},state:{paused:sourceReceipt.status!=='completed'},...o.finishAck};
  }
  throw Error(`Unhandled source ${operation}`);
 }
 async function ledgerRpc(operation,payload){
  calls.push(`ledger:${operation}`);if(o.ledgerDenied===operation)throw Error('inert denied');
  if(operation==='read')return{operationId:s.operationId,requestHash:hash(s),scopeHash:s.scopeHash,operationMaximumMicrounits:s.maximumBrowserMicrounits,qualification:q,...o.ledgerRead};
  if(operation==='bind_session'){assert.deepEqual(payload,{sessionId:s.operationId,providerProjectId:s.providerProjectId,providerAccountHash:q.providerAccountHash});bound=true;return{operationId:s.operationId,usageIdentityHash:H(70)};}
  if(operation==='receipt'){receipts.push(payload);return{operationId:s.operationId,receiptHash:payload.receiptHash,persisted:true};}
  if(operation==='evidence'){
   const prior=evidence.find(e=>e.providerRecordId===payload.providerRecordId);if(prior)assert.deepEqual(payload,prior,'duplicate provider evidence must be byte-equivalent');evidence.push(structuredClone(payload));return{evidenceHash:hash(payload.content)};
  }
  if(operation==='reconcile'){
   const usage=evidence.find(e=>e.kind==='usage_bound'&&hash(e.content)===payload.usageProofHash);assert.ok(usage);assert.equal(payload.billingProofHash,null);
   reconciled=usage.content.withinQualifiedLimits&&!o.rejectAccounting;return{accepted:reconciled};
  }
  throw Error(`Unhandled ledger ${operation}`);
 }
 const createConfigurationGuard=o.omitConfigurationGuard?undefined:inertSteelCreateConfigurationGuard({scopeHash:hash(s),now:()=>NOW,async admit(request,signal){
  signal.throwIfAborted();calls.push('configuration:admit');assert.equal(request.scopeHash,hash(s));assert.equal(request.operationId,s.operationId);assert.equal(request.providerProjectId,s.providerProjectId);
  if(o.configurationDenied)throw Error('inert configuration denial');return inertSteelCreateConfigurationPermit(request,NOW);
 }});
 const runtime=createEtsyInsightsRpcRuntime({scope:s,routeHash:q.routeHash,sourceRpc,ledgerRpc,signal:f.stop.signal,registerCleanup:f.input.registerCleanup,now:()=>NOW,monotonic:()=>0,createConfigurationGuard,
  config:f.input.config,connect:f.input.connect,fetcher:async(address,init)=>{if(init.method!=='POST')gets++;return f.input.fetcher(address,init);}});
 return{...f,runtime,calls,evidence,receipts,uploads,transports,rendererRequests,get sourceReceipt(){return sourceReceipt;},get gets(){return gets;}};
}

test('actual source composition reserves, binds, captures private PNG, releases, qualifies pending and finishes once',async()=>{
 const f=fixture(),r=await f.runtime.run();assert.equal(r.run.receipt.status,'completed',r.run.receipt.reason);assert.equal(r.run.persistence,'verified');assert.equal(r.accounting,'qualified_bounded_pending');assert.equal(r.completion.accepted,true);
 assert.equal(f.events.filter(e=>e==='create').length,1);assert.equal(f.events.filter(e=>e==='submit').length,1);assert.equal(f.uploads.length,1);assert.equal(r.run.receipt.liabilityState,'receipt_required');
 assert.equal(r.run.receipt.captures[0].competitorSales,'unknown');assert.equal(r.run.receipt.captures[0].commercialDemandProven,false);
 assert.ok(f.calls.indexOf('source:source_admit')<f.calls.indexOf('configuration:admit'));assert.ok(f.calls.indexOf('configuration:admit')<f.calls.indexOf('source:source_transport'));assert.ok(f.calls.indexOf('source:cleanup_complete')<f.calls.indexOf('source:source_receipt'));
 assert.ok(f.calls.indexOf('ledger:reconcile')<f.calls.indexOf('source:source_finish'));
 assert.equal(f.evidence.filter(e=>e.kind==='release').length,2);assert.deepEqual(...f.evidence.filter(e=>e.kind==='release'));assert.equal(f.gets,2,'one release status plus one cached terminal usage readback');
 assert.equal(f.receipts.length,1);await assert.rejects(f.runtime.run(),/insights_run_replayed/);await Promise.all(f.cleanup);
 const before=f.events.length;await f.runtime.finishRecorded();assert.equal(f.events.length,before,'recovery finish never creates or navigates');
});
for(const [name,options]of [['missing',{omitConfigurationGuard:true}],['denied',{configurationDenied:true}]])test(`${name} configuration admission pauses before provider create without inventing source or accounting`,async()=>{
 const f=fixture(options),r=await f.runtime.run();assert.equal(r.run.receipt.status,'paused');assert.ok(!f.events.includes('create'));assert.ok(!f.events.includes('submit'));assert.ok(!f.calls.includes('source:source_transport'));assert.ok(!f.calls.includes('source:source_finish'));assert.ok(!f.calls.includes('ledger:reconcile'));await Promise.all(f.cleanup);
});
test('late observer completion cannot upgrade the actual persisted paused source receipt',async()=>{
 const hold=setTimeout(()=>{},4000);let finish;const promise=new Promise(resolve=>{finish=resolve;});
 try{
  const f=fixture({browser:{drainGate:{name:'route',promise}}}),r=await f.runtime.run();
  assert.equal(r.run.persistence,'verified');assert.equal(r.run.receipt.status,'paused');assert.equal(r.run.receipt.liabilityState,'unknown');assert.equal(r.completion,null);assert.deepEqual(r.run.receipt.captures,[]);
  const saved=structuredClone(f.sourceReceipt);assert.equal(saved.status,'paused');finish();await Promise.all(f.cleanup);
  assert.deepEqual(f.sourceReceipt,saved);assert.equal(f.calls.filter(x=>x==='source:source_receipt').length,1);assert.ok(!f.calls.includes('source:source_finish'));assert.equal(f.events.filter(x=>x==='create').length,1);
 }finally{clearTimeout(hold);}
});
for(const [name,options] of [
 ['admission denied',{sourceDenied:'source_admit'}],['invalid reservation',{permit:{admissionHash:H(99)}}],['profile mismatch',{resolved:{profileBindingRevision:id(99)}}],
 ['qualification hash mismatch',{rendererQualification:{qualificationHash:H(99)}}],['transport acknowledgement changed',{transport:{operationId:id(99)}}],
])test(`${name} cannot create a provider session`,async()=>{
 const f=fixture(options),r=await f.runtime.run();assert.equal(r.run.receipt.status,'paused');assert.ok(!f.events.includes('create'));assert.ok(!f.calls.includes('source:source_finish'));await Promise.all(f.cleanup);
});
for(const [name,options] of [
 ['session binding denied',{ledgerDenied:'bind_session'}],['route changed',{route:{providerProjectId:id(99)}}],['request changed',{ledgerRead:{requestHash:H(99)}}],
])test(`${name} releases the admitted session before any query and keeps liability unknown`,async()=>{
 const f=fixture(options),r=await f.runtime.run();await Promise.all(f.cleanup);assert.equal(f.events.filter(e=>e==='create').length,1);assert.ok(f.events.includes('release'));assert.ok(!f.events.includes('submit'));assert.equal(r.run.receipt.status,'paused');assert.equal(r.run.receipt.liabilityState,'unknown');assert.ok(!f.calls.includes('source:source_finish'));
});
for(const [name,options] of [
 ['renderer admission denied',{rendererDenied:true}],['wrong visible shop',{browser:{shop:'Other Shop'}}],['Stop before submit',{stopAt:'submit_query'}],['private screenshot acknowledgement mismatch',{storage:{captureHash:H(99)}}],
])test(`${name} records an honest failed attempt, with no successful source proof`,async()=>{
 const f=fixture(options),r=await f.runtime.run();assert.equal(r.run.receipt.status,'paused');assert.equal(r.run.receipt.captures.length,0);assert.equal(r.completion?.accepted,false);assert.ok(f.events.includes('release'));await Promise.all(f.cleanup);
});
for(const [name,options] of [
 ['unknown provider release',{browser:{releaseFail:true}}],['unexpected proxy usage rejected by provider parsing',{browser:{providerMetadata:{proxyBytesUsed:2}}}],['observers not disposed',{browser:{drainFail:true}}],['release evidence write denied',{ledgerDenied:'evidence'}],['cleanup acknowledgement mismatch',{cleanupAck:{releaseVerified:false}}],
])test(`${name} cannot qualify accounting or finish a source attempt`,async()=>{
 const f=fixture(options),r=await f.runtime.run();assert.equal(r.run.receipt.releaseState,'unconfirmed');assert.equal(r.run.receipt.liabilityState,'unknown');assert.equal(r.completion,null);assert.ok(!f.calls.includes('ledger:reconcile'));assert.ok(!f.calls.includes('source:source_finish'));await Promise.all(f.cleanup);
});
for(const [name,options] of [
 ['missing timeout',{browser:{providerMetadata:{timeout:null}}}],['missing duration',{browser:{providerMetadata:{duration:null}}}],['unknown proxy source',{browser:{providerMetadata:{proxySource:undefined}}}],['explicit ledger denial',{rejectAccounting:true}],
])test(`${name} keeps held liability and forbids completion despite a released receipt`,async()=>{
 const f=fixture(options),r=await f.runtime.run();assert.equal(r.run.receipt.releaseState,'verified');assert.equal(r.accounting,'unconfirmed');assert.equal(r.completion,null);assert.ok(!f.calls.includes('source:source_finish'));assert.equal(f.events.filter(e=>e==='create').length,1);await Promise.all(f.cleanup);
});
test('lost receipt acknowledgement never retries create or advances the next attempt',async()=>{
 const f=fixture({lostReceiptAck:true}),r=await f.runtime.run();assert.ok(f.sourceReceipt);assert.equal(r.run.persistence,'unconfirmed');assert.equal(r.accounting,'not_attempted');assert.equal(r.completion,null);assert.equal(f.calls.filter(x=>x==='source:source_receipt').length,1);await assert.rejects(f.runtime.run());assert.equal(f.events.filter(e=>e==='create').length,1);await Promise.all(f.cleanup);
});
test('early Stop never admits or creates and recovery is still SQL gated',async()=>{
 const f=fixture();f.stop.abort();const r=await f.runtime.run();assert.equal(r.run.receipt.reason,'stopped');assert.ok(!f.events.includes('create'));assert.ok(!f.calls.includes('source:source_admit'));await assert.rejects(f.runtime.finishRecorded());await Promise.all(f.cleanup);
});
test('malicious route and PNG response cannot be mistaken for private storage proof',async()=>{
 const f=fixture({storage:{storageObjectId:'https://public.invalid/image.png'}}),r=await f.runtime.run();assert.equal(r.run.receipt.status,'paused');assert.equal(r.run.receipt.screenshotStorage,null);assert.equal(r.completion?.accepted,false);assert.ok(f.transports.every(t=>new URL(t.endpoint).origin==='https://api.steel.dev'));assert.equal(f.uploads[0].capture.canonicalUrl,`${ROOT}/search?query=pottery+gift`);await Promise.all(f.cleanup);
});

test('completion acknowledgement failure preserves qualified accounting without creating or claiming completion',async()=>{
 const f=fixture({sourceDenied:'source_finish'}),r=await f.runtime.run();assert.equal(r.accounting,'qualified_bounded_pending');assert.equal(r.completion,null);assert.equal(r.run.persistence,'verified');assert.equal(f.events.filter(e=>e==='create').length,1);await assert.rejects(f.runtime.finishRecorded());await Promise.all(f.cleanup);
});
test('no host cleanup registration can dispatch a source operation',async()=>{
 const f=fixture();const runtime=createEtsyInsightsRpcRuntime({scope:f.s,routeHash:H(61),sourceRpc:async()=>{throw Error('must not call');},ledgerRpc:async()=>{throw Error('must not call');},signal:f.stop.signal,registerCleanup(){throw Error('no host');},now:()=>NOW,config:f.input.config,fetcher:f.input.fetcher,connect:f.input.connect});
 await assert.rejects(runtime.run(),/hosting_unavailable/);assert.ok(!f.events.includes('create'));
});

test('completion readback for a different receipt is rejected after successful accounting',async()=>{
 const f=fixture({finishAck:{receiptHash:H(99)}}),r=await f.runtime.run();assert.equal(r.accounting,'qualified_bounded_pending');assert.equal(r.completion,null);await assert.rejects(f.runtime.finishRecorded(),/insights_finish_unconfirmed/);await Promise.all(f.cleanup);
});

test('reviewed renderer .2 records an acknowledged telemetry denial and blocks transport while preserving complete visible proof',async()=>{
 const f=fixture({rendererPolicy:POLICY2,telemetry:true}),r=await f.runtime.run();assert.equal(r.run.receipt.status,'completed',r.run.receipt.reason);assert.equal(r.completion.accepted,true);
 const denial=f.rendererRequests.find(r=>r.disposition==='deny_optional_telemetry');assert.ok(denial);assert.equal(denial.url,TELEMETRY.origin+TELEMETRY.path);assert.equal(denial.provenanceHash,PROVENANCE);assert.equal(denial.policyHash,etsyInsightsRendererPolicyHash(POLICY2));assert.equal(denial.version,'r12.etsy-insights-renderer-request.2');
 assert.equal(f.cdpCommands.filter(x=>x.name==='Fetch.failRequest').length,1);assert.equal(f.cdpCommands.filter(x=>x.name==='Fetch.continueRequest').length,2);assert.equal(f.rendererRequests.length,3);await Promise.all(f.cleanup);
});
for(const [name,denialAck] of [['unexpected allow',{allowed:true}],['missing accepted',{accepted:undefined}],['wrong sequence',{sequence:99}],['changed disposition',{disposition:'allow'}],['extra key',{approved:true}]])test(`renderer .2 ${name} cannot bypass blocked telemetry`,async()=>{
 const f=fixture({rendererPolicy:POLICY2,telemetry:true,denialAck}),r=await f.runtime.run();assert.equal(r.run.receipt.status,'paused');assert.equal(r.run.receipt.captures.length,0);assert.ok(!f.events.includes('submit'));assert.equal(f.cdpCommands.filter(x=>x.name==='Fetch.continueRequest').length,1);assert.ok(f.cdpCommands.some(x=>x.name==='Fetch.failRequest'));await Promise.all(f.cleanup);
});
test('renderer .2 failed Fetch.failRequest acknowledgement invalidates source evidence',async()=>{
 const f=fixture({rendererPolicy:POLICY2,telemetry:true,browser:{cdpFailCommand:'Fetch.failRequest'}}),r=await f.runtime.run();assert.equal(r.run.receipt.status,'paused');assert.equal(r.run.receipt.captures.length,0);assert.ok(!f.events.includes('submit'));assert.equal(f.cdpCommands.filter(x=>x.name==='Fetch.continueRequest').length,1);await Promise.all(f.cleanup);
});
for(const [name,telemetryRequest] of [['material XHR',{resourceType:'XHR'}],['navigation',{resourceType:'Document'}],['redirect',{redirectedRequestId:'prior'}],['mutating POST',{request:{url:TELEMETRY.origin+TELEMETRY.path,method:'POST'}}]])test(`renderer .2 telemetry classification never exempts ${name}`,async()=>{
 const f=fixture({rendererPolicy:POLICY2,telemetry:true,telemetryRequest}),r=await f.runtime.run();assert.equal(r.run.receipt.status,'paused');assert.ok(!f.events.includes('submit'));assert.equal(f.rendererRequests.some(r=>r.disposition==='deny_optional_telemetry'),false);assert.equal(f.cdpCommands.filter(x=>x.name==='Fetch.continueRequest').length,1);await Promise.all(f.cleanup);
});
test('renderer .2 acknowledged denial cannot hide stale query or account evidence',async()=>{
 for(const browser of [{shop:'Other Shop'},{headingQuery:'stale query'},{loading:true}]){const f=fixture({rendererPolicy:POLICY2,telemetry:true,browser}),r=await f.runtime.run();assert.equal(r.run.receipt.status,'paused');assert.equal(r.run.receipt.captures.length,0);assert.equal(r.completion.accepted,false);assert.ok(f.rendererRequests.some(r=>r.disposition==='deny_optional_telemetry'));await Promise.all(f.cleanup);}
});
test('legacy renderer .1 cannot accept the .2 acknowledgement shape',async()=>{
 const f=fixture({rendererAck:{accepted:true,disposition:'allow'}}),r=await f.runtime.run();assert.equal(r.run.receipt.status,'paused');assert.ok(!f.events.includes('submit'));await Promise.all(f.cleanup);
});


test('proof-bound source RPC .3 composes counted query, private PNG, exact decision echo and qualified receipt without resend',async()=>{
 const f=fixture({research:true}),r=await f.runtime.run();assert.equal(r.run.receipt.status,'completed',r.run.receipt.reason);assert.equal(r.run.persistence,'verified');assert.equal(r.accounting,'qualified_bounded_pending');assert.equal(r.completion.accepted,true);
 assert.equal(f.events.filter(e=>e==='create').length,1);assert.equal(f.events.filter(e=>e==='submit').length,1);assert.equal(f.uploads.length,1);assert.equal(f.calls.filter(c=>c==='source:source_admit').length,9);
 const denial=f.rendererRequests.find(r=>r.disposition==='deny_candidate_ancillary');assert.ok(denial);assert.equal(denial.url,undefined);assert.equal(denial.origin,'https://bat.bing.com');assert.equal(denial.pathnameHash,hash('/bat.js'));
 assert.equal(f.cdpCommands.filter(c=>c.name==='Fetch.failRequest').length,1);assert.equal(f.cdpCommands.filter(c=>c.name==='Fetch.continueRequest').length,2);
 const count=f.events.length;await f.runtime.finishRecorded();assert.equal(f.events.length,count);await assert.rejects(f.runtime.run());await Promise.all(f.cleanup);
});
for(const [name,denialAck] of Object.entries({allowed:{allowed:true},accepted:{accepted:false},sequence:{sequence:999},disposition:{disposition:'allow'},decisionHash:{decisionHash:H(200)},qualificationHash:{qualificationHash:H(201)},policyHash:{policyHash:H(202)},provenanceHash:{provenanceHash:H(203)},extra:{untrusted:true}}))test(`proof-bound source .3 rejects altered ${name} acknowledgment before transmitting blocked dependency`,async()=>{
 const f=fixture({research:true,denialAck}),r=await f.runtime.run();assert.equal(r.run.receipt.status,'paused');assert.equal(r.run.receipt.captures.length,0);assert.equal(f.events.includes('submit'),false);assert.equal(f.cdpCommands.filter(c=>c.name==='Fetch.continueRequest').length,1);await Promise.all(f.cleanup);
});
test('proof-bound source .3 preserves honest pause and held accounting when result dependency or release is unknown',async()=>{
 for(const browser of [{resultRequest:{url:'https://unknown.example/result.js'}},{releaseFail:true},{drainFail:true}]){const f=fixture({research:true,browser}),r=await f.runtime.run();assert.equal(r.run.receipt.status,'paused');assert.equal(r.run.receipt.captures.length,0);assert.ok(f.events.filter(e=>e==='submit').length<=1);if(browser.releaseFail||browser.drainFail){assert.equal(r.completion,null);assert.equal(r.run.receipt.liabilityState,'unknown');}await Promise.all(f.cleanup);}
});
