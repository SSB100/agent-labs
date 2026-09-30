-- Run as the database administrator. All fixture changes roll back.
begin;

select set_config('request.jwt.claim.sub',
  (select owner_user_id::text from public.businesses
   where name = 'Stage 9 Live Qualification' limit 1), true);
set local role authenticated;

do $$
declare
  v_business_id uuid;
  v_first record;
  v_duplicate record;
  v_denied boolean := false;
begin
  select id into strict v_business_id from public.businesses
  where owner_user_id = auth.uid() and name = 'Stage 9 Live Qualification';

  select * into strict v_first
  from public.begin_browser_planner_qualification_run(
    v_business_id, 'stage9:reservation-regression', gen_random_uuid(),
    repeat('reservation-regression-', 3));
  assert v_first.should_start, 'First reservation must start';

  select * into strict v_duplicate
  from public.begin_browser_planner_qualification_run(
    v_business_id, 'stage9:reservation-regression', gen_random_uuid(),
    repeat('duplicate-regression-', 3));
  assert not v_duplicate.should_start, 'Duplicate must not start';
  assert v_first.workflow_run_id = v_duplicate.workflow_run_id,
    'Duplicate must reuse the Workflow Run';
  assert v_first.browser_session_id = v_duplicate.browser_session_id,
    'Duplicate must reuse the Browser Session';
  assert (select count(*) from public.workflow_stage_runs
          where workflow_run_id = v_first.workflow_run_id) = 7,
    'Reservation must create all seven stages exactly once';

  begin
    perform public.begin_browser_planner_qualification_run(
      gen_random_uuid(), 'stage9:foreign-business-regression',
      gen_random_uuid(), repeat('foreign-regression-', 3));
  exception when insufficient_privilege then
    v_denied := true;
  end;
  assert v_denied, 'A Business outside the owner scope must be denied';
end;
$$;

rollback;
