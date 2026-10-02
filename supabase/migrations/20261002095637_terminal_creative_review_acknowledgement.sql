-- Owner-approved, acknowledgement-only boundary for stopped Stage 14 notices.
-- Adds one authenticated RPC. Existing guards, table ACL/RLS and RPCs are unchanged.
-- One atomic statement installs the function and its ACL together. If CREATE or
-- either permission statement fails, no callable partial installation survives.
do $migration$
begin
  execute $definition$
create function public.acknowledge_terminal_creative_review(
  p_intervention_id uuid,
  p_expected_updated_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_business_id uuid;
  v_workflow_id uuid;
  v_owner uuid;
  v_creative public.creative_runs%rowtype;
  v_run public.workflow_runs%rowtype;
  v_notice public.owner_interventions%rowtype;
  v_event public.events%rowtype;
  v_event_id uuid;
  v_acknowledged_at timestamptz;
  v_resolution jsonb;
begin
  if v_actor is null or p_intervention_id is null or p_expected_updated_at is null then
    raise exception 'terminal_review_not_allowed' using errcode = '42501';
  end if;

  -- Derive the scope from saved rows, never from client-supplied Business/run IDs.
  select i.business_id, i.workflow_run_id into v_business_id, v_workflow_id
    from public.owner_interventions i where i.id = p_intervention_id;
  if v_business_id is null or v_workflow_id is null then
    raise exception 'terminal_review_not_allowed' using errcode = '42501';
  end if;
  -- Hold current ownership stable until the atomic acknowledgement commits.
  select b.owner_user_id into v_owner from public.businesses b
    where b.id = v_business_id for share;
  if v_owner is distinct from v_actor then
    raise exception 'terminal_review_not_allowed' using errcode = '42501';
  end if;

  -- Match the runtime lock order: creative run, workflow run, then its notice.
  select c.* into v_creative from public.creative_runs c
    where c.workflow_run_id = v_workflow_id and c.business_id = v_business_id for update;
  if v_creative.id is null then
    raise exception 'terminal_review_not_eligible' using errcode = 'P0001';
  end if;
  select w.* into v_run from public.workflow_runs w
    where w.id = v_creative.workflow_run_id and w.business_id = v_business_id for update;
  select i.* into v_notice from public.owner_interventions i
    where i.id = p_intervention_id for update;

  if v_notice.id is null or v_notice.business_id is distinct from v_business_id
    or v_notice.workflow_run_id is distinct from v_run.id or v_run.id is null
    or v_notice.intervention_type is distinct from 'creative_review'
    or v_notice.action_intent_id is not null
    or v_notice.id is distinct from private.stage4_deterministic_uuid('creative:needs-owner:' || v_creative.id)
    or not exists (select 1 from public.workflow_definitions d where d.id = v_run.workflow_definition_id
      and d.workflow_key = 'etsy.creative-pipeline' and d.version = '1.0.0')
    or v_run.input->>'creativeRunId' is distinct from v_creative.id::text
    or v_run.input->>'approvalId' is distinct from v_creative.approval_id::text
    or v_run.status is distinct from 'needs_owner' or v_run.completed_at is null
    or v_run.state->'productionReady' is distinct from 'false'::jsonb
    or v_run.state->'publicationAllowed' is distinct from 'false'::jsonb
    or not exists (select 1 from public.workflow_stage_runs s where s.workflow_run_id = v_run.id)
    or exists (select 1 from public.workflow_stage_runs s where s.workflow_run_id = v_run.id
      and (s.business_id <> v_business_id or s.status not in ('completed', 'failed', 'skipped') or s.completed_at is null))
    or exists (select 1 from public.worker_runs w where w.workflow_run_id = v_run.id
      and (w.business_id <> v_business_id or w.status not in ('completed', 'failed', 'cancelled') or w.completed_at is null))
    or exists (select 1 from public.task_contracts t where t.workflow_run_id = v_run.id
      and (t.business_id <> v_business_id or t.status not in ('completed', 'failed', 'cancelled')))
    or exists (select 1 from public.action_intents a where a.workflow_run_id = v_run.id
      and (a.business_id <> v_business_id or a.status not in ('completed', 'rejected', 'expired', 'failed'))) then
    raise exception 'terminal_review_not_eligible' using errcode = 'P0001';
  end if;

  v_event_id := private.stage4_deterministic_uuid('creative:terminal-review-acknowledged:' || v_notice.id);
  v_acknowledged_at := case when v_notice.status = 'resolved' then v_notice.resolved_at else clock_timestamp() end;
  v_resolution := jsonb_build_object(
    'version', 'terminal-creative-review-acknowledgement-v1', 'decision', 'acknowledge',
    'actorUserId', v_actor, 'businessId', v_business_id, 'workflowRunId', v_run.id,
    'creativeRunId', v_creative.id, 'interventionId', v_notice.id,
    -- Canonical UTC strings retain microseconds and make replay timezone-independent.
    'expectedUpdatedAt', to_char(p_expected_updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'acknowledgedAt', to_char(v_acknowledged_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'executionResumed', false, 'newSpendAuthorized', false, 'costsReconciled', false
  );
  if v_notice.status = 'resolved' then
    select e.* into v_event from public.events e where e.id = v_event_id;
    if v_notice.resolved_at is null or v_notice.resolution is distinct from v_resolution
      or v_event.id is null or v_event.business_id is distinct from v_business_id
      or v_event.workflow_run_id is distinct from v_run.id
      or v_event.event_type is distinct from 'owner_intervention.resolved'
      or v_event.actor_type is distinct from 'owner' or v_event.actor_id is distinct from v_actor::text
      or v_event.payload is distinct from v_resolution
      or v_event.occurred_at is distinct from v_notice.resolved_at then
      raise exception 'terminal_review_conflict' using errcode = 'P0001';
    end if;
    return jsonb_build_object('outcome', 'already_acknowledged', 'interventionId', v_notice.id,
      'businessId', v_business_id, 'workflowRunId', v_run.id);
  end if;
  if v_notice.status <> 'open' or v_notice.resolution <> '{}'::jsonb or v_notice.resolved_at is not null
    or v_notice.updated_at is distinct from p_expected_updated_at then
    raise exception 'terminal_review_conflict' using errcode = 'P0001';
  end if;

  -- Only this notice and one immutable event change. No workflow/provider operation.
  update public.owner_interventions set status = 'resolved', resolved_at = v_acknowledged_at,
    resolution = v_resolution where id = v_notice.id;
  insert into public.events(id, business_id, workflow_run_id, event_type, actor_type, actor_id, payload, occurred_at)
    values(v_event_id, v_business_id, v_run.id, 'owner_intervention.resolved', 'owner', v_actor::text,
      v_resolution, v_acknowledged_at);
  return jsonb_build_object('outcome', 'acknowledged', 'interventionId', v_notice.id,
    'businessId', v_business_id, 'workflowRunId', v_run.id);
end;
$$;
  $definition$;
  revoke all on function public.acknowledge_terminal_creative_review(uuid, timestamptz)
    from public, anon, authenticated, service_role;
  grant execute on function public.acknowledge_terminal_creative_review(uuid, timestamptz) to authenticated;
end;
$migration$;
