-- R12 shared funding and current-scope checks. No grants are seeded. Transport
-- remains explicitly closed until its reviewed exact-wire/source binding exists.
begin;
create function private.r12_discovery_scope_current(p private.r07_plans) returns private.r12_discovery_scopes language plpgsql set search_path='' as $$
declare s private.r12_discovery_scopes; prior public.product_experiments; begin
 perform 1 from public.businesses where id=p.business_id and owner_user_id=p.owner_id for update;
 if not found then raise exception 'r12_owner_changed';end if;
 select * into s from private.r12_discovery_scopes where id=(p.content->>'discoveryScopeId')::uuid and business_id=p.business_id and goal_id=p.goal_id and amendment_hash=p.content->>'discoveryScopeHash';
 if p.content->>'format' is distinct from 'r12.discovery.1' or s.id is null then raise exception 'r12_scope_binding_required';end if;
 perform 1 from public.product_experiments where id=s.budget_authority_root_id and business_id=p.business_id for update;
 select * into strict prior from public.product_experiments where id=s.prior_round_id and business_id=p.business_id;
 if prior.status not in ('failed','completed') or (s.amendment->>'expiresAt')::timestamptz<=clock_timestamp() or exists(select 1 from public.product_experiments newer where newer.business_id=p.business_id and newer.discovery_version='pod-discovery-2.0' and newer.parent_discovery_id is null and newer.candidate_id is null and newer.variables->>'budgetAuthorityRootId'=s.budget_authority_root_id::text and (newer.created_at,newer.id)>(prior.created_at,prior.id)) then raise exception 'r12_scope_no_longer_current';end if;
 if not exists(select 1 from private.r04_goal_versions gv join private.r04_goal_state gs using(goal_id,business_id,revision) where gv.goal_id=p.goal_id and gv.business_id=p.business_id and gv.preference='ready' and gv.revision=(p.content->>'goalRevision')::integer and gv.content_hash=p.content->>'goalHash' and gv.content->>'objective'=prior.variables->'intent'->>'objective' and (select jsonb_agg(x order by x) from jsonb_array_elements_text(gv.content->'parsed'->'geography') x)=(select jsonb_agg(x->>'countryCode' order by x->>'countryCode') from jsonb_array_elements(prior.variables->'intent'->'comparisonUniverse'->'markets') x)) then raise exception 'r12_original_goal_changed';end if;
 return s;
end $$;
revoke all on function private.r12_discovery_scope_current(private.r07_plans) from public,anon,authenticated,service_role;

-- Exactly mapped R05 liabilities are part of the preserved research allowance.
-- New calls never get a second legacy reservation or a second financial identity.
create function private.r12_discovery_exposure(root_id uuid) returns table(request_id uuid,business_id uuid,held bigint,actual bigint,is_pending boolean) language sql stable set search_path='' as $$
 select r.id,r.business_id,coalesce(settled.actual,r.liability_microunits),settled.actual,settled.actual is null
 from private.r12_discovery_scopes scope
 join private.r07_plans p on p.business_id=scope.business_id and p.goal_id=scope.goal_id and p.content->>'format'='r12.discovery.1' and p.content->>'discoveryScopeId'=scope.id::text and p.content->>'discoveryScopeHash'=scope.amendment_hash
 join private.r07_attempts a on a.plan_id=p.id and a.business_id=p.business_id
 join private.r05_requests r on r.workflow_run_id=a.id and r.business_id=a.business_id and r.policy_id=p.policy_id and r.payload->>'operationKey'='research.r12.'||scope.id::text||'.'||a.step_key and r.payload->'accounting'='{"kind":"r05"}'::jsonb
 join private.r05_reservations reserved on reserved.request_id=r.id and reserved.business_id=r.business_id
 left join lateral(select max(actual_microunits) actual from private.r05_settlements where request_id=r.id and business_id=r.business_id and provider_request_id is not null) settled on true
 where scope.budget_authority_root_id=root_id and not exists(select 1 from private.r05_releases released where released.request_id=r.id)
$$;
revoke all on function private.r12_discovery_exposure(uuid) from public,anon,authenticated,service_role;

-- Fail on definition drift instead of replacing historical accounting. Function
-- identity, ACL, original lineage/funding checks and legacy accounting stay intact.
do $migration$
declare definition text; old text; replacement text; begin
 definition:=pg_get_functiondef('private.stage13v2_budget_authority(uuid,boolean)'::regprocedure);
 old:=$old$  return jsonb_build_object('authorityRootId',authority.id,'businessId',root.business_id,'chainRootIds',to_jsonb(chain_ids),$old$;
 replacement:=$new$  select known+coalesce(sum(e.actual),0),pending+coalesce(sum(e.held) filter(where e.is_pending),0),uncertain or coalesce(bool_or(e.is_pending),false)
    into known,pending,uncertain from private.r12_discovery_exposure(authority.id) e;
  return jsonb_build_object('authorityRootId',authority.id,'businessId',root.business_id,'chainRootIds',to_jsonb(chain_ids),$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_budget_definition_drift';end if;
 execute replace(definition,old,replacement);
end $migration$;

create function private.r12_discovery_financial_guard() returns trigger language plpgsql set search_path='' as $$
declare r private.r05_requests; a private.r07_attempts; p private.r07_plans; scope private.r12_discovery_scopes; budget jsonb; own_held bigint:=0; mapped_pending bigint:=0; begin
 select * into strict r from private.r05_requests where id=new.request_id and business_id=new.business_id;
 if r.payload->>'operationKey' not like 'research.r12.%' then return new;end if;
 select * into a from private.r07_attempts where id=r.workflow_run_id and business_id=r.business_id;
 select * into p from private.r07_plans where id=a.plan_id and business_id=a.business_id;
 if a.id is null or p.id is null or r.policy_id is distinct from p.policy_id or r.payload->'accounting' is distinct from '{"kind":"r05"}'::jsonb or r.payload->>'idempotencyKey' is distinct from 'r07:'||a.id or r.payload->>'operationKey' is distinct from 'research.r12.'||(p.content->>'discoveryScopeId')||'.'||a.step_key then raise exception 'r12_exact_controller_request_required';end if;
 scope:=private.r12_discovery_scope_current(p);
 budget:=private.stage13v2_budget_authority(scope.prior_round_id,true);
 select coalesce(sum(e.held) filter(where e.request_id=r.id),0),coalesce(sum(e.held) filter(where e.is_pending),0) into own_held,mapped_pending from private.r12_discovery_exposure(scope.budget_authority_root_id) e;
 if (budget->>'pendingExposureMicrousd')::bigint>mapped_pending or exists(select 1 from private.r12_discovery_exposure(scope.budget_authority_root_id) e where e.is_pending and e.request_id<>r.id) then raise exception 'r12_original_funding_uncertain';end if;
 if (budget->>'committedMicrousd')::bigint-own_held+r.liability_microunits>(budget->>'maximumMicrousd')::bigint then raise exception 'r12_original_funding_exceeded';end if;
 -- Reservation and sent marker both recheck after the shared-root lock. The
 -- marker is still deliberately unavailable without the next exact-wire bridge.
 if tg_table_name='r05_markers' then raise exception 'r12_source_dispatch_bridge_unavailable';end if;
 return new;
end $$;
revoke all on function private.r12_discovery_financial_guard() from public,anon,authenticated,service_role;
create trigger r12_discovery_financial_guard before insert on private.r05_reservations for each row execute function private.r12_discovery_financial_guard();
create trigger r12_discovery_financial_guard before insert on private.r05_markers for each row execute function private.r12_discovery_financial_guard();

-- A queued attempt must not even schedule from a superseded or changed scope.
do $migration$
declare definition text; old text; replacement text; begin
 definition:=pg_get_functiondef('private.r07_gate(private.r07_plans,jsonb)'::regprocedure);
 old:=$old$ select * into pol from private.r05_policies where id=p.policy_id;$old$;
 replacement:=$new$ if p.content->>'format'='r12.discovery.1' then
 begin perform private.r12_discovery_scope_current(p);exception when others then return 'discovery_scope_unavailable';end;
 end if;
 select * into pol from private.r05_policies where id=p.policy_id;$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_gate_definition_drift';end if;
 execute replace(definition,old,replacement);
end $migration$;
commit;
