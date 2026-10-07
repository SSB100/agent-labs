import { createHash, createHmac } from "node:crypto";
import type { JsonObject } from "../core/contracts";
import { createRuntimeClient } from "../lib/supabase/runtime";
import { getOpenRouterConfig } from "../models/openrouter";
import { creativeHash, validateBriefScreen, validateDesignBrief } from "../creative/contracts";
import { prepareCreativeWorker } from "../creative/workers";
import { OpenRouterImageAdapter } from "../creative/image-provider";
import { normalizeProviderImage } from "../creative/image-normalization";
import { inspectCreativePng } from "../creative/inspection";
import { executeFocusedCreativePhase } from "../creative/focused-runtime";
import {currentFocusedCreativeQuote,focusedCreativeDispatchQuote} from '../creative/focused-quote';
import { FOCUSED_CREATIVE_PHASES, type FocusedCreativePhase, type FocusedCreativeScope, type FocusedCreativeProgress } from "../creative/focused-runtime-contract";
import type { CreativeCallKey } from "../creative/budget";
import type { CreativeImageStorage } from "../creative/stored-image";
import type { PackWorker } from "../packs/types";
import type { WorkerInvocationContext } from "../workers/types";
import type { CreativeRuntimeInput } from "./creative-runtime";
import type { CreativeState } from "./creative-runtime-steps";
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const fail = (): never => { throw Error("r12_focused_creative_scope_unavailable"); };

/** The per-approval verifier exists only in this closure; no durable input,
 * prompt, receipt, output or descriptor carries the credential value. */
export async function executeFocusedCreativeTransport(input: CreativeRuntimeInput, state: CreativeState, callKey: CreativeCallKey, dependencies: {
  transition(operation: string, payload?: JsonObject): Promise<unknown>; storage: CreativeImageStorage;
}): Promise<FocusedCreativeProgress> {
  if (!(FOCUSED_CREATIVE_PHASES as readonly string[]).includes(callKey)) return fail();
  const phase = callKey as FocusedCreativePhase, transition = dependencies.transition, storage = dependencies.storage;
  const loaded = await transition("r12_load", { callKey });if (!object(loaded) || !object(loaded.scope)) return fail();
  const scope = loaded.scope as unknown as FocusedCreativeScope, approval = state.approval as typeof state.approval & { focusedPilotBinding?: { adoption: unknown; creativeInstallationId: string; creativeInstallationSnapshotHash: string } };
  if (!approval.focusedPilotBinding || scope.businessId !== input.businessId || scope.creativeRunId !== input.creativeRunId || scope.workflowRunId !== input.coreWorkflowRunId ||
      scope.approvalId !== approval.approvalId || scope.approvalHash !== creativeHash(approval) || scope.adoptionHash !== creativeHash(approval.focusedPilotBinding.adoption) ||
      scope.installationId !== approval.focusedPilotBinding.creativeInstallationId || scope.installationSnapshotHash !== approval.focusedPilotBinding.creativeInstallationSnapshotHash) return fail();
  const root = process.env.R05_ADMISSION_SERVER_KEY?.trim();if (!root || root.length < 32 || process.env.VERCEL_ENV !== "production") return fail();
  const serverKey = createHmac("sha256", root).update(JSON.stringify({ version: "r12.scoped-authority.1", role: "admission", businessId: scope.businessId, ownerId: scope.ownerId, scopeId: scope.approvalId })).digest("base64url");
  const rpc = async (operation: string, payload: Record<string, unknown>) => {
    const result = await createRuntimeClient().rpc("r05_admission_server", { p_business_id: input.businessId, p_operation: operation, p_payload: payload, p_server_key: serverKey });
    if (result.error || !object(result.data)) return fail();return result.data;
  };
  return executeFocusedCreativePhase({ phase, businessId: input.businessId, creativeRunId: input.creativeRunId, approvalHash: state.approvalHash,
    config: getOpenRouterConfig(), store: { transition, storage,
      admit: async descriptor => {
        const value = await rpc("guard", { ...descriptor, runtimeCapability: input.runtimeCapability });
        if (value.decision !== "allowed" || value.shouldDispatch !== true || typeof value.requestId !== "string") return fail();return value.requestId;
      },
      settle: async (key, reportedMicrousd, providerRequestId, evidence) => {
        const candidate = evidence.version === "r12.focused-creative-candidate.1";
        const image=candidate&&key==='generate:1'&&object(evidence.output)?evidence.output:null;
        const sourcePreservation=image?{storagePath:image.storagePath,mediaType:image.mediaType,bytes:image.sourceBytes,sha256:image.sourceSha256,uploadConfirmed:true,downloadVerified:true}:evidence.sourcePreservation;
        await rpc("legacy_settle", { kind: "creative", runId: input.creativeRunId, callKey: key, reportedMicrousd, providerRequestId,
          workflowRunId: input.coreWorkflowRunId, runtimeCapability: input.runtimeCapability,
          receipt: { version: "r12.focused-creative-settlement.1", model: key === "generate:1" ? "black-forest-labs/flux.2-klein-4b" : key === "brief:1" ? "openai/gpt-5.6-luna" : "anthropic/claude-haiku-4.5",
            provider: "openrouter", providerRequestId, servedModelId: candidate ? evidence.modelId : null, outputValidated: candidate&&key!=='generate:1', mockProvider: false, executionMode: key === "generate:1" ? "image.generate" : "creative.model", candidateHash: candidate ? creativeHash(evidence) : null, ...(sourcePreservation?{sourcePreservation}:{}), evidence } });
      },
    }, prepare: async (validationAt, binding) => {
      if (phase !== "generate:1") {
        const prepared = await transition("prepare", { callKey }) as { worker: PackWorker; context: WorkerInvocationContext };
        const asset = phase === "review:1" ? state.assets.find(a => a.version === 1) : undefined;let imageBytes: Uint8Array | undefined;
        if (asset) {
          const downloaded = await storage.download(asset.storagePath);if (downloaded.error || !downloaded.data) return fail();
          imageBytes = new Uint8Array(await downloaded.data.arrayBuffer());
          const inspected = await inspectCreativePng(imageBytes, approval.printSpecification);
          if (creativeHash(inspected) !== creativeHash(asset.inspection)) return fail();
        }
        const dispatchQuote=binding?.dispatchQuote??focusedCreativeDispatchQuote(await currentFocusedCreativeQuote(),scope,phase);
        return { kind: "text" as const, dispatchQuote, ...prepareCreativeWorker({ callKey: phase, approval, brief: state.brief, inspection: asset?.inspection, imageBytes, worker: prepared.worker, context: prepared.context }, validationAt) };
      }
      if (!state.brief || !state.screen) return fail();validateDesignBrief(state.brief, approval);validateBriefScreen(state.screen, state.brief, approval);if (state.screen.outcome !== "PASS") return fail();
      const prompt = state.brief.imagePrompt, model = "black-forest-labs/flux.2-klein-4b", adapter = new OpenRouterImageAdapter({ modelId: model });
      const quote = binding && "prompt" in binding.request ? binding.request.quote : await adapter.preflight({ prompt });
      const body = { model, prompt, aspect_ratio: "1:1", n: 1, output_format: "png", size: "1024x1024", provider: { only: ["black-forest-labs"], allow_fallbacks: false } };
      if (quote.requestHash !== creativeHash(body) || quote.estimatedMicrousd > scope.phaseCeilings[phase]) return fail();
      return { kind: "image" as const, prompt, quote, wireBody: JSON.stringify(body), requestHash: quote.requestHash,
        inspect: async (bytes: Uint8Array, storagePath: string, receivedAt: string) => {
          const normalized = await normalizeProviderImage(bytes, "image/png");
          if (normalized.provenance.conversion !== "none" || normalized.provenance.verification !== "byte_identity" || normalized.provenance.originalSha256 !== createHash("sha256").update(bytes).digest("hex") || !Buffer.from(normalized.bytes).equals(Buffer.from(bytes))) return fail();
          const inspection = await inspectCreativePng(bytes, approval.printSpecification);
          if (inspection.width !== 1024 || inspection.height !== 1024 || inspection.sha256 !== normalized.provenance.originalSha256) return fail();
          return { inspection: { ...inspection }, provenance: { ...normalized.provenance, originalStoragePath: storagePath, normalizedStoragePath: storagePath }, storagePath, prompt, model, provider: "openrouter", generatedAt: receivedAt };
        } };
    } });
}
