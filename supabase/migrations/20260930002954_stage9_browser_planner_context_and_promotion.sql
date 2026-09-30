
create or replace function public.stage9_get_planner_step_context(
  p_business_id uuid,
  p_workflow_run_id uuid,
  p_browser_session_id uuid,
  p_runtime_capability text,
  p_task_contract_id uuid,
  p_observation_artifact_id uuid,
  p_worker_run_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_task public.task_contracts%rowtype;
  v_artifact public.artifacts%rowtype;
begin
  if p_runtime_capability is null
    or char_length(p_runtime_capability) not between 32 and 512 then
    raise exception 'Invalid Browser Planner context request.' using errcode='22023';
  end if;

  if not exists(
    select 1
    from public.workflow_runs run
    where run.id=p_workflow_run_id
      and run.business_id=p_business_id
      and run.workflow_definition_id='00000000-0000-4000-8000-000000000902'::uuid
      and run.runtime_capability_hash=encode(
        extensions.digest(convert_to(p_runtime_capability,'UTF8'),'sha256'),'hex'
      )
  ) or not exists(
    select 1
    from public.browser_sessions session
    where session.id=p_browser_session_id
      and session.workflow_run_id=p_workflow_run_id
      and session.business_id=p_business_id
  ) then
    raise exception 'Browser Planner context capability denied.' using errcode='42501';
  end if;

  select * into v_task
  from public.task_contracts task
  where task.id=p_task_contract_id
    and task.business_id=p_business_id
    and task.workflow_run_id=p_workflow_run_id
    and task.worker_definition_id='00000000-0000-4000-8000-000000000904'::uuid
    and p_observation_artifact_id=any(task.input_artifact_ids);

  if not found then
    raise exception 'Browser Planner Task Contract unavailable.' using errcode='P0002';
  end if;

  select * into v_artifact
  from public.artifacts artifact
  where artifact.id=p_observation_artifact_id
    and artifact.business_id=p_business_id
    and artifact.workflow_run_id=p_workflow_run_id
    and artifact.task_contract_id=p_task_contract_id
    and artifact.artifact_type='browser.structured-observation'
    and artifact.media_type='application/json';

  if not found then
    raise exception 'Browser Planner observation Artifact unavailable.' using errcode='P0002';
  end if;

  if not exists(
    select 1
    from public.worker_runs worker_run
    where worker_run.id=p_worker_run_id
      and worker_run.business_id=p_business_id
      and worker_run.workflow_run_id=p_workflow_run_id
      and worker_run.task_contract_id=p_task_contract_id
      and worker_run.worker_definition_id='00000000-0000-4000-8000-000000000904'::uuid
      and worker_run.status='running'
  ) then
    raise exception 'Browser Planner Worker Run unavailable.' using errcode='P0002';
  end if;

  return jsonb_build_object(
    'taskContract',jsonb_build_object(
      'id',v_task.id,
      'objective',v_task.objective,
      'inputArtifactIds',to_jsonb(v_task.input_artifact_ids),
      'permittedCapabilities',to_jsonb(v_task.permitted_capabilities),
      'requiredKnowledge',to_jsonb(v_task.required_knowledge),
      'requiredOutputSchema',v_task.required_output_schema,
      'completionCriteria',v_task.completion_criteria,
      'failureCriteria',v_task.failure_criteria,
      'nonGoals',to_jsonb(v_task.non_goals),
      'escalationRules',v_task.escalation_rules
    ),
    'inputArtifacts',jsonb_build_array(
      jsonb_build_object(
        'id',v_artifact.id,
        'artifactType',v_artifact.artifact_type,
        'name',v_artifact.name,
        'mediaType',v_artifact.media_type,
        'content',v_artifact.content,
        'metadata',v_artifact.metadata
      )
    )
  );
end;
$$;

revoke all on function public.stage9_get_planner_step_context(
  uuid,uuid,uuid,text,uuid,uuid,uuid
) from public, authenticated, service_role;
grant execute on function public.stage9_get_planner_step_context(
  uuid,uuid,uuid,text,uuid,uuid,uuid
) to anon;

create or replace function private.stage9_promote_planner_if_qualified()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_required integer;
  v_passed integer;
  v_fingerprint text;
begin
  select count(*),count(*) filter(where status='passed')
  into v_required,v_passed
  from public.browser_planner_qualification_cases
  where planner_definition_id='00000000-0000-4000-8000-000000000901'::uuid;

  if v_required <> 4 or v_passed <> v_required then
    return;
  end if;

  update public.worker_definitions
  set status='qualified'
  where id='00000000-0000-4000-8000-000000000904'::uuid;

  update public.packs
  set status='qualified'
  where id='00000000-0000-4000-8000-000000000903'::uuid;

  v_fingerprint := private.stage9_browser_planner_fingerprint();

  update public.browser_planner_definitions
  set
    status='qualified',
    qualification=qualification||jsonb_build_object(
      'subjectFingerprint',v_fingerprint,
      'qualifiedAt',now(),
      'allRequiredCasesPassed',true,
      'requiredCaseCount',v_required,
      'passedCaseCount',v_passed
    )
  where id='00000000-0000-4000-8000-000000000901'::uuid;
end;
$$;

revoke all on function private.stage9_promote_planner_if_qualified()
  from public,anon,authenticated,service_role;

create or replace function private.stage9_promote_after_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists(
    select 1
    from public.browser_planner_definitions
    where id='00000000-0000-4000-8000-000000000901'::uuid
      and status='qualified'
  ) then
    perform private.stage9_promote_planner_if_qualified();
  end if;
  return null;
end;
$$;

revoke all on function private.stage9_promote_after_status_change()
  from public,anon,authenticated,service_role;

drop trigger if exists stage9_promote_after_status_change
  on public.browser_planner_definitions;
create trigger stage9_promote_after_status_change
after update of status
on public.browser_planner_definitions
for each statement
execute function private.stage9_promote_after_status_change();

select private.stage9_promote_planner_if_qualified();

comment on function public.stage9_get_planner_step_context(uuid,uuid,uuid,text,uuid,uuid,uuid) is
  'Returns exactly one capability-authorized Browser Planner Task Contract and its one referenced structured observation Artifact.';
comment on function private.stage9_promote_planner_if_qualified() is
  'Promotes the Browser Planner definition, Worker Pack and WorkerDefinition only after all four required Stage 9 cases pass, and pins the qualification fingerprint.';
