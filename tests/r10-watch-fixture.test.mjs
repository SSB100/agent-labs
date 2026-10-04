import assert from 'node:assert/strict';
import test from 'node:test';
import {fixtureData,id} from './next-fixture/data.mjs';
import {workspaceSeed,workspaceView} from './next-fixture/workspace.mjs';
import {seedViewerFixture,readViewerFixture,viewerAuthorityFixture,r10Scope} from './next-fixture/r10.mjs';

test('inert R10 catalog matches the production scoped object and exact Quest projection',()=>{
 const state=fixtureData();state.workspace=workspaceSeed(state,id,'2026-10-04T03:00:00.000Z');state.viewer=seedViewerFixture(state);
 const args={p_business_id:r10Scope.businessId,p_quest_id:r10Scope.questId,p_workflow_run_id:r10Scope.workflowRunId};
 const result=readViewerFixture(state,'r10_viewer_catalog',args,[],{});assert.equal(result.error,null);assert.equal(result.data.items.length,1);assert.equal(result.data.selected.sessionId,r10Scope.sessionId);assert.equal(result.data.questId,r10Scope.questId);
 assert.equal(workspaceView(state,'r08_workflow_runs').find(row=>row.id===r10Scope.workflowRunId).quest_id,r10Scope.questId);
 const foreign=readViewerFixture(state,'r10_viewer_catalog',{...args,p_business_id:id(2)},[],{});assert.equal(foreign.data.items.length,0);assert.equal(foreign.data.selected,null);
 assert.equal(readViewerFixture(state,'r10_viewer_owner',{...args,p_session_id:id(9),p_operation:'read'},[],{}).data,null);
});

test('inert R10 one-shot claim, live permit, pending revoke and closure acknowledgement remain distinct',()=>{
 const state=fixtureData();state.viewer=seedViewerFixture(state);const effects=[],scope={...r10Scope},writerId=id(99);
 const call=(operation,payload={})=>viewerAuthorityFixture(state,{scope,operation,payload:{writerId,...payload}},effects,{});
 const claim=call('claim');assert.equal(claim.allowed,true);assert.equal(claim.epoch,1);assert.equal(claim.status,'starting');assert.throws(()=>call('claim'));
 call('attest',{contextId:id(80),pageId:id(81),epoch:1});assert.equal(call('permit',{contextId:id(80),pageId:id(81),epoch:1}).allowed,true);
 const args={p_business_id:scope.businessId,p_quest_id:scope.questId,p_workflow_run_id:scope.workflowRunId,p_session_id:scope.sessionId,p_operation:'revoke'};
 assert.equal(readViewerFixture(state,'r10_viewer_owner',args,effects,{}).data.status,'revocation_pending');assert.equal(call('permit',{contextId:id(80),pageId:id(81),epoch:1}).allowed,false);
 assert.equal(call('close',{outcome:'ended',releaseResult:'released'}).status,'revoked');assert.equal(state.viewer.close,true);
 assert.ok(effects.every(row=>row.kind==='in-memory-viewer'));assert.equal('endpoint' in claim,false);
});
