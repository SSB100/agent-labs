import type { JsonObject } from "../core/contracts";
import { resolveModelRoute } from "../models/registry";
import type { ModelMessage, ModelProviderAdapter } from "../models/types";
import type { PackWorker } from "../packs/types";
import { validateWorkerInvocationContext } from "../workers/runtime";
import { assertJsonSchemaValue } from "../workers/schema-validator";
import type { WorkerInvocationContext } from "../workers/types";
import { callCreativeModel, CREATIVE_BUDGET, type CreativeLedger, type CreativeModelCallKey } from "./budget";
import { creativeHash, validateBriefScreen, validateCreativeApproval, validateDesignBrief, validateDesignReview } from "./contracts";
import { BRIEF_SCREEN_SCHEMA, DESIGN_BRIEF_SCHEMA, DESIGN_REVIEW_SCHEMA } from "./packs";
import type { AssetInspection, BriefScreen, CreativeApprovalSnapshot, DesignBrief, DesignReview } from "./types";

export async function executeCreativeWorker(input: {
  callKey: CreativeModelCallKey; approval: CreativeApprovalSnapshot; brief: DesignBrief | null;
  inspection?: AssetInspection; imageBytes?: Uint8Array; worker: PackWorker; context: WorkerInvocationContext;
  ledger: CreativeLedger; adapter?: ModelProviderAdapter; prices?: Parameters<typeof callCreativeModel>[0]["prices"];
}) {
  validateCreativeApproval(input.approval);
  validateWorkerInvocationContext(input.worker.manifest, input.context);
  if (input.context.taskContract.permittedCapabilities.length !== 0 ||
    !["etsy.current-policy", "pod.production"].every(key => input.context.taskContract.requiredKnowledge.includes(key))) throw new Error("Creative worker context is missing scoped knowledge or exceeds its capabilities.");
  const approvalArtifact = input.context.inputArtifacts.find(a => a.artifactType === "creative.approval");
  if (!approvalArtifact || creativeHash(approvalArtifact.content) !== creativeHash(input.approval)) throw new Error("Creative worker does not reference this exact approval snapshot.");
  const director = input.callKey === "brief:1", screen = input.callKey === "screen:1";
  if (input.worker.manifest.worker.workerKey !== (director ? "etsy.creative-director" : "etsy.creative-reviewer")) throw new Error("Creative worker role mismatch.");
  if (!director && !input.brief) throw new Error("The exact source brief is required.");
  if (input.brief) validateDesignBrief(input.brief, input.approval);
  if (!director && !screen && (!input.inspection || !input.imageBytes || input.imageBytes.length !== input.inspection.bytes)) throw new Error("Visual review requires actual stored image bytes and inspection.");
  const model = resolveModelRoute(director ? "standard.default" : "reviewer.independent").primary;
  if (model.providerModelId !== (director ? "openai/gpt-5.6-luna" : "anthropic/claude-haiku-4.5") || (!director && model.providerFamily !== "anthropic")) throw new Error("Creative reviewer independence or fixed model route changed; requalification required.");
  const outputSchema = director ? DESIGN_BRIEF_SCHEMA : screen ? BRIEF_SCREEN_SCHEMA : DESIGN_REVIEW_SCHEMA;
  const binding = { purpose: input.approval.purpose, approvalHash: creativeHash(input.approval), briefHash: input.brief ? creativeHash(input.brief) : null,
    assetHash: input.inspection?.sha256 ?? null, inspection: input.inspection ?? null };
  // The strict phase schema is already supplied in response_format. Avoid duplicating
  // the full union schema inside the prompt while retaining its exact audit binding.
  const { requiredOutputSchema, ...promptTask } = input.context.taskContract;
  const messages: ModelMessage[] = [
    { role: "system", content: [`Role: ${input.worker.manifest.worker.role}`, input.worker.manifest.worker.charter,
      ...input.worker.manifest.instructions, director ? "Return only the Design Brief." : screen ? "Return only the final-brief IP/policy screen. Copy supplied hash bindings exactly." : "Inspect the supplied pixels. Return only the Design Review with exact supplied hash bindings. A prompt description is not evidence of what the image contains."].join("\n") },
    { role: "user", content: JSON.stringify({ taskContract: promptTask, requiredOutputSchemaHash: creativeHash(requiredOutputSchema), inputArtifacts: input.context.inputArtifacts, binding }),
      ...(!director && !screen ? { images: [{ mediaType: "image/png" as const, base64: Buffer.from(input.imageBytes!).toString("base64") }] } : {}) },
  ];
  const response = await callCreativeModel({ callKey: input.callKey, ledger: input.ledger, adapter: input.adapter, prices: input.prices,
    request: { model, schemaName: director ? "creative_brief" : screen ? "creative_brief_screen" : "creative_visual_review", outputSchema, messages,
      maxOutputTokens: director ? CREATIVE_BUDGET.briefOutputTokens : CREATIVE_BUDGET.reviewOutputTokens,
      requestMetadata: { taskContractId: input.context.taskContract.id, workerKey: input.worker.manifest.worker.workerKey, callKey: input.callKey } },
    validateOutput(output: JsonObject) {
      assertJsonSchemaValue(outputSchema, output, "Creative phase output");
      if (director) validateDesignBrief(output as unknown as DesignBrief, input.approval);
      else if (screen) validateBriefScreen(output as unknown as BriefScreen, input.brief!, input.approval);
      else validateDesignReview(output as unknown as DesignReview, input.inspection!.sha256, creativeHash(input.brief));
    } });
  // Creative phase outputs are artifacts, not the generic Researcher stopReason envelope.
  // This dedicated executor has already validated the pinned context, exact phase schema and semantics.
  return { output: response.output, receipt: { receiptVersion: "1.0", packKey: input.worker.manifest.packKey, packVersion: input.worker.manifest.version,
    workerKey: input.worker.manifest.worker.workerKey, workerVersion: input.worker.manifest.worker.version,
    taskContractId: input.context.taskContract.id, inputArtifactIds: [...input.context.taskContract.inputArtifactIds], outputValidated: true,
    executionMode: "creative.model", stopReason: `${input.callKey}:complete`, model: model.providerModelId, provider: "openrouter",
    providerRequestId: response.providerRequestId, mockProvider: false, reportedCostUsd: response.usage.reportedCostUsd, inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens } };
}
