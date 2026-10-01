import "server-only";
import { randomUUID } from "node:crypto";
import type { OwnerUiContext } from "../lib/core-ui/data";
import { etsyConfig, resolveEtsyConnection } from "../etsy/server";
import { discoverShop } from "../etsy/oauth";
import { PrintfulCatalogAdapter } from "../printful/adapter";
import { verifyPrintfulConnection, printfulAccountReadAuthorization, type StoredPrintfulAccount } from "./printful";
import { sealAccountSecret, unsealAccountSecret } from "./vault";
import { prepareAccountRegistration } from "./registration";
import { createAccountBrowserbaseTransport, getAccountBrowserbaseStatus, releaseAccountBrowserbaseSession, type AccountBrowserbaseHandoff } from "./browserbase";
import { ACCOUNT_UUID, AccountError, accountAssert, accountRecord, accountProvider, accountMode,
  parseAccountProfile, buildAccountDisclosure, type AccountProfile, type AccountSetupRun, type AccountWorkspace } from "./contracts";

export function accountsConfigured() { return (process.env.ACCOUNTS_SERVER_KEY?.length ?? 0) >= 32; }
export function accountVaultConfigured() { return accountsConfigured() && /^[a-f0-9]{64}$/.test(process.env.ACCOUNTS_VAULT_KEY ?? ""); }
export function accountOwner(context: OwnerUiContext, businessId: string) {
  accountAssert(ACCOUNT_UUID.test(businessId) && context.businesses.some(b => b.id === businessId), "account_owner_required");
}
export async function accountRpc(context: OwnerUiContext, businessId: string, operation: string, payload: Record<string, unknown> = {}) {
  accountOwner(context, businessId);
  if (operation !== "workspace") accountAssert(accountsConfigured(), "account_setup_unavailable");
  const result = await context.supabase.rpc("account_owner_transition", { p_business_id: businessId, p_operation: operation,
    p_payload: payload, p_server_key: operation === "workspace" ? "" : process.env.ACCOUNTS_SERVER_KEY! });
  // Do not surface RPC bodies, credential envelopes, tokens, query arguments or
  // provider errors in UI, workflow metadata, telemetry or redirected URLs.
  if (result.error) throw new AccountError("account_state_unavailable");
  return accountRecord(result.data);
}
function profileRecord(value: unknown): AccountProfile {
  const row = accountRecord(value); accountAssert(typeof row.revision === "string" && ACCOUNT_UUID.test(row.revision), "account_profile_invalid");
  const { revision, ...data } = row; return { ...parseAccountProfile(data), revision };
}
function setupRun(value: unknown, businessId: string): AccountSetupRun {
  const row = accountRecord(value);
  accountAssert(row.businessId === businessId && typeof row.id === "string" && ACCOUNT_UUID.test(row.id) &&
    typeof row.connectionId === "string" && ACCOUNT_UUID.test(row.connectionId) && Number.isSafeInteger(row.revision) && Number(row.revision) >= 0 &&
    typeof row.disclosureHash === "string" && /^[a-f0-9]{64}$/.test(row.disclosureHash), "account_scope_mismatch");
  accountProvider(row.provider); accountMode(row.mode);
  return row as unknown as AccountSetupRun;
}
export async function loadAccountWorkspace(context: OwnerUiContext, businessId: string): Promise<AccountWorkspace> {
  accountOwner(context, businessId);
  const browser = getAccountBrowserbaseStatus();
  const empty: AccountWorkspace = { businessId, configured: accountsConfigured(), vaultConfigured: accountVaultConfigured(), unavailable: false, observedAt: new Date().toISOString(),
    registrationAvailable: accountVaultConfigured() && browser.available, registrationReason: browser.reasonCode,
    profile: null, accounts: [], runs: [], healthEvents: [] };
  try {
    const result = await accountRpc(context, businessId, "workspace");
    accountAssert(Array.isArray(result.accounts) && Array.isArray(result.runs) && Array.isArray(result.healthEvents), "account_workspace_invalid");
    return { ...empty, profile: result.profile ? profileRecord(result.profile) : null,
      accounts: result.accounts as AccountWorkspace["accounts"], runs: result.runs.map(r => setupRun(r, businessId)),
      healthEvents: result.healthEvents as AccountWorkspace["healthEvents"] };
  } catch { return { ...empty, unavailable: true }; }
}
export async function saveAccountProfile(context: OwnerUiContext, businessId: string, profile: unknown, expectedRevision: string | null) {
  accountAssert(expectedRevision === null || ACCOUNT_UUID.test(expectedRevision), "account_profile_invalid");
  const prior = await loadAccountWorkspace(context, businessId);
  accountAssert(!prior.unavailable, "account_state_unavailable");
  const result = await accountRpc(context, businessId, "save_profile", { profile: parseAccountProfile(profile), expectedRevision });
  return { ...result, browserReleaseVerified: await releaseRegistrationRuns(context, businessId, prior.runs) };
}
export async function prepareAccountSetup(context: OwnerUiContext, businessId: string, providerValue: unknown, modeValue: unknown, idempotencyKey: string) {
  const provider = accountProvider(providerValue), mode = accountMode(modeValue);
  accountAssert(ACCOUNT_UUID.test(idempotencyKey), "account_request_invalid");
  const workspace = await loadAccountWorkspace(context, businessId);
  accountAssert(!workspace.unavailable && workspace.profile, "account_profile_required");
  const disclosure = buildAccountDisclosure(workspace.profile, provider, mode);
  const result = await accountRpc(context, businessId, "prepare", { provider, mode, idempotencyKey,
    profileRevision: workspace.profile.revision, disclosure, approvalTtlSeconds: 1800 });
  return setupRun(result.run, businessId);
}
export async function resumeAccountSetup(context: OwnerUiContext, businessId: string, runId: string) {
  accountAssert(ACCOUNT_UUID.test(runId), "account_request_invalid");
  return setupRun((await accountRpc(context, businessId, "resume", { runId })).run, businessId);
}
export async function approveAccountSetup(context: OwnerUiContext, businessId: string, input: { runId: string; revision: number; disclosureHash: string; acceptTerms: boolean; browserConsent: boolean }) {
  accountAssert(ACCOUNT_UUID.test(input.runId) && Number.isSafeInteger(input.revision) && input.revision >= 0 && /^[a-f0-9]{64}$/.test(input.disclosureHash), "account_review_required");
  return setupRun((await accountRpc(context, businessId, "approve", input)).run, businessId);
}
export async function handoffAccountConnection(context: OwnerUiContext, businessId: string, runId: string) {
  const run = await resumeAccountSetup(context, businessId, runId);
  if (run.status === "owner_handoff") return run;
  accountAssert(run.mode === "connect" && run.status === "approved", "account_approval_required");
  return setupRun((await accountRpc(context, businessId, "owner_handoff", { runId, revision: run.revision,
    receipt: { outcome: "needs_owner", performedFields: [], reasonCode: "owner_access_grant", termsState: "not_accepted" } })).run, businessId);
}
function browserSecretContext(businessId: string, runId: string, preparationId: string) {
  return { businessId, provider: "browserbase_handoff", connectionId: runId, revision: preparationId };
}
export async function prepareApprovedAccountRegistration(context: OwnerUiContext, businessId: string, runId: string) {
  const approved = await resumeAccountSetup(context, businessId, runId);
  accountAssert(approved.mode === "create" && approved.status === "approved", "account_approval_required");
  // No paid/session request or profile transmission before explicit activation.
  if (!accountVaultConfigured() || !getAccountBrowserbaseStatus().available) return approved;
  const reserved = await accountRpc(context, businessId, "registration_prepare", { runId, revision: approved.revision });
  const run = setupRun(reserved.run, businessId);
  if (reserved.dispatchAllowed !== true) return run;
  const preparationId = String(reserved.preparationId);
  accountAssert(ACCOUNT_UUID.test(preparationId) && !!run.approvalExpiresAt, "account_preparation_invalid");
  const transport = createAccountBrowserbaseTransport({ businessId, provider: run.provider, approvalExpiresAt: run.approvalExpiresAt,
    saveHandoff: async handoff => {
      const envelope = sealAccountSecret({ ...handoff, businessId, runId, preparationId },
        browserSecretContext(businessId, runId, preparationId), process.env.ACCOUNTS_VAULT_KEY!);
      await accountRpc(context, businessId, "browser_handoff_save", { runId, revision: run.revision, preparationId,
        handoffId: handoff.handoffId, envelope, expiresAt: handoff.expiresAt });
    } });
  const receipt = await prepareAccountRegistration({ businessId, preparationId, disclosure: run.disclosure,
    disclosureHash: run.disclosureHash, profileRevision: run.disclosure.profileRevision, approvalExpiresAt: run.approvalExpiresAt,
    termsApproved: true, browserConsent: true }, { transport: transport ?? undefined, assertCurrent: async () => {
      const current = await resumeAccountSetup(context, businessId, runId);
      accountAssert(current.status === "preparation_started" && current.revision === run.revision && current.preparationId === preparationId &&
        current.disclosureHash === run.disclosureHash && current.disclosure.profileRevision === run.disclosure.profileRevision,
      "account_registration_authority_changed");
    } });
  const reasonCode = receipt.secureResumeAvailable ? "secure_owner_steps" : receipt.reasonCode === "account_captcha_approval_required" ? "captcha_approval_required" :
    receipt.reasonCode === "account_secure_owner_browser_required" ? "provider_unavailable" : "registration_uncertain";
  try {
    return setupRun((await accountRpc(context, businessId, "owner_handoff", { runId, revision: run.revision,
      receipt: { outcome: receipt.outcome, performedFields: receipt.performedFields, reasonCode, termsState: receipt.termsState } })).run, businessId);
  } catch {
    // A concurrent owner stop/profile edit wins; never leave a hidden live browser
    // running just because final state persistence failed.
    await releaseAccountRegistration(context, businessId, runId).catch(() => undefined);
    throw new AccountError("account_handoff_unavailable");
  }
}
type StoredBrowserHandoff = AccountBrowserbaseHandoff & { businessId: string; runId: string; preparationId: string };
function openBrowserHandoff(value: Record<string, unknown>, businessId: string, runId: string, preparationId: string) {
  accountAssert(accountVaultConfigured() && typeof value.envelope === "string", "account_handoff_unavailable");
  const handoff = unsealAccountSecret<StoredBrowserHandoff>(value.envelope, browserSecretContext(businessId, runId, preparationId), process.env.ACCOUNTS_VAULT_KEY!);
  accountAssert(handoff.businessId === businessId && handoff.runId === runId && handoff.preparationId === preparationId &&
    handoff.handoffId === value.handoffId && ACCOUNT_UUID.test(handoff.sessionId) && typeof handoff.viewerUrl === "string", "account_handoff_invalid");
  const url = new URL(handoff.viewerUrl);
  accountAssert(url.protocol === "https:" && ["www.browserbase.com", "browserbase.com", "debug.browserbase.com"].includes(url.hostname) &&
    !url.username && !url.password && !url.port, "account_handoff_invalid");
  return handoff;
}
/** Owner-only UI boundary. Never import into workers, planner or workflow state. */
export async function loadOwnerRegistrationHandoff(context: OwnerUiContext, businessId: string, runId: string) {
  const run = await resumeAccountSetup(context, businessId, runId);
  accountAssert(run.status === "owner_handoff" && run.mode === "create" && typeof run.preparationId === "string", "account_handoff_unavailable");
  const stored = await accountRpc(context, businessId, "browser_handoff_get", { runId, preparationId: run.preparationId });
  const handoff = openBrowserHandoff(stored, businessId, runId, run.preparationId);
  accountAssert(Date.parse(handoff.expiresAt) > Date.now() && !!run.approvalExpiresAt && Date.parse(handoff.expiresAt) <= Date.parse(run.approvalExpiresAt), "account_handoff_expired");
  return { provider: run.provider, viewerUrl: handoff.viewerUrl, expiresAt: handoff.expiresAt };
}
export async function releaseAccountRegistration(context: OwnerUiContext, businessId: string, runId: string) {
  const run = await resumeAccountSetup(context, businessId, runId);
  if (!run.preparationId) return { remoteReleaseVerified: true };
  const stored = await accountRpc(context, businessId, "browser_handoff_release", { runId, preparationId: run.preparationId });
  if (!stored.envelope) return { remoteReleaseVerified: true };
  const handoff = openBrowserHandoff(stored, businessId, runId, run.preparationId);
  try { await releaseAccountBrowserbaseSession(handoff.sessionId); return { remoteReleaseVerified: true }; }
  catch { return { remoteReleaseVerified: false }; }
}
async function releaseRegistrationRuns(context: OwnerUiContext, businessId: string, runs: AccountSetupRun[]) {
  let verified = true;
  for (const run of runs.filter(r => r.mode === "create" && r.preparationId && ["preparation_started", "owner_handoff"].includes(r.status))) {
    try { if (!(await releaseAccountRegistration(context, businessId, run.id)).remoteReleaseVerified) verified = false; }
    catch { verified = false; }
  }
  return verified;
}
export async function loadAccountSetupInterventions(context: OwnerUiContext) {
  const workspaces = await Promise.all(context.businesses.map(b => loadAccountWorkspace(context, b.id)));
  return { unavailable: workspaces.some(w => w.unavailable), records: workspaces.flatMap(w => w.runs
    .filter(r => ["pending_approval", "approved", "preparation_started", "owner_handoff"].includes(r.status))
    .map(r => ({ businessId: w.businessId, runId: r.id, provider: r.provider, status: r.status }))) };
}
export async function stopAccountSetup(context: OwnerUiContext, businessId: string, runId: string, revision: number) {
  await accountRpc(context, businessId, "cancel", { runId, revision });
  return releaseAccountRegistration(context, businessId, runId);
}
export async function connectPrintfulAccount(context: OwnerUiContext, businessId: string, input: {
  runId: string; credential: string; storeId: number; storeKind: "manual_api" | "ecommerce_linked"; expiresAt: string;
}) {
  accountAssert(accountVaultConfigured(), "account_secure_setup_unavailable");
  let run = await resumeAccountSetup(context, businessId, input.runId);
  accountAssert(run.provider === "printful" && (run.status === "owner_handoff" || (run.mode === "connect" && run.status === "approved")), "account_approval_required");
  if (run.status === "approved") run = await handoffAccountConnection(context, businessId, run.id);
  // This credential originates only in the owner-facing secure form. It is never
  // accepted from workflow/model arguments or sent through the browser planner.
  const revision = randomUUID();
  const verified = await verifyPrintfulConnection({ businessId, connectionId: run.connectionId, revision,
    storeId: input.storeId, storeKind: input.storeKind, credential: input.credential, expiresAt: input.expiresAt });
  const envelope = sealAccountSecret(verified.secret, { businessId, provider: "printful", connectionId: run.connectionId, revision }, process.env.ACCOUNTS_VAULT_KEY!);
  const result = setupRun((await accountRpc(context, businessId, "verify", { runId: run.id, revision: run.revision, evidence: {
    verifiedBy: "provider_api_readback", verifiedAt: verified.binding.verifiedAt, connectionId: run.connectionId,
    connectionRevision: revision, storeId: verified.binding.storeId, storeKind: verified.binding.storeKind,
    scopes: ["catalog.read"], providerScopes: verified.binding.providerScopes, expiresAt: verified.binding.expiresAt, credentialEnvelope: envelope, providerAccountId: String(verified.binding.storeId),
  } })).run, businessId);
  return { ...result, browserReleaseVerified: await releaseRegistrationRuns(context, businessId, [run]) };
}
export async function verifyEtsyAccount(context: OwnerUiContext, businessId: string, runId: string) {
  let run = await resumeAccountSetup(context, businessId, runId);
  accountAssert(run.provider === "etsy" && (run.status === "owner_handoff" || (run.mode === "connect" && run.status === "approved")), "account_approval_required");
  if (run.status === "approved") run = await handoffAccountConnection(context, businessId, run.id);
  // The existing Etsy RPC is the sole authority for its encrypted connection;
  // the registry only points at that exact record. It never copies its tokens.
  const existing = await resolveEtsyConnection(context, businessId);
  // A saved row is not current readback. Verify the authenticated provider shop
  // again, without exposing tokens or performing any listing mutation.
  const shop = await discoverShop(etsyConfig(), { accessToken: existing.accessToken, userId: existing.userId,
    refreshToken: "unused", expiresAt: existing.expiresAt, scopes: ["shops_r", "listings_r", "listings_w"] });
  accountAssert(shop.shopId === existing.shopId && shop.currency === existing.currency, "account_provider_identity_changed");
  const result = setupRun((await accountRpc(context, businessId, "verify", { runId: run.id, revision: run.revision,
    evidence: { verifiedBy: "provider_api_readback", verifiedAt: new Date().toISOString(), connectionId: run.connectionId,
      etsyConnectionId: existing.connectionId, connectionRevision: existing.revision } })).run, businessId);
  return { ...result, browserReleaseVerified: await releaseRegistrationRuns(context, businessId, [run]) };
}
export async function revokeAccount(context: OwnerUiContext, businessId: string, providerValue: unknown, expectedConnectionRevision: string) {
  const provider = accountProvider(providerValue);
  accountAssert(ACCOUNT_UUID.test(expectedConnectionRevision), "account_revision_required");
  const prior = await loadAccountWorkspace(context, businessId);
  accountAssert(!prior.unavailable, "account_state_unavailable");
  const result = await accountRpc(context, businessId, "revoke", { provider, expectedConnectionRevision,
    ...(provider === "etsy" ? { etsyServerKey: etsyConfig().serverKey } : {}) });
  return { ...result, browserReleaseVerified: await releaseRegistrationRuns(context, businessId, prior.runs.filter(r => r.provider === provider)) };
}
/** Owner-entered website password storage is separate from provider tokens.
 * There is deliberately no model/worker plaintext read or password-capture API. */
export async function saveOwnerAccountPassword(context: OwnerUiContext, businessId: string, input: {
  provider: unknown; connectionId: string; expectedConnectionRevision: string; expectedPasswordRevision: string | null;
  username: string; password: string; confirmPassword: string;
}) {
  accountOwner(context, businessId); accountAssert(accountVaultConfigured(), "account_secure_setup_unavailable");
  const provider = accountProvider(input.provider);
  accountAssert(ACCOUNT_UUID.test(input.connectionId) && ACCOUNT_UUID.test(input.expectedConnectionRevision) &&
    (input.expectedPasswordRevision === null || ACCOUNT_UUID.test(input.expectedPasswordRevision)), "account_revision_required");
  accountAssert(typeof input.username === "string" && input.username.trim().length >= 1 && input.username.length <= 254 &&
    !/[\u0000-\u001f\u007f]/.test(input.username) && typeof input.password === "string" && input.password.length >= 12 && input.password.length <= 1024 &&
    !/[\u0000-\u001f\u007f]/.test(input.password) && input.password === input.confirmPassword, "account_password_invalid");
  const current = await loadAccountWorkspace(context, businessId);
  const connection = current.accounts.find(a => a.provider === provider && a.id === input.connectionId);
  accountAssert(!current.unavailable && connection?.status === "connected" && connection.revision === input.expectedConnectionRevision &&
    (connection.passwordRevision ?? null) === input.expectedPasswordRevision, "account_revision_changed");
  const passwordRevision = randomUUID();
  const envelope = sealAccountSecret({ version: "account-password-v1", businessId, provider, connectionId: connection.id,
    passwordRevision, username: input.username.trim(), password: input.password, ownerEnteredAt: new Date().toISOString(), providerVerified: false },
  { businessId, provider: `${provider}_password`, connectionId: connection.id, revision: passwordRevision }, process.env.ACCOUNTS_VAULT_KEY!);
  return accountRpc(context, businessId, "save_password", { provider, connectionId: connection.id,
    expectedConnectionRevision: connection.revision, expectedPasswordRevision: input.expectedPasswordRevision, passwordRevision, envelope });
}
export async function deleteOwnerAccountPassword(context: OwnerUiContext, businessId: string, input: {
  provider: unknown; connectionId: string; expectedPasswordRevision: string;
}) {
  accountOwner(context, businessId);
  const provider = accountProvider(input.provider);
  accountAssert(ACCOUNT_UUID.test(input.connectionId) && ACCOUNT_UUID.test(input.expectedPasswordRevision), "account_revision_required");
  return accountRpc(context, businessId, "delete_password", { provider, connectionId: input.connectionId, expectedPasswordRevision: input.expectedPasswordRevision });
}
export function connectedPrintfulCatalog(context: OwnerUiContext, businessId: string) {
  accountOwner(context, businessId); accountAssert(accountVaultConfigured(), "account_secure_setup_unavailable");
  const authorize = printfulAccountReadAuthorization({ requireBusinessOwner: async id => { accountOwner(context, id); },
    vaultKey: process.env.ACCOUNTS_VAULT_KEY!, loadConnection: async id => {
      const row = await accountRpc(context, id, "connection", { provider: "printful" });
      return { businessId: id, connectionResourceId: String(row.id), revision: String(row.revision), storeId: Number(row.storeId),
        storeKind: row.storeKind, status: "connected", expiresAt: String(row.expiresAt), envelope: String(row.credentialEnvelope),
        providerScopes: row.providerScopes ?? [], verifiedAt: row.verifiedAt } as StoredPrintfulAccount;
    } });
  return new PrintfulCatalogAdapter({ authorize, mode: "provider_response", freshnessMs: 300_000 });
}
