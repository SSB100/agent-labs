export const BROWSER_PROVIDER_KEYS = ["steel", "browserbase"] as const;

export type BrowserProviderKey = (typeof BROWSER_PROVIDER_KEYS)[number];

export const BROWSER_PROVIDER_FAILURE_CATEGORIES = [
  "configuration_required",
  "authentication_required",
  "provider_rejected",
  "provider_timeout",
  "provider_unavailable",
  "malformed_provider_response",
  "playwright_connection_failed",
  "playwright_verification_failed",
  "replay_unavailable",
] as const;

export type BrowserProviderFailureCategory =
  (typeof BROWSER_PROVIDER_FAILURE_CATEGORIES)[number];

export type BrowserProviderCapabilities = {
  liveEmbed: boolean;
  persistentSessions: boolean;
  humanTakeover: boolean;
  replay: boolean;
  playwright: boolean;
  uploads: boolean;
  isolatedSessions: boolean;
  selfHostable: boolean;
};

export type BrowserProviderPricing = {
  plan: string;
  monthlyUsd: number;
  browserHourUsd: number;
  includedBrowserHours: number;
  maxSessionMinutes: number;
  retentionDays: number;
  notes: string[];
};

export type BrowserProviderDefinition = {
  key: BrowserProviderKey;
  displayName: string;
  status: "selected" | "alternative";
  baseUrl: string;
  capabilities: BrowserProviderCapabilities;
  pricing: BrowserProviderPricing;
  documentationUrl: string;
};

export type BrowserSessionLaunchOptions = {
  timeoutMs: number;
  inactivityTimeoutMs?: number | null;
  persistent: boolean;
  providerProfileId?: string | null;
  region?: string | null;
  metadata?: Record<string, unknown>;
};

export type BrowserSessionHandle = {
  provider: BrowserProviderKey;
  providerSessionId: string;
  connectUrl: string;
  liveViewUrl: string;
  interactiveViewUrl: string;
  sessionViewerUrl: string | null;
  providerProfileId: string | null;
  expiresAt: string | null;
  raw: Record<string, unknown>;
};

export type BrowserReplay = {
  available: boolean;
  url: string | null;
  status: "ready" | "processing" | "unavailable";
  raw: Record<string, unknown>;
};

export type BrowserProviderConfiguration = {
  apiKey: string;
  baseUrl: string;
  projectId?: string | null;
};

export interface BrowserProviderAdapter {
  readonly provider: BrowserProviderKey;
  createSession(options: BrowserSessionLaunchOptions): Promise<BrowserSessionHandle>;
  releaseSession(providerSessionId: string): Promise<void>;
  getReplay(providerSessionId: string): Promise<BrowserReplay>;
}

export type BrowserVerificationResult = {
  title: string;
  currentUrl: string;
  uploadVerified: boolean;
  marker: string;
};

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
