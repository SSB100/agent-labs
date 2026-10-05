import "server-only";
import type { OwnerUiContext } from "../lib/core-ui/data";
import { verifyOwnerBusiness } from "../lib/core-ui/owner-business";
import { sealAccountSecret, unsealAccountSecret } from "../accounts/vault";
import { connectionQualificationConfigured } from "./server";
import { UUID, READ_SCOPES, exactPermit, fingerprint, record, requireConnection } from "./contracts";
import { refreshReadOAuth, readExactDraftStatus, type ReadTokenIdentity } from "./etsy-refresh";
import type { ReadTokens } from "./etsy-read";

function configuration() {
  requireConnection(connectionQualificationConfigured());
  const keystring = process.env.ETSY_KEYSTRING ?? "", sharedSecret = process.env.ETSY_SHARED_SECRET ?? "";
  requireConnection(/^[^\s:]{8,200}$/.test(keystring) && /^[^\s:]{8,200}$/.test(sharedSecret));
  return { keystring, sharedSecret, server: process.env.ACCOUNTS_SERVER_KEY!, vault: process.env.ACCOUNTS_VAULT_KEY!, credentialFingerprint: fingerprint(`${keystring}\0${sharedSecret}`) };
}
async function currentOwner(context: OwnerUiContext, businessId: string) {
  requireConnection(UUID.test(businessId) && await verifyOwnerBusiness(context, businessId));
  const { data, error } = await context.supabase.auth.getClaims();
  requireConnection(!error && data?.claims?.sub === context.userId && typeof data.claims.session_id === "string" && UUID.test(data.claims.session_id));
}
async function transition(context: OwnerUiContext, businessId: string, operation: string, payload: Record<string, unknown>, serverKey: string) {
  const { data, error } = await context.supabase.rpc("r11_etsy_read_owner", { p_business_id: businessId, p_operation: operation, p_payload: payload, p_server_key: serverKey });
  requireConnection(!error, "own_shop_read_unavailable"); return record(data);
}
function storedTokens(value: unknown, expected: { businessId: string; connectionId: string; bindingRevision: string; generationId: string; format: string; identity: ReadTokenIdentity; localCutoff: string; tokenExpiresAt: string }): ReadTokens {
  const x = record(value), i = expected.identity, scopes = x.scopes;
  requireConnection(x.businessId === expected.businessId && x.connectionId === expected.connectionId && x.shopId === i.shopId && x.shopName === i.shopName && x.userId === i.userId &&
    (expected.format === "setup" ? x.revision === expected.bindingRevision && expected.generationId === expected.bindingRevision : x.bindingRevision === expected.bindingRevision && x.generationId === expected.generationId) &&
    typeof x.expiresAt === "string" && Date.parse(x.expiresAt) === Date.parse(expected.localCutoff) && Date.parse(expected.localCutoff) > Date.now() &&
    typeof x.tokenExpiresAt === "string" && Number.isFinite(Date.parse(x.tokenExpiresAt)) && Date.parse(x.tokenExpiresAt) === Date.parse(expected.tokenExpiresAt) &&
    typeof x.accessToken === "string" && /^\d+\.[^\s]{8,8192}$/.test(x.accessToken) && x.accessToken.split(".")[0] === String(i.userId) &&
    typeof x.refreshToken === "string" && /^\d+\.[^\s]{8,8192}$/.test(x.refreshToken) && x.refreshToken.split(".")[0] === String(i.userId) &&
    Array.isArray(scopes) && scopes.length === 2 && READ_SCOPES.every(s => scopes.includes(s)), "stored_read_identity_unverified");
  return { userId: i.userId, accessToken: x.accessToken, refreshToken: x.refreshToken, tokenExpiresAt: x.tokenExpiresAt, scopes: [...READ_SCOPES] };
}

/** The exact operation's durable grant and marker, not a metadata read, permit
 * token resolution/refresh. No plaintext credential leaves this function. */
export async function performEtsyDraftStatusRead(context: OwnerUiContext, businessId: string, windowId: string, operationId: string): Promise<{ status: string }> {
  requireConnection(UUID.test(windowId) && UUID.test(operationId)); await currentOwner(context, businessId);
  const config = configuration(), payload = { operationId, credentialFingerprint: config.credentialFingerprint };
  const begun = await transition(context, businessId, "begin", { windowId, ...payload }, config.server);
  if (begun.shouldDispatch !== true) {
    requireConnection(typeof begun.status === "string" && ["reserved", "refresh_marked", "rotated", "read_marked", "succeeded", "failed", "cancelled", "busy", "refresh_unverified", "exhausted"].includes(begun.status));
    return { status: begun.status };
  }
  try {
    requireConnection(begun.operationId === operationId && typeof begun.needsRefresh === "boolean" && typeof begun.connectionId === "string" && UUID.test(begun.connectionId) && typeof begun.bindingRevision === "string" && UUID.test(begun.bindingRevision) &&
      typeof begun.generationId === "string" && UUID.test(begun.generationId) && typeof begun.nextGenerationId === "string" && UUID.test(begun.nextGenerationId) && (begun.format === "setup" || begun.format === "generation") && typeof begun.envelope === "string" &&
      typeof begun.localCutoff === "string" && Number.isFinite(Date.parse(begun.localCutoff)) && Date.parse(begun.localCutoff) > Date.now() && typeof begun.tokenExpiresAt === "string" && Number.isFinite(Date.parse(begun.tokenExpiresAt)) &&
      Number.isSafeInteger(begun.userId) && Number(begun.userId) > 0 && Number.isSafeInteger(begun.shopId) && Number(begun.shopId) > 0 && typeof begun.shopName === "string" && /^[A-Za-z0-9_]{1,120}$/.test(begun.shopName));
    const identity = { userId: Number(begun.userId), shopId: Number(begun.shopId), shopName: begun.shopName }, connectionId = begun.connectionId, bindingRevision = begun.bindingRevision;
    const current = () => requireConnection(configuration().credentialFingerprint === config.credentialFingerprint, "application_credential_changed");
    const clear = unsealAccountSecret(begun.envelope, { businessId, connectionId, provider: begun.format === "setup" ? "etsy_r11_access" : "etsy_r11_token", revision: begun.generationId }, config.vault);
    let tokens = storedTokens(clear, { businessId, connectionId, bindingRevision, generationId: begun.generationId, format: begun.format, identity, localCutoff: begun.localCutoff, tokenExpiresAt: begun.tokenExpiresAt });
    const permit = async (step: 0 | 1, endpoint: string, method: "GET" | "POST") => {
      current(); return exactPermit(await transition(context, businessId, step === 0 ? "mark_refresh" : "mark_read", payload, config.server), { attemptId: operationId, step, endpoint, method });
    };
    if (begun.needsRefresh) {
      requireConnection(begun.nextGenerationId === operationId);
      tokens = await refreshReadOAuth(config, tokens, identity, permit);
      current();
      const envelope = sealAccountSecret({ ...tokens, ...identity, businessId, connectionId, bindingRevision, generationId: begun.nextGenerationId, expiresAt: begun.localCutoff },
        { businessId, connectionId, provider: "etsy_r11_token", revision: begun.nextGenerationId }, config.vault);
      const saved = await transition(context, businessId, "rotate", { ...payload, envelope, tokenExpiresAt: tokens.tokenExpiresAt, userId: tokens.userId, scopes: tokens.scopes }, config.server);
      requireConnection(saved.saved === true && saved.generationId === begun.nextGenerationId, "rotated_custody_unverified");
    } else requireConnection(begun.nextGenerationId === begun.generationId);
    const proof = await readExactDraftStatus(config, tokens, identity, permit);
    current(); const completed = await transition(context, businessId, "complete", { ...payload, proof }, config.server);
    requireConnection(completed.verified === true && completed.generationId === begun.nextGenerationId, "read_completion_unverified");
    return { status: "succeeded" };
  } catch {
    try { await transition(context, businessId, "fail", { operationId }, config.server); } catch { /* Durable markers/candidate remain; never retry or restore a predecessor. */ }
    throw new Error("own_shop_read_unverified");
  }
}
export async function revokeEtsyReadWindow(context: OwnerUiContext, businessId: string, windowId: string) {
  requireConnection(UUID.test(windowId)); await currentOwner(context, businessId);
  return transition(context, businessId, "revoke_window", { windowId }, "");
}
