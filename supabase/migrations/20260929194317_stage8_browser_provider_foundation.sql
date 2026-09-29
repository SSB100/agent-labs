create table public.browser_provider_definitions (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null unique,
  name text not null,
  status text not null check (status in ('candidate', 'selected', 'qualified', 'retired')),
  is_default boolean not null default false,
  api_base_url text not null,
  capabilities jsonb not null default '{}'::jsonb check (jsonb_typeof(capabilities) = 'object'),
  pricing jsonb not null default '{}'::jsonb check (jsonb_typeof(pricing) = 'object'),
  evaluation jsonb not null default '{}'::jsonb check (jsonb_typeof(evaluation) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint browser_provider_definitions_key_format check (
    provider_key ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'
  ),
  constraint browser_provider_definitions_name_length check (
    char_length(btrim(name)) between 1 and 120
  ),
  constraint browser_provider_definitions_api_url check (
    api_base_url ~ '^https://'
  )
);

create unique index browser_provider_definitions_one_default_idx
  on public.browser_provider_definitions (is_default)
  where is_default;

create table public.browser_identities (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider_definition_id uuid not null references public.browser_provider_definitions(id) on delete restrict,
  identity_key text not null,
  label text not null,
  provider_profile_id text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, identity_key),
  unique (provider_definition_id, provider_profile_id),
  unique (id, business_id),
  constraint browser_identities_key_format check (
    identity_key ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'
  ),
  constraint browser_identities_label_length check (
    char_length(btrim(label)) between 1 and 160
  ),
  constraint browser_identities_profile_length check (
    char_length(btrim(provider_profile_id)) between 1 and 300
  )
);

create table public.browser_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  workflow_run_id uuid not null,
  provider_definition_id uuid not null references public.browser_provider_definitions(id) on delete restrict,
  browser_identity_id uuid not null,
  provider_session_id text,
  status text not null default 'reserved' check (
    status in ('reserved', 'launching', 'live', 'human_control', 'returning', 'released', 'failed')
  ),
  control_mode text not null default 'automation' check (
    control_mode in ('automation', 'human', 'released')
  ),
  live_view_status text not null default 'pending' check (
    live_view_status in ('pending', 'ready', 'unavailable')
  ),
  replay_status text not null default 'pending' check (
    replay_status in ('pending', 'ready', 'unavailable')
  ),
  current_url text,
  page_title text,
  region text,
  browser_mode text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  failure jsonb not null default '{}'::jsonb check (jsonb_typeof(failure) = 'object'),
  started_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workflow_run_id),
  unique (id, business_id),
  constraint browser_sessions_workflow_fk foreign key (workflow_run_id, business_id)
    references public.workflow_runs(id, business_id) on delete cascade,
  constraint browser_sessions_identity_fk foreign key (browser_identity_id, business_id)
    references public.browser_identities(id, business_id) on delete restrict,
  constraint browser_sessions_provider_session_length check (
    provider_session_id is null or char_length(btrim(provider_session_id)) between 1 and 300
  )
);

create unique index browser_sessions_provider_session_idx
  on public.browser_sessions (provider_definition_id, provider_session_id)
  where provider_session_id is not null;

create table private.browser_session_secrets (
  browser_session_id uuid primary key references public.browser_sessions(id) on delete cascade,
  debug_url text,
  session_viewer_url text,
  websocket_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.browser_session_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  workflow_run_id uuid not null,
  browser_session_id uuid not null,
  event_type text not null,
  control_mode text not null check (control_mode in ('automation', 'human', 'released')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint browser_session_events_workflow_fk foreign key (workflow_run_id, business_id)
    references public.workflow_runs(id, business_id) on delete cascade,
  constraint browser_session_events_session_fk foreign key (browser_session_id, business_id)
    references public.browser_sessions(id, business_id) on delete cascade,
  constraint browser_session_events_type_length check (
    char_length(btrim(event_type)) between 1 and 200
  )
);

create index browser_identities_business_idx
  on public.browser_identities (business_id, status, created_at desc);
create index browser_sessions_business_created_idx
  on public.browser_sessions (business_id, created_at desc);
create index browser_sessions_status_idx
  on public.browser_sessions (status, updated_at desc);
create index browser_session_events_session_idx
  on public.browser_session_events (browser_session_id, occurred_at);
create index browser_session_events_workflow_idx
  on public.browser_session_events (workflow_run_id, occurred_at);

create trigger browser_provider_definitions_set_updated_at
before update on public.browser_provider_definitions
for each row execute function private.set_updated_at();

create trigger browser_identities_set_updated_at
before update on public.browser_identities
for each row execute function private.set_updated_at();

create trigger browser_sessions_set_updated_at
before update on public.browser_sessions
for each row execute function private.set_updated_at();

create trigger browser_session_secrets_set_updated_at
before update on private.browser_session_secrets
for each row execute function private.set_updated_at();

alter table public.browser_provider_definitions enable row level security;
alter table public.browser_identities enable row level security;
alter table public.browser_sessions enable row level security;
alter table public.browser_session_events enable row level security;

revoke all on table public.browser_provider_definitions from anon, authenticated;
revoke all on table public.browser_identities from anon, authenticated;
revoke all on table public.browser_sessions from anon, authenticated;
revoke all on table public.browser_session_events from anon, authenticated;
revoke all on table private.browser_session_secrets from public, anon, authenticated, service_role;

grant select on table public.browser_provider_definitions to authenticated;
grant select on table public.browser_identities to authenticated;
grant select on table public.browser_sessions to authenticated;
grant select on table public.browser_session_events to authenticated;

create policy browser_provider_definitions_read_authenticated
on public.browser_provider_definitions
for select
to authenticated
using ((select auth.uid()) is not null);

create policy browser_identities_owner_read
on public.browser_identities
for select
to authenticated
using (private.is_business_owner(business_id));

create policy browser_sessions_owner_read
on public.browser_sessions
for select
to authenticated
using (private.is_business_owner(business_id));

create policy browser_session_events_owner_read
on public.browser_session_events
for select
to authenticated
using (private.is_business_owner(business_id));

insert into public.browser_provider_definitions (
  id,
  provider_key,
  name,
  status,
  is_default,
  api_base_url,
  capabilities,
  pricing,
  evaluation
)
values
  (
    '00000000-0000-4000-8000-000000000811',
    'steel',
    'Steel',
    'selected',
    true,
    'https://api.steel.dev',
    jsonb_build_object(
      'remoteChromium', true,
      'persistentProfiles', true,
      'liveEmbed', true,
      'liveTransport', 'webrtc_h264_25fps',
      'humanTakeover', true,
      'returnControl', true,
      'replay', true,
      'replayFormat', 'hls_mp4',
      'playwrightCdp', true,
      'fileUpload', true,
      'isolatedSessions', true,
      'selfHostable', true
    ),
    jsonb_build_object(
      'launchMonthlyUsd', 0,
      'launchBrowserHourUsd', 0.10,
      'launchConcurrency', 10,
      'launchMaxSessionMinutes', 15,
      'launchOneTimeCreditsUsd', 30,
      'scaleMonthlyUsd', 250,
      'scaleBrowserHourUsd', 0.08,
      'sourceCheckedAt', '2026-09-30T00:00:00Z'
    ),
    jsonb_build_object(
      'selection', 'default',
      'reason', 'Meets the full Stage 8 capability contract, has lower entry cost, and preserves a self-hosted migration path.',
      'officialDocsReviewed', true,
      'liveQualified', false,
      'selectedAt', now()
    )
  ),
  (
    '00000000-0000-4000-8000-000000000812',
    'browserbase',
    'Browserbase',
    'candidate',
    false,
    'https://api.browserbase.com',
    jsonb_build_object(
      'remoteChromium', true,
      'persistentProfiles', true,
      'liveEmbed', true,
      'humanTakeover', true,
      'returnControl', true,
      'replay', true,
      'playwrightCdp', true,
      'fileUpload', true,
      'isolatedSessions', true,
      'selfHostable', false
    ),
    jsonb_build_object(
      'freeMonthlyUsd', 0,
      'freeBrowserHours', 1,
      'freeConcurrency', 3,
      'developerMonthlyUsd', 20,
      'developerIncludedBrowserHours', 100,
      'developerOverageBrowserHourUsd', 0.12,
      'startupMonthlyUsd', 99,
      'startupIncludedBrowserHours', 500,
      'sourceCheckedAt', '2026-09-30T00:00:00Z'
    ),
    jsonb_build_object(
      'selection', 'qualified_alternative_candidate',
      'reason', 'Strong managed-cloud scale, live debugging and replay, retained behind the provider-neutral contract.',
      'officialDocsReviewed', true,
      'liveQualified', false,
      'evaluatedAt', now()
    )
  )
on conflict (provider_key) do update
set
  name = excluded.name,
  status = excluded.status,
  is_default = excluded.is_default,
  api_base_url = excluded.api_base_url,
  capabilities = excluded.capabilities,
  pricing = excluded.pricing,
  evaluation = excluded.evaluation,
  updated_at = now();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'browser_identities',
    'browser_sessions',
    'browser_session_events'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables publication_table
      where publication_table.pubname = 'supabase_realtime'
        and publication_table.schemaname = 'public'
        and publication_table.tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;

comment on table public.browser_provider_definitions is
  'Provider-neutral remote browser registry and Stage 8 comparison evidence.';
comment on table public.browser_identities is
  'Opaque, Business-scoped persistent browser identities. Provider credentials never enter Worker context.';
comment on table public.browser_sessions is
  'Durable workflow-owned remote browser sessions and control state.';
comment on table private.browser_session_secrets is
  'Provider URLs and automation endpoints. Never exposed as normal application records.';
comment on table public.browser_session_events is
  'Append-only browser lifecycle, observation, takeover, return-control and replay evidence.';
