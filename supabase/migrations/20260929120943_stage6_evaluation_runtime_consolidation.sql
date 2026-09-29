create or replace function private.stage6_worker_fingerprint(
  p_worker_definition_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'worker', (to_jsonb(worker) - 'status' - 'created_at' - 'updated_at'),
          'pack', (to_jsonb(pack) - 'status' - 'created_at' - 'updated_at'),
          'route', (to_jsonb(route) - 'created_at' - 'updated_at'),
          'primaryModel', (to_jsonb(primary_model) - 'created_at' - 'updated_at'),
          'fallbackModel', (to_jsonb(fallback_model) - 'created_at' - 'updated_at'),
          'qualifications', coalesce(
            (
              select jsonb_agg(
                jsonb_build_object(
                  'modelDefinitionId', qualification.model_definition_id,
                  'type', qualification.qualification_type,
                  'status', qualification.status,
                  'evidence', qualification.evidence,
                  'checkedAt', qualification.checked_at,
                  'qualifiedAt', qualification.qualified_at
                )
                order by qualification.model_definition_id,
                  qualification.qualification_type
              )
              from public.model_qualifications qualification
              where qualification.model_definition_id in (
                route.primary_model_definition_id,
                route.fallback_model_definition_id
              )
            ),
            '[]'::jsonb
          )
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  from public.worker_definitions worker
  join public.packs pack on pack.id = worker.pack_id
  left join public.model_routes route
    on route.route_key = worker.model_requirements ->> 'routeKey'
  left join public.model_definitions primary_model
    on primary_model.id = route.primary_model_definition_id
  left join public.model_definitions fallback_model
    on fallback_model.id = route.fallback_model_definition_id
  where worker.id = p_worker_definition_id;
$$;

revoke all on function private.stage6_worker_fingerprint(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.stage6_worker_is_currently_qualified(
  p_worker_definition_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.worker_definitions worker
    join public.worker_evaluations evaluation
      on evaluation.worker_definition_id = worker.id
    where worker.id = p_worker_definition_id
      and worker.status in ('qualified', 'assisted', 'autonomous')
      and evaluation.status = 'passed'
      and evaluation.subject_fingerprint =
        private.stage6_worker_fingerprint(worker.id)
  );
$$;

revoke all on function private.stage6_worker_is_currently_qualified(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.worker_definition_is_currently_qualified(
  p_worker_definition_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  return private.stage6_worker_is_currently_qualified(p_worker_definition_id);
end;
$$;

revoke all on function public.worker_definition_is_currently_qualified(uuid)
  from public, anon, service_role;
grant execute on function public.worker_definition_is_currently_qualified(uuid)
  to authenticated;

create or replace function public.begin_worker_evaluation(
  p_worker_definition_id uuid,
  p_suite_key text,
  p_suite_version text,
  p_idempotency_key text,
  p_runtime_capability text,
  p_source text default 'owner'
)
returns table (
  evaluation_id uuid,
  should_start boolean,
  status text,
  subject_fingerprint text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_suite public.worker_evaluation_suites%rowtype;
  v_evaluation public.worker_evaluations%rowtype;
  v_route_id uuid;
  v_primary_model_id uuid;
  v_fallback_model_id uuid;
  v_fingerprint text;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if p_source <> 'owner'
    or p_idempotency_key is null
    or char_length(btrim(p_idempotency_key)) not between 1 and 200
    or p_runtime_capability is null
    or char_length(p_runtime_capability) not between 32 and 512 then
    raise exception 'Worker evaluation launch request is invalid.'
      using errcode = '22023';
  end if;

  select * into v_suite
  from public.worker_evaluation_suites
  where worker_definition_id = p_worker_definition_id
    and suite_key = p_suite_key
    and version = p_suite_version
    and status = 'active';

  if not found then
    raise exception 'Worker evaluation suite is unavailable.'
      using errcode = 'P0002';
  end if;

  select route.id,
    route.primary_model_definition_id,
    route.fallback_model_definition_id
  into v_route_id, v_primary_model_id, v_fallback_model_id
  from public.worker_definitions worker
  join public.model_routes route
    on route.route_key = worker.model_requirements ->> 'routeKey'
  where worker.id = p_worker_definition_id
    and route.status = 'qualified';

  if v_route_id is null then
    raise exception 'Worker model route is not qualified.'
      using errcode = '22023';
  end if;

  v_fingerprint := private.stage6_worker_fingerprint(p_worker_definition_id);
  if v_fingerprint is null then
    raise exception 'Worker evaluation fingerprint could not be generated.'
      using errcode = 'P0002';
  end if;

  insert into public.worker_evaluations (
    worker_definition_id,
    suite_id,
    model_route_id,
    primary_model_definition_id,
    fallback_model_definition_id,
    requested_by,
    source,
    idempotency_key,
    status,
    subject_fingerprint,
    runtime_capability_hash,
    evidence
  )
  values (
    p_worker_definition_id,
    v_suite.id,
    v_route_id,
    v_primary_model_id,
    v_fallback_model_id,
    v_user_id,
    p_source,
    btrim(p_idempotency_key),
    'running',
    v_fingerprint,
    encode(
      extensions.digest(
        convert_to(p_runtime_capability, 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    jsonb_build_object(
      'suiteKey', v_suite.suite_key,
      'suiteVersion', v_suite.version,
      'minimumScore', v_suite.minimum_score,
      'requireAllRequired', v_suite.require_all_required
    )
  )
  on conflict (requested_by, worker_definition_id, idempotency_key)
    do nothing
  returning * into v_evaluation;

  if found then
    return query select
      v_evaluation.id,
      true,
      v_evaluation.status,
      v_evaluation.subject_fingerprint;
    return;
  end if;

  select * into v_evaluation
  from public.worker_evaluations
  where requested_by = v_user_id
    and worker_definition_id = p_worker_definition_id
    and idempotency_key = btrim(p_idempotency_key);

  return query select
    v_evaluation.id,
    false,
    v_evaluation.status,
    v_evaluation.subject_fingerprint;
end;
$$;

revoke all on function public.begin_worker_evaluation(
  uuid, text, text, text, text, text
) from public, anon;
grant execute on function public.begin_worker_evaluation(
  uuid, text, text, text, text, text
) to authenticated;

create or replace function public.stage6_record_worker_evaluation_case(
  p_evaluation_id uuid,
  p_runtime_capability text,
  p_case_key text,
  p_status text,
  p_score_awarded numeric,
  p_model_key text default null,
  p_provider text default null,
  p_provider_model_id text default null,
  p_provider_request_id text default null,
  p_latency_ms integer default null,
  p_usage jsonb default '{}'::jsonb,
  p_output jsonb default null,
  p_failure jsonb default '{}'::jsonb,
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evaluation public.worker_evaluations%rowtype;
  v_case public.worker_evaluation_cases%rowtype;
  v_model_id uuid;
  v_result_id uuid;
begin
  if p_runtime_capability is null
    or char_length(p_runtime_capability) not between 32 and 512
    or p_status not in ('passed', 'failed', 'error')
    or p_usage is null
    or jsonb_typeof(p_usage) <> 'object'
    or p_failure is null
    or jsonb_typeof(p_failure) <> 'object'
    or p_evidence is null
    or jsonb_typeof(p_evidence) <> 'object'
    or (p_output is not null and jsonb_typeof(p_output) <> 'object') then
    raise exception 'Worker evaluation case request is invalid.'
      using errcode = '22023';
  end if;

  select * into v_evaluation
  from public.worker_evaluations
  where id = p_evaluation_id
    and status = 'running'
    and runtime_capability_hash = encode(
      extensions.digest(
        convert_to(p_runtime_capability, 'UTF8'),
        'sha256'
      ),
      'hex'
    )
  for update;

  if not found then
    raise exception 'Worker evaluation capability denied.'
      using errcode = '42501';
  end if;

  select * into v_case
  from public.worker_evaluation_cases
  where suite_id = v_evaluation.suite_id
    and case_key = p_case_key;

  if not found then
    raise exception 'Worker evaluation case is unavailable.'
      using errcode = 'P0002';
  end if;

  if p_score_awarded is null
    or p_score_awarded < 0
    or p_score_awarded > v_case.weight then
    raise exception 'Worker evaluation score is invalid.'
      using errcode = '22023';
  end if;

  if p_model_key is not null then
    select id into v_model_id
    from public.model_definitions
    where model_key = p_model_key;

    if v_model_id is null then
      raise exception 'Evaluation model is not registered.'
        using errcode = '22023';
    end if;
  end if;

  if (v_case.model_target = 'none' and v_model_id is not null)
    or (
      v_case.model_target = 'primary'
      and v_model_id is distinct from v_evaluation.primary_model_definition_id
    )
    or (
      v_case.model_target = 'fallback'
      and v_model_id is distinct from v_evaluation.fallback_model_definition_id
    ) then
    raise exception 'Evaluation model does not match the case target.'
      using errcode = '22023';
  end if;

  insert into public.worker_evaluation_case_results (
    evaluation_id,
    case_id,
    status,
    score_awarded,
    model_definition_id,
    provider,
    provider_model_id,
    provider_request_id,
    input_tokens,
    output_tokens,
    total_tokens,
    cached_input_tokens,
    reasoning_tokens,
    reported_cost_usd,
    estimated_cost_usd,
    latency_ms,
    output,
    failure,
    evidence,
    completed_at
  )
  values (
    v_evaluation.id,
    v_case.id,
    p_status,
    p_score_awarded,
    v_model_id,
    nullif(btrim(p_provider), ''),
    nullif(btrim(p_provider_model_id), ''),
    nullif(btrim(p_provider_request_id), ''),
    coalesce(nullif(p_usage ->> 'inputTokens', '')::integer, 0),
    coalesce(nullif(p_usage ->> 'outputTokens', '')::integer, 0),
    coalesce(nullif(p_usage ->> 'totalTokens', '')::integer, 0),
    coalesce(nullif(p_usage ->> 'cachedInputTokens', '')::integer, 0),
    coalesce(nullif(p_usage ->> 'reasoningTokens', '')::integer, 0),
    nullif(p_usage ->> 'reportedCostUsd', '')::numeric,
    coalesce(nullif(p_usage ->> 'estimatedCostUsd', '')::numeric, 0),
    p_latency_ms,
    p_output,
    p_failure,
    p_evidence,
    now()
  )
  on conflict (evaluation_id, case_id) do update
  set
    status = excluded.status,
    score_awarded = excluded.score_awarded,
    model_definition_id = excluded.model_definition_id,
    provider = excluded.provider,
    provider_model_id = excluded.provider_model_id,
    provider_request_id = excluded.provider_request_id,
    input_tokens = excluded.input_tokens,
    output_tokens = excluded.output_tokens,
    total_tokens = excluded.total_tokens,
    cached_input_tokens = excluded.cached_input_tokens,
    reasoning_tokens = excluded.reasoning_tokens,
    reported_cost_usd = excluded.reported_cost_usd,
    estimated_cost_usd = excluded.estimated_cost_usd,
    latency_ms = excluded.latency_ms,
    output = excluded.output,
    failure = excluded.failure,
    evidence = excluded.evidence,
    completed_at = excluded.completed_at,
    updated_at = now()
  returning id into v_result_id;

  return jsonb_build_object(
    'evaluationId', v_evaluation.id,
    'caseKey', v_case.case_key,
    'resultId', v_result_id,
    'status', p_status
  );
end;
$$;

revoke all on function public.stage6_record_worker_evaluation_case(
  uuid, text, text, text, numeric, text, text, text, text,
  integer, jsonb, jsonb, jsonb, jsonb
) from public, authenticated, service_role;
grant execute on function public.stage6_record_worker_evaluation_case(
  uuid, text, text, text, numeric, text, text, text, text,
  integer, jsonb, jsonb, jsonb, jsonb
) to anon;

create or replace function public.stage6_complete_worker_evaluation(
  p_evaluation_id uuid,
  p_runtime_capability text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evaluation public.worker_evaluations%rowtype;
  v_suite public.worker_evaluation_suites%rowtype;
  v_current_fingerprint text;
  v_case_count integer;
  v_result_count integer;
  v_passed_count integer;
  v_required_count integer;
  v_required_failure_count integer;
  v_total_weight numeric;
  v_awarded_weight numeric;
  v_score numeric(5, 2);
  v_status text;
  v_previous_status text;
  v_pack_id uuid;
begin
  if p_runtime_capability is null
    or char_length(p_runtime_capability) not between 32 and 512 then
    raise exception 'Worker evaluation completion request is invalid.'
      using errcode = '22023';
  end if;

  select * into v_evaluation
  from public.worker_evaluations
  where id = p_evaluation_id
    and runtime_capability_hash = encode(
      extensions.digest(
        convert_to(p_runtime_capability, 'UTF8'),
        'sha256'
      ),
      'hex'
    )
  for update;

  if not found then
    raise exception 'Worker evaluation capability denied.'
      using errcode = '42501';
  end if;

  if v_evaluation.status <> 'running' then
    return jsonb_build_object(
      'evaluationId', v_evaluation.id,
      'status', v_evaluation.status,
      'score', v_evaluation.score
    );
  end if;

  select * into v_suite
  from public.worker_evaluation_suites
  where id = v_evaluation.suite_id;

  select
    count(*)::integer,
    count(*) filter (where evaluation_case.required)::integer,
    coalesce(sum(evaluation_case.weight), 0)
  into v_case_count, v_required_count, v_total_weight
  from public.worker_evaluation_cases evaluation_case
  where evaluation_case.suite_id = v_evaluation.suite_id;

  select
    count(result.id)::integer,
    count(result.id) filter (where result.status = 'passed')::integer,
    coalesce(sum(result.score_awarded), 0),
    count(*) filter (
      where evaluation_case.required
        and (result.id is null or result.status <> 'passed')
    )::integer
  into
    v_result_count,
    v_passed_count,
    v_awarded_weight,
    v_required_failure_count
  from public.worker_evaluation_cases evaluation_case
  left join public.worker_evaluation_case_results result
    on result.case_id = evaluation_case.id
   and result.evaluation_id = v_evaluation.id
  where evaluation_case.suite_id = v_evaluation.suite_id;

  v_score := case
    when v_total_weight > 0
      then round((v_awarded_weight / v_total_weight) * 100, 2)
    else 0
  end;
  v_current_fingerprint := private.stage6_worker_fingerprint(
    v_evaluation.worker_definition_id
  );

  if v_current_fingerprint is distinct from v_evaluation.subject_fingerprint then
    v_status := 'stale';
  elsif v_result_count = v_case_count
    and (
      not v_suite.require_all_required
      or v_required_failure_count = 0
    )
    and v_score >= v_suite.minimum_score then
    v_status := 'passed';
  else
    v_status := 'failed';
  end if;

  update public.worker_evaluations
  set
    status = v_status,
    score = v_score,
    passed_case_count = v_passed_count,
    failed_case_count = v_case_count - v_passed_count,
    required_case_count = v_required_count,
    required_failure_count = v_required_failure_count,
    completed_at = now(),
    evidence = evidence || jsonb_build_object(
      'caseCount', v_case_count,
      'resultCount', v_result_count,
      'totalWeight', v_total_weight,
      'awardedWeight', v_awarded_weight,
      'currentFingerprint', v_current_fingerprint
    )
  where id = v_evaluation.id;

  select status, pack_id
  into v_previous_status, v_pack_id
  from public.worker_definitions
  where id = v_evaluation.worker_definition_id
  for update;

  if v_status = 'passed' then
    update public.worker_definitions
    set status = case
      when status in ('assisted', 'autonomous') then status
      else 'qualified'
    end
    where id = v_evaluation.worker_definition_id;

    update public.packs
    set status = case
      when status in ('assisted', 'autonomous') then status
      else 'qualified'
    end
    where id = v_pack_id;

    if v_previous_status = 'experimental' then
      insert into public.worker_promotions (
        worker_definition_id,
        evaluation_id,
        from_status,
        to_status,
        reason,
        evidence
      )
      values (
        v_evaluation.worker_definition_id,
        v_evaluation.id,
        v_previous_status,
        'qualified',
        'All required Stage 6 evaluations passed for the current Worker Pack and model route fingerprint.',
        jsonb_build_object(
          'score', v_score,
          'fingerprint', v_current_fingerprint
        )
      );
    end if;
  elsif v_previous_status in ('qualified', 'assisted', 'autonomous') then
    update public.worker_definitions
    set status = 'experimental'
    where id = v_evaluation.worker_definition_id;

    update public.packs
    set status = 'experimental'
    where id = v_pack_id;

    insert into public.worker_promotions (
      worker_definition_id,
      evaluation_id,
      from_status,
      to_status,
      reason,
      evidence
    )
    values (
      v_evaluation.worker_definition_id,
      v_evaluation.id,
      v_previous_status,
      'experimental',
      case
        when v_status = 'stale'
          then 'The Worker Pack or model route fingerprint changed and requires reevaluation.'
        else 'A required Worker evaluation failed.'
      end,
      jsonb_build_object('score', v_score, 'status', v_status)
    );
  end if;

  return jsonb_build_object(
    'evaluationId', v_evaluation.id,
    'status', v_status,
    'score', v_score,
    'passedCaseCount', v_passed_count,
    'failedCaseCount', v_case_count - v_passed_count,
    'requiredFailureCount', v_required_failure_count
  );
end;
$$;

revoke all on function public.stage6_complete_worker_evaluation(uuid, text)
  from public, authenticated, service_role;
grant execute on function public.stage6_complete_worker_evaluation(uuid, text)
  to anon;

comment on function public.begin_worker_evaluation(
  uuid, text, text, text, text, text
) is 'Reserves one authenticated owner-triggered Worker evaluation with an exact Worker and model-route fingerprint.';
comment on function public.stage6_record_worker_evaluation_case(
  uuid, text, text, text, numeric, text, text, text, text,
  integer, jsonb, jsonb, jsonb, jsonb
) is 'Persists one capability-gated Worker evaluation case result and model telemetry record.';
comment on function public.stage6_complete_worker_evaluation(uuid, text) is
  'Scores one capability-gated Worker evaluation and promotes only after all required current-fingerprint cases pass.';
