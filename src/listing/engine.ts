import type { JsonObject } from "../core/contracts";
import { fetchCreativeModelQuote } from "../creative/budget";
import { hash, requireEtsy, UUID, type EtsyProductPackage } from "../etsy/contracts";
import { OpenRouterAdapter } from "../models/openrouter";
import { ModelProviderError, type ModelProviderAdapter } from "../models/types";
import type { WorkerInvocationContext } from "../workers/types";
import { LISTING_MODELS, listingCallReservation, validateListingQuote, type ListingPriceReader, type ListingQuote } from "./budget";
import { assembleListingProduct, validateListingInput, validateListingProposal, validateListingReview, type ListingInput, type ListingProposal, type ListingReview } from "./contracts";
import { assertListingKnowledgeFresh, listingKnowledgeHash } from "./knowledge";
import { listingWorker } from "./packs";
import { prepareListingTask, reviewListing, validateListingExecution, type ListingExecution, type ListingRole, type ReviewedListing } from "./runtime";

export type ListingRunState = {
  id: string; businessId: string; workflowRunId: string; sourceArtifactId: string; outputArtifactId: string;
  input: ListingInput; inputHash: string; knowledgeHash: string; workerHashes: { specialist: string; reviewer: string };
  status: "queued" | "running" | "completed" | "rejected" | "needs_evidence" | "failed" | "cancelled";
  phase: "specialist" | "reviewer" | "issue" | "terminal"; maximumMicrousd: number; quote: ListingQuote;
  taskIds: { specialist: string; reviewer: string };
  outputs: { specialist?: { output: ListingProposal; execution: ListingExecution }; reviewer?: { output: ListingReview; execution: ListingExecution } };
};
export type ListingOutputWrite = { role: ListingRole; output: ListingProposal | ListingReview; execution: ListingExecution };
export type ListingIssuedEnvelopes = { etsyDraftEnvelope: string; listingReviewEnvelope: string };
export type ListingFinish = ListingIssuedEnvelopes & { product: EtsyProductPackage; reviewedListing: ReviewedListing };
/** SQL is the authority for authenticated upstream evidence, exact live worker
 * qualification, a durable one-attempt ledger and compare-and-set writes.
 * guard must reject unresolved/unknown charges and over-cap settled totals for
 * every completed output. persist/finish repeat guards atomically with writes.
 * settle must work after cancellation, preserving all known charges. */
export interface ListingRunRepository {
  load(): Promise<ListingRunState>;
  guard(): Promise<ListingRunState>;
  reserve(value: { role: ListingRole; reservedMicrousd: number; requestHash: string; estimate: JsonObject; context: WorkerInvocationContext }): Promise<{ shouldExecute: boolean; committedMicrousd: number }>;
  settle(value: { role: ListingRole; reportedMicrousd: number | null; providerRequestId: string | null; receipt: JsonObject }): Promise<void>;
  persist(value: ListingOutputWrite): Promise<void>;
  finish(value: ListingFinish): Promise<void>;
  /** Preserve existing cancellation, completion and review-terminal outcomes. */
  fail(reason: string): Promise<void>;
}
export type ListingRunResult = { status: ListingRunState["status"]; reason?: string };
export type ListingRunOptions = {
  adapter?: Pick<ModelProviderAdapter, "invokeStructured">; prices?: ListingPriceReader;
  issue(product: EtsyProductPackage, record: ReviewedListing): Promise<ListingIssuedEnvelopes>;
};
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
const snapshot = <T>(value: T): T => freeze(structuredClone(value));
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const active = (state: ListingRunState) => state.status === "queued" || state.status === "running";
class Stop extends Error {
  constructor(readonly result: ListingRunResult) { super(result.reason ?? result.status); }
}
function stop(reason: string): never { throw new Stop({ status: "failed", reason }); }
function immutableScope(state: ListingRunState) {
  // The SQL row may additionally carry changing cost totals, reason or internal
  // envelope data. Pin only the explicit approved execution scope.
  return hash({ id: state.id, businessId: state.businessId, workflowRunId: state.workflowRunId,
    sourceArtifactId: state.sourceArtifactId, outputArtifactId: state.outputArtifactId,
    input: state.input, inputHash: state.inputHash, knowledgeHash: state.knowledgeHash,
    workerHashes: state.workerHashes, maximumMicrousd: state.maximumMicrousd, quote: state.quote, taskIds: state.taskIds });
}
function validateState(state: ListingRunState) {
  requireEtsy([state.id, state.businessId, state.workflowRunId, state.sourceArtifactId, state.outputArtifactId,
    state.taskIds?.specialist, state.taskIds?.reviewer].every(id => typeof id === "string" && UUID.test(id)) &&
    state.sourceArtifactId !== state.outputArtifactId && state.taskIds.specialist !== state.taskIds.reviewer &&
    state.input?.evidenceMode === "live" && state.input.product.id === state.sourceArtifactId && state.input.product.businessId === state.businessId,
    "invalid_live_listing_run");
  validateListingInput(state.input); assertListingKnowledgeFresh();
  requireEtsy(hash(state.input) === state.inputHash && state.knowledgeHash === listingKnowledgeHash() &&
    state.workerHashes?.specialist === hash(listingWorker("specialist").manifest) && state.workerHashes.reviewer === hash(listingWorker("reviewer").manifest),
    "listing_run_pins_changed");
  validateListingQuote(state.quote, state.inputHash, state.maximumMicrousd);
  const specialist = state.outputs?.specialist, reviewer = state.outputs?.reviewer;
  requireEtsy(!reviewer || specialist, "listing_phase_mismatch");
  if (specialist) {
    requireEtsy(specialist.execution.taskId === state.taskIds.specialist, "listing_task_identity_mismatch");
    validateListingExecution(state.input, "specialist", specialist.output, specialist.execution);
  }
  if (reviewer) {
    requireEtsy(reviewer.execution.taskId === state.taskIds.reviewer, "listing_task_identity_mismatch");
    reviewListing(state.input, specialist!.output, reviewer.output, specialist!.execution, reviewer.execution, Date.now(), state.outputArtifactId);
  }
  requireEtsy(state.phase === (reviewer ? "issue" : specialist ? "reviewer" : "specialist"), "listing_phase_mismatch");
}
/** Strictly selected, bounded accounting data. No raw provider body, rejected
 * output, exception message, arbitrary metadata or model-supplied receipt. */
function accounting(value: unknown) {
  const v = object(value) ? value : {}, usage = object(v.usage) ? v.usage : {}, metadata = object(v.metadata) ? v.metadata : {};
  const reported = usage.reportedCostUsd;
  const rounded = typeof reported === "number" && Number.isFinite(reported) && reported >= 0 ? Math.ceil(reported * 1e6) : null;
  const reportedMicrousd = rounded !== null && Number.isSafeInteger(rounded) ? rounded : null;
  const identity = (id: unknown) => typeof id === "string" && id.length > 0 && id.length <= 200 && id.trim() === id && !/[\u0000-\u001f\u007f]/.test(id) ? id : null;
  const label = (id: unknown) => typeof id === "string" && /^[A-Za-z0-9_.:/-]{1,160}$/.test(id) ? id : null;
  const metric = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER ? n : null;
  return { reportedMicrousd, providerRequestId: identity(v.providerRequestId), provider: label(v.provider), providerModelId: label(v.providerModelId),
    upstreamProvider: label(metadata.actualUpstreamProvider ?? v.upstreamProvider), finishReason: ["stop", "length", "content_filter", "tool_calls", "error"].includes(String(metadata.finishReason ?? v.finishReason)) ? String(metadata.finishReason ?? v.finishReason) : null,
    inputTokens: metric(usage.inputTokens), outputTokens: metric(usage.outputTokens), latencyMs: metric(v.latencyMs) };
}

/** Finite specialist → independent reviewer → local issuer. No fallback, retry,
 * provider tools, images, product mutation, Etsy action or publication authority. */
export async function executeListingRun(repository: ListingRunRepository, options: ListingRunOptions): Promise<ListingRunResult> {
  // Capture methods before the first await; callers cannot switch execution or
  // persistence targets by mutating the options/repository during an await.
  const repo = { load: repository.load.bind(repository), guard: repository.guard.bind(repository), reserve: repository.reserve.bind(repository),
    settle: repository.settle.bind(repository), persist: repository.persist.bind(repository), finish: repository.finish.bind(repository), fail: repository.fail.bind(repository) };
  const prices = options.prices ?? fetchCreativeModelQuote, issue = options.issue;
  const adapter = options.adapter ?? new OpenRouterAdapter(), invoke = adapter.invokeStructured.bind(adapter);
  let reason = "listing_load_failed", state: ListingRunState | undefined;
  try {
    state = snapshot(await repo.load());
    if (!active(state)) return { status: state.status };
    reason = "listing_guard_failed"; validateState(state);
    const scopeHash = immutableScope(state);
    const expectedOutputs = snapshot(state.outputs);
    const guard = async () => {
      reason = "listing_guard_failed";
      const current = snapshot(await repo.guard());
      if (immutableScope(current) !== scopeHash) stop("listing_scope_changed");
      if (!active(current)) throw new Stop({ status: current.status });
      validateState(current);
      for (const role of ["specialist", "reviewer"] as const) {
        const prior = state?.outputs[role] ?? expectedOutputs[role];
        if (prior && (!current.outputs[role] || hash(prior) !== hash(current.outputs[role]))) stop("listing_persisted_output_changed");
      }
      state = current; return current;
    };

    for (const role of ["specialist", "reviewer"] as const) {
      let current = await guard();
      if (current.outputs[role]) continue;
      const specialist = current.outputs.specialist;
      const prepared = snapshot(prepareListingTask(current.input, role, current.taskIds[role], role === "reviewer" ? specialist?.output : undefined,
        Date.now(), role === "reviewer" ? specialist?.execution : undefined));
      reason = "listing_price_unavailable";
      const price = snapshot(await prices(LISTING_MODELS[role]));
      current = await guard();
      if (current.outputs[role]) continue;
      const request = snapshot({ ...prepared.request, providerOnly: [role === "specialist" ? "openai" : "anthropic"],
        providerPriceLimit: { prompt: price.inputPerMillion, completion: price.outputPerMillion, request: 0 as const } });
      reason = "listing_price_exceeds_approved_ceiling";
      const reservation = listingCallReservation(role, request, price, current.quote, current.maximumMicrousd);
      reason = "listing_reservation_failed";
      const reserved = snapshot(await repo.reserve(snapshot({ role, reservedMicrousd: reservation.reservedMicrousd,
        requestHash: prepared.requestHash, estimate: reservation.estimate, context: prepared.context })));
      // A revoked source/qualification/cancel after reserve never dispatches. The
      // reservation stays consumed, rather than creating a zero-cost retry path.
      current = await guard();
      if (current.outputs[role]) continue;
      if (!reserved.shouldExecute) stop("listing_attempt_already_reserved");
      if (!Number.isSafeInteger(reserved.committedMicrousd) || reserved.committedMicrousd < reservation.reservedMicrousd || reserved.committedMicrousd > current.maximumMicrousd) stop("listing_budget_guard_failed");
      // Reservation/source checks can themselves take time; expired pricing
      // after either await cannot authorize this dispatch.
      listingCallReservation(role, request, price, current.quote, current.maximumMicrousd);

      let output: ListingProposal | ListingReview | undefined, execution: ListingExecution | undefined;
      let receiptData: ReturnType<typeof accounting>, failure: string | null = null;
      reason = "listing_provider_failed";
      try {
        const response = await invoke(request);
        // Capture charge/identity before cloning or validating untrusted output.
        receiptData = accounting(response);
        try {
          const allowedProviders = role === "specialist" ? ["openrouter", "openai", "OpenAI"] : ["openrouter", "anthropic", "Anthropic"];
          const upstream = role === "specialist" ? ["openai", "OpenAI"] : ["anthropic", "Anthropic"];
          if (receiptData.providerModelId !== LISTING_MODELS[role] || !allowedProviders.includes(receiptData.provider ?? "") ||
            (receiptData.upstreamProvider !== null && !upstream.includes(receiptData.upstreamProvider))) stop("listing_returned_model_mismatch");
          if (!receiptData.providerRequestId) stop("listing_provider_identity_missing");
          if (receiptData.finishReason !== null && receiptData.finishReason !== "stop") stop("listing_incomplete_provider_output");
          const candidate: unknown = snapshot(response.output);
          if (role === "specialist") validateListingProposal(current.input, candidate); else validateListingReview(candidate);
          output = candidate as ListingProposal | ListingReview;
          execution = snapshot({ version: "1.0.0", mode: "live_model", taskId: current.taskIds[role], workerKey: `listing.${role}`, workerVersion: "1.0.0",
            providerModelId: receiptData.providerModelId!, providerRequestId: receiptData.providerRequestId, requestHash: prepared.requestHash,
            outputHash: hash(output), completedAt: new Date(Date.now()).toISOString() });
          validateListingExecution(current.input, role, output, execution, role === "reviewer" ? specialist?.output : undefined, Date.now(), role === "reviewer" ? specialist?.execution : undefined);
          if (role === "reviewer" && (execution.providerModelId === specialist!.execution.providerModelId || execution.providerRequestId === specialist!.execution.providerRequestId)) stop("listing_independent_review_required");
        } catch (error) { failure = error instanceof Stop ? error.result.reason! : "listing_invalid_output"; output = undefined; execution = undefined; }
      } catch (error) {
        receiptData = accounting(error instanceof ModelProviderError ? error.details.providerReceipt : null);
        failure = "listing_provider_failed";
      }
      const receipt: JsonObject = { version: "1.0.0", role, executionMode: "listing.model", mockProvider: false, requestedModel: LISTING_MODELS[role],
        actualProviderModelId: receiptData.providerModelId, provider: "openrouter",
        upstreamProvider: receiptData.upstreamProvider ?? (receiptData.provider === "openrouter" ? null : receiptData.provider),
        providerRequestId: receiptData.providerRequestId, reportedMicrousd: receiptData.reportedMicrousd, unknownCharge: receiptData.reportedMicrousd === null,
        inputTokens: receiptData.inputTokens, outputTokens: receiptData.outputTokens, latencyMs: receiptData.latencyMs, finishReason: receiptData.finishReason,
        requestHash: prepared.requestHash, transportRequestHash: reservation.transportRequestHash, outputValidated: failure === null,
        outputHash: execution?.outputHash ?? null, completedAt: execution?.completedAt ?? null,
        ...(failure ? { failureCategory: failure } : {}) };
      reason = "listing_settlement_failed";
      await repo.settle(snapshot({ role, reportedMicrousd: receiptData.reportedMicrousd, providerRequestId: receiptData.providerRequestId, receipt }));
      if (failure) stop(failure);
      if (receiptData.reportedMicrousd === null) stop("listing_unknown_provider_charge");
      if (reserved.committedMicrousd - reservation.reservedMicrousd + receiptData.reportedMicrousd > current.maximumMicrousd) stop("listing_actual_cost_exceeds_cap");
      await guard();
      reason = "listing_output_persistence_failed";
      const write = snapshot({ role, output: output!, execution: execution! });
      try { await repo.persist(write); }
      catch {
        // A committed write whose acknowledgement was lost is recoverable by an
        // exact readback. Never repeat a provider call or invent a replacement.
        const recovered = await guard();
        const saved = recovered.outputs[role];
        if (!saved || hash(saved) !== hash({ output: write.output, execution: write.execution })) stop("listing_output_persistence_failed");
      }
      if (role === "reviewer" && (output as ListingReview).verdict !== "APPROVE") {
        return { status: (output as ListingReview).verdict === "REJECT" ? "rejected" : "needs_evidence" };
      }
    }
    const current = await guard(), specialist = current.outputs.specialist!, reviewer = current.outputs.reviewer!;
    if (reviewer.output.verdict !== "APPROVE") return { status: reviewer.output.verdict === "REJECT" ? "rejected" : "needs_evidence" };
    const now = Date.now(), product = snapshot(assembleListingProduct(current.input, specialist.output, now, current.outputArtifactId));
    const record = snapshot(reviewListing(current.input, specialist.output, reviewer.output, specialist.execution, reviewer.execution, now, current.outputArtifactId));
    reason = "listing_issue_failed";
    const envelopes = snapshot(await issue(product, record));
    requireEtsy(typeof envelopes.etsyDraftEnvelope === "string" && envelopes.etsyDraftEnvelope.length > 0 && envelopes.etsyDraftEnvelope.length <= 200_000 &&
      typeof envelopes.listingReviewEnvelope === "string" && envelopes.listingReviewEnvelope.length > 0 && envelopes.listingReviewEnvelope.length <= 200_000, "invalid_listing_envelopes");
    await guard();
    reason = "listing_finish_failed";
    try { await repo.finish(snapshot({ product, reviewedListing: record, ...envelopes })); }
    catch { await guard(); stop("listing_finish_failed"); }
    return { status: "completed" };
  } catch (error) {
    const result = error instanceof Stop ? error.result : { status: "failed" as const, reason };
    if (result.status !== "failed") return result;
    // Failure reporting must not hide the safe stop or overwrite a cancellation.
    try { await repo.fail(result.reason ?? "listing_execution_failed"); } catch { /* No further dispatch. */ }
    try { const final = snapshot(await repo.load()); if (!active(final)) return { status: final.status, ...(final.status === "failed" ? { reason: result.reason } : {}) }; } catch { /* Preserve the fixed, safe failure. */ }
    return result;
  }
}
