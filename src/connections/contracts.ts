import { createHash } from "node:crypto";
export const READ_SCOPES = ["shops_r", "listings_r"] as const;
export const ETSY_CALLBACK = "https://agent-labs-two.vercel.app/api/etsy/r11/callback";
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][0-9a-f]{3}-[a-f0-9]{12}$/i;
export const HASH = /^[a-f0-9]{64}$/;
export function fingerprint(value: string): string { return createHash("sha256").update(value).digest("hex"); }
export class ConnectionQualificationError extends Error {
  constructor(readonly code: string) { super(code); this.name = "ConnectionQualificationError"; }
}
export function requireConnection(value: unknown, code = "connection_qualification_unavailable"): asserts value {
  if (!value) throw new ConnectionQualificationError(code);
}
export function record(value: unknown): Record<string, unknown> {
  requireConnection(!!value && typeof value === "object" && !Array.isArray(value)); return value as Record<string,unknown>;
}
export type ConnectionGrant = { id: string; provider: "etsy" | "printful"; expectedAccount: string; applicationId: string;
  expiresAt: string; purposeHash: string; approvedCredentialFingerprint: string; state: "available" | "used" | "expired" | "revoked"; credentialAlias: string | null; providerScopes?: string[] | null; providerScopeMode?: "exact"|"inspect_and_record"; configured?: boolean };
export type ConnectionSummary = { id: string; provider: "etsy" | "printful"; externalAccountId: string; label: string;
  revision: string; status: string; custody: "encrypted_oauth" | "environment"; verifiedAt: string; expiresAt: string;
  permittedOperations: string[]; providerScopes?: string[]; providerExpiryVerified: boolean };
export type QualificationAttempt = { id: string; provider: string; status: string; createdAt: string; completedAt: string | null; reason: string | null };
export type QualificationWorkspace = { businessId: string; unavailable: boolean; configured: boolean; grants: ConnectionGrant[]; connections: ConnectionSummary[]; attempts: QualificationAttempt[]; grantTotal?: number; attemptTotal?: number; configurationFingerprints?: {etsy: string|null; printfulPrimary: string|null} };
export type QualificationPermit = { attemptId: string; step: number; endpoint: string; method: "GET" | "POST"; expiresAt: string };
export function exactPermit(value: unknown, expected: { attemptId: string; step: number; endpoint: string; method: string }, now = Date.now()): QualificationPermit {
  const p = record(value);
  requireConnection(p.shouldDispatch === true && p.attemptId === expected.attemptId && p.step === expected.step && p.endpoint === expected.endpoint && p.method === expected.method &&
    typeof p.expiresAt === "string" && Number.isFinite(Date.parse(p.expiresAt)) && Date.parse(p.expiresAt) > now, "connection_dispatch_not_authorized");
  return { ...expected, method: p.method, expiresAt: p.expiresAt } as QualificationPermit;
}
