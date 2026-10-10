import { containsCredentialLikeValue } from "../core/quest-intake";
import type { EvidenceRefV2 } from "./discovery-v2";
import { discoveryV2Hash, discoveryEvidenceIdentity } from "./discovery-v2-hash";

type Span = { id: string; label: string; displayed: string; start: number; end: number };
export type OwnerObservationMetric = Span & (
  | { kind: "statement" }
  | { kind: "count"; unit: string; value: number; precision: "exact" | "rounded" }
  | { kind: "money_range"; currency: string; lower: number; upper: number; basis: string }
  | { kind: "ordinal"; scale: string[]; value: string; definition: string }
  | { kind: "rate"; unit: "fraction"; numerator: number; denominator: number; value: number | null }
);
export type OwnerObservation = {
  id: string; sourceId: string; provenance: "owner_reported_capture";
  source: { url: string; interface: string; capturedAt: string; captureHash: string };
  context: { productFormat: string; category: string; query: string; windowStart: string; windowEnd: string;
    locale: string; geography: { kind: "unknown" | "reported"; countries: string[]; basis: string } };
  content: string; contentHash: string; metrics: OwnerObservationMetric[]; limitations: string[];
  dataClass: "aggregate_nonpersonal";
};
export type OwnerObservationBaseline = {
  version: "r12.owner-observation-baseline.1"; declaredAt: string; timing: "prospective" | "retrospective";
  productFormat: string; category: string; windowStart: string; windowEnd: string; locale: string;
  candidateObservationIds: string[]; referenceObservationId: string;
  hypothesis: string; positiveCriterion: string; negativeCriterion: string; inconclusiveCriterion: string;
};
export type OwnerObservationBundle = {
  version: "r12.owner-observations.1"; id: string; businessId: string; ownerId: string; createdAt: string;
  observations: OwnerObservation[]; baseline: OwnerObservationBaseline | null;
  privacyAttestation: "reviewed_aggregate_only_no_credentials_or_customer_data"; bundleHash: string;
};
const fail = (): never => { throw new Error("r12_owner_observation_unverified"); };
const uuid = (v: unknown) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const text = (v: unknown, max = 300) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
function exact(v: unknown, keys: string) {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).sort().join(",") !== keys.split(",").sort().join(",")) fail();
}
const instant = (v: unknown): number => {
  if (typeof v !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v)) return fail();
  const n = Date.parse(v); if (!Number.isFinite(n) || new Date(n).toISOString().replace(".000Z", "Z") !== v.replace(".000Z", "Z")) return fail(); return n;
};
const number = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
const key = (v: unknown) => typeof v === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(v);
const list = (v: unknown, min: number, max: number): v is string[] => Array.isArray(v) && v.length >= min && v.length <= max && v.every(x => text(x)) && new Set(v).size === v.length;

/** Stable quoted-text identity: metadata, whitespace and capture IDs cannot
 * manufacture novelty. Semantic paraphrase still requires independent review. */
export function ownerObservationEvidenceIdentity(quote: string): string {
  if (!text(quote, 3000)) fail();
  return discoveryEvidenceIdentity({ quote });
}
function metric(m: OwnerObservationMetric, content: string) {
  // A percentage alone cannot witness eligible exposure or attribution. Keep it
  // as displayed text until count-reference and attribution contracts exist.
  if (m?.kind === "rate") fail();
  const fields = { statement: "", count: "unit,value,precision", money_range: "currency,lower,upper,basis", ordinal: "scale,value,definition", rate: "unit,numerator,denominator,value" };
  if (!m || !(m.kind in fields)) fail();
  exact(m, `id,label,displayed,start,end,kind${fields[m.kind] ? `,${fields[m.kind]}` : ""}`);
  const chars = Array.from(content);
  if (!key(m.id) || !text(m.label, 100) || !text(m.displayed, 160) || !Number.isSafeInteger(m.start) || !Number.isSafeInteger(m.end) ||
      m.start < 0 || m.end <= m.start || m.end > chars.length || m.end - m.start > 600 || !chars.slice(m.start, m.end).join("").includes(m.displayed)) fail();
  if (m.kind === "count" && (!text(m.unit, 60) || !number(m.value) || !["exact", "rounded"].includes(m.precision) || m.precision === "exact" && !Number.isSafeInteger(m.value))) fail();
  if (m.kind === "count") {
    const displayed = m.displayed.match(/^(\d+(?:,\d{3})*(?:\.\d+)?)([kKmMbB]?)$/);
    if (!displayed) return fail();
    const multiplier = ({ k: 1000, m: 1_000_000, b: 1_000_000_000 } as Record<string, number>)[displayed[2].toLowerCase()] ?? 1;
    if (m.value !== Number(displayed[1].replaceAll(",", "")) * multiplier || displayed[2] && m.precision !== "rounded") fail();
  }
  if (m.kind === "money_range" && (!/^[A-Z]{3}$/.test(m.currency) || !number(m.lower) || !number(m.upper) || m.lower > m.upper || !text(m.basis))) fail();
  if (m.kind === "money_range") {
    const currencyWitnesses = new Set(m.displayed.match(/\b[A-Z]{3}\b/g) ?? []);
    for(const [pattern,currency] of [[/NZ\$/,"NZD"],[/(?:^|[^A-Za-z])(?:AU\$|A\$)/,"AUD"],[/US\$/,"USD"],[/CA\$/,"CAD"],[/£/,"GBP"],[/€/ ,"EUR"]] as const)
      if(pattern.test(m.displayed))currencyWitnesses.add(currency);
    if (currencyWitnesses.size !== 1 || !currencyWitnesses.has(m.currency)) fail();
    const amounts = m.displayed.match(/\d+(?:,\d{3})*(?:\.\d+)?/g);
    if (!amounts || amounts.length !== 2 || Number(amounts[0].replaceAll(",", "")) !== m.lower || Number(amounts[1].replaceAll(",", "")) !== m.upper) fail();
  }
  if (m.kind === "ordinal" && (!list(m.scale, 2, 8) || !m.scale.includes(m.value) || m.displayed !== m.value || !text(m.definition) || m.scale.some(v => /^[-+\d.%\s]+$/.test(v)))) fail();
  if (m.kind === "rate" && (m.unit !== "fraction" || !Number.isSafeInteger(m.numerator) || !Number.isSafeInteger(m.denominator) ||
      !number(m.numerator) || !number(m.denominator) || m.numerator > m.denominator ||
      (m.denominator === 0 ? m.value !== null : !number(m.value) || Math.abs(m.value! - m.numerator / m.denominator) > 1e-12))) fail();
  if (m.kind === "rate") {
    const percent = m.displayed.match(/^(\d+)(?:\.(\d+))?%$/);
    if (!percent || Number(m.displayed.slice(0, -1)) > 100 || m.denominator > 0 &&
        Math.abs(Number(m.displayed.slice(0, -1)) / 100 - m.value!) > 0.005 / 10 ** (percent[2]?.length ?? 0) + 1e-12) fail();
  }
}

/** Pure content validation only. SQL must establish authenticated ownership,
 * immutable storage, capture existence and provider disclosure before reuse.
 * Privacy attestation plus screening is not automatic semantic redaction. */
export function validateOwnerObservationBundle(raw: unknown, expected: { businessId: string; ownerId: string; now?: number }): OwnerObservationBundle {
  exact(raw, "version,id,businessId,ownerId,createdAt,observations,baseline,privacyAttestation,bundleHash");
  if (containsCredentialLikeValue(raw)) fail();
  const b = raw as OwnerObservationBundle, now = expected.now ?? Date.now();
  if (Buffer.byteLength(JSON.stringify(b), "utf8") > 16_384 || !Number.isFinite(now) || b.version !== "r12.owner-observations.1" ||
      ![b.id,b.businessId,b.ownerId].every(uuid) || b.businessId !== expected.businessId || b.ownerId !== expected.ownerId ||
      instant(b.createdAt) > now || b.privacyAttestation !== "reviewed_aggregate_only_no_credentials_or_customer_data" ||
      !Array.isArray(b.observations) || b.observations.length < 1 || b.observations.length > 8) fail();
  const { bundleHash, ...body } = b;
  if (!hash(bundleHash) || bundleHash !== discoveryV2Hash(body)) fail();
  const ids = new Set<string>();
  for (const o of b.observations) {
    exact(o, "id,sourceId,provenance,source,context,content,contentHash,metrics,limitations,dataClass");
    exact(o.source, "url,interface,capturedAt,captureHash");
    exact(o.context, "productFormat,category,query,windowStart,windowEnd,locale,geography");
    exact(o.context.geography, "kind,countries,basis");
    if (!uuid(o.id) || ids.has(o.id) || !key(o.sourceId) || o.provenance !== "owner_reported_capture" || o.dataClass !== "aggregate_nonpersonal" ||
        !text(o.content, 3000) || !hash(o.contentHash) || o.contentHash !== discoveryV2Hash(o.content) || !hash(o.source.captureHash) ||
        !text(o.source.interface, 160) || instant(o.source.capturedAt) > instant(b.createdAt) || !list(o.limitations, 1, 8) ||
        ![o.context.productFormat,o.context.category,o.context.query,o.context.locale].every(v => text(v, 160)) ||
        instant(o.context.windowStart) > instant(o.context.windowEnd) || instant(o.context.windowEnd) > instant(o.source.capturedAt)) fail();
    ids.add(o.id);
    const g = o.context.geography;
    if (!["unknown", "reported"].includes(g.kind) || !list(g.countries, g.kind === "unknown" ? 0 : 1, g.kind === "unknown" ? 0 : 8) ||
        g.countries.some(c => !/^[A-Z]{2}$/.test(c)) || !text(g.basis)) fail();
    let url: URL; try { url = new URL(o.source.url); } catch { return fail(); }
    if (o.source.url.length > 800 || url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port ||
        !/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) || /(^|\.)(localhost|local|internal)$/i.test(url.hostname)) fail();
    // URL query is separately represented by the bounded context.query; do not
    // forward arbitrary account query parameters or customer identifiers.
    const visible = JSON.stringify({ content: o.content, context: o.context, source: o.source, metrics: o.metrics, limitations: o.limitations });
    if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:customer|buyer)\s*(?:name|email|address|id)\s*[:=]|\b(?:shipping|billing)\s+address\s*[:=]/i.test(visible)) fail();
    if (!Array.isArray(o.metrics) || o.metrics.length < 1 || o.metrics.length > 8 || new Set(o.metrics.map(m => m.id)).size !== o.metrics.length) fail();
    for (const m of o.metrics) metric(m, o.content);
  }
  if (b.baseline !== null) {
    const x = b.baseline;
    exact(x, "version,declaredAt,timing,productFormat,category,windowStart,windowEnd,locale,candidateObservationIds,referenceObservationId,hypothesis,positiveCriterion,negativeCriterion,inconclusiveCriterion");
    if (x.version !== "r12.owner-observation-baseline.1" || !["prospective", "retrospective"].includes(x.timing) || instant(x.declaredAt) > instant(b.createdAt) ||
        !list(x.candidateObservationIds, 2, 3) || x.candidateObservationIds.includes(x.referenceObservationId) ||
        ![x.hypothesis,x.positiveCriterion,x.negativeCriterion,x.inconclusiveCriterion].every(v => text(v, 600))) fail();
    for (const id of [...x.candidateObservationIds, x.referenceObservationId]) {
      const o = b.observations.find(o => o.id === id); if (!o) return fail();
      if (["productFormat","category","windowStart","windowEnd","locale"].some(k => x[k as keyof typeof x] !== o.context[k as keyof typeof o.context]) ||
          x.timing === "prospective" && instant(x.declaredAt) > instant(o.source.capturedAt)) fail();
    }
    const compared = [...x.candidateObservationIds, x.referenceObservationId].map(id => b.observations.find(o => o.id === id)!);
    if (new Set(compared.map(o => o.context.query.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase())).size !== compared.length) fail();
    // Metric IDs are arbitrary labels, not a way to evade currency/unit checks.
    // Incomplete measure sets remain valid exploratory captures but cannot assert
    // a complete comparable baseline until a common observed measure set exists.
    const dimensions = (o: OwnerObservation) => [...new Set(o.metrics.filter(m => m.kind !== "statement").map(m =>
      discoveryV2Hash(m.kind === "money_range" ? { kind:m.kind,currency:m.currency,basis:m.basis } :
        m.kind === "ordinal" ? { kind:m.kind,scale:m.scale,definition:m.definition } : { kind:m.kind,unit:m.unit })))].sort();
    if (compared.some(o => discoveryV2Hash(dimensions(o)) !== discoveryV2Hash(dimensions(compared[0])))) fail();
    const comparability = new Map<string, string>();
    for (const o of compared) for (const m of o.metrics) {
      const dimensions = discoveryV2Hash(m.kind === "statement" ? { kind: m.kind } : m.kind === "ordinal" ? { kind: m.kind, scale: m.scale, definition: m.definition } :
        m.kind === "money_range" ? { kind: m.kind, currency: m.currency, basis: m.basis } : { kind: m.kind, unit: m.unit });
      if (comparability.has(m.id) && comparability.get(m.id) !== dimensions) fail();
      comparability.set(m.id, dimensions);
    }
  }
  return structuredClone(b);
}

/** Only resolve after authenticated bundle validation/readback. UTF-32 scalar
 * offsets match existing evidence spans; no provider verification is implied. */
export function resolveOwnerObservationEvidence(bundle: OwnerObservationBundle, ref: EvidenceRefV2) {
  validateOwnerObservationBundle(bundle, { businessId: bundle.businessId, ownerId: bundle.ownerId });
  exact(ref, "artifactId,evidenceId,sourceId,sourceContentHash,start,end");
  const o = bundle.observations.find(o => o.id === ref.artifactId), m = o?.metrics.find(m => m.id === ref.evidenceId);
  if (!o || !m || ref.sourceId !== o.sourceId || ref.sourceContentHash !== o.contentHash || ref.start !== m.start || ref.end !== m.end) return fail();
  const quote = Array.from(o.content).slice(m.start, m.end).join("");
  return { reference: structuredClone(ref), quote, evidenceIdentityHash: ownerObservationEvidenceIdentity(quote),
    sourceContext: { provenance: o.provenance, independentVerification: false as const, sourceTextIsUntrusted: true as const,
      attribution: { ownerId: bundle.ownerId, businessId: bundle.businessId, authenticationRequiredAtIntake: true as const, providerSigned: false as const },
      comparisonRole: bundle.baseline?.candidateObservationIds.includes(o.id) ? "candidate" : bundle.baseline?.referenceObservationId === o.id ? "reference" : "exploratory",
      baselineTiming: bundle.baseline?.timing ?? null,
      source: structuredClone(o.source), context: structuredClone(o.context), metric: structuredClone(m), limitations: [...o.limitations] } };
}

export type OwnerObservationManifestEntry = { bundleId: string; bundleHash: string; selectedObservationIds: string[] };
export type OwnerObservationSelection = { manifestHash: string; manifest: OwnerObservationManifestEntry[] };
export function validateOwnerObservationSelection(raw: unknown): OwnerObservationSelection | null {
  if (raw === null) return null;
  exact(raw, "manifestHash,manifest");
  const s = raw as OwnerObservationSelection;
  if (!hash(s.manifestHash) || !Array.isArray(s.manifest) || s.manifest.length < 1 || s.manifest.length > 8 ||
      s.manifestHash !== discoveryV2Hash(s.manifest)) fail();
  const bundles = new Set<string>(), observations = new Set<string>();
  for (const m of s.manifest) {
    exact(m, "bundleId,bundleHash,selectedObservationIds");
    if (!uuid(m.bundleId) || !hash(m.bundleHash) || bundles.has(m.bundleId) || !list(m.selectedObservationIds, 1, 8)) fail();
    bundles.add(m.bundleId);
    for (const id of m.selectedObservationIds) { if (!uuid(id) || observations.has(id)) fail(); observations.add(id); }
  }
  if (observations.size > 8 || [...observations].some(id => bundles.has(id))) fail();
  return structuredClone(s);
}
export type OwnerObservationDossierRef = { scopeId: string; scopeHash: string; approvalHash: string; manifestHash: string };
/** Server reconstruction contract only, not a bearer credential or owner JSON.
 * SQL must bind these pins to actual scope approval and frozen phase inputs. */
export type OwnerObservationEvidenceContext = OwnerObservationDossierRef & {
  version: "r12.owner-observation-context.1"; intentId: string; businessId: string; ownerId: string;
  manifest: OwnerObservationManifestEntry[]; bundles: ReadonlyMap<string, OwnerObservationBundle>;
};
export type OwnerObservationContextJSON = Omit<OwnerObservationEvidenceContext, "bundles"> & { bundles: OwnerObservationBundle[] };
/** Convert only the frozen SQL envelope, never a browser-supplied context. */
export function readOwnerObservationEvidenceContext(raw: unknown, expected: {
  selection: OwnerObservationSelection | null; intentId: string; businessId: string; scopeId: string; scopeHash: string;
  approvalHash?: string; occupiedArtifactIds?: readonly string[]; occupiedSourceIds?: readonly string[]; now?: number;
}): OwnerObservationEvidenceContext | null {
  const selected = validateOwnerObservationSelection(expected.selection);
  if (selected === null) { if (raw !== null) fail(); return null; }
  exact(raw, "version,intentId,businessId,ownerId,scopeId,scopeHash,approvalHash,manifestHash,manifest,bundles");
  const c = raw as OwnerObservationContextJSON;
  if (!Array.isArray(c.bundles) || c.bundles.some(b => !b || !uuid(b.id)) || new Set(c.bundles.map(b => b.id)).size !== c.bundles.length ||
      c.scopeId !== expected.scopeId || c.scopeHash !== expected.scopeHash || expected.approvalHash !== undefined && c.approvalHash !== expected.approvalHash ||
      c.manifestHash !== selected.manifestHash || discoveryV2Hash(c.manifest) !== discoveryV2Hash(selected.manifest)) fail();
  const result = { ...structuredClone(c), bundles: new Map(c.bundles.map(b => [b.id, structuredClone(b)])) };
  validateOwnerObservationEvidenceContext(result, { intentId: expected.intentId, businessId: expected.businessId,
    reference: { scopeId: expected.scopeId, scopeHash: expected.scopeHash, approvalHash: expected.approvalHash ?? c.approvalHash, manifestHash: selected.manifestHash },
    occupiedArtifactIds: expected.occupiedArtifactIds ?? [], occupiedSourceIds: expected.occupiedSourceIds ?? [], now: expected.now });
  return result;
}
export function validateOwnerObservationEvidenceContext(c: OwnerObservationEvidenceContext, expected: {
  intentId: string; businessId: string; reference: OwnerObservationDossierRef;
  occupiedArtifactIds: readonly string[]; occupiedSourceIds: readonly string[]; now?: number;
}) {
  exact(c, "version,intentId,businessId,ownerId,scopeId,scopeHash,approvalHash,manifestHash,manifest,bundles");
  exact(expected.reference, "scopeId,scopeHash,approvalHash,manifestHash");
  if (c.version !== "r12.owner-observation-context.1" || ![c.intentId,c.businessId,c.ownerId,c.scopeId].every(uuid) ||
      ![c.scopeHash,c.approvalHash,c.manifestHash].every(hash) || c.intentId !== expected.intentId || c.businessId !== expected.businessId ||
      ["scopeId","scopeHash","approvalHash","manifestHash"].some(k => c[k as keyof OwnerObservationDossierRef] !== expected.reference[k as keyof OwnerObservationDossierRef]) ||
      !Array.isArray(c.manifest) || c.manifest.length < 1 || c.manifest.length > 8 || c.manifestHash !== discoveryV2Hash(c.manifest) ||
      !(c.bundles instanceof Map) || c.bundles.size !== c.manifest.length) fail();
  const artifactIds = new Set(expected.occupiedArtifactIds), sourceIds = new Set(expected.occupiedSourceIds), bundleIds = new Set<string>();
  const selected = new Map<string, { bundle: OwnerObservationBundle; observation: OwnerObservation }>();
  let bytes = 0, observations = 0;
  for (const m of c.manifest) {
    exact(m, "bundleId,bundleHash,selectedObservationIds");
    if (!uuid(m.bundleId) || !hash(m.bundleHash) || bundleIds.has(m.bundleId) || artifactIds.has(m.bundleId) ||
        !list(m.selectedObservationIds, 1, 8)) fail();
    bundleIds.add(m.bundleId);
    const b = validateOwnerObservationBundle(c.bundles.get(m.bundleId), { businessId: c.businessId, ownerId: c.ownerId, now: expected.now });
    if (b.id !== m.bundleId || b.bundleHash !== m.bundleHash) fail();
    bytes += Buffer.byteLength(JSON.stringify(b)); observations += b.observations.length;
    if (bytes > 16_384 || observations > 8) fail();
    for (const o of b.observations) {
      // All retained records occupy IDs, including records not selected for this
      // prompt, so a future active subset cannot silently change source type.
      if (artifactIds.has(o.id) || sourceIds.has(o.sourceId) || bundleIds.has(o.id)) fail();
      artifactIds.add(o.id); sourceIds.add(o.sourceId);
      if (m.selectedObservationIds.includes(o.id)) selected.set(o.id, { bundle: b, observation: o });
    }
    if (m.selectedObservationIds.some(id => !b.observations.some(o => o.id === id))) fail();
  }
  if ([...bundleIds].some(id => artifactIds.has(id))) fail();
  return selected;
}

/** Only approved records may disclose source text or comparison metadata. */
export function selectedOwnerObservationBaselines(context:OwnerObservationEvidenceContext) {
  return context.manifest.map(pin=>{
    const bundle=context.bundles.get(pin.bundleId);
    if(!bundle) return fail();
    const baseline=bundle.baseline;
    const complete=baseline!==null && [...baseline.candidateObservationIds,baseline.referenceObservationId].every(id=>pin.selectedObservationIds.includes(id));
    return {bundleId:bundle.id,baseline:complete?structuredClone(baseline):null,
      baselineStatus:complete?"selected_comparison":"withheld_or_incomplete_no_comparable_baseline",
      comparisons:bundle.observations.filter(o=>pin.selectedObservationIds.includes(o.id)).map(o=>({observationId:o.id,term:o.context.query,selected:true}))};
  });
}
