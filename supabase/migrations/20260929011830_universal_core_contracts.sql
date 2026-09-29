create function private.is_business_owner(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.businesses
      where id = target_business_id
        and owner_user_id = (select auth.uid())
    );
$$;

revoke all on function private.is_business_owner(uuid) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_business_owner(uuid) to authenticated;

create table public.packs (
  id uuid primary key default gen_random_uuid(),
  pack_key text not null,
  version text not null,
  name text not null,
  kind text not null check (kind in ('core', 'capability', 'knowledge', 'worker', 'workflow')),
  status text not null default 'experimental' check (status in ('experimental', 'qualified', 'assisted', 'autonomous', 'retired')),
  manifest jsonb not null default '{}'::jsonb check (jsonb_typeof(manifest) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint packs_key_format check (pack_key ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'),
  constraint packs_version_format check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$'),
  constraint packs_name_length check (char_length(btrim(name)) between 1 and 160),
  unique (pack_key, version)
);

create table public.workflow_definitions (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.packs(id) on delete restrict,
  workflow_key text not null,
  version text not null,
  name text not null,
  description text,
  status text not null default 'experimental' check (status in ('experimental', 'qualified', 'assisted', 'autonomous', 'retired')),
  input_schema jsonb not null default '{}'::jsonb check (jsonb_typeof(input_schema) = 'object'),
  output_schema jsonb not null default '{}'::jsonb check (jsonb_typeof(output_schema) = 'object'),
  stage_definition jsonb not null default '{}'::jsonb check (jsonb_typeof(stage_definition) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_definitions_key_format check (workflow_key ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'),
  constraint workflow_definitions_version_format check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$'),
  constraint workflow_definitions_name_length check (char_length(btrim(name)) between 1 and 160),
  unique (pack_id, workflow_key, version)
);

create table public.worker_definitions (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.packs(id) on delete restrict,
  worker_key text not null,
  version text not null,
  name text not null,
  role text not null,
  charter text not null,
  status text not null default 'experimental' check (status in ('experimental', 'qualified', 'assisted', 'autonomous', 'retired')),
  input_schema jsonb not null default '{}'::jsonb check (jsonb_typeof(input_schema) = 'object'),
  output_schema jsonb not null default '{}'::jsonb check (jsonb_typeof(output_schema) = 'object'),
  knowledge_requirements jsonb not null default '[]'::jsonb check (jsonb_typeof(knowledge_requirements) = 'array'),
  capability_requirements jsonb not null default '[]'::jsonb check (jsonb_typeof(capability_requirements) = 'array'),
  model_requirements jsonb not null default '{}'::jsonb check (jsonb_typeof(model_requirements) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint worker_definitions_key_format check (worker_key ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'),
  constraint worker_definitions_version_format check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$'),
  constraint worker_definitions_name_length check (char_length(btrim(name)) between 1 and 160),
  constraint worker_definitions_role_length check (char_length(btrim(role)) between 1 and 160),
  unique (pack_id, worker_key, version)
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text,
  status text not null default 'draft' check (status in ('draft', 'active', 'achieved', 'cancelled')),
  target jsonb not null default '{}'::jsonb check (jsonb_typeof(target) = 'object'),
  success_criteria jsonb not null default '{}'::jsonb check (jsonb_typeof(success_criteria) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id)
);

create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  goal_id uuid,
  workflow_definition_id uuid not null references public.workflow_definitions(id) on delete restrict,
  status text not null default 'queued' check (status in ('queued', 'running', 'waiting', 'review', 'needs_owner', 'completed', 'failed', 'cancelled')),
  current_stage_key text,
  idempotency_key text not null check (char_length(btrim(idempotency_key)) between 1 and 200),
  input jsonb not null default '{}'::jsonb check (jsonb_typeof(input) = 'object'),
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_runs_goal_fk foreign key (goal_id, business_id) references public.goals(id, business_id) on delete restrict,
  unique (id, business_id),
  unique (business_id, idempotency_key)
);

create table public.workflow_stage_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  workflow_run_id uuid not null,
  stage_key text not null check (char_length(btrim(stage_key)) between 1 and 160),
  sequence integer not null check (sequence >= 0),
  attempt integer not null default 1 check (attempt >= 1),
  status text not null default 'pending' check (status in ('pending', 'running', 'waiting', 'review', 'completed', 'failed', 'skipped')),
  input jsonb not null default '{}'::jsonb check (jsonb_typeof(input) = 'object'),
  output jsonb not null default '{}'::jsonb check (jsonb_typeof(output) = 'object'),
  failure jsonb not null default '{}'::jsonb check (jsonb_typeof(failure) = 'object'),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_stage_runs_parent_fk foreign key (workflow_run_id, business_id) references public.workflow_runs(id, business_id) on delete cascade,
  unique (id, business_id),
  unique (workflow_run_id, stage_key, attempt)
);

create table public.task_contracts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  workflow_run_id uuid not null,
  workflow_stage_run_id uuid,
  worker_definition_id uuid not null references public.worker_definitions(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'ready', 'running', 'completed', 'failed', 'cancelled')),
  objective text not null check (char_length(btrim(objective)) between 1 and 4000),
  input_artifact_ids uuid[] not null default '{}',
  permitted_capabilities text[] not null default '{}',
  required_knowledge text[] not null default '{}',
  required_output_schema jsonb not null default '{}'::jsonb check (jsonb_typeof(required_output_schema) = 'object'),
  completion_criteria jsonb not null default '{}'::jsonb check (jsonb_typeof(completion_criteria) = 'object'),
  failure_criteria jsonb not null default '{}'::jsonb check (jsonb_typeof(failure_criteria) = 'object'),
  non_goals text[] not null default '{}',
  escalation_rules jsonb not null default '{}'::jsonb check (jsonb_typeof(escalation_rules) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_contracts_workflow_fk foreign key (workflow_run_id, business_id) references public.workflow_runs(id, business_id) on delete cascade,
  constraint task_contracts_stage_fk foreign key (workflow_stage_run_id, business_id) references public.workflow_stage_runs(id, business_id) on delete cascade,
  unique (id, business_id)
);

create table public.worker_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  workflow_run_id uuid not null,
  task_contract_id uuid not null,
  worker_definition_id uuid not null references public.worker_definitions(id) on delete restrict,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  input jsonb not null default '{}'::jsonb check (jsonb_typeof(input) = 'object'),
  output jsonb not null default '{}'::jsonb check (jsonb_typeof(output) = 'object'),
  failure jsonb not null default '{}'::jsonb check (jsonb_typeof(failure) = 'object'),
  execution_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(execution_metadata) = 'object'),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint worker_runs_workflow_fk foreign key (workflow_run_id, business_id) references public.workflow_runs(id, business_id) on delete cascade,
  constraint worker_runs_task_contract_fk foreign key (task_contract_id, business_id) references public.task_contracts(id, business_id) on delete cascade,
  unique (id, business_id)
);

create table public.artifacts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  workflow_run_id uuid,
  task_contract_id uuid,
  artifact_type text not null check (char_length(btrim(artifact_type)) between 1 and 160),
  name text not null check (char_length(btrim(name)) between 1 and 240),
  media_type text not null default 'application/json' check (char_length(btrim(media_type)) between 1 and 160),
  storage_path text,
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  checksum text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artifacts_workflow_fk foreign key (workflow_run_id, business_id) references public.workflow_runs(id, business_id) on delete cascade,
  constraint artifacts_task_contract_fk foreign key (task_contract_id, business_id) references public.task_contracts(id, business_id) on delete cascade,
  unique (id, business_id)
);

create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  workflow_run_id uuid,
  artifact_id uuid,
  source_type text not null check (char_length(btrim(source_type)) between 1 and 160),
  source_uri text,
  title text,
  excerpt text,
  observed_at timestamptz not null,
  freshness jsonb not null default '{}'::jsonb check (jsonb_typeof(freshness) = 'object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  constraint evidence_workflow_fk foreign key (workflow_run_id, business_id) references public.workflow_runs(id, business_id) on delete cascade,
  constraint evidence_artifact_fk foreign key (artifact_id, business_id) references public.artifacts(id, business_id) on delete set null,
  unique (id, business_id)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  workflow_run_id uuid,
  event_type text not null check (char_length(btrim(event_type)) between 1 and 200),
  actor_type text not null check (actor_type in ('system', 'owner', 'worker', 'provider')),
  actor_id text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint events_workflow_fk foreign key (workflow_run_id, business_id) references public.workflow_runs(id, business_id) on delete cascade,
  unique (id, business_id)
);

create table public.external_resources (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider text not null check (char_length(btrim(provider)) between 1 and 120),
  resource_type text not null check (char_length(btrim(resource_type)) between 1 and 160),
  external_id text not null check (char_length(btrim(external_id)) between 1 and 300),
  status text not null default 'active' check (status in ('pending', 'active', 'inactive', 'missing', 'deleted')),
  canonical_url text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  unique (business_id, provider, resource_type, external_id)
);

create table public.action_intents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  workflow_run_id uuid,
  task_contract_id uuid,
  action_type text not null check (char_length(btrim(action_type)) between 1 and 200),
  capability text not null check (char_length(btrim(capability)) between 1 and 200),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'executing', 'completed', 'rejected', 'expired', 'failed')),
  request jsonb not null default '{}'::jsonb check (jsonb_typeof(request) = 'object'),
  risk jsonb not null default '{}'::jsonb check (jsonb_typeof(risk) = 'object'),
  financial_impact jsonb not null default '{}'::jsonb check (jsonb_typeof(financial_impact) = 'object'),
  idempotency_key text not null check (char_length(btrim(idempotency_key)) between 1 and 200),
  created_by_type text not null check (created_by_type in ('system', 'owner', 'worker')),
  created_by_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint action_intents_workflow_fk foreign key (workflow_run_id, business_id) references public.workflow_runs(id, business_id) on delete cascade,
  constraint action_intents_task_contract_fk foreign key (task_contract_id, business_id) references public.task_contracts(id, business_id) on delete cascade,
  unique (id, business_id),
  unique (business_id, idempotency_key)
);

create table public.action_receipts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  action_intent_id uuid not null,
  external_resource_id uuid,
  attempt integer not null default 1 check (attempt >= 1),
  outcome text not null check (outcome in ('succeeded', 'failed', 'uncertain')),
  provider text not null check (char_length(btrim(provider)) between 1 and 120),
  request_fingerprint text not null check (char_length(btrim(request_fingerprint)) between 1 and 256),
  response_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(response_summary) = 'object'),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint action_receipts_intent_fk foreign key (action_intent_id, business_id) references public.action_intents(id, business_id) on delete cascade,
  constraint action_receipts_external_resource_fk foreign key (external_resource_id, business_id) references public.external_resources(id, business_id) on delete set null,
  unique (id, business_id),
  unique (action_intent_id, attempt)
);

create table public.owner_interventions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  workflow_run_id uuid,
  action_intent_id uuid,
  intervention_type text not null check (char_length(btrim(intervention_type)) between 1 and 160),
  status text not null default 'open' check (status in ('open', 'resolved', 'declined', 'cancelled')),
  title text not null check (char_length(btrim(title)) between 1 and 240),
  description text not null check (char_length(btrim(description)) between 1 and 4000),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  resolution jsonb not null default '{}'::jsonb check (jsonb_typeof(resolution) = 'object'),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owner_interventions_workflow_fk foreign key (workflow_run_id, business_id) references public.workflow_runs(id, business_id) on delete cascade,
  constraint owner_interventions_action_intent_fk foreign key (action_intent_id, business_id) references public.action_intents(id, business_id) on delete cascade,
  unique (id, business_id)
);

create index workflow_definitions_pack_id_idx on public.workflow_definitions (pack_id);
create index worker_definitions_pack_id_idx on public.worker_definitions (pack_id);
create index goals_business_status_idx on public.goals (business_id, status);
create index workflow_runs_business_status_idx on public.workflow_runs (business_id, status);
create index workflow_runs_goal_id_idx on public.workflow_runs (goal_id);
create index workflow_runs_definition_id_idx on public.workflow_runs (workflow_definition_id);
create index workflow_stage_runs_business_workflow_idx on public.workflow_stage_runs (business_id, workflow_run_id);
create index task_contracts_business_workflow_idx on public.task_contracts (business_id, workflow_run_id);
create index task_contracts_stage_run_id_idx on public.task_contracts (workflow_stage_run_id);
create index task_contracts_worker_definition_id_idx on public.task_contracts (worker_definition_id);
create index worker_runs_business_workflow_idx on public.worker_runs (business_id, workflow_run_id);
create index worker_runs_task_contract_id_idx on public.worker_runs (task_contract_id);
create index worker_runs_worker_definition_id_idx on public.worker_runs (worker_definition_id);
create index artifacts_business_workflow_idx on public.artifacts (business_id, workflow_run_id);
create index artifacts_task_contract_id_idx on public.artifacts (task_contract_id);
create index evidence_business_workflow_idx on public.evidence (business_id, workflow_run_id);
create index evidence_artifact_id_idx on public.evidence (artifact_id);
create index events_business_occurred_idx on public.events (business_id, occurred_at desc);
create index events_workflow_run_id_idx on public.events (workflow_run_id);
create index external_resources_business_status_idx on public.external_resources (business_id, status);
create index action_intents_business_status_idx on public.action_intents (business_id, status);
create index action_intents_workflow_run_id_idx on public.action_intents (workflow_run_id);
create index action_intents_task_contract_id_idx on public.action_intents (task_contract_id);
create index action_receipts_business_intent_idx on public.action_receipts (business_id, action_intent_id);
create index action_receipts_external_resource_id_idx on public.action_receipts (external_resource_id);
create index owner_interventions_business_status_idx on public.owner_interventions (business_id, status);
create index owner_interventions_workflow_run_id_idx on public.owner_interventions (workflow_run_id);
create index owner_interventions_action_intent_id_idx on public.owner_interventions (action_intent_id);

create trigger packs_set_updated_at before update on public.packs for each row execute function private.set_updated_at();
create trigger workflow_definitions_set_updated_at before update on public.workflow_definitions for each row execute function private.set_updated_at();
create trigger worker_definitions_set_updated_at before update on public.worker_definitions for each row execute function private.set_updated_at();
create trigger goals_set_updated_at before update on public.goals for each row execute function private.set_updated_at();
create trigger workflow_runs_set_updated_at before update on public.workflow_runs for each row execute function private.set_updated_at();
create trigger workflow_stage_runs_set_updated_at before update on public.workflow_stage_runs for each row execute function private.set_updated_at();
create trigger task_contracts_set_updated_at before update on public.task_contracts for each row execute function private.set_updated_at();
create trigger worker_runs_set_updated_at before update on public.worker_runs for each row execute function private.set_updated_at();
create trigger artifacts_set_updated_at before update on public.artifacts for each row execute function private.set_updated_at();
create trigger external_resources_set_updated_at before update on public.external_resources for each row execute function private.set_updated_at();
create trigger action_intents_set_updated_at before update on public.action_intents for each row execute function private.set_updated_at();
create trigger owner_interventions_set_updated_at before update on public.owner_interventions for each row execute function private.set_updated_at();

alter table public.packs enable row level security;
alter table public.workflow_definitions enable row level security;
alter table public.worker_definitions enable row level security;
alter table public.goals enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.workflow_stage_runs enable row level security;
alter table public.task_contracts enable row level security;
alter table public.worker_runs enable row level security;
alter table public.artifacts enable row level security;
alter table public.evidence enable row level security;
alter table public.events enable row level security;
alter table public.external_resources enable row level security;
alter table public.action_intents enable row level security;
alter table public.action_receipts enable row level security;
alter table public.owner_interventions enable row level security;

revoke all on table public.packs from anon, authenticated;
revoke all on table public.workflow_definitions from anon, authenticated;
revoke all on table public.worker_definitions from anon, authenticated;
revoke all on table public.goals from anon, authenticated;
revoke all on table public.workflow_runs from anon, authenticated;
revoke all on table public.workflow_stage_runs from anon, authenticated;
revoke all on table public.task_contracts from anon, authenticated;
revoke all on table public.worker_runs from anon, authenticated;
revoke all on table public.artifacts from anon, authenticated;
revoke all on table public.evidence from anon, authenticated;
revoke all on table public.events from anon, authenticated;
revoke all on table public.external_resources from anon, authenticated;
revoke all on table public.action_intents from anon, authenticated;
revoke all on table public.action_receipts from anon, authenticated;
revoke all on table public.owner_interventions from anon, authenticated;

grant select on table public.packs to authenticated;
grant select on table public.workflow_definitions to authenticated;
grant select on table public.worker_definitions to authenticated;
grant select, insert, update on table public.goals to authenticated;
grant select, insert, update on table public.workflow_runs to authenticated;
grant select, insert, update on table public.workflow_stage_runs to authenticated;
grant select, insert, update on table public.task_contracts to authenticated;
grant select, insert, update on table public.worker_runs to authenticated;
grant select, insert, update on table public.artifacts to authenticated;
grant select, insert on table public.evidence to authenticated;
grant select, insert on table public.events to authenticated;
grant select, insert, update on table public.external_resources to authenticated;
grant select, insert, update on table public.action_intents to authenticated;
grant select, insert on table public.action_receipts to authenticated;
grant select, insert, update on table public.owner_interventions to authenticated;

create policy packs_select_active on public.packs for select to authenticated using (status <> 'retired');
create policy workflow_definitions_select_active on public.workflow_definitions for select to authenticated using (status <> 'retired');
create policy worker_definitions_select_active on public.worker_definitions for select to authenticated using (status <> 'retired');
create policy goals_owner_all on public.goals for all to authenticated using (private.is_business_owner(business_id)) with check (private.is_business_owner(business_id));
create policy workflow_runs_owner_all on public.workflow_runs for all to authenticated using (private.is_business_owner(business_id)) with check (private.is_business_owner(business_id));
create policy workflow_stage_runs_owner_all on public.workflow_stage_runs for all to authenticated using (private.is_business_owner(business_id)) with check (private.is_business_owner(business_id));
create policy task_contracts_owner_all on public.task_contracts for all to authenticated using (private.is_business_owner(business_id)) with check (private.is_business_owner(business_id));
create policy worker_runs_owner_all on public.worker_runs for all to authenticated using (private.is_business_owner(business_id)) with check (private.is_business_owner(business_id));
create policy artifacts_owner_all on public.artifacts for all to authenticated using (private.is_business_owner(business_id)) with check (private.is_business_owner(business_id));
create policy evidence_owner_all on public.evidence for all to authenticated using (private.is_business_owner(business_id)) with check (private.is_business_owner(business_id));
create policy events_owner_all on public.events for all to authenticated using (private.is_business_owner(business_id)) with check (private.is_business_owner(business_id));
create policy external_resources_owner_all on public.external_resources for all to authenticated using (private.is_business_owner(business_id)) with check (private.is_business_owner(business_id));
create policy action_intents_owner_all on public.action_intents for all to authenticated using (private.is_business_owner(business_id)) with check (private.is_business_owner(business_id));
create policy action_receipts_owner_all on public.action_receipts for all to authenticated using (private.is_business_owner(business_id)) with check (private.is_business_owner(business_id));
create policy owner_interventions_owner_all on public.owner_interventions for all to authenticated using (private.is_business_owner(business_id)) with check (private.is_business_owner(business_id));

insert into public.packs (id, pack_key, version, name, kind, status, manifest)
values (
  '00000000-0000-4000-8000-000000000201',
  'core.synthetic',
  '1.0.0',
  'Synthetic Core Fixture',
  'core',
  'qualified',
  '{"purpose":"validate universal core contracts","domain":"synthetic"}'::jsonb
);

insert into public.workflow_definitions (
  id, pack_id, workflow_key, version, name, description, status,
  input_schema, output_schema, stage_definition
)
values (
  '00000000-0000-4000-8000-000000000202',
  '00000000-0000-4000-8000-000000000201',
  'synthetic.core.validation',
  '1.0.0',
  'Synthetic Core Validation',
  'A generic workflow fixture used to validate durable Core contracts.',
  'qualified',
  '{"type":"object","additionalProperties":false}'::jsonb,
  '{"type":"object","additionalProperties":false}'::jsonb,
  '{"stages":[{"key":"start","type":"system"},{"key":"worker-task","type":"worker"},{"key":"review","type":"review"},{"key":"complete","type":"terminal"}]}'::jsonb
);

insert into public.worker_definitions (
  id, pack_id, worker_key, version, name, role, charter, status,
  input_schema, output_schema, knowledge_requirements,
  capability_requirements, model_requirements
)
values (
  '00000000-0000-4000-8000-000000000203',
  '00000000-0000-4000-8000-000000000201',
  'generic.synthetic.worker',
  '1.0.0',
  'Generic Synthetic Worker',
  'Generic Researcher',
  'Complete only the supplied Task Contract and return the required structured output.',
  'qualified',
  '{"type":"object"}'::jsonb,
  '{"type":"object"}'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '{"tier":"standard"}'::jsonb
);

comment on table public.packs is 'Versioned generic pack identities. Pack-specific runtime behavior is implemented later.';
comment on table public.workflow_definitions is 'Versioned workflow definitions expressed only through universal Core fields.';
comment on table public.worker_definitions is 'Versioned specialist worker definitions independent of any model provider.';
comment on table public.goals is 'Durable owner intent interpreted by workflows; a Goal is not execution authority.';
comment on table public.workflow_runs is 'Durable instances of versioned workflow definitions.';
comment on table public.workflow_stage_runs is 'Attempted execution of one workflow stage.';
comment on table public.task_contracts is 'Bounded durable work instructions for one specialist worker invocation.';
comment on table public.worker_runs is 'Durable receipts for specialist worker execution.';
comment on table public.artifacts is 'Durable structured outputs created by workflows and workers.';
comment on table public.evidence is 'Inspectable source evidence linked to workflows and artifacts.';
comment on table public.events is 'Append-only business-readable workflow and platform events.';
comment on table public.external_resources is 'References to provider-owned resources without embedding provider secrets.';
comment on table public.action_intents is 'Validated proposed external actions before execution.';
comment on table public.action_receipts is 'Append-only results of attempted external actions.';
comment on table public.owner_interventions is 'Durable owner decision requests for exceptional workflow states.';
