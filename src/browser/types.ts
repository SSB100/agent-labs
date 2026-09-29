export const BROWSER_PROVIDER_KEYS = ["steel", "browserbase"] as const;

export type BrowserProviderKey = (typeof BROWSER_PROVIDER_KEYS)[number];

export const BROWSER_CAPABILITIES = [
  "browser.observe",
  "browser.interact",
  "browser.upload",
  "browser.takeover",
] as const;

export type BrowserCapability = (typeof BROWSER_CAPABILITIES)[number];

export type BrowserProviderSession = {
  providerKey: BrowserProviderKey;
  providerSessionId: string;
  debugUrl: string;
  sessionViewerUrl: string | null;
  automationEndpoint: string;
  profileId: string | null;
  status: "live" | "released" | "failed";
  region: string | null;
  browserMode: string | null;
};

export type BrowserSessionCreateRequest = {
  browserSessionId: string;
  profileId: string | null;
  timeoutMs: number;
};

export type BrowserObservation = {
  url: string;
  title: string;
  text: string;
  uploadQualified: boolean;
  uploadName: string | null;
  ownerInteractionCount: number;
  automationMarker: string | null;
};

export interface BrowserProviderAdapter {
  readonly providerKey: BrowserProviderKey;
  readonly configured: boolean;
  createSession(request: BrowserSessionCreateRequest): Promise<BrowserProviderSession>;
  retrieveSession(providerSessionId: string): Promise<BrowserProviderSession>;
  releaseSession(providerSessionId: string): Promise<void>;
  fetchReplay(providerSessionId: string, resourceUrl?: string): Promise<Response>;
}

export const BROWSER_PROVIDER_FAILURE_CATEGORIES = [
  "configuration_required",
  "authentication_required",
  "rate_limited",
  "provider_timeout",
  "provider_unavailable",
  "provider_rejected",
  "session_not_found",
  "automation_failed",
  "replay_unavailable",
] as const;

export type BrowserProviderFailureCategory =
  (typeof BROWSER_PROVIDER_FAILURE_CATEGORIES)[number];

export class BrowserProviderError extends Error {
  readonly category: BrowserProviderFailureCategory;
  readonly retryable: boolean;
  readonly details: Record<string, unknown>;

  constructor(
    category: BrowserProviderFailureCategory,
    message: string,
    retryable: boolean,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "BrowserProviderError";
    this.category = category;
    this.retryable = retryable;
    this.details = details;
  }
}

export type BrowserAction =
  | { type: "observe" }
  | { type: "navigate"; url: string }
  | { type: "click"; selector: string }
  | { type: "type"; selector: string; text: string }
  | {
      type: "upload";
      selector: string;
      fileName: string;
      mimeType: string;
      content: string;
    };
