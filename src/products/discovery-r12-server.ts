import "server-only";
import { createHash, createHmac, randomUUID } from "node:crypto";
import type { OwnerUiContext } from "../lib/core-ui/data";
import { verifyOwnerBusiness } from "../lib/core-ui/owner-business";
import { compileQuestPlan } from "../core/quest-plan";
import { driveQuestOnce, type QuestAdapter, type QuestTickResult } from "../core/quest-controller";
import { discoveryV2Hash } from "./discovery-v2";
import { buildDiscoveryR12PhaseRequest, projectDiscoveryR12Phase, readDiscoveryR12PhaseInputs } from "./discovery-r12-runtime";
import { DiscoveryR12ReceiptPending, type DiscoveryR12EffectStore } from "./discovery-r12-adapter";
import type { DiscoveryR12ExecutionQuote } from "./discovery-r12-quote";
import type { DiscoveryR12ExecutionScope } from "./discovery-r12-review-continuation";
import { DISCOVERY_R12_PHASES, type DiscoveryR12Phase } from "./discovery-r12-wire";
import { discoveryR12ServerDependencies } from "./discovery-r12-server-dependencies";
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fail=():never=>{throw Error('r12_discovery_owner_action_unavailable');};
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
async function owned(context:OwnerUiContext,businessId:string,scopeId:string){
 if(!id(businessId)||!id(scopeId)||!id(context.userId)||!await verifyOwnerBusiness(context,businessId))return fail();
 const claims=await context.supabase.auth.getClaims();if(claims.error||claims.data?.claims?.sub!==context.userId)return fail();
}
function keys(context:OwnerUiContext,businessId:string,scopeId:string){
 const root=process.env.R05_ADMISSION_SERVER_KEY?.trim();
 if(process.env.VERCEL_ENV!=='production'||!root||root.length<32||root.length>200||!process.env.OPENROUTER_API_KEY?.trim())return fail();
 const derive=(role:string)=>createHmac('sha256',root).update(JSON.stringify({version:'r12.scoped-authority.1',role,businessId,ownerId:context.userId,scopeId})).digest('base64url');
 return{controllerKey:derive('controller'),admissionKey:derive('admission')};
}
/** Nonsecret preparation only. The operator must separately approve/register
 * exact expiring verifier hashes; this creates no persistent authority. */
export async function prepareDiscoveryR12Authority(context:OwnerUiContext,businessId:string,scopeId:string){
 await owned(context,businessId,scopeId);const authority=keys(context,businessId,scopeId);
 return{controllerKeyHash:sha(authority.controllerKey),admissionKeyHash:sha(authority.admissionKey),authorityCreated:false as const};
}
export async function continueDiscoveryR12(context:OwnerUiContext,businessId:string,scopeId:string):Promise<QuestTickResult>{
 await owned(context,businessId,scopeId);const authority=keys(context,businessId,scopeId);
 const read=await context.supabase.rpc('r12_discovery_owner_read',{p_business_id:businessId,p_scope_id:scopeId,p_activation:true});
 const row=read.data;if(read.error||!object(row)||row.businessId!==businessId||row.scopeId!==scopeId||!object(row.activation))return fail();
 const activation=row.activation;
 if(activation.mode!=='qualification'||activation.controllerKeyHash!==sha(authority.controllerKey)||activation.admissionKeyHash!==sha(authority.admissionKey)||!Array.isArray(activation.operations)||!object(activation.scope))return fail();
 const scope=activation.scope as DiscoveryR12ExecutionScope,plan=compileQuestPlan(activation.plan);
 if(scope.id!==scopeId||scope.businessId!==businessId||scope.goalId!==row.goalId||plan.businessId!==businessId||plan.goalId!==scope.goalId||plan.discoveryScopeId!==scopeId||plan.discoveryScopeHash!==discoveryV2Hash(scope))return fail();
 const dependencies=discoveryR12ServerDependencies(),controller=dependencies.createController(businessId,scope.goalId,authority),client=dependencies.createClient();
 const operation:DiscoveryR12EffectStore['operation']=async(attemptId,operation,payload)=>{
  const response=await client.rpc('r12_discovery_server',{p_business_id:businessId,p_attempt_id:attemptId,p_operation:operation,p_payload:payload,p_server_key:authority.controllerKey});
  if(response.error||!object(response.data))return fail();return response.data;
 };
 const effects:DiscoveryR12EffectStore={operation,settle:async(attemptId,settlement)=>{await controller.command('settle',{attemptId,settlement});},dispatchedAt:async attemptId=>{const data=await operation(attemptId,'load',{});if(typeof data.dispatchedAt!=='string'||!Number.isFinite(Date.parse(data.dispatchedAt)))return fail();return data.dispatchedAt;}};
 let quote:DiscoveryR12ExecutionQuote|null=null;
 const freshQuote=async()=>{if(!quote||Date.parse(quote.validUntil)<=Date.now())quote=await dependencies.quote({evidenceContinuation:plan.format==='r12.discovery-evidence.1',focusedPilot:plan.format==='r12.discovery-pilot.1'});return quote;};
 const adapters:Record<string,QuestAdapter>={};
 for(const step of plan.steps){
  if(!DISCOVERY_R12_PHASES.includes(step.key as DiscoveryR12Phase))return fail();
  const operationScope=activation.operations.find(value=>object(value)&&value.operationKey===step.operationKey);
  if(!object(operationScope)||!Array.isArray(operationScope.dataClasses)||operationScope.dataClasses.some(value=>typeof value!=='string'))return fail();
  adapters[step.adapter]=dependencies.createAdapter({scope,phase:step.key as DiscoveryR12Phase,identity:{qualificationHash:step.qualificationHash,workflowDefinitionId:step.workflowDefinitionId,workerDefinitionId:step.workerDefinitionId,mode:'qualification'},dataClasses:operationScope.dataClasses as string[],store:effects,
   request:async ctx=>buildDiscoveryR12PhaseRequest(ctx,readDiscoveryR12PhaseInputs(ctx,await operation(ctx.attempt.id,'inputs',{}))),quote:freshQuote,
   project:async(qualified,ctx,request)=>projectDiscoveryR12Phase(ctx,readDiscoveryR12PhaseInputs(ctx,await operation(ctx.attempt.id,'inputs',{})),qualified,request)});
 }
 const saved=await controller.read();
 if(saved&&saved.planHash!==activation.planHash)return fail();
 if(!saved){
  if(row.activeWindow!==true||plan.format==='r12.discovery-review.1'||plan.format==='r12.discovery-evidence.1')return fail();
  await controller.command('plan',{plan,expectedVersion:0,reason:'Approved bounded nature-shirt discovery',evidenceHash:scope.independentReviewHash});
 }
 const started=Date.now();
 // Existing Core takes one finite transition at a time. This request can make
 // at most the approved five effects; pause/receipt-wait returns to the owner.
 // Stop starting transitions at 200s, leaving room for the bounded 45s model
 // transport, 20s receipt and persistence within the 300s dashboard limit.
 for(let transitions=0;transitions<24&&Date.now()-started<200000;transitions++){
  try{const result=await driveQuestOnce(controller,{adapters,reconcile:true});if(result.status!=='progress')return result;}
  catch(error){if(error instanceof DiscoveryR12ReceiptPending){const wake=error.receipt.nextCheckAt;return{status:'waiting',reason:'receipt_pending',...(typeof wake==='string'?{wakeAt:wake}:{})};}throw error;}
 }
 return{status:'waiting',reason:'continue_saved_progress'};
}
/** Stop is key-free and uses the already established owner financial control. */
export async function stopDiscoveryR12(context:OwnerUiContext,businessId:string,scopeId:string){
 await owned(context,businessId,scopeId);
 const loaded=await context.supabase.rpc('r12_discovery_owner_read',{p_business_id:businessId,p_scope_id:scopeId,p_activation:true});
 if(loaded.error||!object(loaded.data))return fail();
 if(loaded.data.activation===null&&loaded.data.state==='awaiting_authority'){
  // A confirmed recovery policy can be stopped before any verifier enrollment.
  // The existing owner API revokes only the exact policy; it grants no access.
  const prepared=await context.supabase.rpc('r12_review_owner_read',{p_business_id:businessId,p_scope_id:scopeId});
  if(prepared.error)return fail();
  const {parseR12ReviewOwnerWorkspace}=await import('./discovery-r12-review-preparation-contract');
  const workspace=parseR12ReviewOwnerWorkspace(prepared.data,businessId,scopeId,context.userId);
  if(workspace.successor?.authorization.version!=='r12.focused-pilot-unsent-recovery-authorization.1'||!workspace.confirmation)return fail();
  const {policyId,policyHash}=workspace.confirmation;
  const stopped=await context.supabase.rpc('r05_policy_owner',{p_business_id:businessId,p_operation:'revoke',p_payload:{policyId,policyHash},p_submission_id:randomUUID()});
  if(stopped.error||!object(stopped.data)||stopped.data.id!==policyId||stopped.data.status!=='revoked')return fail();
  const checked=await context.supabase.rpc('r05_admission_read',{p_business_id:businessId,p_policy_id:policyId,p_limit:1,p_offset:0});
  if(checked.error||!object(checked.data)||!Array.isArray(checked.data.policies)||checked.data.policies.length!==1)return fail();
  const policy=checked.data.policies[0];if(!object(policy)||policy.id!==policyId||policy.hash!==policyHash||policy.revoked!==true)return fail();
  return{stopped:true as const};
 }
 if(!object(loaded.data.activation)||!object(loaded.data.activation.plan)||!id(loaded.data.activation.plan.policyId))return fail();
 const stopped=await context.supabase.rpc('r05_policy_owner',{p_business_id:businessId,p_operation:'revoke',p_payload:{policyId:loaded.data.activation.plan.policyId,policyHash:loaded.data.activation.plan.policyHash},p_submission_id:randomUUID()});
 if(stopped.error)return fail();
 const after=await context.supabase.rpc('r12_discovery_owner_read',{p_business_id:businessId,p_scope_id:scopeId,p_activation:false});
 if(after.error||!object(after.data)||after.data.policyRevoked!==true)return fail();return{stopped:true as const};
}
