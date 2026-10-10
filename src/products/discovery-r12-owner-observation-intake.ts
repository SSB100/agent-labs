import { discoveryV2Hash } from "./discovery-v2-hash";
import { validateOwnerObservationBundle, type OwnerObservationBundle } from "./discovery-r12-owner-observation";

/** Owner-entered textual captures. No API access, numeric inference, or authority. */
export type OwnerObservationIntake = {
  id: string; createdAt: string; productFormat: string; category: string;
  windowStart: string; windowEnd: string; locale: string;
  observations: Array<{ id: string; query: string; url: string; interface: string;
    capturedAt: string; content: string; excerpt: string; limitations: string }>;
  baseline: null | { hypothesis: string; positiveCriterion: string; negativeCriterion: string; inconclusiveCriterion: string };
  privacyReviewed: boolean;
};
export function buildOwnerObservationIntake(raw: OwnerObservationIntake, businessId: string, ownerId: string): OwnerObservationBundle {
  if (!raw || raw.privacyReviewed !== true || !Array.isArray(raw.observations) ||
      raw.observations.length < 1 || raw.observations.length > 4 ||
      raw.baseline !== null && ![3,4].includes(raw.observations.length)) throw new Error("r12_owner_observation_intake_invalid");
  const observations = raw.observations.map(row => {
    if (!row || typeof row.content !== "string" || typeof row.excerpt !== "string" || !row.excerpt.trim() ||
        !/^https:\/\/(?:www\.)?etsy\.com\//i.test(row.url)) throw new Error("r12_owner_observation_intake_invalid");
    const offset = row.content.indexOf(row.excerpt);
    if (offset < 0) throw new Error("r12_owner_observation_intake_invalid");
    const start = Array.from(row.content.slice(0, offset)).length;
    return { id: row.id, sourceId: `owner-${row.id}`, provenance: "owner_reported_capture" as const,
      source: { url: row.url, interface: row.interface, capturedAt: row.capturedAt,
        captureHash: discoveryV2Hash({ url: row.url, interface: row.interface, capturedAt: row.capturedAt, content: row.content }) },
      context: { productFormat: raw.productFormat, category: raw.category, query: row.query,
        windowStart: raw.windowStart, windowEnd: raw.windowEnd, locale: raw.locale,
        geography: { kind: "unknown" as const, countries: [], basis: "Buyer geography was not independently established by this textual capture; account locale is not buyer geography." } },
      content: row.content, contentHash: discoveryV2Hash(row.content),
      metrics: [{ id: "observed-text", label: "Exact displayed observation", displayed: row.excerpt,
        start, end: start + Array.from(row.excerpt).length, kind: "statement" as const }],
      limitations: [row.limitations], dataClass: "aggregate_nonpersonal" as const };
  });
  const body = { version: "r12.owner-observations.1" as const, id: raw.id, businessId, ownerId, createdAt: raw.createdAt,
    observations, baseline: raw.baseline === null ? null : { version: "r12.owner-observation-baseline.1" as const,
      declaredAt: raw.createdAt, timing: "retrospective" as const, productFormat: raw.productFormat,
      category: raw.category, windowStart: raw.windowStart, windowEnd: raw.windowEnd, locale: raw.locale,
      candidateObservationIds: observations.slice(0,-1).map(o => o.id), referenceObservationId: observations.at(-1)!.id,
      ...raw.baseline }, privacyAttestation: "reviewed_aggregate_only_no_credentials_or_customer_data" as const };
  return validateOwnerObservationBundle({ ...body, bundleHash: discoveryV2Hash(body) }, { businessId, ownerId });
}
