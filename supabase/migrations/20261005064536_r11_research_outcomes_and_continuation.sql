-- R11 repair definitions only. No diagnostic, grant, key, registry row, owner
-- confirmation or provider call is seeded. Applied R11/R05 history is retained.
begin;
-- The only R05 schema extension: exact per-attempt research keys. The original
-- eight labels remain valid; every R05 function and ACL remains unchanged.
alter table private.r05_operations drop constraint r05_operations_operation_key_check;
alter table private.r05_operations add constraint r05_operations_operation_key_v2_check check (
 operation_key in ('research.search','research.model','creative.text','creative.image','listing.specialist','listing.reviewer','listing.qualification','browser.planner')
 or operation_key ~ '^research\.(search|model)\.r11v2\.[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
);
create table private.r11_research_outcomes(
 id uuid primary key default gen_random_uuid(),business_id uuid not null,policy_id uuid not null,workflow_run_id uuid not null,
 kind text not null check(kind in ('failure','owner_stopped')),phase text not null check(phase in ('none','search','select')),request_id uuid,
 reason text not null check(reason in ('provider_response_invalid','response_model_unqualified','response_provider_unqualified','source_contract_invalid','collection_persistence_failed','selector_output_invalid','result_persistence_failed','cost_unverified_or_over_cap','internal_failure','legacy_failure_undetermined','owner_stopped')),
 observation jsonb,facts jsonb not null,actor_id uuid references auth.users(id),producer_key_hash text references private.r05_server_keys(key_hash),
 created_at timestamptz not null default clock_timestamp(),unique(policy_id,kind),
 foreign key(policy_id,business_id) references private.r11_research_policies(id,business_id),
 foreign key(workflow_run_id,business_id) references public.workflow_runs(id,business_id),
 foreign key(request_id,business_id) references private.r05_requests(id,business_id),
 check((phase='none' and request_id is null) or phase in ('search','select')),
 check((kind='owner_stopped' and reason='owner_stopped' and observation is null) or (kind='failure' and reason<>'owner_stopped')),
 check((observation is null or jsonb_typeof(observation)='object') and octet_length(coalesce(observation::text,''))<=8192 and octet_length(facts::text)<=4096)
);
create table private.r11_research_continuation_grants(
 id uuid primary key,business_id uuid not null references public.businesses(id),owner_id uuid not null references auth.users(id),
 grant_json jsonb not null,grant_canonical text not null,grant_hash text not null check(grant_hash ~ '^[a-f0-9]{64}$'),created_at timestamptz not null default clock_timestamp(),
 check(octet_length(grant_canonical)<=65536 and grant_canonical=private.stage14_canonical(grant_json) and grant_hash=private.stage14_hash(grant_json))
);
create table private.r11_research_continuation_revocations(
 grant_id uuid primary key references private.r11_research_continuation_grants(id),created_at timestamptz not null default clock_timestamp()
);
create table private.r11_research_attempts(
 policy_id uuid primary key,business_id uuid not null,predecessor_policy_id uuid not null unique,grant_id uuid not null unique references private.r11_research_continuation_grants(id),
 search_operation_key text not null unique references private.r05_operations(operation_key),selector_operation_key text not null unique references private.r05_operations(operation_key),
 actor_id uuid not null references auth.users(id),grant_hash text not null,created_at timestamptz not null default clock_timestamp(),
 foreign key(policy_id,business_id) references private.r11_research_policies(id,business_id),
 foreign key(predecessor_policy_id,business_id) references private.r11_research_policies(id,business_id),
 check(search_operation_key='research.search.r11v2.'||policy_id::text and selector_operation_key='research.model.r11v2.'||policy_id::text)
);
do $$ declare t text;begin
 foreach t in array array['r11_research_outcomes','r11_research_continuation_grants','r11_research_continuation_revocations','r11_research_attempts'] loop
 execute format('alter table private.%I enable row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger r11_research_guard before insert or update or delete on private.%I for each row execute function private.r11_research_history_guard()',t);
 end loop;
end $$;
create function private.r11_research_operation_keys(pid uuid) returns jsonb language sql stable set search_path='' as $$
 select coalesce((select jsonb_build_object('search',search_operation_key,'select',selector_operation_key) from private.r11_research_attempts where policy_id=pid),'{"search":"research.search","select":"research.model"}'::jsonb)
$$;
create function private.r11_research_observation_validate(p private.r11_research_policies,o jsonb) returns void language plpgsql set search_path='' as $$
declare k text;d jsonb;i integer:=0;total integer:=0;begin
 if o is null or o='null'::jsonb then return;end if;
 perform private.r04_keys(o,array['modelIdentity','observedModelId','providerIdentity','observedProvider','finishReason','searchRequests','annotationCount','approvedDomainCounts','rejectedDomainCount','malformedAnnotationCount','providerError']);
 if octet_length(o::text)>8192 then raise exception 'r11_research_observation_invalid';end if;
 if o->>'modelIdentity' not in ('request_alias','canonical','other','missing','invalid') or o->>'providerIdentity' not in ('exact','other','missing','invalid') or o->>'finishReason' not in ('stop','length','content_filter','tool_calls','error','other','missing') then raise exception 'r11_research_observation_invalid';end if;
 foreach k in array array['modelIdentity','providerIdentity','finishReason'] loop if jsonb_typeof(o->k) is distinct from 'string' then raise exception 'r11_research_observation_invalid';end if;end loop;
 if (o->>'modelIdentity'='request_alias' and o->>'observedModelId' is distinct from p.policy->>'modelId') or (o->>'modelIdentity'='canonical' and (p.policy->>'modelId' is distinct from 'openai/gpt-5.6-luna' or o->>'observedModelId' is distinct from 'openai/gpt-5.6-luna-20260709')) or (o->>'modelIdentity' in ('other','missing','invalid') and o->'observedModelId' is distinct from 'null'::jsonb) then raise exception 'r11_research_observation_identity';end if;
 if (o->>'providerIdentity'='exact' and (p.policy->>'providerEndpoint' is distinct from 'azure/us' or o->>'observedProvider' is distinct from 'Azure')) or (o->>'providerIdentity'<>'exact' and o->'observedProvider' is distinct from 'null'::jsonb) then raise exception 'r11_research_observation_identity';end if;
 foreach k in array array['searchRequests','annotationCount','rejectedDomainCount','malformedAnnotationCount'] loop
 if k in ('searchRequests','annotationCount') and o->k='null'::jsonb then continue;end if;
 if jsonb_typeof(o->k) is distinct from 'number' or o->>k !~ '^(0|[1-9][0-9]{0,2}|1000)$' then raise exception 'r11_research_observation_count';end if;
 end loop;
 if jsonb_typeof(o->'approvedDomainCounts') is distinct from 'array' or jsonb_array_length(o->'approvedDomainCounts')<>jsonb_array_length(p.policy->'allowedDomains') then raise exception 'r11_research_observation_domains';end if;
 for d in select value from jsonb_array_elements(o->'approvedDomainCounts') loop
 perform private.r04_keys(d,array['domain','count']);
 if d->'domain' is distinct from p.policy->'allowedDomains'->i or jsonb_typeof(d->'count') is distinct from 'number' or d->>'count' !~ '^(0|[1-9][0-9]{0,2}|1000)$' then raise exception 'r11_research_observation_domains';end if;total:=total+(d->>'count')::integer;i:=i+1;end loop;
 total:=total+(o->>'rejectedDomainCount')::integer+(o->>'malformedAnnotationCount')::integer;
 if total>1000 or (o->'annotationCount'<>'null'::jsonb and total<>(o->>'annotationCount')::integer) then raise exception 'r11_research_observation_count';end if;
 if o->'providerError'<>'null'::jsonb and (jsonb_typeof(o->'providerError') is distinct from 'string' or o->>'providerError' not in ('configuration_required','authentication_required','rate_limited','provider_timeout','provider_unavailable','provider_rejected','malformed_model_output','tool_qualification_failed')) then raise exception 'r11_research_observation_provider_error';end if;
end $$;
create function private.r11_research_outcome_write(p private.r11_research_policies,event_kind text,event_phase text,rid uuid,event_reason text,observed jsonb,actor uuid,key_hash text) returns jsonb language plpgsql set search_path='' as $$
declare old private.r11_research_outcomes;w public.workflow_runs;f jsonb;begin
 select * into w from public.workflow_runs where id=p.workflow_run_id and business_id=p.business_id and goal_id=p.goal_id for update;
 if w.id is null then raise exception 'r11_research_outcome_workflow';end if;
 -- A lost collect/complete reply must not revoke a phase that has already
 -- progressed durably, including a selector owned by a different invocation.
 if event_kind='failure' and ((event_phase='search' and exists(select 1 from private.r11_research_collections where policy_id=p.id)) or exists(select 1 from private.r11_research_results where policy_id=p.id)) then return jsonb_build_object('outcomeId',null,'recorded',false,'replayed',false,'superseded',true,'reason','phase_progressed','workflowStatus',w.status);end if;
 select * into old from private.r11_research_outcomes where policy_id=p.id and kind=event_kind;
 if old.id is not null then
 if old.phase is distinct from event_phase or old.request_id is distinct from rid or old.reason is distinct from event_reason or old.observation is distinct from nullif(observed,'null'::jsonb) then raise exception 'r11_research_outcome_conflict';end if;
 return jsonb_build_object('outcomeId',old.id,'recorded',true,'replayed',true,'workflowStatus',w.status);end if;
 f:=jsonb_build_object('searchMarked',(select count(*) from private.r11_research_bindings v join private.r05_markers m on m.request_id=v.request_id where v.policy_id=p.id and v.phase='search'),'selectorMarked',(select count(*) from private.r11_research_bindings v join private.r05_markers m on m.request_id=v.request_id where v.policy_id=p.id and v.phase='select'),'searchActualMicrounits',(select max(z.actual_microunits)::text from private.r11_research_bindings v join private.r05_settlements z on z.request_id=v.request_id where v.policy_id=p.id and v.phase='search'),'collections',(select count(*) from private.r11_research_collections where policy_id=p.id),'results',(select count(*) from private.r11_research_results where policy_id=p.id));
 insert into private.r11_research_outcomes(business_id,policy_id,workflow_run_id,kind,phase,request_id,reason,observation,facts,actor_id,producer_key_hash)
 values(p.business_id,p.id,p.workflow_run_id,event_kind,event_phase,rid,event_reason,nullif(observed,'null'::jsonb),f,actor,key_hash) returning * into old;
 insert into private.r11_research_revocations(policy_id) values(p.id) on conflict do nothing;
 update public.workflow_runs set status=case when event_kind='owner_stopped' then 'cancelled' else 'needs_owner' end,updated_at=clock_timestamp()
 where id=p.workflow_run_id and business_id=p.business_id and goal_id=p.goal_id and status in ('queued','running','waiting','review','needs_owner') and not exists(select 1 from private.r11_research_results where policy_id=p.id);
 select status into w.status from public.workflow_runs where id=p.workflow_run_id;
 return jsonb_build_object('outcomeId',old.id,'recorded',true,'replayed',false,'workflowStatus',w.status);
end $$;
create function public.r11_research_server_v2(p_business_id uuid,p_operation text,p_payload jsonb,p_server_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.r11_research_policies;key_hash text;result jsonb;rid uuid;phase_name text;begin
 if p_operation in ('load','guard','collect','complete') then
 result:=public.r11_research_server(p_business_id,p_operation,p_payload,p_server_key);
 if p_operation='load' then result:=result||jsonb_build_object('operationKeys',private.r11_research_operation_keys((p_payload->>'policyId')::uuid),'attemptVersion',case when exists(select 1 from private.r11_research_attempts where policy_id=(p_payload->>'policyId')::uuid) then 2 else 1 end);end if;
 return result;end if;
 if p_operation is distinct from 'fail' then raise exception 'r11_research_operation_unavailable';end if;
 if p_server_key is null or length(p_server_key) not between 32 and 200 then raise exception 'r11_research_authority_required' using errcode='42501';end if;
 perform private.r04_keys(p_payload,array['policyId','phase','requestId','reason','observation']);
 if octet_length(p_payload::text)>12288 or jsonb_typeof(p_payload->'policyId') is distinct from 'string' or p_payload->>'policyId' !~ '^[a-f0-9-]{36}$' or jsonb_typeof(p_payload->'phase') is distinct from 'string' or p_payload->>'phase' not in ('none','search','select') or jsonb_typeof(p_payload->'reason') is distinct from 'string' or p_payload->>'reason' not in ('provider_response_invalid','response_model_unqualified','response_provider_unqualified','source_contract_invalid','collection_persistence_failed','selector_output_invalid','result_persistence_failed','cost_unverified_or_over_cap','internal_failure') then raise exception 'r11_research_outcome_invalid';end if;
 perform 1 from public.businesses where id=p_business_id for update;
 select * into p from private.r11_research_policies where id=(p_payload->>'policyId')::uuid and business_id=p_business_id for share;
 if p.id is null or not exists(select 1 from public.businesses where id=p_business_id and owner_user_id=p.owner_id) then raise exception 'r11_research_outcome_scope';end if;
 key_hash:=encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex');perform private.r11_research_key(key_hash);
 if p.authority_key_hash is not null and p.authority_key_hash<>key_hash then raise exception 'r11_research_authority_required' using errcode='42501';end if;
 phase_name:=p_payload->>'phase';
 if phase_name='none' and exists(select 1 from private.r11_research_bindings where policy_id=p.id) then raise exception 'r11_research_outcome_phase';end if;
 select request_id into rid from private.r11_research_bindings where policy_id=p.id and phase=phase_name;
 if (p_payload->'requestId'='null'::jsonb and rid is not null) or (p_payload->'requestId'<>'null'::jsonb and (jsonb_typeof(p_payload->'requestId') is distinct from 'string' or p_payload->>'requestId' is distinct from rid::text)) then raise exception 'r11_research_outcome_request';end if;
 if rid is not null and not exists(select 1 from private.r11_research_bindings where request_id=rid and admission_key_hash=key_hash) then raise exception 'r11_research_outcome_key';end if;
 perform private.r11_research_observation_validate(p,p_payload->'observation');
 result:=private.r11_research_outcome_write(p,'failure',phase_name,rid,p_payload->>'reason',p_payload->'observation',null,key_hash);
 -- Projection may wait on workflow locks; expiry after the wait rolls back all.
 perform private.r11_research_key(key_hash);return result;
end $$;
create function public.r11_research_stop_v2(p_business_id uuid,p_policy_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.r11_research_policies;session_id uuid:=private.r11_auth_session();result jsonb;rid uuid;prior_stop boolean;begin
 perform private.r05_owner(p_business_id);perform 1 from auth.sessions where id=session_id and user_id=auth.uid() for share;
 if not private.r11_session(auth.uid(),session_id) then raise exception 'r11_research_owner_session_required' using errcode='42501';end if;
 select * into p from private.r11_research_policies where id=p_policy_id and business_id=p_business_id for update;
 if p.id is null then raise exception 'r11_research_policy_unavailable';end if;
 prior_stop:=exists(select 1 from private.r11_research_revocations where policy_id=p.id);
 -- Retrospective diagnosis is deliberately limited to recorded facts. A prior
 -- expired stopped search with no retained result has an undetermined cause.
 if prior_stop and clock_timestamp()>=(p.policy->>'validUntil')::timestamptz and not exists(select 1 from private.r11_research_results where policy_id=p.id) and not exists(select 1 from private.r11_research_outcomes where policy_id=p.id and kind='failure') and not exists(select 1 from private.r11_research_collections where policy_id=p.id) and not exists(select 1 from private.r11_research_bindings where policy_id=p.id and phase='select') then
 select v.request_id into rid from private.r11_research_bindings v join private.r05_markers m on m.request_id=v.request_id where v.policy_id=p.id and v.phase='search' and exists(select 1 from private.r05_settlements z where z.request_id=v.request_id and z.actual_microunits is not null);
 if rid is not null then perform private.r11_research_outcome_write(p,'failure','search',rid,'legacy_failure_undetermined',null,auth.uid(),null);end if;
 end if;
 result:=private.r11_research_outcome_write(p,'owner_stopped','none',null,'owner_stopped',null,auth.uid(),null);
 if not private.r11_session(auth.uid(),session_id) then raise exception 'r11_research_owner_session_required' using errcode='42501';end if;
 return result||jsonb_build_object('policyId',p.id,'revoked',true);
end $$;
create function private.r11_research_continuation_context(b uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare p private.r11_research_policies;bs private.r04_business_state;gs private.r04_goal_state;cap private.r05_cap_versions;total numeric;unknown_cost boolean;why text:='ready';owner_id uuid;ws text;begin
 select * into p from private.r11_research_policies where business_id=b order by created_at desc,id desc limit 1;
 if p.id is null then return null;end if;
 select owner_user_id into owner_id from public.businesses where id=b;
 select * into bs from private.r04_business_state where business_id=b;
 select * into gs from private.r04_goal_state where business_id=b and goal_id=p.goal_id;
 select * into cap from private.r05_cap_versions where business_id=b and currency='USD' order by revision desc limit 1;
 if bs.business_id is null or gs.goal_id is null or cap.business_id is null then return null;end if;
 select coalesce(sum(held) filter(where currency='USD'),0),coalesce(bool_or(unknown),false) into total,unknown_cost from private.r05_exposure(b);
 select status into ws from public.workflow_runs where id=p.workflow_run_id and business_id=b;
 if owner_id is distinct from p.owner_id then why:='owner_changed';
 elsif not exists(select 1 from private.r11_research_activations where policy_id=p.id) and not exists(select 1 from private.r11_research_attempts where policy_id=p.id) then why:='owner_activation_required';
 elsif exists(select 1 from private.r11_research_results where policy_id=p.id) then why:='result_exists';
 elsif not exists(select 1 from private.r11_research_revocations where policy_id=p.id) then why:='stop_required';
 elsif ws not in ('needs_owner','cancelled','failed') then why:='terminal_reconciliation_required';
 elsif bs.current_goal_id is distinct from p.goal_id then why:='current_goal_changed';
 elsif cap.policy_id is distinct from p.operating_policy_id then why:='financial_authority_changed';
 elsif unknown_cost then why:='unknown_exposure';
 elsif total>=cap.maximum_microunits then why:='no_remaining_budget';
 elsif exists(select 1 from private.r11_research_attempts where predecessor_policy_id=p.id) then why:='continuation_already_used';end if;
 return jsonb_build_object('predecessorPolicyId',p.id,'predecessorWorkflowRunId',p.workflow_run_id,'goalId',p.goal_id,'goalRevision',gs.revision,'businessRevision',bs.revision,'currentOperatingPolicyId',cap.policy_id,'capRevision',cap.revision,'lifetimeCapMicrounits',cap.maximum_microunits::text,'exposureMicrounits',total::text,'remainingMicrounits',greatest(cap.maximum_microunits-total,0)::text,'eligible',why='ready','reason',why);
end $$;
create function private.r11_research_continuation_validate() returns trigger language plpgsql set search_path='' as $$
declare g jsonb:=new.grant_json;c jsonb:=g->'continuation';p jsonb:=g->'researchPolicy';f jsonb:=g->'operatingPolicy';x jsonb;o private.r05_operations;k text;pid uuid;amount bigint;begin
 perform private.r04_keys(g,array['version','id','businessId','ownerId','policyId','workflowRunId','runtimeCapabilityHash','serverKeyHash','installationId','installationSnapshotHash','workflowDefinitionId','continuation','businessContent','goalContent','operatingPolicy','researchPolicy','search','interpretationHash','approvalHash']);
 if g->>'version' is distinct from 'r11.owner-continuation-grant.1' or g->>'id' is distinct from new.id::text or g->>'businessId' is distinct from new.business_id::text or g->>'ownerId' is distinct from new.owner_id::text then raise exception 'r11_research_continuation_binding';end if;
 foreach k in array array['runtimeCapabilityHash','serverKeyHash','installationSnapshotHash','interpretationHash','approvalHash'] loop if coalesce(g->>k,'') !~ '^[a-f0-9]{64}$' then raise exception 'r11_research_continuation_hash';end if;end loop;
 foreach k in array array['policyId','workflowRunId','installationId','workflowDefinitionId'] loop if jsonb_typeof(g->k) is distinct from 'string' or (g->>k)::uuid is null then raise exception 'r11_research_continuation_id';end if;end loop;pid:=(g->>'policyId')::uuid;
 perform private.r04_keys(c,array['predecessorPolicyId','predecessorWorkflowRunId','goalId','goalRevision','businessRevision','currentOperatingPolicyId','capRevision','lifetimeCapMicrounits','exposureMicrounits','remainingMicrounits','eligible','reason']);
 if c->'eligible' is distinct from 'true'::jsonb or c->>'reason' is distinct from 'ready' or c is distinct from private.r11_research_continuation_context(new.business_id) then raise exception 'r11_research_stale_continuation';end if;
 if not exists(select 1 from public.installed_packs where id=(g->>'installationId')::uuid and business_id=new.business_id and status='active' and private.r04_hash(snapshot)=g->>'installationSnapshotHash') then raise exception 'r11_research_installation_snapshot';end if;
 perform private.r04_business_content(g->'businessContent');perform private.r04_quest_content(g->'goalContent');perform private.r04_parsed(g->'goalContent'->'parsed',true);
 if g->'goalContent'->'ambiguities' is distinct from '[]'::jsonb then raise exception 'r11_research_continuation_intent';end if;
 perform private.r04_keys(f,array['version','goalRevision','businessRevision','currency','businessLifetimeLimitMicrounits','policyLimitMicrounits','categoryLimits','expectedCapRevision','expectedExposureMicrounits','startsAt','expiresAt','maximumDispatches','minimumIntervalSeconds','stopOnTarget','operations','financialMode']);
 amount:=private.r05_money(f->'policyLimitMicrounits');
 if f->'goalRevision' is distinct from to_jsonb((c->>'goalRevision')::integer+2) or f->'businessRevision' is distinct from to_jsonb((c->>'businessRevision')::integer+1) or f->'expectedCapRevision' is distinct from c->'capRevision' or f->'expectedExposureMicrounits' is distinct from c->'exposureMicrounits' or f->'businessLifetimeLimitMicrounits' is distinct from c->'lifetimeCapMicrounits' or f->'maximumDispatches' is distinct from '2'::jsonb or f->'minimumIntervalSeconds' is distinct from '0'::jsonb or amount not between 1 and 250000 or amount>private.r05_money(c->'remainingMicrounits') or p->'maximumMicrousd' is distinct from to_jsonb(amount) then raise exception 'r11_research_continuation_financial_scope';end if;
 if p ?| array['id','businessId','ownerId','workflowRunId','goalId','operatingPolicyId'] or p->>'approvalHash' is distinct from g->>'approvalHash' or jsonb_typeof(p->'validFrom') is distinct from 'string' or jsonb_typeof(p->'validUntil') is distinct from 'string' or jsonb_typeof(p->'quoteValidUntil') is distinct from 'string' or not isfinite((p->>'validFrom')::timestamptz) or not isfinite((p->>'validUntil')::timestamptz) or not isfinite((p->>'quoteValidUntil')::timestamptz) or (p->>'validUntil')::timestamptz<=(p->>'validFrom')::timestamptz or (p->>'validUntil')::timestamptz>(p->>'validFrom')::timestamptz+interval '5 minutes' or (p->>'quoteValidUntil')::timestamptz>(p->>'validFrom')::timestamptz+interval '5 minutes' or f->>'startsAt' is distinct from p->>'validFrom' or f->>'expiresAt' is distinct from p->>'validUntil' then raise exception 'r11_research_continuation_window';end if;
 if not exists(select 1 from private.r05_server_keys where key_hash=g->>'serverKeyHash' and expires_at>(p->>'validUntil')::timestamptz and expires_at<=(p->>'validUntil')::timestamptz+interval '30 minutes') or exists(select 1 from private.r11_research_policies where authority_key_hash=g->>'serverKeyHash') then raise exception 'r11_research_continuation_fresh_key_required';end if;
 perform private.r04_keys(g->'search',array['requestHash','wireHash','wireBytes','maxTokens']);
 if jsonb_typeof(f->'operations') is distinct from 'array' or jsonb_array_length(f->'operations')<>2 then raise exception 'r11_research_continuation_operations';end if;
 for x in select value from jsonb_array_elements(f->'operations') loop
 select * into o from private.r05_operations where operation_key=x->>'operationKey';
 if o.operation_key is null or o.operation_key not in ('research.search.r11v2.'||pid,'research.model.r11v2.'||pid) or x->>'installationId' is distinct from g->>'installationId' or x->>'workflowDefinitionId' is distinct from g->>'workflowDefinitionId' or x->'accountId' is distinct from 'null'::jsonb or x->'accountRevision' is distinct from 'null'::jsonb or x->'sourceDomains' is distinct from p->'allowedDomains' or x->'dataClasses' is distinct from '["generic_public_query","public_evidence"]'::jsonb or o.provider_model_id is distinct from p->>'modelId' or o.quote_hash is distinct from p->>'quoteHash' or o.valid_from>(p->>'validFrom')::timestamptz or o.valid_until<(p->>'validUntil')::timestamptz or o.valid_until>o.valid_from+interval '5 minutes' or o.liability_microunits<>(p->>case when o.operation_key='research.search.r11v2.'||pid then 'searchMicrousd' else 'selectorMicrousd' end)::bigint then raise exception 'r11_research_continuation_operation_scope';end if;
 end loop;
 if (select count(distinct value->>'operationKey') from jsonb_array_elements(f->'operations'))<>2 then raise exception 'r11_research_continuation_operations';end if;
 return new;
end $$;
create trigger r11_research_continuation_validate before insert on private.r11_research_continuation_grants for each row execute function private.r11_research_continuation_validate();
create function private.r11_research_continuation_revoke_lock() returns trigger language plpgsql set search_path='' as $$ declare b uuid;begin
 select business_id into b from private.r11_research_continuation_grants where id=new.grant_id;perform 1 from public.businesses where id=b for update;perform 1 from private.r11_research_continuation_grants where id=new.grant_id for update;return new;
end $$;
create trigger r11_research_continuation_revoke_lock before insert on private.r11_research_continuation_revocations for each row execute function private.r11_research_continuation_revoke_lock();
create or replace function private.r11_research_activation_revoked(pid uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from private.r11_research_activations a join private.r11_research_grant_revocations r on r.grant_id=a.grant_id where a.policy_id=pid)
 or exists(select 1 from private.r11_research_attempts a join private.r11_research_continuation_revocations r on r.grant_id=a.grant_id where a.policy_id=pid)
$$;
create function public.r11_research_continue(p_business_id uuid,p_grant_id uuid,p_grant_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare g private.r11_research_continuation_grants;a private.r11_research_attempts;j jsonb;c jsonb;p jsonb;op jsonb;w public.installed_packs;session_id uuid:=private.r11_auth_session();goal uuid;canon text;begin
 perform private.r05_owner(p_business_id);perform 1 from auth.sessions where id=session_id and user_id=auth.uid() for share;
 if not private.r11_session(auth.uid(),session_id) then raise exception 'r11_research_owner_session_required' using errcode='42501';end if;
 select * into g from private.r11_research_continuation_grants where id=p_grant_id and business_id=p_business_id and owner_id=auth.uid() for share;
 if g.id is null or g.grant_hash is distinct from p_grant_hash then raise exception 'r11_research_exact_continuation_required';end if;
 select * into a from private.r11_research_attempts where grant_id=g.id;
 if a.policy_id is not null then return jsonb_build_object('policyId',a.policy_id,'workflowRunId',g.grant_json->>'workflowRunId','replayed',true);end if;
 j:=g.grant_json;c:=j->'continuation';p:=j->'researchPolicy';goal:=(c->>'goalId')::uuid;
 if c is distinct from private.r11_research_continuation_context(p_business_id) or c->'eligible' is distinct from 'true'::jsonb then raise exception 'r11_research_stale_continuation';end if;
 if exists(select 1 from private.r11_research_continuation_revocations where grant_id=g.id) or clock_timestamp()<(p->>'validFrom')::timestamptz or clock_timestamp()>=(p->>'validUntil')::timestamptz then raise exception 'r11_research_continuation_inactive';end if;
 perform private.r11_research_key(j->>'serverKeyHash');
 if exists(select 1 from private.r11_research_policies where authority_key_hash=j->>'serverKeyHash') then raise exception 'r11_research_continuation_fresh_key_required';end if;
 select * into w from public.installed_packs where id=(j->>'installationId')::uuid and business_id=p_business_id and status='active' for share;
 if w.id is null or private.r04_hash(w.snapshot) is distinct from j->>'installationSnapshotHash' then raise exception 'r11_research_installation_unavailable';end if;
 perform 1 from public.packs where id=w.root_pack_id and status='qualified' for share;if not found then raise exception 'r11_research_pack_unavailable';end if;
 perform 1 from public.workflow_definitions where id=(j->>'workflowDefinitionId')::uuid and pack_id=w.root_pack_id and status='qualified' for share;if not found then raise exception 'r11_research_workflow_unavailable';end if;
 perform public.r04_quest_transition(p_business_id,'business.save',jsonb_build_object('expectedRevision',c->'businessRevision','content',j->'businessContent','preference','setup'),gen_random_uuid());
 perform public.r04_quest_transition(p_business_id,'quest.save',jsonb_build_object('goalId',goal,'expectedRevision',c->'goalRevision','content',j->'goalContent'),gen_random_uuid());
 perform public.r04_quest_transition(p_business_id,'quest.preference',jsonb_build_object('goalId',goal,'expectedRevision',(c->>'goalRevision')::integer+1,'preference','ready'),gen_random_uuid());
 perform public.r04_quest_transition(p_business_id,'quest.select',jsonb_build_object('goalId',goal,'expectedRevision',(c->>'goalRevision')::integer+2),gen_random_uuid());
 insert into public.workflow_runs(id,business_id,goal_id,workflow_definition_id,idempotency_key,status,runtime_capability_hash,pack_installation_id,pack_snapshot)
 values((j->>'workflowRunId')::uuid,p_business_id,goal,(j->>'workflowDefinitionId')::uuid,'r11-owner-continuation:'||g.id,'running',j->>'runtimeCapabilityHash',w.id,w.snapshot);
 op:=public.r05_policy_owner(p_business_id,'propose',(j->'operatingPolicy')||jsonb_build_object('goalId',goal),gen_random_uuid());
 perform public.r05_policy_owner(p_business_id,'confirm',jsonb_build_object('policyId',op->>'id','policyHash',op->>'hash'),gen_random_uuid());
 insert into private.r05_policy_proofs(policy_id,policy_hash,evidence_hash,valid_until) values((op->>'id')::uuid,op->>'hash',j->>'interpretationHash',(p->>'validUntil')::timestamptz);
 p:=p||jsonb_build_object('id',j->>'policyId','businessId',p_business_id,'ownerId',auth.uid(),'workflowRunId',j->>'workflowRunId','goalId',goal,'operatingPolicyId',op->>'id');canon:=private.stage14_canonical(p);
 insert into private.r11_research_policies(id,business_id,owner_id,workflow_run_id,goal_id,operating_policy_id,policy,policy_canonical,policy_hash,search_request_hash,search_wire_hash,search_wire_bytes,search_max_tokens,authority_key_hash)
 values((j->>'policyId')::uuid,p_business_id,auth.uid(),(j->>'workflowRunId')::uuid,goal,(op->>'id')::uuid,p,canon,private.stage14_hash(p),j->'search'->>'requestHash',j->'search'->>'wireHash',(j->'search'->>'wireBytes')::integer,(j->'search'->>'maxTokens')::integer,j->>'serverKeyHash');
 insert into private.r11_research_attempts(policy_id,business_id,predecessor_policy_id,grant_id,search_operation_key,selector_operation_key,actor_id,grant_hash)
 values((j->>'policyId')::uuid,p_business_id,(c->>'predecessorPolicyId')::uuid,g.id,'research.search.r11v2.'||(j->>'policyId'),'research.model.r11v2.'||(j->>'policyId'),auth.uid(),g.grant_hash);
 -- All prior Business/Goal/policy/registry history is untouched. Recheck live
 -- key/source/session after waits, before this single owner transaction returns.
 perform private.r11_research_key(j->>'serverKeyHash');perform private.r11_research_active(p_business_id,(j->>'policyId')::uuid);
 if not private.r11_session(auth.uid(),session_id) then raise exception 'r11_research_owner_session_required' using errcode='42501';end if;
 return jsonb_build_object('policyId',j->>'policyId','workflowRunId',j->>'workflowRunId','replayed',false);
end $$;
create function public.r11_research_workspace_v2(p_business_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare answer jsonb;policies jsonb:='[]';item jsonb;events jsonb;pid uuid;ws text;begin
 answer:=public.r11_research_workspace(p_business_id);
 for item in select value from jsonb_array_elements(answer->'policies') loop
 pid:=(item->>'policyId')::uuid;select status into ws from public.workflow_runs where id=(item->>'workflowRunId')::uuid and business_id=p_business_id;
 select coalesce(jsonb_agg(jsonb_build_object('outcomeId',id,'kind',kind,'phase',phase,'requestId',request_id,'reason',reason,'observation',observation,'createdAt',created_at) order by created_at,id),'[]'::jsonb) into events from private.r11_research_outcomes where policy_id=pid;
 item:=item||jsonb_build_object('attemptVersion',case when exists(select 1 from private.r11_research_attempts where policy_id=pid) then 2 else 1 end,'operations',private.r11_research_operation_keys(pid),'outcomes',events,'terminalReconciliationRequired',(item->>'revoked')::boolean and ws in ('queued','running','waiting','review') and item->'result'='null'::jsonb);
 if item->'result'='null'::jsonb and ws in ('needs_owner','cancelled','failed') then item:=item||jsonb_build_object('status',ws);end if;
 policies:=policies||jsonb_build_array(item);
 end loop;
 return answer||jsonb_build_object('policies',policies,'continuation',private.r11_research_continuation_context(p_business_id),
 'continuationGrantTotal',(select count(*) from private.r11_research_continuation_grants where business_id=p_business_id and owner_id=auth.uid()),'continuationGrants',coalesce((select jsonb_agg(grant_rows.item order by grant_rows.created_at desc,grant_rows.id desc) from (
 select g.id,g.created_at,jsonb_build_object('grantId',g.id,'grantHash',g.grant_hash,'grant',g.grant_json,'used',exists(select 1 from private.r11_research_attempts where grant_id=g.id),'expired',now()>=(g.grant_json->'researchPolicy'->>'validUntil')::timestamptz,'revoked',exists(select 1 from private.r11_research_continuation_revocations where grant_id=g.id)) item from private.r11_research_continuation_grants g where g.business_id=p_business_id and g.owner_id=auth.uid() order by g.created_at desc,g.id desc limit 25) grant_rows),'[]'::jsonb));
end $$;

-- Narrow R11 recognition extension; all source/financial checks below stay intact.
create or replace function private.r11_research_descriptor(p private.r11_research_policies,phase text,c private.r11_research_collections,a jsonb) returns void language plpgsql set search_path='' as $$
declare logical text;wire text;bytes integer;tokens integer;amount bigint;begin
 if phase='search' then logical:=p.search_request_hash;wire:=p.search_wire_hash;bytes:=p.search_wire_bytes;tokens:=p.search_max_tokens;amount:=(p.policy->>'searchMicrousd')::bigint;
 elsif phase='select' and c.id is not null then logical:=c.selector_request_hash;wire:=c.selector_wire_hash;bytes:=c.selector_wire_bytes;tokens:=c.selector_max_tokens;amount:=(p.policy->>'selectorMicrousd')::bigint;
 else raise exception 'r11_research_phase_invalid';end if;
 if a->>'workflowRunId' is distinct from p.workflow_run_id::text or a->>'operationKey' is distinct from (private.r11_research_operation_keys(p.id)->>phase) or a->>'requestHash' is distinct from logical or a->>'wireRequestHash' is distinct from wire or a->'wireRequestBytes' is distinct from to_jsonb(bytes) or a->'maximumOutputTokens' is distinct from to_jsonb(tokens) or a->>'providerModelId' is distinct from p.policy->>'modelId' or a->>'idempotencyKey' is distinct from 'r11:'||p.id||':'||phase or a->'accounting' is distinct from '{"kind":"r05"}'::jsonb or a->'sourceDomains' is distinct from p.policy->'allowedDomains' or a->'dataClasses' is distinct from '["generic_public_query","public_evidence"]'::jsonb or a->'accountId' is distinct from 'null'::jsonb or a->'accountRevision' is distinct from 'null'::jsonb or a->>'currency' is distinct from 'USD' or a->'liabilityMicrounits' is distinct from to_jsonb(amount::text) then raise exception 'r11_research_descriptor_mismatch';end if;
end $$;
create or replace function private.r11_research_marker() returns trigger language plpgsql set search_path='' as $$
declare r private.r05_requests;v private.r11_research_bindings;p private.r11_research_policies;c private.r11_research_collections;o private.r05_operations;reason text;begin
 select * into r from private.r05_requests where id=new.request_id and business_id=new.business_id;
 select * into o from private.r05_operations where operation_key=r.payload->>'operationKey';
 if r.payload->>'operationKey' not in ('research.search','research.model') and not exists(select 1 from private.r11_research_attempts a where a.search_operation_key=r.payload->>'operationKey' or a.selector_operation_key=r.payload->>'operationKey') then
 if r.payload->>'operationKey' like 'research.%.r11v2.%' then raise exception 'r11_research_source_operation_unqualified';end if;
 if coalesce(jsonb_array_length(r.payload->'sourceDomains'),0)>0 or coalesce(jsonb_array_length(o.source_domains),0)>0 or r.payload->'dataClasses' ?| array['public_evidence','product_evidence'] or o.data_classes ?| array['public_evidence','product_evidence'] then raise exception 'r11_research_source_operation_unqualified';end if;
 return new;
 end if;
 perform 1 from public.businesses where id=new.business_id for update;
 select * into v from private.r11_research_bindings where request_id=r.id and business_id=r.business_id;
 if v.request_id is null then raise exception 'r11_research_binding_required';end if;
 perform private.r11_research_key(v.admission_key_hash);p:=private.r11_research_active(r.business_id,v.policy_id);
 if v.phase='select' then c:=private.r11_research_collection_active(p,v.collection_id);end if;
 perform private.r11_research_descriptor(p,v.phase,c,r.payload);
 if r.policy_id is distinct from p.operating_policy_id or r.request_hash is distinct from v.descriptor_hash or private.r04_hash(r.payload) is distinct from v.descriptor_hash or r.payload->>'requestHash' is distinct from v.logical_request_hash or r.payload->>'wireRequestHash' is distinct from v.wire_hash then raise exception 'r11_research_binding_mismatch';end if;
 -- Recheck after all possible waits, immediately before the irreversible sent marker.
 perform private.r11_research_key(v.admission_key_hash);perform private.r11_research_active(r.business_id,v.policy_id);
 -- R05 may have waited on its operation/pack locks after checking financial
 -- proof expiry. All those locks are now held; reread every original guard.
 reason:=private.r05_admissible(r);
 if reason is not null then raise exception 'r11_research_financial_recheck: %',reason;end if;
 return new;
end $$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'r11_research_%' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;
end $$;
revoke all on function public.r11_research_server_v2(uuid,text,jsonb,text),public.r11_research_workspace_v2(uuid),public.r11_research_stop_v2(uuid,uuid),public.r11_research_continue(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.r11_research_server_v2(uuid,text,jsonb,text) to anon;
grant execute on function public.r11_research_workspace_v2(uuid),public.r11_research_stop_v2(uuid,uuid),public.r11_research_continue(uuid,uuid,text) to authenticated;
commit;
