import {
  classifyHttpFailure,
  firstText,
  providerMessage,
  record,
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

export function getBrowserbaseConfiguration(): BrowserProviderConfiguration {
  const apiKey = process.env.BROWSERBASE_API_KEY?.trim();
  if (!apiKey) {
    throw new BrowserProviderError(
      "configuration_required",
      "BROWSERBASE_API_KEY is not configured.",
      false,
    );
  }
  return {
    apiKey,
    projectId: process.env.BROWSERBASE_PROJECT_ID?.trim() || null,
    baseUrl:
      process.env.BROWSERBASE_API_BASE_URL?.trim().replace(/\/$/, "") ||
      "https://api.browserbase.com/v1",
  };
}

export class BrowserbaseAdapter implements BrowserProviderAdapter {
  readonly provider = "browserbase" as const;
  private readonly config: BrowserProviderConfiguration;
  private readonly fetcher: typeof fetch;

  constructor(options?: {
    config?: BrowserProviderConfiguration;
    fetcher?: typeof fetch;
  }) {
    this.config = options?.config ?? getBrowserbaseConfiguration();
    this.fetcher = options?.fetcher ?? fetch;
  }

  private headers() {
    return {
      "Content-Type": "application/json",
      "X-BB-API-Key": this.config.apiKey,
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
        providerMessage(
          payload,
          `Browserbase request failed with ${response.status}.`,
        ),
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
        ...(this.config.projectId ? { projectId: this.config.projectId } : {}),
        timeout: Math.max(60, Math.round(options.timeoutMs / 1000)),
        keepAlive: true,
        ...(options.providerProfileId
          ? { browserSettings: { context: { id: options.providerProfileId } } }
          : {}),
        ...(options.region ? { region: options.region } : {}),
      }),
    });

    const providerSessionId = firstText(payload, "id", "sessionId");
    const connectUrl = firstText(payload, "connectUrl", "connect_url");
    if (!providerSessionId || !connectUrl) {
      throw new BrowserProviderError(
        "malformed_provider_response",
        "Browserbase did not return the required session ID and connect URL.",
        false,
        { returnedKeys: Object.keys(payload) },
      );
    }

    const debug = await this.request(
      `/sessions/${encodeURIComponent(providerSessionId)}/debug`,
      { method: "GET" },
    );
    const liveViewUrl = firstText(
      debug,
      "debuggerFullscreenUrl",
      "debuggerUrl",
      "liveViewUrl",
    );
    if (!liveViewUrl) {
      throw new BrowserProviderError(
        "malformed_provider_response",
        "Browserbase did not return a live debugger URL.",
        false,
        { returnedKeys: Object.keys(debug) },
      );
    }

    const context = record(payload.context);
    return {
      provider: this.provider,
      providerSessionId,
      connectUrl,
      liveViewUrl,
      interactiveViewUrl: liveViewUrl,
      sessionViewerUrl:
        firstText(payload, "sessionUrl", "sessionViewerUrl") ?? liveViewUrl,
      providerProfileId:
        firstText(context, "id") ?? firstText(payload, "contextId"),
      expiresAt: firstText(payload, "expiresAt", "expires_at"),
      raw: { ...payload, debug },
    };
  }

  async releaseSession(providerSessionId: string) {
    await this.request(`/sessions/${encodeURIComponent(providerSessionId)}`, {
      method: "POST",
      body: JSON.stringify({ status: "REQUEST_RELEASE" }),
    });
  }

  async getReplay(providerSessionId: string): Promise<BrowserReplay> {
    const payload = await this.request(
      `/sessions/${encodeURIComponent(providerSessionId)}/replays`,
      { method: "GET" },
    );
    const pages = Array.isArray(payload.pages) ? payload.pages : [];
    const first = pages.length ? record(pages[0]) : {};
    const url =
      firstText(first, "hlsUrl", "url", "replayUrl") ??
      firstText(payload, "hlsUrl", "url", "replayUrl");

    return {
      available: Boolean(url),
      url,
      status: url ? "ready" : pages.length ? "processing" : "unavailable",
      raw: payload,
    };
  }
}
