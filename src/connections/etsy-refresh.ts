import { etsyJson, formBody } from "../etsy/adapter";
import { READ_SCOPES, fingerprint, record, requireConnection, type QualificationPermit } from "./contracts";
import type { ReadApiConfig, ReadTokens } from "./etsy-read";

export type ReadTokenIdentity = { userId: number; shopId: number; shopName: string };
export type DraftReadProof = ReadTokenIdentity & { listingCount: number; totalDrafts: number; factsHash: string; verifiedAt: string };
export type RefreshReadPermit = (step: 0 | 1, endpoint: string, method: "GET" | "POST") => Promise<QualificationPermit>;

function exactIdentity(value: ReadTokenIdentity) {
  requireConnection(Number.isSafeInteger(value.userId) && value.userId > 0 && Number.isSafeInteger(value.shopId) && value.shopId > 0 && /^[A-Za-z0-9_]{1,120}$/.test(value.shopName), "read_identity_unverified");
}
async function call(config: ReadApiConfig, step: 0 | 1, endpoint: string, method: "GET" | "POST", permit: RefreshReadPermit, fetcher: typeof fetch, token?: string, body?: URLSearchParams) {
  const p = await permit(step, endpoint, method), deadline = Date.parse(p.expiresAt);
  requireConnection(p.step === step && p.endpoint === endpoint && p.method === method && deadline > Date.now(), "connection_dispatch_expired");
  return etsyJson(fetcher, endpoint, { method, headers: { "x-api-key": `${config.keystring}:${config.sharedSecret}`, Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body },
    { operation: step === 0 ? "r11.own-shop.refresh" : "r11.own-shop.read", admitDispatch: async d => {
      requireConnection(d.endpoint === endpoint && d.method === method && deadline > Date.now(), "connection_dispatch_expired");
    } });
}

/** One admitted POST, never a retry or a scope upgrade. A failed/unknown response
 * must fence this predecessor generation in the durable caller. */
export async function refreshReadOAuth(config: ReadApiConfig, current: ReadTokens, expected: ReadTokenIdentity, permit: RefreshReadPermit, fetcher: typeof fetch = fetch): Promise<ReadTokens> {
  const c = { ...config }, old = { ...current, scopes: [...current.scopes] }, identity = { ...expected };
  exactIdentity(identity);
  requireConnection(old.userId === identity.userId && old.scopes.length === 2 && READ_SCOPES.every(s => old.scopes.includes(s)) && /^\d+\.[^\s]{8,8192}$/.test(old.refreshToken) && old.refreshToken.split(".")[0] === String(identity.userId), "refresh_identity_unverified");
  const requestStarted = Date.now();
  const raw = record(await call(c, 0, "https://api.etsy.com/v3/public/oauth/token", "POST", permit, fetcher, undefined,
    formBody({ grant_type: "refresh_token", client_id: c.keystring, refresh_token: old.refreshToken })));
  const scopes = typeof raw.scope === "string" ? raw.scope.split(" ") : [];
  requireConnection(raw.token_type === "Bearer" && typeof raw.access_token === "string" && /^\d+\.[^\s]{8,8192}$/.test(raw.access_token) && typeof raw.refresh_token === "string" && /^\d+\.[^\s]{8,8192}$/.test(raw.refresh_token) &&
    Number.isSafeInteger(raw.expires_in) && Number(raw.expires_in) > 30 && Number(raw.expires_in) <= 3600, "refresh_response_unverified");
  requireConnection(scopes.length === 2 && READ_SCOPES.every(s => scopes.includes(s)), "granted_scopes_unverified");
  requireConnection(raw.access_token.split(".")[0] === String(identity.userId) && raw.refresh_token.split(".")[0] === String(identity.userId), "refresh_identity_mismatch");
  const tokenExpiresAt = new Date(requestStarted + Number(raw.expires_in) * 1000 - 30_000).toISOString();
  requireConnection(Date.parse(tokenExpiresAt) > Date.now(), "refresh_response_expired");
  return { userId: identity.userId, accessToken: raw.access_token, refreshToken: raw.refresh_token, scopes: [...READ_SCOPES], tokenExpiresAt };
}

/** Useful fixed own-shop operation. No discovery, pagination, arbitrary fields,
 * model processing or token refresh occurs inside this read adapter. */
export async function readExactDraftStatus(config: ReadApiConfig, tokens: ReadTokens, expected: ReadTokenIdentity, permit: RefreshReadPermit, fetcher: typeof fetch = fetch): Promise<DraftReadProof> {
  const c = { ...config }, t = { ...tokens, scopes: [...tokens.scopes] }, identity = { ...expected };
  exactIdentity(identity);
  requireConnection(t.userId === identity.userId && /^\d+\.[^\s]{8,8192}$/.test(t.accessToken) && t.accessToken.split(".")[0] === String(identity.userId) && t.scopes.length === 2 && READ_SCOPES.every(s => t.scopes.includes(s)) && Date.parse(t.tokenExpiresAt) > Date.now(), "read_token_unavailable");
  const url = `https://api.etsy.com/v3/application/shops/${identity.shopId}/listings?state=draft&limit=1&offset=0`;
  const page = record(await call(c, 1, url, "GET", permit, fetcher, t.accessToken));
  requireConnection(Number.isSafeInteger(page.count) && Number(page.count) >= 0 && Array.isArray(page.results) && page.results.length <= 1 && Number(page.count) >= page.results.length, "read_response_unverified");
  const facts = page.results.map(value => {
    const row = record(value);
    requireConnection(Number.isSafeInteger(row.listing_id) && Number(row.listing_id) > 0 && row.shop_id === identity.shopId && row.user_id === identity.userId && row.state === "draft", "read_listing_identity_mismatch");
    return { listingId: row.listing_id, shopId: identity.shopId, userId: identity.userId, state: "draft" };
  });
  requireConnection(Date.parse(t.tokenExpiresAt) > Date.now(), "read_token_expired");
  return { ...identity, listingCount: facts.length, totalDrafts: Number(page.count), factsHash: fingerprint(JSON.stringify(facts)), verifiedAt: new Date().toISOString() };
}
