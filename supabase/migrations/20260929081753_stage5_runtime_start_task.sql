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
    'taskContract',jsonb_build_object(
      'id',task.id,
      'objective',task.objective,
      'inputArtifactIds',to_jsonb(task.input_artifact_ids),
      'permittedCapabilities',to_jsonb(task.permitted_capabilities),
      'requiredKnowledge',to_jsonb(task.required_knowledge),
      'requiredOutputSchema',task.required_output_schema,
      'completionCriteria',task.completion_criteria,
      'failureCriteria',task.failure_criteria,
      'nonGoals',to_jsonb(task.non_goals),
      'escalationRules',task.escalation_rules
    ),
    'inputArtifacts',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',artifact.id,'artifactType',artifact.artifact_type,
        'name',artifact.name,'mediaType',artifact.media_type,
        'content',artifact.content,'metadata',artifact.metadata
      ) order by artifact.id)
      from public.artifacts artifact
      where artifact.business_id=task.business_id
        and artifact.workflow_run_id=task.workflow_run_id
        and artifact.id=any(task.input_artifact_ids)
    ),'[]'::jsonb)
  )
  from public.task_contracts task
  where task.id=private.stage5_deterministic_uuid(
      'stage5:task:' || p_workflow_run_id::text
    )
    and task.workflow_run_id=p_workflow_run_id
    and task.business_id=p_business_id;
$$;
revoke all on function private.stage5_worker_context(uuid,uuid)
  from public,anon,authenticated;

create or replace function private.stage5_op_runtime_started(
  p_workflow_run_id uuid,p_business_id uuid,p_payload jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz:=now();
  v_runtime_id text:=nullif(btrim(p_payload->>'runtimeRunId'),'');
begin
  if v_runtime_id is null or char_length(v_runtime_id)>300 then
    raise exception 'Runtime run identifier is invalid.' using errcode='22023';
  end if;
  update public.workflow_runs set
    current_stage_key='start',runtime_launch_status='started',
    runtime_provider='vercel_workflow',runtime_run_id=v_runtime_id,
    started_at=coalesce(started_at,v_now),status='running',
    state=coalesce(state,'{}') || jsonb_build_object('runtimeRunId',v_runtime_id)
  where id=p_workflow_run_id and business_id=p_business_id;

  insert into public.workflow_stage_runs (
    business_id,workflow_run_id,stage_key,sequence,attempt,status,
    input,output,failure,started_at,completed_at
  ) values (
    p_business_id,p_workflow_run_id,'start',0,1,'completed',
    '{}',jsonb_build_object('runtimeRunId',v_runtime_id),'{}',v_now,v_now
  ) on conflict (workflow_run_id,stage_key,attempt) do update set
    status='completed',output=excluded.output,completed_at=excluded.completed_at;

  insert into public.events (
    id,business_id,workflow_run_id,event_type,actor_type,payload,occurred_at
  ) values
    (private.stage5_deterministic_uuid('event:'||p_workflow_run_id||':workflow.started'),
      p_business_id,p_workflow_run_id,'workflow.started','system',
      jsonb_build_object('runtimeRunId',v_runtime_id,'workflowKey','synthetic.model-router.runtime-proof'),v_now),
    (private.stage5_deterministic_uuid('event:'||p_workflow_run_id||':stage.start.completed'),
      p_business_id,p_workflow_run_id,'workflow.stage.completed','system',
      jsonb_build_object('stageKey','start'),v_now)
  on conflict (id) do nothing;
  return jsonb_build_object('runtimeRunId',v_runtime_id,'status','running');
end;
$$;

create or replace function private.stage5_op_prepare_task(
  p_workflow_run_id uuid,p_business_id uuid,p_proof_mode text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz:=now();
  v_input uuid:=private.stage5_deterministic_uuid('stage5:input:'||p_workflow_run_id);
  v_task uuid:=private.stage5_deterministic_uuid('stage5:task:'||p_workflow_run_id);
  v_stage uuid;
  v_schema jsonb;
  v_context jsonb;
  v_objective text:='Summarise the three supplied synthetic market signals, clearly separate evidence from inference, and stop without recommending a business strategy.';
begin
  select output_schema into v_schema from public.worker_definitions
  where id='00000000-0000-4000-8000-000000000502';
  if v_schema is null then
    raise exception 'The model-backed worker definition is unavailable.' using errcode='P0002';
  end if;

  insert into public.artifacts (
    id,business_id,workflow_run_id,artifact_type,name,media_type,content,metadata
  ) values (
    v_input,p_business_id,p_workflow_run_id,'fixture.market-signals',
    'Synthetic market signals for model routing','application/json',
    jsonb_build_object(
      'proofMode',p_proof_mode,'question',v_objective,
      'signals',jsonb_build_array(
        jsonb_build_object('id','signal-1','observation','Three of five supplied synthetic listings use concise buyer-language phrases in their titles.'),
        jsonb_build_object('id','signal-2','observation','The supplied synthetic price observations cluster within a narrow mid-range band.'),
        jsonb_build_object('id','signal-3','observation','Two supplied synthetic review excerpts mention gift suitability and easy sizing.')
      )
    ),
    jsonb_build_object('knowledgeKey','fixture.synthetic-market-signals','source','stage5-model-router-proof')
  ) on conflict (id) do update set
    content=excluded.content,metadata=excluded.metadata,updated_at=v_now;

  insert into public.workflow_stage_runs (
    business_id,workflow_run_id,stage_key,sequence,attempt,status,
    input,output,failure,started_at,completed_at
  ) values (
    p_business_id,p_workflow_run_id,'task-contract',1,1,'completed',
    jsonb_build_object('proofMode',p_proof_mode),
    jsonb_build_object('taskContractId',v_task,'inputArtifactId',v_input,'workerKey','generic.researcher'),
    '{}',v_now,v_now
  ) on conflict (workflow_run_id,stage_key,attempt) do update set
    status='completed',output=excluded.output,completed_at=excluded.completed_at
  returning id into v_stage;

  insert into public.task_contracts (
    id,business_id,workflow_run_id,workflow_stage_run_id,worker_definition_id,
    status,objective,input_artifact_ids,permitted_capabilities,required_knowledge,
    required_output_schema,completion_criteria,failure_criteria,non_goals,escalation_rules
  ) values (
    v_task,p_business_id,p_workflow_run_id,v_stage,
    '00000000-0000-4000-8000-000000000502','ready',v_objective,
    array[v_input],array[]::text[],array['fixture.synthetic-market-signals'],v_schema,
    jsonb_build_object('requiredDecision','complete','minimumEvidenceCount',3,'requiredStopReason','completion_criteria_satisfied'),
    jsonb_build_object('allowedCategories',jsonb_build_array(
      'contract_invalid','context_invalid','validation_failed','worker_execution_failed',
      'route_unavailable','all_routes_failed','configuration_required','authentication_required',
      'rate_limited','provider_timeout','provider_unavailable','provider_rejected',
      'malformed_model_output','tool_qualification_failed'
    )),
    array['Choose a final business strategy','Browse for additional evidence','Create or publish a product'],
    jsonb_build_object('onProviderFailure','one_qualified_fallback_then_stop','maximumModelAttempts',2,'onValidationFailure','classify_and_stop')
  ) on conflict (id) do update set
    status=case when public.task_contracts.status in ('completed','failed','cancelled')
      then public.task_contracts.status else 'ready' end,
    updated_at=v_now;

  v_context:=private.stage5_worker_context(p_workflow_run_id,p_business_id);
  update public.workflow_runs set
    current_stage_key='route',status='running',
    state=coalesce(state,'{}') || jsonb_build_object(
      'taskContractId',v_task,'inputArtifactId',v_input,'modelRouteKey','standard.default'
    )
  where id=p_workflow_run_id and business_id=p_business_id
    and status not in ('completed','failed','cancelled');

  insert into public.events (
    id,business_id,workflow_run_id,event_type,actor_type,payload,occurred_at
  ) values
    (private.stage5_deterministic_uuid('event:'||p_workflow_run_id||':task-contract.created'),
      p_business_id,p_workflow_run_id,'task_contract.created','system',
      jsonb_build_object('taskContractId',v_task,'workerKey','generic.researcher','modelRouteKey','standard.default'),v_now),
    (private.stage5_deterministic_uuid('event:'||p_workflow_run_id||':stage.task-contract.completed'),
      p_business_id,p_workflow_run_id,'workflow.stage.completed','system',
      jsonb_build_object('stageKey','task-contract'),v_now)
  on conflict (id) do nothing;

  return jsonb_build_object('context',v_context,'status','ready');
end;
$$;

revoke all on function private.stage5_op_runtime_started(uuid,uuid,jsonb),
  private.stage5_op_prepare_task(uuid,uuid,text)
from public,anon,authenticated;