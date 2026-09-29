import { createHmac, timingSafeEqual } from "node:crypto";

import { createBrowserProviderAdapter } from "./registry";
import { rewriteHlsManifest } from "./replay";
import type { BrowserProviderDefinitionRecord, BrowserSessionRecord } from "./ui";
import { createClient } from "@/lib/supabase/server";

const BROWSER_SESSION_SELECT =
  "id, business_id, workflow_run_id, provider_definition_id, browser_identity_id, provider_session_id, status, control_mode, live_view_status, replay_status, current_url, page_title, region, browser_mode, metadata, failure, started_at, released_at, created_at, updated_at";

function row<T>(value: unknown): T | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as T)
    : null;
}

export async function loadOwnedBrowserSession(browserSessionId: string) {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData?.claims?.sub) return null;

  const { data: sessionData, error: sessionError } = await supabase
    .from("browser_sessions")
    .select(BROWSER_SESSION_SELECT)
    .eq("id", browserSessionId)
    .maybeSingle();
  const session = row<BrowserSessionRecord>(sessionData);
  if (sessionError || !session) return null;

  const { data: providerData, error: providerError } = await supabase
    .from("browser_provider_definitions")
    .select(
      "id, provider_key, name, status, is_default, api_base_url, capabilities, pricing, evaluation, created_at, updated_at",
    )
    .eq("id", session.provider_definition_id)
    .maybeSingle();
  const provider = row<BrowserProviderDefinitionRecord>(providerData);
  if (providerError || !provider) return null;

  return { provider, session, supabase };
}

function replaySigningKey() {
  const key = process.env.STEEL_API_KEY?.trim();
  if (!key) throw new Error("STEEL_API_KEY is not configured.");
  return key;
}

export function signReplayResource(browserSessionId: string, resourceUrl: string) {
  return createHmac("sha256", replaySigningKey())
    .update(`${browserSessionId}\n${resourceUrl}`)
    .digest("base64url");
}

export function verifyReplayResource(
  browserSessionId: string,
  resourceUrl: string,
  signature: string,
) {
  const supplied = Buffer.from(signature);
  const expected = Buffer.from(signReplayResource(browserSessionId, resourceUrl));
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function replayProxyUrl(
  origin: string,
  browserSessionId: string,
  resourceUrl: string,
) {
  const url = new URL(
    `/api/browser/sessions/${browserSessionId}/replay/resource`,
    origin,
  );
  url.searchParams.set("url", Buffer.from(resourceUrl).toString("base64url"));
  url.searchParams.set("signature", signReplayResource(browserSessionId, resourceUrl));
  return url.toString();
}

export function rewriteReplayManifest(
  manifest: string,
  manifestUrl: string,
  origin: string,
  browserSessionId: string,
) {
  return rewriteHlsManifest(manifest, manifestUrl, (absoluteResourceUrl) =>
    replayProxyUrl(origin, browserSessionId, absoluteResourceUrl),
  );
}

export async function fetchBrowserReplay(
  browserSessionId: string,
  resourceUrl?: string,
) {
  const owned = await loadOwnedBrowserSession(browserSessionId);
  if (!owned?.session.provider_session_id) return null;
  const adapter = createBrowserProviderAdapter(owned.provider.provider_key);
  const response = await adapter.fetchReplay(
    owned.session.provider_session_id,
    resourceUrl,
  );
  return { ...owned, response };
}
