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
  from public.browser_sessions existing_session
  where existing_session.workflow_run_id=v_run.id;

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
