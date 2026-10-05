import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {fixtureData} from './next-fixture/data.mjs';
import {seedResearchFixture,researchOwnerFixture,researchRuntimeFixture,researchProviderFixture,researchGenerationFixture,researchCatalogFixture,r11Scope,R11_INERT_SERVER_KEY,R11_RESET,R11_RAW_SENTINEL,r11Hash} from './next-fixture/r11-research.mjs';
import {receiptEntries,receiptCollectionAnnotations} from './next-fixture/r11-receipts.mjs';
import {submitReceiptAction} from './next-fixture/r11-pending-journeys.mjs';
import {FIXTURE_ACTION_TIMEOUT_MS} from './next-fixture/async-bounds.mjs';
const require=createRequire(import.meta.url),runtimeModule=require('../.core-tests/research/qualification-runtime.js'),route=require('../.core-tests/research/generation-route.js'),quote=require('../.core-tests/research/qualification-quote.js'),model=require('../.core-tests/models/openrouter.js');
function fixture(extra={}){
 const clock=Date.now(),control={...R11_RESET,r11Now:clock,r11ReceiptDelayMs:120_001,...extra},state=fixtureData(),effects=[],log=[];
 state.r11Research=seedResearchFixture(state,control);const research=state.r11Research,grant=research.grants[0];
 const activated=researchOwnerFixture(state,'r11_research_bootstrap',{p_business_id:r11Scope.businessId,p_grant_id:grant.grantId,p_grant_hash:grant.grantHash},effects,control);assert.equal(activated.error,null);
 const scope={businessId:r11Scope.businessId,coreWorkflowRunId:r11Scope.workflowRunId,runtimeCapability:createHmac('sha256',R11_INERT_SERVER_KEY).update(JSON.stringify({businessId:r11Scope.businessId,ownerId:state.owner,policyId:r11Scope.policyId,version:'r11.owner-runtime.1',workflowRunId:r11Scope.workflowRunId})).digest('base64url')};
 const rpc=(name,operation,payload)=>{log.push({kind:'rpc',operation});const reply=researchRuntimeFixture(state,name,{p_business_id:r11Scope.businessId,p_server_key:R11_INERT_SERVER_KEY,p_operation:operation,p_payload:payload},effects,control);if(reply.error)throw Error(reply.error.message);return reply.data;};
 const imports={
  '@/models/openrouter':model,'@/research/generation-route':route,'@/research/qualification-quote':quote,
  '@/research/qualification-runtime':{publicResearchRuntime:(_scope,verifyQuote)=>({verifyQuote,requireDurableReceipts:true,
   rpc:(operation,payload)=>rpc('r11_research_server_v2',operation,payload),
   settle:(requestId,receipt)=>rpc('r05_admission_server','settle',{requestId,currency:'USD',actualMicrounits:receipt.reportedMicrousd===null?null:String(receipt.reportedMicrousd),providerRequestId:receipt.providerRequestId,receiptHash:r11Hash(receipt)}),
  })},
 };
 const make=()=>{
  const source=ts.transpileModule(readFileSync('tests/next-fixture/r11-dependencies.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,compiled={exports:{}};
  runInNewContext(`(function(require,module,exports){${source}\n})`,{URL,Response,Headers,Buffer,AbortSignal,Date,
   process:{env:{R03_BOUNDARY:'http://127.0.0.1:12345'}},fetch:async(url,init)=>{
    assert.match(url,/^http:\/\/127\.0\.0\.1:12345\/r11\/(clock|catalog|provider|generation)$/);assert.equal(init.method,'POST');const payload=JSON.parse(init.body);let result;
    if(url.endsWith('/clock')){assert.deepEqual(payload,{});result={now:control.r11Now};}
    else if(url.endsWith('/catalog'))result=researchCatalogFixture(payload.url,log,control);
    else if(url.endsWith('/provider'))result=researchProviderFixture(state,payload,effects,control);
    else result=researchGenerationFixture(state,payload,log,control);
    return Response.json(result);
   },
  })(name=>{assert.ok(Object.hasOwn(imports,name),name);return imports[name];},compiled,compiled.exports);
  return compiled.exports.researchQualificationDependencies();
 };
 const run=async()=>{const dependencies=make();await dependencies.now();return runtimeModule.runPublicResearchQualification(scope,r11Scope.policyId,dependencies.makeRuntime(scope,async p=>{const value=await dependencies.fetchQuote({maximumMicrousd:p.maximumMicrousd});quote.validatePublicResearchQuote(value,control.r11Now);assert.equal(value.quoteHash,p.quoteHash);return{providerName:value.providerName,acceptedResponseModelIds:value.acceptedResponseModelIds,quoteValidUntil:value.validUntil};}));};
 const workspace=()=>researchOwnerFixture(state,'r11_research_workspace_v2',{p_business_id:r11Scope.businessId},effects,control).data;
 return{clock,control,state,research,effects,log,rpc,make,run,workspace,reads:()=>log.filter(row=>row.kind==='inert-r11-generation-read')};
}
test('actual runtime and Next fixture preserve delayed output through fresh factories and use exactly one model call per phase',async()=>{
 const f=fixture();let result=await f.run();assert.equal(result.status,'receipt_pending');assert.equal(result.receiptStatus,'awaiting_receipt');assert.equal(f.research.providerCalls.length,1);assert.equal(f.research.settlements.length,1);assert.equal(f.reads().length,1);assert.equal(f.research.outcomes.length,0);
 const saved=structuredClone(f.research.receiptCandidates[0]);assert.ok(f.log.findIndex(row=>row.operation==='stage_receipt')<f.log.findIndex(row=>row.kind==='inert-r11-generation-read'));assert.doesNotMatch(JSON.stringify(saved),new RegExp(R11_RAW_SENTINEL));
 const projection=f.workspace();assert.deepEqual(Object.keys(projection.policies[0].receiptChecks[0]).sort(),['attempts','candidateHash','diagnostic','nextCheckAt','phase','proofHash','receiptExpiresAt','requestId','status'].sort());assert.doesNotMatch(JSON.stringify(projection),/url_citation|Synthetic public gardening report/);
 result=await f.run();assert.equal(result.status,'receipt_pending');assert.equal(f.reads().length,1);assert.deepEqual(f.research.receiptCandidates[0],saved);
 f.control.r11Now=f.clock+120_002;result=await f.run();assert.equal(result.status,'receipt_pending');assert.equal(result.phase,'select');assert.equal(f.research.providerCalls.length,2);assert.equal(f.research.collections.length,1);assert.equal(f.research.results.length,0);assert.equal(f.reads().length,3);assert.deepEqual(f.research.receiptCandidates[0].candidate,saved.candidate);assert.equal(f.research.collections[0].collection.sources[0].retrievedAt,saved.candidate.receivedAt);
 const select=structuredClone(f.research.receiptCandidates[1].candidate);f.control.r11Now=f.clock+240_004;result=await f.run();assert.equal(result.status,'completed');assert.equal(f.research.results.length,1);assert.equal(f.research.providerCalls.length,2);assert.equal(f.research.settlements.length,4);assert.deepEqual(f.research.receiptCandidates[1].candidate,select);assert.equal(f.research.outcomes.length,0);
 assert.deepEqual(f.reads().map(row=>row.generationId),[f.research.providerCalls[0].receiptId,f.research.providerCalls[0].receiptId,f.research.providerCalls[1].receiptId,f.research.providerCalls[1].receiptId]);
});
test('independent Next fixture refuses unknown-cost staging and exact candidate/claim substitutions',async()=>{
 const f=fixture();await f.run();const entry=f.research.receiptCandidates[0],payload={policyId:r11Scope.policyId,phase:'search',candidateHash:entry.candidateHash};
 for(const edit of [{candidateHash:'f'.repeat(64)},{phase:'select'},{policyId:r11Scope.otherBusinessId}])assert.throws(()=>f.rpc('r11_research_server_v2','claim_receipt',{...payload,...edit}));
 const noCost=fixture({r11UnknownCost:true});await assert.rejects(noCost.run());assert.equal(noCost.research.receiptCandidates.length,0);assert.equal(noCost.reads().length,0);assert.equal(noCost.research.settlements[0].actualMicrounits,null);
 f.control.r11Now=f.clock+120_000;const claim=f.rpc('r11_research_server_v2','claim_receipt',payload);assert.equal(claim.claimed,true);const raced=f.rpc('r11_research_server_v2','claim_receipt',payload);assert.equal(raced.claimed,false);assert.equal(raced.reason,'cooldown');
 assert.throws(()=>f.rpc('r11_research_server_v2','record_receipt',{...payload,claimId:entry.claims[0].id,proof:null,diagnostic:{code:'api_failure',httpStatus:404},retryAfterAt:null}));assert.equal(entry.claims.length,2);
});
test('inert receipt claims honor longer Retry-After, consume lost leases, and stop at three without false outcomes',async()=>{
 const f=fixture();await f.run();const entry=f.research.receiptCandidates[0],payload={policyId:r11Scope.policyId,phase:'search',candidateHash:entry.candidateHash};f.control.r11Now=f.clock+120_000;
 const claim=f.rpc('r11_research_server_v2','claim_receipt',payload),record={...payload,claimId:claim.claimId,proof:null,diagnostic:{code:'api_failure',httpStatus:429},retryAfterAt:new Date(f.clock+600_000).toISOString()};
 assert.equal(f.rpc('r11_research_server_v2','record_receipt',record).replayed,false);assert.equal(f.rpc('r11_research_server_v2','record_receipt',record).replayed,true);
 f.control.r11Now=f.clock+240_000;assert.equal(f.rpc('r11_research_server_v2','claim_receipt',payload).reason,'cooldown');f.control.r11Now=f.clock+600_000;assert.equal(f.rpc('r11_research_server_v2','claim_receipt',payload).claimed,true);
 f.control.r11Now=f.clock+720_000;assert.equal(f.rpc('r11_research_server_v2','claim_receipt',payload).reason,'exhausted');assert.equal(entry.claims.length,3);assert.equal(f.research.outcomes.length,0);assert.equal(f.research.results.length,0);assert.equal(f.research.providerCalls.length,1);
});
test('terminal 401 is atomic safe failure/revocation; owner Stop and grace expiry fence receipt access',async()=>{
 const terminal=fixture({r11ReceiptDelayMs:0,r11GenerationResponses:['unauthorized']});const result=await terminal.run();assert.equal(result.status,'receipt_pending');assert.equal(result.receiptStatus,'terminal');assert.equal(terminal.research.outcomes[0].reason,'response_provider_unqualified');assert.equal(terminal.research.outcomes[0].observation.inferenceRouteHttpStatus,401);assert.equal(terminal.research.policies[0].revoked,true);assert.equal(terminal.reads().length,1);assert.equal(terminal.research.results.length,0);assert.doesNotMatch(JSON.stringify(terminal.research),new RegExp(R11_RAW_SENTINEL));
 for(const stop of [true,false]){const f=fixture();await f.run();if(stop)assert.equal(researchOwnerFixture(f.state,'r11_research_stop_v2',{p_business_id:r11Scope.businessId,p_policy_id:r11Scope.policyId},f.effects,f.control).error,null);else f.control.r11Now=f.clock+35*60_000;
  assert.equal(receiptEntries(f.research,f.research.policies[0],f.control)[0].status,stop?'stopped':'expired');await assert.rejects(f.run());assert.equal(f.reads().length,1);assert.equal(f.research.providerCalls.length,1);assert.equal(f.research.results.length,0);assert.equal(f.research.settlements.length,1);
 }
});
test('pending browser helper bounds exact action headers and natural rendered outcome without Flight EOF',async()=>{
 const events=[],url='http://localhost:12345/dashboard/research-qualification';let capture,resolveHeaders;
 const request={method:()=> 'POST',url:()=>url,headers:()=>({'next-action':'exact-receipt-action'})},response={request:()=>request,status:()=>200,headers:()=>({'x-action-redirect':'/dashboard/research-qualification;push'}),body:()=>assert.fail('No Flight body'),finished:()=>assert.fail('No Flight EOF')};
 const page={url:()=>url,on:(name,handler)=>{assert.equal(name,'request');capture=handler;},off:(name,handler)=>{assert.equal(name,'request');assert.equal(handler,capture);events.push('cleanup');},waitForResponse:(predicate,options)=>{assert.equal(options.timeout,FIXTURE_ACTION_TIMEOUT_MS);return new Promise(resolve=>{resolveHeaders=()=>{assert.equal(predicate({...response,request:()=>({...request})}),false);assert.equal(predicate(response),true);events.push('headers');resolve(response);};});}};
 await submitReceiptAction(page,{click:async options=>{assert.equal(options.timeout,FIXTURE_ACTION_TIMEOUT_MS);capture(request);resolveHeaders();}},async()=>{events.push('rendered');});assert.deepEqual(events,['headers','rendered','cleanup']);
});
test('fresh actual runtime instances racing Continue share one durable claim and cannot revoke the admitted selector',async()=>{
 const f=fixture();await f.run();f.control.r11Now=f.clock+120_002;
 const results=await Promise.allSettled([f.run(),f.run()]);assert.ok(results.some(result=>result.status==='fulfilled'));
 assert.equal(f.research.providerCalls.length,2);assert.deepEqual(f.research.providerCalls.map(row=>row.phase),['search','select']);assert.equal(f.reads().length,3);assert.equal(f.research.collections.length,1);assert.equal(f.research.outcomes.length,0);assert.equal(f.research.policies[0].revoked,false);
 assert.equal(f.research.receiptCandidates[0].claims.length,2);assert.equal(f.research.receiptCandidates[1].claims.length,1);assert.equal(f.research.results.length,0);
});
test('Next once-reader Retry-After uses the same trusted virtual clock without blocking or attempting another GET',async()=>{
 const f=fixture({r11ReceiptDelayMs:0,r11GenerationResponses:['rate_limited']});f.control.r11Now+=60_000;const result=await f.run();assert.equal(result.status,'receipt_pending');assert.equal(result.nextCheckAt,new Date(f.control.r11Now+300_000).toISOString());assert.equal(f.reads().length,1);assert.equal(f.research.providerCalls.length,1);assert.equal(f.research.outcomes.length,0);
 f.control.r11Now+=120_000;await f.run();assert.equal(f.reads().length,1);assert.equal(f.research.receiptCandidates[0].claims.length,1);
});
test('uncertain collection/result persistence retains verified output and Continue recovers without repeating its model or receipt',async()=>{
 for(const failed of ['r11CollectFailure','r11CompleteFailure']){
  const f=fixture({r11ReceiptDelayMs:0,[failed]:true});await assert.rejects(f.run());const count=failed==='r11CollectFailure'?1:2,staged=structuredClone(f.research.receiptCandidates);
  assert.equal(f.research.providerCalls.length,count);assert.equal(f.reads().length,count);assert.equal(f.research.settlements.length,count*2);assert.equal(f.research.results.length,0);assert.equal(f.research.outcomes.length,0);assert.equal(f.research.policies[0].revoked,false);assert.equal(f.workspace().policies[0].receiptChecks.at(-1).status,'verified');
  f.control[failed]=false;assert.equal((await f.run()).status,'completed');assert.equal(f.research.results.length,1);assert.equal(f.research.providerCalls.length,2);assert.equal(f.reads().length,2);assert.equal(f.research.settlements.length,4);assert.equal(f.research.outcomes.length,0);assert.equal(f.research.policies[0].revoked,false);
  for(const entry of staged)assert.deepEqual(f.research.receiptCandidates.find(row=>row.requestId===entry.requestId),entry);
 }
});

test('fixture promotion uses greedy source dedup without discarding or modifying staged annotations',()=>{
 const annotation=(url,content)=>({type:'url_citation',url_citation:{url:`https://gardening.example/${url}`,title:'Public report',content}}),a='A bounded public source excerpt for adult gardeners.',b='Another bounded public excerpt about gardening containers.';
 const staged=[annotation('a',a),annotation('a',b),annotation('b',b),annotation('c',a)],snapshot=structuredClone(staged);
 assert.deepEqual(receiptCollectionAnnotations(staged),[staged[0],staged[2]]);assert.deepEqual(staged,snapshot);
});
