import "server-only";
import { createHash, createHmac } from "node:crypto";
import type { JsonObject } from "../core/contracts";
import type { OwnerUiContext } from "../lib/core-ui/data";
import { verifyOwnerBusiness } from "../lib/core-ui/owner-business";
import { resolveModelRoute } from "../models/registry";
import { canonicalResearchUrl, validateEvidencePack } from "./sources";
import { canonicalPublicResearchJson, publicResearchHash, publicResearchSearchRequest, validatePublicResearchPolicy, type PublicResearchPolicy } from "./qualification";
import { inspectPublicResearchWire, runPublicResearchQualification } from "./qualification-runtime";
import { validatePublicResearchQuote } from "./qualification-quote";
import { PUBLIC_RESEARCH_PROOF_PROFILE } from "./qualification-profile";
import { researchQualificationDependencies } from "./qualification-server-dependencies";
import type { ResearchBootstrapPreparation, ResearchProofGrant, ResearchProofPhase, ResearchProofPolicy, ResearchProofResult, ResearchQualificationWorkspace } from "./qualification-owner-contract";
export type { ResearchBootstrapPreparation, ResearchQualificationWorkspace } from "./qualification-owner-contract";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const MONEY = /^(0|[1-9][0-9]{0,15})$/;
const STATUSES = new Set(["ready", "collection_ready", "search_recording_pending", "selection_recording_pending", "completed", "revoked", "expired"]);
const fail = (): never => { throw new Error("research_qualification_unavailable"); };
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const sha = (x: string) => createHash("sha256").update(x).digest("hex");
function requireValue(value: unknown): asserts value { if (!value) fail(); }
function money(value: unknown): value is string { return typeof value === "string" && MONEY.test(value) && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER); }
function id(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
function hash(value: unknown): value is string { return typeof value === "string" && HASH.test(value); }
function configured() { return process.env.VERCEL_ENV === "production" && (process.env.R05_ADMISSION_SERVER_KEY?.trim().length ?? 0) >= 32 &&
  (process.env.R05_ADMISSION_SERVER_KEY?.trim().length ?? 201) <= 200 && Boolean(process.env.OPENROUTER_API_KEY?.trim()); }
function serverKey() { requireValue(configured()); return process.env.R05_ADMISSION_SERVER_KEY!.trim(); }
/** This is a separate, policy-bound capability. It never reaches the owner UI,
 * durable prompts, source excerpts, receipt output or operator tooling. */
function runtimeCapability(key: string, businessId: string, ownerId: string, policyId: string, workflowRunId: string) {
  return createHmac("sha256", key).update(canonicalPublicResearchJson({ version: "r11.owner-runtime.1", businessId, ownerId, policyId, workflowRunId })).digest("base64url");
}
async function owner(context: OwnerUiContext, businessId: string) {
  requireValue(id(businessId) && id(context.userId) && await verifyOwnerBusiness(context, businessId));
  const { data, error } = await context.supabase.auth.getClaims();
  requireValue(!error && data?.claims?.sub === context.userId && id(data.claims.session_id));
}
async function workspace(context: OwnerUiContext, businessId: string) {
  await owner(context, businessId);
  // SQL checks the live auth.sessions row, exact owner and Business. The read
  // needs no execution key and never performs catalog, search or model calls.
  const { data, error } = await context.supabase.rpc("r11_research_workspace", { p_business_id: businessId });
  requireValue(!error && object(data) && data.businessId === businessId && data.ownerId === context.userId);
  return data;
}
function policy(value: unknown, businessId: string, ownerId: string): ResearchProofPolicy {
  requireValue(object(value) && [value.policyId, value.workflowRunId, value.goalId, value.operatingPolicyId].every(id) && hash(value.policyHash) &&
    typeof value.status === "string" && STATUSES.has(value.status) && typeof value.revoked === "boolean" && typeof value.expired === "boolean" && Array.isArray(value.phases) && value.phases.length <= 2 && object(value.policy));
  const p = value.policy as unknown as PublicResearchPolicy;
  validatePublicResearchPolicy(p, Date.parse(p.validFrom));
  requireValue(p.businessId === businessId && p.ownerId === ownerId && p.id === value.policyId && p.workflowRunId === value.workflowRunId && p.goalId === value.goalId && p.operatingPolicyId === value.operatingPolicyId && publicResearchHash(p) === value.policyHash);
  const phases: ResearchProofPhase[] = value.phases.map(raw => {
    requireValue(object(raw) && ["search", "select"].includes(String(raw.phase)) && id(raw.requestId) && typeof raw.marked === "boolean" && typeof raw.settled === "boolean" &&
      (raw.actualMicrounits === null || money(raw.actualMicrounits)) && (raw.providerRequestId === null || typeof raw.providerRequestId === "string" && raw.providerRequestId.length >= 1 && raw.providerRequestId.length <= 300));
    return { phase: raw.phase as "search" | "select", requestId: raw.requestId, marked: raw.marked, settled: raw.settled,
      actualMicrounits: raw.actualMicrounits as string | null, providerRequestId: raw.providerRequestId as string | null };
  });
  requireValue(new Set(phases.map(phase => phase.phase)).size === phases.length);
  let result: ResearchProofResult | null = null;
  if (value.result !== null) {
    const r = value.result;
    requireValue(object(r) && [r.resultId, r.collectionId, r.selectorRequestId].every(id) && hash(r.evidencePackHash) &&
      typeof r.providerRequestId === "string" && r.providerRequestId.length >= 1 && r.providerRequestId.length <= 300 && typeof r.createdAt === "string" && Number.isFinite(Date.parse(r.createdAt)) && object(r.evidencePack));
    const evidencePack = r.evidencePack as ResearchProofResult["evidencePack"];
    requireValue(publicResearchHash(evidencePack) === r.evidencePackHash && evidencePack.question === p.query && evidencePack.evidencePackVersion === "1.0" &&
      Array.isArray(evidencePack.sources) && evidencePack.sources.length >= 1 && evidencePack.sources.length <= 4 && Array.isArray(evidencePack.evidence) && evidencePack.evidence.length >= 1 && evidencePack.evidence.length <= 4 && Array.isArray(evidencePack.claims) && evidencePack.claims.length <= 4 && Array.isArray(evidencePack.limitations));
    validateEvidencePack(evidencePack);
    for (const source of evidencePack.sources) requireValue(canonicalResearchUrl(source.url, p.allowedDomains) === source.url && typeof source.excerpt === "string" && source.excerpt.length <= 1800);
    const lineage = evidencePack.sourceLineage;
    requireValue(object(lineage) && lineage.policyId === p.id && lineage.policyHash === value.policyHash && hash(lineage.collectionHash));
    const selected = phases.find(phase => phase.phase === "select");
    requireValue(selected && selected.requestId === r.selectorRequestId && selected.marked && selected.settled && selected.actualMicrounits !== null && selected.providerRequestId === r.providerRequestId);
    result = { resultId: r.resultId as string, collectionId: r.collectionId as string, selectorRequestId: r.selectorRequestId as string,
      evidencePack, evidencePackHash: r.evidencePackHash, providerRequestId: r.providerRequestId, createdAt: r.createdAt };
  }
  requireValue(value.status !== "completed" || result !== null);
  return { policyId: value.policyId as string, workflowRunId: value.workflowRunId as string, goalId: value.goalId as string, operatingPolicyId: value.operatingPolicyId as string,
    policy: p, policyHash: value.policyHash, status: value.status, revoked: value.revoked, expired: value.expired, phases, result };
}
function grant(value: unknown, businessId: string, ownerId: string): ResearchProofGrant {
  requireValue(object(value) && id(value.grantId) && hash(value.grantHash) && object(value.grant) && typeof value.used === "boolean" && typeof value.expired === "boolean" && typeof value.revoked === "boolean");
  const g = value.grant;
  requireValue(g.version === "r11.owner-proof-grant.1" && g.id === value.grantId && g.businessId === businessId && g.ownerId === ownerId && id(g.policyId) && id(g.workflowRunId) &&
    hash(g.serverKeyHash) && hash(g.runtimeCapabilityHash) && object(g.researchPolicy) && publicResearchHash(g) === value.grantHash);
  const proposed = { ...g.researchPolicy, id: g.policyId, businessId, ownerId, workflowRunId: g.workflowRunId, goalId: g.policyId, operatingPolicyId: g.policyId } as PublicResearchPolicy;
  validatePublicResearchPolicy(proposed, Date.parse(proposed.validFrom));
  // Ordinary workspace rendering does not expose credential/capability verifier
  // metadata. The separate explicit preparation view provides only new hashes.
  const safe = structuredClone(g) as JsonObject;
  delete safe.serverKeyHash; delete safe.runtimeCapabilityHash;
  return { grantId: value.grantId, grantHash: value.grantHash, grant: safe as ResearchProofGrant["grant"], used: value.used, expired: value.expired, revoked: value.revoked };
}
export async function readResearchQualification(context: OwnerUiContext, businessId: string): Promise<ResearchQualificationWorkspace> {
  const empty: ResearchQualificationWorkspace = { businessId, ownerId: context.userId, unavailable: false, configured: configured(),
    exposure: { currency: "USD", heldMicrounits: "0", hasUnknown: true }, policies: [], grants: [], policyTotal: 0, grantTotal: 0 };
  try {
    const row = await workspace(context, businessId);
    requireValue(object(row.exposure) && row.exposure.currency === "USD" && money(row.exposure.heldMicrounits) && typeof row.exposure.hasUnknown === "boolean" &&
      Array.isArray(row.policies) && row.policies.length <= 25 && Array.isArray(row.grants) && row.grants.length <= 25 &&
      Number.isSafeInteger(row.policyTotal) && Number(row.policyTotal) >= row.policies.length && Number.isSafeInteger(row.grantTotal) && Number(row.grantTotal) >= row.grants.length);
    return { ...empty, exposure: { currency: "USD", heldMicrounits: row.exposure.heldMicrounits, hasUnknown: row.exposure.hasUnknown },
      policies: row.policies.map(value => policy(value, businessId, context.userId)), grants: row.grants.map(value => grant(value, businessId, context.userId)), policyTotal: Number(row.policyTotal), grantTotal: Number(row.grantTotal) };
  } catch { return { ...empty, unavailable: true }; }
}

/** Explicit preparation reads public pricing and computes verification metadata
 * only. It does not install a grant, create intent, reserve cost or call a model. */
export async function prepareResearchBootstrap(context: OwnerUiContext, businessId: string, policyId: string, workflowRunId: string): Promise<ResearchBootstrapPreparation> {
  requireValue(id(policyId) && id(workflowRunId) && policyId !== workflowRunId);
  await workspace(context, businessId);
  const key = serverKey(), dependencies = researchQualificationDependencies();
  const quote = await dependencies.fetchQuote(); validatePublicResearchQuote(quote);
  await workspace(context, businessId); requireValue(serverKey() === key);
  const preparedAt = new Date().toISOString(), expiresAt = quote.validUntil;
  const profile = structuredClone(PUBLIC_RESEARCH_PROOF_PROFILE);
  // Only query/routing fields enter the dry wire. Goal/financial identifiers and
  // approval below are placeholders for structural checking, never a saved grant.
  const proposed: PublicResearchPolicy = {
    version: "r11.public-research.1", id: policyId, businessId, ownerId: context.userId, workflowRunId, goalId: policyId, operatingPolicyId: policyId,
    query: profile.query, allowedDomains: [...profile.allowedDomains], excludedDomains: [...profile.excludedDomains], sourceReviews: profile.sourceReviews.map(review => ({ ...review })),
    queryReviewHash: publicResearchHash({ query: profile.query, classification: "generic_nonpersonal_public_research" }), termsReviewHash: profile.termsReviewHash,
    independentReviewHash: "0".repeat(64), approvalHash: "0".repeat(64), modelId: quote.modelId, providerEndpoint: quote.providerEndpoint,
    recipients: { router: "openrouter.ai", search: "exa.ai", inferenceEndpoint: quote.providerEndpoint },
    retention: { inference: "no_training_zdr", search: "query_retention_improvement_training_possible", application: "bounded_attributed_audit_evidence" },
    validFrom: preparedAt, validUntil: expiresAt, maximumMicrousd: quote.maximumMicrousd, searchMicrousd: quote.searchMicrousd, selectorMicrousd: quote.selectorMicrousd,
    priceLimit: quote.priceLimit, quoteHash: quote.quoteHash, quoteValidUntil: quote.validUntil,
  };
  const search = await inspectPublicResearchWire(publicResearchSearchRequest(proposed, resolveModelRoute("standard.default").primary), "search");
  return { version: "r11.owner-proof-preparation.1", businessId, ownerId: context.userId, policyId, workflowRunId,
    serverKeyHash: sha(key), runtimeCapabilityHash: sha(runtimeCapability(key, businessId, context.userId, policyId, workflowRunId)),
    preparedAt, expiresAt, quote, sourceProfile: profile as unknown as JsonObject, search, authorityCreated: false, paidCalls: 0 };
}
export async function activateResearchGrant(context: OwnerUiContext, businessId: string, grantId: string, grantHash: string) {
  requireValue(id(grantId) && hash(grantHash));
  const row = await workspace(context, businessId), key = serverKey();
  requireValue(Array.isArray(row.grants));
  const saved = row.grants.find(value => object(value) && value.grantId === grantId);
  requireValue(object(saved) && saved.grantHash === grantHash && !saved.expired && !saved.revoked && object(saved.grant));
  const g = saved.grant;
  requireValue(g.ownerId === context.userId && g.businessId === businessId && id(g.policyId) && id(g.workflowRunId) && g.serverKeyHash === sha(key) &&
    g.runtimeCapabilityHash === sha(runtimeCapability(key, businessId, context.userId, g.policyId, g.workflowRunId)) && publicResearchHash(g) === grantHash);
  const { data, error } = await context.supabase.rpc("r11_research_bootstrap", { p_business_id: businessId, p_grant_id: grantId, p_grant_hash: grantHash });
  requireValue(!error && object(data) && data.policyId === g.policyId && data.workflowRunId === g.workflowRunId && typeof data.replayed === "boolean");
  return { policyId: data.policyId, workflowRunId: data.workflowRunId, replayed: data.replayed };
}
export async function runResearchProof(context: OwnerUiContext, businessId: string, policyId: string) {
  requireValue(id(policyId));
  const row = await workspace(context, businessId); requireValue(Array.isArray(row.policies));
  const raw = row.policies.find(value => object(value) && value.policyId === policyId); requireValue(raw);
  const selected = policy(raw, businessId, context.userId);
  if (selected.result) return { status: "completed", resultId: selected.result.resultId };
  requireValue(!selected.revoked && !selected.expired && ["ready", "collection_ready"].includes(selected.status));
  const key = serverKey(), dependencies = researchQualificationDependencies();
  const scope = { businessId, coreWorkflowRunId: selected.workflowRunId, runtimeCapability: runtimeCapability(key, businessId, context.userId, policyId, selected.workflowRunId) };
  const verifyQuote = async (p: PublicResearchPolicy) => {
    requireValue(serverKey() === key);
    const quote = await dependencies.fetchQuote(); validatePublicResearchQuote(quote);
    requireValue(quote.quoteHash === p.quoteHash && quote.modelId === p.modelId && quote.providerEndpoint === p.providerEndpoint &&
      quote.searchMicrousd === p.searchMicrousd && quote.selectorMicrousd === p.selectorMicrousd && publicResearchHash(quote.priceLimit) === publicResearchHash(p.priceLimit));
    requireValue(serverKey() === key); return { providerName: quote.providerName };
  };
  await runPublicResearchQualification(scope, policyId, dependencies.makeRuntime(scope, verifyQuote));
  const latest = await readResearchQualification(context, businessId), proof = latest.policies.find(item => item.policyId === policyId);
  requireValue(!latest.unavailable && proof?.result);
  return { status: "completed", resultId: proof.result.resultId };
}
export async function stopResearchProof(context: OwnerUiContext, businessId: string, policyId: string) {
  requireValue(id(policyId)); await owner(context, businessId);
  const { data, error } = await context.supabase.rpc("r11_research_revoke", { p_business_id: businessId, p_policy_id: policyId });
  requireValue(!error && object(data) && data.policyId === policyId && data.revoked === true);
  return { policyId, revoked: true };
}
