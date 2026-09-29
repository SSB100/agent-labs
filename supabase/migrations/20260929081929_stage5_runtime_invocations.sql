create or replace function private.stage5_op_invocation_started(
  p_workflow_run_id uuid,p_business_id uuid,p_proof_mode text,p_payload jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz:=now();
  v_attempt integer:=nullif(p_payload->>'attempt','')::integer;
  v_route_key text:=nullif(btrim(p_payload->>'routeKey'),'');
  v_model_key text:=nullif(btrim(p_payload->>'modelKey'),'');
  v_provider_model text:=nullif(btrim(p_payload->>'providerModelId'),'');
  v_family text:=nullif(btrim(p_payload->>'providerFamily'),'');
  v_route uuid;
  v_model uuid;
  v_invocation uuid;
  v_task uuid:=private.stage5_deterministic_uuid('stage5:task:'||p_workflow_run_id);
  v_worker uuid:=private.stage5_deterministic_uuid('stage5:worker:'||p_workflow_run_id||':1');
begin
  if v_attempt not in (1,2) then
    raise exception 'The model attempt is invalid.' using errcode='22023';
  end if;
  select route.id,model.id into v_route,v_model
  from public.model_routes route
  join public.model_definitions model on model.model_key=v_model_key
  where route.route_key=v_route_key and route.status='qualified'
    and model.provider_model_id=v_provider_model
    and model.provider_family=v_family
    and ((v_attempt=1 and model.id=route.primary_model_definition_id)
      or (v_attempt=2 and model.id=route.fallback_model_definition_id));
  if v_route is null or v_model is null then
    raise exception 'The model attempt does not match the qualified route.' using errcode='22023';
  end if;

  v_invocation:=private.stage5_deterministic_uuid(
    'stage5:invocation:'||p_workflow_run_id||':'||v_attempt
  );
  insert into public.model_invocations (
    id,business_id,workflow_run_id,task_contract_id,worker_run_id,
    model_route_id,model_definition_id,attempt,status,provider,
    provider_model_id,metadata,started_at
  ) values (
    v_invocation,p_business_id,p_workflow_run_id,v_task,v_worker,
    v_route,v_model,v_attempt,'started','openrouter',v_provider_model,
    jsonb_build_object('modelKey',v_model_key,'providerFamily',v_family,'proofMode',p_proof_mode),v_now
  ) on conflict (workflow_run_id,attempt) do update set
    status=case when public.model_invocations.status='completed'
      then public.model_invocations.status else 'started' end,
    model_route_id=excluded.model_route_id,
    model_definition_id=excluded.model_definition_id,
    provider_model_id=excluded.provider_model_id,
    metadata=public.model_invocations.metadata || excluded.metadata,
    updated_at=v_now;

  insert into public.events (
    id,business_id,workflow_run_id,event_type,actor_type,actor_id,payload,occurred_at
  ) values (
    private.stage5_deterministic_uuid(
      'event:'||p_workflow_run_id||':model.invocation.started:'||v_attempt
    ),p_business_id,p_workflow_run_id,'model.invocation.started','provider',v_model_key,
    jsonb_build_object(
      'attempt',v_attempt,'modelKey',v_model_key,
      'providerModelId',v_provider_model,'routeKey',v_route_key
    ),v_now
  ) on conflict (id) do nothing;
  return jsonb_build_object('invocationId',v_invocation,'attempt',v_attempt,'status','started');
end;
$$;

create or replace function private.stage5_op_invocation_completed(
  p_workflow_run_id uuid,p_business_id uuid,p_payload jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz:=now();
  v_attempt integer:=nullif(p_payload->>'attempt','')::integer;
  v_usage jsonb:=coalesce(p_payload->'usage','{}');
begin
  if v_attempt not in (1,2) or jsonb_typeof(v_usage)<>'object' then
    raise exception 'Completed model invocation telemetry is invalid.' using errcode='22023';
  end if;
  update public.model_invocations set
    status='completed',
    provider=coalesce(nullif(p_payload->>'provider',''),provider),
    provider_model_id=coalesce(nullif(p_payload->>'providerModelId',''),provider_model_id),
    provider_request_id=nullif(p_payload->>'providerRequestId',''),
    failure_category=null,failure_message=null,
    input_tokens=coalesce(nullif(v_usage->>'inputTokens','')::integer,0),
    output_tokens=coalesce(nullif(v_usage->>'outputTokens','')::integer,0),
    total_tokens=coalesce(nullif(v_usage->>'totalTokens','')::integer,0),
    cached_input_tokens=coalesce(nullif(v_usage->>'cachedInputTokens','')::integer,0),
    reasoning_tokens=coalesce(nullif(v_usage->>'reasoningTokens','')::integer,0),
    reported_cost_usd=nullif(v_usage->>'reportedCostUsd','')::numeric,
    estimated_cost_usd=coalesce(nullif(v_usage->>'estimatedCostUsd','')::numeric,0),
    latency_ms=nullif(p_payload->>'latencyMs','')::integer,
    usage=v_usage,metadata=metadata || coalesce(p_payload->'metadata','{}'),
    completed_at=v_now,updated_at=v_now
  where workflow_run_id=p_workflow_run_id and business_id=p_business_id
    and attempt=v_attempt;
  if not found then
    raise exception 'The model invocation was not started.' using errcode='P0002';
  end if;

  insert into public.events (
    id,business_id,workflow_run_id,event_type,actor_type,actor_id,payload,occurred_at
  )
  select
    private.stage5_deterministic_uuid(
      'event:'||p_workflow_run_id||':model.invocation.completed:'||v_attempt
    ),p_business_id,p_workflow_run_id,'model.invocation.completed','provider',model.model_key,
    jsonb_build_object(
      'attempt',invocation.attempt,'modelKey',model.model_key,
      'providerModelId',invocation.provider_model_id,
      'inputTokens',invocation.input_tokens,'outputTokens',invocation.output_tokens,
      'reportedCostUsd',invocation.reported_cost_usd,
      'estimatedCostUsd',invocation.estimated_cost_usd
    ),v_now
  from public.model_invocations invocation
  join public.model_definitions model on model.id=invocation.model_definition_id
  where invocation.workflow_run_id=p_workflow_run_id and invocation.attempt=v_attempt
  on conflict (id) do nothing;
  return jsonb_build_object('attempt',v_attempt,'status','completed');
end;
$$;

create or replace function private.stage5_op_invocation_failed(
  p_workflow_run_id uuid,p_business_id uuid,p_payload jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz:=now();
  v_attempt integer:=nullif(p_payload->>'attempt','')::integer;
  v_category text:=nullif(btrim(p_payload->>'failureCategory'),'');
  v_message text:=left(coalesce(p_payload->>'failureMessage','Model invocation failed.'),500);
begin
  if v_attempt not in (1,2) or v_category not in (
    'configuration_required','authentication_required','rate_limited',
    'provider_timeout','provider_unavailable','provider_rejected',
    'malformed_model_output','tool_qualification_failed'
  ) then
    raise exception 'Failed model invocation telemetry is invalid.' using errcode='22023';
  end if;
  update public.model_invocations set
    status='failed',failure_category=v_category,failure_message=v_message,
    metadata=metadata || coalesce(p_payload->'metadata','{}'),
    completed_at=v_now,updated_at=v_now
  where workflow_run_id=p_workflow_run_id and business_id=p_business_id
    and attempt=v_attempt;
  if not found then
    raise exception 'The model invocation was not started.' using errcode='P0002';
  end if;

  insert into public.events (
    id,business_id,workflow_run_id,event_type,actor_type,actor_id,payload,occurred_at
  )
  select
    private.stage5_deterministic_uuid(
      'event:'||p_workflow_run_id||':model.invocation.failed:'||v_attempt
    ),p_business_id,p_workflow_run_id,'model.invocation.failed','provider',model.model_key,
    jsonb_build_object(
      'attempt',invocation.attempt,'modelKey',model.model_key,
      'category',v_category,'message',v_message
    ),v_now
  from public.model_invocations invocation
  join public.model_definitions model on model.id=invocation.model_definition_id
  where invocation.workflow_run_id=p_workflow_run_id and invocation.attempt=v_attempt
  on conflict (id) do nothing;
  return jsonb_build_object(
    'attempt',v_attempt,'status','failed','failureCategory',v_category
  );
end;
$$;

revoke all on function private.stage5_op_invocation_started(uuid,uuid,text,jsonb),
  private.stage5_op_invocation_completed(uuid,uuid,jsonb),
  private.stage5_op_invocation_failed(uuid,uuid,jsonb)
from public,anon,authenticated;