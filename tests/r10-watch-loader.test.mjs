import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import React from 'react';
import {wire,fixture,id,loadBrowserSource,contract} from './helpers/console-browser-fixtures.mjs';
const questId=id(810),r10run=id(811),sessionId=id(812);
function setup({failed=false,selectedRun=r10run,legacy=true,failedRuns=false}={}){
 const old=fixture();const w=wire({sessions:legacy?[old.session]:[],runs:[{...old.run,id:r10run,workflow_definition_id:'a1100000-0000-4000-8000-000000000002'}],failTable:failedRuns?'workflow_runs':undefined});
 const viewer={sessionId,businessId:id(2),questId,workflowRunId:r10run,status:'available',expiresAt:new Date(Date.now()+120000).toISOString(),policyVersion:'r10.controlled-public.v1'};
 w.context.workspaceQuest={id:questId,title:'Selected Quest',selection:'explicit'};
 w.client.rpc=async(name,args)=>{assert.equal(name,'r10_viewer_catalog');assert.equal(args.p_quest_id,questId);return failed?{data:null,error:{message:'inert unavailable'}}:{data:{businessId:id(2),questId,items:[viewer],selected:viewer},error:null};};
 return{...w,read:()=>w.server.loadConsoleBrowserWorkspace(w.context,{businessId:id(2),workflowRunId:selectedRun})};
}
function html(data){const m=loadBrowserSource('src/components/console/console-browser-centre.tsx',{'@/browser/console-view':contract,'./console-browser-centre.css':{}});return renderToStaticMarkup(React.createElement(m.ConsoleBrowserCentre,{mode:'browser',data},'Overview'));}
test('R10 exact scoped loader retains selected viewer alongside same-Business other-Quest legacy sessions',async()=>{
 const w=setup(),data=await w.read();assert.equal(data.status,'ready');assert.equal(data.viewer.sessionId,sessionId);assert.equal(data.selectedSession.id,sessionId);assert.equal(data.sessions.length,1);assert.equal(data.truncated,true);assert.match(html(data),/Controlled public qualification/);assert.match(html(data),/>Watch</);
});
test('R10 explicit wrong-Quest selection rejects rather than silently selecting enrolled viewer',async()=>{
 const data=await setup({selectedRun:fixture().run.id}).read();assert.equal(data.status,'invalid_selection');assert.equal(data.viewer,undefined);assert.doesNotMatch(html(data),/>Watch</);
});
test('R10 catalog failure renders unavailable instead of falsely claiming no browser session',async()=>{
 const data=await setup({failed:true,legacy:false}).read();assert.equal(data.status,'ready');assert.equal(data.viewerUnavailable,true);assert.equal(data.viewer,undefined);const output=html(data);assert.match(output,/Safe-viewing records unavailable/);assert.doesNotMatch(output,/No browser session for this run|>Watch</);
});
test('R10 scoped legacy omission never swallows actual workflow read failures',async()=>{
 const data=await setup({failedRuns:true}).read();assert.equal(data.status,'unavailable');assert.equal(data.viewer,undefined);assert.doesNotMatch(html(data),/>Watch</);
});
