import type {
  BrowserProviderAdapter,
  BrowserProviderSession,
  BrowserSessionCreateRequest,
} from "../types";
import { BrowserProviderError } from "../types";

const DEFAULT_BASE_URL = "https://api.steel.dev";
const DEFAULT_TIMEOUT_MS = 15_000;
const SUPPORTED_REGION = "us-east";

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function parseJsonRecord(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringValue(record: Record<string, unknown>, key: string) {
  return typeof record[key] === "string" ? (record[key] as string) : null;
}

function statusCategory(status: number) {
  if (status === 401 || status === 403) return "authentication_required" as const;
  if (status === 404) return "session_not_found" as const;
  if (status === 429) return "rate_limited" as const;
  if (status >= 500) return "provider_unavailable" as const;
  return "provider_rejected" as const;
}

export function isSteelConfigured() {
  return Boolean(process.env.STEEL_API_KEY?.trim());
}

export type SteelConfig = {
  apiKey: string;
  baseUrl: string;
  region: string;
};

export function getSteelConfig(): SteelConfig {
  const apiKey = process.env.STEEL_API_KEY?.trim();
  if (!apiKey) {
    throw new BrowserProviderError(
      "configuration_required",
      "STEEL_API_KEY is not configured.",
      false,
    );
  }

  const region = process.env.STEEL_REGION?.trim() || SUPPORTED_REGION;
  if (region !== SUPPORTED_REGION) {
    throw new BrowserProviderError(
      "configuration_required",
      `Steel managed sessions currently support only ${SUPPORTED_REGION}.`,
      false,
      { configuredRegion: region, supportedRegion: SUPPORTED_REGION },
    );
  }

  return {
    apiKey,
    baseUrl: trimTrailingSlash(
      process.env.STEEL_API_BASE_URL?.trim() || DEFAULT_BASE_URL,
    ),
    region,
  };
}

export class SteelBrowserAdapter implements BrowserProviderAdapter {
  readonly providerKey = "steel" as const;
  readonly configured = isSteelConfigured();
  private readonly config: SteelConfig;

  constructor(config?: SteelConfig) {
    this.config = config ?? getSteelConfig();
  }

  private async request(
    pathOrUrl: string,
    init: RequestInit = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const url = pathOrUrl.startsWith("http")
      ? pathOrUrl
      : `${this.config.baseUrl}${pathOrUrl}`;

    try {
      const response = await fetch(url, {
        ...init,
        cache: "no-store",
        headers: {
          "steel-api-key": this.config.apiKey,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        const category = statusCategory(response.status);
        throw new BrowserProviderError(
          category,
          `Steel request failed with HTTP ${response.status}.`,
          category === "rate_limited" || category === "provider_unavailable",
          { response: text.slice(0, 500), status: response.status },
        );
      }

      return response;
    } catch (error) {
      if (error instanceof BrowserProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new BrowserProviderError(
          "provider_timeout",
          `Steel did not respond within ${timeoutMs}ms.`,
          true,
        );
      }
      throw new BrowserProviderError(
        "provider_unavailable",
        error instanceof Error ? error.message : "Steel request failed.",
        true,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private toSession(record: Record<string, unknown>): BrowserProviderSession {
    const providerSessionId = stringValue(record, "id");
    const debugUrl = stringValue(record, "debugUrl");
    const websocketUrl = stringValue(record, "websocketUrl");
    if (!providerSessionId || !debugUrl || !websocketUrl) {
      throw new BrowserProviderError(
        "provider_rejected",
        "Steel returned an incomplete session response.",
        false,
        { keys: Object.keys(record) },
      );
    }

    const status = stringValue(record, "status");
    const normalizedStatus =
      status === "released" || status === "failed" ? status : "live";
    const separator = websocketUrl.includes("?") ? "&" : "?";

    return {
      providerKey: "steel",
      providerSessionId,
      debugUrl,
      sessionViewerUrl: stringValue(record, "sessionViewerUrl"),
      automationEndpoint: `${websocketUrl}${separator}apiKey=${encodeURIComponent(this.config.apiKey)}`,
      profileId: stringValue(record, "profileId"),
      status: normalizedStatus,
      region: stringValue(record, "region") ?? this.config.region,
      browserMode: stringValue(record, "browserMode"),
    };
  }

  async createSession(
    request: BrowserSessionCreateRequest,
  ): Promise<BrowserProviderSession> {
    const profileId = request.profileId?.startsWith("pending:")
      ? undefined
      : request.profileId ?? undefined;
    const response = await this.request(
      "/v1/sessions",
      {
        method: "POST",
        body: JSON.stringify({
          debugConfig: {
            interactive: true,
            systemCursor: true,
          },
          deviceConfig: { device: "desktop" },
          dimensions: { width: 1440, height: 900 },
          headless: false,
          inactivityTimeout: Math.min(request.timeoutMs - 30_000, 600_000),
          persistProfile: true,
          profileId,
          region: this.config.region,
          sessionId: request.browserSessionId,
          timeout: request.timeoutMs,
        }),
      },
      45_000,
    );

    return this.toSession(parseJsonRecord(await response.text()));
  }

  async retrieveSession(providerSessionId: string) {
    const response = await this.request(
      `/v1/sessions/${encodeURIComponent(providerSessionId)}`,
    );
    return this.toSession(parseJsonRecord(await response.text()));
  }

  async releaseSession(providerSessionId: string) {
    await this.request(
      `/v1/sessions/${encodeURIComponent(providerSessionId)}/release`,
      { method: "POST" },
      30_000,
    );
  }

  async fetchReplay(providerSessionId: string, resourceUrl?: string) {
    return this.request(
      resourceUrl ??
        `${this.config.baseUrl}/v1/sessions/${encodeURIComponent(providerSessionId)}/hls`,
      {},
      30_000,
    );
  }
}
