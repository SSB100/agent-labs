
create table if not exists public.browser_planner_definitions (
  id uuid primary key default gen_random_uuid(),
  planner_key text not null,
  version text not null,
  name text not null,
  status text not null default 'candidate' check (
    status in ('candidate', 'qualified', 'failed', 'stale', 'retired')
  ),
  model_route_key text not null,
  observation_contract jsonb not null default '{}'::jsonb check (jsonb_typeof(observation_contract) = 'object'),
  action_contract jsonb not null default '{}'::jsonb check (jsonb_typeof(action_contract) = 'object'),
  recovery_policy jsonb not null default '{}'::jsonb check (jsonb_typeof(recovery_policy) = 'object'),
  qualification jsonb not null default '{}'::jsonb check (jsonb_typeof(qualification) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (planner_key, version)
);

create table if not exists public.browser_planner_qualification_cases (
  id uuid primary key default gen_random_uuid(),
  planner_definition_id uuid not null references public.browser_planner_definitions(id) on delete cascade,
  case_key text not null,
  level text not null check (
    level in ('synthetic', 'mock_commerce', 'real_read_only', 'controlled_draft')
  ),
  status text not null default 'candidate' check (
    status in ('candidate', 'passed', 'failed', 'stale')
  ),
  score numeric(5,2) check (score is null or score between 0 and 100),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  model_usage jsonb not null default '{}'::jsonb check (jsonb_typeof(model_usage) = 'object'),
  qualified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (planner_definition_id, case_key)
);

create index if not exists browser_planner_cases_definition_idx
  on public.browser_planner_qualification_cases (planner_definition_id, level, status);

drop trigger if exists browser_planner_definitions_set_updated_at on public.browser_planner_definitions;
create trigger browser_planner_definitions_set_updated_at
before update on public.browser_planner_definitions
for each row execute function private.set_updated_at();

drop trigger if exists browser_planner_cases_set_updated_at on public.browser_planner_qualification_cases;
create trigger browser_planner_cases_set_updated_at
before update on public.browser_planner_qualification_cases
for each row execute function private.set_updated_at();

alter table public.browser_planner_definitions enable row level security;
alter table public.browser_planner_qualification_cases enable row level security;

revoke all on table public.browser_planner_definitions from anon, authenticated;
revoke all on table public.browser_planner_qualification_cases from anon, authenticated;
grant select on table public.browser_planner_definitions to authenticated;
grant select on table public.browser_planner_qualification_cases to authenticated;

drop policy if exists browser_planner_definitions_read_authenticated on public.browser_planner_definitions;
create policy browser_planner_definitions_read_authenticated
on public.browser_planner_definitions
for select
to authenticated
using ((select auth.uid()) is not null);

drop policy if exists browser_planner_cases_read_authenticated on public.browser_planner_qualification_cases;
create policy browser_planner_cases_read_authenticated
on public.browser_planner_qualification_cases
for select
to authenticated
using ((select auth.uid()) is not null);

insert into public.browser_planner_definitions (
  id, planner_key, version, name, status, model_route_key,
  observation_contract, action_contract, recovery_policy, qualification
)
values (
  '00000000-0000-4000-8000-000000000901',
  'browser.planner',
  '1.0.0',
  'Browser Planner',
  'candidate',
  'standard.default',
  jsonb_build_object(
    'fields', jsonb_build_array('url','title','visibleText','forms','controls','links','observedAt'),
    'stableElementIds', true,
    'rawDomExcluded', true,
    'playwrightExcluded', true
  ),
  jsonb_build_object(
    'oneActionPerStep', true,
    'actions', jsonb_build_array('click','type','navigate','complete','fail'),
    'elementActionsRequireObservedId', true,
    'selectorsForbidden', true
  ),
  jsonb_build_object(
    'maximumRecoveryAttempts', 2,
    'reobserveBeforeRecovery', true,
    'unboundedRetryForbidden', true
  ),
  jsonb_build_object(
    'requiredLevels', jsonb_build_array('synthetic','mock_commerce','real_read_only','controlled_draft'),
    'allRequired', true
  )
)
on conflict (planner_key, version) do update
set
  name = excluded.name,
  model_route_key = excluded.model_route_key,
  observation_contract = excluded.observation_contract,
  action_contract = excluded.action_contract,
  recovery_policy = excluded.recovery_policy,
  qualification = public.browser_planner_definitions.qualification || excluded.qualification,
  updated_at = now();

insert into public.browser_planner_qualification_cases (
  planner_definition_id, case_key, level, status, evidence
)
values
  ('00000000-0000-4000-8000-000000000901','synthetic.stable-element-action','synthetic','candidate',
    jsonb_build_object('objective','Prove structured observation and stable-element action selection.')),
  ('00000000-0000-4000-8000-000000000901','mock-commerce.draft-flow','mock_commerce','candidate',
    jsonb_build_object('objective','Prove bounded multi-step planning against a mock commerce draft page.')),
  ('00000000-0000-4000-8000-000000000901','real-read-only.example-domain','real_read_only','candidate',
    jsonb_build_object('objective','Prove read-only completion on a real public site without mutation.')),
  ('00000000-0000-4000-8000-000000000901','controlled-draft.safe-mutation','controlled_draft','candidate',
    jsonb_build_object('objective','Prove one controlled draft mutation with post-action verification.'))
on conflict (planner_definition_id, case_key) do nothing;

create or replace function public.stage9_record_browser_planner_event(
  p_business_id uuid,
  p_workflow_run_id uuid,
  p_browser_session_id uuid,
  p_runtime_capability text,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.workflow_runs%rowtype;
  v_session public.browser_sessions%rowtype;
begin
  if p_runtime_capability is null
    or char_length(p_runtime_capability) not between 32 and 512
    or p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or p_event_type not in (
      'browser.planner.observed',
      'browser.planner.action.planned',
      'browser.planner.action.completed',
      'browser.planner.action.failed',
      'browser.planner.recovery'
    ) then
    raise exception 'Invalid Browser Planner event request.' using errcode = '22023';
  end if;

  select * into v_run
  from public.workflow_runs
  where id = p_workflow_run_id
    and business_id = p_business_id
    and runtime_capability_hash = encode(
      extensions.digest(convert_to(p_runtime_capability, 'UTF8'), 'sha256'),
      'hex'
    );

  if not found then
    raise exception 'Browser Planner runtime capability denied.' using errcode = '42501';
  end if;

  select * into v_session
  from public.browser_sessions
  where id = p_browser_session_id
    and workflow_run_id = p_workflow_run_id
    and business_id = p_business_id;

  if not found then
    raise exception 'Browser Planner session is unavailable.' using errcode = 'P0002';
  end if;

  insert into public.browser_session_events (
    business_id, workflow_run_id, browser_session_id,
    event_type, control_mode, payload
  )
  values (
    p_business_id, p_workflow_run_id, p_browser_session_id,
    p_event_type, v_session.control_mode, p_payload
  );

  insert into public.events (
    business_id, workflow_run_id, event_type, actor_type, payload, occurred_at
  )
  values (
    p_business_id, p_workflow_run_id, p_event_type, 'worker',
    p_payload || jsonb_build_object(
      'browserSessionId', p_browser_session_id,
      'controlMode', v_session.control_mode
    ),
    now()
  );

  update public.browser_sessions
  set metadata = metadata || jsonb_build_object(
    'plannerLastEvent', p_event_type,
    'plannerLastEventAt', now()
  )
  where id = p_browser_session_id;

  return jsonb_build_object(
    'browserSessionId', p_browser_session_id,
    'workflowRunId', p_workflow_run_id,
    'eventType', p_event_type
  );
end;
$$;

revoke all on function public.stage9_record_browser_planner_event(
  uuid, uuid, uuid, text, text, jsonb
) from public, authenticated, service_role;
grant execute on function public.stage9_record_browser_planner_event(
  uuid, uuid, uuid, text, text, jsonb
) to anon;

comment on table public.browser_planner_definitions is
  'Versioned Browser Planner contract and qualification state.';
comment on table public.browser_planner_qualification_cases is
  'Stage 9 qualification evidence across synthetic, mock-commerce, real-read-only and controlled-draft levels.';
comment on function public.stage9_record_browser_planner_event(uuid, uuid, uuid, text, text, jsonb) is
  'Capability-gated durable Browser Planner action telemetry for Workflow UI visibility.';
