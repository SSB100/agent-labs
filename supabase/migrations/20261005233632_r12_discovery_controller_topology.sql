-- R12 definition only: exactly five one-effect attempts, ending with an
-- independent review. Legacy r07.1 validation remains unchanged. No adapter,
-- operation, source policy, financial authority or server key is enrolled.
begin;
alter table private.r05_operations drop constraint r05_operations_operation_key_v2_check;
alter table private.r05_operations add constraint r05_operations_operation_key_r12_check check (
 operation_key in ('research.search','research.model','creative.text','creative.image','listing.specialist','listing.reviewer','listing.qualification','browser.planner')
 or operation_key ~ '^research\.(search|model)\.r11v2\.[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
 or operation_key ~ '^research\.r12\.[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(plan|search1|select1|strategy|review)$');
create or replace function private.r07_validate_plan(b uuid,g uuid,p jsonb) returns void language plpgsql set search_path='' as $$
declare s jsonb; k text; seen text[]:='{}'; first_key text; challenge_key text; total numeric:=0; policy private.r05_policies; scope jsonb; n integer:=0; dep text; discovery boolean:=coalesce(p->>'format'='r12.discovery.1',false); discovery_keys text[]:=array['plan','search1','select1','strategy','review']; binding private.r12_discovery_scopes; original public.product_experiments; budget jsonb; begin
 perform private.r07_safe(p);
 perform private.r04_keys(p,array['format','businessId','goalId','goalRevision','goalHash','businessRevision','businessHash','policyId','policyHash','authorityRootId','plannerWorkerDefinitionId','currency','maximumMicrounits','deadline','expiresAt','maximumRepairs','maximumPivots','maximumChildren','maximumDispatches','requiredChecks','finishCondition','stopConditions','steps']||case when discovery then array['discoveryScopeId','discoveryScopeHash'] else array[]::text[] end);
 if (not discovery and p->>'format' is distinct from 'r07.1') or p->>'businessId' is distinct from b::text or p->>'goalId' is distinct from g::text or p->>'authorityRootId' is distinct from b::text or p->>'currency' is distinct from 'USD' then raise exception 'r07_invalid_lineage'; end if;
 foreach k in array array['goalRevision','businessRevision','maximumRepairs','maximumPivots','maximumChildren','maximumDispatches'] loop
 if jsonb_typeof(p->k) is distinct from 'number' or p->>k !~ '^(0|[1-9][0-9]{0,8})$' then raise exception 'r07_invalid_integer'; end if;
 end loop;
 if (p->>'maximumRepairs')::integer>8 or (p->>'maximumPivots')::integer>3 or (p->>'maximumChildren')::integer not between 2 and 32 or (p->>'maximumDispatches')::integer not between 2 and 64 then raise exception 'r07_invalid_bounds'; end if;
 if not exists(select 1 from private.r04_goal_versions where business_id=b and goal_id=g and revision=(p->>'goalRevision')::integer and content_hash=p->>'goalHash') or not exists(select 1 from private.r04_business_versions where business_id=b and revision=(p->>'businessRevision')::integer and content_hash=p->>'businessHash') then raise exception 'r07_invalid_version_pins'; end if;
 select * into policy from private.r05_policies where id=(p->>'policyId')::uuid and business_id=b and goal_id=g;
 if policy.id is null or policy.content_hash is distinct from p->>'policyHash' or policy.goal_revision<>(p->>'goalRevision')::integer or policy.business_revision<>(p->>'businessRevision')::integer then raise exception 'r07_policy_pin_mismatch'; end if;
 if not exists(select 1 from public.worker_definitions where id=(p->>'plannerWorkerDefinitionId')::uuid and status in ('qualified','assisted','autonomous')) then raise exception 'r07_planner_unqualified'; end if;
 foreach k in array array['deadline','expiresAt'] loop
 if jsonb_typeof(p->k) is distinct from 'string' or p->>k !~ '^\d{4}-\d\d-\d\dT.+(Z|[+-]\d\d:\d\d)$' then raise exception 'r07_invalid_time'; end if;
 end loop;
 if (p->>'expiresAt')::timestamptz>(policy.payload->>'expiresAt')::timestamptz or (p->>'expiresAt')::timestamptz>(p->>'deadline')::timestamptz or (p->>'expiresAt')::timestamptz<=clock_timestamp() or private.r05_money(p->'maximumMicrounits') not between 1 and private.r05_money(policy.payload->'policyLimitMicrounits') or (p->>'maximumDispatches')::integer>(policy.payload->>'maximumDispatches')::integer then raise exception 'r07_parent_scope_exceeded'; end if;
 if p->>'finishCondition' is distinct from 'all_required_outputs_verified' or p->'stopConditions' is distinct from '["no_permitted_work","deadline","repair_exhausted","owner_stopped"]'::jsonb then raise exception 'r07_invalid_stop_conditions'; end if;
 if jsonb_typeof(p->'steps') is distinct from 'array' or jsonb_array_length(p->'steps') not between 2 and 16 or jsonb_array_length(p->'steps')>(p->>'maximumChildren')::integer or jsonb_array_length(p->'steps')>(p->>'maximumDispatches')::integer then raise exception 'r07_invalid_steps'; end if;
 if discovery then
 if p->>'discoveryScopeId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' or p->>'discoveryScopeHash' !~ '^[a-f0-9]{64}$' or jsonb_typeof(p->'discoveryScopeId') is distinct from 'string' or jsonb_typeof(p->'discoveryScopeHash') is distinct from 'string' or jsonb_array_length(p->'steps')<>5 or p->'maximumChildren'<>'5' or p->'maximumDispatches'<>'5' or p->'maximumRepairs'<>'0' or p->'maximumPivots'<>'0' or p->'requiredChecks'<>'["review"]'::jsonb then raise exception 'r07_discovery_topology_invalid';end if;
 select * into binding from private.r12_discovery_scopes where id=(p->>'discoveryScopeId')::uuid and business_id=b and goal_id=g and amendment_hash=p->>'discoveryScopeHash';
 if binding.id is null or (binding.amendment->>'expiresAt')::timestamptz<(p->>'expiresAt')::timestamptz then raise exception 'r07_discovery_scope_unavailable';end if;
 select * into strict original from public.product_experiments where id=binding.prior_round_id and business_id=b;
 if exists(select 1 from public.product_experiments newer where newer.business_id=b and newer.discovery_version='pod-discovery-2.0' and newer.parent_discovery_id is null and newer.candidate_id is null and newer.variables->>'budgetAuthorityRootId'=binding.budget_authority_root_id::text and (newer.created_at,newer.id)>(original.created_at,original.id)) or not exists(select 1 from private.r04_goal_versions gv join private.r04_goal_state gs using(goal_id,business_id,revision) where gv.goal_id=g and gv.business_id=b and gv.preference='ready' and gv.revision=(p->>'goalRevision')::integer and gv.content->>'objective'=original.variables->'intent'->>'objective' and (select jsonb_agg(x order by x) from jsonb_array_elements_text(gv.content->'parsed'->'geography') x)=(select jsonb_agg(x->>'countryCode' order by x->>'countryCode') from jsonb_array_elements(original.variables->'intent'->'comparisonUniverse'->'markets') x)) then raise exception 'r07_discovery_original_scope_changed';end if;
 budget:=private.stage13v2_budget_authority(original.id,true);
 if budget->'hasUncertainCosts' is distinct from 'false'::jsonb or private.r05_money(p->'maximumMicrounits')>(budget->>'remainingMicrousd')::bigint then raise exception 'r07_discovery_shared_budget_exceeded';end if;
 end if;
 for s in select value from jsonb_array_elements(p->'steps') loop
 perform private.r04_keys(s,array['key','kind','objective','reason','adapter','qualificationHash','installationId','packSnapshotHash','workflowDefinitionId','workerDefinitionId','role','operationKey','purpose','dependsOn','expectedArtifactType','maximumMicrounits','expiresAt','notBefore','measurement','maximumRepairs']);
 foreach k in array array['key','kind','objective','reason','adapter','qualificationHash','installationId','packSnapshotHash','workflowDefinitionId','workerDefinitionId','role','operationKey','purpose','expectedArtifactType','expiresAt','notBefore'] loop
 if jsonb_typeof(s->k) is distinct from 'string' or length(btrim(s->>k)) not between 1 and 240 then raise exception 'r07_invalid_step_type'; end if;
 end loop;
 if s->>'key' !~ '^[a-z][a-z0-9_-]{0,39}$' or s->>'key'=any(seen) or s->>'qualificationHash' !~ '^[a-f0-9]{64}$' or s->>'packSnapshotHash' !~ '^[a-f0-9]{64}$' then raise exception 'r07_invalid_step_identity'; end if;
 if jsonb_typeof(s->'maximumRepairs') is distinct from 'number' or s->>'maximumRepairs' !~ '^[0-3]$' or (s->>'maximumRepairs')::integer>(p->>'maximumRepairs')::integer then raise exception 'r07_invalid_repair_bound'; end if;
 perform private.r04_strings(s->'dependsOn',16);
 if (select count(*)<>count(distinct x) from jsonb_array_elements_text(s->'dependsOn') x) then raise exception 'r07_duplicate_dependency'; end if;
 for dep in select jsonb_array_elements_text(s->'dependsOn') loop if not dep=any(seen) then raise exception 'r07_invalid_dependencies'; end if; end loop;
 if s->>'kind' not in ('research','challenge','work','review','measure') then raise exception 'r07_invalid_kind'; end if;
 if discovery then
 if s->>'key' is distinct from discovery_keys[n+1] or s->>'kind' is distinct from (case when n=1 then 'research' when n=4 then 'review' else 'work' end) or s->>'adapter' is distinct from 'r12.discovery.'||(p->>'discoveryScopeId')||'.'||discovery_keys[n+1] or s->>'role' is distinct from discovery_keys[n+1] or s->>'operationKey' is distinct from 'research.r12.'||(p->>'discoveryScopeId')||'.'||discovery_keys[n+1] or s->>'expectedArtifactType' is distinct from 'r12.discovery.'||discovery_keys[n+1] or s->'maximumRepairs'<>'0' or s->'measurement'<>'null'::jsonb or s->'dependsOn' is distinct from to_jsonb(discovery_keys[1:n]) then raise exception 'r07_discovery_topology_invalid';end if;
 if n=4 then challenge_key:='review';end if;
 elsif n=0 then first_key:=s->>'key'; if s->>'kind'<>'research' or s->'dependsOn'<>'[]' then raise exception 'r07_research_first'; end if;
 elsif n=1 then challenge_key:=s->>'key'; if s->>'kind'<>'challenge' or not(s->'dependsOn' ? first_key) then raise exception 'r07_challenge_second'; end if;
 elsif not(s->'dependsOn' ? challenge_key) then raise exception 'r07_challenge_required'; end if;
 if s->>'kind' in ('challenge','review') and ((s->>'workerDefinitionId')::uuid=(p->>'plannerWorkerDefinitionId')::uuid or exists(select 1 from jsonb_array_elements(p->'steps') x where s->'dependsOn' ? (x->>'key') and (x->>'workerDefinitionId')::uuid=(s->>'workerDefinitionId')::uuid)) then raise exception 'r07_independent_check_required'; end if;
 select value into scope from jsonb_array_elements(policy.payload->'operations') x where x->>'operationKey'=s->>'operationKey';
 if scope is null or scope->>'purpose' is distinct from s->>'purpose' or scope->>'workflowDefinitionId' is distinct from s->>'workflowDefinitionId' or scope->>'installationId' is distinct from s->>'installationId' then raise exception 'r07_child_scope_widened'; end if;
 if not exists(select 1 from public.installed_packs where id=(s->>'installationId')::uuid and business_id=b and private.r04_hash(snapshot)=s->>'packSnapshotHash') then raise exception 'r07_snapshot_mismatch'; end if;
 foreach k in array array['expiresAt','notBefore'] loop
 if s->>k !~ '^\d{4}-\d\d-\d\dT.+(Z|[+-]\d\d:\d\d)$' then raise exception 'r07_invalid_time'; end if;
 end loop;
 if private.r05_money(s->'maximumMicrounits') not between 1 and private.r05_money(p->'maximumMicrounits') or (s->>'expiresAt')::timestamptz>(p->>'expiresAt')::timestamptz or (s->>'notBefore')::timestamptz>=(s->>'expiresAt')::timestamptz then raise exception 'r07_child_scope_widened'; end if;
 if s->'measurement'<>'null'::jsonb then
 perform private.r04_keys(s->'measurement',array['minimumObservations','closesAt']);
 if jsonb_typeof(s->'measurement'->'closesAt') is distinct from 'string' or s->'measurement'->>'closesAt' !~ '^\d{4}-\d\d-\d\dT.+(Z|[+-]\d\d:\d\d)$' or s->>'kind'<>'measure' or jsonb_typeof(s->'measurement'->'minimumObservations') is distinct from 'number' or s->'measurement'->>'minimumObservations' !~ '^[1-9][0-9]{0,8}$' or (s->'measurement'->>'closesAt')::timestamptz<=(s->>'notBefore')::timestamptz or (s->'measurement'->>'closesAt')::timestamptz>(s->>'expiresAt')::timestamptz then raise exception 'r07_invalid_measurement'; end if;
 elsif s->>'kind'='measure' then raise exception 'r07_measurement_required'; end if;
 total:=total+private.r05_money(s->'maximumMicrounits'); seen:=array_append(seen,s->>'key'); n:=n+1;
 end loop;
 if total>private.r05_money(p->'maximumMicrounits') then raise exception 'r07_plan_budget_exceeded'; end if;
 perform private.r04_strings(p->'requiredChecks',16);
 if not(p->'requiredChecks' ? challenge_key) or exists(select 1 from jsonb_array_elements_text(p->'requiredChecks') ck where not exists(select 1 from jsonb_array_elements(p->'steps') cs where cs->>'key'=ck and cs->>'kind' in ('challenge','review'))) or (select count(*)<>count(distinct ck) from jsonb_array_elements_text(p->'requiredChecks') ck) then raise exception 'r07_invalid_required_checks'; end if;
end $$;
revoke all on function private.r07_validate_plan(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
commit;
