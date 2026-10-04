/** Replaces only watch-dependencies.ts in the disposable Next copy. The actual
 * authenticated watch/revoke routes and producer/runtime protocol stay intact. */
import type { WatchDependencies, WatchIdentity } from "@/browser/watch/contracts";
export function createViewerDependencies(identity: WatchIdentity): WatchDependencies {
  const origin = process.env.R03_BOUNDARY!;
  const parsed = new URL(origin);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") throw new Error("fixture_boundary_required");
  let suspended = false;
  return {
    sourceHash: "b".repeat(64),
    async authority(operation, payload = {}) {
      const response = await fetch(`${origin}/r10/authority`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: identity, operation, payload }), signal: AbortSignal.timeout(5_000) });
      const value = await response.json();
      if (!response.ok || value.error || !value.data) throw new Error("inert_authority_denied");
      return value.data;
    },
    async createProvider() { return { providerSessionId: "inert-r10", endpoint: "inert://r10-capture", receiptHash: "c".repeat(64) }; },
    async createCapture(endpoint) {
      if (endpoint !== "inert://r10-capture") throw new Error("inert_source_required");
      return {
        contextId: "00000000-0000-4000-8000-000000910004", pageId: "00000000-0000-4000-8000-000000910005",
        eligible: () => !suspended,
        async capture() {
          const response = await fetch(`${origin}/r10/capture`, { method: "POST", signal: AbortSignal.timeout(5_000) });
          if (!response.ok) throw new Error("inert_capture_unavailable");
          return new Uint8Array(await response.arrayBuffer());
        },
        suspend() { suspended = true; },
        async dispose() { suspended = true; },
      };
    },
    async releaseProvider() { suspended = true; },
  };
}
