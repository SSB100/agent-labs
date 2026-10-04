import assert from 'node:assert/strict';
import {setTimeout as pause} from 'node:timers/promises';
import {r10Scope,r10LegacyScopes,r10Lineage} from './r10.mjs';
export const viewerRoute=(extra={})=>'/dashboard?'+new URLSearchParams({view:'overview',centre:'browser',business:r10Scope.businessId,quest:r10Scope.questId,browserRun:r10Scope.workflowRunId,...extra});
export const viewerEndpoint=`/api/browser/sessions/${r10Scope.sessionId}/watch`;
export async function runViewerHttp({origin,boundary,check}){
 const until=async check=>{const end=Date.now()+5_000;while(!check()&&Date.now()<end)await pause(20);assert.ok(check(),'Bounded actual Next cleanup did not settle');};
 const control=values=>fetch(boundary.origin+'/control',{method:'POST',body:JSON.stringify(values),signal:AbortSignal.timeout(10_000)});
 const {sessionId:_,...scope}=r10Scope;void _;
 const post=(path,body=scope,headers={})=>fetch(origin+path,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(30_000)});
 await control({workspace:true,viewer:true,resetViewer:true});
 await check('R10 actual Next renders an explicit dedicated public Watch without connecting',async()=>{
  const before=boundary.effects.length,response=await fetch(origin+viewerRoute(),{signal:AbortSignal.timeout(30_000)}),html=await response.text();
  assert.equal(response.status,200);assert.match(html,/Controlled public qualification/);assert.match(html,/>Watch<\/button>/);assert.doesNotMatch(html,/Application error|<iframe|wss:\/\/|inert:\/\/r10|inert-r10|INERT_PRIVATE_LEGACY_PROVIDER/);assert.equal(boundary.effects.length,before);
 });
 await check('R10 populated same-Business legacy sessions cannot poison or widen the selected Quest',async()=>{
  const sessions=boundary.state().db.browser_sessions.filter(session=>session.business_id===r10Scope.businessId);
  assert.ok(sessions.some(session=>session.id===r10LegacyScopes.sameQuest.sessionId));assert.ok(sessions.some(session=>session.id===r10LegacyScopes.otherQuest.sessionId));
  const response=await fetch(origin+viewerRoute(),{signal:AbortSignal.timeout(30_000)}),html=await response.text();assert.equal(response.status,200);assert.match(html,/>Watch<\/button>/);
  assert.match(html,new RegExp('value="'+r10LegacyScopes.sameQuest.workflowRunId+'"'));assert.doesNotMatch(html,new RegExp('value="'+r10LegacyScopes.otherQuest.workflowRunId+'"'));
  const wrong=await fetch(origin+viewerRoute({browserRun:r10LegacyScopes.otherQuest.workflowRunId}),{signal:AbortSignal.timeout(30_000)});assert.equal(wrong.status,404);assert.doesNotMatch(await wrong.text(),/>Watch<\/button>/);
  const legacy=await fetch(origin+viewerRoute({browserRun:r10LegacyScopes.sameQuest.workflowRunId}),{signal:AbortSignal.timeout(30_000)}),saved=await legacy.text();assert.equal(legacy.status,200);assert.match(saved,/Live viewing unavailable for this session/);assert.doesNotMatch(saved,/>Watch<\/button>|INERT_PRIVATE_LEGACY_PROVIDER/);
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
  const state=boundary.state(),audit=state.db.artifacts.find(row=>row.id===r10Lineage.auditArtifactId);assert.equal(audit.workflow_run_id,r10Scope.workflowRunId);assert.equal(audit.task_contract_id,r10Lineage.taskId);assert.equal(audit.content.workerRunId,r10Lineage.workerRunId);assert.ok(audit.content.capturedFrames>=audit.content.deliveredFrames&&audit.content.deliveredFrames>=1);assert.equal(audit.content.actualMicrounits,null);
  const record='/dashboard?'+new URLSearchParams({view:'work',business:r10Scope.businessId,quest:r10Scope.questId,selected:r10Scope.workflowRunId,episode:r10Scope.workflowRunId,agent:r10Lineage.workerRunId});
  const recordResponse=await fetch(origin+record,{signal:AbortSignal.timeout(30_000)}),recordHtml=await recordResponse.text();assert.equal(recordResponse.status,200);assert.match(recordHtml.replace(/<!--.*?-->/gs,''),new RegExp('Actual Worker Run '+r10Lineage.workerRunId+' · Task '+r10Lineage.taskId));assert.match(recordHtml,/Controlled public viewer closure audit/);assert.doesNotMatch(recordHtml,/This exact Step\/Agent\/task chain is unavailable/);
  assert.equal(state.db.task_contracts.find(row=>row.id===r10Lineage.taskId).workflow_stage_run_id,null);
  const plain=recordHtml.replace(/<!--.*?-->/gs,'');assert.match(plain,/Saved tasks, newest first · 1 loaded of 1/);assert.match(plain,/Run-level task · No stage assigned/);assert.match(plain,/Render the fixed reviewed public R10 source/);
  assert.doesNotMatch(plain,/Step outputs/);

 });
 await check('R10 actual Next response cancellation retains cleanup while independent release precedes delayed disposal',async()=>{
  await control({resetViewer:true,viewerHoldDispose:true,viewerDisposeDelayMs:0,viewerDisposeFailure:false,viewerCaptureFailure:false});
  const start=boundary.effects.length,response=await post(viewerEndpoint),reader=response.body.getReader();assert.equal(response.status,200);await reader.read();await reader.cancel();
  const events=()=>boundary.effects.slice(start),has=event=>events().some(row=>row.event===event);
  try{await until(()=>has('provider_released')&&has('dispose_started'));assert.equal(boundary.state().viewer.close,false,'Release must not fabricate disposal ACK');}
  finally{await control({viewerHoldDispose:false});}
  await until(()=>boundary.state().viewer.close);const effects=events();assert.equal(effects.filter(row=>row.event==='provider_create').length,1);
  assert.ok(effects.findIndex(row=>row.event==='provider_released')<effects.findIndex(row=>row.event==='dispose_finished'));
  assert.ok(effects.findIndex(row=>row.event==='dispose_finished')<effects.findIndex(row=>row.operation==='close'));
  await control({viewerDisposeDelayMs:0});
 });
 await check('R10 pre-first-frame failure and rejected disposal keep exact release, one create and unconfirmed closure',async()=>{
  await control({resetViewer:true,viewerHoldDispose:false,viewerCaptureFailure:true,viewerDisposeFailure:true,viewerDisposeDelayMs:0});
  const start=boundary.effects.length;
  // A real Next stream error can reject fetch before headers or while reading.
  await assert.rejects(async()=>{const response=await post(viewerEndpoint);if(response.status>=500)throw Error('Expected Next stream failure');await response.text();});
  const events=()=>boundary.effects.slice(start);await until(()=>events().some(row=>row.event==='provider_released')&&events().some(row=>row.event==='dispose_failed'));
  assert.equal(boundary.state().viewer.close,false);assert.equal(events().filter(row=>row.event==='provider_create').length,1);assert.equal(events().filter(row=>row.operation==='permit').length,1);assert.equal(events().filter(row=>row.operation==='close').length,0);
  await control({resetViewer:true,viewerCaptureFailure:false,viewerDisposeFailure:false,viewerDisposeDelayMs:0});
 });
}
