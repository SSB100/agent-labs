import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import automationModule from "../.core-tests/browser/automation.js";
import steelModule from "../.core-tests/browser/providers/steel.js";
import registryModule from "../.core-tests/browser/registry.js";
import replayModule from "../.core-tests/browser/replay.js";
import typesModule from "../.core-tests/browser/types.js";

const read = (path) => readFileSync(path, "utf8");
const { validateBrowserAction } = automationModule;
const { SteelBrowserAdapter } = steelModule;
const {
  BROWSER_PROVIDER_COMPARISON,
  DEFAULT_BROWSER_PROVIDER_KEY,
} = registryModule;
const { rewriteHlsManifest } = replayModule;
const { BrowserProviderError } = typesModule;

test("Stage 8 selects Steel while retaining a replaceable Browserbase adapter", () => {
  assert.equal(DEFAULT_BROWSER_PROVIDER_KEY, "steel");
  assert.equal(BROWSER_PROVIDER_COMPARISON.steel.selected, true);
  assert.equal(BROWSER_PROVIDER_COMPARISON.steel.selfHostable, true);
  assert.equal(BROWSER_PROVIDER_COMPARISON.browserbase.selected, false);
  assert.equal(BROWSER_PROVIDER_COMPARISON.browserbase.playwright, true);
  assert.equal(BROWSER_PROVIDER_COMPARISON.browserbase.uploads, true);

  const browserbase = read("src/browser/providers/browserbase.ts");
  assert.match(browserbase, /implements BrowserProviderAdapter/);
  assert.match(browserbase, /providerKey = "browserbase"/);
});

test("browser actions are denied unless the Task Contract exposes the exact capability", () => {
  assert.doesNotThrow(() =>
    validateBrowserAction(
      { type: "observe" },
      ["browser.observe"],
    ),
  );
  assert.doesNotThrow(() =>
    validateBrowserAction(
      { type: "upload", selector: "#file", fileName: "proof.txt", mimeType: "text/plain", content: "proof" },
      ["browser.upload"],
    ),
  );

  assert.throws(
    () => validateBrowserAction({ type: "click", selector: "button" }, ["browser.observe"]),
    (error) =>
      error instanceof BrowserProviderError &&
      error.category === "automation_failed" &&
      error.details.requiredCapability === "browser.interact",
  );
  assert.throws(
    () => validateBrowserAction({ type: "navigate", url: "file:///etc/passwd" }, ["browser.interact"]),
    /limited to HTTP and HTTPS/,
  );
});

test("Steel authentication is never forwarded to external replay resources", async () => {
  const calls = [];
  const fetcher = async (input, init = {}) => {
    calls.push({
      headers: new Headers(init.headers),
      url: String(input),
    });
    return new Response("#EXTM3U\n#EXT-X-VERSION:3\n", {
      status: 200,
      headers: { "content-type": "application/vnd.apple.mpegurl" },
    });
  };
  const adapter = new SteelBrowserAdapter({
    config: {
      apiKey: "steel-secret-test-key",
      baseUrl: "https://api.steel.dev",
      region: "us-east",
    },
    fetcher,
  });

  await adapter.fetchReplay(
    "steel-session-1",
    "https://recordings.example.test/session/segment.m3u8",
  );
  await adapter.fetchReplay("steel-session-1");

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://recordings.example.test/session/segment.m3u8");
  assert.equal(calls[0].headers.has("steel-api-key"), false);
  assert.equal(calls[1].url, "https://api.steel.dev/v1/sessions/steel-session-1/hls");
  assert.equal(calls[1].headers.get("steel-api-key"), "steel-secret-test-key");
});

test("every HLS segment, key and initialization URI is rewritten through the owner proxy", () => {
  const manifest = [
    "#EXTM3U",
    '#EXT-X-MAP:URI="init.mp4"',
    '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin"',
    "segments/part-1.m4s",
    "",
  ].join("\n");
  const rewritten = rewriteHlsManifest(
    manifest,
    "https://recordings.example.test/session/master.m3u8",
    (resource) => `https://agent-labs.test/replay?resource=${encodeURIComponent(resource)}`,
  );

  assert.match(
    rewritten,
    /URI="https:\/\/agent-labs\.test\/replay\?resource=https%3A%2F%2Frecordings\.example\.test%2Fsession%2Finit\.mp4"/,
  );
  assert.match(
    rewritten,
    /URI="https:\/\/agent-labs\.test\/replay\?resource=https%3A%2F%2Frecordings\.example\.test%2Fsession%2Fkeys%2Fkey\.bin"/,
  );
  assert.match(
    rewritten,
    /https:\/\/agent-labs\.test\/replay\?resource=https%3A%2F%2Frecordings\.example\.test%2Fsession%2Fsegments%2Fpart-1\.m4s/,
  );
  assert.doesNotMatch(rewritten, /URI="init\.mp4"|URI="keys\/key\.bin"|^segments\/part-1\.m4s$/m);
});

test("Stage 8 stores provider URLs privately and keeps exposed browser records owner-scoped", () => {
  const foundation = read(
    "supabase/migrations/20260929194317_stage8_browser_provider_foundation.sql",
  );

  for (const table of [
    "browser_provider_definitions",
    "browser_identities",
    "browser_sessions",
    "browser_session_events",
  ]) {
    assert.match(foundation, new RegExp(`create table public\\.${table}`));
    assert.match(
      foundation,
      new RegExp(`alter table public\\.${table} enable row level security`),
    );
  }

  assert.match(foundation, /create table private\.browser_session_secrets/);
  assert.match(foundation, /revoke all on table private\.browser_session_secrets/);
  assert.match(foundation, /browser_sessions_owner_read/);
  assert.match(foundation, /browser_identities_owner_read/);
  assert.match(foundation, /browser_session_events_owner_read/);
  assert.doesNotMatch(foundation, /NEXT_PUBLIC_STEEL|NEXT_PUBLIC_BROWSERBASE/);
});

test("Stage 8 workflow proves launch, live view, takeover, return control and replay", () => {
  const runtime = read("src/workflows/browser-provider-runtime.ts");
  const steps = read("src/workflows/browser-provider-runtime-steps.ts");
  const workspace = read("src/components/stage7/workflow-workspace.tsx");
  const migration = read(
    "supabase/migrations/20260929194440_stage8_browser_workflow_runtime.sql",
  );

  assert.match(runtime, /"use workflow"/);
  assert.match(runtime, /browserTakeControlHookToken/);
  assert.match(runtime, /browserReturnControlHookToken/);
  assert.match(runtime, /launchAndObserveBrowser/);
  assert.match(runtime, /verifyBrowserAutomationReturned/);
  assert.match(runtime, /releaseBrowserProviderSession/);
  assert.match(runtime, /inspectBrowserReplay/);
  assert.match(runtime, /sleep\("5s"\)/);
  assert.match(runtime, /completeQualifiedBrowser/);
  assert.match(steps, /"use step"/);
  assert.match(steps, /stage8_browser_runtime_transition/);
  assert.match(steps, /replay_unavailable/);
  assert.match(workspace, /Live Browser/);
  assert.match(workspace, /Take Control/);
  assert.match(workspace, /Return Control/);
  assert.match(workspace, /BrowserReplay/);

  for (const stage of [
    "reserve",
    "launch",
    "observe",
    "take-control",
    "return-control",
    "verify",
    "replay",
    "complete",
  ]) {
    assert.match(migration, new RegExp(`'${stage}'`));
  }
  assert.match(migration, /get_browser_session_live_view/);
  assert.match(migration, /stage8_browser_runtime_transition/);
  assert.match(migration, /liveQualified/);
});

test("Stage 8 qualifies Playwright, upload, persistent identity, isolation and replay without Stage 9", () => {
  const steel = read("src/browser/providers/steel.ts");
  const automation = read("src/browser/automation.ts");
  const nextConfig = read("next.config.ts");
  const replayManifest = read(
    "src/app/api/browser/sessions/[browserSessionId]/replay/manifest/route.ts",
  );
  const env = read(".env.example");

  assert.match(steel, /persistProfile: true/);
  assert.match(steel, /profileId/);
  assert.match(steel, /debugConfig/);
  assert.match(steel, /SUPPORTED_REGION = "us-east"/);
  assert.match(steel, /providerAuthenticated/);
  assert.match(steel, /\/hls/);
  assert.match(automation, /connectOverCDP/);
  assert.match(automation, /setInputFiles/);
  assert.match(automation, /stage8-browser-proof\.txt/);
  assert.match(automation, /await disconnect\(browser\)/);
  assert.match(nextConfig, /serverExternalPackages: \["playwright-core"\]/);
  assert.match(nextConfig, /node_modules\/playwright-core\/\*\*\/\*/);
  assert.match(replayManifest, /rewriteReplayManifest/);
  assert.match(env, /STEEL_API_KEY/);
  assert.match(env, /STEEL_REGION=us-east/);
  assert.doesNotMatch(env, /NEXT_PUBLIC_STEEL_API_KEY/);

  assert.equal(existsSync("docs/checkpoints/STAGE_9_CREDENTIAL_VAULT.md"), false);
  assert.equal(existsSync("src/credentials/vault.ts"), false);
});
