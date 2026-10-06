import { createHash } from "node:crypto";
import { containsCredentialLikeValue } from "../core/quest-intake";
import { DIMENSIONS, type Dimension } from "./types";
import { discoveryV2Hash, discoveryV2SnapshotByteLength, type DiscoveryIntentV2, type EvidenceRefV2 } from "./discovery-v2";

/** Reviewed observations have their own provenance. They are never labelled as
 * Exa results, provider-qualified source output, rights clearance or sales. */
export type DiscoveryPublicObservation = {
  id: string; sourceId: string; url: string; title: string;
  access: "public_document_read" | "public_search_index"; kind: "retail_offer" | "official_operating_fact" | "published_research";
  retrievedAt: string; expiresAt: string; captureHash: string; contentHash: string;
  context: string; start: number; end: number;
  geographyRole: "buyer_market" | "seller_jurisdiction" | "general_operating_context";
  countries: string[]; dimensions: Dimension[]; limitations: string[];
  sourceReviewHash: string;
};
export type DiscoveryEvidenceAddendum = {
  version: "r12.discovery-evidence-addendum.1"; id: string; businessId: string; goalId: string;
  predecessorScopeId: string; predecessorReviewHash: string;
  observations: DiscoveryPublicObservation[];
  sellerBankCountry: string | null;
  approvalHash: string; independentReviewHash: string; createdAt: string; expiresAt: string;
};
export type DiscoveryAddendumRef = { artifactId: string; sha256: string };
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fail = (): never => { throw Error("r12_evidence_addendum_unverified"); };
const exact = (value: unknown, keys: string) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== keys.split(",").sort().join(",")) fail();
};
const text = (value: unknown, min: number, max: number): value is string => typeof value === "string" && value.trim() === value && value.length >= min && value.length <= max;
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const unique = (value: unknown, min: number, max: number): value is string[] => Array.isArray(value) && value.length >= min && value.length <= max && value.every(x => typeof x === "string") && new Set(value).size === value.length;

/** Trusted persistence must separately bind approval and captured document
 * hashes. This pure validator checks integrity, scope and temporal bounds; it
 * cannot attest that an operator's description is true. */
export function validateDiscoveryEvidenceAddendum(value: DiscoveryEvidenceAddendum, intent: DiscoveryIntentV2, now: number): DiscoveryEvidenceAddendum {
  exact(value, "version,id,businessId,goalId,predecessorScopeId,predecessorReviewHash,observations,sellerBankCountry,approvalHash,independentReviewHash,createdAt,expiresAt");
  if (value.version !== "r12.discovery-evidence-addendum.1" || !Number.isFinite(now) || containsCredentialLikeValue(value) ||
      ![value.id, value.businessId, value.goalId, value.predecessorScopeId].every(x => UUID.test(x)) || value.businessId !== intent.businessId ||
      ![value.predecessorReviewHash, value.approvalHash, value.independentReviewHash].every(x => HASH.test(x)) ||
      (value.sellerBankCountry !== null && !/^[A-Z]{2}$/.test(value.sellerBankCountry)) ||
      !Array.isArray(value.observations) || value.observations.length < 1 || value.observations.length > 8 || discoveryV2SnapshotByteLength(value) > 16384) return fail();
  const created = Date.parse(value.createdAt), expires = Date.parse(value.expiresAt);
  if (!Number.isFinite(created) || !Number.isFinite(expires) || created > now || expires <= now || expires > created + 24 * 60 * 60_000) return fail();
  const ids = new Set<string>(), sources = new Set<string>();
  for (const observation of value.observations) {
    exact(observation, "id,sourceId,url,title,access,kind,retrievedAt,expiresAt,captureHash,contentHash,context,start,end,geographyRole,countries,dimensions,limitations,sourceReviewHash");
    if (!/^evi-[a-f0-9]{24}$/.test(observation.id) || !/^src-[a-f0-9]{24}$/.test(observation.sourceId) || ids.has(observation.id) || sources.has(observation.sourceId) ||
        !["public_document_read", "public_search_index"].includes(observation.access) || !["retail_offer", "official_operating_fact", "published_research"].includes(observation.kind) ||
        !text(observation.title, 3, 160) || !text(observation.context, 30, 1200) ||
        ![observation.captureHash, observation.contentHash, observation.sourceReviewHash].every(x => HASH.test(x)) || observation.contentHash !== digest(observation.context) ||
        !unique(observation.countries, 0, 4) || observation.countries.some(c => !intent.comparisonUniverse.markets.some(m => m.countryCode === c)) ||
        !["buyer_market", "seller_jurisdiction", "general_operating_context"].includes(observation.geographyRole) ||
        (observation.geographyRole !== "general_operating_context" && !observation.countries.length) ||
        (observation.kind !== "official_operating_fact" && observation.geographyRole !== "buyer_market") ||
        !unique(observation.dimensions, 1, 9) || observation.dimensions.some(d => !DIMENSIONS.includes(d)) ||
        !unique(observation.limitations, 1, 5) || observation.limitations.some(l => !text(l, 20, 240))) return fail();
    let url: URL;
    try { url = new URL(observation.url); } catch { return fail(); }
    if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search || url.port || observation.url.length > 800 ||
        !/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) || /(^|\.)(localhost|local|internal)$/i.test(url.hostname)) return fail();
    // Current source approval excludes Etsy marketplace analytics. Official fee
    // and policy documents have a different purpose and remain available.
    if ((url.hostname === "etsy.com" || url.hostname.endsWith(".etsy.com")) &&
        !(observation.kind === "official_operating_fact" && (/^\/legal\//.test(url.pathname) || url.hostname === "help.etsy.com"))) return fail();
    const retrieved = Date.parse(observation.retrievedAt), end = Date.parse(observation.expiresAt), characters = Array.from(observation.context);
    if (!Number.isFinite(retrieved) || !Number.isFinite(end) || retrieved > created || retrieved > now || end <= now || end > retrieved + 24 * 60 * 60_000 || expires > end ||
        !Number.isSafeInteger(observation.start) || !Number.isSafeInteger(observation.end) || observation.start < 0 || observation.end <= observation.start || observation.end > characters.length || observation.end - observation.start > 320 ||
        !characters.slice(observation.start, observation.end).join("").trim()) return fail();
    if (observation.kind === "retail_offer" && observation.dimensions.some(d => ["demand", "seasonality", "marketing_potential"].includes(d))) return fail();
    if (observation.kind === "official_operating_fact" && observation.dimensions.some(d => ["demand", "competition", "seasonality", "marketing_potential"].includes(d))) return fail();
    ids.add(observation.id); sources.add(observation.sourceId);
  }
  return structuredClone(value);
}

export function discoveryAddendumReferences(value: DiscoveryEvidenceAddendum): EvidenceRefV2[] {
  return value.observations.map(o => ({ artifactId: value.id, evidenceId: o.id, sourceId: o.sourceId, sourceContentHash: o.contentHash, start: o.start, end: o.end }));
}

export function discoveryAddendumObservation(value: DiscoveryEvidenceAddendum, ref: EvidenceRefV2) {
  const observation = value.observations.find(o => o.id === ref.evidenceId);
  if (!observation || ref.artifactId !== value.id || ref.sourceId !== observation.sourceId || ref.sourceContentHash !== observation.contentHash || ref.start !== observation.start || ref.end !== observation.end) return fail();
  return observation;
}

export const discoveryAddendumHash = (value: DiscoveryEvidenceAddendum) => discoveryV2Hash(value);

/** Exact repeated text only. This retains every source, limitation and prior
 * decision while avoiding duplicated prose in the bounded reviewer payload. */
export function compactDiscoveryEvidenceInput(input: Record<string, unknown>): Record<string, unknown> {
  const counts = new Map<string, number>();
  const count = (value: unknown): void => {
    if (typeof value === "string" && value.length >= 48) counts.set(value, (counts.get(value) ?? 0) + 1);
    else if (Array.isArray(value)) value.forEach(count);
    else if (value && typeof value === "object") {
      if (Object.keys(value).includes("$text") || Object.keys(value).includes("sharedText")) return fail();
      Object.values(value).forEach(count);
    }
  };
  count(input);
  const sharedText = [...counts].filter(([text, count]) => (count - 1) * Buffer.byteLength(JSON.stringify(text), "utf8") - count * 14 > 32).map(([text]) => text);
  const indexes = new Map(sharedText.map((text, index) => [text, index]));
  const encode = (value: unknown): unknown => {
    if (typeof value === "string") return indexes.has(value) ? { $text: indexes.get(value) } : value;
    if (Array.isArray(value)) return value.map(encode);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, encode(child)]));
    return value;
  };
  const compact = { ...encode(input) as Record<string, unknown>, sharedText };
  return Buffer.byteLength(JSON.stringify(compact), "utf8") < Buffer.byteLength(JSON.stringify(input), "utf8") ? compact : structuredClone(input);
}
