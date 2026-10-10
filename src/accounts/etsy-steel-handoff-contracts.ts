import { ACCOUNT_UUID, accountDigest } from "./contracts";
import type { BrowserProviderSession, BrowserSessionCreateRequest } from "../browser/types";

/** An owner-login contract, not the existing unrecorded signup contract and not
 * research/source authority. No production Steel port is installed here. */
export const ETSY_STEEL_HANDOFF_VERSION = "etsy.steel-owner-handoff-scope.1" as const;
export const ETSY_STEEL_HANDOFF_RISKS = Object.freeze({
  version: "etsy.steel-owner-handoff-disclosure.1",
  provider: "steel",
  destination: "https://www.etsy.com",
  recording: "provider_records_session",
  manualPasswordMasking: "not_verified",
  manualMfaMasking: "not_verified",
  networkSecretRedaction: "not_verified",
  profilePersistence: "provider_managed_browser_state",
  providerRetention: "plan_dependent_not_independently_verified",
  providerProfileDeletion: "not_qualified",
  ownerCredentials: "owner_entry_only",
  agentObservationDuringOwnerEntry: "physically_disconnected",
  profileReuse: "requires_separate_current_read_authority",
  initialVerification: "one_separate_read_only_shop_identity_and_insights_landing_session_no_query",
} as const);

export type EtsySteelHandoffScope = {
  version: typeof ETSY_STEEL_HANDOFF_VERSION;
  operationId: string; ownerId: string; businessId: string; goalId: string; authorityRootId: string;
  testEnvelopeId: string; testEnvelopeHash: string; providerProjectId: string;
  verificationOperationId: string; verificationMaximumMicrounits: string; verificationQuoteHash: string;
  accountId: string; accountRevision: string; expectedShopName: string; expectedShopId: string | null;
  purpose: "etsy_insights_read_only";
  approvalId: string; approvalRevision: string; approvedAt: string; approvalExpiresAt: string;
  profileAccessExpiresAt: string; maximumSessionMs: number;
  maximumBrowserMicrounits: string; currency: "USD"; quoteHash: string; disclosureHash: string;
};
export type EtsySteelOwner = { ownerId: string; businessId: string };
export type EtsySteelHandoffOperation = "create" | "publish_handoff" | "owner_view" | "owner_return" | "profile_readback" | "accept_profile";
export type EtsySteelHandoffAdmissionRequest = {
  version: "etsy.steel-owner-handoff-admission.1";
  operation: EtsySteelHandoffOperation; requestId: string; scopeHash: string;
  operationId: string; ownerId: string; businessId: string; authorityRootId: string;
  testEnvelopeId: string; testEnvelopeHash: string; providerProjectId: string;
  accountId: string; accountRevision: string; approvalId: string; approvalRevision: string;
  disclosureHash: string; quoteHash: string; maximumBrowserMicrounits: string;
  handoffId: string | null; sessionId: string | null; profileId: string | null;
  reservationId: string | null; reservationHash: string | null;
};
export type EtsySteelHandoffPermit = {
  version: "etsy.steel-owner-handoff-permit.1"; requestHash: string;
  approval: "explicit_owner_persistent_access_and_budget";
  reservationId: string; reservationHash: string; reservedBrowserMicrounits: string;
  expiresAt: string;
};
export type EtsySteelDisconnectProof = {
  version: "etsy.steel-owner-disconnect.1"; sessionId: string;
  cdpDisconnected: true; observersDrained: true; inFlightCommandsSettled: true;
  appCaptureStopped: true; routeHandlersDrained: true; eventListenersRemoved: true;
};
/** The future trusted port opens only Etsy's reviewed login entry in a fresh
 * profile, then drains and physically disconnects ALL app observers. It never
 * reads/types credentials, supplies arbitrary navigation, or calls context APIs.
 * A provider recording continues; this proof concerns application observers only. */
export type EtsySteelOwnerSession = Pick<BrowserProviderSession, "providerKey" | "providerSessionId" | "profileId" | "debugUrl"> & {
  providerProjectId:string; freshProfile: true; entryUrl: "https://www.etsy.com";
  disconnectForOwner(signal: AbortSignal): Promise<EtsySteelDisconnectProof>;
};
export type EtsySteelHandoffRecord = {
  version: "etsy.steel-owner-handoff-record.1"; id: string;
  scope: EtsySteelHandoffScope; scopeHash: string;
  reservationId: string; reservationHash: string;
  envelope: string; createdAt: string; expiresAt: string; recordHash: string;
};
export type EtsySteelProfileCandidate = {
  version: "etsy.steel-profile-candidate.1";
  handoffId: string; scopeHash: string; ownerId: string; businessId: string;
  testEnvelopeId: string; testEnvelopeHash: string;
  accountId: string; accountRevision: string; expectedShopName: string; expectedShopId: string | null;
  approvalId: string; approvalRevision: string; purpose: "etsy_insights_read_only";
  providerProjectId:string; profileId: string; sourceSessionId: string; expiresAt: string;
  accountIdentityVerified: false; insightsAccessVerified: false; reuseRequiresFreshAuthority: true;
  candidateHash: string;
};
export type EtsySteelHandoffReceipt = {
  version: "etsy.steel-owner-handoff-receipt.1"; operationId: string; scopeHash: string;
  handoffId: string | null;
  status: "awaiting_owner" | "profile_pending_verification" | "stopped" | "failed";
  reason: string; releaseState: "not_created" | "held_for_owner" | "verified" | "unconfirmed";
  liabilityState: "not_dispatched" | "held" | "receipt_required" | "unknown";
  reservationId: string | null; reservationHash: string | null;
  profileBindingId: string | null; profileBindingRevision: string | null;
  accountIdentityVerified: false; insightsAccessVerified: false; receiptHash: string;
};
export type EtsySteelHandoffDependencies = {
  /** Trusted server transaction. Create must atomically reserve FULL session
   * liability and commit a one-shot dispatch marker. Exact replays throw; they
   * never return a reusable create permit. Every stage rechecks owner, account,
   * current approval revision, Stop and expiry. Not model/browser JSON authority. */
  admit(request: Readonly<EtsySteelHandoffAdmissionRequest>): Promise<EtsySteelHandoffPermit>;
  createSession(request: Readonly<BrowserSessionCreateRequest>, signal: AbortSignal): Promise<EtsySteelOwnerSession>;
  /** Atomic current-authority check + private encrypted storage + durable
   * Stop/expiry cleanup registration. Never publish a live URL in a receipt. */
  storeHandoff(record: Readonly<EtsySteelHandoffRecord>, permit: Readonly<EtsySteelHandoffPermit>): Promise<{ recordHash: string; cleanupRegistered: true }>;
  loadHandoff(owner: Readonly<EtsySteelOwner>, handoffId: string): Promise<EtsySteelHandoffRecord>;
  /** Authenticated CAS: invalidates every owner-view lease BEFORE cleanup.
   * Stop works after approval revocation/expiry. Return requires its fresh permit.
   * Repeats must reject; recovery uses a separate read-only ledger operation. */
  consumeHandoff(record: Readonly<EtsySteelHandoffRecord>, owner: Readonly<EtsySteelOwner>, action: "return" | "stop", permit: Readonly<EtsySteelHandoffPermit> | null): Promise<{ recordHash: string; consumed: true }>;
  /** Exact-session semantic release AND independent terminal readback. */
  releaseSession(sessionId: string): Promise<{ sessionId: string; released: boolean; terminalReadback: boolean }>;
  readProfile(profileId: string, signal: AbortSignal): Promise<{ id: string; sourceSessionId: string; status: "UPLOADING" | "READY" | "FAILED" }>;
  /** Atomic current-revision/Stop check. This stores only a pending verification
   * candidate, never an enabled research binding or new financial authority. */
  saveProfileCandidate(candidate: Readonly<EtsySteelProfileCandidate>, permit: Readonly<EtsySteelHandoffPermit>): Promise<{ candidateHash: string; bindingId: string; revision: string }>;
  recordOutcome(receipt: Readonly<EtsySteelHandoffReceipt>): Promise<void>;
  /** Server-only vault material. Reuses the existing Account AES-GCM envelope. */
  vaultKey: string; signal: AbortSignal;
  registerCleanup(completion: Promise<void>): void;
  now?: () => number; monotonic?: () => number;
};

export class EtsySteelHandoffError extends Error {
  constructor(readonly code: string) { super(code); this.name = "EtsySteelHandoffError"; }
}
export const etsySteelHash = accountDigest;
export function handoffAssert(value: unknown, code: string): asserts value {
  if (!value) throw new EtsySteelHandoffError(code);
}
export function handoffExact(value: unknown, keys: string, code = "handoff_invalid_shape"): asserts value is Record<string, unknown> {
  handoffAssert(value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === keys.split(",").sort().join(","), code);
}
export function handoffUuid(value: unknown): value is string { return typeof value === "string" && ACCOUNT_UUID.test(value); }
export function handoffHash(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
export function handoffInstant(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
export function buildEtsySteelHandoffDisclosure(scope: Omit<EtsySteelHandoffScope, "disclosureHash">) {
  return { ...ETSY_STEEL_HANDOFF_RISKS, ownerId: scope.ownerId, businessId: scope.businessId,
    testEnvelopeId: scope.testEnvelopeId, testEnvelopeHash: scope.testEnvelopeHash, providerProjectId: scope.providerProjectId,
    verificationOperationId: scope.verificationOperationId, verificationMaximumMicrounits: scope.verificationMaximumMicrounits, verificationQuoteHash: scope.verificationQuoteHash, accountId: scope.accountId, accountRevision: scope.accountRevision, expectedShopName: scope.expectedShopName,
    expectedShopId: scope.expectedShopId, purpose: scope.purpose, profileAccessExpiresAt: scope.profileAccessExpiresAt,
    maximumSessionMs: scope.maximumSessionMs, maximumBrowserMicrounits: scope.maximumBrowserMicrounits,
    currency: scope.currency, quoteHash: scope.quoteHash };
}
export function validateEtsySteelHandoffScope(value: unknown): EtsySteelHandoffScope {
  handoffExact(value, "version,operationId,ownerId,businessId,goalId,authorityRootId,testEnvelopeId,testEnvelopeHash,providerProjectId,verificationOperationId,verificationMaximumMicrounits,verificationQuoteHash,accountId,accountRevision,expectedShopName,expectedShopId,purpose,approvalId,approvalRevision,approvedAt,approvalExpiresAt,profileAccessExpiresAt,maximumSessionMs,maximumBrowserMicrounits,currency,quoteHash,disclosureHash");
  const s = value as EtsySteelHandoffScope;
  handoffAssert(s.version === ETSY_STEEL_HANDOFF_VERSION && s.purpose === "etsy_insights_read_only" && s.currency === "USD" &&
    [s.operationId,s.ownerId,s.businessId,s.goalId,s.authorityRootId,s.testEnvelopeId,s.providerProjectId,s.verificationOperationId,s.accountId,s.accountRevision,s.approvalId,s.approvalRevision].every(handoffUuid) &&
    typeof s.expectedShopName === "string" && s.expectedShopName.trim().length >= 1 && s.expectedShopName.length <= 120 && !/[\u0000-\u001f\u007f]/.test(s.expectedShopName) &&
    (s.expectedShopId === null || typeof s.expectedShopId === "string" && /^[1-9][0-9]{0,19}$/.test(s.expectedShopId)) &&
    Number.isSafeInteger(s.maximumSessionMs) && s.maximumSessionMs >= 15_000 && s.maximumSessionMs <= 900_000 &&
    typeof s.verificationMaximumMicrounits === "string" && /^[1-9][0-9]{0,14}$/.test(s.verificationMaximumMicrounits) && s.verificationOperationId !== s.operationId &&
    typeof s.maximumBrowserMicrounits === "string" && /^[1-9][0-9]{0,14}$/.test(s.maximumBrowserMicrounits) &&
    [s.quoteHash,s.disclosureHash,s.testEnvelopeHash,s.verificationQuoteHash].every(handoffHash), "handoff_scope_invalid");
  handoffAssert([s.approvedAt,s.approvalExpiresAt,s.profileAccessExpiresAt].every(handoffInstant), "handoff_expiry_invalid");
  const approved = Date.parse(s.approvedAt), expires = Date.parse(s.approvalExpiresAt), profile = Date.parse(s.profileAccessExpiresAt);
  handoffAssert([approved,expires,profile].every(Number.isFinite) && expires > approved && expires - approved <= 1_800_000 &&
    profile >= expires && profile - approved <= 30 * 86_400_000, "handoff_expiry_invalid");
  handoffAssert(s.disclosureHash === etsySteelHash(buildEtsySteelHandoffDisclosure(s)), "handoff_disclosure_changed");
  return structuredClone(s);
}
