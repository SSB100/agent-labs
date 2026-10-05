import { randomUUID } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright-core";
import { CaptureFailure, CaptureSetupFailure, WATCH_CSP, WATCH_DISPOSE_TIMEOUT_MS, WATCH_HTML, WATCH_MAX_FRAME_BYTES, WATCH_SOURCE_URL, type WatchCapture } from "./contracts";

const CAPTURE_TIMEOUT_MS = 1_500, CDP_SETUP_TIMEOUT_MS = 1_500;
// Context creation gets the same setup allowance as connection/navigation,
// rather than the shorter pixel/CDP-command deadline.
const CONTEXT_SETUP_TIMEOUT_MS = 15_000;
const VIEWPORT = { width: 960, height: 540 } as const;
const MAX_SCROLLBAR_SIZE = 32;
const MAX_BASE64_LENGTH = 4 * Math.ceil(WATCH_MAX_FRAME_BYTES / 3);

/** A stalled context must not prevent disconnecting the transport. A timeout
 * records uncertainty, never evidence that either physical close succeeded. */
async function closeWithinDeadline(close: () => Promise<void>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(close),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("capture_disposal_unconfirmed")), WATCH_DISPOSE_TIMEOUT_MS);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** CDP send/attach have no built-in timeout. This bounds the caller only; the
 * separately tracked raw command must still settle before physical closure ACK. */
async function withinDeadline<T>(work: Promise<T>, deadline: number, expire: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = () => { expire(); return new CaptureFailure("timeout"); };
  try {
    if (performance.now() >= deadline) throw timeout();
    const result = await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(timeout()), Math.max(0, deadline - performance.now()));
      }),
    ]);
    // Timer callbacks can be delayed behind an already-arrived protocol reply.
    if (performance.now() >= deadline) throw timeout();
    return result;
  } finally {
    clearTimeout(timer);
  }
}

type LayoutViewport = { pageX: number; pageY: number; clientWidth: number; clientHeight: number };
type LayoutMetrics = { cssLayoutViewport: LayoutViewport; cssVisualViewport: LayoutViewport &
  { offsetX: number; offsetY: number; scale: number; zoom?: number } };

function fixedLayout(metrics: LayoutMetrics): boolean {
  const layout = metrics.cssLayoutViewport, visual = metrics.cssVisualViewport;
  // CDP client dimensions exclude scrollbars. The exact outer viewport remains
  // fixed by newContext and checked separately on every eligibility read.
  // A small scrollbar deficit is allowed; a scaled/shrunken viewport is not.
  return Boolean(layout && visual && layout.pageX === 0 && layout.pageY === 0 &&
    visual.pageX === 0 && visual.pageY === 0 && visual.offsetX === 0 && visual.offsetY === 0 &&
    visual.scale === 1 && (visual.zoom === undefined || visual.zoom === 1) &&
    layout.clientWidth === visual.clientWidth && layout.clientHeight === visual.clientHeight &&
    Number.isSafeInteger(layout.clientWidth) && Number.isSafeInteger(layout.clientHeight) &&
    layout.clientWidth >= VIEWPORT.width - MAX_SCROLLBAR_SIZE && layout.clientWidth <= VIEWPORT.width &&
    layout.clientHeight >= VIEWPORT.height - MAX_SCROLLBAR_SIZE && layout.clientHeight <= VIEWPORT.height);
}

/** Only this constructor can establish the producer's eligibility. No saved
 * live/status/URL/fixture metadata is consumed. Every pixel comes from the
 * newly created, nonpersistent, network-confined context below. */
export async function createControlledCapture(browser: Browser, invalidate: () => void): Promise<WatchCapture> {
  let context: BrowserContext | undefined, page: Page | undefined, session: CDPSession | undefined;
  let suspended = false, ready = false, preparing = true, disposing = false, admittedDocument = false;
  let capturePending = false;
  let contextCloseObserved = false, disconnectObserved = false;
  let observeDisconnect!: () => void;
  const transportDisconnected = new Promise<void>(resolve => { observeDisconnect = resolve; });
  const contextId = randomUUID(), pageId = randomUUID();
  const rawWork = new Set<Promise<void>>(), ownedPixels = new Set<Uint8Array>();
  const suspend = () => {
    suspended = true; ready = false;
    for (const pixels of ownedPixels) pixels.fill(0);
    ownedPixels.clear();
  };
  const fail = () => { suspend(); if (!disposing) invalidate(); };
  // Observe transport loss before the first constructor await. Browser.close()
  // can swallow TargetClosed, so its fulfillment is not disconnect evidence.
  browser.on("disconnected", () => { disconnectObserved = true; observeDisconnect(); fail(); });
  const track = <T>(work: Promise<T>): Promise<T> => {
    const settled = work.then(() => undefined, () => undefined);
    rawWork.add(settled);
    void settled.then(() => rawWork.delete(settled));
    return work;
  };
  const confined = () => Boolean(!suspended && page && !page.isClosed() && browser.isConnected() &&
    page.context() === context && page.url() === WATCH_SOURCE_URL && context?.pages().length === 1 &&
    context.pages()[0] === page && page.frames().length === 1 &&
    page.viewportSize()?.width === VIEWPORT.width && page.viewportSize()?.height === VIEWPORT.height);
  const eligible = () => Boolean(ready && session && confined());
  const assertConfined = () => { if (!confined()) throw new Error("capture_confinement_unavailable"); };
  let disposal: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    if (disposal) return disposal;
    disposing = true; suspend();
    disposal = (async () => {
      // Start this alongside physical close, not after it. A caller-facing
      // timeout, detach or successful close cannot stand in for raw settlement.
      const commandsSettled = closeWithinDeadline(async () => { await Promise.all([...rawWork]); });
      const contextClosed = await closeWithinDeadline(async () => {
        const ownedContext = context;
        // Public isClosed() includes an already-closing context. Its close()
        // would fulfill without dispatch, which cannot prove our physical close.
        if (!ownedContext || contextCloseObserved || ownedContext.isClosed() ||
            disconnectObserved || !browser.isConnected()) throw new Error("capture_disposal_unconfirmed");
        await ownedContext.close({ reason: "Read-only viewer ended." });
        if (!contextCloseObserved || !ownedContext.isClosed() || disconnectObserved ||
            !browser.isConnected()) throw new Error("capture_disposal_unconfirmed");
      });
      // Attempt this independently even if context.close rejects or times out.
      const disconnected = await closeWithinDeadline(async () => {
        await browser.close({ reason: "Read-only viewer disconnected." });
        await transportDisconnected;
        if (browser.isConnected()) throw new Error("capture_disposal_unconfirmed");
      });
      if (!await commandsSettled || !contextClosed || !disconnected) throw new Error("capture_disposal_unconfirmed");
    })();
    return disposal;
  };
  const setup = <T>(work: Promise<T>, timeout = CDP_SETUP_TIMEOUT_MS) => withinDeadline(track(work), performance.now() + timeout, fail);
  try {
    await setup(Promise.resolve().then(() => {
      if (disconnectObserved || !browser.isConnected()) throw new Error("capture_confinement_unavailable");
      return browser.newContext({
        acceptDownloads: false, javaScriptEnabled: false, serviceWorkers: "block",
        permissions: [], viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: "light", locale: "en-US",
      });
    }).then(async created => {
      context = created;
      // Install this before route/page setup can fail or the context can close.
      context.on("close", () => { contextCloseObserved = true; fail(); });
      if (disposing) {
        // An ambiguous late constructor never repairs an earlier failed proof.
        await closeWithinDeadline(() => created.close({ reason: "Read-only viewer ended." }));
        throw new Error("capture_confinement_unavailable");
      }
      if (context.isClosed() || disconnectObserved || !browser.isConnected()) throw new Error("capture_confinement_unavailable");
    }), CONTEXT_SETUP_TIMEOUT_MS);
    if (!context) throw new Error("capture_confinement_unavailable");
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
    page = await context.newPage();
    page.on("popup", fail); page.on("download", fail); page.on("dialog", fail);
    page.on("crash", fail); page.on("close", fail); page.on("frameattached", fail);
    page.on("framenavigated", frame => {
      if (!preparing || frame !== page?.mainFrame() || frame.url() !== WATCH_SOURCE_URL) fail();
    });
    await page.goto(WATCH_SOURCE_URL, { waitUntil: "load", timeout: 15_000 });
    preparing = false;
    assertConfined();
    if (!admittedDocument || (await context.cookies()).length !== 0) throw new Error("capture_confinement_unavailable");
    assertConfined();
    // Attach only to the exact page just created here. Never enumerate targets
    // or attach to a default context, browser session, saved page or frame.
    await setup(Promise.resolve().then(() => {
      assertConfined();
      return context!.newCDPSession(page!);
    }).then(attached => {
      session = attached;
      session.on("close", fail);
      assertConfined(); // Includes late attach after timeout or disposal.
    }));
    assertConfined();
    const metrics = await setup(Promise.resolve().then(() => {
      assertConfined();
      return session!.send("Page.getLayoutMetrics");
    }));
    assertConfined();
    if (!fixedLayout(metrics)) throw new Error("capture_confinement_unavailable");
    ready = true;
    return {
      contextId, pageId, eligible, suspend, dispose,
      async capture(captureCutoff?: number) {
        const started = performance.now(), cutoff = captureCutoff ?? started + CAPTURE_TIMEOUT_MS;
        const deadline = Math.min(started + CAPTURE_TIMEOUT_MS, cutoff);
        if (!eligible()) throw new CaptureFailure("source_invalidated");
        if (capturePending) { fail(); throw new CaptureFailure("source_invalidated"); }
        let abandoned = false, pixels: Uint8Array | undefined;
        const expire = () => { abandoned = true; fail(); };
        if (!Number.isFinite(cutoff) || performance.now() >= deadline) { expire(); throw new CaptureFailure("timeout"); }
        const check = () => {
          const valid = eligible();
          // Sample after the synchronous eligibility work, immediately before
          // dispatch/consumption; that work must not renew the original lease.
          if (abandoned || performance.now() >= deadline) { expire(); throw new CaptureFailure("timeout"); }
          if (!valid) throw new CaptureFailure("source_invalidated");
        };
        capturePending = true;
        const raw = track(Promise.resolve().then(() => {
          check();
          // Exactly one bounded pixel command per permitted capture, with no
          // font/layout/animation round trips, warm-up frame, cache or screencast.
          return session!.send("Page.captureScreenshot", {
            format: "jpeg", quality: 65, fromSurface: true, captureBeyondViewport: false,
            clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height, scale: 1 },
          }).then(response => {
            try {
              check(); // Late base64 is dropped without decoding or retaining it.
              const data = response.data;
              if (typeof data !== "string" || !data.length || data.length > MAX_BASE64_LENGTH ||
                  data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new CaptureFailure("frame_invalid");
              pixels = Buffer.from(data, "base64");
              ownedPixels.add(pixels);
              check();
              if (pixels.byteLength > WATCH_MAX_FRAME_BYTES || pixels[0] !== 0xff || pixels[1] !== 0xd8) throw new CaptureFailure("frame_invalid");
              return pixels;
            } finally {
              // Strings cannot be zeroed. Drop this reference; only allocated
              // mutable pixel buffers can be zeroed on invalidation/rejection.
              response.data = "";
            }
          }, () => { check(); throw new Error("capture_unavailable"); });
        }).finally(() => { capturePending = false; }));
        try {
          const result = await withinDeadline(raw, deadline, expire);
          check();
          ownedPixels.delete(result); // Ownership passes to the runtime's drain.
          return result;
        } catch (error) {
          pixels?.fill(0);
          if (pixels) ownedPixels.delete(pixels);
          if (error instanceof CaptureFailure) throw error;
          if (!eligible()) throw new CaptureFailure("source_invalidated");
          throw new Error("capture_unavailable");
        }
      },
    };
  } catch {
    let closureConfirmed = false;
    try { await dispose(); closureConfirmed = true; } catch { /* A failed or timed-out close remains unconfirmed. */ }
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
