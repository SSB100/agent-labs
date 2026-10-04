/** R10 is a controlled public qualification source, not a permission to watch
 * an arbitrary browser, owner handoff, saved profile or existing worker page. */
export const WATCH_POLICY = "r10.controlled-public.v1";
export const WATCH_SOURCE_URL = "https://r10-viewer.invalid/controlled-public";
export const WATCH_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agent Labs controlled public qualification</title><style>html{color-scheme:light}body{margin:0;padding:36px;background:#f0f5f7;color:#163340;font:20px system-ui,sans-serif}main{max-width:740px;margin:auto;border:2px solid #2d7b86;border-radius:24px;padding:30px;background:white}h1{font-size:30px;margin:0 0 20px}p{line-height:1.5}strong{color:#146672}.mark{width:64px;height:64px;border-radius:50%;background:#207981;margin:24px 0}</style></head><body><main><div class="mark"></div><h1>Controlled public qualification</h1><p>This is a real browser rendering a fixed, reviewed public test document.</p><p><strong>Read-only viewing</strong> · No account, personal content, forms or external requests.</p><p>The browser, capture and viewing channel have a bounded lifetime. This page does not establish general website or existing worker-session viewing.</p></main></body></html>`;
export const WATCH_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; sandbox";
export const WATCH_MAX_FRAME_BYTES = 150_000;
export const WATCH_MAX_FRAMES = 120;
export const WATCH_MAX_RUNTIME_MS = 120_000;
export const WATCH_DISPOSE_TIMEOUT_MS = 5_000;
export const WATCH_CLEANUP_BUDGET_MS = 15_000;
export type WatchLifetime = {
  readonly completion: Promise<void>;
  readonly signal: AbortSignal;
  readonly workDeadline: number;
  finish(): void;
};
export type WatchPhase = "hosting" | "claim" | "dispatch" | "provider_create" | "provider_record" | "capture_setup" |
  "attest" | "capture_permit" | "capture" | "capture_lease" | "delivery_permit" | "delivery" | "authority_read" |
  "stop" | "setup_settle" | "dispose" | "capture_settle" | "release" | "close" | "cleanup";
export type WatchReason = "started" | "completed" | "failed" | "denied" | "expired" | "aborted" |
  "source_invalidated" | "timeout" | "unconfirmed" | "frame_invalid" | "frame_limit";
/** Only fixed codes and bounded numbers, never exceptions or source/identity data. */
export type WatchDiagnostic = { phase: WatchPhase; reason: WatchReason; durationMs: number; remainingMs: number;
  capturedFrames: number; deliveredFrames: number };
export type WatchScope = { sessionId: string; businessId: string; questId: string; workflowRunId: string };
export type WatchIdentity = WatchScope & { ownerId: string; authSessionId: string };
export type WatchStatus = "available" | "starting" | "watching" | "revocation_pending" | "revoked" | "ended" | "expired" | "unavailable";
export type WatchSummary = WatchScope & { status: WatchStatus; expiresAt: string; policyVersion: string; updatedAt?: string; streamClosure?: "unconfirmed" | "acknowledged" };
export type WatchOperation = "claim" | "create_dispatched" | "created" | "attest" | "suspend" | "permit" | "revoke" | "close" | "read";
export type WatchAuthority = (operation: WatchOperation, payload?: Record<string, unknown>) => Promise<Record<string, unknown>>;
export type WatchCapture = {
  readonly contextId: string; readonly pageId: string;
  /** Must check the producer's own live confinement, never caller JSON. */
  eligible(): boolean;
  capture(): Promise<Uint8Array>;
  suspend(): void;
  dispose(): Promise<void>;
};
export type WatchDependencies = {
  authority: WatchAuthority;
  sourceHash: string;
  createProvider(timeoutMs: number, assertDispatch: () => void): Promise<{ providerSessionId: string; endpoint: string; receiptHash: string }>;
  createCapture(endpoint: string, invalidate: () => void): Promise<WatchCapture>;
  releaseProvider(providerSessionId: string): Promise<void>;
  diagnostic?: (event: WatchDiagnostic) => void;
  /** Only dependency injection in inert tests substitutes time/producer. */
  monotonic?: () => number;
};
export class CaptureFailure extends Error {
  constructor(readonly reason: "timeout" | "source_invalidated" | "frame_invalid") { super("capture_unavailable"); }
}
export class CaptureSetupFailure extends Error {
  constructor(readonly closureConfirmed: boolean) { super("capture_confinement_unavailable"); }
}
export const watchScopeKeys = ["sessionId", "businessId", "questId", "workflowRunId"] as const;
export function validWatchScope(value: unknown): value is WatchScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return watchScopeKeys.every(key => typeof (value as WatchScope)[key] === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test((value as WatchScope)[key]));
}
