import type { StructuredModelRequest } from "../models/types";
import { bindValidatedOwnerResearchIntent, type ValidatedOwnerResearchIntent } from "./discovery-r12-goal-intent";
import type { DiscoveryR12Quote } from "./discovery-r12-quote";
import { inspectDiscoveryR12Wire, routeDiscoveryR12Request } from "./discovery-r12-wire";
import type { DiscoveryIntentV2 } from "./discovery-v2";
import { pinDiscoveryKnowledgeV2, discoveryKnowledgeHashV2, type DiscoveryKnowledgeContextV2 } from "./discovery-v2-knowledge";
import { buildDiscoveryPlannerRequestV2 } from "./discovery-v2-plan";

export type DiscoveryR12OwnerPlannerPreflightInput = {
  version: "r12.owner-planner-preflight-input.1";
  setupId: string; setupHash: string; scopeId: string; cutoff: string;
  intent: DiscoveryIntentV2; knowledgeSnapshot: DiscoveryKnowledgeContextV2["snapshot"]; inputHash: string;
};
export type DiscoveryR12OwnerPlannerPreflightReceipt = {
  version: "r12.owner-planner-preflight.1"; inputHash: string; requestBytes: number; wireBytes: number;
};

/** The same concrete owner planner request is used by dispatch and the inert preflight. */
export function buildDiscoveryR12OwnerPlannerRequest(
  intent: DiscoveryIntentV2, knowledge: DiscoveryKnowledgeContextV2,
  ownerInitial: ValidatedOwnerResearchIntent, approvedQuery: string, committedBeforeAttemptMicrousd: number,
): StructuredModelRequest {
  if (approvedQuery !== ownerInitial.approvedQuery || !Number.isSafeInteger(committedBeforeAttemptMicrousd) || committedBeforeAttemptMicrousd < 0) throw new Error("r12_owner_planner_request_unverified");
  const request = buildDiscoveryPlannerRequestV2(intent, knowledge, undefined, "owner_initial", ownerInitial).request;
  request.messages[0].content += " The actual public search question is separately reviewed and fixed. Your queryFocus is advisory and cannot expand it.";
  request.messages[1].content = JSON.stringify({ ...JSON.parse(request.messages[1].content), approvedSearchQuery: approvedQuery });
  request.requestMetadata = { ...request.requestMetadata, r12CommittedBeforeAttemptMicrousd: committedBeforeAttemptMicrousd,
    r12KnowledgeHash: discoveryKnowledgeHashV2(knowledge), r12OwnerInitialScopeHash: ownerInitial.scopeHash };
  return request;
}

/** Sizes an exact prospective owner planner request using the inert real serializer.
 * The placeholder scope hash has the same 64-byte shape as the later persisted hash;
 * binding it here grants no scope or dispatch authority. */
export async function preflightDiscoveryR12OwnerPlanner(
  packet: unknown, quote: DiscoveryR12Quote,
): Promise<DiscoveryR12OwnerPlannerPreflightReceipt> {
  try {
    if (!packet || typeof packet !== "object" || Array.isArray(packet)) throw new Error("invalid preflight input");
    const input = packet as DiscoveryR12OwnerPlannerPreflightInput;
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
    const hash = /^[a-f0-9]{64}$/;
    if (!input || Object.keys(input).sort().join(",") !== "cutoff,inputHash,intent,knowledgeSnapshot,scopeId,setupHash,setupId,version" ||
        input.version !== "r12.owner-planner-preflight-input.1" || !uuid.test(input.setupId) || !uuid.test(input.scopeId) ||
        !hash.test(input.setupHash) || !hash.test(input.inputHash) || input.intent.id !== input.scopeId ||
        input.intent.expiresAt !== input.cutoff || !Number.isFinite(Date.parse(input.cutoff))) throw new Error("invalid preflight input");
    const now = Date.now();
    const knowledge = pinDiscoveryKnowledgeV2(input.knowledgeSnapshot, now);
    // This prospective binding only supplies the fixed-size scope hash needed to
    // serialize the request. The trusted server validates the eventual scope.
    const ownerInitial = bindValidatedOwnerResearchIntent(input.intent, {
      scopeId: input.scopeId, scopeHash: "0".repeat(64), approvedQuery: input.intent.comparisonUniverse.selectionQuestion,
    }, now);
    const request = buildDiscoveryR12OwnerPlannerRequest(input.intent, knowledge, ownerInitial, ownerInitial.approvedQuery, 0);
    const routed = routeDiscoveryR12Request(request, "plan", {
      modelId: quote.luna.modelId, endpoint: quote.luna.endpoint, priceLimit: quote.luna.priceLimit,
    }, false, true);
    const requestBytes = Buffer.byteLength(JSON.stringify(routed), "utf8");
    const inspected = await inspectDiscoveryR12Wire(routed, "plan", false, false, true);
    return { version: "r12.owner-planner-preflight.1", inputHash: input.inputHash, requestBytes, wireBytes: inspected.wireBytes };
  } catch {
    throw new Error("r12_owner_planner_preflight_failed");
  }
}
