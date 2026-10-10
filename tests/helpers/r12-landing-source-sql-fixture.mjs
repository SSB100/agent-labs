/** Real historical source port/runtime + SQL. Renderer/provider IO and the
 * explicitly declared pre-21300 configuration-admission leaf are inert. */
import assert from 'node:assert/strict';
import {inertSteelCreateConfigurationGuard,inertSteelCreateConfigurationPermit,createConfigHash} from './etsy-steel-create-config-fixture.mjs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
import {landingFixture} from './etsy-insights-landing-fixture.mjs';
const {createEtsyInsightsRpcRuntime}=await import(pathToFileURL(resolve(process.env.R12_INSIGHTS_CORE_DIR||'.core-tests','browser/etsy-insights-rpc-runtime.js')).href);
export function landingSqlSource(f,a,{beforeRpc=null,browserOptions={}}={}){
 const s=a.inputs,calls=[],providerRequests=[],cleanup=[],transports=[],boundarySubstitutions=[];let browser,created=false,released=false;
 browser=landingFixture({...browserOptions,shop:s.accountBinding.observedShopName,summaryQuery:s.query,headingQuery:s.query,
  beforeNavigate:url=>browser.request(url),beforeSubmit:url=>browser.request(url)});
 browser.page.screenshot=async({clip})=>{browser.events.push('screenshot');assert.ok(clip.x>=300);return sharp({create:{width:clip.width,height:clip.height,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png({compressionLevel:9,palette:true}).toBuffer();};
 const createConfigurationGuard={scopeHash:createConfigHash(s),deployment:inertSteelCreateConfigurationGuard().deployment,async admit(request,signal){
  signal.throwIfAborted();
  assert.equal((await f.authority.db.query("select to_regprocedure('public.r12_steel_create_config_admit(uuid,jsonb,text)') is null absent")).rows[0].absent,true,'Historical configuration leaf cannot bypass 21300');
  assert.equal(request.operationId,s.operationId);assert.equal(request.scopeHash,createConfigHash(s));assert.equal(request.providerProjectId,s.providerProjectId);
  if(!boundarySubstitutions.length)boundarySubstitutions.push('historical_pre_21300_configuration_admission_leaf');
  return inertSteelCreateConfigurationPermit(request);
 }};
 const runtime=createEtsyInsightsRpcRuntime({scope:s,createConfigurationGuard,routeHash:f.authority.routeHash,signal:browser.stop.signal,registerCleanup:p=>cleanup.push(p),config:browser.input.config,connect:browser.input.connect,
  sourceRpc:async(operation,payload)=>{
   calls.push({operation,payload:structuredClone(payload)});if(beforeRpc)await beforeRpc(operation,payload);
   const result=await f.rpc(operation,payload,'source');if(operation==='source_transport'){assert.equal(result.allowed,true);transports.push(payload.request);}return result;
  },
  ledgerRpc:(operation,payload)=>f.approved.ledger(s.operationId,operation,payload),
  fetcher:async(address,init={})=>{
   const url=new URL(address),method=init.method??'GET',admitted=transports.shift();assert.ok(admitted);assert.equal(admitted.endpoint,url.href);assert.equal(admitted.method,method);
   assert.equal(url.origin,'https://api.steel.dev');providerRequests.push({method,path:url.pathname});
   if(url.pathname==='/v1/sessions'){
    assert.equal(method,'POST');assert.equal(created,false);created=true;
    const body=JSON.parse(init.body);assert.deepEqual(body,{sessionId:s.operationId,projectId:s.providerProjectId,timeout:s.limits.maximumSessionMs,persistProfile:false,profileId:f.approved.profileId,debugConfig:{interactive:false,systemCursor:false},useProxy:false,solveCaptcha:false,stealthConfig:{autoCaptchaSolving:false,humanizeInteractions:false,skipFingerprintInjection:true}});
   }else if(url.pathname===`/v1/sessions/${s.operationId}/release`){assert.equal(method,'POST');assert.equal(created,true);assert.equal(released,false);released=true;return Response.json({success:true});}
   else{assert.equal(method,'GET');assert.equal(url.pathname,`/v1/sessions/${s.operationId}`);assert.equal(released,true);}
   return Response.json({id:s.operationId,projectId:s.providerProjectId,profileId:f.approved.profileId,status:released?'released':'live',debugUrl:`https://api.steel.dev/v1/sessions/${s.operationId}/player`,solveCaptcha:false,useProxy:false,proxyBytesUsed:0,proxySource:null,timeout:s.limits.maximumSessionMs,duration:1000});
  },
 });
 return {browser,boundarySubstitutions,calls,providerRequests,runtime,async run(){const result=await runtime.run();await Promise.all(cleanup);assert.equal(transports.length,0);return result;}};
}
