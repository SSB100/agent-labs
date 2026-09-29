insert into public.workflow_definitions (
  id,
  pack_id,
  workflow_key,
  version,
  name,
  description,
  status,
  input_schema,
  output_schema,
  stage_definition
)
select
  '00000000-0000-4000-8000-000000000801',
  pack.id,
  'synthetic.browser-provider.qualification',
  '1.0.0',
  'Browser Provider Qualification',
  'Launches an isolated remote Chromium session, proves Playwright observation and upload, pauses for owner takeover, returns control to automation, releases the session and exposes replay.',
  'experimental',
  jsonb_build_object(
    'type', 'object',
    'additionalProperties', false,
    'required', jsonb_build_array('businessId'),
    'properties', jsonb_build_object(
      'businessId', jsonb_build_object('type', 'string', 'format', 'uuid')
    )
  ),
  jsonb_build_object(
    'type', 'object',
    'additionalProperties', false,
    'required', jsonb_build_array('browserSessionId', 'providerKey', 'status'),
    'properties', jsonb_build_object(
      'browserSessionId', jsonb_build_object('type', 'string', 'format', 'uuid'),
      'providerKey', jsonb_build_object('type', 'string'),
      'status', jsonb_build_object('const', 'completed')
    )
  ),
  jsonb_build_object(
    'stages', jsonb_build_array(
      jsonb_build_object('key', 'reserve', 'type', 'system', 'sequence', 0),
      jsonb_build_object('key', 'launch', 'type', 'browser', 'sequence', 1),
      jsonb_build_object('key', 'observe', 'type', 'browser', 'sequence', 2),
      jsonb_build_object('key', 'take-control', 'type', 'owner_intervention', 'sequence', 3),
      jsonb_build_object('key', 'return-control', 'type', 'owner_intervention', 'sequence', 4),
      jsonb_build_object('key', 'verify', 'type', 'browser', 'sequence', 5),
      jsonb_build_object('key', 'replay', 'type', 'browser', 'sequence', 6),
      jsonb_build_object('key', 'complete', 'type', 'terminal', 'sequence', 7)
    ),
    'providerNeutral', true,
    'requiredCapabilities', jsonb_build_array(
      'browser.observe',
      'browser.interact',
      'browser.upload',
      'browser.takeover'
    )
  )
from public.packs pack
where pack.pack_key = 'core.synthetic'
  and pack.version = '1.0.0'
on conflict (pack_id, workflow_key, version) do update
set
  name = excluded.name,
  description = excluded.description,
  status = case
    when public.workflow_definitions.status = 'qualified'
      then public.workflow_definitions.status
    else excluded.status
  end,
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
      '00000000-0000-4000-8000-000000000801'::uuid
    ])
    or runtime_capability_hash is not null
  );

create or replace function private.stage8_stage_sequence(p_stage_key text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_stage_key
    when 'reserve' then 0
    when 'launch' then 1
    when 'observe' then 2
    when 'take-control' then 3
    when 'return-control' then 4
    when 'verify' then 5
    when 'replay' then 6
    when 'complete' then 7
    else 99
  end;
$$;

revoke all on function private.stage8_stage_sequence(text)
  from public, anon, authenticated, service_role;

create or replace function private.stage8_upsert_stage(
  p_business_id uuid,
  p_workflow_run_id uuid,
  p_stage_key text,
  p_status text,
  p_input jsonb default '{}'::jsonb,
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
    business_id,
    workflow_run_id,
    stage_key,
    sequence,
    attempt,
    status,
    input,
    output,
    failure,
    started_at,
    completed_at
  )
  values (
    p_business_id,
    p_workflow_run_id,
    p_stage_key,
    private.stage8_stage_sequence(p_stage_key),
    1,
    p_status,
    coalesce(p_input, '{}'::jsonb),
    coalesce(p_output, '{}'::jsonb),
    coalesce(p_failure, '{}'::jsonb),
    case when p_status in ('running', 'waiting', 'review', 'completed', 'failed') then now() else null end,
    case when p_status in ('completed', 'failed', 'skipped') then now() else null end
  )
  on conflict (workflow_run_id, stage_key, attempt) do update
  set
    status = excluded.status,
    input = case when excluded.input = '{}'::jsonb then public.workflow_stage_runs.input else excluded.input end,
    output = case when excluded.output = '{}'::jsonb then public.workflow_stage_runs.output else excluded.output end,
    failure = case when excluded.failure = '{}'::jsonb then public.workflow_stage_runs.failure else excluded.failure end,
    started_at = coalesce(public.workflow_stage_runs.started_at, excluded.started_at),
    completed_at = excluded.completed_at,
    updated_at = now()
  returning id into v_stage_id;

  return v_stage_id;
end;
$$;

revoke all on function private.stage8_upsert_stage(uuid, uuid, text, text, jsonb, jsonb, jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.stage8_record_browser_event(
  p_business_id uuid,
  p_workflow_run_id uuid,
  p_browser_session_id uuid,
  p_event_type text,
  p_control_mode text,
  p_payload jsonb default '{}'::jsonb,
  p_actor_type text default 'system'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.browser_session_events (
    business_id,
    workflow_run_id,
    browser_session_id,
    event_type,
    control_mode,
    payload
  )
  values (
    p_business_id,
    p_workflow_run_id,
    p_browser_session_id,
    p_event_type,
    p_control_mode,
    coalesce(p_payload, '{}'::jsonb)
  );

  insert into public.events (
    business_id,
    workflow_run_id,
    event_type,
    actor_type,
    payload,
    occurred_at
  )
  values (
    p_business_id,
    p_workflow_run_id,
    p_event_type,
    p_actor_type,
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
      'browserSessionId', p_browser_session_id,
      'controlMode', p_control_mode
    ),
    now()
  );
end;
$$;

revoke all on function private.stage8_record_browser_event(uuid, uuid, uuid, text, text, jsonb, text)
  from public, anon, authenticated, service_role;

create or replace function public.begin_browser_qualification_run(
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
  if v_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if not private.is_business_owner(p_business_id) then
    raise exception 'Business ownership is required.' using errcode = '42501';
  end if;

  if p_launch_nonce is null
    or p_idempotency_key is null
    or char_length(btrim(p_idempotency_key)) not between 1 and 200
    or p_runtime_capability is null
    or char_length(p_runtime_capability) not between 32 and 512 then
    raise exception 'Browser qualification launch request is invalid.' using errcode = '22023';
  end if;

  select provider.* into v_provider
  from public.browser_provider_definitions provider
  where provider.is_default
    and provider.status in ('selected', 'qualified');

  if not found then
    raise exception 'No default browser provider is selected.' using errcode = 'P0002';
  end if;

  select definition.* into v_definition
  from public.workflow_definitions definition
  join public.packs pack on pack.id = definition.pack_id
  where pack.pack_key = 'core.synthetic'
    and definition.workflow_key = 'synthetic.browser-provider.qualification'
    and definition.version = '1.0.0';

  if not found then
    raise exception 'Browser qualification workflow is unavailable.' using errcode = 'P0002';
  end if;

  insert into public.workflow_runs (
    business_id,
    workflow_definition_id,
    status,
    current_stage_key,
    idempotency_key,
    input,
    state,
    runtime_launch_status,
    runtime_launch_nonce,
    runtime_launch_reserved_at,
    runtime_capability_hash
  )
  values (
    p_business_id,
    v_definition.id,
    'queued',
    'reserve',
    btrim(p_idempotency_key),
    jsonb_build_object('businessId', p_business_id, 'providerKey', v_provider.provider_key),
    jsonb_build_object('providerKey', v_provider.provider_key, 'qualification', true),
    'reserved',
    p_launch_nonce,
    now(),
    encode(extensions.digest(convert_to(p_runtime_capability, 'UTF8'), 'sha256'), 'hex')
  )
  on conflict (business_id, idempotency_key) do nothing
  returning * into v_run;

  if found then
    v_started := true;
  else
    select run.* into v_run
    from public.workflow_runs run
    where run.business_id = p_business_id
      and run.idempotency_key = btrim(p_idempotency_key);
  end if;

  select identity.* into v_identity
  from public.browser_identities identity
  where identity.business_id = p_business_id
    and identity.identity_key = 'stage8.qualification';

  if not found then
    insert into public.browser_identities (
      business_id,
      provider_definition_id,
      identity_key,
      label,
      provider_profile_id,
      metadata
    )
    values (
      p_business_id,
      v_provider.id,
      'stage8.qualification',
      'Stage 8 qualification identity',
      'pending:' || gen_random_uuid()::text,
      jsonb_build_object('credentialScope', 'provider_managed', 'accountIdentity', 'opaque')
    )
    returning * into v_identity;
  end if;

  select session.* into v_session
  from public.browser_sessions session
  where session.workflow_run_id = v_run.id;

  if not found then
    insert into public.browser_sessions (
      business_id,
      workflow_run_id,
      provider_definition_id,
      browser_identity_id,
      status,
      control_mode,
      metadata
    )
    values (
      p_business_id,
      v_run.id,
      v_provider.id,
      v_identity.id,
      'reserved',
      'automation',
      jsonb_build_object(
        'qualificationTarget', 'https://example.com',
        'requiredCapabilities', jsonb_build_array(
          'browser.observe',
          'browser.interact',
          'browser.upload',
          'browser.takeover'
        )
      )
    )
    returning * into v_session;
  end if;

  if v_started then
    perform private.stage8_upsert_stage(p_business_id, v_run.id, 'reserve', 'completed', '{}'::jsonb, jsonb_build_object('browserSessionId', v_session.id));
    perform private.stage8_upsert_stage(p_business_id, v_run.id, 'launch', 'pending');
    perform private.stage8_upsert_stage(p_business_id, v_run.id, 'observe', 'pending');
    perform private.stage8_upsert_stage(p_business_id, v_run.id, 'take-control', 'pending');
    perform private.stage8_upsert_stage(p_business_id, v_run.id, 'return-control', 'pending');
    perform private.stage8_upsert_stage(p_business_id, v_run.id, 'verify', 'pending');
    perform private.stage8_upsert_stage(p_business_id, v_run.id, 'replay', 'pending');
    perform private.stage8_upsert_stage(p_business_id, v_run.id, 'complete', 'pending');

    perform private.stage8_record_browser_event(
      p_business_id,
      v_run.id,
      v_session.id,
      'browser.session.reserved',
      'automation',
      jsonb_build_object('providerKey', v_provider.provider_key, 'identityId', v_identity.id)
    );
  end if;

  return query select
    v_run.id,
    v_session.id,
    v_identity.id,
    v_provider.provider_key,
    v_identity.provider_profile_id,
    v_started,
    v_run.runtime_launch_status;
end;
$$;

revoke all on function public.begin_browser_qualification_run(uuid, text, uuid, text)
  from public, anon;
grant execute on function public.begin_browser_qualification_run(uuid, text, uuid, text)
  to authenticated;

create or replace function public.stage8_browser_runtime_transition(
  p_workflow_run_id uuid,
  p_business_id uuid,
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
  v_provider public.browser_provider_definitions%rowtype;
  v_intervention_id uuid;
  v_profile_id text;
  v_failure jsonb := coalesce(p_payload -> 'failure', '{}'::jsonb);
begin
  if p_runtime_capability is null
    or char_length(p_runtime_capability) not between 32 and 512
    or p_payload is null
    or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Browser runtime transition request is invalid.' using errcode = '22023';
  end if;

  select run.* into v_run
  from public.workflow_runs run
  where run.id = p_workflow_run_id
    and run.business_id = p_business_id
    and run.workflow_definition_id = '00000000-0000-4000-8000-000000000801'
    and run.runtime_capability_hash = encode(
      extensions.digest(convert_to(p_runtime_capability, 'UTF8'), 'sha256'),
      'hex'
    )
  for update;

  if not found then
    raise exception 'Browser runtime capability denied.' using errcode = '42501';
  end if;

  select session.* into v_session
  from public.browser_sessions session
  where session.workflow_run_id = v_run.id
    and session.business_id = p_business_id
  for update;

  if not found then
    raise exception 'Browser session is unavailable.' using errcode = 'P0002';
  end if;

  select provider.* into v_provider
  from public.browser_provider_definitions provider
  where provider.id = v_session.provider_definition_id;

  if p_operation = 'runtime_started' then
    update public.workflow_runs
    set
      status = 'running',
      current_stage_key = 'launch',
      runtime_provider = 'vercel_workflow',
      runtime_run_id = nullif(p_payload ->> 'runtimeRunId', ''),
      runtime_launch_status = 'started',
      started_at = coalesce(started_at, now()),
      state = state || jsonb_build_object('browserSessionId', v_session.id),
      updated_at = now()
    where id = v_run.id;

    update public.browser_sessions
    set status = 'launching', started_at = coalesce(started_at, now())
    where id = v_session.id;

    perform private.stage8_upsert_stage(p_business_id, v_run.id, 'launch', 'running');
    perform private.stage8_record_browser_event(
      p_business_id, v_run.id, v_session.id,
      'browser.workflow.started', 'automation',
      jsonb_build_object('runtimeRunId', p_payload ->> 'runtimeRunId')
    );

  elsif p_operation = 'session_launched' then
    if nullif(p_payload ->> 'providerSessionId', '') is null
      or nullif(p_payload ->> 'debugUrl', '') is null
      or nullif(p_payload ->> 'websocketUrl', '') is null then
      raise exception 'Browser provider session response is incomplete.' using errcode = '22023';
    end if;

    v_profile_id := nullif(p_payload ->> 'profileId', '');

    update public.browser_sessions
    set
      provider_session_id = p_payload ->> 'providerSessionId',
      status = 'live',
      control_mode = 'automation',
      live_view_status = 'ready',
      replay_status = 'pending',
      current_url = nullif(p_payload ->> 'currentUrl', ''),
      page_title = nullif(p_payload ->> 'pageTitle', ''),
      region = nullif(p_payload ->> 'region', ''),
      browser_mode = nullif(p_payload ->> 'browserMode', ''),
      metadata = metadata || jsonb_build_object(
        'uploadQualified', coalesce((p_payload ->> 'uploadQualified')::boolean, false),
        'uploadName', p_payload ->> 'uploadName',
        'playwrightQualified', true,
        'liveEmbedQualified', true
      )
    where id = v_session.id;

    if v_profile_id is not null then
      update public.browser_identities
      set
        provider_profile_id = v_profile_id,
        metadata = metadata || jsonb_build_object('profileQualified', true, 'lastSessionId', p_payload ->> 'providerSessionId')
      where id = v_session.browser_identity_id;
    end if;

    insert into private.browser_session_secrets (
      browser_session_id,
      debug_url,
      session_viewer_url,
      websocket_url
    )
    values (
      v_session.id,
      p_payload ->> 'debugUrl',
      nullif(p_payload ->> 'sessionViewerUrl', ''),
      p_payload ->> 'websocketUrl'
    )
    on conflict (browser_session_id) do update
    set
      debug_url = excluded.debug_url,
      session_viewer_url = excluded.session_viewer_url,
      websocket_url = excluded.websocket_url,
      updated_at = now();

    insert into public.external_resources (
      business_id,
      provider,
      resource_type,
      external_id,
      status,
      metadata
    )
    values (
      p_business_id,
      v_provider.provider_key,
      'browser_session',
      p_payload ->> 'providerSessionId',
      'active',
      jsonb_build_object('browserSessionId', v_session.id, 'workflowRunId', v_run.id)
    )
    on conflict (business_id, provider, resource_type, external_id) do update
    set status = 'active', metadata = excluded.metadata, updated_at = now();

    perform private.stage8_upsert_stage(
      p_business_id, v_run.id, 'launch', 'completed', '{}'::jsonb,
      jsonb_build_object('providerSessionId', p_payload ->> 'providerSessionId', 'providerKey', v_provider.provider_key)
    );
    perform private.stage8_upsert_stage(
      p_business_id, v_run.id, 'observe', 'completed', '{}'::jsonb,
      jsonb_build_object(
        'url', p_payload ->> 'currentUrl',
        'title', p_payload ->> 'pageTitle',
        'uploadQualified', coalesce((p_payload ->> 'uploadQualified')::boolean, false)
      )
    );
    perform private.stage8_upsert_stage(p_business_id, v_run.id, 'take-control', 'review');

    insert into public.owner_interventions (
      business_id,
      workflow_run_id,
      intervention_type,
      status,
      title,
      description,
      options
    )
    values (
      p_business_id,
      v_run.id,
      'browser_takeover',
      'open',
      'Take control of the live browser',
      'Open the Live Browser workspace, take temporary control, interact with the qualification page, then return control to Agent Labs.',
      jsonb_build_object('browserSessionId', v_session.id, 'decision', 'take_control')
    )
    returning id into v_intervention_id;

    update public.workflow_runs
    set
      status = 'needs_owner',
      current_stage_key = 'take-control',
      state = state || jsonb_build_object(
        'browserSessionId', v_session.id,
        'providerSessionId', p_payload ->> 'providerSessionId',
        'ownerInterventionId', v_intervention_id
      )
    where id = v_run.id;

    perform private.stage8_record_browser_event(
      p_business_id, v_run.id, v_session.id,
      'browser.session.launched', 'automation',
      jsonb_build_object(
        'providerKey', v_provider.provider_key,
        'url', p_payload ->> 'currentUrl',
        'title', p_payload ->> 'pageTitle',
        'uploadQualified', coalesce((p_payload ->> 'uploadQualified')::boolean, false)
      ),
      'provider'
    );
    perform private.stage8_record_browser_event(
      p_business_id, v_run.id, v_session.id,
      'browser.takeover.requested', 'automation',
      jsonb_build_object('ownerInterventionId', v_intervention_id)
    );

  elsif p_operation = 'control_taken' then
    update public.browser_sessions
    set status = 'human_control', control_mode = 'human'
    where id = v_session.id;

    update public.owner_interventions
    set
      status = 'resolved',
      resolution = jsonb_build_object(
        'decision', 'take_control',
        'ownerUserId', p_payload ->> 'ownerUserId',
        'decidedAt', p_payload ->> 'decidedAt'
      ),
      resolved_at = now()
    where workflow_run_id = v_run.id
      and intervention_type = 'browser_takeover'
      and status = 'open';

    perform private.stage8_upsert_stage(
      p_business_id, v_run.id, 'take-control', 'completed', '{}'::jsonb,
      jsonb_build_object('ownerUserId', p_payload ->> 'ownerUserId')
    );
    perform private.stage8_upsert_stage(p_business_id, v_run.id, 'return-control', 'review');

    insert into public.owner_interventions (
      business_id,
      workflow_run_id,
      intervention_type,
      status,
      title,
      description,
      options
    )
    values (
      p_business_id,
      v_run.id,
      'browser_return_control',
      'open',
      'Return browser control to Agent Labs',
      'When you have finished interacting with the qualification page, return control so automation can reconnect, verify the page and release the session.',
      jsonb_build_object('browserSessionId', v_session.id, 'decision', 'return_control')
    )
    returning id into v_intervention_id;

    update public.workflow_runs
    set
      status = 'needs_owner',
      current_stage_key = 'return-control',
      state = state || jsonb_build_object('ownerInterventionId', v_intervention_id)
    where id = v_run.id;

    perform private.stage8_record_browser_event(
      p_business_id, v_run.id, v_session.id,
      'browser.control.taken', 'human',
      jsonb_build_object('ownerUserId', p_payload ->> 'ownerUserId'),
      'owner'
    );

  elsif p_operation = 'control_returned' then
    update public.browser_sessions
    set status = 'returning', control_mode = 'automation'
    where id = v_session.id;

    update public.owner_interventions
    set
      status = 'resolved',
      resolution = jsonb_build_object(
        'decision', 'return_control',
        'ownerUserId', p_payload ->> 'ownerUserId',
        'decidedAt', p_payload ->> 'decidedAt'
      ),
      resolved_at = now()
    where workflow_run_id = v_run.id
      and intervention_type = 'browser_return_control'
      and status = 'open';

    perform private.stage8_upsert_stage(
      p_business_id, v_run.id, 'return-control', 'completed', '{}'::jsonb,
      jsonb_build_object('ownerUserId', p_payload ->> 'ownerUserId')
    );
    perform private.stage8_upsert_stage(p_business_id, v_run.id, 'verify', 'running');

    update public.workflow_runs
    set status = 'running', current_stage_key = 'verify'
    where id = v_run.id;

    perform private.stage8_record_browser_event(
      p_business_id, v_run.id, v_session.id,
      'browser.control.returned', 'automation',
      jsonb_build_object('ownerUserId', p_payload ->> 'ownerUserId'),
      'owner'
    );

  elsif p_operation = 'automation_verified' then
    update public.browser_sessions
    set
      status = 'live',
      control_mode = 'automation',
      current_url = coalesce(nullif(p_payload ->> 'currentUrl', ''), current_url),
      page_title = coalesce(nullif(p_payload ->> 'pageTitle', ''), page_title),
      metadata = metadata || jsonb_build_object(
        'returnControlQualified', true,
        'ownerInteractionCount', coalesce(nullif(p_payload ->> 'ownerInteractionCount', '')::integer, 0),
        'automationMarker', p_payload ->> 'automationMarker'
      )
    where id = v_session.id;

    perform private.stage8_upsert_stage(
      p_business_id, v_run.id, 'verify', 'completed', '{}'::jsonb,
      jsonb_build_object(
        'url', p_payload ->> 'currentUrl',
        'title', p_payload ->> 'pageTitle',
        'ownerInteractionCount', coalesce(nullif(p_payload ->> 'ownerInteractionCount', '')::integer, 0),
        'automationMarker', p_payload ->> 'automationMarker'
      )
    );
    perform private.stage8_upsert_stage(p_business_id, v_run.id, 'replay', 'running');

    update public.workflow_runs
    set status = 'running', current_stage_key = 'replay'
    where id = v_run.id;

    perform private.stage8_record_browser_event(
      p_business_id, v_run.id, v_session.id,
      'browser.automation.resumed', 'automation',
      jsonb_build_object(
        'url', p_payload ->> 'currentUrl',
        'ownerInteractionCount', coalesce(nullif(p_payload ->> 'ownerInteractionCount', '')::integer, 0)
      )
    );

  elsif p_operation = 'session_released' then
    update public.browser_sessions
    set
      status = 'released',
      control_mode = 'released',
      live_view_status = 'unavailable',
      replay_status = case when coalesce((p_payload ->> 'replayReady')::boolean, true) then 'ready' else 'pending' end,
      released_at = now(),
      metadata = metadata || jsonb_build_object(
        'releaseQualified', true,
        'replayQualified', coalesce((p_payload ->> 'replayReady')::boolean, true),
        'estimatedCostUsd', coalesce(nullif(p_payload ->> 'estimatedCostUsd', '')::numeric, 0)
      )
    where id = v_session.id;

    update public.external_resources
    set status = 'inactive', updated_at = now(), metadata = metadata || jsonb_build_object('releasedAt', now())
    where business_id = p_business_id
      and provider = v_provider.provider_key
      and resource_type = 'browser_session'
      and external_id = v_session.provider_session_id;

    update public.browser_provider_definitions
    set
      status = 'qualified',
      evaluation = evaluation || jsonb_build_object(
        'liveQualified', true,
        'qualifiedAt', now(),
        'qualifiedWorkflowRunId', v_run.id,
        'capabilitiesProven', jsonb_build_array(
          'remoteChromium',
          'persistentProfiles',
          'liveEmbed',
          'humanTakeover',
          'returnControl',
          'replay',
          'playwrightCdp',
          'fileUpload',
          'isolatedSessions'
        )
      )
    where id = v_provider.id;

    update public.workflow_definitions
    set status = 'qualified'
    where id = v_run.workflow_definition_id;

    perform private.stage8_upsert_stage(
      p_business_id, v_run.id, 'replay', 'completed', '{}'::jsonb,
      jsonb_build_object('replayReady', coalesce((p_payload ->> 'replayReady')::boolean, true))
    );
    perform private.stage8_upsert_stage(
      p_business_id, v_run.id, 'complete', 'completed', '{}'::jsonb,
      jsonb_build_object('browserSessionId', v_session.id, 'providerKey', v_provider.provider_key)
    );

    update public.workflow_runs
    set
      status = 'completed',
      current_stage_key = 'complete',
      completed_at = now(),
      state = state || jsonb_build_object(
        'browserSessionId', v_session.id,
        'providerKey', v_provider.provider_key,
        'replayReady', coalesce((p_payload ->> 'replayReady')::boolean, true)
      )
    where id = v_run.id;

    perform private.stage8_record_browser_event(
      p_business_id, v_run.id, v_session.id,
      'browser.session.released', 'released',
      jsonb_build_object('replayReady', coalesce((p_payload ->> 'replayReady')::boolean, true)),
      'provider'
    );
    perform private.stage8_record_browser_event(
      p_business_id, v_run.id, v_session.id,
      'browser.workflow.completed', 'released',
      jsonb_build_object('providerKey', v_provider.provider_key)
    );

  elsif p_operation = 'session_failed' then
    update public.browser_sessions
    set
      status = 'failed',
      live_view_status = 'unavailable',
      failure = v_failure,
      released_at = coalesce(released_at, now())
    where id = v_session.id;

    update public.workflow_runs
    set
      status = 'failed',
      completed_at = now(),
      state = state || jsonb_build_object('browserFailure', v_failure)
    where id = v_run.id;

    perform private.stage8_upsert_stage(
      p_business_id,
      v_run.id,
      coalesce(nullif(p_payload ->> 'stageKey', ''), v_run.current_stage_key, 'launch'),
      'failed',
      '{}'::jsonb,
      '{}'::jsonb,
      v_failure
    );
    perform private.stage8_record_browser_event(
      p_business_id, v_run.id, v_session.id,
      'browser.session.failed', v_session.control_mode,
      jsonb_build_object('failure', v_failure),
      'provider'
    );
  else
    raise exception 'Unsupported browser runtime operation: %', p_operation using errcode = '22023';
  end if;

  return jsonb_build_object(
    'workflowRunId', v_run.id,
    'browserSessionId', v_session.id,
    'operation', p_operation,
    'providerKey', v_provider.provider_key
  );
end;
$$;

revoke all on function public.stage8_browser_runtime_transition(uuid, uuid, text, text, jsonb)
  from public, authenticated, service_role;
grant execute on function public.stage8_browser_runtime_transition(uuid, uuid, text, text, jsonb)
  to anon;

comment on function public.begin_browser_qualification_run(uuid, text, uuid, text) is
  'Reserves an idempotent Stage 8 workflow, isolated browser identity and provider-neutral browser session for the authenticated Business owner.';
comment on function public.stage8_browser_runtime_transition(uuid, uuid, text, text, jsonb) is
  'Capability-gated durable browser lifecycle, takeover, return-control, replay and qualification transition.';
