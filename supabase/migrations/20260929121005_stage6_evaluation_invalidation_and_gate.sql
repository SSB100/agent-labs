create or replace function private.stage6_refresh_stale_evaluations()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worker record;
begin
  update public.worker_evaluations evaluation
  set
    status = 'stale',
    completed_at = coalesce(completed_at, now()),
    evidence = evidence || jsonb_build_object(
      'staleReason', 'Worker Pack or model route fingerprint changed.',
      'staleAt', now()
    )
  where evaluation.status = 'passed'
    and evaluation.subject_fingerprint is distinct from
      private.stage6_worker_fingerprint(evaluation.worker_definition_id);

  for v_worker in
    select worker.id, worker.pack_id, worker.status
    from public.worker_definitions worker
    where worker.status in ('qualified', 'assisted', 'autonomous')
      and exists (
        select 1
        from public.worker_evaluation_suites suite
        where suite.worker_definition_id = worker.id
          and suite.status = 'active'
      )
      and not private.stage6_worker_is_currently_qualified(worker.id)
    for update
  loop
    update public.worker_definitions
    set status = 'experimental'
    where id = v_worker.id;

    update public.packs
    set status = 'experimental'
    where id = v_worker.pack_id;

    insert into public.worker_promotions (
      worker_definition_id,
      evaluation_id,
      from_status,
      to_status,
      reason,
      evidence
    )
    values (
      v_worker.id,
      null,
      v_worker.status,
      'experimental',
      'A Worker Pack, route, model or model qualification changed and requires reevaluation.',
      jsonb_build_object('invalidatedAt', now())
    );
  end loop;
end;
$$;

revoke all on function private.stage6_refresh_stale_evaluations()
  from public, anon, authenticated, service_role;

create or replace function private.stage6_invalidate_evaluations_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.stage6_refresh_stale_evaluations();
  return null;
end;
$$;

revoke all on function private.stage6_invalidate_evaluations_trigger()
  from public, anon, authenticated, service_role;

drop trigger if exists stage6_worker_definition_changed
  on public.worker_definitions;
create trigger stage6_worker_definition_changed
  after update of worker_key, version, role, charter, input_schema,
    output_schema, knowledge_requirements, capability_requirements,
    model_requirements
  on public.worker_definitions
  for each statement
  execute function private.stage6_invalidate_evaluations_trigger();

drop trigger if exists stage6_worker_pack_changed
  on public.packs;
create trigger stage6_worker_pack_changed
  after update of pack_key, version, manifest
  on public.packs
  for each statement
  execute function private.stage6_invalidate_evaluations_trigger();

drop trigger if exists stage6_model_definition_changed
  on public.model_definitions;
create trigger stage6_model_definition_changed
  after update of model_key, provider, provider_family, provider_model_id,
    tier, status, context_window_tokens, max_output_tokens, capabilities,
    input_price_per_million_usd, output_price_per_million_usd,
    cache_read_price_per_million_usd, metadata
  on public.model_definitions
  for each statement
  execute function private.stage6_invalidate_evaluations_trigger();

drop trigger if exists stage6_model_route_changed
  on public.model_routes;
create trigger stage6_model_route_changed
  after update of route_key, status, requirements,
    primary_model_definition_id, fallback_model_definition_id,
    maximum_attempts, metadata
  on public.model_routes
  for each statement
  execute function private.stage6_invalidate_evaluations_trigger();

drop trigger if exists stage6_model_qualification_changed
  on public.model_qualifications;
create trigger stage6_model_qualification_changed
  after insert or update or delete
  on public.model_qualifications
  for each statement
  execute function private.stage6_invalidate_evaluations_trigger();

create or replace function private.stage6_enforce_worker_qualification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.worker_evaluation_suites suite
    where suite.worker_definition_id = new.worker_definition_id
      and suite.status = 'active'
  ) and not private.stage6_worker_is_currently_qualified(
    new.worker_definition_id
  ) then
    raise exception 'Worker is not currently qualified for this Worker Pack and model route.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.stage6_enforce_worker_qualification()
  from public, anon, authenticated, service_role;

drop trigger if exists stage6_task_contract_requires_qualified_worker
  on public.task_contracts;
create trigger stage6_task_contract_requires_qualified_worker
  before insert or update of worker_definition_id
  on public.task_contracts
  for each row
  execute function private.stage6_enforce_worker_qualification();

comment on function private.stage6_refresh_stale_evaluations() is
  'Invalidates passed Worker evaluations and conservatively demotes workers when a relevant Pack, route, model or model qualification changes.';
comment on function private.stage6_enforce_worker_qualification() is
  'Prevents evaluated workers from receiving new Task Contracts without a current passed evaluation fingerprint.';
