alter table public.workflow_runs
  add column runtime_provider text,
  add column runtime_run_id text,
  add column runtime_launch_status text not null default 'unclaimed',
  add column runtime_launch_nonce uuid,
  add column runtime_launch_reserved_at timestamptz;

alter table public.workflow_runs
  add constraint workflow_runs_runtime_provider_check
    check (runtime_provider is null or runtime_provider in ('vercel_workflow')),
  add constraint workflow_runs_runtime_launch_status_check
    check (runtime_launch_status in ('unclaimed', 'reserved', 'started', 'launch_failed')),
  add constraint workflow_runs_runtime_identity_check
    check (runtime_run_id is null or runtime_provider is not null),
  add constraint workflow_runs_launch_reservation_check
    check (
      runtime_launch_status = 'unclaimed'
      or (runtime_launch_nonce is not null and runtime_launch_reserved_at is not null)
    );

create unique index workflow_runs_runtime_run_id_idx
  on public.workflow_runs (runtime_run_id)
  where runtime_run_id is not null;

create index workflow_runs_runtime_status_idx
  on public.workflow_runs (runtime_provider, runtime_launch_status);

insert into public.workflow_definitions (
  id,
  pack_id,
  workflow_key,
  version,
  name,
  description,
  status,
  input_schema,
  output_schema,
  stage_definition
)
values (
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000201',
  'synthetic.core.runtime-proof',
  '1.0.0',
  'Synthetic Durable Runtime Proof',
  'Stage 3 proof workflow for durable transitions, retry, wait, human review and completion.',
  'qualified',
  '{"type":"object","required":["businessId","coreWorkflowRunId"],"additionalProperties":false}'::jsonb,
  '{"type":"object","required":["coreWorkflowRunId","runtimeRunId","status"],"additionalProperties":false}'::jsonb,
  '{"stages":[{"key":"start","type":"system","sequence":0},{"key":"worker-task","type":"synthetic-worker","sequence":1},{"key":"wait","type":"wait","sequence":2},{"key":"review","type":"owner-review","sequence":3},{"key":"complete","type":"terminal","sequence":4}]}'::jsonb
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

create or replace function public.begin_synthetic_workflow_run(
  p_business_id uuid,
  p_idempotency_key text,
  p_launch_nonce uuid,
  p_input jsonb default '{}'::jsonb
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

  if p_idempotency_key is null
    or char_length(btrim(p_idempotency_key)) < 1
    or char_length(btrim(p_idempotency_key)) > 200 then
    raise exception 'The idempotency key is invalid.' using errcode = '22023';
  end if;

  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'Workflow input must be a JSON object.' using errcode = '22023';
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
    runtime_launch_reserved_at
  )
  values (
    p_business_id,
    '00000000-0000-4000-8000-000000000301',
    'queued',
    null,
    btrim(p_idempotency_key),
    p_input,
    jsonb_build_object(
      'runtime', 'vercel_workflow',
      'syntheticWorkerAttempts', 0,
      'workerTaskCompleted', false
    ),
    'vercel_workflow',
    'reserved',
    p_launch_nonce,
    now()
  )
  on conflict (business_id, idempotency_key) do nothing
  returning id, workflow_runs.runtime_launch_status
  into v_workflow_run_id, v_launch_status;

  if v_workflow_run_id is not null then
    insert into public.events (
      business_id,
      workflow_run_id,
      event_type,
      actor_type,
      payload
    )
    values (
      p_business_id,
      v_workflow_run_id,
      'workflow.queued',
      'owner',
      jsonb_build_object('workflowKey', 'synthetic.core.runtime-proof')
    );

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

revoke all on function public.begin_synthetic_workflow_run(uuid, text, uuid, jsonb)
  from public, anon;
grant execute on function public.begin_synthetic_workflow_run(uuid, text, uuid, jsonb)
  to authenticated;

create or replace function public.stage3_claim_synthetic_worker_attempt(
  p_workflow_run_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt integer;
begin
  update public.workflow_runs
  set state = jsonb_set(
    coalesce(state, '{}'::jsonb),
    '{syntheticWorkerAttempts}',
    to_jsonb(coalesce((state ->> 'syntheticWorkerAttempts')::integer, 0) + 1),
    true
  )
  where id = p_workflow_run_id
  returning (state ->> 'syntheticWorkerAttempts')::integer
  into v_attempt;

  if v_attempt is null then
    raise exception 'Workflow run not found.' using errcode = 'P0002';
  end if;

  return v_attempt;
end;
$$;

revoke all on function public.stage3_claim_synthetic_worker_attempt(uuid)
  from public, anon, authenticated;
grant execute on function public.stage3_claim_synthetic_worker_attempt(uuid)
  to service_role;

comment on function public.begin_synthetic_workflow_run(uuid, text, uuid, jsonb) is
  'Atomically reserves one owner-scoped Stage 3 workflow launch for an idempotency key.';
comment on function public.stage3_claim_synthetic_worker_attempt(uuid) is
  'Claims the next deterministic synthetic worker attempt for the trusted Stage 3 runtime.';
comment on column public.workflow_runs.runtime_run_id is
  'Opaque durable runtime identifier assigned by the configured workflow provider.';
comment on column public.workflow_runs.runtime_launch_nonce is
  'One-time launch reservation used to prevent duplicate workflow starts.';
