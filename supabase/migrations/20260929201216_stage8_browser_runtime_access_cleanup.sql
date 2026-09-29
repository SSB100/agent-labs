drop function if exists public.stage8_browser_runtime_access(uuid, uuid, text);
drop function if exists public.stage8_browser_store_replay(uuid, uuid, text, text, text);
drop function if exists public.get_browser_session_replay(uuid);

alter table private.browser_session_secrets
  drop column if exists replay_url;

comment on function public.get_browser_session_live_view(uuid, boolean) is
  'Returns an owner-authorized live browser view and enables interactivity only while the durable session control mode is human.';
