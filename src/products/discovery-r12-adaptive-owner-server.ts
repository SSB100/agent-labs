import "server-only";
import { createHmac } from "node:crypto";
import type { OwnerUiContext } from "../lib/core-ui/data";
import { verifyOwnerBusiness } from "../lib/core-ui/owner-business";
import { boundedRpc, requestDeadline } from "../core/request-deadline";
import { containsCredentialLikeValue } from "../core/quest-intake";
import { discoveryV2Hash } from "./discovery-v2";
import { prepareDiscoveryR12Authority } from "./discovery-r12-server";
import { validateOwnerEpisodeClosure } from "./discovery-r12-owner-episode";
import { selectAdaptiveOwnerResearchPublicScope, validateAdaptiveOwnerResearchProfile } from "./discovery-r12-goal-scope";
import { validateAdaptiveResearchPreview } from "./discovery-r12-adaptive-scope";
import { validateAdaptiveResearchQuote } from "./discovery-r12-adaptive-quote";
import { discoveryR12ServerDependencies } from "./discovery-r12-server-dependencies";
import { prepareAdaptiveResearchPreview, validateAdaptivePreparationInput, type AdaptiveResearchPreparationInput } from "./discovery-r12-adaptive-preparation";
import { preflightAdaptiveOwnerPlanner } from "./discovery-r12-adaptive-planner-preflight";
import { adaptiveOwnerSetupHash, type AdaptiveOwnerCatalog, type AdaptiveOwnerReceipt, type AdaptiveOwnerSetupAction } from "./discovery-r12-adaptive-owner-contract";
import { validateOwnerObservationSelection } from "./discovery-r12-owner-observation";
import { readOwnerResearchObservationSelection } from "./discovery-r12-owner-observation-server";

const id = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const money = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9][0-9]{0,15})$/.test(v) && BigInt(v) <= BigInt(Number.MAX_SAFE_INTEGER);
const integer = (v: unknown,minimum=0) => Number.isSafeInteger(v) && Number(v) >= minimum;
const fail = (): never => { throw new Error("r12_adaptive_owner_unavailable"); };
async function owned(context: OwnerUiContext, businessId: string) {
  if (!id(businessId) || !id(context.userId) || !await verifyOwnerBusiness(context,businessId)) return fail();
  const claims = await context.supabase.auth.getClaims();
  if (claims.error || claims.data?.claims?.sub !== context.userId) return fail();
}
function capability(context: OwnerUiContext,businessId: string,grantId: string) {
  const key = process.env.R05_ADMISSION_SERVER_KEY?.trim();
  if (process.env.VERCEL_ENV !== "production" || !key || key.length < 32 || key.length > 200 || !id(grantId)) return fail();
  return createHmac("sha256",key).update(JSON.stringify({version:"r12.owner-bootstrap.1",businessId,ownerId:context.userId,grantId})).digest("base64url");
}
function receipt(raw: unknown,businessId: string,setupId?: string): AdaptiveOwnerReceipt {
  if (!object(raw) || containsCredentialLikeValue(raw) || JSON.stringify(raw).length > 1_048_576 ||
      raw.version !== "r12.owner-adaptive-receipt.1" || raw.businessId !== businessId || setupId !== undefined && raw.setupId !== setupId ||
      ![raw.businessId,raw.goalId,raw.setupId,raw.scopeId,raw.profileId,raw.grantId,raw.submissionId,raw.policyId].every(id) ||
      ![raw.setupHash,raw.policyHash,raw.approvalHash].every(hash) || ![raw.confirmed,raw.activated,raw.stopped].every(v=>typeof v === "boolean") ||
      raw.activated === true && raw.confirmed !== true || !object(raw.preview) || !object(raw.quote) || !object(raw.selection) || !Array.isArray(raw.actions) || raw.actions.length > 11) return fail();
  const r = raw as unknown as AdaptiveOwnerReceipt;
  validateOwnerObservationSelection(r.ownerObservationRef);
  if (discoveryV2Hash(r.ownerObservationRef) !== discoveryV2Hash(r.preview.ownerObservationRef)) return fail();
  if (adaptiveOwnerSetupHash(r) !== r.setupHash) return fail();
  // Archived packets remain readable after expiry; confirmation checks now.
  const historicalTime = Date.parse(r.quote.verifiedAt);
  validateAdaptiveResearchQuote(r.quote,historicalTime);
  validateAdaptiveResearchPreview(r.preview,Math.min(historicalTime,Date.parse(r.preview.expiresAt)-1));
  if (r.preview.businessId !== businessId || r.preview.goalId !== r.goalId || r.preview.profileId !== r.profileId || r.preview.quoteHash !== r.quote.quoteHash ||
      (r.activated ? !id(r.planId) || !hash(r.planHash) : r.planId !== null || r.planHash !== null)) return fail();
  if (typeof r.selection.marketSetKey !== "string" || typeof r.selection.topicKey !== "string" ||
      typeof r.selection.approvedQuery !== "string" || !Array.isArray(r.selection.allowedDomains) || !Array.isArray(r.selection.excludedDomains) ||
      !Array.isArray(r.selection.markets) || typeof r.selection.audience !== "string") return fail();
  for (const [ordinal,row] of r.actions.entries()) {
    if (!object(row) || !object(row.action) || row.action.scopeId !== r.scopeId || row.action.ordinal !== ordinal ||
        !hash(row.actionHash) || discoveryV2Hash(row.action) !== row.actionHash ||
        !["admitted","running","settling","completed","failed","stopped"].includes(String(row.state)) ||
        !(row.outcome === null || ["TEST","NEEDS_MORE_EVIDENCE","REJECT"].includes(String(row.outcome))) ||
        typeof row.committedMicrounits !== "string" || !/^(0|[1-9][0-9]{0,15})$/.test(row.committedMicrounits) ||
        !Array.isArray(row.unresolvedQuestions) || row.unresolvedQuestions.some(q=>typeof q !== "string")) return fail();
  }
  return structuredClone(r);
}
export async function readAdaptiveOwnerResearch(context: OwnerUiContext,businessId: string,goalId: string,setupId: string|null=null): Promise<{available:boolean;catalog:AdaptiveOwnerCatalog|null}> {
  try {
    await owned(context,businessId);
    if (!id(goalId) || setupId !== null && !id(setupId)) return fail();
    const {data,error} = await boundedRpc(context.supabase.rpc("r12_owner_adaptive_read",{p_business_id:businessId,p_goal_id:goalId,p_setup_id:setupId}),requestDeadline(15_000),10_000);
    if (error || !object(data) || containsCredentialLikeValue(data) || JSON.stringify(data).length > 1_048_576 ||
        data.version !== "r12.owner-adaptive-catalog.1" || data.businessId !== businessId || data.goalId !== goalId ||
        typeof data.eligible !== "boolean" || !(data.reason === null || typeof data.reason === "string") ||
        !Array.isArray(data.profiles) || data.profiles.length > 32 || !Array.isArray(data.grants) || data.grants.length > 32 || !Array.isArray(data.setups) || data.setups.length > 20) return fail();
    const c = data as unknown as AdaptiveOwnerCatalog;
    if (!object(c.business) || !integer(c.business.revision,1) || !hash(c.business.hash) || !integer(c.business.capRevision,1) ||
        ![c.business.committedMicrounits,c.business.currentLimitMicrounits].every(money) || typeof c.business.hasUnknown !== "boolean" ||
        !Number.isFinite(Date.parse(c.deadline)) || !Array.isArray(c.imports) || !Array.isArray(c.actions) || c.actions.length > 11) return fail();
    if (c.funding !== null && (!object(c.funding) || !id(c.funding.authorityRootId) || !hash(c.funding.bindingHash) || !integer(c.funding.revision) ||
        ![c.funding.committedMicrounits,c.funding.pendingMicrounits,c.funding.currentLimitMicrounits].every(money) || typeof c.funding.hasUnknown !== "boolean")) return fail();
    if (c.predecessorClosure !== null) {
      const p = validateOwnerEpisodeClosure(c.predecessorClosure);
      if (discoveryV2Hash(p) !== c.predecessorClosureHash || p.businessId !== businessId || p.goalId !== goalId) return fail();
    } else if (c.eligible || c.predecessorClosureHash !== null) return fail();
    for (const row of c.profiles) {
      // Freshness prevents activation; it must not erase archived history.
      const profile = validateAdaptiveOwnerResearchProfile(row.profile,Date.parse(row.profile.validFrom));
      if (row.profileHash !== discoveryV2Hash(profile)) return fail();
    }
    for (const g of c.grants) {
      if (!object(g) || ![g.id,g.profileId].every(id) || g.businessId !== businessId || g.goalId !== goalId || !integer(g.goalRevision,1) ||
          ![g.goalHash,g.approvalHash].every(hash) || typeof g.allowsPaidFollowups !== "boolean" || !integer(g.maximumActions,1) || g.maximumActions > 10 ||
          ![g.maximumRunMicrounits,g.remainingAllocationMicrounits].every(money) || BigInt(g.maximumRunMicrounits) < BigInt(1) || BigInt(g.maximumRunMicrounits) > BigInt(10_000_000) ||
          !integer(g.remainingScopes) || !Number.isFinite(Date.parse(g.expiresAt)) || !c.profiles.some(p=>p.profile.id === g.profileId)) return fail();
    }
    c.setups = c.setups.map(r=>receipt(r,businessId,setupId ?? undefined));
    if (c.setups.some(r=>r.goalId !== goalId)) return fail();
    if (c.activation !== null) {
      const active=c.activation;
      if (!object(active) || ![active.setupId,active.scopeId].every(id) || typeof active.stopped !== "boolean" ||
          typeof active.pendingReceiptReadback !== "boolean" || !integer(active.pendingReceiptCount) || active.pendingReceiptCount > 5 ||
          !(active.pauseReason === null || active.pauseReason === "owner_source_operation_required") ||
          active.pendingReceiptReadback !== (active.pendingReceiptCount > 0) || active.pendingReceiptReadback && !active.stopped ||
          !c.setups.some(r=>r.setupId === active.setupId && r.scopeId === active.scopeId && r.activated && r.stopped === active.stopped)) return fail();
      if (active.pauseReason !== null && (active.stopped || active.pendingReceiptReadback ||
          !c.setups.some(r=>r.setupId === active.setupId && r.scopeId === active.scopeId &&
            r.preview.version === "r12.adaptive-research-preview.2" && r.actions.at(-1)?.state === "completed"))) return fail();
    }
    for (const r of c.setups) {
      const profile = c.profiles.find(p=>p.profile.id === r.profileId && p.profileHash === r.preview.profileHash);
      if (!profile) return fail();
      const choice = {marketSetKey:r.selection.marketSetKey,topicKey:r.selection.topicKey};
      const expected = {...selectAdaptiveOwnerResearchPublicScope(profile.profile,choice,Date.parse(profile.profile.validFrom)),...choice};
      if (discoveryV2Hash(r.selection) !== discoveryV2Hash(expected)) return fail();
    }
    return {available:true,catalog:c};
  } catch { return {available:false,catalog:null}; }
}
async function exactSetup(context: OwnerUiContext,input: AdaptiveOwnerSetupAction) {
  if (!input || Object.keys(input).sort().join(",") !== "businessId,setupHash,setupId,submissionId" ||
      ![input.businessId,input.setupId,input.submissionId].every(id) || !hash(input.setupHash)) return fail();
  await owned(context,input.businessId);
  // Exact setup reads do not substitute the latest episode after a lost response.
  const result = await boundedRpc(context.supabase.rpc("r12_owner_adaptive_read",{p_business_id:input.businessId,p_goal_id:null,p_setup_id:input.setupId}),requestDeadline(15_000),10_000);
  if (result.error || !object(result.data) || !Array.isArray(result.data.setups) || result.data.setups.length !== 1) return fail();
  const r = receipt(result.data.setups[0],input.businessId,input.setupId);
  if (r.setupHash !== input.setupHash) return fail();
  return r;
}
export async function prepareAdaptiveOwnerResearch(context: OwnerUiContext,input: AdaptiveResearchPreparationInput): Promise<AdaptiveOwnerReceipt> {
  let stage="input";
  try {
  validateAdaptivePreparationInput(input);
  stage="catalog";
  const loaded = await readAdaptiveOwnerResearch(context,input.businessId,input.goalId);
  const c = loaded.catalog;
  if (!loaded.available || !c?.eligible || !c.predecessorClosure || !c.funding) return fail();
  const profile = c.profiles.find(p=>p.profile.id === input.profileId && p.profileHash === input.profileHash);
  const grant = c.grants.find(g=>g.id === input.grantId && g.profileId === input.profileId);
  if (!profile || !grant) return fail();
  stage="owner_observations";
  const ownerObservationRef=await readOwnerResearchObservationSelection(context,input.businessId,input.grantId,input.ownerObservationRef);
  stage="quote";
  const quote = await discoveryR12ServerDependencies().adaptiveQuote({version:profile.profile.version==="r12.owner-research-profile.3"?"r12.adaptive-quote.2":"r12.adaptive-quote.1"});
  stage="preview";
  const prepared = prepareAdaptiveResearchPreview(input,{predecessor:c.predecessorClosure,imports:c.imports,profile:profile.profile,grant,quote,funding:c.funding,business:c.business,deadline:c.deadline,ownerObservationRef});
  const matches = (saved: AdaptiveOwnerReceipt) => saved.goalId === input.goalId && saved.grantId === input.grantId && saved.submissionId === input.submissionId &&
    saved.approvalHash === prepared.approvalHash && discoveryV2Hash(saved.preview) === discoveryV2Hash(prepared.preview) &&
    discoveryV2Hash(saved.selection) === discoveryV2Hash({...prepared.selection,marketSetKey:input.marketSetKey,topicKey:input.topicKey}) &&
    saved.quote.quoteHash === quote.quoteHash;
  stage="prepare_rpc";
  const result = await boundedRpc(context.supabase.rpc("r12_owner_adaptive_server",{p_business_id:input.businessId,p_operation:"prepare",p_payload:{input,quote},p_server_key:capability(context,input.businessId,input.grantId)}),requestDeadline(20_000),15_000);
  if (!result.error && result.data) {
    stage="receipt";
    const saved=receipt(result.data,input.businessId);
    stage="exact_packet_match";
    if (matches(saved)) return saved;
    return fail();
  }
  stage="lost_response_readback";
  const after = await readAdaptiveOwnerResearch(context,input.businessId,input.goalId);
  const saved = after.catalog?.setups.find(r=>r.submissionId === input.submissionId);
  if (saved && matches(saved)) return saved;
  return fail();
  } catch (error) {
    const code=error instanceof Error && /^r12_[a-z0-9_]+$/.test(error.message)?error.message:"validation_rejected";
    console.warn("r12_adaptive_prepare_rejected",{stage,code});
    throw error;
  }
}
export async function confirmAdaptiveOwnerResearch(context: OwnerUiContext,input: AdaptiveOwnerSetupAction): Promise<AdaptiveOwnerReceipt> {
  let stage="saved_setup";
  try {
  const before = await exactSetup(context,input);
  if (before.activated || before.stopped) return before;
  stage="preview";
  validateAdaptiveResearchPreview(before.preview);
  stage="quote";
  const quote = await discoveryR12ServerDependencies().adaptiveQuote({version:before.quote.version});
  // New catalog content needs a new reviewed packet rather than silent repricing.
  if (quote.quoteHash !== before.quote.quoteHash) return fail();
  stage="preflight_rpc";
  const checked = await boundedRpc(context.supabase.rpc("r12_owner_adaptive_preflight",{
    p_business_id:input.businessId,p_setup_id:input.setupId,p_setup_hash:input.setupHash,p_quote:quote,
  }),requestDeadline(15_000),10_000);
  if (checked.error || !object(checked.data) || checked.data.setupId !== before.setupId || checked.data.setupHash !== before.setupHash || checked.data.scopeId !== before.scopeId) return fail();
  stage="planner_preflight";
  const preflight = await preflightAdaptiveOwnerPlanner(checked.data,quote);
  stage="scoped_keys";
  const keys = await prepareDiscoveryR12Authority(context,input.businessId,before.scopeId);
  stage="confirm_rpc";
  const result = await boundedRpc(context.supabase.rpc("r12_owner_adaptive_server",{p_business_id:input.businessId,p_operation:"confirm",p_payload:{...input,quote,preflight,controllerKeyHash:keys.controllerKeyHash,admissionKeyHash:keys.admissionKeyHash},p_server_key:capability(context,input.businessId,before.grantId)}),requestDeadline(20_000),15_000);
  if (!result.error && result.data) {
    stage="receipt";
    const saved=receipt(result.data,input.businessId,input.setupId);
    if (saved.setupHash === before.setupHash && (saved.activated || saved.stopped)) return saved;
    return fail();
  }
  stage="lost_response_readback";
  const after = await exactSetup(context,input);
  if (after.activated || after.stopped) return after;
  return fail();
  } catch(error) {
    const code=error instanceof Error && /^r12_[a-z0-9_]+$/.test(error.message)?error.message:"validation_rejected";
    console.warn("r12_adaptive_confirm_rejected",{stage,code});
    throw error;
  }
}
export async function stopAdaptiveOwnerResearch(context: OwnerUiContext,input: AdaptiveOwnerSetupAction): Promise<AdaptiveOwnerReceipt> {
  const before=await exactSetup(context,input);
  const result = await boundedRpc(context.supabase.rpc("r12_owner_adaptive_server",{p_business_id:input.businessId,p_operation:"stop",p_payload:input,p_server_key:""}),requestDeadline(20_000),15_000);
  if (!result.error && result.data) {
    const saved=receipt(result.data,input.businessId,input.setupId);
    if (saved.setupHash === before.setupHash && saved.stopped) return saved;
    return fail();
  }
  const after = await exactSetup(context,input);
  if (after.stopped) return after;
  return fail();
}
