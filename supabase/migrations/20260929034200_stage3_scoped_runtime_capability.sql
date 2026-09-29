alter table public.workflow_runs
  add column runtime_capability_hash text;

alter table public.workflow_runs
  add constraint workflow_runs_runtime_capability_hash_check
    check (
      runtime_capability_hash is null
      or runtime_capability_hash ~ '^[0-9a-f]{64}$'
    ),
  add constraint workflow_runs_stage3_capability_required_check
    check (
      workflow_definition_id <> '00000000-0000-4000-8000-000000000301'::uuid
      or runtime_capability_hash is not null
    );

create or replace function private.stage3_deterministic_uuid(p_value text)
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

revoke all on function private.stage3_deterministic_uuid(text)
  from public, anon, authenticated;

drop function if exists public.begin_synthetic_workflow_run(uuid, text, uuid, jsonb);

create function public.begin_synthetic_workflow_run(
  p_business_id uuid,
  p_idempotency_key text,
  p_launch_nonce uuid,
  p_runtime_capability text,
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

  if p_runtime_capability is null
    or char_length(p_runtime_capability) < 32
    or char_length(p_runtime_capability) > 512 then
    raise exception 'The runtime capability is invalid.' using errcode = '22023';
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
    runtime_launch_reserved_at,
    runtime_capability_hash
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
      id,
      business_id,
      workflow_run_id,
      event_type,
      actor_type,
      payload
    )
    values (
      private.stage3_deterministic_uuid(
        'event:' || v_workflow_run_id::text || ':workflow.queued'
      ),
      p_business_id,
      v_workflow_run_id,
      'workflow.queued',
      'owner',
      jsonb_build_object('workflowKey', 'synthetic.core.runtime-proof')
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

revoke all on function public.begin_synthetic_workflow_run(uuid, text, uuid, text, jsonb)
  from public, anon;
grant execute on function public.begin_synthetic_workflow_run(uuid, text, uuid, text, jsonb)
  to authenticated;

drop function if exists public.stage3_claim_synthetic_worker_attempt(uuid);

create function public.stage3_runtime_transition(
  p_workflow_run_id uuid,
  p_business_id uuid,
  p_runtime_capability text,
  p_operation text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.workflow_runs%rowtype;
  v_now timestamptz := now();
  v_attempt integer;
  v_stage_key text;
  v_runtime_run_id text;
  v_owner_user_id text;
  v_decided_at timestamptz;
  v_intervention_id uuid;
  v_failure jsonb;
  v_event_key text;
begin
  if p_runtime_capability is null
    or char_length(p_runtime_capability) < 32
    or char_length(p_runtime_capability) > 512 then
    raise exception 'Runtime capability denied.' using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Runtime payload must be an object.' using errcode = '22023';
  end if;

  select *
  into v_run
  from public.workflow_runs
  where id = p_workflow_run_id
    and business_id = p_business_id
    and workflow_definition_id = '00000000-0000-4000-8000-000000000301'::uuid
    and runtime_capability_hash = encode(
      extensions.digest(convert_to(p_runtime_capability, 'UTF8'), 'sha256'),
      'hex'
    )
  for update;

  if not found then
    raise exception 'Runtime capability denied.' using errcode = '42501';
  end if;

  if p_operation = 'runtime_started' then
    v_runtime_run_id := nullif(btrim(p_payload ->> 'runtimeRunId'), '');
    if v_runtime_run_id is null or char_length(v_runtime_run_id) > 300 then
      raise exception 'Runtime run identifier is invalid.' using errcode = '22023';
    end if;

    update public.workflow_runs
    set
      current_stage_key = 'start',
      runtime_launch_status = 'started',
      runtime_provider = 'vercel_workflow',
      runtime_run_id = v_runtime_run_id,
      started_at = coalesce(started_at, v_now),
      status = 'running',
      state = coalesce(state, '{}'::jsonb) || jsonb_build_object(
        'runtimeRunId', v_runtime_run_id
      )
    where id = p_workflow_run_id;

    insert into public.workflow_stage_runs (
      business_id,
      workflow_run_id,
      stage_key,
      sequence,
      attempt,
      status,
      input,
      output,
      failure,
      started_at,
      completed_at
    )
    values (
      p_business_id,
      p_workflow_run_id,
      'start',
      0,
      1,
      'completed',
      '{}'::jsonb,
      jsonb_build_object('runtimeRunId', v_runtime_run_id),
      '{}'::jsonb,
      v_now,
      v_now
    )
    on conflict (workflow_run_id, stage_key, attempt) do update
    set
      status = 'completed',
      output = excluded.output,
      completed_at = excluded.completed_at;

    insert into public.events (
      id, business_id, workflow_run_id, event_type, actor_type, payload, occurred_at
    )
    values
      (
        private.stage3_deterministic_uuid(
          'event:' || p_workflow_run_id::text || ':workflow.started'
        ),
        p_business_id,
        p_workflow_run_id,
        'workflow.started',
        'system',
        jsonb_build_object(
          'runtimeRunId', v_runtime_run_id,
          'workflowKey', 'synthetic.core.runtime-proof'
        ),
        v_now
      ),
      (
        private.stage3_deterministic_uuid(
          'event:' || p_workflow_run_id::text || ':stage.start.completed'
        ),
        p_business_id,
        p_workflow_run_id,
        'workflow.stage.completed',
        'system',
        jsonb_build_object('stageKey', 'start'),
        v_now
      )
    on conflict (id) do nothing;

    return jsonb_build_object('runtimeRunId', v_runtime_run_id, 'status', 'running');
  end if;

  if p_operation = 'worker_attempt_started' then
    if coalesce((v_run.state ->> 'workerTaskCompleted')::boolean, false) then
      return jsonb_build_object(
        'attempt', coalesce((v_run.state ->> 'syntheticWorkerAttempts')::integer, 2),
        'completed', true
      );
    end if;

    v_attempt := coalesce((v_run.state ->> 'syntheticWorkerAttempts')::integer, 0) + 1;

    update public.workflow_runs
    set
      current_stage_key = 'worker-task',
      status = 'running',
      state = jsonb_set(
        coalesce(state, '{}'::jsonb),
        '{syntheticWorkerAttempts}',
        to_jsonb(v_attempt),
        true
      )
    where id = p_workflow_run_id;

    insert into public.workflow_stage_runs (
      business_id,
      workflow_run_id,
      stage_key,
      sequence,
      attempt,
      status,
      input,
      output,
      failure,
      started_at
    )
    values (
      p_business_id,
      p_workflow_run_id,
      'worker-task',
      1,
      v_attempt,
      'running',
      '{}'::jsonb,
      '{}'::jsonb,
      '{}'::jsonb,
      v_now
    )
    on conflict (workflow_run_id, stage_key, attempt) do update
    set status = 'running';

    insert into public.events (
      id, business_id, workflow_run_id, event_type, actor_type, actor_id, payload, occurred_at
    )
    values (
      private.stage3_deterministic_uuid(
        'event:' || p_workflow_run_id::text || ':worker-task:' || v_attempt::text || ':started'
      ),
      p_business_id,
      p_workflow_run_id,
      'workflow.stage.started',
      'worker',
      'synthetic-worker',
      jsonb_build_object('attempt', v_attempt, 'stageKey', 'worker-task'),
      v_now
    )
    on conflict (id) do nothing;

    return jsonb_build_object('attempt', v_attempt, 'completed', false);
  end if;

  if p_operation = 'worker_attempt_failed' then
    v_attempt := coalesce((p_payload ->> 'attempt')::integer, 0);
    if v_attempt < 1 then
      raise exception 'Worker attempt is invalid.' using errcode = '22023';
    end if;

    v_failure := jsonb_build_object(
      'category', 'synthetic_transient_failure',
      'message', 'The Stage 3 proof intentionally fails its first worker attempt.',
      'retryable', true
    );

    update public.workflow_stage_runs
    set
      completed_at = v_now,
      failure = v_failure,
      status = 'failed'
    where workflow_run_id = p_workflow_run_id
      and business_id = p_business_id
      and stage_key = 'worker-task'
      and attempt = v_attempt;

    insert into public.events (
      id, business_id, workflow_run_id, event_type, actor_type, actor_id, payload, occurred_at
    )
    values (
      private.stage3_deterministic_uuid(
        'event:' || p_workflow_run_id::text || ':worker-task:retry:' || v_attempt::text
      ),
      p_business_id,
      p_workflow_run_id,
      'workflow.retry.scheduled',
      'worker',
      'synthetic-worker',
      jsonb_build_object(
        'attempt', v_attempt,
        'retryAfter', '1s',
        'stageKey', 'worker-task'
      ),
      v_now
    )
    on conflict (id) do nothing;

    return jsonb_build_object('attempt', v_attempt, 'status', 'failed');
  end if;

  if p_operation = 'worker_attempt_completed' then
    v_attempt := coalesce((p_payload ->> 'attempt')::integer, 0);
    if v_attempt < 1 then
      raise exception 'Worker attempt is invalid.' using errcode = '22023';
    end if;

    update public.workflow_stage_runs
    set
      completed_at = v_now,
      output = jsonb_build_object(
        'attempt', v_attempt,
        'result', 'synthetic-task-complete'
      ),
      status = 'completed'
    where workflow_run_id = p_workflow_run_id
      and business_id = p_business_id
      and stage_key = 'worker-task'
      and attempt = v_attempt;

    update public.workflow_runs
    set
      current_stage_key = 'wait',
      status = 'running',
      state = coalesce(state, '{}'::jsonb) || jsonb_build_object(
        'syntheticWorkerAttempts', v_attempt,
        'workerTaskCompleted', true
      )
    where id = p_workflow_run_id;

    insert into public.events (
      id, business_id, workflow_run_id, event_type, actor_type, actor_id, payload, occurred_at
    )
    values (
      private.stage3_deterministic_uuid(
        'event:' || p_workflow_run_id::text || ':worker-task:' || v_attempt::text || ':completed'
      ),
      p_business_id,
      p_workflow_run_id,
      'workflow.stage.completed',
      'worker',
      'synthetic-worker',
      jsonb_build_object('attempt', v_attempt, 'stageKey', 'worker-task'),
      v_now
    )
    on conflict (id) do nothing;

    return jsonb_build_object('attempt', v_attempt, 'status', 'completed');
  end if;

  if p_operation = 'wait_started' then
    insert into public.workflow_stage_runs (
      business_id,
      workflow_run_id,
      stage_key,
      sequence,
      attempt,
      status,
      input,
      output,
      failure,
      started_at
    )
    values (
      p_business_id,
      p_workflow_run_id,
      'wait',
      2,
      1,
      'waiting',
      '{}'::jsonb,
      jsonb_build_object('duration', '5s'),
      '{}'::jsonb,
      v_now
    )
    on conflict (workflow_run_id, stage_key, attempt) do update
    set status = 'waiting';

    update public.workflow_runs
    set current_stage_key = 'wait', status = 'waiting'
    where id = p_workflow_run_id;

    insert into public.events (
      id, business_id, workflow_run_id, event_type, actor_type, payload, occurred_at
    )
    values (
      private.stage3_deterministic_uuid(
        'event:' || p_workflow_run_id::text || ':wait.started'
      ),
      p_business_id,
      p_workflow_run_id,
      'workflow.wait.started',
      'system',
      jsonb_build_object('duration', '5s', 'stageKey', 'wait'),
      v_now
    )
    on conflict (id) do nothing;

    return jsonb_build_object('status', 'waiting');
  end if;

  if p_operation = 'wait_completed' then
    update public.workflow_stage_runs
    set
      completed_at = v_now,
      output = jsonb_build_object('duration', '5s', 'resumed', true),
      status = 'completed'
    where workflow_run_id = p_workflow_run_id
      and business_id = p_business_id
      and stage_key = 'wait'
      and attempt = 1;

    update public.workflow_runs
    set current_stage_key = 'review', status = 'running'
    where id = p_workflow_run_id;

    insert into public.events (
      id, business_id, workflow_run_id, event_type, actor_type, payload, occurred_at
    )
    values (
      private.stage3_deterministic_uuid(
        'event:' || p_workflow_run_id::text || ':wait.completed'
      ),
      p_business_id,
      p_workflow_run_id,
      'workflow.wait.completed',
      'system',
      jsonb_build_object('stageKey', 'wait'),
      v_now
    )
    on conflict (id) do nothing;

    return jsonb_build_object('status', 'running');
  end if;

  if p_operation = 'review_requested' then
    v_intervention_id := private.stage3_deterministic_uuid(
      'intervention:' || p_workflow_run_id::text || ':review'
    );

    insert into public.workflow_stage_runs (
      business_id,
      workflow_run_id,
      stage_key,
      sequence,
      attempt,
      status,
      input,
      output,
      failure,
      started_at
    )
    values (
      p_business_id,
      p_workflow_run_id,
      'review',
      3,
      1,
      'review',
      '{}'::jsonb,
      '{}'::jsonb,
      '{}'::jsonb,
      v_now
    )
    on conflict (workflow_run_id, stage_key, attempt) do update
    set status = case
      when public.workflow_stage_runs.status in ('completed', 'failed')
        then public.workflow_stage_runs.status
      else 'review'
    end;

    insert into public.owner_interventions (
      id,
      business_id,
      workflow_run_id,
      action_intent_id,
      intervention_type,
      status,
      title,
      description,
      options,
      resolution,
      requested_at
    )
    values (
      v_intervention_id,
      p_business_id,
      p_workflow_run_id,
      null,
      'synthetic_workflow_review',
      'open',
      'Review synthetic workflow',
      'Approve the Stage 3 synthetic runtime proof to complete it, or fail it to verify the durable failure path.',
      jsonb_build_array(
        jsonb_build_object('id', 'approve', 'label', 'Approve and complete'),
        jsonb_build_object('id', 'fail', 'label', 'Fail workflow')
      ),
      '{}'::jsonb,
      v_now
    )
    on conflict (id) do nothing;

    update public.workflow_runs
    set current_stage_key = 'review', status = 'needs_owner'
    where id = p_workflow_run_id
      and status not in ('completed', 'failed', 'cancelled');

    insert into public.events (
      id, business_id, workflow_run_id, event_type, actor_type, payload, occurred_at
    )
    values (
      private.stage3_deterministic_uuid(
        'event:' || p_workflow_run_id::text || ':review.requested'
      ),
      p_business_id,
      p_workflow_run_id,
      'workflow.owner_intervention.requested',
      'system',
      jsonb_build_object(
        'interventionId', v_intervention_id,
        'stageKey', 'review'
      ),
      v_now
    )
    on conflict (id) do nothing;

    return jsonb_build_object(
      'interventionId', v_intervention_id,
      'status', 'needs_owner'
    );
  end if;

  if p_operation in ('review_approved', 'review_failed') then
    v_owner_user_id := nullif(btrim(p_payload ->> 'ownerUserId'), '');
    v_decided_at := coalesce(
      nullif(p_payload ->> 'decidedAt', '')::timestamptz,
      v_now
    );
    v_intervention_id := private.stage3_deterministic_uuid(
      'intervention:' || p_workflow_run_id::text || ':review'
    );

    if v_owner_user_id is null or char_length(v_owner_user_id) > 200 then
      raise exception 'Owner identity is invalid.' using errcode = '22023';
    end if;

    if p_operation = 'review_approved' then
      update public.owner_interventions
      set
        resolution = jsonb_build_object(
          'decidedAt', v_decided_at,
          'decision', 'approve',
          'ownerUserId', v_owner_user_id
        ),
        resolved_at = v_now,
        status = 'resolved'
      where id = v_intervention_id
        and business_id = p_business_id;

      update public.workflow_stage_runs
      set
        completed_at = v_now,
        output = jsonb_build_object(
          'decision', 'approve',
          'ownerUserId', v_owner_user_id
        ),
        status = 'completed'
      where workflow_run_id = p_workflow_run_id
        and business_id = p_business_id
        and stage_key = 'review'
        and attempt = 1;

      update public.workflow_runs
      set current_stage_key = 'complete', status = 'running'
      where id = p_workflow_run_id;

      insert into public.events (
        id, business_id, workflow_run_id, event_type, actor_type, actor_id, payload, occurred_at
      )
      values
        (
          private.stage3_deterministic_uuid(
            'event:' || p_workflow_run_id::text || ':review.approved'
          ),
          p_business_id,
          p_workflow_run_id,
          'workflow.owner_intervention.resolved',
          'owner',
          v_owner_user_id,
          jsonb_build_object(
            'decision', 'approve',
            'interventionId', v_intervention_id
          ),
          v_now
        ),
        (
          private.stage3_deterministic_uuid(
            'event:' || p_workflow_run_id::text || ':review.completed'
          ),
          p_business_id,
          p_workflow_run_id,
          'workflow.stage.completed',
          'system',
          null,
          jsonb_build_object('stageKey', 'review'),
          v_now
        )
      on conflict (id) do nothing;

      return jsonb_build_object('status', 'running');
    end if;

    v_failure := jsonb_build_object(
      'category', 'owner_rejected',
      'message', 'The owner selected the failure path.'
    );

    update public.owner_interventions
    set
      resolution = jsonb_build_object(
        'decidedAt', v_decided_at,
        'decision', 'fail',
        'ownerUserId', v_owner_user_id
      ),
      resolved_at = v_now,
      status = 'declined'
    where id = v_intervention_id
      and business_id = p_business_id;

    update public.workflow_stage_runs
    set completed_at = v_now, failure = v_failure, status = 'failed'
    where workflow_run_id = p_workflow_run_id
      and business_id = p_business_id
      and stage_key = 'review'
      and attempt = 1;

    update public.workflow_runs
    set
      completed_at = v_now,
      current_stage_key = 'review',
      status = 'failed',
      state = coalesce(state, '{}'::jsonb) || jsonb_build_object(
        'outcome', 'owner_rejected'
      )
    where id = p_workflow_run_id;

    insert into public.events (
      id, business_id, workflow_run_id, event_type, actor_type, actor_id, payload, occurred_at
    )
    values
      (
        private.stage3_deterministic_uuid(
          'event:' || p_workflow_run_id::text || ':review.failed'
        ),
        p_business_id,
        p_workflow_run_id,
        'workflow.owner_intervention.resolved',
        'owner',
        v_owner_user_id,
        jsonb_build_object(
          'decision', 'fail',
          'interventionId', v_intervention_id
        ),
        v_now
      ),
      (
        private.stage3_deterministic_uuid(
          'event:' || p_workflow_run_id::text || ':workflow.failed.owner'
        ),
        p_business_id,
        p_workflow_run_id,
        'workflow.failed',
        'system',
        null,
        jsonb_build_object('category', 'owner_rejected', 'stageKey', 'review'),
        v_now
      )
    on conflict (id) do nothing;

    return jsonb_build_object('status', 'failed');
  end if;

  if p_operation = 'workflow_completed' then
    insert into public.workflow_stage_runs (
      business_id,
      workflow_run_id,
      stage_key,
      sequence,
      attempt,
      status,
      input,
      output,
      failure,
      started_at,
      completed_at
    )
    values (
      p_business_id,
      p_workflow_run_id,
      'complete',
      4,
      1,
      'completed',
      '{}'::jsonb,
      jsonb_build_object('result', 'stage-3-runtime-qualified'),
      '{}'::jsonb,
      v_now,
      v_now
    )
    on conflict (workflow_run_id, stage_key, attempt) do update
    set
      status = 'completed',
      output = excluded.output,
      completed_at = excluded.completed_at;

    update public.workflow_runs
    set
      completed_at = v_now,
      current_stage_key = 'complete',
      status = 'completed',
      state = coalesce(state, '{}'::jsonb) || jsonb_build_object(
        'outcome', 'completed'
      )
    where id = p_workflow_run_id;

    insert into public.events (
      id, business_id, workflow_run_id, event_type, actor_type, payload, occurred_at
    )
    values
      (
        private.stage3_deterministic_uuid(
          'event:' || p_workflow_run_id::text || ':complete.completed'
        ),
        p_business_id,
        p_workflow_run_id,
        'workflow.stage.completed',
        'system',
        jsonb_build_object('stageKey', 'complete'),
        v_now
      ),
      (
        private.stage3_deterministic_uuid(
          'event:' || p_workflow_run_id::text || ':workflow.completed'
        ),
        p_business_id,
        p_workflow_run_id,
        'workflow.completed',
        'system',
        jsonb_build_object('result', 'stage-3-runtime-qualified'),
        v_now
      )
    on conflict (id) do nothing;

    return jsonb_build_object('status', 'completed');
  end if;

  if p_operation = 'unexpected_failed' then
    v_stage_key := coalesce(nullif(btrim(p_payload ->> 'stageKey'), ''), 'unknown');
    v_failure := jsonb_build_object(
      'category', 'unexpected_runtime_failure',
      'name', left(coalesce(p_payload ->> 'name', 'UnknownError'), 120),
      'message', left(coalesce(p_payload ->> 'message', 'Unknown workflow failure'), 500)
    );

    update public.workflow_stage_runs
    set completed_at = v_now, failure = v_failure, status = 'failed'
    where id = (
      select id
      from public.workflow_stage_runs
      where workflow_run_id = p_workflow_run_id
        and business_id = p_business_id
        and stage_key = v_stage_key
      order by attempt desc
      limit 1
    );

    update public.workflow_runs
    set
      completed_at = v_now,
      current_stage_key = v_stage_key,
      status = 'failed',
      state = coalesce(state, '{}'::jsonb) || jsonb_build_object(
        'failure', v_failure,
        'outcome', 'failed'
      )
    where id = p_workflow_run_id;

    v_event_key := 'event:' || p_workflow_run_id::text || ':unexpected:' || v_stage_key;
    insert into public.events (
      id, business_id, workflow_run_id, event_type, actor_type, payload, occurred_at
    )
    values (
      private.stage3_deterministic_uuid(v_event_key),
      p_business_id,
      p_workflow_run_id,
      'workflow.failed',
      'system',
      v_failure || jsonb_build_object('stageKey', v_stage_key),
      v_now
    )
    on conflict (id) do nothing;

    return jsonb_build_object('status', 'failed');
  end if;

  raise exception 'Unsupported runtime operation.' using errcode = '22023';
end;
$$;

revoke all on function public.stage3_runtime_transition(uuid, uuid, text, text, jsonb)
  from public;
grant execute on function public.stage3_runtime_transition(uuid, uuid, text, text, jsonb)
  to anon, authenticated;

comment on column public.workflow_runs.runtime_capability_hash is
  'SHA-256 hash of the one-run capability used by the Stage 3 durable runtime.';
comment on function public.stage3_runtime_transition(uuid, uuid, text, text, jsonb) is
  'Applies one bounded transition to the Stage 3 synthetic workflow after validating its scoped capability.';
