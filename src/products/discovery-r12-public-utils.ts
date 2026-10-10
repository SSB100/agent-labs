import { discoveryV2Hash } from "./discovery-v2";
export const publicResearchHash = discoveryV2Hash;
export function publicResearchFail(reason = "r12_public_contract_unverified"): never { throw new Error(reason); }
export function exactPublicKeys(value: unknown, keys: string): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === keys.split(",").sort().join(",");
}
export const publicUuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
export const publicHash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export const publicInteger = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
export function publicMoney(v: unknown): bigint { return typeof v === "string" && /^(0|[1-9][0-9]{0,15})$/.test(v) && BigInt(v) <= BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(v) : publicResearchFail(); }
export function publicText(v: unknown, max = 2000): v is string { return typeof v === "string" && v.trim().length > 0 && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v); }
export function publicTime(v: unknown): number { return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v) && Number.isFinite(Date.parse(v)) ? Date.parse(v) : publicResearchFail(); }
export function publicCanonicalText(v: string): string { return v.normalize("NFC").replace(/[\t\n\v\f\r ]+/g, " ").trim().replace(/[A-Z]/g, c => c.toLowerCase()); }
export function publicHashSet(v: unknown, max = 4096): v is string[] { return Array.isArray(v) && v.length <= max && v.every(publicHash) && v.every((x, i) => i === 0 || v[i - 1] < x); }
export function verifyPublicSelfHash(value: Record<string, unknown>, key: string): void { const { [key]: h, ...body } = value; if (!publicHash(h) || publicResearchHash(body) !== h) publicResearchFail(); }
export function publicBoundedJson(v: unknown, max = 2 * 1024 * 1024): void { if (Buffer.byteLength(JSON.stringify(v), "utf8") > max) publicResearchFail("r12_public_context_too_large"); }
