alter table public.workflow_runs
  drop constraint if exists workflow_runs_runtime_capability_required_check;

alter table public.workflow_runs
  add constraint workflow_runs_runtime_capability_required_check check (
    workflow_definition_id not in (
      '00000000-0000-4000-8000-000000000301'::uuid,
      '00000000-0000-4000-8000-000000000403'::uuid,
      '00000000-0000-4000-8000-000000000503'::uuid
    )
    or runtime_capability_hash is not null
  );

create table public.model_definitions (
  id uuid primary key,
  model_key text not null unique,
  display_name text not null,
  provider text not null,
  provider_family text not null,
  provider_model_id text not null unique,
  tier text not null check (tier in ('standard', 'review', 'high_power', 'large_context')),
  status text not null check (status in ('candidate', 'qualified', 'failed', 'stale', 'retired')),
  context_window_tokens integer not null check (context_window_tokens > 0),
  max_output_tokens integer not null check (max_output_tokens > 0),
  capabilities jsonb not null check (jsonb_typeof(capabilities) = 'array'),
  input_price_per_million_usd numeric(18, 6) not null check (input_price_per_million_usd >= 0),
  output_price_per_million_usd numeric(18, 6) not null check (output_price_per_million_usd >= 0),
  cache_read_price_per_million_usd numeric(18, 6) check (
    cache_read_price_per_million_usd is null
    or cache_read_price_per_million_usd >= 0
  ),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint model_definitions_key_format check (
    model_key ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'
  ),
  constraint model_definitions_provider_length check (
    char_length(btrim(provider)) between 1 and 120
  ),
  constraint model_definitions_provider_model_length check (
    char_length(btrim(provider_model_id)) between 1 and 300
  )
);

create table public.model_qualifications (
  id uuid primary key,
  model_definition_id uuid not null references public.model_definitions(id) on delete cascade,
  qualification_type text not null check (
    qualification_type in ('structured_output', 'tool_use')
  ),
  status text not null check (status in ('candidate', 'qualified', 'failed', 'stale', 'retired')),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  checked_at timestamptz not null,
  qualified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (model_definition_id, qualification_type)
);

create table public.model_routes (
  id uuid primary key,
  route_key text not null unique,
  name text not null,
  description text not null,
  status text not null check (status in ('candidate', 'qualified', 'failed', 'stale', 'retired')),
  requirements jsonb not null check (jsonb_typeof(requirements) = 'object'),
  primary_model_definition_id uuid not null references public.model_definitions(id) on delete restrict,
  fallback_model_definition_id uuid not null references public.model_definitions(id) on delete restrict,
  maximum_attempts integer not null default 2 check (maximum_attempts between 1 and 3),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint model_routes_key_format check (
    route_key ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'
  ),
  constraint model_routes_distinct_models check (
    primary_model_definition_id <> fallback_model_definition_id
  )
);

alter table public.worker_runs
  drop constraint if exists worker_runs_model_identity_unique;

alter table public.worker_runs
  add constraint worker_runs_model_identity_unique
  unique (id, workflow_run_id, business_id);

create table public.model_invocations (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  workflow_run_id uuid not null,
  task_contract_id uuid not null,
  worker_run_id uuid not null,
  model_route_id uuid not null references public.model_routes(id) on delete restrict,
  model_definition_id uuid not null references public.model_definitions(id) on delete restrict,
  attempt integer not null check (attempt between 1 and 3),
  status text not null check (status in ('started', 'completed', 'failed', 'uncertain')),
  provider text not null,
  provider_model_id text not null,
  provider_request_id text,
  failure_category text,
  failure_message text,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  total_tokens integer not null default 0 check (total_tokens >= 0),
  cached_input_tokens integer not null default 0 check (cached_input_tokens >= 0),
  reasoning_tokens integer not null default 0 check (reasoning_tokens >= 0),
  reported_cost_usd numeric(18, 8) check (reported_cost_usd is null or reported_cost_usd >= 0),
  estimated_cost_usd numeric(18, 8) not null default 0 check (estimated_cost_usd >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  usage jsonb not null default '{}'::jsonb check (jsonb_typeof(usage) = 'object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint model_invocations_workflow_fk
    foreign key (workflow_run_id, business_id)
    references public.workflow_runs(id, business_id)
    on delete cascade,
  constraint model_invocations_task_fk
    foreign key (task_contract_id, workflow_run_id, business_id)
    references public.task_contracts(id, workflow_run_id, business_id)
    on delete cascade,
  constraint model_invocations_worker_fk
    foreign key (worker_run_id, workflow_run_id, business_id)
    references public.worker_runs(id, workflow_run_id, business_id)
    on delete cascade,
  unique (workflow_run_id, attempt),
  unique (id, business_id)
);

create index model_invocations_business_created_idx
  on public.model_invocations (business_id, created_at desc);
create index model_invocations_workflow_idx
  on public.model_invocations (workflow_run_id, attempt);
create index model_invocations_route_idx
  on public.model_invocations (model_route_id, created_at desc);

create trigger model_definitions_set_updated_at
before update on public.model_definitions
for each row execute function private.set_updated_at();

create trigger model_qualifications_set_updated_at
before update on public.model_qualifications
for each row execute function private.set_updated_at();

create trigger model_routes_set_updated_at
before update on public.model_routes
for each row execute function private.set_updated_at();

create trigger model_invocations_set_updated_at
before update on public.model_invocations
for each row execute function private.set_updated_at();

alter table public.model_definitions enable row level security;
alter table public.model_qualifications enable row level security;
alter table public.model_routes enable row level security;
alter table public.model_invocations enable row level security;

revoke all on table public.model_definitions from anon, authenticated;
revoke all on table public.model_qualifications from anon, authenticated;
revoke all on table public.model_routes from anon, authenticated;
revoke all on table public.model_invocations from anon, authenticated;

grant select on table public.model_definitions to authenticated;
grant select on table public.model_qualifications to authenticated;
grant select on table public.model_routes to authenticated;
grant select on table public.model_invocations to authenticated;

create policy model_definitions_read_authenticated
on public.model_definitions
for select
to authenticated
using ((select auth.uid()) is not null);

create policy model_qualifications_read_authenticated
on public.model_qualifications
for select
to authenticated
using ((select auth.uid()) is not null);

create policy model_routes_read_authenticated
on public.model_routes
for select
to authenticated
using ((select auth.uid()) is not null);

create policy model_invocations_read_owned
on public.model_invocations
for select
to authenticated
using (
  (select auth.uid()) is not null
  and (select private.is_business_owner(business_id))
);

insert into public.model_definitions (
  id, model_key, display_name, provider, provider_family, provider_model_id,
  tier, status, context_window_tokens, max_output_tokens, capabilities,
  input_price_per_million_usd, output_price_per_million_usd,
  cache_read_price_per_million_usd, metadata
)
values
  (
    '00000000-0000-4000-8000-000000000511',
    'luna.standard',
    'GPT-6 Luna',
    'openrouter',
    'openai',
    'openai/gpt-6-luna',
    'standard',
    'qualified',
    1050000,
    128000,
    '["structured_output","tool_use","large_context","reasoning","vision","files"]'::jsonb,
    0.10,
    0.50,
    0.01,
    '{"catalogSource":"openrouter","catalogCheckedAt":"2026-09-29T00:00:00.000Z"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000512',
    'gemini.flash.large',
    'Gemini 3.8 Flash',
    'openrouter',
    'google',
    'google/gemini-3.8-flash',
    'large_context',
    'qualified',
    1048576,
    65536,
    '["structured_output","tool_use","large_context","reasoning","vision","files"]'::jsonb,
    0.75,
    3.75,
    0.075,
    '{"catalogSource":"openrouter","catalogCheckedAt":"2026-09-29T00:00:00.000Z"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000513',
    'claude.haiku.review',
    'Claude Haiku 4.5',
    'openrouter',
    'anthropic',
    'anthropic/claude-haiku-4.5',
    'review',
    'qualified',
    200000,
    64000,
    '["structured_output","tool_use","reasoning","vision","files"]'::jsonb,
    1.00,
    5.00,
    0.10,
    '{"catalogSource":"openrouter","catalogCheckedAt":"2026-09-29T00:00:00.000Z"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000514',
    'sol.high-power',
    'GPT-6 Sol',
    'openrouter',
    'openai',
    'openai/gpt-6-sol',
    'high_power',
    'qualified',
    1050000,
    128000,
    '["structured_output","tool_use","large_context","reasoning","vision","files"]'::jsonb,
    2.00,
    10.00,
    0.20,
    '{"catalogSource":"openrouter","catalogCheckedAt":"2026-09-29T00:00:00.000Z"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000515',
    'claude.sonnet.high-power',
    'Claude Sonnet 4.6',
    'openrouter',
    'anthropic',
    'anthropic/claude-sonnet-4.6',
    'high_power',
    'qualified',
    1000000,
    128000,
    '["structured_output","tool_use","large_context","reasoning","vision","files"]'::jsonb,
    3.00,
    15.00,
    0.30,
    '{"catalogSource":"openrouter","catalogCheckedAt":"2026-09-29T00:00:00.000Z"}'::jsonb
  )
on conflict (model_key) do update
set
  display_name = excluded.display_name,
  provider = excluded.provider,
  provider_family = excluded.provider_family,
  provider_model_id = excluded.provider_model_id,
  tier = excluded.tier,
  status = excluded.status,
  context_window_tokens = excluded.context_window_tokens,
  max_output_tokens = excluded.max_output_tokens,
  capabilities = excluded.capabilities,
  input_price_per_million_usd = excluded.input_price_per_million_usd,
  output_price_per_million_usd = excluded.output_price_per_million_usd,
  cache_read_price_per_million_usd = excluded.cache_read_price_per_million_usd,
  metadata = excluded.metadata,
  updated_at = now();

insert into public.model_qualifications (
  id, model_definition_id, qualification_type, status, evidence,
  checked_at, qualified_at
)
values
  ('00000000-0000-4000-8000-000000000531', '00000000-0000-4000-8000-000000000511', 'structured_output', 'qualified', '{"source":"openrouter_catalog","liveValidated":false}'::jsonb, '2026-09-29T00:00:00Z', '2026-09-29T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000532', '00000000-0000-4000-8000-000000000511', 'tool_use', 'qualified', '{"source":"openrouter_catalog","liveValidated":false}'::jsonb, '2026-09-29T00:00:00Z', '2026-09-29T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000533', '00000000-0000-4000-8000-000000000512', 'structured_output', 'qualified', '{"source":"openrouter_catalog","liveValidated":false}'::jsonb, '2026-09-29T00:00:00Z', '2026-09-29T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000534', '00000000-0000-4000-8000-000000000512', 'tool_use', 'qualified', '{"source":"openrouter_catalog","liveValidated":false}'::jsonb, '2026-09-29T00:00:00Z', '2026-09-29T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000535', '00000000-0000-4000-8000-000000000513', 'structured_output', 'qualified', '{"source":"openrouter_catalog","liveValidated":false}'::jsonb, '2026-09-29T00:00:00Z', '2026-09-29T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000536', '00000000-0000-4000-8000-000000000513', 'tool_use', 'qualified', '{"source":"openrouter_catalog","liveValidated":false}'::jsonb, '2026-09-29T00:00:00Z', '2026-09-29T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000537', '00000000-0000-4000-8000-000000000514', 'structured_output', 'qualified', '{"source":"openrouter_catalog","liveValidated":false}'::jsonb, '2026-09-29T00:00:00Z', '2026-09-29T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000538', '00000000-0000-4000-8000-000000000514', 'tool_use', 'qualified', '{"source":"openrouter_catalog","liveValidated":false}'::jsonb, '2026-09-29T00:00:00Z', '2026-09-29T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000539', '00000000-0000-4000-8000-000000000515', 'structured_output', 'qualified', '{"source":"openrouter_catalog","liveValidated":false}'::jsonb, '2026-09-29T00:00:00Z', '2026-09-29T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000540', '00000000-0000-4000-8000-000000000515', 'tool_use', 'qualified', '{"source":"openrouter_catalog","liveValidated":false}'::jsonb, '2026-09-29T00:00:00Z', '2026-09-29T00:00:00Z')
on conflict (model_definition_id, qualification_type) do update
set
  status = excluded.status,
  evidence = excluded.evidence,
  checked_at = excluded.checked_at,
  qualified_at = excluded.qualified_at,
  updated_at = now();

insert into public.model_routes (
  id, route_key, name, description, status, requirements,
  primary_model_definition_id, fallback_model_definition_id,
  maximum_attempts, metadata
)
values
  (
    '00000000-0000-4000-8000-000000000521',
    'standard.default',
    'Standard workhorse',
    'Economical default for routine structured work, with a different provider family as fallback.',
    'qualified',
    '{"structuredOutput":true,"toolUse":false,"minimumContextTokens":200000,"preferredProviderFamily":"openai","independentFallback":true}'::jsonb,
    '00000000-0000-4000-8000-000000000511',
    '00000000-0000-4000-8000-000000000512',
    2,
    '{"policyVersion":"1.0.0"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000522',
    'reviewer.independent',
    'Independent reviewer',
    'Anthropic-family review route with an OpenAI-family fallback.',
    'qualified',
    '{"structuredOutput":true,"toolUse":false,"minimumContextTokens":200000,"preferredProviderFamily":"anthropic","independentFallback":true}'::jsonb,
    '00000000-0000-4000-8000-000000000513',
    '00000000-0000-4000-8000-000000000511',
    2,
    '{"policyVersion":"1.0.0"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000523',
    'escalation.high-power',
    'High-power escalation',
    'Bounded high-power route with an independent Claude-family fallback.',
    'qualified',
    '{"structuredOutput":true,"toolUse":true,"minimumContextTokens":1000000,"preferredProviderFamily":"openai","independentFallback":true}'::jsonb,
    '00000000-0000-4000-8000-000000000514',
    '00000000-0000-4000-8000-000000000515',
    2,
    '{"policyVersion":"1.0.0"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000524',
    'large-context',
    'Large-context specialist',
    'Gemini-class route for tasks that materially require very large context.',
    'qualified',
    '{"structuredOutput":true,"toolUse":true,"minimumContextTokens":1000000,"preferredProviderFamily":"google","independentFallback":true}'::jsonb,
    '00000000-0000-4000-8000-000000000512',
    '00000000-0000-4000-8000-000000000511',
    2,
    '{"policyVersion":"1.0.0"}'::jsonb
  )
on conflict (route_key) do update
set
  name = excluded.name,
  description = excluded.description,
  status = excluded.status,
  requirements = excluded.requirements,
  primary_model_definition_id = excluded.primary_model_definition_id,
  fallback_model_definition_id = excluded.fallback_model_definition_id,
  maximum_attempts = excluded.maximum_attempts,
  metadata = excluded.metadata,
  updated_at = now();

insert into public.packs (
  id, pack_key, version, name, kind, status, manifest
)
select
  '00000000-0000-4000-8000-000000000501'::uuid,
  'worker.generic-researcher',
  '1.0.0',
  'Generic Researcher',
  'worker',
  'experimental',
  manifest || jsonb_build_object(
    'packKey', 'worker.generic-researcher',
    'name', 'Generic Researcher',
    'worker', (manifest -> 'worker') || jsonb_build_object(
      'workerKey', 'generic.researcher',
      'version', '1.0.0'
    ),
    'modelRequirements', jsonb_build_object(
      'executionMode', 'model_router',
      'modelRouterRequired', true,
      'routeKey', 'standard.default',
      'structuredOutput', true,
      'toolUse', false,
      'minimumContextTokens', 200000,
      'fallbackRequired', true
    ),
    'escalationPolicy', jsonb_build_object(
      'providerFailure', 'use_one_qualified_fallback_then_stop',
      'validationFailure', 'fail_task',
      'unavailableKnowledge', 'fail_task',
      'unexpectedFailure', 'classify_and_stop'
    )
  )
from public.packs
where id = '00000000-0000-4000-8000-000000000401'
on conflict (pack_key, version) do update
set
  name = excluded.name,
  kind = excluded.kind,
  status = excluded.status,
  manifest = excluded.manifest,
  updated_at = now();

insert into public.worker_definitions (
  id, pack_id, worker_key, version, name, role, charter, status,
  input_schema, output_schema, knowledge_requirements,
  capability_requirements, model_requirements
)
select
  '00000000-0000-4000-8000-000000000502'::uuid,
  '00000000-0000-4000-8000-000000000501'::uuid,
  'generic.researcher',
  '1.0.0',
  'Generic Researcher',
  role,
  charter,
  'experimental',
  input_schema,
  output_schema,
  knowledge_requirements,
  capability_requirements,
  '{"executionMode":"model_router","modelRouterRequired":true,"routeKey":"standard.default","structuredOutput":true,"toolUse":false,"minimumContextTokens":200000,"fallbackRequired":true}'::jsonb
from public.worker_definitions
where id = '00000000-0000-4000-8000-000000000402'
on conflict (pack_id, worker_key, version) do update
set
  name = excluded.name,
  role = excluded.role,
  charter = excluded.charter,
  status = excluded.status,
  input_schema = excluded.input_schema,
  output_schema = excluded.output_schema,
  knowledge_requirements = excluded.knowledge_requirements,
  capability_requirements = excluded.capability_requirements,
  model_requirements = excluded.model_requirements,
  updated_at = now();

insert into public.workflow_definitions (
  id, pack_id, workflow_key, version, name, description, status,
  input_schema, output_schema, stage_definition
)
values (
  '00000000-0000-4000-8000-000000000503',
  '00000000-0000-4000-8000-000000000201',
  'synthetic.model-router.runtime-proof',
  '1.0.0',
  'Synthetic Model Router Runtime Proof',
  'Stage 5 proof that a bounded worker contract resolves through a qualified logical route, records provider telemetry and cost, and uses at most one meaningful fallback.',
  'experimental',
  '{"type":"object","required":["businessId","coreWorkflowRunId","runtimeCapability","proofMode"],"additionalProperties":false}'::jsonb,
  '{"type":"object","required":["coreWorkflowRunId","runtimeRunId","status","selectedModelKey","modelRouteKey","workerOutput","workerReceipt"],"additionalProperties":false}'::jsonb,
  '{"stages":[{"key":"start","type":"system","sequence":0},{"key":"task-contract","type":"contract","sequence":1},{"key":"route","type":"model-route","sequence":2},{"key":"worker","type":"worker","sequence":3},{"key":"validate","type":"validation","sequence":4},{"key":"complete","type":"terminal","sequence":5}]}'::jsonb
)
on conflict (pack_id, workflow_key, version) do update
set
  name = excluded.name,
  description = excluded.description,
  status = excluded.status,
  input_schema = excluded.input_schema,
  output_schema = excluded.output_schema,
  stage_definition = excluded.stage_definition,
  updated_at = now();

create or replace function private.stage5_deterministic_uuid(p_value text)
returns uuid
language sql
immutable
strict
set search_path = ''
as $$
  select (
    substr(md5(p_value), 1, 8) || '-' ||
    substr(md5(p_value), 9, 4) || '-' ||
    '5' || substr(md5(p_value), 14, 3) || '-' ||
    'a' || substr(md5(p_value), 18, 3) || '-' ||
    substr(md5(p_value), 21, 12)
  )::uuid;
$$;

revoke all on function private.stage5_deterministic_uuid(text)
  from public, anon, authenticated;

create or replace function public.begin_model_router_workflow_run(
  p_business_id uuid,
  p_idempotency_key text,
  p_launch_nonce uuid,
  p_runtime_capability text,
  p_proof_mode text default 'live'
)
returns table (
  workflow_run_id uuid,
  should_start boolean,
  runtime_launch_status text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_workflow_run_id uuid;
  v_launch_status text;
begin
  if not private.is_business_owner(p_business_id) then
    raise exception 'Business ownership is required.' using errcode = '42501';
  end if;

  if p_launch_nonce is null then
    raise exception 'A launch nonce is required.' using errcode = '22023';
  end if;

  if p_runtime_capability is null
    or char_length(p_runtime_capability) < 32
    or char_length(p_runtime_capability) > 512 then
    raise exception 'The runtime capability is invalid.' using errcode = '22023';
  end if;

  if p_proof_mode not in ('live', 'fallback-proof') then
    raise exception 'The model proof mode is invalid.' using errcode = '22023';
  end if;

  if p_idempotency_key is null
    or char_length(btrim(p_idempotency_key)) < 1
    or char_length(btrim(p_idempotency_key)) > 200 then
    raise exception 'The idempotency key is invalid.' using errcode = '22023';
  end if;

  insert into public.workflow_runs (
    business_id,
    workflow_definition_id,
    status,
    current_stage_key,
    idempotency_key,
    input,
    state,
    runtime_provider,
    runtime_launch_status,
    runtime_launch_nonce,
    runtime_launch_reserved_at,
    runtime_capability_hash
  )
  values (
    p_business_id,
    '00000000-0000-4000-8000-000000000503',
    'queued',
    null,
    btrim(p_idempotency_key),
    jsonb_build_object('proofMode', p_proof_mode),
    jsonb_build_object(
      'runtime', 'vercel_workflow',
      'workerKey', 'generic.researcher',
      'workerVersion', '1.0.0',
      'modelRouteKey', 'standard.default'
    ),
    'vercel_workflow',
    'reserved',
    p_launch_nonce,
    now(),
    encode(
      extensions.digest(convert_to(p_runtime_capability, 'UTF8'), 'sha256'),
      'hex'
    )
  )
  on conflict (business_id, idempotency_key) do nothing
  returning id, workflow_runs.runtime_launch_status
  into v_workflow_run_id, v_launch_status;

  if v_workflow_run_id is not null then
    insert into public.events (
      id, business_id, workflow_run_id, event_type, actor_type, payload
    )
    values (
      private.stage5_deterministic_uuid(
        'event:' || v_workflow_run_id::text || ':workflow.queued'
      ),
      p_business_id,
      v_workflow_run_id,
      'workflow.queued',
      'owner',
      jsonb_build_object(
        'workflowKey', 'synthetic.model-router.runtime-proof',
        'proofMode', p_proof_mode
      )
    )
    on conflict (id) do nothing;

    return query select v_workflow_run_id, true, v_launch_status;
    return;
  end if;

  select id, workflow_runs.runtime_launch_status
  into v_workflow_run_id, v_launch_status
  from public.workflow_runs
  where business_id = p_business_id
    and idempotency_key = btrim(p_idempotency_key);

  return query select v_workflow_run_id, false, v_launch_status;
end;
$$;

revoke all on function public.begin_model_router_workflow_run(uuid, text, uuid, text, text)
  from public, anon;
grant execute on function public.begin_model_router_workflow_run(uuid, text, uuid, text, text)
  to authenticated;

comment on table public.model_definitions is 'Provider-neutral model registry with current capabilities and price metadata.';
comment on table public.model_qualifications is 'Structured-output and tool-use qualification evidence for registered models.';
comment on table public.model_routes is 'Logical model routes with one qualified primary and one bounded fallback.';
comment on table public.model_invocations is 'Business-scoped provider telemetry, token usage and cost for model calls.';