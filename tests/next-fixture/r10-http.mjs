import assert from 'node:assert/strict';
import {r10Scope} from './r10.mjs';
export const viewerRoute=(extra={})=>'/dashboard?'+new URLSearchParams({view:'overview',centre:'browser',business:r10Scope.businessId,quest:r10Scope.questId,browserRun:r10Scope.workflowRunId,...extra});
export const viewerEndpoint=`/api/browser/sessions/${r10Scope.sessionId}/watch`;
export async function runViewerHttp({origin,boundary,check}){
 const control=values=>fetch(boundary.origin+'/control',{method:'POST',body:JSON.stringify(values),signal:AbortSignal.timeout(10_000)});
 const {sessionId:_,...scope}=r10Scope;void _;
 const post=(path,body=scope,headers={})=>fetch(origin+path,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(30_000)});
 await control({workspace:true,viewer:true,resetViewer:true});
 await check('R10 actual Next renders an explicit dedicated public Watch without connecting',async()=>{
  const before=boundary.effects.length,response=await fetch(origin+viewerRoute(),{signal:AbortSignal.timeout(30_000)}),html=await response.text();
  assert.equal(response.status,200);assert.match(html,/Controlled public qualification/);assert.match(html,/>Watch<\/button>/);assert.doesNotMatch(html,/Application error|<iframe|wss:\/\/|inert:\/\/r10|inert-r10/);assert.equal(boundary.effects.length,before);
 });
 await check('R10 actual authenticated routes reject missing auth, foreign origin, forged extra authority and mismatched tuples',async()=>{
  const cases=[await post(viewerEndpoint,scope,{cookie:'r03-session=off'}),await post(viewerEndpoint,scope,{origin:'https://foreign.invalid'}),await post(viewerEndpoint,{...scope,debugUrl:'wss://forged.invalid'}),await post(viewerEndpoint,{...scope,businessId:'00000000-0000-4000-8000-000000000002'}),await fetch(origin+viewerEndpoint,{signal:AbortSignal.timeout(30_000)})];
  for(const response of cases){assert.ok([400,404,405].includes(response.status),String(response.status));assert.doesNotMatch(await response.text(),/inert-r10|r10-capture|\/9j\//);}
  assert.equal(boundary.state().viewer.writerId,null);
 });
 await check('R10 actual route streams one inert JPEG with private headers; copied stream fails and revoke is acknowledged',async()=>{
  const response=await post(viewerEndpoint);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/application\/x-ndjson/);assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  const reader=response.body.getReader();let bytes='';try{while(!bytes.includes('\n')){const chunk=await reader.read();assert.equal(chunk.done,false);bytes+=new TextDecoder().decode(chunk.value);}
   const frame=JSON.parse(bytes.slice(0,bytes.indexOf('\n')));assert.equal(frame.type,'frame');assert.equal(frame.epoch,1);assert.equal(frame.sequence,1);assert.equal(frame.mime,'image/jpeg');assert.ok(frame.data.startsWith('/9j/'));assert.ok(frame.data.length<=200*1024);
   const copied=await post(viewerEndpoint);assert.equal(copied.status,409);assert.doesNotMatch(await copied.text(),/inert-r10|r10-capture|\/9j\//);
  }finally{await reader.cancel();}
  const stopped=await post(viewerEndpoint+'/revoke');assert.equal(stopped.status,200);assert.equal((await stopped.json()).status,'revoked');assert.equal(boundary.state().viewer.close,true);
 });
}
