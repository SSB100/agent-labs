/** Actual verification runtime and SQL authority with inert Playwright/Steel IO.
 * No runtime authority, result, proof, receipt or accounting response is mocked.
 */
import assert from 'node:assert/strict';
import {verificationFixture as browserFixture} from './etsy-insights-playwright-fixture.mjs';
import {verifyApprovedEtsySteelProfile} from '../../.core-tests/accounts/etsy-steel-verification-runtime.js';

export function sqlBackedEtsySteelVerification(ctx,{shop=ctx.a.scope.expectedShopName,beforeRendererRequest=null,beforeNavigate=null}={}){
 const {authority,x,a,receipt}=ctx,calls=[],providerRequests=[],cleanup=[],transportQueue=[];
 let prepared=null,released=false,created=false,browser;
 browser=browserFixture({shop,beforeNavigate:async url=>{
  // Exercise the real request-stage renderer guard and its durable SQL decision.
  if(beforeRendererRequest)await beforeRendererRequest(ctx);
  await browser.request(url);
  if(beforeNavigate)await beforeNavigate(ctx);
 }});
 const input={setupScope:a.scope,handoffReceiptHash:receipt.receiptHash,routeHash:authority.routeHash,
  signal:browser.stop.signal,registerCleanup:work=>cleanup.push(work),config:browser.input.config,connect:browser.input.connect,
  rpc:async(operation,payload)=>{
   calls.push({operation,payload:structuredClone(payload)});
   const result=await x.verifier(operation,payload);
   if(operation==='prepare')prepared=result;
   if(operation==='transport'){
    assert.equal(result.allowed,true);assert.equal(result.operationId,a.scope.verificationOperationId);
    transportQueue.push(structuredClone(payload.request));
   }
   return result;
  },
  ledger:async(operationId,operation,payload)=>{
   calls.push({operation:'ledger:'+operation,payload:structuredClone(payload)});
   assert.equal(operationId,a.scope.verificationOperationId);
   return x.ledger(operationId,operation,payload);
  },
  fetcher:async(address,init={})=>{
   assert.ok(prepared,'The real SQL prepare RPC must precede provider IO');
   const s=prepared.scope,url=new URL(address),method=init.method??'GET',admitted=transportQueue.shift();
   assert.equal(url.origin,'https://api.steel.dev');
   assert.ok(admitted,'Every provider request requires its exact SQL transport admission');
   assert.equal(admitted.endpoint,url.href);assert.equal(admitted.method,method);assert.equal(admitted.provider,'steel');
   const request={method,url:url.href,body:init.body?JSON.parse(init.body):null};providerRequests.push(request);
   if(url.pathname==='/v1/sessions'){
    assert.equal(admitted.operation,'browser.etsy.insights.create');assert.equal(method,'POST');assert.equal(created,false);
    assert.deepEqual(request.body,{sessionId:s.operationId,projectId:s.providerProjectId,timeout:s.maximumSessionMs,persistProfile:false,
     profileId:s.profileId,debugConfig:{interactive:false,systemCursor:false},useProxy:false,solveCaptcha:false,
     stealthConfig:{autoCaptchaSolving:false,humanizeInteractions:false,skipFingerprintInjection:true}});
    created=true;
   }else if(url.pathname===`/v1/sessions/${s.operationId}/release`){
    assert.equal(admitted.operation,'browser.etsy.session.release');assert.equal(method,'POST');assert.equal(created,true);
    assert.equal(released,false);released=true;return Response.json({success:true});
   }else{
    assert.equal(url.pathname,`/v1/sessions/${s.operationId}`);assert.equal(method,'GET');assert.equal(created,true);
    assert.equal(admitted.operation,'browser.etsy.session.release_readback');assert.equal(released,true);
   }
   return Response.json({id:s.operationId,projectId:s.providerProjectId,profileId:s.profileId,status:released?'released':'live',
    debugUrl:`https://api.steel.dev/v1/sessions/${s.operationId}/player`,solveCaptcha:false,useProxy:false,
    proxyBytesUsed:0,proxySource:null,timeout:s.maximumSessionMs,duration:1000});
  },
 };
 return{input,calls,providerRequests,browser,cleanup,get prepared(){return prepared;},
  async run(){const result=await verifyApprovedEtsySteelProfile(input);await Promise.all(cleanup);assert.equal(transportQueue.length,0);return result;}};
}
