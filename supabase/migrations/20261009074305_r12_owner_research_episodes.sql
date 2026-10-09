-- Definition-only same-Goal research episodes. No enrollments or provider effects.
begin;
alter table private.r12_owner_bootstrap_grants add column continuation_bounds jsonb;
alter table private.r12_owner_bootstrap_grants add constraint r12_owner_continuation_bounds check(continuation_bounds is null or (
 jsonb_typeof(continuation_bounds)='object' and continuation_bounds ?& array['maximumEpisodes','maximumAllocationMicrounits','expiresAt']
 and continuation_bounds-array['maximumEpisodes','maximumAllocationMicrounits','expiresAt']='{}'::jsonb
 and jsonb_typeof(continuation_bounds->'maximumEpisodes')='number' and continuation_bounds->>'maximumEpisodes' ~ '^[1-5]$'
 and jsonb_typeof(continuation_bounds->'maximumAllocationMicrounits')='string' and continuation_bounds->>'maximumAllocationMicrounits' ~ '^[1-9][0-9]{0,15}$'
 and (continuation_bounds->>'maximumAllocationMicrounits')::numeric<=9007199254740991
 and jsonb_typeof(continuation_bounds->'expiresAt')='string' and isfinite((continuation_bounds->>'expiresAt')::timestamptz)
 and (continuation_bounds->>'expiresAt')::timestamptz>valid_from and (continuation_bounds->>'expiresAt')::timestamptz<=valid_until));
create table private.r12_owner_episode_closures (
 predecessor_plan_id uuid primary key references private.r07_plans(id),business_id uuid not null,goal_id uuid not null,
 proof jsonb not null,proof_hash text not null check(proof_hash=private.stage14_hash(proof)),created_at timestamptz not null default clock_timestamp(),
 foreign key(goal_id,business_id) references private.r04_goal_state(goal_id,business_id)
);
create table private.r12_owner_episode_activations (
 setup_id uuid primary key references private.r12_owner_setups(id),business_id uuid not null,goal_id uuid not null,
 scope_id uuid not null unique references private.r12_discovery_scopes(id),grant_root_id uuid not null references private.r12_owner_grant_roots(id),
 predecessor_plan_id uuid not null unique references private.r12_owner_episode_closures(predecessor_plan_id),
 plan_id uuid not null unique references private.r07_plans(id) deferrable initially deferred,
 episode_number integer not null check(episode_number between 1 and 5),allocation_microunits bigint not null check(allocation_microunits between 1 and 2000000),
 closure_hash text not null,created_at timestamptz not null default clock_timestamp(),unique(business_id,goal_id,episode_number),
 foreign key(goal_id,business_id) references private.r04_goal_state(goal_id,business_id)
);
create index r12_owner_episode_root_usage on private.r12_owner_episode_activations(grant_root_id) include(allocation_microunits);
DO $$ declare n text;begin foreach n in array array['r12_owner_episode_closures','r12_owner_episode_activations'] loop
 execute format('alter table private.%I enable row level security',n);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);
 execute format('create trigger owner_immutable before insert or update or delete on private.%I for each row execute function private.r12_owner_immutable()',n);
 end loop;end $$;
alter table private.r12_discovery_scopes drop constraint r12_discovery_scopes_origin_check;
alter table private.r12_discovery_scopes add constraint r12_discovery_scopes_origin_check check(origin in ('legacy','owner_initial','owner_episode'));
alter table private.r12_discovery_scopes drop constraint r12_owner_origin_exact;
alter table private.r12_discovery_scopes add constraint r12_owner_origin_exact check(
 (origin='legacy' and owner_setup_id is null and budget_authority_root_id is not null and prior_round_id is not null and amendment->>'version' not in ('r12.discovery-owner-initial.1','r12.discovery-owner-episode.1')) or
 (origin='owner_initial' and owner_setup_id is not null and amendment->>'version'='r12.discovery-owner-initial.1' and
 ((amendment->'funding'->>'kind'='r05_business' and budget_authority_root_id is null and prior_round_id is null) or
 (amendment->'funding'->>'kind'='legacy_research_root' and budget_authority_root_id is not null and prior_round_id is not null))) or
 (origin='owner_episode' and owner_setup_id is not null and amendment->>'version'='r12.discovery-owner-episode.1' and
 ((amendment->'funding'->>'kind'='r05_business' and budget_authority_root_id is null and prior_round_id is null) or
 (amendment->'funding'->>'kind'='legacy_research_root' and budget_authority_root_id is not null and prior_round_id is not null))));
alter table private.r07_plans drop constraint r07_plans_version_check;
alter table private.r07_plans add constraint r07_plans_version_check check(version between 1 and 4 or (version between 5 and 9 and content->>'format'='r12.discovery-episode.1'));

-- The proof is a read-only reconstruction, not a synthetic terminal result.
-- A paid failed/uncertain attempt can be closed only with known final settlement
-- and irrevocably revoked policy plus both execution capabilities.
create function private.r12_owner_episode_predecessor(b uuid,g uuid) returns jsonb language plpgsql set search_path='' as $$
declare h private.r07_heads;p private.r07_plans;s private.r12_discovery_scopes;binding private.r12_owner_funding_bindings;
 gv private.r04_goal_versions;bv private.r04_business_versions;root_plan private.r07_plans;root_scope private.r12_discovery_scopes;
 children integer;dispatches integer;repairs integer;known bigint;history jsonb;source jsonb;genesis integer;begin
 select * into h from private.r07_heads where business_id=b and goal_id=g;
 select * into p from private.r07_plans where id=h.plan_id and business_id=b and goal_id=g;
 select * into s from private.r12_discovery_scopes where id=(p.content->>'discoveryScopeId')::uuid and business_id=b and goal_id=g;
 select * into binding from private.r12_owner_funding_bindings where business_id=b;
 select v.* into gv from private.r04_goal_versions v join private.r04_goal_state st using(business_id,goal_id,revision) where v.business_id=b and v.goal_id=g;
 select v.* into bv from private.r04_business_versions v join private.r04_business_state st using(business_id,revision) where v.business_id=b;
 select * into root_plan from private.r07_plans where business_id=b and goal_id=g and version=1;
 select * into root_scope from private.r12_discovery_scopes where id=(root_plan.content->>'discoveryScopeId')::uuid;
 genesis:=case when root_scope.origin='owner_initial' then 1 else 4 end;
 if p.id is null or s.id is null or binding.id is null or p.version<genesis or p.version>8
 or not ((p.version=1 and s.origin='owner_initial' and p.content->>'format'='r12.discovery.1') or p.content->>'format' in ('r12.discovery-evidence.1','r12.discovery-episode.1'))
 or binding.authority_root_id is distinct from coalesce(s.budget_authority_root_id,b)
 or gv.preference is distinct from 'ready' or bv.preference is distinct from 'setup'
 or not exists(select 1 from public.businesses where id=b and owner_user_id=p.owner_id)
 or exists(select 1 from private.r12_owner_episode_activations where predecessor_plan_id=p.id)
 then raise exception 'r12_episode_exact_closed_predecessor_required';end if;
 -- Exhausted four-plan lineage must be real, connected, scope/authority-bound,
 -- and owned by the current owner. Every later row must be an activated episode.
 if (select count(*) from private.r07_plans where business_id=b and goal_id=g)<>p.version
 or exists(select 1 from private.r07_plans x left join private.r07_plans prev on prev.id=x.previous_plan_id
 left join private.r12_discovery_scopes sc on sc.id=(x.content->>'discoveryScopeId')::uuid and sc.business_id=b and sc.goal_id=g
 left join private.r12_discovery_authorities q on q.scope_id=sc.id and q.business_id=b and q.goal_id=g
 left join private.r05_policies pol on pol.id=x.policy_id and pol.business_id=b and pol.goal_id=g
 where x.business_id=b and x.goal_id=g and (x.content_hash is distinct from private.r04_hash(x.content)
 or x.owner_id<>p.owner_id or sc.id is null or sc.amendment_hash is distinct from private.stage14_hash(sc.amendment)
 or x.content->>'discoveryScopeHash' is distinct from sc.amendment_hash or coalesce(sc.budget_authority_root_id,b) is distinct from binding.authority_root_id
 or sc.prior_round_id is distinct from s.prior_round_id or q.scope_id is null or q.plan is distinct from x.content or q.plan_hash is distinct from x.content_hash
 or pol.id is null or pol.content_hash is distinct from x.content->>'policyHash' or pol.actor_id<>p.owner_id
 or not exists(select 1 from private.r05_confirmations c where c.policy_id=pol.id and c.actor_id=p.owner_id)
 or (x.version=1 and (x.previous_plan_id is not null or x.content->>'format'<>'r12.discovery.1'))
 or (x.version>1 and (prev.id is null or prev.version<>x.version-1 or prev.business_id<>b or prev.goal_id<>g))
 or (genesis=4 and x.version in(2,3) and x.content->>'format'<>'r12.discovery-review.1')
 or (genesis=4 and x.version=4 and x.content->>'format'<>'r12.discovery-evidence.1')
 or (x.version>genesis and (x.content->>'format'<>'r12.discovery-episode.1' or not exists(select 1 from private.r12_owner_episode_activations ep where ep.plan_id=x.id and ep.predecessor_plan_id=x.previous_plan_id and ep.episode_number=x.version-genesis and ep.business_id=b and ep.goal_id=g)))
 or not exists(select 1 from private.r05_revocations z where z.policy_id=x.policy_id and z.business_id=b)
 or (not exists(select 1 from private.r07_server_revocations z where z.key_hash=q.controller_key_hash) and not exists(select 1 from private.r07_server_keys k where k.key_hash=q.controller_key_hash and k.expires_at<=clock_timestamp()))
 or (not exists(select 1 from private.r05_server_revocations z where z.key_hash=q.admission_key_hash) and not exists(select 1 from private.r05_server_keys k where k.key_hash=q.admission_key_hash and k.expires_at<=clock_timestamp()))))
 then raise exception 'r12_episode_genuine_closed_lineage_required';end if;
 if genesis=4 then
 select * into root_plan from private.r07_plans where business_id=b and goal_id=g and version=4;
 select * into root_scope from private.r12_discovery_scopes where id=(root_plan.content->>'discoveryScopeId')::uuid;
 -- Existing historical evidence validator proves successful source outputs,
 -- both real prior reviews, all immutable reuse links and settlement hashes.
 source:=private.r12_evidence_source(root_scope,(root_scope.amendment->>'createdAt')::timestamptz,false);
 if root_plan.previous_plan_id is distinct from (root_scope.amendment->>'predecessorPlanId')::uuid
 or (select count(*) from private.r07_reused where plan_id=root_plan.id)<>3 then raise exception 'r12_episode_genuine_closed_lineage_required';end if;
 else
 perform private.r12_owner_scope_resolve(root_scope,(root_scope.amendment->>'createdAt')::timestamptz,false);
 if not exists(select 1 from private.r12_owner_activations ep where ep.scope_id=root_scope.id and ep.business_id=b and ep.goal_id=g)
 or root_plan.previous_plan_id is not null or exists(select 1 from private.r07_reused where plan_id=root_plan.id) then raise exception 'r12_episode_genuine_closed_lineage_required';end if;
 end if;
 if exists(select 1 from private.r07_attempts a where a.business_id=b and a.goal_id=g and a.status in('scheduled','reserved'))
 or exists(select 1 from private.r05_exposure(b) where unknown)
 or (private.r12_owner_funding(binding)->>'pendingMicrounits')::bigint<>0
 then raise exception 'r12_episode_unresolved_predecessor';end if;
 -- All marked requests need a known provider-bound final settlement. A null
 -- amount, unmarked reservation or a fabricated terminal status is not closure.
 if exists(select 1 from private.r07_attempts a join private.r05_requests r on r.workflow_run_id=a.id and r.business_id=b
 join private.r05_reservations rs on rs.request_id=r.id where a.business_id=b and a.goal_id=g
 and not exists(select 1 from private.r05_releases rel where rel.request_id=r.id)
 and (not exists(select 1 from private.r05_markers m where m.request_id=r.id) or not exists(select 1 from private.r05_settlements z where z.request_id=r.id and z.actual_microunits is not null and z.provider_request_id is not null)))
 then raise exception 'r12_episode_unresolved_predecessor';end if;
 select count(*) into children from private.r07_children where business_id=b and goal_id=g;
 select count(*) into dispatches from private.r07_markers m join private.r07_attempts a on a.id=m.attempt_id where a.business_id=b and a.goal_id=g;
 select count(*) into repairs from private.r07_attempts where business_id=b and goal_id=g and attempt>1;
 if h.children_created<>children or h.dispatches<>dispatches or h.repairs_used<>repairs or repairs<>0 or h.pivots_used<>0
 or children+5>32 or dispatches+5>64 then raise exception 'r12_episode_lifetime_bound';end if;
 select coalesce(sum(e.held),0) into known from private.r07_attempts a join private.r07_bindings rb on rb.attempt_id=a.id
 join private.r05_requests r on r.id=rb.request_id join lateral private.r05_exposure(b)e on e.source_key=r.source_key where a.business_id=b and a.goal_id=g;
 history:=jsonb_build_object('plans',(select jsonb_agg(to_jsonb(x) order by version) from private.r07_plans x where business_id=b and goal_id=g),
 'attempts',(select jsonb_agg(to_jsonb(x) order by id) from private.r07_attempts x where business_id=b and goal_id=g),
 'settlements',(select jsonb_agg(to_jsonb(z) order by z.id) from private.r05_settlements z join private.r05_requests r on r.id=z.request_id join private.r07_attempts a on a.id=r.workflow_run_id where a.business_id=b and a.goal_id=g));
 return jsonb_build_object('version','r12.owner-episode-closure.1','businessId',b,'goalId',g,'predecessorPlanId',p.id,'predecessorPlanHash',p.content_hash,'predecessorPlanVersion',p.version,
 'predecessorScopeId',s.id,'predecessorScopeHash',s.amendment_hash,'goalRevision',gv.revision,'goalHash',gv.content_hash,'businessRevision',bv.revision,'businessHash',bv.content_hash,
 'authorityRootId',binding.authority_root_id,'priorRoundId',s.prior_round_id,'originalSemanticGoalHash',binding.original_semantic_goal_hash,
 'headRevision',h.revision,'headState',h.state,'headReason',h.reason,'baseChildren',children,'baseDispatches',dispatches,'baseRepairs',repairs,'basePivots',h.pivots_used,'baseKnownMicrounits',known::text,'historyHash',private.stage14_hash(history));
end $$;

create function private.r12_owner_episode_eligibility(b uuid,g uuid) returns jsonb language plpgsql set search_path='' as $$
declare proof jsonb;begin
 proof:=private.r12_owner_episode_predecessor(b,g);
 return jsonb_build_object('eligible',true,'reason',null,'predecessorClosure',proof,'predecessorClosureHash',private.stage14_hash(proof));
 exception when others then return jsonb_build_object('eligible',false,'reason','closed_settled_lineage_required','predecessorClosure',null,'predecessorClosureHash',null);
end $$;

create function private.r12_owner_episode_scope_resolve(s private.r12_discovery_scopes,at_time timestamptz,require_current boolean default false) returns jsonb language plpgsql set search_path='' as $$
declare setup private.r12_owner_setups;profile private.r12_owner_profiles;gr private.r12_owner_bootstrap_grants;binding private.r12_owner_funding_bindings;funding jsonb;selection jsonb;a jsonb:=s.amendment;begin
 if s.origin is distinct from 'owner_episode' or a->>'version' is distinct from 'r12.discovery-owner-episode.1' then raise exception 'r12_owner_scope_required';end if;
 select * into setup from private.r12_owner_setups where id=s.owner_setup_id and business_id=s.business_id and goal_id=s.goal_id and scope_id=s.id;
 select * into profile from private.r12_owner_profiles where id=setup.profile_id;select * into gr from private.r12_owner_bootstrap_grants where id=setup.grant_id;
 select * into binding from private.r12_owner_funding_bindings where id=setup.binding_id and business_id=s.business_id;
 if require_current then perform 1 from public.businesses where id=s.business_id and owner_user_id=setup.owner_id for update;else perform 1 from public.businesses where id=s.business_id and owner_user_id=setup.owner_id;end if;
 if not found then raise exception 'r12_owner_changed';end if;
 if require_current and binding.kind='legacy_research_root' then perform 1 from public.product_experiments where id=binding.authority_root_id and business_id=s.business_id for update;end if;
 perform private.r04_keys(a,array['version','id','businessId','goalId','goalRevision','goalHash','businessRevision','businessHash','setupId','setupHash','profile','profileHash','selection','funding','fundingApproval','intent','allowedDomains','excludedDomains','approvedQuery','approvalHash','independentReviewHash','createdAt','expiresAt','episodeNumber','predecessorClosure','predecessorClosureHash']);
 if setup.id is null or profile.id is null or binding.id is null or gr.id is null or a->>'id' is distinct from s.id::text or a->>'businessId' is distinct from s.business_id::text or a->>'goalId' is distinct from s.goal_id::text
 or a->>'setupId' is distinct from setup.id::text or a->>'setupHash' is distinct from setup.setup_hash or s.amendment_hash is distinct from private.stage14_hash(a)
 or a->'profile' is distinct from profile.profile or a->>'profileHash' is distinct from profile.profile_hash or a->>'approvalHash' is distinct from private.r12_owner_confirmation_hash(setup) or a->>'independentReviewHash' is distinct from profile.profile->>'independentReviewHash'
 or a->'selection' is distinct from setup.preview->'selection' or a->'goalRevision' is distinct from setup.preview->'goalRevision' or a->'goalHash' is distinct from setup.preview->'goalHash' or a->'businessRevision' is distinct from setup.preview->'businessRevision' or a->'businessHash' is distinct from setup.preview->'businessHash'
 or (a->>'createdAt')::timestamptz>at_time or (a->>'expiresAt')::timestamptz<=at_time or (a->>'expiresAt')::timestamptz<>setup.cutoff or gr.business_id<>s.business_id or gr.owner_id<>setup.owner_id or gr.profile_id<>profile.id
 or gr.business_revision<>(a->>'businessRevision')::integer or gr.business_hash is distinct from a->>'businessHash'
 or gr.valid_from>at_time or gr.valid_until<setup.cutoff or exists(select 1 from private.r12_owner_grant_revocations r where r.grant_id=gr.id and r.created_at<=at_time)
 then raise exception 'r12_owner_scope_binding_invalid';end if;
 if setup.preview->>'version' is distinct from 'r12.owner-research-episode-preview.1'
 or a->'predecessorClosure' is distinct from setup.preview->'predecessorClosure'
 or a->>'predecessorClosureHash' is distinct from private.stage14_hash(a->'predecessorClosure')
 or a->'episodeNumber' is distinct from setup.preview->'episodeNumber'
 or not exists(select 1 from private.r12_owner_episode_closures cl where cl.predecessor_plan_id=(a->'predecessorClosure'->>'predecessorPlanId')::uuid and cl.business_id=s.business_id and cl.goal_id=s.goal_id and cl.proof=a->'predecessorClosure' and cl.proof_hash=a->>'predecessorClosureHash')
 or gr.continuation_bounds is null or (gr.continuation_bounds->>'expiresAt')::timestamptz<setup.cutoff
 or binding.authority_root_id is distinct from (a->'predecessorClosure'->>'authorityRootId')::uuid
 or binding.original_semantic_goal_hash is distinct from a->'predecessorClosure'->>'originalSemanticGoalHash'
 then raise exception 'r12_episode_scope_proof_invalid';end if;
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

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_owner_scope_resolve(private.r12_discovery_scopes,timestamp with time zone,boolean)'::regprocedure);
 if position($old$ if s.origin is distinct from 'owner_initial'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r12_owner_scope_resolve(private.r12_discovery_scopes,timestamp with time zone,boolean)';end if;
 d:=replace(d,$old$ if s.origin is distinct from 'owner_initial'$old$,$new$ if s.origin='owner_episode' then return private.r12_owner_episode_scope_resolve(s,at_time,require_current);end if;
 if s.origin is distinct from 'owner_initial'$new$);
 execute d;end $episode_patch$;

create function private.r12_owner_episode_server(p_business_id uuid,p_operation text,p_payload jsonb,p_server_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare input jsonb;q jsonb;gr private.r12_owner_bootstrap_grants;rt private.r12_owner_grant_roots;profile private.r12_owner_profiles;binding private.r12_owner_funding_bindings;
 goal private.r04_goal_versions;br private.r04_business_versions;cap private.r05_cap_versions;setup private.r12_owner_setups;old private.r12_owner_submissions;policy private.r05_policies;installed public.installed_packs;
 funding jsonb;selected jsonb;preview jsonb;ops jsonb:='[]';steps jsonb:='[]';policy_body jsonb;proposed jsonb;plan jsonb;amendment jsonb;approval jsonb;revision_body jsonb;
 sid uuid;iid uuid;setup_id uuid;submission uuid;h text;purpose_digest text;phase text;operation_key text;adapter_key text;purpose text;data_classes jsonb;model text;amount bigint;bytes integer;tokens integer;ord integer:=0;
 committed bigint;unknown boolean;maximum bigint;research_maximum bigint;stamp timestamptz:=date_trunc('milliseconds',clock_timestamp());cutoff timestamptz;dispatch_until timestamptz;receipt_until timestamptz;
 closure jsonb;episode_number integer;next_plan_id uuid:=gen_random_uuid();previous_plan private.r07_plans;head private.r07_heads;
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
 if p_operation is null or p_operation not in ('prepare_episode','confirm_episode') then raise exception 'r12_owner_operation_unavailable';end if;
 if p_operation='prepare_episode' then
 perform private.r04_keys(p_payload,array['input','quote']);input:=p_payload->'input';q:=p_payload->'quote';
 perform private.r04_keys(input,array['businessId','goalId','goalRevision','profileId','profileHash','grantId','marketSetKey','topicKey','businessLifetimeLimitMicrounits','researchLifetimeLimitMicrounits','submissionId','predecessorPlanId','predecessorPlanHash','predecessorScopeId','predecessorScopeHash']);
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
 if gr.continuation_bounds is null or (gr.continuation_bounds->>'expiresAt')::timestamptz<=stamp+interval '35 minutes' then raise exception 'r12_episode_grant_required';end if;
 if p_operation='confirm_episode' and exists(select 1 from private.r12_owner_episode_activations ep where ep.setup_id=setup.id) then return private.r12_owner_setup_receipt(setup);end if;
 select * into head from private.r07_heads where business_id=p_business_id and goal_id=goal.goal_id for update;
 closure:=private.r12_owner_episode_predecessor(p_business_id,goal.goal_id);
 if input->>'predecessorPlanId' is distinct from closure->>'predecessorPlanId' or input->>'predecessorPlanHash' is distinct from closure->>'predecessorPlanHash'
 or input->>'predecessorScopeId' is distinct from closure->>'predecessorScopeId' or input->>'predecessorScopeHash' is distinct from closure->>'predecessorScopeHash'
 then raise exception 'r12_episode_exact_predecessor_required';end if;
 select count(*)+1 into episode_number from private.r12_owner_episode_activations where business_id=p_business_id and goal_id=goal.goal_id;
 if p_operation='confirm_episode' and (setup.preview->'predecessorClosure' is distinct from closure or setup.preview->>'predecessorClosureHash' is distinct from private.stage14_hash(closure)) then raise exception 'r12_episode_stale_closure';end if;
 maximum:=private.r05_money(input->'businessLifetimeLimitMicrounits');research_maximum:=private.r05_money(input->'researchLifetimeLimitMicrounits');
 perform private.r12_owner_quote_check(q,case when p_operation='confirm_episode' then setup.preview->'quote' else null end);
 amount:=case when p_operation='confirm_episode' then (setup.preview->'quote'->>'maximumMicrousd')::bigint else (q->>'maximumMicrousd')::bigint end;
 if amount>(profile.profile->>'maximumRunMicrousd')::bigint or maximum<committed+amount or research_maximum<(funding->>'committedMicrounits')::bigint+amount
 or research_maximum<(funding->>'maximumMicrounits')::bigint or (binding.kind='r05_business' and research_maximum<>maximum) then raise exception 'r12_owner_funding_limit_insufficient';end if;
 if (select count(*) from private.r12_owner_episode_activations where grant_root_id=rt.id)>=(gr.continuation_bounds->>'maximumEpisodes')::integer or (select coalesce(sum(allocation_microunits),0) from private.r12_owner_episode_activations where grant_root_id=rt.id)+amount>(gr.continuation_bounds->>'maximumAllocationMicrounits')::bigint then raise exception 'r12_episode_grant_exhausted';end if;
 if ((select count(*) from private.r12_owner_activations where grant_root_id=rt.id)+(select count(*) from private.r12_owner_episode_activations where grant_root_id=rt.id))>=least(rt.maximum_scopes,coalesce(gr.maximum_scopes,rt.maximum_scopes)) or ((select coalesce(sum(allocation_microunits),0) from private.r12_owner_activations where grant_root_id=rt.id)+(select coalesce(sum(allocation_microunits),0) from private.r12_owner_episode_activations where grant_root_id=rt.id))+amount>least(rt.maximum_allocation_microunits,coalesce(gr.maximum_allocation_microunits,rt.maximum_allocation_microunits)) then raise exception 'r12_owner_grant_exhausted';end if;
 -- Purpose identity ignores profile/choice IDs, market ordering and template
 -- wording. Exact query/catalog bytes remain separately pinned in the setup.
 purpose_digest:=private.stage14_hash(jsonb_build_object('category','original_pod_tshirt','objective',lower(regexp_replace(btrim(goal.content->>'objective'),'\s+',' ','g')),
 'markets',(select jsonb_agg(jsonb_build_object('countryCode',m->>'countryCode','currency',m->>'currency') order by m->>'countryCode',m->>'currency') from jsonb_array_elements(selected->'markets')m),
 'topic',lower(regexp_replace(btrim((select t->>'queryTopic' from jsonb_array_elements(profile.profile->'topics')t where t->>'key'=input->>'topicKey')),'\s+',' ','g')),
 'audience',lower(regexp_replace(btrim(selected->>'audience'),'\s+',' ','g'))));
 -- Same purpose is deliberate only under the exact closed predecessor proof.
 if exists(select 1 from private.r12_owner_activations x where x.business_id=p_business_id and x.purpose_hash=purpose_digest and x.goal_id<>goal.goal_id) then raise exception 'r12_owner_exact_purpose_already_used';end if;
 if p_operation='prepare_episode' then
 cutoff:=least((gr.continuation_bounds->>'expiresAt')::timestamptz,stamp+interval '1 day',(profile.profile->>'validUntil')::timestamptz,gr.valid_until,(profile.pins->>'knowledgeValidUntil')::timestamptz,((goal.content->'parsed'->'deadline'->>'date')||' '||coalesce(goal.content->'parsed'->'deadline'->>'time','23:59:59'))::timestamp at time zone (goal.content->'parsed'->'deadline'->>'timezone'));
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
 preview:=jsonb_build_object('version','r12.owner-research-episode-preview.1','episodeNumber',episode_number,'predecessorClosure',closure,'predecessorClosureHash',private.stage14_hash(closure),'businessId',p_business_id,'goalId',goal.goal_id,'goalRevision',goal.revision,'goalHash',goal.content_hash,'businessRevision',br.revision,'businessHash',br.content_hash,'title',goal.content->>'title','objective',goal.content->>'objective','profileId',profile.id,'profileHash',profile.profile_hash,'selection',jsonb_build_object('marketSetKey',input->>'marketSetKey','topicKey',input->>'topicKey'),'approvedQuery',selected->>'approvedQuery','sourceDomains',selected->'allowedDomains','excludedDomains',selected->'excludedDomains','markets',selected->'markets','audience',selected->>'audience','funding',funding,
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
 amendment:=jsonb_build_object('version','r12.discovery-owner-episode.1','episodeNumber',episode_number,'predecessorClosure',closure,'predecessorClosureHash',private.stage14_hash(closure),'id',sid,'businessId',p_business_id,'goalId',goal.goal_id,'goalRevision',goal.revision,'goalHash',goal.content_hash,'businessRevision',br.revision,'businessHash',br.content_hash,'setupId',setup.id,'setupHash',setup.setup_hash,'profile',profile.profile,'profileHash',profile.profile_hash,'selection',setup.preview->'selection','funding',setup.preview->'funding'->'binding','fundingApproval',approval,
 'intent',jsonb_build_object('version','pod-discovery-2.0','id',sid,'businessId',p_business_id,'objective',goal.content->>'objective','comparisonUniverse',jsonb_build_object('productType','original_pod_tshirt','markets',selected->'markets','audiences',jsonb_build_array(selected->>'audience'),'sourceDomains',selected->'allowedDomains','selectionQuestion',selected->>'approvedQuery'),'limits',jsonb_build_object('maximumAlternatives',3,'maximumNewCollections',1,'maximumMicrousd',amount,'maximumGenerations',1),'expiresAt',cutoff),
 'allowedDomains',selected->'allowedDomains','excludedDomains',selected->'excludedDomains','approvedQuery',selected->>'approvedQuery','approvalHash',private.r12_owner_confirmation_hash(setup),'independentReviewHash',profile.profile->>'independentReviewHash','createdAt',stamp,'expiresAt',cutoff);
 insert into private.r12_owner_episode_closures(predecessor_plan_id,business_id,goal_id,proof,proof_hash)
 values((closure->>'predecessorPlanId')::uuid,p_business_id,goal.goal_id,closure,private.stage14_hash(closure));
 insert into private.r12_discovery_scopes(id,business_id,goal_id,budget_authority_root_id,prior_round_id,amendment,amendment_hash,origin,owner_setup_id)
 values(sid,p_business_id,goal.goal_id,case when binding.kind='legacy_research_root' then binding.authority_root_id else null end,(setup.preview->'funding'->'binding'->>'priorRoundId')::uuid,amendment,private.stage14_hash(amendment),'owner_episode',setup.id);
 insert into private.r12_owner_episode_activations(setup_id,business_id,goal_id,scope_id,grant_root_id,predecessor_plan_id,plan_id,episode_number,allocation_microunits,closure_hash) values(setup.id,p_business_id,goal.goal_id,sid,rt.id,(closure->>'predecessorPlanId')::uuid,next_plan_id,episode_number,amount,private.stage14_hash(closure));
 foreach phase in array phase_keys loop
 steps:=steps||jsonb_build_array(jsonb_build_object('key',phase,'kind',case when phase='search1' then 'research' when phase='review' then 'review' else 'work' end,'objective','Complete the reviewed original POD '||phase||' phase','reason','Use only verified dependencies within this bounded research run','adapter','r12.discovery.'||sid::text||'.'||phase,'qualificationHash',profile.pins->>'executionReviewHash','installationId',iid,'packSnapshotHash',profile.pins->>'snapshotHash','workflowDefinitionId',profile.pins->>'workflowDefinitionId','workerDefinitionId',profile.pins->'workers'->phase->>'id','role',phase,'operationKey','research.r12.'||sid::text||'.'||phase,'purpose','Reviewed original POD research: '||phase,'dependsOn',to_jsonb(phase_keys[1:ord]),'expectedArtifactType','r12.discovery.'||phase,'maximumMicrounits',setup.preview->'quote'->'ceilings'->>phase,'expiresAt',dispatch_until,'notBefore',stamp,'measurement',null,'maximumRepairs',0));ord:=ord+1;end loop;
 plan:=jsonb_build_object('format','r12.discovery-episode.1','discoveryScopeId',sid,'discoveryScopeHash',private.stage14_hash(amendment),'businessId',p_business_id,'goalId',goal.goal_id,'goalRevision',goal.revision,'goalHash',goal.content_hash,'businessRevision',br.revision,'businessHash',br.content_hash,'policyId',setup.policy_id,'policyHash',setup.policy_hash,'authorityRootId',p_business_id,'plannerWorkerDefinitionId',profile.pins->>'plannerWorkerDefinitionId','currency','USD','maximumMicrounits',((closure->>'baseKnownMicrounits')::bigint+amount)::text,'deadline',dispatch_until,'expiresAt',dispatch_until,'maximumRepairs',0,'maximumPivots',0,'maximumChildren',(closure->>'baseChildren')::integer+5,'maximumDispatches',(closure->>'baseDispatches')::integer+5,'requiredChecks','["review"]'::jsonb,'finishCondition','all_required_outputs_verified','stopConditions','["no_permitted_work","deadline","repair_exhausted","owner_stopped"]'::jsonb,'steps',steps);
 insert into private.r05_policy_proofs(policy_id,policy_hash,evidence_hash,valid_until) values(setup.policy_id,setup.policy_hash,profile.pins->>'policyInterpretationHash',dispatch_until);
 insert into private.r07_server_keys(key_hash,expires_at) values(p_payload->>'controllerKeyHash',receipt_until);insert into private.r05_server_keys(key_hash,expires_at) values(p_payload->>'admissionKeyHash',receipt_until);
 insert into private.r12_discovery_authorities(scope_id,business_id,goal_id,controller_key_hash,admission_key_hash,plan,plan_hash,mode,approval_hash,execution_review_hash,valid_until,receipt_until)
 values(sid,p_business_id,goal.goal_id,p_payload->>'controllerKeyHash',p_payload->>'admissionKeyHash',plan,private.r04_hash(plan),'qualification',private.r12_owner_confirmation_hash(setup),profile.pins->>'executionReviewHash',dispatch_until,receipt_until);
 insert into private.r07_plans(id,business_id,goal_id,version,previous_plan_id,policy_id,owner_id,content,content_hash,reason,evidence_hash)
 values(next_plan_id,p_business_id,goal.goal_id,(closure->>'predecessorPlanVersion')::integer+1,(closure->>'predecessorPlanId')::uuid,setup.policy_id,auth.uid(),plan,private.r04_hash(plan),'Owner-confirmed bounded research episode',private.stage14_hash(closure));
 update private.r07_heads set plan_id=next_plan_id,revision=revision+1,state='ready',reason='owner_episode_ready',lease_epoch=lease_epoch+1,lease_hash=null,lease_expires_at=null
 where business_id=p_business_id and goal_id=goal.goal_id and plan_id=(closure->>'predecessorPlanId')::uuid and revision=(closure->>'headRevision')::bigint;
 if not found then raise exception 'r12_episode_head_changed';end if;
 insert into private.r07_events(business_id,goal_id,plan_id,operation,payload) values(p_business_id,goal.goal_id,next_plan_id,'owner_episode',jsonb_build_object('setupId',setup.id,'predecessorPlanId',closure->>'predecessorPlanId','closureHash',private.stage14_hash(closure),'shouldDispatch',false));
 select * into previous_plan from private.r07_plans where id=next_plan_id;
 if private.r07_gate(previous_plan,plan->'steps'->0) is not null then raise exception 'r12_episode_activation_not_admissible';end if;
 end if;
 insert into private.r12_owner_submissions values(p_business_id,submission,h,setup.id,p_operation);return private.r12_owner_setup_receipt(setup);
end $$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_owner_research_server(uuid,text,jsonb,text)'::regprocedure);
 if position($old$ perform private.r05_owner(p_business_id);stamp:=$old$ in d)=0 then raise exception 'r12_episode_patch_missing: public.r12_owner_research_server(uuid,text,jsonb,text)';end if;
 d:=replace(d,$old$ perform private.r05_owner(p_business_id);stamp:=$old$,$new$ if p_operation in ('prepare_episode','confirm_episode') then return private.r12_owner_episode_server(p_business_id,p_operation,p_payload,p_server_key);end if;
 perform private.r05_owner(p_business_id);stamp:=$new$);
 if position($old$(select count(*) from private.r12_owner_activations where grant_root_id=rt.id)$old$ in d)=0 then raise exception 'r12_episode_patch_missing: public.r12_owner_research_server(uuid,text,jsonb,text)';end if;
 d:=replace(d,$old$(select count(*) from private.r12_owner_activations where grant_root_id=rt.id)$old$,$new$((select count(*) from private.r12_owner_activations where grant_root_id=rt.id)+(select count(*) from private.r12_owner_episode_activations where grant_root_id=rt.id))$new$);
 if position($old$(select coalesce(sum(allocation_microunits),0) from private.r12_owner_activations where grant_root_id=rt.id)$old$ in d)=0 then raise exception 'r12_episode_patch_missing: public.r12_owner_research_server(uuid,text,jsonb,text)';end if;
 d:=replace(d,$old$(select coalesce(sum(allocation_microunits),0) from private.r12_owner_activations where grant_root_id=rt.id)$old$,$new$((select coalesce(sum(allocation_microunits),0) from private.r12_owner_activations where grant_root_id=rt.id)+(select coalesce(sum(allocation_microunits),0) from private.r12_owner_episode_activations where grant_root_id=rt.id))$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_owner_setup_receipt(private.r12_owner_setups)'::regprocedure);
 if position($old$'activated',exists(select 1 from private.r12_owner_activations where setup_id=s.id)$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r12_owner_setup_receipt(private.r12_owner_setups)';end if;
 d:=replace(d,$old$'activated',exists(select 1 from private.r12_owner_activations where setup_id=s.id)$old$,$new$'activated',(exists(select 1 from private.r12_owner_activations where setup_id=s.id) or exists(select 1 from private.r12_owner_episode_activations where setup_id=s.id))$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_owner_research_read(uuid,uuid,uuid)'::regprocedure);
 if position($old$'grantId',gr.id)$old$ in d)=0 then raise exception 'r12_episode_patch_missing: public.r12_owner_research_read(uuid,uuid,uuid)';end if;
 d:=replace(d,$old$'grantId',gr.id)$old$,$new$'grantId',gr.id,'continuationBounds',gr.continuation_bounds)$new$);
 if position($old$'content',g.content,'initialRunExists'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: public.r12_owner_research_read(uuid,uuid,uuid)';end if;
 d:=replace(d,$old$'content',g.content,'initialRunExists'$old$,$new$'content',g.content,'continuation',private.r12_owner_episode_eligibility(p_business_id,g.goal_id),'initialRunExists'$new$);
 if position($old$(select count(*) from private.r12_owner_activations a where a.grant_root_id=rt.id)$old$ in d)=0 then raise exception 'r12_episode_patch_missing: public.r12_owner_research_read(uuid,uuid,uuid)';end if;
 d:=replace(d,$old$(select count(*) from private.r12_owner_activations a where a.grant_root_id=rt.id)$old$,$new$((select count(*) from private.r12_owner_activations a where a.grant_root_id=rt.id)+(select count(*) from private.r12_owner_episode_activations a where a.grant_root_id=rt.id))$new$);
 if position($old$(select coalesce(sum(a.allocation_microunits),0) from private.r12_owner_activations a where a.grant_root_id=rt.id)$old$ in d)=0 then raise exception 'r12_episode_patch_missing: public.r12_owner_research_read(uuid,uuid,uuid)';end if;
 d:=replace(d,$old$(select coalesce(sum(a.allocation_microunits),0) from private.r12_owner_activations a where a.grant_root_id=rt.id)$old$,$new$((select coalesce(sum(a.allocation_microunits),0) from private.r12_owner_activations a where a.grant_root_id=rt.id)+(select coalesce(sum(a.allocation_microunits),0) from private.r12_owner_episode_activations a where a.grant_root_id=rt.id))$new$);
 if position('setups jsonb;begin' in d)=0 or position(' order by p.id,gr.created_at desc,gr.id limit 33' in d)=0 then raise exception 'r12_episode_catalog_filter_patch_missing';end if;
 d:=replace(d,'setups jsonb;begin','setups jsonb;episode_goal boolean;begin');
 d:=replace(d,' select coalesce(jsonb_agg(x),',E' episode_goal:=exists(select 1 from private.r12_owner_activations where business_id=p_business_id and goal_id=p_goal_id) or exists(select 1 from private.r07_plans where business_id=p_business_id and goal_id=p_goal_id);\n select coalesce(jsonb_agg(x),');
 -- Filter before DISTINCT ON: a newer initial-only or exhausted continuation
 -- grant must not hide an older usable continuation grant for this Goal.
 d:=replace(d,' order by p.id,gr.created_at desc,gr.id limit 33',$new$
 and (not episode_goal or (
 gr.continuation_bounds is not null
 and (gr.continuation_bounds->>'expiresAt')::timestamptz>clock_timestamp()+interval '35 minutes'
 and gr.valid_until>clock_timestamp()+interval '35 minutes'
 and (p.profile->>'validUntil')::timestamptz>clock_timestamp()+interval '35 minutes'
 and (p.pins->>'knowledgeValidUntil')::timestamptz>clock_timestamp()+interval '35 minutes'
 and (((g.content->'parsed'->'deadline'->>'date')||' '||coalesce(g.content->'parsed'->'deadline'->>'time','23:59:59'))::timestamp at time zone (g.content->'parsed'->'deadline'->>'timezone'))>clock_timestamp()+interval '35 minutes'
 and (select count(*) from private.r12_owner_episode_activations a where a.grant_root_id=rt.id)<(gr.continuation_bounds->>'maximumEpisodes')::integer
 and (select coalesce(sum(a.allocation_microunits),0) from private.r12_owner_episode_activations a where a.grant_root_id=rt.id)<(gr.continuation_bounds->>'maximumAllocationMicrounits')::bigint
 and ((select count(*) from private.r12_owner_activations a where a.grant_root_id=rt.id)+(select count(*) from private.r12_owner_episode_activations a where a.grant_root_id=rt.id))<rt.maximum_scopes
 and ((select coalesce(sum(a.allocation_microunits),0) from private.r12_owner_activations a where a.grant_root_id=rt.id)+(select coalesce(sum(a.allocation_microunits),0) from private.r12_owner_episode_activations a where a.grant_root_id=rt.id))<rt.maximum_allocation_microunits))
 order by p.id,gr.created_at desc,gr.id limit 33$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r07_gate(private.r07_plans,jsonb)'::regprocedure);
 if position($old$'r12.discovery.1','r12.discovery-review.1'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r07_gate(private.r07_plans,jsonb)';end if;
 d:=replace(d,$old$'r12.discovery.1','r12.discovery-review.1'$old$,$new$'r12.discovery.1','r12.discovery-episode.1','r12.discovery-review.1'$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_exposure(uuid)'::regprocedure);
 if position($old$'r12.discovery.1','r12.discovery-review.1'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r12_discovery_exposure(uuid)';end if;
 d:=replace(d,$old$'r12.discovery.1','r12.discovery-review.1'$old$,$new$'r12.discovery.1','r12.discovery-episode.1','r12.discovery-review.1'$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_controller_keys(uuid,uuid,jsonb,text,text)'::regprocedure);
 if position($old$'r12.discovery.1','r12.discovery-review.1'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r12_controller_keys(uuid,uuid,jsonb,text,text)';end if;
 d:=replace(d,$old$'r12.discovery.1','r12.discovery-review.1'$old$,$new$'r12.discovery.1','r12.discovery-episode.1','r12.discovery-review.1'$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_admission_key_scope(uuid,text,jsonb,text)'::regprocedure);
 if position($old$'r12.discovery.1','r12.discovery-review.1'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r12_admission_key_scope(uuid,text,jsonb,text)';end if;
 d:=replace(d,$old$'r12.discovery.1','r12.discovery-review.1'$old$,$new$'r12.discovery.1','r12.discovery-episode.1','r12.discovery-review.1'$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_discovery_server(uuid,uuid,text,jsonb,text)'::regprocedure);
 if position($old$'r12.discovery.1','r12.discovery-review.1'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: public.r12_discovery_server(uuid,uuid,text,jsonb,text)';end if;
 d:=replace(d,$old$'r12.discovery.1','r12.discovery-review.1'$old$,$new$'r12.discovery.1','r12.discovery-episode.1','r12.discovery-review.1'$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_response_guard()'::regprocedure);
 if position($old$'r12.discovery.1','r12.discovery-review.1'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r12_discovery_response_guard()';end if;
 d:=replace(d,$old$'r12.discovery.1','r12.discovery-review.1'$old$,$new$'r12.discovery.1','r12.discovery-episode.1','r12.discovery-review.1'$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_completed_phase(private.r07_attempts,private.r07_plans)'::regprocedure);
 if position($old$'r12.discovery.1','r12.discovery-review.1'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r12_discovery_completed_phase(private.r07_attempts,private.r07_plans)';end if;
 d:=replace(d,$old$'r12.discovery.1','r12.discovery-review.1'$old$,$new$'r12.discovery.1','r12.discovery-episode.1','r12.discovery-review.1'$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_plan_qualification(uuid,uuid,jsonb)'::regprocedure);
 if position($old$'r12.discovery.1','r12.discovery-review.1'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r12_plan_qualification(uuid,uuid,jsonb)';end if;
 d:=replace(d,$old$'r12.discovery.1','r12.discovery-review.1'$old$,$new$'r12.discovery.1','r12.discovery-episode.1','r12.discovery-review.1'$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_authority_validate()'::regprocedure);
 if position($old$'r12.discovery.1','r12.discovery-review.1'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r12_authority_validate()';end if;
 d:=replace(d,$old$'r12.discovery.1','r12.discovery-review.1'$old$,$new$'r12.discovery.1','r12.discovery-episode.1','r12.discovery-review.1'$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r07_validate_plan(uuid,uuid,jsonb)'::regprocedure);
 if position($old$'r12.discovery.1','r12.discovery-review.1'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r07_validate_plan(uuid,uuid,jsonb)';end if;
 d:=replace(d,$old$'r12.discovery.1','r12.discovery-review.1'$old$,$new$'r12.discovery.1','r12.discovery-episode.1','r12.discovery-review.1'$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)'::regprocedure);
 if position($old$'r12.discovery.1','r12.discovery-review.1'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r12_discovery_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)';end if;
 d:=replace(d,$old$'r12.discovery.1','r12.discovery-review.1'$old$,$new$'r12.discovery.1','r12.discovery-episode.1','r12.discovery-review.1'$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_scope_current(private.r07_plans)'::regprocedure);
 if position($old$'r12.discovery.1','r12.discovery-review.1'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r12_discovery_scope_current(private.r07_plans)';end if;
 d:=replace(d,$old$'r12.discovery.1','r12.discovery-review.1'$old$,$new$'r12.discovery.1','r12.discovery-episode.1','r12.discovery-review.1'$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_scope_at(private.r07_plans,timestamp with time zone)'::regprocedure);
 if position($old$'r12.discovery.1','r12.discovery-review.1'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r12_discovery_scope_at(private.r07_plans,timestamp with time zone)';end if;
 d:=replace(d,$old$'r12.discovery.1','r12.discovery-review.1'$old$,$new$'r12.discovery.1','r12.discovery-episode.1','r12.discovery-review.1'$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_plan_qualification(uuid,uuid,jsonb)'::regprocedure);
 if position($old$((v->>'format'='r12.discovery-pilot.1'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r12_plan_qualification(uuid,uuid,jsonb)';end if;
 d:=replace(d,$old$((v->>'format'='r12.discovery-pilot.1'$old$,$new$((v->>'format'='r12.discovery-episode.1' and s.origin='owner_episode' and s.amendment->>'version'='r12.discovery-owner-episode.1' and exists(select 1 from private.r12_owner_episode_activations ep where ep.scope_id=s.id and ep.business_id=b and ep.goal_id=g and ep.closure_hash=s.amendment->>'predecessorClosureHash')) or (v->>'format'='r12.discovery-pilot.1'$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_scope_validate()'::regprocedure);
 if position($old$ if a->>'version'='r12.discovery-owner-initial.1'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r12_discovery_scope_validate()';end if;
 d:=replace(d,$old$ if a->>'version'='r12.discovery-owner-initial.1'$old$,$new$ if a->>'version'='r12.discovery-owner-episode.1' then perform private.r12_owner_episode_scope_resolve(new,clock_timestamp(),true);return new;end if;
 if a->>'version'='r12.discovery-owner-initial.1'$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_scope_current(private.r07_plans)'::regprocedure);
 if position($old$ if s.origin='owner_initial' then$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r12_discovery_scope_current(private.r07_plans)';end if;
 d:=replace(d,$old$ if s.origin='owner_initial' then$old$,$new$ if s.origin='owner_episode' then
 if p.content->>'format' is distinct from 'r12.discovery-episode.1' then raise exception 'r12_episode_plan_format_required';end if;
 perform private.r12_owner_episode_scope_resolve(s,clock_timestamp(),true);return s;end if;
 if s.origin='owner_initial' then$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_scope_at(private.r07_plans,timestamp with time zone)'::regprocedure);
 if position($old$ if s.origin='owner_initial' then$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r12_discovery_scope_at(private.r07_plans,timestamp with time zone)';end if;
 d:=replace(d,$old$ if s.origin='owner_initial' then$old$,$new$ if s.origin='owner_episode' then
 if p.content->>'format' is distinct from 'r12.discovery-episode.1' then raise exception 'r12_episode_plan_format_required';end if;
 perform private.r12_owner_episode_scope_resolve(s,effective_at,false);return s;end if;
 if s.origin='owner_initial' then$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_authority_validate()'::regprocedure);
 if position($old$ if (new.plan->>'format'='r12.discovery-pilot.1')$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r12_authority_validate()';end if;
 d:=replace(d,$old$ if (new.plan->>'format'='r12.discovery-pilot.1')$old$,$new$ if (new.plan->>'format'='r12.discovery-episode.1') is distinct from (s.origin='owner_episode') then raise exception 'r12_scope_format_mismatch';end if;
 if (new.plan->>'format'='r12.discovery-pilot.1')$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r07_validate_plan(uuid,uuid,jsonb)'::regprocedure);
 if position($old$declare s jsonb; k text;$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r07_validate_plan(uuid,uuid,jsonb)';end if;
 d:=replace(d,$old$declare s jsonb; k text;$old$,$new$declare episode boolean:=coalesce(p->>'format'='r12.discovery-episode.1',false);closure jsonb; s jsonb; k text;$new$);
 if position($old$ if review_cont then
 select * into binding$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r07_validate_plan(uuid,uuid,jsonb)';end if;
 d:=replace(d,$old$ if review_cont then
 select * into binding$old$,$new$ if episode then
 select * into binding from private.r12_discovery_scopes where id=(p->>'discoveryScopeId')::uuid and business_id=b and goal_id=g and origin='owner_episode' and amendment_hash=p->>'discoveryScopeHash';
 if binding.id is null then raise exception 'r12_episode_scope_required';end if;
 source:=private.r12_owner_episode_scope_resolve(binding,clock_timestamp(),true);closure:=binding.amendment->'predecessorClosure';
 end if;
 if review_cont then
 select * into binding$new$);
 if position($old$case when review_cont then (binding.amendment->>'baseKnownMicrounits')::bigint else 0 end$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r07_validate_plan(uuid,uuid,jsonb)';end if;
 d:=replace(d,$old$case when review_cont then (binding.amendment->>'baseKnownMicrounits')::bigint else 0 end$old$,$new$case when episode then (closure->>'baseKnownMicrounits')::bigint when review_cont then (binding.amendment->>'baseKnownMicrounits')::bigint else 0 end$new$);
 if position($old$case when review_cont then (binding.amendment->>'baseDispatches')::integer else 0 end$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r07_validate_plan(uuid,uuid,jsonb)';end if;
 d:=replace(d,$old$case when review_cont then (binding.amendment->>'baseDispatches')::integer else 0 end$old$,$new$case when episode then (closure->>'baseDispatches')::integer when review_cont then (binding.amendment->>'baseDispatches')::integer else 0 end$new$);
 if position($old$p->'maximumChildren'<>'5' or p->'maximumDispatches'<>'5'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r07_validate_plan(uuid,uuid,jsonb)';end if;
 d:=replace(d,$old$p->'maximumChildren'<>'5' or p->'maximumDispatches'<>'5'$old$,$new$p->'maximumChildren'<>to_jsonb(case when episode then (closure->>'baseChildren')::integer+5 else 5 end) or p->'maximumDispatches'<>to_jsonb(case when episode then (closure->>'baseDispatches')::integer+5 else 5 end)$new$);
 if position($old$(not review_cont and not pilot and not coalesce$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r07_validate_plan(uuid,uuid,jsonb)';end if;
 d:=replace(d,$old$(not review_cont and not pilot and not coalesce$old$,$new$(not episode and not review_cont and not pilot and not coalesce$new$);
 if position($old$ if binding.origin='owner_initial' then$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r07_validate_plan(uuid,uuid,jsonb)';end if;
 d:=replace(d,$old$ if binding.origin='owner_initial' then$old$,$new$ if episode then
 if private.r05_money(p->'maximumMicrounits')<>(closure->>'baseKnownMicrounits')::bigint+(binding.amendment->'intent'->'limits'->>'maximumMicrousd')::bigint
 or policy.payload->'maximumDispatches' is distinct from '5'::jsonb or jsonb_array_length(policy.payload->'operations')<>5
 or policy.id is distinct from (select policy_id from private.r12_owner_setups where id=binding.owner_setup_id)
 or p->'maximumRepairs' is distinct from '0'::jsonb or p->'maximumPivots' is distinct from '0'::jsonb
 or exists(select 1 from private.r07_reused rr join private.r07_plans pp on pp.id=rr.plan_id where pp.content->>'discoveryScopeId'=binding.id::text)
 then raise exception 'r12_episode_topology_required';end if;
 budget:=source->'budget';
 elsif binding.origin='owner_initial' then$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r07_budget(private.r07_plans,jsonb,uuid,bigint)'::regprocedure);
 if position($old$ if p.content->>'format' in ('r12.discovery-review.1','r12.discovery-evidence.1') then$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r07_budget(private.r07_plans,jsonb,uuid,bigint)';end if;
 d:=replace(d,$old$ if p.content->>'format' in ('r12.discovery-review.1','r12.discovery-evidence.1') then$old$,$new$ if p.content->>'format'='r12.discovery-episode.1' then
 select * into binding from private.r12_discovery_scopes where id=(p.content->>'discoveryScopeId')::uuid and business_id=p.business_id and goal_id=p.goal_id and amendment_hash=p.content->>'discoveryScopeHash';
 perform private.r12_owner_episode_scope_resolve(binding,clock_timestamp(),true);successor:=true;
 end if;
 if p.content->>'format' in ('r12.discovery-review.1','r12.discovery-evidence.1') then$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_financial_guard()'::regprocedure);
 if position($old$scope.origin='owner_initial'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r12_discovery_financial_guard()';end if;
 d:=replace(d,$old$scope.origin='owner_initial'$old$,$new$scope.origin in ('owner_initial','owner_episode')$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_phase_inputs(private.r07_attempts,private.r07_plans)'::regprocedure);
 if position($old$s.origin='owner_initial'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r12_discovery_phase_inputs(private.r07_attempts,private.r07_plans)';end if;
 d:=replace(d,$old$s.origin='owner_initial'$old$,$new$s.origin in ('owner_initial','owner_episode')$new$);
 if position($old$s.origin<>'owner_initial'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r12_discovery_phase_inputs(private.r07_attempts,private.r07_plans)';end if;
 d:=replace(d,$old$s.origin<>'owner_initial'$old$,$new$s.origin not in ('owner_initial','owner_episode')$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)'::regprocedure);
 if position($old$s.origin='owner_initial'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r12_discovery_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)';end if;
 d:=replace(d,$old$s.origin='owner_initial'$old$,$new$s.origin in ('owner_initial','owner_episode')$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_discovery_result_read(uuid,uuid)'::regprocedure);
 if position($old$s.origin='owner_initial'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: public.r12_discovery_result_read(uuid,uuid)';end if;
 d:=replace(d,$old$s.origin='owner_initial'$old$,$new$s.origin in ('owner_initial','owner_episode')$new$);
 if position($old$s.origin<>'owner_initial'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: public.r12_discovery_result_read(uuid,uuid)';end if;
 d:=replace(d,$old$s.origin<>'owner_initial'$old$,$new$s.origin not in ('owner_initial','owner_episode')$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_discovery_scope_read(uuid,uuid)'::regprocedure);
 if position($old$s.origin='owner_initial'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: public.r12_discovery_scope_read(uuid,uuid)';end if;
 d:=replace(d,$old$s.origin='owner_initial'$old$,$new$s.origin in ('owner_initial','owner_episode')$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_phase_inputs(private.r07_attempts,private.r07_plans)'::regprocedure);
 if position($old$if p.content->>'format' is distinct from 'r12.discovery.1'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r12_discovery_phase_inputs(private.r07_attempts,private.r07_plans)';end if;
 d:=replace(d,$old$if p.content->>'format' is distinct from 'r12.discovery.1'$old$,$new$if p.content->>'format' not in ('r12.discovery.1','r12.discovery-episode.1')$new$);
 if position($old$'version','r12.discovery-owner-initial-inputs.1'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: private.r12_discovery_phase_inputs(private.r07_attempts,private.r07_plans)';end if;
 d:=replace(d,$old$'version','r12.discovery-owner-initial-inputs.1'$old$,$new$'version',case when s.origin='owner_episode' then 'r12.discovery-owner-episode-inputs.1' else 'r12.discovery-owner-initial-inputs.1' end$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_discovery_result_read(uuid,uuid)'::regprocedure);
 if position($old$('r12.discovery-source-scope.1','r12.discovery-owner-initial.1')$old$ in d)=0 then raise exception 'r12_episode_patch_missing: public.r12_discovery_result_read(uuid,uuid)';end if;
 d:=replace(d,$old$('r12.discovery-source-scope.1','r12.discovery-owner-initial.1')$old$,$new$('r12.discovery-source-scope.1','r12.discovery-owner-initial.1','r12.discovery-owner-episode.1')$new$);
 if position($old$content->>'format'='r12.discovery.1'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: public.r12_discovery_result_read(uuid,uuid)';end if;
 d:=replace(d,$old$content->>'format'='r12.discovery.1'$old$,$new$content->>'format' in ('r12.discovery.1','r12.discovery-episode.1')$new$);
 if position($old$'version','r12.discovery-owner-initial-inputs.1'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: public.r12_discovery_result_read(uuid,uuid)';end if;
 d:=replace(d,$old$'version','r12.discovery-owner-initial-inputs.1'$old$,$new$'version',case when s.origin='owner_episode' then 'r12.discovery-owner-episode-inputs.1' else 'r12.discovery-owner-initial-inputs.1' end$new$);
 execute d;end $episode_patch$;

DO $episode_patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_discovery_owner_read(uuid,uuid,boolean)'::regprocedure);
 if position($old$'r12.discovery-owner-initial.1','r12.discovery-source-scope.1'$old$ in d)=0 then raise exception 'r12_episode_owner_scope_allowlist_missing';end if;
 d:=replace(d,$old$'r12.discovery-owner-initial.1','r12.discovery-source-scope.1'$old$,$new$'r12.discovery-owner-initial.1','r12.discovery-owner-episode.1','r12.discovery-source-scope.1'$new$);
 if position($old$source_scope.origin='owner_initial' then
 budget$old$ in d)=0 then raise exception 'r12_episode_patch_missing: public.r12_discovery_owner_read(uuid,uuid,boolean)';end if;
 d:=replace(d,$old$source_scope.origin='owner_initial' then
 budget$old$,$new$source_scope.origin in ('owner_initial','owner_episode') then
 budget$new$);
 if position($old$||case when source_scope.origin='owner_initial' then jsonb_build_object('ownerInitial'$old$ in d)=0 then raise exception 'r12_episode_patch_missing: public.r12_discovery_owner_read(uuid,uuid,boolean)';end if;
 d:=replace(d,$old$||case when source_scope.origin='owner_initial' then jsonb_build_object('ownerInitial'$old$,$new$||case when source_scope.origin='owner_episode' then jsonb_build_object('ownerEpisode',jsonb_build_object('profileId',source_scope.amendment->'profile'->>'id','profileHash',source_scope.amendment->>'profileHash','fundingKind',source_scope.amendment->'funding'->>'kind','episodeNumber',source_scope.amendment->'episodeNumber','predecessorClosure',source_scope.amendment->'predecessorClosure','predecessorClosureHash',source_scope.amendment->>'predecessorClosureHash')) else '{}'::jsonb end
 ||case when source_scope.origin='owner_initial' then jsonb_build_object('ownerInitial'$new$);
 execute d;end $episode_patch$;

-- A version exception is insufficient by itself: the insertion must carry the
-- exact immutable activation sidecar created by atomic owner confirmation.
create function private.r12_owner_episode_plan_guard() returns trigger language plpgsql set search_path='' as $$
declare ep private.r12_owner_episode_activations;cl private.r12_owner_episode_closures;h private.r07_heads;prior private.r07_plans;q private.r12_discovery_authorities;begin
 if new.content->>'format' is distinct from 'r12.discovery-episode.1' then return new;end if;
 select * into ep from private.r12_owner_episode_activations where plan_id=new.id and business_id=new.business_id and goal_id=new.goal_id;
 select * into cl from private.r12_owner_episode_closures where predecessor_plan_id=ep.predecessor_plan_id;
 select * into h from private.r07_heads where goal_id=new.goal_id and business_id=new.business_id;
 select * into prior from private.r07_plans where id=ep.predecessor_plan_id;
 select * into q from private.r12_discovery_authorities where scope_id=ep.scope_id and business_id=new.business_id and goal_id=new.goal_id;
 if ep.setup_id is null or cl.predecessor_plan_id is null or q.scope_id is null or q.plan is distinct from new.content or q.plan_hash is distinct from new.content_hash
 or new.previous_plan_id is distinct from ep.predecessor_plan_id or new.version<>prior.version+1
 or ep.closure_hash is distinct from cl.proof_hash or cl.proof_hash is distinct from private.stage14_hash(cl.proof)
 or h.plan_id is distinct from prior.id or h.revision<>(cl.proof->>'headRevision')::bigint
 or h.children_created<>(cl.proof->>'baseChildren')::integer or h.dispatches<>(cl.proof->>'baseDispatches')::integer
 or h.repairs_used<>(cl.proof->>'baseRepairs')::integer or h.pivots_used<>(cl.proof->>'basePivots')::integer
 then raise exception 'r12_episode_plan_activation_required';end if;
 perform private.r07_validate_plan(new.business_id,new.goal_id,new.content);return new;
end $$;
create trigger r12_owner_episode_plan_guard before insert on private.r07_plans for each row execute function private.r12_owner_episode_plan_guard();
-- A Stop with no unresolved exposure closes the now-useless scoped keys too.
-- Unknown in-flight charges retain their receipt capabilities and stay blocked.
create function private.r12_owner_episode_stop_keys(s private.r12_owner_setups) returns void language plpgsql set search_path='' as $$
declare q private.r12_discovery_authorities;begin
 if not exists(select 1 from private.r05_revocations where policy_id=s.policy_id and business_id=s.business_id) then raise exception 'r12_episode_owner_stop_required';end if;
 select * into q from private.r12_discovery_authorities where scope_id=s.scope_id and business_id=s.business_id and goal_id=s.goal_id;
 if q.scope_id is null then return;end if;
 if exists(select 1 from private.r05_requests r join private.r05_exposure(s.business_id)e on e.source_key=r.source_key where r.policy_id=s.policy_id and e.unknown) then return;end if;
 insert into private.r07_server_revocations(key_hash) values(q.controller_key_hash) on conflict do nothing;
 insert into private.r05_server_revocations(key_hash) values(q.admission_key_hash) on conflict do nothing;
end $$;
DO $episode_stop$ declare d text;needle text:=$old$ perform public.r05_policy_owner(p_business_id,'revoke',jsonb_build_object('policyId',setup.policy_id,'policyHash',setup.policy_hash),submission);$old$;begin
 d:=pg_get_functiondef('public.r12_owner_research_server(uuid,text,jsonb,text)'::regprocedure);
 if position(needle in d)=0 then raise exception 'r12_episode_stop_patch_missing';end if;
 d:=replace(d,needle,needle||E'\n perform private.r12_owner_episode_stop_keys(setup);');execute d;
end $episode_stop$;
-- Private helpers are never app RPCs. Existing public ACLs remain unchanged.
DO $$ declare f record;begin for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'r12_owner_episode_%' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);end loop;end $$;
commit;
