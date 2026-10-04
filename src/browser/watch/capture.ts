import { randomUUID } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { CaptureSetupFailure, WATCH_CSP, WATCH_HTML, WATCH_MAX_FRAME_BYTES, WATCH_SOURCE_URL, type WatchCapture } from "./contracts";

/** Only this constructor can establish the producer's eligibility. No saved
 * live/status/URL/fixture metadata is consumed. Every pixel comes from the
 * newly created, nonpersistent, network-confined context below. */
export async function createControlledCapture(browser: Browser, invalidate: () => void): Promise<WatchCapture> {
  let context: BrowserContext | undefined, page: Page | undefined;
  let suspended = false, ready = false, preparing = true, disposing = false, admittedDocument = false;
  const contextId = randomUUID(), pageId = randomUUID();
  const suspend = () => { suspended = true; ready = false; };
  const fail = () => { suspend(); if (!disposing) invalidate(); };
  try {
    context = await browser.newContext({
      acceptDownloads: false, javaScriptEnabled: false, serviceWorkers: "block",
      permissions: [], viewport: { width: 960, height: 540 }, colorScheme: "light", locale: "en-US",
    });
    await context.routeWebSocket("**/*", socket => { fail(); socket.close(); });
    await context.route("**/*", async route => {
      const request = route.request();
      if (!suspended && preparing && !admittedDocument && page && request.url() === WATCH_SOURCE_URL &&
          request.method() === "GET" && request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        admittedDocument = true;
        await route.fulfill({ status: 200, body: WATCH_HTML, headers: {
          "content-type": "text/html; charset=utf-8", "content-security-policy": WATCH_CSP,
          "cache-control": "no-store", "referrer-policy": "no-referrer",
        } });
      } else {
        fail(); await route.abort("blockedbyclient").catch(() => undefined);
      }
    });
    context.on("page", candidate => { if (!preparing || page && candidate !== page) fail(); });
    context.on("close", fail);
    browser.on("disconnected", fail);
    page = await context.newPage();
    page.on("popup", fail); page.on("download", fail); page.on("dialog", fail);
    page.on("crash", fail); page.on("close", fail); page.on("frameattached", fail);
    page.on("framenavigated", frame => {
      if (!preparing || frame !== page?.mainFrame() || frame.url() !== WATCH_SOURCE_URL) fail();
    });
    await page.goto(WATCH_SOURCE_URL, { waitUntil: "load", timeout: 15_000 });
    preparing = false;
    if (suspended || !admittedDocument || page.url() !== WATCH_SOURCE_URL || context.pages().length !== 1 ||
        page.frames().length !== 1 || (await context.cookies()).length !== 0) throw new Error("capture_confinement_unavailable");
    ready = true;
    const eligible = () => Boolean(ready && !suspended && page && !page.isClosed() && browser.isConnected() &&
      page.url() === WATCH_SOURCE_URL && context?.pages().length === 1 && context.pages()[0] === page && page.frames().length === 1);
    return {
      contextId, pageId, eligible, suspend,
      async capture() {
        if (!eligible()) throw new Error("capture_not_eligible");
        const pixels = await page!.screenshot({ type: "jpeg", quality: 65, fullPage: false, timeout: 1_500, animations: "disabled" });
        if (!eligible() || pixels.byteLength > WATCH_MAX_FRAME_BYTES || pixels[0] !== 0xff || pixels[1] !== 0xd8) {
          pixels.fill(0); throw new Error("capture_not_eligible");
        }
        return pixels;
      },
      async dispose() {
        disposing = true; suspend();
        await context!.close({ reason: "Read-only viewer ended." });
        await browser.close({ reason: "Read-only viewer disconnected." });
      },
    };
  } catch {
    disposing = true; suspend();
    let closureConfirmed = true;
    try { await context?.close(); } catch { closureConfirmed = false; }
    try { await browser.close(); } catch { closureConfirmed = false; }
    throw new CaptureSetupFailure(closureConfirmed);
  }
}

export async function connectControlledCapture(endpoint: string, invalidate: () => void): Promise<WatchCapture> {
  // Endpoint comes only from the server-held provider result, never request data.
  const url = new URL(endpoint);
  if (url.origin !== "wss://connect.steel.dev" || url.pathname !== "/" || url.username || url.password || url.hash ||
      url.searchParams.getAll("sessionId").length !== 1 || !/^[a-f0-9-]{36}$/i.test(url.searchParams.get("sessionId") ?? "") ||
      url.searchParams.getAll("apiKey").length !== 1 || [...url.searchParams.keys()].some(key => !["apiKey", "sessionId"].includes(key))) throw new CaptureSetupFailure(true);
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 15_000 });
  return createControlledCapture(browser, invalidate);
}
