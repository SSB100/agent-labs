alter table private.browser_session_secrets
  add column if not exists replay_url text;

create or replace function public.stage8_browser_runtime_access(
  p_workflow_run_id uuid,
  p_business_id uuid,
  p_runtime_capability text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_runtime_capability is null
    or char_length(p_runtime_capability) not between 32 and 512 then
    raise exception 'Browser runtime access request is invalid.' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'browserSessionId', session.id,
    'providerKey', provider.provider_key,
    'providerSessionId', session.provider_session_id,
    'providerProfileId', identity.provider_profile_id,
    'status', session.status,
    'controlMode', session.control_mode,
    'websocketUrl', secret.websocket_url,
    'debugUrl', secret.debug_url,
    'sessionViewerUrl', secret.session_viewer_url,
    'replayUrl', secret.replay_url,
    'startedAt', session.started_at,
    'releasedAt', session.released_at
  )
  into v_result
  from public.workflow_runs run
  join public.browser_sessions session
    on session.workflow_run_id = run.id
   and session.business_id = run.business_id
  join public.browser_provider_definitions provider
    on provider.id = session.provider_definition_id
  join public.browser_identities identity
    on identity.id = session.browser_identity_id
   and identity.business_id = session.business_id
  left join private.browser_session_secrets secret
    on secret.browser_session_id = session.id
  where run.id = p_workflow_run_id
    and run.business_id = p_business_id
    and run.workflow_definition_id = '00000000-0000-4000-8000-000000000801'::uuid
    and run.runtime_capability_hash = encode(
      extensions.digest(convert_to(p_runtime_capability, 'UTF8'), 'sha256'),
      'hex'
    );

  if v_result is null then
    raise exception 'Browser runtime capability denied.' using errcode = '42501';
  end if;

  return v_result;
end;
$$;

revoke all on function public.stage8_browser_runtime_access(uuid, uuid, text)
  from public, authenticated, service_role;
grant execute on function public.stage8_browser_runtime_access(uuid, uuid, text)
  to anon;

create or replace function public.stage8_browser_store_replay(
  p_workflow_run_id uuid,
  p_business_id uuid,
  p_runtime_capability text,
  p_replay_url text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
begin
  if p_runtime_capability is null
    or char_length(p_runtime_capability) not between 32 and 512
    or p_status not in ('ready', 'pending', 'unavailable') then
    raise exception 'Browser replay update is invalid.' using errcode = '22023';
  end if;

  select session.id
  into v_session_id
  from public.workflow_runs run
  join public.browser_sessions session
    on session.workflow_run_id = run.id
   and session.business_id = run.business_id
  where run.id = p_workflow_run_id
    and run.business_id = p_business_id
    and run.workflow_definition_id = '00000000-0000-4000-8000-000000000801'::uuid
    and run.runtime_capability_hash = encode(
      extensions.digest(convert_to(p_runtime_capability, 'UTF8'), 'sha256'),
      'hex'
    )
  for update of session;

  if v_session_id is null then
    raise exception 'Browser runtime capability denied.' using errcode = '42501';
  end if;

  insert into private.browser_session_secrets (
    browser_session_id,
    replay_url
  )
  values (
    v_session_id,
    nullif(btrim(p_replay_url), '')
  )
  on conflict (browser_session_id) do update
  set
    replay_url = excluded.replay_url,
    updated_at = now();

  update public.browser_sessions
  set
    replay_status = p_status,
    metadata = metadata || jsonb_build_object(
      'replayRecordedAt', now(),
      'replayAvailable', p_status = 'ready' and nullif(btrim(p_replay_url), '') is not null
    )
  where id = v_session_id;

  return jsonb_build_object(
    'browserSessionId', v_session_id,
    'replayStatus', p_status,
    'replayAvailable', p_status = 'ready' and nullif(btrim(p_replay_url), '') is not null
  );
end;
$$;

revoke all on function public.stage8_browser_store_replay(uuid, uuid, text, text, text)
  from public, authenticated, service_role;
grant execute on function public.stage8_browser_store_replay(uuid, uuid, text, text, text)
  to anon;

create or replace function public.get_browser_session_live_view(
  p_browser_session_id uuid,
  p_interactive boolean default false
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_debug_url text;
  v_control_mode text;
  v_interactive boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select secret.debug_url, session.control_mode
  into v_debug_url, v_control_mode
  from public.browser_sessions session
  join private.browser_session_secrets secret
    on secret.browser_session_id = session.id
  where session.id = p_browser_session_id
    and private.is_business_owner(session.business_id)
    and session.status in ('live', 'human_control', 'returning');

  if v_debug_url is null then
    return null;
  end if;

  v_interactive := p_interactive and v_control_mode = 'human';

  return v_debug_url
    || case when position('?' in v_debug_url) > 0 then '&' else '?' end
    || 'interactive=' || case when v_interactive then 'true' else 'false' end
    || '&showControls=true';
end;
$$;

revoke all on function public.get_browser_session_live_view(uuid, boolean)
  from public, anon, service_role;
grant execute on function public.get_browser_session_live_view(uuid, boolean)
  to authenticated;

create or replace function public.get_browser_session_replay(
  p_browser_session_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_replay_url text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select secret.replay_url
  into v_replay_url
  from public.browser_sessions session
  join private.browser_session_secrets secret
    on secret.browser_session_id = session.id
  where session.id = p_browser_session_id
    and private.is_business_owner(session.business_id)
    and session.replay_status = 'ready';

  return v_replay_url;
end;
$$;

revoke all on function public.get_browser_session_replay(uuid)
  from public, anon, service_role;
grant execute on function public.get_browser_session_replay(uuid)
  to authenticated;

comment on function public.stage8_browser_runtime_access(uuid, uuid, text) is
  'Returns one capability-gated browser runtime secret bundle to the durable workflow client.';
comment on function public.stage8_browser_store_replay(uuid, uuid, text, text, text) is
  'Stores capability-gated browser replay evidence without exposing provider URLs in public tables.';
comment on function public.get_browser_session_live_view(uuid, boolean) is
  'Returns an owner-authorized browser viewer URL and permits interactivity only while control mode is human.';
comment on function public.get_browser_session_replay(uuid) is
  'Returns an owner-authorized browser replay URL after the provider session has been released.';
