/** R05 financial authority is separately confirmed; R04 remains intent-only. */
export type AdmissionMoney = { currency: string; microunits: string };
export type AdmissionScope = {
  operationKey: string; installationId: string; workflowDefinitionId: string;
  purpose: string; provider: string; category: "model";
  accountId: string | null; accountRevision: string | null;
  sourceDomains: string[]; dataClasses: string[];
  maximumPerOperationMicrounits: string;
};
export type OperatingPolicy = {
  version: "r05.1"; goalId: string; goalRevision: number; businessRevision: number;
  currency: string; businessLifetimeLimitMicrounits: string; policyLimitMicrounits: string;
  categoryLimits: Array<{category: "model"; microunits: string}>;
  expectedCapRevision: number; expectedExposureMicrounits: string;
  startsAt: string; expiresAt: string; maximumDispatches: number; minimumIntervalSeconds: number;
  stopOnTarget: boolean; operations: AdmissionScope[];
  /** No unsupported recurring/commerce/loss/margin semantics can be silently omitted. */
  financialMode: "bounded_model_cost_only";
};
export type LegacyAccountingSource =
  | {kind: "r05"}
  | {kind: "research"; callKey: string}
  | {kind: "creative" | "listing" | "listing_qualification"; runId: string; callKey: string}
  | {kind: "model_invocation"; invocationId: string};
/** Constructed only in trusted server runtime, never stored in a worker prompt or browser payload. */
export type AdmissionDispatchInput = {
  workflowRunId: string; runtimeCapability: string;
  operationKey: string; requestHash: string; idempotencyKey: string;
  providerModelId: string; wireRequestHash: string; wireRequestBytes: number; maximumOutputTokens: number;
  accounting: LegacyAccountingSource;
  sourceDomains: string[]; dataClasses: string[];
  accountId: string | null; accountRevision: string | null;
  currency: string; liabilityMicrounits: string;
};
export type AdmissionDecision = {
  decision: "allowed" | "blocked" | "needs_owner"; reason: string;
  requestId: string | null; shouldDispatch: boolean;
};
export type AdmissionOwnerOperation = "propose" | "confirm" | "revoke" | "pause" | "resume";
export type AdmissionServerOperation = "prepare" | "reserve" | "dispatch" | "guard" | "release_unsent" | "settle" | "readback" | "existing_effect_read" | "legacy_settle";
export type AdmissionPauseScope = {kind: "business" | "quest" | "pack" | "account"; id: string};
export const ADMISSION_RPC = {owner:"r05_policy_owner",server:"r05_admission_server",read:"r05_admission_read"} as const;
export type AdmissionRead = {
 authorityRootId: string; financialMode: "bounded_model_cost_only"; serverAuthorityConfigured: boolean;
 unavailableReason: string | null;
 eligibleOperations: Array<AdmissionScope & {providerModelId:string;maximumOutputTokens:number;maximumRequestBytes:number;validUntil:string}>;
 capVersions:Array<{currency:string;revision:number;maximumMicrounits:string}>;
 pauseStates:Array<AdmissionPauseScope & {paused:boolean}>; pauseStatesComplete:boolean;
 policies:Array<{id:string;hash:string;policy:OperatingPolicy;confirmed:boolean;revoked:boolean}>;
 exposure:Array<{currency:string;category:"model";heldMicrounits:string;hasUnknown:boolean}>;
 decisions:Array<{requestId:string|null;decision:string;reason:string;at:string}>;
 limit:number;offset:number;policyTotal:number;decisionTotal:number;businessPaused:boolean;
};
