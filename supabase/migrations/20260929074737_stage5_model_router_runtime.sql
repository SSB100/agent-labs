create or replace function private.stage5_worker_context(
  p_workflow_run_id uuid,
  p_business_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'taskContract', jsonb_build_object(
      'id', task.id,
      'objective', task.objective,
      'inputArtifactIds', to_jsonb(task.input_artifact_ids),
      'permittedCapabilities', to_jsonb(task.permitted_capabilities),
      'requiredKnowledge', to_jsonb(task.required_knowledge),
      'requiredOutputSchema', task.required_output_schema,
      'completionCriteria', task.completion_criteria,
      'failureCriteria', task.failure_criteria,
      'nonGoals', to_jsonb(task.non_goals),
      'escalationRules', task.escalation_rules
    ),
    'inputArtifacts', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', artifact.id,
            'artifactType', artifact.artifact_type,
            'name', artifact.name,
            'mediaType', artifact.media_type,
            'content', artifact.content,
            'metadata', artifact.metadata
          )
          order by artifact.id
        )
        from public.artifacts artifact
        where artifact.business_id = task.business_id
          and artifact.workflow_run_id = task.workflow_run_id
          and artifact.id = any(task.input_artifact_ids)
      ),
      '[]'::jsonb
    )
  )
  from public.task_contracts task
  where task.id = private.stage5_deterministic_uuid(
      'stage5:task:' || p_workflow_run_id::text
    )
    and task.workflow_run_id = p_workflow_run_id
    and task.business_id = p_business_id;
$$;

revoke all on function private.stage5_worker_context(uuid, uuid)
  from public, anon, authenticated;

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
  v_run public.workflow_runs%rowtype;
  v_worker public.worker_runs%rowtype;
  v_now timestamptz := now();
  v_proof_mode text;
  v_runtime_id text;
  v_category text;
  v_message text;
  v_details jsonb;
  v_output jsonb;
  v_receipt jsonb;
  v_context jsonb;
  v_schema jsonb;
  v_stage_id uuid;
  v_route_id uuid;
  v_route_key text;
  v_primary_model_key text;
  v_fallback_model_key text;
  v_selected_model_key text;
  v_model_definition_id uuid;
  v_provider_model_id text;
  v_provider_family text;
  v_attempt integer;
  v_usage jsonb;
  v_input_id uuid := private.stage5_deterministic_uuid(
    'stage5:input:' || p_workflow_run_id::text
  );
  v_task_id uuid := private.stage5_deterministic_uuid(
    'stage5:task:' || p_workflow_run_id::text
  );
  v_worker_id uuid := private.stage5_deterministic_uuid(
    'stage5:worker:' || p_workflow_run_id::text || ':1'
  );
  v_output_id uuid := private.stage5_deterministic_uuid(
    'stage5:output:' || p_workflow_run_id::text
  );
  v_invocation_id uuid;
  v_objective text := 'Summarise the three supplied synthetic market signals, clearly separate evidence from inference, and stop without recommending a business strategy.';
begin
  if p_runtime_capability is null
    or char_length(p_runtime_capability) < 32
    or char_length(p_runtime_capability) > 512
    or p_payload is null
    or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Stage 5 runtime request denied.' using errcode = '42501';
  end if;

  select *
  into v_run
  from public.workflow_runs
  where id = p_workflow_run_id
    and business_id = p_business_id
    and workflow_definition_id = '00000000-0000-4000-8000-000000000503'::uuid
    and runtime_capability_hash = encode(
      extensions.digest(convert_to(p_runtime_capability, 'UTF8'), 'sha256'),
      'hex'
    )
  for update;

  if not found then
    raise exception 'Stage 5 runtime capability denied.' using errcode = '42501';
  end if;

  v_proof_mode := coalesce(v_run.input ->> 'proofMode', 'live');
  if v_proof_mode not in ('live', 'fallback-proof') then
    raise exception 'Stored model proof mode is invalid.' using errcode = '22023';
  end if;

  if p_operation = 'runtime_started' then
    v_runtime_id := nullif(btrim(p_payload ->> 'runtimeRunId'), '');
    if v_runtime_id is null or char_length(v_runtime_id) > 300 then
      raise exception 'Runtime run identifier is invalid.' using errcode = '22023';
    end if;

    update public.workflow_runs
    set
      current_stage_key = 'start',
      runtime_launch_status = 'started',
      runtime_provider = 'vercel_workflow',
      runtime_run_id = v_runtime_id,
      started_at = coalesce(started_at, v_now),
      status = 'running',
      state = coalesce(state, '{}'::jsonb) || jsonb_build_object(
        'runtimeRunId', v_runtime_id,
        'proofMode', v_proof_mode
      )
    where id = p_workflow_run_id;

    insert into public.workflow_stage_runs (
      business_id, workflow_run_id, stage_key, sequence, attempt, status,
      input, output, failure, started_at, completed_at
    )
    values (
      p_business_id, p_workflow_run_id, 'start', 0, 1, 'completed',
      '{}'::jsonb,
      jsonb_build_object('runtimeRunId', v_runtime_id),
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
        private.stage5_deterministic_uuid(
          'event:' || p_workflow_run_id::text || ':workflow.started'
        ),
        p_business_id,
        p_workflow_run_id,
        'workflow.started',
        'system',
        jsonb_build_object(
          'runtimeRunId', v_runtime_id,
          'workflowKey', 'synthetic.model-router.runtime-proof',
          'proofMode', v_proof_mode
        ),
        v_now
      ),
      (
        private.stage5_deterministic_uuid(
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

    return jsonb_build_object('runtimeRunId', v_runtime_id, 'status', 'running');
  end if;

  if p_operation = 'prepare_task' then
    select output_schema
    into v_schema
    from public.worker_definitions
    where id = '00000000-0000-4000-8000-000000000502'::uuid;

    if v_schema is null then
      raise exception 'The model-backed worker definition is unavailable.' using errcode = 'P0002';
    end if;

    insert into public.artifacts (
      id, business_id, workflow_run_id, artifact_type, name,
      media_type, content, metadata
    )
    values (
      v_input_id,
      p_business_id,
      p_workflow_run_id,
      'fixture.market-signals',
      'Synthetic market signals for model routing',
      'application/json',
      jsonb_build_object(
        'proofMode', v_proof_mode,
        'question', v_objective,
        'signals', jsonb_build_array(
          jsonb_build_object(
            'id', 'signal-1',
            'observation', 'Three of five supplied synthetic listings use concise buyer-language phrases in their titles.'
          ),
          jsonb_build_object(
            'id', 'signal-2',
            'observation', 'The supplied synthetic price observations cluster within a narrow mid-range band.'
          ),
          jsonb_build_object(
            'id', 'signal-3',
            'observation', 'Two supplied synthetic review excerpts mention gift suitability and easy sizing.'
          )
        )
      ),
      jsonb_build_object(
        'knowledgeKey', 'fixture.synthetic-market-signals',
        'source', 'stage5-model-router-proof'
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
    values (
      p_business_id,
      p_workflow_run_id,
      'task-contract',
      1,
      1,
      'completed',
      jsonb_build_object('proofMode', v_proof_mode),
      jsonb_build_object(
        'taskContractId', v_task_id,
        'inputArtifactId', v_input_id,
        'workerKey', 'generic.researcher'
      ),
      '{}'::jsonb,
      v_now,
      v_now
    )
    on conflict (workflow_run_id, stage_key, attempt) do update
    set
      status = 'completed',
      output = excluded.output,
      completed_at = excluded.completed_at
    returning id into v_stage_id;

    insert into public.task_contracts (
      id, business_id, workflow_run_id, workflow_stage_run_id,
      worker_definition_id, status, objective, input_artifact_ids,
      permitted_capabilities, required_knowledge, required_output_schema,
      completion_criteria, failure_criteria, non_goals, escalation_rules
    )
    values (
      v_task_id,
      p_business_id,
      p_workflow_run_id,
      v_stage_id,
      '00000000-0000-4000-8000-000000000502',
      'ready',
      v_objective,
      array[v_input_id],
      array[]::text[],
      array['fixture.synthetic-market-signals'],
      v_schema,
      jsonb_build_object(
        'requiredDecision', 'complete',
        'minimumEvidenceCount', 3,
        'requiredStopReason', 'completion_criteria_satisfied'
      ),
      jsonb_build_object(
        'allowedCategories', jsonb_build_array(
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
          'malformed_model_output'
        )
      ),
      array[
        'Choose a final business strategy',
        'Browse for additional evidence',
        'Create or publish a product'
      ],
      jsonb_build_object(
        'onProviderFailure', 'one_qualified_fallback_then_stop',
        'maximumModelAttempts', 2,
        'onValidationFailure', 'classify_and_stop'
      )
    )
    on conflict (id) do update
    set
      status = case
        when public.task_contracts.status in ('completed', 'failed', 'cancelled')
          then public.task_contracts.status
        else 'ready'
      end,
      updated_at = v_now;

    v_context := private.stage5_worker_context(p_workflow_run_id, p_business_id);

    update public.workflow_runs
    set
      current_stage_key = 'route',
      status = 'running',
      state = coalesce(state, '{}'::jsonb) || jsonb_build_object(
        'taskContractId', v_task_id,
        'inputArtifactId', v_input_id,
        'modelRouteKey', 'standard.default'
      )
    where id = p_workflow_run_id
      and status not in ('completed', 'failed', 'cancelled');

    insert into public.events (
      id, business_id, workflow_run_id, event_type, actor_type, payload, occurred_at
    )
    values
      (
        private.stage5_deterministic_uuid(
          'event:' || p_workflow_run_id::text || ':task-contract.created'
        ),
        p_business_id,
        p_workflow_run_id,
        'task_contract.created',
        'system',
        jsonb_build_object(
          'taskContractId', v_task_id,
          'workerKey', 'generic.researcher',
          'modelRouteKey', 'standard.default'
        ),
        v_now
      ),
      (
        private.stage5_deterministic_uuid(
          'event:' || p_workflow_run_id::text || ':stage.task-contract.completed'
        ),
        p_business_id,
        p_workflow_run_id,
        'workflow.stage.completed',
        'system',
        jsonb_build_object('stageKey', 'task-contract'),
        v_now
      )
    on conflict (id) do nothing;

    return jsonb_build_object('context', v_context, 'status', 'ready');
  end if;

  if p_operation = 'route_resolved' then
    v_route_key := nullif(btrim(p_payload ->> 'routeKey'), '');
    v_primary_model_key := nullif(btrim(p_payload ->> 'primaryModelKey'), '');
    v_fallback_model_key := nullif(btrim(p_payload ->> 'fallbackModelKey'), '');

    select
      route.id,
      primary_model.model_key,
      fallback_model.model_key
    into
      v_route_id,
      v_primary_model_key,
      v_fallback_model_key
    from public.model_routes route
    join public.model_definitions primary_model
      on primary_model.id = route.primary_model_definition_id
    join public.model_definitions fallback_model
      on fallback_model.id = route.fallback_model_definition_id
    where route.route_key = v_route_key
      and route.status = 'qualified'
      and primary_model.model_key = p_payload ->> 'primaryModelKey'
      and fallback_model.model_key = p_payload ->> 'fallbackModelKey'
      and route.maximum_attempts = coalesce(
        nullif(p_payload ->> 'maximumAttempts', '')::integer,
        route.maximum_attempts
      );

    if v_route_id is null then
      raise exception 'The requested model route is not qualified.' using errcode = '22023';
    end if;

    insert into public.workflow_stage_runs (
      business_id, workflow_run_id, stage_key, sequence, attempt, status,
      input, output, failure, started_at, completed_at
    )
    values (
      p_business_id,
      p_workflow_run_id,
      'route',
      2,
      1,
      'completed',
      jsonb_build_object('routeKey', v_route_key),
      jsonb_build_object(
        'routeId', v_route_id,
        'primaryModelKey', v_primary_model_key,
        'fallbackModelKey', v_fallback_model_key,
        'maximumAttempts', 2
      ),
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
      current_stage_key = 'worker',
      state = coalesce(state, '{}'::jsonb) || jsonb_build_object(
        'modelRouteId', v_route_id,
        'modelRouteKey', v_route_key,
        'primaryModelKey', v_primary_model_key,
        'fallbackModelKey', v_fallback_model_key
      )
    where id = p_workflow_run_id;

    insert into public.events (
      id, business_id, workflow_run_id, event_type, actor_type, payload, occurred_at
    )
    values
      (
        private.stage5_deterministic_uuid(
          'event:' || p_workflow_run_id::text || ':model.route.resolved'
        ),
        p_business_id,
        p_workflow_run_id,
        'model.route.resolved',
        'system',
        jsonb_build_object(
          'routeKey', v_route_key,
          'primaryModelKey', v_primary_model_key,
          'fallbackModelKey', v_fallback_model_key,
          'maximumAttempts', 2
        ),
        v_now
      ),
      (
        private.stage5_deterministic_uuid(
          'event:' || p_workflow_run_id::text || ':stage.route.completed'
        ),
        p_business_id,
        p_workflow_run_id,
        'workflow.stage.completed',
        'system',
        jsonb_build_object('stageKey', 'route'),
        v_now
      )
    on conflict (id) do nothing;

    return jsonb_build_object(
      'routeId', v_route_id,
      'routeKey', v_route_key,
      'status', 'qualified'
    );
  end if;

  if p_operation = 'worker_started' then
    select *
    into v_worker
    from public.worker_runs
    where id = v_worker_id
      and business_id = p_business_id;

    if found and v_worker.status = 'completed' then
      return jsonb_build_object(
        'completed', true,
        'output', v_worker.output,
        'receipt', coalesce(v_worker.execution_metadata -> 'receipt', '{}'::jsonb),
        'selectedModelKey', v_worker.execution_metadata ->> 'selectedModelKey',
        'modelRouteKey', v_worker.execution_metadata ->> 'modelRouteKey'
      );
    end if;

    if found and v_worker.status = 'failed' then
      return jsonb_build_object(
        'failed', true,
        'failureCategory', v_worker.failure ->> 'category'
      );
    end if;

    v_context := private.stage5_worker_context(p_workflow_run_id, p_business_id);
    if v_context is null then
      raise exception 'The Task Contract is not ready.' using errcode = '22023';
    end if;

    if not exists (
      select 1
      from public.workflow_stage_runs
      where workflow_run_id = p_workflow_run_id
        and business_id = p_business_id
        and stage_key = 'route'
        and attempt = 1
        and status = 'completed'
    ) then
      raise exception 'The model route has not been resolved.' using errcode = '22023';
    end if;

    insert into public.workflow_stage_runs (
      business_id, workflow_run_id, stage_key, sequence, attempt, status,
      input, output, failure, started_at
    )
    values (
      p_business_id,
      p_workflow_run_id,
      'worker',
      3,
      1,
      'running',
      jsonb_build_object('taskContractId', v_task_id, 'modelRouteKey', 'standard.default'),
      '{}'::jsonb,
      '{}'::jsonb,
      v_now
    )
    on conflict (workflow_run_id, stage_key, attempt) do update
    set status = case
      when public.workflow_stage_runs.status in ('completed', 'failed')
        then public.workflow_stage_runs.status
      else 'running'
    end;

    insert into public.worker_runs (
      id, business_id, workflow_run_id, task_contract_id,
      worker_definition_id, status, input, output, failure,
      execution_metadata, started_at
    )
    values (
      v_worker_id,
      p_business_id,
      p_workflow_run_id,
      v_task_id,
      '00000000-0000-4000-8000-000000000502',
      'running',
      v_context,
      '{}'::jsonb,
      '{}'::jsonb,
      jsonb_build_object(
        'attempt', 1,
        'packKey', 'worker.generic-researcher',
        'packVersion', '1.0.0',
        'workerKey', 'generic.researcher',
        'workerVersion', '1.0.0',
        'contextPolicy', 'task_contract_and_referenced_artifacts_only',
        'conversationHistoryIncluded', false,
        'modelRouterRequired', true,
        'modelRouteKey', 'standard.default'
      ),
      v_now
    )
    on conflict (id) do update
    set
      status = case
        when public.worker_runs.status in ('completed', 'failed', 'cancelled')
          then public.worker_runs.status
        else 'running'
      end,
      updated_at = v_now;

    update public.task_contracts
    set status = 'running'
    where id = v_task_id
      and status = 'ready';

    update public.workflow_runs
    set current_stage_key = 'worker', status = 'running'
    where id = p_workflow_run_id
      and status not in ('completed', 'failed', 'cancelled');

    insert into public.events (
      id, business_id, workflow_run_id, event_type, actor_type,
      actor_id, payload, occurred_at
    )
    values (
      private.stage5_deterministic_uuid(
        'event:' || p_workflow_run_id::text || ':worker.started'
      ),
      p_business_id,
      p_workflow_run_id,
      'worker.started',
      'worker',
      'generic.researcher',
      jsonb_build_object(
        'workerRunId', v_worker_id,
        'taskContractId', v_task_id,
        'workerKey', 'generic.researcher',
        'workerVersion', '1.0.0',
        'modelRouteKey', 'standard.default'
      ),
      v_now
    )
    on conflict (id) do nothing;

    return jsonb_build_object('completed', false, 'workerRunId', v_worker_id);
  end if;

  if p_operation = 'invocation_started' then
    v_attempt := nullif(p_payload ->> 'attempt', '')::integer;
    v_route_key := nullif(btrim(p_payload ->> 'routeKey'), '');
    v_selected_model_key := nullif(btrim(p_payload ->> 'modelKey'), '');
    v_provider_model_id := nullif(btrim(p_payload ->> 'providerModelId'), '');
    v_provider_family := nullif(btrim(p_payload ->> 'providerFamily'), '');

    if v_attempt not in (1, 2) then
      raise exception 'The model attempt is invalid.' using errcode = '22023';
    end if;

    select route.id, model.id
    into v_route_id, v_model_definition_id
    from public.model_routes route
    join public.model_definitions model
      on model.model_key = v_selected_model_key
    where route.route_key = v_route_key
      and route.status = 'qualified'
      and model.provider_model_id = v_provider_model_id
      and model.provider_family = v_provider_family
      and (
        (v_attempt = 1 and model.id = route.primary_model_definition_id)
        or
        (v_attempt = 2 and model.id = route.fallback_model_definition_id)
      );

    if v_route_id is null or v_model_definition_id is null then
      raise exception 'The model attempt does not match the qualified route.' using errcode = '22023';
    end if;

    v_invocation_id := private.stage5_deterministic_uuid(
      'stage5:invocation:' || p_workflow_run_id::text || ':' || v_attempt::text
    );

    insert into public.model_invocations (
      id, business_id, workflow_run_id, task_contract_id, worker_run_id,
      model_route_id, model_definition_id, attempt, status,
      provider, provider_model_id, metadata, started_at
    )
    values (
      v_invocation_id,
      p_business_id,
      p_workflow_run_id,
      v_task_id,
      v_worker_id,
      v_route_id,
      v_model_definition_id,
      v_attempt,
      'started',
      'openrouter',
      v_provider_model_id,
      jsonb_build_object(
        'modelKey', v_selected_model_key,
        'providerFamily', v_provider_family,
        'proofMode', v_proof_mode
      ),
      v_now
    )
    on conflict (workflow_run_id, attempt) do update
    set
      status = case
        when public.model_invocations.status = 'completed'
          then public.model_invocations.status
        else 'started'
      end,
      model_route_id = excluded.model_route_id,
      model_definition_id = excluded.model_definition_id,
      provider_model_id = excluded.provider_model_id,
      metadata = public.model_invocations.metadata || excluded.metadata,
      updated_at = v_now;

    insert into public.events (
      id, business_id, workflow_run_id, event_type, actor_type,
      actor_id, payload, occurred_at
    )
    values (
      private.stage5_deterministic_uuid(
        'event:' || p_workflow_run_id::text || ':model.invocation.started:' || v_attempt::text
      ),
      p_business_id,
      p_workflow_run_id,
      'model.invocation.started',
      'provider',
      v_selected_model_key,
      jsonb_build_object(
        'attempt', v_attempt,
        'modelKey', v_selected_model_key,
        'providerModelId', v_provider_model_id,
        'routeKey', v_route_key
      ),
      v_now
    )
    on conflict (id) do nothing;

    return jsonb_build_object(
      'invocationId', v_invocation_id,
      'attempt', v_attempt,
      'status', 'started'
    );
  end if;

  if p_operation = 'invocation_completed' then
    v_attempt := nullif(p_payload ->> 'attempt', '')::integer;
    v_usage := coalesce(p_payload -> 'usage', '{}'::jsonb);
    if v_attempt not in (1, 2) or jsonb_typeof(v_usage) <> 'object' then
      raise exception 'Completed model invocation telemetry is invalid.' using errcode = '22023';
    end if;

    update public.model_invocations
    set
      status = 'completed',
      provider = coalesce(nullif(p_payload ->> 'provider', ''), provider),
      provider_model_id = coalesce(
        nullif(p_payload ->> 'providerModelId', ''),
        provider_model_id
      ),
      provider_request_id = nullif(p_payload ->> 'providerRequestId', ''),
      failure_category = null,
      failure_message = null,
      input_tokens = coalesce(nullif(v_usage ->> 'inputTokens', '')::integer, 0),
      output_tokens = coalesce(nullif(v_usage ->> 'outputTokens', '')::integer, 0),
      total_tokens = coalesce(nullif(v_usage ->> 'totalTokens', '')::integer, 0),
      cached_input_tokens = coalesce(
        nullif(v_usage ->> 'cachedInputTokens', '')::integer,
        0
      ),
      reasoning_tokens = coalesce(
        nullif(v_usage ->> 'reasoningTokens', '')::integer,
        0
      ),
      reported_cost_usd = nullif(v_usage ->> 'reportedCostUsd', '')::numeric,
      estimated_cost_usd = coalesce(
        nullif(v_usage ->> 'estimatedCostUsd', '')::numeric,
        0
      ),
      latency_ms = nullif(p_payload ->> 'latencyMs', '')::integer,
      usage = v_usage,
      metadata = metadata || coalesce(p_payload -> 'metadata', '{}'::jsonb),
      completed_at = v_now,
      updated_at = v_now
    where workflow_run_id = p_workflow_run_id
      and business_id = p_business_id
      and attempt = v_attempt;

    if not found then
      raise exception 'The model invocation was not started.' using errcode = 'P0002';
    end if;

    insert into public.events (
      id, business_id, workflow_run_id, event_type, actor_type,
      actor_id, payload, occurred_at
    )
    select
      private.stage5_deterministic_uuid(
        'event:' || p_workflow_run_id::text || ':model.invocation.completed:' || v_attempt::text
      ),
      p_business_id,
      p_workflow_run_id,
      'model.invocation.completed',
      'provider',
      model.model_key,
      jsonb_build_object(
        'attempt', invocation.attempt,
        'modelKey', model.model_key,
        'providerModelId', invocation.provider_model_id,
        'inputTokens', invocation.input_tokens,
        'outputTokens', invocation.output_tokens,
        'reportedCostUsd', invocation.reported_cost_usd,
        'estimatedCostUsd', invocation.estimated_cost_usd
      ),
      v_now
    from public.model_invocations invocation
    join public.model_definitions model
      on model.id = invocation.model_definition_id
    where invocation.workflow_run_id = p_workflow_run_id
      and invocation.attempt = v_attempt
    on conflict (id) do nothing;

    return jsonb_build_object('attempt', v_attempt, 'status', 'completed');
  end if;

  if p_operation = 'invocation_failed' then
    v_attempt := nullif(p_payload ->> 'attempt', '')::integer;
    v_category := nullif(btrim(p_payload ->> 'failureCategory'), '');
    v_message := left(coalesce(p_payload ->> 'failureMessage', 'Model invocation failed.'), 500);

    if v_attempt not in (1, 2)
      or v_category not in (
        'configuration_required',
        'authentication_required',
        'rate_limited',
        'provider_timeout',
        'provider_unavailable',
        'provider_rejected',
        'malformed_model_output',
        'tool_qualification_failed'
      ) then
      raise exception 'Failed model invocation telemetry is invalid.' using errcode = '22023';
    end if;

    update public.model_invocations
    set
      status = 'failed',
      failure_category = v_category,
      failure_message = v_message,
      metadata = metadata || coalesce(p_payload -> 'metadata', '{}'::jsonb),
      completed_at = v_now,
      updated_at = v_now
    where workflow_run_id = p_workflow_run_id
      and business_id = p_business_id
      and attempt = v_attempt;

    if not found then
      raise exception 'The model invocation was not started.' using errcode = 'P0002';
    end if;

    insert into public.events (
      id, business_id, workflow_run_id, event_type, actor_type,
      actor_id, payload, occurred_at
    )
    select
      private.stage5_deterministic_uuid(
        'event:' || p_workflow_run_id::text || ':model.invocation.failed:' || v_attempt::text
      ),
      p_business_id,
      p_workflow_run_id,
      'model.invocation.failed',
      'provider',
      model.model_key,
      jsonb_build_object(
        'attempt', invocation.attempt,
        'modelKey', model.model_key,
        'category', v_category,
        'message', v_message
      ),
      v_now
    from public.model_invocations invocation
    join public.model_definitions model
      on model.id = invocation.model_definition_id
    where invocation.workflow_run_id = p_workflow_run_id
      and invocation.attempt = v_attempt
    on conflict (id) do nothing;

    return jsonb_build_object(
      'attempt', v_attempt,
      'status', 'failed',
      'failureCategory', v_category
    );
  end if;

  if p_operation = 'worker_completed' then
    v_output := p_payload -> 'output';
    v_receipt := p_payload -> 'receipt';
    v_route_key := nullif(btrim(p_payload ->> 'routeKey'), '');
    v_selected_model_key := nullif(btrim(p_payload ->> 'selectedModelKey'), '');

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
      and status in ('running', 'completed');

    if not found then
      raise exception 'Worker Run is not available for completion.' using errcode = 'P0002';
    end if;

    update public.task_contracts
    set status = 'completed'
    where id = v_task_id
      and business_id = p_business_id;

    update public.workflow_stage_runs
    set
      completed_at = v_now,
      output = jsonb_build_object(
        'workerRunId', v_worker_id,
        'outputArtifactId', v_output_id,
        'selectedModelKey', v_selected_model_key,
        'modelRouteKey', v_route_key
      ),
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
    where id = p_workflow_run_id;

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
  end if;

  if p_operation = 'worker_failed' then
    v_category := nullif(btrim(p_payload ->> 'category'), '');
    v_message := left(coalesce(p_payload ->> 'message', 'Model worker failed.'), 500);
    v_details := coalesce(p_payload -> 'details', '{}'::jsonb);

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
      and status in ('running', 'failed');

    update public.task_contracts
    set status = 'failed'
    where id = v_task_id
      and business_id = p_business_id;

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
    where id = p_workflow_run_id;

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
  end if;

  raise exception 'Unsupported Stage 5 runtime operation.' using errcode = '22023';
end;
$$;

revoke all on function public.stage5_model_runtime_transition(uuid, uuid, text, text, jsonb)
  from public, authenticated, service_role;
grant execute on function public.stage5_model_runtime_transition(uuid, uuid, text, text, jsonb)
  to anon;

comment on function private.stage5_worker_context(uuid, uuid) is
  'Builds the exact Task Contract and referenced-artifact context for one Stage 5 model-backed worker.';
comment on function public.stage5_model_runtime_transition(uuid, uuid, text, text, jsonb) is
  'Applies bounded Stage 5 route, model invocation, token, cost and worker transitions after validating a one-run capability.';