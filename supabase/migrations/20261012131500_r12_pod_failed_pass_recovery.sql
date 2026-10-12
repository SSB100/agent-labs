-- Explicit owner-approved, same-Goal next-pass recovery. Definition only.
-- No old policy, template, deadline, response, charge or allowance is rewritten.
begin;
alter table private.r12_pod_templates drop constraint r12_pod_templates_version_check;
alter table private.r12_pod_templates add constraint r12_pod_templates_version_check check(version in ('r12.pod-template.2','r12.pod-template.3'));
create table private.r12_pod_recoveries (
 setup_id uuid primary key references private.r12_pod_setups(id),
 business_id uuid not null references public.businesses(id), goal_id uuid not null,
 scope_id uuid not null unique, owner_id uuid not null references auth.users(id),
 approval_hash text not null check(approval_hash ~ '^[a-f0-9]{64}$'),
 cap_revision integer not null, allocation_microunits bigint not null check(allocation_microunits between 1 and 10000000),
 created_at timestamptz not null default clock_timestamp(),
 predecessor_setup_id uuid not null unique references private.r12_pod_setups(id),
 predecessor_plan_id uuid not null unique references private.r07_plans(id),
 plan_id uuid not null unique references private.r07_plans(id) deferrable initially deferred,
 failed_attempt_id uuid not null unique references private.r07_attempts(id),
 proof jsonb not null, proof_hash text not null check(proof_hash=private.stage14_hash(proof)),
 history jsonb not null, history_hash text not null check(history_hash=private.stage14_hash(history)),
 foreign key(goal_id,business_id) references private.r04_goal_state(goal_id,business_id)
);
alter table private.r12_pod_recoveries enable row level security;
revoke all on private.r12_pod_recoveries from public,anon,authenticated,service_role;
create trigger pod_recovery_immutable before insert or update or delete on private.r12_pod_recoveries for each row execute function private.r12_pod_immutable();
create view private.r12_pod_all_activations as
 select setup_id,business_id,goal_id,scope_id,owner_id,approval_hash,cap_revision,allocation_microunits,created_at from private.r12_pod_activations
 union all select setup_id,business_id,goal_id,scope_id,owner_id,approval_hash,cap_revision,allocation_microunits,created_at from private.r12_pod_recoveries;
revoke all on private.r12_pod_all_activations from public,anon,authenticated,service_role;


create or replace function private.r12_pod_template_check(t private.r12_pod_templates,at_time timestamptz,current_use boolean default true) returns void language plpgsql set search_path='' as $$
declare p jsonb:=t.source_policy;k text;wd public.worker_definitions;fd public.workflow_definitions;begin
 if t.id is null or t.version not in ('r12.pod-template.2','r12.pod-template.3') or t.source_policy_hash<>private.stage14_hash(p) or t.pins_hash<>private.stage14_hash(t.pins)
 or t.valid_from>at_time or t.valid_until<=at_time or exists(select 1 from private.r12_pod_template_revocations r where r.template_id=t.id and (current_use or r.created_at<=at_time))
 then raise exception 'r12_pod_template_unavailable';end if;
 perform private.r04_keys(p,array['version','reviewId','method','purpose','excludedDomains','restrictionsRevision','termsReviewHash','independentReviewHash','recipients','retention','validFrom','validUntil']);
 if p->>'version' is distinct from 'r12.pod-source-policy.1' or p->>'method' is distinct from 'openrouter_exa_factual_snippets' or p->>'purpose' is distinct from 'public_pod_market_research'
 or (p->>'validFrom')::timestamptz>at_time or (p->>'validUntil')::timestamptz<=at_time
 or p->'recipients' is distinct from '{"router":"openrouter.ai","search":"exa.ai","researcher":"azure/us","reviewer":"amazon-bedrock/us"}'::jsonb
 or p->'retention' is distinct from '{"inference":"no_training_zdr","search":"query_retention_improvement_training_possible","application":"bounded_attributed_audit_evidence"}'::jsonb
 or not(p->'excludedDomains' @> '["etsy.com","etsy.me","etsystatic.com"]'::jsonb) then raise exception 'r12_pod_source_policy_unavailable';end if;
 foreach k in array array['restrictionsRevision','termsReviewHash','independentReviewHash'] loop if p->>k !~ '^[a-f0-9]{64}$' then raise exception 'r12_pod_source_policy_unavailable';end if;end loop;
 perform private.r04_strings(p->'excludedDomains',32);
 if p->'excludedDomains' is distinct from (select jsonb_agg(x order by x) from(select distinct jsonb_array_elements_text(p->'excludedDomains')x)q) then raise exception 'r12_pod_source_policy_unavailable';end if;
 if not current_use then return;end if;
 perform private.r04_keys(t.pins,array['packId','snapshot','snapshotHash','workflowDefinitionId','workflowHash','plannerWorkerDefinitionId','workers','executionReviewHash','eligibilityReviewHash','policyInterpretationHash','knowledgeValidUntil','schemas']);
 if t.pins->'snapshot' is distinct from jsonb_build_object('rootPackId',(t.pins->>'packId')::uuid,'releases',private.stage10_resolve((t.pins->>'packId')::uuid,true)) or t.pins->>'snapshotHash' is distinct from private.r04_hash(t.pins->'snapshot')
 or (t.pins->>'knowledgeValidUntil')::timestamptz<=at_time then raise exception 'r12_pod_catalog_changed';end if;
 perform 1 from public.packs where id in(select (v->>'id')::uuid from jsonb_array_elements(t.pins->'snapshot'->'releases')v) order by id for share;
 select * into fd from public.workflow_definitions where id=(t.pins->>'workflowDefinitionId')::uuid for share;
 if fd.id is null or fd.workflow_key<>'product.pod-research.one' or fd.version<>'1.0.0' or fd.pack_id<>(t.pins->>'packId')::uuid or private.r04_hash(to_jsonb(fd)) is distinct from t.pins->>'workflowHash' then raise exception 'r12_pod_workflow_changed';end if;
 foreach k in array array['executionReviewHash','eligibilityReviewHash','policyInterpretationHash'] loop if t.pins->>k !~ '^[a-f0-9]{64}$' then raise exception 'r12_pod_review_required';end if;end loop;
 perform private.r04_keys(t.pins->'workers',array['plan','search1','select1','strategy','review']);
 foreach k in array array['plan','search1','select1','strategy','review'] loop
 select * into wd from public.worker_definitions where id=(t.pins->'workers'->k->>'id')::uuid for share;
 if wd.id is null or wd.worker_key is distinct from 'product.pod-research.'||(case when k in ('search1','select1') then 'research' else k end) or wd.version<>'1.0.0'
 or wd.pack_id not in (select (v->>'id')::uuid from jsonb_array_elements(t.pins->'snapshot'->'releases')v)
 or private.r04_hash(to_jsonb(wd)) is distinct from t.pins->'workers'->k->>'hash' then raise exception 'r12_pod_worker_changed';end if;end loop;
 if t.pins->>'plannerWorkerDefinitionId' is distinct from t.pins->'workers'->'plan'->>'id' or t.pins->'workers'->'review'->>'id'=any(array[t.pins->'workers'->'plan'->>'id',t.pins->'workers'->'search1'->>'id',t.pins->'workers'->'select1'->>'id',t.pins->'workers'->'strategy'->>'id']) then raise exception 'r12_pod_independent_review_required';end if;
end $$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_pod_research_read(uuid,uuid,uuid,uuid)'::regprocedure);
 if (length(d)-length(replace(d,$old$where x.valid_from<=clock_timestamp()$old$,'')))/length($old$where x.valid_from<=clock_timestamp()$old$)<>1 then raise exception 'r12_pod_recovery_patch_drift: public.r12_pod_research_read(uuid,uuid,uuid,uuid)';end if;
 d:=replace(d,$old$where x.valid_from<=clock_timestamp()$old$,$new$where x.version='r12.pod-template.2' and x.valid_from<=clock_timestamp()$new$);execute d;end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_pod_owner_server(uuid,text,jsonb,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$ perform private.r12_pod_template_check(t,stamp,true);$old$,'')))/length($old$ perform private.r12_pod_template_check(t,stamp,true);$old$)<>1 then raise exception 'r12_pod_recovery_patch_drift: public.r12_pod_owner_server(uuid,text,jsonb,text)';end if;
 d:=replace(d,$old$ perform private.r12_pod_template_check(t,stamp,true);$old$,$new$ if t.version<>'r12.pod-template.2' then raise exception 'r12_pod_recovery_requires_separate_approval';end if;
 perform private.r12_pod_template_check(t,stamp,true);$new$);execute d;end $patch$;

create or replace function private.r12_pod_outstanding_hold(b uuid,policy uuid default null) returns bigint language sql stable set search_path='' as $$
 select coalesce(sum(greatest(0,d.maximum_microunits-coalesce(issued.liability,0))),0)::bigint
 from private.r12_pod_passes d join private.r12_pod_all_activations a on a.scope_id=d.scope_id join private.r12_pod_setups s on s.id=a.setup_id
 join private.r12_discovery_scopes scope on scope.id=d.scope_id
 left join lateral(select sum(c.maximum_microunits) liability from private.r12_pod_pass_calls c where c.scope_id=d.scope_id and c.ordinal=d.ordinal) issued on true
 where s.business_id=b and (policy is null or s.policy_id=policy) and (scope.amendment->>'expiresAt')::timestamptz>clock_timestamp()
 and not exists(select 1 from private.r05_revocations r where r.policy_id=s.policy_id)
 and not exists(select 1 from private.r12_pod_pass_closures c where c.scope_id=d.scope_id and c.ordinal=d.ordinal)
$$;

create or replace function private.r12_pod_setup_receipt(s private.r12_pod_setups) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('version','r12.pod-setup-receipt.2','businessId',s.business_id,'goalId',s.goal_id,'setupId',s.id,'scopeId',s.scope_id,'setupHash',s.setup_hash,
 'policyId',s.policy_id,'policyHash',s.policy_hash,'submissionId',s.input->>'submissionId','preview',s.preview,
 'confirmed',exists(select 1 from private.r05_confirmations where policy_id=s.policy_id),'activated',exists(select 1 from private.r12_pod_all_activations pa where pa.setup_id=s.id),
 'stopped',exists(select 1 from private.r05_revocations where policy_id=s.policy_id))
$$;

create or replace function private.r12_pod_scope_resolve(s private.r12_discovery_scopes,at_time timestamptz,require_current boolean default false) returns jsonb language plpgsql set search_path='' as $$
declare setup private.r12_pod_setups;activation private.r12_pod_activations;t private.r12_pod_templates;p private.r05_policies;a jsonb:=s.amendment;begin
 select * into setup from private.r12_pod_setups where id=s.pod_setup_id and business_id=s.business_id;
 select * into activation from private.r12_pod_all_activations where setup_id=setup.id and scope_id=s.id;
 select * into t from private.r12_pod_templates where id=setup.template_id for share;
 select * into p from private.r05_policies where id=setup.policy_id and business_id=s.business_id;
 perform private.r04_keys(a,array['version','id','businessId','businessRevision','businessHash','goalId','goalRevision','goalHash','setupId','setupHash','authorityRootId','publicBrief','sourcePolicy','sourcePolicyHash','approvalHash','maximumMicrousd','createdAt','expiresAt']);
 if s.id is null or s.origin<>'pod_goal' or s.owner_setup_id is not null or s.adaptive_setup_id is not null or s.budget_authority_root_id is not null or s.prior_round_id is not null
 or setup.id is null or activation.setup_id is null or p.id is null or p.actor_id<>setup.owner_id or setup.owner_id<>activation.owner_id or setup.goal_id<>s.goal_id or activation.goal_id<>s.goal_id or setup.scope_id<>s.id
 or a->>'version' is distinct from 'r12.pod-research-goal.2' or a->>'id' is distinct from s.id::text or a->>'businessId' is distinct from s.business_id::text or a->>'authorityRootId' is distinct from s.business_id::text
 or a->>'goalId' is distinct from s.goal_id::text or s.amendment_hash is distinct from private.stage14_hash(a)
 or a->>'setupId' is distinct from setup.id::text or a->>'setupHash' is distinct from setup.setup_hash or setup.setup_hash is distinct from private.stage14_hash(setup.preview)
 or a->'publicBrief' is distinct from setup.preview->'publicBrief' or a->'sourcePolicy' is distinct from t.source_policy or a->>'sourcePolicyHash' is distinct from t.source_policy_hash
 or a->>'approvalHash' is distinct from activation.approval_hash or activation.approval_hash is distinct from private.r12_pod_confirmation_hash(setup)
 or a->'maximumMicrousd' is distinct from to_jsonb(activation.allocation_microunits)
 or (a->>'createdAt')::timestamptz<>activation.created_at or (a->>'expiresAt')::timestamptz<>(a->>'createdAt')::timestamptz+interval '30 minutes'
 or (a->>'expiresAt')::timestamptz>setup.cutoff or (a->>'createdAt')::timestamptz>at_time or (a->>'expiresAt')::timestamptz<=at_time
 or a->'goalRevision' is distinct from setup.preview->'goalRevision' or a->>'goalHash' is distinct from setup.preview->>'goalHash'
 or a->'businessRevision' is distinct from setup.preview->'businessRevision' or a->>'businessHash' is distinct from setup.preview->>'businessHash'
 or p.content_hash is distinct from setup.policy_hash or p.payload->'policyLimitMicrounits' is distinct from to_jsonb(activation.allocation_microunits::text)
 then raise exception 'r12_pod_scope_ancestry_invalid';end if;
 perform private.r12_pod_public_brief(a->'publicBrief');perform private.r12_pod_template_check(t,at_time,require_current);
 if not exists(select 1 from private.r05_cap_versions c where c.business_id=s.business_id and c.currency='USD' and c.revision=activation.cap_revision and c.policy_id=p.id and c.maximum_microunits=private.r05_money(p.payload->'businessLifetimeLimitMicrounits')) then raise exception 'r12_pod_cap_ancestry_invalid';end if;
 if require_current then
 perform 1 from public.businesses where id=s.business_id and owner_user_id=setup.owner_id for update;
 if not found or exists(select 1 from private.r05_revocations where policy_id=p.id)
 or not exists(select 1 from private.r04_business_versions v join private.r04_business_state st using(business_id,revision) where v.business_id=s.business_id and v.revision=p.business_revision and v.content_hash=a->>'businessHash' and v.preference='setup')
 or not exists(select 1 from private.r04_goal_versions v join private.r04_goal_state st using(business_id,goal_id,revision) where v.business_id=s.business_id and v.goal_id=s.goal_id and v.revision=p.goal_revision and v.content_hash=a->>'goalHash' and v.preference='ready')
 or private.r05_paused(s.business_id,'business',s.business_id) or private.r05_paused(s.business_id,'quest',s.goal_id) then raise exception 'r12_pod_scope_stopped_or_changed';end if;
 end if;
 return jsonb_build_object('setupId',setup.id,'policyId',setup.policy_id,'templateId',t.id,'pins',t.pins);
end $$;

create function private.r12_pod_utf16_length(v text) returns integer language sql immutable set search_path='' as $$
 select coalesce(sum(case when ascii(c)>65535 then 2 else 1 end),0)::integer from regexp_split_to_table(v,'') c
$$;
create function private.r12_pod_length_classification(raw jsonb,schema jsonb,assessment jsonb,evidence jsonb,pack_hash text) returns jsonb language plpgsql immutable set search_path='' as $$
declare relaxed jsonb;fields jsonb:='[]';item jsonb;path text;original text;minimum integer;maximum integer;begin
 relaxed:=schema #- '{properties,rationale,maxLength}' #- '{properties,checks,items,properties,rationale,maxLength}' #- '{properties,missingEvidence,items,maxLength}' #- '{properties,nextTest,maxLength}';
 if not private.r12_direct_schema_valid(raw,relaxed) or pack_hash !~ '^[a-f0-9]{64}$'
 or raw->>'outcome' is distinct from 'INSUFFICIENT_EVIDENCE' or raw->'candidateIndex' is distinct from 'null'::jsonb
 or assessment->'recommendation'->>'outcome' is distinct from 'INSUFFICIENT_EVIDENCE'
 or (select count(distinct c->>'check') from jsonb_array_elements(raw->'checks')c)<>6
 or exists(select 1 from jsonb_array_elements(raw->'checks')c,lateral jsonb_array_elements_text(c->'evidence') ref where not exists(select 1 from jsonb_array_elements(evidence)e where e->>'key'=ref))
 then raise exception 'r12_pod_length_only_structure_and_domain_required';end if;
 for item in select v from (
 select 0 n,jsonb_build_object('path','$.rationale','min',60,'max',600,'original',raw->>'rationale')v
 union all select ord::integer,jsonb_build_object('path','$.checks['||(ord-1)||'].rationale','min',30,'max',240,'original',c->>'rationale') from jsonb_array_elements(raw->'checks') with ordinality x(c,ord)
 union all select 10+ord::integer,jsonb_build_object('path','$.missingEvidence['||(ord-1)||']','min',20,'max',220,'original',c) from jsonb_array_elements_text(raw->'missingEvidence') with ordinality x(c,ord)
 union all select 20,jsonb_build_object('path','$.nextTest','min',40,'max',400,'original',raw->>'nextTest')) x order by n loop
 original:=item->>'original';maximum:=(item->>'max')::integer;
 if private.r12_pod_utf16_length(original)>maximum then fields:=fields||jsonb_build_array(item);end if;
 end loop;
 if jsonb_array_length(fields)=0 then raise exception 'r12_pod_actual_length_failure_required';end if;
 return jsonb_build_object('version','r12.pod-review-length-failure.1','originalHash',private.stage14_hash(raw),'assessmentHash',private.stage14_hash(assessment),'evidenceHash',pack_hash,'fields',fields);
end $$;


-- Read-only predecessor proof; the owner-facing wrapper checks current ownership.
-- This never completes the rejected pass or changes its receipt/status.
create function private.r12_pod_recovery_context(b uuid, predecessor uuid) returns jsonb
language plpgsql set search_path='' as $$
declare st private.r12_pod_setups;s private.r12_discovery_scopes;p private.r07_plans;h private.r07_heads;
 a private.r07_attempts;dep private.r07_attempts;pass private.r12_pod_passes;received private.r12_discovery_response_observations;rejected private.r12_discovery_response_observations;
 classification jsonb;schema jsonb;pack_hash text;paid bigint;calls integer;known integer;searches integer;providers integer;step jsonb;proof jsonb;history jsonb;ctx jsonb;raw jsonb;pins jsonb:='[]';queries jsonb;assessment jsonb;plan_output jsonb;dep_value jsonb;evidence jsonb;domains jsonb;
begin
 select * into st from private.r12_pod_setups where id=predecessor and business_id=b;
 select * into s from private.r12_discovery_scopes where id=st.scope_id and business_id=b and origin='pod_goal';
 select * into p from private.r07_plans where content->>'discoveryScopeId'=s.id::text and business_id=b and goal_id=st.goal_id;
 select * into h from private.r07_heads where business_id=b and goal_id=st.goal_id;
 select * into pass from private.r12_pod_passes where scope_id=s.id order by ordinal desc limit 1;
 if st.id is null or s.id is null or p.id is null or p.version<>1 or p.previous_plan_id is not null or h.plan_id is distinct from p.id
 or st.owner_id is distinct from (select owner_user_id from public.businesses where id=b)
 or not exists(select 1 from private.r12_pod_activations x where x.setup_id=st.id and x.scope_id=s.id)
 or not exists(select 1 from private.r05_revocations where policy_id=st.policy_id)
 or pass.scope_id is null or pass.ordinal>=4 or exists(select 1 from private.r12_pod_pass_closures where scope_id=s.id and ordinal=pass.ordinal)
 or exists(select 1 from private.r12_pod_passes d where d.scope_id=s.id and d.ordinal<pass.ordinal and not exists(select 1 from private.r12_pod_pass_closures c where c.scope_id=s.id and c.ordinal=d.ordinal and c.outcome='INSUFFICIENT_EVIDENCE'))
 or h.repairs_used<>0 or h.pivots_used<>0 then raise exception 'r12_pod_stopped_failed_pass_required';end if;
 select * into a from private.r07_attempts where plan_id=p.id and step_key='review' and adaptive_action_ordinal=pass.ordinal and adaptive_action_hash=pass.content_hash;
 select o.* into received from private.r12_discovery_response_observations o join private.r12_pod_pass_calls c on c.request_id=o.request_id where c.attempt_id=a.id and o.kind='received';
 select o.* into rejected from private.r12_discovery_response_observations o where o.request_id=received.request_id and o.kind='rejected';
 if a.id is null or a.status not in ('dispatched','failed','rejected') or received.request_id is null or rejected.request_id is null
 or exists(select 1 from private.r07_responses where attempt_id=a.id)
 or exists(select 1 from private.r12_discovery_candidates where request_id=received.request_id)
 or received.payload->>'contentState' is distinct from 'complete' or received.payload->>'finishReason' is distinct from 'stop'
 or received.payload->>'contentHash' is distinct from encode(extensions.digest(convert_to(received.payload->>'content','UTF8'),'sha256'),'hex')
 or octet_length(received.payload->>'content') not between 1 and 16384
 or rejected.payload->>'code' is distinct from 'response_schema' or rejected.payload->'observationSaved' is distinct from 'true'::jsonb
 or jsonb_array_length(rejected.payload->'issues') not between 1 and 16
 or exists(select 1 from jsonb_array_elements(rejected.payload->'issues') i where i->>'constraint' is distinct from 'max_length')
 then raise exception 'r12_pod_saved_length_failure_required';end if;
 raw:=(received.payload->>'content')::jsonb;
 if raw->>'outcome' is distinct from 'INSUFFICIENT_EVIDENCE' or raw->'candidateIndex' is distinct from 'null'::jsonb
 or raw->'etsyDemandVerified' is distinct from 'false'::jsonb or raw->'commercialViabilityVerified' is distinct from 'false'::jsonb
 then raise exception 'r12_pod_no_rejected_recommendation_reuse';end if;
 select count(*),count(*) filter(where z.n=1 and z.providers=1),coalesce(sum(z.actual),0),count(*) filter(where c.phase='search1') into calls,known,paid,searches
 from private.r12_pod_pass_calls c left join lateral(select count(distinct actual_microunits)n,count(distinct provider_request_id)providers,max(actual_microunits)actual from private.r05_settlements where request_id=c.request_id and business_id=b and actual_microunits is not null and provider_request_id is not null)z on true where c.scope_id=s.id;
 if calls<>5*(pass.ordinal+1) or known<>calls or searches<>pass.ordinal+1 or paid<0 or paid>=(s.amendment->>'maximumMicrousd')::bigint
 or h.dispatches<>calls or h.children_created<>5
 or (select count(*) from private.r07_attempts where plan_id=p.id)<>calls
 or exists(select 1 from private.r12_pod_pass_calls c where c.scope_id=s.id and not exists(select 1 from private.r05_markers where request_id=c.request_id))
 or exists(select 1 from private.r12_pod_pass_calls c where c.scope_id=s.id and not exists(select 1 from private.r12_discovery_transport_claims where request_id=c.request_id))
 or not exists(select 1 from private.r05_settlements where request_id=received.request_id and provider_request_id=received.payload->>'providerRequestId' and actual_microunits is not null)
 then raise exception 'r12_pod_exact_settled_lineage_required';end if;
 for dep in select * from private.r07_attempts where plan_id=p.id and adaptive_action_ordinal=pass.ordinal and step_key<>'review' order by case step_key when 'plan' then 1 when 'search1' then 2 when 'select1' then 3 when 'strategy' then 4 end loop
 dep_value:=private.r12_pod_completed_dependency(dep,p);
 pins:=pins||jsonb_build_array(jsonb_build_object('phase',dep.step_key,'attemptId',dep.id,'responseHash',dep_value->>'responseHash','candidateHash',private.stage14_hash(dep_value->'candidate')));
 if dep.step_key='strategy' then assessment:=dep_value->'candidate'->'output';end if;
 if dep.step_key='select1' then pack_hash:=dep_value->'response'->'result'->>'evidencePackHash';end if;
 if dep.step_key='plan' then plan_output:=dep_value->'candidate'->'output';end if;
 end loop;
 if jsonb_array_length(pins)<>4 or assessment->'recommendation'->>'outcome' is distinct from 'INSUFFICIENT_EVIDENCE' then raise exception 'r12_pod_four_accepted_dependencies_required';end if;
 evidence:=private.r12_pod_evidence_view(a,p,s);
 select w.output_schema into schema from public.worker_definitions w join private.r12_pod_templates t on t.id=st.template_id where w.id=(t.pins->'workers'->'review'->>'id')::uuid and private.r04_hash(to_jsonb(w))=t.pins->'workers'->'review'->>'hash' and private.stage14_hash(w.output_schema)=t.pins->'schemas'->'review'->>'localHash';
 classification:=private.r12_pod_length_classification(raw,schema,assessment,evidence,pack_hash);
 if rejected.payload->'issues' is distinct from (select jsonb_agg(jsonb_build_object('path',f->>'path','constraint','max_length','limit',f->'max')) from jsonb_array_elements(classification->'fields')f) then raise exception 'r12_pod_length_diagnostic_changed';end if;
 select jsonb_agg(jsonb_build_object('pass',c.ordinal,'query',v.candidate->'output'->>'query','sourceDomains',v.candidate->'output'->'sourceDomains') order by c.ordinal) into queries
 from private.r12_pod_pass_calls c join private.r12_discovery_candidates v on v.request_id=c.request_id where c.scope_id=s.id and c.phase='plan';
 select coalesce(jsonb_agg(domain order by domain),'[]'::jsonb) into domains from(select distinct lower(substring(e->>'url' from '^https://([^/]+)')) domain from jsonb_array_elements(evidence)e)x;
 history:=jsonb_build_object('version','r12.pod-failed-pass-history.1','kind','failed_pass_context','previousPass',pass.ordinal,'reviewAccepted',false,
 'failedObservationHash',received.payload_hash,'failureDiagnosticHash',rejected.payload_hash,'failureKind','review_length_rejected',
 'priorQueries',queries,'priorCandidates',(select jsonb_agg(jsonb_build_object('productType',x->>'productType','niche',x->>'niche','audience',x->>'audience')) from jsonb_array_elements(assessment->'candidates')x),
 'untrustedCritique',raw,'acceptedAssessment',jsonb_build_object('explorationSummary',assessment->'explorationSummary','recommendation',assessment->'recommendation','limitations',assessment->'limitations'),
 'evidence',evidence,'observedDomains',domains,'acceptedOutputHashes',(select jsonb_agg(jsonb_build_object('phase',x->>'phase','responseHash',x->>'responseHash')) from jsonb_array_elements(pins)x));
 proof:=jsonb_build_object('version','r12.pod-recovery-proof.1','businessId',b,'goalId',st.goal_id,'predecessorSetupId',st.id,'predecessorScopeId',s.id,'predecessorPlanId',p.id,'predecessorPlanHash',p.content_hash,'predecessorPlanVersion',p.version,
 'failedAttemptId',a.id,'observationHash',received.payload_hash,'diagnosticHash',rejected.payload_hash,'dependencyPins',pins,'historyHash',private.stage14_hash(history),
 'headRevision',h.revision,'baseChildren',h.children_created,'baseDispatches',h.dispatches,'baseRepairs',h.repairs_used,'basePivots',h.pivots_used,
 'usedPasses',pass.ordinal+1,'usedCalls',calls,'usedSearches',searches,'spentMicrounits',paid::text,'originalMaximumMicrounits',s.amendment->>'maximumMicrousd','remainingMaximumMicrounits',((s.amendment->>'maximumMicrousd')::bigint-paid)::text,
 'originalDeadline',s.amendment->>'expiresAt','sourcePolicyHash',s.amendment->>'sourcePolicyHash','publicBriefHash',private.stage14_hash(s.amendment->'publicBrief'));
 select value into step from jsonb_array_elements(p.content->'steps')x where x->>'key'='review';
 ctx:=jsonb_build_object('planId',p.id,'planHash',p.content_hash,'plan',p.content,'step',step,'attempt',jsonb_build_object('id',a.id,'stepKey','review','attempt',a.attempt,'adaptiveActionHash',a.adaptive_action_hash,'adaptiveActionOrdinal',a.adaptive_action_ordinal,'status',a.status,'inputHash',a.input_hash,'dependencyPins',a.dependency_pins,'wireHash',null,'requestId',received.request_id,'responseHash',null),'knowledge',jsonb_build_object('format','r09.1','businessId',b,'planId',p.id,'pins','[]'::jsonb));
 return jsonb_build_object('classificationHash',private.stage14_hash(classification),'proof',proof,'proofHash',private.stage14_hash(proof),'history',history,'historyHash',private.stage14_hash(history),'context',ctx,'inputs',private.r12_pod_phase_inputs(a,p),'observation',received.payload,'diagnostic',rejected.payload);
end $$;


create or replace function private.r12_pod_plan_check(b uuid,g uuid,p jsonb) returns void language plpgsql set search_path='' as $$
declare s private.r12_discovery_scopes;setup private.r12_pod_setups;t private.r12_pod_templates;step jsonb;expected jsonb;steps jsonb:='[]';phase text;ord integer:=0;keys text[]:=array['plan','search1','select1','strategy','review'];begin
 perform private.r07_safe(p);
 select * into s from private.r12_discovery_scopes where id=(p->>'discoveryScopeId')::uuid and business_id=b and goal_id=g;
 select * into setup from private.r12_pod_setups where id=s.pod_setup_id;
 select * into t from private.r12_pod_templates where id=setup.template_id;
 perform private.r12_pod_scope_resolve(s,(s.amendment->>'createdAt')::timestamptz,false);
 foreach phase in array keys loop
 step:=jsonb_build_object('key',phase,'kind',case when phase='search1' then 'research' when phase='review' then 'review' else 'work' end,'objective','Complete the approved public POD '||phase||' phase','reason','Use exact permitted evidence within this finite research pass','adapter','r12.discovery.'||s.id::text||'.'||phase,'qualificationHash',t.pins->>'executionReviewHash','installationId',setup.installation_id,'packSnapshotHash',t.pins->>'snapshotHash','workflowDefinitionId',t.pins->>'workflowDefinitionId','workerDefinitionId',t.pins->'workers'->phase->>'id','role',phase,'operationKey','research.r12.'||s.id::text||'.'||phase,'purpose','Public POD research: '||phase,'dependsOn',to_jsonb(keys[1:ord]),'expectedArtifactType','r12.discovery.'||phase,'maximumMicrounits',setup.preview->'quote'->'ceilings'->>phase,'expiresAt',s.amendment->'expiresAt','notBefore',s.amendment->'createdAt','measurement',null,'maximumRepairs',0);
 steps:=steps||jsonb_build_array(step);ord:=ord+1;end loop;
 expected:=jsonb_build_object('format','r12.pod-research.2','discoveryScopeId',s.id,'discoveryScopeHash',s.amendment_hash,'businessId',b,'goalId',g,'goalRevision',s.amendment->'goalRevision','goalHash',s.amendment->>'goalHash','businessRevision',s.amendment->'businessRevision','businessHash',s.amendment->>'businessHash','policyId',setup.policy_id,'policyHash',setup.policy_hash,'authorityRootId',b,'plannerWorkerDefinitionId',t.pins->>'plannerWorkerDefinitionId','currency','USD','maximumMicrounits',coalesce((select proof->>'originalMaximumMicrounits' from private.r12_pod_recoveries where scope_id=s.id),s.amendment->>'maximumMicrousd'),'deadline',s.amendment->'expiresAt','expiresAt',s.amendment->'expiresAt','maximumRepairs',0,'maximumPivots',0,'maximumChildren',coalesce((select (proof->>'baseChildren')::integer+5 from private.r12_pod_recoveries where scope_id=s.id),5),'maximumDispatches',25,'requiredChecks','["review"]'::jsonb,'finishCondition','all_required_outputs_verified','stopConditions','["no_permitted_work","deadline","repair_exhausted","owner_stopped"]'::jsonb,'steps',steps);
 if p is distinct from expected then raise exception 'r12_pod_exact_five_phase_plan_required';end if;
end $$;

create function public.r12_pod_recovery_read(p_business_id uuid,p_setup_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb;t private.r12_pod_templates;begin
 if auth.uid() is null or private.is_business_owner(p_business_id) is distinct from true then raise exception 'r12_pod_owner_required' using errcode='42501';end if;
 c:=private.r12_pod_recovery_context(p_business_id,p_setup_id);
 select * into t from private.r12_pod_templates x where x.version='r12.pod-template.3' and x.valid_from<=clock_timestamp() and x.valid_until>clock_timestamp()+interval '35 minutes' and not exists(select 1 from private.r12_pod_template_revocations where template_id=x.id) order by x.created_at desc,x.id desc limit 1;
 return c||jsonb_build_object('template',case when t.id is null then null else jsonb_build_object('id',t.id,'hash',t.reviewed_bundle_hash,'sourcePolicyHash',t.source_policy_hash,'validUntil',t.valid_until) end,'finance',private.r12_pod_finance(p_business_id));
end $$;

create or replace function public.r12_pod_recovery_owner_server(p_business_id uuid,p_operation text,p_payload jsonb,p_server_key text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.r12_pod_setups;t private.r12_pod_templates;g private.r04_goal_versions;br private.r04_business_versions;
 old private.r12_pod_submissions;installed public.installed_packs;input jsonb;q jsonb;finance jsonb;brief jsonb;ops jsonb:='[]';steps jsonb:='[]';policy_body jsonb;proposed jsonb;preview jsonb;amendment jsonb;plan jsonb;approval text;
 submission uuid;setup_id uuid;sid uuid;iid uuid;stamp timestamptz:=clock_timestamp();cutoff timestamptz;dispatch_until timestamptz;receipt_until timestamptz;
 h text;phase text;operation_key text;purpose text;data_classes jsonb;model text;bytes integer;tokens integer;ord integer:=0;maximum bigint;amount bigint;
 source_context jsonb;recovery_proof jsonb;recovery_history jsonb;next_plan_id uuid:=gen_random_uuid();
 phase_keys text[]:=array['plan','search1','select1','strategy','review'];begin
 perform private.r05_owner(p_business_id);perform private.r04_safe(p_payload);
 if p_operation not in ('prepare','confirm') then raise exception 'r12_pod_operation_invalid';end if;
 if p_operation='prepare' then
 perform private.r04_keys(p_payload,array['input','quote']);input:=p_payload->'input';q:=p_payload->'quote';
 perform private.r04_keys(input,array['businessId','goalId','goalRevision','templateId','templateHash','publicBrief','maximumMicrounits','businessLifetimeLimitMicrounits','submissionId','predecessorSetupId','proofHash','historyHash','classificationHash']);
 if input->>'businessId' is distinct from p_business_id::text then raise exception 'r12_pod_business_mismatch';end if;
 submission:=(input->>'submissionId')::uuid;select * into t from private.r12_pod_templates where id=(input->>'templateId')::uuid for share;
 else
 perform private.r04_keys(p_payload,case when p_operation='stop' then array['setupId','setupHash','submissionId'] else array['setupId','setupHash','submissionId','controllerKeyHash','admissionKeyHash','quote','preflight'] end);
 submission:=(p_payload->>'submissionId')::uuid;
 select * into s from private.r12_pod_setups where id=(p_payload->>'setupId')::uuid and business_id=p_business_id and owner_id=auth.uid() and setup_hash=p_payload->>'setupHash';
 if s.id is null then raise exception 'r12_pod_exact_setup_required';end if;
 input:=s.input;q:=p_payload->'quote';select * into t from private.r12_pod_templates where id=s.template_id for share;
 end if;
 if submission is null then raise exception 'r12_pod_submission_required';end if;
 h:=private.stage14_hash(jsonb_build_object('operation',p_operation,'payload',p_payload-array['quote','preflight']));
 select * into old from private.r12_pod_submissions where business_id=p_business_id and id=submission;
 if old.id is not null then
 if old.request_hash<>h or old.operation<>p_operation then raise exception 'r12_pod_idempotency_conflict';end if;
 select * into s from private.r12_pod_setups where id=old.setup_id and business_id=p_business_id and owner_id=auth.uid();
 if s.id is null then raise exception 'r12_pod_owner_changed';end if;return private.r12_pod_setup_receipt(s);end if;
 if p_operation='stop' then
 perform public.r05_policy_owner(p_business_id,'revoke',jsonb_build_object('policyId',s.policy_id,'policyHash',s.policy_hash),submission);
 -- No new send survives policy revocation. Scoped keys remain only for bounded
 -- exact already-paid receipt settlement; the receipt gate checks the marker.
 insert into private.r12_pod_submissions values(p_business_id,submission,h,s.id,p_operation);return private.r12_pod_setup_receipt(s);end if;
 if t.id is null or length(coalesce(p_server_key,''))<32 or t.server_key_hash is distinct from encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex') then raise exception 'r12_pod_application_capability_required' using errcode='42501';end if;
 if p_operation='confirm' and exists(select 1 from private.r12_pod_recoveries pa where pa.setup_id=s.id) then return private.r12_pod_setup_receipt(s);end if;
 if t.version<>'r12.pod-template.3' then raise exception 'r12_pod_recovery_template_required';end if;
 perform private.r12_pod_template_check(t,stamp,true);
 source_context:=private.r12_pod_recovery_context(p_business_id,(input->>'predecessorSetupId')::uuid);recovery_proof:=source_context->'proof';recovery_history:=source_context->'history';
 if input->>'proofHash' is distinct from source_context->>'proofHash' or input->>'historyHash' is distinct from source_context->>'historyHash' or input->>'classificationHash' is distinct from source_context->>'classificationHash' or recovery_proof->>'goalId' is distinct from input->>'goalId' or recovery_proof->>'sourcePolicyHash' is distinct from t.source_policy_hash then raise exception 'r12_pod_recovery_predecessor_changed';end if;
 if input->>'templateHash' is distinct from t.reviewed_bundle_hash then raise exception 'r12_pod_template_changed';end if;
 brief:=input->'publicBrief';perform private.r12_pod_public_brief(brief);
 select v.* into g from private.r04_goal_versions v join private.r04_goal_state st using(business_id,goal_id,revision) where v.business_id=p_business_id and v.goal_id=(input->>'goalId')::uuid;
 select v.* into br from private.r04_business_versions v join private.r04_business_state st using(business_id,revision) where v.business_id=p_business_id;
 if g.goal_id is null or g.revision<>(input->>'goalRevision')::integer or g.preference<>'ready' or br.business_id is null or br.preference<>'setup'
 or g.content->'ambiguities' is distinct from '[]'::jsonb or g.content->'parsed'->>'researchMode' is distinct from 'r12.pod-research-intent.1'
 or brief->>'objective' is distinct from g.content->>'objective' then raise exception 'r12_pod_intent_changed';end if;
 if private.r05_paused(p_business_id,'business',p_business_id) or private.r05_paused(p_business_id,'quest',g.goal_id) then raise exception 'r12_pod_paused';end if;
 finance:=private.r12_pod_finance(p_business_id);
 if finance->'hasBlockingUnknown' is distinct from 'false'::jsonb then raise exception 'r12_pod_unresolved_liability';end if;
 if private.stage14_hash(brief) is distinct from recovery_proof->>'publicBriefHash' or exists(select 1 from private.r12_pod_recoveries where predecessor_setup_id=(input->>'predecessorSetupId')::uuid) then raise exception 'r12_pod_recovery_already_used_or_changed';end if;
 perform private.r12_pod_quote_check(q,case when p_operation='confirm' then s.preview->'quote' else null end);
 amount:=private.r05_money(input->'maximumMicrounits');
 if amount not between 1 and 10000000 or (q->>'maximumMicrousd')::bigint>amount then raise exception 'r12_pod_budget_insufficient';end if;
 maximum:=private.r05_money(input->'businessLifetimeLimitMicrounits');
 if amount>(recovery_proof->>'remainingMaximumMicrounits')::bigint or maximum<>(finance->>'maximumMicrounits')::bigint or maximum<(finance->>'committedMicrounits')::bigint+amount then raise exception 'r12_pod_recovery_budget_cannot_reset';end if;
 if p_operation='prepare' then
 cutoff:=least(stamp+interval '35 minutes',t.valid_until,(t.source_policy->>'validUntil')::timestamptz,(t.pins->>'knowledgeValidUntil')::timestamptz);
 if cutoff<stamp+interval '30 minutes' then raise exception 'r12_pod_window_insufficient';end if;
 sid:=gen_random_uuid();setup_id:=gen_random_uuid();
 select * into installed from public.installed_packs where business_id=p_business_id and root_pack_id=(t.pins->>'packId')::uuid;
 if installed.id is not null then
 if installed.status<>'active' or installed.snapshot is distinct from t.pins->'snapshot' then raise exception 'r12_pod_installation_changed';end if;iid:=installed.id;
 else iid:=gen_random_uuid();insert into public.installed_packs(id,business_id,root_pack_id,root_pack_key,status,snapshot) values(iid,p_business_id,(t.pins->>'packId')::uuid,'workflow.pod-research','active',t.pins->'snapshot');end if;
 foreach phase in array phase_keys loop
 operation_key:='research.r12.'||sid::text||'.'||phase;purpose:='Public POD research: '||phase;
 data_classes:=case when phase='search1' then '["generic_public_query","public_evidence"]'::jsonb else '["approved_public_brief","public_evidence"]'::jsonb end;
 model:=case when phase='review' then 'anthropic/claude-haiku-4.5' else 'openai/gpt-5.6-luna' end;
 bytes:=case phase when 'plan' then 24576 when 'search1' then 8192 when 'select1' then 16384 else 32768 end;
 tokens:=case phase when 'plan' then 1500 when 'search1' then 4000 when 'select1' then 1000 when 'strategy' then 5000 else 4000 end;
 insert into private.r05_operations(operation_key,pack_id,workflow_definition_id,provider,provider_model_id,purpose,currency,category,maximum_request_bytes,maximum_output_tokens,liability_microunits,source_domains,data_classes,qualification_hash,eligibility_hash,quote_hash,valid_from,valid_until)
 values(operation_key,(t.pins->>'packId')::uuid,(t.pins->>'workflowDefinitionId')::uuid,'openrouter',model,purpose,'USD','model',bytes,tokens,(q->'ceilings'->>phase)::bigint,'[]',data_classes,t.pins->>'executionReviewHash',t.pins->>'eligibilityReviewHash',q->>'quoteHash',stamp,cutoff);
 insert into private.r07_adapters(adapter_key,qualification_hash,workflow_definition_id,worker_definition_id,workflow_hash,worker_hash,operation_key,role,purpose,artifact_type,mode,valid_from,valid_until,knowledge_valid_until)
 values('r12.discovery.'||sid::text||'.'||phase,t.pins->>'executionReviewHash',(t.pins->>'workflowDefinitionId')::uuid,(t.pins->'workers'->phase->>'id')::uuid,t.pins->>'workflowHash',t.pins->'workers'->phase->>'hash',operation_key,phase,purpose,'r12.discovery.'||phase,'qualification',stamp,cutoff,(t.pins->>'knowledgeValidUntil')::timestamptz);
 ops:=ops||jsonb_build_array(jsonb_build_object('operationKey',operation_key,'installationId',iid,'workflowDefinitionId',t.pins->>'workflowDefinitionId','purpose',purpose,'provider','openrouter','category','model','accountId',null,'accountRevision',null,'sourceDomains','[]'::jsonb,'dataClasses',data_classes,'maximumPerOperationMicrounits',q->'ceilings'->>phase));
 end loop;
 select jsonb_agg(x order by x->>'operationKey') into ops from jsonb_array_elements(ops)x;
 policy_body:=jsonb_build_object('version','r05.1','goalId',g.goal_id,'goalRevision',g.revision,'businessRevision',br.revision,'currency','USD','businessLifetimeLimitMicrounits',maximum::text,'policyLimitMicrounits',amount::text,'categoryLimits',jsonb_build_array(jsonb_build_object('category','model','microunits',amount::text)),'expectedCapRevision',(finance->>'capRevision')::integer,'expectedExposureMicrounits',finance->>'committedMicrounits','startsAt',stamp,'expiresAt',cutoff,'maximumDispatches',25,'minimumIntervalSeconds',0,'stopOnTarget',false,'operations',ops,'financialMode','bounded_model_cost_only');
 foreach phase in array phase_keys loop
 insert into private.r12_pod_operation_sources values('research.r12.'||sid::text||'.'||phase,'r12.pod-operation-source-policy.2',p_business_id,auth.uid(),g.goal_id,setup_id,sid,t.id,t.source_policy_hash,private.r04_hash(policy_body),phase,case when phase='plan' then 'approved_brief_or_reviewed_history' else 'reviewed_dynamic_public' end,stamp,cutoff);end loop;
 proposed:=public.r05_policy_owner(p_business_id,'propose',policy_body,gen_random_uuid());
 preview:=jsonb_build_object('version','r12.pod-research-preview.2','businessId',p_business_id,'goalId',g.goal_id,'goalRevision',g.revision,'goalHash',g.content_hash,'businessRevision',br.revision,'businessHash',br.content_hash,
 'publicBrief',brief,'templateId',t.id,'templateHash',t.reviewed_bundle_hash,'sourcePolicy',t.source_policy,'sourcePolicyHash',t.source_policy_hash,
 'finance',finance||jsonb_build_object('proposedBusinessLimitMicrounits',maximum::text,'runLimitMicrounits',input->>'maximumMicrounits'),'quote',q,'maximumPasses',5,'maximumCalls',25,'maximumCollections',5,'maximumRepairs',0,'dispatchMinutes',30,'receiptMinutes',30,'maximumReceiptChecks',75,'authorityCreated',false,'recovery',jsonb_build_object('version','r12.pod-next-pass-recovery.1','proof',recovery_proof,'proofHash',source_context->>'proofHash','historyHash',source_context->>'historyHash','classificationHash',input->>'classificationHash','originalReviewAccepted',false));
 insert into private.r12_pod_setups(id,business_id,goal_id,owner_id,scope_id,template_id,installation_id,policy_id,policy_hash,input,preview,setup_hash,cutoff)
 values(setup_id,p_business_id,g.goal_id,auth.uid(),sid,t.id,iid,(proposed->>'id')::uuid,proposed->>'hash',input,preview,private.stage14_hash(preview),cutoff) returning * into s;
 else
 if s.preview->>'goalHash' is distinct from g.content_hash or s.preview->>'businessHash' is distinct from br.content_hash
 or (s.preview->'finance')-array['proposedBusinessLimitMicrounits','runLimitMicrounits'] is distinct from finance
 or exists(select 1 from private.r05_revocations where policy_id=s.policy_id) then raise exception 'r12_pod_stale_or_stopped_review';end if;
 sid:=s.scope_id;iid:=s.installation_id;dispatch_until:=stamp+interval '30 minutes';receipt_until:=dispatch_until+interval '30 minutes';
 if dispatch_until>s.cutoff then raise exception 'r12_pod_confirmation_expired';end if;
 if coalesce(p_payload->>'controllerKeyHash','') !~ '^[a-f0-9]{64}$' or coalesce(p_payload->>'admissionKeyHash','') !~ '^[a-f0-9]{64}$' or p_payload->>'controllerKeyHash'=p_payload->>'admissionKeyHash'
 or exists(select 1 from private.r07_server_keys where key_hash in(p_payload->>'controllerKeyHash',p_payload->>'admissionKeyHash')) or exists(select 1 from private.r05_server_keys where key_hash in(p_payload->>'controllerKeyHash',p_payload->>'admissionKeyHash')) then raise exception 'r12_pod_fresh_separate_keys_required';end if;
 if p_payload->'preflight'->>'setupHash' is distinct from s.setup_hash or p_payload->'preflight'->>'sourcePolicyHash' is distinct from t.source_policy_hash
 or coalesce(p_payload->'preflight'->>'requestHash','') !~ '^[a-f0-9]{64}$' or coalesce(p_payload->'preflight'->>'wireHash','') !~ '^[a-f0-9]{64}$' or coalesce((p_payload->'preflight'->>'wireBytes')::integer,0) not between 1 and 24576 then raise exception 'r12_pod_planner_preflight_required';end if;
 perform public.r05_policy_owner(p_business_id,'confirm',jsonb_build_object('policyId',s.policy_id,'policyHash',s.policy_hash),submission);
 approval:=private.r12_pod_confirmation_hash(s);
 insert into private.r12_pod_recoveries values(s.id,p_business_id,g.goal_id,sid,auth.uid(),approval,(finance->>'capRevision')::integer+1,amount,stamp,(input->>'predecessorSetupId')::uuid,(recovery_proof->>'predecessorPlanId')::uuid,next_plan_id,(recovery_proof->>'failedAttemptId')::uuid,recovery_proof,source_context->>'proofHash',recovery_history,source_context->>'historyHash');
 amendment:=jsonb_build_object('version','r12.pod-research-goal.2','id',sid,'businessId',p_business_id,'businessRevision',br.revision,'businessHash',br.content_hash,'goalId',g.goal_id,'goalRevision',g.revision,'goalHash',g.content_hash,'setupId',s.id,'setupHash',s.setup_hash,'authorityRootId',p_business_id,'publicBrief',brief,'sourcePolicy',t.source_policy,'sourcePolicyHash',t.source_policy_hash,'approvalHash',approval,'maximumMicrousd',amount,'createdAt',stamp,'expiresAt',dispatch_until);
 insert into private.r12_discovery_scopes(id,business_id,goal_id,budget_authority_root_id,prior_round_id,amendment,amendment_hash,origin,pod_setup_id)
 values(sid,p_business_id,g.goal_id,null,null,amendment,private.stage14_hash(amendment),'pod_goal',s.id);
 foreach phase in array phase_keys loop
 steps:=steps||jsonb_build_array(jsonb_build_object('key',phase,'kind',case when phase='search1' then 'research' when phase='review' then 'review' else 'work' end,'objective','Complete the approved public POD '||phase||' phase','reason','Use exact permitted evidence within this finite research pass','adapter','r12.discovery.'||sid::text||'.'||phase,'qualificationHash',t.pins->>'executionReviewHash','installationId',iid,'packSnapshotHash',t.pins->>'snapshotHash','workflowDefinitionId',t.pins->>'workflowDefinitionId','workerDefinitionId',t.pins->'workers'->phase->>'id','role',phase,'operationKey','research.r12.'||sid::text||'.'||phase,'purpose','Public POD research: '||phase,'dependsOn',to_jsonb(phase_keys[1:ord]),'expectedArtifactType','r12.discovery.'||phase,'maximumMicrounits',s.preview->'quote'->'ceilings'->>phase,'expiresAt',dispatch_until,'notBefore',stamp,'measurement',null,'maximumRepairs',0));ord:=ord+1;end loop;
 plan:=jsonb_build_object('format','r12.pod-research.2','discoveryScopeId',sid,'discoveryScopeHash',private.stage14_hash(amendment),'businessId',p_business_id,'goalId',g.goal_id,'goalRevision',g.revision,'goalHash',g.content_hash,'businessRevision',br.revision,'businessHash',br.content_hash,'policyId',s.policy_id,'policyHash',s.policy_hash,'authorityRootId',p_business_id,'plannerWorkerDefinitionId',t.pins->>'plannerWorkerDefinitionId','currency','USD','maximumMicrounits',recovery_proof->>'originalMaximumMicrounits','deadline',dispatch_until,'expiresAt',dispatch_until,'maximumRepairs',0,'maximumPivots',0,'maximumChildren',(recovery_proof->>'baseChildren')::integer+5,'maximumDispatches',25,'requiredChecks','["review"]'::jsonb,'finishCondition','all_required_outputs_verified','stopConditions','["no_permitted_work","deadline","repair_exhausted","owner_stopped"]'::jsonb,'steps',steps);
 insert into private.r05_policy_proofs values(s.policy_id,s.policy_hash,t.pins->>'policyInterpretationHash',dispatch_until);
 insert into private.r07_server_keys values(p_payload->>'controllerKeyHash',receipt_until);insert into private.r05_server_keys values(p_payload->>'admissionKeyHash',receipt_until);
 insert into private.r12_discovery_authorities(scope_id,business_id,goal_id,controller_key_hash,admission_key_hash,plan,plan_hash,mode,approval_hash,execution_review_hash,valid_until,receipt_until)
 values(sid,p_business_id,g.goal_id,p_payload->>'controllerKeyHash',p_payload->>'admissionKeyHash',plan,private.r04_hash(plan),'qualification',approval,t.pins->>'executionReviewHash',dispatch_until,receipt_until);
 insert into private.r07_plans(id,business_id,goal_id,version,previous_plan_id,policy_id,owner_id,content,content_hash,reason,evidence_hash)
 values(next_plan_id,p_business_id,g.goal_id,(recovery_proof->>'predecessorPlanVersion')::integer+1,(recovery_proof->>'predecessorPlanId')::uuid,s.policy_id,auth.uid(),plan,private.r04_hash(plan),'Owner-confirmed next research pass after rejected review',source_context->>'proofHash');
 update private.r07_heads set plan_id=next_plan_id,revision=revision+1,state='ready',reason='pod_recovery_ready',lease_epoch=lease_epoch+1,lease_hash=null,lease_expires_at=null
 where business_id=p_business_id and goal_id=g.goal_id and plan_id=(recovery_proof->>'predecessorPlanId')::uuid and revision=(recovery_proof->>'headRevision')::bigint;
 if not found then raise exception 'r12_pod_recovery_head_changed';end if;
 insert into private.r07_events(business_id,goal_id,plan_id,operation,payload) values(p_business_id,g.goal_id,next_plan_id,'pod_next_pass_recovery',jsonb_build_object('setupId',s.id,'predecessorPlanId',recovery_proof->>'predecessorPlanId','proofHash',source_context->>'proofHash','originalReviewAccepted',false,'shouldDispatch',false));

 end if;
 insert into private.r12_pod_submissions values(p_business_id,submission,h,s.id,p_operation);return private.r12_pod_setup_receipt(s);
end $$;

create function private.r12_pod_recovery_state(scope uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('version','r12.pod-next-pass-recovery.1','proof',r.proof,'proofHash',r.proof_hash,'historyHash',r.history_hash,'setupHash',s.setup_hash)
 from private.r12_pod_recoveries r join private.r12_pod_setups s on s.id=r.setup_id where r.scope_id=scope
$$;
create function private.r12_pod_plan_lineage(p private.r07_plans) returns boolean language sql stable set search_path='' as $$
 select (p.version=1 and p.previous_plan_id is null and not exists(select 1 from private.r12_pod_recoveries where plan_id=p.id)) or exists(
 select 1 from private.r12_pod_recoveries r join private.r12_pod_setups s on s.id=r.setup_id join private.r12_pod_templates t on t.id=s.template_id
 where r.plan_id=p.id and r.scope_id=(p.content->>'discoveryScopeId')::uuid and r.business_id=p.business_id and r.goal_id=p.goal_id
 and p.previous_plan_id=r.predecessor_plan_id and p.version=(r.proof->>'predecessorPlanVersion')::integer+1 and t.version='r12.pod-template.3'
 and p.content->>'maximumMicrounits'=r.proof->>'originalMaximumMicrounits' and p.content->'maximumChildren'=to_jsonb((r.proof->>'baseChildren')::integer+5)
 and p.content->'maximumDispatches'='25'::jsonb and p.policy_id=s.policy_id)
$$;
create function private.r12_pod_recovery_plan_guard() returns trigger language plpgsql set search_path='' as $$
declare r private.r12_pod_recoveries;h private.r07_heads;q private.r12_discovery_authorities;begin
 if new.content->>'format'<>'r12.pod-research.2' or new.version=1 and new.previous_plan_id is null then return new;end if;
 select * into r from private.r12_pod_recoveries where plan_id=new.id;
 select * into h from private.r07_heads where business_id=new.business_id and goal_id=new.goal_id;
 select * into q from private.r12_discovery_authorities where scope_id=r.scope_id;
 if r.setup_id is null or not private.r12_pod_plan_lineage(new) or q.plan is distinct from new.content or q.plan_hash is distinct from new.content_hash
 or h.plan_id is distinct from r.predecessor_plan_id or h.revision<>(r.proof->>'headRevision')::bigint
 or h.children_created<>(r.proof->>'baseChildren')::integer or h.dispatches<>(r.proof->>'baseDispatches')::integer
 or h.repairs_used<>(r.proof->>'baseRepairs')::integer or h.pivots_used<>(r.proof->>'basePivots')::integer
 or not exists(select 1 from private.r05_revocations x join private.r07_plans prior on prior.policy_id=x.policy_id where prior.id=r.predecessor_plan_id)
 then raise exception 'r12_pod_exact_recovery_plan_required';end if;
 perform private.r07_validate_plan(new.business_id,new.goal_id,new.content);return new;
end $$;
create trigger pod_recovery_plan_guard before insert on private.r07_plans for each row execute function private.r12_pod_recovery_plan_guard();


do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_plan_qualification(uuid,uuid,jsonb)'::regprocedure);
 if (length(d)-length(replace(d,$old$private.r12_pod_activations $old$,'')))/length($old$private.r12_pod_activations $old$)<>1 then raise exception 'r12_pod_recovery_patch_drift: private.r12_plan_qualification(uuid,uuid,jsonb)';end if;
 d:=replace(d,$old$private.r12_pod_activations $old$,$new$private.r12_pod_all_activations $new$);execute d;end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_admission_key_scope(uuid,text,jsonb,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$private.r12_pod_activations $old$,'')))/length($old$private.r12_pod_activations $old$)<>1 then raise exception 'r12_pod_recovery_patch_drift: private.r12_admission_key_scope(uuid,text,jsonb,text)';end if;
 d:=replace(d,$old$private.r12_pod_activations $old$,$new$private.r12_pod_all_activations $new$);execute d;end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_server_before_funding_proof(uuid,uuid,text,jsonb,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$private.r12_pod_activations $old$,'')))/length($old$private.r12_pod_activations $old$)<>1 then raise exception 'r12_pod_recovery_patch_drift: private.r12_discovery_server_before_funding_proof(uuid,uuid,text,jsonb,text)';end if;
 d:=replace(d,$old$private.r12_pod_activations $old$,$new$private.r12_pod_all_activations $new$);execute d;end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)'::regprocedure);
 if (length(d)-length(replace(d,$old$p.version<>1 or p.previous_plan_id is not null$old$,'')))/length($old$p.version<>1 or p.previous_plan_id is not null$old$)<>1 then raise exception 'r12_pod_recovery_patch_drift: private.r12_pod_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)';end if;
 d:=replace(d,$old$p.version<>1 or p.previous_plan_id is not null$old$,$new$not private.r12_pod_plan_lineage(p)$new$);execute d;end $patch$;

create or replace function private.r12_pod_pass_history(p private.r07_plans,pass integer) returns jsonb language plpgsql stable set search_path='' as $$
declare recovery private.r12_pod_recoveries;closed private.r12_pod_pass_closures;review jsonb;queries jsonb;hypotheses jsonb;begin
 select * into recovery from private.r12_pod_recoveries where scope_id=(p.content->>'discoveryScopeId')::uuid;
 if recovery.setup_id is not null and pass=(recovery.proof->>'usedPasses')::integer then return recovery.history;end if;
 if pass=0 then return null;end if;
 select * into closed from private.r12_pod_pass_closures where scope_id=(p.content->>'discoveryScopeId')::uuid and ordinal=pass-1;
 if closed.scope_id is null or closed.outcome<>'INSUFFICIENT_EVIDENCE' then raise exception 'r12_pod_refinement_predecessor_required';end if;
 select c.candidate->'output' into review from private.r12_pod_pass_calls call join private.r12_discovery_candidates c on c.request_id=call.request_id
 join private.r07_responses r on r.attempt_id=call.attempt_id and r.content_hash=closed.review_hash
 where call.scope_id=closed.scope_id and call.ordinal=closed.ordinal and call.phase='review' and call.attempt_id=closed.review_attempt_id;
 select jsonb_agg(jsonb_build_object('pass',call.ordinal,'query',c.candidate->'output'->>'query','sourceDomains',c.candidate->'output'->'sourceDomains') order by call.ordinal) into queries
 from private.r12_pod_pass_calls call join private.r12_discovery_candidates c on c.request_id=call.request_id where call.scope_id in(closed.scope_id,(recovery.proof->>'predecessorScopeId')::uuid) and call.ordinal<pass and call.phase='plan';
 select jsonb_agg(jsonb_build_object('productType',h->>'productType','niche',h->>'niche','audience',h->>'audience')) into hypotheses
 from private.r12_pod_pass_calls call join private.r12_discovery_candidates c on c.request_id=call.request_id,
 lateral jsonb_array_elements(c.candidate->'output'->'candidates')h where call.scope_id=closed.scope_id and call.ordinal=closed.ordinal and call.phase='strategy';
 if review is null or jsonb_array_length(queries)<>pass or hypotheses is null then raise exception 'r12_pod_refinement_history_incomplete';end if;
 return jsonb_build_object('version','r12.pod-refinement-history.2','previousPass',closed.ordinal,'previousReviewHash',closed.review_hash,
 'reviewEvidenceNamespace','pass-'||closed.ordinal,'priorQueries',queries,'review',review,'priorCandidates',hypotheses);
end $$;

create or replace function private.r12_pod_accepted_plan(a private.r07_attempts,p private.r07_plans,s private.r12_discovery_scopes) returns jsonb language plpgsql set search_path='' as $$
declare dep private.r07_attempts;pin jsonb;d jsonb;v jsonb;h jsonb;t text;body jsonb;begin
 select value into pin from jsonb_array_elements(a.dependency_pins) x where x->>'stepKey'='plan';
 select * into dep from private.r07_attempts where id=(pin->>'attemptId')::uuid and plan_id=p.id and business_id=p.business_id and step_key='plan';
 d:=private.r12_pod_completed_dependency(dep,p);v:=d->'candidate'->'output';
 if pin->>'resultHash' is distinct from d->>'responseHash' then raise exception 'r12_pod_planner_dependency_changed';end if;
 perform private.r04_keys(v,array['comparisonRationale','query','sourceDomains','sourceChoiceRationale','hypotheses']);perform private.r04_safe(v);
 if length(v->>'comparisonRationale') not between 40 and 700 or length(v->>'query') not between 20 and 800 or v->>'query'<>btrim(v->>'query') or length(v->>'sourceChoiceRationale') not between 30 and 500
 or jsonb_typeof(v->'hypotheses') is distinct from 'array' or jsonb_array_length(v->'hypotheses') not between 1 and 3
 or v::text ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|https?://|localhost|127\.0\.0\.1|169\.254\.169\.254|([0-9][ -]?){12,19}' then raise exception 'r12_pod_planner_policy_rejected';end if;
 if exists(select 1 from private.r12_pod_pass_calls call join private.r12_discovery_candidates prior on prior.request_id=call.request_id where call.scope_id in(s.id,(select (proof->>'predecessorScopeId')::uuid from private.r12_pod_recoveries where scope_id=s.id)) and call.ordinal<a.adaptive_action_ordinal and call.phase='plan' and lower(regexp_replace(prior.candidate->'output'->>'query','\s+',' ','g'))=lower(regexp_replace(v->>'query','\s+',' ','g'))) then raise exception 'r12_pod_unchanged_query';end if;
 -- Canonicalize the derived accepted plan exactly as TypeScript does. The raw
 -- provider candidate remains immutable; invalid types/duplicates still fail.
 perform private.r04_strings(v->'sourceDomains',6);
 v:=jsonb_set(v,'{sourceDomains}',(select jsonb_agg(value order by value collate "C") from jsonb_array_elements_text(v->'sourceDomains')));
 perform private.r12_pod_domains(v->'sourceDomains',s.amendment->'sourcePolicy');
 for h in select value from jsonb_array_elements(v->'hypotheses') loop
 perform private.r04_keys(h,array['productType','niche','audience','hypothesis','contraryExplanation']);
 foreach t in array array['productType','niche','audience','hypothesis','contraryExplanation'] loop
 if jsonb_typeof(h->t) is distinct from 'string' or h->>t<>btrim(h->>t) or length(h->>t) not between (case when t in ('hypothesis','contraryExplanation') then 20 else 3 end) and (case when t='productType' then 120 when t in ('niche','audience') then 160 else 400 end) then raise exception 'r12_pod_planner_policy_rejected';end if;end loop;end loop;
 body:=v||jsonb_build_object('version','r12.pod-research-plan.1','scopeId',s.id,'scopeHash',s.amendment_hash,'publicBriefHash',private.stage14_hash(s.amendment->'publicBrief'),'sourcePolicyHash',s.amendment->>'sourcePolicyHash','queryProvenance','application_submitted_query');
 if d->'response'->'result'->>'researchPlanHash' is distinct from private.stage14_hash(body) then raise exception 'r12_pod_accepted_plan_hash_changed';end if;
 return body||jsonb_build_object('planHash',private.stage14_hash(body));
end $$;

create or replace function public.r12_pod_pass_server(p_business_id uuid,p_scope_id uuid,p_operation text,p_payload jsonb,p_server_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.r12_discovery_scopes;setup private.r12_pod_setups;authority private.r12_discovery_authorities;p private.r07_plans;head private.r07_heads;
 d private.r12_pod_passes;closed private.r12_pod_pass_closures;review private.r07_attempts;response private.r07_responses;candidate jsonb;history jsonb;body jsonb;finance jsonb;
 recovery private.r12_pod_recoveries;ordinal integer;paid bigint;ceiling bigint;total bigint;phase text;outcome text;begin
 perform private.r04_safe(p_payload);
 perform 1 from public.businesses where id=p_business_id for update;
 select * into s from private.r12_discovery_scopes where id=p_scope_id and business_id=p_business_id and origin='pod_goal';
 select * into setup from private.r12_pod_setups where id=s.pod_setup_id and business_id=p_business_id;
 select * into authority from private.r12_discovery_authorities where scope_id=s.id and controller_key_hash=encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex');
 perform 1 from private.r07_server_keys k where k.key_hash=authority.controller_key_hash for share;
 if not found then raise exception 'r12_pod_pass_authority_required' using errcode='42501';end if;
 if authority.scope_id is null or authority.receipt_until<=clock_timestamp() or not private.r12_authority_owner_current(authority)
 or not exists(select 1 from private.r07_server_keys k where k.key_hash=authority.controller_key_hash and k.expires_at>clock_timestamp() and not exists(select 1 from private.r07_server_revocations revoked where revoked.key_hash=k.key_hash))
 then raise exception 'r12_pod_pass_authority_required' using errcode='42501';end if;
 select * into head from private.r07_heads where business_id=p_business_id and goal_id=s.goal_id for update;
 select * into p from private.r07_plans where id=head.plan_id and business_id=p_business_id and content=authority.plan and content_hash=authority.plan_hash;
 if p.id is null then raise exception 'r12_pod_pass_plan_required';end if;
 select * into recovery from private.r12_pod_recoveries where scope_id=s.id;
 select pass.* into d from private.r12_pod_passes pass where pass.scope_id=s.id order by pass.ordinal desc limit 1;
 if p_operation='context' then perform private.r04_keys(p_payload,array[]::text[]);return private.r12_pod_pass_context(s.id);
 elsif p_operation='complete' then
 perform private.r04_keys(p_payload,array['actionHash','actionOrdinal']);
 if d.scope_id is null or d.content_hash is distinct from p_payload->>'actionHash' or d.ordinal::text is distinct from p_payload->>'actionOrdinal' then raise exception 'r12_pod_current_pass_required';end if;
 select c.* into closed from private.r12_pod_pass_closures c where c.scope_id=s.id and c.ordinal=d.ordinal;
 if closed.scope_id is not null then return jsonb_build_object('closed',true,'outcome',closed.outcome,'replayed',true);end if;
 if (select count(*) from private.r12_pod_pass_calls call join private.r07_attempts a on a.id=call.attempt_id
 where call.scope_id=s.id and call.ordinal=d.ordinal and a.status='completed' and a.adaptive_action_hash=d.content_hash)<>5
 or exists(select 1 from private.r12_pod_pass_calls call where call.scope_id=s.id and call.ordinal=d.ordinal
 and not exists(select 1 from private.r05_settlements z where z.request_id=call.request_id and z.actual_microunits is not null and z.provider_request_id is not null)) then raise exception 'r12_pod_pass_unsettled';end if;
 select a.* into review from private.r12_pod_pass_calls call join private.r07_attempts a on a.id=call.attempt_id where call.scope_id=s.id and call.ordinal=d.ordinal and call.phase='review';
 candidate:=private.r12_pod_completed_dependency(review,p);select * into response from private.r07_responses where attempt_id=review.id;
 outcome:=candidate->'candidate'->'output'->>'outcome';
 if outcome not in ('HYPOTHESIS_TO_TEST','INSUFFICIENT_EVIDENCE') or response.content->'result'->>'outcome' is distinct from outcome then raise exception 'r12_pod_independent_outcome_required';end if;
 select coalesce(sum(known.actual),0) into paid from private.r12_pod_pass_calls call join lateral(select max(z.actual_microunits) actual from private.r05_settlements z where z.request_id=call.request_id and z.provider_request_id is not null)known on true where call.scope_id=s.id and call.ordinal=d.ordinal;
 insert into private.r12_pod_pass_closures values(s.id,d.ordinal,d.content_hash,review.id,response.content_hash,outcome,paid,clock_timestamp());
 return jsonb_build_object('closed',true,'outcome',outcome,'committedMicrounits',paid::text);
 elsif p_operation<>'admit' then raise exception 'r12_pod_pass_operation_invalid';end if;
 perform private.r04_keys(p_payload,array['quote']);
 if head.state in ('completed','stopped') then return jsonb_build_object('admitted',false,'completed',head.state='completed','stopped',head.state='stopped','reason',head.reason);end if;
 if d.scope_id is not null and not exists(select 1 from private.r12_pod_pass_closures c where c.scope_id=d.scope_id and c.ordinal=d.ordinal) then return jsonb_build_object('admitted',true,'replayed',true);end if;
 select c.* into closed from private.r12_pod_pass_closures c where c.scope_id=s.id order by c.ordinal desc limit 1;
 ordinal:=coalesce(d.ordinal+1,(recovery.proof->>'usedPasses')::integer,0);
 if ordinal<5 and closed.outcome is distinct from 'HYPOTHESIS_TO_TEST' and coalesce((recovery.proof->>'usedCalls')::integer,0)+(select count(*) from private.r12_pod_pass_calls where scope_id=s.id)+5>25 then update private.r07_heads set state='completed',reason='remaining_calls_below_complete_pass' where plan_id=p.id;return jsonb_build_object('admitted',false,'completed',true,'reason','remaining_calls_below_complete_pass');end if;
 if closed.outcome='HYPOTHESIS_TO_TEST' or ordinal>=5 then update private.r07_heads set state='completed',reason=case when ordinal>=5 then 'five_pass_limit' else 'reviewed_hypothesis_ready' end where plan_id=p.id;return jsonb_build_object('admitted',false,'completed',true,'reason',case when ordinal>=5 then 'five_pass_limit' else 'reviewed_hypothesis_ready' end);end if;
 perform private.r12_pod_scope_resolve(s,clock_timestamp(),true);
 if private.r07_gate(p) is not null then raise exception 'r12_pod_pass_gate_closed';end if;
 perform private.r12_pod_quote_check(p_payload->'quote',setup.preview->'quote');
 finance:=private.r12_pod_finance(p_business_id);
 if finance->'hasBlockingUnknown' is distinct from 'false'::jsonb then return jsonb_build_object('admitted',false,'stopped',true,'reason','unbounded_liability');end if;
 ceiling:=(setup.preview->'quote'->>'maximumMicrousd')::bigint;
 select coalesce(sum(held),0) into paid from private.r05_exposure(p_business_id) where policy_id=p.policy_id and currency='USD';
 select coalesce(sum(held),0) into total from private.r05_exposure(p_business_id) where currency='USD';
 if paid+private.r12_adaptive_outstanding_hold(p_business_id,p.policy_id)+ceiling>(s.amendment->>'maximumMicrousd')::bigint
 or total+private.r12_adaptive_outstanding_hold(p_business_id)+ceiling>(finance->>'maximumMicrounits')::bigint then update private.r07_heads set state='completed',reason='remaining_budget_below_quoted_pass' where plan_id=p.id;return jsonb_build_object('admitted',false,'completed',true,'reason','remaining_budget_below_quoted_pass');end if;
 history:=private.r12_pod_pass_history(p,ordinal);
 body:=jsonb_build_object('version','r12.pod-pass.2','scopeId',s.id,'ordinal',ordinal,'previousPassHash',d.content_hash,'previousReviewHash',closed.review_hash,
 'historyHash',private.stage14_hash(coalesce(history,'null'::jsonb)),'quoteHash',p_payload->'quote'->>'quoteHash','maximumMicrounits',ceiling::text,'phases','["plan","search1","select1","strategy","review"]'::jsonb);
 insert into private.r12_pod_passes values(s.id,ordinal,body,private.stage14_hash(body),ceiling,clock_timestamp());
 return jsonb_build_object('admitted',true,'ordinal',ordinal,'actionHash',private.stage14_hash(body),'maximumMicrounits',ceiling::text);
end $$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_reserve_call(private.r07_attempts,private.r05_requests)'::regprocedure);
 if (length(d)-length(replace(d,$old$(select count(*) from private.r12_pod_pass_calls c where c.scope_id=d.scope_id)>=25$old$,'')))/length($old$(select count(*) from private.r12_pod_pass_calls c where c.scope_id=d.scope_id)>=25$old$)<>1 then raise exception 'r12_pod_recovery_patch_drift: private.r12_pod_reserve_call(private.r07_attempts,private.r05_requests)';end if;
 d:=replace(d,$old$(select count(*) from private.r12_pod_pass_calls c where c.scope_id=d.scope_id)>=25$old$,$new$(select count(*) from private.r12_pod_pass_calls c where c.scope_id=d.scope_id)+coalesce((select (proof->>'usedCalls')::integer from private.r12_pod_recoveries where scope_id=d.scope_id),0)>=25$new$);execute d;end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_phase_inputs(private.r07_attempts,private.r07_plans)'::regprocedure);
 if (length(d)-length(replace(d,$old$'amendment',s.amendment,'dependencies',dependencies$old$,'')))/length($old$'amendment',s.amendment,'dependencies',dependencies$old$)<>1 then raise exception 'r12_pod_recovery_patch_drift: private.r12_pod_phase_inputs(private.r07_attempts,private.r07_plans)';end if;
 d:=replace(d,$old$'amendment',s.amendment,'dependencies',dependencies$old$,$new$'recovery',private.r12_pod_recovery_state(s.id),'amendment',s.amendment,'dependencies',dependencies$new$);execute d;end $patch$;

revoke all on function public.r12_pod_recovery_read(uuid,uuid),public.r12_pod_recovery_owner_server(uuid,text,jsonb,text) from public,anon,service_role;
grant execute on function public.r12_pod_recovery_read(uuid,uuid),public.r12_pod_recovery_owner_server(uuid,text,jsonb,text) to authenticated;
revoke all on function private.r12_pod_recovery_context(uuid,uuid),private.r12_pod_recovery_state(uuid),private.r12_pod_plan_lineage(private.r07_plans),private.r12_pod_recovery_plan_guard() from public,anon,authenticated,service_role;


do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_pod_runtime_read(uuid,uuid,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$'ownerId',st.owner_id,'activeWindow'$old$,'')))/length($old$'ownerId',st.owner_id,'activeWindow'$old$)<>1 then raise exception 'r12_pod_recovery_patch_drift: public.r12_pod_runtime_read(uuid,uuid,text)';end if;
 d:=replace(d,$old$'ownerId',st.owner_id,'activeWindow'$old$,$new$'ownerId',st.owner_id,'podRecovery',private.r12_pod_recovery_state(s.id),'activeWindow'$new$);execute d;end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_owner_read_before_funding_proof(uuid,uuid,boolean)'::regprocedure);
 if (length(d)-length(replace(d,$old$'planVersion',saved_plan.version,'nextReviewScopeId'$old$,'')))/length($old$'planVersion',saved_plan.version,'nextReviewScopeId'$old$)<>1 then raise exception 'r12_pod_recovery_patch_drift: private.r12_discovery_owner_read_before_funding_proof(uuid,uuid,boolean)';end if;
 d:=replace(d,$old$'planVersion',saved_plan.version,'nextReviewScopeId'$old$,$new$'planVersion',saved_plan.version,'podRecovery',private.r12_pod_recovery_state(source_scope.id),'nextReviewScopeId'$new$);execute d;end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.r07_controller(uuid,uuid,text,jsonb,uuid,text,text,bigint,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$s->>'key',coalesce(old.attempt,0)+1,private.r04_hash(pins)$old$,'')))/length($old$s->>'key',coalesce(old.attempt,0)+1,private.r04_hash(pins)$old$)<>1 then raise exception 'r12_pod_recovery_patch_drift: public.r07_controller(uuid,uuid,text,jsonb,uuid,text,text,bigint,text)';end if;
 d:=replace(d,$old$s->>'key',coalesce(old.attempt,0)+1,private.r04_hash(pins)$old$,$new$s->>'key',case when p.content->>'format'='r12.pod-research.2' and exists(select 1 from private.r12_pod_recoveries where plan_id=p.id) then (clean->>'actionOrdinal')::integer+1 else coalesce(old.attempt,0)+1 end,private.r04_hash(pins)$new$);execute d;end $patch$;

revoke all on function private.r12_pod_utf16_length(text),private.r12_pod_length_classification(jsonb,jsonb,jsonb,jsonb,text) from public,anon,authenticated,service_role;

commit;
