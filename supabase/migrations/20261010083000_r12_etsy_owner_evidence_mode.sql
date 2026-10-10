-- Explicit Etsy owner-evidence mode. Definition-only: no catalog rows, grants,
-- credentials, scopes, provider requests or paid effects are created.
-- The .1 five-phase lane and immutable historical imports retain their meaning.
-- .2 is three real paid phases over frozen owner observations; it never obtains
-- an Exa search/selector operation, receipt, evidence pack or network permission.
begin;

create function private.r12_adaptive_etsy_scope(scope uuid) returns boolean
language sql stable set search_path='' as $$
 select coalesce((select amendment->>'version'='r12.discovery-owner-adaptive.2'
  from private.r12_discovery_scopes where id=scope),false)
$$;

create function private.r12_adaptive_etsy_action_phases(kind text,repair_phase text default null)
returns jsonb language plpgsql immutable set search_path='' as $$
begin
 if kind in ('initial','pivot') then return '["plan","strategy","review"]'::jsonb;end if;
 if kind='followup' then raise exception 'owner_source_operation_required';end if;
 if kind='reasoning_review' then return '["strategy","review"]'::jsonb;end if;
 if kind='repair' and repair_phase='plan' then return '["plan","strategy","review"]'::jsonb;end if;
 if kind='repair' and repair_phase in ('strategy','review') then return '["strategy","review"]'::jsonb;end if;
 raise exception 'r12_adaptive_etsy_action_topology_invalid';
end $$;

create function private.r12_adaptive_etsy_observation_context(ref jsonb,business uuid,owner uuid,
 intent_id uuid,scope_id uuid,scope_hash text,approval_hash text) returns jsonb
language plpgsql stable set search_path='' as $$
declare result jsonb;begin
 if ref is null or ref='null'::jsonb then raise exception 'r12_owner_observation_ref_required';end if;
 result:=private.r12_owner_observation_context(ref,business,owner,intent_id,scope_id,scope_hash,approval_hash);
 if exists(select 1 from jsonb_array_elements(result->'bundles') bundle
  cross join lateral jsonb_array_elements(bundle->'observations') observation
  join lateral jsonb_array_elements(result->'manifest') pin
   on pin->>'bundleId'=bundle->>'id' and pin->'selectedObservationIds' ? (observation->>'id')
  where observation->'source'->>'url' !~* '^https://(www\.)?etsy\.com(/|$)')
 then raise exception 'r12_adaptive_etsy_observation_source_required';end if;
 return result;
end $$;

do $etsy_mode$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_profile_check(private.r12_owner_profiles,timestamp with time zone)'::regprocedure);
 d:=replace(d,'FUNCTION private.r12_adaptive_profile_check(', 'FUNCTION private.r12_adaptive_profile_check_etsy(');
 if position($replace$'r12.owner-research-profile.2'$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_profile_check';end if;
 d:=replace(d,$replace$'r12.owner-research-profile.2'$replace$,$replace$'r12.owner-research-profile.3'$replace$);
 if position($replace$'documented_api_factual_snippets'$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_profile_check';end if;
 d:=replace(d,$replace$'documented_api_factual_snippets'$replace$,$replace$'owner_reported_capture'$replace$);
 if position($replace$coalesce(cardinality(domains),0)<1$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_profile_check';end if;
 d:=replace(d,$replace$coalesce(cardinality(domains),0)<1$replace$,$replace$v->'allowedDomains' is distinct from '["etsy.com"]'::jsonb$replace$);
 if position($replace$exists(select 1 from unnest(domains)a cross join unnest(excluded)e where a=e or a like '%.'||e or e like '%.'||a) or $replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_profile_check';end if;
 d:=replace(d,$replace$exists(select 1 from unnest(domains)a cross join unnest(excluded)e where a=e or a like '%.'||e or e like '%.'||a) or $replace$,$replace$$replace$);
 execute d;
end $etsy_mode$;

do $etsy_mode$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_quote_check(jsonb,jsonb)'::regprocedure);
 d:=replace(d,'FUNCTION private.r12_adaptive_quote_check(', 'FUNCTION private.r12_adaptive_quote_check_etsy(');
 if position($replace$'r12.adaptive-quote.1'$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_quote_check';end if;
 d:=replace(d,$replace$'r12.adaptive-quote.1'$replace$,$replace$'r12.adaptive-quote.2'$replace$);
 if position($replace$array['plan','search','select','strategy','review']$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_quote_check';end if;
 d:=replace(d,$replace$array['plan','search','select','strategy','review']$replace$,$replace$array['plan','strategy','review']$replace$);
 if position($replace$or q->>'baseQuoteHash' !~ '^[a-f0-9]{64}$'$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_quote_check';end if;
 d:=replace(d,$replace$or q->>'baseQuoteHash' !~ '^[a-f0-9]{64}$'$replace$,$replace$or q->>'baseQuoteHash' is distinct from private.stage14_hash(jsonb_build_object('version','r12.adaptive-inference-catalog.1','luna',q->'luna','reviewer',q->'reviewer'))$replace$);
 if position($replace$"search":"query_retention_improvement_training_possible"$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_quote_check';end if;
 d:=replace(d,$replace$"search":"query_retention_improvement_training_possible"$replace$,$replace$"sourceAcquisition":"owner_reported_capture_no_search"$replace$);
 if position($replace${"plan":24576,"search":8192,"select":24576,"strategy":65536,"review":65536}$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_quote_check';end if;
 d:=replace(d,$replace${"plan":24576,"search":8192,"select":24576,"strategy":65536,"review":65536}$replace$,$replace${"plan":24576,"strategy":65536,"review":65536}$replace$);
 if position($replace${"plan":1500,"search":4000,"select":1000,"strategy":5000,"review":4000}$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_quote_check';end if;
 d:=replace(d,$replace${"plan":1500,"search":4000,"select":1000,"strategy":5000,"review":4000}$replace$,$replace${"plan":1500,"strategy":5000,"review":4000}$replace$);
 execute d;
end $etsy_mode$;

do $etsy_mode$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_action_context(uuid)'::regprocedure);
 d:=replace(d,'FUNCTION private.r12_adaptive_action_context(', 'FUNCTION private.r12_adaptive_action_context_etsy(');
 if position($replace$array['plan','search1','select1','strategy','review']$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_action_context';end if;
 d:=replace(d,$replace$array['plan','search1','select1','strategy','review']$replace$,$replace$array['plan','strategy','review']$replace$);
 if position($replace$reused)<>5-$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_action_context';end if;
 d:=replace(d,$replace$reused)<>5-$replace$,$replace$reused)<>3-$replace$);
 execute d;
end $etsy_mode$;

do $etsy_mode$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_activation_check(private.r12_adaptive_activations)'::regprocedure);
 d:=replace(d,'FUNCTION private.r12_adaptive_activation_check(', 'FUNCTION private.r12_adaptive_activation_check_etsy(');
 if position($replace$'r12.discovery-adaptive.1'$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_activation_check';end if;
 d:=replace(d,$replace$'r12.discovery-adaptive.1'$replace$,$replace$'r12.discovery-adaptive.2'$replace$);
 if position($replace$'r12.discovery-owner-adaptive.1'$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_activation_check';end if;
 d:=replace(d,$replace$'r12.discovery-owner-adaptive.1'$replace$,$replace$'r12.discovery-owner-adaptive.2'$replace$);
 if position($replace$'r12.adaptive-research-preview.1'$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_activation_check';end if;
 d:=replace(d,$replace$'r12.adaptive-research-preview.1'$replace$,$replace$'r12.adaptive-research-preview.2'$replace$);
 if position($replace$'r12.adaptive-activation.1'$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_activation_check';end if;
 d:=replace(d,$replace$'r12.adaptive-activation.1'$replace$,$replace$'r12.adaptive-activation.2'$replace$);
 if position($replace$array['plan','search1','select1','strategy','review']$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_activation_check';end if;
 d:=replace(d,$replace$array['plan','search1','select1','strategy','review']$replace$,$replace$array['plan','strategy','review']$replace$);
 if position($replace$or 5>32-$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_activation_check';end if;
 d:=replace(d,$replace$or 5>32-$replace$,$replace$or 3>32-$replace$);
 if position($replace$'search',a.phase_ceilings->'search1','select',a.phase_ceilings->'select1',$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_activation_check';end if;
 d:=replace(d,$replace$'search',a.phase_ceilings->'search1','select',a.phase_ceilings->'select1',$replace$,$replace$$replace$);
 if position($replace$jsonb_array_length(p.content->'steps')<>5$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_activation_check';end if;
 d:=replace(d,$replace$jsonb_array_length(p.content->'steps')<>5$replace$,$replace$jsonb_array_length(p.content->'steps')<>3$replace$);
 if position($replace$perform private.r12_adaptive_profile_check(profile,$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_activation_check';end if;
 d:=replace(d,$replace$perform private.r12_adaptive_profile_check(profile,$replace$,$replace$perform private.r12_adaptive_profile_check_etsy(profile,$replace$);
 if position($replace$or setup.preview->>'version'$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_activation_check';end if;
 d:=replace(d,$replace$or setup.preview->>'version'$replace$,$replace$or setup.quote->>'version' is distinct from 'r12.adaptive-quote.2'
 or setup.preview->>'version'$replace$);
 execute d;
end $etsy_mode$;

do $etsy_mode$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)'::regprocedure);
 d:=replace(d,'FUNCTION private.r12_adaptive_wire_validate(', 'FUNCTION private.r12_adaptive_wire_validate_etsy(');
 if position($replace$'r12.adaptive-wire.1'$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_wire_validate';end if;
 d:=replace(d,$replace$'r12.adaptive-wire.1'$replace$,$replace$'r12.adaptive-wire.2'$replace$);
 if position($replace$if activation.scope_id is null$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_wire_validate';end if;
 d:=replace(d,$replace$if activation.scope_id is null$replace$,$replace$if p.content->>'format' is distinct from 'r12.discovery-adaptive.2'
 or s.amendment->>'version' is distinct from 'r12.discovery-owner-adaptive.2'
 or phase not in ('plan','strategy','review') or activation.scope_id is null$replace$);
 if position($replace$perform private.r12_adaptive_quote_check(q,setup.quote);$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_wire_validate';end if;
 d:=replace(d,$replace$perform private.r12_adaptive_quote_check(q,setup.quote);$replace$,$replace$if setup.quote->>'version' is distinct from 'r12.adaptive-quote.2' then raise exception 'r12_adaptive_cross_mode_replay';end if;
 perform private.r12_adaptive_quote_check(q,setup.quote);$replace$);
 execute d;
end $etsy_mode$;

do $etsy_mode$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_action_check(private.r12_adaptive_activations,jsonb)'::regprocedure);
 d:=replace(d,'FUNCTION private.r12_adaptive_action_check(', 'FUNCTION private.r12_adaptive_action_check_etsy(');
 if position($replace$'r12.adaptive-action.1'$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_action_check';end if;
 d:=replace(d,$replace$'r12.adaptive-action.1'$replace$,$replace$'r12.adaptive-action.2'$replace$);
 if position($replace$private.r12_adaptive_action_phases($replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_action_check';end if;
 d:=replace(d,$replace$private.r12_adaptive_action_phases($replace$,$replace$private.r12_adaptive_etsy_action_phases($replace$);
 execute d;
end $etsy_mode$;

do $etsy_mode$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_admit_action(uuid,jsonb)'::regprocedure);
 d:=replace(d,'FUNCTION private.r12_adaptive_admit_action(', 'FUNCTION private.r12_adaptive_admit_action_etsy(');
 if position($replace$array['plan','search','select','strategy','review']$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_admit_action';end if;
 d:=replace(d,$replace$array['plan','search','select','strategy','review']$replace$,$replace$array['plan','strategy','review']$replace$);
 if position($replace$where plan_id=a.plan_id)<>5$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_admit_action';end if;
 d:=replace(d,$replace$where plan_id=a.plan_id)<>5$replace$,$replace$where plan_id=a.plan_id)<>3$replace$);
 if position($replace$(a.predecessor_closure->>'baseChildren')::integer+5$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_admit_action';end if;
 d:=replace(d,$replace$(a.predecessor_closure->>'baseChildren')::integer+5$replace$,$replace$(a.predecessor_closure->>'baseChildren')::integer+3$replace$);
 execute d;
end $etsy_mode$;

do $etsy_mode$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_admit_next(uuid)'::regprocedure);
 d:=replace(d,'FUNCTION private.r12_adaptive_admit_next(', 'FUNCTION private.r12_adaptive_admit_next_etsy(');
 if position($replace$'r12.adaptive-action.1'$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_admit_next';end if;
 d:=replace(d,$replace$'r12.adaptive-action.1'$replace$,$replace$'r12.adaptive-action.2'$replace$);
 if position($replace$array['plan','search1','select1','strategy','review']$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_admit_next';end if;
 d:=replace(d,$replace$array['plan','search1','select1','strategy','review']$replace$,$replace$array['plan','strategy','review']$replace$);
 if position($replace$private.r12_adaptive_action_phases($replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_admit_next';end if;
 d:=replace(d,$replace$private.r12_adaptive_action_phases($replace$,$replace$private.r12_adaptive_etsy_action_phases($replace$);
 if position($replace$kind:=recommendation->>'kind';question:=recommendation->>'publicQuestion';$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_admit_next';end if;
 d:=replace(d,$replace$kind:=recommendation->>'kind';question:=recommendation->>'publicQuestion';$replace$,$replace$kind:=recommendation->>'kind';
    if kind='followup' then return jsonb_build_object('admitted',false,'reason','owner_source_operation_required');end if;
    question:=recommendation->>'publicQuestion';$replace$);
 execute d;
end $etsy_mode$;

do $etsy_mode$ declare d text;begin
 d:=pg_get_functiondef('private.r12_owner_adaptive_prepare(uuid,jsonb,text)'::regprocedure);
 d:=replace(d,'FUNCTION private.r12_owner_adaptive_prepare(', 'FUNCTION private.r12_owner_adaptive_prepare_etsy(');
 if position($replace$'r12.adaptive-research-preview.1'$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_owner_adaptive_prepare';end if;
 d:=replace(d,$replace$'r12.adaptive-research-preview.1'$replace$,$replace$'r12.adaptive-research-preview.2'$replace$);
 if position($replace$array['plan','search','select','strategy','review']$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_owner_adaptive_prepare';end if;
 d:=replace(d,$replace$array['plan','search','select','strategy','review']$replace$,$replace$array['plan','strategy','review']$replace$);
 if position($replace$private.r12_owner_observation_context($replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_owner_adaptive_prepare';end if;
 d:=replace(d,$replace$private.r12_owner_observation_context($replace$,$replace$private.r12_adaptive_etsy_observation_context($replace$);
 if position($replace$perform private.r12_adaptive_profile_check(profile,$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_owner_adaptive_prepare';end if;
 d:=replace(d,$replace$perform private.r12_adaptive_profile_check(profile,$replace$,$replace$perform private.r12_adaptive_profile_check_etsy(profile,$replace$);
 if position($replace$(closure->>'baseChildren')::integer+5$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_owner_adaptive_prepare';end if;
 d:=replace(d,$replace$(closure->>'baseChildren')::integer+5$replace$,$replace$(closure->>'baseChildren')::integer+3$replace$);
 if position($replace$(closure->>'baseDispatches')::integer+5$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_owner_adaptive_prepare';end if;
 d:=replace(d,$replace$(closure->>'baseDispatches')::integer+5$replace$,$replace$(closure->>'baseDispatches')::integer+3$replace$);
 if position($replace$'maximumNewChildren',5$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_owner_adaptive_prepare';end if;
 d:=replace(d,$replace$'maximumNewChildren',5$replace$,$replace$'maximumNewChildren',3$replace$);
 if position($replace$if input->'ownerObservationRef' is null$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_owner_adaptive_prepare';end if;
 d:=replace(d,$replace$if input->'ownerObservationRef' is null$replace$,$replace$if input->'ownerObservationRef' is null or input->'ownerObservationRef'='null'::jsonb$replace$);
 if position($replace$perform private.r12_adaptive_quote_check(q);$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_owner_adaptive_prepare';end if;
 d:=replace(d,$replace$perform private.r12_adaptive_quote_check(q);$replace$,$replace$if q->>'version' is distinct from 'r12.adaptive-quote.2' then raise exception 'r12_adaptive_cross_mode_replay';end if;
 perform private.r12_adaptive_quote_check(q);$replace$);
 execute d;
end $etsy_mode$;

do $etsy_mode$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_scope_insert_check(private.r12_discovery_scopes)'::regprocedure);
 d:=replace(d,'FUNCTION private.r12_adaptive_scope_insert_check(', 'FUNCTION private.r12_adaptive_scope_insert_check_etsy(');
 if position($replace$'r12.discovery-owner-adaptive.1'$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_scope_insert_check';end if;
 d:=replace(d,$replace$'r12.discovery-owner-adaptive.1'$replace$,$replace$'r12.discovery-owner-adaptive.2'$replace$);
 if position($replace$if a->>'version'$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_scope_insert_check';end if;
 d:=replace(d,$replace$if a->>'version'$replace$,$replace$if profile.profile->>'version' is distinct from 'r12.owner-research-profile.3'
 or setup.preview->>'version' is distinct from 'r12.adaptive-research-preview.2'
 or setup.quote->>'version' is distinct from 'r12.adaptive-quote.2'
 or a->'ownerObservationRef'='null'::jsonb or a->'ownerObservationRef' is null
 or a->'intent'->'limits'->'maximumNewCollections' is distinct from '0'::jsonb
 or a->>'version'$replace$);
 execute d;
end $etsy_mode$;

do $etsy_mode$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_plan_check(uuid,uuid,jsonb)'::regprocedure);
 d:=replace(d,'FUNCTION private.r12_adaptive_plan_check(', 'FUNCTION private.r12_adaptive_plan_check_etsy(');
 if position($replace$'r12.discovery-adaptive.1'$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_plan_check';end if;
 d:=replace(d,$replace$'r12.discovery-adaptive.1'$replace$,$replace$'r12.discovery-adaptive.2'$replace$);
 if position($replace$array['plan','search1','select1','strategy','review']$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_plan_check';end if;
 d:=replace(d,$replace$array['plan','search1','select1','strategy','review']$replace$,$replace$array['plan','strategy','review']$replace$);
 if position($replace$(closure->>'baseChildren')::integer+5$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_plan_check';end if;
 d:=replace(d,$replace$(closure->>'baseChildren')::integer+5$replace$,$replace$(closure->>'baseChildren')::integer+3$replace$);
 if position($replace$jsonb_array_length(p->'steps')<>5$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_plan_check';end if;
 d:=replace(d,$replace$jsonb_array_length(p->'steps')<>5$replace$,$replace$jsonb_array_length(p->'steps')<>3$replace$);
 if position($replace$jsonb_array_length(policy.payload->'operations')<>5$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_plan_check';end if;
 d:=replace(d,$replace$jsonb_array_length(policy.payload->'operations')<>5$replace$,$replace$jsonb_array_length(policy.payload->'operations')<>3$replace$);
 execute d;
end $etsy_mode$;

do $etsy_mode$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_proposed_scope(private.r12_adaptive_setups)'::regprocedure);
 d:=replace(d,'FUNCTION private.r12_adaptive_proposed_scope(', 'FUNCTION private.r12_adaptive_proposed_scope_etsy(');
 if position($replace$'r12.discovery-owner-adaptive.1'$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_proposed_scope';end if;
 d:=replace(d,$replace$'r12.discovery-owner-adaptive.1'$replace$,$replace$'r12.discovery-owner-adaptive.2'$replace$);
 if position($replace$'maximumNewCollections',1$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_proposed_scope';end if;
 d:=replace(d,$replace$'maximumNewCollections',1$replace$,$replace$'maximumNewCollections',0$replace$);
 execute d;
end $etsy_mode$;

do $etsy_mode$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_initial_action(jsonb)'::regprocedure);
 d:=replace(d,'FUNCTION private.r12_adaptive_initial_action(', 'FUNCTION private.r12_adaptive_initial_action_etsy(');
 if position($replace$'r12.adaptive-action.1'$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_initial_action';end if;
 d:=replace(d,$replace$'r12.adaptive-action.1'$replace$,$replace$'r12.adaptive-action.2'$replace$);
 if position($replace$private.r12_adaptive_action_phases($replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_initial_action';end if;
 d:=replace(d,$replace$private.r12_adaptive_action_phases($replace$,$replace$private.r12_adaptive_etsy_action_phases($replace$);
 execute d;
end $etsy_mode$;

do $etsy_mode$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_predecessor_context(private.r12_adaptive_setups)'::regprocedure);
 d:=replace(d,'FUNCTION private.r12_adaptive_predecessor_context(', 'FUNCTION private.r12_adaptive_predecessor_context_etsy(');
 if position($replace$archive:=jsonb_build_array(private.r12_adaptive_evidence_archive((d->>'attemptId')::uuid));$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_predecessor_context';end if;
 d:=replace(d,$replace$archive:=jsonb_build_array(private.r12_adaptive_evidence_archive((d->>'attemptId')::uuid));$replace$,$replace$-- Historical selector remains a lineage pin, never active .2 evidence.
   archive:='[]'::jsonb;$replace$);
 if position($replace$refs:=jsonb_build_array(d->>'artifactId');$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_predecessor_context';end if;
 d:=replace(d,$replace$refs:=jsonb_build_array(d->>'artifactId');$replace$,$replace$refs:='[]'::jsonb;$replace$);
 if position($replace$if jsonb_array_length(archive)<>1 then raise exception 'r12_adaptive_predecessor_evidence_required';end if;$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_predecessor_context';end if;
 d:=replace(d,$replace$if jsonb_array_length(archive)<>1 then raise exception 'r12_adaptive_predecessor_evidence_required';end if;$replace$,$replace$-- Keep authentic negative findings and source artifact references from history.$replace$);
 execute d;
end $etsy_mode$;

do $etsy_mode$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_phase_inputs(private.r07_attempts,private.r07_plans)'::regprocedure);
 d:=replace(d,'FUNCTION private.r12_adaptive_phase_inputs(', 'FUNCTION private.r12_adaptive_phase_inputs_etsy(');
 if position($replace$'r12.discovery-adaptive.1'$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_phase_inputs';end if;
 d:=replace(d,$replace$'r12.discovery-adaptive.1'$replace$,$replace$'r12.discovery-adaptive.2'$replace$);
 if position($replace$'r12.discovery-owner-adaptive.1'$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_phase_inputs';end if;
 d:=replace(d,$replace$'r12.discovery-owner-adaptive.1'$replace$,$replace$'r12.discovery-owner-adaptive.2'$replace$);
 if position($replace$'r12.discovery-adaptive-inputs.1'$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_phase_inputs';end if;
 d:=replace(d,$replace$'r12.discovery-adaptive-inputs.1'$replace$,$replace$'r12.discovery-adaptive-inputs.2'$replace$);
 if position($replace$private.r12_owner_observation_context($replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_phase_inputs';end if;
 d:=replace(d,$replace$private.r12_owner_observation_context($replace$,$replace$private.r12_adaptive_etsy_observation_context($replace$);
 if position($replace$ -- All accepted collections from this run remain in the archive, including
 -- refuted candidates. Only the latest six packs enter the active dossier.
 for v_attempt_id in select t.id from private.r07_attempts t where t.plan_id=p.id and t.status='completed'
  and t.step_key='select1' and t.adaptive_action_ordinal<=action.ordinal order by t.adaptive_action_ordinal,t.attempt,t.id loop
  archive:=archive||jsonb_build_array(private.r12_adaptive_evidence_archive(v_attempt_id));
 end loop;
$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_phase_inputs';end if;
 d:=replace(d,$replace$ -- All accepted collections from this run remain in the archive, including
 -- refuted candidates. Only the latest six packs enter the active dossier.
 for v_attempt_id in select t.id from private.r07_attempts t where t.plan_id=p.id and t.status='completed'
  and t.step_key='select1' and t.adaptive_action_ordinal<=action.ordinal order by t.adaptive_action_ordinal,t.attempt,t.id loop
  archive:=archive||jsonb_build_array(private.r12_adaptive_evidence_archive(v_attempt_id));
 end loop;
$replace$,$replace$ -- Owner evidence is immutable for this mode. No collection/selection archive.
 archive:='[]'::jsonb;
$replace$);
 execute d;
end $etsy_mode$;

do $etsy_mode$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_planner_input(private.r12_adaptive_setups,jsonb,boolean)'::regprocedure);
 d:=replace(d,'FUNCTION private.r12_adaptive_planner_input(', 'FUNCTION private.r12_adaptive_planner_input_etsy(');
 if position($replace$'r12.discovery-owner-adaptive.1'$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_planner_input';end if;
 d:=replace(d,$replace$'r12.discovery-owner-adaptive.1'$replace$,$replace$'r12.discovery-owner-adaptive.2'$replace$);
 if position($replace$'r12.owner-adaptive-planner-preflight-input.1'$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_planner_input';end if;
 d:=replace(d,$replace$'r12.owner-adaptive-planner-preflight-input.1'$replace$,$replace$'r12.owner-adaptive-planner-preflight-input.2'$replace$);
 if position($replace$private.r12_owner_observation_context($replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_planner_input';end if;
 d:=replace(d,$replace$private.r12_owner_observation_context($replace$,$replace$private.r12_adaptive_etsy_observation_context($replace$);
 if position($replace$action_maximum:=(q->'ceilings'->>'plan')::bigint+(q->'ceilings'->>'search')::bigint
  +(q->'ceilings'->>'select')::bigint+$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_planner_input';end if;
 d:=replace(d,$replace$action_maximum:=(q->'ceilings'->>'plan')::bigint+(q->'ceilings'->>'search')::bigint
  +(q->'ceilings'->>'select')::bigint+$replace$,$replace$action_maximum:=(q->'ceilings'->>'plan')::bigint+$replace$);
 if position($replace$perform private.r12_adaptive_profile_check(p,$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_planner_input';end if;
 d:=replace(d,$replace$perform private.r12_adaptive_profile_check(p,$replace$,$replace$perform private.r12_adaptive_profile_check_etsy(p,$replace$);
 execute d;
end $etsy_mode$;

do $etsy_mode$ declare d text;begin
 d:=pg_get_functiondef('private.r12_owner_adaptive_confirm(uuid,jsonb,text)'::regprocedure);
 d:=replace(d,'FUNCTION private.r12_owner_adaptive_confirm(', 'FUNCTION private.r12_owner_adaptive_confirm_etsy(');
 if position($replace$'r12.discovery-adaptive.1'$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_owner_adaptive_confirm';end if;
 d:=replace(d,$replace$'r12.discovery-adaptive.1'$replace$,$replace$'r12.discovery-adaptive.2'$replace$);
 if position($replace$'r12.owner-adaptive-planner-preflight.1'$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_owner_adaptive_confirm';end if;
 d:=replace(d,$replace$'r12.owner-adaptive-planner-preflight.1'$replace$,$replace$'r12.owner-adaptive-planner-preflight.2'$replace$);
 if position($replace$'r12.adaptive-activation.1'$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_owner_adaptive_confirm';end if;
 d:=replace(d,$replace$'r12.adaptive-activation.1'$replace$,$replace$'r12.adaptive-activation.2'$replace$);
 if position($replace$array['plan','search1','select1','strategy','review']$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_owner_adaptive_confirm';end if;
 d:=replace(d,$replace$array['plan','search1','select1','strategy','review']$replace$,$replace$array['plan','strategy','review']$replace$);
 if position($replace$perform private.r12_adaptive_profile_check(profile,$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_owner_adaptive_confirm';end if;
 d:=replace(d,$replace$perform private.r12_adaptive_profile_check(profile,$replace$,$replace$perform private.r12_adaptive_profile_check_etsy(profile,$replace$);
 if position($replace$'search1',setup.quote->'ceilings'->'search','select1',setup.quote->'ceilings'->'select',$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_owner_adaptive_confirm';end if;
 d:=replace(d,$replace$'search1',setup.quote->'ceilings'->'search','select1',setup.quote->'ceilings'->'select',$replace$,$replace$$replace$);
 if position($replace$(closure->>'baseChildren')::integer+5$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_owner_adaptive_confirm';end if;
 d:=replace(d,$replace$(closure->>'baseChildren')::integer+5$replace$,$replace$(closure->>'baseChildren')::integer+3$replace$);
 if position($replace$children_created=children_created+5$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_owner_adaptive_confirm';end if;
 d:=replace(d,$replace$children_created=children_created+5$replace$,$replace$children_created=children_created+3$replace$);
 if position($replace$if exists(select 1 from private.r12_adaptive_activations where setup_id=setup.id)$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_owner_adaptive_confirm';end if;
 d:=replace(d,$replace$if exists(select 1 from private.r12_adaptive_activations where setup_id=setup.id)$replace$,$replace$if p_payload->'quote'->>'version' is distinct from 'r12.adaptive-quote.2'
 or p_payload->'preflight'->>'version' is distinct from 'r12.owner-adaptive-planner-preflight.2'
 then raise exception 'r12_adaptive_cross_mode_replay';end if;
 if exists(select 1 from private.r12_adaptive_activations where setup_id=setup.id)$replace$);
 execute d;
end $etsy_mode$;

do $etsy_mode$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_review_progress(jsonb,jsonb,text)'::regprocedure);
 d:=replace(d,'FUNCTION private.r12_adaptive_review_progress(', 'FUNCTION private.r12_adaptive_review_progress_etsy(');
 if position($replace$ -- Seen evidence includes the complete original archive, not just previous
 -- citations or the active subset. Re-fetching an uncited old quote is not new.
 for item in select value from jsonb_array_elements(snapshot->'archive') loop
  if item->'selector'->'origin'->>'actionHash' is distinct from d->'origin'->>'actionHash' then
   for evidence in select value from jsonb_array_elements(item->'persisted'->'evidencePack'->'evidence') loop
    prior_identities:=array_append(prior_identities,private.r12_adaptive_quote_identity(evidence->>'quote'));
   end loop;
  end if;
 end loop;
$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_review_progress';end if;
 d:=replace(d,$replace$ -- Seen evidence includes the complete original archive, not just previous
 -- citations or the active subset. Re-fetching an uncited old quote is not new.
 for item in select value from jsonb_array_elements(snapshot->'archive') loop
  if item->'selector'->'origin'->>'actionHash' is distinct from d->'origin'->>'actionHash' then
   for evidence in select value from jsonb_array_elements(item->'persisted'->'evidencePack'->'evidence') loop
    prior_identities:=array_append(prior_identities,private.r12_adaptive_quote_identity(evidence->>'quote'));
   end loop;
  end if;
 end loop;
$replace$,$replace$ -- The initial owner packet may inform a new finding. Later actions see the
 -- same immutable packet, so unused quotes cannot be relabeled new evidence.
 if (snapshot->'action'->>'ordinal')::integer>0 then
  for item in select value from jsonb_array_elements(snapshot->'ownerObservationContext'->'bundles') loop
   for evidence in select observation from jsonb_array_elements(item->'observations') observation
    where exists(select 1 from jsonb_array_elements(snapshot->'ownerObservationContext'->'manifest') pin
     where pin->>'bundleId'=item->>'id' and pin->'selectedObservationIds' ? (observation->>'id')) loop
    for span in select value from jsonb_array_elements(evidence->'metrics') loop
     prior_identities:=array_append(prior_identities,private.r12_adaptive_quote_identity(
      substr(evidence->>'content',(span->>'start')::integer+1,(span->>'end')::integer-(span->>'start')::integer)));
    end loop;
   end loop;
  end loop;
 end if;
$replace$);
 if position($replace$or not exists(select 1 from jsonb_array_elements(snapshot->'archive') ar
    cross join lateral jsonb_array_elements(ar->'persisted'->'evidencePack'->'evidence') ev
    where snapshot->'intentPins'->'activeEvidenceArtifactIds' ? (ar->'persisted'->>'artifactId')
     and ev->>'quote'=span->>'quote')$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_adaptive_review_progress';end if;
 d:=replace(d,$replace$or not exists(select 1 from jsonb_array_elements(snapshot->'archive') ar
    cross join lateral jsonb_array_elements(ar->'persisted'->'evidencePack'->'evidence') ev
    where snapshot->'intentPins'->'activeEvidenceArtifactIds' ? (ar->'persisted'->>'artifactId')
     and ev->>'quote'=span->>'quote')$replace$,$replace$or not exists(select 1 from jsonb_array_elements(snapshot->'ownerObservationContext'->'bundles') bundle
    cross join lateral jsonb_array_elements(bundle->'observations') observation
    cross join lateral jsonb_array_elements(observation->'metrics') metric
    join lateral jsonb_array_elements(snapshot->'ownerObservationContext'->'manifest') pin
     on pin->>'bundleId'=bundle->>'id' and pin->'selectedObservationIds' ? (observation->>'id')
    where span->'reference'=jsonb_build_object('artifactId',observation->>'id','evidenceId',metric->>'id',
      'sourceId',observation->>'sourceId','sourceContentHash',observation->>'contentHash',
      'start',metric->'start','end',metric->'end')
     and span->>'quote'=substr(observation->>'content',(metric->>'start')::integer+1,
       (metric->>'end')::integer-(metric->>'start')::integer))$replace$);
 execute d;
end $etsy_mode$;

-- Route explicit .2 records to their exact validator. The original .1
-- body remains the fallback and retains its five-phase contracts.

do $etsy_router$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_review_progress(jsonb,jsonb,text)'::regprocedure);
 d:=regexp_replace(d,'\mbegin\M',$replace$begin
 if snapshot->>'version'='r12.discovery-adaptive-inputs.2' then return private.r12_adaptive_review_progress_etsy(d,snapshot,action_kind);end if;$replace$,'i');
 execute d;
end $etsy_router$;

do $etsy_router$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_profile_check(private.r12_owner_profiles,timestamp with time zone)'::regprocedure);
 d:=regexp_replace(d,'\mbegin\M',$replace$begin
 if p.profile->>'version'='r12.owner-research-profile.3' then perform private.r12_adaptive_profile_check_etsy(p,at_time);return;end if;$replace$,'i');
 execute d;
end $etsy_router$;

do $etsy_router$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_quote_check(jsonb,jsonb)'::regprocedure);
 d:=regexp_replace(d,'\mbegin\M',$replace$begin
 if reviewed is not null and q->>'version' is distinct from reviewed->>'version' then raise exception 'r12_adaptive_cross_mode_replay';end if;
 if q->>'version'='r12.adaptive-quote.2' then perform private.r12_adaptive_quote_check_etsy(q,reviewed);return;end if;$replace$,'i');
 execute d;
end $etsy_router$;

do $etsy_router$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_action_context(uuid)'::regprocedure);
 d:=regexp_replace(d,'\mbegin\M',$replace$begin
 if private.r12_adaptive_etsy_scope(p_scope) then return private.r12_adaptive_action_context_etsy(p_scope);end if;$replace$,'i');
 execute d;
end $etsy_router$;

do $etsy_router$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_activation_check(private.r12_adaptive_activations)'::regprocedure);
 d:=regexp_replace(d,'\mbegin\M',$replace$begin
 if private.r12_adaptive_etsy_scope(a.scope_id) then perform private.r12_adaptive_activation_check_etsy(a);return;end if;$replace$,'i');
 execute d;
end $etsy_router$;

do $etsy_router$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)'::regprocedure);
 d:=regexp_replace(d,'\mbegin\M',$replace$begin
 if p.content->>'format'='r12.discovery-adaptive.2' then perform private.r12_adaptive_wire_validate_etsy(r,a,p,s,v);return;end if;$replace$,'i');
 execute d;
end $etsy_router$;

do $etsy_router$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_action_check(private.r12_adaptive_activations,jsonb)'::regprocedure);
 d:=regexp_replace(d,'\mbegin\M',$replace$begin
 if private.r12_adaptive_etsy_scope(a.scope_id) then return private.r12_adaptive_action_check_etsy(a,body);end if;$replace$,'i');
 execute d;
end $etsy_router$;

do $etsy_router$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_admit_action(uuid,jsonb)'::regprocedure);
 d:=regexp_replace(d,'\mbegin\M',$replace$begin
 if private.r12_adaptive_etsy_scope(p_scope) then return private.r12_adaptive_admit_action_etsy(p_scope,p_body);end if;$replace$,'i');
 execute d;
end $etsy_router$;

do $etsy_router$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_admit_next(uuid)'::regprocedure);
 d:=regexp_replace(d,'\mbegin\M',$replace$begin
 if private.r12_adaptive_etsy_scope(p_scope) then return private.r12_adaptive_admit_next_etsy(p_scope);end if;$replace$,'i');
 execute d;
end $etsy_router$;

do $etsy_router$ declare d text;begin
 d:=pg_get_functiondef('private.r12_owner_adaptive_prepare(uuid,jsonb,text)'::regprocedure);
 d:=regexp_replace(d,'\mbegin\M',$replace$begin
 if p_payload->'quote'->>'version'='r12.adaptive-quote.2' then return private.r12_owner_adaptive_prepare_etsy(p_business_id,p_payload,p_server_key);end if;$replace$,'i');
 execute d;
end $etsy_router$;

do $etsy_router$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_scope_insert_check(private.r12_discovery_scopes)'::regprocedure);
 d:=regexp_replace(d,'\mbegin\M',$replace$begin
 if s.amendment->>'version'='r12.discovery-owner-adaptive.2' then perform private.r12_adaptive_scope_insert_check_etsy(s);return;end if;$replace$,'i');
 execute d;
end $etsy_router$;

do $etsy_router$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_plan_check(uuid,uuid,jsonb)'::regprocedure);
 d:=regexp_replace(d,'\mbegin\M',$replace$begin
 if p->>'format'='r12.discovery-adaptive.2' then perform private.r12_adaptive_plan_check_etsy(b,g,p);return;end if;$replace$,'i');
 execute d;
end $etsy_router$;

do $etsy_router$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_proposed_scope(private.r12_adaptive_setups)'::regprocedure);
 d:=regexp_replace(d,'\mbegin\M',$replace$begin
 if s.preview->>'version'='r12.adaptive-research-preview.2' then return private.r12_adaptive_proposed_scope_etsy(s);end if;$replace$,'i');
 execute d;
end $etsy_router$;

do $etsy_router$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_predecessor_context(private.r12_adaptive_setups)'::regprocedure);
 d:=regexp_replace(d,'\mbegin\M',$replace$begin
 if s.preview->>'version'='r12.adaptive-research-preview.2' then return private.r12_adaptive_predecessor_context_etsy(s);end if;$replace$,'i');
 execute d;
end $etsy_router$;

do $etsy_router$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_phase_inputs(private.r07_attempts,private.r07_plans)'::regprocedure);
 d:=regexp_replace(d,'\mbegin\M',$replace$begin
 if p.content->>'format'='r12.discovery-adaptive.2' then return private.r12_adaptive_phase_inputs_etsy(a,p);end if;$replace$,'i');
 execute d;
end $etsy_router$;

do $etsy_router$ declare d text;begin
 d:=pg_get_functiondef('private.r12_adaptive_planner_input(private.r12_adaptive_setups,jsonb,boolean)'::regprocedure);
 d:=regexp_replace(d,'\mbegin\M',$replace$begin
 if s.preview->>'version'='r12.adaptive-research-preview.2' then return private.r12_adaptive_planner_input_etsy(s,q,lock_installation);end if;$replace$,'i');
 execute d;
end $etsy_router$;

do $etsy_router$ declare d text;begin
 d:=pg_get_functiondef('private.r12_owner_adaptive_confirm(uuid,jsonb,text)'::regprocedure);
 d:=regexp_replace(d,'\mbegin\M',$replace$begin
 if exists(select 1 from private.r12_adaptive_setups selected_setup where selected_setup.id=(p_payload->>'setupId')::uuid and selected_setup.preview->>'version'='r12.adaptive-research-preview.2') then return private.r12_owner_adaptive_confirm_etsy(p_business_id,p_payload,p_server_key);end if;$replace$,'i');
 execute d;
end $etsy_router$;

create or replace function private.r12_adaptive_initial_action(scope jsonb) returns jsonb
language sql stable set search_path='' as $$
 select case when scope->>'version'='r12.discovery-owner-adaptive.2'
 then private.r12_adaptive_initial_action_etsy(scope) else (select jsonb_build_object('version','r12.adaptive-action.1','scopeId',scope->>'id',
  'scopeHash',private.stage14_hash(scope),'ordinal',0,'kind','initial',
  'previousActionHash',null,'previousReviewHash',scope->'imports'->4->>'responseHash',
  'question',scope->>'approvedQuery','hypothesis',left(scope->'intent'->>'objective',500),
  'expectedInformationGain','Identify dated public evidence and the main uncertainty in this original POD research question.',
  'counterevidenceQuestion','What reliable public evidence would contradict the proposed opportunity and require a narrower conclusion?',
  'phases',private.r12_adaptive_action_phases('initial'),'repair',null)) end
$$;

do $etsy_mode$ declare d text;begin
 d:=pg_get_functiondef('private.r12_owner_adaptive_prepare(uuid,jsonb,text)'::regprocedure);
 if position($replace$perform private.r12_adaptive_profile_check(profile,stamp);$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_owner_adaptive_prepare';end if;
 d:=replace(d,$replace$perform private.r12_adaptive_profile_check(profile,stamp);$replace$,$replace$if profile.profile->>'version' is distinct from 'r12.owner-research-profile.2' then raise exception 'r12_adaptive_cross_mode_replay';end if;
 perform private.r12_adaptive_profile_check(profile,stamp);$replace$);
 execute d;
end $etsy_mode$;

do $etsy_mode$ declare d text;begin
 d:=pg_get_functiondef('private.r12_owner_adaptive_confirm(uuid,jsonb,text)'::regprocedure);
 if position($replace$if exists(select 1 from private.r12_adaptive_activations where setup_id=setup.id)$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_owner_adaptive_confirm';end if;
 d:=replace(d,$replace$if exists(select 1 from private.r12_adaptive_activations where setup_id=setup.id)$replace$,$replace$if p_payload->'quote'->>'version' is distinct from 'r12.adaptive-quote.1'
 or p_payload->'preflight'->>'version' is distinct from 'r12.owner-adaptive-planner-preflight.1'
 then raise exception 'r12_adaptive_cross_mode_replay';end if;
 if exists(select 1 from private.r12_adaptive_activations where setup_id=setup.id)$replace$);
 execute d;
end $etsy_mode$;

do $etsy_shared_gates$ declare d text;name text;v text;begin
 foreach name in array array['private.r07_gate(private.r07_plans,jsonb)','private.r07_validate_plan(uuid,uuid,jsonb)','private.r12_adaptive_attempt_guard()','private.r12_adaptive_schedule_pins(private.r07_plans,jsonb,jsonb)','private.r12_admission_key_scope(uuid,text,jsonb,text)','private.r12_authority_validate()','private.r12_controller_keys(uuid,uuid,jsonb,text,text)','private.r12_discovery_completed_phase(private.r07_attempts,private.r07_plans)','private.r12_discovery_phase_inputs(private.r07_attempts,private.r07_plans)','private.r12_discovery_receipt_status(private.r12_discovery_candidates)','private.r12_discovery_response_guard()','private.r12_discovery_scope_at(private.r07_plans,timestamp with time zone)','private.r12_discovery_scope_current(private.r07_plans)','private.r12_discovery_scope_validate()','private.r12_discovery_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)','private.r12_plan_qualification(uuid,uuid,jsonb)','public.r07_controller(uuid,uuid,text,jsonb,uuid,text,text,bigint,text)','public.r12_discovery_owner_read(uuid,uuid,boolean)','public.r12_discovery_server(uuid,uuid,text,jsonb,text)'] loop
  d:=pg_get_functiondef(name::regprocedure);
  foreach v in array array['r12.discovery-adaptive','r12.discovery-owner-adaptive'] loop
   d:=replace(d,'='||quote_literal(v||'.1'),' in ('||quote_literal(v||'.1')||','||quote_literal(v||'.2')||')');
   d:=replace(d,'<>'||quote_literal(v||'.1'),' not in ('||quote_literal(v||'.1')||','||quote_literal(v||'.2')||')');
   -- Preserve IS DISTINCT FROM's fail-closed NULL behavior at attempt gates.
   d:=replace(d,'plan.content->>''format'' is distinct from '||quote_literal(v||'.1'),
    $gate$coalesce(plan.content->>'format','') not in ($gate$||quote_literal(v||'.1')||','||quote_literal(v||'.2')||')');
   d:=replace(d,'p.content->>''format'' is distinct from '||quote_literal(v||'.1'),
    $gate$coalesce(p.content->>'format','') not in ($gate$||quote_literal(v||'.1')||','||quote_literal(v||'.2')||')');
   -- Literal list members, never version values produced by a constructor.
   d:=replace(d,quote_literal(v||'.1')||','||quote_literal('r12.discovery-review.1'),quote_literal(v||'.1')||','||quote_literal(v||'.2')||','||quote_literal('r12.discovery-review.1'));
   d:=replace(d,quote_literal(v||'.1')||','||quote_literal('r12.discovery-source-scope.1'),quote_literal(v||'.1')||','||quote_literal(v||'.2')||','||quote_literal('r12.discovery-source-scope.1'));
  end loop;
  execute d;
 end loop;
end $etsy_shared_gates$;

do $etsy_mode$ declare d text;begin
 d:=pg_get_functiondef('private.r12_authority_validate()'::regprocedure);
 if position($replace$if (new.plan->>'format' in ('r12.discovery-adaptive.1','r12.discovery-adaptive.2'))$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: private.r12_authority_validate';end if;
 d:=replace(d,$replace$if (new.plan->>'format' in ('r12.discovery-adaptive.1','r12.discovery-adaptive.2'))$replace$,$replace$if s.origin='owner_adaptive' and ((new.plan->>'format'='r12.discovery-adaptive.2')
 is distinct from (s.amendment->>'version'='r12.discovery-owner-adaptive.2'))
 then raise exception 'r12_adaptive_cross_mode_replay';end if;
 if (new.plan->>'format' in ('r12.discovery-adaptive.1','r12.discovery-adaptive.2'))$replace$);
 execute d;
end $etsy_mode$;

do $etsy_mode$ declare d text;begin
 d:=pg_get_functiondef('public.r12_owner_adaptive_read(uuid,uuid,uuid)'::regprocedure);
 if position($replace$p.profile->>'version'='r12.owner-research-profile.2'$replace$ in d)=0 then raise exception 'r12_etsy_migration_source_changed: public.r12_owner_adaptive_read';end if;
 d:=replace(d,$replace$p.profile->>'version'='r12.owner-research-profile.2'$replace$,$replace$p.profile->>'version' in ('r12.owner-research-profile.2','r12.owner-research-profile.3')$replace$);
 execute d;
end $etsy_mode$;

do $etsy_constraints$ declare c record;d text;begin
 for c in select conname,conrelid,pg_get_constraintdef(oid) def from pg_constraint
  where contype='c' and conrelid in ('private.r12_discovery_scopes'::regclass,
   'private.r07_plans'::regclass,'private.r12_adaptive_planner_receipts'::regclass,
   'private.r12_adaptive_input_snapshots'::regclass) loop
  d:=c.def;
  d:=replace(d,'''r12.discovery-adaptive.1''::text]', '''r12.discovery-adaptive.1''::text, ''r12.discovery-adaptive.2''::text]');
  d:=replace(d,'''r12.discovery-owner-adaptive.1''::text]', '''r12.discovery-owner-adaptive.1''::text, ''r12.discovery-owner-adaptive.2''::text]');
  d:=replace(d,'= ''r12.discovery-owner-adaptive.1''::text', 'in (''r12.discovery-owner-adaptive.1''::text,''r12.discovery-owner-adaptive.2''::text)');
  d:=replace(d,'= ''r12.owner-adaptive-planner-preflight-input.1''::text', 'in (''r12.owner-adaptive-planner-preflight-input.1''::text,''r12.owner-adaptive-planner-preflight-input.2''::text)');
  d:=replace(d,'= ''r12.discovery-adaptive-inputs.1''::text', 'in (''r12.discovery-adaptive-inputs.1''::text,''r12.discovery-adaptive-inputs.2''::text)');
  if d is distinct from c.def then
   execute format('alter table %s drop constraint %I',c.conrelid::regclass,c.conname);
   execute format('alter table %s add constraint %I %s',c.conrelid::regclass,c.conname,d);
  end if;
 end loop;
end $etsy_constraints$;

-- The minimum is three actual calls in .2. The admission and activation
-- validators bind the maximum to the original 64-dispatch lifetime remainder.
alter table private.r12_adaptive_activations drop constraint r12_adaptive_activations_maximum_paid_calls_check;
alter table private.r12_adaptive_activations add constraint r12_adaptive_activations_maximum_paid_calls_check
 check(maximum_paid_calls between 3 and 64 and (content->>'version'='r12.adaptive-activation.2' or maximum_paid_calls>=5));

-- New helpers are private and create no browser-callable capability.
do $etsy_privileges$ declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='private' and (p.proname like '%\_etsy' escape '\' or p.proname like 'r12_adaptive_etsy_%') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
 end loop;
end $etsy_privileges$;
commit;
