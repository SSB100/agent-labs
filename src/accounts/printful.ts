import { inspectPrintfulStore, printfulReadAuthorization, type PrintfulStoreBinding } from "../printful/account";
import type { PrintfulReadAuthorization } from "../printful/adapter";
import { printfulHash } from "../printful/contracts";
import { unsealAccountSecret } from "./vault";

/** Official references reviewed 2026-10-01. These are links, not auto-opened
 * credential entry surfaces. Only the owner enters secrets in the secure app form. */
export const PRINTFUL_ACCOUNT_LINKS = {
  documentation: "https://developers.printful.com/docs/",
  tokenManagement: "https://developers.printful.com/tokens",
  scopeDocumentation: "https://developers.printful.com/docs/edm/",
} as const;
const ORIGIN = "https://api.printful.com";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const RESPONSE_LIMIT_BYTES = 65_536;
const MAX_LOCAL_VALIDITY_MS = 31 * 86_400_000;
const SAFE_SCOPES = new Set(["stores_list/read"]);
export type PrintfulConnectionErrorCode = "invalid_connection_request" | "credential_access_denied" |
  "provider_rate_limited" | "provider_failure" | "provider_timeout" | "invalid_provider_response" |
  "store_identity_mismatch" | "credential_scope_rejected" | "credential_store_scope_rejected" | "account_connection_required";
export class PrintfulConnectionError extends Error {
  constructor(readonly code: PrintfulConnectionErrorCode) { super(code); this.name = "PrintfulConnectionError"; }
}
function requireConnection(condition: unknown, code: PrintfulConnectionErrorCode): asserts condition {
  if (!condition) throw new PrintfulConnectionError(code);
}
function record(value: unknown): Record<string, unknown> {
  requireConnection(value !== null && typeof value === "object" && !Array.isArray(value), "invalid_provider_response");
  return value as Record<string, unknown>;
}
function validCredential(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 8192 && /^[\x21-\x7e]+$/.test(value);
}
function safeScopes(value: unknown): string[] {
  requireConnection(Array.isArray(value) && value.length <= SAFE_SCOPES.size && value.every(scope => typeof scope === "string" && SAFE_SCOPES.has(scope)) &&
    new Set(value).size === value.length, "credential_scope_rejected");
  return [...value].sort() as string[];
}
export type PrintfulConnectionVerificationInput = {
  businessId: string; connectionId: string; revision: string; storeId: number;
  storeKind: PrintfulStoreBinding["storeKind"]; credential: string;
  /** Owner-supplied expiry is a bounded local cutoff, not provider introspection. */
  expiresAt: string;
};
export type VerifiedPrintfulBinding = PrintfulStoreBinding & {
  revision: string; providerScopes: string[]; verifiedAt: string;
};
export type PrintfulAccountSecret = {
  version: "account-v1"; provider: "printful"; businessId: string; connectionId: string; revision: string;
  storeId: number; storeKind: PrintfulStoreBinding["storeKind"]; credential: string;
  expiresAt: string; verifiedAt: string; providerScopes: string[];
};
export type PrintfulConnectionVerificationReceipt = {
  provider: "printful"; businessId: string; connectionId: string; revision: string;
  storeId: number; storeKind: PrintfulStoreBinding["storeKind"]; verifiedAt: string; expiresAt: string;
  verification: "provider_read"; method: "GET"; endpoints: string[]; httpStatus: 200;
  providerScopes: string[]; permittedOperations: ["catalog.read"];
  accessibleStoresAtVerification: 1; tokenAccessLevel: "not_reported"; providerExpiryVerified: false;
  responseHash: string; externalMutation: false; productExecutionAuthorized: false; liveQualified: false;
};
export type PrintfulVerificationOptions = {fetcher?: typeof fetch; now?: () => number; timeoutMs?: number};
async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  requireConnection(contentLength === null || (/^\d+$/.test(contentLength) && Number(contentLength) <= RESPONSE_LIMIT_BYTES), "invalid_provider_response");
  requireConnection(/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "") && response.body, "invalid_provider_response");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, {once: true});
  try {
    while (true) {
      requireConnection(!signal.aborted, "provider_timeout");
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > RESPONSE_LIMIT_BYTES) { cancel(); throw new PrintfulConnectionError("invalid_provider_response"); }
      chunks.push(part.value);
    }
    requireConnection(!signal.aborted, "provider_timeout");
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}
/** Only three fixed read paths exist. No client URL, redirects, retry, mutation,
 * order, subscription or credential-creation endpoint can reach this transport. */
async function providerRead(path: string, credential: string, storeId: number, options: PrintfulVerificationOptions): Promise<unknown> {
  requireConnection(["/oauth/scopes", "/stores", `/stores/${storeId}`].includes(path), "invalid_connection_request");
  const controller = new AbortController(), timeoutMs = options.timeoutMs ?? 10_000;
  requireConnection(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 10_000, "invalid_connection_request");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new PrintfulConnectionError("provider_timeout")); }, timeoutMs);
  });
  try {
    return await Promise.race([deadline, (async () => {
      const url = `${ORIGIN}${path}`;
      const response = await (options.fetcher ?? fetch)(url, {method: "GET", redirect: "error", cache: "no-store", signal: controller.signal,
        headers: {Authorization: `Bearer ${credential}`, Accept: "application/json"}});
      requireConnection(!response.redirected && (response.url === "" || response.url === url), "invalid_provider_response");
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => {});
        throw new PrintfulConnectionError(response.status === 401 || response.status === 403 ? "credential_access_denied" :
          response.status === 429 ? "provider_rate_limited" : "provider_failure");
      }
      try { return await boundedJson(response, controller.signal); }
      catch (error) {
        if (error instanceof PrintfulConnectionError) throw error;
        throw new PrintfulConnectionError("invalid_provider_response");
      }
    })()]);
  } catch (error) {
    // Neither error causes nor provider bodies may cross this server boundary.
    if (error instanceof PrintfulConnectionError) throw new PrintfulConnectionError(error.code);
    throw new PrintfulConnectionError(controller.signal.aborted ? "provider_timeout" : "provider_failure");
  } finally { clearTimeout(timer); controller.abort(); }
}
/** Called only after authenticated owner approval and a persisted, exact-target
 * setup attempt. A receipt is evidence, not SQL/app authorization by itself.
 * Secret output must be sealed immediately and never returned to the browser. */
export async function verifyPrintfulConnection(input: PrintfulConnectionVerificationInput, options: PrintfulVerificationOptions = {}): Promise<{
  binding: VerifiedPrintfulBinding; receipt: PrintfulConnectionVerificationReceipt; secret: PrintfulAccountSecret;
}> {
  // Snapshot before awaiting provider I/O; submitted objects cannot change target.
  const {businessId, connectionId, revision, storeId, storeKind, credential, expiresAt} = input;
  const now = options.now ?? Date.now, startedAt = now(), expiry = Date.parse(expiresAt);
  requireConnection(UUID.test(businessId) && UUID.test(connectionId) && UUID.test(revision) && Number.isSafeInteger(storeId) && storeId > 0 &&
    ["manual_api", "ecommerce_linked"].includes(storeKind) && validCredential(credential) && Number.isFinite(startedAt) &&
    Number.isFinite(expiry) && expiry > startedAt && expiry <= startedAt + MAX_LOCAL_VALIDITY_MS, "invalid_connection_request");
  const scopesBody = record(await providerRead("/oauth/scopes", credential, storeId, options));
  requireConnection(scopesBody.code === 200, "invalid_provider_response");
  const rawScopes = record(scopesBody.result).scopes;
  requireConnection(Array.isArray(rawScopes) && rawScopes.length <= 100, "invalid_provider_response");
  const providerScopes = safeScopes(rawScopes.map(row => record(row).scope));
  const storesBody = record(await providerRead("/stores", credential, storeId, options));
  requireConnection(storesBody.code === 200 && Array.isArray(storesBody.result), "invalid_provider_response");
  requireConnection(storesBody.result.length === 1 && record(storesBody.result[0]).id === storeId, "credential_store_scope_rejected");
  // The documented /stores response includes pagination. Require complete
  // evidence, not a one-row window that could hide other accessible stores.
  const paging = record(storesBody.paging);
  requireConnection(paging.total === 1 && paging.offset === 0 && Number.isSafeInteger(paging.limit) && Number(paging.limit) >= 1, "credential_store_scope_rejected");
  const storeBody = await providerRead(`/stores/${storeId}`, credential, storeId, options);
  try { inspectPrintfulStore(storeBody, {storeId, storeKind}); }
  catch { throw new PrintfulConnectionError("store_identity_mismatch"); }
  const completedAt = now();
  requireConnection(Number.isFinite(completedAt) && completedAt >= startedAt && expiry > completedAt, "invalid_connection_request");
  const verifiedAt = new Date(completedAt).toISOString(), normalizedExpiry = new Date(expiry).toISOString();
  const binding: VerifiedPrintfulBinding = {businessId, connectionResourceId: connectionId, revision, storeId, storeKind,
    status: "connected", expiresAt: normalizedExpiry, verifiedAt, providerScopes};
  // Hash only allowlisted public facts. No arbitrary provider field, display
  // name, body, token fingerprint or echoed secret enters a receipt or log.
  const responseHash = printfulHash({storeId, storeKind, providerScopes, accessibleStores: [storeId]});
  return {binding, receipt: {provider: "printful", businessId, connectionId, revision, storeId, storeKind, verifiedAt, expiresAt: normalizedExpiry,
    verification: "provider_read", method: "GET", endpoints: [`${ORIGIN}/oauth/scopes`, `${ORIGIN}/stores`, `${ORIGIN}/stores/${storeId}`], httpStatus: 200,
    providerScopes: [...providerScopes], permittedOperations: ["catalog.read"], accessibleStoresAtVerification: 1, tokenAccessLevel: "not_reported",
    providerExpiryVerified: false, responseHash, externalMutation: false, productExecutionAuthorized: false, liveQualified: false},
    secret: {version: "account-v1", provider: "printful", businessId, connectionId, revision, storeId, storeKind, credential,
      expiresAt: normalizedExpiry, verifiedAt, providerScopes: [...providerScopes]}};
}
export type StoredPrintfulAccount = VerifiedPrintfulBinding & {envelope: string};
/** Trusted callbacks must read server-authoritative connection rows, not Core
 * metadata or form JSON. Load once for an internally consistent snapshot; caller
 * must reload on every new catalog operation so disconnect/revision changes win. */
export function printfulAccountReadAuthorization(input: {
  requireBusinessOwner: (businessId: string) => Promise<void>;
  loadConnection: (businessId: string) => Promise<StoredPrintfulAccount | null>;
  vaultKey: string;
}): PrintfulReadAuthorization {
  return async businessId => {
    try {
      let current: StoredPrintfulAccount | null = null;
      const authorize = printfulReadAuthorization({requireBusinessOwner: input.requireBusinessOwner,
        loadBinding: async id => {
          current = structuredClone(await input.loadConnection(id));
          requireConnection(current && UUID.test(current.revision) && typeof current.envelope === "string", "account_connection_required");
          safeScopes(current.providerScopes);
          return current;
        },
        resolveServerCredential: async connectionId => {
          requireConnection(current && current.businessId === businessId && current.connectionResourceId === connectionId, "account_connection_required");
          const secret = unsealAccountSecret<PrintfulAccountSecret>(current.envelope,
            {businessId, provider: "printful", connectionId, revision: current.revision}, input.vaultKey);
          requireConnection(secret && secret.version === "account-v1" && secret.provider === "printful" && secret.businessId === businessId &&
            secret.connectionId === connectionId && secret.revision === current.revision && secret.storeId === current.storeId && secret.storeKind === current.storeKind &&
            secret.expiresAt === current.expiresAt && secret.verifiedAt === current.verifiedAt && Date.parse(secret.verifiedAt) <= Date.now() &&
            Date.parse(secret.expiresAt) > Date.now() && validCredential(secret.credential) &&
            JSON.stringify(safeScopes(secret.providerScopes)) === JSON.stringify(safeScopes(current.providerScopes)), "account_connection_required");
          return secret.credential;
        }});
      return await authorize(businessId);
    } catch { throw new PrintfulConnectionError("account_connection_required"); }
  };
}
/** Display after the SQL local-disconnect transition succeeds. There is no
 * documented private-token revocation API invoked by this adapter. */
export const PRINTFUL_LOCAL_DISCONNECT_NOTICE = {
  providerRevoked: false,
  message: "Local access is disconnected. Delete the private token in Printful's developer portal to revoke it at Printful.",
  providerRevocationUrl: PRINTFUL_ACCOUNT_LINKS.tokenManagement,
} as const;
