create table if not exists public.worker_evaluation_suites (
  id uuid primary key default gen_random_uuid(),
  worker_definition_id uuid not null references public.worker_definitions(id) on delete cascade,
  suite_key text not null,
  version text not null,
  name text not null,
  description text not null,
  status text not null default 'active' check (status in ('active', 'retired')),
  minimum_score numeric(5, 2) not null check (minimum_score between 0 and 100),
  require_all_required boolean not null default true,
  manifest jsonb not null default '{}'::jsonb check (jsonb_typeof(manifest) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (worker_definition_id, suite_key, version),
  constraint worker_evaluation_suites_key_format check (
    suite_key ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'
  ),
  constraint worker_evaluation_suites_version_format check (
    version ~ '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$'
  ),
  constraint worker_evaluation_suites_name_length check (
    char_length(btrim(name)) between 1 and 160
  )
);

create table if not exists public.worker_evaluation_cases (
  id uuid primary key default gen_random_uuid(),
  suite_id uuid not null references public.worker_evaluation_suites(id) on delete cascade,
  case_key text not null,
  name text not null,
  description text not null,
  category text not null check (
    category in ('schema', 'role_boundary', 'capability', 'positive_example', 'negative_example')
  ),
  execution_mode text not null check (
    execution_mode in ('deterministic_output', 'live_model', 'mock_capability')
  ),
  model_target text not null default 'none' check (
    model_target in ('none', 'primary', 'fallback')
  ),
  required boolean not null default true,
  weight numeric(8, 3) not null default 1 check (weight > 0),
  fixture jsonb not null default '{}'::jsonb check (jsonb_typeof(fixture) = 'object'),
  expectation jsonb not null default '{}'::jsonb check (jsonb_typeof(expectation) = 'object'),
  covers_positive_examples text[] not null default array[]::text[],
  covers_negative_examples text[] not null default array[]::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (suite_id, case_key),
  constraint worker_evaluation_cases_key_format check (
    case_key ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'
  ),
  constraint worker_evaluation_cases_model_target check (
    (execution_mode = 'live_model' and model_target in ('primary', 'fallback'))
    or (execution_mode <> 'live_model' and model_target = 'none')
  )
);

create table if not exists public.worker_evaluations (
  id uuid primary key default gen_random_uuid(),
  worker_definition_id uuid not null references public.worker_definitions(id) on delete cascade,
  suite_id uuid not null references public.worker_evaluation_suites(id) on delete restrict,
  model_route_id uuid references public.model_routes(id) on delete restrict,
  primary_model_definition_id uuid references public.model_definitions(id) on delete restrict,
  fallback_model_definition_id uuid references public.model_definitions(id) on delete restrict,
  requested_by uuid references auth.users(id) on delete set null,
  source text not null check (source in ('owner', 'preview_qualification', 'regression')),
  idempotency_key text not null,
  status text not null default 'running' check (
    status in ('running', 'passed', 'failed', 'stale', 'cancelled')
  ),
  score numeric(5, 2),
  passed_case_count integer not null default 0 check (passed_case_count >= 0),
  failed_case_count integer not null default 0 check (failed_case_count >= 0),
  required_case_count integer not null default 0 check (required_case_count >= 0),
  required_failure_count integer not null default 0 check (required_failure_count >= 0),
  subject_fingerprint text not null,
  runtime_capability_hash text not null,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requested_by, worker_definition_id, idempotency_key),
  constraint worker_evaluations_idempotency_length check (
    char_length(btrim(idempotency_key)) between 1 and 200
  ),
  constraint worker_evaluations_fingerprint_format check (
    subject_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  constraint worker_evaluations_capability_hash_format check (
    runtime_capability_hash ~ '^[0-9a-f]{64}$'
  )
);

create table if not exists public.worker_evaluation_case_results (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.worker_evaluations(id) on delete cascade,
  case_id uuid not null references public.worker_evaluation_cases(id) on delete restrict,
  status text not null check (status in ('passed', 'failed', 'error')),
  score_awarded numeric(8, 3) not null default 0 check (score_awarded >= 0),
  model_definition_id uuid references public.model_definitions(id) on delete restrict,
  provider text,
  provider_model_id text,
  provider_request_id text,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  total_tokens integer not null default 0 check (total_tokens >= 0),
  cached_input_tokens integer not null default 0 check (cached_input_tokens >= 0),
  reasoning_tokens integer not null default 0 check (reasoning_tokens >= 0),
  reported_cost_usd numeric(18, 8) check (reported_cost_usd is null or reported_cost_usd >= 0),
  estimated_cost_usd numeric(18, 8) not null default 0 check (estimated_cost_usd >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  output jsonb,
  failure jsonb not null default '{}'::jsonb check (jsonb_typeof(failure) = 'object'),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (evaluation_id, case_id),
  constraint worker_evaluation_case_results_output_object check (
    output is null or jsonb_typeof(output) = 'object'
  )
);

create table if not exists public.worker_promotions (
  id uuid primary key default gen_random_uuid(),
  worker_definition_id uuid not null references public.worker_definitions(id) on delete cascade,
  evaluation_id uuid references public.worker_evaluations(id) on delete set null,
  from_status text not null check (
    from_status in ('experimental', 'qualified', 'assisted', 'autonomous', 'retired')
  ),
  to_status text not null check (
    to_status in ('experimental', 'qualified', 'assisted', 'autonomous', 'retired')
  ),
  reason text not null,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  promoted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint worker_promotions_reason_length check (
    char_length(btrim(reason)) between 1 and 500
  ),
  constraint worker_promotions_status_changed check (from_status <> to_status)
);

create index if not exists worker_evaluation_cases_suite_idx
  on public.worker_evaluation_cases (suite_id, case_key);
create index if not exists worker_evaluations_worker_created_idx
  on public.worker_evaluations (worker_definition_id, created_at desc);
create index if not exists worker_evaluations_suite_created_idx
  on public.worker_evaluations (suite_id, created_at desc);
create index if not exists worker_evaluation_results_evaluation_idx
  on public.worker_evaluation_case_results (evaluation_id, created_at);
create index if not exists worker_promotions_worker_idx
  on public.worker_promotions (worker_definition_id, promoted_at desc);

drop trigger if exists worker_evaluation_suites_set_updated_at
  on public.worker_evaluation_suites;
create trigger worker_evaluation_suites_set_updated_at
before update on public.worker_evaluation_suites
for each row execute function private.set_updated_at();

drop trigger if exists worker_evaluation_cases_set_updated_at
  on public.worker_evaluation_cases;
create trigger worker_evaluation_cases_set_updated_at
before update on public.worker_evaluation_cases
for each row execute function private.set_updated_at();

drop trigger if exists worker_evaluations_set_updated_at
  on public.worker_evaluations;
create trigger worker_evaluations_set_updated_at
before update on public.worker_evaluations
for each row execute function private.set_updated_at();

drop trigger if exists worker_evaluation_case_results_set_updated_at
  on public.worker_evaluation_case_results;
create trigger worker_evaluation_case_results_set_updated_at
before update on public.worker_evaluation_case_results
for each row execute function private.set_updated_at();

alter table public.worker_evaluation_suites enable row level security;
alter table public.worker_evaluation_cases enable row level security;
alter table public.worker_evaluations enable row level security;
alter table public.worker_evaluation_case_results enable row level security;
alter table public.worker_promotions enable row level security;

revoke all on table public.worker_evaluation_suites from anon, authenticated;
revoke all on table public.worker_evaluation_cases from anon, authenticated;
revoke all on table public.worker_evaluations from anon, authenticated;
revoke all on table public.worker_evaluation_case_results from anon, authenticated;
revoke all on table public.worker_promotions from anon, authenticated;

grant select on table public.worker_evaluation_suites to authenticated;
grant select on table public.worker_evaluation_cases to authenticated;
grant select on table public.worker_evaluations to authenticated;
grant select on table public.worker_evaluation_case_results to authenticated;
grant select on table public.worker_promotions to authenticated;

drop policy if exists worker_evaluation_suites_read_authenticated
  on public.worker_evaluation_suites;
create policy worker_evaluation_suites_read_authenticated
on public.worker_evaluation_suites
for select
to authenticated
using ((select auth.uid()) is not null);

drop policy if exists worker_evaluation_cases_read_authenticated
  on public.worker_evaluation_cases;
create policy worker_evaluation_cases_read_authenticated
on public.worker_evaluation_cases
for select
to authenticated
using ((select auth.uid()) is not null);

drop policy if exists worker_evaluations_read_authenticated
  on public.worker_evaluations;
create policy worker_evaluations_read_authenticated
on public.worker_evaluations
for select
to authenticated
using ((select auth.uid()) is not null);

drop policy if exists worker_evaluation_results_read_authenticated
  on public.worker_evaluation_case_results;
create policy worker_evaluation_results_read_authenticated
on public.worker_evaluation_case_results
for select
to authenticated
using ((select auth.uid()) is not null);

drop policy if exists worker_promotions_read_authenticated
  on public.worker_promotions;
create policy worker_promotions_read_authenticated
on public.worker_promotions
for select
to authenticated
using ((select auth.uid()) is not null);

comment on table public.worker_evaluation_suites is
  'Versioned Worker Pack competence suites and promotion thresholds.';
comment on table public.worker_evaluation_cases is
  'Required schema, role, capability, positive and negative evaluation fixtures.';
comment on table public.worker_evaluations is
  'Durable qualification runs bound to an exact Worker Pack and model-route fingerprint.';
comment on table public.worker_evaluation_case_results is
  'Per-case outcomes, model telemetry and regression evidence for a Worker evaluation.';
comment on table public.worker_promotions is
  'Append-only receipts for Worker maturity promotion and conservative demotion.';
