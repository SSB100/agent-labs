import "server-only";
import { createHash, createHmac } from "node:crypto";
import type { OwnerUiContext } from "../lib/core-ui/data";
import { verifyOwnerBusiness } from "../lib/core-ui/owner-business";
import { boundedRpc, requestDeadline } from "../core/request-deadline";
import { containsCredentialLikeValue } from "../core/quest-intake";
import { discoveryV2Hash } from "./discovery-v2";
import { discoveryR12ServerDependencies } from "./discovery-r12-server-dependencies";
import { prepareDiscoveryR12Authority } from "./discovery-r12-server";
import { validateOwnerResearchProfile } from "./discovery-r12-goal-scope";
import {
  prepareOwnerResearchPreview, validateOwnerResearchPreparationInput, validateOwnerResearchQuote,
  type OwnerResearchCatalog, type OwnerResearchPreparationInput, type OwnerResearchSetupAction,
  type OwnerResearchSetupReceipt, type OwnerResearchFundingSnapshot,
} from "./discovery-r12-goal-preparation-contract";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && HASH.test(value);
const money = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9][0-9]{0,15})$/.test(value) && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER);
const fail = (): never => { throw new Error("r12_owner_research_unavailable"); };

async function owned(context: OwnerUiContext, businessId: string) {
  if (!id(businessId) || !id(context.userId) || !await verifyOwnerBusiness(context, businessId)) return fail();
  const claims = await context.supabase.auth.getClaims();
  if (claims.error || claims.data?.claims?.sub !== context.userId) return fail();
}

/** Distinct from child dispatch roles. Its verifier must already have been
 * explicitly enrolled for this exact finite Business grant. Never returned. */
function bootstrapCapability(context: OwnerUiContext, businessId: string, grantId: string) {
  const root = process.env.R05_ADMISSION_SERVER_KEY?.trim();
  if (process.env.VERCEL_ENV !== "production" || !root || root.length < 32 || root.length > 200 || !id(grantId)) return fail();
  return createHmac("sha256", root).update(JSON.stringify({ version: "r12.owner-bootstrap.1", businessId, ownerId: context.userId, grantId })).digest("base64url");
}

/** One-time enrollment preparation for a separately reviewed finite grant.
 * Returning its nonsecret verifier neither registers it nor grants access. */
export async function prepareOwnerResearchBootstrap(context: OwnerUiContext, businessId: string, grantId: string) {
  await owned(context, businessId);
  const key = bootstrapCapability(context, businessId, grantId);
  return { businessId, ownerId: context.userId, grantId, bootstrapKeyHash: createHash("sha256").update(key).digest("hex"), authorityCreated: false as const };
}

function funding(value: unknown, businessId: string): OwnerResearchFundingSnapshot {
  if (containsCredentialLikeValue(value) || !object(value) || !object(value.binding) || !id(value.binding.bindingId) || !id(value.binding.authorityRootId) ||
      !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !hash(value.hash) ||
      ![value.maximumMicrounits, value.committedMicrounits, value.pendingMicrounits].every(money) || typeof value.hasUnknown !== "boolean") return fail();
  const binding = value.binding;
  if (binding.kind === "r05_business") {
    if (binding.authorityRootId !== businessId || binding.priorRoundId !== null || binding.originalSemanticGoalHash !== null) return fail();
  } else if (binding.kind !== "legacy_research_root" || !id(binding.priorRoundId) || !hash(binding.originalSemanticGoalHash)) return fail();
  return structuredClone(value) as OwnerResearchFundingSnapshot;
}

export function parseOwnerResearchSetupReceipt(value: unknown, businessId: string, setupId?: string): OwnerResearchSetupReceipt {
  if (containsCredentialLikeValue(value) || !object(value) || value.businessId !== businessId || setupId !== undefined && value.setupId !== setupId ||
      ![value.businessId, value.goalId, value.setupId, value.scopeId, value.grantId, value.submissionId, value.policyId].every(id) || ![value.setupHash, value.policyHash].every(hash) ||
      ![value.confirmed, value.activated, value.stopped].every(item => typeof item === "boolean") || value.activated === true && value.confirmed !== true ||
      !object(value.preview) || value.preview.version !== "r12.owner-research-preview.1" || value.preview.businessId !== businessId || value.preview.goalId !== value.goalId ||
      value.preview.authorityCreated !== false || value.preview.maximumCalls !== 5 || value.preview.maximumCollections !== 1 || value.preview.maximumRepairs !== 0 ||
      value.preview.dispatchMinutes !== 30 || value.preview.receiptMinutes !== 30 || value.preview.maximumReceiptChecks !== 15 || !object(value.preview.finance)) return fail();
  const preview = value.preview;
  if (!hash(preview.goalHash) || !hash(preview.businessHash) || !hash(preview.profileHash) || !id(preview.profileId) ||
      !object(preview.selection) || typeof preview.selection.marketSetKey !== "string" || typeof preview.selection.topicKey !== "string" ||
      typeof preview.title !== "string" || preview.title.length > 200 || typeof preview.objective !== "string" || preview.objective.length > 1200 ||
      typeof preview.approvedQuery !== "string" || preview.approvedQuery.length < 20 || preview.approvedQuery.length > 800 ||
      !Array.isArray(preview.sourceDomains) || preview.sourceDomains.length < 1 || preview.sourceDomains.length > 4 || preview.sourceDomains.some(domain => typeof domain !== "string") ||
      !Array.isArray(preview.excludedDomains) || preview.excludedDomains.some(domain => typeof domain !== "string") ||
      !Array.isArray(preview.markets) || preview.markets.length < 1 || preview.markets.length > 4 || typeof preview.audience !== "string") return fail();
  funding(preview.funding, businessId);
  if (!object(preview.quote) || typeof preview.quote.verifiedAt !== "string") return fail();
  // Expiry blocks confirmation, not honest historical readback of the quote.
  validateOwnerResearchQuote(preview.quote as unknown as OwnerResearchSetupReceipt["preview"]["quote"], Date.parse(preview.quote.verifiedAt));
  const finance = preview.finance;
  if (!object(finance) || ![finance.currentBusinessLimitMicrounits, finance.proposedBusinessLimitMicrounits, finance.businessCommittedMicrounits,
      finance.minimumBusinessLimitMicrounits, finance.proposedResearchLimitMicrounits, finance.minimumResearchLimitMicrounits].every(money) ||
      typeof finance.changesBusinessLimit !== "boolean" || typeof finance.changesResearchLimit !== "boolean" ||
      !Number.isSafeInteger(finance.expectedCapRevision) || Number(finance.expectedCapRevision) < 0) return fail();
  return structuredClone(value) as OwnerResearchSetupReceipt;
}

export async function readOwnerResearchCatalog(context: OwnerUiContext, businessId: string, goalId: string | null, setupId: string | null): Promise<{ available: boolean; catalog: OwnerResearchCatalog | null }> {
  try {
    if (goalId !== null && !id(goalId) || setupId !== null && !id(setupId)) return fail();
    await owned(context, businessId);
    const { data, error } = await boundedRpc(context.supabase.rpc("r12_owner_research_read", { p_business_id: businessId, p_goal_id: goalId, p_setup_id: setupId }), requestDeadline(15_000), 10_000);
    if (error || !object(data) || !object(data.business) || data.business.id !== businessId || !Array.isArray(data.profiles) || data.profiles.length > 32 ||
        !Array.isArray(data.setups) || data.setups.length > 20 || JSON.stringify(data).length > 1_048_576) return fail();
    const business = data.business;
    if (containsCredentialLikeValue(business) || !hash(business.hash) || !Number.isSafeInteger(business.revision) || Number(business.revision) < 1 || !Number.isSafeInteger(business.capRevision) || Number(business.capRevision) < 0 ||
        ![business.maximumMicrounits, business.committedMicrounits].every(money) || typeof business.hasUnknown !== "boolean" || typeof business.paused !== "boolean") return fail();
    for (const row of data.profiles) {
      if (containsCredentialLikeValue(row) || !object(row) || !id(row.grantId) || !hash(row.profileHash) || !object(row.profile)) return fail();
      const profile = validateOwnerResearchProfile(row.profile as unknown as OwnerResearchCatalog["profiles"][number]["profile"]);
      if (row.profileHash !== discoveryV2Hash(profile)) return fail();
    }
    if (data.goal !== null && (containsCredentialLikeValue(data.goal) || !object(data.goal) || !id(data.goal.id) || data.goal.businessId !== businessId || goalId !== null && data.goal.id !== goalId ||
        !hash(data.goal.hash) || !Number.isSafeInteger(data.goal.revision) || Number(data.goal.revision) < 1 || typeof data.goal.preference !== "string" ||
        !object(data.goal.content) || typeof data.goal.initialRunExists !== "boolean")) return fail();
    if (goalId !== null && data.goal === null) return fail();
    const parsedFunding = data.funding === null ? null : funding(data.funding, businessId);
    const setups = data.setups.map(receipt => parseOwnerResearchSetupReceipt(receipt, businessId, setupId ?? undefined));
    if (setups.some(receipt => goalId !== null && receipt.goalId !== goalId)) return fail();
    return { available: true, catalog: { ...data, funding: parsedFunding, setups } as unknown as OwnerResearchCatalog };
  } catch { return { available: false, catalog: null }; }
}

function validateSetupAction(input: OwnerResearchSetupAction) {
  if (!input || Object.keys(input).sort().join(",") !== "businessId,setupHash,setupId,submissionId" ||
      ![input.businessId, input.setupId, input.submissionId].every(id) || !hash(input.setupHash)) return fail();
}
async function exactSetup(context: OwnerUiContext, input: OwnerResearchSetupAction) {
  validateSetupAction(input);
  await owned(context, input.businessId);
  const { data, error } = await boundedRpc(context.supabase.rpc("r12_owner_research_read", { p_business_id: input.businessId, p_goal_id: null, p_setup_id: input.setupId }), requestDeadline(15_000), 10_000);
  if (error || !object(data) || !Array.isArray(data.setups) || data.setups.length !== 1) return fail();
  const receipt = parseOwnerResearchSetupReceipt(data.setups[0], input.businessId, input.setupId);
  if (receipt.setupHash !== input.setupHash) return fail();
  return receipt;
}

export async function prepareOwnerResearch(context: OwnerUiContext, input: OwnerResearchPreparationInput): Promise<OwnerResearchSetupReceipt> {
  validateOwnerResearchPreparationInput(input);
  const loaded = await readOwnerResearchCatalog(context, input.businessId, input.goalId, null);
  if (!loaded.available || !loaded.catalog?.goal || !loaded.catalog.funding) return fail();
  const catalog = loaded.catalog, selected = catalog.profiles.find(row => row.profile.id === input.profileId && row.profileHash === input.profileHash && row.grantId === input.grantId);
  if (!selected) return fail();
  const serverKey = bootstrapCapability(context, input.businessId, input.grantId), quote = await discoveryR12ServerDependencies().quote({});
  if (quote.version !== "r12.discovery-quote.1") return fail();
  prepareOwnerResearchPreview(input, { business: catalog.business, goal: catalog.goal!, profile: selected.profile, funding: catalog.funding!, quote });
  const { data, error } = await boundedRpc(context.supabase.rpc("r12_owner_research_server", { p_business_id: input.businessId, p_operation: "prepare", p_payload: { input, quote }, p_server_key: serverKey }), requestDeadline(20_000), 15_000);
  if (!error && data) return parseOwnerResearchSetupReceipt(data, input.businessId);
  // A lost response is not proof that proposal persistence failed. Read back
  // its exact stable request identity without creating another setup.
  const readback = await readOwnerResearchCatalog(context, input.businessId, input.goalId, null);
  const receipt = readback.catalog?.setups.find(row => row.submissionId === input.submissionId);
  if (readback.available && receipt && receipt.preview.goalRevision === input.goalRevision && receipt.preview.profileId === input.profileId && receipt.preview.profileHash === input.profileHash && receipt.grantId === input.grantId &&
      receipt.preview.selection.marketSetKey === input.marketSetKey && receipt.preview.selection.topicKey === input.topicKey &&
      receipt.preview.finance.proposedBusinessLimitMicrounits === input.businessLifetimeLimitMicrounits && receipt.preview.finance.proposedResearchLimitMicrounits === input.researchLifetimeLimitMicrounits) return receipt;
  return fail();
}

export async function confirmOwnerResearch(context: OwnerUiContext, input: OwnerResearchSetupAction): Promise<OwnerResearchSetupReceipt> {
  const before = await exactSetup(context, input);
  if (before.activated || before.stopped) return before;
  const serverKey = bootstrapCapability(context, input.businessId, before.grantId), quote = await discoveryR12ServerDependencies().quote({});
  if (quote.version !== "r12.discovery-quote.1") return fail();
  validateOwnerResearchQuote(quote);
  validateOwnerResearchQuote(before.preview.quote);
  if (quote.maximumMicrousd > before.preview.quote.maximumMicrousd || Object.entries(quote.ceilings).some(([phase, amount]) => amount > before.preview.quote.ceilings[phase as keyof typeof quote.ceilings])) return fail();
  const keys = await prepareDiscoveryR12Authority(context, input.businessId, before.scopeId);
  const { data, error } = await boundedRpc(context.supabase.rpc("r12_owner_research_server", { p_business_id: input.businessId, p_operation: "confirm",
    p_payload: { setupId: input.setupId, setupHash: input.setupHash, submissionId: input.submissionId, controllerKeyHash: keys.controllerKeyHash, admissionKeyHash: keys.admissionKeyHash, quote }, p_server_key: serverKey }), requestDeadline(20_000), 15_000);
  if (!error && data) return parseOwnerResearchSetupReceipt(data, input.businessId, input.setupId);
  const after = await exactSetup(context, input);
  if (after.activated || after.stopped) return after;
  return fail();
}

/** Stop remains independent of credentials, catalog availability, fresh quotes
 * and active enrollment. It can only revoke the exact owned setup policy. */
export async function stopOwnerResearch(context: OwnerUiContext, input: OwnerResearchSetupAction): Promise<OwnerResearchSetupReceipt> {
  validateSetupAction(input);
  await owned(context, input.businessId);
  const { data, error } = await boundedRpc(context.supabase.rpc("r12_owner_research_server", { p_business_id: input.businessId, p_operation: "stop",
    p_payload: { setupId: input.setupId, setupHash: input.setupHash, submissionId: input.submissionId }, p_server_key: "" }), requestDeadline(20_000), 15_000);
  if (!error && data) return parseOwnerResearchSetupReceipt(data, input.businessId, input.setupId);
  const after = await exactSetup(context, input);
  if (after.stopped) return after;
  return fail();
}
