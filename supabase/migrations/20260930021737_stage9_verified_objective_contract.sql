-- Persist the verifier result and case scope in each exact Task Contract.
drop function public.stage9_prepare_planner_step(uuid,uuid,uuid,text,text,text,integer,text,text[],jsonb,jsonb);

create or replace function public.stage9_prepare_planner_step(
  p_business_id uuid,
  p_workflow_run_id uuid,
  p_browser_session_id uuid,
  p_runtime_capability text,
  p_stage_key text,
  p_case_key text,
  p_step integer,
  p_objective text,
  p_permitted_capabilities text[],
  p_observation jsonb,
  p_previous_failure jsonb default null,
  p_objective_verified boolean default null,
  p_non_goals text[] default null
)
returns table (
  task_contract_id uuid,
  observation_artifact_id uuid,
  worker_run_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.workflow_runs%rowtype;
  v_stage_id uuid;
  v_task_id uuid;
  v_artifact_id uuid;
  v_worker_run_id uuid;
  v_output_schema jsonb;
begin
  if p_runtime_capability is null
    or char_length(p_runtime_capability) not between 32 and 512
    or p_step < 1 or p_step > 20
    or p_stage_key not in ('synthetic','mock-commerce','real-read-only','controlled-draft')
    or p_case_key is null or not length(p_case_key) between 1 and 200
    or p_objective is null or not length(btrim(p_objective)) between 1 and 4000
    or p_observation is null or jsonb_typeof(p_observation)<>'object'
    or p_permitted_capabilities is null then
    raise exception 'Invalid Browser Planner step request.' using errcode='22023';
  end if;

  select * into v_run
  from public.workflow_runs
  where id=p_workflow_run_id
    and business_id=p_business_id
    and workflow_definition_id='00000000-0000-4000-8000-000000000902'::uuid
    and runtime_capability_hash=encode(
      extensions.digest(convert_to(p_runtime_capability,'UTF8'),'sha256'),'hex'
    );

  if not found then
    raise exception 'Browser Planner step capability denied.' using errcode='42501';
  end if;

  if not exists(
    select 1 from public.browser_sessions
    where id=p_browser_session_id
      and workflow_run_id=p_workflow_run_id
      and business_id=p_business_id
  ) then
    raise exception 'Browser Planner step session unavailable.' using errcode='P0002';
  end if;

  select id into v_stage_id
  from public.workflow_stage_runs
  where workflow_run_id=p_workflow_run_id
    and business_id=p_business_id
    and stage_key=p_stage_key
    and attempt=1;

  if v_stage_id is null then
    raise exception 'Browser Planner stage unavailable.' using errcode='P0002';
  end if;

  select output_schema into v_output_schema
  from public.worker_definitions
  where id='00000000-0000-4000-8000-000000000904'::uuid;

  v_task_id := private.stage4_deterministic_uuid(
    'stage9:task:'||p_workflow_run_id::text||':'||p_case_key||':'||p_step::text
  );
  v_artifact_id := private.stage4_deterministic_uuid(
    'stage9:observation:'||p_workflow_run_id::text||':'||p_case_key||':'||p_step::text
  );
  v_worker_run_id := private.stage4_deterministic_uuid(
    'stage9:worker-run:'||p_workflow_run_id::text||':'||p_case_key||':'||p_step::text
  );

  insert into public.task_contracts(
    id,business_id,workflow_run_id,workflow_stage_run_id,worker_definition_id,
    status,objective,input_artifact_ids,permitted_capabilities,required_knowledge,
    required_output_schema,completion_criteria,failure_criteria,non_goals,escalation_rules
  )
  values(
    v_task_id,p_business_id,p_workflow_run_id,v_stage_id,
    '00000000-0000-4000-8000-000000000904'::uuid,
    'running',p_objective,array[v_artifact_id],p_permitted_capabilities,array[]::text[],
    v_output_schema,
    jsonb_build_object('oneBoundedAction',true,'freshObservationRequiredAfterAction',true,'objectiveVerified',p_objective_verified),
    jsonb_build_object(
      'allowedCategories',jsonb_build_array(
        'invented_element','invalid_action','action_failed','observation_failed',
        'model_failed','recovery_exhausted'
      )
    ),
    coalesce(p_non_goals,array[
      'Invent selectors or element identifiers',
      'Use raw Playwright, DOM handles, credentials, cookies, or provider secrets',
      'Return multiple browser actions in one planning step',
      'Publish, spend, or exceed the explicit objective'
    ]::text[]),
    jsonb_build_object(
      'maximumRecoveryAttempts',2,
      'previousFailure',coalesce(p_previous_failure,'null'::jsonb)
    )
  )
  on conflict(id) do update
  set
    status='running',
    objective=excluded.objective,
    permitted_capabilities=excluded.permitted_capabilities,
    escalation_rules=excluded.escalation_rules,
    completion_criteria=excluded.completion_criteria,
    non_goals=excluded.non_goals,
    updated_at=now();

  insert into public.artifacts(
    id,business_id,workflow_run_id,task_contract_id,artifact_type,name,
    media_type,content,metadata
  )
  values(
    v_artifact_id,p_business_id,p_workflow_run_id,v_task_id,
    'browser.structured-observation',
    'Browser observation '||p_case_key||' step '||p_step::text,
    'application/json',p_observation,
    jsonb_build_object(
      'source','browser_service',
      'caseKey',p_case_key,
      'step',p_step,
      'browserSessionId',p_browser_session_id
    )
  )
  on conflict(id) do update
  set content=excluded.content,metadata=excluded.metadata,updated_at=now();

  insert into public.worker_runs(
    id,business_id,workflow_run_id,task_contract_id,worker_definition_id,
    status,input,output,failure,execution_metadata,started_at
  )
  values(
    v_worker_run_id,p_business_id,p_workflow_run_id,v_task_id,
    '00000000-0000-4000-8000-000000000904'::uuid,
    'running',
    jsonb_build_object(
      'taskContractId',v_task_id,
      'observationArtifactId',v_artifact_id
    ),
    '{}'::jsonb,'{}'::jsonb,
    jsonb_build_object(
      'plannerKey','browser.planner',
      'plannerVersion','1.0.0',
      'caseKey',p_case_key,
      'step',p_step,
      'modelRoute','standard.default'
    ),
    now()
  )
  on conflict(id) do update
  set
    status='running',
    input=excluded.input,
    failure='{}'::jsonb,
    started_at=coalesce(public.worker_runs.started_at,excluded.started_at),
    completed_at=null,
    updated_at=now();

  return query select v_task_id,v_artifact_id,v_worker_run_id;
end;
$$;

revoke all on function public.stage9_prepare_planner_step(
  uuid,uuid,uuid,text,text,text,integer,text,text[],jsonb,jsonb,boolean,text[]
) from public, authenticated, service_role;
grant execute on function public.stage9_prepare_planner_step(
  uuid,uuid,uuid,text,text,text,integer,text,text[],jsonb,jsonb,boolean,text[]
) to anon;


