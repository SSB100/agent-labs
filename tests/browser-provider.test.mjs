import assert from "node:assert/strict";
import test from "node:test";

import browserbaseModule from "../.core-tests/browser/browserbase.js";
import httpModule from "../.core-tests/browser/http.js";
import registryModule from "../.core-tests/browser/registry.js";
import serviceModule from "../.core-tests/browser/service.js";
import steelModule from "../.core-tests/browser/steel.js";

const { BrowserbaseAdapter } = browserbaseModule;
const { classifyHttpFailure } = httpModule;
const {
  BROWSER_PROVIDER_REGISTRY,
  DEFAULT_BROWSER_PROVIDER,
  getDefaultBrowserProviderKey,
} = registryModule;
const { estimateBrowserCostUsd } = serviceModule;
const { SteelBrowserAdapter } = steelModule;

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("Steel is selected while Browserbase remains a replaceable adapter", () => {
  assert.equal(DEFAULT_BROWSER_PROVIDER, "steel");
  assert.equal(getDefaultBrowserProviderKey(), "steel");
  assert.equal(BROWSER_PROVIDER_REGISTRY.steel.status, "selected");
  assert.equal(BROWSER_PROVIDER_REGISTRY.browserbase.status, "alternative");

  for (const key of ["steel", "browserbase"]) {
    const capabilities = BROWSER_PROVIDER_REGISTRY[key].capabilities;
    for (const required of [
      "liveEmbed",
      "persistentSessions",
      "humanTakeover",
      "replay",
      "playwright",
      "uploads",
      "isolatedSessions",
    ]) {
      assert.equal(capabilities[required], true, `${key} lacks ${required}`);
    }
  }

  assert.equal(BROWSER_PROVIDER_REGISTRY.steel.capabilities.selfHostable, true);
  assert.equal(BROWSER_PROVIDER_REGISTRY.browserbase.capabilities.selfHostable, false);
});

test("Steel adapter creates, releases and verifies a recorded session", async () => {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET" });
    if (String(url).endsWith("/sessions") && init.method === "POST") {
      return jsonResponse({
        id: "steel-session-1",
        websocketUrl: "wss://connect.steel.dev?sessionId=steel-session-1",
        debugUrl: "https://app.steel.dev/live/steel-session-1",
        sessionViewerUrl: "https://app.steel.dev/sessions/steel-session-1",
        profileId: "steel-profile-1",
      });
    }
    if (String(url).endsWith("/sessions/steel-session-1/release")) {
      return jsonResponse({ released: true });
    }
    if (String(url).endsWith("/sessions/steel-session-1/hls")) {
      return new Response("#EXTM3U\n#EXT-X-VERSION:3\n", { status: 200 });
    }
    return jsonResponse({ message: "unexpected" }, 404);
  };

  const adapter = new SteelBrowserAdapter({
    config: {
      apiKey: "steel-test-key",
      baseUrl: "https://api.steel.dev/v1",
    },
    fetcher,
  });
  const session = await adapter.createSession({
    timeoutMs: 900_000,
    persistent: true,
  });

  assert.equal(session.providerSessionId, "steel-session-1");
  assert.match(session.connectUrl, /apiKey=steel-test-key/);
  assert.equal(session.liveViewUrl, "https://app.steel.dev/live/steel-session-1");
  assert.equal(session.sessionViewerUrl, "https://app.steel.dev/sessions/steel-session-1");
  assert.equal(session.providerProfileId, "steel-profile-1");

  await adapter.releaseSession(session.providerSessionId);
  const replay = await adapter.getReplay(session.providerSessionId);
  assert.equal(replay.available, true);
  assert.equal(replay.status, "ready");
  assert.ok(calls.some((call) => call.url.endsWith("/release") && call.method === "POST"));
});

test("Browserbase implements the same provider-neutral session contract", async () => {
  const fetcher = async (url, init = {}) => {
    const address = String(url);
    if (address.endsWith("/sessions") && init.method === "POST") {
      return jsonResponse({
        id: "browserbase-session-1",
        connectUrl: "wss://connect.browserbase.com/session-1",
        context: { id: "browserbase-context-1" },
        sessionUrl: "https://www.browserbase.com/sessions/session-1",
      });
    }
    if (address.endsWith("/sessions/browserbase-session-1/debug")) {
      return jsonResponse({
        debuggerFullscreenUrl: "https://www.browserbase.com/debug/session-1",
      });
    }
    if (address.endsWith("/sessions/browserbase-session-1/replays")) {
      return jsonResponse({ pages: [{ hlsUrl: "https://replay.example/session-1.m3u8" }] });
    }
    if (address.endsWith("/sessions/browserbase-session-1") && init.method === "POST") {
      return jsonResponse({ status: "RELEASED" });
    }
    return jsonResponse({ message: "unexpected" }, 404);
  };

  const adapter = new BrowserbaseAdapter({
    config: {
      apiKey: "browserbase-test-key",
      baseUrl: "https://api.browserbase.com/v1",
      projectId: "project-1",
    },
    fetcher,
  });
  const session = await adapter.createSession({
    timeoutMs: 900_000,
    persistent: true,
  });

  assert.equal(session.provider, "browserbase");
  assert.equal(session.providerSessionId, "browserbase-session-1");
  assert.equal(session.providerProfileId, "browserbase-context-1");
  assert.equal(session.liveViewUrl, "https://www.browserbase.com/debug/session-1");

  await adapter.releaseSession(session.providerSessionId);
  const replay = await adapter.getReplay(session.providerSessionId);
  assert.equal(replay.available, true);
  assert.equal(replay.url, "https://replay.example/session-1.m3u8");
});

test("provider failures and usage cost remain deterministic", () => {
  const unauthorized = classifyHttpFailure(401, "unauthorized");
  const unavailable = classifyHttpFailure(503, "down");
  const rejected = classifyHttpFailure(400, "bad request");

  assert.equal(unauthorized.category, "authentication_required");
  assert.equal(unauthorized.retryable, false);
  assert.equal(unavailable.category, "provider_unavailable");
  assert.equal(unavailable.retryable, true);
  assert.equal(rejected.category, "provider_rejected");
  assert.equal(rejected.retryable, false);

  assert.equal(estimateBrowserCostUsd("steel", 3_600_000), 0.1);
  assert.equal(estimateBrowserCostUsd("browserbase", 1_800_000), 0.06);
});
