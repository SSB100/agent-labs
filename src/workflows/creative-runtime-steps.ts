import { createClient } from "@supabase/supabase-js";
import { FatalError } from "workflow";
import type { JsonObject } from "../core/contracts";
import { createRuntimeClient } from "../lib/supabase/runtime";
import { modelDispatchAdmission, settleLegacyAdmission } from "../lib/admission-runtime";
import { getSupabasePublicConfig } from "../lib/supabase/env";
import { creativeHash, validateBriefScreen, validateCreativeApproval, validateDesignBrief } from "../creative/contracts";
import type { CreativeCallKey, CreativeLedger, CreativeModelCallKey } from "../creative/budget";
import { getImageGenerationPolicy, ImageProviderError, OpenRouterImageAdapter } from "../creative/image-provider";
import { inspectCreativePng } from "../creative/inspection";
import { storeCreativeImage, type SourcePreservation, type StoredImageProvenance } from "../creative/stored-image";
import type { AssetInspection, BriefScreen, CreativeApprovalSnapshot, DesignBrief, DesignReview } from "../creative/types";
import { executeCreativeWorker } from "../creative/workers";
import { creativeFailureMessage } from "../creative/errors";
import type { PackWorker } from "../packs/types";
import type { WorkerInvocationContext } from "../workers/types";
import type { CreativeRuntimeInput } from "./creative-runtime";

type CreativeState = { status: string; phaseKey: CreativeCallKey; productionReady: boolean; approval: CreativeApprovalSnapshot;
  approvalHash: string; quote: { generatorModel: string }; brief: DesignBrief | null; briefHash: string | null; screen: BriefScreen | null;
  assets: { version: number; inspection: AssetInspection; storagePath: string; prompt: string }[];
  reviews: { version: number; output: DesignReview }[] };
async function transition(input: CreativeRuntimeInput, operation: string, payload: JsonObject = {}) {
  const result = await createRuntimeClient().rpc("creative_runtime_transition", { p_creative_run_id: input.creativeRunId,
    p_business_id: input.businessId, p_runtime_capability: input.runtimeCapability, p_operation: operation, p_payload: payload });
  if (result.error) throw new Error(`Creative ${operation}: ${result.error.message}`);
  return result.data;
}
function ledger(input: CreativeRuntimeInput): CreativeLedger {
  return { admissionFor: reservation => modelDispatchAdmission(input, {
      operationKey: "creative.text", requestHash: reservation.requestHash, callKey: reservation.callKey,
      reservedMicrousd: reservation.reservedMicrousd, providerModelId: reservation.model,
      accounting: { kind: "creative", runId: input.creativeRunId, callKey: reservation.callKey },
      dataClasses: reservation.callKey.startsWith("review:") ? ["business_context", "private_image"] : ["business_context"],
    }),
    reserve: reservation => transition(input, "reserve_call", { ...reservation }),
    record: async (callKey, reportedMicrousd, providerRequestId, receipt) => { await settleLegacyAdmission(input, { kind: "creative", runId: input.creativeRunId, callKey, reportedMicrousd, providerRequestId, receipt }); } };
}
function storageClient(input: CreativeRuntimeInput) {
  const { url, publishableKey } = getSupabasePublicConfig();
  return createClient(url, publishableKey, { global: { headers: { "x-creative-capability": input.runtimeCapability },
    fetch: (resource, options) => fetch(resource, { ...options, signal: AbortSignal.timeout(60_000) }) },
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }).storage.from("creative-assets");
}
export async function loadCreativeRun(input: CreativeRuntimeInput, runtimeRunId: string): Promise<CreativeState> {
  "use step";
  return transition(input, "load", { runtimeRunId });
}
export async function executeCreativePhase(input: CreativeRuntimeInput, callKey: CreativeCallKey) {
  "use step";
  try { await executeCreativePhaseOnce(input, callKey); }
  catch (error) { throw new FatalError(creativeFailureMessage(error)); }
}
// A paid or uncertain phase is never automatically attempted again by the durable runner.
executeCreativePhase.maxRetries = 0;

async function executeCreativePhaseOnce(input: CreativeRuntimeInput, callKey: CreativeCallKey) {
  input = structuredClone(input);
  const state = await transition(input, "load") as CreativeState;
  if (state.status !== "running" || state.phaseKey !== callKey) return;
  validateCreativeApproval(state.approval);
  if (callKey.endsWith(":2") && state.approval.maximumGenerations === 1) throw new FatalError("This approval permits one image only; no repair phase is authorized.");
  if (state.approval.purpose === "simulation") throw new FatalError("Hosted simulation requires the separate mocked executor; paid adapters cannot accept simulation input.");
  const costs = ledger(input);
  if (!callKey.startsWith("generate:")) {
    const prepared = await transition(input, "prepare", { callKey }) as { worker: PackWorker; context: WorkerInvocationContext };
    const generation = callKey === "review:2" ? 2 : 1;
    const asset = callKey.startsWith("review:") ? state.assets.find(a => a.version === generation) : undefined;
    let imageBytes: Uint8Array | undefined;
    if (asset) {
      const downloaded = await storageClient(input).download(asset.storagePath);
      if (downloaded.error || !downloaded.data) throw new FatalError("Unable to retrieve the exact private asset for visual review.");
      imageBytes = new Uint8Array(await downloaded.data.arrayBuffer());
      const inspected = await inspectCreativePng(imageBytes, state.approval.printSpecification);
      if (inspected.sha256 !== asset.inspection.sha256 || creativeHash(inspected) !== creativeHash(asset.inspection)) throw new FatalError("Stored image bytes no longer match their immutable inspection.");
    }
    const result = await executeCreativeWorker({ callKey: callKey as CreativeModelCallKey, approval: state.approval, brief: state.brief,
      inspection: asset?.inspection, imageBytes, worker: prepared.worker, context: prepared.context, ledger: costs });
    await transition(input, "persist_phase", { callKey, output: result.output });
    return;
  }
  if (!state.brief || !state.screen) throw new FatalError("A reviewed final brief is required before image generation.");
  validateDesignBrief(state.brief, state.approval);
  validateBriefScreen(state.screen, state.brief, state.approval);
  if (state.screen.outcome !== "PASS") throw new FatalError("Final brief screening requires owner intervention.");
  const generation = callKey === "generate:2" ? 2 : 1;
  const previous = state.reviews.find(r => r.version === 1)?.output;
  if (generation === 2 && (!previous || previous.outcome !== "FAIL" || !previous.repairInstruction)) throw new FatalError("A repair requires the first independent review's exact instruction.");
  const prompt = state.brief.imagePrompt + (generation === 2 ? `\n\nRepair instruction: ${previous!.repairInstruction}` : "");
  if (typeof state.quote?.generatorModel !== "string") throw new FatalError("The immutable approval has no image provider binding.");
  const approvedPolicy = getImageGenerationPolicy(state.quote.generatorModel);
  const adapter = new OpenRouterImageAdapter({ modelId: approvedPolicy.modelId }), quote = await adapter.preflight({ prompt });
  const reserved = await costs.reserve({ callKey, model: quote.modelId, provider: "openrouter", requestHash: quote.requestHash,
    reservedMicrousd: quote.estimatedMicrousd, estimate: { ...quote } });
  if (!reserved.shouldExecute) throw new FatalError("Image generation was already reserved; uncertain charges cannot be retried automatically.");
  let generated: Awaited<ReturnType<OpenRouterImageAdapter["generate"]>> | null = null;
  let inspection: AssetInspection;
  let provenance: StoredImageProvenance;
  const sourceProgress: { current: SourcePreservation | null } = { current: null };
  const storagePath = `${input.businessId}/${input.creativeRunId}/version-${generation}.png`;
  try {
    generated = await adapter.generate({ prompt }, { quote, reservationId: `${input.creativeRunId}:${callKey}`, reservedMicrousd: quote.estimatedMicrousd, preauthorized: true });
    const declared = generated.declaredMediaType;
    const stored = await storeCreativeImage({ bytes: generated.bytes, mediaType: generated.mediaType,
      declaredMediaType: declared === "absent" ? null : declared,
      storagePath, specification: state.approval.printSpecification, storage: storageClient(input), nativePngRequired: approvedPolicy.nativePngRequired,
      onSourceProgress: progress => { sourceProgress.current = progress; } });
    inspection = stored.inspection;
    provenance = stored.provenance;
  } catch (error) {
    const receipt = generated?.receipt ?? (error instanceof ImageProviderError ? error.receipt : null);
    await costs.record(callKey, receipt?.reportedMicrousd ?? null, receipt?.providerRequestId ?? null,
      { ...(receipt ?? {}), model: quote.modelId, provider: "openrouter", providerRequestId: receipt?.providerRequestId ?? null, outputValidated: false, executionMode: "image.generate", mockProvider: false,
        storagePath, sourcePreservation: sourceProgress.current ? { ...sourceProgress.current } : null, failure: error instanceof Error ? error.message.slice(0, 500) : "Image generation failed" });
    throw new FatalError(error instanceof Error ? error.message : "Image generation failed.");
  }
  await costs.record(callKey, generated.receipt.reportedMicrousd, generated.receipt.providerRequestId,
    { ...generated.receipt, provenance: { ...provenance }, model: quote.modelId, provider: "openrouter", outputValidated: true, executionMode: "image.generate", mockProvider: false });
  await transition(input, "persist_phase", { callKey, output: { inspection: { ...inspection }, provenance: { ...provenance }, storagePath, prompt, model: quote.modelId, provider: "openrouter", generatedAt: new Date().toISOString() } });
}
export async function failCreativeRun(input: CreativeRuntimeInput, reason: string) {
  "use step";
  return transition(input, "fail", { reason });
}
