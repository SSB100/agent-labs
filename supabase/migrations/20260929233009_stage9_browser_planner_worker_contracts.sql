
insert into public.packs (
  id, pack_key, version, name, kind, status, manifest
)
values (
  '00000000-0000-4000-8000-000000000903',
  'worker.browser-planner',
  '1.0.0',
  'Browser Planner',
  'worker',
  'experimental',
  jsonb_build_object(
    'manifestVersion','1.0',
    'packKey','worker.browser-planner',
    'version','1.0.0',
    'name','Browser Planner',
    'worker',jsonb_build_object(
      'workerKey','browser.planner',
      'version','1.0.0',
      'role','Browser Planner',
      'charter','Choose exactly one safe browser action from the current Task Contract and structured browser observation. Use only stable element identifiers supplied by Browser Service, never credentials or invented selectors, and stop when the Task Contract is complete or bounded recovery is exhausted.'
    ),
    'capabilityPolicy',jsonb_build_object(
      'allowed',jsonb_build_array('browser.observe','browser.interact'),
      'forbidden',jsonb_build_array('browser.upload','browser.takeover','money.spend','marketplace.publish','shell.execute')
    ),
    'knowledgeRequirements','[]'::jsonb,
    'modelRequirements',jsonb_build_object(
      'executionMode','model_router',
      'modelRouterRequired',true,
      'routeKey','standard.default',
      'structuredOutput',true,
      'toolUse',false,
      'fallbackRequired',true
    ),
    'instructions',jsonb_build_array(
      'Read only the current Task Contract and one structured browser observation Artifact.',
      'Choose exactly one next browser action or return complete/fail.',
      'For click or type actions, use only a stable element ID present in the observation.',
      'Never output CSS selectors, XPath, DOM handles, Playwright calls, cookies, credentials, or multiple actions.',
      'After Core executes an action, wait for a fresh observation before choosing another action.',
      'If an observed element becomes stale, use bounded recovery from a fresh observation instead of inventing a selector.',
      'Never publish, spend, or exceed the explicit Task Contract objective.'
    ),
    'qualificationSystem','stage9.browser-planner'
  )
)
on conflict (pack_key, version) do update
set
  name=excluded.name,
  kind=excluded.kind,
  manifest=excluded.manifest,
  updated_at=now();

insert into public.worker_definitions (
  id, pack_id, worker_key, version, name, role, charter, status,
  input_schema, output_schema, knowledge_requirements,
  capability_requirements, model_requirements
)
values (
  '00000000-0000-4000-8000-000000000904',
  '00000000-0000-4000-8000-000000000903',
  'browser.planner',
  '1.0.0',
  'Browser Planner',
  'Browser Planner',
  'Choose exactly one safe browser action from the current Task Contract and structured browser observation. Use only stable element identifiers supplied by Browser Service, never credentials or invented selectors, and stop when the Task Contract is complete or bounded recovery is exhausted.',
  'experimental',
  jsonb_build_object(
    'type','object',
    'additionalProperties',false,
    'required',jsonb_build_array('taskContract','inputArtifacts'),
    'properties',jsonb_build_object(
      'taskContract',jsonb_build_object('type','object'),
      'inputArtifacts',jsonb_build_object('type','array','minItems',1,'maxItems',1)
    )
  ),
  jsonb_build_object(
    'type','object',
    'additionalProperties',false,
    'required',jsonb_build_array('type','elementId','text','url','reason','failureCategory'),
    'properties',jsonb_build_object(
      'type',jsonb_build_object('type','string','enum',jsonb_build_array('click','type','navigate','complete','fail')),
      'elementId',jsonb_build_object('type',jsonb_build_array('string','null')),
      'text',jsonb_build_object('type',jsonb_build_array('string','null')),
      'url',jsonb_build_object('type',jsonb_build_array('string','null')),
      'reason',jsonb_build_object('type','string'),
      'failureCategory',jsonb_build_object('type',jsonb_build_array('string','null'))
    )
  ),
  '[]'::jsonb,
  jsonb_build_array('browser.observe','browser.interact'),
  jsonb_build_object(
    'executionMode','model_router',
    'modelRouterRequired',true,
    'routeKey','standard.default',
    'structuredOutput',true,
    'toolUse',false,
    'fallbackRequired',true
  )
)
on conflict (pack_id, worker_key, version) do update
set
  name=excluded.name,
  role=excluded.role,
  charter=excluded.charter,
  input_schema=excluded.input_schema,
  output_schema=excluded.output_schema,
  knowledge_requirements=excluded.knowledge_requirements,
  capability_requirements=excluded.capability_requirements,
  model_requirements=excluded.model_requirements,
  updated_at=now();

update public.browser_planner_definitions
set qualification = qualification || jsonb_build_object(
  'workerPackId','00000000-0000-4000-8000-000000000903',
  'workerDefinitionId','00000000-0000-4000-8000-000000000904'
)
where id='00000000-0000-4000-8000-000000000901'::uuid;

create or replace function private.stage9_browser_planner_fingerprint()
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
          'planner', (
            select to_jsonb(planner) - 'status' - 'qualification' - 'created_at' - 'updated_at'
            from public.browser_planner_definitions planner
            where planner.id='00000000-0000-4000-8000-000000000901'::uuid
          ),
          'worker', (
            select to_jsonb(worker) - 'status' - 'created_at' - 'updated_at'
            from public.worker_definitions worker
            where worker.id='00000000-0000-4000-8000-000000000904'::uuid
          ),
          'pack', (
            select to_jsonb(pack) - 'status' - 'created_at' - 'updated_at'
            from public.packs pack
            where pack.id='00000000-0000-4000-8000-000000000903'::uuid
          ),
          'route', (
            select to_jsonb(route) - 'created_at' - 'updated_at'
            from public.model_routes route
            where route.route_key='standard.default'
          ),
          'models', coalesce((
            select jsonb_agg(
              to_jsonb(model) - 'created_at' - 'updated_at'
              order by model.model_key
            )
            from public.model_definitions model
            where model.id in (
              select route.primary_model_definition_id
              from public.model_routes route
              where route.route_key='standard.default'
              union
              select route.fallback_model_definition_id
              from public.model_routes route
              where route.route_key='standard.default'
            )
          ),'[]'::jsonb),
          'qualifications', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'modelDefinitionId',qualification.model_definition_id,
                'type',qualification.qualification_type,
                'status',qualification.status,
                'evidence',qualification.evidence,
                'qualifiedAt',qualification.qualified_at
              )
              order by qualification.model_definition_id,qualification.qualification_type
            )
            from public.model_qualifications qualification
            where qualification.model_definition_id in (
              select route.primary_model_definition_id
              from public.model_routes route
              where route.route_key='standard.default'
              union
              select route.fallback_model_definition_id
              from public.model_routes route
              where route.route_key='standard.default'
            )
          ),'[]'::jsonb)
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

revoke all on function private.stage9_browser_planner_fingerprint()
  from public, anon, authenticated, service_role;

create or replace function private.stage9_planner_is_currently_qualified()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from public.browser_planner_definitions planner
    join public.worker_definitions worker
      on worker.id='00000000-0000-4000-8000-000000000904'::uuid
    join public.packs pack
      on pack.id='00000000-0000-4000-8000-000000000903'::uuid
    where planner.id='00000000-0000-4000-8000-000000000901'::uuid
      and planner.status='qualified'
      and worker.status in ('qualified','assisted','autonomous')
      and pack.status in ('qualified','assisted','autonomous')
      and planner.qualification->>'subjectFingerprint'
        = private.stage9_browser_planner_fingerprint()
  );
$$;

revoke all on function private.stage9_planner_is_currently_qualified()
  from public, anon, authenticated, service_role;

create or replace function private.stage9_refresh_planner_qualification()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current text := private.stage9_browser_planner_fingerprint();
  v_stored text;
  v_status text;
begin
  select status, qualification->>'subjectFingerprint'
  into v_status, v_stored
  from public.browser_planner_definitions
  where id='00000000-0000-4000-8000-000000000901'::uuid;

  if v_status='qualified' and v_stored is distinct from v_current then
    update public.browser_planner_definitions
    set status='stale',
        qualification=qualification||jsonb_build_object(
          'staleAt',now(),
          'staleReason','Browser Planner Worker Pack, route, model, or model qualification changed.',
          'currentFingerprint',v_current
        )
    where id='00000000-0000-4000-8000-000000000901'::uuid;

    update public.browser_planner_qualification_cases
    set status='stale'
    where planner_definition_id='00000000-0000-4000-8000-000000000901'::uuid
      and status='passed';

    update public.worker_definitions
    set status='experimental'
    where id='00000000-0000-4000-8000-000000000904'::uuid;

    update public.packs
    set status='experimental'
    where id='00000000-0000-4000-8000-000000000903'::uuid;
  end if;
end;
$$;

revoke all on function private.stage9_refresh_planner_qualification()
  from public, anon, authenticated, service_role;

create or replace function private.stage9_planner_invalidation_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.stage9_refresh_planner_qualification();
  return null;
end;
$$;

revoke all on function private.stage9_planner_invalidation_trigger()
  from public, anon, authenticated, service_role;

drop trigger if exists stage9_planner_contract_changed on public.browser_planner_definitions;
create trigger stage9_planner_contract_changed
after update of version, model_route_key, observation_contract, action_contract, recovery_policy
on public.browser_planner_definitions
for each statement execute function private.stage9_planner_invalidation_trigger();

drop trigger if exists stage9_planner_worker_changed on public.worker_definitions;
create trigger stage9_planner_worker_changed
after update of worker_key, version, role, charter, input_schema, output_schema,
  knowledge_requirements, capability_requirements, model_requirements
on public.worker_definitions
for each statement execute function private.stage9_planner_invalidation_trigger();

drop trigger if exists stage9_planner_pack_changed on public.packs;
create trigger stage9_planner_pack_changed
after update of pack_key, version, manifest
on public.packs
for each statement execute function private.stage9_planner_invalidation_trigger();

drop trigger if exists stage9_planner_model_changed on public.model_definitions;
create trigger stage9_planner_model_changed
after update of model_key, provider, provider_family, provider_model_id, tier,
  status, context_window_tokens, max_output_tokens, capabilities,
  input_price_per_million_usd, output_price_per_million_usd,
  cache_read_price_per_million_usd, metadata
on public.model_definitions
for each statement execute function private.stage9_planner_invalidation_trigger();

drop trigger if exists stage9_planner_route_changed on public.model_routes;
create trigger stage9_planner_route_changed
after update of route_key, status, requirements, primary_model_definition_id,
  fallback_model_definition_id, maximum_attempts, metadata
on public.model_routes
for each statement execute function private.stage9_planner_invalidation_trigger();

drop trigger if exists stage9_planner_model_qualification_changed on public.model_qualifications;
create trigger stage9_planner_model_qualification_changed
after insert or update or delete
on public.model_qualifications
for each statement execute function private.stage9_planner_invalidation_trigger();

create or replace function private.stage9_enforce_planner_task_contract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_definition_id uuid;
begin
  if new.worker_definition_id <> '00000000-0000-4000-8000-000000000904'::uuid then
    return new;
  end if;

  select workflow_definition_id into v_definition_id
  from public.workflow_runs
  where id=new.workflow_run_id
    and business_id=new.business_id;

  if v_definition_id='00000000-0000-4000-8000-000000000902'::uuid then
    return new;
  end if;

  if not private.stage9_planner_is_currently_qualified() then
    raise exception 'Browser Planner is not currently qualified for this Worker Pack and model route.'
      using errcode='42501';
  end if;

  return new;
end;
$$;

revoke all on function private.stage9_enforce_planner_task_contract()
  from public, anon, authenticated, service_role;

drop trigger if exists stage9_task_contract_requires_qualified_planner on public.task_contracts;
create trigger stage9_task_contract_requires_qualified_planner
before insert or update of worker_definition_id
on public.task_contracts
for each row execute function private.stage9_enforce_planner_task_contract();

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
  p_previous_failure jsonb default null
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
    jsonb_build_object('oneBoundedAction',true,'freshObservationRequiredAfterAction',true),
    jsonb_build_object(
      'allowedCategories',jsonb_build_array(
        'invented_element','invalid_action','action_failed','observation_failed',
        'model_failed','recovery_exhausted'
      )
    ),
    array[
      'Invent selectors or element identifiers',
      'Use raw Playwright, DOM handles, credentials, cookies, or provider secrets',
      'Return multiple browser actions in one planning step',
      'Publish, spend, or exceed the explicit objective'
    ]::text[],
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
  uuid,uuid,uuid,text,text,text,integer,text,text[],jsonb,jsonb
) from public, authenticated, service_role;
grant execute on function public.stage9_prepare_planner_step(
  uuid,uuid,uuid,text,text,text,integer,text,text[],jsonb,jsonb
) to anon;

create or replace function public.stage9_finish_planner_step(
  p_business_id uuid,
  p_workflow_run_id uuid,
  p_browser_session_id uuid,
  p_runtime_capability text,
  p_task_contract_id uuid,
  p_worker_run_id uuid,
  p_status text,
  p_action jsonb default null,
  p_failure jsonb default '{}'::jsonb,
  p_model_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_output_artifact_id uuid;
begin
  if p_runtime_capability is null
    or char_length(p_runtime_capability) not between 32 and 512
    or p_status not in ('completed','failed')
    or p_failure is null or jsonb_typeof(p_failure)<>'object'
    or p_model_metadata is null or jsonb_typeof(p_model_metadata)<>'object'
    or (p_action is not null and jsonb_typeof(p_action)<>'object') then
    raise exception 'Invalid Browser Planner step completion.' using errcode='22023';
  end if;

  if not exists(
    select 1 from public.workflow_runs
    where id=p_workflow_run_id and business_id=p_business_id
      and runtime_capability_hash=encode(
        extensions.digest(convert_to(p_runtime_capability,'UTF8'),'sha256'),'hex'
      )
  ) or not exists(
    select 1 from public.browser_sessions
    where id=p_browser_session_id and workflow_run_id=p_workflow_run_id
      and business_id=p_business_id
  ) then
    raise exception 'Browser Planner step completion capability denied.' using errcode='42501';
  end if;

  if not exists(
    select 1 from public.worker_runs
    where id=p_worker_run_id and workflow_run_id=p_workflow_run_id
      and business_id=p_business_id and task_contract_id=p_task_contract_id
      and worker_definition_id='00000000-0000-4000-8000-000000000904'::uuid
  ) then
    raise exception 'Browser Planner Worker Run unavailable.' using errcode='P0002';
  end if;

  update public.worker_runs
  set
    status=p_status,
    output=case when p_action is null then '{}'::jsonb else p_action end,
    failure=case when p_status='failed' then p_failure else '{}'::jsonb end,
    execution_metadata=execution_metadata||p_model_metadata,
    completed_at=now(),
    updated_at=now()
  where id=p_worker_run_id;

  update public.task_contracts
  set status=p_status,updated_at=now()
  where id=p_task_contract_id;

  if p_status='completed' and p_action is not null then
    v_output_artifact_id := private.stage4_deterministic_uuid(
      'stage9:planner-action:'||p_worker_run_id::text
    );
    insert into public.artifacts(
      id,business_id,workflow_run_id,task_contract_id,artifact_type,name,
      media_type,content,metadata
    )
    values(
      v_output_artifact_id,p_business_id,p_workflow_run_id,p_task_contract_id,
      'browser.planner-action','Browser Planner action',
      'application/json',p_action,
      jsonb_build_object(
        'source','browser.planner',
        'workerRunId',p_worker_run_id,
        'model',p_model_metadata
      )
    )
    on conflict(id) do update
    set content=excluded.content,metadata=excluded.metadata,updated_at=now();
  end if;

  return jsonb_build_object(
    'taskContractId',p_task_contract_id,
    'workerRunId',p_worker_run_id,
    'status',p_status,
    'outputArtifactId',v_output_artifact_id
  );
end;
$$;

revoke all on function public.stage9_finish_planner_step(
  uuid,uuid,uuid,text,uuid,uuid,text,jsonb,jsonb,jsonb
) from public, authenticated, service_role;
grant execute on function public.stage9_finish_planner_step(
  uuid,uuid,uuid,text,uuid,uuid,text,jsonb,jsonb,jsonb
) to anon;

comment on function private.stage9_browser_planner_fingerprint() is
  'Fingerprints Browser Planner contract, Worker Pack, standard route, models and model qualification evidence.';
comment on function public.stage9_prepare_planner_step(uuid,uuid,uuid,text,text,text,integer,text,text[],jsonb,jsonb) is
  'Creates one durable Task Contract, structured observation Artifact and Browser Planner Worker Run for one planning step.';
comment on function public.stage9_finish_planner_step(uuid,uuid,uuid,text,uuid,uuid,text,jsonb,jsonb,jsonb) is
  'Completes one Browser Planner Worker Run and persists its one-action output Artifact.';
