import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MAX_BYTES = 65_536;
/** Injected by trusted server code. The revision must come from the current
 * persisted connection, never from the envelope or a submitted form. */
export type AccountSecretContext = {
  businessId: string; provider: string; connectionId: string; revision: string;
};
export class AccountVaultError extends Error {
  constructor(readonly code: "account_vault_not_configured" | "invalid_account_secret") {
    super(code); this.name = "AccountVaultError";
  }
}
function aad(context: AccountSecretContext) {
  if (!context || !UUID.test(context.businessId) || !UUID.test(context.connectionId) || !UUID.test(context.revision) ||
    typeof context.provider !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(context.provider)) {
    throw new AccountVaultError("invalid_account_secret");
  }
  // A distinct namespace prevents reuse as Etsy/product-package authority.
  return Buffer.from(JSON.stringify(["account-v1", context.businessId, context.provider, context.connectionId, context.revision]));
}
function keyBytes(key: string) {
  if (typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key)) throw new AccountVaultError("account_vault_not_configured");
  return Buffer.from(key, "hex");
}
function decode(value: string, exactBytes?: number) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new AccountVaultError("invalid_account_secret");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value || (exactBytes !== undefined && decoded.length !== exactBytes)) {
    throw new AccountVaultError("invalid_account_secret");
  }
  return decoded;
}
/** This module has no environment lookup, password derivation or master login.
 * Only the account server imports it; envelopes must not enter model artifacts. */
export function sealAccountSecret<T>(value: T, context: AccountSecretContext, key: string): string {
  const material = keyBytes(key), associatedData = aad(context);
  try {
    const json = JSON.stringify(value);
    if (typeof json !== "string" || Buffer.byteLength(json, "utf8") > MAX_BYTES) throw new AccountVaultError("invalid_account_secret");
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", material, iv);
    cipher.setAAD(associatedData);
    const encrypted = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
    return ["account-v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
  } catch { throw new AccountVaultError("invalid_account_secret"); }
  finally { material.fill(0); }
}
/** Authenticated decryption does not establish freshness by itself. Callers must
 * load the current revision/status and validate the decrypted schema and expiry. */
export function unsealAccountSecret<T>(value: string, context: AccountSecretContext, key: string): T {
  let material: Buffer | undefined;
  try {
    material = keyBytes(key);
    if (typeof value !== "string" || value.length > 90_000) throw new AccountVaultError("invalid_account_secret");
    const parts = value.split(".");
    if (parts.length !== 4 || parts[0] !== "account-v1") throw new AccountVaultError("invalid_account_secret");
    const iv = decode(parts[1], 12), tag = decode(parts[2], 16), ciphertext = decode(parts[3]);
    if (ciphertext.length > MAX_BYTES) throw new AccountVaultError("invalid_account_secret");
    const decipher = createDecipheriv("aes-256-gcm", material, iv);
    decipher.setAAD(aad(context)); decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")) as T;
  } catch { throw new AccountVaultError("invalid_account_secret"); }
  finally { material?.fill(0); }
}
