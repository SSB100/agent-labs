import type { SupabaseClient } from "@supabase/supabase-js";

import type { OwnerUiContext } from "./data";
import type { UiJson } from "./workflows";

export type BrowserProviderDefinitionRecord = {
  id: string;
  provider_key: "steel" | "browserbase";
  name: string;
  status: string;
  is_default: boolean;
  api_base_url: string;
  capabilities: UiJson;
  pricing: UiJson;
  evaluation: UiJson;
  created_at: string;
  updated_at: string;
};

export type BrowserIdentityRecord = {
  id: string;
  business_id: string;
  provider_definition_id: string;
  identity_key: string;
  label: string;
  provider_profile_id: string;
  status: string;
  metadata: UiJson;
  created_at: string;
  updated_at: string;
};

export type BrowserSessionRecord = {
  id: string;
  business_id: string;
  workflow_run_id: string;
  provider_definition_id: string;
  browser_identity_id: string;
  provider_session_id: string | null;
  status: string;
  control_mode: string;
  live_view_status: string;
  replay_status: string;
  current_url: string | null;
  page_title: string | null;
  region: string | null;
  browser_mode: string | null;
  metadata: UiJson;
  failure: UiJson;
  started_at: string | null;
  released_at: string | null;
  created_at: string;
  updated_at: string;
};

export type BrowserSessionEventRecord = {
  id: string;
  business_id: string;
  workflow_run_id: string;
  browser_session_id: string;
  event_type: string;
  control_mode: string;
  payload: UiJson;
  occurred_at: string;
  created_at: string;
};

export type BrowserWorkflowData = {
  session: BrowserSessionRecord | null;
  provider: BrowserProviderDefinitionRecord | null;
  identity: BrowserIdentityRecord | null;
  events: BrowserSessionEventRecord[];
  liveViewUrl: string | null;
  replayUrl: string | null;
  errors: string[];
};

const PROVIDER_SELECT =
  "id, provider_key, name, status, is_default, api_base_url, capabilities, pricing, evaluation, created_at, updated_at";
const IDENTITY_SELECT =
  "id, business_id, provider_definition_id, identity_key, label, provider_profile_id, status, metadata, created_at, updated_at";
const SESSION_SELECT =
  "id, business_id, workflow_run_id, provider_definition_id, browser_identity_id, provider_session_id, status, control_mode, live_view_status, replay_status, current_url, page_title, region, browser_mode, metadata, failure, started_at, released_at, created_at, updated_at";
const EVENT_SELECT =
  "id, business_id, workflow_run_id, browser_session_id, event_type, control_mode, payload, occurred_at, created_at";

function row<T>(value: unknown): T | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as T)
    : null;
}

function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function errorMessage(error: unknown) {
  return error && typeof error === "object" && "message" in error
    ? String(error.message)
    : "Unknown browser data error";
}

export async function loadBrowserWorkflowData(
  supabase: SupabaseClient,
  workflowRunId: string,
): Promise<BrowserWorkflowData> {
  const sessionResult = await supabase
    .from("browser_sessions")
    .select(SESSION_SELECT)
    .eq("workflow_run_id", workflowRunId)
    .maybeSingle();
  const session = row<BrowserSessionRecord>(sessionResult.data);
  const errors = sessionResult.error ? [errorMessage(sessionResult.error)] : [];

  if (!session) {
    return {
      session: null,
      provider: null,
      identity: null,
      events: [],
      liveViewUrl: null,
      replayUrl: null,
      errors,
    };
  }

  const [providerResult, identityResult, eventResult, liveResult, replayResult] =
    await Promise.all([
      supabase
        .from("browser_provider_definitions")
        .select(PROVIDER_SELECT)
        .eq("id", session.provider_definition_id)
        .maybeSingle(),
      supabase
        .from("browser_identities")
        .select(IDENTITY_SELECT)
        .eq("id", session.browser_identity_id)
        .maybeSingle(),
      supabase
        .from("browser_session_events")
        .select(EVENT_SELECT)
        .eq("browser_session_id", session.id)
        .order("occurred_at", { ascending: false }),
      session.status === "live" ||
      session.status === "human_control" ||
      session.status === "returning"
        ? supabase.rpc("get_browser_session_live_view", {
            p_browser_session_id: session.id,
            p_interactive: session.control_mode === "human",
          })
        : Promise.resolve({ data: null, error: null }),
      session.replay_status === "ready"
        ? supabase.rpc("get_browser_session_replay", {
            p_browser_session_id: session.id,
          })
        : Promise.resolve({ data: null, error: null }),
    ]);

  for (const result of [
    providerResult,
    identityResult,
    eventResult,
    liveResult,
    replayResult,
  ]) {
    if (result.error) errors.push(errorMessage(result.error));
  }

  return {
    session,
    provider: row<BrowserProviderDefinitionRecord>(providerResult.data),
    identity: row<BrowserIdentityRecord>(identityResult.data),
    events: rows<BrowserSessionEventRecord>(eventResult.data),
    liveViewUrl:
      typeof liveResult.data === "string" && liveResult.data.trim()
        ? liveResult.data
        : null,
    replayUrl:
      typeof replayResult.data === "string" && replayResult.data.trim()
        ? replayResult.data
        : null,
    errors,
  };
}

export async function loadBrowserControlCentre(context: OwnerUiContext) {
  const businessIds = context.businesses.map((business) => business.id);
  const providerResult = await context.supabase
    .from("browser_provider_definitions")
    .select(PROVIDER_SELECT)
    .order("is_default", { ascending: false })
    .order("provider_key");

  if (!businessIds.length) {
    return {
      providers: rows<BrowserProviderDefinitionRecord>(providerResult.data),
      sessions: [] as BrowserSessionRecord[],
      identities: [] as BrowserIdentityRecord[],
      events: [] as BrowserSessionEventRecord[],
      errors: providerResult.error ? [errorMessage(providerResult.error)] : [],
    };
  }

  const [sessionResult, identityResult, eventResult] = await Promise.all([
    context.supabase
      .from("browser_sessions")
      .select(SESSION_SELECT)
      .in("business_id", businessIds)
      .order("created_at", { ascending: false })
      .limit(50),
    context.supabase
      .from("browser_identities")
      .select(IDENTITY_SELECT)
      .in("business_id", businessIds)
      .order("created_at", { ascending: false }),
    context.supabase
      .from("browser_session_events")
      .select(EVENT_SELECT)
      .in("business_id", businessIds)
      .order("occurred_at", { ascending: false })
      .limit(100),
  ]);

  const errors = [] as string[];
  for (const result of [providerResult, sessionResult, identityResult, eventResult]) {
    if (result.error) errors.push(errorMessage(result.error));
  }

  return {
    providers: rows<BrowserProviderDefinitionRecord>(providerResult.data),
    sessions: rows<BrowserSessionRecord>(sessionResult.data),
    identities: rows<BrowserIdentityRecord>(identityResult.data),
    events: rows<BrowserSessionEventRecord>(eventResult.data),
    errors,
  };
}
