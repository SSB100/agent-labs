-- Additive, definition-only owner-initial research lane. No production catalog,
-- enrollment, credential, scope, funding extension or provider effect is seeded.
begin;
create table private.r12_owner_profiles (
 id uuid primary key, profile jsonb not null, profile_hash text not null check(profile_hash=private.stage14_hash(profile)),
 pins jsonb not null, pins_hash text not null check(pins_hash=private.stage14_hash(pins)), created_at timestamptz not null default clock_timestamp()
);
create table private.r12_owner_profile_revocations(profile_id uuid primary key references private.r12_owner_profiles(id), reason text not null, created_at timestamptz not null default clock_timestamp());
create table private.r12_owner_funding_bindings (
 id uuid primary key default gen_random_uuid(), business_id uuid not null unique references public.businesses(id),
 category text not null default 'original_pod_tshirt' check(category='original_pod_tshirt'),
 kind text not null check(kind in ('legacy_research_root','r05_business')), authority_root_id uuid not null,
 original_semantic_goal_hash text, created_at timestamptz not null default clock_timestamp(),
 check((kind='r05_business' and authority_root_id=business_id and original_semantic_goal_hash is null) or (kind='legacy_research_root' and original_semantic_goal_hash ~ '^[a-f0-9]{64}$'))
);
create table private.r12_owner_grant_roots (
 id uuid primary key, business_id uuid not null references public.businesses(id), binding_id uuid not null references private.r12_owner_funding_bindings(id),
 maximum_scopes integer not null check(maximum_scopes>0), maximum_allocation_microunits bigint not null check(maximum_allocation_microunits between 1 and 9007199254740991),
 approval_hash text not null check(approval_hash ~ '^[a-f0-9]{64}$'),created_at timestamptz not null default clock_timestamp(), unique(business_id,binding_id)
);
create table private.r12_owner_bootstrap_grants (
 id uuid primary key, root_id uuid not null references private.r12_owner_grant_roots(id), business_id uuid not null references public.businesses(id),
 owner_id uuid not null, business_revision integer not null check(business_revision>0), business_hash text not null check(business_hash ~ '^[a-f0-9]{64}$'),
 foreign key(business_id,business_revision) references private.r04_business_versions(business_id,revision),
 profile_id uuid not null references private.r12_owner_profiles(id),
 maximum_scopes integer check(maximum_scopes>0), maximum_allocation_microunits bigint check(maximum_allocation_microunits between 1 and 9007199254740991),
 check((maximum_scopes is null)=(maximum_allocation_microunits is null)),
 server_key_hash text not null unique check(server_key_hash ~ '^[a-f0-9]{64}$'), approval_hash text not null check(approval_hash ~ '^[a-f0-9]{64}$'),
 valid_from timestamptz not null, valid_until timestamptz not null, created_at timestamptz not null default clock_timestamp(),
 check(valid_until>valid_from and valid_until<=valid_from+interval '31 days')
);
create table private.r12_owner_grant_revocations(grant_id uuid primary key references private.r12_owner_bootstrap_grants(id), reason text not null, created_at timestamptz not null default clock_timestamp());
create table private.r12_owner_setups (
 id uuid primary key, business_id uuid not null references public.businesses(id), goal_id uuid not null, owner_id uuid not null,
 scope_id uuid not null unique, profile_id uuid not null references private.r12_owner_profiles(id), grant_id uuid not null references private.r12_owner_bootstrap_grants(id),
 binding_id uuid not null references private.r12_owner_funding_bindings(id), installation_id uuid not null references public.installed_packs(id),
 policy_id uuid not null unique references private.r05_policies(id), policy_hash text not null, purpose_hash text not null,
 input jsonb not null, preview jsonb not null, setup_hash text not null check(setup_hash=private.stage14_hash(preview)),
 cutoff timestamptz not null, created_at timestamptz not null default clock_timestamp(),
 foreign key(goal_id,business_id) references private.r04_goal_state(goal_id,business_id)
);
create table private.r12_owner_funding_revisions (
 binding_id uuid not null references private.r12_owner_funding_bindings(id), revision integer not null check(revision>0),
 previous_hash text not null check(previous_hash ~ '^[a-f0-9]{64}$'), previous_maximum_microunits bigint not null,
 maximum_microunits bigint not null check(maximum_microunits>previous_maximum_microunits),
 committed_microunits bigint not null, policy_id uuid not null references private.r05_policies(id), owner_id uuid not null,
 content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'), created_at timestamptz not null default clock_timestamp(), primary key(binding_id,revision)
);
create table private.r12_owner_activations (
 setup_id uuid primary key references private.r12_owner_setups(id), business_id uuid not null references public.businesses(id),goal_id uuid not null,
 scope_id uuid not null unique, grant_root_id uuid not null references private.r12_owner_grant_roots(id), purpose_hash text not null,
 allocation_microunits bigint not null check(allocation_microunits between 1 and 2000000), funding_approval jsonb not null,
 created_at timestamptz not null default clock_timestamp(),unique(business_id,goal_id),unique(business_id,purpose_hash)
);
create table private.r12_owner_submissions(business_id uuid not null references public.businesses(id), id uuid not null, request_hash text not null, setup_id uuid not null references private.r12_owner_setups(id), operation text not null, primary key(business_id,id));
-- Tenant/Goal recent setup reads, including the Goal-optional catalog page.
create index r12_owner_setups_business_owner_goal_recent on private.r12_owner_setups(business_id,owner_id,goal_id,created_at desc,id desc);
create index r12_owner_setups_business_owner_recent on private.r12_owner_setups(business_id,owner_id,created_at desc,id desc);
-- Immutable revision-zero funding proof lookup uses the permanent binding.
create index r12_owner_setups_binding on private.r12_owner_setups(binding_id);
-- One latest eligible grant per profile; revocation finds affected Businesses.
create index r12_owner_grants_business_profile_recent on private.r12_owner_bootstrap_grants(business_id,profile_id,created_at desc,id);
create index r12_owner_grants_profile_business on private.r12_owner_bootstrap_grants(profile_id,business_id);
-- Cumulative count/allocation never resets across grant renewal IDs.
create index r12_owner_activations_grant_usage on private.r12_owner_activations(grant_root_id) include(allocation_microunits);

alter table private.r12_discovery_scopes add column origin text not null default 'legacy' check(origin in ('legacy','owner_initial'));
alter table private.r12_discovery_scopes add column owner_setup_id uuid references private.r12_owner_setups(id);
alter table private.r12_discovery_scopes alter column budget_authority_root_id drop not null;
alter table private.r12_discovery_scopes alter column prior_round_id drop not null;
alter table private.r12_discovery_scopes add constraint r12_owner_origin_exact check(
 (origin='legacy' and owner_setup_id is null and budget_authority_root_id is not null and prior_round_id is not null and amendment->>'version'<>'r12.discovery-owner-initial.1') or
 (origin='owner_initial' and owner_setup_id is not null and amendment->>'version'='r12.discovery-owner-initial.1' and
 ((amendment->'funding'->>'kind'='r05_business' and budget_authority_root_id is null and prior_round_id is null) or
 (amendment->'funding'->>'kind'='legacy_research_root' and budget_authority_root_id is not null and prior_round_id is not null))));

create function private.r12_owner_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op<>'INSERT' or current_user in ('anon','authenticated','service_role') then raise exception 'r12_owner_trusted_immutable_record_required' using errcode='42501';end if;
 -- Revocation serializes against the same Business-first dispatch/activation
 -- locks. A multi-Business catalog revocation takes a deterministic order.
 if tg_table_name='r12_owner_profile_revocations' then
 perform 1 from public.businesses b where b.id in(select g.business_id from private.r12_owner_bootstrap_grants g where g.profile_id=new.profile_id) order by b.id for update;
 perform 1 from private.r12_owner_profiles where id=new.profile_id for update;
 elsif tg_table_name='r12_owner_grant_revocations' then
 perform 1 from public.businesses b where b.id=(select business_id from private.r12_owner_bootstrap_grants where id=new.grant_id) for update;
 perform 1 from private.r12_owner_bootstrap_grants where id=new.grant_id for update;
 end if;
 return new;end $$;
DO $$ declare n text;begin foreach n in array array['r12_owner_profiles','r12_owner_profile_revocations','r12_owner_funding_bindings','r12_owner_grant_roots','r12_owner_bootstrap_grants','r12_owner_grant_revocations','r12_owner_setups','r12_owner_funding_revisions','r12_owner_activations','r12_owner_submissions'] loop
 execute format('alter table private.%I enable row level security',n);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);
 execute format('create trigger owner_immutable before insert or update or delete on private.%I for each row execute function private.r12_owner_immutable()',n);
 end loop;end $$;

-- Only reviewed catalog placeholders are substituted. Goal/Business prose is
-- deliberately not an input to this public-query renderer.
create function private.r12_owner_selection(p jsonb,market_key text,topic_key text) returns jsonb language plpgsql immutable set search_path='' as $$
declare m jsonb;t jsonb;q text;begin
 select value into m from jsonb_array_elements(p->'marketSets') v where v->>'key'=market_key;
 select value into t from jsonb_array_elements(p->'topics') v where v->>'key'=topic_key;
 if m is null or t is null then raise exception 'r12_owner_public_choice_unavailable';end if;
 q:=replace(replace(replace(p->>'queryTemplate','{{markets}}',(select string_agg(v->>'countryCode',', ' order by ord) from jsonb_array_elements(m->'markets') with ordinality a(v,ord))),'{{topic}}',t->>'queryTopic'),'{{audience}}',t->>'audience');
 if length(q) not between 20 and 800 or q<>btrim(q) or q ~ '[{}]' then raise exception 'r12_owner_public_query_invalid';end if;perform private.r04_safe(to_jsonb(q));
 return jsonb_build_object('markets',m->'markets','audience',t->>'audience','approvedQuery',q,'allowedDomains',p->'allowedDomains','excludedDomains',p->'excludedDomains');end $$;

create function private.r12_owner_profile_check(p private.r12_owner_profiles,at_time timestamptz) returns void language plpgsql set search_path='' as $$
declare v jsonb:=p.profile;i jsonb;m jsonb;t jsonb;d text;domains text[];excluded text[];begin
 perform private.r04_safe(v);perform private.r04_keys(v,array['version','id','title','purpose','marketSets','topics','queryTemplate','allowedDomains','excludedDomains','sourceReviews','independentReviewHash','purposeReviewHash','maximumRunMicrousd','validFrom','validUntil']);
 foreach d in array array['version','id','title','purpose','queryTemplate','independentReviewHash','purposeReviewHash','validFrom','validUntil'] loop if jsonb_typeof(v->d) is distinct from 'string' or v->>d is distinct from btrim(v->>d) then raise exception 'r12_owner_profile_type_invalid';end if;end loop;
 if jsonb_typeof(v->'maximumRunMicrousd') is distinct from 'number' or v->>'maximumRunMicrousd' !~ '^[1-9][0-9]{0,6}$' or not isfinite((v->>'validFrom')::timestamptz) or not isfinite((v->>'validUntil')::timestamptz) or (v->>'validUntil')::timestamptz<=(v->>'validFrom')::timestamptz then raise exception 'r12_owner_profile_type_invalid';end if;
 if p.id is null or v->>'version' is distinct from 'r12.owner-research-profile.1' or v->>'id' is distinct from p.id::text or p.profile_hash is distinct from private.stage14_hash(v)
 or v->>'independentReviewHash' !~ '^[a-f0-9]{64}$' or v->>'purposeReviewHash' !~ '^[a-f0-9]{64}$' or (v->>'maximumRunMicrousd')::bigint not between 1 and 2000000
 or length(v->>'title') not between 3 and 120 or length(v->>'purpose') not between 20 and 800
 or (v->>'validFrom')::timestamptz>at_time or (v->>'validUntil')::timestamptz<=at_time
 or exists(select 1 from private.r12_owner_profile_revocations r where r.profile_id=p.id and r.created_at<=at_time)
 then raise exception 'r12_owner_profile_unavailable';end if;
 if jsonb_array_length(v->'marketSets') not between 1 and 16 or jsonb_array_length(v->'topics') not between 1 and 32
 or (select count(*)<>count(distinct x->>'key') from jsonb_array_elements(v->'marketSets')x)
 or (select count(*)<>count(distinct x->>'key') from jsonb_array_elements(v->'topics')x)
 or not(v->>'queryTemplate' like '%{{markets}}%' and v->>'queryTemplate' like '%{{topic}}%' and v->>'queryTemplate' like '%{{audience}}%') then raise exception 'r12_owner_profile_choices_invalid';end if;
 for m in select value from jsonb_array_elements(v->'marketSets') loop
 perform private.r04_keys(m,array['key','label','markets']);if jsonb_typeof(m->'key') is distinct from 'string' or jsonb_typeof(m->'label') is distinct from 'string' or length(m->>'label') not between 2 and 120 or m->>'key' !~ '^[a-z][a-z0-9_-]{0,39}$' or jsonb_array_length(m->'markets') not between 1 and 4
 or (select count(*)<>count(distinct x->>'countryCode') from jsonb_array_elements(m->'markets')x) then raise exception 'r12_owner_markets_invalid';end if;
 for i in select value from jsonb_array_elements(m->'markets') loop perform private.r04_keys(i,array['countryCode','currency']);if exists(select 1 from jsonb_each(i)x where jsonb_typeof(x.value) is distinct from 'string') or i->>'countryCode' !~ '^[A-Z]{2}$' or i->>'currency' !~ '^[A-Z]{3}$' then raise exception 'r12_owner_markets_invalid';end if;end loop;
 for t in select value from jsonb_array_elements(v->'topics') loop perform private.r04_keys(t,array['key','label','audience','queryTopic']);if exists(select 1 from jsonb_each(t)x where jsonb_typeof(x.value) is distinct from 'string' or x.value#>>'{}' is distinct from btrim(x.value#>>'{}')) or length(t->>'label') not between 3 and 120 or t->>'key' !~ '^[a-z][a-z0-9_-]{0,39}$' or length(t->>'audience') not between 3 and 160 or length(t->>'queryTopic') not between 3 and 160 then raise exception 'r12_owner_topic_invalid';end if;perform private.r12_owner_selection(v,m->>'key',t->>'key');end loop;end loop;
 perform private.r04_strings(v->'allowedDomains',4);perform private.r04_strings(v->'excludedDomains',32);
 select array_agg(x order by x) into domains from jsonb_array_elements_text(v->'allowedDomains')x;select array_agg(x order by x) into excluded from jsonb_array_elements_text(v->'excludedDomains')x;
 if coalesce(cardinality(domains),0)<1 or to_jsonb(domains) is distinct from v->'allowedDomains' or to_jsonb(excluded) is distinct from v->'excludedDomains' or (array['etsy.com','etsy.me','etsystatic.com']<@excluded) is distinct from true
 or cardinality(domains)<>(select count(distinct x) from unnest(domains)x) or cardinality(excluded)<>(select count(distinct x) from unnest(excluded)x) then raise exception 'r12_owner_domains_invalid';end if;
 foreach d in array domains||excluded loop if d !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' or length(d)>253 or d like '%.local' or d like '%.internal' then raise exception 'r12_owner_domains_invalid';end if;end loop;
 if exists(select 1 from unnest(domains)a cross join unnest(excluded)e where a=e or a like '%.'||e or e like '%.'||a) or jsonb_array_length(v->'sourceReviews')<>cardinality(domains)
 or (select count(distinct x->>'domain') from jsonb_array_elements(v->'sourceReviews')x)<>cardinality(domains) then raise exception 'r12_owner_source_reviews_invalid';end if;
 for i in select value from jsonb_array_elements(v->'sourceReviews') loop perform private.r04_keys(i,array['domain','basis','reviewHash']);if exists(select 1 from jsonb_each(i)x where jsonb_typeof(x.value) is distinct from 'string') or not(i->>'domain'=any(domains)) or i->>'basis' is distinct from 'documented_api_factual_snippets' or i->>'reviewHash' !~ '^[a-f0-9]{64}$' then raise exception 'r12_owner_source_reviews_invalid';end if;end loop;
end $$;

create function private.r12_owner_quote_check(q jsonb,reviewed jsonb default null) returns void language plpgsql set search_path='' as $$
declare phase text;total bigint:=0;begin
 perform private.r04_safe(q);
 if q->>'version' is distinct from 'r12.discovery-quote.1' or q->'maximumCalls' is distinct from '5'::jsonb or q->'maximumCollections' is distinct from '1'::jsonb
 or q->'proposalOnly' is distinct from 'true'::jsonb or q->'dispatchAuthorized' is distinct from 'false'::jsonb or q->>'quoteHash' is distinct from private.stage14_hash(q-array['quoteHash','verifiedAt','validUntil'])
 or jsonb_typeof(q->'verifiedAt') is distinct from 'string' or jsonb_typeof(q->'validUntil') is distinct from 'string' or not isfinite((q->>'verifiedAt')::timestamptz) or not isfinite((q->>'validUntil')::timestamptz) or (q->>'verifiedAt')::timestamptz>clock_timestamp() or (q->>'validUntil')::timestamptz<=clock_timestamp() or (q->>'validUntil')::timestamptz-(q->>'verifiedAt')::timestamptz<>interval '5 minutes'
 or q->'retention' is distinct from '{"inference":"no_training_zdr","search":"query_retention_improvement_training_possible","schemas":"static_nonprivate_schema_only"}'::jsonb
 or q->'luna'->>'canonicalModelId' is distinct from 'openai/gpt-5.6-luna-20260709' or q->'luna'->'acceptedResponseModelIds' is distinct from '["openai/gpt-5.6-luna","openai/gpt-5.6-luna-20260709"]'::jsonb
 or q->'reviewer'->>'canonicalModelId' is distinct from 'anthropic/claude-4.5-haiku-20251001' or q->'reviewer'->'acceptedResponseModelIds' is distinct from '["anthropic/claude-haiku-4.5","anthropic/claude-4.5-haiku-20251001"]'::jsonb
 or q->'luna'->>'modelId' is distinct from 'openai/gpt-5.6-luna' or q->'luna'->>'endpoint' is distinct from 'azure/us' or q->'luna'->>'providerName' is distinct from 'Azure'
 or q->'reviewer'->>'modelId' is distinct from 'anthropic/claude-haiku-4.5' or q->'reviewer'->>'endpoint' is distinct from 'amazon-bedrock/us' or q->'reviewer'->>'providerName' is distinct from 'Amazon Bedrock'
 then raise exception 'r12_owner_fresh_quote_required';end if;
 perform private.r04_keys(q->'ceilings',array['plan','search1','select1','strategy','review']);
 foreach phase in array array['plan','search1','select1','strategy','review'] loop
 if jsonb_typeof(q->'ceilings'->phase) is distinct from 'number' or q->'ceilings'->>phase !~ '^[1-9][0-9]{0,6}$' then raise exception 'r12_owner_quote_bounds_invalid';end if;
 total:=total+(q->'ceilings'->>phase)::bigint;
 if reviewed is not null and (q->'ceilings'->>phase)::bigint>(reviewed->'ceilings'->>phase)::bigint then raise exception 'r12_owner_quote_exceeds_reviewed';end if;end loop;
 if total not between 1 and 2000000 or q->'maximumMicrousd' is distinct from to_jsonb(total) then raise exception 'r12_owner_quote_bounds_invalid';end if;
end $$;

-- Accounting has one authority root. Native funding is the actual R05 cap;
-- legacy accounting delegates lineage/charge reconstruction to the unchanged
-- original ledger and substitutes only this lane's append-only ceiling.
create function private.r12_owner_funding(binding private.r12_owner_funding_bindings, pinned jsonb default null, historical_prior uuid default null, historical boolean default false) returns jsonb language plpgsql set search_path='' as $$
declare prior public.product_experiments;v private.r12_owner_funding_revisions;cap private.r05_cap_versions;b jsonb;revision integer;maximum bigint;h text;begin
 if binding.id is null then raise exception 'r12_owner_funding_binding_required';end if;
 if binding.kind='legacy_research_root' then
 select * into prior from public.product_experiments e where e.business_id=binding.business_id and e.discovery_version='pod-discovery-2.0' and e.parent_discovery_id is null and e.candidate_id is null and e.variables->>'budgetAuthorityRootId'=binding.authority_root_id::text and (not historical or e.id=historical_prior) order by e.created_at desc,e.id desc limit 1;
 if prior.id is null or prior.status not in ('failed','completed') or prior.variables->>'semanticGoalHash' is distinct from binding.original_semantic_goal_hash then raise exception 'r12_owner_original_funding_mismatch';end if;
 b:=private.stage13v2_budget_authority(prior.id,false);
 select * into v from private.r12_owner_funding_revisions where binding_id=binding.id order by private.r12_owner_funding_revisions.revision desc limit 1;
 revision:=coalesce(v.revision,0);maximum:=coalesce(v.maximum_microunits,(b->>'maximumMicrousd')::bigint);
 h:=coalesce(v.content_hash,private.stage14_hash(jsonb_build_object('bindingId',binding.id,'revision',0,'maximumMicrounits',maximum::text)));
 else
 if not historical and exists(select 1 from public.product_experiments e where e.business_id=binding.business_id and e.discovery_version='pod-discovery-2.0' and e.parent_discovery_id is null and e.candidate_id is null) then raise exception 'r12_owner_original_root_binding_required';end if;
 select * into cap from private.r05_cap_versions where business_id=binding.business_id and currency='USD' order by private.r05_cap_versions.revision desc limit 1;
 revision:=coalesce(cap.revision,0);maximum:=coalesce(cap.maximum_microunits,0);
 h:=private.stage14_hash(jsonb_build_object('bindingId',binding.id,'revision',revision,'maximumMicrounits',maximum::text));
 select jsonb_build_object('committedMicrousd',coalesce(sum(held),0),'knownActualMicrousd',coalesce(sum(held) filter(where not pending),0),'pendingExposureMicrousd',coalesce(sum(held) filter(where pending),0),'hasUncertainCosts',coalesce(bool_or(pending),false)) into b from (
 select case when r.id is not null and settled.actual is null then greatest(e.held,r.liability_microunits) else e.held end held,
 e.unknown or (r.id is not null and settled.actual is null) pending
 from private.r05_exposure(binding.business_id)e left join private.r05_requests r on r.business_id=binding.business_id and r.source_key=e.source_key and r.payload->'accounting'->>'kind'='r05'
 left join lateral(select max(actual_microunits) actual from private.r05_settlements z where z.request_id=r.id and z.business_id=r.business_id and z.provider_request_id is not null) settled on true where e.currency='USD') costs;
 end if;
 if pinned is not null then
 if binding.kind='legacy_research_root' and not((pinned->>'revision')::integer=0 and pinned->>'hash'=private.stage14_hash(jsonb_build_object('bindingId',binding.id,'revision',0,'maximumMicrounits',pinned->>'maximumMicrounits')) and exists(select 1 from private.r12_owner_setups os where os.binding_id=binding.id and os.preview->'funding'->'revision'='0'::jsonb and os.preview->'funding'->>'hash'=pinned->>'hash' and os.preview->'funding'->>'maximumMicrounits'=pinned->>'maximumMicrounits'))
 and not exists(select 1 from private.r12_owner_funding_revisions r where r.binding_id=binding.id and r.revision=(pinned->>'revision')::integer and r.content_hash=pinned->>'hash' and r.maximum_microunits=(pinned->>'maximumMicrounits')::bigint) then raise exception 'r12_owner_funding_pin_invalid';end if;
 if binding.kind='r05_business' and not exists(select 1 from private.r05_cap_versions c where c.business_id=binding.business_id and c.currency='USD' and c.revision=(pinned->>'revision')::integer and c.maximum_microunits=(pinned->>'maximumMicrounits')::bigint and pinned->>'hash'=private.stage14_hash(jsonb_build_object('bindingId',binding.id,'revision',c.revision,'maximumMicrounits',c.maximum_microunits::text))) then raise exception 'r12_owner_funding_pin_invalid';end if;
 maximum:=least(maximum,(pinned->>'maximumMicrounits')::bigint);revision:=(pinned->>'revision')::integer;h:=pinned->>'hash';end if;
 return jsonb_build_object('binding',jsonb_build_object('kind',binding.kind,'bindingId',binding.id,'authorityRootId',binding.authority_root_id,'priorRoundId',prior.id,'originalSemanticGoalHash',binding.original_semantic_goal_hash),
 'revision',revision,'hash',h,'maximumMicrounits',maximum::text,'committedMicrounits',b->>'committedMicrousd','pendingMicrounits',b->>'pendingExposureMicrousd','hasUnknown',b->'hasUncertainCosts',
 'budget',b||jsonb_build_object('accounting','known_final_actual_plus_pending_reserved_exposure','authorityRootId',binding.authority_root_id,'businessId',binding.business_id,'maximumMicrousd',maximum,'remainingMicrousd',greatest(0,maximum-(b->>'committedMicrousd')::bigint)));
end $$;

create function private.r12_owner_pins_check(p private.r12_owner_profiles) returns void language plpgsql set search_path='' as $$
declare pins jsonb:=p.pins;phase text;wd public.worker_definitions;fd public.workflow_definitions;k text;begin
 perform 1 from public.packs where id in(select (v->>'id')::uuid from jsonb_array_elements(pins->'snapshot'->'releases')v) order by id for share;
 perform 1 from public.workflow_definitions where id=(pins->>'workflowDefinitionId')::uuid for share;
 perform 1 from public.worker_definitions where id in(select (v.value->>'id')::uuid from jsonb_each(pins->'workers')v) order by id for share;
 perform private.r04_keys(pins,array['packId','snapshot','snapshotHash','workflowDefinitionId','workflowHash','plannerWorkerDefinitionId','workers','executionReviewHash','eligibilityReviewHash','policyInterpretationHash','knowledgeValidUntil']);
 if p.pins_hash is distinct from private.stage14_hash(pins) or pins->'snapshot' is distinct from jsonb_build_object('rootPackId',(pins->>'packId')::uuid,'releases',private.stage10_resolve((pins->>'packId')::uuid,true)) or pins->>'snapshotHash' is distinct from private.r04_hash(pins->'snapshot') then raise exception 'r12_owner_catalog_changed';end if;
 foreach k in array array['executionReviewHash','eligibilityReviewHash','policyInterpretationHash'] loop if jsonb_typeof(pins->k) is distinct from 'string' or pins->>k !~ '^[a-f0-9]{64}$' then raise exception 'r12_owner_review_required';end if;end loop;
 select * into fd from public.workflow_definitions where id=(pins->>'workflowDefinitionId')::uuid;
 if fd.id is null or private.r04_hash(to_jsonb(fd)) is distinct from pins->>'workflowHash' or fd.workflow_key<>'product.discovery-v2.one' or fd.version<>'1.0.0' or fd.pack_id<>(pins->>'packId')::uuid then raise exception 'r12_owner_workflow_changed';end if;
 perform private.r04_keys(pins->'workers',array['plan','search1','select1','strategy','review']);
 foreach phase in array array['plan','search1','select1','strategy','review'] loop
 perform private.r04_keys(pins->'workers'->phase,array['id','hash']);select * into wd from public.worker_definitions where id=(pins->'workers'->phase->>'id')::uuid;
 if wd.id is null or private.r04_hash(to_jsonb(wd)) is distinct from pins->'workers'->phase->>'hash' or wd.worker_key is distinct from 'product.discovery-v2.'||(case when phase in ('search1','select1') then 'research' else phase end) or wd.version<>'1.0.0' or not exists(select 1 from jsonb_array_elements(pins->'snapshot'->'releases') rel where rel->>'id'=wd.pack_id::text) then raise exception 'r12_owner_worker_changed';end if;end loop;
 if pins->>'plannerWorkerDefinitionId' is distinct from pins->'workers'->'plan'->>'id' or pins->'workers'->'review'->>'id'=any(array[pins->'workers'->'plan'->>'id',pins->'workers'->'search1'->>'id',pins->'workers'->'select1'->>'id',pins->'workers'->'strategy'->>'id']) then raise exception 'r12_owner_independent_review_required';end if;
end $$;

create function private.r12_owner_setup_receipt(s private.r12_owner_setups) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('businessId',s.business_id,'goalId',s.goal_id,'setupId',s.id,'setupHash',s.setup_hash,'scopeId',s.scope_id,'grantId',s.grant_id,'submissionId',s.input->>'submissionId','policyId',s.policy_id,'policyHash',s.policy_hash,
 'confirmed',exists(select 1 from private.r05_confirmations where policy_id=s.policy_id),'activated',exists(select 1 from private.r12_owner_activations where setup_id=s.id),'stopped',exists(select 1 from private.r05_revocations where policy_id=s.policy_id),'preview',s.preview)
$$;

create function public.r12_owner_research_read(p_business_id uuid,p_goal_id uuid default null,p_setup_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare br private.r04_business_versions;g private.r04_goal_versions;cap private.r05_cap_versions;binding private.r12_owner_funding_bindings;exp jsonb;profiles jsonb;setups jsonb;begin
 if auth.uid() is null or private.is_business_owner(p_business_id) is distinct from true then raise exception 'r12_owner_required' using errcode='42501';end if;
 if p_goal_id is not null and not exists(select 1 from public.goals where id=p_goal_id and business_id=p_business_id) then raise exception 'r12_owner_goal_unavailable';end if;
 if p_setup_id is not null and not exists(select 1 from private.r12_owner_setups where id=p_setup_id and business_id=p_business_id and owner_id=auth.uid() and (p_goal_id is null or goal_id=p_goal_id)) then raise exception 'r12_owner_setup_unavailable';end if;
 select v.* into br from private.r04_business_versions v join private.r04_business_state s using(business_id,revision) where v.business_id=p_business_id;
 select v.* into g from private.r04_goal_versions v join private.r04_goal_state s using(business_id,goal_id,revision) where v.business_id=p_business_id and v.goal_id=p_goal_id;
 select * into cap from private.r05_cap_versions where business_id=p_business_id and currency='USD' order by revision desc limit 1;
 select * into binding from private.r12_owner_funding_bindings where business_id=p_business_id;
 select jsonb_build_object('committed',coalesce(sum(held),0)::text,'unknown',coalesce(bool_or(unknown),false)) into exp from private.r05_exposure(p_business_id) where currency='USD';
 select coalesce(jsonb_agg(x),'[]'::jsonb) into profiles from (select distinct on (p.id) jsonb_build_object('profile',p.profile,'profileHash',p.profile_hash,'grantId',gr.id) x
 from private.r12_owner_profiles p join private.r12_owner_bootstrap_grants gr on gr.profile_id=p.id join private.r12_owner_grant_roots rt on rt.id=gr.root_id and rt.business_id=gr.business_id and rt.binding_id=binding.id
 where gr.business_id=p_business_id and gr.owner_id=auth.uid() and gr.business_revision=br.revision and gr.business_hash=br.content_hash and gr.valid_from<=clock_timestamp() and gr.valid_until>clock_timestamp()+interval '30 minutes'
 and (p.profile->>'validFrom')::timestamptz<=clock_timestamp() and (p.profile->>'validUntil')::timestamptz>clock_timestamp()+interval '30 minutes'
 and not exists(select 1 from private.r12_owner_profile_revocations where profile_id=p.id) and not exists(select 1 from private.r12_owner_grant_revocations where grant_id=gr.id)
 and (select count(*) from private.r12_owner_activations a where a.grant_root_id=rt.id)<coalesce(gr.maximum_scopes,rt.maximum_scopes)
 and (select coalesce(sum(a.allocation_microunits),0) from private.r12_owner_activations a where a.grant_root_id=rt.id)<coalesce(gr.maximum_allocation_microunits,rt.maximum_allocation_microunits)
 order by p.id,gr.created_at desc,gr.id limit 33) q;
 select coalesce(jsonb_agg(private.r12_owner_setup_receipt(s)),'[]'::jsonb) into setups from (select * from private.r12_owner_setups where business_id=p_business_id and owner_id=auth.uid() and (p_goal_id is null or goal_id=p_goal_id) and (p_setup_id is null or id=p_setup_id) order by created_at desc,id desc limit 21)s;
 return jsonb_build_object('profiles',coalesce((select jsonb_agg(v order by ord) from jsonb_array_elements(profiles) with ordinality x(v,ord) where ord<=32),'[]'::jsonb),'profilesTruncated',jsonb_array_length(profiles)>32,'business',case when br.business_id is null then null else jsonb_build_object('id',p_business_id,'revision',br.revision,'hash',br.content_hash,'capRevision',coalesce(cap.revision,0),'maximumMicrounits',coalesce(cap.maximum_microunits,0)::text,'committedMicrounits',exp->>'committed','hasUnknown',exp->'unknown','paused',private.r05_paused(p_business_id,'business',p_business_id) or br.preference<>'setup') end,
 'goal',case when g.goal_id is null then null else jsonb_build_object('id',g.goal_id,'businessId',g.business_id,'revision',g.revision,'hash',g.content_hash,'preference',g.preference,'content',g.content,'initialRunExists',exists(select 1 from private.r12_owner_activations where business_id=p_business_id and goal_id=g.goal_id) or exists(select 1 from private.r07_plans where business_id=p_business_id and goal_id=g.goal_id)) end,
 'funding',case when p_setup_id is not null then (select preview->'funding' from private.r12_owner_setups where id=p_setup_id) when binding.id is null then null else private.r12_owner_funding(binding) end,'setups',coalesce((select jsonb_agg(v order by ord) from jsonb_array_elements(setups) with ordinality x(v,ord) where ord<=20),'[]'::jsonb),'setupsTruncated',jsonb_array_length(setups)>20);
end $$;

-- A bootstrap approval permits configuration only. This distinct per-run
-- approval binds the genuine owner-confirmed policy to the exact visible setup.
create function private.r12_owner_confirmation_hash(s private.r12_owner_setups) returns text language sql stable set search_path='' as $$
 select private.stage14_hash(jsonb_build_object('version','r12.owner-initial-confirmation.1','businessId',s.business_id,'goalId',s.goal_id,'setupId',s.id,'setupHash',s.setup_hash,'policyId',s.policy_id,'policyHash',s.policy_hash,'confirmation',to_jsonb(c)))
 from private.r05_confirmations c join private.r05_policies p on p.id=c.policy_id and p.business_id=c.business_id
 where c.policy_id=s.policy_id and c.business_id=s.business_id and c.actor_id=s.owner_id and p.actor_id=s.owner_id and p.content_hash=s.policy_hash
$$;

-- The sole trusted resolver for native owner scope/intent/funding. Historical
-- variants never enter this function. Receipt reconstruction supplies the
-- original dispatch instant; current dispatch checks lock Business then root.
create function private.r12_owner_scope_resolve(s private.r12_discovery_scopes,at_time timestamptz,require_current boolean default false) returns jsonb language plpgsql set search_path='' as $$
declare setup private.r12_owner_setups;profile private.r12_owner_profiles;gr private.r12_owner_bootstrap_grants;binding private.r12_owner_funding_bindings;funding jsonb;selection jsonb;a jsonb:=s.amendment;begin
 if s.origin is distinct from 'owner_initial' or a->>'version' is distinct from 'r12.discovery-owner-initial.1' then raise exception 'r12_owner_scope_required';end if;
 select * into setup from private.r12_owner_setups where id=s.owner_setup_id and business_id=s.business_id and goal_id=s.goal_id and scope_id=s.id;
 select * into profile from private.r12_owner_profiles where id=setup.profile_id;select * into gr from private.r12_owner_bootstrap_grants where id=setup.grant_id;
 select * into binding from private.r12_owner_funding_bindings where id=setup.binding_id and business_id=s.business_id;
 if require_current then perform 1 from public.businesses where id=s.business_id and owner_user_id=setup.owner_id for update;else perform 1 from public.businesses where id=s.business_id and owner_user_id=setup.owner_id;end if;
 if not found then raise exception 'r12_owner_changed';end if;
 if require_current and binding.kind='legacy_research_root' then perform 1 from public.product_experiments where id=binding.authority_root_id and business_id=s.business_id for update;end if;
 perform private.r04_keys(a,array['version','id','businessId','goalId','goalRevision','goalHash','businessRevision','businessHash','setupId','setupHash','profile','profileHash','selection','funding','fundingApproval','intent','allowedDomains','excludedDomains','approvedQuery','approvalHash','independentReviewHash','createdAt','expiresAt']);
 if setup.id is null or profile.id is null or binding.id is null or gr.id is null or a->>'id' is distinct from s.id::text or a->>'businessId' is distinct from s.business_id::text or a->>'goalId' is distinct from s.goal_id::text
 or a->>'setupId' is distinct from setup.id::text or a->>'setupHash' is distinct from setup.setup_hash or s.amendment_hash is distinct from private.stage14_hash(a)
 or a->'profile' is distinct from profile.profile or a->>'profileHash' is distinct from profile.profile_hash or a->>'approvalHash' is distinct from private.r12_owner_confirmation_hash(setup) or a->>'independentReviewHash' is distinct from profile.profile->>'independentReviewHash'
 or a->'selection' is distinct from setup.preview->'selection' or a->'goalRevision' is distinct from setup.preview->'goalRevision' or a->'goalHash' is distinct from setup.preview->'goalHash' or a->'businessRevision' is distinct from setup.preview->'businessRevision' or a->'businessHash' is distinct from setup.preview->'businessHash'
 or (a->>'createdAt')::timestamptz>at_time or (a->>'expiresAt')::timestamptz<=at_time or (a->>'expiresAt')::timestamptz<>setup.cutoff or gr.business_id<>s.business_id or gr.owner_id<>setup.owner_id or gr.profile_id<>profile.id
 or gr.business_revision<>(a->>'businessRevision')::integer or gr.business_hash is distinct from a->>'businessHash'
 or gr.valid_from>at_time or gr.valid_until<setup.cutoff or exists(select 1 from private.r12_owner_grant_revocations r where r.grant_id=gr.id and r.created_at<=at_time)
 then raise exception 'r12_owner_scope_binding_invalid';end if;
 perform private.r12_owner_profile_check(profile,at_time);
 selection:=private.r12_owner_selection(profile.profile,a->'selection'->>'marketSetKey',a->'selection'->>'topicKey');
 if a->'allowedDomains' is distinct from selection->'allowedDomains' or a->'excludedDomains' is distinct from selection->'excludedDomains' or a->'approvedQuery' is distinct from selection->'approvedQuery'
 or a->'funding' is distinct from setup.preview->'funding'->'binding' or a->'intent' is distinct from jsonb_build_object('version','pod-discovery-2.0','id',s.id,'businessId',s.business_id,'objective',setup.preview->>'objective','comparisonUniverse',jsonb_build_object('productType','original_pod_tshirt','markets',selection->'markets','audiences',jsonb_build_array(selection->>'audience'),'sourceDomains',selection->'allowedDomains','selectionQuestion',selection->>'approvedQuery'),'limits',jsonb_build_object('maximumAlternatives',3,'maximumNewCollections',1,'maximumMicrousd',(setup.preview->'quote'->>'maximumMicrousd')::bigint,'maximumGenerations',1),'expiresAt',a->'expiresAt')
 or (binding.kind='legacy_research_root' and (s.budget_authority_root_id is distinct from binding.authority_root_id or s.prior_round_id is distinct from (a->'funding'->>'priorRoundId')::uuid)) or (binding.kind='r05_business' and (s.budget_authority_root_id is not null or s.prior_round_id is not null)) then raise exception 'r12_owner_scope_intent_invalid';end if;
 funding:=private.r12_owner_funding(binding,a->'fundingApproval',s.prior_round_id,not require_current);
 if require_current then
 if not exists(select 1 from private.r04_goal_state st join private.r04_goal_versions gv using(goal_id,business_id,revision) where gv.business_id=s.business_id and gv.goal_id=s.goal_id and gv.revision=(a->>'goalRevision')::integer and gv.content_hash=a->>'goalHash' and gv.preference='ready')
 or not exists(select 1 from private.r04_business_state st join private.r04_business_versions bv using(business_id,revision) where bv.business_id=s.business_id and bv.revision=(a->>'businessRevision')::integer and bv.content_hash=a->>'businessHash' and bv.preference='setup')
 or exists(select 1 from private.r05_revocations where policy_id=setup.policy_id) or private.r05_paused(s.business_id,'business',s.business_id) or private.r05_paused(s.business_id,'quest',s.goal_id)
 or (binding.kind='legacy_research_root' and funding->'binding'->'priorRoundId' is distinct from a->'funding'->'priorRoundId') then raise exception 'r12_owner_scope_changed';end if;
 perform private.r12_owner_pins_check(profile);end if;
 return jsonb_build_object('intent',a->'intent','funding',funding,'budget',funding->'budget','setupId',setup.id);
end $$;

create function public.r12_owner_research_server(p_business_id uuid,p_operation text,p_payload jsonb,p_server_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare input jsonb;q jsonb;gr private.r12_owner_bootstrap_grants;rt private.r12_owner_grant_roots;profile private.r12_owner_profiles;binding private.r12_owner_funding_bindings;
 goal private.r04_goal_versions;br private.r04_business_versions;cap private.r05_cap_versions;setup private.r12_owner_setups;old private.r12_owner_submissions;policy private.r05_policies;installed public.installed_packs;
 funding jsonb;selected jsonb;preview jsonb;ops jsonb:='[]';steps jsonb:='[]';policy_body jsonb;proposed jsonb;plan jsonb;amendment jsonb;approval jsonb;revision_body jsonb;
 sid uuid;iid uuid;setup_id uuid;submission uuid;h text;purpose_digest text;phase text;operation_key text;adapter_key text;purpose text;data_classes jsonb;model text;amount bigint;bytes integer;tokens integer;ord integer:=0;
 committed bigint;unknown boolean;maximum bigint;research_maximum bigint;stamp timestamptz:=date_trunc('milliseconds',clock_timestamp());cutoff timestamptz;dispatch_until timestamptz;receipt_until timestamptz;
 phase_keys text[]:=array['plan','search1','select1','strategy','review'];begin
 perform private.r05_owner(p_business_id);stamp:=date_trunc('milliseconds',clock_timestamp());perform private.r04_safe(p_payload);
 if p_operation='stop_scope' then
 perform private.r04_keys(p_payload,array['scopeId','submissionId']);submission:=(p_payload->>'submissionId')::uuid;
 if submission is null or jsonb_typeof(p_payload->'scopeId') is distinct from 'string' then raise exception 'r12_owner_submission_required';end if;
 select * into setup from private.r12_owner_setups where scope_id=(p_payload->>'scopeId')::uuid and business_id=p_business_id;
 if setup.id is null then return jsonb_build_object('matched',false);end if;
 h:=private.stage14_hash(jsonb_build_object('operation',p_operation,'payload',p_payload));
 select * into old from private.r12_owner_submissions where business_id=p_business_id and id=submission;
 if old.id is not null and (old.request_hash<>h or old.operation<>p_operation or old.setup_id<>setup.id) then raise exception 'r12_owner_idempotency_conflict';end if;
 perform public.r05_policy_owner(p_business_id,'revoke',jsonb_build_object('policyId',setup.policy_id,'policyHash',setup.policy_hash),submission);
 if old.id is null then insert into private.r12_owner_submissions values(p_business_id,submission,h,setup.id,p_operation);end if;
 return jsonb_build_object('matched',true,'stopped',true,'scopeId',setup.scope_id);end if;
 if p_operation is null or p_operation not in ('prepare','confirm','stop') then raise exception 'r12_owner_operation_unavailable';end if;
 if p_operation='prepare' then
 perform private.r04_keys(p_payload,array['input','quote']);input:=p_payload->'input';q:=p_payload->'quote';
 perform private.r04_keys(input,array['businessId','goalId','goalRevision','profileId','profileHash','grantId','marketSetKey','topicKey','businessLifetimeLimitMicrounits','researchLifetimeLimitMicrounits','submissionId']);
 if exists(select 1 from jsonb_each(input)x where x.key<>'goalRevision' and jsonb_typeof(x.value) is distinct from 'string') or jsonb_typeof(input->'goalRevision') is distinct from 'number' or input->>'goalRevision' !~ '^[1-9][0-9]{0,8}$'
 or input->>'profileHash' !~ '^[a-f0-9]{64}$' or input->>'marketSetKey' !~ '^[a-z][a-z0-9_-]{0,39}$' or input->>'topicKey' !~ '^[a-z][a-z0-9_-]{0,39}$' then raise exception 'r12_owner_input_invalid';end if;
 if input->>'businessId' is distinct from p_business_id::text then raise exception 'r12_owner_business_mismatch';end if;
 submission:=(input->>'submissionId')::uuid;select * into gr from private.r12_owner_bootstrap_grants where id=(input->>'grantId')::uuid;
 else
 perform private.r04_keys(p_payload,case when p_operation='stop' then array['setupId','setupHash','submissionId'] else array['setupId','setupHash','submissionId','controllerKeyHash','admissionKeyHash','quote'] end);
 submission:=(p_payload->>'submissionId')::uuid;select * into setup from private.r12_owner_setups where id=(p_payload->>'setupId')::uuid and business_id=p_business_id and owner_id=auth.uid() and setup_hash=p_payload->>'setupHash';
 if setup.id is null then raise exception 'r12_owner_exact_setup_required';end if;input:=setup.input;q:=p_payload->'quote';select * into gr from private.r12_owner_bootstrap_grants where id=setup.grant_id;end if;
 if submission is null then raise exception 'r12_owner_submission_required';end if;
 if p_operation<>'stop' and (gr.id is null or gr.business_id<>p_business_id or gr.owner_id<>auth.uid() or length(coalesce(p_server_key,''))<32 or gr.server_key_hash is distinct from encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex')) then raise exception 'r12_owner_bootstrap_capability_required' using errcode='42501';end if;
 h:=private.stage14_hash(jsonb_build_object('operation',p_operation,'payload',p_payload-'quote'));select * into old from private.r12_owner_submissions where business_id=p_business_id and id=submission;
 if old.id is not null then if old.request_hash<>h or old.operation<>p_operation then raise exception 'r12_owner_idempotency_conflict';end if;select * into setup from private.r12_owner_setups where id=old.setup_id and business_id=p_business_id and owner_id=auth.uid();if setup.id is null then raise exception 'r12_owner_changed';end if;return private.r12_owner_setup_receipt(setup)||jsonb_build_object('replayed',true);end if;
 if p_operation='stop' then
 perform public.r05_policy_owner(p_business_id,'revoke',jsonb_build_object('policyId',setup.policy_id,'policyHash',setup.policy_hash),submission);
 insert into private.r12_owner_submissions values(p_business_id,submission,h,setup.id,p_operation);return private.r12_owner_setup_receipt(setup);end if;
 select * into rt from private.r12_owner_grant_roots where id=gr.root_id and business_id=p_business_id for update;
 select * into binding from private.r12_owner_funding_bindings where id=rt.binding_id and business_id=p_business_id;
 if rt.id is null or binding.id is null or gr.valid_from>stamp or gr.valid_until<=stamp or exists(select 1 from private.r12_owner_grant_revocations where grant_id=gr.id) then raise exception 'r12_owner_grant_unavailable';end if;
 if binding.kind='legacy_research_root' then perform 1 from public.product_experiments where id=binding.authority_root_id and business_id=p_business_id for update;if not found then raise exception 'r12_owner_funding_unavailable';end if;end if;
 select * into profile from private.r12_owner_profiles where id=gr.profile_id;perform private.r12_owner_profile_check(profile,stamp);perform private.r12_owner_pins_check(profile);
 if input->>'profileId' is distinct from profile.id::text or input->>'profileHash' is distinct from profile.profile_hash then raise exception 'r12_owner_profile_changed';end if;
 select v.* into goal from private.r04_goal_versions v join private.r04_goal_state s using(goal_id,business_id,revision) where v.goal_id=(input->>'goalId')::uuid and v.business_id=p_business_id;
 select v.* into br from private.r04_business_versions v join private.r04_business_state s using(business_id,revision) where v.business_id=p_business_id;
 select * into cap from private.r05_cap_versions where business_id=p_business_id and currency='USD' order by revision desc limit 1;
 select coalesce(sum(held),0),coalesce(bool_or(e.unknown),false) into committed,unknown from private.r05_exposure(p_business_id)e where currency='USD';
 funding:=private.r12_owner_funding(binding);selected:=private.r12_owner_selection(profile.profile,input->>'marketSetKey',input->>'topicKey');
 if goal.goal_id is null or goal.revision<>(input->>'goalRevision')::integer or goal.preference<>'ready' or br.business_id is null or br.preference<>'setup' or goal.content->'ambiguities' is distinct from '[]'::jsonb then raise exception 'r12_owner_goal_changed';end if;
 if gr.business_revision<>br.revision or gr.business_hash is distinct from br.content_hash then raise exception 'r12_owner_reviewed_business_changed';end if;
 if private.r05_paused(p_business_id,'business',p_business_id) or private.r05_paused(p_business_id,'quest',goal.goal_id) then raise exception 'r12_owner_scope_paused';end if;
 if unknown or funding->'hasUnknown' is distinct from 'false'::jsonb or (funding->>'pendingMicrounits')::bigint<>0 then raise exception 'r12_owner_unresolved_liability';end if;
 if exists(select 1 from private.r12_owner_activations where business_id=p_business_id and goal_id=goal.goal_id) or exists(select 1 from private.r07_plans where business_id=p_business_id and goal_id=goal.goal_id) then
 if p_operation='confirm' and exists(select 1 from private.r12_owner_activations oa where oa.setup_id=setup.id) then return private.r12_owner_setup_receipt(setup);end if;
 raise exception 'r12_owner_initial_run_already_exists';end if;
 maximum:=private.r05_money(input->'businessLifetimeLimitMicrounits');research_maximum:=private.r05_money(input->'researchLifetimeLimitMicrounits');
 perform private.r12_owner_quote_check(q,case when p_operation='confirm' then setup.preview->'quote' else null end);
 amount:=case when p_operation='confirm' then (setup.preview->'quote'->>'maximumMicrousd')::bigint else (q->>'maximumMicrousd')::bigint end;
 if amount>(profile.profile->>'maximumRunMicrousd')::bigint or maximum<committed+amount or research_maximum<(funding->>'committedMicrounits')::bigint+amount
 or research_maximum<(funding->>'maximumMicrounits')::bigint or (binding.kind='r05_business' and research_maximum<>maximum) then raise exception 'r12_owner_funding_limit_insufficient';end if;
 if (select count(*) from private.r12_owner_activations where grant_root_id=rt.id)>=coalesce(gr.maximum_scopes,rt.maximum_scopes) or (select coalesce(sum(allocation_microunits),0) from private.r12_owner_activations where grant_root_id=rt.id)+amount>coalesce(gr.maximum_allocation_microunits,rt.maximum_allocation_microunits) then raise exception 'r12_owner_grant_exhausted';end if;
 -- Purpose identity ignores profile/choice IDs, market ordering and template
 -- wording. Exact query/catalog bytes remain separately pinned in the setup.
 purpose_digest:=private.stage14_hash(jsonb_build_object('category','original_pod_tshirt','objective',lower(regexp_replace(btrim(goal.content->>'objective'),'\s+',' ','g')),
 'markets',(select jsonb_agg(jsonb_build_object('countryCode',m->>'countryCode','currency',m->>'currency') order by m->>'countryCode',m->>'currency') from jsonb_array_elements(selected->'markets')m),
 'topic',lower(regexp_replace(btrim((select t->>'queryTopic' from jsonb_array_elements(profile.profile->'topics')t where t->>'key'=input->>'topicKey')),'\s+',' ','g')),
 'audience',lower(regexp_replace(btrim(selected->>'audience'),'\s+',' ','g'))));
 if exists(select 1 from private.r12_owner_activations where business_id=p_business_id and private.r12_owner_activations.purpose_hash=purpose_digest) then raise exception 'r12_owner_exact_purpose_already_used';end if;
 if p_operation='prepare' then
 cutoff:=least(stamp+interval '1 day',(profile.profile->>'validUntil')::timestamptz,gr.valid_until,(profile.pins->>'knowledgeValidUntil')::timestamptz,((goal.content->'parsed'->'deadline'->>'date')||' '||coalesce(goal.content->'parsed'->'deadline'->>'time','23:59:59'))::timestamp at time zone (goal.content->'parsed'->'deadline'->>'timezone'));
 if cutoff<=stamp+interval '35 minutes' then raise exception 'r12_owner_window_insufficient';end if;
 sid:=gen_random_uuid();setup_id:=gen_random_uuid();
 select * into installed from public.installed_packs where business_id=p_business_id and root_pack_id=(profile.pins->>'packId')::uuid;
 if installed.id is not null then
 if installed.status<>'active' or installed.snapshot is distinct from profile.pins->'snapshot' then raise exception 'r12_owner_installation_changed';end if;iid:=installed.id;
 else iid:=gen_random_uuid();insert into public.installed_packs(id,business_id,root_pack_id,root_pack_key,status,snapshot) values(iid,p_business_id,(profile.pins->>'packId')::uuid,'workflow.product-discovery-v2','active',profile.pins->'snapshot');end if;
 foreach phase in array phase_keys loop
 operation_key:='research.r12.'||sid::text||'.'||phase;adapter_key:='r12.discovery.'||sid::text||'.'||phase;purpose:='Reviewed original POD research: '||phase;
 data_classes:=case when phase='search1' then '["generic_public_query","public_evidence"]'::jsonb else '["business_context","public_evidence"]'::jsonb end;model:=case when phase='review' then 'anthropic/claude-haiku-4.5' else 'openai/gpt-5.6-luna' end;
 bytes:=case phase when 'plan' then 12288 when 'search1' then 8192 when 'select1' then 16384 else 32768 end;tokens:=case phase when 'plan' then 1500 when 'search1' then 4000 when 'select1' then 1000 when 'strategy' then 5000 else 4000 end;
 insert into private.r05_operations(operation_key,pack_id,workflow_definition_id,provider,provider_model_id,purpose,currency,category,maximum_request_bytes,maximum_output_tokens,liability_microunits,source_domains,data_classes,qualification_hash,eligibility_hash,quote_hash,valid_from,valid_until)
 values(operation_key,(profile.pins->>'packId')::uuid,(profile.pins->>'workflowDefinitionId')::uuid,'openrouter',model,purpose,'USD','model',bytes,tokens,(q->'ceilings'->>phase)::bigint,selected->'allowedDomains',data_classes,profile.pins->>'executionReviewHash',profile.pins->>'eligibilityReviewHash',q->>'quoteHash',stamp,cutoff);
 insert into private.r07_adapters(adapter_key,qualification_hash,workflow_definition_id,worker_definition_id,workflow_hash,worker_hash,operation_key,role,purpose,artifact_type,mode,valid_from,valid_until,knowledge_valid_until)
 values(adapter_key,profile.pins->>'executionReviewHash',(profile.pins->>'workflowDefinitionId')::uuid,(profile.pins->'workers'->phase->>'id')::uuid,profile.pins->>'workflowHash',profile.pins->'workers'->phase->>'hash',operation_key,phase,purpose,'r12.discovery.'||phase,'qualification',stamp,cutoff,(profile.pins->>'knowledgeValidUntil')::timestamptz);
 ops:=ops||jsonb_build_array(jsonb_build_object('operationKey',operation_key,'installationId',iid,'workflowDefinitionId',profile.pins->>'workflowDefinitionId','purpose',purpose,'provider','openrouter','category','model','accountId',null,'accountRevision',null,'sourceDomains',selected->'allowedDomains','dataClasses',data_classes,'maximumPerOperationMicrounits',(q->'ceilings'->>phase)));
 end loop;
 select jsonb_agg(x order by x->>'operationKey') into ops from jsonb_array_elements(ops)x;
 policy_body:=jsonb_build_object('version','r05.1','goalId',goal.goal_id,'goalRevision',goal.revision,'businessRevision',br.revision,'currency','USD','businessLifetimeLimitMicrounits',maximum::text,'policyLimitMicrounits',amount::text,'categoryLimits',jsonb_build_array(jsonb_build_object('category','model','microunits',amount::text)),'expectedCapRevision',coalesce(cap.revision,0),'expectedExposureMicrounits',committed::text,'startsAt',stamp,'expiresAt',cutoff,'maximumDispatches',5,'minimumIntervalSeconds',0,'stopOnTarget',false,'operations',ops,'financialMode','bounded_model_cost_only');
 proposed:=public.r05_policy_owner(p_business_id,'propose',policy_body,gen_random_uuid());
 preview:=jsonb_build_object('version','r12.owner-research-preview.1','businessId',p_business_id,'goalId',goal.goal_id,'goalRevision',goal.revision,'goalHash',goal.content_hash,'businessRevision',br.revision,'businessHash',br.content_hash,'title',goal.content->>'title','objective',goal.content->>'objective','profileId',profile.id,'profileHash',profile.profile_hash,'selection',jsonb_build_object('marketSetKey',input->>'marketSetKey','topicKey',input->>'topicKey'),'approvedQuery',selected->>'approvedQuery','sourceDomains',selected->'allowedDomains','excludedDomains',selected->'excludedDomains','markets',selected->'markets','audience',selected->>'audience','funding',funding,
 'finance',jsonb_build_object('currentBusinessLimitMicrounits',coalesce(cap.maximum_microunits,0)::text,'proposedBusinessLimitMicrounits',maximum::text,'businessCommittedMicrounits',committed::text,'expectedCapRevision',coalesce(cap.revision,0),'minimumBusinessLimitMicrounits',(committed+amount)::text,'changesBusinessLimit',coalesce(cap.maximum_microunits,0)<>maximum,'proposedResearchLimitMicrounits',research_maximum::text,'minimumResearchLimitMicrounits',((funding->>'committedMicrounits')::bigint+amount)::text,'changesResearchLimit',(funding->>'maximumMicrounits')::bigint<>research_maximum),
 'quote',q,'maximumCalls',5,'maximumCollections',1,'maximumRepairs',0,'dispatchMinutes',30,'receiptMinutes',30,'maximumReceiptChecks',15,'authorityCreated',false);
 insert into private.r12_owner_setups(id,business_id,goal_id,owner_id,scope_id,profile_id,grant_id,binding_id,installation_id,policy_id,policy_hash,purpose_hash,input,preview,setup_hash,cutoff)
 values(setup_id,p_business_id,goal.goal_id,auth.uid(),sid,profile.id,gr.id,binding.id,iid,(proposed->>'id')::uuid,proposed->>'hash',purpose_digest,input,preview,private.stage14_hash(preview),cutoff) returning * into setup;
 else
 if setup.preview->>'goalHash' is distinct from goal.content_hash or setup.preview->>'businessHash' is distinct from br.content_hash or setup.preview->'funding' is distinct from funding
 or (setup.preview->'finance'->>'businessCommittedMicrounits')::bigint<>committed or (setup.preview->'finance'->>'expectedCapRevision')::integer<>coalesce(cap.revision,0) then raise exception 'r12_owner_stale_review';end if;
 if exists(select 1 from private.r05_revocations where policy_id=setup.policy_id) then raise exception 'r12_owner_setup_stopped';end if;
 sid:=setup.scope_id;iid:=setup.installation_id;cutoff:=setup.cutoff;
 if cutoff<stamp+interval '30 minutes' then raise exception 'r12_owner_activation_window_expired';end if;
 if jsonb_typeof(p_payload->'controllerKeyHash') is distinct from 'string' or jsonb_typeof(p_payload->'admissionKeyHash') is distinct from 'string' or p_payload->>'controllerKeyHash' !~ '^[a-f0-9]{64}$' or p_payload->>'admissionKeyHash' !~ '^[a-f0-9]{64}$' or p_payload->>'controllerKeyHash'=p_payload->>'admissionKeyHash'
 or exists(select 1 from private.r07_server_keys where key_hash in(p_payload->>'controllerKeyHash',p_payload->>'admissionKeyHash')) or exists(select 1 from private.r05_server_keys where key_hash in(p_payload->>'controllerKeyHash',p_payload->>'admissionKeyHash')) then raise exception 'r12_owner_fresh_separate_keys_required';end if;
 perform public.r05_policy_owner(p_business_id,'confirm',jsonb_build_object('policyId',setup.policy_id,'policyHash',setup.policy_hash),submission);
 if binding.kind='legacy_research_root' and research_maximum>(funding->>'maximumMicrounits')::bigint then
 revision_body:=jsonb_build_object('bindingId',binding.id,'revision',(funding->>'revision')::integer+1,'previousHash',funding->>'hash','previousMaximumMicrounits',funding->>'maximumMicrounits','maximumMicrounits',research_maximum::text,'committedMicrounits',funding->>'committedMicrounits','policyId',setup.policy_id,'ownerId',auth.uid());
 insert into private.r12_owner_funding_revisions(binding_id,revision,previous_hash,previous_maximum_microunits,maximum_microunits,committed_microunits,policy_id,owner_id,content_hash)
 values(binding.id,(funding->>'revision')::integer+1,funding->>'hash',(funding->>'maximumMicrounits')::bigint,research_maximum,(funding->>'committedMicrounits')::bigint,setup.policy_id,auth.uid(),private.stage14_hash(revision_body));end if;
 funding:=private.r12_owner_funding(binding);approval:=jsonb_build_object('revision',(funding->>'revision')::integer,'hash',funding->>'hash','maximumMicrounits',funding->>'maximumMicrounits');
 dispatch_until:=stamp+interval '30 minutes';receipt_until:=dispatch_until+interval '30 minutes';
 amendment:=jsonb_build_object('version','r12.discovery-owner-initial.1','id',sid,'businessId',p_business_id,'goalId',goal.goal_id,'goalRevision',goal.revision,'goalHash',goal.content_hash,'businessRevision',br.revision,'businessHash',br.content_hash,'setupId',setup.id,'setupHash',setup.setup_hash,'profile',profile.profile,'profileHash',profile.profile_hash,'selection',setup.preview->'selection','funding',setup.preview->'funding'->'binding','fundingApproval',approval,
 'intent',jsonb_build_object('version','pod-discovery-2.0','id',sid,'businessId',p_business_id,'objective',goal.content->>'objective','comparisonUniverse',jsonb_build_object('productType','original_pod_tshirt','markets',selected->'markets','audiences',jsonb_build_array(selected->>'audience'),'sourceDomains',selected->'allowedDomains','selectionQuestion',selected->>'approvedQuery'),'limits',jsonb_build_object('maximumAlternatives',3,'maximumNewCollections',1,'maximumMicrousd',amount,'maximumGenerations',1),'expiresAt',cutoff),
 'allowedDomains',selected->'allowedDomains','excludedDomains',selected->'excludedDomains','approvedQuery',selected->>'approvedQuery','approvalHash',private.r12_owner_confirmation_hash(setup),'independentReviewHash',profile.profile->>'independentReviewHash','createdAt',stamp,'expiresAt',cutoff);
 insert into private.r12_discovery_scopes(id,business_id,goal_id,budget_authority_root_id,prior_round_id,amendment,amendment_hash,origin,owner_setup_id)
 values(sid,p_business_id,goal.goal_id,case when binding.kind='legacy_research_root' then binding.authority_root_id else null end,(setup.preview->'funding'->'binding'->>'priorRoundId')::uuid,amendment,private.stage14_hash(amendment),'owner_initial',setup.id);
 foreach phase in array phase_keys loop
 steps:=steps||jsonb_build_array(jsonb_build_object('key',phase,'kind',case when phase='search1' then 'research' when phase='review' then 'review' else 'work' end,'objective','Complete the reviewed original POD '||phase||' phase','reason','Use only verified dependencies within this bounded research run','adapter','r12.discovery.'||sid::text||'.'||phase,'qualificationHash',profile.pins->>'executionReviewHash','installationId',iid,'packSnapshotHash',profile.pins->>'snapshotHash','workflowDefinitionId',profile.pins->>'workflowDefinitionId','workerDefinitionId',profile.pins->'workers'->phase->>'id','role',phase,'operationKey','research.r12.'||sid::text||'.'||phase,'purpose','Reviewed original POD research: '||phase,'dependsOn',to_jsonb(phase_keys[1:ord]),'expectedArtifactType','r12.discovery.'||phase,'maximumMicrounits',setup.preview->'quote'->'ceilings'->>phase,'expiresAt',dispatch_until,'notBefore',stamp,'measurement',null,'maximumRepairs',0));ord:=ord+1;end loop;
 plan:=jsonb_build_object('format','r12.discovery.1','discoveryScopeId',sid,'discoveryScopeHash',private.stage14_hash(amendment),'businessId',p_business_id,'goalId',goal.goal_id,'goalRevision',goal.revision,'goalHash',goal.content_hash,'businessRevision',br.revision,'businessHash',br.content_hash,'policyId',setup.policy_id,'policyHash',setup.policy_hash,'authorityRootId',p_business_id,'plannerWorkerDefinitionId',profile.pins->>'plannerWorkerDefinitionId','currency','USD','maximumMicrounits',amount::text,'deadline',dispatch_until,'expiresAt',dispatch_until,'maximumRepairs',0,'maximumPivots',0,'maximumChildren',5,'maximumDispatches',5,'requiredChecks','["review"]'::jsonb,'finishCondition','all_required_outputs_verified','stopConditions','["no_permitted_work","deadline","repair_exhausted","owner_stopped"]'::jsonb,'steps',steps);
 insert into private.r05_policy_proofs(policy_id,policy_hash,evidence_hash,valid_until) values(setup.policy_id,setup.policy_hash,profile.pins->>'policyInterpretationHash',dispatch_until);
 insert into private.r07_server_keys(key_hash,expires_at) values(p_payload->>'controllerKeyHash',receipt_until);insert into private.r05_server_keys(key_hash,expires_at) values(p_payload->>'admissionKeyHash',receipt_until);
 insert into private.r12_discovery_authorities(scope_id,business_id,goal_id,controller_key_hash,admission_key_hash,plan,plan_hash,mode,approval_hash,execution_review_hash,valid_until,receipt_until)
 values(sid,p_business_id,goal.goal_id,p_payload->>'controllerKeyHash',p_payload->>'admissionKeyHash',plan,private.r04_hash(plan),'qualification',private.r12_owner_confirmation_hash(setup),profile.pins->>'executionReviewHash',dispatch_until,receipt_until);
 insert into private.r12_owner_activations values(setup.id,p_business_id,goal.goal_id,sid,rt.id,setup.purpose_hash,amount,approval,stamp);
 end if;
 insert into private.r12_owner_submissions values(p_business_id,submission,h,setup.id,p_operation);return private.r12_owner_setup_receipt(setup);
end $$;

-- Preserve the installed historical branches; route only the new origin.
CREATE OR REPLACE FUNCTION private.r12_discovery_scope_validate()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare prior public.product_experiments; goal private.r04_goal_versions; a jsonb; scope jsonb; domains text[]; excluded text[]; item jsonb; d text; begin
 if current_user in ('anon','authenticated','service_role') then raise exception 'r12_trusted_scope_registration_required' using errcode='42501';end if;
 if tg_op<>'INSERT' then raise exception 'r12_immutable_source_amendment';end if;
 perform 1 from public.businesses where id=new.business_id for update;
 a:=new.amendment;
 if a->>'version'='r12.discovery-owner-initial.1' then perform private.r12_owner_scope_resolve(new,clock_timestamp(),true);return new;end if;
 if a->>'version'='r12.discovery-focused-pilot.1' then perform private.r12_pilot_envelope_validate(new);return new;end if;
 if a->>'version'='r12.discovery-evidence-continuation.1' then perform private.r12_validate_evidence_envelope(new);return new;end if;
 if a->>'version' in ('r12.discovery-review-continuation.1','r12.discovery-review-continuation.2') then perform private.r04_safe(a);perform private.r12_validate_review_envelope(new);return new;end if;
 perform private.r04_safe(a);
 perform private.r04_keys(a,array['version','id','businessId','goalId','budgetAuthorityRootId','priorRoundId','originalIntentHash','originalSemanticGoalHash','allowedDomains','excludedDomains','sourceReviews','approvalHash','independentReviewHash','purposeReviewHash','approvedQuery','createdAt','expiresAt']);
 if a->>'version' is distinct from 'r12.discovery-source-scope.1' or a->>'id' is distinct from new.id::text or a->>'businessId' is distinct from new.business_id::text or a->>'goalId' is distinct from new.goal_id::text or a->>'budgetAuthorityRootId' is distinct from new.budget_authority_root_id::text or a->>'priorRoundId' is distinct from new.prior_round_id::text or new.id in(new.budget_authority_root_id,new.prior_round_id) then raise exception 'r12_scope_identity_mismatch';end if;
 foreach d in array array['originalIntentHash','originalSemanticGoalHash','approvalHash','independentReviewHash','purposeReviewHash'] loop
 if jsonb_typeof(a->d) is distinct from 'string' or a->>d !~ '^[a-f0-9]{64}$' then raise exception 'r12_review_pin_required';end if;end loop;
 if jsonb_typeof(a->'approvedQuery') is distinct from 'string' or length(a->>'approvedQuery') not between 20 and 800 or btrim(a->>'approvedQuery') is distinct from a->>'approvedQuery' or a->>'purposeReviewHash' is distinct from private.stage14_hash(jsonb_build_object('query',a->>'approvedQuery','classification','generic_nonpersonal_public_research')) then raise exception 'r12_reviewed_public_query_required';end if;
 if new.amendment_hash is distinct from private.stage14_hash(a) then raise exception 'r12_amendment_hash_mismatch';end if;
 select * into strict prior from public.product_experiments where id=new.prior_round_id and business_id=new.business_id and discovery_version='pod-discovery-2.0' and parent_discovery_id is null and candidate_id is null;
 if prior.status not in ('failed','completed') or prior.variables->>'budgetAuthorityRootId' is distinct from new.budget_authority_root_id::text or prior.variables->>'semanticGoalHash' is distinct from a->>'originalSemanticGoalHash' or private.stage14_hash(prior.variables->'intent') is distinct from a->>'originalIntentHash' then raise exception 'r12_original_scope_mismatch';end if;
 if exists(select 1 from public.product_experiments e where e.business_id=new.business_id and e.discovery_version='pod-discovery-2.0' and e.parent_discovery_id is null and e.candidate_id is null and e.variables->>'budgetAuthorityRootId'=new.budget_authority_root_id::text and (e.created_at,e.id)>(prior.created_at,prior.id)) then raise exception 'r12_latest_round_required';end if;
 scope:=private.stage13v2_budget_authority(prior.id,true);
 if scope->'hasUncertainCosts' is distinct from 'false'::jsonb or (scope->>'remainingMicrousd')::bigint<=0 then raise exception 'r12_shared_funding_unavailable';end if;
 select v.* into goal from private.r04_goal_versions v join private.r04_goal_state s using(goal_id,business_id,revision) where v.goal_id=new.goal_id and v.business_id=new.business_id;
 if goal.goal_id is null or goal.preference<>'ready' or goal.content->>'objective' is distinct from prior.variables->'intent'->>'objective' or (select jsonb_agg(x order by x) from jsonb_array_elements_text(goal.content->'parsed'->'geography') x) is distinct from (select jsonb_agg(x->>'countryCode' order by x->>'countryCode') from jsonb_array_elements(prior.variables->'intent'->'comparisonUniverse'->'markets') x) then raise exception 'r12_original_goal_required';end if;
 if jsonb_typeof(a->'createdAt') is distinct from 'string' or jsonb_typeof(a->'expiresAt') is distinct from 'string' or (a->>'createdAt')::timestamptz>clock_timestamp() or (a->>'expiresAt')::timestamptz<=clock_timestamp() or (a->>'expiresAt')::timestamptz>(a->>'createdAt')::timestamptz+interval '1 day' then raise exception 'r12_amendment_expired';end if;
 perform private.r04_strings(a->'allowedDomains',4);perform private.r04_strings(a->'excludedDomains',32);
 select array_agg(x) into domains from jsonb_array_elements_text(a->'allowedDomains') x;
 select array_agg(x) into excluded from jsonb_array_elements_text(a->'excludedDomains') x;
 if coalesce(cardinality(domains),0)<1 or (array['etsy.com','etsy.me','etsystatic.com']<@excluded) is distinct from true or cardinality(domains)<>(select count(distinct x) from unnest(domains) x) or cardinality(excluded)<>(select count(distinct x) from unnest(excluded) x) then raise exception 'r12_source_scope_invalid';end if;
 foreach d in array domains||excluded loop
 if length(d)>253 or d !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' or d like '%.local' or d like '%.internal' then raise exception 'r12_source_scope_invalid';end if;end loop;
 if exists(select 1 from unnest(domains) allowed_domain cross join unnest(excluded) blocked_domain where allowed_domain=blocked_domain or allowed_domain like '%.'||blocked_domain or blocked_domain like '%.'||allowed_domain) then raise exception 'r12_restricted_source';end if;
 if jsonb_typeof(a->'sourceReviews') is distinct from 'array' or jsonb_array_length(a->'sourceReviews')<>cardinality(domains) or (select count(distinct x->>'domain') from jsonb_array_elements(a->'sourceReviews') x)<>cardinality(domains) then raise exception 'r12_source_reviews_required';end if;
 for item in select value from jsonb_array_elements(a->'sourceReviews') loop
 perform private.r04_keys(item,array['domain','basis','reviewHash']);
 if jsonb_typeof(item->'domain') is distinct from 'string' or jsonb_typeof(item->'reviewHash') is distinct from 'string' or not(item->>'domain'=any(domains)) or item->>'basis' is distinct from 'documented_api_factual_snippets' or item->>'reviewHash' !~ '^[a-f0-9]{64}$' then raise exception 'r12_source_reviews_required';end if;end loop;
 return new;
end $function$
;

-- Preserve the installed historical branches; route only the new origin.
CREATE OR REPLACE FUNCTION private.r12_discovery_scope_current(p private.r07_plans)
 RETURNS private.r12_discovery_scopes
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s private.r12_discovery_scopes; prior public.product_experiments; begin
 if p.content->>'format'='r12.discovery-pilot.1' then return private.r12_pilot_scope_at(p,clock_timestamp(),true);end if;
 perform 1 from public.businesses where id=p.business_id and owner_user_id=p.owner_id for update;
 if not found then raise exception 'r12_owner_changed';end if;
 select * into s from private.r12_discovery_scopes where id=(p.content->>'discoveryScopeId')::uuid and business_id=p.business_id and goal_id=p.goal_id and amendment_hash=p.content->>'discoveryScopeHash';
 if not coalesce(p.content->>'format' in ('r12.discovery.1','r12.discovery-review.1','r12.discovery-evidence.1'),false) or s.id is null then raise exception 'r12_scope_binding_required';end if;
 if s.origin='owner_initial' then
 if p.content->>'format' is distinct from 'r12.discovery.1' then raise exception 'r12_owner_plan_format_required';end if;
 perform private.r12_owner_scope_resolve(s,clock_timestamp(),true);return s;end if;
 if p.content->>'format'='r12.discovery-evidence.1' then
 if s.amendment->>'version' is distinct from 'r12.discovery-evidence-continuation.1' then raise exception 'r12_scope_binding_required';end if;
 perform private.r12_evidence_source(s,clock_timestamp(),true);
 elsif p.content->>'format'='r12.discovery-review.1' then
 if not coalesce(s.amendment->>'version' in ('r12.discovery-review-continuation.1','r12.discovery-review-continuation.2'),false) then raise exception 'r12_scope_binding_required';end if;
 perform private.r12_review_source(s,clock_timestamp(),true);
 elsif s.amendment->>'version' is distinct from 'r12.discovery-source-scope.1' then raise exception 'r12_scope_binding_required';end if;
 perform 1 from public.product_experiments where id=s.budget_authority_root_id and business_id=p.business_id for update;
 select * into strict prior from public.product_experiments where id=s.prior_round_id and business_id=p.business_id;
 if prior.status not in ('failed','completed') or (s.amendment->>'expiresAt')::timestamptz<=clock_timestamp() or exists(select 1 from public.product_experiments newer where newer.business_id=p.business_id and newer.discovery_version='pod-discovery-2.0' and newer.parent_discovery_id is null and newer.candidate_id is null and newer.variables->>'budgetAuthorityRootId'=s.budget_authority_root_id::text and (newer.created_at,newer.id)>(prior.created_at,prior.id)) then raise exception 'r12_scope_no_longer_current';end if;
 if not exists(select 1 from private.r04_goal_versions gv join private.r04_goal_state gs using(goal_id,business_id,revision) where gv.goal_id=p.goal_id and gv.business_id=p.business_id and gv.preference='ready' and gv.revision=(p.content->>'goalRevision')::integer and gv.content_hash=p.content->>'goalHash' and gv.content->>'objective'=prior.variables->'intent'->>'objective' and (select jsonb_agg(x order by x) from jsonb_array_elements_text(gv.content->'parsed'->'geography') x)=(select jsonb_agg(x->>'countryCode' order by x->>'countryCode') from jsonb_array_elements(prior.variables->'intent'->'comparisonUniverse'->'markets') x)) then raise exception 'r12_original_goal_changed';end if;
 return s;
end $function$
;

-- Preserve the installed historical branches; route only the new origin.
CREATE OR REPLACE FUNCTION private.r12_discovery_scope_at(p private.r07_plans, effective_at timestamp with time zone)
 RETURNS private.r12_discovery_scopes
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s private.r12_discovery_scopes; prior public.product_experiments; begin
 if p.content->>'format'='r12.discovery-pilot.1' then return private.r12_pilot_scope_at(p,effective_at,true);end if;
 perform 1 from public.businesses where id=p.business_id and owner_user_id=p.owner_id for update;
 if not found then raise exception 'r12_owner_changed';end if;
 select * into s from private.r12_discovery_scopes where id=(p.content->>'discoveryScopeId')::uuid and business_id=p.business_id and goal_id=p.goal_id and amendment_hash=p.content->>'discoveryScopeHash';
 if not coalesce(p.content->>'format' in ('r12.discovery.1','r12.discovery-review.1','r12.discovery-evidence.1'),false) or s.id is null then raise exception 'r12_scope_binding_required';end if;
 if s.origin='owner_initial' then
 if p.content->>'format' is distinct from 'r12.discovery.1' then raise exception 'r12_owner_plan_format_required';end if;
 perform private.r12_owner_scope_resolve(s,effective_at,false);return s;end if;
 if p.content->>'format'='r12.discovery-evidence.1' then
 if s.amendment->>'version' is distinct from 'r12.discovery-evidence-continuation.1' then raise exception 'r12_scope_binding_required';end if;
 perform private.r12_evidence_source(s,effective_at,true);
 elsif p.content->>'format'='r12.discovery-review.1' then
 if not coalesce(s.amendment->>'version' in ('r12.discovery-review-continuation.1','r12.discovery-review-continuation.2'),false) then raise exception 'r12_scope_binding_required';end if;
 perform private.r12_review_source(s,effective_at,true);
 elsif s.amendment->>'version' is distinct from 'r12.discovery-source-scope.1' then raise exception 'r12_scope_binding_required';end if;
 perform 1 from public.product_experiments where id=s.budget_authority_root_id and business_id=p.business_id for update;
 select * into strict prior from public.product_experiments where id=s.prior_round_id and business_id=p.business_id;
 if prior.status not in ('failed','completed') or (s.amendment->>'expiresAt')::timestamptz<=effective_at or exists(select 1 from public.product_experiments newer where newer.business_id=p.business_id and newer.discovery_version='pod-discovery-2.0' and newer.parent_discovery_id is null and newer.candidate_id is null and newer.variables->>'budgetAuthorityRootId'=s.budget_authority_root_id::text and (newer.created_at,newer.id)>(prior.created_at,prior.id)) then raise exception 'r12_scope_no_longer_current';end if;
 if not exists(select 1 from private.r04_goal_versions gv join private.r04_goal_state gs using(goal_id,business_id,revision) where gv.goal_id=p.goal_id and gv.business_id=p.business_id and gv.preference='ready' and gv.revision=(p.content->>'goalRevision')::integer and gv.content_hash=p.content->>'goalHash' and gv.content->>'objective'=prior.variables->'intent'->>'objective' and (select jsonb_agg(x order by x) from jsonb_array_elements_text(gv.content->'parsed'->'geography') x)=(select jsonb_agg(x->>'countryCode' order by x->>'countryCode') from jsonb_array_elements(prior.variables->'intent'->'comparisonUniverse'->'markets') x)) then raise exception 'r12_original_goal_changed';end if;
 return s;
end $function$
;

-- Preserve the installed historical branches; route only the new origin.
CREATE OR REPLACE FUNCTION private.r12_authority_validate()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s private.r12_discovery_scopes;step jsonb;adapter private.r07_adapters;wd public.worker_definitions;fd public.workflow_definitions;begin
 perform 1 from public.businesses where id=new.business_id for update;
 select * into s from private.r12_discovery_scopes where id=new.scope_id and business_id=new.business_id and goal_id=new.goal_id;
 if s.id is null or not coalesce(new.plan->>'format' in ('r12.discovery.1','r12.discovery-review.1','r12.discovery-evidence.1','r12.discovery-pilot.1'),false) or new.plan->>'discoveryScopeId' is distinct from s.id::text or new.plan->>'discoveryScopeHash' is distinct from s.amendment_hash or new.valid_until is distinct from (new.plan->>'expiresAt')::timestamptz or new.valid_until<=clock_timestamp() or new.valid_until>clock_timestamp()+interval '30 minutes' or new.valid_until>(s.amendment->>'expiresAt')::timestamptz then raise exception 'r12_bounded_authority_required';end if;
 if (new.plan->>'format'='r12.discovery-pilot.1') is distinct from (s.amendment->>'version'='r12.discovery-focused-pilot.1') then raise exception 'r12_scope_format_mismatch';end if;
 if (new.plan->>'format'='r12.discovery.1') is distinct from (s.amendment->>'version' in ('r12.discovery-source-scope.1','r12.discovery-owner-initial.1')) or (new.plan->>'format'='r12.discovery-review.1') is distinct from (s.amendment->>'version' in ('r12.discovery-review-continuation.1','r12.discovery-review-continuation.2')) or (new.plan->>'format'='r12.discovery-evidence.1') is distinct from (s.amendment->>'version'='r12.discovery-evidence-continuation.1') then raise exception 'r12_scope_format_mismatch';end if;
 if new.plan->>'format' in ('r12.discovery-review.1','r12.discovery-evidence.1','r12.discovery-pilot.1') and not exists(select 1 from private.r12_review_owner_confirmations confirmed where confirmed.scope_id=new.scope_id and confirmed.business_id=new.business_id and confirmed.policy_id=(new.plan->>'policyId')::uuid and confirmed.policy_hash=new.plan->>'policyHash' and confirmed.business_revision=(new.plan->>'businessRevision')::integer and confirmed.goal_revision=(new.plan->>'goalRevision')::integer) then raise exception 'r12_review_owner_confirmation_required';end if;
 if not exists(select 1 from private.r07_server_keys where key_hash=new.controller_key_hash and expires_at>=new.receipt_until and expires_at<=new.receipt_until+interval '5 seconds') or not exists(select 1 from private.r05_server_keys where key_hash=new.admission_key_hash and expires_at>=new.receipt_until and expires_at<=new.receipt_until+interval '5 seconds') then raise exception 'r12_exact_authority_window_required';end if;
 if exists(select 1 from private.r05_server_keys where key_hash=new.controller_key_hash) or exists(select 1 from private.r07_server_keys where key_hash=new.admission_key_hash) then raise exception 'r12_separate_scoped_key_roles_required';end if;
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
end $function$
;

-- Preserve the installed historical branches; route only the new origin.
CREATE OR REPLACE FUNCTION private.r07_validate_plan(b uuid, g uuid, p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s jsonb; k text; seen text[]:='{}'; first_key text; challenge_key text; total numeric:=0; policy private.r05_policies; scope jsonb; n integer:=0; dep text; discovery boolean:=coalesce(p->>'format' in ('r12.discovery.1','r12.discovery-review.1','r12.discovery-evidence.1','r12.discovery-pilot.1'),false);review_cont boolean:=coalesce(p->>'format' in ('r12.discovery-review.1','r12.discovery-evidence.1'),false);pilot boolean:=coalesce(p->>'format'='r12.discovery-pilot.1',false);evidence_cont boolean:=coalesce(p->>'format'='r12.discovery-evidence.1',false);old_step jsonb;source jsonb;old_review jsonb; discovery_keys text[]:=array['plan','search1','select1','strategy','review']; binding private.r12_discovery_scopes; original public.product_experiments; budget jsonb; begin
 perform private.r07_safe(p);
 perform private.r04_keys(p,array['format','businessId','goalId','goalRevision','goalHash','businessRevision','businessHash','policyId','policyHash','authorityRootId','plannerWorkerDefinitionId','currency','maximumMicrounits','deadline','expiresAt','maximumRepairs','maximumPivots','maximumChildren','maximumDispatches','requiredChecks','finishCondition','stopConditions','steps']||case when discovery then array['discoveryScopeId','discoveryScopeHash'] else array[]::text[] end);
 if (not discovery and p->>'format' is distinct from 'r07.1') or p->>'businessId' is distinct from b::text or p->>'goalId' is distinct from g::text or p->>'authorityRootId' is distinct from b::text or p->>'currency' is distinct from 'USD' then raise exception 'r07_invalid_lineage'; end if;
 foreach k in array array['goalRevision','businessRevision','maximumRepairs','maximumPivots','maximumChildren','maximumDispatches'] loop
 if jsonb_typeof(p->k) is distinct from 'number' or p->>k !~ '^(0|[1-9][0-9]{0,8})$' then raise exception 'r07_invalid_integer'; end if;
 end loop;
 if (p->>'maximumRepairs')::integer>8 or (p->>'maximumPivots')::integer>3 or (p->>'maximumChildren')::integer not between 2 and 32 or (p->>'maximumDispatches')::integer not between 2 and 64 then raise exception 'r07_invalid_bounds'; end if;
 if not exists(select 1 from private.r04_goal_versions where business_id=b and goal_id=g and revision=(p->>'goalRevision')::integer and content_hash=p->>'goalHash') or not exists(select 1 from private.r04_business_versions where business_id=b and revision=(p->>'businessRevision')::integer and content_hash=p->>'businessHash') then raise exception 'r07_invalid_version_pins'; end if;
 if review_cont then
 select * into binding from private.r12_discovery_scopes where id=(p->>'discoveryScopeId')::uuid and business_id=b and goal_id=g and amendment_hash=p->>'discoveryScopeHash';
 if binding.id is null or not coalesce(binding.amendment->>'version' in ('r12.discovery-review-continuation.1','r12.discovery-review-continuation.2','r12.discovery-evidence-continuation.1'),false) then raise exception 'r07_review_scope_unavailable';end if;
 if evidence_cont is distinct from (binding.amendment->>'version'='r12.discovery-evidence-continuation.1') then raise exception 'r07_evidence_scope_mismatch';end if;
 source:=private.r12_review_source(binding,clock_timestamp(),true);
 select value into old_review from jsonb_array_elements(source->'sourcePlan'->'steps') x where x->>'key'='review';
 end if;
 select * into policy from private.r05_policies where id=(p->>'policyId')::uuid and business_id=b and goal_id=g;
 if policy.id is null or policy.content_hash is distinct from p->>'policyHash' or policy.goal_revision<>(p->>'goalRevision')::integer or policy.business_revision<>(p->>'businessRevision')::integer then raise exception 'r07_policy_pin_mismatch'; end if;
 if not exists(select 1 from public.worker_definitions where id=(p->>'plannerWorkerDefinitionId')::uuid and (status in ('qualified','assisted','autonomous') or status='experimental' and worker_key='product.discovery-v2.plan' and version='1.0.0' and private.r12_plan_qualification(b,g,p))) then raise exception 'r07_planner_unqualified'; end if;
 foreach k in array array['deadline','expiresAt'] loop
 if jsonb_typeof(p->k) is distinct from 'string' or p->>k !~ '^\d{4}-\d\d-\d\dT.+(Z|[+-]\d\d:\d\d)$' then raise exception 'r07_invalid_time'; end if;
 end loop;
 if (p->>'expiresAt')::timestamptz>(policy.payload->>'expiresAt')::timestamptz or (p->>'expiresAt')::timestamptz>(p->>'deadline')::timestamptz or (p->>'expiresAt')::timestamptz<=clock_timestamp() or (private.r05_money(p->'maximumMicrounits')-case when review_cont then (binding.amendment->>'baseKnownMicrounits')::bigint else 0 end) not between 1 and private.r05_money(policy.payload->'policyLimitMicrounits') or ((p->>'maximumDispatches')::integer-case when review_cont then (binding.amendment->>'baseDispatches')::integer else 0 end)>(policy.payload->>'maximumDispatches')::integer then raise exception 'r07_parent_scope_exceeded'; end if;
 if p->>'finishCondition' is distinct from 'all_required_outputs_verified' or p->'stopConditions' is distinct from '["no_permitted_work","deadline","repair_exhausted","owner_stopped"]'::jsonb then raise exception 'r07_invalid_stop_conditions'; end if;
 if jsonb_typeof(p->'steps') is distinct from 'array' or jsonb_array_length(p->'steps') not between (case when review_cont then 1 else 2 end) and 16 or jsonb_array_length(p->'steps')>(p->>'maximumChildren')::integer or jsonb_array_length(p->'steps')>(p->>'maximumDispatches')::integer then raise exception 'r07_invalid_steps'; end if;
 if discovery then
 if pilot then
 select * into binding from private.r12_discovery_scopes where id=(p->>'discoveryScopeId')::uuid and business_id=b and goal_id=g and amendment_hash=p->>'discoveryScopeHash';
 if binding.id is null or binding.amendment->>'version' is distinct from 'r12.discovery-focused-pilot.1' then raise exception 'r07_pilot_scope_unavailable';end if;
 perform private.r12_pilot_source(binding,clock_timestamp(),true);
 if jsonb_array_length(p->'steps')<>2 or p->'maximumChildren' is distinct from '2'::jsonb or p->'maximumDispatches' is distinct from '2'::jsonb
 or p->'maximumRepairs' is distinct from '0'::jsonb or p->'maximumPivots' is distinct from '0'::jsonb or p->'requiredChecks' is distinct from '["review"]'::jsonb
 or policy.payload->'maximumDispatches' is distinct from '2'::jsonb or jsonb_array_length(policy.payload->'operations')<>2
 or private.r05_money(p->'maximumMicrounits')<>private.r05_money(policy.payload->'policyLimitMicrounits')
 or private.r05_money(p->'maximumMicrounits')<>private.r05_money(to_jsonb(binding.amendment->'profile'->>'researchAllocationMicrousd'))
 or exists(select 1 from private.r07_plans saved where saved.business_id=b and saved.goal_id=g and (saved.version<>1 or saved.previous_plan_id is not null or saved.content is distinct from p))
 or exists(select 1 from private.r07_reused reuse join private.r07_plans saved on saved.id=reuse.plan_id where saved.business_id=b and saved.goal_id=g)
 then raise exception 'r07_pilot_initial_topology_required';end if;
 elsif review_cont then
 if jsonb_array_length(p->'steps')<>(case when evidence_cont then 2 else 1 end) or p->'maximumChildren'<>to_jsonb((binding.amendment->>'baseChildren')::integer+(case when evidence_cont then 2 else 1 end)) or p->'maximumDispatches'<>to_jsonb((binding.amendment->>'baseDispatches')::integer+(case when evidence_cont then 2 else 1 end)) or p->'maximumRepairs'<>'0' or p->'maximumPivots'<>'0' or p->'requiredChecks'<>'["review"]'::jsonb
 or policy.payload->'maximumDispatches'<>to_jsonb(case when evidence_cont then 2 else 1 end) or jsonb_array_length(policy.payload->'operations')<>(case when evidence_cont then 2 else 1 end)
 or private.r05_money(p->'maximumMicrounits')<>(binding.amendment->>'baseKnownMicrounits')::bigint+private.r05_money(policy.payload->'policyLimitMicrounits')
 or p->>'plannerWorkerDefinitionId' is distinct from source->'sourcePlan'->>'plannerWorkerDefinitionId'
 then raise exception 'r07_review_topology_invalid';end if;
 else
 if p->>'discoveryScopeId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' or p->>'discoveryScopeHash' !~ '^[a-f0-9]{64}$' or jsonb_typeof(p->'discoveryScopeId') is distinct from 'string' or jsonb_typeof(p->'discoveryScopeHash') is distinct from 'string' or jsonb_array_length(p->'steps')<>5 or p->'maximumChildren'<>'5' or p->'maximumDispatches'<>'5' or p->'maximumRepairs'<>'0' or p->'maximumPivots'<>'0' or p->'requiredChecks'<>'["review"]'::jsonb then raise exception 'r07_discovery_topology_invalid';end if;
 end if;
 select * into binding from private.r12_discovery_scopes where id=(p->>'discoveryScopeId')::uuid and business_id=b and goal_id=g and amendment_hash=p->>'discoveryScopeHash';
 if binding.id is null or (not review_cont and not pilot and not coalesce(binding.amendment->>'version' in ('r12.discovery-source-scope.1','r12.discovery-owner-initial.1'),false)) or (binding.amendment->>'expiresAt')::timestamptz<(p->>'expiresAt')::timestamptz then raise exception 'r07_discovery_scope_unavailable';end if;
 if binding.origin='owner_initial' then
 source:=private.r12_owner_scope_resolve(binding,clock_timestamp(),true);budget:=source->'budget';
 if private.r05_money(p->'maximumMicrounits')<>(binding.amendment->'intent'->'limits'->>'maximumMicrousd')::bigint
 or policy.payload->'maximumDispatches' is distinct from '5'::jsonb or jsonb_array_length(policy.payload->'operations')<>5
 or policy.id is distinct from (select policy_id from private.r12_owner_setups where id=binding.owner_setup_id)
 or exists(select 1 from private.r07_plans saved where saved.business_id=b and saved.goal_id=g and (saved.version<>1 or saved.previous_plan_id is not null or saved.content is distinct from p))
 or exists(select 1 from private.r07_reused reuse join private.r07_plans saved on saved.id=reuse.plan_id where saved.business_id=b and saved.goal_id=g)
 then raise exception 'r07_owner_initial_topology_required';end if;
 else
 select * into strict original from public.product_experiments where id=binding.prior_round_id and business_id=b;
 if pilot then
 if exists(select 1 from public.product_experiments newer where newer.business_id=b and newer.discovery_version='pod-discovery-2.0' and newer.parent_discovery_id is null and newer.candidate_id is null and newer.variables->>'budgetAuthorityRootId'=binding.budget_authority_root_id::text and (newer.created_at,newer.id)>(original.created_at,original.id))
 or not exists(select 1 from private.r04_goal_versions gv join private.r04_goal_state gs using(goal_id,business_id,revision) where gv.goal_id=g and gv.business_id=b and gv.preference='ready'
 and gv.revision=(p->>'goalRevision')::integer and gv.content_hash=p->>'goalHash' and gv.content->'objective'=binding.amendment->'profile'->'intent'->'objective' and gv.content->'parsed'->'geography'='["GB"]'::jsonb)
 then raise exception 'r07_pilot_owner_goal_changed';end if;
 else
 if exists(select 1 from public.product_experiments newer where newer.business_id=b and newer.discovery_version='pod-discovery-2.0' and newer.parent_discovery_id is null and newer.candidate_id is null and newer.variables->>'budgetAuthorityRootId'=binding.budget_authority_root_id::text and (newer.created_at,newer.id)>(original.created_at,original.id)) or not exists(select 1 from private.r04_goal_versions gv join private.r04_goal_state gs using(goal_id,business_id,revision) where gv.goal_id=g and gv.business_id=b and gv.preference='ready' and gv.revision=(p->>'goalRevision')::integer and gv.content->>'objective'=original.variables->'intent'->>'objective' and (select jsonb_agg(x order by x) from jsonb_array_elements_text(gv.content->'parsed'->'geography') x)=(select jsonb_agg(x->>'countryCode' order by x->>'countryCode') from jsonb_array_elements(original.variables->'intent'->'comparisonUniverse'->'markets') x)) then raise exception 'r07_discovery_original_scope_changed';end if;
 end if;
 budget:=private.stage13v2_budget_authority(original.id,true);
 end if;
 if budget->'hasUncertainCosts' is distinct from 'false'::jsonb or (private.r05_money(p->'maximumMicrounits')-(case when review_cont then (binding.amendment->>'baseKnownMicrounits')::bigint else 0 end))>(budget->>'remainingMicrousd')::bigint then raise exception 'r07_discovery_shared_budget_exceeded';end if;
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
 for dep in select jsonb_array_elements_text(s->'dependsOn') loop if not dep=any(seen) and not(review_cont and dep=any(array['plan','search1','select1','strategy'])) then raise exception 'r07_invalid_dependencies'; end if; end loop;
 if s->>'kind' not in ('research','challenge','work','review','measure') then raise exception 'r07_invalid_kind'; end if;
 if discovery then
 if pilot then
 if n not between 0 and 1 or s->>'key' is distinct from (case n when 0 then 'strategy' else 'review' end)
 or s->>'kind' is distinct from (case n when 0 then 'work' else 'review' end) or s->>'role' is distinct from s->>'key'
 or s->>'adapter' is distinct from 'r12.discovery.'||(p->>'discoveryScopeId')||'.'||(s->>'key')
 or s->>'operationKey' is distinct from 'research.r12.'||(p->>'discoveryScopeId')||'.'||(s->>'key')
 or s->>'expectedArtifactType' is distinct from 'r12.discovery.'||(s->>'key') or s->'maximumRepairs' is distinct from '0'::jsonb or s->'measurement' is distinct from 'null'::jsonb
 or s->'dependsOn' is distinct from (case n when 0 then '[]'::jsonb else '["strategy"]'::jsonb end)
 then raise exception 'r07_pilot_topology_invalid';end if;
 if n=1 then challenge_key:='review';end if;
 elsif review_cont then
 if evidence_cont then
 select value into old_step from jsonb_array_elements(source->'sourcePlan'->'steps') st where st->>'key'=s->>'key';
 if n not between 0 and 1 or s->>'key' is distinct from (case n when 0 then 'strategy' else 'review' end)
 or s->>'kind' is distinct from (case n when 0 then 'work' else 'review' end) or s->>'role' is distinct from s->>'key'
 or s->>'adapter' is distinct from 'r12.discovery.'||(p->>'discoveryScopeId')||'.'||(s->>'key')
 or s->>'operationKey' is distinct from 'research.r12.'||(p->>'discoveryScopeId')||'.'||(s->>'key')
 or s->>'expectedArtifactType' is distinct from 'r12.discovery.'||(s->>'key') or s->'maximumRepairs'<>'0' or s->'measurement'<>'null'::jsonb
 or s->'dependsOn' is distinct from (case n when 0 then '["plan","search1","select1"]'::jsonb else '["plan","search1","select1","strategy"]'::jsonb end)
 or s->>'installationId' is distinct from old_step->>'installationId' or s->>'packSnapshotHash' is distinct from old_step->>'packSnapshotHash'
 or s->>'workflowDefinitionId' is distinct from old_step->>'workflowDefinitionId' or s->>'workerDefinitionId' is distinct from old_step->>'workerDefinitionId'
 or (s->>'key'='review' and exists(select 1 from jsonb_array_elements(source->'sourcePlan'->'steps') os where os->>'key'<>'review' and os->>'workerDefinitionId'=s->>'workerDefinitionId'))
 then raise exception 'r07_evidence_topology_invalid';end if;
 if n=1 then challenge_key:='review';end if;
 else
 if n<>0 or s->>'key' is distinct from 'review' or s->>'kind' is distinct from 'review' or s->>'role' is distinct from 'review'
 or s->>'adapter' is distinct from 'r12.discovery.'||(p->>'discoveryScopeId')||'.review' or s->>'operationKey' is distinct from 'research.r12.'||(p->>'discoveryScopeId')||'.review'
 or s->>'expectedArtifactType' is distinct from 'r12.discovery.review' or s->'maximumRepairs'<>'0' or s->'measurement'<>'null'::jsonb or s->'dependsOn' is distinct from '["plan","search1","select1","strategy"]'::jsonb
 or private.r05_money(s->'maximumMicrounits')<>private.r05_money(policy.payload->'policyLimitMicrounits')
 or s->>'installationId' is distinct from old_review->>'installationId' or s->>'packSnapshotHash' is distinct from old_review->>'packSnapshotHash'
 or s->>'workflowDefinitionId' is distinct from old_review->>'workflowDefinitionId' or s->>'workerDefinitionId' is distinct from old_review->>'workerDefinitionId'
 or exists(select 1 from jsonb_array_elements(source->'sourcePlan'->'steps') os where os->>'key'<>'review' and os->>'workerDefinitionId'=s->>'workerDefinitionId')
 then raise exception 'r07_review_topology_invalid';end if;challenge_key:='review';
 end if;
 else
 if s->>'key' is distinct from discovery_keys[n+1] or s->>'kind' is distinct from (case when n=1 then 'research' when n=4 then 'review' else 'work' end) or s->>'adapter' is distinct from 'r12.discovery.'||(p->>'discoveryScopeId')||'.'||discovery_keys[n+1] or s->>'role' is distinct from discovery_keys[n+1] or s->>'operationKey' is distinct from 'research.r12.'||(p->>'discoveryScopeId')||'.'||discovery_keys[n+1] or s->>'expectedArtifactType' is distinct from 'r12.discovery.'||discovery_keys[n+1] or s->'maximumRepairs'<>'0' or s->'measurement'<>'null'::jsonb or s->'dependsOn' is distinct from to_jsonb(discovery_keys[1:n]) then raise exception 'r07_discovery_topology_invalid';end if;
 if n=4 then challenge_key:='review';end if;
 end if;
 elsif n=0 then first_key:=s->>'key'; if s->>'kind'<>'research' or s->'dependsOn'<>'[]' then raise exception 'r07_research_first'; end if;
 elsif n=1 then challenge_key:=s->>'key'; if s->>'kind'<>'challenge' or not(s->'dependsOn' ? first_key) then raise exception 'r07_challenge_second'; end if;
 elsif not(s->'dependsOn' ? challenge_key) then raise exception 'r07_challenge_required'; end if;
 if s->>'kind' in ('challenge','review') and ((s->>'workerDefinitionId')::uuid=(p->>'plannerWorkerDefinitionId')::uuid or exists(select 1 from jsonb_array_elements(p->'steps') x where s->'dependsOn' ? (x->>'key') and (x->>'workerDefinitionId')::uuid=(s->>'workerDefinitionId')::uuid)) then raise exception 'r07_independent_check_required'; end if;
 select value into scope from jsonb_array_elements(policy.payload->'operations') x where x->>'operationKey'=s->>'operationKey';
 if pilot and (scope->>'operationKey' is distinct from s->>'operationKey' or scope->>'provider' is distinct from 'openrouter'
 or scope->'accountId' is distinct from 'null'::jsonb or scope->'accountRevision' is distinct from 'null'::jsonb
 or scope->'sourceDomains' is distinct from binding.amendment->'allowedDomains'
 or private.r05_money(scope->'maximumPerOperationMicrounits')<>private.r05_money(s->'maximumMicrounits')) then raise exception 'r07_pilot_exact_operation';end if;
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
 if (evidence_cont or pilot) and total<>private.r05_money(policy.payload->'policyLimitMicrounits') then raise exception 'r07_evidence_exact_policy_total';end if;
 if total>private.r05_money(p->'maximumMicrounits') then raise exception 'r07_plan_budget_exceeded'; end if;
 perform private.r04_strings(p->'requiredChecks',16);
 if not(p->'requiredChecks' ? challenge_key) or exists(select 1 from jsonb_array_elements_text(p->'requiredChecks') ck where not exists(select 1 from jsonb_array_elements(p->'steps') cs where cs->>'key'=ck and cs->>'kind' in ('challenge','review'))) or (select count(*)<>count(distinct ck) from jsonb_array_elements_text(p->'requiredChecks') ck) then raise exception 'r07_invalid_required_checks'; end if;
end $function$
;

-- Preserve the installed historical branches; route only the new origin.
CREATE OR REPLACE FUNCTION private.r12_discovery_financial_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r private.r05_requests; a private.r07_attempts; p private.r07_plans; scope private.r12_discovery_scopes; budget jsonb; own_held bigint:=0; mapped_pending bigint:=0; begin
 select * into strict r from private.r05_requests where id=new.request_id and business_id=new.business_id;
 if r.payload->>'operationKey' not like 'research.r12.%' then return new;end if;
 select * into a from private.r07_attempts where id=r.workflow_run_id and business_id=r.business_id;
 select * into p from private.r07_plans where id=a.plan_id and business_id=a.business_id;
 if a.id is null or p.id is null or r.policy_id is distinct from p.policy_id or r.payload->'accounting' is distinct from '{"kind":"r05"}'::jsonb or r.payload->>'idempotencyKey' is distinct from 'r07:'||a.id or r.payload->>'operationKey' is distinct from 'research.r12.'||(p.content->>'discoveryScopeId')||'.'||a.step_key then raise exception 'r12_exact_controller_request_required';end if;
 scope:=private.r12_discovery_scope_current(p);
 if scope.origin='owner_initial' then
 budget:=private.r12_owner_scope_resolve(scope,clock_timestamp(),true)->'budget';
 if scope.budget_authority_root_id is null then
 select coalesce(sum(e.held) filter(where e.source_key=r.source_key),0) into own_held from private.r05_exposure(r.business_id)e;
 mapped_pending:=case when exists(select 1 from private.r05_settlements z where z.request_id=r.id and z.business_id=r.business_id and z.provider_request_id is not null and z.actual_microunits is not null) then 0 else own_held end;
 if (budget->>'pendingExposureMicrousd')::bigint>mapped_pending or exists(select 1 from private.r05_exposure(r.business_id)e where e.unknown and e.source_key<>r.source_key) then raise exception 'r12_owner_funding_uncertain';end if;
 else
 select coalesce(sum(e.held) filter(where e.request_id=r.id),0),coalesce(sum(e.held) filter(where e.is_pending),0) into own_held,mapped_pending from private.r12_discovery_exposure(scope.budget_authority_root_id)e;
 if (budget->>'pendingExposureMicrousd')::bigint>mapped_pending or exists(select 1 from private.r12_discovery_exposure(scope.budget_authority_root_id)e where e.is_pending and e.request_id<>r.id) then raise exception 'r12_owner_funding_uncertain';end if;
 end if;
 if (budget->>'committedMicrousd')::bigint-own_held+r.liability_microunits>(budget->>'maximumMicrousd')::bigint then raise exception 'r12_owner_funding_exceeded';end if;
 if tg_table_name='r05_markers' then perform private.r12_discovery_mark_guard(r,a,p,scope);end if;return new;end if;
 budget:=private.stage13v2_budget_authority(scope.prior_round_id,true);
 select coalesce(sum(e.held) filter(where e.request_id=r.id),0),coalesce(sum(e.held) filter(where e.is_pending),0) into own_held,mapped_pending from private.r12_discovery_exposure(scope.budget_authority_root_id) e;
 if (budget->>'pendingExposureMicrousd')::bigint>mapped_pending or exists(select 1 from private.r12_discovery_exposure(scope.budget_authority_root_id) e where e.is_pending and e.request_id<>r.id) then raise exception 'r12_original_funding_uncertain';end if;
 if (budget->>'committedMicrousd')::bigint-own_held+r.liability_microunits>(budget->>'maximumMicrousd')::bigint then raise exception 'r12_original_funding_exceeded';end if;
 -- Reservation and sent marker both recheck after the shared-root lock. The
 -- marker is still deliberately unavailable without the next exact-wire bridge.
 if tg_table_name='r05_markers' then perform private.r12_discovery_mark_guard(r,a,p,scope);end if;
 return new;
end $function$
;

-- Preserve the installed historical branches; route only the new origin.
CREATE OR REPLACE FUNCTION private.r12_discovery_phase_inputs(a private.r07_attempts, p private.r07_plans)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s private.r12_discovery_scopes;prior public.product_experiments;budget jsonb;own_held bigint:=0;own_pending bigint:=0;step jsonb;installation public.installed_packs;
 pin jsonb;dep private.r07_attempts;response private.r07_responses;wire private.r12_discovery_wires;c private.r12_discovery_candidates;r private.r05_requests;mark timestamptz;proof jsonb;dependencies jsonb:='[]';output jsonb;validation_at timestamptz:=clock_timestamp();input_mode text:='dispatch';begin
 if p.content->>'format'='r12.discovery-pilot.1' then return private.r12_pilot_phase_inputs(a,p);end if;
 if p.content->>'format'='r12.discovery-evidence.1' then return private.r12_evidence_phase_inputs(a,p);end if;
 if p.content->>'format'='r12.discovery-review.1' then return private.r12_review_phase_inputs(a,p);end if;
 if p.content->>'format' is distinct from 'r12.discovery.1' then raise exception 'r12_unknown_input_format';end if;
 select own_candidate.* into c from private.r12_discovery_candidates own_candidate join private.r12_discovery_wires own_wire on own_wire.request_id=own_candidate.request_id where own_wire.attempt_id=a.id and own_wire.business_id=p.business_id;
 if c.request_id is not null and private.r12_discovery_receipt_status(c)->>'status'='verified' then
 select created_at into strict validation_at from private.r05_markers where request_id=c.request_id;input_mode:='receipt';
 s:=private.r12_discovery_scope_at(p,validation_at);
 else s:=private.r12_discovery_scope_current(p);end if;
 if s.origin<>'owner_initial' then select * into strict prior from public.product_experiments where id=s.prior_round_id;end if;
 select value into step from jsonb_array_elements(p.content->'steps') x where x->>'key'=a.step_key;
 select * into installation from public.installed_packs where id=(step->>'installationId')::uuid and business_id=p.business_id and status='active' for share;
 if installation.id is null or private.r04_hash(installation.snapshot) is distinct from step->>'packSnapshotHash' then raise exception 'r12_knowledge_installation_changed';end if;
 budget:=case when s.origin='owner_initial' then private.r12_owner_scope_resolve(s,validation_at,input_mode='dispatch')->'budget' else private.stage13v2_budget_authority(s.prior_round_id,true) end;
 select coalesce(sum(e.held),0),coalesce(sum(e.held) filter(where e.is_pending),0) into own_held,own_pending from private.r12_discovery_exposure(s.budget_authority_root_id) e join private.r05_requests req on req.id=e.request_id where req.workflow_run_id=a.id;
 if jsonb_array_length(a.dependency_pins)>4 then raise exception 'r12_dependency_bound';end if;
 for pin in select value from jsonb_array_elements(a.dependency_pins) loop
 select * into dep from private.r07_attempts where id=(pin->>'attemptId')::uuid and business_id=p.business_id and plan_id=p.id and step_key=pin->>'stepKey' and status='completed';
 select * into response from private.r07_responses where attempt_id=dep.id and business_id=p.business_id and content_hash=pin->>'resultHash';
 select * into wire from private.r12_discovery_wires where attempt_id=dep.id and business_id=p.business_id and scope_id=s.id;
 select * into c from private.r12_discovery_candidates where request_id=wire.request_id;
 select * into r from private.r05_requests where id=wire.request_id and business_id=p.business_id;
 select created_at into mark from private.r05_markers where request_id=wire.request_id;
 if dep.id is null or response.attempt_id is null or response.content->>'outcome' is distinct from 'accepted' or wire.request_id is null or c.request_id is null or mark is null or private.r12_discovery_receipt_status(c)->>'status' is distinct from 'verified' then raise exception 'r12_completed_dependency_required';end if;
 select ro.proof into proof from private.r12_discovery_receipt_checks rc join private.r12_discovery_receipt_observations ro on ro.check_id=rc.id where rc.request_id=c.request_id and ro.proof is not null;
 if proof is null then raise exception 'r12_verified_dependency_required';end if;
 dependencies:=dependencies||jsonb_build_array(jsonb_build_object('stepKey',dep.step_key,'attemptId',dep.id,'artifactId',response.artifact_id,'responseHash',response.content_hash,'responseCanonicalHash',private.stage14_hash(response.content),'response',response.content,
 'binding',jsonb_build_object('scopeId',s.id,'attemptId',dep.id,'requestId',r.id,'phase',dep.step_key,'request',(wire.binding->>'requestJson')::jsonb,'maximumMicrousd',r.liability_microunits,'dispatchedAt',mark,'receiptExpiresAt',c.receipt_expires_at),
 'candidate',c.candidate,'proof',proof));
 end loop;
 output:=jsonb_build_object('version','r12.discovery-inputs.1','businessId',p.business_id,'planId',p.id,'attemptId',a.id,'inputMode',input_mode,'validationAt',validation_at,'knowledgeSnapshot',installation.snapshot,'knowledgeSnapshotHash',private.r04_hash(installation.snapshot),'knowledgeCanonicalHash',private.stage14_hash(installation.snapshot),
 'original',jsonb_build_object('businessId',s.business_id,'budgetAuthorityRootId',s.budget_authority_root_id,'priorRoundId',s.prior_round_id,'semanticGoalHash',prior.variables->>'semanticGoalHash','priorIntent',prior.variables->'intent','maximumMicrousd',budget->'maximumMicrousd','committedMicrousd',(budget->>'committedMicrousd')::bigint-own_held,'hasUncertainCosts',(budget->>'pendingExposureMicrousd')::bigint>own_pending),
 'amendment',s.amendment,'dependencies',dependencies);
 if s.origin='owner_initial' then
 output:=(output-'original')||jsonb_build_object('version','r12.discovery-owner-initial-inputs.1','committedMicrousd',(select coalesce(sum((x->'candidate'->>'reportedMicrousd')::bigint),0) from jsonb_array_elements(dependencies)x),'hasUncertainCosts',false);
 end if;
 if octet_length(output::text)>524288 then raise exception 'r12_complete_input_bound';end if;
 if input_mode='receipt' then
 select own_candidate.* into c from private.r12_discovery_candidates own_candidate join private.r12_discovery_wires own_wire on own_wire.request_id=own_candidate.request_id where own_wire.attempt_id=a.id and own_wire.business_id=p.business_id;
 if private.r12_discovery_receipt_status(c)->>'status' is distinct from 'verified' then raise exception 'r12_receipt_grace_ended';end if;
 perform private.r12_discovery_scope_at(p,validation_at);
 else perform private.r12_discovery_scope_current(p);end if;return output;
end $function$
;

-- Preserve the installed historical branches; route only the new origin.
CREATE OR REPLACE FUNCTION private.r12_discovery_wire_validate(r private.r05_requests, a private.r07_attempts, p private.r07_plans, s private.r12_discovery_scopes, v jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare body jsonb;q jsonb;route jsonb;msg jsonb;phase text:=a.step_key;maximum_bytes integer;tokens integer;begin
 if not coalesce(p.content->>'format' in ('r12.discovery.1','r12.discovery-review.1','r12.discovery-evidence.1','r12.discovery-pilot.1'),false) then raise exception 'r12_unknown_wire_format';end if;
 if p.content->>'format'='r12.discovery-review.1' and (phase<>'review' or not coalesce(s.amendment->>'version' in ('r12.discovery-review-continuation.1','r12.discovery-review-continuation.2'),false) or a.dependency_pins is distinct from private.r07_dependencies(p.id,p.content->'steps'->0)) then raise exception 'r12_review_only_wire_required';end if;
 if p.content->>'format'='r12.discovery-evidence.1' and (phase not in ('strategy','review') or s.amendment->>'version' is distinct from 'r12.discovery-evidence-continuation.1' or a.dependency_pins is distinct from private.r07_dependencies(p.id,(select value from jsonb_array_elements(p.content->'steps') st where st->>'key'=phase))) then raise exception 'r12_evidence_only_wire_required';end if;
 if p.content->>'format'='r12.discovery-pilot.1' and (phase not in ('strategy','review') or s.amendment->>'version' is distinct from 'r12.discovery-focused-pilot.1'
 or a.attempt<>1 or p.version<>1 or p.previous_plan_id is not null
 or a.dependency_pins is distinct from private.r07_dependencies(p.id,(select value from jsonb_array_elements(p.content->'steps') st where st->>'key'=phase))) then raise exception 'r12_pilot_only_wire_required';end if;
 perform private.r04_keys(v,array['version','scopeId','scopeHash','attemptId','requestId','phase','requestJson','requestHash','wireBody','wireHash','quote','dependencyPins']);
 if v->>'version' is distinct from 'r12.discovery-wire.1' or v->>'scopeId' is distinct from s.id::text or v->>'scopeHash' is distinct from s.amendment_hash or v->>'attemptId' is distinct from a.id::text or v->>'requestId' is distinct from r.id::text or v->>'phase' is distinct from phase or v->'dependencyPins' is distinct from a.dependency_pins or r.workflow_run_id<>a.id or r.policy_id<>p.policy_id or r.payload->>'operationKey' is distinct from 'research.r12.'||s.id::text||'.'||phase then raise exception 'r12_wire_scope_mismatch';end if;
 if v->>'requestHash' is distinct from private.stage14_hash((v->>'requestJson')::jsonb) or r.payload->>'requestHash' is distinct from v->>'requestHash' or v->>'wireHash' is distinct from encode(extensions.digest(convert_to(v->>'wireBody','UTF8'),'sha256'),'hex') or r.payload->>'wireRequestHash' is distinct from v->>'wireHash' or jsonb_typeof(v->'wireBody') is distinct from 'string' then raise exception 'r12_wire_hash_mismatch';end if;
 maximum_bytes:=case when p.content->>'format'='r12.discovery-pilot.1' then 49152 when p.content->>'format'='r12.discovery-evidence.1' then 65536 else case phase when 'plan' then 12288 when 'search1' then 8192 when 'select1' then 16384 when 'strategy' then 32768 when 'review' then 32768 end end;
 tokens:=case phase when 'plan' then 1500 when 'search1' then 4000 when 'select1' then 1000 when 'strategy' then 5000 when 'review' then 4000 end;
 if maximum_bytes is null or octet_length(v->>'wireBody')>maximum_bytes or octet_length(v->>'wireBody') is distinct from (r.payload->>'wireRequestBytes')::integer or (r.payload->>'maximumOutputTokens')::integer is distinct from tokens then raise exception 'r12_wire_bound_mismatch';end if;
 body:=(v->>'wireBody')::jsonb;q:=v->'quote';route:=q->(case when phase='review' then 'reviewer' else 'luna' end);
 if q->>'version' is distinct from (case when p.content->>'format'='r12.discovery-pilot.1' then 'r12.discovery-pilot-quote.1' when p.content->>'format'='r12.discovery-evidence.1' then 'r12.discovery-evidence-quote.1' else 'r12.discovery-quote.1' end) or (p.content->>'format'='r12.discovery-pilot.1' and q->'maximumRequestBytes' is distinct from '49152'::jsonb) or (p.content->>'format'='r12.discovery-evidence.1' and q->'maximumRequestBytes' is distinct from '65536'::jsonb) or q->>'quoteHash' is distinct from private.stage14_hash(q-array['quoteHash','verifiedAt','validUntil']) or q->'maximumCalls' is distinct from to_jsonb(case when p.content->>'format' in ('r12.discovery-evidence.1','r12.discovery-pilot.1') then 2 else 5 end) or q->'maximumCollections' is distinct from to_jsonb(case when p.content->>'format' in ('r12.discovery-evidence.1','r12.discovery-pilot.1') then 0 else 1 end) or q->'proposalOnly' is distinct from 'true'::jsonb or q->'dispatchAuthorized' is distinct from 'false'::jsonb or jsonb_typeof(q->'verifiedAt') is distinct from 'string' or jsonb_typeof(q->'validUntil') is distinct from 'string' or not isfinite((q->>'verifiedAt')::timestamptz) or not isfinite((q->>'validUntil')::timestamptz) or (q->>'verifiedAt')::timestamptz>clock_timestamp() or (q->>'validUntil')::timestamptz<=clock_timestamp() or (q->>'validUntil')::timestamptz-(q->>'verifiedAt')::timestamptz<>interval '5 minutes' then raise exception 'r12_fresh_quote_required';end if;
 if jsonb_typeof(q->'ceilings'->phase) is distinct from 'number' or q->'ceilings'->>phase !~ '^[1-9][0-9]{0,6}$' or (q->'ceilings'->>phase)::bigint>r.liability_microunits then raise exception 'r12_quote_liability_mismatch';end if;
 if route->>'modelId' is distinct from (case when phase='review' then 'anthropic/claude-haiku-4.5' else 'openai/gpt-5.6-luna' end) or route->>'endpoint' is distinct from (case when phase='review' then 'amazon-bedrock/us' else 'azure/us' end) or route->>'providerName' is distinct from (case when phase='review' then 'Amazon Bedrock' else 'Azure' end) or body->>'model' is distinct from route->>'modelId' or r.payload->>'providerModelId' is distinct from body->>'model' or body->'max_tokens' is distinct from to_jsonb(tokens) or body->'stream' is distinct from 'false'::jsonb or body->'provider'->'only' is distinct from jsonb_build_array(route->>'endpoint') or body->'provider'->'allow_fallbacks' is distinct from 'false'::jsonb or body->'provider'->'require_parameters' is distinct from 'true'::jsonb or body->'provider'->'data_collection' is distinct from '"deny"'::jsonb or body->'provider'->'zdr' is distinct from 'true'::jsonb or body->'provider'->'max_price' is distinct from route->'priceLimit' then raise exception 'r12_exact_route_required';end if;
 if r.payload->'sourceDomains' is distinct from (case when p.content->>'format'='r12.discovery-evidence.1' then s.amendment->'executionSourceDomains' else s.amendment->'allowedDomains' end) then raise exception 'r12_source_provenance_required';end if;
 perform private.r04_keys(body->'provider',array['only','allow_fallbacks','require_parameters','data_collection','zdr','max_price']);
 if jsonb_typeof(body->'messages') is distinct from 'array' or jsonb_array_length(body->'messages') not between 1 and 4 or exists(select 1 from jsonb_array_elements(body->'messages') m where jsonb_typeof(m->'content') is distinct from 'string' or not coalesce(m->>'role' in ('system','user'),false)) then raise exception 'r12_text_only_phase_required';end if;
 for msg in select value from jsonb_array_elements(body->'messages') loop perform private.r04_keys(msg,array['role','content']);end loop;
 if phase='search1' then
 perform private.r04_keys(body,array['model','provider','messages','tools','tool_choice','max_tool_calls','max_tokens','stream']);
 if body->'messages'->1->>'content' is distinct from s.amendment->>'approvedQuery' or ((v->>'requestJson')::jsonb)->>'query' is distinct from s.amendment->>'approvedQuery' or body->'tools' is distinct from jsonb_build_array(jsonb_build_object('type','openrouter:web_search','parameters',jsonb_build_object('engine','exa','mode','fast','max_uses',1,'max_results',4,'max_total_results',4,'max_characters',1800,'allowed_domains',s.amendment->'allowedDomains','excluded_domains',s.amendment->'excludedDomains'))) or body->>'tool_choice' is distinct from 'required' or body->'max_tool_calls' is distinct from '1'::jsonb or ((v->>'requestJson')::jsonb)->'allowedDomains' is distinct from s.amendment->'allowedDomains' or ((v->>'requestJson')::jsonb)->'excludedDomains' is distinct from s.amendment->'excludedDomains' then raise exception 'r12_exact_search_scope_required';end if;
 elsif body ?| array['tools','plugins','tool_choice','max_tool_calls'] or body->'response_format'->>'type' is distinct from 'json_schema' then raise exception 'r12_text_only_phase_required';end if;
 if phase<>'search1' then
 perform private.r04_keys(body,array['model','provider','messages','response_format','max_tokens','stream']||case when phase='select1' then array['reasoning'] else array[]::text[] end);
 perform private.r04_keys(body->'response_format',array['type','json_schema']);perform private.r04_keys(body->'response_format'->'json_schema',array['name','strict','schema']);
 if body->'response_format'->'json_schema'->'strict' is distinct from 'true'::jsonb or body->'response_format'->'json_schema'->>'name' is distinct from (case phase when 'plan' then 'geographic_discovery_plan_v2' when 'select1' then 'discovery_evidence_selection_v2' when 'strategy' then case when s.origin='owner_initial' then 'product_discovery_r12_owner_initial_strategy' else 'product_discovery_v2_strategy' end when 'review' then 'product_discovery_v2_review' end) or (phase='select1' and body->'reasoning' is distinct from '{"effort":"none"}'::jsonb) or (phase<>'select1' and body ? 'reasoning') then raise exception 'r12_static_nonprivate_schema_required';end if;
 if p.content->>'format'='r12.discovery-pilot.1' then
 if ((v->>'requestJson')::jsonb)->'requestMetadata'->>'r12FocusedSuccessorAuthorizationHash' is distinct from
 (select authorization_hash from private.r12_pilot_research_authorizations(s.id,s.business_id) where scope_id=s.id and business_id=s.business_id)
 then raise exception 'r12_successor_wire_proof_required';end if;
 if exists(select 1 from private.r12_pilot_research_authorizations(s.id,s.business_id) where scope_id=s.id) and phase='review'
 and not exists(select 1 from private.r07_attempts prior_a join private.r07_responses prior_r on prior_r.attempt_id=prior_a.id
 where prior_a.plan_id=p.id and prior_a.business_id=p.business_id and prior_a.step_key='strategy' and prior_a.attempt=1 and prior_a.status='completed'
 and prior_r.content->>'outcome'='accepted' and prior_r.content->'result'->>'outcome'='TEST'
 and exists(select 1 from private.r12_discovery_wires sw join private.r12_discovery_candidates sc on sc.request_id=sw.request_id where sw.attempt_id=prior_a.id and sw.scope_id=(p.content->>'discoveryScopeId')::uuid and sc.candidate->'output'->'usesPinnedLearningPlan'='true'::jsonb and sc.candidate->'output'->'recommendation'->>'proposedOutcome'='TEST'
 and not exists(select 1 from jsonb_array_elements(sc.candidate->'output'->'candidates') cand cross join lateral jsonb_array_elements(cand->'dimensions') dim where dim->'hardFailure'='true'::jsonb or exists(select 1 from jsonb_array_elements(dim->'uncertainties') u where u->'blockingForTest'='true'::jsonb)))) then raise exception 'r12_successor_strategy_terminal';end if;
 if ((v->>'requestJson')::jsonb)->'requestMetadata'->>'r12FocusedPilotProfileHash' is distinct from s.amendment->>'profileHash'
 or private.stage14_hash(((v->>'requestJson')::jsonb)->'outputSchema') is distinct from (case phase when 'strategy' then '0eeaa5590d1945e34be684d637f069f7787bfd992c4d89182d0d44831aac8ba0' else 'd1ab02be3a01b43f6c407070b284c37b8079e10eb2991013009d2c502bbd7e54' end)
 or private.stage14_hash(body->'response_format'->'json_schema'->'schema') is distinct from (case phase when 'strategy' then '6af47351df9096251feb5bc4f2f710f109ae73b27003a55576446bcfbe04727d' else '81c1f3d20dce36cd6f00e3dabf8b7bce069cf5d03628d770e7ef40172b5d734c' end)
 then raise exception 'r12_pilot_static_schema_required';end if;return;
 end if;
 if s.origin='owner_initial' and ((v->>'requestJson')::jsonb)->'requestMetadata'->>'r12OwnerInitialScopeHash' is distinct from s.amendment_hash then raise exception 'r12_owner_exact_wire_scope_required';end if;
 if private.stage14_hash(((v->>'requestJson')::jsonb)->'outputSchema') is distinct from (case phase
 when 'plan' then 'b49dfc9ddc8c2dc3c496c3d4ccf350ea383150b724dedaf3e9d99fbbe7ebcf10'
 when 'select1' then 'e1bedf858d2286df3a2007c6a17040eb4c2e42ef8f92c445979be74f02e3a39c'
 when 'strategy' then case when s.origin='owner_initial' then 'cb504caec30d5f43ab63dcb63a6691da058ec6f14e3dfffe8c0884f472a926db' else '5515b1bc5c413c852525df2fb9641f710be92418bb3bf68746577cf1663c24a3' end
 when 'review' then 'd1ab02be3a01b43f6c407070b284c37b8079e10eb2991013009d2c502bbd7e54' end)
 or private.stage14_hash(body->'response_format'->'json_schema'->'schema') is distinct from (case phase
 when 'plan' then 'ca9d827a2c2027e579902b91e4b368b4ebcd01bde1109a8332c61848c8e4c8d8'
 when 'select1' then '8ecda611f97e9ad9fb515c985be2eb93cdc1dd034d6e758760e888449d8a5cc9'
 when 'strategy' then '4d8489ecc1a39768e42f07969bb96054d40861de28ef0cd110645927a048204b'
 when 'review' then '81c1f3d20dce36cd6f00e3dabf8b7bce069cf5d03628d770e7ef40172b5d734c' end)
 then raise exception 'r12_static_nonprivate_schema_required';end if;end if;
end $function$
;

-- Preserve the installed historical branches; route only the new origin.
CREATE OR REPLACE FUNCTION public.r12_discovery_owner_read(p_business_id uuid, p_scope_id uuid, p_activation boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare source_scope private.r12_discovery_scopes;authority private.r12_discovery_authorities;saved_plan private.r07_plans;head private.r07_heads;
 phase_plan_id uuid;source_plan private.r07_plans;step jsonb;attempt private.r07_attempts;binding private.r07_bindings;request private.r05_requests;candidate private.r12_discovery_candidates;response private.r07_responses;
 phases jsonb:='[]';prior_reviews jsonb:='[]';next_review_scope_id uuid;history_item jsonb;receipt jsonb;actual bigint;held bigint;marked boolean;reserved boolean;known_total bigint:=0;held_total bigint:=0;unknown_cost boolean:=false;active boolean;stopped boolean;policy_revoked boolean;paused boolean;budget jsonb;begin
 if private.is_business_owner(p_business_id) is distinct from true then raise exception 'r12_owner_required' using errcode='42501';end if;
 select * into source_scope from private.r12_discovery_scopes where id=p_scope_id and business_id=p_business_id;if source_scope.id is null then return null;end if;
 if not coalesce(source_scope.amendment->>'version' in ('r12.discovery-owner-initial.1','r12.discovery-source-scope.1','r12.discovery-review-continuation.1','r12.discovery-review-continuation.2','r12.discovery-evidence-continuation.1','r12.discovery-focused-pilot.1'),false) then raise exception 'r12_unknown_owner_scope';end if;
 if source_scope.amendment->>'version' in ('r12.discovery-review-continuation.1','r12.discovery-review-continuation.2','r12.discovery-evidence-continuation.1') then
 select * into source_plan from private.r07_plans where id=(source_scope.amendment->>'sourcePlanId')::uuid and business_id=p_business_id and goal_id=source_scope.goal_id and content_hash=source_scope.amendment->>'sourcePlanHash';
 if source_plan.id is null then raise exception 'r12_review_owner_source_unavailable';end if;end if;
 select * into authority from private.r12_discovery_authorities where scope_id=source_scope.id;
 select * into saved_plan from private.r07_plans where business_id=p_business_id and goal_id=source_scope.goal_id and content->>'discoveryScopeId'=source_scope.id::text order by version desc limit 1;
 select * into head from private.r07_heads where plan_id=saved_plan.id;
 if source_scope.amendment->>'version' in ('r12.discovery-review-continuation.2','r12.discovery-evidence-continuation.1') then
 if source_scope.amendment->>'version'='r12.discovery-evidence-continuation.1' then
 perform private.r12_evidence_source(source_scope,clock_timestamp(),false);
 select known_total+coalesce(sum((c.candidate->>'reportedMicrousd')::bigint),0) into known_total from private.r07_attempts a join private.r12_discovery_wires w on w.attempt_id=a.id join private.r12_discovery_candidates c on c.request_id=w.request_id where a.plan_id=source_plan.id and a.step_key='strategy';
 else perform private.r12_review_successor_source(source_scope,clock_timestamp(),false);end if;
 for history_item in select value from jsonb_array_elements(source_scope.amendment->'reviewHistory') loop
 prior_reviews:=prior_reviews||jsonb_build_array(jsonb_build_object('scopeId',history_item->>'scopeId','attemptId',history_item->>'attemptId','knownMicrousd',history_item->>'actualMicrounits'));
 known_total:=known_total+(history_item->>'actualMicrounits')::bigint;
 end loop;
 end if;
 if (select count(*) from private.r12_discovery_scopes successor_scope join private.r12_review_owner_proposals proposal on proposal.scope_id=successor_scope.id
 where successor_scope.business_id=p_business_id and successor_scope.goal_id=source_scope.goal_id and successor_scope.id<>source_scope.id
 and proposal.business_id=p_business_id and proposal.owner_id=auth.uid()
 and ((successor_scope.amendment->>'version'='r12.discovery-review-continuation.1' and successor_scope.amendment->>'sourcePlanId'=saved_plan.id::text)
 or (successor_scope.amendment->>'version' in ('r12.discovery-review-continuation.2','r12.discovery-evidence-continuation.1') and successor_scope.amendment->>'predecessorPlanId'=saved_plan.id::text)))>1
 then raise exception 'r12_review_successor_ambiguous';end if;
 select successor_scope.id into next_review_scope_id from private.r12_discovery_scopes successor_scope join private.r12_review_owner_proposals proposal on proposal.scope_id=successor_scope.id
 where successor_scope.business_id=p_business_id and successor_scope.goal_id=source_scope.goal_id and successor_scope.id<>source_scope.id
 and proposal.business_id=p_business_id and proposal.owner_id=auth.uid()
 and ((successor_scope.amendment->>'version'='r12.discovery-review-continuation.1' and successor_scope.amendment->>'sourcePlanId'=saved_plan.id::text)
 or (successor_scope.amendment->>'version' in ('r12.discovery-review-continuation.2','r12.discovery-evidence-continuation.1') and successor_scope.amendment->>'predecessorPlanId'=saved_plan.id::text));
 stopped:=authority.scope_id is null or exists(select 1 from private.r05_revocations where policy_id=(authority.plan->>'policyId')::uuid) or private.r05_paused(p_business_id,'business',p_business_id) or private.r05_paused(p_business_id,'quest',source_scope.goal_id)
 or not exists(select 1 from private.r04_goal_state gs join private.r04_goal_versions gv using(goal_id,business_id,revision) where gs.goal_id=source_scope.goal_id and gs.business_id=p_business_id and gs.revision=(authority.plan->>'goalRevision')::integer and gv.preference='ready')
 or not exists(select 1 from private.r04_business_state bs join private.r04_business_versions bv using(business_id,revision) where bs.business_id=p_business_id and bs.revision=(authority.plan->>'businessRevision')::integer and bv.preference='setup');
 policy_revoked:=exists(select 1 from private.r05_revocations where policy_id=(authority.plan->>'policyId')::uuid);
 paused:=private.r05_paused(p_business_id,'business',p_business_id) or private.r05_paused(p_business_id,'quest',source_scope.goal_id) or exists(select 1 from jsonb_array_elements(authority.plan->'steps') st where private.r05_paused(p_business_id,'pack',(st->>'installationId')::uuid));
 active:=not stopped and not paused and authority.valid_until>clock_timestamp() and exists(select 1 from private.r07_server_keys k where k.key_hash=authority.controller_key_hash and k.expires_at>clock_timestamp() and not exists(select 1 from private.r07_server_revocations rev where rev.key_hash=k.key_hash)) and exists(select 1 from private.r05_server_keys k where k.key_hash=authority.admission_key_hash and k.expires_at>clock_timestamp() and not exists(select 1 from private.r05_server_revocations rev where rev.key_hash=k.key_hash));
 if authority.scope_id is not null or source_plan.id is not null then
 for step in select value from jsonb_array_elements(case when source_plan.id is null then authority.plan->'steps' else source_plan.content->'steps' end) loop
 phase_plan_id:=case when source_scope.amendment->>'version'='r12.discovery-evidence-continuation.1' and step->>'key' in ('strategy','review') then saved_plan.id when source_plan.id is not null and step->>'key'<>'review' then source_plan.id else saved_plan.id end;
 select * into attempt from private.r07_attempts where plan_id=phase_plan_id and business_id=p_business_id and step_key=step->>'key' order by private.r07_attempts.attempt desc limit 1;
 select * into binding from private.r07_bindings where attempt_id=attempt.id;
 select * into request from private.r05_requests where id=binding.request_id;
 select * into candidate from private.r12_discovery_candidates where request_id=request.id;
 select * into response from private.r07_responses where attempt_id=attempt.id;
 select max(actual_microunits) into actual from private.r05_settlements where request_id=request.id and provider_request_id is not null;
 marked:=exists(select 1 from private.r05_markers where request_id=request.id);reserved:=exists(select 1 from private.r05_reservations where request_id=request.id) and not exists(select 1 from private.r05_releases where request_id=request.id);
 held:=case when reserved and actual is null then request.liability_microunits else 0 end;
 receipt:=case when candidate.request_id is null then null else private.r12_discovery_receipt_status(candidate)-array['requestId','candidateHash','proofHash'] end;
 known_total:=known_total+coalesce(actual,0);held_total:=held_total+held;unknown_cost:=unknown_cost or marked and actual is null and not private.r12_pilot_pretransport_reconciled(request.id);
 phases:=phases||jsonb_build_array(jsonb_build_object('phase',step->>'key','status',coalesce(attempt.status,'not_started'),'reason',attempt.reason,'attemptId',attempt.id,'artifactId',response.artifact_id,
 'responseObservation',(select jsonb_build_object('receivedAt',ro.payload->'receivedAt','finishReason',ro.payload->'finishReason','nativeFinishReason',ro.payload->'nativeFinishReason',
 'contentState',ro.payload->'contentState','contentBytes',ro.payload->'contentBytes','contentHash',ro.payload->'contentHash')
 from private.r12_discovery_response_observations ro where ro.request_id=request.id and ro.kind='received'),
 'responseDiagnostic',(select jsonb_build_object('recordedAt',ro.payload->'recordedAt','code',ro.payload->'code',
 'httpStatus',ro.payload->'httpStatus','observationSaved',ro.payload->'observationSaved','issues',ro.payload->'issues')
 from private.r12_discovery_response_observations ro where ro.request_id=request.id and ro.kind='rejected'),
 'candidateSaved',candidate.request_id is not null,'receipt',receipt,'knownMicrousd',actual::text,'heldMicrousd',held::text,'unknownCost',marked and actual is null and not private.r12_pilot_pretransport_reconciled(request.id),
 'pretransportReconciled',private.r12_pilot_pretransport_reconciled(request.id),'outcome',response.content->'result'->>'outcome'));
 end loop;end if;
 if source_scope.origin='owner_initial' then
 budget:=private.r12_owner_scope_resolve(source_scope,(source_scope.amendment->>'createdAt')::timestamptz,false)->'budget';
 stopped:=stopped or exists(select 1 from private.r12_owner_setups os join private.r12_owner_bootstrap_grants gr on gr.id=os.grant_id where os.id=source_scope.owner_setup_id and (gr.valid_until<=clock_timestamp() or exists(select 1 from private.r12_owner_grant_revocations where grant_id=gr.id) or exists(select 1 from private.r12_owner_profile_revocations where profile_id=os.profile_id)));active:=active and not stopped;
 else budget:=private.stage13v2_budget_authority(source_scope.prior_round_id,false);end if;
 return jsonb_build_object('version','r12.discovery-workspace.1','businessId',p_business_id,'scopeId',source_scope.id,'goalId',source_scope.goal_id,
 'title',(select content->>'title' from private.r04_goal_versions where goal_id=source_scope.goal_id order by revision desc limit 1),
 'approvedQuery',source_scope.amendment->>'approvedQuery','sourceDomains',case when source_scope.amendment->>'version'='r12.discovery-evidence-continuation.1' then source_scope.amendment->'executionSourceDomains' else source_scope.amendment->'allowedDomains' end,'priorRoundId',source_scope.prior_round_id,'budgetAuthorityRootId',coalesce(source_scope.budget_authority_root_id,(source_scope.amendment->'funding'->>'authorityRootId')::uuid),
 'planId',saved_plan.id,'planHash',saved_plan.content_hash,'planVersion',saved_plan.version,'nextReviewScopeId',next_review_scope_id,'priorReviews',prior_reviews,'state',case when authority.scope_id is null then 'awaiting_authority' when head.state='completed' then 'completed' when policy_revoked then 'stopped' when paused then 'paused' when stopped then 'blocked' else coalesce(head.state,'prepared') end,'reason',case when policy_revoked then 'owner_stopped' when paused then 'scope_paused' when stopped and authority.scope_id is not null then 'scope_changed' else head.reason end,'policyRevoked',policy_revoked,'paused',paused,
 'activeWindow',active,'dispatchUntil',authority.valid_until,'receiptUntil',authority.receipt_until,'phases',phases,
 'cost',jsonb_build_object('knownMicrousd',known_total::text,'heldMicrousd',held_total::text,'hasUnknown',unknown_cost),'rootFunding',budget,
 'activation',case when p_activation and authority.scope_id is not null then jsonb_build_object('scope',source_scope.amendment,'plan',authority.plan,'planHash',authority.plan_hash,'mode',authority.mode,
 'controllerKeyHash',authority.controller_key_hash,'admissionKeyHash',authority.admission_key_hash,'operations',(select payload->'operations' from private.r05_policies where id=(authority.plan->>'policyId')::uuid)) else null end)||case when source_scope.amendment->>'version'='r12.discovery-evidence-continuation.1' then jsonb_build_object('sourcePhases',source_scope.amendment->'sourcePhases','addendumHash',source_scope.amendment->>'addendumHash','priorStrategy',jsonb_build_object('scopeId',source_scope.amendment->>'sourceScopeId','attemptId',source_scope.amendment->'sourcePhases'->3->>'attemptId','knownMicrousd',(select c.candidate->>'reportedMicrousd' from private.r07_attempts a join private.r12_discovery_wires w on w.attempt_id=a.id join private.r12_discovery_candidates c on c.request_id=w.request_id where a.plan_id=source_plan.id and a.step_key='strategy'))) else '{}'::jsonb end||case when source_scope.amendment->>'version'='r12.discovery-focused-pilot.1' then jsonb_build_object('focusedPilot',jsonb_build_object('profileHash',source_scope.amendment->>'profileHash','closedScopeId',(select old.content->>'discoveryScopeId' from private.r07_plans old where old.id=(source_scope.amendment->>'closedPlanId')::uuid and old.business_id=p_business_id and old.content_hash=source_scope.amendment->>'closedPlanHash'),'closedPlanId',source_scope.amendment->>'closedPlanId','acceptedReviewScopeId',source_scope.amendment->>'acceptedReviewScopeId')) else '{}'::jsonb end||coalesce((select jsonb_build_object('focusedSuccessor',jsonb_build_object('authorization',a.authorization_data,'authorizationHash',a.authorization_hash)) from private.r12_pilot_research_authorizations(source_scope.id,p_business_id) a where a.scope_id=source_scope.id and a.business_id=p_business_id),'{}'::jsonb)
 ||coalesce((select jsonb_build_object('focusedUnsentClosure',closure) from
 (select private.r12_pilot_unsent_owner_eligibility(source_scope.id,p_business_id) closure) checked where closure is not null),'{}'::jsonb)
 ||coalesce((select jsonb_build_object('focusedPretransportClosure',closure) from
 (select private.r12_pilot_pretransport_owner_eligibility(source_scope.id,p_business_id) closure) checked where closure is not null),'{}'::jsonb)
 ||case when source_scope.origin='owner_initial' then jsonb_build_object('ownerInitial',jsonb_build_object('profileId',source_scope.amendment->'profile'->>'id','profileHash',source_scope.amendment->>'profileHash','fundingKind',source_scope.amendment->'funding'->>'kind')) else '{}'::jsonb end
 ||case when head.state in ('ready','running','waiting') and head.lease_expires_at>clock_timestamp()
 and private.r12_authority_owner_current(authority)
 and (active or (not stopped and not paused and authority.receipt_until>clock_timestamp()
 and exists(select 1 from private.r07_server_keys k where k.key_hash=authority.controller_key_hash and k.expires_at>clock_timestamp()
 and not exists(select 1 from private.r07_server_revocations z where z.key_hash=k.key_hash))
 and exists(select 1 from private.r05_server_keys k where k.key_hash=authority.admission_key_hash and k.expires_at>clock_timestamp()
 and not exists(select 1 from private.r05_server_revocations z where z.key_hash=k.key_hash))
 and exists(select 1 from jsonb_array_elements(phases) phase where phase->'candidateSaved'='true'::jsonb
 and phase->>'status' in ('dispatched','uncertain','responded') and phase->'receipt'->>'status' in ('awaiting_receipt','checking_receipt','verified'))))
 and exists(select 1 from private.r12_pilot_research_authorizations(source_scope.id,p_business_id) authz_record
 where authz_record.authorization_data->>'version' in ('r12.focused-pilot-unsent-recovery-authorization.1','r12.focused-pilot-terminal-qualification-authorization.1'))
 then jsonb_build_object('continueAfter',head.lease_expires_at) else '{}'::jsonb end;
end $function$
;

-- Preserve the installed historical branches; route only the new origin.
CREATE OR REPLACE FUNCTION public.r12_discovery_result_read(p_business_id uuid, p_scope_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s private.r12_discovery_scopes;p private.r07_plans;a private.r07_attempts;dep private.r07_attempts;prior public.product_experiments;installation public.installed_packs;
 step jsonb;pin jsonb;current_phase jsonb;dependency jsonb;dependencies jsonb:='[]';at_time timestamptz;committed bigint;output jsonb;begin
 if private.is_business_owner(p_business_id) is distinct from true then raise exception 'r12_owner_required' using errcode='42501';end if;
 select * into s from private.r12_discovery_scopes where id=p_scope_id and business_id=p_business_id;if s.id is null then return null;end if;
 if s.amendment->>'version'='r12.discovery-focused-pilot.1' then return private.r12_pilot_result(s);end if;
 if s.amendment->>'version'='r12.discovery-evidence-continuation.1' then return private.r12_evidence_result(s);end if;
 if s.amendment->>'version' in ('r12.discovery-review-continuation.1','r12.discovery-review-continuation.2') then return private.r12_review_result(s);end if;
 if not coalesce(s.amendment->>'version' in ('r12.discovery-source-scope.1','r12.discovery-owner-initial.1'),false) then raise exception 'r12_unknown_result_scope';end if;
 select * into p from private.r07_plans where business_id=p_business_id and goal_id=s.goal_id and content->>'format'='r12.discovery.1' and content->>'discoveryScopeId'=s.id::text order by version desc limit 1;
 select * into a from private.r07_attempts where plan_id=p.id and business_id=p_business_id and step_key='review' and status='completed' order by private.r07_attempts.attempt desc limit 1;
 if a.id is null then return null;end if;
 if p.content->>'discoveryScopeHash' is distinct from s.amendment_hash or private.stage14_hash(s.amendment) is distinct from s.amendment_hash or jsonb_array_length(a.dependency_pins)<>4 then raise exception 'r12_completed_history_unverified';end if;
 current_phase:=private.r12_discovery_completed_phase(a,p);at_time:=(current_phase->'binding'->>'dispatchedAt')::timestamptz;
 committed:=(current_phase->'binding'->'request'->'requestMetadata'->>'r12CommittedBeforeAttemptMicrousd')::bigint;
 for pin in select value from jsonb_array_elements(a.dependency_pins) loop
 select * into dep from private.r07_attempts where id=(pin->>'attemptId')::uuid and plan_id=p.id and business_id=p_business_id and step_key=pin->>'stepKey';
 dependency:=private.r12_discovery_completed_phase(dep,p);
 if dependency->>'responseHash' is distinct from pin->>'resultHash' then raise exception 'r12_completed_history_unverified';end if;
 dependencies:=dependencies||jsonb_build_array(dependency);
 end loop;
 if (select array_agg(x->>'stepKey' order by x->>'stepKey') from jsonb_array_elements(dependencies)x) is distinct from array['plan','search1','select1','strategy'] then raise exception 'r12_completed_history_unverified';end if;
 select value into step from jsonb_array_elements(p.content->'steps')x where x->>'key'='review';
 select * into installation from public.installed_packs where id=(step->>'installationId')::uuid and business_id=p_business_id;
 if installation.id is null or private.r04_hash(installation.snapshot) is distinct from step->>'packSnapshotHash' then raise exception 'r12_completed_knowledge_unverified';end if;
 select * into prior from public.product_experiments where id=s.prior_round_id and business_id=p_business_id;
 if (s.origin<>'owner_initial' and prior.id is null) or committed is null or committed<0 or committed>=coalesce((s.amendment->'intent'->'limits'->>'maximumMicrousd')::bigint,(prior.variables->'intent'->'limits'->>'maximumMicrousd')::bigint) then raise exception 'r12_completed_history_unverified';end if;
 output:=jsonb_build_object('version','r12.discovery-saved-result.1','context',jsonb_build_object('planId',p.id,'planHash',p.content_hash,'plan',p.content,'step',step,
 'attempt',jsonb_build_object('id',a.id,'stepKey',a.step_key,'attempt',a.attempt,'status',a.status,'reason',a.reason,'inputHash',a.input_hash,'dependencyPins',a.dependency_pins,'repairEvidenceHash',a.repair_evidence_hash,'wireHash',null,'requestId',current_phase->'binding'->'requestId','responseHash',current_phase->'responseHash'),
 'knowledge',jsonb_build_object('format','r09.1','businessId',p_business_id,'planId',p.id,'pins','[]'::jsonb)),
 'inputs',jsonb_build_object('version','r12.discovery-inputs.1','businessId',p_business_id,'planId',p.id,'attemptId',a.id,'inputMode','receipt','validationAt',at_time,
 'knowledgeSnapshot',installation.snapshot,'knowledgeSnapshotHash',private.r04_hash(installation.snapshot),'knowledgeCanonicalHash',private.stage14_hash(installation.snapshot),
 'original',jsonb_build_object('businessId',s.business_id,'budgetAuthorityRootId',s.budget_authority_root_id,'priorRoundId',s.prior_round_id,'semanticGoalHash',prior.variables->>'semanticGoalHash','priorIntent',prior.variables->'intent','maximumMicrousd',prior.variables->'intent'->'limits'->'maximumMicrousd','committedMicrousd',committed,'hasUncertainCosts',false),
 'amendment',s.amendment,'dependencies',dependencies),'current',current_phase);
 if s.origin='owner_initial' then
 perform private.r12_owner_scope_resolve(s,at_time,false);
 if committed<>(select coalesce(sum((x->'candidate'->>'reportedMicrousd')::bigint),0) from jsonb_array_elements(dependencies)x) then raise exception 'r12_owner_run_cost_mismatch';end if;
 output:=jsonb_set(output,'{inputs}',((output->'inputs')-'original')||jsonb_build_object('version','r12.discovery-owner-initial-inputs.1','committedMicrousd',committed,'hasUncertainCosts',false));end if;
 if octet_length(output::text)>655360 then raise exception 'r12_completed_history_bound';end if;return output;
end $function$
;

-- Preserve the installed historical branches; route only the new origin.
CREATE OR REPLACE FUNCTION public.r12_discovery_scope_read(p_business_id uuid, p_scope_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s private.r12_discovery_scopes; prior public.product_experiments; budget jsonb; begin
 if private.is_business_owner(p_business_id) is distinct from true then raise exception 'r12_scope_not_owned' using errcode='42501';end if;
 select * into s from private.r12_discovery_scopes where id=p_scope_id and business_id=p_business_id;
 if s.id is null then return null;end if;
 if s.origin='owner_initial' then perform private.r12_owner_scope_resolve(s,clock_timestamp(),true);return jsonb_build_object('amendment',s.amendment,'amendmentHash',s.amendment_hash,'executionAuthorized',false);end if;
 if s.amendment->>'version' is distinct from 'r12.discovery-source-scope.1' then raise exception 'r12_source_scope_only';end if;
 select * into strict prior from public.product_experiments where id=s.prior_round_id and business_id=p_business_id;
 if s.amendment->>'version'='r12.discovery-focused-pilot.1' then
 perform private.r12_pilot_source(s,clock_timestamp(),true);
 if not exists(select 1 from private.r04_goal_versions gv join private.r04_goal_state gs using(goal_id,business_id,revision) where gv.goal_id=s.goal_id and gv.business_id=s.business_id and gv.preference='ready' and gv.content->'objective'=s.amendment->'profile'->'intent'->'objective' and gv.content->'parsed'->'geography'='["GB"]'::jsonb) then raise exception 'r12_pilot_owner_goal_changed';end if;
 budget:=private.stage13v2_budget_authority(prior.id,false);
 return jsonb_build_object('original',jsonb_build_object('businessId',s.business_id,'budgetAuthorityRootId',s.budget_authority_root_id,'priorRoundId',s.prior_round_id,'semanticGoalHash',prior.variables->>'semanticGoalHash','priorIntent',prior.variables->'intent','maximumMicrousd',budget->'maximumMicrousd','committedMicrousd',budget->'committedMicrousd','hasUncertainCosts',budget->'hasUncertainCosts'),'amendment',s.amendment,'amendmentHash',s.amendment_hash,'executionAuthorized',false);
 end if;
 if (s.amendment->>'expiresAt')::timestamptz<=clock_timestamp() or prior.status not in ('failed','completed') or exists(select 1 from public.product_experiments newer where newer.business_id=p_business_id and newer.discovery_version='pod-discovery-2.0' and newer.parent_discovery_id is null and newer.candidate_id is null and newer.variables->>'budgetAuthorityRootId'=s.budget_authority_root_id::text and (newer.created_at,newer.id)>(prior.created_at,prior.id)) or not exists(select 1 from private.r04_goal_versions gv join private.r04_goal_state gs using(goal_id,business_id,revision) where gv.goal_id=s.goal_id and gv.business_id=p_business_id and gv.preference='ready' and gv.content->>'objective'=prior.variables->'intent'->>'objective' and (select jsonb_agg(x order by x) from jsonb_array_elements_text(gv.content->'parsed'->'geography') x)=(select jsonb_agg(x->>'countryCode' order by x->>'countryCode') from jsonb_array_elements(prior.variables->'intent'->'comparisonUniverse'->'markets') x)) then raise exception 'r12_scope_no_longer_current';end if;
 budget:=private.stage13v2_budget_authority(prior.id,false);
 return jsonb_build_object('original',jsonb_build_object('businessId',s.business_id,'budgetAuthorityRootId',s.budget_authority_root_id,'priorRoundId',s.prior_round_id,'semanticGoalHash',prior.variables->>'semanticGoalHash','priorIntent',prior.variables->'intent','maximumMicrousd',budget->'maximumMicrousd','committedMicrousd',budget->'committedMicrousd','hasUncertainCosts',budget->'hasUncertainCosts'),'amendment',s.amendment,'amendmentHash',s.amendment_hash,'executionAuthorized',false);
end $function$
;

CREATE OR REPLACE FUNCTION private.r12_plan_qualification(b uuid, g uuid, v jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select exists(select 1 from private.r12_discovery_authorities q join private.r12_discovery_scopes s on s.id=q.scope_id
 where q.business_id=b and q.goal_id=g and q.plan=v and q.plan_hash=private.r04_hash(v) and v->>'format' in ('r12.discovery.1','r12.discovery-review.1','r12.discovery-evidence.1','r12.discovery-pilot.1') and v->>'discoveryScopeId'=s.id::text and v->>'discoveryScopeHash'=s.amendment_hash and ((v->>'format'='r12.discovery-pilot.1' and s.amendment->>'version'='r12.discovery-focused-pilot.1') or (v->>'format'='r12.discovery.1' and s.amendment->>'version' in ('r12.discovery-source-scope.1','r12.discovery-owner-initial.1')) or (v->>'format'='r12.discovery-review.1' and s.amendment->>'version' in ('r12.discovery-review-continuation.1','r12.discovery-review-continuation.2')) or (v->>'format'='r12.discovery-evidence.1' and s.amendment->>'version'='r12.discovery-evidence-continuation.1')) and (v->>'format'<>'r12.discovery-evidence.1' or s.amendment->>'version'='r12.discovery-evidence-continuation.1') and q.valid_until>clock_timestamp() and private.r12_authority_owner_current(q))
$function$
;

-- No private helper or table is an application API. The server RPC itself
-- requires real owner auth AND the separately enrolled grant capability.
DO $$ declare f record;begin for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'r12_owner_%' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);end loop;end $$;
revoke all on function public.r12_owner_research_read(uuid,uuid,uuid),public.r12_owner_research_server(uuid,text,jsonb,text) from public,anon,service_role;
grant execute on function public.r12_owner_research_read(uuid,uuid,uuid),public.r12_owner_research_server(uuid,text,jsonb,text) to authenticated;
commit;
