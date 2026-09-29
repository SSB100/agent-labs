import {
  appendQuery,
  classifyHttpFailure,
  firstText,
  providerMessage,
  responsePayload,
} from "./http";
import type {
  BrowserProviderAdapter,
  BrowserProviderConfiguration,
  BrowserReplay,
  BrowserSessionHandle,
  BrowserSessionLaunchOptions,
} from "./types";
import { BrowserProviderError } from "./types";

const REQUEST_TIMEOUT_MS = 20_000;

export function getSteelConfiguration(): BrowserProviderConfiguration {
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
    baseUrl:
      process.env.STEEL_API_BASE_URL?.trim().replace(/\/$/, "") ||
      "https://api.steel.dev/v1",
  };
}

export class SteelBrowserAdapter implements BrowserProviderAdapter {
  readonly provider = "steel" as const;
  private readonly config: BrowserProviderConfiguration;
  private readonly fetcher: typeof fetch;

  constructor(options?: {
    config?: BrowserProviderConfiguration;
    fetcher?: typeof fetch;
  }) {
    this.config = options?.config ?? getSteelConfiguration();
    this.fetcher = options?.fetcher ?? fetch;
  }

  private headers() {
    return {
      "Content-Type": "application/json",
      "steel-api-key": this.config.apiKey,
    };
  }

  private async request(path: string, init: RequestInit) {
    const response = await this.fetcher(`${this.config.baseUrl}${path}`, {
      ...init,
      cache: "no-store",
      headers: { ...this.headers(), ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload = await responsePayload(response);
    if (!response.ok) {
      throw classifyHttpFailure(
        response.status,
        providerMessage(payload, `Steel request failed with ${response.status}.`),
      );
    }
    return payload;
  }

  async createSession(
    options: BrowserSessionLaunchOptions,
  ): Promise<BrowserSessionHandle> {
    const payload = await this.request("/sessions", {
      method: "POST",
      body: JSON.stringify({
        timeout: options.timeoutMs,
        ...(typeof options.inactivityTimeoutMs === "number"
          ? { inactivityTimeout: options.inactivityTimeoutMs }
          : {}),
        persistProfile: options.persistent,
        ...(options.providerProfileId
          ? { profileId: options.providerProfileId }
          : {}),
        debugConfig: { interactive: true },
        metadata: options.metadata ?? {},
      }),
    });

    const providerSessionId = firstText(payload, "id", "sessionId");
    const websocketUrl = firstText(
      payload,
      "websocketUrl",
      "connectUrl",
      "websocket_url",
    );
    const liveViewUrl = firstText(
      payload,
      "debugUrl",
      "liveViewUrl",
      "debug_url",
    );

    if (!providerSessionId || !websocketUrl || !liveViewUrl) {
      throw new BrowserProviderError(
        "malformed_provider_response",
        "Steel did not return the required session identity, CDP URL, and live view URL.",
        false,
        { returnedKeys: Object.keys(payload) },
      );
    }

    const sessionViewerUrl = firstText(
      payload,
      "sessionViewerUrl",
      "session_viewer_url",
    );
    const expiresAt = firstText(payload, "expiresAt", "expires_at");
    const providerProfileId = firstText(payload, "profileId", "profile_id");

    return {
      provider: this.provider,
      providerSessionId,
      connectUrl: appendQuery(websocketUrl, "apiKey", this.config.apiKey),
      liveViewUrl,
      interactiveViewUrl: appendQuery(liveViewUrl, "interactive", "true"),
      sessionViewerUrl,
      providerProfileId,
      expiresAt,
      raw: payload,
    };
  }

  async releaseSession(providerSessionId: string) {
    await this.request(
      `/sessions/${encodeURIComponent(providerSessionId)}/release`,
      { method: "POST", body: "{}" },
    );
  }

  async getReplay(providerSessionId: string): Promise<BrowserReplay> {
    const response = await this.fetcher(
      `${this.config.baseUrl}/sessions/${encodeURIComponent(providerSessionId)}/hls`,
      {
        method: "GET",
        cache: "no-store",
        headers: this.headers(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );

    if (response.status === 404 || response.status === 409 || response.status === 425) {
      return { available: false, url: null, status: "processing", raw: {} };
    }

    const playlist = await response.text();
    if (!response.ok) {
      let payload: Record<string, unknown> = {};
      try {
        const parsed: unknown = playlist ? JSON.parse(playlist) : {};
        payload = parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
      } catch {
        payload = { message: playlist.slice(0, 500) };
      }
      throw classifyHttpFailure(
        response.status,
        providerMessage(payload, "Steel replay lookup failed."),
      );
    }

    return {
      available: playlist.includes("#EXTM3U"),
      url: null,
      status: playlist.includes("#EXTM3U") ? "ready" : "processing",
      raw: { playlistLength: playlist.length },
    };
  }
}
