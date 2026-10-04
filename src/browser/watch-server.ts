import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createViewerDependencies } from "./watch-dependencies";
import { openWatchStream } from "./watch/runtime";
import { validWatchScope, type WatchIdentity, type WatchScope } from "./watch/contracts";

const headers = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer", Vary: "Cookie" };
function unavailable(status = 404) { return Response.json({ status: "unavailable" }, { status, headers }); }
export async function readWatchRequest(request: Request, sessionId: string): Promise<WatchScope | null> {
  if (request.method !== "POST" || request.headers.get("origin") !== new URL(request.url).origin ||
      request.headers.get("content-type")?.split(";")[0] !== "application/json" ||
      Number(request.headers.get("content-length") ?? 0) > 512) return null;
  try {
    const text = await request.text(); if (text.length > 512) return null;
    const data: unknown = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data) ||
        Object.keys(data).some(key => !["businessId", "questId", "workflowRunId"].includes(key))) return null;
    const scope = { ...data, sessionId };
    return validWatchScope(scope) ? scope : null;
  } catch { return null; }
}
async function authenticatedScope(scope: WatchScope): Promise<WatchIdentity | null> {
  const client = await createClient();
  const [{ data: claimsData, error: claimsError }, { data: userData, error: userError }] = await Promise.all([
    client.auth.getClaims(), client.auth.getUser(),
  ]);
  const claims = claimsData?.claims;
  const authSessionId: unknown = claims?.session_id;
  if (claimsError || userError || !userData.user || claims?.sub !== userData.user.id || typeof authSessionId !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(authSessionId)) return null;
  // Owner RPC independently proves the whole tuple and active auth session.
  const result = await client.rpc("r10_viewer_owner", {
    p_business_id: scope.businessId, p_quest_id: scope.questId, p_workflow_run_id: scope.workflowRunId,
    p_session_id: scope.sessionId, p_operation: "read",
  });
  const value: unknown = result.data;
  if (result.error || !validWatchScope(value) || Object.keys(scope).some(key => scope[key as keyof WatchScope] !== value[key as keyof WatchScope])) return null;
  return { ...scope, ownerId: userData.user.id, authSessionId };
}
export async function openOwnedBrowserWatch(request: Request, scope: WatchScope): Promise<Response> {
  try {
    const identity = await authenticatedScope(scope); if (!identity) return unavailable();
    return await openWatchStream(createViewerDependencies(identity), request.signal);
  } catch { return unavailable(409); }
}
export async function revokeOwnedBrowserWatch(_request: Request, scope: WatchScope): Promise<Response> {
  try {
    const identity = await authenticatedScope(scope); if (!identity) return unavailable();
    const client = await createClient();
    let current = await client.rpc("r10_viewer_owner", {
      p_business_id: scope.businessId, p_quest_id: scope.questId, p_workflow_run_id: scope.workflowRunId,
      p_session_id: scope.sessionId, p_operation: "revoke",
    });
    if (current.error) return unavailable(409);
    const end = performance.now() + 5_000;
    while (current.data?.status === "revocation_pending" && performance.now() < end) {
      await new Promise(resolve => setTimeout(resolve, 100));
      current = await client.rpc("r10_viewer_owner", {
        p_business_id: scope.businessId, p_quest_id: scope.questId, p_workflow_run_id: scope.workflowRunId,
        p_session_id: scope.sessionId, p_operation: "read",
      });
      if (current.error) return unavailable(409);
    }
    // An elapsed deadline or failed close acknowledgement is never 'revoked'.
    const closed = current.data?.streamClosure === "acknowledged" && ["revoked", "ended", "unavailable"].includes(current.data?.status);
    return Response.json({ status: closed ? "revoked" : "revocation_pending" }, { headers });
  } catch { return unavailable(409); }
}
