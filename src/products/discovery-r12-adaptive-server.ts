import "server-only";
import type { AdaptiveFundingProof } from "./discovery-r12-adaptive-funding-proof";
import { createHash, createHmac } from "node:crypto";
import type { OwnerUiContext } from "../lib/core-ui/data";
import { verifyOwnerBusiness } from "../lib/core-ui/owner-business";
import { awaitRequestDeadline, boundedRpc, deadlineFetch, requestDeadline } from "../core/request-deadline";
import { compileQuestPlan } from "../core/quest-plan";
import { driveQuestOnce, type QuestAdapter, type QuestAdaptiveActionProjection, type QuestTickResult } from "../core/quest-controller";
import { discoveryV2Hash } from "./discovery-v2";
import { DiscoveryR12ReceiptPending, type DiscoveryR12EffectStore } from "./discovery-r12-adapter";
import { discoveryR12ServerDependencies } from "./discovery-r12-server-dependencies";
import { validateAdaptiveExecutionScope, type DiscoveryAdaptiveOwnerScope } from "./discovery-r12-adaptive-execution-scope";
import { validateAdaptiveResearchPlan, type AdaptiveResearchPreview } from "./discovery-r12-adaptive-scope";
import { validateAdaptiveExecutionQuote, type AdaptiveResearchQuote } from "./discovery-r12-adaptive-quote";
import { readAdaptivePhaseInputs, projectAdaptivePhaseResponse } from "./discovery-r12-adaptive-inputs";
import { buildAdaptivePhaseRequest } from "./discovery-r12-adaptive-runtime";
import { DISCOVERY_R12_PHASES, type DiscoveryR12Phase } from "./discovery-r12-wire";
import { validateAdaptiveReceiptResume } from "./discovery-r12-adaptive-receipt-recovery";

const id = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const object = (v: unknown): v is Record<string,unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const fail = (): never => { throw new Error("r12_adaptive_execution_unavailable"); };
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

/** Executes only SQL-admitted actions. A browser supplies owned identity, never
 * a question, wire, model, action counter, budget or completion assertion. */
export async function continueAdaptiveOwnerResearch(context: OwnerUiContext,businessId: string,scopeId: string,mode:"research"|"receipt_only"="research"): Promise<QuestTickResult> {
  let stage="owner_identity";
  try {
  const started=Date.now(),signal=requestDeadline(270_000);
  if (!["research","receipt_only"].includes(mode)) return fail();
  if (!id(businessId) || !id(scopeId) || !id(context.userId) ||
      !await awaitRequestDeadline(verifyOwnerBusiness(context,businessId),AbortSignal.any([signal,AbortSignal.timeout(15_000)]))) return fail();
  stage="owner_claims";
  const claims=await context.supabase.auth.getClaims();
  if (claims.error || claims.data?.claims?.sub !== context.userId) return fail();
  stage="environment";
  const root=process.env.R05_ADMISSION_SERVER_KEY?.trim();
  if (process.env.VERCEL_ENV !== "production" || !root || root.length < 32 || root.length > 200 || !process.env.OPENROUTER_API_KEY?.trim()) return fail();
  const derive=(role:string)=>createHmac("sha256",root).update(JSON.stringify({version:"r12.scoped-authority.1",role,businessId,ownerId:context.userId,scopeId})).digest("base64url");
  const authority={controllerKey:derive("controller"),admissionKey:derive("admission")};
  stage="activation_read";
  const read=await boundedRpc(context.supabase.rpc("r12_discovery_owner_read",{p_business_id:businessId,p_scope_id:scopeId,p_activation:true}),signal,10_000);
  const row=read.data;
  if (read.error || !object(row) || row.businessId !== businessId || row.scopeId !== scopeId || !object(row.activation)) return fail();
  stage="activation_authority";
  const a=row.activation;
  if (a.mode !== "qualification" || a.controllerKeyHash !== sha(authority.controllerKey) || a.admissionKeyHash !== sha(authority.admissionKey) ||
      !object(a.scope) || !object(a.preview) || !object(a.quote) || !Array.isArray(a.operations)) return fail();
  stage="activation_scope";
  const scope=a.scope as DiscoveryAdaptiveOwnerScope,preview=a.preview as AdaptiveResearchPreview;
  if (!["r12.discovery-owner-adaptive.1","r12.discovery-owner-adaptive.2"].includes(scope.version) || scope.id !== scopeId || scope.businessId !== businessId || scope.goalId !== row.goalId) return fail();
  stage="activation_quote";
  const approvedQuote=a.quote as AdaptiveResearchQuote;
  if (approvedQuote.quoteHash !== scope.quoteHash) return fail();
  stage="scope_validation";
  const fundingProof=(a.fundingProof??null) as AdaptiveFundingProof|null;
  validateAdaptiveExecutionScope(scope,preview,Date.parse(scope.createdAt),fundingProof);
  stage="plan_validation";
  const scopeHash=discoveryV2Hash(scope),plan=validateAdaptiveResearchPlan(compileQuestPlan(a.plan),preview,{id:scopeId,hash:scopeHash},Date.parse(scope.createdAt));
  stage="dependencies";
  const dependencies=discoveryR12ServerDependencies(),client=dependencies.createClient();
  const adaptiveOperation=async(operation:string,payload:Record<string,unknown>={})=>{
    signal.throwIfAborted();
    if (mode === "receipt_only" && !["action_context","complete_action"].includes(operation)) return fail();
    const result=await boundedRpc(client.rpc("r12_adaptive_controller_server",{p_business_id:businessId,p_scope_id:scopeId,p_operation:operation,p_payload:payload,p_server_key:authority.controllerKey}),signal,10_000);
    if (result.error) return fail();
    return result.data;
  };
  const base=dependencies.createController(businessId,scope.goalId,{...authority,requestSignal:signal});
  const controller={...base,command:async(operation:string,payload:Record<string,unknown>,epoch?:number)=>{
    if (mode === "receipt_only" && !["read","claim","settle","response","finish","uncertain","adaptive_complete_action"].includes(operation)) return fail();
    if (operation !== "adaptive_complete_action") return base.command(operation,payload,epoch);
    const result=await adaptiveOperation("complete_action",payload);
    if (!object(result)) return fail();
    return result;
  },readAdaptiveAction:async()=>{
    const data=await adaptiveOperation("action_context");
    if (data === null) return null;
    if (!object(data)) return fail();
    return data as QuestAdaptiveActionProjection;
  }};
  stage="controller_read";
  const saved=await controller.read();
  // The persisted R04 hash uses PostgreSQL JSONB serialization. Compare its
  // trusted identity directly, and compare both readback bodies separately.
  if (!saved || saved.planId !== row.planId || saved.planHash !== a.planHash || discoveryV2Hash(saved.plan) !== discoveryV2Hash(plan)) return fail();
  const progressResult=async(result:QuestTickResult,receiptProgressHash?:string):Promise<QuestTickResult>=>{
    const state=await controller.read(),action=await controller.readAdaptiveAction();
    if (!state || state.planHash !== saved.planHash) return fail();
    return {...result,progressToken:discoveryV2Hash({planId:state.planId,planHash:state.planHash,
      actionHash:action?.actionHash ?? null,actionOrdinal:action?.ordinal ?? null,receiptProgressHash:receiptProgressHash ?? null,
      attempts:state.attempts.map(t=>({id:t.id,status:t.status,requestId:t.requestId,responseHash:t.responseHash,resultEvidenceHash:t.resultEvidenceHash ?? null})).sort((x,y)=>x.id.localeCompare(y.id))})};
  };
  const operation:DiscoveryR12EffectStore["operation"]=async(attemptId,operation,payload)=>{
    signal.throwIfAborted();
    if (mode === "receipt_only" && !["inputs","load","claim","record","diagnose"].includes(operation)) return fail();
    const result=await boundedRpc(client.rpc("r12_discovery_server",{p_business_id:businessId,p_attempt_id:attemptId,p_operation:operation,p_payload:payload,p_server_key:authority.controllerKey}),signal,10_000);
    if (result.error || !object(result.data)) return fail();
    return result.data;
  };
  const effects:DiscoveryR12EffectStore={operation,settle:async(attemptId,settlement)=>{await controller.command("settle",{attemptId,settlement});},
    dispatchedAt:async attemptId=>{const data=await operation(attemptId,"load",{});if (typeof data.dispatchedAt !== "string" || !Number.isFinite(Date.parse(data.dispatchedAt))) return fail();return data.dispatchedAt;}};
  stage="adapter_setup";
  let quote:AdaptiveResearchQuote|null=null;
  const freshQuote=async()=>{
    if (!quote || Date.parse(quote.validUntil) <= Date.now()) quote=await dependencies.adaptiveQuote({fetch:deadlineFetch(signal),version:approvedQuote.version});
    return validateAdaptiveExecutionQuote(quote,approvedQuote,scope.quoteHash);
  };
  const adapters:Record<string,QuestAdapter>={};
  for (const step of plan.steps) {
    if (!DISCOVERY_R12_PHASES.includes(step.key as DiscoveryR12Phase)) return fail();
    const pin=a.operations.find(v=>object(v) && v.operationKey === step.operationKey);
    if (!object(pin) || !Array.isArray(pin.dataClasses) || pin.dataClasses.some(v=>typeof v !== "string")) return fail();
    adapters[step.adapter]=dependencies.createAdapter({scope,phase:step.key as DiscoveryR12Phase,adaptivePreview:preview,adaptiveFundingProof:fundingProof,
      identity:{qualificationHash:step.qualificationHash,workflowDefinitionId:step.workflowDefinitionId,workerDefinitionId:step.workerDefinitionId,mode:"qualification"},
      dataClasses:pin.dataClasses as string[],store:effects,fetcher:deadlineFetch(signal),quote:freshQuote,
      request:async ctx=>{
        const input=readAdaptivePhaseInputs(ctx,await operation(ctx.attempt.id,"inputs",{}));
        return buildAdaptivePhaseRequest(input,input.validationAt);
      },
      project:async(qualified,ctx,request)=>projectAdaptivePhaseResponse(ctx,readAdaptivePhaseInputs(ctx,await operation(ctx.attempt.id,"inputs",{})),qualified,request)});
  }
  // A request is a bounded worker wake. It never retries a committed send.
  // Further wakes resume durable state until SQL records a stop/pause/outcome.
  stage="durable_execution";
  for (let transitions=0;transitions<24 && Date.now()-started<200_000;transitions++) {
    signal.throwIfAborted();
    if (mode === "receipt_only") {
      const current=await controller.read(),action=await controller.readAdaptiveAction();
      if (!current || current.planHash !== saved.planHash) return fail();
      if (!action || !current.attempts.some(t=>action.attemptIds.includes(t.id) && ["dispatched","uncertain","responded"].includes(t.status))) {
        return {status:"stopped",reason:"saved_receipt_readback_recorded"};
      }
    }
    if (!await controller.readAdaptiveAction()) {
      const next=await adaptiveOperation("admit_next");
      if (!object(next)) return fail();
      if (next.admitted !== true) return {status:next.stopped === true?"stopped":"waiting",reason:typeof next.reason === "string"?next.reason:"adaptive_reviewed_action_required"};
    }
    try {
      const result=await awaitRequestDeadline(driveQuestOnce(controller,{adapters,reconcile:true}),signal);
      if (mode === "research" && result.status === "blocked" && ["effect_still_uncertain","liability_still_uncertain"].includes(result.reason)) {
        const failed=await adaptiveOperation("diagnosed_failure");
        if (object(failed) && failed.handled === true) continue;
      }
      if (result.status !== "progress") return progressResult(result);
    } catch (error) {
      if (error instanceof DiscoveryR12ReceiptPending) return progressResult({status:"waiting",reason:"receipt_pending",...(typeof error.receipt.nextCheckAt === "string"?{wakeAt:error.receipt.nextCheckAt}:{})},discoveryV2Hash(error.receipt));
      // This operation can only recognize an already saved, known-charge
      // failure. It cannot turn a caught exception into retry permission.
      let failed: unknown;
      try { failed=mode === "research" ? await adaptiveOperation("diagnosed_failure") : null; }
      catch { throw error; }
      if (object(failed) && failed.handled === true) continue;
      if (error instanceof Error && error.message === "quest_controller_transition_unverified") {
        // A long provider call can save its candidate before its worker lease
        // expires. Fresh immutable readback permits a receipt-only wake; the
        // generic RPC error itself establishes neither cost nor permission.
        try {
          const current=await controller.read(),action=await controller.readAdaptiveAction();
          if (!current || !current.knowledge || !action || current.planId !== saved.planId || current.planHash !== saved.planHash || typeof current.head?.leaseExpiresAt !== 'string') throw error;
          const pending=current.attempts.filter(t=>action.attemptIds.includes(t.id) && ["dispatched","responded","uncertain"].includes(t.status));
          if (pending.length !== 1) throw error;
          const attempt=pending[0],step=plan.steps.find(s=>s.key === attempt.stepKey);
          if (!step) throw error;
          const eligible=await validateAdaptiveReceiptResume({context:{planId:current.planId,planHash:current.planHash,plan,step,attempt,knowledge:current.knowledge},
            expectedPlanId:saved.planId,expectedPlanHash:saved.planHash,leaseExpiresAt:current.head.leaseExpiresAt,scope,preview,fundingProof,approvedQuote,action,saved:await operation(attempt.id,"load",{})});
          return progressResult({status:"waiting",reason:"receipt_pending",...(eligible.wakeAt?{wakeAt:eligible.wakeAt}:{})},eligible.receiptProgressHash);
        } catch { throw error; }
      }
      throw error;
    }
  }
  return progressResult({status:"waiting",reason:"continue_saved_progress"});
  } catch(error) {
    const message=error instanceof Error?error.message:"";
    const code=/^(?:r12_[a-z0-9_]+|quest_controller_transition_unverified)$/.test(message)?message:"execution_rejected";
    const cause=error instanceof Error?error.cause:null;
    const guard=message === "r12_discovery_adapter_binding_invalid" && typeof cause === "string" &&
      ["binding","adaptive_preview","adaptive_action","context","quote_kind","stored_binding","stored_wire","quote_freshness","dispatch_binding"].includes(cause)?cause:undefined;
    console.warn("r12_adaptive_execution_rejected",{stage,code,...(guard?{guard}:{})});
    throw error;
  }
}
