import { createHash } from "node:crypto";
import { requireTransportAdmission, type TransportAdmission } from "../core/transport-admission";
import { ETSY_SCOPES, requireEtsy, record, positiveId } from "./contracts";
import { etsyJson, formBody } from "./adapter";
import { randomSecret } from "./vault";

export type OAuthConfig = { keystring: string; sharedSecret: string; redirectUri: string };
export type EtsyTokens = { accessToken: string; refreshToken: string; userId: number; expiresAt: string; scopes: string[] };
export async function beginOAuth(config: OAuthConfig, admitDispatch?: TransportAdmission) {
  config = { ...config };
  await requireTransportAdmission(admitDispatch, { provider: "etsy", operation: "account.oauth.begin", method: "GET", endpoint: "https://www.etsy.com/oauth/connect", requestedScopes: [...ETSY_SCOPES] });
  const uri = new URL(config.redirectUri);
  requireEtsy(uri.protocol === "https:" && !uri.username && !uri.password && !uri.search && !uri.hash && uri.pathname === "/api/etsy/callback", "invalid_oauth_configuration");
  const state = randomSecret(), verifier = randomSecret(), browserNonce = randomSecret();
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const query = new URLSearchParams({ response_type: "code", client_id: config.keystring, redirect_uri: config.redirectUri, scope: ETSY_SCOPES.join(" "), state, code_challenge: challenge, code_challenge_method: "S256" });
  return { state, verifier, browserNonce, url: `https://www.etsy.com/oauth/connect?${query}` };
}
export async function exchangeOAuth(config: OAuthConfig, input: { code: string; verifier: string } | { refreshToken: string }, fetcher: typeof fetch = fetch, admitDispatch?: TransportAdmission): Promise<EtsyTokens> {
  config = { ...config }; input = { ...input };
  const fields = "code" in input ? { grant_type: "authorization_code", client_id: config.keystring, redirect_uri: config.redirectUri, code: input.code, code_verifier: input.verifier } : { grant_type: "refresh_token", client_id: config.keystring, refresh_token: input.refreshToken };
  const result = record(await etsyJson(fetcher, "https://api.etsy.com/v3/public/oauth/token", { method: "POST", headers: { "x-api-key": `${config.keystring}:${config.sharedSecret}`, Accept: "application/json" }, body: formBody(fields) }, { operation: "account.oauth", admitDispatch }));
  requireEtsy(result.token_type === "Bearer" && typeof result.access_token === "string" && /^\d+\.[^\s]{8,8192}$/.test(result.access_token) && typeof result.refresh_token === "string" && /^\d+\.[^\s]{8,8192}$/.test(result.refresh_token) && Number.isSafeInteger(result.expires_in) && Number(result.expires_in) > 0 && Number(result.expires_in) <= 3600, "invalid_oauth_response");
  const scopes = typeof result.scope === "string" ? result.scope.split(" ") : [];
  requireEtsy(ETSY_SCOPES.every(scope => scopes.includes(scope)) && scopes.every(scope => ETSY_SCOPES.includes(scope as typeof ETSY_SCOPES[number])), "oauth_scope_mismatch");
  const userId = positiveId(Number(result.access_token.split(".")[0]));
  requireEtsy(String(userId) === result.refresh_token.split(".")[0], "oauth_identity_mismatch");
  return { accessToken: result.access_token, refreshToken: result.refresh_token, userId, scopes, expiresAt: new Date(Date.now() + Number(result.expires_in) * 1000 - 30_000).toISOString() };
}
export async function discoverShop(config: OAuthConfig, tokens: EtsyTokens, fetcher: typeof fetch = fetch, admitDispatch?: TransportAdmission) {
  config = { ...config }; tokens = { ...tokens, scopes: [...tokens.scopes] };
  const value = record(await etsyJson(fetcher, `https://api.etsy.com/v3/application/users/${positiveId(tokens.userId)}/shops`, { headers: { "x-api-key": `${config.keystring}:${config.sharedSecret}`, Authorization: `Bearer ${tokens.accessToken}`, Accept: "application/json" } }, { operation: "account.read", admitDispatch }));
  positiveId(value.shop_id);
  requireEtsy(value.user_id === tokens.userId && typeof value.shop_name === "string" && value.shop_name.length <= 160 && typeof value.currency_code === "string" && ["NZD", "USD", "AUD", "GBP"].includes(value.currency_code), "shop_identity_mismatch");
  return { shopId: Number(value.shop_id), shopName: value.shop_name, currency: value.currency_code };
}
