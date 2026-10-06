-- Explicit per-scope first-live qualification. No worker/workflow status is
-- promoted and no authority, key, operation, policy or installation is seeded.
begin;
alter table private.r07_adapters drop constraint r07_adapters_mode_check;
alter table private.r07_adapters add constraint r07_adapters_mode_check check(mode in ('simulation','production','qualification'));
create table private.r12_discovery_authorities(
 scope_id uuid primary key references private.r12_discovery_scopes(id),business_id uuid not null references public.businesses(id),goal_id uuid not null,
 controller_key_hash text not null references private.r07_server_keys(key_hash),admission_key_hash text not null references private.r05_server_keys(key_hash),
 plan jsonb not null,plan_hash text not null,mode text not null check(mode in ('simulation','qualification')),
 approval_hash text not null check(approval_hash ~ '^[a-f0-9]{64}$'),execution_review_hash text not null check(execution_review_hash ~ '^[a-f0-9]{64}$'),
 valid_until timestamptz not null,receipt_until timestamptz not null,created_at timestamptz not null default clock_timestamp(),
 foreign key(goal_id,business_id) references private.r04_goal_state(goal_id,business_id),
 check(plan_hash=private.r04_hash(plan) and octet_length(plan::text)<=32768 and receipt_until=valid_until+interval '30 minutes')
);
alter table private.r12_discovery_authorities enable row level security;
revoke all on private.r12_discovery_authorities from public,anon,authenticated,service_role;
create trigger r12_authority_history before insert or update or delete on private.r12_discovery_authorities for each row execute function private.r12_discovery_history_guard();

create function private.r12_plan_qualification(b uuid,g uuid,v jsonb) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from private.r12_discovery_authorities q join private.r12_discovery_scopes s on s.id=q.scope_id
 where q.business_id=b and q.goal_id=g and q.plan=v and q.plan_hash=private.r04_hash(v) and v->>'format'='r12.discovery.1' and v->>'discoveryScopeId'=s.id::text and v->>'discoveryScopeHash'=s.amendment_hash and q.valid_until>clock_timestamp())
$$;

create function private.r12_authority_validate() returns trigger language plpgsql set search_path='' as $$
declare s private.r12_discovery_scopes;step jsonb;adapter private.r07_adapters;wd public.worker_definitions;fd public.workflow_definitions;begin
 perform 1 from public.businesses where id=new.business_id for update;
 select * into s from private.r12_discovery_scopes where id=new.scope_id and business_id=new.business_id and goal_id=new.goal_id;
 if s.id is null or new.plan->>'format' is distinct from 'r12.discovery.1' or new.plan->>'discoveryScopeId' is distinct from s.id::text or new.plan->>'discoveryScopeHash' is distinct from s.amendment_hash or new.valid_until is distinct from (new.plan->>'expiresAt')::timestamptz or new.valid_until<=clock_timestamp() or new.valid_until>clock_timestamp()+interval '30 minutes' or new.valid_until>(s.amendment->>'expiresAt')::timestamptz then raise exception 'r12_bounded_authority_required';end if;
 if not exists(select 1 from private.r07_server_keys where key_hash=new.controller_key_hash and expires_at>=new.receipt_until and expires_at<=new.receipt_until+interval '5 seconds') or not exists(select 1 from private.r05_server_keys where key_hash=new.admission_key_hash and expires_at>=new.receipt_until and expires_at<=new.receipt_until+interval '5 seconds') then raise exception 'r12_exact_authority_window_required';end if;
 if exists(select 1 from private.r07_server_revocations where key_hash=new.controller_key_hash) or exists(select 1 from private.r05_server_revocations where key_hash=new.admission_key_hash) then raise exception 'r12_authority_revoked';end if;
 for step in select value from jsonb_array_elements(new.plan->'steps') loop
 select * into adapter from private.r07_adapters where adapter_key=step->>'adapter' and qualification_hash=step->>'qualificationHash';
 select * into wd from public.worker_definitions where id=adapter.worker_definition_id;select * into fd from public.workflow_definitions where id=adapter.workflow_definition_id;
 if adapter.adapter_key is null or adapter.mode<>new.mode or adapter.operation_key is distinct from 'research.r12.'||s.id||'.'||(step->>'key') or private.r04_hash(to_jsonb(wd)) is distinct from adapter.worker_hash or private.r04_hash(to_jsonb(fd)) is distinct from adapter.workflow_hash then raise exception 'r12_exact_definition_qualification_required';end if;
 if new.mode='qualification' and (wd.worker_key is distinct from 'product.discovery-v2.'||(case when step->>'key' in ('search1','select1') then 'research' else step->>'key' end) or wd.version<>'1.0.0' or fd.version<>'1.0.0' or fd.workflow_key<>'product.discovery-v2.one' or wd.status not in ('experimental','qualified','assisted','autonomous') or fd.status not in ('experimental','qualified','assisted','autonomous')) then raise exception 'r12_existing_discovery_definition_required';end if;
 end loop;
 -- AFTER INSERT makes this exact scope row visible to the narrow experimental
 -- planner exception. Any invalid plan rolls the entire registration back.
 perform private.r07_validate_plan(new.business_id,new.goal_id,new.plan);return new;
end $$;
create trigger r12_authority_validate after insert on private.r12_discovery_authorities for each row execute function private.r12_authority_validate();

create function private.r12_controller_keys(b uuid,g uuid,v jsonb,controller_hash text,admission_hash text) returns void language plpgsql set search_path='' as $$
begin
 if v->>'format' is distinct from 'r12.discovery.1' then return;end if;
 if not exists(select 1 from private.r12_discovery_authorities q where q.business_id=b and q.goal_id=g and q.plan=v and q.controller_key_hash=controller_hash and q.admission_key_hash=admission_hash and q.receipt_until>clock_timestamp()) then raise exception 'r12_exact_scoped_controller_authority_required';end if;
end $$;

-- Only an exact approved R12 plan may use its pinned experimental definitions
-- for this first-live qualification. Generic R07 and other scopes stay closed.
do $migration$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r07_validate_plan(uuid,uuid,jsonb)'::regprocedure);
 old:=$old$status in ('qualified','assisted','autonomous')) then raise exception 'r07_planner_unqualified';$old$;
 replacement:=$new$(status in ('qualified','assisted','autonomous') or status='experimental' and worker_key='product.discovery-v2.plan' and version='1.0.0' and private.r12_plan_qualification(b,g,p))) then raise exception 'r07_planner_unqualified';$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_planner_gate_drift';end if;execute replace(definition,old,replacement);
 definition:=pg_get_functiondef('private.r07_gate(private.r07_plans,jsonb)'::regprocedure);
 old:=$old$ select * into pol from private.r05_policies where id=p.policy_id;$old$;
 replacement:=$new$ if p.content->>'format'='r12.discovery.1' and not private.r12_plan_qualification(p.business_id,p.goal_id,p.content) then return 'discovery_authority_unavailable';end if;
 select * into pol from private.r05_policies where id=p.policy_id;$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_gate_drift';end if;definition:=replace(definition,old,replacement);
 old:=$old$status in ('qualified','assisted','autonomous') and private.r04_hash(to_jsonb(wd))=a.worker_hash$old$;
 replacement:=$new$(status in ('qualified','assisted','autonomous') or status='experimental' and a.mode='qualification' and private.r12_plan_qualification(p.business_id,p.goal_id,p.content)) and private.r04_hash(to_jsonb(wd))=a.worker_hash$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_worker_gate_drift';end if;definition:=replace(definition,old,replacement);
 old:=$old$status in ('qualified','assisted','autonomous') and private.r04_hash(to_jsonb(fd))=a.workflow_hash$old$;
 replacement:=$new$(status in ('qualified','assisted','autonomous') or status='experimental' and a.mode='qualification' and private.r12_plan_qualification(p.business_id,p.goal_id,p.content)) and private.r04_hash(to_jsonb(fd))=a.workflow_hash$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_workflow_gate_drift';end if;definition:=replace(definition,old,replacement);
 definition:=replace(definition,$old$ if a.adapter_key is null$old$,$new$ if (a.mode='qualification' and p.content->>'format'<>'r12.discovery.1') or a.adapter_key is null$new$);execute definition;
 definition:=pg_get_functiondef('public.r07_controller(uuid,uuid,text,jsonb,uuid,text,text,bigint,text)'::regprocedure);
 old:=$old$ if p_operation='read' then return private.r07_snapshot(p_business_id,p_goal_id,h.plan_id); end if;$old$;
 replacement:=$new$ perform private.r12_controller_keys(p_business_id,p_goal_id,case when p_operation='plan' then p_payload->'plan' else p.content end,encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex'),encode(extensions.digest(convert_to(p_admission_key,'UTF8'),'sha256'),'hex'));
 if p_operation='read' then return private.r07_snapshot(p_business_id,p_goal_id,h.plan_id); end if;$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_controller_entry_drift';end if;execute replace(definition,old,replacement);
 definition:=pg_get_functiondef('public.r12_discovery_server(uuid,uuid,text,jsonb,text)'::regprocedure);
 old:=' if p_operation=''inputs'' then';
 replacement:=$new$ if not exists(select 1 from private.r12_discovery_authorities scoped_auth where scoped_auth.business_id=p_business_id and scoped_auth.goal_id=p.goal_id and scoped_auth.plan=p.content and scoped_auth.controller_key_hash=key_hash and scoped_auth.receipt_until>clock_timestamp()) then raise exception 'r12_exact_scoped_controller_authority_required';end if;
 if p_operation='inputs' then$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_server_authority_drift';end if;execute replace(definition,old,replacement);
end $migration$;

do $$ declare fn regprocedure;begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('r12_plan_qualification','r12_authority_validate','r12_controller_keys') loop execute format('revoke all on function %s from public,anon,authenticated,service_role',fn);end loop;
end $$;
-- Owner metadata is distinct from the trusted runtime load: no wire, prompt,
-- private candidate body, capability or credential is returned during rendering.
create function public.r12_discovery_owner_read(p_business_id uuid,p_scope_id uuid,p_activation boolean default false) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare source_scope private.r12_discovery_scopes;authority private.r12_discovery_authorities;saved_plan private.r07_plans;head private.r07_heads;
 step jsonb;attempt private.r07_attempts;binding private.r07_bindings;request private.r05_requests;candidate private.r12_discovery_candidates;response private.r07_responses;
 phases jsonb:='[]';receipt jsonb;actual bigint;held bigint;marked boolean;reserved boolean;known_total bigint:=0;held_total bigint:=0;unknown_cost boolean:=false;active boolean;stopped boolean;policy_revoked boolean;paused boolean;budget jsonb;begin
 if private.is_business_owner(p_business_id) is distinct from true then raise exception 'r12_owner_required' using errcode='42501';end if;
 select * into source_scope from private.r12_discovery_scopes where id=p_scope_id and business_id=p_business_id;if source_scope.id is null then return null;end if;
 select * into authority from private.r12_discovery_authorities where scope_id=source_scope.id;
 select * into saved_plan from private.r07_plans where business_id=p_business_id and goal_id=source_scope.goal_id and content->>'discoveryScopeId'=source_scope.id::text order by version desc limit 1;
 select * into head from private.r07_heads where plan_id=saved_plan.id;
 stopped:=authority.scope_id is null or exists(select 1 from private.r05_revocations where policy_id=(authority.plan->>'policyId')::uuid) or private.r05_paused(p_business_id,'business',p_business_id) or private.r05_paused(p_business_id,'quest',source_scope.goal_id)
 or not exists(select 1 from private.r04_goal_state gs join private.r04_goal_versions gv using(goal_id,business_id,revision) where gs.goal_id=source_scope.goal_id and gs.business_id=p_business_id and gs.revision=(authority.plan->>'goalRevision')::integer and gv.preference='ready')
 or not exists(select 1 from private.r04_business_state bs join private.r04_business_versions bv using(business_id,revision) where bs.business_id=p_business_id and bs.revision=(authority.plan->>'businessRevision')::integer and bv.preference='setup');
 policy_revoked:=exists(select 1 from private.r05_revocations where policy_id=(authority.plan->>'policyId')::uuid);
 paused:=private.r05_paused(p_business_id,'business',p_business_id) or private.r05_paused(p_business_id,'quest',source_scope.goal_id) or exists(select 1 from jsonb_array_elements(authority.plan->'steps') st where private.r05_paused(p_business_id,'pack',(st->>'installationId')::uuid));
 active:=not stopped and not paused and authority.valid_until>clock_timestamp() and exists(select 1 from private.r07_server_keys k where k.key_hash=authority.controller_key_hash and k.expires_at>clock_timestamp() and not exists(select 1 from private.r07_server_revocations rev where rev.key_hash=k.key_hash)) and exists(select 1 from private.r05_server_keys k where k.key_hash=authority.admission_key_hash and k.expires_at>clock_timestamp() and not exists(select 1 from private.r05_server_revocations rev where rev.key_hash=k.key_hash));
 if authority.scope_id is not null then
 for step in select value from jsonb_array_elements(authority.plan->'steps') loop
 select * into attempt from private.r07_attempts where plan_id=saved_plan.id and business_id=p_business_id and step_key=step->>'key' order by private.r07_attempts.attempt desc limit 1;
 select * into binding from private.r07_bindings where attempt_id=attempt.id;
 select * into request from private.r05_requests where id=binding.request_id;
 select * into candidate from private.r12_discovery_candidates where request_id=request.id;
 select * into response from private.r07_responses where attempt_id=attempt.id;
 select max(actual_microunits) into actual from private.r05_settlements where request_id=request.id and provider_request_id is not null;
 marked:=exists(select 1 from private.r05_markers where request_id=request.id);reserved:=exists(select 1 from private.r05_reservations where request_id=request.id) and not exists(select 1 from private.r05_releases where request_id=request.id);
 held:=case when reserved and actual is null then request.liability_microunits else 0 end;
 receipt:=case when candidate.request_id is null then null else private.r12_discovery_receipt_status(candidate)-array['requestId','candidateHash','proofHash'] end;
 known_total:=known_total+coalesce(actual,0);held_total:=held_total+held;unknown_cost:=unknown_cost or marked and actual is null;
 phases:=phases||jsonb_build_array(jsonb_build_object('phase',step->>'key','status',coalesce(attempt.status,'not_started'),'reason',attempt.reason,'attemptId',attempt.id,'artifactId',response.artifact_id,
 'candidateSaved',candidate.request_id is not null,'receipt',receipt,'knownMicrousd',actual::text,'heldMicrousd',held::text,'unknownCost',marked and actual is null,'outcome',response.content->'result'->>'outcome'));
 end loop;end if;
 budget:=private.stage13v2_budget_authority(source_scope.prior_round_id,false);
 return jsonb_build_object('version','r12.discovery-workspace.1','businessId',p_business_id,'scopeId',source_scope.id,'goalId',source_scope.goal_id,
 'title',(select content->>'title' from private.r04_goal_versions where goal_id=source_scope.goal_id order by revision desc limit 1),
 'approvedQuery',source_scope.amendment->>'approvedQuery','sourceDomains',source_scope.amendment->'allowedDomains','priorRoundId',source_scope.prior_round_id,'budgetAuthorityRootId',source_scope.budget_authority_root_id,
 'planId',saved_plan.id,'planHash',saved_plan.content_hash,'state',case when authority.scope_id is null then 'awaiting_authority' when head.state='completed' then 'completed' when policy_revoked then 'stopped' when paused then 'paused' when stopped then 'blocked' else coalesce(head.state,'prepared') end,'reason',case when policy_revoked then 'owner_stopped' when paused then 'scope_paused' when stopped and authority.scope_id is not null then 'scope_changed' else head.reason end,'policyRevoked',policy_revoked,'paused',paused,
 'activeWindow',active,'dispatchUntil',authority.valid_until,'receiptUntil',authority.receipt_until,'phases',phases,
 'cost',jsonb_build_object('knownMicrousd',known_total::text,'heldMicrousd',held_total::text,'hasUnknown',unknown_cost),'rootFunding',budget,
 'activation',case when p_activation and authority.scope_id is not null then jsonb_build_object('scope',source_scope.amendment,'plan',authority.plan,'planHash',authority.plan_hash,'mode',authority.mode,
 'controllerKeyHash',authority.controller_key_hash,'admissionKeyHash',authority.admission_key_hash,'operations',(select payload->'operations' from private.r05_policies where id=(authority.plan->>'policyId')::uuid)) else null end);
end $$;
revoke all on function public.r12_discovery_owner_read(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.r12_discovery_owner_read(uuid,uuid,boolean) to authenticated;
commit;
