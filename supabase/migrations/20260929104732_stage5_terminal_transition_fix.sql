alter function public.stage5_model_runtime_transition(uuid, uuid, text, text, jsonb)
  rename to stage5_model_runtime_transition_legacy;

revoke all on function public.stage5_model_runtime_transition_legacy(uuid, uuid, text, text, jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.stage5_op_worker_completed_v2(
  p_workflow_run_id uuid,
  p_business_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_output jsonb := p_payload -> 'output';
  v_receipt jsonb := p_payload -> 'receipt';
  v_route_key text := nullif(btrim(p_payload ->> 'routeKey'), '');
  v_selected_model_key text := nullif(btrim(p_payload ->> 'selectedModelKey'), '');
  v_task_id uuid := private.stage5_deterministic_uuid(
    'stage5:task:' || p_workflow_run_id::text
  );
  v_worker_id uuid := private.stage5_deterministic_uuid(
    'stage5:worker:' || p_workflow_run_id::text || ':1'
  );
  v_output_id uuid := private.stage5_deterministic_uuid(
    'stage5:output:' || p_workflow_run_id::text
  );
begin
  if v_output is null
    or jsonb_typeof(v_output) <> 'object'
    or v_receipt is null
    or jsonb_typeof(v_receipt) <> 'object'
    or coalesce((v_receipt ->> 'outputValidated')::boolean, false) is not true
    or v_receipt ->> 'taskContractId' <> v_task_id::text
    or v_receipt ->> 'workerKey' <> 'generic.researcher'
    or v_receipt ->> 'workerVersion' <> '1.0.0'
    or v_receipt ->> 'modelRouteKey' <> 'standard.default'
    or v_receipt ->> 'stopReason' <> 'completion_criteria_satisfied'
    or v_route_key <> 'standard.default'
    or v_selected_model_key is null then
    raise exception 'Model worker result or receipt is invalid.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.model_invocations invocation
    join public.model_definitions model
      on model.id = invocation.model_definition_id
    where invocation.workflow_run_id = p_workflow_run_id
      and invocation.business_id = p_business_id
      and invocation.status = 'completed'
      and model.model_key = v_selected_model_key
  ) then
    raise exception 'A completed model invocation is required.' using errcode = '22023';
  end if;

  v_receipt := v_receipt || jsonb_build_object(
    'workerRunId', v_worker_id,
    'outputArtifactId', v_output_id,
    'completedAt', v_now
  );

  update public.worker_runs
  set
    completed_at = v_now,
    output = v_output,
    failure = '{}'::jsonb,
    execution_metadata = coalesce(execution_metadata, '{}'::jsonb) || jsonb_build_object(
      'receipt', v_receipt,
      'outputArtifactId', v_output_id,
      'outputValidated', true,
      'selectedModelKey', v_selected_model_key,
      'modelRouteKey', v_route_key,
      'routeAttemptCount', coalesce(
        nullif(p_payload ->> 'routeAttemptCount', '')::integer,
        1
      ),
      'reportedCostUsd', nullif(p_payload ->> 'reportedCostUsd', '')::numeric,
      'estimatedCostUsd', coalesce(
        nullif(p_payload ->> 'estimatedCostUsd', '')::numeric,
        0
      )
    ),
    status = 'completed'
  where id = v_worker_id
    and business_id = p_business_id
    and workflow_run_id = p_workflow_run_id
    and status in ('running', 'completed');

  if not found then
    raise exception 'Worker Run is not available for completion.' using errcode = 'P0002';
  end if;

  update public.task_contracts
  set status = 'completed'
  where id = v_task_id
    and business_id = p_business_id
    and workflow_run_id = p_workflow_run_id;

  update public.workflow_stage_runs
  set
    completed_at = v_now,
    output = jsonb_build_object(
      'workerRunId', v_worker_id,
      'outputArtifactId', v_output_id,
      'selectedModelKey', v_selected_model_key,
      'modelRouteKey', v_route_key
    ),
    failure = '{}'::jsonb,
    status = 'completed'
  where workflow_run_id = p_workflow_run_id
    and business_id = p_business_id
    and stage_key = 'worker'
    and attempt = 1;

  insert into public.artifacts (
    id, business_id, workflow_run_id, task_contract_id,
    artifact_type, name, media_type, content, metadata
  )
  values (
    v_output_id,
    p_business_id,
    p_workflow_run_id,
    v_task_id,
    'worker.research-evidence-pack',
    'Model-routed Generic Researcher evidence pack',
    'application/json',
    v_output,
    jsonb_build_object(
      'receipt', v_receipt,
      'modelRouteKey', v_route_key,
      'selectedModelKey', v_selected_model_key
    )
  )
  on conflict (id) do update
  set
    content = excluded.content,
    metadata = excluded.metadata,
    updated_at = v_now;

  insert into public.workflow_stage_runs (
    business_id, workflow_run_id, stage_key, sequence, attempt, status,
    input, output, failure, started_at, completed_at
  )
  values
    (
      p_business_id,
      p_workflow_run_id,
      'validate',
      4,
      1,
      'completed',
      jsonb_build_object('workerRunId', v_worker_id),
      jsonb_build_object(
        'outputValidated', true,
        'selectedModelKey', v_selected_model_key,
        'receiptVersion', v_receipt ->> 'receiptVersion'
      ),
      '{}'::jsonb,
      v_now,
      v_now
    ),
    (
      p_business_id,
      p_workflow_run_id,
      'complete',
      5,
      1,
      'completed',
      '{}'::jsonb,
      jsonb_build_object(
        'result', 'stage-5-model-router-qualified',
        'outputArtifactId', v_output_id,
        'selectedModelKey', v_selected_model_key,
        'modelRouteKey', v_route_key
      ),
      '{}'::jsonb,
      v_now,
      v_now
    )
  on conflict (workflow_run_id, stage_key, attempt) do update
  set
    status = 'completed',
    output = excluded.output,
    failure = '{}'::jsonb,
    completed_at = excluded.completed_at;

  update public.workflow_runs
  set
    completed_at = v_now,
    current_stage_key = 'complete',
    status = 'completed',
    state = coalesce(state, '{}'::jsonb) || jsonb_build_object(
      'workerRunId', v_worker_id,
      'outputArtifactId', v_output_id,
      'selectedModelKey', v_selected_model_key,
      'modelRouteKey', v_route_key,
      'routeAttemptCount', coalesce(
        nullif(p_payload ->> 'routeAttemptCount', '')::integer,
        1
      ),
      'reportedCostUsd', nullif(p_payload ->> 'reportedCostUsd', '')::numeric,
      'estimatedCostUsd', coalesce(
        nullif(p_payload ->> 'estimatedCostUsd', '')::numeric,
        0
      ),
      'outcome', 'completed'
    )
  where id = p_workflow_run_id
    and business_id = p_business_id;

  insert into public.events (
    id, business_id, workflow_run_id, event_type, actor_type,
    actor_id, payload, occurred_at
  )
  values
    (
      private.stage5_deterministic_uuid(
        'event:' || p_workflow_run_id::text || ':worker.completed'
      ),
      p_business_id,
      p_workflow_run_id,
      'worker.completed',
      'worker',
      'generic.researcher',
      jsonb_build_object(
        'workerRunId', v_worker_id,
        'taskContractId', v_task_id,
        'outputArtifactId', v_output_id,
        'outputValidated', true,
        'selectedModelKey', v_selected_model_key,
        'modelRouteKey', v_route_key
      ),
      v_now
    ),
    (
      private.stage5_deterministic_uuid(
        'event:' || p_workflow_run_id::text || ':workflow.completed'
      ),
      p_business_id,
      p_workflow_run_id,
      'workflow.completed',
      'system',
      null,
      jsonb_build_object(
        'result', 'stage-5-model-router-qualified',
        'workerKey', 'generic.researcher',
        'selectedModelKey', v_selected_model_key,
        'modelRouteKey', v_route_key
      ),
      v_now
    )
  on conflict (id) do nothing;

  return jsonb_build_object(
    'status', 'completed',
    'output', v_output,
    'receipt', v_receipt,
    'outputArtifactId', v_output_id,
    'selectedModelKey', v_selected_model_key,
    'modelRouteKey', v_route_key
  );
end;
$$;

create or replace function private.stage5_op_worker_failed_v2(
  p_workflow_run_id uuid,
  p_business_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_category text := nullif(btrim(p_payload ->> 'category'), '');
  v_message text := left(coalesce(p_payload ->> 'message', 'Model worker failed.'), 500);
  v_details jsonb := coalesce(p_payload -> 'details', '{}'::jsonb);
  v_task_id uuid := private.stage5_deterministic_uuid(
    'stage5:task:' || p_workflow_run_id::text
  );
  v_worker_id uuid := private.stage5_deterministic_uuid(
    'stage5:worker:' || p_workflow_run_id::text || ':1'
  );
begin
  if v_category not in (
    'contract_invalid',
    'context_invalid',
    'validation_failed',
    'worker_execution_failed',
    'route_unavailable',
    'all_routes_failed',
    'configuration_required',
    'authentication_required',
    'rate_limited',
    'provider_timeout',
    'provider_unavailable',
    'provider_rejected',
    'malformed_model_output',
    'tool_qualification_failed'
  )
    or jsonb_typeof(v_details) <> 'object' then
    raise exception 'Model worker failure classification is invalid.' using errcode = '22023';
  end if;

  update public.worker_runs
  set
    completed_at = v_now,
    failure = jsonb_build_object(
      'category', v_category,
      'message', v_message,
      'details', v_details
    ),
    execution_metadata = coalesce(execution_metadata, '{}'::jsonb) || jsonb_build_object(
      'failureCategory', v_category,
      'outputValidated', false
    ),
    status = 'failed'
  where id = v_worker_id
    and business_id = p_business_id
    and workflow_run_id = p_workflow_run_id
    and status in ('running', 'failed');

  if not found then
    raise exception 'Worker Run is not available for failure recording.' using errcode = 'P0002';
  end if;

  update public.task_contracts
  set status = 'failed'
  where id = v_task_id
    and business_id = p_business_id
    and workflow_run_id = p_workflow_run_id;

  update public.workflow_stage_runs
  set
    completed_at = v_now,
    failure = jsonb_build_object(
      'category', v_category,
      'message', v_message,
      'details', v_details
    ),
    status = 'failed'
  where workflow_run_id = p_workflow_run_id
    and business_id = p_business_id
    and stage_key = 'worker'
    and attempt = 1;

  insert into public.workflow_stage_runs (
    business_id, workflow_run_id, stage_key, sequence, attempt, status,
    input, output, failure, started_at, completed_at
  )
  values (
    p_business_id,
    p_workflow_run_id,
    'validate',
    4,
    1,
    'failed',
    jsonb_build_object('workerRunId', v_worker_id),
    '{}'::jsonb,
    jsonb_build_object(
      'category', v_category,
      'message', v_message,
      'details', v_details
    ),
    v_now,
    v_now
  )
  on conflict (workflow_run_id, stage_key, attempt) do update
  set
    status = 'failed',
    failure = excluded.failure,
    completed_at = excluded.completed_at;

  update public.workflow_runs
  set
    completed_at = v_now,
    current_stage_key = case
      when v_category = 'validation_failed' then 'validate'
      else 'worker'
    end,
    status = 'failed',
    state = coalesce(state, '{}'::jsonb) || jsonb_build_object(
      'workerRunId', v_worker_id,
      'failureCategory', v_category,
      'outcome', 'failed'
    )
  where id = p_workflow_run_id
    and business_id = p_business_id;

  insert into public.events (
    id, business_id, workflow_run_id, event_type, actor_type,
    actor_id, payload, occurred_at
  )
  values
    (
      private.stage5_deterministic_uuid(
        'event:' || p_workflow_run_id::text || ':worker.failed'
      ),
      p_business_id,
      p_workflow_run_id,
      'worker.failed',
      'worker',
      'generic.researcher',
      jsonb_build_object(
        'workerRunId', v_worker_id,
        'taskContractId', v_task_id,
        'category', v_category,
        'message', v_message
      ),
      v_now
    ),
    (
      private.stage5_deterministic_uuid(
        'event:' || p_workflow_run_id::text || ':workflow.failed'
      ),
      p_business_id,
      p_workflow_run_id,
      'workflow.failed',
      'system',
      null,
      jsonb_build_object(
        'stageKey', case
          when v_category = 'validation_failed' then 'validate'
          else 'worker'
        end,
        'category', v_category
      ),
      v_now
    )
  on conflict (id) do nothing;

  return jsonb_build_object(
    'status', 'failed',
    'failureCategory', v_category
  );
end;
$$;

revoke all on function private.stage5_op_worker_completed_v2(uuid, uuid, jsonb),
  private.stage5_op_worker_failed_v2(uuid, uuid, jsonb)
from public, anon, authenticated, service_role;

create or replace function public.stage5_model_runtime_transition(
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
  v_authorized boolean;
begin
  if p_runtime_capability is null
    or char_length(p_runtime_capability) < 32
    or char_length(p_runtime_capability) > 512
    or p_payload is null
    or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Stage 5 runtime request denied.' using errcode = '42501';
  end if;

  if p_operation in ('worker_completed', 'worker_failed') then
    select true
    into v_authorized
    from public.workflow_runs
    where id = p_workflow_run_id
      and business_id = p_business_id
      and workflow_definition_id = '00000000-0000-4000-8000-000000000503'::uuid
      and runtime_capability_hash = encode(
        extensions.digest(convert_to(p_runtime_capability, 'UTF8'), 'sha256'),
        'hex'
      )
    for update;

    if coalesce(v_authorized, false) is not true then
      raise exception 'Stage 5 runtime capability denied.' using errcode = '42501';
    end if;

    if p_operation = 'worker_completed' then
      return private.stage5_op_worker_completed_v2(
        p_workflow_run_id,
        p_business_id,
        p_payload
      );
    end if;

    return private.stage5_op_worker_failed_v2(
      p_workflow_run_id,
      p_business_id,
      p_payload
    );
  end if;

  return public.stage5_model_runtime_transition_legacy(
    p_workflow_run_id,
    p_business_id,
    p_runtime_capability,
    p_operation,
    p_payload
  );
end;
$$;

revoke all on function public.stage5_model_runtime_transition(uuid, uuid, text, text, jsonb)
  from public, authenticated, service_role;
grant execute on function public.stage5_model_runtime_transition(uuid, uuid, text, text, jsonb)
  to anon;

comment on function public.stage5_model_runtime_transition(uuid, uuid, text, text, jsonb) is
  'Applies bounded Stage 5 transitions and routes corrected worker terminal operations through private helpers.';
