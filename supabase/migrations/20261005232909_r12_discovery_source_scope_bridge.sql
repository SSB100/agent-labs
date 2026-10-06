-- R12 definition only. No scope, Goal, key, source permission, funding or
-- execution adapter is enrolled. Original experiments/hashes remain immutable.
begin;
create table private.r12_discovery_scopes (
 id uuid primary key,
 business_id uuid not null references public.businesses(id),
 goal_id uuid not null,
 budget_authority_root_id uuid not null,
 prior_round_id uuid not null,
 amendment jsonb not null,
 amendment_hash text not null check(amendment_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 unique(id,business_id),
 foreign key(goal_id,business_id) references private.r04_goal_state(goal_id,business_id),
 foreign key(budget_authority_root_id,business_id) references public.product_experiments(id,business_id),
 foreign key(prior_round_id,business_id) references public.product_experiments(id,business_id)
);
alter table private.r12_discovery_scopes enable row level security;
revoke all on private.r12_discovery_scopes from public,anon,authenticated,service_role;

-- The old semantic identity includes sourceDomains. Preserve it as the original
-- lineage pin; an explicit source-only amendment is a separate identity.
create function private.r12_discovery_scope_validate() returns trigger language plpgsql set search_path='' as $$
declare prior public.product_experiments; goal private.r04_goal_versions; a jsonb; scope jsonb; domains text[]; excluded text[]; item jsonb; d text; begin
 if current_user in ('anon','authenticated','service_role') then raise exception 'r12_trusted_scope_registration_required' using errcode='42501';end if;
 if tg_op<>'INSERT' then raise exception 'r12_immutable_source_amendment';end if;
 perform 1 from public.businesses where id=new.business_id for update;
 a:=new.amendment;
 perform private.r04_safe(a);
 perform private.r04_keys(a,array['version','id','businessId','goalId','budgetAuthorityRootId','priorRoundId','originalIntentHash','originalSemanticGoalHash','allowedDomains','excludedDomains','sourceReviews','approvalHash','independentReviewHash','purposeReviewHash','createdAt','expiresAt']);
 if a->>'version' is distinct from 'r12.discovery-source-scope.1' or a->>'id' is distinct from new.id::text or a->>'businessId' is distinct from new.business_id::text or a->>'goalId' is distinct from new.goal_id::text or a->>'budgetAuthorityRootId' is distinct from new.budget_authority_root_id::text or a->>'priorRoundId' is distinct from new.prior_round_id::text or new.id in(new.budget_authority_root_id,new.prior_round_id) then raise exception 'r12_scope_identity_mismatch';end if;
 foreach d in array array['originalIntentHash','originalSemanticGoalHash','approvalHash','independentReviewHash','purposeReviewHash'] loop
 if jsonb_typeof(a->d) is distinct from 'string' or a->>d !~ '^[a-f0-9]{64}$' then raise exception 'r12_review_pin_required';end if;end loop;
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
end $$;
create trigger r12_discovery_scope_validate before insert or update or delete on private.r12_discovery_scopes for each row execute function private.r12_discovery_scope_validate();
revoke all on function private.r12_discovery_scope_validate() from public,anon,authenticated,service_role;

-- Scope preparation is read-only and explicitly confers no execution authority.
-- No secret/token/key columns are returned or consulted by this read.
create function public.r12_discovery_scope_read(p_business_id uuid,p_scope_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s private.r12_discovery_scopes; prior public.product_experiments; budget jsonb; begin
 if private.is_business_owner(p_business_id) is distinct from true then raise exception 'r12_scope_not_owned' using errcode='42501';end if;
 select * into s from private.r12_discovery_scopes where id=p_scope_id and business_id=p_business_id;
 if s.id is null then return null;end if;
 select * into strict prior from public.product_experiments where id=s.prior_round_id and business_id=p_business_id;
 if (s.amendment->>'expiresAt')::timestamptz<=clock_timestamp() or prior.status not in ('failed','completed') or exists(select 1 from public.product_experiments newer where newer.business_id=p_business_id and newer.discovery_version='pod-discovery-2.0' and newer.parent_discovery_id is null and newer.candidate_id is null and newer.variables->>'budgetAuthorityRootId'=s.budget_authority_root_id::text and (newer.created_at,newer.id)>(prior.created_at,prior.id)) or not exists(select 1 from private.r04_goal_versions gv join private.r04_goal_state gs using(goal_id,business_id,revision) where gv.goal_id=s.goal_id and gv.business_id=p_business_id and gv.preference='ready' and gv.content->>'objective'=prior.variables->'intent'->>'objective' and (select jsonb_agg(x order by x) from jsonb_array_elements_text(gv.content->'parsed'->'geography') x)=(select jsonb_agg(x->>'countryCode' order by x->>'countryCode') from jsonb_array_elements(prior.variables->'intent'->'comparisonUniverse'->'markets') x)) then raise exception 'r12_scope_no_longer_current';end if;
 budget:=private.stage13v2_budget_authority(prior.id,false);
 return jsonb_build_object('original',jsonb_build_object('businessId',s.business_id,'budgetAuthorityRootId',s.budget_authority_root_id,'priorRoundId',s.prior_round_id,'semanticGoalHash',prior.variables->>'semanticGoalHash','priorIntent',prior.variables->'intent','maximumMicrousd',budget->'maximumMicrousd','committedMicrousd',budget->'committedMicrousd','hasUncertainCosts',budget->'hasUncertainCosts'),'amendment',s.amendment,'amendmentHash',s.amendment_hash,'executionAuthorized',false);
end $$;
revoke all on function public.r12_discovery_scope_read(uuid,uuid) from public,anon,service_role;
grant execute on function public.r12_discovery_scope_read(uuid,uuid) to authenticated;
commit;
