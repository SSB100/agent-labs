import "server-only";
import { createHash, createHmac } from "node:crypto";
import type { JsonObject } from "../core/contracts";
import type { OwnerUiContext } from "../lib/core-ui/data";
import { verifyOwnerBusiness } from "../lib/core-ui/owner-business";
import { resolveModelRoute } from "../models/registry";
import { canonicalResearchUrl, validateEvidencePack } from "./sources";
import { canonicalPublicResearchJson, publicResearchHash, publicResearchSearchRequest, validatePublicResearchPolicy, type PublicResearchPolicy } from "./qualification";
import { inspectPublicResearchWire, runPublicResearchQualification } from "./qualification-runtime";
import { validateGenerationRouteProof, type GenerationRouteExpectation } from "./generation-route";
import { PUBLIC_RESEARCH_QUOTE_LIMITS, validatePublicResearchQuote } from "./qualification-quote";
import { PUBLIC_RESEARCH_PROOF_PROFILE } from "./qualification-profile";
import { researchQualificationDependencies } from "./qualification-server-dependencies";
import { validateResearchObservation } from "./qualification-outcome";
import { RESEARCH_FAILURE_REASONS, type ResearchBootstrapPreparation, type ResearchContinuation, type ResearchOutcomeEvent, type ResearchProofGrant, type ResearchProofPhase, type ResearchProofPolicy, type ResearchProofResult, type ResearchQualificationWorkspace } from "./qualification-owner-contract";
export type { ResearchBootstrapPreparation, ResearchQualificationWorkspace } from "./qualification-owner-contract";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const MONEY = /^(0|[1-9][0-9]{0,15})$/;
const STATUSES = new Set(["ready", "collection_ready", "search_recording_pending", "selection_recording_pending", "completed", "revoked", "expired", "needs_owner", "cancelled", "failed"]);
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
function attemptAdmissionKey(key: string, businessId: string, ownerId: string, policyId: string, workflowRunId: string) {
  return createHmac("sha256", key).update(canonicalPublicResearchJson({ version: "r11.attempt-admission.1", businessId, ownerId, policyId, workflowRunId })).digest("base64url");
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
  const { data, error } = await context.supabase.rpc("r11_research_workspace_v2", { p_business_id: businessId });
  requireValue(!error && object(data) && data.businessId === businessId && data.ownerId === context.userId);
  return data;
}
function continuation(value: unknown): ResearchContinuation | null {
  if (value === null || value === undefined) return null;
  requireValue(object(value) && Object.keys(value).sort().join(",") === "businessRevision,capRevision,currentOperatingPolicyId,eligible,exposureMicrounits,goalId,goalRevision,lifetimeCapMicrounits,predecessorPolicyId,predecessorWorkflowRunId,reason,remainingMicrounits" &&
    [value.predecessorPolicyId, value.predecessorWorkflowRunId, value.currentOperatingPolicyId, value.goalId].every(id) &&
    [value.goalRevision, value.businessRevision, value.capRevision].every(x => Number.isSafeInteger(x) && Number(x) >= 1) &&
    [value.lifetimeCapMicrounits, value.exposureMicrounits, value.remainingMicrounits].every(money) && typeof value.eligible === "boolean" &&
    typeof value.reason === "string" && /^[a-z][a-z_]{1,79}$/.test(value.reason));
  const remaining = BigInt(value.remainingMicrounits as string), held = BigInt(value.exposureMicrounits as string), lifetime = BigInt(value.lifetimeCapMicrounits as string);
  requireValue(remaining === (lifetime > held ? lifetime - held : BigInt(0)) && (!value.eligible || value.reason === "ready" && remaining > BigInt(0)));
  return structuredClone(value) as unknown as ResearchContinuation;
}
function outcomes(value: unknown, p: PublicResearchPolicy): ResearchOutcomeEvent[] {
  if (value === undefined) return []; // Historical v1 projection is not a diagnosis.
  requireValue(Array.isArray(value) && value.length <= 20);
  return value.map(raw => {
    requireValue(object(raw) && id(raw.outcomeId) && ["failure", "owner_stopped"].includes(String(raw.kind)) &&
      ["none", "search", "select"].includes(String(raw.phase)) && (raw.requestId === null || id(raw.requestId)) &&
      [...RESEARCH_FAILURE_REASONS, "owner_stopped", "legacy_failure_undetermined"].includes(String(raw.reason)) &&
      typeof raw.createdAt === "string" && Number.isFinite(Date.parse(raw.createdAt)));
    requireValue(raw.kind !== "owner_stopped" || raw.reason === "owner_stopped");
    const observation = raw.observation === null ? null : validateResearchObservation(raw.observation, p.allowedDomains, p.modelId);
    return { outcomeId: raw.outcomeId, kind: raw.kind as ResearchOutcomeEvent["kind"], phase: raw.phase as ResearchOutcomeEvent["phase"],
      requestId: raw.requestId as string | null, reason: raw.reason as ResearchOutcomeEvent["reason"], observation, createdAt: raw.createdAt };
  });
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
  requireValue(value.attemptVersion === undefined || value.attemptVersion === 1 || value.attemptVersion === 2);
  requireValue(value.terminalReconciliationRequired === undefined || typeof value.terminalReconciliationRequired === "boolean");
  return { policyId: value.policyId as string, workflowRunId: value.workflowRunId as string, goalId: value.goalId as string, operatingPolicyId: value.operatingPolicyId as string,
    policy: p, policyHash: value.policyHash, status: value.status, revoked: value.revoked, expired: value.expired, phases, result,
    attemptVersion: value.attemptVersion === 2 ? 2 : 1, outcomeEvents: outcomes(value.outcomes, p), terminalReconciliationRequired: value.terminalReconciliationRequired === true };
}
function grant(value: unknown, businessId: string, ownerId: string): ResearchProofGrant {
  requireValue(object(value) && id(value.grantId) && hash(value.grantHash) && object(value.grant) && typeof value.used === "boolean" && typeof value.expired === "boolean" && typeof value.revoked === "boolean");
  const g = value.grant;
  requireValue(["r11.owner-proof-grant.1", "r11.owner-continuation-grant.1"].includes(String(g.version)) && g.id === value.grantId && g.businessId === businessId && g.ownerId === ownerId && id(g.policyId) && id(g.workflowRunId) &&
    hash(g.serverKeyHash) && hash(g.runtimeCapabilityHash) && object(g.researchPolicy) && publicResearchHash(g) === value.grantHash);
  const proposed = { ...g.researchPolicy, id: g.policyId, businessId, ownerId, workflowRunId: g.workflowRunId, goalId: g.policyId, operatingPolicyId: g.policyId } as PublicResearchPolicy;
  validatePublicResearchPolicy(proposed, Date.parse(proposed.validFrom));
  if (g.version === "r11.owner-continuation-grant.1") requireValue(continuation(g.continuation)?.eligible);
  // Ordinary workspace rendering does not expose credential/capability verifier
  // metadata. The separate explicit preparation view provides only new hashes.
  const safe = structuredClone(g) as JsonObject;
  delete safe.serverKeyHash; delete safe.runtimeCapabilityHash;
  return { grantId: value.grantId, grantHash: value.grantHash, grant: safe as ResearchProofGrant["grant"], used: value.used, expired: value.expired, revoked: value.revoked,
    kind: g.version === "r11.owner-continuation-grant.1" ? "continuation" : "initial" };
}
export async function readResearchQualification(context: OwnerUiContext, businessId: string): Promise<ResearchQualificationWorkspace> {
  const empty: ResearchQualificationWorkspace = { businessId, ownerId: context.userId, unavailable: false, configured: configured(),
    exposure: { currency: "USD", heldMicrounits: "0", hasUnknown: true }, policies: [], grants: [], policyTotal: 0, grantTotal: 0, continuation: null };
  try {
    const row = await workspace(context, businessId);
    requireValue(object(row.exposure) && row.exposure.currency === "USD" && money(row.exposure.heldMicrounits) && typeof row.exposure.hasUnknown === "boolean" &&
      Array.isArray(row.policies) && row.policies.length <= 25 && Array.isArray(row.grants) && row.grants.length <= 25 &&
      Number.isSafeInteger(row.policyTotal) && Number(row.policyTotal) >= row.policies.length && Number.isSafeInteger(row.grantTotal) && Number(row.grantTotal) >= row.grants.length);
    const continued = row.continuationGrants ?? [], continuedTotal = row.continuationGrantTotal ?? 0;
    requireValue(Array.isArray(continued) && continued.length <= 25 && Number.isSafeInteger(continuedTotal) && Number(continuedTotal) >= continued.length);
    const grants = [...row.grants, ...continued].map(value => grant(value, businessId, context.userId));
    requireValue(new Set(grants.map(g => g.grantId)).size === grants.length);
    grants.sort((a, b) => Date.parse(b.grant.researchPolicy.validFrom) - Date.parse(a.grant.researchPolicy.validFrom));
    const next = continuation(row.continuation);
    requireValue(!next?.eligible || !row.exposure.hasUnknown && next.exposureMicrounits === row.exposure.heldMicrounits);
    return { ...empty, exposure: { currency: "USD", heldMicrounits: row.exposure.heldMicrounits, hasUnknown: row.exposure.hasUnknown },
      policies: row.policies.map(value => policy(value, businessId, context.userId)), grants: grants.slice(0, 25), policyTotal: Number(row.policyTotal),
      grantTotal: Number(row.grantTotal) + Number(continuedTotal), continuation: next };
  } catch { return { ...empty, unavailable: true }; }
}

/** Explicit preparation reads public pricing and computes verification metadata
 * only. It does not install a grant, create intent, reserve cost or call a model. */
export async function prepareResearchBootstrap(context: OwnerUiContext, businessId: string, policyId: string, workflowRunId: string, predecessorPolicyId?: string): Promise<ResearchBootstrapPreparation> {
  requireValue(id(policyId) && id(workflowRunId) && policyId !== workflowRunId);
  requireValue(predecessorPolicyId === undefined || id(predecessorPolicyId));
  const before = await workspace(context, businessId), previous = continuation(before.continuation);
  requireValue(object(before.exposure) && before.exposure.currency === "USD" && money(before.exposure.heldMicrounits) && before.exposure.hasUnknown === false);
  if (predecessorPolicyId === undefined) requireValue(before.policyTotal === 0);
  else requireValue(previous?.eligible && previous.predecessorPolicyId === predecessorPolicyId && previous.predecessorPolicyId !== policyId && previous.predecessorWorkflowRunId !== workflowRunId);
  const continued = predecessorPolicyId === undefined ? null : previous;
  requireValue(!continued || continued.exposureMicrounits === before.exposure.heldMicrounits);
  const maximumMicrousd = continued ? Number(BigInt(continued.remainingMicrounits) > BigInt(250000) ? BigInt(250000) : BigInt(continued.remainingMicrounits)) : 250000;
  const key = serverKey(), dependencies = researchQualificationDependencies();
  const quote = await dependencies.fetchQuote({ maximumMicrousd }); validatePublicResearchQuote(quote);
  requireValue(quote.version === "r11.public-research-quote.2" && quote.maximumMicrousd === maximumMicrousd);
  const after = await workspace(context, businessId); requireValue(serverKey() === key);
  requireValue(canonicalPublicResearchJson(after.exposure) === canonicalPublicResearchJson(before.exposure));
  if (continued) requireValue(canonicalPublicResearchJson(continuation(after.continuation)) === canonicalPublicResearchJson(continued));
  else requireValue(after.policyTotal === 0);
  const preparedAt = new Date().toISOString();
  // Continuation setup time must not consume the independent five-minute
  // catalogue freshness window. V2 phase markers bind their own fresh deadline.
  const expiresAt = continued ? new Date(Date.parse(preparedAt) + 30 * 60_000).toISOString() : quote.validUntil;
  const profile = structuredClone(PUBLIC_RESEARCH_PROOF_PROFILE);
  // Only query/routing fields enter the dry wire. Goal/financial identifiers and
  // approval below are placeholders for structural checking, never a saved grant.
  const proposed: PublicResearchPolicy = {
    version: continued ? "r11.public-research.2" : "r11.public-research.1", id: policyId, businessId, ownerId: context.userId, workflowRunId, goalId: policyId, operatingPolicyId: policyId,
    query: profile.query, allowedDomains: [...profile.allowedDomains], excludedDomains: [...profile.excludedDomains], sourceReviews: profile.sourceReviews.map(review => ({ ...review })),
    queryReviewHash: publicResearchHash({ query: profile.query, classification: "generic_nonpersonal_public_research" }), termsReviewHash: profile.termsReviewHash,
    independentReviewHash: "0".repeat(64), approvalHash: "0".repeat(64), modelId: quote.modelId, providerEndpoint: quote.providerEndpoint,
    recipients: { router: "openrouter.ai", search: "exa.ai", inferenceEndpoint: quote.providerEndpoint },
    retention: { inference: "no_training_zdr", search: "query_retention_improvement_training_possible", application: "bounded_attributed_audit_evidence" },
    validFrom: preparedAt, validUntil: expiresAt, maximumMicrousd: quote.maximumMicrousd, searchMicrousd: quote.searchMicrousd, selectorMicrousd: quote.selectorMicrousd,
    priceLimit: quote.priceLimit, quoteHash: quote.quoteHash, quoteValidUntil: expiresAt,
  };
  const search = await inspectPublicResearchWire(publicResearchSearchRequest(proposed, resolveModelRoute("standard.default").primary), "search");
  return { version: continued ? "r11.owner-proof-preparation.3" : "r11.owner-proof-preparation.2", businessId, ownerId: context.userId, policyId, workflowRunId,
    mode: continued ? "continuation" : "initial", predecessorPolicyId: predecessorPolicyId ?? null, continuation: continued,
    serverKeyHash: sha(continued ? attemptAdmissionKey(key, businessId, context.userId, policyId, workflowRunId) : key), runtimeCapabilityHash: sha(runtimeCapability(key, businessId, context.userId, policyId, workflowRunId)),
    preparedAt, expiresAt, quote, sourceProfile: profile as unknown as JsonObject, search, authorityCreated: false, paidCalls: 0 };
}
export async function activateResearchGrant(context: OwnerUiContext, businessId: string, grantId: string, grantHash: string) {
  requireValue(id(grantId) && hash(grantHash));
  const row = await workspace(context, businessId), key = serverKey();
  requireValue(Array.isArray(row.grants) && (row.continuationGrants === undefined || Array.isArray(row.continuationGrants)));
  const matches = [...row.grants, ...(row.continuationGrants as unknown[] ?? [])].filter(value => object(value) && value.grantId === grantId);
  requireValue(matches.length === 1);
  const saved = matches[0];
  requireValue(object(saved) && saved.grantHash === grantHash && !saved.expired && !saved.revoked && object(saved.grant));
  const g = saved.grant;
  const continued = g.version === "r11.owner-continuation-grant.1";
  requireValue(continued || g.version === "r11.owner-proof-grant.1");
  requireValue(g.ownerId === context.userId && g.businessId === businessId && id(g.policyId) && id(g.workflowRunId));
  requireValue(g.serverKeyHash === sha(continued ? attemptAdmissionKey(key, businessId, context.userId, g.policyId, g.workflowRunId) : key) &&
    g.runtimeCapabilityHash === sha(runtimeCapability(key, businessId, context.userId, g.policyId, g.workflowRunId)) && publicResearchHash(g) === grantHash);
  const { data, error } = await context.supabase.rpc(continued ? "r11_research_continue" : "r11_research_bootstrap", { p_business_id: businessId, p_grant_id: grantId, p_grant_hash: grantHash });
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
  const scope = { businessId, coreWorkflowRunId: selected.workflowRunId, runtimeCapability: runtimeCapability(key, businessId, context.userId, policyId, selected.workflowRunId),
    ...(selected.attemptVersion === 2 ? { admissionKey: attemptAdmissionKey(key, businessId, context.userId, policyId, selected.workflowRunId) } : {}) };
  const verifyQuote = async (p: PublicResearchPolicy) => {
    requireValue(serverKey() === key);
    const quote = await dependencies.fetchQuote({ maximumMicrousd: p.maximumMicrousd }); validatePublicResearchQuote(quote);
    requireValue(quote.version === "r11.public-research-quote.2" && quote.quoteHash === p.quoteHash && quote.modelId === p.modelId && quote.providerEndpoint === p.providerEndpoint &&
      quote.searchMicrousd === p.searchMicrousd && quote.selectorMicrousd === p.selectorMicrousd && publicResearchHash(quote.priceLimit) === publicResearchHash(p.priceLimit));
    requireValue(serverKey() === key); return { providerName: quote.providerName, acceptedResponseModelIds: quote.acceptedResponseModelIds, quoteValidUntil: quote.validUntil };
  };
  await runPublicResearchQualification(scope, policyId, dependencies.makeRuntime(scope, verifyQuote));
  const latest = await readResearchQualification(context, businessId), proof = latest.policies.find(item => item.policyId === policyId);
  requireValue(!latest.unavailable && proof?.result);
  return { status: "completed", resultId: proof.result.resultId };
}
export async function stopResearchProof(context: OwnerUiContext, businessId: string, policyId: string) {
  requireValue(id(policyId)); await owner(context, businessId);
  const { data, error } = await context.supabase.rpc("r11_research_stop_v2", { p_business_id: businessId, p_policy_id: policyId });
  requireValue(!error && object(data) && data.policyId === policyId && data.revoked === true);
  return { policyId, revoked: true };
}
/** Explicit key-free projection repair derives only an already saved Stop. */
export async function reconcileResearchProof(context: OwnerUiContext, businessId: string, policyId: string) {
  requireValue(id(policyId));
  const row = await workspace(context, businessId); requireValue(Array.isArray(row.policies));
  const raw = row.policies.find(value => object(value) && value.policyId === policyId);
  requireValue(object(raw) && raw.revoked === true && raw.terminalReconciliationRequired === true);
  return stopResearchProof(context, businessId, policyId);
}

/** An explicit authenticated receipt read, independent of expired/revoked R05
 * authority. No supplied generation ID, quote, admission, write or replay. */
export async function verifySavedResearchInferenceRoute(context: OwnerUiContext, businessId: string, policyId: string, requestId: string) {
  requireValue(id(policyId) && id(requestId));
  const resolve = (row: Record<string, unknown>) => {
    requireValue(Array.isArray(row.policies));
    const matches = row.policies.filter(value => object(value) && value.policyId === policyId);
    requireValue(matches.length === 1);
    const selected = policy(matches[0], businessId, context.userId);
    requireValue(selected.policy.modelId === PUBLIC_RESEARCH_QUOTE_LIMITS.modelId && selected.policy.providerEndpoint === PUBLIC_RESEARCH_QUOTE_LIMITS.providerEndpoint);
    const phases = selected.phases.filter(phase => phase.requestId === requestId);
    requireValue(phases.length === 1);
    const phase = phases[0];
    requireValue(phase.marked && phase.settled && typeof phase.providerRequestId === "string" && /^gen-[A-Za-z0-9_-]{1,296}$/.test(phase.providerRequestId));
    return { phase: phase.phase, generationId: phase.providerRequestId, policyHash: selected.policyHash };
  };
  const saved = resolve(await workspace(context, businessId));
  const expectation: GenerationRouteExpectation = { generationId: saved.generationId, providerName: "Azure",
    acceptedResponseModelIds: [PUBLIC_RESEARCH_QUOTE_LIMITS.modelId, PUBLIC_RESEARCH_QUOTE_LIMITS.canonicalModelId], requestedEndpoint: "azure/us" };
  // An injected asynchronous reader cannot rewrite what this caller expects.
  let proof: ReturnType<typeof validateGenerationRouteProof> | undefined, readFailure: unknown;
  try { proof = validateGenerationRouteProof(await researchQualificationDependencies().fetchGenerationRoute(structuredClone(expectation)), expectation); }
  catch (error) { readFailure = error; }
  // A changed/expired login or changed receipt cannot leak a stale result.
  // Stop/expiry are deliberately not authority checks for this historical read.
  const after = resolve(await workspace(context, businessId));
  requireValue(after.phase === saved.phase && after.generationId === saved.generationId && after.policyHash === saved.policyHash);
  // Even safe HTTP/code diagnostics belong only to the still-current owner of
  // this exact saved receipt. No raw provider error or body is returned.
  if (readFailure !== undefined) throw readFailure;
  requireValue(proof);
  return { businessId, policyId, requestId, phase: saved.phase, proof };
}
