/** Only the disposable Next fixture imports this in-memory authority. It grants
 * no provider or production credentials, and holds no saved/native endpoints. */
import {id,time} from './data.mjs';
export const R10_POLICY='r10.controlled-public.v1';
export const R10_SOURCE_HASH='b'.repeat(64);
export const R10_FIXTURE_SVG=`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
<rect width="960" height="540" fill="#f0f5f7"/><rect x="44" y="40" width="872" height="460" rx="24" fill="#fff" stroke="#2d7b86" stroke-width="3"/>
<circle cx="100" cy="101" r="28" fill="#207981"/><path d="m86 101 10 10 20-24" fill="none" stroke="white" stroke-width="6"/>
<g font-family="sans-serif" fill="#163340"><text x="150" y="92" font-size="30" font-weight="bold">Controlled public qualification</text><text x="150" y="126" font-size="19">Read-only screenshot stream</text>
<text x="82" y="208" font-size="25">A fixed, nonsensitive public document</text><text x="82" y="253" font-size="21">No account, personal content or external requests</text>
<rect x="82" y="300" width="235" height="82" rx="12" fill="#e1f1ed"/><rect x="362" y="300" width="235" height="82" rx="12" fill="#dcecf5"/><rect x="642" y="300" width="235" height="82" rx="12" fill="#fff0cc"/>
<text x="112" y="348" font-size="21">1 · Isolated source</text><text x="395" y="348" font-size="21">2 · Read-only view</text><text x="676" y="348" font-size="21">3 · Bounded stop</text>
<text x="82" y="451" font-size="18" fill="#526675">SYNTHETIC UI FIXTURE · NO PROVIDER SESSION</text></g></svg>`;

export const r10Scope={sessionId:id(910001),businessId:id(1),questId:id(820000),workflowRunId:id(910002)};
export const r10Lineage={definitionId:'a1100000-0000-4000-8000-000000000002',workerDefinitionId:'a1100000-0000-4000-8000-000000000003',taskId:id(910030),workerRunId:id(910031),auditArtifactId:id(910032),eventId:id(910033)};
export const r10LegacyScopes={
 sameQuest:{sessionId:id(910010),workflowRunId:id(910011),questId:r10Scope.questId},
 otherQuest:{sessionId:id(910020),workflowRunId:id(910021),questId:id(820001)},
};
export function seedViewerFixture(state){
 // Business-wide legacy sessions deliberately coexist with the Quest-scoped R10
 // source. The other-Quest row must be filtered after the scoped run lookup.
 const original=state.db.workflow_runs.find(run=>run.business_id===r10Scope.businessId);
 for(const legacy of Object.values(r10LegacyScopes)){
  if(!state.db.workflow_runs.some(run=>run.id===legacy.workflowRunId))state.db.workflow_runs.push({...original,id:legacy.workflowRunId,business_id:r10Scope.businessId,goal_id:legacy.questId,workflow_definition_id:id(902),status:'running'});
  if(!state.db.browser_sessions.some(session=>session.id===legacy.sessionId))state.db.browser_sessions.push({id:legacy.sessionId,business_id:r10Scope.businessId,workflow_run_id:legacy.workflowRunId,status:'live',updated_at:time,provider_session_id:'INERT_PRIVATE_LEGACY_PROVIDER',current_url:'https://example.invalid/private-legacy',metadata:{fixtureOnly:true}});
 }
 if(!state.db.workflow_definitions.some(definition=>definition.id===id(902)))state.db.workflow_definitions.push({id:id(902),workflow_key:'browser.planner.qualification',version:'1.0.0',name:'Legacy browser planner qualification',status:'active',stage_definition:[]});
 if(!state.db.workflow_definitions.some(definition=>definition.id==='a1100000-0000-4000-8000-000000000002'))state.db.workflow_definitions.push({id:'a1100000-0000-4000-8000-000000000002',workflow_key:'r10.public-viewer',version:'1.0.0',name:'Controlled public viewer qualification',status:'experimental',stage_definition:[]});
 if(!state.db.workflow_runs.some(run=>run.id===r10Scope.workflowRunId))state.db.workflow_runs.push({...state.db.workflow_runs.find(run=>run.business_id===id(1)),id:r10Scope.workflowRunId,business_id:id(1),goal_id:r10Scope.questId,workflow_definition_id:'a1100000-0000-4000-8000-000000000002',status:'queued',input:{},state:{},started_at:null,completed_at:null,current_stage_key:null,runtime_provider:'inert',runtime_run_id:null});
 const stamp=new Date().toISOString();
 const run=state.db.workflow_runs.find(row=>row.id===r10Scope.workflowRunId);Object.assign(run,{status:'queued',started_at:null,completed_at:null,current_stage_key:null,state:{},created_at:stamp,updated_at:stamp});
 if(!state.db.worker_definitions.some(row=>row.id===r10Lineage.workerDefinitionId))state.db.worker_definitions.push({id:r10Lineage.workerDefinitionId,name:'Controlled public capture worker',worker_key:'r10.controlled-capture',version:'1.0.0',role:'read-only capture',status:'experimental'});
 const task={id:r10Lineage.taskId,business_id:r10Scope.businessId,workflow_run_id:r10Scope.workflowRunId,workflow_stage_run_id:null,worker_definition_id:r10Lineage.workerDefinitionId,status:'ready',objective:'Render the fixed reviewed public R10 source, relay only bounded read-only frames, then acknowledge producer drain.',permitted_capabilities:['browser.observe'],input:{},created_at:stamp,updated_at:stamp};
 const worker={id:r10Lineage.workerRunId,business_id:r10Scope.businessId,workflow_run_id:r10Scope.workflowRunId,task_contract_id:r10Lineage.taskId,worker_definition_id:r10Lineage.workerDefinitionId,status:'queued',started_at:null,completed_at:null,output:{},failure:null,execution_metadata:{},created_at:stamp,updated_at:stamp};
 for(const [table,row]of [['task_contracts',task],['worker_runs',worker]]){const existing=state.db[table].find(item=>item.id===row.id);if(existing)Object.assign(existing,row);else state.db[table].push(row);}
 // resetViewer resets this inert enrollment only; normal reads never manufacture receipts.
 state.db.artifacts=state.db.artifacts.filter(row=>row.id!==r10Lineage.auditArtifactId);state.db.events=state.db.events.filter(row=>row.id!==r10Lineage.eventId);
 return {scope:{...r10Scope},status:'available',expiresAt:new Date(Date.now()+120_000).toISOString(),writerId:null,contextId:null,pageId:null,permits:0,close:false};
}
function projectViewerClaim(state){
 const stamp=new Date().toISOString();Object.assign(state.db.workflow_runs.find(row=>row.id===r10Scope.workflowRunId),{status:'running',started_at:stamp,current_stage_key:'controlled_capture',updated_at:stamp});
 Object.assign(state.db.task_contracts.find(row=>row.id===r10Lineage.taskId),{status:'running',updated_at:stamp});Object.assign(state.db.worker_runs.find(row=>row.id===r10Lineage.workerRunId),{status:'running',started_at:stamp,updated_at:stamp});
}
function projectViewerClose(state,payload){
 const captured=payload.capturedFrames,delivered=payload.deliveredFrames;
 if(!Number.isInteger(captured)||captured<0||captured>120||!Number.isInteger(delivered)||delivered<0||delivered>captured)throw Error('Inert closure counts rejected');
 const stamp=new Date().toISOString(),status=payload.outcome==='ended'?'completed':'failed',v=state.viewer;
 const audit={format:'r10.close-audit.v1',...r10Scope,taskContractId:r10Lineage.taskId,workerRunId:r10Lineage.workerRunId,policyVersion:R10_POLICY,sourceHash:R10_SOURCE_HASH,capturedFrames:captured,deliveredFrames:delivered,permitsIssued:v.permits,createDispatched:Boolean(v.dispatched),closeOutcome:payload.outcome,closedAt:stamp,streamClosure:'acknowledged',providerReceiptHash:payload.providerReceiptHash??null,releaseResult:payload.releaseResult,closureAuthority:'writer_acknowledgement',recoveryEvidenceHash:null,liabilityStatus:v.dispatched?'unknown':'not_dispatched',actualMicrounits:null};
 state.db.artifacts.push({id:r10Lineage.auditArtifactId,business_id:r10Scope.businessId,workflow_run_id:r10Scope.workflowRunId,task_contract_id:r10Lineage.taskId,artifact_type:'r10.viewer.close-audit',name:'Controlled public viewer closure audit',media_type:'application/json',storage_path:null,checksum:null,metadata:{},content:audit,created_at:stamp,updated_at:stamp});
 Object.assign(state.db.workflow_runs.find(row=>row.id===r10Scope.workflowRunId),{status,completed_at:stamp,current_stage_key:'closed',state:{policyVersion:R10_POLICY,viewerAuditArtifactId:r10Lineage.auditArtifactId,streamClosure:'acknowledged'},updated_at:stamp});
 Object.assign(state.db.task_contracts.find(row=>row.id===r10Lineage.taskId),{status,updated_at:stamp});Object.assign(state.db.worker_runs.find(row=>row.id===r10Lineage.workerRunId),{status,completed_at:stamp,output:{auditArtifactId:r10Lineage.auditArtifactId,capturedFrames:captured,deliveredFrames:delivered,streamClosure:'acknowledged'},updated_at:stamp});
 state.db.events.push({id:r10Lineage.eventId,business_id:r10Scope.businessId,workflow_run_id:r10Scope.workflowRunId,event_type:'r10.viewer.closed',actor_type:'worker',actor_id:r10Lineage.workerRunId,payload:{auditArtifactId:r10Lineage.auditArtifactId,streamClosure:'acknowledged',capturedFrames:captured,deliveredFrames:delivered},occurred_at:stamp,created_at:stamp});
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
  v.writerId=p.writerId;v.status='starting';projectViewerClaim(state);return {...viewerSummary(state),allowed:true,epoch:1,sourceHash:R10_SOURCE_HASH,serverNow:new Date().toISOString(),timeoutMs:Math.floor(Date.parse(v.expiresAt)-Date.now())};
 }
 if(p.writerId!==v.writerId)throw Error('Inert viewer writer fenced');
 if(op==='close'){
  if(control.viewerCloseUnconfirmed||v.close)return viewerSummary(state);
  projectViewerClose(state,p);v.close=true;v.status=v.status==='revocation_pending'?'revoked':p.outcome==='ended'?'ended':'unavailable';return viewerSummary(state);
 }
 if(['revoke','suspend'].includes(op)){v.status='revocation_pending';return viewerSummary(state);}
 if(!['starting','watching'].includes(v.status)||Date.parse(v.expiresAt)<=Date.now())return {allowed:false,...viewerSummary(state)};
 if(op==='create_dispatched'){v.dispatched=true;return {...viewerSummary(state),allowed:true};}
 if(op==='created')return {...viewerSummary(state),allowed:true};
 if(op==='attest'){v.status='watching';v.contextId=p.contextId;v.pageId=p.pageId;return {...viewerSummary(state),allowed:true};}
 if(op==='permit'){
  if(p.epoch!==1||p.contextId!==v.contextId||p.pageId!==v.pageId||control.viewerPermitDenied)return {allowed:false};
  v.permits++;return {allowed:true,epoch:1,serverNow:new Date().toISOString(),leaseUntil:new Date(Math.min(Date.now()+1_900,Date.parse(v.expiresAt))).toISOString()};
 }
 throw Error('Inert viewer unknown authority operation');
}
