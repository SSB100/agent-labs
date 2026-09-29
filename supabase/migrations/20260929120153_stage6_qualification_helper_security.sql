create or replace function public.worker_definition_is_currently_qualified(
  p_worker_definition_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  return private.stage6_worker_is_currently_qualified(p_worker_definition_id);
end;
$$;

revoke all on function public.worker_definition_is_currently_qualified(uuid)
  from public, anon, service_role;
grant execute on function public.worker_definition_is_currently_qualified(uuid)
  to authenticated;

comment on function public.worker_definition_is_currently_qualified(uuid) is
  'Returns whether a Worker has a current passed evaluation for its exact Worker Pack and model-route fingerprint.';
