import { randomUUID } from "node:crypto";
import { CaptureSetupFailure, WATCH_MAX_FRAME_BYTES, WATCH_MAX_FRAMES, WATCH_MAX_RUNTIME_MS, WATCH_POLICY, type WatchCapture, type WatchDependencies } from "./contracts";

const POLL_MS = 250, FRAME_INTERVAL_MS = 1_000, PERMIT_MARGIN_MS = 150;
const WATCH_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Accel-Buffering": "no",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", Vary: "Cookie",
};
function finiteDate(value: unknown): number {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? Date.parse(value) : Number.NaN;
}
function privateFailure(): Error { return new Error("Read-only viewing ended. Saved records remain available."); }

/** One durable, nonreplaceable writer, one screenshot at a time, no frame cache,
 * no automatic reconnect and no queued source frames. The independent watcher
 * closes a backpressured channel, so stopping is never just a client poll gate. */
export async function openWatchStream(deps: WatchDependencies, signal: AbortSignal): Promise<Response> {
  const monotonic = deps.monotonic ?? (() => performance.now());
  const writerId = randomUUID(), beforeClaim = monotonic();
  const claim = await deps.authority("claim", { writerId });
  const grantMs = finiteDate(claim.expiresAt) - finiteDate(claim.serverNow);
  const timeoutMs = Number(claim.timeoutMs), epoch = Number(claim.epoch);
  if (claim.allowed !== true || !Number.isFinite(grantMs) || grantMs <= PERMIT_MARGIN_MS || grantMs > WATCH_MAX_RUNTIME_MS ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > WATCH_MAX_RUNTIME_MS || epoch !== 1 ||
      claim.policyVersion !== WATCH_POLICY || claim.sourceHash !== deps.sourceHash) {
    await deps.authority("close", { writerId, outcome: "failed", providerReceiptHash: null, releaseResult: "not_created", capturedFrames: 0, deliveredFrames: 0 }).catch(() => undefined);
    throw privateFailure();
  }
  const requireAllowed = async (operation: "create_dispatched" | "created" | "attest", payload: Record<string, unknown>) => {
    const value = await deps.authority(operation, payload);
    if (value.allowed !== true) throw privateFailure();
  };
  const deadline = beforeClaim + Math.min(grantMs, timeoutMs) - PERMIT_MARGIN_MS;
  let capture: WatchCapture | undefined, providerId: string | undefined, receiptHash: string | undefined;
  let pending: Uint8Array | undefined, stopped = false, dispatched = false, sequence = 0, capturedFrames = 0, lastFrameAt = 0;
  let setupClosureConfirmed = true;
  let activeCapture: Promise<Uint8Array> | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let watchTimer: ReturnType<typeof setInterval> | undefined, expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let checking = false, setup: Promise<void>, cleanup: Promise<void> | undefined;
  const encoder = new TextEncoder();
  const stillLive = () => !stopped && !signal.aborted && monotonic() < deadline;
  const discard = () => { pending?.fill(0); pending = undefined; };

  const stop = (outcome: "ended" | "failed" | "uncertain" = "ended") => {
    if (cleanup) return cleanup;
    // Synchronous pre-pixel/pre-delivery boundary. No await before this fence.
    stopped = true; capture?.suspend(); discard();
    if (watchTimer) clearInterval(watchTimer);
    if (expiryTimer) clearTimeout(expiryTimer);
    signal.removeEventListener("abort", onAbort);
    try { controller?.error(privateFailure()); } catch { /* Already cancelled. */ }
    cleanup = Promise.resolve().then(async () => {
      await setup?.catch(() => undefined);
      // ACK is never sent before physical producer/context disposal. If disposal
      // fails, leave closure unconfirmed even if a lease has expired.
      let closureConfirmed = setupClosureConfirmed;
      try { await capture?.dispose(); } catch { closureConfirmed = false; }
      // Settle the one in-flight capture before freezing audit counts. Delivery
      // already failed synchronously; late bytes are zeroed in the capture job.
      await activeCapture?.catch(() => undefined);
      let releaseResult = dispatched ? "unknown" : "not_created";
      if (providerId) {
        try { await deps.releaseProvider(providerId); releaseResult = "released"; }
        catch { releaseResult = "failed"; }
      }
      if (!closureConfirmed) return;
      await deps.authority("close", { writerId, outcome: dispatched && !providerId ? "uncertain" : outcome,
        providerReceiptHash: receiptHash ?? null, releaseResult, capturedFrames, deliveredFrames: sequence }).catch(() => undefined);
    });
    return cleanup;
  };
  const onAbort = () => { void stop(); };
  const assertLive = () => { if (!stillLive() || !capture?.eligible()) throw privateFailure(); };
  const stamp = () => ({ writerId, contextId: capture!.contextId, pageId: capture!.pageId, epoch });
  const permit = async () => {
    assertLive();
    const started = monotonic(), result = await deps.authority("permit", stamp());
    const ttl = finiteDate(result.leaseUntil) - finiteDate(result.serverNow);
    const cutoff = started + ttl - PERMIT_MARGIN_MS;
    if (result.allowed !== true || result.epoch !== epoch || !Number.isFinite(ttl) || ttl <= PERMIT_MARGIN_MS || ttl > 2_000 ||
        monotonic() >= cutoff) throw privateFailure();
    assertLive(); return Math.min(cutoff, deadline);
  };
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      setup = (async () => {
        if (!stillLive()) throw privateFailure();
        await requireAllowed("create_dispatched", { writerId });
        dispatched = true;
        if (!stillLive()) throw privateFailure();
        const provider = await deps.createProvider(timeoutMs, () => { if (!stillLive()) throw privateFailure(); });
        providerId = provider.providerSessionId; receiptHash = provider.receiptHash;
        await requireAllowed("created", { writerId, providerSessionId: providerId });
        if (!stillLive()) throw privateFailure();
        setupClosureConfirmed = false;
        try {
          capture = await deps.createCapture(provider.endpoint, () => { void stop("failed"); });
          setupClosureConfirmed = true;
        } catch (error) {
          setupClosureConfirmed = error instanceof CaptureSetupFailure && error.closureConfirmed;
          throw privateFailure();
        }
        assertLive();
        await requireAllowed("attest", { ...stamp(), sourceHash: deps.sourceHash });
        assertLive();
      })();
      void setup.catch(() => { void stop(dispatched && !providerId ? "uncertain" : "failed"); });
      signal.addEventListener("abort", onAbort, { once: true });
      expiryTimer = setTimeout(() => { void stop(); }, Math.max(0, deadline - monotonic()));
      // Independent of demand and screenshot completion. Failed authority reads
      // are a stop, never a reason to retain an old viewer lease.
      watchTimer = setInterval(() => {
        if (checking || stopped) return;
        checking = true;
        void deps.authority("read", {}).then(value => {
          if (!["starting", "watching"].includes(String(value.status)) || !stillLive()) void stop();
        }, () => { void stop("failed"); }).finally(() => { checking = false; });
      }, POLL_MS);
      if (signal.aborted) void stop();
    },
    async pull(c) {
      try {
        await setup;
        if (sequence >= WATCH_MAX_FRAMES) { void stop(); return; }
        const wait = FRAME_INTERVAL_MS - (monotonic() - lastFrameAt);
        if (sequence && wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
        assertLive();
        await requireAllowed("attest", { ...stamp(), sourceHash: deps.sourceHash });
        const captureCutoff = await permit();
        if (monotonic() >= captureCutoff) throw privateFailure();
        activeCapture = capture!.capture().then(bytes => {
          capturedFrames += 1;
          if (!stillLive()) { bytes.fill(0); throw privateFailure(); }
          return bytes;
        });
        pending = await activeCapture;
        activeCapture = undefined;
        // A privacy event may have happened while screenshot bytes were in
        // flight. Drop them before any authority/network operation.
        assertLive();
        if (monotonic() >= captureCutoff || !pending.byteLength || pending.byteLength > WATCH_MAX_FRAME_BYTES ||
            pending[0] !== 0xff || pending[1] !== 0xd8) throw privateFailure();
        const capturedAt = new Date().toISOString();
        const deliveryCutoff = await permit();
        assertLive();
        const packet = encoder.encode(JSON.stringify({ type: "frame", epoch, sequence: sequence + 1,
          capturedAt, mime: "image/jpeg", data: Buffer.from(pending).toString("base64") }) + "\n");
        discard();
        // No await is allowed between this final deadline fence and enqueue.
        if (!stillLive() || !capture!.eligible() || monotonic() >= deliveryCutoff) {
          packet.fill(0); throw privateFailure();
        }
        c.enqueue(packet); sequence += 1; lastFrameAt = monotonic();
      } catch { discard(); void stop("failed"); }
    },
    cancel() { return stop(); },
  }, { highWaterMark: 0 });
  return new Response(body, { status: 200, headers: WATCH_HEADERS });
}
