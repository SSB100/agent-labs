import { randomUUID } from "node:crypto";
import { chromium, type Browser } from "playwright-core";
import { ACCOUNT_PROVIDERS, ACCOUNT_UUID, accountAssert, type AccountProvider } from "./contracts";
import type { RegistrationTransport } from "./registration";

/** Per-session recording/log opt-out works on every plan, but a disconnected
 * owner continuation needs keepAlive, which requires an ALREADY approved paid
 * entitlement. Nothing here creates/upgrades a plan or a persistent auth context.
 * https://docs.browserbase.com/account/enterprise/zero-data-retention
 * https://docs.browserbase.com/platform/browser/long-sessions/keep-alive
 * https://docs.browserbase.com/reference/api/session-live-urls
 * Operational metadata remains with the provider. This is not a blanket promise
 * of zero data retention, and live provider qualification is still required.
 */
export type AccountBrowserbaseConfig = {
  enabled: boolean;
  apiKey: string;
  projectId: string;
  budgetApproved: boolean;
  keepAliveEntitled: boolean;
};
export type AccountBrowserbaseHandoff = {
  handoffId: string;
  sessionId: string;
  viewerUrl: string;
  expiresAt: string;
};
type Dependencies = {
  config?: AccountBrowserbaseConfig;
  fetcher?: typeof fetch;
  connect?: typeof chromium.connectOverCDP;
  now?: () => number;
};
function configFromEnvironment(): AccountBrowserbaseConfig {
  return {
    enabled: process.env.ACCOUNTS_BROWSERBASE_ENABLED === "true",
    apiKey: process.env.BROWSERBASE_API_KEY?.trim() ?? "",
    projectId: process.env.BROWSERBASE_PROJECT_ID?.trim() ?? "",
    budgetApproved: process.env.ACCOUNTS_BROWSERBASE_BUDGET_APPROVED === "true",
    keepAliveEntitled: process.env.ACCOUNTS_BROWSERBASE_KEEPALIVE_ENTITLED === "true",
  };
}
export function getAccountBrowserbaseStatus(config = configFromEnvironment()) {
  let reasonCode = "account_browserbase_ready";
  if (!config.enabled) reasonCode = "account_browserbase_activation_required";
  else if (!config.apiKey || !ACCOUNT_UUID.test(config.projectId)) reasonCode = "account_browserbase_configuration_required";
  else if (!config.budgetApproved) reasonCode = "account_browserbase_budget_approval_required";
  else if (!config.keepAliveEntitled) reasonCode = "account_browserbase_paid_entitlement_required";
  return { available: reasonCode === "account_browserbase_ready", reasonCode, maxSessionSeconds: 900,
    recordSession: false, logSession: false, persistentContext: false, requiresPaidKeepAlive: true };
}
async function deadline<T>(operation: Promise<T>, onTimeout: () => void, milliseconds = 20_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { onTimeout(); reject(new Error("account_browserbase_timeout")); }, milliseconds);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
async function request(config: AccountBrowserbaseConfig, fetcher: typeof fetch, path: string, body?: Record<string, unknown>) {
  // Static internal paths only. Redirects are rejected before a credential can be forwarded.
  const controller = new AbortController();
  const response = await deadline(fetcher(`https://api.browserbase.com/v1${path}`, {
    method: body ? "POST" : "GET", redirect: "error", cache: "no-store", signal: controller.signal,
    headers: { "X-BB-API-Key": config.apiKey, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), () => controller.abort());
  accountAssert(!response.redirected, "account_browserbase_response_rejected");
  return response;
}
async function jsonBody(response: Response) {
  const maxBytes = 65_536;
  const declared = Number(response.headers.get("content-length"));
  accountAssert(!Number.isFinite(declared) || declared <= maxBytes, "account_browserbase_response_rejected");
  const reader = response.body?.getReader();
  accountAssert(reader, "account_browserbase_response_rejected");
  const read = async () => {
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      accountAssert(length <= maxBytes, "account_browserbase_response_rejected");
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  };
  try { return await deadline(read(), () => { void reader.cancel().catch(() => undefined); }); }
  catch { void reader.cancel().catch(() => undefined); throw new Error("account_browserbase_response_rejected"); }
  finally { try { reader.releaseLock(); } catch { /* A timed-out read is cancelled above. */ } }
}

function object(value: unknown) {
  accountAssert(value && typeof value === "object" && !Array.isArray(value), "account_browserbase_response_rejected");
  return value as Record<string, unknown>;
}
function providerUrl(value: unknown, kind: "connect" | "viewer") {
  accountAssert(typeof value === "string" && value.length < 16_384, "account_browserbase_endpoint_rejected");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("account_browserbase_endpoint_rejected"); }
  const hostAllowed = kind === "connect"
    ? /^connect(?:-[a-z0-9]+)?(?:\.[a-z0-9-]+)?\.browserbase\.com$/.test(url.hostname)
    : ["www.browserbase.com", "browserbase.com", "debug.browserbase.com"].includes(url.hostname);
  accountAssert(hostAllowed && url.protocol === (kind === "connect" ? "wss:" : "https:") &&
    !url.username && !url.password && !url.port, "account_browserbase_endpoint_rejected");
  return value;
}
/** Stop an already-authorized session even if activation/budget switches have
 * subsequently been turned off. The caller retrieves sessionId only by decrypting
 * its owner+Business-bound private handoff envelope, never from request JSON. */
export async function releaseAccountBrowserbaseSession(sessionId: string, dependencies: Dependencies = {}): Promise<void> {
  const config = dependencies.config ?? configFromEnvironment();
  accountAssert(ACCOUNT_UUID.test(sessionId) && Boolean(config.apiKey) && ACCOUNT_UUID.test(config.projectId), "account_browserbase_release_unconfirmed");
  try {
    const response = await request(config, dependencies.fetcher ?? fetch, `/sessions/${sessionId}`, {
      status: "REQUEST_RELEASE", projectId: config.projectId,
    });
    accountAssert(response.ok || response.status === 404, "account_browserbase_release_unconfirmed");
    if (response.status === 404) return;
    // Accepted release is not proof that the remote browser has closed.
    const readback = await request(config, dependencies.fetcher ?? fetch, `/sessions/${sessionId}`);
    if (readback.status === 404) return;
    accountAssert(readback.ok, "account_browserbase_release_unconfirmed");
    const state = object(await jsonBody(readback));
    accountAssert(state.id === sessionId && state.projectId === config.projectId &&
      ["COMPLETED", "ERROR", "TIMED_OUT"].includes(String(state.status)), "account_browserbase_release_unconfirmed");
  } catch { throw new Error("account_browserbase_release_unconfirmed"); }
}

/** Server-only factory. Dependencies/consent must come from trusted deployment
 * configuration and a reserved owner-approved run, never an HTTP-supplied object.
 * saveHandoff MUST encrypt viewerUrl/sessionId in the private account vault before
 * acknowledging. It must reject stale/cancelled runs and bind preparationId.
 */
export function createAccountBrowserbaseTransport(input: {
  businessId: string;
  provider: AccountProvider;
  approvalExpiresAt: string;
  saveHandoff(handoff: AccountBrowserbaseHandoff): Promise<void>;
}, dependencies: Dependencies = {}): RegistrationTransport | null {
  const config = { ...(dependencies.config ?? configFromEnvironment()) };
  if (!getAccountBrowserbaseStatus(config).available) return null;
  accountAssert(ACCOUNT_UUID.test(input.businessId) && (input.provider === "etsy" || input.provider === "printful"), "account_browserbase_binding_required");
  const now = dependencies.now ?? Date.now;
  const fetcher = dependencies.fetcher ?? fetch;
  const connect = dependencies.connect ?? chromium.connectOverCDP.bind(chromium);
  const provider = input.provider;
  const businessId = input.businessId;
  const approvalExpires = Date.parse(input.approvalExpiresAt);
  let opened = false;
  return {
    // Verified means the documented immutable opt-out is requested and creation
    // accepted, not that this code has passed a live provider qualification.
    safety: { recording: "disabled_verified", secretObservation: "disabled", persistentIdentityBound: { businessId, provider }, ownerSecureResume: true },
    async open(requestedProvider) {
      accountAssert(requestedProvider === provider && !opened, "account_browserbase_binding_required");
      // At most one paid creation per reserved transport. No blind network retries.
      opened = true;
      const started = now();
      const timeout = Math.min(900, Math.floor((approvalExpires - started) / 1000));
      accountAssert(Number.isFinite(timeout) && timeout >= 60, "account_approval_expired");
      let sessionId: string | null = null;
      let browser: Browser | null = null;
      let released = false;
      let handedOff = false;
      let handoffStarted = false;
      const close = async () => {
        if (released) return;
        try {
          if (sessionId) await releaseAccountBrowserbaseSession(sessionId, { config, fetcher });
          released = true;
        } finally {
          if (browser?.isConnected()) await browser.close().catch(() => undefined);
          browser = null;
        }
      };
      try {
        const response = await request(config, fetcher, "/sessions", {
          projectId: config.projectId, timeout, keepAlive: true, proxies: false,
          browserSettings: { recordSession: false, logSession: false, solveCaptchas: false,
            ignoreCertificateErrors: false, allowedDomains: [new URL(ACCOUNT_PROVIDERS[provider].destination).hostname] },
          // No profile/context, credential, owner name/email, or business metadata.
        });
        accountAssert(response.ok, "account_browserbase_create_failed");
        const data = object(await jsonBody(response));
        accountAssert(typeof data.id === "string" && ACCOUNT_UUID.test(data.id), "account_browserbase_response_rejected");
        sessionId = data.id;
        accountAssert(data.projectId === config.projectId && data.keepAlive === true && !data.contextId &&
          ["PENDING", "RUNNING"].includes(String(data.status)), "account_browserbase_response_rejected");
        const providerExpires = Date.parse(String(data.expiresAt));
        accountAssert(Number.isFinite(providerExpires) && providerExpires > now() && providerExpires <= started + timeout * 1000 + 10_000,
          "account_browserbase_response_rejected");
        const expires = Math.min(approvalExpires, started + timeout * 1000, providerExpires);
        browser = await connect(providerUrl(data.connectUrl, "connect"), { timeout: 20_000 });
        // The provider's endpoint is used only for this connection and never saved.
        delete data.connectUrl; delete data.signingKey; delete data.seleniumRemoteUrl;
        const context = browser.contexts()[0];
        accountAssert(context && context.pages().every(page => page.url() === "about:blank"), "account_browserbase_session_not_fresh");
        const page = context.pages()[0] ?? await context.newPage();
        const network = await context.newCDPSession(page);
        await network.send("Network.setBypassServiceWorker", { bypass: true });
        await network.detach();
        let locked = false;
        const approvedOrigin = ACCOUNT_PROVIDERS[provider].destination;
        await context.route("**/*", async route => {
          let url: URL;
          try { url = new URL(route.request().url()); } catch { await route.abort("blockedbyclient"); return; }
          // Main/subframe redirects cannot expand the exact approved origin. Once
          // data is filled, all cross-origin traffic, including analytics, stops.
          if (url.protocol !== "https:" || ((locked || route.request().isNavigationRequest()) && url.origin !== approvedOrigin)) {
            await route.abort("blockedbyclient");
          } else await route.continue();
        });
        return {
          page,
          async restrictToOrigin(origin) {
            accountAssert(origin === approvedOrigin && !handedOff, "account_registration_origin_rejected"); locked = true;
          },
          async handoff() {
            const connectedBrowser = browser;
            accountAssert(!handoffStarted && !handedOff && !released && connectedBrowser && connectedBrowser.isConnected(), "account_secure_handoff_unconfirmed");
            handoffStarted = true;
            const remainingSeconds = Math.floor((expires - now()) / 1000);
            accountAssert(remainingSeconds >= 60, "account_approval_expired");
            const debugResponse = await request(config, fetcher, `/sessions/${sessionId}/debug?expiresIn=${Math.min(900, remainingSeconds)}`);
            accountAssert(debugResponse.ok, "account_secure_handoff_unconfirmed");
            const debug = object(await jsonBody(debugResponse));
            const viewerUrl = providerUrl(debug.debuggerFullscreenUrl, "viewer");
            // No observer remains when the owner can enter a password. In-flight
            // route handlers are drained, then the agent's CDP channel disconnects.
            // The owner now controls the browser. The provider's allowedDomains
            // restriction remains for top-level navigation (including its documented
            // subdomain allowance); embedded third-party provider content still runs.
            // It cannot leave agent-side route handlers listening during secrets.
            await context.unrouteAll({ behavior: "wait" });
            await connectedBrowser.close();
            accountAssert(!connectedBrowser.isConnected(), "account_secure_handoff_unconfirmed");
            browser = null;
            const liveResponse = await request(config, fetcher, `/sessions/${sessionId}`);
            accountAssert(liveResponse.ok, "account_secure_handoff_unconfirmed");
            const live = object(await jsonBody(liveResponse));
            accountAssert(live.id === sessionId && live.projectId === config.projectId && live.status === "RUNNING" && live.keepAlive === true,
              "account_secure_handoff_unconfirmed");
            const handoffId = randomUUID();
            const expiresAt = new Date(expires).toISOString();
            await input.saveHandoff({ handoffId, sessionId: sessionId!, viewerUrl, expiresAt });
            handedOff = true;
            return { id: handoffId, expiresAt };
          },
          close,
        };
      } catch {
        await close().catch(() => undefined);
        // Provider/CDP messages can include secrets, URLs and values. Never forward.
        throw new Error("account_browserbase_preparation_unconfirmed");
      }
    },
  };
}
