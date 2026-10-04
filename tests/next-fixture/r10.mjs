/** Only the disposable Next fixture imports this in-memory authority. It grants
 * no provider or production credentials, and holds no saved/native endpoints. */
import {id} from './data.mjs';
export const R10_POLICY='r10.controlled-public.v1';
export const R10_SOURCE_HASH='b'.repeat(64);
export const r10Scope={sessionId:id(910001),businessId:id(1),questId:id(820000),workflowRunId:id(910002)};
export function seedViewerFixture(state){
 if(!state.db.workflow_runs.some(run=>run.id===r10Scope.workflowRunId))state.db.workflow_runs.push({...state.db.workflow_runs.find(run=>run.business_id===id(1)),id:r10Scope.workflowRunId,business_id:id(1),goal_id:r10Scope.questId,workflow_definition_id:'a1100000-0000-4000-8000-000000000002',status:'queued'});
 return {scope:{...r10Scope},status:'available',expiresAt:new Date(Date.now()+120_000).toISOString(),writerId:null,contextId:null,pageId:null,permits:0,close:false};
}
const error=message=>({data:null,error:{message,code:'42501'}});
export function viewerSummary(state){const v=state.viewer;if(!v)return null;return {...v.scope,status:Date.parse(v.expiresAt)<=Date.now()&&!v.close?'expired':v.status,expiresAt:v.expiresAt,updatedAt:new Date().toISOString(),policyVersion:R10_POLICY,streamClosure:v.close?'acknowledged':'unconfirmed'};}
function matches(scope,args){return scope.businessId===args.p_business_id&&scope.questId===args.p_quest_id&&(!args.p_workflow_run_id||scope.workflowRunId===args.p_workflow_run_id)&&(!args.p_session_id||scope.sessionId===args.p_session_id);}
export function readViewerFixture(state,name,args,effects,control){
 if(!state.viewer){if(name==='r10_viewer_catalog')return {data:{businessId:args.p_business_id,questId:args.p_quest_id,items:[],selected:null},error:null};return {data:null,error:null};}
 const v=state.viewer;
 if(!matches(v.scope,{...args,p_workflow_run_id:null,p_session_id:null}))return name==='r10_viewer_catalog'?{data:{businessId:args.p_business_id,questId:args.p_quest_id,items:[],selected:null},error:null}:error('Inert viewer scope rejected');
 if(name==='r10_viewer_catalog')return {data:{businessId:args.p_business_id,questId:args.p_quest_id,items:[viewerSummary(state)],selected:args.p_workflow_run_id===v.scope.workflowRunId?viewerSummary(state):null},error:null};
 if(!matches(v.scope,args))return error('Inert viewer scope rejected');
 if(name!=='r10_viewer_owner'||!['read','revoke'].includes(args.p_operation))return error('Inert viewer operation rejected');
 if(args.p_operation==='revoke'){
  v.status=v.close?'revoked':'revocation_pending';effects.push({kind:'in-memory-viewer',operation:'revoke',sessionId:v.scope.sessionId});
  if(control.viewerRevokeUnavailable)return error('Inert revocation unavailable');
 }
 return {data:viewerSummary(state),error:null};
}
export function viewerAuthorityFixture(state,input,effects,control){
 const v=state.viewer;
 if(!v||Object.entries(v.scope).some(([key,value])=>input.scope?.[key]!==value))throw Error('Inert viewer exact scope rejected');
 const op=input.operation,p=input.payload??{};
 effects.push({kind:'in-memory-viewer',operation:op,sessionId:v.scope.sessionId});
 if(op==='read')return viewerSummary(state);
 if(op==='claim'){
  if(v.writerId||v.status!=='available'||Date.parse(v.expiresAt)<=Date.now())throw Error('Inert one-shot viewer exhausted');
  v.writerId=p.writerId;v.status='starting';return {...viewerSummary(state),allowed:true,epoch:1,sourceHash:R10_SOURCE_HASH,serverNow:new Date().toISOString(),timeoutMs:Math.floor(Date.parse(v.expiresAt)-Date.now())};
 }
 if(p.writerId!==v.writerId)throw Error('Inert viewer writer fenced');
 if(op==='close'){
  if(control.viewerCloseUnconfirmed)return viewerSummary(state);
  v.close=true;v.status=v.status==='revocation_pending'?'revoked':p.outcome==='ended'?'ended':'unavailable';return viewerSummary(state);
 }
 if(['revoke','suspend'].includes(op)){v.status='revocation_pending';return viewerSummary(state);}
 if(!['starting','watching'].includes(v.status)||Date.parse(v.expiresAt)<=Date.now())return {allowed:false,...viewerSummary(state)};
 if(op==='create_dispatched'||op==='created')return {...viewerSummary(state),allowed:true};
 if(op==='attest'){v.status='watching';v.contextId=p.contextId;v.pageId=p.pageId;return {...viewerSummary(state),allowed:true};}
 if(op==='permit'){
  if(p.epoch!==1||p.contextId!==v.contextId||p.pageId!==v.pageId||control.viewerPermitDenied)return {allowed:false};
  v.permits++;return {allowed:true,epoch:1,serverNow:new Date().toISOString(),leaseUntil:new Date(Math.min(Date.now()+1_900,Date.parse(v.expiresAt))).toISOString()};
 }
 throw Error('Inert viewer unknown authority operation');
}
