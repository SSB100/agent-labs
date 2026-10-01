import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { requireEtsy, EtsyError } from "./contracts";

/** Server-only key material is injected by the server boundary; never exported
 * as an artifact or passed to a client component. AAD prevents tenant/type swaps. */
export function seal(value: unknown, context: string, key: string) {
  requireEtsy(/^[a-f0-9]{64}$/.test(key), "etsy_vault_not_configured");
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  cipher.setAAD(Buffer.from(`etsy-v1:${context}`));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
export function unseal<T>(value: string, context: string, key: string): T {
  try {
    requireEtsy(/^[a-f0-9]{64}$/.test(key) && value.length <= 200_000, "invalid_sealed_record");
    const [version, iv, tag, ciphertext, extra] = value.split(".");
    requireEtsy(version === "v1" && !extra && !!iv && !!tag && !!ciphertext, "invalid_sealed_record");
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(`etsy-v1:${context}`)); decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8")) as T;
  } catch { throw new EtsyError("invalid_sealed_record"); }
}
export function randomSecret() { return randomBytes(32).toString("base64url"); }
export function secretHash(secret: string) { return createHash("sha256").update(secret).digest("hex"); }
