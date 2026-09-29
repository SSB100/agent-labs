export type BrowserProviderDefinitionRecord = {
  id: string;
  provider_key: "steel" | "browserbase";
  name: string;
  status: string;
  is_default: boolean;
  api_base_url: string;
  capabilities: Record<string, unknown>;
  pricing: Record<string, unknown>;
  evaluation: Record<string, unknown>;
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
  metadata: Record<string, unknown>;
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
  control_mode: "automation" | "human" | "released";
  live_view_status: string;
  replay_status: string;
  current_url: string | null;
  page_title: string | null;
  region: string | null;
  browser_mode: string | null;
  metadata: Record<string, unknown>;
  failure: Record<string, unknown>;
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
  control_mode: "automation" | "human" | "released";
  payload: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
};
