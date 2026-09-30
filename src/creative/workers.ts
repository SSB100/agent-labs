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
import { creativeOutputLimits } from "./output-limits";
import { creativePromptApproval } from "./prompt-approval";
import { SAFE_REPAIR_INSTRUCTIONS, type AssetInspection, type BriefScreen, type CreativeApprovalSnapshot, type DesignBrief, type DesignReview } from "./types";

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
  const imageArtifact = input.context.inputArtifacts.find(artifact => artifact.artifactType === "creative.image");
  const priorReview = input.context.inputArtifacts.find(artifact => artifact.artifactType === "creative.review");
  const repair = input.callKey === "review:2" && typeof priorReview?.content.repairInstruction === "string" &&
    SAFE_REPAIR_INSTRUCTIONS.includes(priorReview.content.repairInstruction as typeof SAFE_REPAIR_INSTRUCTIONS[number]) ? priorReview.content.repairInstruction : null;
  const expectedImagePrompt = input.brief ? input.brief.imagePrompt + (input.callKey === "review:2" && repair ? `\n\nRepair instruction: ${repair}` : "") : null;
  const duplicateImageContext = !director && !screen && imageArtifact && input.inspection &&
    (input.callKey !== "review:2" || repair !== null) && imageArtifact.content.prompt === expectedImagePrompt &&
    creativeHash(imageArtifact.content.inspection) === creativeHash(input.inspection);
  const binding = { purpose: input.approval.purpose, approvalHash: creativeHash(input.approval), briefHash: input.brief ? creativeHash(input.brief) : null,
    assetHash: input.inspection?.sha256 ?? null, inspection: duplicateImageContext ? { artifactId: imageArtifact.id } : input.inspection ?? null };
  // The complete immutable context was validated above and remains in its audit record.
  // Keep complete knowledge, brief and prior review; group identical approval policy text losslessly.
  // An exact duplicate image prompt
  // becomes explicit references; divergent image content is never silently discarded.
  const promptArtifacts = input.context.inputArtifacts.map(artifact => ({ id: artifact.id, artifactType: artifact.artifactType,
    content: artifact.id === approvalArtifact.id ? creativePromptApproval(input.approval)
      : duplicateImageContext && artifact.id === imageArtifact.id
        ? { inspection: artifact.content.inspection, promptFromBrief: true, ...(repair ? { repairFromPriorReview: true } : {}) } : artifact.content,
    ...(artifact.artifactType === "pack.knowledge" ? { metadata: Object.fromEntries(["knowledgeKey", "knowledgeVersion"]
      .filter(key => artifact.metadata[key] !== undefined).map(key => [key, artifact.metadata[key]])) } : {}) }));
  // The provider-safe response_format drops length and cardinality constraints.
  // Supply its compact bounds in the prompt too; the full schema/union can exceed the byte cap.
  const { requiredOutputSchema, inputArtifactIds, ...promptTaskFields } = input.context.taskContract;
  // Full-context validation proved these IDs exactly match the supplied artifact set.
  void inputArtifactIds;
  const promptTask = { ...promptTaskFields, inputArtifactIdsFrom: "inputArtifacts[].id" };
  if (promptTask.completionCriteria.approvalHash === binding.approvalHash) {
    const { approvalHash: duplicateApprovalHash, ...criteria } = promptTask.completionCriteria;
    void duplicateApprovalHash;
    promptTask.completionCriteria = criteria;
  }
  const messages: ModelMessage[] = [
    { role: "system", content: [`Role: ${input.worker.manifest.worker.role}`, input.worker.manifest.worker.charter,
      ...input.worker.manifest.instructions, "Honor every outputLimits constraint, including string lengths and array counts; all are validated locally.",
      director ? "Return only a concise Design Brief; do not copy policy text into it. Copy approvalId, concept and audience from the approval; placement and garmentCompatibility must exactly equal printSpecification.placement and printSpecification.garment. style, hierarchy, typography and originalityRequirements must each be 10–600 characters; imagePrompt 50–3500 characters and at most 6000 UTF-8 bytes. colors must contain 1–6 #RRGGBB values; forbiddenElements 3–16 strings of 3–120 characters."
        : screen ? "Return only the final-brief IP/policy screen. Copy supplied hash bindings exactly. Include each category exactly once; every rationale must be 15–700 characters."
          : "Inspect the supplied pixels. Return only the Design Review with exact supplied hash bindings and each criterion exactly once; every rationale must be 15–700 characters. A prompt description is not evidence of what the image contains."].join("\n") },
    { role: "user", content: JSON.stringify({ taskContract: promptTask, requiredOutputSchemaHash: creativeHash(requiredOutputSchema), outputLimits: creativeOutputLimits(outputSchema), inputArtifacts: promptArtifacts, binding }),
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
