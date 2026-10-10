import { containsCredentialLikeValue } from "../core/quest-intake";
import { validateResearchRequest } from "../research/sources";
import { discoveryV2Hash, validateDiscoveryIntentV2, type DiscoveryIntentV2 } from "./discovery-v2";
import { validateOwnerObservationSelection, type OwnerObservationSelection } from "./discovery-r12-owner-observation";

export type AdaptiveEvidenceManifestEntry = { artifactId: string; packHash: string; queryId: string;
  collectedForIntentId: string; scopeId: string; scopeHash: string; actionHash: string | null };
export type AdaptiveMaterialHistory = { kind: "negative_finding" | "unresolved_question" | "prior_decision";
  recordHash: string; statement: string; evidenceArtifactIds: string[] };
export type AdaptiveIntentPins = {
  scopeVersion: "r12.discovery-owner-adaptive.1" | "r12.discovery-owner-adaptive.2"; scopeId: string; scopeHash: string;
  actionHash: string; actionOrdinal: number; approvedQuery: string;
  finance: { authorityRootId: string; ledgerSnapshotHash: string; runMaximumMicrousd: number; runCommittedMicrousd: number;
    rootMaximumMicrousd: number; rootCommittedMicrousd: number; actionMaximumMicrousd: number; actionCommittedMicrousd: number };
  evidenceManifest: AdaptiveEvidenceManifestEntry[]; activeEvidenceArtifactIds: string[];
  ownerObservationRef: OwnerObservationSelection | null;
  materialHistory: AdaptiveMaterialHistory[];
};
export type ValidatedAdaptiveResearchIntent = Readonly<AdaptiveIntentPins & {
  mode: "owner_adaptive"; intent: DiscoveryIntentV2; intentHash: string; bindingHash: string;
}>;
const uuid = (v: unknown) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const nat = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const fail = (): never => { throw new Error("r12_adaptive_intent_unverified"); };
function binding(context: Omit<ValidatedAdaptiveResearchIntent, "bindingHash"> | ValidatedAdaptiveResearchIntent) {
  const { bindingHash: _ignored, ...rest } = context as ValidatedAdaptiveResearchIntent;
  void _ignored; return discoveryV2Hash(rest);
}
/** Pure binding only. The caller reconstructs every field from same-owner SQL
 * state. An owner or model cannot confer authority by manufacturing these pins. */
export function assertValidatedAdaptiveResearchIntent(intent: DiscoveryIntentV2, c: ValidatedAdaptiveResearchIntent): void {
  validateOwnerObservationSelection(c?.ownerObservationRef);
  const ownerCapture = c?.scopeVersion === "r12.discovery-owner-adaptive.2";
  if (!c || c.mode !== "owner_adaptive" || !["r12.discovery-owner-adaptive.1", "r12.discovery-owner-adaptive.2"].includes(c.scopeVersion) ||
      !uuid(c.scopeId) || !uuid(intent.id) || !hash(c.scopeHash) || !hash(c.actionHash) || !hash(c.intentHash) ||
      !nat(c.actionOrdinal) || c.actionOrdinal > 10 || c.intentHash !== discoveryV2Hash(intent) ||
      c.intentHash !== discoveryV2Hash(c.intent) || c.bindingHash !== binding(c) ||
      ![0, 1].includes(intent.limits.maximumNewCollections) || intent.comparisonUniverse.selectionQuestion !== c.approvedQuery ||
      containsCredentialLikeValue(c)) fail();
  // In .2 this domain is a capture-attribution boundary, never permission to
  // perform the otherwise well-formed research request.
  validateResearchRequest({ query: c.approvedQuery, allowedDomains: intent.comparisonUniverse.sourceDomains });
  if (ownerCapture && (c.ownerObservationRef === null || intent.limits.maximumNewCollections !== 0 ||
      discoveryV2Hash(intent.comparisonUniverse.sourceDomains) !== discoveryV2Hash(["etsy.com"]))) fail();
  const f = c.finance;
  if (!f || !uuid(f.authorityRootId) || !hash(f.ledgerSnapshotHash) ||
      ![f.runMaximumMicrousd, f.runCommittedMicrousd, f.rootMaximumMicrousd, f.rootCommittedMicrousd,
        f.actionMaximumMicrousd, f.actionCommittedMicrousd].every(nat) || f.runMaximumMicrousd < 1 || f.runMaximumMicrousd > 10_000_000 ||
      intent.limits.maximumMicrousd !== f.runMaximumMicrousd || f.runCommittedMicrousd > f.runMaximumMicrousd ||
      f.rootCommittedMicrousd > f.rootMaximumMicrousd || f.rootCommittedMicrousd < f.runCommittedMicrousd ||
      f.actionMaximumMicrousd < 1 || f.actionMaximumMicrousd > f.runMaximumMicrousd ||
      f.actionCommittedMicrousd > f.actionMaximumMicrousd || f.actionCommittedMicrousd > f.runCommittedMicrousd) fail();
  if (!Array.isArray(c.evidenceManifest) || c.evidenceManifest.length > 64 ||
      !Array.isArray(c.activeEvidenceArtifactIds) || c.activeEvidenceArtifactIds.length > 6 ||
      new Set(c.activeEvidenceArtifactIds).size !== c.activeEvidenceArtifactIds.length ||
      new Set(c.evidenceManifest.map(e => e.artifactId)).size !== c.evidenceManifest.length ||
      c.evidenceManifest.some(e => !e || ![e.artifactId, e.queryId, e.collectedForIntentId, e.scopeId].every(uuid) || ![e.packHash, e.scopeHash].every(hash) || e.actionHash !== null && !hash(e.actionHash)) ||
      c.activeEvidenceArtifactIds.some(id => !c.evidenceManifest.some(e => e.artifactId === id))) fail();
  if (ownerCapture && (c.evidenceManifest.length !== 0 || c.activeEvidenceArtifactIds.length !== 0)) fail();
  if (!Array.isArray(c.materialHistory) || c.materialHistory.length > 100 || c.materialHistory.some(h =>
    !h || !["negative_finding", "unresolved_question", "prior_decision"].includes(h.kind) || !hash(h.recordHash) ||
    typeof h.statement !== "string" || h.statement.trim().length < 10 || h.statement.length > 600 ||
    !Array.isArray(h.evidenceArtifactIds) || h.evidenceArtifactIds.length > 8 ||
    h.evidenceArtifactIds.some(id => !c.evidenceManifest.some(e => e.artifactId === id) &&
      !c.ownerObservationRef?.manifest.some(m => m.selectedObservationIds.includes(id))))) fail();
}
export function bindValidatedAdaptiveResearchIntent(intent: DiscoveryIntentV2, pins: AdaptiveIntentPins, now = Date.now()): ValidatedAdaptiveResearchIntent {
  const body = { ...structuredClone(pins), mode: "owner_adaptive" as const, intent: structuredClone(intent), intentHash: discoveryV2Hash(intent) };
  const result = { ...body, bindingHash: binding(body) };
  assertValidatedAdaptiveResearchIntent(intent, result);
  validateDiscoveryIntentV2(intent, now, undefined, undefined, result);
  return result;
}
