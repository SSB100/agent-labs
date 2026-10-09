import { containsCredentialLikeValue } from "../core/quest-intake";
import { validateResearchRequest } from "../research/sources";
import { discoveryV2Hash, validateDiscoveryIntentV2, type DiscoveryIntentV2 } from "./discovery-v2";

/** Trusted server context only: construct after checking the persisted owner,
 * Goal and exact initial scope. This binding prevents accidental substitution;
 * it is not an authorization grant or a worker-supplied attestation. */
export type ValidatedOwnerResearchIntent = Readonly<{
  mode: "owner_initial";
  scopeId: string;
  scopeHash: string;
  intent: DiscoveryIntentV2;
  intentHash: string;
  approvedQuery: string;
  bindingHash: string;
}>;
export type OwnerResearchIntentPins = { scopeId: string; scopeHash: string; approvedQuery: string };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hash = /^[a-f0-9]{64}$/;
const fail = (): never => { throw new Error("r12_owner_research_intent_unverified"); };
const binding = (value: Omit<ValidatedOwnerResearchIntent, "bindingHash">) => discoveryV2Hash({
  mode: value.mode, scopeId: value.scopeId, scopeHash: value.scopeHash,
  intentHash: value.intentHash, approvedQuery: value.approvedQuery,
});
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
/** Recheck immutable pins on every local use. Only the trusted server can
 * establish that scopeHash belongs to this owner's reviewed persisted scope. */
export function assertValidatedOwnerResearchIntent(intent: DiscoveryIntentV2, context: ValidatedOwnerResearchIntent): void {
  if (!context || Object.keys(context).sort().join(",") !== "approvedQuery,bindingHash,intent,intentHash,mode,scopeHash,scopeId" ||
      context.mode !== "owner_initial" || typeof context.scopeId !== "string" || !uuid.test(context.scopeId) ||
      typeof context.scopeHash !== "string" || !hash.test(context.scopeHash) || typeof context.intentHash !== "string" || !hash.test(context.intentHash) ||
      context.scopeId !== intent.id || context.intentHash !== discoveryV2Hash(intent) || context.intentHash !== discoveryV2Hash(context.intent) ||
      context.bindingHash !== binding(context) || intent.limits.maximumNewCollections !== 1 ||
      typeof context.approvedQuery !== "string" || context.approvedQuery.trim() !== context.approvedQuery || context.approvedQuery !== intent.comparisonUniverse.selectionQuestion ||
      containsCredentialLikeValue({ intent, approvedQuery: context.approvedQuery })) return fail();
  validateResearchRequest({ query: context.approvedQuery, allowedDomains: intent.comparisonUniverse.sourceDomains });
}
/** Call only after trusted scope validation, never directly on request JSON.
 * Pure validation/ownership binding makes no call, reservation or new authority. */
export function bindValidatedOwnerResearchIntent(intent: DiscoveryIntentV2, pins: OwnerResearchIntentPins, now = Date.now()): ValidatedOwnerResearchIntent {
  if (!pins || Object.keys(pins).sort().join(",") !== "approvedQuery,scopeHash,scopeId" || !Number.isFinite(now)) return fail();
  const value = { mode: "owner_initial" as const, ...structuredClone(pins), intent: structuredClone(intent), intentHash: discoveryV2Hash(intent) };
  const context: ValidatedOwnerResearchIntent = { ...value, bindingHash: binding(value) };
  validateDiscoveryIntentV2(context.intent, now, undefined, context);
  return freeze(context);
}
