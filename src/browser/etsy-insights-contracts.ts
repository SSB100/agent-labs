import type { PublicResearchInsightsAccountBinding } from "../products/discovery-r12-public-source";
import type { PublicResearchWindow } from "../products/discovery-r12-public-window";

export const ETSY_INSIGHTS_SCOPE_VERSION = "r12.etsy-insights-source-scope.1" as const;
export const ETSY_INSIGHTS_RECEIPT_VERSION = "r12.etsy-insights-source-receipt.1" as const;
export type EtsyInsightsScope = {
  version: typeof ETSY_INSIGHTS_SCOPE_VERSION;
  operationId: string; sourceAttemptId: string; businessId: string; goalId: string; authorityRootId: string;
  scopeId: string; scopeHash: string; originDirectRunId: string; providerProjectId: string;
  window: PublicResearchWindow; attemptOrdinal: number; windowAttemptOrdinal: number;
  criteriaHash: string; questionHash: string; quoteHash: string; executionQuoteHash: string; executionQuoteProofHash: string; sourcePolicyHash: string;
  accountBinding: PublicResearchInsightsAccountBinding; capturePolicyHash: string;
  query: string; expiresAt: string; maximumBrowserMicrounits: string;
  limits: { maximumSessionMs: number; maximumActions: number; maximumTextBytes: number;
    maximumScreenshotBytes: number; maximumTotalCaptureBytes: number };
};
export type EtsyInsightsOperation = "create" | "open_insights" | "observe" | "submit_query" | "capture" | "accept_capture";
export type EtsyInsightsAdmissionRequest = {
  version: "r12.etsy-insights-source-admission.1"; operation: EtsyInsightsOperation; sequence: number;
  operationId: string; sourceAttemptId: string; requestHash: string;
  businessId: string; goalId: string; authorityRootId: string; scopeId: string; scopeHash: string; providerProjectId: string;
  originDirectRunId: string; windowId: string; windowOrdinal: number; windowAttemptOrdinal: number;
  attemptOrdinal: number; criteriaHash: string; questionHash: string; quoteHash: string; executionQuoteHash: string; executionQuoteProofHash: string;
  sourcePolicyHash: string; capturePolicyHash: string; accountBindingHash: string; accountVerificationHash: string;
  maximumBrowserMicrounits: string; sessionId: string | null; contextId: string | null;
  pageId: string | null; documentEpoch: number | null; targetId: string | null; captureHash: string | null;
};
export type EtsyInsightsAdmission = {
  version: "r12.etsy-insights-source-permit.1"; admissionHash: string;
  reservationId: string; reservationHash: string; reservedBrowserMicrounits: string; expiresAt: string;
};
export type EtsyInsightsIdentity = {
  sessionId: string; contextId: string; pageId: string; providerProjectId: string;
  profileBindingId: string; profileBindingRevision: string; accountBindingHash: string;
};
export type EtsyInsightsBlock = "none" | "login" | "captcha" | "bot_challenge" | "quota" | "account_mismatch" | "private_data" | "unknown";
export type EtsyInsightsObservedPage = EtsyInsightsIdentity & {
  documentEpoch: number; url: string; view: "landing" | "results";
  block: EtsyInsightsBlock; unexpectedNavigation: boolean; unapprovedRequest: boolean; popupOpened: boolean;
  visibleShopName: string; visibleShopId: string | null;
  query: string | null;
  queryControl: { id: string; kind: "insights_query"; sensitive: false } | null;
};
export type EtsyInsightsFactKind = "query" | "shop_name" | "shop_id" | "reporting_window" | "searches" | "results" |
  "conversion_statement" | "price" | "currency" | "aggregate_region" | "timezone" | "trend_statement" | "limitation";
/** Literal visible statements only. Offsets count Unicode code points. No rate,
 * numeric expansion, ordinal scale, sales estimate or geographic inference. */
export type EtsyInsightsFact = { kind: EtsyInsightsFactKind; start: number; end: number; quote: string };
export type EtsyInsightsCaptureFrame = EtsyInsightsIdentity & {
  beforeEpoch: number; afterEpoch: number; url: string; capturedAt: string;
  text: string; screenshot: Uint8Array; mimeType: "image/png"; viewport: { width: number; height: number };
  extraction: "visible_aggregate_viewport"; facts: EtsyInsightsFact[];
};
export type EtsyInsightsCapture = {
  version: "r12.etsy-insights-visible-capture.1"; captureHash: string;
  sessionId: string; contextId: string; pageId: string; providerProjectId: string; visibleAccountContextHash: string;
  canonicalUrl: string; query: string; documentEpoch: number; capturedAt: string;
  source: "browser_visible_signed_in_aggregate"; accountBindingHash: string; accountVerificationHash: string;
  observedShopName: string; observedShopId: string | null;
  text: string; textHash: string; screenshotHash: string; screenshotBytes: number;
  mimeType: "image/png"; viewport: { width: number; height: number }; extraction: "visible_aggregate_viewport";
  facts: EtsyInsightsFact[]; interpretation: "literal_display_only";
  buyerGeography: "not_inferred"; competitorSales: "unknown"; competitorConversion: "unknown"; commercialDemandProven: false;
};
export type EtsyInsightsWitness = { ref: string; evidenceIdentityHash: string; factIdentityHash: string; observationClusterHash: string };
export type EtsyInsightsScreenshotStorage = {
  version: "r12.etsy-insights-screenshot-storage.1"; captureHash: string; screenshotHash: string;
  byteLength: number; storageObjectId: string; storageReceiptHash: string;
};
export type EtsyInsightsReceipt = {
  version: typeof ETSY_INSIGHTS_RECEIPT_VERSION; operationId: string; sourceAttemptId: string; requestHash: string;
  businessId: string; goalId: string; authorityRootId: string; scopeId: string; scopeHash: string; providerProjectId: string;
  originDirectRunId: string; windowId: string; windowOrdinal: number; windowAttemptOrdinal: number;
  maximumAttemptsInWindow: number; baseAttemptsStarted: number; attemptOrdinal: number;
  criteriaHash: string; questionHash: string; quoteHash: string; executionQuoteHash: string; executionQuoteProofHash: string; sourcePolicyHash: string; capturePolicyHash: string;
  accountBindingHash: string; accountVerificationHash: string; maximumBrowserMicrounits: string;
  status: "completed" | "paused"; reason: string; capturedAt: string;
  captureHash: string; captures: EtsyInsightsCapture[]; witnesses: EtsyInsightsWitness[];
  screenshotStorage: EtsyInsightsScreenshotStorage | null;
  releaseState: "not_required" | "verified" | "unconfirmed";
  liabilityState: "not_dispatched" | "receipt_required" | "unknown";
  reservationId: string | null; reservationHash: string | null; sessionId: string | null;
  actionsUsed: number; receiptHash: string;
};
/** The future trusted port resolves the exact approved opaque profile binding,
 * uses persistProfile:false, confines navigation to the reviewed Insights UI,
 * verifies visible account identity in the SAME context, and enforces private
 * data exclusion before returning any text/PNG. No arbitrary Page/URL/eval,
 * cookies, context export, replay, credentials, orders or customer APIs. */
export type EtsyInsightsSession = EtsyInsightsIdentity & {
  persistProfile: false;
  openApprovedInsights(signal: AbortSignal): Promise<void>;
  observeAggregateView(signal: AbortSignal): Promise<EtsyInsightsObservedPage>;
  submitObservedQuery(controlId: string, expectedEpoch: number, query: string, signal: AbortSignal): Promise<void>;
  captureSameEpoch(expectedEpoch: number, signal: AbortSignal): Promise<EtsyInsightsCaptureFrame>;
  close(expectedSessionId: string): Promise<{ sessionId: string; released: boolean; terminalReadback: boolean; observersDisposed: boolean }>;
};
export type EtsyInsightsDependencies = {
  /** Trusted one-shot transaction reserves the actual R05/R07 source attempt and
   * full original-root liability BEFORE create. Duplicate sequence throws, never
   * returns a reusable permit. Every stage rechecks Stop, scope/window/account/
   * purpose/profile revisions and existing quoted authority; no grant creation. */
  admit(request: Readonly<EtsyInsightsAdmissionRequest>): Promise<EtsyInsightsAdmission>;
  createSession(scope: Readonly<EtsyInsightsScope>, signal: AbortSignal): Promise<EtsyInsightsSession>;
  /** Private server storage and immutable ledger acknowledgement. A matching
   * hash alone is not storage authentication; no public URL enters the receipt. */
  storeScreenshot(capture: Readonly<EtsyInsightsCapture>, bytes: Uint8Array, signal: AbortSignal): Promise<EtsyInsightsScreenshotStorage>;
  recordRelease(event: { operationId: string; sourceAttemptId: string; reservationId: string | null; sessionId: string | null; verified: boolean }): Promise<void>;
  /** Persist both success and honest pauses. Next-attempt admission stays blocked
   * while this dispatched source attempt has no qualified immutable receipt. */
  recordReceipt(receipt: Readonly<EtsyInsightsReceipt>): Promise<{ receiptHash: string; persisted: true }>;
  signal: AbortSignal; registerCleanup(completion: Promise<void>): void;
  now?: () => number; monotonic?: () => number;
};
export type EtsyInsightsRunResult = { receipt: EtsyInsightsReceipt; persistence: "verified" | "unconfirmed" };
