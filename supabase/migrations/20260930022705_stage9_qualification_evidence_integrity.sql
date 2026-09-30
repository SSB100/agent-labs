create or replace function public.stage9_browser_planner_transition(
  p_business_id uuid,
  p_workflow_run_id uuid,
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
  v_session public.browser_sessions%rowtype;
  v_identity public.browser_identities%rowtype;
  v_case public.browser_planner_qualification_cases%rowtype;
  v_case_key text := p_payload ->> 'caseKey';
  v_stage_key text := p_payload ->> 'stageKey';
  v_profile_id text;
begin
  if p_runtime_capability is null
    or char_length(p_runtime_capability) not between 32 and 512
    or p_payload is null
    or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid Browser Planner transition.' using errcode = '22023';
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
    raise exception 'Browser Planner runtime capability denied.' using errcode='42501';
  end if;

  select * into v_session
  from public.browser_sessions
  where workflow_run_id=v_run.id and business_id=p_business_id;

  if not found then
    raise exception 'Browser Planner session unavailable.' using errcode='P0002';
  end if;

  select * into v_identity
  from public.browser_identities
  where id=v_session.browser_identity_id;

  if p_operation='runtime_started' then
    update public.workflow_runs
    set status='running',current_stage_key='launch',started_at=coalesce(started_at,now()),
        runtime_run_id=coalesce(nullif(p_payload->>'runtimeRunId',''),runtime_run_id),
        runtime_provider='vercel_workflow',runtime_launch_status='started'
    where id=v_run.id;
    perform private.stage9_upsert_stage(p_business_id,v_run.id,'launch','running');

  elsif p_operation='session_launched' then
    v_profile_id := nullif(p_payload->>'profileId','');
    update public.browser_sessions
    set provider_session_id=p_payload->>'providerSessionId',
        status='live',control_mode='automation',live_view_status='ready',
        region=nullif(p_payload->>'region',''),
        browser_mode=nullif(p_payload->>'browserMode',''),
        started_at=coalesce(started_at,now())
    where id=v_session.id;

    if v_profile_id is not null then
      update public.browser_identities
      set provider_profile_id=v_profile_id,
          metadata=metadata||jsonb_build_object('plannerQualificationProfile',true)
      where id=v_identity.id;
    end if;

    insert into private.browser_session_secrets(
      browser_session_id,debug_url,session_viewer_url,websocket_url
    ) values (
      v_session.id,p_payload->>'debugUrl',nullif(p_payload->>'sessionViewerUrl',''),
      p_payload->>'websocketUrl'
    )
    on conflict(browser_session_id) do update
    set debug_url=excluded.debug_url,
        session_viewer_url=excluded.session_viewer_url,
        websocket_url=excluded.websocket_url,
        updated_at=now();

    perform private.stage9_upsert_stage(p_business_id,v_run.id,'launch','completed',
      jsonb_build_object('providerSessionId',p_payload->>'providerSessionId'));
    perform private.stage9_upsert_stage(p_business_id,v_run.id,'synthetic','running');
    update public.workflow_runs set current_stage_key='synthetic' where id=v_run.id;

  elsif p_operation='case_started' then
    if v_stage_key not in ('synthetic','mock-commerce','real-read-only','controlled-draft') then
      raise exception 'Invalid planner qualification stage.' using errcode='22023';
    end if;
    perform private.stage9_upsert_stage(p_business_id,v_run.id,v_stage_key,'running');
    update public.workflow_runs set current_stage_key=v_stage_key where id=v_run.id;

  elsif p_operation in ('case_passed','case_failed') then
    select * into v_case
    from public.browser_planner_qualification_cases
    where planner_definition_id='00000000-0000-4000-8000-000000000901'::uuid
      and case_key=v_case_key;

    if not found then
      raise exception 'Planner qualification case unavailable.' using errcode='P0002';
    end if;

    if p_operation='case_passed' then
      update public.browser_planner_qualification_cases
      set status='passed',score=100,
          evidence=jsonb_build_object('objective',evidence->>'objective','workflowRunId',v_run.id)||coalesce(p_payload->'evidence','{}'::jsonb),
          model_usage=jsonb_build_object(
            'reportedCostUsd',coalesce((p_payload#>>'{evidence,reportedCostUsd}')::numeric,0),
            'estimatedCostUsd',coalesce((p_payload#>>'{evidence,estimatedCostUsd}')::numeric,0),
            'modelKeys',coalesce(p_payload#>'{evidence,modelKeys}','[]'::jsonb)
          ),
          qualified_at=now()
      where id=v_case.id;
      perform private.stage9_upsert_stage(p_business_id,v_run.id,v_stage_key,'completed',
        coalesce(p_payload->'evidence','{}'::jsonb));
    else
      update public.browser_planner_qualification_cases
      set status='failed',score=0,
          evidence=jsonb_build_object('objective',evidence->>'objective','workflowRunId',v_run.id,'failure',coalesce(p_payload->'failure','{}'::jsonb)), qualified_at=null
      where id=v_case.id;
      perform private.stage9_upsert_stage(p_business_id,v_run.id,v_stage_key,'failed',
        '{}'::jsonb,coalesce(p_payload->'failure','{}'::jsonb));
      update public.workflow_runs
      set status='failed',completed_at=now(),
          state=state||jsonb_build_object('plannerFailure',coalesce(p_payload->'failure','{}'::jsonb))
      where id=v_run.id;
    end if;

  elsif p_operation='completed' then
    if (select count(*) from public.workflow_stage_runs
        where workflow_run_id=v_run.id and business_id=p_business_id
          and stage_key in ('synthetic','mock-commerce','real-read-only','controlled-draft')
          and attempt=1 and status='completed') <> 4 then
      raise exception 'All four planner stages must pass in this Workflow Run.' using errcode='22023';
    end if;
    if exists (
      select 1 from public.browser_planner_qualification_cases
      where planner_definition_id='00000000-0000-4000-8000-000000000901'::uuid
        and (status <> 'passed' or evidence->>'workflowRunId' is distinct from v_run.id::text)
    ) then
      raise exception 'Browser Planner required qualification cases are incomplete.' using errcode='22023';
    end if;

    update public.browser_sessions
    set status='released',control_mode='released',live_view_status='unavailable',
        released_at=now(),metadata=metadata||jsonb_build_object('plannerQualified',true)
    where id=v_session.id;

    update public.browser_planner_definitions
    set status='qualified',
        qualification=qualification||jsonb_build_object(
          'qualifiedAt',now(),
          'qualifiedWorkflowRunId',v_run.id,
          'allRequiredCasesPassed',true
        )
    where id='00000000-0000-4000-8000-000000000901'::uuid;

    update public.workflow_definitions set status='qualified'
    where id=v_run.workflow_definition_id;

    perform private.stage9_upsert_stage(p_business_id,v_run.id,'complete','completed',
      jsonb_build_object('plannerKey','browser.planner','browserSessionId',v_session.id));
    update public.workflow_runs
    set status='completed',current_stage_key='complete',completed_at=now(),
        state=state||jsonb_build_object('plannerQualified',true,'browserSessionId',v_session.id)
    where id=v_run.id;

  elsif p_operation='failed' then
    update public.browser_sessions
    set status='failed',live_view_status='unavailable',released_at=coalesce(released_at,now()),
        failure=coalesce(p_payload->'failure','{}'::jsonb)
    where id=v_session.id;
    update public.workflow_runs
    set status='failed',completed_at=now(),
        state=state||jsonb_build_object('plannerFailure',coalesce(p_payload->'failure','{}'::jsonb))
    where id=v_run.id;
    perform private.stage9_upsert_stage(
      p_business_id,v_run.id,
      coalesce(nullif(v_stage_key,''),v_run.current_stage_key,'launch'),
      'failed','{}'::jsonb,coalesce(p_payload->'failure','{}'::jsonb)
    );
  else
    raise exception 'Unsupported Browser Planner operation.' using errcode='22023';
  end if;

  return jsonb_build_object(
    'workflowRunId',v_run.id,
    'browserSessionId',v_session.id,
    'operation',p_operation
  );
end;
$$;

revoke all on function public.stage9_browser_planner_transition(uuid,uuid,text,text,jsonb)
  from public, authenticated, service_role;
grant execute on function public.stage9_browser_planner_transition(uuid,uuid,text,text,jsonb)
  to anon;


create or replace function public.stage9_record_browser_planner_event(
  p_business_id uuid,
  p_workflow_run_id uuid,
  p_browser_session_id uuid,
  p_runtime_capability text,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.workflow_runs%rowtype;
  v_session public.browser_sessions%rowtype;
begin
  if p_runtime_capability is null
    or char_length(p_runtime_capability) not between 32 and 512
    or p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or p_event_type not in (
      'browser.planner.observed',
      'browser.planner.action.planned',
      'browser.planner.action.completed',
      'browser.planner.action.failed',
      'browser.planner.recovery'
    ) then
    raise exception 'Invalid Browser Planner event request.' using errcode = '22023';
  end if;

  select * into v_run
  from public.workflow_runs
  where id = p_workflow_run_id
    and business_id = p_business_id
    and runtime_capability_hash = encode(
      extensions.digest(convert_to(p_runtime_capability, 'UTF8'), 'sha256'),
      'hex'
    );

  if not found then
    raise exception 'Browser Planner runtime capability denied.' using errcode = '42501';
  end if;

  select * into v_session
  from public.browser_sessions
  where id = p_browser_session_id
    and workflow_run_id = p_workflow_run_id
    and business_id = p_business_id;

  if not found then
    raise exception 'Browser Planner session is unavailable.' using errcode = 'P0002';
  end if;

  insert into public.browser_session_events (
    business_id, workflow_run_id, browser_session_id,
    event_type, control_mode, payload
  )
  values (
    p_business_id, p_workflow_run_id, p_browser_session_id,
    p_event_type, v_session.control_mode, p_payload
  );

  insert into public.events (
    business_id, workflow_run_id, event_type, actor_type, payload, occurred_at
  )
  values (
    p_business_id, p_workflow_run_id, p_event_type, 'worker',
    p_payload || jsonb_build_object(
      'browserSessionId', p_browser_session_id,
      'controlMode', v_session.control_mode
    ),
    now()
  );

  update public.browser_sessions
  set current_url = case when p_event_type='browser.planner.observed' then p_payload->>'url' else current_url end,
      page_title = case when p_event_type='browser.planner.observed' then p_payload->>'title' else page_title end,
      metadata = metadata || jsonb_build_object(
    'plannerLastEvent', p_event_type,
    'plannerLastEventAt', now()
  )
  where id = p_browser_session_id;

  return jsonb_build_object(
    'browserSessionId', p_browser_session_id,
    'workflowRunId', p_workflow_run_id,
    'eventType', p_event_type
  );
end;
$$;

revoke all on function public.stage9_record_browser_planner_event(
  uuid, uuid, uuid, text, text, jsonb
) from public, authenticated, service_role;
grant execute on function public.stage9_record_browser_planner_event(
  uuid, uuid, uuid, text, text, jsonb
) to anon;


-- Reconcile the recorded live pass using its completed per-run stage receipts.
-- Prior failed-run evidence remains in its own WorkflowStageRun and WorkerRuns.
update public.browser_planner_qualification_cases c
set evidence=jsonb_build_object('objective',c.evidence->>'objective',
    'workflowRunId',s.workflow_run_id)||s.output
from public.workflow_stage_runs s
join public.browser_planner_definitions p
  on p.qualification->>'qualifiedWorkflowRunId'=s.workflow_run_id::text
where c.planner_definition_id=p.id and c.status='passed' and s.status='completed'
  and c.case_key=s.output->>'caseKey';
