/** Replaces only watch-dependencies.ts in the disposable Next copy. The actual
 * authenticated watch/revoke routes, Next after registration and runtime remain intact. */
import type { WatchDependencies, WatchIdentity } from "@/browser/watch/contracts";
export function createViewerDependencies(identity: WatchIdentity): WatchDependencies {
  const origin = process.env.R03_BOUNDARY!;
  const parsed = new URL(origin);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") throw new Error("fixture_boundary_required");
  let suspended = false;
  let controls: Record<string, unknown> = {};
  const report = async (event: string) => {
    const response = await fetch(`${origin}/r10/authority`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: identity, operation: "fixture_event", payload: { event } }), signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error("inert_fixture_event_failed");
  };
  return {
    sourceHash: "b".repeat(64),
    async authority(operation, payload = {}) {
      const response = await fetch(`${origin}/r10/authority`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: identity, operation, payload }), signal: AbortSignal.timeout(5_000) });
      const value = await response.json();
      if (!response.ok || value.error || !value.data) throw new Error("inert_authority_denied");
      return value.data;
    },
    async createProvider() {
      const snapshot = await fetch(`${origin}/snapshot`, { signal: AbortSignal.timeout(5_000) });
      controls = (await snapshot.json()).control;
      await report("provider_create");
      return { providerSessionId: "inert-r10", endpoint: "inert://r10-capture", receiptHash: "c".repeat(64) };
    },
    async createCapture(endpoint) {
      if (endpoint !== "inert://r10-capture") throw new Error("inert_source_required");
      return {
        contextId: "00000000-0000-4000-8000-000000910004", pageId: "00000000-0000-4000-8000-000000910005",
        eligible: () => !suspended,
        async capture() {
          if (controls.viewerCaptureFailure) { await report("capture_failed"); throw new Error("INERT_PRIVATE_ERROR https://secret.invalid/?key=NEVER_LOG"); }
          const response = await fetch(`${origin}/r10/capture`, { method: "POST", signal: AbortSignal.timeout(5_000) });
          if (!response.ok) throw new Error("inert_capture_unavailable");
          return new Uint8Array(await response.arrayBuffer());
        },
        suspend() { suspended = true; },
        async dispose() {
          suspended = true; await report("dispose_started");
          if (controls.viewerHoldDispose) {
            const end = performance.now() + 4_000;
            while (true) {
              const snapshot = await fetch(`${origin}/snapshot`, { signal: AbortSignal.timeout(500) });
              if (!(await snapshot.json()).control.viewerHoldDispose) break;
              if (performance.now() >= end) throw new Error("inert_disposal_hold_timeout");
              await new Promise(resolve => setTimeout(resolve, 20));
            }
          }
          const delay = Number(controls.viewerDisposeDelayMs ?? 0);
          if (Number.isFinite(delay) && delay > 0 && delay <= 2_000) await new Promise(resolve => setTimeout(resolve, delay));
          if (controls.viewerDisposeFailure) { await report("dispose_failed"); throw new Error("inert_disposal_unconfirmed"); }
          await report("dispose_finished");
        },
      };
    },
    async releaseProvider(id) {
      if (id !== "inert-r10") throw new Error("inert_exact_release_required");
      suspended = true; await report("provider_released");
    },
  };
}
