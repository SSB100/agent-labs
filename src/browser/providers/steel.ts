import type {
  BrowserProviderAdapter,
  BrowserProviderSession,
  BrowserSessionCreateRequest,
} from "../types";
import { BrowserProviderError } from "../types";
import { requireTransportAdmission, type TransportAdmission } from "../../core/transport-admission";

const DEFAULT_BASE_URL = "https://api.steel.dev";
const DEFAULT_TIMEOUT_MS = 15_000;

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
  region?: string | null;
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

  return {
    apiKey,
    baseUrl: trimTrailingSlash(
      process.env.STEEL_API_BASE_URL?.trim() || DEFAULT_BASE_URL,
    ),
    region: process.env.STEEL_REGION?.trim() || null,
  };
}

export class SteelBrowserAdapter implements BrowserProviderAdapter {
  readonly providerKey = "steel" as const;
  readonly configured = isSteelConfigured();
  private readonly config: SteelConfig;
  private readonly fetcher: typeof fetch;
  private readonly admitDispatch?: TransportAdmission;

  constructor(options?: {
    config?: SteelConfig;
    fetcher?: typeof fetch;
    admitDispatch?: TransportAdmission;
  }) {
    this.config = options?.config ?? getSteelConfig();
    this.fetcher = options?.fetcher ?? fetch;
    this.admitDispatch = options?.admitDispatch;
  }

  private async request(
    pathOrUrl: string,
    init: RequestInit = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    releaseExistingSession = false,
    beforeDispatch?: () => void,
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const address = pathOrUrl.startsWith("http")
      ? pathOrUrl
      : `${this.config.baseUrl}${pathOrUrl}`;
    const target = new URL(address);
    const providerOrigin = new URL(this.config.baseUrl).origin;
    const providerAuthenticated = target.origin === providerOrigin;

    try {
      // Release remains possible after pause, to stop an already-incurred lease.
      if (!releaseExistingSession) {
        try { await requireTransportAdmission(this.admitDispatch, { provider: "steel", operation: "browser.session", method: init.method ?? "GET", endpoint: target.origin + target.pathname }); }
        catch { throw new BrowserProviderError("configuration_required", "Operating policy admission is required for this browser operation.", false); }
      }
      if (controller.signal.aborted) throw new BrowserProviderError("provider_timeout", "Browser admission expired before dispatch.", false);
      beforeDispatch?.();
      const response = await this.fetcher(target, {
        ...init,
        cache: "no-store",
        headers: {
          ...(providerAuthenticated
            ? { "steel-api-key": this.config.apiKey }
            : {}),
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
      releaseReason: stringValue(record, "releaseReason"),
      region: stringValue(record, "region") ?? this.config.region ?? null,
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
          persistProfile: true,
          profileId,
          ...(this.config.region ? { region: this.config.region } : {}),
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

  /** R10 has a separate one-shot authority and never uses an existing profile.
   * Native viewer controls are not the security boundary: only our confined
   * fresh context's screenshots are delivered to the owner. */
  async createViewerSession(timeoutMs: number, beforeDispatch: () => void): Promise<BrowserProviderSession> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 15_000 || timeoutMs > 120_000) {
      throw new BrowserProviderError("provider_rejected", "Invalid bounded viewer lifetime.", false);
    }
    const response = await this.request("/v1/sessions", {
      method: "POST",
      redirect: "error",
      body: JSON.stringify({
        debugConfig: { interactive: false, systemCursor: false },
        persistProfile: false,
        useProxy: false,
        solveCaptcha: false,
        timeout: timeoutMs,
        ...(this.config.region ? { region: this.config.region } : {}),
      }),
    }, 45_000, false, beforeDispatch);
    const record = parseJsonRecord(await response.text()), id = stringValue(record, "id");
    if (!id || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) {
      throw new BrowserProviderError("provider_rejected", "Invalid viewer session identity.", false);
    }
    // The official exact-session CDP origin is fixed. Never append credentials
    // to a provider-returned URL or omit sessionId (which could create a session).
    const endpoint = new URL("wss://connect.steel.dev/");
    endpoint.searchParams.set("apiKey", this.config.apiKey); endpoint.searchParams.set("sessionId", id);
    return { providerKey: "steel", providerSessionId: id, automationEndpoint: endpoint.href,
      debugUrl: "", sessionViewerUrl: null, profileId: null, status: "live", releaseReason: null, region: null, browserMode: null };
  }

  async releaseViewerSession(providerSessionId: string) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(providerSessionId)) throw new Error("invalid_viewer_session");
    const response = await this.request(`/v1/sessions/${providerSessionId}/release`, { method: "POST", redirect: "error" }, 30_000, true);
    const result = parseJsonRecord(await response.text());
    if (result.success !== true) throw new Error("viewer_release_unconfirmed");
  }

  async releaseSession(providerSessionId: string) {
    try {
      await this.request(
        `/v1/sessions/${encodeURIComponent(providerSessionId)}/release`,
        { method: "POST" },
        30_000,
        true,
      );
    } catch (error) {
      if (
        error instanceof BrowserProviderError &&
        [404, 409].includes(Number(error.details.status ?? 0))
      ) {
        return;
      }
      throw error;
    }
  }

  async fetchReplay(
    providerSessionId: string,
    resourceUrl?: string,
    requestHeaders?: HeadersInit,
  ) {
    return this.request(
      resourceUrl ??
        `${this.config.baseUrl}/v1/sessions/${encodeURIComponent(providerSessionId)}/hls`,
      { headers: requestHeaders },
      30_000,
    );
  }
}
