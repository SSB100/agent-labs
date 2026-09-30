
create or replace function private.stage9_promote_planner_if_qualified()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_required integer;
  v_passed integer;
  v_fingerprint text;
begin
  select count(*),count(*) filter(where status='passed')
  into v_required,v_passed
  from public.browser_planner_qualification_cases
  where planner_definition_id='00000000-0000-4000-8000-000000000901'::uuid;

  if v_required <> 4 or v_passed <> v_required then
    return;
  end if;

  update public.worker_definitions
  set status='qualified'
  where id='00000000-0000-4000-8000-000000000904'::uuid
    and status <> 'qualified';

  update public.packs
  set status='qualified'
  where id='00000000-0000-4000-8000-000000000903'::uuid
    and status <> 'qualified';

  v_fingerprint := private.stage9_browser_planner_fingerprint();

  update public.browser_planner_definitions
  set qualification=qualification||jsonb_build_object(
      'subjectFingerprint',v_fingerprint,
      'qualifiedAt',now(),
      'allRequiredCasesPassed',true,
      'requiredCaseCount',v_required,
      'passedCaseCount',v_passed
    )
  where id='00000000-0000-4000-8000-000000000901'::uuid;
end;
$$;

revoke all on function private.stage9_promote_planner_if_qualified()
  from public,anon,authenticated,service_role;

create or replace function private.stage9_promote_after_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.stage9_promote_planner_if_qualified();
  return new;
end;
$$;

revoke all on function private.stage9_promote_after_status_change()
  from public,anon,authenticated,service_role;

create or replace trigger stage9_promote_after_status_change
after update of status
on public.browser_planner_definitions
for each row
when (
  new.id='00000000-0000-4000-8000-000000000901'::uuid
  and new.status='qualified'
  and old.status is distinct from new.status
)
execute function private.stage9_promote_after_status_change();

comment on function private.stage9_promote_planner_if_qualified() is
  'Promotes Browser Planner Worker and Pack after all four cases pass and records a pinned subject fingerprint without recursively changing planner status.';
