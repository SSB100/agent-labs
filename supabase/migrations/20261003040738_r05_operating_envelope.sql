-- R05: additive, disabled-by-default financial authority. No production grants are seeded.
begin;
create table private.r05_server_keys(key_hash text primary key check(key_hash ~ '^[a-f0-9]{64}$'), expires_at timestamptz not null);
create table private.r05_server_revocations(key_hash text primary key references private.r05_server_keys(key_hash),created_at timestamptz not null default clock_timestamp());
create table private.r05_readback_evidence(
 id uuid primary key default gen_random_uuid(),business_id uuid not null references public.businesses(id),provider text not null check(provider in ('etsy','printful')),run_id uuid not null,
 owner_id uuid not null references auth.users(id),
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),connection_id uuid not null,connection_revision uuid not null,
 purpose text not null check(purpose='existing_effect_readback'),data_classes jsonb not null check(data_classes='["provider_account_metadata","existing_effect_state"]'::jsonb),
 evidence_hash text not null check(evidence_hash ~ '^[a-f0-9]{64}$'),valid_from timestamptz not null,valid_until timestamptz not null,check(valid_until>valid_from)
);
create table private.r05_readback_revocations(evidence_id uuid primary key references private.r05_readback_evidence(id),created_at timestamptz not null default clock_timestamp());
create table private.r05_operations (
 operation_key text primary key check(operation_key in ('research.search','research.model','creative.text','creative.image','listing.specialist','listing.reviewer','listing.qualification','browser.planner')),
 pack_id uuid not null references public.packs(id), workflow_definition_id uuid not null references public.workflow_definitions(id),
 provider text not null check(provider='openrouter'), provider_model_id text not null, purpose text not null,
 currency text not null check(currency='USD'), category text not null check(category='model'),
 maximum_request_bytes integer not null check(maximum_request_bytes between 1 and 1048576),
 maximum_output_tokens integer not null check(maximum_output_tokens between 1 and 1000000),
 liability_microunits bigint not null check(liability_microunits between 1 and 9007199254740991),
 source_domains jsonb not null check(jsonb_typeof(source_domains)='array'), data_classes jsonb not null check(jsonb_typeof(data_classes)='array'),
 qualification_hash text not null check(qualification_hash ~ '^[a-f0-9]{64}$'), eligibility_hash text not null check(eligibility_hash ~ '^[a-f0-9]{64}$'), quote_hash text not null check(quote_hash ~ '^[a-f0-9]{64}$'),
 valid_from timestamptz not null, valid_until timestamptz not null, check(valid_until>valid_from)
);
create table private.r05_operation_revocations(operation_key text primary key references private.r05_operations(operation_key), created_at timestamptz not null default clock_timestamp());
create table private.r05_policies (
 id uuid primary key default gen_random_uuid(), business_id uuid not null, goal_id uuid not null, goal_revision integer not null, business_revision integer not null,
 payload jsonb not null, content_hash text not null, actor_id uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp(), unique(id,business_id),
 foreign key(goal_id,business_id,goal_revision) references private.r04_goal_versions(goal_id,business_id,revision),
 foreign key(business_id,business_revision) references private.r04_business_versions(business_id,revision)
);
-- Independent administrative interpretation evidence covers ALL exact textual rules and stop constraints.
-- A policy cannot dispatch merely because a worker omitted unsupported financial semantics.
create table private.r05_policy_proofs(policy_id uuid primary key references private.r05_policies(id), policy_hash text not null, evidence_hash text not null check(evidence_hash ~ '^[a-f0-9]{64}$'), valid_until timestamptz not null);
create table private.r05_confirmations(policy_id uuid primary key, business_id uuid not null, actor_id uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp(), foreign key(policy_id,business_id) references private.r05_policies(id,business_id));
create table private.r05_revocations(policy_id uuid primary key, business_id uuid not null, actor_id uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp(), foreign key(policy_id,business_id) references private.r05_policies(id,business_id));
create table private.r05_cap_versions(business_id uuid not null references public.businesses(id), currency text not null, revision integer not null check(revision>0), maximum_microunits bigint not null check(maximum_microunits>=0), policy_id uuid not null, created_at timestamptz not null default clock_timestamp(), primary key(business_id,currency,revision), foreign key(policy_id,business_id) references private.r05_policies(id,business_id));
create table private.r05_pause_events(id bigint generated always as identity primary key, business_id uuid not null references public.businesses(id), kind text not null check(kind in ('business','quest','pack','account')), target_id uuid not null, paused boolean not null, actor_id uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp());
create index r05_pause_latest on private.r05_pause_events(business_id,kind,target_id,id desc);
create table private.r05_submissions(business_id uuid not null references public.businesses(id), id uuid not null, request_hash text not null, result jsonb not null, primary key(business_id,id));
create table private.r05_requests(
 id uuid primary key default gen_random_uuid(), business_id uuid not null, workflow_run_id uuid not null, policy_id uuid,
 idempotency_key text not null, request_hash text not null, payload jsonb not null, source_key text not null,
 currency text not null, liability_microunits bigint not null check(liability_microunits>0), created_at timestamptz not null default clock_timestamp(),
 unique(business_id,idempotency_key), unique(business_id,source_key), unique(id,business_id),
 foreign key(workflow_run_id,business_id) references public.workflow_runs(id,business_id), foreign key(policy_id,business_id) references private.r05_policies(id,business_id)
);
create table private.r05_reservations(request_id uuid primary key, business_id uuid not null, created_at timestamptz not null default clock_timestamp(), foreign key(request_id,business_id) references private.r05_requests(id,business_id));
create table private.r05_markers(request_id uuid primary key, business_id uuid not null, created_at timestamptz not null default clock_timestamp(), foreign key(request_id,business_id) references private.r05_requests(id,business_id));
create table private.r05_releases(request_id uuid primary key, business_id uuid not null, evidence_hash text not null check(evidence_hash ~ '^[a-f0-9]{64}$'), created_at timestamptz not null default clock_timestamp(), foreign key(request_id,business_id) references private.r05_requests(id,business_id));
create table private.r05_settlements(id bigint generated always as identity primary key,request_id uuid not null, business_id uuid not null, currency text not null, actual_microunits bigint check(actual_microunits between 0 and 9007199254740991), provider_request_id text not null, receipt_hash text not null check(receipt_hash ~ '^[a-f0-9]{64}$'), created_at timestamptz not null default clock_timestamp(), unique(request_id,receipt_hash),foreign key(request_id,business_id) references private.r05_requests(id,business_id));
create table private.r05_receipt_claims(provider text not null check(provider='openrouter'),provider_request_id text not null,business_id uuid not null references public.businesses(id),workflow_run_id uuid not null,source_key text not null,created_at timestamptz not null default clock_timestamp(),primary key(provider,provider_request_id),foreign key(workflow_run_id,business_id) references public.workflow_runs(id,business_id));
create table private.r05_legacy_attestations(business_id uuid not null references public.businesses(id),workflow_run_id uuid not null,source_key text not null,reported_microusd bigint,provider_request_id text,receipt_hash text not null,created_at timestamptz not null default clock_timestamp(),primary key(business_id,source_key,receipt_hash),foreign key(workflow_run_id,business_id) references public.workflow_runs(id,business_id));
create table private.r05_decisions(id bigint generated always as identity primary key,business_id uuid not null references public.businesses(id),request_id uuid,decision text not null,reason text not null,created_at timestamptz not null default clock_timestamp(),foreign key(request_id,business_id) references private.r05_requests(id,business_id));
create index r05_requests_policy on private.r05_requests(business_id,policy_id);
create index r05_decisions_business on private.r05_decisions(business_id,id desc);
create index r05_research_receipt_lookup on public.product_research_cost_settlements(provider_request_id) where provider_request_id is not null;
create index r05_listing_receipt_lookup on public.listing_cost_settlements(provider_request_id) where provider_request_id is not null;
create index r05_qualification_receipt_lookup on private.listing_qualification_settlements(provider_request_id) where provider_request_id is not null;
create index r05_model_receipt_lookup on public.model_invocations(provider,provider_request_id) where provider_request_id is not null;
create function private.r05_guard() returns trigger language plpgsql set search_path='' as $$ begin
 if current_user in ('anon','authenticated','service_role') then raise exception 'r05_guarded_rpc_required' using errcode='42501'; end if;
 if tg_op<>'INSERT' then raise exception 'r05_immutable_history'; end if; return new;
end $$;
do $$ declare t text; begin
 for t in select tablename from pg_tables where schemaname='private' and tablename like 'r05_%' loop
 execute format('alter table private.%I enable row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger r05_guard before insert or update or delete on private.%I for each row execute function private.r05_guard()',t);
 end loop;
end $$;
create function private.r05_money(v jsonb) returns bigint language plpgsql immutable set search_path='' as $$ begin
 if jsonb_typeof(v) is distinct from 'string' or (v#>>'{}') !~ '^(0|[1-9][0-9]{0,15})$' or (v#>>'{}')::numeric>9007199254740991 then raise exception 'r05_invalid_money'; end if; return (v#>>'{}')::bigint;
end $$;
create function private.r05_owner(b uuid) returns void language plpgsql set search_path='' as $$ begin
 if auth.uid() is null then raise exception 'r05_owner_required' using errcode='42501'; end if;
 perform 1 from public.businesses where id=b and owner_user_id=auth.uid() for update;
 if not found then raise exception 'r05_owner_required' using errcode='42501'; end if;
end $$;
create function private.r05_paused(b uuid,k text,t uuid) returns boolean language sql stable set search_path='' as $$ select coalesce((select paused from private.r05_pause_events where business_id=b and kind=k and target_id=t order by id desc limit 1),false) $$;
create function private.r05_result(b uuid,r uuid,d text,reason text,send boolean default false) returns jsonb language plpgsql set search_path='' as $$ begin
 insert into private.r05_decisions(business_id,request_id,decision,reason) values(b,r,d,reason);
 return jsonb_build_object('decision',d,'reason',reason,'requestId',r,'shouldDispatch',send);
end $$;

-- Original financial rows remain authoritative. Exact sidecar source identity avoids double booking.
create function private.r05_legacy_exposure(b uuid) returns table(source_key text,workflow_id uuid,currency text,held bigint,unknown boolean,request_hash text,model text,receipt text,created_at timestamptz,provider text,has_settlement boolean) language sql stable set search_path='' as $$
 select 'research:'||r.id,r.workflow_run_id,'USD',coalesce(s.actual,r.reserved_microusd)::bigint,s.actual is null,r.request_hash,null::text,s.receipt,r.created_at,'openrouter',s.records>0
 from public.product_research_cost_reservations r left join lateral(select max(reported_microusd) filter(where provider_request_id is not null) actual,min(provider_request_id) receipt,count(*) records from public.product_research_cost_settlements where reservation_id=r.id) s on true where r.business_id=b
 union all select 'creative:'||r.creative_run_id||':'||r.call_key,w.workflow_run_id,'USD',case when s.provider_request_id is not null then coalesce(s.reported_microusd,r.reserved_microusd) else r.reserved_microusd end,s.reported_microusd is null or s.provider_request_id is null,r.request_hash,r.model,s.provider_request_id,r.created_at,'openrouter',s.call_key is not null from public.creative_cost_reservations r join public.creative_runs w on w.id=r.creative_run_id left join public.creative_cost_settlements s on s.creative_run_id=r.creative_run_id and s.call_key=r.call_key and s.business_id=r.business_id where r.business_id=b
 union all select 'listing:'||r.listing_run_id||':'||r.role,w.workflow_run_id,'USD',case when s.provider_request_id is not null then coalesce(s.reported_microusd,r.reserved_microusd) else r.reserved_microusd end,s.reported_microusd is null or s.provider_request_id is null,r.request_hash,r.model,s.provider_request_id,r.created_at,'openrouter',s.role is not null from public.listing_cost_reservations r join public.listing_runs w on w.id=r.listing_run_id left join public.listing_cost_settlements s on s.listing_run_id=r.listing_run_id and s.role=r.role and s.business_id=r.business_id where r.business_id=b
 union all select 'listing_qualification:'||r.run_id||':'||r.case_key,w.workflow_run_id,'USD',case when s.provider_request_id is not null then coalesce(s.reported_microusd,r.reserved_microusd) else r.reserved_microusd end,s.reported_microusd is null or s.provider_request_id is null,r.request_hash,null::text,s.provider_request_id,r.created_at,'openrouter',s.case_key is not null from private.listing_qualification_reservations r join private.listing_qualification_runs w on w.id=r.run_id left join private.listing_qualification_settlements s using(run_id,case_key) where w.business_id=b
 union all select 'model_invocation:'||m.id,m.workflow_run_id,'USD',ceil(1000000*case when m.provider_request_id is not null then coalesce(m.reported_cost_usd,m.estimated_cost_usd) else m.estimated_cost_usd end)::bigint,m.reported_cost_usd is null or m.provider_request_id is null,null::text,m.provider_model_id,m.provider_request_id,m.created_at,m.provider,m.status<>'started' from public.model_invocations m where m.business_id=b
$$;
-- Pending source exposure is never hidden by an unknown settlement. Unsent release is independent proof.
create function private.r05_verified_telemetry_mirror(b uuid,k text) returns boolean language sql stable set search_path='' as $$
 select k like 'model_invocation:%' and exists(select 1 from public.model_invocations m join public.listing_cost_reservations cr on cr.task_contract_id=m.task_contract_id and cr.worker_run_id=m.worker_run_id and cr.business_id=m.business_id join public.listing_runs lr on lr.id=cr.listing_run_id and lr.workflow_run_id=m.workflow_run_id join public.listing_cost_settlements cs on cs.listing_run_id=cr.listing_run_id and cs.role=cr.role where m.business_id=b and 'model_invocation:'||m.id=k and m.provider='openrouter' and m.provider_model_id=cr.model and m.provider_request_id=cs.provider_request_id and m.reported_cost_usd is not null and ceil(m.reported_cost_usd*1000000)=cs.reported_microusd)
$$;
create function private.r05_model_source(b uuid,invocation uuid) returns text language sql stable set search_path='' as $$
 select coalesce((select 'listing:'||cr.listing_run_id||':'||cr.role from public.model_invocations m join public.listing_cost_reservations cr on cr.task_contract_id=m.task_contract_id and cr.worker_run_id=m.worker_run_id and cr.business_id=m.business_id join public.listing_runs lr on lr.id=cr.listing_run_id and lr.workflow_run_id=m.workflow_run_id where m.id=invocation and m.business_id=b and m.provider='openrouter' and m.provider_model_id=cr.model),'model_invocation:'||invocation)
$$;
create function private.r05_exposure(b uuid) returns table(source_key text,currency text,held bigint,unknown boolean,policy_id uuid) language sql stable set search_path='' as $$
 with legacy as (select l.source_key,l.currency,
 case when l.unknown then coalesce(a.actual,l.held) else greatest(l.held,coalesce(a.actual,0)) end held,
 l.unknown and a.actual is null unknown,r.id rid,r.policy_id,l.receipt,l.provider
 from private.r05_legacy_exposure(b) l left join private.r05_requests r on r.business_id=b and r.source_key=l.source_key
 left join lateral(select max(reported_microusd) filter(where provider_request_id is not null) actual from private.r05_legacy_attestations where business_id=b and source_key=l.source_key) a on true
 where not exists(select 1 from private.r05_releases z where z.request_id=r.id)
 and not private.r05_verified_telemetry_mirror(b,l.source_key)
 ), ranked as (select *,count(*) over(partition by provider,receipt) receipt_count from legacy)
 select l.source_key,l.currency,l.held,
 (l.unknown and (rid is null or not exists(select 1 from private.r05_reservations v where v.request_id=rid) or exists(select 1 from private.r05_markers m where m.request_id=rid))) or (receipt is not null and receipt_count>1),l.policy_id from ranked l
 union all select r.source_key,r.currency,coalesce(s.actual_microunits,r.liability_microunits),s.actual_microunits is null and exists(select 1 from private.r05_markers m where m.request_id=r.id),r.policy_id
 from private.r05_requests r join private.r05_reservations v on v.request_id=r.id left join lateral(select max(actual_microunits) actual_microunits from private.r05_settlements where request_id=r.id) s on true
 where r.business_id=b and r.payload->'accounting'->>'kind'='r05' and not exists(select 1 from private.r05_releases z where z.request_id=r.id)
$$;

create function private.r05_policy_validate(b uuid,p jsonb) returns void language plpgsql set search_path='' as $$
declare x jsonb; o private.r05_operations; g private.r04_goal_versions; br private.r04_business_versions; k text; begin
 perform private.r04_safe(p); perform private.r04_keys(p,array['version','goalId','goalRevision','businessRevision','currency','businessLifetimeLimitMicrounits','policyLimitMicrounits','categoryLimits','expectedCapRevision','expectedExposureMicrounits','startsAt','expiresAt','maximumDispatches','minimumIntervalSeconds','stopOnTarget','operations','financialMode']);
 foreach k in array array['goalId','startsAt','expiresAt','currency'] loop if jsonb_typeof(p->k) is distinct from 'string' then raise exception 'r05_invalid_policy_type'; end if; end loop;
 foreach k in array array['goalRevision','businessRevision','expectedCapRevision','maximumDispatches','minimumIntervalSeconds'] loop if jsonb_typeof(p->k) is distinct from 'number' then raise exception 'r05_invalid_policy_type'; end if; end loop;
 if p->>'version' is distinct from 'r05.1' or p->>'financialMode' is distinct from 'bounded_model_cost_only' or p->>'currency' is distinct from 'USD' or p->'stopOnTarget' is distinct from 'false'::jsonb then raise exception 'r05_unsupported_policy'; end if;
 select v.* into g from private.r04_goal_versions v join private.r04_goal_state s using(goal_id,business_id,revision) where v.goal_id=(p->>'goalId')::uuid and v.business_id=b and v.revision=(p->>'goalRevision')::integer;
 select v.* into br from private.r04_business_versions v join private.r04_business_state s using(business_id,revision) where v.business_id=b and v.revision=(p->>'businessRevision')::integer;
 if g.goal_id is null or br.business_id is null or g.preference<>'ready' or br.preference<>'setup' then raise exception 'r05_stale_or_stopped_intent'; end if;
 perform private.r04_parsed(g.content->'parsed',true);
 if g.content->'ambiguities'<>'[]'::jsonb then raise exception 'r05_ambiguous_intent'; end if;
 if g.content->'parsed'->'budget'->>'currency' is distinct from p->>'currency' or private.r05_money(p->'policyLimitMicrounits')>floor((g.content->'parsed'->'budget'->>'amount')::numeric*1000000) then raise exception 'r05_intent_budget_exceeded'; end if;
 if private.r05_money(p->'policyLimitMicrounits')>private.r05_money(p->'businessLifetimeLimitMicrounits') then raise exception 'r05_invalid_caps'; end if;
 if p->'categoryLimits' is distinct from jsonb_build_array(jsonb_build_object('category','model','microunits',p->'policyLimitMicrounits')) then raise exception 'r05_unsupported_categories'; end if;
 if (p->>'expectedCapRevision') !~ '^(0|[1-9][0-9]{0,8})$' or (p->>'maximumDispatches') !~ '^[1-9][0-9]{0,5}$' or (p->>'minimumIntervalSeconds') !~ '^(0|[1-9][0-9]{0,5})$' then raise exception 'r05_invalid_cadence'; end if;
 if p->>'startsAt' !~ '^\d{4}-\d\d-\d\dT' or p->>'expiresAt' !~ '^\d{4}-\d\d-\d\dT' or (p->>'expiresAt')::timestamptz<=(p->>'startsAt')::timestamptz or (p->>'expiresAt')::timestamptz>(p->>'startsAt')::timestamptz+interval '31 days' then raise exception 'r05_invalid_duration'; end if;
 if (p->>'expiresAt')::timestamptz>((g.content->'parsed'->'deadline'->>'date')||' '||coalesce(g.content->'parsed'->'deadline'->>'time','23:59:59'))::timestamp at time zone (g.content->'parsed'->'deadline'->>'timezone') then raise exception 'r05_intent_deadline_exceeded'; end if;
 if jsonb_typeof(p->'operations') is distinct from 'array' or jsonb_array_length(p->'operations') not between 1 and 16 then raise exception 'r05_invalid_operations'; end if;
 for x in select value from jsonb_array_elements(p->'operations') loop
 perform private.r04_keys(x,array['operationKey','installationId','workflowDefinitionId','purpose','provider','category','accountId','accountRevision','sourceDomains','dataClasses','maximumPerOperationMicrounits']);
 foreach k in array array['operationKey','installationId','workflowDefinitionId','purpose','provider','category'] loop if jsonb_typeof(x->k) is distinct from 'string' then raise exception 'r05_invalid_operation_type'; end if; end loop;
 perform private.r04_strings(x->'sourceDomains',32); perform private.r04_strings(x->'dataClasses',32);
 select * into o from private.r05_operations where operation_key=x->>'operationKey';
 if o.operation_key is null or x->>'workflowDefinitionId'<>o.workflow_definition_id::text or x->>'purpose'<>o.purpose or x->>'provider'<>o.provider or x->>'category'<>o.category or x->'sourceDomains'<>o.source_domains or x->'dataClasses'<>o.data_classes or private.r05_money(x->'maximumPerOperationMicrounits')<o.liability_microunits or private.r05_money(x->'maximumPerOperationMicrounits')>private.r05_money(p->'policyLimitMicrounits') then raise exception 'r05_operation_scope_mismatch'; end if;
 if not exists(select 1 from public.installed_packs i join public.packs pk on pk.id=i.root_pack_id where i.id=(x->>'installationId')::uuid and i.business_id=b and i.root_pack_id=o.pack_id and i.status='active' and pk.status<>'retired') then raise exception 'r05_pack_unavailable'; end if;
 if (x->'accountId'='null'::jsonb) is distinct from (x->'accountRevision'='null'::jsonb) then raise exception 'r05_account_scope_mismatch'; end if;
 if x->'accountId'<>'null'::jsonb and not exists(select 1 from private.connected_accounts where id=(x->>'accountId')::uuid and business_id=b and owner_id=auth.uid() and connection_revision=(x->>'accountRevision')::uuid and status='connected' and revoked_at is null) then raise exception 'r05_account_unavailable'; end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p->'operations') item group by item->>'operationKey' having count(*)>1) then raise exception 'r05_duplicate_operation'; end if;
end $$;

create function public.r05_policy_owner(p_business_id uuid,p_operation text,p_payload jsonb,p_submission_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare h text; old private.r05_submissions; p private.r05_policies; result jsonb; n integer; scope text; scope_target uuid; begin
 perform private.r05_owner(p_business_id); perform private.r04_safe(p_payload);
 if p_submission_id is null then raise exception 'r05_submission_required'; end if;
 h:=private.r04_hash(jsonb_build_object('operation',p_operation,'payload',p_payload));
 select * into old from private.r05_submissions where business_id=p_business_id and id=p_submission_id;
 if found then if old.request_hash<>h then raise exception 'r05_idempotency_conflict'; end if; return old.result||jsonb_build_object('replayed',true); end if;
 if p_operation='propose' then
 perform private.r05_policy_validate(p_business_id,p_payload);
 insert into private.r05_policies(business_id,goal_id,goal_revision,business_revision,payload,content_hash,actor_id) values(p_business_id,(p_payload->>'goalId')::uuid,(p_payload->>'goalRevision')::integer,(p_payload->>'businessRevision')::integer,p_payload,private.r04_hash(p_payload),auth.uid()) returning * into p;
 result:=jsonb_build_object('id',p.id,'hash',p.content_hash,'status','proposed');
 elsif p_operation in ('confirm','revoke') then
 perform private.r04_keys(p_payload,array['policyId','policyHash']);
 select * into p from private.r05_policies where id=(p_payload->>'policyId')::uuid and business_id=p_business_id;
 if p.id is null or p.content_hash is distinct from p_payload->>'policyHash' then raise exception 'r05_exact_policy_required'; end if;
 if p_operation='confirm' then
 if p.actor_id<>auth.uid() then raise exception 'r05_policy_owner_changed'; end if;
 perform private.r05_policy_validate(p_business_id,p.payload);
 if exists(select 1 from private.r05_revocations where policy_id=p.id) then raise exception 'r05_revoked'; end if;
 if not exists(select 1 from private.r05_confirmations where policy_id=p.id) then
 select coalesce(max(revision),0) into n from private.r05_cap_versions where business_id=p_business_id and currency=p.payload->>'currency';
 if n<>(p.payload->>'expectedCapRevision')::integer then raise exception 'r05_stale_cap_revision'; end if;
 if exists(select 1 from private.r05_exposure(p_business_id) where unknown) then raise exception 'r05_unresolved_prior_liability'; end if;
 if (select coalesce(sum(held),0) from private.r05_exposure(p_business_id) where currency=p.payload->>'currency')<>private.r05_money(p.payload->'expectedExposureMicrounits') then raise exception 'r05_stale_exposure'; end if;
 insert into private.r05_cap_versions values(p_business_id,p.payload->>'currency',n+1,private.r05_money(p.payload->'businessLifetimeLimitMicrounits'),p.id,clock_timestamp());
 insert into private.r05_confirmations(policy_id,business_id,actor_id) values(p.id,p_business_id,auth.uid());
 end if; result:=jsonb_build_object('id',p.id,'status','confirmed_capability_gated');
 else insert into private.r05_revocations(policy_id,business_id,actor_id) values(p.id,p_business_id,auth.uid()) on conflict do nothing; result:=jsonb_build_object('id',p.id,'status','revoked'); end if;
 elsif p_operation in ('pause','resume') then
 perform private.r04_keys(p_payload,array['kind','id']); scope:=p_payload->>'kind'; scope_target:=(p_payload->>'id')::uuid;
 if not ((scope='business' and scope_target=p_business_id) or (scope='quest' and exists(select 1 from public.goals where id=scope_target and business_id=p_business_id)) or (scope='pack' and exists(select 1 from public.installed_packs where id=scope_target and business_id=p_business_id)) or (scope='account' and exists(select 1 from private.connected_accounts where id=scope_target and business_id=p_business_id))) then raise exception 'r05_scope_unavailable'; end if;
 insert into private.r05_pause_events(business_id,kind,target_id,paused,actor_id) values(p_business_id,scope,scope_target,p_operation='pause',auth.uid());
 result:=jsonb_build_object('kind',scope,'id',scope_target,'paused',p_operation='pause');
 else raise exception 'r05_unknown_operation'; end if;
 insert into private.r05_submissions values(p_business_id,p_submission_id,h,result);
 return result;
end $$;

create function private.r05_admissible(r private.r05_requests) returns text language plpgsql set search_path='' as $$
declare p private.r05_policies; o private.r05_operations; w public.workflow_runs; s jsonb; cap bigint; total numeric; policy_total numeric; own numeric; n integer; latest timestamptz; a private.connected_accounts; begin
 select * into p from private.r05_policies where id=r.policy_id;
 if p.id is null then return 'confirmed_operating_policy_required'; end if;
 if not exists(select 1 from public.businesses b join private.r05_confirmations c on c.business_id=b.id where b.id=r.business_id and b.owner_user_id=p.actor_id and c.policy_id=p.id and c.actor_id=b.owner_user_id) then return 'policy_owner_changed'; end if;
 if not exists(select 1 from private.r05_confirmations where policy_id=p.id) or exists(select 1 from private.r05_revocations where policy_id=p.id) then return 'policy_not_confirmed'; end if;
 if not exists(select 1 from private.r04_goal_state where goal_id=p.goal_id and business_id=r.business_id and revision=p.goal_revision) or not exists(select 1 from private.r04_business_state where business_id=r.business_id and revision=p.business_revision) then return 'intent_revision_changed'; end if;
 if not exists(select 1 from private.r04_goal_versions where goal_id=p.goal_id and business_id=r.business_id and revision=p.goal_revision and preference='ready') or not exists(select 1 from private.r04_business_versions where business_id=r.business_id and revision=p.business_revision and preference='setup') then return 'intent_stopped'; end if;
 if clock_timestamp()<(p.payload->>'startsAt')::timestamptz or clock_timestamp()>=(p.payload->>'expiresAt')::timestamptz then return 'policy_outside_validity'; end if;
 if not exists(select 1 from private.r05_policy_proofs where policy_id=p.id and policy_hash=p.content_hash and valid_until>clock_timestamp()) then return 'rules_interpretation_unqualified'; end if;
 select value into s from jsonb_array_elements(p.payload->'operations') where value->>'operationKey'=r.payload->>'operationKey';
 select * into o from private.r05_operations where operation_key=r.payload->>'operationKey' for share;
 select * into w from public.workflow_runs where id=r.workflow_run_id and business_id=r.business_id;
 if s is null or o.operation_key is null or exists(select 1 from private.r05_operation_revocations where operation_key=o.operation_key) or clock_timestamp()<o.valid_from or clock_timestamp()>=o.valid_until then return 'operation_evidence_unavailable'; end if;
 if w.status not in ('queued','running','waiting','review') or w.workflow_definition_id<>o.workflow_definition_id or w.pack_installation_id is distinct from (s->>'installationId')::uuid then return 'workflow_scope_mismatch'; end if;
 if o.provider_model_id is distinct from r.payload->>'providerModelId' or (r.payload->>'wireRequestBytes')::integer>o.maximum_request_bytes or (r.payload->>'maximumOutputTokens')::integer>o.maximum_output_tokens or r.liability_microunits<>o.liability_microunits or r.currency<>o.currency or r.payload->'sourceDomains' is distinct from o.source_domains or r.payload->'dataClasses' is distinct from o.data_classes or r.payload->'accountId' is distinct from s->'accountId' or r.payload->'accountRevision' is distinct from s->'accountRevision' then return 'wire_scope_or_quote_mismatch'; end if;
 -- Share locks serialize administrative retirement/revision changes with the marker.
 perform 1 from public.installed_packs where id=w.pack_installation_id and business_id=r.business_id and root_pack_id=o.pack_id and status='active' for share;
 if not found then return 'pack_unavailable'; end if;
 perform 1 from public.packs where id=o.pack_id and status<>'retired' for share;
 if not found then return 'pack_unavailable'; end if;
 if s->>'accountId' is not null then
 select * into a from private.connected_accounts where id=(s->>'accountId')::uuid and business_id=r.business_id for share;
 if a.id is null or a.owner_id<>p.actor_id or a.connection_revision::text is distinct from s->>'accountRevision' or a.status<>'connected' or a.revoked_at is not null then return 'account_unavailable'; end if;
 end if;
 if private.r05_paused(r.business_id,'business',r.business_id) or private.r05_paused(r.business_id,'quest',p.goal_id) or private.r05_paused(r.business_id,'pack',w.pack_installation_id) or (s->>'accountId' is not null and private.r05_paused(r.business_id,'account',(s->>'accountId')::uuid)) then return 'scope_paused'; end if;
 if exists(select 1 from private.r05_releases where request_id=r.id) then return 'released_unsent'; end if;
 if exists(select 1 from private.r05_exposure(r.business_id) e where e.unknown and e.source_key<>r.source_key) then return 'unresolved_prior_liability'; end if;
 select maximum_microunits into cap from private.r05_cap_versions where business_id=r.business_id and currency=r.currency order by revision desc limit 1;
 select coalesce(sum(e.held),0),coalesce(sum(e.held) filter(where e.policy_id=r.policy_id),0),coalesce(sum(e.held) filter(where e.source_key=r.source_key),0) into total,policy_total,own from private.r05_exposure(r.business_id) e where e.currency=r.currency;
 if cap is null or total-own+r.liability_microunits>cap or policy_total-own+r.liability_microunits>private.r05_money(p.payload->'policyLimitMicrounits') or r.liability_microunits>private.r05_money(s->'maximumPerOperationMicrounits') then return 'financial_cap_exceeded'; end if;
 select count(*),max(m.created_at) into n,latest from private.r05_markers m join private.r05_requests q on q.id=m.request_id where q.policy_id=p.id and q.id<>r.id;
 if n>=(p.payload->>'maximumDispatches')::integer or (latest is not null and latest+make_interval(secs=>(p.payload->>'minimumIntervalSeconds')::integer)>clock_timestamp()) then return 'cadence_exceeded'; end if;
 return null;
end $$;

create function private.r05_claim_receipt(b uuid,w uuid,k text,p_receipt text) returns void language plpgsql set search_path='' as $$
declare claim private.r05_receipt_claims; begin
 if p_receipt is null then return; end if;
 if length(p_receipt) not between 1 and 300 then raise exception 'r05_invalid_receipt'; end if;
 insert into private.r05_receipt_claims(provider,provider_request_id,business_id,workflow_run_id,source_key) values('openrouter',p_receipt,b,w,k) on conflict do nothing;
 select * into claim from private.r05_receipt_claims where provider='openrouter' and provider_request_id=p_receipt;
 if claim.business_id<>b or claim.workflow_run_id<>w or claim.source_key<>k then raise exception 'r05_receipt_already_used'; end if;
 -- Historical receipts have no claim rows; check all original ledgers before accepting a claim.
 if exists(select 1 from public.product_research_cost_settlements s where s.provider_request_id=p_receipt and (s.business_id<>b or 'research:'||s.reservation_id<>k))
 or exists(select 1 from public.creative_cost_settlements s where s.provider_request_id=p_receipt and (s.business_id<>b or 'creative:'||s.creative_run_id||':'||s.call_key<>k))
 or exists(select 1 from public.listing_cost_settlements s where s.provider_request_id=p_receipt and (s.business_id<>b or 'listing:'||s.listing_run_id||':'||s.role<>k))
 or exists(select 1 from private.listing_qualification_settlements s join private.listing_qualification_runs q on q.id=s.run_id where s.provider_request_id=p_receipt and (q.business_id<>b or 'listing_qualification:'||s.run_id||':'||s.case_key<>k))
 or exists(select 1 from public.model_invocations m where m.provider='openrouter' and m.provider_request_id=p_receipt and not (m.business_id=b and m.workflow_run_id=w and private.r05_model_source(b,m.id)=k)) then raise exception 'r05_receipt_already_used'; end if;
end $$;
create function private.r05_legacy_settle(b uuid,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare source record; key text; wf uuid:=(p->>'workflowRunId')::uuid; kind text:=p->>'kind'; amount bigint; receipt_id text:=p->>'providerRequestId'; payload jsonb; result jsonb; expected_capability_hash text; begin
 perform private.r04_keys(p,array['kind','runId','workflowRunId','runtimeCapability','callKey','reportedMicrousd','providerRequestId','receipt']);
 perform private.r04_safe(p-'runtimeCapability');
 if kind not in ('research','creative','listing','listing_qualification') or jsonb_typeof(p->'receipt') is distinct from 'object' or not exists(select 1 from public.workflow_runs where id=wf and business_id=b) then raise exception 'r05_invalid_legacy_settlement'; end if;
 expected_capability_hash:=encode(extensions.digest(convert_to(p->>'runtimeCapability','UTF8'),'sha256'),'hex');
 if expected_capability_hash is null or not coalesce((
 (kind='research' and exists(select 1 from public.workflow_runs where id=wf and business_id=b and runtime_capability_hash=expected_capability_hash)) or
 (kind='creative' and exists(select 1 from public.creative_runs r join private.creative_run_capabilities c on c.creative_run_id=r.id where r.id=(p->>'runId')::uuid and r.business_id=b and r.workflow_run_id=wf and c.capability_hash=expected_capability_hash)) or
 (kind='listing' and exists(select 1 from public.listing_runs r join private.listing_run_capabilities c on c.listing_run_id=r.id where r.id=(p->>'runId')::uuid and r.business_id=b and r.workflow_run_id=wf and c.capability_hash=expected_capability_hash)) or
 (kind='listing_qualification' and exists(select 1 from private.listing_qualification_runs r where r.id=(p->>'runId')::uuid and r.business_id=b and r.workflow_run_id=wf and r.capability_hash=expected_capability_hash))),false) then raise exception 'r05_runtime_authority_required'; end if;
 if p->'reportedMicrousd'<>'null'::jsonb then
 if jsonb_typeof(p->'reportedMicrousd') is distinct from 'number' or p->>'reportedMicrousd' !~ '^(0|[1-9][0-9]{0,15})$' or (p->>'reportedMicrousd')::numeric>9007199254740991 then raise exception 'r05_invalid_money'; end if;
 amount:=(p->>'reportedMicrousd')::bigint; end if;
 if kind='research' then select 'research:'||id into key from public.product_research_cost_reservations where business_id=b and workflow_run_id=wf and attempt_key=p->>'callKey';
 else key:=kind||':'||(p->>'runId')||':'||(p->>'callKey'); end if;
 select * into source from private.r05_legacy_exposure(b) where source_key=key;
 if source.source_key is null or source.workflow_id<>wf then raise exception 'r05_accounting_source_mismatch'; end if;
 if (source.receipt is not null and source.receipt is distinct from receipt_id) or exists(select 1 from private.r05_legacy_attestations a where a.business_id=b and a.source_key=key and a.provider_request_id is not null and a.provider_request_id is distinct from receipt_id) then raise exception 'r05_provider_identity_changed'; end if;
 perform private.r05_claim_receipt(b,wf,key,receipt_id);
 insert into private.r05_legacy_attestations(business_id,workflow_run_id,source_key,reported_microusd,provider_request_id,receipt_hash) values(b,wf,key,amount,receipt_id,private.r04_hash(p-'runtimeCapability')) on conflict do nothing;
 -- Reconciliation of an immutable old receipt, an amount beyond the old research integer,
 -- or an expired creative capability
 -- appends trusted financial evidence only. It never rewrites the old receipt or resumes work.
 if source.has_settlement or (kind='research' and amount>2147483647) or (kind='creative' and exists(select 1 from public.creative_runs where id=(p->>'runId')::uuid and capability_expires_at<=clock_timestamp())) then return jsonb_build_object('recorded',true,'r05Readback',true); end if;
 payload:=jsonb_build_object('reportedMicrousd',p->'reportedMicrousd','providerRequestId',p->'providerRequestId','receipt',p->'receipt');
 -- Every original capability/receipt/context check remains in force. Any failure rolls back
 -- the trusted attestation and global claim together with the original ledger transaction.
 if kind='research' then result:=public.record_product_research_cost(wf,b,p->>'runtimeCapability',p->>'callKey',amount::integer,receipt_id);
 elsif kind='creative' then result:=public.creative_runtime_transition((p->>'runId')::uuid,b,p->>'runtimeCapability','record_call',payload||jsonb_build_object('callKey',p->>'callKey'));
 elsif kind='listing' then result:=public.listing_runtime_transition((p->>'runId')::uuid,b,p->>'runtimeCapability','settle',payload||jsonb_build_object('role',p->>'callKey'));
 else result:=public.listing_qualification_transition((p->>'runId')::uuid,b,p->>'runtimeCapability','settle',payload||jsonb_build_object('caseKey',p->>'callKey')); end if;
 return result;
end $$;

create function private.r05_existing_effect_read(b uuid,p jsonb) returns text language plpgsql set search_path='' as $$
declare proof private.r05_readback_evidence; pf private.printful_product_runs; et private.etsy_publication_runs; marker_hash text; marker_time timestamptz; endpoints text[]; root text; shop text; listing text; begin
 perform private.r04_safe(p);perform private.r04_keys(p,array['provider','runId','requestHash','sentAt','connectionId','connectionRevision','endpoint']);
 if p->>'provider' not in ('etsy','printful') or p->>'requestHash' !~ '^[a-f0-9]{64}$' or jsonb_typeof(p->'endpoint') is distinct from 'string' then return 'readback_binding_invalid'; end if;
 select e.* into proof from private.r05_readback_evidence e where e.business_id=b and e.provider=p->>'provider' and e.run_id=(p->>'runId')::uuid and e.owner_id=(select owner_user_id from public.businesses where id=b) and e.valid_from<=clock_timestamp() and e.valid_until>clock_timestamp() and not exists(select 1 from private.r05_readback_revocations z where z.evidence_id=e.id) order by e.valid_from desc,e.id desc limit 1 for share;
 if proof.id is null or proof.request_hash is distinct from p->>'requestHash' or proof.connection_id::text is distinct from p->>'connectionId' or proof.connection_revision::text is distinct from p->>'connectionRevision' or proof.valid_from>clock_timestamp() or proof.valid_until<=clock_timestamp() or exists(select 1 from private.r05_readback_revocations where evidence_id=proof.id) then return 'readback_eligibility_unavailable'; end if;
 if proof.provider='printful' then
 select * into pf from private.printful_product_runs where id=proof.run_id and business_id=b for share;
 select request_hash,sent_at into marker_hash,marker_time from private.printful_product_operations where run_id=pf.id and business_id=b;
 if pf.id is null or pf.request_hash<>proof.request_hash or pf.connection_id<>proof.connection_id or pf.connection_revision<>proof.connection_revision then return 'readback_binding_changed'; end if;
 perform 1 from private.connected_accounts where id=proof.connection_id and business_id=b and owner_id=proof.owner_id and provider='printful' and connection_revision=proof.connection_revision and status='connected' and revoked_at is null for share;
 if not found then return 'readback_account_unavailable'; end if;
 root:='https://api.printful.com';
 endpoints:=array[root||'/stores/'||pf.store_id,root||'/files/'||(pf.source->>'printfulFileId'),root||'/store/products/@'||pf.identity];
 if pf.state->>'syncProductId' ~ '^[1-9][0-9]{0,15}$' then endpoints:=array_append(endpoints,root||'/store/products/'||(pf.state->>'syncProductId')); end if;
 else
 select * into et from private.etsy_publication_runs where id=proof.run_id and business_id=b for share;
 select request_hash,sent_at into marker_hash,marker_time from private.etsy_publication_operations where publication_run_id=et.id and business_id=b;
 if et.id is null or et.request_hash<>proof.request_hash or et.connection_id<>proof.connection_id or et.connection_revision<>proof.connection_revision then return 'readback_binding_changed'; end if;
 perform 1 from private.etsy_connections where id=proof.connection_id and business_id=b and owner_id=proof.owner_id and revision=proof.connection_revision and status='connected' and revoked_at is null for share;
 if not found then return 'readback_account_unavailable'; end if;
 root:='https://api.etsy.com/v3/application';shop:=root||'/shops/'||et.shop_id;listing:=root||'/listings/'||et.listing_id;
 endpoints:=array[shop,listing,listing||'/inventory',listing||'/images',shop||'/listings/'||et.listing_id||'/properties',shop||'/shipping-profiles/'||(et.package->>'shippingProfileId'),shop||'/policies/return/'||(et.preflight->>'returnPolicyId'),shop||'/readiness-state-definitions/'||(et.package->>'readinessStateId')];
 end if;
 if marker_hash is distinct from proof.request_hash or marker_time is null or marker_time is distinct from (p->>'sentAt')::timestamptz then return 'existing_effect_marker_required'; end if;
 if not coalesce((p->>'endpoint')=any(endpoints),false) then return 'readback_endpoint_denied'; end if;
 return null;
end $$;

create function public.r05_admission_server(p_business_id uuid,p_operation text,p_payload jsonb,p_server_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.r05_requests; w public.workflow_runs; p private.r05_policies; saved jsonb; h text; sk text; source record; reason text; goal uuid; rh text; actual bigint; old private.r05_settlements; k text; begin
 if length(p_server_key) not between 32 and 200 or p_server_key is null then raise exception 'r05_server_authority_required' using errcode='42501'; end if;
 perform 1 from public.businesses where id=p_business_id for update;
 if not found then raise exception 'r05_business_unavailable'; end if;
 perform 1 from private.r05_server_keys k where key_hash=encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex') and expires_at>clock_timestamp() and not exists(select 1 from private.r05_server_revocations z where z.key_hash=k.key_hash) for share;
 if not found then raise exception 'r05_server_authority_required' using errcode='42501'; end if;
 if p_operation='legacy_settle' then return private.r05_legacy_settle(p_business_id,p_payload); end if;
 if p_operation='existing_effect_read' then
 reason:=private.r05_existing_effect_read(p_business_id,p_payload);
 return private.r05_result(p_business_id,null,case when reason is null then 'allowed' else 'blocked' end,coalesce(reason,'existing_effect_read_allowed'))||jsonb_build_object('shouldRead',reason is null);
 end if;
 -- Runtime capability is validated and discarded; it is never stored or echoed.
 if p_operation in ('prepare','guard') then
 perform private.r04_keys(p_payload,array['workflowRunId','runtimeCapability','operationKey','requestHash','idempotencyKey','providerModelId','wireRequestHash','wireRequestBytes','maximumOutputTokens','accounting','sourceDomains','dataClasses','accountId','accountRevision','currency','liabilityMicrounits']);
 saved:=p_payload-'runtimeCapability'; perform private.r04_safe(saved);
 foreach k in array array['workflowRunId','operationKey','requestHash','idempotencyKey','providerModelId','wireRequestHash','currency'] loop if jsonb_typeof(saved->k) is distinct from 'string' then raise exception 'r05_invalid_dispatch_type'; end if; end loop;
 if jsonb_typeof(saved->'wireRequestBytes') is distinct from 'number' or (saved->>'wireRequestBytes') !~ '^[1-9][0-9]{0,6}$' or jsonb_typeof(saved->'maximumOutputTokens') is distinct from 'number' then raise exception 'r05_invalid_dispatch_type'; end if;
 if saved->>'requestHash' !~ '^[a-f0-9]{64}$' or saved->>'wireRequestHash' !~ '^[a-f0-9]{64}$' or length(saved->>'idempotencyKey') not between 1 and 200 or (saved->>'maximumOutputTokens') !~ '^[1-9][0-9]{0,6}$' or saved->>'currency' is distinct from 'USD' or private.r05_money(saved->'liabilityMicrounits')=0 then raise exception 'r05_invalid_dispatch'; end if;
 perform private.r04_strings(saved->'sourceDomains',32); perform private.r04_strings(saved->'dataClasses',32);
 select * into w from public.workflow_runs where id=(saved->>'workflowRunId')::uuid and business_id=p_business_id;
 rh:=encode(extensions.digest(convert_to(p_payload->>'runtimeCapability','UTF8'),'sha256'),'hex');
 if w.id is null or rh is null or not coalesce((w.runtime_capability_hash=rh
 or exists(select 1 from public.creative_runs cr join private.creative_run_capabilities c on c.creative_run_id=cr.id where cr.workflow_run_id=w.id and cr.business_id=p_business_id and c.capability_hash=rh and cr.capability_expires_at>clock_timestamp())
 or exists(select 1 from public.listing_runs lr join private.listing_run_capabilities c on c.listing_run_id=lr.id where lr.workflow_run_id=w.id and lr.business_id=p_business_id and c.capability_hash=rh and lr.capability_expires_at>clock_timestamp())
 or exists(select 1 from private.listing_qualification_runs lr where lr.workflow_run_id=w.id and lr.business_id=p_business_id and lr.capability_hash=rh and lr.expires_at>clock_timestamp())),false) then raise exception 'r05_runtime_authority_required' using errcode='42501'; end if;
 h:=private.r04_hash(saved);
 select * into r from private.r05_requests where business_id=p_business_id and idempotency_key=saved->>'idempotencyKey';
 if r.id is not null then
 if r.request_hash<>h then raise exception 'r05_idempotency_conflict'; end if;
 else
 goal:=w.goal_id;
 if goal is null then select goal_id into goal from private.r04_research_links where business_id=p_business_id and workflow_run_id=w.id order by experiment_id limit 1; end if;
 select q.* into p from private.r05_policies q join private.r05_confirmations c on c.policy_id=q.id where q.business_id=p_business_id and q.goal_id=goal and exists(select 1 from jsonb_array_elements(q.payload->'operations') x where x->>'operationKey'=saved->>'operationKey') and not exists(select 1 from private.r05_revocations z where z.policy_id=q.id) order by c.created_at desc,q.id desc limit 1;
 if saved->'accounting'->>'kind'='r05' then
 perform private.r04_keys(saved->'accounting',array['kind']); sk:='r05:'||w.id||':'||(saved->>'idempotencyKey');
 elsif saved->'accounting'->>'kind'='research' then
 perform private.r04_keys(saved->'accounting',array['kind','callKey']);
 select 'research:'||id into sk from public.product_research_cost_reservations where business_id=p_business_id and workflow_run_id=w.id and attempt_key=saved->'accounting'->>'callKey';
 elsif saved->'accounting'->>'kind' in ('creative','listing','listing_qualification') then
 perform private.r04_keys(saved->'accounting',array['kind','runId','callKey']);
 sk:=(saved->'accounting'->>'kind')||':'||(saved->'accounting'->>'runId')||':'||(saved->'accounting'->>'callKey');
 else return private.r05_result(p_business_id,null,'blocked','unsupported_accounting_source'); end if;
 if saved->'accounting'->>'kind'<>'r05' then
 select * into source from private.r05_legacy_exposure(p_business_id) e where e.source_key=sk;
 if source.source_key is null or source.has_settlement or source.created_at<(select valid_from from private.r05_operations where operation_key=saved->>'operationKey') or source.workflow_id<>w.id or source.request_hash is distinct from saved->>'requestHash' or source.currency<>saved->>'currency' or source.held<>private.r05_money(saved->'liabilityMicrounits') or not source.unknown or source.receipt is not null or (source.model is not null and source.model<>saved->>'providerModelId') then return private.r05_result(p_business_id,null,'blocked','accounting_source_mismatch'); end if;
 end if;
 if exists(select 1 from private.r05_requests where business_id=p_business_id and source_key=sk) then return private.r05_result(p_business_id,null,'blocked','source_already_bound'); end if;
 insert into private.r05_requests(business_id,workflow_run_id,policy_id,idempotency_key,request_hash,payload,source_key,currency,liability_microunits) values(p_business_id,w.id,p.id,saved->>'idempotencyKey',h,saved,sk,saved->>'currency',private.r05_money(saved->'liabilityMicrounits')) returning * into r;
 end if;
 if p_operation='prepare' then return private.r05_result(p_business_id,r.id,'allowed','prepared'); end if;
 elsif p_operation in ('reserve','dispatch','release_unsent','settle','readback') then
 perform private.r04_safe(p_payload);
 select * into r from private.r05_requests where id=(p_payload->>'requestId')::uuid and business_id=p_business_id;
 if r.id is null then raise exception 'r05_request_unavailable'; end if;
 else raise exception 'r05_unknown_operation'; end if;
 if p_operation in ('reserve','dispatch','guard') then
 if exists(select 1 from private.r05_markers where request_id=r.id) then return private.r05_result(p_business_id,r.id,'blocked','already_marked'); end if;
 reason:=private.r05_admissible(r);
 if reason is not null then return private.r05_result(p_business_id,r.id,case when reason='confirmed_operating_policy_required' then 'needs_owner' else 'blocked' end,reason); end if;
 insert into private.r05_reservations(request_id,business_id) values(r.id,p_business_id) on conflict do nothing;
 if p_operation<>'reserve' then insert into private.r05_markers(request_id,business_id) values(r.id,p_business_id); end if;
 return private.r05_result(p_business_id,r.id,'allowed',case when p_operation='reserve' then 'reserved' else 'marked' end,p_operation<>'reserve');
 elsif p_operation='release_unsent' then
 perform private.r04_keys(p_payload,array['requestId','evidenceHash']);
 if exists(select 1 from private.r05_markers where request_id=r.id) then return private.r05_result(p_business_id,r.id,'blocked','marked_liability_cannot_release'); end if;
 -- A trusted caller supplies exact absence evidence; neither owners nor workers can invoke this authority.
 if exists(select 1 from private.r05_legacy_exposure(p_business_id) e where e.source_key=r.source_key and (e.has_settlement or not e.unknown or e.receipt is not null)) then return private.r05_result(p_business_id,r.id,'blocked','legacy_effect_evidence_exists'); end if;
 insert into private.r05_releases(request_id,business_id,evidence_hash) values(r.id,p_business_id,p_payload->>'evidenceHash') on conflict do nothing;
 return private.r05_result(p_business_id,r.id,'allowed','released_unsent');
 elsif p_operation in ('settle','readback') then
 perform private.r04_keys(p_payload,array['requestId','currency','actualMicrounits','providerRequestId','receiptHash']);
 if r.payload->'accounting'->>'kind'<>'r05' then return private.r05_result(p_business_id,r.id,'blocked','settle_original_ledger'); end if;
 if not exists(select 1 from private.r05_markers where request_id=r.id) or p_payload->>'currency' is distinct from r.currency or length(p_payload->>'providerRequestId') not between 1 and 300 then raise exception 'r05_invalid_settlement'; end if;
 actual:=case when p_payload->'actualMicrounits'='null'::jsonb then null else private.r05_money(p_payload->'actualMicrounits') end;
 select * into old from private.r05_settlements where request_id=r.id and receipt_hash=p_payload->>'receiptHash';
 if old.request_id is not null then
 if old.currency is distinct from p_payload->>'currency' or old.actual_microunits is distinct from actual or old.provider_request_id is distinct from p_payload->>'providerRequestId' or old.receipt_hash is distinct from p_payload->>'receiptHash' then raise exception 'r05_settlement_conflict'; end if;
 else
 perform private.r05_claim_receipt(p_business_id,r.workflow_run_id,r.source_key,p_payload->>'providerRequestId');
 if exists(select 1 from private.r05_settlements where provider_request_id=p_payload->>'providerRequestId' and request_id<>r.id) or exists(select 1 from private.r05_settlements where request_id=r.id and provider_request_id<>p_payload->>'providerRequestId') or exists(select 1 from private.r05_legacy_exposure(p_business_id) where receipt=p_payload->>'providerRequestId') then raise exception 'r05_receipt_already_used'; end if;
 insert into private.r05_settlements(request_id,business_id,currency,actual_microunits,provider_request_id,receipt_hash) values(r.id,p_business_id,r.currency,actual,p_payload->>'providerRequestId',p_payload->>'receiptHash');
 end if;
 return private.r05_result(p_business_id,r.id,'allowed',case when actual is null then 'unknown_retained' else 'settled' end);
 end if;
 raise exception 'r05_unknown_operation';
end $$;

create function public.r05_admission_read(p_business_id uuid,p_policy_id uuid default null,p_limit integer default 20,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$ declare result jsonb; begin
 if auth.uid() is null or not exists(select 1 from public.businesses where id=p_business_id and owner_user_id=auth.uid()) then raise exception 'r05_owner_required' using errcode='42501'; end if;
 if p_limit is null or p_offset is null or p_limit not between 1 and 50 or p_offset not between 0 and 10000 then raise exception 'r05_invalid_page'; end if;
 if p_policy_id is not null and not exists(select 1 from private.r05_policies where id=p_policy_id and business_id=p_business_id) then raise exception 'r05_policy_unavailable'; end if;
 result:=jsonb_build_object('authorityRootId',p_business_id,'financialMode','bounded_model_cost_only','serverAuthorityConfigured',exists(select 1 from private.r05_server_keys k where expires_at>clock_timestamp() and not exists(select 1 from private.r05_server_revocations z where z.key_hash=k.key_hash)),
 'unavailableReason',case when not exists(select 1 from private.r05_operations o join public.installed_packs i on i.root_pack_id=o.pack_id where i.business_id=p_business_id and i.status='active' and o.valid_from<=clock_timestamp() and o.valid_until>clock_timestamp() and not exists(select 1 from private.r05_operation_revocations z where z.operation_key=o.operation_key)) then 'No qualified operation is installed. Commerce, FX, recurring commitments, loss and margin controls remain unsupported.' else null end,
 'eligibleOperations',(select coalesce(jsonb_agg(x.item),'[]') from(select jsonb_build_object('operationKey',o.operation_key,'installationId',i.id,'workflowDefinitionId',o.workflow_definition_id,'purpose',o.purpose,'provider',o.provider,'category',o.category,'accountId',null,'accountRevision',null,'sourceDomains',o.source_domains,'dataClasses',o.data_classes,'maximumPerOperationMicrounits',o.liability_microunits::text,'providerModelId',o.provider_model_id,'maximumOutputTokens',o.maximum_output_tokens,'maximumRequestBytes',o.maximum_request_bytes,'validUntil',o.valid_until) item from private.r05_operations o join public.installed_packs i on i.root_pack_id=o.pack_id join public.packs pk on pk.id=o.pack_id where i.business_id=p_business_id and i.status='active' and pk.status<>'retired' and o.valid_from<=clock_timestamp() and o.valid_until>clock_timestamp() and not exists(select 1 from private.r05_operation_revocations z where z.operation_key=o.operation_key) order by o.operation_key limit 16) x),
 'capVersions',(select coalesce(jsonb_agg(x.item),'[]') from(select distinct on(currency) jsonb_build_object('currency',currency,'revision',revision,'maximumMicrounits',maximum_microunits::text) item from private.r05_cap_versions where business_id=p_business_id order by currency,revision desc) x),
 'pauseStates',(select coalesce(jsonb_agg(x.item),'[]') from(select distinct on(kind,target_id) jsonb_build_object('kind',kind,'id',target_id,'paused',paused) item from private.r05_pause_events where business_id=p_business_id order by kind,target_id,id desc limit 50) x),
 'pauseStatesComplete',(select count(*)<=50 from(select distinct kind,target_id from private.r05_pause_events where business_id=p_business_id) scopes),
 'policies',(select coalesce(jsonb_agg(x.item),'[]') from(select jsonb_build_object('id',p.id,'hash',p.content_hash,'policy',p.payload,'confirmed',exists(select 1 from private.r05_confirmations where policy_id=p.id),'revoked',exists(select 1 from private.r05_revocations where policy_id=p.id)) item from private.r05_policies p where p.business_id=p_business_id and (p_policy_id is null or p.id=p_policy_id) order by p.created_at desc,p.id desc limit p_limit offset p_offset) x),
 'exposure',(select coalesce(jsonb_agg(x.item),'[]') from(select jsonb_build_object('currency',currency,'category','model','heldMicrounits',sum(held)::text,'hasUnknown',bool_or(unknown)) item from private.r05_exposure(p_business_id) group by currency) x),
 'decisions',(select coalesce(jsonb_agg(x.item),'[]') from(select jsonb_build_object('requestId',request_id,'decision',decision,'reason',reason,'at',created_at) item from private.r05_decisions where business_id=p_business_id order by id desc limit p_limit offset p_offset) x),
 'policyTotal',(select count(*) from private.r05_policies where business_id=p_business_id and (p_policy_id is null or id=p_policy_id)),
 'decisionTotal',(select count(*) from private.r05_decisions where business_id=p_business_id),
 'limit',p_limit,'offset',p_offset,'businessPaused',private.r05_paused(p_business_id,'business',p_business_id));
 if octet_length(result::text)>262144 then raise exception 'r05_read_too_large_reduce_page'; end if;
 return result;
end $$;

-- Reservation writes in every legacy lane acquire the same Business lock. Known settlements
-- are recorded even above a cap; only new reservation is denied. Original guards remain.
create function private.r05_registry_revoke_lock() returns trigger language plpgsql set search_path='' as $$ begin
 if tg_table_name='r05_operation_revocations' then perform 1 from private.r05_operations where operation_key=new.operation_key for update;
 elsif tg_table_name='r05_readback_revocations' then perform 1 from private.r05_readback_evidence where id=new.evidence_id for update;
 else perform 1 from private.r05_server_keys where key_hash=new.key_hash for update; end if;
 return new;
end $$;
create trigger r05_revoke_lock before insert on private.r05_operation_revocations for each row execute function private.r05_registry_revoke_lock();
create trigger r05_revoke_lock before insert on private.r05_server_revocations for each row execute function private.r05_registry_revoke_lock();
create trigger r05_revoke_lock before insert on private.r05_readback_revocations for each row execute function private.r05_registry_revoke_lock();
create function private.r05_legacy_financial_lock() returns trigger language plpgsql security definer set search_path='' as $$
declare b uuid; cap bigint; exposure numeric; j jsonb; source_identity text; wf uuid; amount bigint; receipt_id text; begin
 j:=to_jsonb(new); b:=(j->>'business_id')::uuid;
 if b is null and j ? 'run_id' then select business_id into b from private.listing_qualification_runs where id=(j->>'run_id')::uuid; end if;
 perform 1 from public.businesses where id=b for update;
 if tg_table_name in ('product_research_cost_settlements','creative_cost_settlements','listing_cost_settlements','listing_qualification_settlements','model_invocations') then
 if tg_table_name='product_research_cost_settlements' then source_identity:='research:'||(j->>'reservation_id');
 elsif tg_table_name='creative_cost_settlements' then source_identity:='creative:'||(j->>'creative_run_id')||':'||(j->>'call_key');
 elsif tg_table_name='listing_cost_settlements' then source_identity:='listing:'||(j->>'listing_run_id')||':'||(j->>'role');
 elsif tg_table_name='listing_qualification_settlements' then source_identity:='listing_qualification:'||(j->>'run_id')||':'||(j->>'case_key');
 else source_identity:=private.r05_model_source(b,(j->>'id')::uuid); end if;
 receipt_id:=j->>'provider_request_id';
 if tg_table_name='model_invocations' then wf:=(j->>'workflow_run_id')::uuid;
 else select workflow_id into wf from private.r05_legacy_exposure(b) where source_key=source_identity; end if;
 if receipt_id is not null and (tg_table_name<>'model_invocations' or j->>'provider'='openrouter') then perform private.r05_claim_receipt(b,wf,source_identity,receipt_id); end if;
 if exists(select 1 from private.r05_cap_versions where business_id=b) then
 if tg_table_name='model_invocations' then
 amount:=ceil((j->>'reported_cost_usd')::numeric*1000000)::bigint;wf:=(j->>'workflow_run_id')::uuid;
 if amount is not null and receipt_id is not null and not exists(select 1 from private.r05_legacy_attestations a where a.business_id=b and a.workflow_run_id=wf and a.provider_request_id=receipt_id and a.reported_microusd=amount) then raise exception 'r05_trusted_settlement_required'; end if;
 else
 amount:=(j->>'reported_microusd')::bigint;
 if not exists(select 1 from private.r05_legacy_attestations a where a.business_id=b and a.source_key=source_identity and a.provider_request_id is not distinct from receipt_id and a.reported_microusd is not distinct from amount) then raise exception 'r05_trusted_settlement_required'; end if;
 end if;
 end if;
 end if;
 if tg_table_name in ('product_research_cost_reservations','creative_cost_reservations','listing_cost_reservations','listing_qualification_reservations') or (tg_table_name='model_invocations' and tg_op='INSERT') then
 select maximum_microunits into cap from private.r05_cap_versions where business_id=b and currency='USD' order by revision desc limit 1;
 if cap is not null then
 select coalesce(sum(held),0) into exposure from private.r05_exposure(b) where currency='USD';
 if exposure>cap then raise exception 'r05_business_cap_exceeded'; end if;
 end if;
 end if;
 return new;
end $$;
do $$ declare t text; begin
 foreach t in array array['product_research_cost_reservations','product_research_cost_settlements','creative_cost_reservations','creative_cost_settlements','listing_cost_reservations','listing_cost_settlements','model_invocations'] loop
 execute format('create trigger r05_financial_lock after insert or update on public.%I for each row execute function private.r05_legacy_financial_lock()',t);
 end loop;
 foreach t in array array['listing_qualification_reservations','listing_qualification_settlements'] loop
 execute format('create trigger r05_financial_lock after insert or update on private.%I for each row execute function private.r05_legacy_financial_lock()',t);
 end loop;
end $$;
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'r05_%' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature); end loop;
end $$;
revoke all on function public.r05_policy_owner(uuid,text,jsonb,uuid),public.r05_admission_read(uuid,uuid,integer,integer),public.r05_admission_server(uuid,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.r05_policy_owner(uuid,text,jsonb,uuid),public.r05_admission_read(uuid,uuid,integer,integer) to authenticated;
grant execute on function public.r05_admission_server(uuid,text,jsonb,text) to anon;
commit;
