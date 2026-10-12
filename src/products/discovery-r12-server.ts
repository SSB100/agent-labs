import { podExecutingRelease } from "./discovery-r12-pod-release";
import { isPodResearchGoalScope, validatePodResearchGoalScope } from "./discovery-r12-pod-goal";
import { validatePodQuestPlan } from "./discovery-r12-pod-runtime";
import type { PodRecoveryContext } from "./discovery-r12-pod-recovery";
import "server-only";
import { createHash, createHmac, randomUUID } from "node:crypto";
import type { OwnerUiContext } from "../lib/core-ui/data";
import { verifyOwnerBusiness } from "../lib/core-ui/owner-business";
import { awaitRequestDeadline, boundedRpc, deadlineFetch, requestDeadline } from "../core/request-deadline";
import { compileQuestPlan } from "../core/quest-plan";
import { driveQuestOnce, type QuestAdapter, type QuestTickResult } from "../core/quest-controller";
import { discoveryV2Hash } from "./discovery-v2";
import { buildDiscoveryR12PhaseRequest, projectDiscoveryR12Phase, readDiscoveryR12PhaseInputs } from "./discovery-r12-runtime";
import { DiscoveryR12ReceiptPending, type DiscoveryR12EffectStore } from "./discovery-r12-adapter";
import type { DiscoveryR12ExecutionQuote } from "./discovery-r12-quote";
import type { DiscoveryR12ExecutionScope } from "./discovery-r12-review-continuation";
import { DISCOVERY_R12_PHASES, type DiscoveryR12Phase } from "./discovery-r12-wire";
import { discoveryR12ServerDependencies } from "./discovery-r12-server-dependencies";
import { validateR12FocusedSuccessor } from "./discovery-r12-focused-successor";
import { isDiscoveryOwnerEpisodeScope, validateDiscoveryOwnerEpisodeScope, validateOwnerEpisodePlan } from "./discovery-r12-owner-episode";
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fail=():never=>{throw Error('r12_discovery_owner_action_unavailable');};
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
async function owned(context:OwnerUiContext,businessId:string,scopeId:string){
 if(!id(businessId)||!id(scopeId)||!id(context.userId)||!await verifyOwnerBusiness(context,businessId))return fail();
 const claims=await context.supabase.auth.getClaims();if(claims.error||claims.data?.claims?.sub!==context.userId)return fail();
}
function keysForOwner(ownerId:string,businessId:string,scopeId:string){
 const root=process.env.R05_ADMISSION_SERVER_KEY?.trim();
 if(process.env.VERCEL_ENV!=='production'||!root||root.length<32||root.length>200||!process.env.OPENROUTER_API_KEY?.trim())return fail();
 const derive=(role:string)=>createHmac('sha256',root).update(JSON.stringify({version:'r12.scoped-authority.1',role,businessId,ownerId,scopeId})).digest('base64url');
 return{controllerKey:derive('controller'),admissionKey:derive('admission')};
}
/** Nonsecret preparation only. The operator must separately approve/register
 * exact expiring verifier hashes; this creates no persistent authority. */
export async function prepareDiscoveryR12Authority(context:OwnerUiContext,businessId:string,scopeId:string){
 await owned(context,businessId,scopeId);const authority=keysForOwner(context.userId,businessId,scopeId);
 return{controllerKeyHash:sha(authority.controllerKey),admissionKeyHash:sha(authority.admissionKey),authorityCreated:false as const};
}
export async function continueDiscoveryR12(context:OwnerUiContext,businessId:string,scopeId:string):Promise<QuestTickResult>{
 const requestStarted=Date.now(),requestSignal=requestDeadline(270000);
 await awaitRequestDeadline(owned(context,businessId,scopeId),AbortSignal.any([requestSignal,AbortSignal.timeout(15000)]));const authority=keysForOwner(context.userId,businessId,scopeId);
 const read=await boundedRpc(context.supabase.rpc('r12_discovery_owner_read',{p_business_id:businessId,p_scope_id:scopeId,p_activation:true}),requestSignal,10000);
 const row=read.data;if(read.error||!object(row)||row.businessId!==businessId||row.scopeId!==scopeId||!object(row.activation))return fail();
 return continuePreparedDiscoveryR12(businessId,scopeId,row,authority,requestStarted,requestSignal,context.userId);
}
async function continuePreparedDiscoveryR12(businessId:string,scopeId:string,row:Record<string,unknown>,authority:{controllerKey:string;admissionKey:string},requestStarted:number,requestSignal:AbortSignal,ownerId:string):Promise<QuestTickResult>{
 if(!object(row.activation))return fail();
 const activation=row.activation;
 if(activation.mode!=='qualification'||activation.controllerKeyHash!==sha(authority.controllerKey)||activation.admissionKeyHash!==sha(authority.admissionKey)||!Array.isArray(activation.operations)||!object(activation.scope))return fail();
 const scope=activation.scope as DiscoveryR12ExecutionScope,plan=compileQuestPlan(activation.plan);
 if(scope.id!==scopeId||scope.businessId!==businessId||scope.goalId!==row.goalId||plan.businessId!==businessId||plan.goalId!==scope.goalId||plan.discoveryScopeId!==scopeId||plan.discoveryScopeHash!==discoveryV2Hash(scope))return fail();
 // Historical scope validity permits bounded receipt recovery after dispatch
 // expiry. SQL separately checks current authority before every new send.
 const podRecovery=(row.podRecovery??null) as PodRecoveryContext|null;
 if(isPodResearchGoalScope(scope)){validatePodResearchGoalScope(scope,Date.parse(scope.createdAt));validatePodQuestPlan({plan},scope,podRecovery);}
 if(isDiscoveryOwnerEpisodeScope(scope)){validateDiscoveryOwnerEpisodeScope(scope,Date.parse(scope.createdAt));validateOwnerEpisodePlan(plan,scope);}
 if(row.focusedSuccessor!==undefined&&scope.version!=='r12.discovery-focused-pilot.1')return fail();
 const successor=row.focusedSuccessor===undefined?null:validateR12FocusedSuccessor(row.focusedSuccessor,{businessId,scopeId,goalId:scope.goalId,ownerId,...(scope.version==='r12.discovery-focused-pilot.1'?{scope}:{})});
 const recovery=successor?.authorization.version==='r12.focused-pilot-unsent-recovery-authorization.1'||successor?.authorization.version==='r12.focused-pilot-terminal-qualification-authorization.1';
 const bounded=recovery||isPodResearchGoalScope(scope);
 const dependencies=discoveryR12ServerDependencies(),baseController=dependencies.createController(businessId,scope.goalId,{...authority,...(bounded?{requestSignal}:{}),...(recovery?{recoveryScopeId:scopeId}:{})}),client=dependencies.createClient();
 const passOperation=async(operation:string,payload:Record<string,unknown>={})=>{const result=await boundedRpc(client.rpc('r12_pod_pass_server',{p_business_id:businessId,p_scope_id:scopeId,p_operation:operation,p_payload:payload,p_server_key:authority.controllerKey}),requestSignal,10000);if(result.error)return fail();return result.data;};
 const controller=isPodResearchGoalScope(scope)?{...baseController,command:async(operation:string,payload:Record<string,unknown>,epoch?:number)=>{
 if(operation!=='adaptive_complete_action')return baseController.command(operation,payload,epoch);const result=await passOperation('complete',payload);if(!object(result))return fail();return result;},
 readAdaptiveAction:async()=>{const data=await passOperation('context');if(data===null)return null;if(!object(data))return fail();return data as unknown as import('../core/quest-controller').QuestAdaptiveActionProjection;}}:baseController;
 const operation:DiscoveryR12EffectStore['operation']=async(attemptId,operation,payload)=>{
  const extended=recovery&&['inputs','bind','send'].includes(operation);
  if(bounded)requestSignal.throwIfAborted();
  const query=client.rpc(extended?'r12_recovery_server':'r12_discovery_server',{p_business_id:businessId,...(extended?{p_scope_id:scopeId}:{}),p_attempt_id:attemptId,p_operation:operation,p_payload:payload,p_server_key:authority.controllerKey});
  const response=bounded?await boundedRpc(query,requestSignal,extended||isPodResearchGoalScope(scope)?10000:5000):await query;
  if(response.error||!object(response.data))return fail();return response.data;
 };
 const effects:DiscoveryR12EffectStore={operation,settle:async(attemptId,settlement)=>{await controller.command('settle',{attemptId,settlement});},dispatchedAt:async attemptId=>{const data=await operation(attemptId,'load',{});if(typeof data.dispatchedAt!=='string'||!Number.isFinite(Date.parse(data.dispatchedAt)))return fail();return data.dispatchedAt;}};
 let quote:DiscoveryR12ExecutionQuote|null=null;
 const freshQuote=async()=>{if(!quote||Date.parse(quote.validUntil)<=Date.now())quote=await dependencies.quote({evidenceContinuation:plan.format==='r12.discovery-evidence.1',focusedPilot:plan.format==='r12.discovery-pilot.1',podResearch:isPodResearchGoalScope(scope),...(bounded?{fetch:deadlineFetch(requestSignal)}:{})});return quote;};
 const adapters:Record<string,QuestAdapter>={};
 for(const step of plan.steps){
  if(!DISCOVERY_R12_PHASES.includes(step.key as DiscoveryR12Phase))return fail();
  const operationScope=activation.operations.find(value=>object(value)&&value.operationKey===step.operationKey);
  if(!object(operationScope)||!Array.isArray(operationScope.dataClasses)||operationScope.dataClasses.some(value=>typeof value!=='string'))return fail();
  adapters[step.adapter]=dependencies.createAdapter({...(isPodResearchGoalScope(scope)?{executingRelease:podExecutingRelease(),podRecovery}:{}),scope,phase:step.key as DiscoveryR12Phase,identity:{qualificationHash:step.qualificationHash,workflowDefinitionId:step.workflowDefinitionId,workerDefinitionId:step.workerDefinitionId,mode:'qualification'},dataClasses:operationScope.dataClasses as string[],store:effects,...(bounded?{fetcher:deadlineFetch(requestSignal)}:{}),
   request:async ctx=>buildDiscoveryR12PhaseRequest(ctx,readDiscoveryR12PhaseInputs(ctx,await operation(ctx.attempt.id,'inputs',{}))),quote:freshQuote,
   project:async(qualified,ctx,request)=>projectDiscoveryR12Phase(ctx,readDiscoveryR12PhaseInputs(ctx,await operation(ctx.attempt.id,'inputs',{})),qualified,request)});
 }
 const saved=await controller.read();
 if(saved&&saved.planHash!==activation.planHash)return fail();
 // A new durable step has a new random controller lease token. Never steal or
 // reuse the previous process's live lease: wait, then reconcile its exact work.
 if(isPodResearchGoalScope(scope)&&saved){const expiry=Date.parse(saved.head.leaseExpiresAt);if(Number.isFinite(expiry)&&expiry>Date.now())return{status:'waiting',reason:'controller_lease_pending',wakeAt:new Date(expiry+1000).toISOString()};}
 if(!saved){
  if(row.activeWindow!==true||plan.format==='r12.discovery-review.1'||plan.format==='r12.discovery-evidence.1'||plan.format==='r12.discovery-episode.1')return fail();
  await controller.command('plan',{plan,expectedVersion:0,reason:isPodResearchGoalScope(scope)?'Owner-confirmed public POD product research':scope.version==='r12.discovery-owner-initial.1'?'Owner-confirmed bounded original POD research':'Approved bounded nature-shirt discovery',evidenceHash:isPodResearchGoalScope(scope)?scope.sourcePolicy.independentReviewHash:scope.independentReviewHash});
 }
 // A stopped/expired POD run may cancel only exact unmarked reservations.
 // R07 cancel rechecks the marker atomically; a raced send remains uncertain.
 if(isPodResearchGoalScope(scope)&&row.activeWindow!==true&&saved){
  const unsent=saved.attempts.filter(a=>a.status==='scheduled'||a.status==='reserved');
  if(unsent.length){const lease=await controller.command('claim',{seconds:60});for(const attempt of unsent)await controller.command('cancel',{attemptId:attempt.id,evidenceHash:sha(`pod-stopped-unsent:${scopeId}:${attempt.id}`)},Number(lease.epoch));}
 }
 const started=recovery?requestStarted:Date.now();
 // Existing Core takes one finite transition at a time. Each request has a
 // finite transition chunk; durable POD continuation preserves the run limits.
 // Stop starting transitions at 200s, leaving room for the bounded 45s model
 // transport, 20s receipt and persistence within the 300s dashboard limit.
 // Recovery: 22 RPCs at their caller bounds, catalogs20s, model45s and
 // receipt20s total220s including one renewal/readback. Stop starts at40s,
 // leaving230s before the hard270s caller cancellation (300s host limit).
 // These are finite failure bounds, not a Production latency guarantee.
 const latestTransitionStartMs=bounded?40000:200000;
 for(let transitions=0;transitions<24&&Date.now()-started<latestTransitionStartMs;transitions++){
  try{if(bounded)requestSignal.throwIfAborted();if(isPodResearchGoalScope(scope)&&'readAdaptiveAction' in controller&&!await controller.readAdaptiveAction!()){if(row.activeWindow!==true)return{status:'stopped',reason:'owner_stopped_or_expired'};const next=await passOperation('admit',{quote:await freshQuote()});if(!object(next))return fail();if(next.admitted!==true)return{status:next.completed===true?'completed':next.stopped===true?'stopped':'waiting',reason:typeof next.reason==='string'?next.reason:'pass_not_admitted'};}const work=driveQuestOnce(controller,{adapters,reconcile:true});const result=bounded?await awaitRequestDeadline(work,requestSignal):await work;if(result.status!=='progress')return result;}
  catch(error){if(error instanceof DiscoveryR12ReceiptPending){const wake=error.receipt.nextCheckAt;return{status:'waiting',reason:'receipt_pending',...(typeof wake==='string'?{wakeAt:wake}:{})};}throw error;}
 }
 return{status:'waiting',reason:'continue_saved_progress'};
}
/** The durable runner derives the same role-separated keys inside each step.
 * Its public-only plan was already confirmed by the owner; SQL rechecks every
 * new send and preserves bounded receipt reconciliation after Stop. */
export async function continuePodResearchRuntime(businessId:string,scopeId:string){
 if(!id(businessId)||!id(scopeId))return fail();
 const {podApplicationCapability}=await import('./discovery-r12-pod-server-key');
 const signal=requestDeadline(270000),started=Date.now(),client=discoveryR12ServerDependencies().createClient();
 const read=await boundedRpc(client.rpc('r12_pod_runtime_read',{p_business_id:businessId,p_scope_id:scopeId,p_server_key:podApplicationCapability()}),signal,10000);
 const row=read.data;if(read.error||!object(row)||row.businessId!==businessId||row.scopeId!==scopeId||!id(row.ownerId)||!object(row.activation)||!object(row.activation.scope)||row.activation.scope.version!=='r12.pod-research-goal.2')return fail();
 const result=await continuePreparedDiscoveryR12(businessId,scopeId,row,keysForOwner(row.ownerId,businessId,scopeId),started,signal,row.ownerId);
 return {...result,receiptUntil:String(row.receiptUntil)};
}
/** Stop is key-free and uses the already established owner financial control. */
export async function stopDiscoveryR12(context:OwnerUiContext,businessId:string,scopeId:string,ownerInitial=false){
 await owned(context,businessId,scopeId);
 if(ownerInitial){
  // This exact owner-only revocation does not depend on current source, profile,
  // funding or grant availability. SQL resolves the immutable saved policy.
  const native=await boundedRpc(context.supabase.rpc('r12_owner_research_server',{p_business_id:businessId,p_operation:'stop_scope',p_payload:{scopeId,submissionId:randomUUID()},p_server_key:''}),requestDeadline(20000),15000);
  if(native.error||!object(native.data))return fail();
  if(native.data.matched===true){if(native.data.stopped!==true||native.data.scopeId!==scopeId)return fail();return{stopped:true as const};}
  if(native.data.matched!==false)return fail();
 }
 const loaded=await context.supabase.rpc('r12_discovery_owner_read',{p_business_id:businessId,p_scope_id:scopeId,p_activation:true});
 if(loaded.error||!object(loaded.data))return fail();
 if(loaded.data.activation===null&&loaded.data.state==='awaiting_authority'){
  // A confirmed recovery policy can be stopped before any verifier enrollment.
  // The existing owner API revokes only the exact policy; it grants no access.
  const prepared=await context.supabase.rpc('r12_review_owner_read',{p_business_id:businessId,p_scope_id:scopeId});
  if(prepared.error)return fail();
  const {parseR12ReviewOwnerWorkspace}=await import('./discovery-r12-review-preparation-contract');
  const workspace=parseR12ReviewOwnerWorkspace(prepared.data,businessId,scopeId,context.userId);
  if(!['r12.focused-pilot-unsent-recovery-authorization.1','r12.focused-pilot-terminal-qualification-authorization.1'].includes(workspace.successor?.authorization.version??'')||!workspace.confirmation)return fail();
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
