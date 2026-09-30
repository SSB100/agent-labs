
insert into public.workflow_definitions (
  id, pack_id, workflow_key, version, name, description, status,
  input_schema, output_schema, stage_definition
)
select
  '00000000-0000-4000-8000-000000000902',
  pack.id,
  'synthetic.browser-planner.qualification',
  '1.0.0',
  'Browser Planner Qualification',
  'Qualifies structured browser observation, one-action planning, bounded recovery, read-only browsing and controlled draft mutation.',
  'experimental',
  jsonb_build_object(
    'type','object','additionalProperties',false,
    'required',jsonb_build_array('businessId'),
    'properties',jsonb_build_object(
      'businessId',jsonb_build_object('type','string','format','uuid')
    )
  ),
  jsonb_build_object(
    'type','object','additionalProperties',false,
    'required',jsonb_build_array('browserSessionId','status'),
    'properties',jsonb_build_object(
      'browserSessionId',jsonb_build_object('type','string','format','uuid'),
      'status',jsonb_build_object('const','completed')
    )
  ),
  jsonb_build_object(
    'stages',jsonb_build_array(
      jsonb_build_object('key','reserve','type','system','sequence',0),
      jsonb_build_object('key','launch','type','browser','sequence',1),
      jsonb_build_object('key','synthetic','type','browser_planner','sequence',2),
      jsonb_build_object('key','mock-commerce','type','browser_planner','sequence',3),
      jsonb_build_object('key','real-read-only','type','browser_planner','sequence',4),
      jsonb_build_object('key','controlled-draft','type','browser_planner','sequence',5),
      jsonb_build_object('key','complete','type','terminal','sequence',6)
    ),
    'plannerKey','browser.planner',
    'plannerVersion','1.0.0',
    'oneActionPerPlanningStep',true,
    'maximumRecoveryAttempts',2
  )
from public.packs pack
where pack.pack_key = 'core.synthetic'
  and pack.version = '1.0.0'
on conflict (pack_id, workflow_key, version) do update
set
  name = excluded.name,
  description = excluded.description,
  status = excluded.status,
  input_schema = excluded.input_schema,
  output_schema = excluded.output_schema,
  stage_definition = excluded.stage_definition,
  updated_at = now();

alter table public.workflow_runs
  drop constraint if exists workflow_runs_runtime_capability_required_check;

alter table public.workflow_runs
  add constraint workflow_runs_runtime_capability_required_check check (
    workflow_definition_id <> all (array[
      '00000000-0000-4000-8000-000000000301'::uuid,
      '00000000-0000-4000-8000-000000000403'::uuid,
      '00000000-0000-4000-8000-000000000503'::uuid,
      '00000000-0000-4000-8000-000000000801'::uuid,
      '00000000-0000-4000-8000-000000000902'::uuid
    ])
    or runtime_capability_hash is not null
  );

create or replace function private.stage9_stage_sequence(p_stage_key text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_stage_key
    when 'reserve' then 0
    when 'launch' then 1
    when 'synthetic' then 2
    when 'mock-commerce' then 3
    when 'real-read-only' then 4
    when 'controlled-draft' then 5
    when 'complete' then 6
    else 99
  end;
$$;

revoke all on function private.stage9_stage_sequence(text)
  from public, anon, authenticated, service_role;

create or replace function private.stage9_upsert_stage(
  p_business_id uuid,
  p_workflow_run_id uuid,
  p_stage_key text,
  p_status text,
  p_output jsonb default '{}'::jsonb,
  p_failure jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage_id uuid;
begin
  insert into public.workflow_stage_runs (
    business_id, workflow_run_id, stage_key, sequence, attempt, status,
    input, output, failure, started_at, completed_at
  )
  values (
    p_business_id, p_workflow_run_id, p_stage_key,
    private.stage9_stage_sequence(p_stage_key), 1, p_status,
    '{}'::jsonb, coalesce(p_output,'{}'::jsonb), coalesce(p_failure,'{}'::jsonb),
    case when p_status in ('running','completed','failed') then now() else null end,
    case when p_status in ('completed','failed','skipped') then now() else null end
  )
  on conflict (workflow_run_id, stage_key, attempt) do update
  set
    status = excluded.status,
    output = case when excluded.output='{}'::jsonb then public.workflow_stage_runs.output else excluded.output end,
    failure = case when excluded.failure='{}'::jsonb then public.workflow_stage_runs.failure else excluded.failure end,
    started_at = coalesce(public.workflow_stage_runs.started_at, excluded.started_at),
    completed_at = excluded.completed_at,
    updated_at = now()
  returning id into v_stage_id;
  return v_stage_id;
end;
$$;

revoke all on function private.stage9_upsert_stage(uuid,uuid,text,text,jsonb,jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.begin_browser_planner_qualification_run(
  p_business_id uuid,
  p_idempotency_key text,
  p_launch_nonce uuid,
  p_runtime_capability text
)
returns table (
  workflow_run_id uuid,
  browser_session_id uuid,
  browser_identity_id uuid,
  provider_key text,
  provider_profile_id text,
  should_start boolean,
  runtime_launch_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_provider public.browser_provider_definitions%rowtype;
  v_definition public.workflow_definitions%rowtype;
  v_run public.workflow_runs%rowtype;
  v_identity public.browser_identities%rowtype;
  v_session public.browser_sessions%rowtype;
  v_started boolean := false;
begin
  if v_user_id is null or not private.is_business_owner(p_business_id) then
    raise exception 'Business ownership is required.' using errcode = '42501';
  end if;

  if p_launch_nonce is null
    or p_idempotency_key is null
    or char_length(btrim(p_idempotency_key)) not between 1 and 200
    or p_runtime_capability is null
    or char_length(p_runtime_capability) not between 32 and 512 then
    raise exception 'Browser Planner launch request is invalid.' using errcode = '22023';
  end if;

  select * into v_provider
  from public.browser_provider_definitions
  where is_default and status = 'qualified';

  if not found then
    raise exception 'Qualified default browser provider is unavailable.' using errcode = 'P0002';
  end if;

  select definition.* into v_definition
  from public.workflow_definitions definition
  join public.packs pack on pack.id = definition.pack_id
  where pack.pack_key = 'core.synthetic'
    and definition.workflow_key = 'synthetic.browser-planner.qualification'
    and definition.version = '1.0.0';

  if not found then
    raise exception 'Browser Planner qualification workflow is unavailable.' using errcode = 'P0002';
  end if;

  insert into public.workflow_runs (
    business_id, workflow_definition_id, status, current_stage_key,
    idempotency_key, input, state, runtime_launch_status,
    runtime_launch_nonce, runtime_launch_reserved_at, runtime_capability_hash
  )
  values (
    p_business_id, v_definition.id, 'queued', 'reserve',
    btrim(p_idempotency_key),
    jsonb_build_object('businessId',p_business_id,'providerKey',v_provider.provider_key),
    jsonb_build_object('providerKey',v_provider.provider_key,'plannerKey','browser.planner','qualification',true),
    'reserved', p_launch_nonce, now(),
    encode(extensions.digest(convert_to(p_runtime_capability,'UTF8'),'sha256'),'hex')
  )
  on conflict (business_id,idempotency_key) do nothing
  returning * into v_run;

  if found then
    v_started := true;
  else
    select * into v_run
    from public.workflow_runs
    where business_id=p_business_id and idempotency_key=btrim(p_idempotency_key);
  end if;

  select * into v_identity
  from public.browser_identities
  where business_id=p_business_id and identity_key='stage9.qualification';

  if not found then
    insert into public.browser_identities (
      business_id,provider_definition_id,identity_key,label,provider_profile_id,metadata
    ) values (
      p_business_id,v_provider.id,'stage9.qualification','Stage 9 Browser Planner identity',
      'pending:'||gen_random_uuid()::text,
      jsonb_build_object('credentialScope','provider_managed','plannerQualification',true)
    ) returning * into v_identity;
  end if;

  select * into v_session
  from public.browser_sessions
  where workflow_run_id=v_run.id;

  if not found then
    insert into public.browser_sessions (
      business_id,workflow_run_id,provider_definition_id,browser_identity_id,
      status,control_mode,metadata
    ) values (
      p_business_id,v_run.id,v_provider.id,v_identity.id,'reserved','automation',
      jsonb_build_object(
        'qualification','browser_planner',
        'plannerKey','browser.planner',
        'plannerVersion','1.0.0',
        'requiredCapabilities',jsonb_build_array('browser.observe','browser.interact')
      )
    ) returning * into v_session;
  end if;

  if v_started then
    perform private.stage9_upsert_stage(p_business_id,v_run.id,'reserve','completed',jsonb_build_object('browserSessionId',v_session.id));
    perform private.stage9_upsert_stage(p_business_id,v_run.id,'launch','pending');
    perform private.stage9_upsert_stage(p_business_id,v_run.id,'synthetic','pending');
    perform private.stage9_upsert_stage(p_business_id,v_run.id,'mock-commerce','pending');
    perform private.stage9_upsert_stage(p_business_id,v_run.id,'real-read-only','pending');
    perform private.stage9_upsert_stage(p_business_id,v_run.id,'controlled-draft','pending');
    perform private.stage9_upsert_stage(p_business_id,v_run.id,'complete','pending');
  end if;

  return query select
    v_run.id,v_session.id,v_identity.id,v_provider.provider_key,
    v_identity.provider_profile_id,v_started,v_run.runtime_launch_status;
end;
$$;

revoke all on function public.begin_browser_planner_qualification_run(uuid,text,uuid,text)
  from public, anon;
grant execute on function public.begin_browser_planner_qualification_run(uuid,text,uuid,text)
  to authenticated;

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
          evidence=evidence||coalesce(p_payload->'evidence','{}'::jsonb),
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
          evidence=evidence||jsonb_build_object('failure',coalesce(p_payload->'failure','{}'::jsonb))
      where id=v_case.id;
      perform private.stage9_upsert_stage(p_business_id,v_run.id,v_stage_key,'failed',
        '{}'::jsonb,coalesce(p_payload->'failure','{}'::jsonb));
      update public.workflow_runs
      set status='failed',completed_at=now(),
          state=state||jsonb_build_object('plannerFailure',coalesce(p_payload->'failure','{}'::jsonb))
      where id=v_run.id;
    end if;

  elsif p_operation='completed' then
    if exists (
      select 1 from public.browser_planner_qualification_cases
      where planner_definition_id='00000000-0000-4000-8000-000000000901'::uuid
        and status <> 'passed'
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

comment on function public.begin_browser_planner_qualification_run(uuid,text,uuid,text) is
  'Reserves one owner-scoped Stage 9 Browser Planner qualification Workflow Run and browser session.';
comment on function public.stage9_browser_planner_transition(uuid,uuid,text,text,jsonb) is
  'Capability-gated Stage 9 Browser Planner qualification transition.';
