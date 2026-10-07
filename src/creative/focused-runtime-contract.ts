import { createHash } from "node:crypto";
import type { AdmissionDispatchInput } from "../core/admission-contract";
import type { JsonObject } from "../core/contracts";
import type { StructuredModelRequest } from "../models/types";
import { creativeHash } from "./contracts";
import type { ImageGenerationQuote } from "./image-provider";

export const FOCUSED_CREATIVE_PHASES = ["brief:1", "screen:1", "generate:1", "review:1"] as const;
export type FocusedCreativePhase = typeof FOCUSED_CREATIVE_PHASES[number];
export const FOCUSED_CREATIVE_BOUNDS = { textBytes: 24576, originalImageBytes: 3700000, imageBase64Bytes: 4933336, visionWireBytes: 5000000, outputBytes: 65536, receiptBytes: 65536, receiptAttempts: 3, receiptIntervalMs: 120000 } as const;
export type FocusedCreativeScope = {
  version: "r12.focused-creative-scope.1"; ownerId: string; businessId: string; creativeRunId: string; workflowRunId: string;
  approvalId: string; approvalHash: string; adoptionHash: string; installationId: string; installationSnapshotHash: string;
  startsAt: string; expiresAt: string; receiptUntil: string; quoteHash: string;
  phaseCeilings: Record<FocusedCreativePhase, number>; sourceDomains: string[];
  dataClassesByPhase: Record<FocusedCreativePhase, string[]>;
  priceLimitsByPhase: Record<Exclude<FocusedCreativePhase, "generate:1">, { prompt: number; completion: number; request: 0 }>;
};
export type FocusedCreativeDescriptor = AdmissionDispatchInput & { maximumOutputImages?: 1 };
export type FocusedCreativeDispatchQuote = {
  version: "r12.focused-creative-dispatch-quote.1"; callKey: Exclude<FocusedCreativePhase,"generate:1">;
  modelId: string; endpoint: string; verifiedAt: string; validUntil: string; sourceQuoteHash: string;
  priceLimits: { prompt: number; completion: number; request: 0 }; maximumMicrousd: number; quoteHash: string;
};
export type FocusedCreativeBinding = {
  version: "r12.focused-creative-wire.1"; scopeHash: string; callKey: FocusedCreativePhase;
  dispatchQuote: FocusedCreativeDispatchQuote | null;
  request: StructuredModelRequest | { prompt: string; quote: ImageGenerationQuote };
  requestHash: string; wireBody: string; wireHash: string; descriptor: Omit<FocusedCreativeDescriptor, "runtimeCapability">;
};
export type FocusedCreativeCandidate = {
  version: "r12.focused-creative-candidate.1"; scopeHash: string; callKey: FocusedCreativePhase; bindingHash: string;
  generationId: string; modelId: string; receivedAt: string; reportedMicrousd: number | null;
  output: JsonObject; outputHash: string;
};
export type FocusedCreativeProof = {
  version: "r12.focused-creative-route.1"; generationId: string; providerName: string; modelId: string;
  requestedEndpoint: string; providerResponses: Array<{ providerName: string; modelId: string; status: 200 }>;
  imageReceipt?: {apiType:'image';createdAt:string;totalCostMicrousd:number;mediaCompletions:number|null;mediaPrompts:number|null};
  proofHash: string;
};
export type FocusedCreativeReceipt = { status: "awaiting_receipt" | "checking_receipt" | "verified" | "terminal" | "exhausted" | "expired" | "stopped" | "unknown"; attempts: number; nextCheckAt: string | null; receiptExpiresAt: string };
export type FocusedCreativePhaseRecord = { scope: FocusedCreativeScope; phase: { binding: FocusedCreativeBinding | null; candidate: FocusedCreativeCandidate | null; proof: FocusedCreativeProof | null; receipt: FocusedCreativeReceipt | null }; dispatchedAt: string | null };
export type FocusedCreativeProgress = { status: "advanced" } | { status: "waiting"; wakeAt: string } | { status: "blocked"; reason: string };
export const focusedWireHash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const fail = (): never => { throw Error("r12_focused_creative_binding_invalid"); };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function validateFocusedCreativeScope(scope: FocusedCreativeScope, now: number, receiptOnly = false): void {
  if (scope.version !== "r12.focused-creative-scope.1" || !Number.isFinite(now) ||
      Date.parse(scope.startsAt) > now || Date.parse(scope.expiresAt) !== Date.parse(scope.startsAt) + 1800000 ||
      Date.parse(scope.receiptUntil) !== Date.parse(scope.expiresAt) + 1800000 || Date.parse(receiptOnly ? scope.receiptUntil : scope.expiresAt) <= now ||
      FOCUSED_CREATIVE_PHASES.some(key => !Number.isSafeInteger(scope.phaseCeilings[key]) || scope.phaseCeilings[key] < 1 || scope.phaseCeilings[key] > 1000000)) fail();
}
export function focusedCreativeRoute(phase: FocusedCreativePhase) {
  return phase === "generate:1" ? { endpoint: "black-forest-labs", providerName: "Black Forest Labs", modelId: "black-forest-labs/flux.2-klein-4b", models: ["black-forest-labs/flux.2-klein-4b"] }
    : phase === "brief:1" ? { endpoint: "azure/us", providerName: "Azure", modelId: "openai/gpt-5.6-luna", models: ["openai/gpt-5.6-luna", "openai/gpt-5.6-luna-20260709"] }
      : { endpoint: "amazon-bedrock/us", providerName: "Amazon Bedrock", modelId: "anthropic/claude-haiku-4.5", models: ["anthropic/claude-haiku-4.5", "anthropic/claude-4.5-haiku-20251001"] };
}
export function validateFocusedCreativeDispatchQuote(quote: FocusedCreativeDispatchQuote, scope: FocusedCreativeScope, phase: Exclude<FocusedCreativePhase,"generate:1">, now: number): void {
  const route=focusedCreativeRoute(phase), {quoteHash,...body}=quote, limits=scope.priceLimitsByPhase[phase];
  if(quote.version!=="r12.focused-creative-dispatch-quote.1" || quote.callKey!==phase || quote.modelId!==route.modelId || quote.endpoint!==route.endpoint ||
    !/^[a-f0-9]{64}$/.test(quote.sourceQuoteHash) || quoteHash!==creativeHash(body) || !Number.isFinite(Date.parse(quote.verifiedAt)) || Date.parse(quote.verifiedAt)>now ||
    Date.parse(quote.validUntil)!==Date.parse(quote.verifiedAt)+300000 || Date.parse(quote.validUntil)<=now ||
    !Number.isSafeInteger(quote.maximumMicrousd) || quote.maximumMicrousd<1 || quote.maximumMicrousd>scope.phaseCeilings[phase] || quote.priceLimits.request!==0 ||
    !["prompt","completion"].every(key=>{const k=key as "prompt"|"completion";return Number.isFinite(quote.priceLimits[k])&&quote.priceLimits[k]>=0&&quote.priceLimits[k]<=limits[k];})) return fail();
}
export function routeFocusedCreativeRequest(scope: FocusedCreativeScope, phase: Exclude<FocusedCreativePhase,"generate:1">, raw: StructuredModelRequest): StructuredModelRequest {
  const request = structuredClone(raw), route = focusedCreativeRoute(phase), visual = phase === "review:1";
  const images = request.messages.flatMap(message => message.images ?? []);
  if (request.model.providerModelId !== route.modelId || images.length !== (visual ? 1 : 0) || request.maxOutputTokens !== (phase === "brief:1" ? 2500 : 1800) ||
      images.some(image => image.mediaType !== "image/png" || image.base64.length > FOCUSED_CREATIVE_BOUNDS.imageBase64Bytes || Buffer.from(image.base64,"base64").length > FOCUSED_CREATIVE_BOUNDS.originalImageBytes || Buffer.from(image.base64,"base64").toString("base64") !== image.base64)) return fail();
  const routed = { ...request, providerOnly: [route.endpoint], providerDataCollection: "deny" as const, providerZdr: true as const,
    requireReturnedModel: true, providerPriceLimit: structuredClone(scope.priceLimitsByPhase[phase]) };
  if (Buffer.byteLength(JSON.stringify({ ...routed, messages: routed.messages.map(({ role, content }) => ({ role, content })) })) > FOCUSED_CREATIVE_BOUNDS.textBytes) return fail();
  return routed;
}
export function focusedCreativeDescriptor(scope: FocusedCreativeScope, phase: FocusedCreativePhase, requestHash: string, body: string): Omit<FocusedCreativeDescriptor,"runtimeCapability"> {
  const route = focusedCreativeRoute(phase), wire = JSON.parse(body), image = phase === "generate:1", visual = phase === "review:1";
  if (!record(wire) || wire.model !== route.modelId || !record(wire.provider) || creativeHash(wire.provider.only) !== creativeHash([route.endpoint]) || wire.provider.allow_fallbacks !== false ||
      Buffer.byteLength(body) > (visual ? FOCUSED_CREATIVE_BOUNDS.visionWireBytes : FOCUSED_CREATIVE_BOUNDS.textBytes)) return fail();
  if (image ? wire.n !== 1 || wire.output_format !== "png" || wire.size !== "1024x1024" || wire.aspect_ratio !== "1:1" || wire.max_tokens !== undefined || wire.input_references !== undefined
    : wire.max_tokens !== (phase === "brief:1" ? 2500 : 1800) || wire.stream !== false || wire.provider.data_collection !== "deny" || wire.provider.zdr !== true || wire.tools !== undefined || creativeHash(wire.provider.max_price) !== creativeHash(scope.priceLimitsByPhase[phase as Exclude<FocusedCreativePhase,"generate:1">])) return fail();
  return { workflowRunId: scope.workflowRunId, operationKey: `creative.r12.${scope.approvalId}.${phase.split(":")[0]}`, requestHash,
    idempotencyKey: `${scope.workflowRunId}:creative:${phase}`, providerModelId: route.modelId, wireRequestHash: focusedWireHash(body), wireRequestBytes: Buffer.byteLength(body),
    maximumOutputTokens: image ? 0 : Number(wire.max_tokens), ...(image ? { maximumOutputImages: 1 as const } : {}),
    accounting: { kind: "creative", runId: scope.creativeRunId, callKey: phase }, sourceDomains: [...scope.sourceDomains], dataClasses: [...scope.dataClassesByPhase[phase]],
    accountId: null, accountRevision: null, currency: "USD", liabilityMicrounits: String(scope.phaseCeilings[phase]) };
}
export function qualifyFocusedCreativeReceipt(raw: unknown, candidate: FocusedCreativeCandidate): FocusedCreativeProof {
  const route = focusedCreativeRoute(candidate.callKey);
  if (!record(raw) || !record(raw.data) || raw.error !== undefined || raw.data.id !== candidate.generationId || raw.data.provider_name !== route.providerName || !route.models.includes(String(raw.data.model))) return fail();
  const supplied = raw.data.provider_responses ?? [];
  if (!Array.isArray(supplied) || supplied.length > 64) return fail();
  const providerResponses = supplied.map(row => {
    if (!record(row) || row.provider_name !== route.providerName || !route.models.includes(String(row.model_permaslug)) || row.status !== 200) return fail();
    return { providerName: route.providerName, modelId: String(row.model_permaslug), status: 200 as const };
  });
  let imageReceipt:FocusedCreativeProof['imageReceipt'];
  if(candidate.callKey==='generate:1'){
    const data=raw.data,created=Date.parse(String(data.created_at)),received=Date.parse(candidate.receivedAt),cost=data.total_cost;
    if(data.api_type!=='image'||data.cancelled===true||typeof cost!=='number'||!Number.isFinite(cost)||cost<0||!Number.isSafeInteger(Math.ceil(cost*1e6))||
      candidate.reportedMicrousd===null||Math.ceil(cost*1e6)!==candidate.reportedMicrousd||!Number.isFinite(created)||!Number.isFinite(received)||created<received-1800000||created>received+60000||
      !(data.num_media_completion==null||data.num_media_completion===1)||!(data.num_media_prompt==null||data.num_media_prompt===0))return fail();
    imageReceipt={apiType:'image',createdAt:String(data.created_at),totalCostMicrousd:Math.ceil(cost*1e6),mediaCompletions:data.num_media_completion==null?null:1,mediaPrompts:data.num_media_prompt==null?null:0};
  }
  const proof = { version: "r12.focused-creative-route.1" as const, generationId: candidate.generationId, providerName: route.providerName, modelId: String(raw.data.model), requestedEndpoint: route.endpoint, providerResponses,...(imageReceipt?{imageReceipt}:{}) };
  return { ...proof, proofHash: creativeHash(proof) };
}
export function validateFocusedCreativeProof(raw: FocusedCreativeProof, candidate: FocusedCreativeCandidate): FocusedCreativeProof {
  const proof = qualifyFocusedCreativeReceipt({ data: { id: raw.generationId, provider_name: raw.providerName, model: raw.modelId,
    ...(raw.imageReceipt?{api_type:raw.imageReceipt.apiType,created_at:raw.imageReceipt.createdAt,total_cost:raw.imageReceipt.totalCostMicrousd/1e6,num_media_completion:raw.imageReceipt.mediaCompletions,num_media_prompt:raw.imageReceipt.mediaPrompts}:{}),
    provider_responses: raw.providerResponses.map(row => ({ provider_name: row.providerName, model_permaslug: row.modelId, status: row.status })) } }, candidate);
  if (creativeHash(raw) !== creativeHash(proof)) return fail();return proof;
}
