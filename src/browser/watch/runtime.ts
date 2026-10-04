import { randomUUID } from "node:crypto";
import { withinWatchLifetime } from "./lifetime";
import { CaptureFailure, CaptureSetupFailure, WATCH_CLEANUP_BUDGET_MS, WATCH_MAX_FRAME_BYTES, WATCH_MAX_FRAMES, WATCH_MAX_RUNTIME_MS, WATCH_POLICY,
  type WatchCapture, type WatchDependencies, type WatchLifetime, type WatchPhase, type WatchReason } from "./contracts";

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
function transportAbort(): Error {
  const error = privateFailure();
  // Deliberate stream termination still destroys queued bytes immediately.
  // Next handles AbortError as cancellation, not a failed response pipeline.
  error.name = "AbortError";
  return error;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/** The supplied lifetime is already registered with the host before admission.
 * One nonreplaceable writer, no frame cache, and independent stop/cleanup. */
export async function openWatchStream(deps: WatchDependencies, signal: AbortSignal, lifetime: WatchLifetime): Promise<Response> {
  const monotonic = deps.monotonic ?? (() => performance.now());
  const writerId = randomUUID(), beforeClaim = monotonic();
  let deadline = beforeClaim + WATCH_MAX_RUNTIME_MS, epoch = 1, timeoutMs = 0;
  let capture: WatchCapture | undefined, providerId: string | undefined, receiptHash: string | undefined;
  let pending: Uint8Array | undefined, stopped = false, dispatched = false, sequence = 0, capturedFrames = 0, lastFrameAt = 0;
  let setupClosureConfirmed = true, cleanupCutoff = Number.POSITIVE_INFINITY;
  let activeCapture: Promise<Uint8Array> | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let watchTimer: ReturnType<typeof setInterval> | undefined, expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let checking = false, setup: Promise<void>, cleanup: Promise<void> | undefined, disposal: Promise<void> | undefined;
  let release: Promise<void> | undefined;
  const setupFinished = deferred(), providerKnown = deferred(), encoder = new TextEncoder();
  const stillLive = () => !stopped && !signal.aborted && !lifetime.signal.aborted && monotonic() < deadline;
  const discard = () => { pending?.fill(0); pending = undefined; };
  const numeric = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(180_000, Math.round(value))) : 0;
  const emit = (phase: WatchPhase, reason: WatchReason, started = monotonic()) => {
    try { deps.diagnostic?.({ phase, reason, durationMs: numeric(monotonic() - started),
      remainingMs: numeric(stopped ? cleanupCutoff - performance.now() : deadline - monotonic()), capturedFrames, deliveredFrames: sequence }); }
    catch { /* Observability is never an authority or cleanup dependency. */ }
  };
  const fail = (phase: WatchPhase, reason: WatchReason): never => { emit(phase, reason); throw privateFailure(); };
  const observe = async <T>(phase: WatchPhase, operation: () => Promise<T>): Promise<T> => {
    const started = monotonic();
    try { const result = await operation(); emit(phase, "completed", started); return result; }
    catch (error) { emit(phase, error instanceof CaptureFailure ? error.reason : "failed", started); throw privateFailure(); }
  };
  // A timeout is a distinct negative result, never positive disposal evidence.
  const bounded = async <T>(phase: WatchPhase, operation: () => Promise<T>, limitMs = WATCH_CLEANUP_BUDGET_MS): Promise<{ ok: true; value: T } | { ok: false; reason: "failed" | "timeout" }> => {
    const started = monotonic(), remaining = Math.min(limitMs, cleanupCutoff - performance.now());
    if (remaining <= 0) { emit(phase, "timeout", started); return { ok: false, reason: "timeout" }; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve().then(operation).then(value => ({ ok: true as const, value }), () => ({ ok: false as const, reason: "failed" as const })),
        new Promise<{ ok: false; reason: "timeout" }>(resolve => { timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), remaining); }),
      ]);
      emit(phase, result.ok ? "completed" : result.reason, started);
      return result;
    } finally { if (timer) clearTimeout(timer); }
  };
  const releaseKnown = () => {
    if (!release && providerId) {
      const exactId = providerId;
      release = Promise.resolve().then(() => deps.releaseProvider(exactId));
      void release.catch(() => undefined);
    }
    return release;
  };
  const disposeCapture = () => {
    if (!disposal && capture) {
      capture.suspend();
      disposal = Promise.resolve().then(() => capture!.dispose());
      void disposal.catch(() => undefined);
    }
    return disposal;
  };
  const stop = (outcome: "ended" | "failed" | "uncertain" = "ended", reason: WatchReason = "completed") => {
    if (stopped) return cleanup ?? lifetime.completion;
    // No await before the pre-pixel/pre-delivery fence and transport termination.
    stopped = true; capture?.suspend(); discard();
    cleanupCutoff = Math.min(performance.now() + WATCH_CLEANUP_BUDGET_MS, lifetime.workDeadline + WATCH_CLEANUP_BUDGET_MS);
    if (watchTimer) clearInterval(watchTimer);
    if (expiryTimer) clearTimeout(expiryTimer);
    signal.removeEventListener("abort", onAbort); lifetime.signal.removeEventListener("abort", onHostStop);
    emit("stop", reason);
    // Release is not ordered behind setup completion or context disposal.
    releaseKnown(); disposeCapture();
    cleanup = Promise.resolve().then(async () => {
      const releaseResult = (async () => {
        const known = await bounded("setup_settle", () => providerKnown.promise);
        if (!known.ok) return "unknown";
        const work = releaseKnown();
        if (!work) return dispatched ? "unknown" : "not_created";
        const result = await bounded("release", () => work, 10_000);
        return result.ok ? "released" : result.reason === "failed" ? "failed" : "unknown";
      })();
      const setupResult = await bounded("setup_settle", () => setupFinished.promise);
      let closureConfirmed = setupResult.ok && setupClosureConfirmed;
      if (setupResult.ok && capture) {
        const result = await bounded("dispose", () => disposeCapture()!);
        closureConfirmed = closureConfirmed && result.ok;
      }
      const captured = await bounded("capture_settle", async () => { await activeCapture?.catch(() => undefined); });
      closureConfirmed = closureConfirmed && captured.ok;
      const released = await releaseResult;
      if (!closureConfirmed) { emit("close", "unconfirmed"); return; }
      await bounded("close", () => deps.authority("close", { writerId, outcome: dispatched && !providerId ? "uncertain" : outcome,
        providerReceiptHash: receiptHash ?? null, releaseResult: released, capturedFrames, deliveredFrames: sequence }));
    }).catch(() => { emit("cleanup", "failed"); }).finally(() => {
      emit("cleanup", "completed"); lifetime.finish(); emit("hosting", "completed");
    });
    // Install all cleanup work before ending transport. An empty response can
    // close normally without triggering the host's pre-header pipe-error path;
    // EOF is still a client failure, never a physical-close acknowledgement.
    // Once a frame was enqueued, error instead so queued bytes cannot drain.
    emit("cleanup", "started");
    try { if (sequence === 0) controller?.close(); else controller?.error(transportAbort()); } catch { /* Already cancelled. */ }
    return cleanup;
  };
  const onAbort = () => { void stop("ended", "aborted"); };
  const onHostStop = () => { void stop("failed", "expired"); };
  const assertLive = () => {
    if (!stillLive()) fail("stop", signal.aborted ? "aborted" : "expired");
    if (!capture?.eligible()) fail("capture", "source_invalidated");
  };
  const stamp = () => ({ writerId, contextId: capture!.contextId, pageId: capture!.pageId, epoch });
  const requireAllowed = async (operation: "create_dispatched" | "created" | "attest", payload: Record<string, unknown>) => {
    const phase = operation === "create_dispatched" ? "dispatch" : operation === "created" ? "provider_record" : "attest";
    const value = await observe(phase, () => deps.authority(operation, payload));
    if (value.allowed !== true) fail(phase, "denied");
  };
  const permit = async (phase: "capture_permit" | "delivery_permit") => {
    assertLive();
    const started = monotonic(), result = await observe(phase, () => deps.authority("permit", stamp()));
    const ttl = finiteDate(result.leaseUntil) - finiteDate(result.serverNow), cutoff = started + ttl - PERMIT_MARGIN_MS;
    if (result.allowed !== true || result.epoch !== epoch || !Number.isFinite(ttl) || ttl <= PERMIT_MARGIN_MS || ttl > 2_000) fail(phase, "denied");
    if (monotonic() >= cutoff) fail(phase, "expired");
    assertLive(); return Math.min(cutoff, deadline);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  lifetime.signal.addEventListener("abort", onHostStop, { once: true });
  emit("hosting", "started");
  let claimWork: Promise<Record<string, unknown>> | undefined;
  try {
    if (!stillLive()) throw privateFailure();
    claimWork = observe("claim", () => deps.authority("claim", { writerId }));
    const claim = await withinWatchLifetime(lifetime, () => claimWork!, signal);
    const grantMs = finiteDate(claim.expiresAt) - finiteDate(claim.serverNow);
    timeoutMs = Number(claim.timeoutMs); epoch = Number(claim.epoch);
    if (claim.allowed !== true || !Number.isFinite(grantMs) || grantMs <= PERMIT_MARGIN_MS || grantMs > WATCH_MAX_RUNTIME_MS ||
        !Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > WATCH_MAX_RUNTIME_MS || epoch !== 1 ||
        claim.policyVersion !== WATCH_POLICY || claim.sourceHash !== deps.sourceHash) fail("claim", "denied");
    deadline = beforeClaim + Math.min(grantMs, timeoutMs) - PERMIT_MARGIN_MS;
    if (!stillLive()) throw privateFailure();
  } catch {
    // Reject the handler promptly on abort, but a still-pending claim is not a
    // settled setup. Cleanup may ACK only if that actual RPC settles in budget.
    if (claimWork) void claimWork.then(setupFinished.resolve, setupFinished.resolve);
    else setupFinished.resolve();
    providerKnown.resolve();
    void stop("failed", signal.aborted ? "aborted" : "failed");
    throw privateFailure();
  }
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      setup = (async () => {
        if (!stillLive()) throw privateFailure();
        await requireAllowed("create_dispatched", { writerId });
        dispatched = true;
        if (!stillLive()) throw privateFailure();
        const provider = await observe("provider_create", () => deps.createProvider(timeoutMs, () => { if (!stillLive()) throw privateFailure(); }));
        providerId = provider.providerSessionId; receiptHash = provider.receiptHash; providerKnown.resolve();
        if (stopped) releaseKnown();
        await requireAllowed("created", { writerId, providerSessionId: providerId });
        if (!stillLive()) throw privateFailure();
        setupClosureConfirmed = false;
        const started = monotonic();
        try {
          capture = await deps.createCapture(provider.endpoint, () => { void stop("failed", "source_invalidated"); });
          setupClosureConfirmed = true; emit("capture_setup", "completed", started);
          if (!stillLive()) { capture.suspend(); disposeCapture(); }
        } catch (error) {
          setupClosureConfirmed = error instanceof CaptureSetupFailure && error.closureConfirmed;
          emit("capture_setup", "failed", started); throw privateFailure();
        }
        assertLive();
        await requireAllowed("attest", { ...stamp(), sourceHash: deps.sourceHash });
        assertLive();
      })().finally(() => { setupFinished.resolve(); providerKnown.resolve(); });
      void setup.catch(() => { void stop(dispatched && !providerId ? "uncertain" : "failed", "failed"); });
      expiryTimer = setTimeout(() => { void stop("ended", "expired"); }, Math.max(0, deadline - monotonic()));
      watchTimer = setInterval(() => {
        if (checking || stopped) return;
        checking = true;
        void deps.authority("read", {}).then(value => {
          if (!["starting", "watching"].includes(String(value.status)) || !stillLive()) void stop("ended", "denied");
        }, () => { emit("authority_read", "failed"); void stop("failed", "failed"); }).finally(() => { checking = false; });
      }, POLL_MS);
      if (signal.aborted || lifetime.signal.aborted) void stop("ended", "aborted");
    },
    async pull(c) {
      try {
        await setup;
        if (sequence >= WATCH_MAX_FRAMES) { void stop("ended", "frame_limit"); return; }
        const wait = FRAME_INTERVAL_MS - (monotonic() - lastFrameAt);
        if (sequence && wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
        assertLive();
        await requireAllowed("attest", { ...stamp(), sourceHash: deps.sourceHash });
        const captureCutoff = await permit("capture_permit");
        if (monotonic() >= captureCutoff) fail("capture_lease", "expired");
        activeCapture = observe("capture", () => capture!.capture(captureCutoff)).then(bytes => {
          capturedFrames += 1;
          if (!stillLive()) { bytes.fill(0); throw privateFailure(); }
          return bytes;
        });
        pending = await activeCapture;
        activeCapture = undefined;
        assertLive();
        if (monotonic() >= captureCutoff) fail("capture_lease", "expired");
        if (!pending.byteLength || pending.byteLength > WATCH_MAX_FRAME_BYTES || pending[0] !== 0xff || pending[1] !== 0xd8) fail("capture", "frame_invalid");
        const capturedAt = new Date().toISOString(), deliveryCutoff = await permit("delivery_permit");
        assertLive();
        const packet = encoder.encode(JSON.stringify({ type: "frame", epoch, sequence: sequence + 1,
          capturedAt, mime: "image/jpeg", data: Buffer.from(pending).toString("base64") }) + "\n");
        discard();
        // No await is allowed between this final deadline fence and enqueue.
        if (!stillLive() || !capture!.eligible() || monotonic() >= deliveryCutoff) { packet.fill(0); fail("delivery", "expired"); }
        c.enqueue(packet); sequence += 1; lastFrameAt = monotonic();
        emit("delivery", "completed");
      } catch { discard(); void stop("failed", "failed"); }
    },
    cancel() { return stop("ended", "aborted"); },
  }, { highWaterMark: 0 });
  return new Response(body, { status: 200, headers: WATCH_HEADERS });
}
