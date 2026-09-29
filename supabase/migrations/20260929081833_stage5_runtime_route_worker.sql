create or replace function private.stage5_op_route_resolved(
  p_workflow_run_id uuid,p_business_id uuid,p_payload jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz:=now();
  v_route_id uuid;
  v_route_key text:=nullif(btrim(p_payload->>'routeKey'),'');
  v_primary text:=nullif(btrim(p_payload->>'primaryModelKey'),'');
  v_fallback text:=nullif(btrim(p_payload->>'fallbackModelKey'),'');
  v_max integer:=coalesce(nullif(p_payload->>'maximumAttempts','')::integer,2);
begin
  select route.id into v_route_id
  from public.model_routes route
  join public.model_definitions primary_model on primary_model.id=route.primary_model_definition_id
  join public.model_definitions fallback_model on fallback_model.id=route.fallback_model_definition_id
  where route.route_key=v_route_key and route.status='qualified'
    and primary_model.model_key=v_primary
    and fallback_model.model_key=v_fallback
    and route.maximum_attempts=v_max;
  if v_route_id is null then
    raise exception 'The requested model route is not qualified.' using errcode='22023';
  end if;

  insert into public.workflow_stage_runs (
    business_id,workflow_run_id,stage_key,sequence,attempt,status,
    input,output,failure,started_at,completed_at
  ) values (
    p_business_id,p_workflow_run_id,'route',2,1,'completed',
    jsonb_build_object('routeKey',v_route_key),
    jsonb_build_object(
      'routeId',v_route_id,'primaryModelKey',v_primary,
      'fallbackModelKey',v_fallback,'maximumAttempts',v_max
    ),'{}',v_now,v_now
  ) on conflict (workflow_run_id,stage_key,attempt) do update set
    status='completed',output=excluded.output,completed_at=excluded.completed_at;

  update public.workflow_runs set
    current_stage_key='worker',
    state=coalesce(state,'{}') || jsonb_build_object(
      'modelRouteId',v_route_id,'modelRouteKey',v_route_key,
      'primaryModelKey',v_primary,'fallbackModelKey',v_fallback
    )
  where id=p_workflow_run_id and business_id=p_business_id;

  insert into public.events (
    id,business_id,workflow_run_id,event_type,actor_type,payload,occurred_at
  ) values
    (private.stage5_deterministic_uuid('event:'||p_workflow_run_id||':model.route.resolved'),
      p_business_id,p_workflow_run_id,'model.route.resolved','system',
      jsonb_build_object(
        'routeKey',v_route_key,'primaryModelKey',v_primary,
        'fallbackModelKey',v_fallback,'maximumAttempts',v_max
      ),v_now),
    (private.stage5_deterministic_uuid('event:'||p_workflow_run_id||':stage.route.completed'),
      p_business_id,p_workflow_run_id,'workflow.stage.completed','system',
      jsonb_build_object('stageKey','route'),v_now)
  on conflict (id) do nothing;
  return jsonb_build_object('routeId',v_route_id,'routeKey',v_route_key,'status','qualified');
end;
$$;

create or replace function private.stage5_op_worker_started(
  p_workflow_run_id uuid,p_business_id uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz:=now();
  v_task uuid:=private.stage5_deterministic_uuid('stage5:task:'||p_workflow_run_id);
  v_worker uuid:=private.stage5_deterministic_uuid('stage5:worker:'||p_workflow_run_id||':1');
  v_context jsonb;
  v_existing public.worker_runs%rowtype;
begin
  select * into v_existing from public.worker_runs
  where id=v_worker and business_id=p_business_id;
  if found and v_existing.status='completed' then
    return jsonb_build_object(
      'completed',true,'output',v_existing.output,
      'receipt',coalesce(v_existing.execution_metadata->'receipt','{}'),
      'selectedModelKey',v_existing.execution_metadata->>'selectedModelKey',
      'modelRouteKey',v_existing.execution_metadata->>'modelRouteKey'
    );
  end if;
  if found and v_existing.status='failed' then
    return jsonb_build_object('failed',true,'failureCategory',v_existing.failure->>'category');
  end if;

  v_context:=private.stage5_worker_context(p_workflow_run_id,p_business_id);
  if v_context is null then
    raise exception 'The Task Contract is not ready.' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.workflow_stage_runs
    where workflow_run_id=p_workflow_run_id and business_id=p_business_id
      and stage_key='route' and attempt=1 and status='completed'
  ) then
    raise exception 'The model route has not been resolved.' using errcode='22023';
  end if;

  insert into public.workflow_stage_runs (
    business_id,workflow_run_id,stage_key,sequence,attempt,status,
    input,output,failure,started_at
  ) values (
    p_business_id,p_workflow_run_id,'worker',3,1,'running',
    jsonb_build_object('taskContractId',v_task,'modelRouteKey','standard.default'),
    '{}','{}',v_now
  ) on conflict (workflow_run_id,stage_key,attempt) do update set
    status=case when public.workflow_stage_runs.status in ('completed','failed')
      then public.workflow_stage_runs.status else 'running' end;

  insert into public.worker_runs (
    id,business_id,workflow_run_id,task_contract_id,worker_definition_id,
    status,input,output,failure,execution_metadata,started_at
  ) values (
    v_worker,p_business_id,p_workflow_run_id,v_task,
    '00000000-0000-4000-8000-000000000502','running',v_context,'{}','{}',
    jsonb_build_object(
      'attempt',1,'packKey','worker.generic-researcher','packVersion','1.0.0',
      'workerKey','generic.researcher','workerVersion','1.0.0',
      'contextPolicy','task_contract_and_referenced_artifacts_only',
      'conversationHistoryIncluded',false,'modelRouterRequired',true,
      'modelRouteKey','standard.default'
    ),v_now
  ) on conflict (id) do update set
    status=case when public.worker_runs.status in ('completed','failed','cancelled')
      then public.worker_runs.status else 'running' end,
    updated_at=v_now;

  update public.task_contracts set status='running'
  where id=v_task and business_id=p_business_id and status='ready';
  update public.workflow_runs set current_stage_key='worker',status='running'
  where id=p_workflow_run_id and business_id=p_business_id
    and status not in ('completed','failed','cancelled');

  insert into public.events (
    id,business_id,workflow_run_id,event_type,actor_type,actor_id,payload,occurred_at
  ) values (
    private.stage5_deterministic_uuid('event:'||p_workflow_run_id||':worker.started'),
    p_business_id,p_workflow_run_id,'worker.started','worker','generic.researcher',
    jsonb_build_object(
      'workerRunId',v_worker,'taskContractId',v_task,
      'workerKey','generic.researcher','workerVersion','1.0.0',
      'modelRouteKey','standard.default'
    ),v_now
  ) on conflict (id) do nothing;
  return jsonb_build_object('completed',false,'workerRunId',v_worker);
end;
$$;

revoke all on function private.stage5_op_route_resolved(uuid,uuid,jsonb),
  private.stage5_op_worker_started(uuid,uuid)
from public,anon,authenticated;