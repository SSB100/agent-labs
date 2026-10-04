/** TEMPORARY protected-Preview diagnostic. Never a viewer qualification.
 * This module deliberately imports no auth, database, provider or live factory.
 * Remove it and its route/page/tests before any production fix is released.
 */
import { WATCH_POLICY, type WatchDependencies, type WatchDiagnostic, type WatchLifetime } from "./contracts";
import { createWatchLifetime } from "./lifetime";
import { openWatchStream } from "./runtime";

export const HOST_PROBE_CASES = ["normal-response", "early-empty-eof", "post-frame-failure", "owner-revoke", "client-cancel"] as const;
type ProbeCase = typeof HOST_PROBE_CASES[number];
const WORK_MS = 2_500, HARD_LIMIT_MS = 5_000, INPUT_MS = 250, MAX_INPUT_BYTES = 48;
const SOURCE_HASH = "0".repeat(64);
const HEADERS = {
  "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const numeric = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(HARD_LIMIT_MS, Math.round(value))) : 0;
type ProbePhase = WatchDiagnostic["phase"] | "probe" | "registration" | "control" | "fake_close" | "hard_limit";
type ProbeReason = WatchDiagnostic["reason"] | ProbeCase;
function log(phase: ProbePhase, reason: ProbeReason, started: number, capturedFrames = 0, deliveredFrames = 0) {
  // Construct, never spread, the only diagnostic payload. No request or authority payload is logged.
  console.info("[r10-host-probe]", JSON.stringify({ phase, reason, durationMs: numeric(performance.now() - started),
    remainingMs: numeric(HARD_LIMIT_MS - (performance.now() - started)),
    capturedFrames: numeric(capturedFrames), deliveredFrames: numeric(deliveredFrames) }));
}
export function hostProbeUnavailable(status = 404) { return new Response(null, { status, headers: HEADERS }); }
export function isHostProbeRequest(request: Request, post: boolean): boolean {
  const url = new URL(request.url), origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
  // A clicked external link may open this inert landing document. It cannot run
  // a case: the existing POST Origin and fetch-metadata checks stay unchanged.
  const landingNavigation = !post && request.method === "GET"
    && (site === "cross-site" || site === "same-site")
    && request.headers.get("sec-fetch-mode") === "navigate"
    && request.headers.get("sec-fetch-dest") === "document";
  if (url.search || (site && site !== "same-origin" && (post || (site !== "none" && !landingNavigation)))) return false;
  if (post && origin !== url.origin) return false;
  return !origin || origin === url.origin;
}
async function readCase(request: Request): Promise<ProbeCase | null> {
  if (request.headers.get("content-type") !== "application/json" || !request.body || request.signal.aborted) return null;
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d{1,2}$/.test(length) || Number(length) > MAX_INPUT_BYTES)) return null;
  const reader = request.body.getReader();
  let bytes = new Uint8Array(), timer: ReturnType<typeof setTimeout> | undefined, expired = false;
  try {
    return await Promise.race([
      (async () => {
        while (!expired) {
          const chunk = await reader.read();
          if (expired) return null;
          if (chunk.done) break;
          if (bytes.byteLength + chunk.value.byteLength > MAX_INPUT_BYTES) return null;
          bytes = Buffer.concat([bytes, chunk.value]);
        }
        const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return HOST_PROBE_CASES.find(value => body === JSON.stringify({ case: value })) ?? null;
      })(),
      new Promise<null>(resolve => { timer = setTimeout(() => { expired = true; resolve(null); }, INPUT_MS); }),
    ]);
  } catch { return null; }
  finally { expired = true; clearTimeout(timer); void reader.cancel().catch(() => undefined); }
}

/** register is exactly the existing after(completion) registration at the route.
 * All other dependencies are created here, are inert, and cannot be supplied by callers.
 */
export async function runHostProbe(request: Request, register: (completion: Promise<void>) => void): Promise<Response> {
  if (!isHostProbeRequest(request, true)) return hostProbeUnavailable(403);
  const started = performance.now();
  let lifetime: WatchLifetime;
  try { lifetime = createWatchLifetime(completion => { register(completion); log("registration", "completed", started); }); }
  catch { return hostProbeUnavailable(503); }
  const control = new AbortController();
  const signal = AbortSignal.any([request.signal, control.signal]);
  const workTimer = setTimeout(() => control.abort(), WORK_MS);
  const hardTimer = setTimeout(() => {
    // The unchanged production lifetime is 150s; this disposable harness always
    // aborts at2.5s and caps retention at5s. Hitting this cap is a negative result.
    log("hard_limit", "timeout", started); control.abort(); lifetime.finish();
  }, HARD_LIMIT_MS);
  void lifetime.completion.then(() => { clearTimeout(workTimer); clearTimeout(hardTimer); });
  let handedOff = false;
  try {
    const mode = await readCase(request);
    if (!mode || signal.aborted) return hostProbeUnavailable(400);
    log("probe", mode, started);
    if (mode === "normal-response") {
      handedOff = true;
      // Deliberately finish AFTER the plain JSON response has returned.
      void wait(1_750).then(() => { log("control", "completed", started); lifetime.finish(); log("hosting", "completed", started); });
      return Response.json({ diagnostic: "provider-free", qualification: false, case: mode }, { headers: HEADERS });
    }
    let suspended = false, disposed = false, released = false, shots = 0, captured = 0, delivered = 0, closeCalls = 0;
    let deliveredAt: number | undefined;
    const deps: WatchDependencies = {
      sourceHash: SOURCE_HASH,
      diagnostic: event => {
        if (event.phase === "delivery" && event.reason === "completed") { delivered = event.deliveredFrames; deliveredAt ??= performance.now(); }
        log(event.phase, event.reason, started, event.capturedFrames, event.deliveredFrames);
      },
      authority: async operation => {
        const now = Date.now();
        if (operation === "claim") return { allowed: true, epoch: 1, serverNow: new Date(now).toISOString(),
          expiresAt: new Date(now + WORK_MS).toISOString(), timeoutMs: WORK_MS, policyVersion: WATCH_POLICY, sourceHash: SOURCE_HASH };
        if (operation === "read") return { status: mode === "owner-revoke" && deliveredAt !== undefined && performance.now() - deliveredAt >= 100 ? "revocation_pending" : "watching" };
        if (operation === "close") {
          closeCalls += 1;
          if (!disposed || !released || closeCalls !== 1) throw new Error("inert_close_invalid");
          await wait(100); log("fake_close", "completed", started, captured, delivered); return { status: "ended" };
        }
        if (operation === "permit") return { allowed: true, epoch: 1, serverNow: new Date(now).toISOString(), leaseUntil: new Date(now + 2_000).toISOString() };
        return { allowed: true };
      },
      // These constant strings never reach a transport, registry, database or logs.
      createProvider: async (_timeout, assertDispatch) => { assertDispatch(); return { providerSessionId: "inert", endpoint: "inert", receiptHash: SOURCE_HASH }; },
      releaseProvider: async () => { await wait(120); released = true; },
      createCapture: async () => ({ contextId: "inert", pageId: "inert", eligible: () => !suspended,
        capture: async () => {
          shots += 1;
          if (mode === "early-empty-eof" || (mode === "post-frame-failure" && shots > 1)) throw new Error("inert_capture_failed");
          captured += 1;
          // Fixed harmless marker bytes exercise the stream; these are not an image or live pixels.
          return new Uint8Array([255, 216, 255, 217]);
        },
        suspend: () => { suspended = true; },
        dispose: async () => { await wait(1_750); disposed = true; },
      }),
    };
    handedOff = true;
    const response = await openWatchStream(deps, signal, lifetime);
    response.headers.set("X-R10-Host-Probe", "provider-free-not-qualification");
    return response;
  } catch { return hostProbeUnavailable(409); }
  finally { if (!handedOff) lifetime.finish(); }
}
