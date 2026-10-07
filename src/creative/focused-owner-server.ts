import 'server-only';
import type {OwnerUiContext} from '../lib/core-ui/data';
import {verifyOwnerBusiness} from '../lib/core-ui/owner-business';
import {readDiscoveryR12Result} from '../products/discovery-r12-owner';
import {creativeHash} from './contracts';
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const fail=():never=>{throw Error('r12_focused_owner_adoption_unavailable');};
/** The form supplies identities only. The complete accepted result is rebuilt
 * from the owner-only receipt join, then SQL independently checks it again. */
export async function adoptFocusedPilotTest(context:OwnerUiContext,businessId:string,scopeId:string,resultHash:string){
 if(![businessId,scopeId,context.userId].every(id)||!/^[a-f0-9]{64}$/.test(resultHash)||!await verifyOwnerBusiness(context,businessId))return fail();
 const claims=await context.supabase.auth.getClaims();if(claims.error||claims.data?.claims?.sub!==context.userId)return fail();
 const {record:result}=await readDiscoveryR12Result(context,businessId,scopeId);
 if(!result||result.version!=='r12.discovery-focused-pilot-result.1'||result.review.outcome!=='TEST'||creativeHash(result)!==resultHash)return fail();
 const read=await context.supabase.rpc('r12_discovery_owner_read',{p_business_id:businessId,p_scope_id:scopeId,p_activation:true});
 const row=read.data,plan=object(row)&&object(row.activation)?row.activation.plan:null;
 if(read.error||!object(plan)||plan.format!=='r12.discovery-pilot.1'||plan.goalId!==result.goalId||plan.discoveryScopeId!==scopeId||!Number.isSafeInteger(plan.goalRevision)||typeof plan.goalHash!=='string')return fail();
 const ownerIntent={version:'r12.focused-adoption-owner.1',scopeId,profileHash:result.focusedPilotProfileHash,resultHash,goalId:result.goalId,
  goalRevision:plan.goalRevision,goalHash:plan.goalHash,candidateId:result.review.candidateId,learningPlanHash:creativeHash(result.focusedPilot.pinnedLearningPlan),
  originalResearchFundingRootId:result.originalFundingRootId,adoptForPrivateLearning:true,creativeExecutionAuthorized:false};
 const saved=await context.supabase.rpc('adopt_r12_focused_test',{p_scope_id:scopeId,p_result:result,p_owner_intent:ownerIntent});
 if(saved.error||!object(saved.data)||saved.data.executionAuthorized!==false||![saved.data.adoptionId,saved.data.candidateId,saved.data.experimentId,saved.data.decisionId].every(id)||saved.data.candidateId!==result.review.candidateId)return fail();
 return {businessId,candidateId:String(saved.data.candidateId),adoptionId:String(saved.data.adoptionId),executionAuthorized:false as const};
}

export type FocusedRunReceipt={businessId:string;approvalId:string;creativeRunId:string;workflowRunId:string;goalId:string;approvalHash:string;admissionKeyHash:string;runtimeCapabilityHash:string;dispatchAuthorized:false};
async function focusedOwnedApproval(context:OwnerUiContext,approvalId:string){
 if(!id(approvalId)||!id(context.userId))return fail();
 const read=await context.supabase.from('creative_approvals').select('id,business_id,approval_hash,snapshot').eq('id',approvalId).maybeSingle();
 if(read.error||!read.data||!await verifyOwnerBusiness(context,read.data.business_id)||!object(read.data.snapshot)||!object(read.data.snapshot.focusedPilotBinding))return fail();
 const claims=await context.supabase.auth.getClaims();if(claims.error||claims.data?.claims?.sub!==context.userId)return fail();
 return read.data;
}
import {createHash,createHmac} from 'node:crypto';
import {createRuntimeClient} from '../lib/supabase/runtime';
import {start} from 'workflow/api';
import {creativeRuntimeWorkflow} from '../workflows/creative-runtime';
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
function scopedRunKeys(ownerId:string,businessId:string,approvalId:string){
 const root=process.env.R05_ADMISSION_SERVER_KEY?.trim();if(process.env.VERCEL_ENV!=='production'||!root||root.length<32||root.length>200)return fail();
 const derive=(role:string)=>createHmac('sha256',root).update(JSON.stringify({version:'r12.scoped-authority.1',role,businessId,ownerId,scopeId:approvalId})).digest('base64url');
 const n=sha(JSON.stringify(['r12.focused.launch.1',ownerId,businessId,approvalId]));
 return {runtimeCapability:derive('creative-runtime'),admissionKeyHash:sha(derive('admission')),nonce:`${n.slice(0,8)}-${n.slice(8,12)}-5${n.slice(13,16)}-8${n.slice(17,20)}-${n.slice(20,32)}`};
}
/** Creates the existing single Stage14 run/capability, but deliberately does not
 * launch the durable workflow before its separately reviewed scope is sealed. */
export async function prepareFocusedCreativeRun(context:OwnerUiContext,approvalId:string):Promise<FocusedRunReceipt>{
 const a=await focusedOwnedApproval(context,approvalId),keys=scopedRunKeys(context.userId,a.business_id,approvalId);
 const begun=await context.supabase.rpc('begin_creative_run',{p_approval_id:approvalId,p_launch_nonce:keys.nonce,p_runtime_capability:keys.runtimeCapability});
 const row=begun.data;if(begun.error||!object(row)||![row.creativeRunId,row.workflowRunId].every(id)||row.approvalHash!==a.approval_hash)return fail();
 const run=await context.supabase.from('workflow_runs').select('id,business_id,goal_id,runtime_capability_hash,runtime_launch_nonce').eq('id',row.workflowRunId).eq('business_id',a.business_id).maybeSingle();
 if(run.error||!run.data||run.data.runtime_capability_hash!==sha(keys.runtimeCapability)||run.data.runtime_launch_nonce!==keys.nonce||!id(run.data.goal_id))return fail();
 return {businessId:a.business_id,approvalId,creativeRunId:String(row.creativeRunId),workflowRunId:String(row.workflowRunId),goalId:run.data.goal_id,approvalHash:a.approval_hash,
  admissionKeyHash:keys.admissionKeyHash,runtimeCapabilityHash:sha(keys.runtimeCapability),dispatchAuthorized:false};
}
/** A durable once-only claim follows exact scope enrollment. Neither reload nor
 * response loss can silently launch a second workflow or regenerate a phase. */
export async function startFocusedCreativeRun(context:OwnerUiContext,approvalId:string){
 const a=await focusedOwnedApproval(context,approvalId),keys=scopedRunKeys(context.userId,a.business_id,approvalId);
 const read=await context.supabase.from('creative_runs').select('id,business_id,workflow_run_id').eq('approval_id',approvalId).eq('business_id',a.business_id).maybeSingle();
 if(read.error||!read.data||!id(read.data.id)||!id(read.data.workflow_run_id))return fail();
 const run=read.data,claim=await createRuntimeClient().rpc('creative_runtime_transition',{p_creative_run_id:run.id,p_business_id:a.business_id,p_runtime_capability:keys.runtimeCapability,p_operation:'r12_launch_claim',p_payload:{}});
 if(claim.error||!object(claim.data)||typeof claim.data.shouldStart!=='boolean'||claim.data.creativeRunId!==run.id||claim.data.workflowRunId!==run.workflow_run_id||(claim.data.shouldStart&&claim.data.launchNonce!==keys.nonce))return fail();
 if(!claim.data.shouldStart)return {workflowRunId:run.workflow_run_id,started:false};
 try{await start(creativeRuntimeWorkflow,[{businessId:a.business_id,creativeRunId:run.id,coreWorkflowRunId:run.workflow_run_id,runtimeCapability:keys.runtimeCapability}]);}
 catch{await context.supabase.rpc('fail_creative_launch',{p_creative_run_id:run.id,p_launch_nonce:keys.nonce});throw Error('r12_focused_launch_unconfirmed');}
 return {workflowRunId:run.workflow_run_id,started:true};
}
