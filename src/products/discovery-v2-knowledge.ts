import { createHash } from "node:crypto";
import type { JsonObject } from "../core/contracts";
import { resolvePackDependencies } from "../packs/dependencies";
import type { PackRelease, PackKnowledge } from "../packs/types";

export const DISCOVERY_KNOWLEDGE_KEYS_V2 = ["etsy.current-policy", "pod.production", "product.research", "social.marketing"] as const;
export const DISCOVERY_REQUIRED_KNOWLEDGE_KEYS_V2 = [...DISCOVERY_KNOWLEDGE_KEYS_V2, "research.evidence-guide"] as const;
export type DiscoveryKnowledgeKeyV2 = typeof DISCOVERY_REQUIRED_KNOWLEDGE_KEYS_V2[number];
export type PinnedDiscoveryKnowledgeV2 = {
  releaseId: string; packKey: string; packVersion: string; manifestHash: string;
  knowledgeKey: DiscoveryKnowledgeKeyV2; knowledgeVersion: string; contentHash: string;
};
/** Trusted owner-scoped pinned catalog snapshot; retain complete manifests/content server-side. */
export type DiscoveryKnowledgeContextV2 = {
  snapshot: { rootPackId: string; releases: PackRelease[] }; records: PinnedDiscoveryKnowledgeV2[];
};
export type DiscoveryKnowledgePhaseV2 = "plan" | "research" | "strategy" | "review";
const GUIDELINES: Record<typeof DISCOVERY_KNOWLEDGE_KEYS_V2[number], { plan: readonly string[]; analysis: readonly string[]; planLimit: number }> = {
  "etsy.current-policy": { plan: ["original-design-eligibility", "ip-rights-required"], analysis: ["original-design-eligibility", "ai-disclosure", "ip-rights-required"], planLimit: 0 },
  "pod.production": { plan: ["cost-inputs"], analysis: ["per-product-print-files", "delivery-estimates", "cost-inputs"], planLimit: 1 },
  "product.research": { plan: ["hypotheses-not-sales"], analysis: ["evidence-record", "hypotheses-not-sales", "ranking-not-demand"], planLimit: 0 },
  "social.marketing": { plan: ["engagement-not-sales"], analysis: ["bounded-content-test", "engagement-not-sales"], planLimit: 1 },
};
function fail(message: string): never { throw new Error(message); }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function exact(value: unknown, keys: string, label: string): asserts value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).sort().join(",") !== keys.split(",").sort().join(",")) fail(`Invalid ${label}.`);
}
export function discoveryKnowledgeHashV2(value: unknown): string {
  const canonical = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
    if (object(v)) return `{${Object.keys(v).sort().map(key => `${JSON.stringify(key)}:${canonical(v[key])}`).join(",")}}`;
    if (v === undefined || (typeof v === "number" && !Number.isFinite(v))) fail("Invalid knowledge JSON.");
    return JSON.stringify(v);
  };
  return createHash("sha256").update(canonical(value)).digest("hex");
}
function url(value: unknown) {
  if (typeof value !== "string") fail("Knowledge needs a public source URL.");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.hash || /[?&](token|api_key|access_token|password|auth)=/i.test(parsed.search)) fail("Unsafe knowledge source URL.");
}
function closure(snapshot: DiscoveryKnowledgeContextV2["snapshot"]) {
  const root = snapshot.releases.find(release => release.id === snapshot.rootPackId);
  if (!root) fail("Pinned knowledge root release is missing.");
  // Experimental status stays explicit; this validates dependency scope, never promotes qualifications.
  return resolvePackDependencies(snapshot.releases, { packKey: root.manifest.packKey, version: root.manifest.version }, true);
}
function matching(releases: PackRelease[], key: DiscoveryKnowledgeKeyV2) {
  const matches = releases.flatMap(release => release.manifest.knowledge.filter(knowledge => knowledge.key === key).map(knowledge => ({ release, knowledge })));
  if (matches.length !== 1) fail(`Pinned discovery knowledge is missing or ambiguous: ${key}.`);
  return matches[0];
}
function inspectKnowledge(knowledge: PackKnowledge, now: number) {
  url(knowledge.source);
  const verified = Date.parse(knowledge.verifiedAt), expires = verified + knowledge.freshnessDays * 86400000;
  if (!Number.isFinite(verified) || verified > now || !Number.isInteger(knowledge.freshnessDays) || knowledge.freshnessDays < 1 || knowledge.freshnessDays > 365 || expires <= now) fail("Pinned discovery knowledge is stale or future-dated.");
  const content = knowledge.content;
  if (knowledge.key === "research.evidence-guide") {
    if(knowledge.version!=="2.0.0")fail("V2 research requires the pinned exact-span evidence guide, not v1 ID-only selection.");
    exact(content, "guidance", "research evidence guide");
    if (typeof content.guidance !== "string" || content.guidance.trim().length < 20) fail("Research evidence guide needs complete scoped guidance.");
    return { verifiedAt: knowledge.verifiedAt, expiresAt: new Date(expires).toISOString() };
  }
  if (!Array.isArray(content.guidelines) || !Array.isArray(content.sources) || !Array.isArray(content.limitations) || !content.limitations.length || content.limitations.some(value => typeof value !== "string" || !value.trim()) || typeof content.executionBoundary !== "string") fail("Knowledge needs inspectable guidelines, sources, limitations and execution boundary.");
  const ids = new Set<string>();
  for (const raw of content.guidelines) {
    exact(raw, "id,statement,sourceUrl,kind", "knowledge guideline");
    if (typeof raw.id !== "string" || ids.has(raw.id) || typeof raw.statement !== "string" || !raw.statement.trim() || !["platform_rule", "guidance", "implementation_inference"].includes(String(raw.kind))) fail("Invalid attributed knowledge guideline.");
    ids.add(raw.id); url(raw.sourceUrl);
    if (!content.sources.some(source => object(source) && source.url === raw.sourceUrl && source.verifiedAt === knowledge.verifiedAt)) fail("Guideline source/verification lineage is missing.");
  }
  for (const source of content.sources) { if (!object(source)) fail("Invalid knowledge source."); url(source.url); }
  if (object(content.sourceDateAnomaly) && Array.isArray(content.sourceDateAnomaly.excludedSourceUrls)) {
    const excluded = content.sourceDateAnomaly.excludedSourceUrls;
    if (content.guidelines.some(g => object(g) && excluded.includes(g.sourceUrl as string))) fail("Knowledge relies on an explicitly excluded policy source.");
  }
  return { verifiedAt: knowledge.verifiedAt, expiresAt: new Date(expires).toISOString() };
}
export function pinDiscoveryKnowledgeV2(snapshot: DiscoveryKnowledgeContextV2["snapshot"], now = Date.now()): DiscoveryKnowledgeContextV2 {
  const releases = closure(snapshot);
  const records = DISCOVERY_REQUIRED_KNOWLEDGE_KEYS_V2.map(key => {
    const { release, knowledge } = matching(releases, key); inspectKnowledge(knowledge, now);
    return { releaseId: release.id, packKey: release.manifest.packKey, packVersion: release.manifest.version, manifestHash: discoveryKnowledgeHashV2(release.manifest), knowledgeKey: key, knowledgeVersion: knowledge.version, contentHash: discoveryKnowledgeHashV2(knowledge.content) };
  });
  return { snapshot: structuredClone(snapshot), records };
}
export function validateDiscoveryKnowledgeV2(context: DiscoveryKnowledgeContextV2, now = Date.now()): void {
  exact(context, "snapshot,records", "trusted discovery knowledge context");
  if (!Array.isArray(context.records) || context.records.length !== DISCOVERY_REQUIRED_KNOWLEDGE_KEYS_V2.length || new Set(context.records.map(record => record.knowledgeKey)).size !== DISCOVERY_REQUIRED_KNOWLEDGE_KEYS_V2.length) fail("All five pinned discovery knowledge records are required.");
  const releases = closure(context.snapshot);
  for (const record of context.records) {
    exact(record, "releaseId,packKey,packVersion,manifestHash,knowledgeKey,knowledgeVersion,contentHash", "knowledge pin");
    if (!DISCOVERY_REQUIRED_KNOWLEDGE_KEYS_V2.includes(record.knowledgeKey)) fail("Unexpected knowledge scope.");
    const { release, knowledge } = matching(releases, record.knowledgeKey);
    if (record.releaseId !== release.id || record.packKey !== release.manifest.packKey || record.packVersion !== release.manifest.version || record.knowledgeVersion !== knowledge.version || record.manifestHash !== discoveryKnowledgeHashV2(release.manifest) || record.contentHash !== discoveryKnowledgeHashV2(knowledge.content)) fail("Pinned knowledge hash/version/lineage mismatch.");
    inspectKnowledge(knowledge, now);
    if (record.knowledgeKey === "research.evidence-guide") continue;
    for (const key of GUIDELINES[record.knowledgeKey].analysis) if (!(knowledge.content.guidelines as JsonObject[]).some(g => object(g) && g.id === key)) fail("Required scoped knowledge guideline is absent.");
  }
}
/** Deterministic semantic selection of complete guidelines, never prefix/length truncation. */
export function buildDiscoveryKnowledgeContextV2(context: DiscoveryKnowledgeContextV2, phase: DiscoveryKnowledgePhaseV2, now = Date.now()): JsonObject {
  validateDiscoveryKnowledgeV2(context, now);
  const releases = closure(context.snapshot), boundaries = new Map<string, string[]>();
  if (phase === "research") {
    const { release, knowledge } = matching(releases, "research.evidence-guide"), dates = inspectKnowledge(knowledge, now);
    return { knowledge: [{ ref: "K5", key: knowledge.key, version: knowledge.version, status: release.status, source: knowledge.source, ...dates, guidance: knowledge.content.guidance }],
      interpretation: "This exact pinned evidence guide constrains source selection; it grants no strategy, generation, spending or publication authority. Complete original and pin hashes are retained server-side." };
  }
  const knowledge = DISCOVERY_KNOWLEDGE_KEYS_V2.map((key, index) => {
    const ref = `K${index + 1}`, { release, knowledge } = matching(releases, key), dates = inspectKnowledge(knowledge, now);
    const selected = GUIDELINES[key], ids = phase === "plan" ? selected.plan : selected.analysis;
    const guidelines = ids.map(id => {
      const guideline = (knowledge.content.guidelines as JsonObject[]).find(g => g.id === id)!;
      return { ref: `${ref}:${id}`, kind: guideline.kind, sourceUrl: guideline.sourceUrl, statement: guideline.statement };
    });
    const limitations = knowledge.content.limitations as string[];
    if (phase === "plan" && !limitations[selected.planLimit]) fail("Required planner knowledge limitation is absent.");
    const boundary = knowledge.content.executionBoundary as string;
    boundaries.set(boundary, [...boundaries.get(boundary) ?? [], ref]);
    return { ref, key, version: knowledge.version, status: release.status, ...dates, guidelines,
      limitations: phase === "plan" ? [limitations[selected.planLimit]] : [...limitations],
      ...(knowledge.content.sourceDateAnomaly ? { sourceDateAnomaly: structuredClone(knowledge.content.sourceDateAnomaly) } : {}) };
  });
  return { knowledge, executionBoundaries: [...boundaries].map(([statement, refs]) => ({ refs, statement })),
    interpretation: "Pinned guidance informs reasoning; it is not candidate demand evidence, rights clearance, provider qualification or execution authority. Complete originals and pin hashes remain in the bound server-side context." };
}
