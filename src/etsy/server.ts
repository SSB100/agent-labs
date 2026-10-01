import "server-only";
import { randomUUID } from "node:crypto";
import type { OwnerUiContext } from "../lib/core-ui/data";
import type { ActionReceipt, ExternalResource } from "../core/contracts";
import { EtsyDraftAdapter } from "./adapter";
import { EtsyError, requireEtsy, record, UUID, validatePackage, hash, draftIdentity, type EtsyProductPackage, type EtsyConnection } from "./contracts";
import { exchangeOAuth, type EtsyTokens, type OAuthConfig } from "./oauth";
import { seal, unseal, randomSecret } from "./vault";
import { executeEtsyDraft, type DraftRepository, type DraftState } from "./engine";

export function etsyConfigured() {
  return !!(process.env.ETSY_KEYSTRING && process.env.ETSY_SHARED_SECRET && process.env.ETSY_REDIRECT_URI &&
    /^[a-f0-9]{64}$/.test(process.env.ETSY_VAULT_KEY ?? "") && (process.env.ETSY_SERVER_KEY?.length ?? 0) >= 32);
}
export function etsyConfig(): OAuthConfig & { vaultKey: string; serverKey: string } {
  requireEtsy(etsyConfigured(), "etsy_connection_setup_unavailable");
  return { keystring: process.env.ETSY_KEYSTRING!, sharedSecret: process.env.ETSY_SHARED_SECRET!, redirectUri: process.env.ETSY_REDIRECT_URI!,
    vaultKey: process.env.ETSY_VAULT_KEY!, serverKey: process.env.ETSY_SERVER_KEY! };
}
export function ownerBusiness(context: OwnerUiContext, businessId: string) {
  requireEtsy(UUID.test(businessId) && context.businesses.some(b => b.id === businessId), "owner_required");
}
export async function etsyRpc(context: OwnerUiContext, businessId: string, operation: string, payload: Record<string, unknown> = {}) {
  ownerBusiness(context, businessId);
  const result = await context.supabase.rpc("etsy_owner_transition", { p_business_id: businessId, p_operation: operation, p_payload: payload,
    p_server_key: operation === "workspace" ? "" : etsyConfig().serverKey });
  // Never propagate database/provider bodies, OAuth codes or key-bearing arguments.
  if (result.error) throw new EtsyError(operation === "validate_package" || operation === "guard" ? "upstream_qualification_required" : "etsy_state_unavailable");
  return record(result.data);
}
type StoredAccount = EtsyTokens & { businessId: string; connectionId: string; revision: string; shopId: number; currency: string };
export async function resolveEtsyConnection(context: OwnerUiContext, businessId: string): Promise<EtsyConnection> {
  const row = await etsyRpc(context, businessId, "connection"), config = etsyConfig();
  requireEtsy(typeof row.id === "string" && UUID.test(row.id) && typeof row.envelope === "string", "account_connection_required");
  let account = unseal<StoredAccount>(row.envelope, `account:${businessId}:${row.id}`, config.vaultKey);
  requireEtsy(account.businessId === businessId && account.connectionId === row.id && account.shopId === row.shopId && account.revision === row.revision && account.currency === row.currency, "account_scope_mismatch");
  if (Date.parse(account.expiresAt) <= Date.now()) {
    await etsyRpc(context, businessId, "refresh_begin", { revision: account.revision });
    const tokens = await exchangeOAuth(config, { refreshToken: account.refreshToken });
    requireEtsy(tokens.userId === account.userId, "oauth_identity_mismatch");
    account = { ...account, ...tokens };
    await etsyRpc(context, businessId, "refresh", { revision: account.revision, envelope: seal(account, `account:${businessId}:${row.id}`, config.vaultKey) });
  }
  return { businessId, connectionId: account.connectionId, shopId: account.shopId, revision: account.revision, userId: account.userId,
    currency: account.currency, status: "connected", expiresAt: account.expiresAt, accessToken: account.accessToken };
}
export function etsyProvider(context: OwnerUiContext, businessId: string) {
  const config = etsyConfig();
  return new EtsyDraftAdapter({ authorize: () => resolveEtsyConnection(context, businessId), apiKey: `${config.keystring}:${config.sharedSecret}` });
}
/** Upstream must emit an authenticated immutable handoff after real product
 * configuration. Generic artifact JSON, owner flags and Stage15 fixtures cannot
 * mint this envelope. Stage16 deliberately does not manufacture that prerequisite. */
export async function loadEtsyPackage(context: OwnerUiContext, businessId: string, artifactId: string) {
  ownerBusiness(context, businessId); requireEtsy(UUID.test(artifactId), "approved_package_required");
  const result = await context.supabase.from("artifacts").select("id,business_id,content").eq("business_id", businessId).eq("id", artifactId).eq("artifact_type", "product.package.v1").maybeSingle();
  requireEtsy(!result.error && result.data && typeof result.data.content?.etsyDraftEnvelope === "string", "approved_package_required");
  const envelope = result.data.content.etsyDraftEnvelope as string;
  const p = unseal<EtsyProductPackage>(envelope, `product-package:${businessId}:${artifactId}`, etsyConfig().vaultKey);
  validatePackage(p, businessId); requireEtsy(p.id === artifactId, "package_identity_mismatch");
  await etsyRpc(context, businessId, "validate_package", { package: p });
  return { package: p, envelope };
}
export async function eligibleEtsyPackages(context: OwnerUiContext, businessId: string) {
  if (!etsyConfigured()) return [];
  const result = await context.supabase.from("artifacts").select("id").eq("business_id", businessId).eq("artifact_type", "product.package.v1").order("created_at", { ascending: false }).limit(20);
  if (result.error) throw new EtsyError("package_list_unavailable");
  const choices: EtsyProductPackage[] = [];
  for (const artifact of result.data ?? []) {
    try { choices.push((await loadEtsyPackage(context, businessId, artifact.id)).package); }
    catch (error) { if (!(error instanceof EtsyError)) throw error; }
  }
  return choices;
}
export async function prepareEtsyDraft(context: OwnerUiContext, businessId: string, artifactId: string) {
  const loaded = await loadEtsyPackage(context, businessId, artifactId), connection = await resolveEtsyConnection(context, businessId);
  const p = loaded.package;
  return etsyRpc(context, businessId, "prepare", { package: p, packageEnvelope: loaded.envelope, packageHash: hash(p),
    identity: draftIdentity(connection, p), connectionRevision: connection.revision, approveDraft: true, approveAssetSharing: true });
}
export function draftRepository(context: OwnerUiContext, businessId: string, runId: string): DraftRepository {
  requireEtsy(UUID.test(runId), "draft_not_found");
  const lease = randomSecret(); let revision = 0;
  const rpc = (operation: string, payload: Record<string, unknown> = {}) => etsyRpc(context, businessId, operation, { ...payload, runId, lease });
  return {
    async acquire() { const r = await rpc("acquire"); revision = Number(r.revision); return r.state as DraftState; },
    async save(state) { const r = await rpc("save", { state, revision }); revision = Number(r.revision); },
    async guard() {
      const r = await rpc("guard");
      const p = r.package as EtsyProductPackage;
      // Re-read the immutable upstream handoff so deleted/replaced artifacts fail.
      const latest = await loadEtsyPackage(context, businessId, p.id);
      requireEtsy(hash(latest.package) === hash(p), "stale_package_or_approval");
      return { package: p, connection: await resolveEtsyConnection(context, businessId) };
    },
    async image(image) {
      const result = await context.supabase.storage.from("creative-assets").download(image.storagePath);
      requireEtsy(!result.error && result.data && result.data.size <= 7_000_000, "asset_download_failed");
      return new Uint8Array(await result.data.arrayBuffer());
    },
    async finish(state: DraftState, receipt: ActionReceipt, resource: ExternalResource) {
      const r = await rpc("finish", { state, receipt, resource, revision }); revision = Number(r.revision);
    },
    async release() { await rpc("release"); },
  };
}
export async function runEtsyDraft(context: OwnerUiContext, businessId: string, runId: string) {
  return executeEtsyDraft(draftRepository(context, businessId, runId), etsyProvider(context, businessId));
}
export function newConnectionId() { return randomUUID(); }
