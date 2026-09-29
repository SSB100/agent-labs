create or replace function private.stage8_normalize_browser_intervention_options()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.intervention_type in ('browser_takeover', 'browser_return_control')
    and jsonb_typeof(new.options) = 'object' then
    new.options := jsonb_build_array(new.options);
  end if;

  return new;
end;
$$;

revoke all on function private.stage8_normalize_browser_intervention_options()
  from public, anon, authenticated, service_role;

drop trigger if exists stage8_normalize_browser_intervention_options
  on public.owner_interventions;
create trigger stage8_normalize_browser_intervention_options
before insert or update of options, intervention_type
on public.owner_interventions
for each row
execute function private.stage8_normalize_browser_intervention_options();

revoke execute on function public.begin_browser_qualification_run(uuid, text, uuid, text)
  from service_role;

comment on function private.stage8_normalize_browser_intervention_options() is
  'Preserves the universal OwnerIntervention options-array contract for Stage 8 takeover and return-control requests.';
