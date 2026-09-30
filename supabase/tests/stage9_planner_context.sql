-- Run as the database administrator. All fixture changes roll back.
begin;
select set_config('request.jwt.claim.sub',
  (select owner_user_id::text from public.businesses
   where name = 'Stage 9 Live Qualification' limit 1), true);

do $$
declare
  v_business_id uuid;
  v_run record;
  v_step record;
  v_context jsonb;
  v_capability text := repeat('context-regression-', 3);
  v_denied boolean := false;
begin
  select id into strict v_business_id from public.businesses
  where owner_user_id = auth.uid() and name = 'Stage 9 Live Qualification';
  select * into strict v_run
  from public.begin_browser_planner_qualification_run(
    v_business_id, 'stage9:context-regression', gen_random_uuid(), v_capability);
  select * into strict v_step
  from public.stage9_prepare_planner_step(
    v_business_id, v_run.workflow_run_id, v_run.browser_session_id, v_capability,
    'synthetic', 'synthetic.stable-element-action', 1, 'Continue once then stop.',
    array['browser.observe','browser.interact'],
    '{"url":"about:blank","title":"Synthetic","visibleText":"Continued","forms":[],"controls":[],"links":[],"observedAt":"2026-09-30T00:00:00Z"}'::jsonb,
    null, true, array['Never repeat Continue','Never publish']);
  v_context := public.stage9_get_planner_step_context(
    v_business_id, v_run.workflow_run_id, v_run.browser_session_id, v_capability,
    v_step.task_contract_id, v_step.observation_artifact_id, v_step.worker_run_id);
  assert v_context #> '{taskContract,completionCriteria,objectiveVerified}' = 'true'::jsonb,
    'Current verifier result must survive the durable context round trip';
  assert v_context #> '{taskContract,nonGoals}' = '["Never repeat Continue","Never publish"]'::jsonb,
    'Case-specific scope must survive the durable context round trip';
  assert v_context #> '{taskContract,escalationRules,previousFailure}' = 'null'::jsonb,
    'Resolved failures must be absent';
  begin
    perform public.stage9_get_planner_step_context(
      v_business_id, v_run.workflow_run_id, v_run.browser_session_id,
      repeat('wrong-capability-', 3), v_step.task_contract_id,
      v_step.observation_artifact_id, v_step.worker_run_id);
  exception when insufficient_privilege then
    v_denied := true;
  end;
  assert v_denied, 'An incorrect runtime capability must be denied';
end;
$$;
rollback;
