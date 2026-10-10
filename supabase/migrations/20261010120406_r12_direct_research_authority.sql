-- Direct Insights test envelopes. Definitions only; no enrollment, tariff,
-- account, browser session, owner approval or provider effect is installed.
begin;
create table private.r12_direct_grant_reviews(
 grant_id uuid primary key references private.r12_owner_bootstrap_grants(id),goal_id uuid not null,goal_revision integer not null,goal_hash text not null,
 provider_project_id uuid not null,route_hash text not null references private.r12_direct_browser_routes(route_hash),
 maximum_test_microunits bigint not null check(maximum_test_microunits between 1 and 10000000),maximum_attempts integer not null check(maximum_attempts between 1 and 32),
 cumulative_dispatches_ceiling integer not null check(cumulative_dispatches_ceiling between 4 and 64),
 setup_operation jsonb not null,verification_operation jsonb not null,research_pins jsonb not null,profile_template jsonb not null,
 approval_hash text not null check(approval_hash~'^[a-f0-9]{64}$'),content_hash text not null,expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp());
create table private.r12_direct_grant_review_revocations(grant_id uuid primary key references private.r12_direct_grant_reviews(grant_id),created_at timestamptz not null default clock_timestamp());
create table private.r12_direct_test_drafts(
 id uuid primary key,business_id uuid not null references public.businesses(id),goal_id uuid not null,owner_id uuid not null references auth.users(id),
 grant_id uuid not null references private.r12_owner_bootstrap_grants(id),grant_root_id uuid not null references private.r12_owner_grant_roots(id),
 binding_id uuid not null references private.r12_owner_funding_bindings(id),policy_id uuid not null unique,origin_hash text not null,
 predecessor_plan_id uuid not null references private.r07_plans(id),submission_id uuid not null,input_hash text not null,
 content jsonb not null,content_hash text not null check(content_hash=private.stage14_hash(content)),expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),unique(business_id,submission_id));
create table private.r12_direct_test_confirmations(envelope_id uuid primary key references private.r12_direct_test_envelopes(id),draft_id uuid not null unique references private.r12_direct_test_drafts(id),grant_id uuid not null references private.r12_owner_bootstrap_grants(id),grant_root_id uuid not null references private.r12_owner_grant_roots(id),predecessor_plan_id uuid not null unique references private.r07_plans(id),origin_hash text not null,allocation_microunits bigint not null check(allocation_microunits between 1 and 10000000),actor_id uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp());
create table private.r12_direct_draft_stops(draft_id uuid primary key references private.r12_direct_test_drafts(id),owner_id uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp());
create table private.r12_direct_owner_submissions(business_id uuid not null references public.businesses(id),submission_id uuid not null,operation text not null,input_hash text not null,envelope_id uuid not null,primary key(business_id,submission_id));
create index r12_direct_drafts_owner on private.r12_direct_test_drafts(business_id,owner_id,goal_id,created_at desc);
create index r12_direct_confirmations_root on private.r12_direct_test_confirmations(grant_root_id);
do $$ declare n text;begin foreach n in array array['r12_direct_grant_reviews','r12_direct_grant_review_revocations','r12_direct_test_drafts','r12_direct_test_confirmations','r12_direct_draft_stops','r12_direct_owner_submissions'] loop
 execute format('alter table private.%I enable row level security',n);execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);execute format('create trigger direct_authority_immutable before insert or update or delete on private.%I for each row execute function private.r05_guard()',n);end loop;end $$;

create function private.r12_direct_grant_review_body(r private.r12_direct_grant_reviews) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('version','r12.direct-grant-review.1','grantId',r.grant_id,'goalId',r.goal_id,'goalRevision',r.goal_revision,'goalHash',r.goal_hash,'providerProjectId',r.provider_project_id,'routeHash',r.route_hash,'maximumTestMicrounits',r.maximum_test_microunits::text,'maximumAttemptsInWindow',r.maximum_attempts,'cumulativeDispatchesCeiling',r.cumulative_dispatches_ceiling,'setupOperation',r.setup_operation,'verificationOperation',r.verification_operation,'researchPins',r.research_pins,'profileTemplate',r.profile_template,'approvalHash',r.approval_hash,'expiresAt',r.expires_at)
$$;
create function private.r12_direct_grant_usage(root_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('scopes',count(*),'allocationMicrounits',coalesce(sum(amount),0)::text) from (
 select allocation_microunits amount from private.r12_owner_activations where grant_root_id=root_id
 union all select allocation_microunits from private.r12_owner_episode_activations where grant_root_id=root_id
 union all select maximum_run_microusd from private.r12_adaptive_activations where grant_root_id=root_id
 union all select allocation_microunits from private.r12_direct_test_confirmations where grant_root_id=root_id) x
$$;
-- Cross-lane cumulative guard closes the older endpoints' omitted-new-lane
-- accounting gap without widening any historical approval or validation.
create function private.r12_direct_grant_total_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare rt private.r12_owner_grant_roots;rv private.r12_owner_grant_root_revisions;gr private.r12_owner_bootstrap_grants;grant_uuid uuid;usage jsonb;max_scopes integer;max_amount bigint;begin
 select * into strict rt from private.r12_owner_grant_roots where id=new.grant_root_id for update;
 if tg_table_name in ('r12_owner_activations','r12_owner_episode_activations') then select grant_id into grant_uuid from private.r12_owner_setups where id=new.setup_id;else grant_uuid:=new.grant_id;end if;
 select * into strict gr from private.r12_owner_bootstrap_grants where id=grant_uuid and root_id=rt.id;
 select * into rv from private.r12_owner_grant_root_revisions where root_id=rt.id and revision=gr.root_revision and content_hash=gr.root_revision_hash;
 max_scopes:=least(coalesce(rv.maximum_scopes,rt.maximum_scopes),coalesce(gr.maximum_scopes,2147483647));max_amount:=least(coalesce(rv.maximum_allocation_microunits,rt.maximum_allocation_microunits),coalesce(gr.maximum_allocation_microunits,9007199254740991));
 usage:=private.r12_direct_grant_usage(rt.id);
 if (usage->>'scopes')::integer>max_scopes or (usage->>'allocationMicrounits')::bigint>max_amount then raise exception 'r12_direct_cumulative_grant_exhausted';end if;return new;
end $$;
create trigger r12_direct_grant_total after insert on private.r12_owner_activations for each row execute function private.r12_direct_grant_total_guard();
create trigger r12_direct_grant_total after insert on private.r12_owner_episode_activations for each row execute function private.r12_direct_grant_total_guard();
create trigger r12_direct_grant_total after insert on private.r12_adaptive_activations for each row execute function private.r12_direct_grant_total_guard();
create trigger r12_direct_grant_total after insert on private.r12_direct_test_confirmations for each row execute function private.r12_direct_grant_total_guard();

create function private.r12_direct_key(p_secret text,p_business uuid,p_goal uuid,p_envelope uuid,p_hash text,p_route text,p_purpose text) returns text language sql immutable set search_path='' as $$
 select translate(rtrim(encode(extensions.hmac(convert_to(private.stage14_canonical(jsonb_build_object('version','r12.direct-server-key.1','businessId',p_business,'goalId',p_goal,'testEnvelopeId',p_envelope,'envelopeHash',p_hash,'routeHash',p_route,'purpose',p_purpose)),'UTF8'),convert_to(p_secret,'UTF8'),'sha256'),'base64'),'='),'+/','-_')
$$;
create function private.r12_direct_grant_check(b uuid,g uuid,grant_uuid uuid,server_key text) returns private.r12_direct_grant_reviews language plpgsql set search_path='' as $$
declare gr private.r12_owner_bootstrap_grants;r private.r12_direct_grant_reviews;rt private.r12_owner_grant_roots;gv private.r04_goal_versions;bv private.r04_business_versions;begin
 perform private.r05_owner(b);
 select * into gr from private.r12_owner_bootstrap_grants where id=grant_uuid and business_id=b and owner_id=auth.uid() and server_key_hash=encode(extensions.digest(server_key,'sha256'),'hex');
 select * into r from private.r12_direct_grant_reviews where grant_id=gr.id and goal_id=g;
 select * into rt from private.r12_owner_grant_roots where id=gr.root_id and business_id=b for update;
 select x.* into gv from private.r04_goal_versions x join private.r04_goal_state s using(business_id,goal_id,revision) where x.business_id=b and x.goal_id=g;
 select x.* into bv from private.r04_business_versions x join private.r04_business_state s using(business_id,revision) where x.business_id=b;
 if gr.id is null or r.grant_id is null or rt.id is null or gr.valid_from>clock_timestamp() or gr.valid_until<=clock_timestamp() or r.expires_at<=clock_timestamp()
 or exists(select 1 from private.r12_owner_grant_revocations where grant_id=gr.id) or exists(select 1 from private.r12_direct_grant_review_revocations where grant_id=gr.id)
 or gv.revision is distinct from r.goal_revision or gv.content_hash is distinct from r.goal_hash or gv.preference is distinct from 'ready'
 or bv.revision is distinct from gr.business_revision or bv.content_hash is distinct from gr.business_hash or bv.preference is distinct from 'setup'
 or r.content_hash is distinct from private.stage14_hash(private.r12_direct_grant_review_body(r)) then raise exception 'r12_direct_reviewed_grant_required';end if;
 perform private.r12_owner_grant_revision_current(gr,rt,clock_timestamp());return r;
end $$;

create function private.r12_direct_funding_snapshot(b uuid) returns jsonb language plpgsql set search_path='' as $$
declare binding private.r12_owner_funding_bindings;cap private.r05_cap_versions;funding jsonb;actual bigint;unknown boolean;begin
 select * into strict binding from private.r12_owner_funding_bindings where business_id=b for update;
 select * into cap from private.r05_cap_versions where business_id=b and currency='USD' order by revision desc limit 1;
 select coalesce(sum(x.held),0),coalesce(bool_or(x.unknown),false) into actual,unknown from private.r12_direct_exposure(b) x;
 if unknown then raise exception 'r12_direct_unresolved_liability';end if;
 funding:=private.r12_owner_funding(binding);
 return jsonb_build_object('bindingId',binding.id,'bindingKind',binding.kind,'authorityRootId',binding.authority_root_id,
 'business',jsonb_build_object('revision',coalesce(cap.revision,0),'currentLimitMicrounits',coalesce(cap.maximum_microunits,0)::text,'conservativeExposureMicrounits',actual::text,'headroomMicrounits',greatest(0,coalesce(cap.maximum_microunits,0)-actual)::text),
 'root',jsonb_build_object('revision',(funding->>'revision')::integer,'currentLimitMicrounits',funding->>'maximumMicrounits','conservativeExposureMicrounits',funding->>'committedMicrounits','headroomMicrounits',greatest(0,(funding->>'maximumMicrounits')::bigint-(funding->>'committedMicrounits')::bigint)::text,'bindingHash',funding->>'hash'),
 'funding',funding);
end $$;
create function private.r12_direct_cap_check(proposal jsonb,funding jsonb,amount bigint) returns void language plpgsql set search_path='' as $$
declare k text;v jsonb;current jsonb;begin
 perform private.r04_keys(proposal,array['version','business','root']);
 if proposal->>'version' is distinct from 'r12.public-cap-proposal.1' then raise exception 'r12_direct_cap_proposal_required';end if;
 foreach k in array array['business','root'] loop v:=proposal->k;current:=funding->k;perform private.r04_keys(v,array['currentRevision','currentLimitMicrounits','proposedLimitMicrounits']);
 if v->'currentRevision' is distinct from current->'revision' or v->>'currentLimitMicrounits' is distinct from current->>'currentLimitMicrounits'
 or private.r05_money(v->'proposedLimitMicrounits')<(current->>'conservativeExposureMicrounits')::bigint+amount then raise exception 'r12_direct_stale_or_insufficient_cap';end if;
 end loop;
 if funding->>'bindingKind'='legacy_research_root' and private.r05_money(proposal->'root'->'proposedLimitMicrounits')<(funding->'root'->>'currentLimitMicrounits')::bigint then raise exception 'r12_direct_legacy_cap_decrease_unsupported';end if;
 if funding->>'bindingKind'='r05_business' and proposal->'business'->'proposedLimitMicrounits' is distinct from proposal->'root'->'proposedLimitMicrounits' then raise exception 'r12_direct_native_root_cap_mismatch';end if;
end $$;

-- Quote structure is new-version-only. Private route evidence, rather than a
-- public self-hash, authenticates the tariff/project and conservative bound.
create function private.r12_direct_browser_quote_check(q jsonb,r private.r12_direct_browser_routes,op jsonb) returns void language plpgsql set search_path='' as $$
begin
 perform private.r04_keys(op,array['operationKey','workflowDefinitionId','workflowHash','qualificationHash','routeHash','maximumMicrounits']);
 perform private.r04_keys(q,array['version','provider','category','providerProjectId','zeroCostQualificationHash','routeHash','priceEvidenceHash','settlementContractHash','tariffHash','qualificationHash','maximumMicrounits','verifiedAt','validUntil','qualified','retentionDisclosure','browserQuoteHash']);
 if jsonb_typeof(q->'verifiedAt') is distinct from 'string' or jsonb_typeof(q->'validUntil') is distinct from 'string' or coalesce(q->>'priceEvidenceHash','')!~'^[a-f0-9]{64}$' or jsonb_typeof(q->'retentionDisclosure') is distinct from 'string' or length(q->>'retentionDisclosure') not between 1 and 2000 or (q->>'verifiedAt')::timestamptz<r.valid_from or q->>'category' is distinct from 'browser' or q->'zeroCostQualificationHash' is distinct from 'null'::jsonb or (q->>'validUntil')::timestamptz>(q->>'verifiedAt')::timestamptz+interval '5 minutes' or q->>'version' is distinct from 'r12.public-browser-quote.1' or q->>'provider' is distinct from 'steel' or q->>'providerProjectId' is distinct from r.provider_project_id::text
 or q->>'routeHash' is distinct from r.route_hash or q->>'tariffHash' is distinct from r.tariff_hash or q->>'qualificationHash' is distinct from r.qualification_hash
 or q->>'settlementContractHash' is distinct from r.settlement_contract_hash or q->>'priceEvidenceHash' is distinct from r.content->>'priceEvidenceHash'
 or q->>'browserQuoteHash' is distinct from private.stage14_hash(q-'browserQuoteHash') or q->'qualified' is distinct from 'true'::jsonb
 or (q->>'verifiedAt')::timestamptz>clock_timestamp() or (q->>'validUntil')::timestamptz<=clock_timestamp() or (q->>'validUntil')::timestamptz>r.valid_until
 or q->'retentionDisclosure' is distinct from r.content->'retentionDisclosure'
 or private.r05_money(q->'maximumMicrounits')<r.maximum_session_microunits or private.r05_money(q->'maximumMicrounits')>private.r05_money(op->'maximumMicrounits')
 or op->>'routeHash' is distinct from r.route_hash or op->>'qualificationHash' is distinct from r.qualification_hash
 or not exists(select 1 from public.workflow_definitions w where w.id=(op->>'workflowDefinitionId')::uuid and private.r04_hash(to_jsonb(w))=op->>'workflowHash')
 or r.valid_from>clock_timestamp() or r.valid_until<=clock_timestamp() or exists(select 1 from private.r12_direct_browser_route_revocations where route_hash=r.route_hash)
 then raise exception 'r12_direct_browser_quote_unqualified';end if;
end $$;

create function private.r12_direct_test_receipt(d private.r12_direct_test_drafts) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('version','r12.owner-direct-test-receipt.1','businessId',d.business_id,'goalId',d.goal_id,'testEnvelopeId',d.id,'testEnvelopeHash',d.content_hash,
 'confirmed',exists(select 1 from private.r12_direct_test_confirmations c where c.envelope_id=d.id),'stopped',exists(select 1 from private.r12_direct_test_revocations v where v.envelope_id=d.id) or exists(select 1 from private.r12_direct_draft_stops v where v.draft_id=d.id),
 'createdAt',to_char(d.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'expiresAt',to_char(d.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'preview',d.content)
$$;

create function private.r12_direct_prepare_test(b uuid,payload jsonb,server_key text) returns jsonb language plpgsql set search_path='' as $$
declare i jsonb:=payload->'input';r private.r12_direct_grant_reviews;gr private.r12_owner_bootstrap_grants;rt private.r12_owner_grant_roots;binding private.r12_owner_funding_bindings;route private.r12_direct_browser_routes;
 origin jsonb;funding jsonb;usage jsonb;revision jsonb;content jsonb;old private.r12_direct_test_drafts;d private.r12_direct_test_drafts;amount bigint;n integer;cutoff timestamptz;setup_op jsonb;verification_op jsonb;h text;
begin
 perform private.r04_keys(payload,array['input','setupQuote','verificationQuote']);
 perform private.r04_keys(i,array['version','businessId','goalId','grantId','predecessorScopeId','predecessorScopeHash','maximumAttemptsInWindow','maximumRunMicrounits','capProposal','submissionId']);
 if jsonb_typeof(i->'maximumAttemptsInWindow') is distinct from 'number' or coalesce(i->>'maximumAttemptsInWindow','')!~'^[1-9][0-9]?$' or i->>'version' is distinct from 'r12.owner-direct-test-input.1' or i->>'businessId' is distinct from b::text then raise exception 'r12_direct_test_input_required';end if;
 h:=private.stage14_hash(payload);select * into old from private.r12_direct_test_drafts where business_id=b and submission_id=(i->>'submissionId')::uuid;
 if found then if old.input_hash<>h or old.owner_id<>auth.uid() then raise exception 'r12_direct_idempotency_conflict';end if;return private.r12_direct_test_receipt(old);end if;
 r:=private.r12_direct_grant_check(b,(i->>'goalId')::uuid,(i->>'grantId')::uuid,server_key);
 select * into strict gr from private.r12_owner_bootstrap_grants where id=r.grant_id;select * into strict rt from private.r12_owner_grant_roots where id=gr.root_id;
 select * into strict binding from private.r12_owner_funding_bindings where id=rt.binding_id;select * into strict route from private.r12_direct_browser_routes where route_hash=r.route_hash;
 amount:=private.r05_money(i->'maximumRunMicrounits');n:=(i->>'maximumAttemptsInWindow')::integer;
 if amount<1 or amount>r.maximum_test_microunits or n<1 or n>r.maximum_attempts or route.provider_project_id<>r.provider_project_id then raise exception 'r12_direct_reviewed_bounds_exceeded';end if;
 origin:=private.r12_direct_origin_build(b,(i->>'goalId')::uuid);
 if origin->'predecessor'->'closure'->>'predecessorScopeId' is distinct from i->>'predecessorScopeId' or origin->'predecessor'->'closure'->>'predecessorScopeHash' is distinct from i->>'predecessorScopeHash'
 or (origin->'predecessor'->'closure'->>'authorityRootId')::uuid<>binding.authority_root_id
 or (origin->'predecessor'->'closure'->>'baseChildren')::integer+4>32
 or (origin->'predecessor'->'closure'->>'baseDispatches')::integer+4*n>least(64,r.cumulative_dispatches_ceiling)
 or exists(select 1 from private.r12_direct_test_confirmations where predecessor_plan_id=(origin->'predecessor'->'closure'->>'predecessorPlanId')::uuid) then raise exception 'r12_direct_origin_or_lifetime_bound';end if;
 funding:=private.r12_direct_funding_snapshot(b);perform private.r12_direct_cap_check(i->'capProposal',funding,amount);
 usage:=private.r12_direct_grant_usage(rt.id);revision:=private.r12_owner_grant_revision_current(gr,rt,clock_timestamp());
 if (usage->>'scopes')::integer>=least(coalesce((revision->>'maximumScopes')::integer,rt.maximum_scopes),coalesce(gr.maximum_scopes,2147483647))
 or (usage->>'allocationMicrounits')::bigint+amount>least(coalesce((revision->>'maximumAllocationMicrounits')::bigint,rt.maximum_allocation_microunits),coalesce(gr.maximum_allocation_microunits,9007199254740991)) then raise exception 'r12_direct_grant_exhausted';end if;
 perform private.r12_direct_browser_quote_check(payload->'setupQuote',route,r.setup_operation);perform private.r12_direct_browser_quote_check(payload->'verificationQuote',route,r.verification_operation);
 setup_op:=r.setup_operation||jsonb_build_object('quoteHash',payload->'setupQuote'->>'browserQuoteHash','maximumMicrounits',payload->'setupQuote'->>'maximumMicrounits');
 verification_op:=r.verification_operation||jsonb_build_object('quoteHash',payload->'verificationQuote'->>'browserQuoteHash','maximumMicrounits',payload->'verificationQuote'->>'maximumMicrounits');
 if (setup_op->>'maximumMicrounits')::bigint+(verification_op->>'maximumMicrounits')::bigint>=amount then raise exception 'r12_direct_no_research_headroom';end if;
 cutoff:=least(gr.valid_until,r.expires_at,route.valid_until,(select ((v.content->'parsed'->'deadline'->>'date')||' '||coalesce(v.content->'parsed'->'deadline'->>'time','23:59:59'))::timestamp at time zone (v.content->'parsed'->'deadline'->>'timezone') from private.r04_goal_versions v where v.business_id=b and v.goal_id=r.goal_id and v.revision=r.goal_revision));
 if cutoff<=clock_timestamp()+interval '10 minutes' then raise exception 'r12_direct_deadline_too_short';end if;
 d.id:=gen_random_uuid();d.policy_id:=gen_random_uuid();
 content:=jsonb_build_object('version','r12.owner-direct-test-envelope.1','testEnvelopeId',d.id,'businessId',b,'goalId',r.goal_id,'ownerId',auth.uid(),'authorityRootId',binding.authority_root_id,'bindingId',binding.id,'policyId',d.policy_id,'grantId',gr.id,'grantRootId',rt.id,'grantReviewHash',r.content_hash,'originDirectRunId',gen_random_uuid(),'input',i,'origin',origin,'originHash',private.stage14_hash(origin),'funding',funding,'capProposal',i->'capProposal','maximumMicrounits',amount::text,'maximumAttemptsInWindow',n,'setupOperation',setup_op,'verificationOperation',verification_op,'setupQuote',payload->'setupQuote','verificationQuote',payload->'verificationQuote','researchPins',r.research_pins,'profileTemplate',r.profile_template,'requiresPersistentAccessApproval',true,'existingGoalBudget', (select v.content->'parsed'->'budget' from private.r04_goal_versions v where v.business_id=b and v.goal_id=r.goal_id and v.revision=r.goal_revision),'expiresAt',to_char(cutoff at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 insert into private.r12_direct_test_drafts values(d.id,b,r.goal_id,auth.uid(),gr.id,rt.id,binding.id,d.policy_id,private.stage14_hash(origin),(origin->'predecessor'->'closure'->>'predecessorPlanId')::uuid,(i->>'submissionId')::uuid,h,content,private.stage14_hash(content),cutoff,clock_timestamp()) returning * into d;
 return private.r12_direct_test_receipt(d);
end $$;

create function private.r12_direct_confirm_test(b uuid,payload jsonb,server_key text) returns jsonb language plpgsql set search_path='' as $$
declare d private.r12_direct_test_drafts;r private.r12_direct_grant_reviews;gr private.r12_owner_bootstrap_grants;rt private.r12_owner_grant_roots;route private.r12_direct_browser_routes;
 binding private.r12_owner_funding_bindings;funding jsonb;origin jsonb;policy jsonb;body jsonb;usage jsonb;revision jsonb;amount bigint;business_limit bigint;root_limit bigint;
 key_hash text;purpose text;h text;old private.r12_direct_owner_submissions;begin
 perform private.r04_keys(payload,array['testEnvelopeId','testEnvelopeHash','submissionId']);perform private.r05_owner(b);
 select * into d from private.r12_direct_test_drafts where id=(payload->>'testEnvelopeId')::uuid and business_id=b and owner_id=auth.uid() and content_hash=payload->>'testEnvelopeHash';
 if d.id is null then raise exception 'r12_direct_exact_test_required';end if;
 h:=private.stage14_hash(payload);select * into old from private.r12_direct_owner_submissions where business_id=b and submission_id=(payload->>'submissionId')::uuid;
 if found then if old.operation<>'confirm_test' or old.input_hash<>h or old.envelope_id<>d.id then raise exception 'r12_direct_idempotency_conflict';end if;return private.r12_direct_test_receipt(d);end if;
 if exists(select 1 from private.r12_direct_test_confirmations where envelope_id=d.id) then return private.r12_direct_test_receipt(d);end if;
 if exists(select 1 from private.r12_direct_draft_stops where draft_id=d.id) then raise exception 'r12_direct_test_stopped';end if;
 r:=private.r12_direct_grant_check(b,d.goal_id,d.grant_id,server_key);
 if d.expires_at<=clock_timestamp()+interval '5 minutes' or d.content->>'grantReviewHash'<>r.content_hash then raise exception 'r12_direct_stale_test';end if;
 select * into strict gr from private.r12_owner_bootstrap_grants where id=d.grant_id;select * into strict rt from private.r12_owner_grant_roots where id=d.grant_root_id for update;
 select * into strict binding from private.r12_owner_funding_bindings where id=d.binding_id for update;select * into strict route from private.r12_direct_browser_routes where route_hash=r.route_hash;
 amount:=(d.content->>'maximumMicrounits')::bigint;funding:=private.r12_direct_funding_snapshot(b);
 if funding is distinct from d.content->'funding' then raise exception 'r12_direct_stale_financial_snapshot';end if;
 perform private.r12_direct_cap_check(d.content->'capProposal',funding,amount);
 perform private.r12_direct_browser_quote_check(d.content->'setupQuote',route,r.setup_operation);perform private.r12_direct_browser_quote_check(d.content->'verificationQuote',route,r.verification_operation);
 usage:=private.r12_direct_grant_usage(rt.id);revision:=private.r12_owner_grant_revision_current(gr,rt,clock_timestamp());
 if (usage->>'scopes')::integer>=least(coalesce((revision->>'maximumScopes')::integer,rt.maximum_scopes),coalesce(gr.maximum_scopes,2147483647))
 or (usage->>'allocationMicrounits')::bigint+amount>least(coalesce((revision->>'maximumAllocationMicrounits')::bigint,rt.maximum_allocation_microunits),coalesce(gr.maximum_allocation_microunits,9007199254740991)) then raise exception 'r12_direct_grant_exhausted';end if;
 origin:=private.r12_direct_origin_freeze(b,d.goal_id,d.origin_hash);
 if origin is distinct from d.content->'origin' then raise exception 'r12_direct_origin_changed';end if;
 business_limit:=(d.content->'capProposal'->'business'->>'proposedLimitMicrounits')::bigint;root_limit:=(d.content->'capProposal'->'root'->>'proposedLimitMicrounits')::bigint;
 policy:=jsonb_build_object('version','r12.direct-test-policy.1','businessId',b,'goalId',d.goal_id,'goalRevision',r.goal_revision,'businessRevision',gr.business_revision,'testEnvelopeId',d.id,'testEnvelopeHash',d.content_hash,'authorityRootId',binding.authority_root_id,'currency','USD','maximumMicrounits',amount::text,'maximumDispatches',2+4*(d.content->>'maximumAttemptsInWindow')::integer,'startsAt',clock_timestamp(),'expiresAt',d.expires_at,'financialMode','qualified_bounded_browser_plus_models','setupOperation',d.content->'setupOperation','verificationOperation',d.content->'verificationOperation','researchPins',r.research_pins,'capProposal',d.content->'capProposal');
 insert into private.r05_policies(id,business_id,goal_id,goal_revision,business_revision,payload,content_hash,actor_id) values(d.policy_id,b,d.goal_id,r.goal_revision,gr.business_revision,policy,private.r04_hash(policy),auth.uid());
 insert into private.r05_confirmations(policy_id,business_id,actor_id) values(d.policy_id,b,auth.uid());
 insert into private.r05_policy_proofs(policy_id,policy_hash,evidence_hash,valid_until) values(d.policy_id,private.r04_hash(policy),r.approval_hash,d.expires_at);
 if business_limit<>(funding->'business'->>'currentLimitMicrounits')::bigint then
 insert into private.r05_cap_versions(business_id,currency,revision,maximum_microunits,policy_id) values(b,'USD',(funding->'business'->>'revision')::integer+1,business_limit,d.policy_id);end if;
 if binding.kind='legacy_research_root' and root_limit>(funding->'root'->>'currentLimitMicrounits')::bigint then
 body:=jsonb_build_object('bindingId',binding.id,'revision',(funding->'root'->>'revision')::integer+1,'previousHash',funding->'root'->>'bindingHash','previousMaximumMicrounits',funding->'root'->>'currentLimitMicrounits','maximumMicrounits',root_limit::text,'committedMicrounits',funding->'root'->>'conservativeExposureMicrounits','policyId',d.policy_id,'ownerId',auth.uid());
 insert into private.r12_owner_funding_revisions(binding_id,revision,previous_hash,previous_maximum_microunits,maximum_microunits,committed_microunits,policy_id,owner_id,content_hash) values(binding.id,(body->>'revision')::integer,body->>'previousHash',(body->>'previousMaximumMicrounits')::bigint,root_limit,(body->>'committedMicrounits')::bigint,d.policy_id,auth.uid(),private.stage14_hash(body));end if;
 insert into private.r12_direct_test_envelopes(id,business_id,goal_id,owner_id,binding_id,authority_root_id,policy_id,origin_direct_run_id,maximum_microunits,business_limit_microunits,root_limit_microunits,content,content_hash,expires_at)
 values(d.id,b,d.goal_id,auth.uid(),binding.id,binding.authority_root_id,d.policy_id,(d.content->>'originDirectRunId')::uuid,amount,business_limit,root_limit,d.content,d.content_hash,d.expires_at);
 insert into private.r12_direct_test_confirmations values(d.id,d.id,gr.id,rt.id,d.predecessor_plan_id,d.origin_hash,amount,auth.uid(),clock_timestamp());
 foreach purpose in array array['handoff','verification','cleanup','evidence'] loop
 key_hash:=encode(extensions.digest(private.r12_direct_key(server_key,b,d.goal_id,d.id,d.content_hash,r.route_hash,purpose),'sha256'),'hex');
 if purpose='evidence' then insert into private.r12_direct_browser_evidence_keys values(key_hash,d.id,r.route_hash,d.expires_at+interval '30 days');
 else insert into private.r12_etsy_steel_keys values(key_hash,d.id,r.route_hash,purpose,d.expires_at+case when purpose='cleanup' then interval '24 hours' else interval '0' end);end if;
 end loop;
 insert into private.r12_direct_owner_submissions values(b,(payload->>'submissionId')::uuid,'confirm_test',h,d.id);
 return private.r12_direct_test_receipt(d);
end $$;

create function public.r12_owner_direct_server(p_business_id uuid,p_operation text,p_payload jsonb,p_server_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.r12_direct_test_drafts;old private.r12_direct_owner_submissions;h text;begin
 perform private.r05_owner(p_business_id);perform private.r04_safe(p_payload);
 if p_operation='prepare_test' then return private.r12_direct_prepare_test(p_business_id,p_payload,p_server_key);end if;
 if p_operation='confirm_test' then return private.r12_direct_confirm_test(p_business_id,p_payload,p_server_key);end if;
 if p_operation='stop_test' then
 perform private.r04_keys(p_payload,array['testEnvelopeId','testEnvelopeHash','submissionId']);
 select * into d from private.r12_direct_test_drafts where id=(p_payload->>'testEnvelopeId')::uuid and business_id=p_business_id and owner_id=auth.uid() and content_hash=p_payload->>'testEnvelopeHash';
 if d.id is null then raise exception 'r12_direct_exact_test_required';end if;
 h:=private.stage14_hash(p_payload);select * into old from private.r12_direct_owner_submissions where business_id=p_business_id and submission_id=(p_payload->>'submissionId')::uuid;
 if found and (old.operation<>'stop_test' or old.input_hash<>h or old.envelope_id<>d.id) then raise exception 'r12_direct_idempotency_conflict';end if;
 insert into private.r12_direct_draft_stops(draft_id,owner_id) values(d.id,auth.uid()) on conflict do nothing;
 if exists(select 1 from private.r12_direct_test_confirmations where envelope_id=d.id) then
 insert into private.r12_direct_test_revocations(envelope_id,reason) values(d.id,'owner_stopped') on conflict do nothing;
 insert into private.r05_revocations(policy_id,business_id,actor_id) values(d.policy_id,p_business_id,auth.uid()) on conflict do nothing;
 end if;
 insert into private.r12_direct_owner_submissions values(p_business_id,(p_payload->>'submissionId')::uuid,'stop_test',h,d.id) on conflict do nothing;
 return private.r12_direct_test_receipt(d);
 end if;raise exception 'r12_direct_owner_operation_unavailable';
end $$;

create function public.r12_owner_direct_read(p_business_id uuid,p_goal_id uuid,p_test_envelope_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.r12_direct_test_drafts;origin jsonb;funding jsonb;eligible boolean:=false;reason text:='reviewed_direct_grant_required';receipts jsonb;grants jsonb;begin
 if auth.uid() is null or private.is_business_owner(p_business_id) is distinct from true then raise exception 'r12_direct_owner_required' using errcode='42501';end if;
 if p_test_envelope_id is not null then select * into d from private.r12_direct_test_drafts where id=p_test_envelope_id and business_id=p_business_id and owner_id=auth.uid() and goal_id=p_goal_id;
 if not found then raise exception 'r12_direct_exact_test_required';end if;
 else select * into d from private.r12_direct_test_drafts where business_id=p_business_id and owner_id=auth.uid() and goal_id=p_goal_id order by created_at desc,id desc limit 1;end if;
 select coalesce(jsonb_agg(private.r12_direct_test_receipt(x) order by x.created_at desc),'[]'::jsonb) into receipts from (select * from private.r12_direct_test_drafts where business_id=p_business_id and owner_id=auth.uid() and goal_id=p_goal_id and (p_test_envelope_id is null or id=p_test_envelope_id) order by created_at desc limit 32) x;
 select coalesce(jsonb_agg(jsonb_build_object('grantId',g.id,'reviewHash',r.content_hash,'maximumTestMicrounits',r.maximum_test_microunits::text,'maximumAttemptsInWindow',r.maximum_attempts,'cumulativeDispatchesCeiling',r.cumulative_dispatches_ceiling,'providerProjectId',r.provider_project_id,'routeHash',r.route_hash,'setupOperation',r.setup_operation,'verificationOperation',r.verification_operation,'expiresAt',least(g.valid_until,r.expires_at)) order by g.created_at desc),'[]'::jsonb) into grants
 from private.r12_owner_bootstrap_grants g join private.r12_direct_grant_reviews r on r.grant_id=g.id where g.business_id=p_business_id and g.owner_id=auth.uid() and r.goal_id=p_goal_id and g.valid_from<=clock_timestamp() and least(g.valid_until,r.expires_at)>clock_timestamp() and not exists(select 1 from private.r12_owner_grant_revocations where grant_id=g.id) and not exists(select 1 from private.r12_direct_grant_review_revocations where grant_id=g.id);
 if d.id is not null then origin:=d.content->'origin';funding:=d.content->'funding';reason:=case when exists(select 1 from private.r12_direct_test_confirmations where envelope_id=d.id) then 'test_already_confirmed' else 'exact_test_confirmation_required' end;
 else begin
 origin:=private.r12_direct_origin_build(p_business_id,p_goal_id);funding:=private.r12_direct_funding_snapshot(p_business_id);
 eligible:=jsonb_array_length(grants)>0;reason:=case when eligible then null else 'reviewed_direct_grant_required' end;
 exception when others then origin:=null;funding:=null;eligible:=false;reason:='closed_qualified_origin_required';end;end if;
 return jsonb_build_object('version','r12.owner-direct-catalog.1','businessId',p_business_id,'goalId',p_goal_id,'eligible',eligible,'reason',reason,'grants',grants,'testEnvelopes',receipts,'current',case when d.id is null then null else private.r12_direct_test_receipt(d) end,'predecessor',origin->'predecessor','originHistory',origin->'originHistory','funding',funding);
end $$;

create function private.r12_direct_test_current(envelope uuid) returns void language plpgsql set search_path='' as $$
declare e private.r12_direct_test_envelopes;c private.r12_direct_test_confirmations;gr private.r12_owner_bootstrap_grants;r private.r12_direct_grant_reviews;pol private.r05_policies;h private.r07_heads;p private.r07_plans;begin
 select * into strict e from private.r12_direct_test_envelopes where id=envelope;
 select * into c from private.r12_direct_test_confirmations where envelope_id=e.id;
 select * into gr from private.r12_owner_bootstrap_grants where id=c.grant_id;
 select * into r from private.r12_direct_grant_reviews where grant_id=gr.id;
 select * into pol from private.r05_policies where id=e.policy_id and business_id=e.business_id and goal_id=e.goal_id;
 select * into h from private.r07_heads where business_id=e.business_id and goal_id=e.goal_id;select * into p from private.r07_plans where id=h.plan_id;
 if c.envelope_id is null or gr.id is null or r.grant_id is null or pol.id is null or gr.owner_id<>e.owner_id or c.actor_id<>e.owner_id
 or not exists(select 1 from public.businesses where id=e.business_id and owner_user_id=e.owner_id)
 or r.content_hash is distinct from e.content->>'grantReviewHash' or r.content_hash is distinct from private.stage14_hash(private.r12_direct_grant_review_body(r))
 or gr.valid_until<=clock_timestamp() or r.expires_at<=clock_timestamp() or e.expires_at<=clock_timestamp()
 or exists(select 1 from private.r12_direct_test_revocations where envelope_id=e.id)
 or exists(select 1 from private.r12_owner_grant_revocations where grant_id=gr.id)
 or exists(select 1 from private.r12_direct_grant_review_revocations where grant_id=gr.id)
 or exists(select 1 from private.r05_revocations where policy_id=e.policy_id)
 or not exists(select 1 from private.r04_goal_state s join private.r04_goal_versions v using(business_id,goal_id,revision) where v.business_id=e.business_id and v.goal_id=e.goal_id and v.revision=r.goal_revision and v.content_hash=r.goal_hash and v.preference='ready')
 or not exists(select 1 from private.r04_business_state s join private.r04_business_versions v using(business_id,revision) where v.business_id=e.business_id and v.revision=gr.business_revision and v.content_hash=gr.business_hash and v.preference='setup')
 or pol.payload->>'version' is distinct from 'r12.direct-test-policy.1' or pol.payload->>'testEnvelopeHash' is distinct from e.content_hash
 or (h.plan_id is distinct from c.predecessor_plan_id and not (p.content->>'format'='r12.discovery-direct.1' and p.content->>'testEnvelopeId'=e.id::text and p.content->>'testEnvelopeHash'=e.content_hash))
 then raise exception 'r12_direct_current_test_required';end if;
end $$;
create function private.r12_direct_authority_admission_guard() returns trigger language plpgsql set search_path='' as $$
declare mapping private.r12_direct_request_bindings;e private.r12_direct_test_envelopes;o private.r12_direct_browser_operations;q jsonb;begin
 select * into mapping from private.r12_direct_request_bindings where request_id=new.request_id;
 if mapping.request_id is null then return new;end if;
 select * into strict e from private.r12_direct_test_envelopes where id=mapping.envelope_id;
 -- Narrow private accounting fixtures can use independent synthetic envelopes.
 -- The real owner endpoint creates only this exact reviewed version.
 if e.content->>'version'<>'r12.owner-direct-test-envelope.1' then return new;end if;
 perform private.r12_direct_test_current(e.id);
 if mapping.kind='owner_setup' then
 select * into strict o from private.r12_direct_browser_operations where request_id=new.request_id;
 q:=case when o.scope->>'version'='etsy.steel-owner-handoff-scope.1' then e.content->'setupQuote' when o.scope->>'version'='etsy.steel-account-verification-scope.1' then e.content->'verificationQuote' else null end;
 if q is null or q->>'browserQuoteHash' is distinct from o.quote_hash or (q->>'validUntil')::timestamptz<=clock_timestamp() then raise exception 'r12_direct_current_setup_quote_required';end if;
 end if;return new;
end $$;
create trigger r12_direct_authority_admission_guard before insert on private.r05_reservations for each row execute function private.r12_direct_authority_admission_guard();
create trigger r12_direct_authority_admission_guard before insert on private.r05_markers for each row execute function private.r12_direct_authority_admission_guard();

do $$ declare f record;begin for f in select p.oid::regprocedure name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'r12_direct_%' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.name);end loop;end $$;
revoke all on function public.r12_owner_direct_server(uuid,text,jsonb,text),public.r12_owner_direct_read(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.r12_owner_direct_server(uuid,text,jsonb,text),public.r12_owner_direct_read(uuid,uuid,uuid) to authenticated;
commit;
