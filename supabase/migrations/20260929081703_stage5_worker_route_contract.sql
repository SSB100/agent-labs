insert into public.packs (id, pack_key, version, name, kind, status, manifest)
select
  '00000000-0000-4000-8000-000000000501'::uuid,
  'worker.generic-researcher','1.0.0','Generic Researcher','worker','experimental',
  manifest || jsonb_build_object(
    'packKey','worker.generic-researcher','name','Generic Researcher',
    'worker',(manifest -> 'worker') || jsonb_build_object('workerKey','generic.researcher','version','1.0.0'),
    'modelRequirements',jsonb_build_object(
      'executionMode','model_router','modelRouterRequired',true,
      'routeKey','standard.default','structuredOutput',true,'toolUse',false,
      'minimumContextTokens',200000,'fallbackRequired',true
    ),
    'escalationPolicy',jsonb_build_object(
      'providerFailure','use_one_qualified_fallback_then_stop',
      'validationFailure','fail_task','unavailableKnowledge','fail_task',
      'unexpectedFailure','classify_and_stop'
    )
  )
from public.packs
where id = '00000000-0000-4000-8000-000000000401'
on conflict (pack_key, version) do update set
  name=excluded.name,kind=excluded.kind,status=excluded.status,
  manifest=excluded.manifest,updated_at=now();

insert into public.worker_definitions (
  id, pack_id, worker_key, version, name, role, charter, status,
  input_schema, output_schema, knowledge_requirements,
  capability_requirements, model_requirements
)
select
  '00000000-0000-4000-8000-000000000502'::uuid,
  '00000000-0000-4000-8000-000000000501'::uuid,
  'generic.researcher','1.0.0','Generic Researcher',role,charter,'experimental',
  input_schema,output_schema,knowledge_requirements,capability_requirements,
  '{"executionMode":"model_router","modelRouterRequired":true,"routeKey":"standard.default","structuredOutput":true,"toolUse":false,"minimumContextTokens":200000,"fallbackRequired":true}'::jsonb
from public.worker_definitions
where id = '00000000-0000-4000-8000-000000000402'
on conflict (pack_id, worker_key, version) do update set
  name=excluded.name,role=excluded.role,charter=excluded.charter,status=excluded.status,
  input_schema=excluded.input_schema,output_schema=excluded.output_schema,
  knowledge_requirements=excluded.knowledge_requirements,
  capability_requirements=excluded.capability_requirements,
  model_requirements=excluded.model_requirements,updated_at=now();

insert into public.workflow_definitions (
  id, pack_id, workflow_key, version, name, description, status,
  input_schema, output_schema, stage_definition
)
values (
  '00000000-0000-4000-8000-000000000503',
  '00000000-0000-4000-8000-000000000201',
  'synthetic.model-router.runtime-proof','1.0.0',
  'Synthetic Model Router Runtime Proof',
  'Stage 5 proof that a bounded worker contract resolves through a qualified logical route, records provider telemetry and cost, and uses at most one meaningful fallback.',
  'experimental',
  '{"type":"object","required":["businessId","coreWorkflowRunId","runtimeCapability","proofMode"],"additionalProperties":false}',
  '{"type":"object","required":["coreWorkflowRunId","runtimeRunId","status","selectedModelKey","modelRouteKey","workerOutput","workerReceipt"],"additionalProperties":false}',
  '{"stages":[{"key":"start","type":"system","sequence":0},{"key":"task-contract","type":"contract","sequence":1},{"key":"route","type":"model-route","sequence":2},{"key":"worker","type":"worker","sequence":3},{"key":"validate","type":"validation","sequence":4},{"key":"complete","type":"terminal","sequence":5}]}'
)
on conflict (pack_id, workflow_key, version) do update set
  name=excluded.name,description=excluded.description,status=excluded.status,
  input_schema=excluded.input_schema,output_schema=excluded.output_schema,
  stage_definition=excluded.stage_definition,updated_at=now();

create or replace function private.stage5_deterministic_uuid(p_value text)
returns uuid
language sql
immutable
strict
set search_path = ''
as $$
  select (
    substr(md5(p_value),1,8) || '-' || substr(md5(p_value),9,4) || '-' ||
    '5' || substr(md5(p_value),14,3) || '-' ||
    'a' || substr(md5(p_value),18,3) || '-' || substr(md5(p_value),21,12)
  )::uuid;
$$;
revoke all on function private.stage5_deterministic_uuid(text)
  from public, anon, authenticated;

create or replace function public.begin_model_router_workflow_run(
  p_business_id uuid,
  p_idempotency_key text,
  p_launch_nonce uuid,
  p_runtime_capability text,
  p_proof_mode text default 'live'
)
returns table (
  workflow_run_id uuid,
  should_start boolean,
  runtime_launch_status text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
begin
  if not private.is_business_owner(p_business_id) then
    raise exception 'Business ownership is required.' using errcode='42501';
  end if;
  if p_launch_nonce is null
    or p_runtime_capability is null
    or char_length(p_runtime_capability) not between 32 and 512
    or p_proof_mode not in ('live','fallback-proof')
    or p_idempotency_key is null
    or char_length(btrim(p_idempotency_key)) not between 1 and 200 then
    raise exception 'The model workflow launch request is invalid.' using errcode='22023';
  end if;

  insert into public.workflow_runs (
    business_id, workflow_definition_id, status, current_stage_key,
    idempotency_key, input, state, runtime_provider,
    runtime_launch_status, runtime_launch_nonce,
    runtime_launch_reserved_at, runtime_capability_hash
  ) values (
    p_business_id,'00000000-0000-4000-8000-000000000503','queued',null,
    btrim(p_idempotency_key),jsonb_build_object('proofMode',p_proof_mode),
    jsonb_build_object(
      'runtime','vercel_workflow','workerKey','generic.researcher',
      'workerVersion','1.0.0','modelRouteKey','standard.default'
    ),
    'vercel_workflow','reserved',p_launch_nonce,now(),
    encode(extensions.digest(convert_to(p_runtime_capability,'UTF8'),'sha256'),'hex')
  )
  on conflict (business_id,idempotency_key) do nothing
  returning id, workflow_runs.runtime_launch_status into v_id, v_status;

  if v_id is not null then
    insert into public.events (
      id,business_id,workflow_run_id,event_type,actor_type,payload
    ) values (
      private.stage5_deterministic_uuid('event:' || v_id::text || ':workflow.queued'),
      p_business_id,v_id,'workflow.queued','owner',
      jsonb_build_object(
        'workflowKey','synthetic.model-router.runtime-proof','proofMode',p_proof_mode
      )
    ) on conflict (id) do nothing;
    return query select v_id,true,v_status;
    return;
  end if;

  select id, workflow_runs.runtime_launch_status into v_id,v_status
  from public.workflow_runs
  where business_id=p_business_id and idempotency_key=btrim(p_idempotency_key);
  return query select v_id,false,v_status;
end;
$$;

revoke all on function public.begin_model_router_workflow_run(uuid,text,uuid,text,text)
  from public,anon;
grant execute on function public.begin_model_router_workflow_run(uuid,text,uuid,text,text)
  to authenticated;