import { containsCredentialLikeValue } from "./quest-intake";
import type { PackManifest } from "../packs/types";
import { validatePackManifest } from "../packs/registry";

/** Validation is a fail-closed preflight, never proof of semantic review or authority.
 * Only the restricted platform SQL review/promotion path can issue a release. */
export type ReviewedGuidance = {
  guidance: string; scope: string; limitations: string[]; conflicts: string[]; generalizability: string;
};
export type KnowledgeSource = {
  url: string; title: string; verifiedAt: string; expiresAt: string; contentHash: string;
  stance: "supports" | "contradicts";
};
export type KnowledgeReview = {
  redactionStatus: "accepted" | "rejected"; proofPreserved: boolean; generalizable: boolean;
  privateContentRemoved: boolean; independentSourcesVerified: boolean;
  content: ReviewedGuidance; sources: KnowledgeSource[]; expiresAt: string; notes: string;
};
export type ReviewedKnowledgePin = {
  applicationId: string; applicationReason: string; releaseId: string; installationId: string;
  packKey: string; packVersion: string; knowledgeKey: string; knowledgeVersion: string;
  /** Database-owned jsonb hashes, not interchangeable with JS canonical JSON hashes. */
  manifestHash: string; contentHash: string; verifiedAt: string; expiresAt: string;
  content: ReviewedGuidance; sources: KnowledgeSource[];
  reviewerIdentity: string; reviewerFingerprint: string;
};
export type QuestKnowledgeSnapshot = { format: "r09.1"; businessId: string; planId: string; pins: ReviewedKnowledgePin[] };
const fail = (reason: string): never => { throw new Error(`r09_${reason}`); };
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const version = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v);
const key = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(v) && v.length <= 160;
function exact(v: unknown, names: string[]): asserts v is Record<string, unknown> {
  if (!object(v) || Object.keys(v).length !== names.length || names.some(n => !Object.hasOwn(v, n))) fail("invalid_fields");
}
function text(v: unknown, max = 4000): asserts v is string {
  if (typeof v !== "string" || !v.trim() || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)) fail("invalid_text");
}
function strings(v: unknown, minimum: number): asserts v is string[] {
  if (!Array.isArray(v) || v.length < minimum || v.length > 12 || new Set(v).size !== v.length) fail("invalid_list");
  (v as unknown[]).forEach(value => text(value, 1000));
}
function instant(v: unknown): number {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) || !Number.isFinite(Date.parse(v))) fail("invalid_time");
  return Date.parse(v as string);
}
function safe(v: unknown): void {
  if (!object(v)) fail("invalid_fields");
  if (containsCredentialLikeValue(v)) fail("unsafe_content");
  if (Buffer.byteLength(JSON.stringify(v)) > 150000) fail("content_too_large");
}
function guidance(v: unknown): asserts v is ReviewedGuidance {
  exact(v, ["guidance", "scope", "limitations", "conflicts", "generalizability"]);
  text(v.guidance, 2000); text(v.scope, 2000); text(v.generalizability, 2000);
  strings(v.limitations, 1); strings(v.conflicts, 0);
}
function publicHost(value: unknown): string {
  text(value, 1000);
  let url: URL; try { url = new URL(value); } catch { return fail("unsafe_source"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || url.search ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(url.hostname) ||
    /(?:^|\.)(?:localhost|local|internal|invalid|test|example)$/i.test(url.hostname)) fail("unsafe_source");
  return url.hostname;
}
function sources(v: unknown, expires: number, now?: number): asserts v is KnowledgeSource[] {
  if (!Array.isArray(v) || v.length < 2 || v.length > 12) fail("independent_evidence_required");
  const hosts = new Set<string>(), urls = new Set<string>();
  for (const s of v as unknown[]) {
    exact(s, ["url", "title", "verifiedAt", "expiresAt", "contentHash", "stance"]);
    const host = publicHost(s.url); text(s.title, 200);
    if (!hash(s.contentHash) || !["supports", "contradicts"].includes(String(s.stance)) || urls.has(s.url as string)) fail("invalid_source");
    const verified = instant(s.verifiedAt), expiry = instant(s.expiresAt);
    if (verified >= expiry || expires > expiry || (now !== undefined && (verified > now || verified < now - 90 * 86400000 || expiry <= now))) fail("stale_or_future_source");
    if (s.stance === "contradicts") fail("conflicting_evidence_unresolved");
    hosts.add(host); urls.add(s.url as string);
  }
  // This mechanical floor never establishes independence or generalizability by itself.
  if (hosts.size < 2) fail("independent_evidence_required");
}

export function validateKnowledgeReview(value: unknown, now = Date.now()): KnowledgeReview {
  safe(value);
  exact(value, ["redactionStatus", "proofPreserved", "generalizable", "privateContentRemoved", "independentSourcesVerified", "content", "sources", "expiresAt", "notes"]);
  if (value.redactionStatus !== "accepted" || ["proofPreserved", "generalizable", "privateContentRemoved", "independentSourcesVerified"].some(k => value[k] !== true)) fail("review_unqualified");
  if (!Number.isFinite(now)) fail("invalid_time");
  const expiry = instant(value.expiresAt);
  if (expiry <= now || expiry > now + 90 * 86400000) fail("review_window_invalid");
  guidance(value.content); sources(value.sources, expiry, now); text(value.notes, 2000);
  return structuredClone(value) as KnowledgeReview;
}

/** A preview for trusted platform review. This does not register or qualify a pack. */
export function reviewedKnowledgeManifest(identity: { packKey: string; version: string; name: string }, review: KnowledgeReview, now = Date.now()): PackManifest {
  safe(identity);
  const checked = validateKnowledgeReview(review, now);
  if (!/^knowledge\.learned\.[a-z][a-z0-9-]{1,59}$/.test(identity.packKey) || !version(identity.version)) fail("invalid_release_identity");
  text(identity.name, 200);
  const verifiedAt = new Date(Math.min(...checked.sources.map(s => instant(s.verifiedAt)))).toISOString();
  const freshnessDays = Math.max(1, Math.ceil((instant(checked.expiresAt) - instant(verifiedAt)) / 86400000));
  const manifest: PackManifest = {
    frameworkVersion: "1.0", packKey: identity.packKey, version: identity.version, name: identity.name,
    kind: "knowledge", description: "Reviewed reusable guidance. Exact expiry and source verification are retained in the R09 release receipt.",
    dependencies: [], ui: { category: "Reviewed Knowledge", summary: checked.content.scope, supportedBusinessTypes: [] },
    evals: ["review", "redaction", "generalizability", "freshness"], capabilities: [], workers: [], workflows: [],
    knowledge: [{ key: identity.packKey, version: identity.version, name: identity.name, source: checked.sources[0].url,
      verifiedAt, freshnessDays, content: { ...checked.content } }],
  };
  validatePackManifest(manifest);
  return manifest;
}

/** Historic pins remain inspectable after expiry. SQL gates new scheduling,
 * reservation and dispatch; reconciliation must still see the original lesson. */
export function readQuestKnowledge(value: unknown, businessId: string, planId: string): QuestKnowledgeSnapshot {
  if (!uuid(businessId) || !uuid(planId)) fail("invalid_identity");
  exact(value, ["format", "businessId", "planId", "pins"]);
  if (value.format !== "r09.1" || value.businessId !== businessId || value.planId !== planId || !Array.isArray(value.pins) || value.pins.length > 20) fail("knowledge_scope_mismatch");
  const seen = new Set<string>();
  for (const p of value.pins as unknown[]) {
    safe(p);
    exact(p, ["applicationId", "applicationReason", "releaseId", "installationId", "packKey", "packVersion", "knowledgeKey", "knowledgeVersion", "manifestHash", "contentHash", "verifiedAt", "expiresAt", "content", "sources", "reviewerIdentity", "reviewerFingerprint"]);
    if (![p.applicationId, p.releaseId, p.installationId].every(uuid) || !key(p.packKey) || !key(p.knowledgeKey) || !version(p.packVersion) || !version(p.knowledgeVersion) || p.packVersion !== p.knowledgeVersion || ![p.manifestHash, p.contentHash, p.reviewerFingerprint].every(hash) || seen.has(p.packKey as string)) fail("invalid_knowledge_pin");
    text(p.reviewerIdentity, 200); text(p.applicationReason, 2000);
    const expiry = instant(p.expiresAt); if (instant(p.verifiedAt) >= expiry) fail("invalid_time");
    guidance(p.content); sources(p.sources, expiry); seen.add(p.packKey as string);
  }
  if (Buffer.byteLength(JSON.stringify(value)) > 150000) fail("content_too_large");
  return structuredClone(value) as QuestKnowledgeSnapshot;
}
