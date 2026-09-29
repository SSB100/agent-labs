alter table public.workflow_runs
  drop constraint if exists workflow_runs_runtime_capability_required_check;

alter table public.workflow_runs
  add constraint workflow_runs_runtime_capability_required_check check (
    workflow_definition_id not in (
      '00000000-0000-4000-8000-000000000301'::uuid,
      '00000000-0000-4000-8000-000000000403'::uuid,
      '00000000-0000-4000-8000-000000000503'::uuid
    ) or runtime_capability_hash is not null
  );

create table if not exists public.model_definitions (
  id uuid primary key,
  model_key text not null unique,
  display_name text not null,
  provider text not null,
  provider_family text not null,
  provider_model_id text not null unique,
  tier text not null check (tier in ('standard','review','high_power','large_context')),
  status text not null check (status in ('candidate','qualified','failed','stale','retired')),
  context_window_tokens integer not null check (context_window_tokens > 0),
  max_output_tokens integer not null check (max_output_tokens > 0),
  capabilities jsonb not null check (jsonb_typeof(capabilities) = 'array'),
  input_price_per_million_usd numeric(18,6) not null check (input_price_per_million_usd >= 0),
  output_price_per_million_usd numeric(18,6) not null check (output_price_per_million_usd >= 0),
  cache_read_price_per_million_usd numeric(18,6) check (cache_read_price_per_million_usd is null or cache_read_price_per_million_usd >= 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint model_definitions_key_format check (model_key ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$')
);

create table if not exists public.model_qualifications (
  id uuid primary key,
  model_definition_id uuid not null references public.model_definitions(id) on delete cascade,
  qualification_type text not null check (qualification_type in ('structured_output','tool_use')),
  status text not null check (status in ('candidate','qualified','failed','stale','retired')),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  checked_at timestamptz not null,
  qualified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (model_definition_id, qualification_type)
);

create table if not exists public.model_routes (
  id uuid primary key,
  route_key text not null unique,
  name text not null,
  description text not null,
  status text not null check (status in ('candidate','qualified','failed','stale','retired')),
  requirements jsonb not null check (jsonb_typeof(requirements) = 'object'),
  primary_model_definition_id uuid not null references public.model_definitions(id) on delete restrict,
  fallback_model_definition_id uuid not null references public.model_definitions(id) on delete restrict,
  maximum_attempts integer not null default 2 check (maximum_attempts between 1 and 3),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint model_routes_key_format check (route_key ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'),
  constraint model_routes_distinct_models check (primary_model_definition_id <> fallback_model_definition_id)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'worker_runs_model_identity_unique'
      and conrelid = 'public.worker_runs'::regclass
  ) then
    alter table public.worker_runs
      add constraint worker_runs_model_identity_unique
      unique (id, workflow_run_id, business_id);
  end if;
end;
$$;

create table if not exists public.model_invocations (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  workflow_run_id uuid not null,
  task_contract_id uuid not null,
  worker_run_id uuid not null,
  model_route_id uuid not null references public.model_routes(id) on delete restrict,
  model_definition_id uuid not null references public.model_definitions(id) on delete restrict,
  attempt integer not null check (attempt between 1 and 3),
  status text not null check (status in ('started','completed','failed','uncertain')),
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
  reported_cost_usd numeric(18,8) check (reported_cost_usd is null or reported_cost_usd >= 0),
  estimated_cost_usd numeric(18,8) not null default 0 check (estimated_cost_usd >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  usage jsonb not null default '{}'::jsonb check (jsonb_typeof(usage) = 'object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint model_invocations_workflow_fk foreign key (workflow_run_id,business_id)
    references public.workflow_runs(id,business_id) on delete cascade,
  constraint model_invocations_task_fk foreign key (task_contract_id,workflow_run_id,business_id)
    references public.task_contracts(id,workflow_run_id,business_id) on delete cascade,
  constraint model_invocations_worker_fk foreign key (worker_run_id,workflow_run_id,business_id)
    references public.worker_runs(id,workflow_run_id,business_id) on delete cascade,
  unique (workflow_run_id, attempt),
  unique (id, business_id)
);

create index if not exists model_invocations_business_created_idx
  on public.model_invocations (business_id, created_at desc);
create index if not exists model_invocations_workflow_idx
  on public.model_invocations (workflow_run_id, attempt);
create index if not exists model_invocations_route_idx
  on public.model_invocations (model_route_id, created_at desc);

drop trigger if exists model_definitions_set_updated_at on public.model_definitions;
create trigger model_definitions_set_updated_at before update on public.model_definitions
for each row execute function private.set_updated_at();
drop trigger if exists model_qualifications_set_updated_at on public.model_qualifications;
create trigger model_qualifications_set_updated_at before update on public.model_qualifications
for each row execute function private.set_updated_at();
drop trigger if exists model_routes_set_updated_at on public.model_routes;
create trigger model_routes_set_updated_at before update on public.model_routes
for each row execute function private.set_updated_at();
drop trigger if exists model_invocations_set_updated_at on public.model_invocations;
create trigger model_invocations_set_updated_at before update on public.model_invocations
for each row execute function private.set_updated_at();

alter table public.model_definitions enable row level security;
alter table public.model_qualifications enable row level security;
alter table public.model_routes enable row level security;
alter table public.model_invocations enable row level security;

revoke all on public.model_definitions, public.model_qualifications,
  public.model_routes, public.model_invocations from anon, authenticated;
grant select on public.model_definitions, public.model_qualifications,
  public.model_routes, public.model_invocations to authenticated;

drop policy if exists model_definitions_read_authenticated on public.model_definitions;
create policy model_definitions_read_authenticated on public.model_definitions
for select to authenticated using ((select auth.uid()) is not null);
drop policy if exists model_qualifications_read_authenticated on public.model_qualifications;
create policy model_qualifications_read_authenticated on public.model_qualifications
for select to authenticated using ((select auth.uid()) is not null);
drop policy if exists model_routes_read_authenticated on public.model_routes;
create policy model_routes_read_authenticated on public.model_routes
for select to authenticated using ((select auth.uid()) is not null);
drop policy if exists model_invocations_read_owned on public.model_invocations;
create policy model_invocations_read_owned on public.model_invocations
for select to authenticated using (
  (select auth.uid()) is not null
  and (select private.is_business_owner(business_id))
);