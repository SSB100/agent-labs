import "server-only";
import { createHash } from "node:crypto";
import { SteelBrowserAdapter, getSteelConfig } from "./providers/steel";
import { connectControlledCapture } from "./watch/capture";
import { WATCH_HTML, type WatchAuthority, type WatchDependencies, type WatchIdentity } from "./watch/contracts";
import { createRuntimeClient } from "@/lib/supabase/runtime";

/** Production seam. Inert Next qualification substitutes this factory, not the
 * authenticated route, producer protocol or stream/revocation implementation. */
export function createViewerDependencies(identity: WatchIdentity): WatchDependencies {
  const serverKey = process.env.R10_VIEWER_SERVER_KEY?.trim();
  if (!serverKey) throw new Error("viewer_authority_unavailable");
  const client = createRuntimeClient();
  const authority: WatchAuthority = async (operation, payload = {}) => {
    const result = await client.rpc("r10_viewer_server", {
      p_business_id: identity.businessId, p_quest_id: identity.questId, p_workflow_run_id: identity.workflowRunId,
      p_session_id: identity.sessionId, p_owner_id: identity.ownerId, p_auth_session_id: identity.authSessionId,
      p_operation: operation, p_payload: payload, p_server_key: serverKey,
    });
    if (result.error || !result.data || typeof result.data !== "object" || Array.isArray(result.data)) throw new Error("viewer_authority_unavailable");
    return result.data as Record<string, unknown>;
  };
  const config = getSteelConfig();
  // No owner-supplied destination, legacy saved endpoint, profile or capability.
  if (new URL(config.baseUrl).origin !== "https://api.steel.dev" || new URL(config.baseUrl).pathname !== "/") {
    throw new Error("viewer_provider_unavailable");
  }
  let admissionCutoff = 0;
  const adapter = new SteelBrowserAdapter({ config, admitDispatch: async request => {
    if (request.provider !== "steel" || request.operation !== "browser.session" || request.method !== "POST" ||
        request.endpoint !== "https://api.steel.dev/v1/sessions") throw new Error("viewer_dispatch_not_admitted");
    const started = performance.now(), current = await authority("read");
    if (current.status !== "starting" || current.createDispatched !== true) throw new Error("viewer_dispatch_not_admitted");
    admissionCutoff = started + 1_850;
    if (performance.now() >= admissionCutoff) throw new Error("viewer_dispatch_not_admitted");
  } });
  return {
    authority, sourceHash: createHash("sha256").update(WATCH_HTML).digest("hex"),
    async createProvider(timeoutMs, assertDispatch) {
      const result = await adapter.createViewerSession(timeoutMs, () => {
        assertDispatch(); if (performance.now() >= admissionCutoff) throw new Error("viewer_dispatch_not_admitted");
      });
      return { providerSessionId: result.providerSessionId, endpoint: result.automationEndpoint,
        receiptHash: createHash("sha256").update(JSON.stringify({ provider: "steel", providerSessionId: result.providerSessionId, timeoutMs, persistProfile: false })).digest("hex") };
    },
    createCapture: connectControlledCapture,
    releaseProvider: id => adapter.releaseViewerSession(id),
  };
}
