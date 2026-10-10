import type { DiscoveryIntentV2 } from "./discovery-v2";
import { discoveryKnowledgeHashV2, pinDiscoveryKnowledgeV2, type DiscoveryKnowledgeContextV2 } from "./discovery-v2-knowledge";
import { bindValidatedAdaptiveResearchIntent, type AdaptiveIntentPins } from "./discovery-r12-adaptive-intent";
import { type AdaptiveResearchQuote } from "./discovery-r12-adaptive-quote";
import { buildAdaptivePhaseRequest } from "./discovery-r12-adaptive-runtime";
import { inspectAdaptiveResearchWire, routeAdaptiveResearchRequest } from "./discovery-r12-adaptive-wire";
import { readOwnerObservationEvidenceContext, type OwnerObservationContextJSON } from "./discovery-r12-owner-observation";

export type AdaptivePlannerPreflightInput = {
  version: "r12.owner-adaptive-planner-preflight-input.1" | "r12.owner-adaptive-planner-preflight-input.2";
  setupId: string; setupHash: string; scopeId: string; cutoff: string;
  intent: DiscoveryIntentV2; intentPins: AdaptiveIntentPins;
  knowledgeSnapshot: DiscoveryKnowledgeContextV2["snapshot"]; quoteHash: string; inputHash: string;
  ownerObservationContext: OwnerObservationContextJSON | null;
};
export type AdaptivePlannerPreflightReceipt = {
  version: "r12.owner-adaptive-planner-preflight.1" | "r12.owner-adaptive-planner-preflight.2";
  inputHash: string; quoteHash: string; bindingHash: string; actionHash: string; knowledgeHash: string;
  requestHash: string; wireHash: string; requestBytes: number; wireBytes: number;
};

/** The server obtains this packet only from the owner-scoped SQL reconstruction.
 * inputHash is SQL's opaque fingerprint, not a JS canonical hash. Confirm must
 * reconstruct it under locks over setup/profile/closure/imports/finance/installed
 * knowledge and fresh quote, then retain these request pins for initial dispatch.
 * This pure inspection creates no authority and never invokes network transport. */
export async function preflightAdaptiveOwnerPlanner(packet: unknown, quote: AdaptiveResearchQuote,
  now = Date.now()): Promise<AdaptivePlannerPreflightReceipt> {
  try {
    const input = packet as AdaptivePlannerPreflightInput;
    const etsy=quote.version==="r12.adaptive-quote.2";
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
    const hash = /^[a-f0-9]{64}$/;
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).sort().join(",") !== "cutoff,inputHash,intent,intentPins,knowledgeSnapshot,ownerObservationContext,quoteHash,scopeId,setupHash,setupId,version" ||
        input.version !== (etsy?"r12.owner-adaptive-planner-preflight-input.2":"r12.owner-adaptive-planner-preflight-input.1") || !uuid.test(input.setupId) || !uuid.test(input.scopeId) ||
        !hash.test(input.setupHash) || !hash.test(input.inputHash) || input.quoteHash !== quote.quoteHash ||
        !Number.isFinite(now) || !Number.isFinite(Date.parse(input.cutoff)) || Date.parse(input.cutoff) <= now ||
        input.intent.expiresAt !== input.cutoff || input.intentPins.scopeId !== input.scopeId ||
        input.intentPins.actionOrdinal !== 0 || input.intent.limits.maximumNewCollections !== (etsy?0:1) ||
        input.intentPins.finance.runCommittedMicrousd !== 0 || input.intentPins.finance.actionCommittedMicrousd !== 0) throw new Error("invalid adaptive preflight input");
    const knowledge = pinDiscoveryKnowledgeV2(input.knowledgeSnapshot, now);
    const binding = bindValidatedAdaptiveResearchIntent(input.intent, input.intentPins, now);
    const ownerObservations = readOwnerObservationEvidenceContext(input.ownerObservationContext, { selection: binding.ownerObservationRef,
      intentId: input.intent.id, businessId: input.intent.businessId, scopeId: binding.scopeId, scopeHash: binding.scopeHash,
      occupiedArtifactIds: binding.evidenceManifest.map(e => e.artifactId), now });
    const request = buildAdaptivePhaseRequest({ phase: "plan", binding, knowledge, ownerObservations, validationAt: now }, now);
    const routed = routeAdaptiveResearchRequest(request, "plan", quote, now);
    const inspected = await inspectAdaptiveResearchWire(request, "plan", quote, now);
    return { version: etsy?"r12.owner-adaptive-planner-preflight.2":"r12.owner-adaptive-planner-preflight.1", inputHash: input.inputHash,
      quoteHash: quote.quoteHash, bindingHash: binding.bindingHash, actionHash: binding.actionHash,
      knowledgeHash: discoveryKnowledgeHashV2(knowledge), requestHash: inspected.requestHash, wireHash: inspected.wireHash,
      requestBytes: Buffer.byteLength(JSON.stringify(routed), "utf8"), wireBytes: inspected.wireBytes };
  } catch { throw new Error("r12_adaptive_owner_planner_preflight_failed"); }
}
