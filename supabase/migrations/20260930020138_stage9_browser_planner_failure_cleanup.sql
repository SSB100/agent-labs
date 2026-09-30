-- A terminal workflow must not leave its current Task Contract or Worker Run active.
create or replace function private.stage9_close_failed_children()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.workflow_definition_id <> '00000000-0000-4000-8000-000000000902'::uuid
    or new.status <> 'failed' then
    return new;
  end if;

  update public.worker_runs
  set status='failed',
      failure=coalesce(new.state->'plannerFailure','{}'::jsonb),
      completed_at=coalesce(completed_at,now()),
      updated_at=now()
  where workflow_run_id=new.id and business_id=new.business_id
    and status in ('queued','running');

  update public.task_contracts
  set status='failed',updated_at=now()
  where workflow_run_id=new.id and business_id=new.business_id
    and status in ('queued','running');

  return new;
end;
$$;

revoke all on function private.stage9_close_failed_children()
  from public,anon,authenticated,service_role;

create trigger stage9_close_failed_children
after update of status on public.workflow_runs
for each row execute function private.stage9_close_failed_children();

-- Reconcile the live failure that exposed the orphaned child records.
update public.workflow_runs
set status=status
where workflow_definition_id='00000000-0000-4000-8000-000000000902'::uuid
  and status='failed';
