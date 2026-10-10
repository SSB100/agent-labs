-- Reviewed, direct-only finite enrollment. Definitions only: this migration
-- publishes no review, grant, profile, tariff, credential or provider operation.
begin;
-- Register only the declared direct-source adapter. This is a catalog type,
-- never a generic executor permission or an installed/qualified release.
alter table public.pack_capability_definitions drop constraint pack_capability_definitions_adapter_check;
alter table public.pack_capability_definitions add constraint pack_capability_definitions_adapter_check check(
 adapter in ('structured.mapping','web.research','image.generate','printful.foundation','etsy.drafts')
 or (capability_key='browser.etsy.insights.read_only' and adapter='browser.etsy.insights.read_only'));
create table private.r12_direct_enrollment_packages(
 package_hash text primary key check(package_hash=private.stage14_hash(content)),
 business_id uuid not null references public.businesses(id),goal_id uuid not null,owner_id uuid not null,
 grant_id uuid not null unique,profile_id uuid not null unique,root_id uuid not null references private.r12_owner_grant_roots(id),
 content jsonb not null,review_evidence jsonb not null,review_evidence_hash text not null check(review_evidence_hash=private.stage14_hash(review_evidence)),
 operator_role text not null,operator_session_role text not null,expires_at timestamptz not null check(isfinite(expires_at)),created_at timestamptz not null default clock_timestamp(),
 foreign key(goal_id,business_id) references private.r04_goal_state(goal_id,business_id));
create table private.r12_direct_enrollment_revocations(package_hash text primary key references private.r12_direct_enrollment_packages(package_hash),reason text not null,created_at timestamptz not null default clock_timestamp());
create table private.r12_direct_enrollment_proposals(
 id uuid primary key,business_id uuid not null references public.businesses(id),goal_id uuid not null,owner_id uuid not null,
 package_hash text not null references private.r12_direct_enrollment_packages(package_hash),content jsonb not null,proposal_hash text not null check(proposal_hash=private.stage14_hash(content)),
 expires_at timestamptz not null,created_at timestamptz not null default clock_timestamp());
-- Inserted in the same transaction before the root-revision grant. This purpose
-- mapping is not an activation and cannot itself authorize any paid request.
create table private.r12_direct_enrollment_grants(
 grant_id uuid primary key,package_hash text not null unique references private.r12_direct_enrollment_packages(package_hash),
 proposal_id uuid not null unique references private.r12_direct_enrollment_proposals(id),root_revision integer not null,root_revision_hash text not null,
 owner_id uuid not null,created_at timestamptz not null default clock_timestamp(),
 foreign key(grant_id) references private.r12_owner_bootstrap_grants(id) deferrable initially deferred);
create table private.r12_direct_enrollment_submissions(
 business_id uuid not null references public.businesses(id),submission_id uuid not null,operation text not null check(operation in ('prepare','confirm')),
 input_hash text not null,proposal_id uuid not null references private.r12_direct_enrollment_proposals(id),primary key(business_id,submission_id));
create index r12_direct_enrollment_owner on private.r12_direct_enrollment_packages(business_id,goal_id,owner_id,created_at desc);
create index r12_direct_enrollment_proposal_owner on private.r12_direct_enrollment_proposals(business_id,goal_id,owner_id,created_at desc);
create function private.r12_direct_enrollment_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op<>'INSERT' or current_user in ('anon','authenticated','service_role') then raise exception 'r12_enrollment_trusted_immutable_required' using errcode='42501';end if;
 if tg_table_name='r12_direct_enrollment_revocations' then
  perform 1 from public.businesses where id=(select business_id from private.r12_direct_enrollment_packages where package_hash=new.package_hash) for update;
  perform 1 from private.r12_owner_grant_roots where id=(select root_id from private.r12_direct_enrollment_packages where package_hash=new.package_hash) for update;
  perform 1 from private.r12_direct_enrollment_packages where package_hash=new.package_hash for update;
 end if;return new;
end $$;
do $$ declare n text;begin foreach n in array array['r12_direct_enrollment_packages','r12_direct_enrollment_revocations','r12_direct_enrollment_proposals','r12_direct_enrollment_grants','r12_direct_enrollment_submissions'] loop
 execute format('alter table private.%I enable row level security',n);execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);
 execute format('create trigger enrollment_immutable before insert or update or delete on private.%I for each row execute function private.r12_direct_enrollment_immutable()',n);
end loop;end $$;

create function private.r12_direct_enrollment_state(b uuid,g uuid,r uuid) returns jsonb language plpgsql set search_path='' as $$
declare rt private.r12_owner_grant_roots;rv private.r12_owner_grant_root_revisions;binding private.r12_owner_funding_bindings;gv private.r04_goal_versions;bv private.r04_business_versions;usage jsonb;origin jsonb;funding jsonb;begin
 perform 1 from public.businesses where id=b for update;
 select * into strict rt from private.r12_owner_grant_roots where id=r and business_id=b for update;
 select * into strict binding from private.r12_owner_funding_bindings where id=rt.binding_id and business_id=b for update;
 if binding.kind='legacy_research_root' then perform 1 from public.product_experiments where id=binding.authority_root_id and business_id=b for update;if not found then raise exception 'r12_enrollment_original_root_required';end if;end if;
 perform 1 from private.r07_heads where business_id=b and goal_id=g for update;
 select * into rv from private.r12_owner_grant_root_revisions where root_id=r order by revision desc limit 1;
 select v.* into strict gv from private.r04_goal_versions v join private.r04_goal_state s using(business_id,goal_id,revision) where v.business_id=b and v.goal_id=g;
 select v.* into strict bv from private.r04_business_versions v join private.r04_business_state s using(business_id,revision) where v.business_id=b;
 if gv.preference is distinct from 'ready' or bv.preference is distinct from 'setup' then raise exception 'r12_enrollment_current_origin_unavailable';end if;
 origin:=private.r12_direct_origin_build(b,g);funding:=private.r12_direct_funding_snapshot(b);usage:=private.r12_direct_grant_usage(r);
 return jsonb_build_object('businessRevision',bv.revision,'businessHash',bv.content_hash,'goalRevision',gv.revision,'goalHash',gv.content_hash,
 'bindingId',binding.id,'authorityRootId',binding.authority_root_id,'originHash',private.stage14_hash(origin),'fundingSnapshotHash',private.stage14_hash(funding),
 'currentGrantRoot',jsonb_build_object('rootId',r,'revision',coalesce(rv.revision,0),'revisionHash',coalesce(rv.content_hash,private.r12_owner_grant_root_genesis(rt)),
 'maximumScopes',coalesce(rv.maximum_scopes,rt.maximum_scopes),'maximumAllocationMicrounits',coalesce(rv.maximum_allocation_microunits,rt.maximum_allocation_microunits)::text,
 'scopesUsed',usage->'scopes','allocationUsedMicrounits',usage->>'allocationMicrounits'));
end $$;

create function private.r12_direct_enrollment_package_active(h text) returns private.r12_direct_enrollment_packages language plpgsql set search_path='' as $$
declare p private.r12_direct_enrollment_packages;begin
 select * into strict p from private.r12_direct_enrollment_packages where package_hash=h;
 if p.package_hash is distinct from private.stage14_hash(p.content) or p.review_evidence_hash is distinct from private.stage14_hash(p.review_evidence)
 or p.content->>'reviewEvidenceHash' is distinct from p.review_evidence_hash then raise exception 'r12_enrollment_review_corrupt';end if;
 if p.expires_at<=clock_timestamp() or (p.content->>'validFrom')::timestamptz>clock_timestamp()
 or exists(select 1 from private.r12_direct_enrollment_revocations where package_hash=h)
 then raise exception 'r12_enrollment_review_inactive';end if;
 if not exists(select 1 from public.businesses where id=p.business_id and owner_user_id=p.owner_id) then raise exception 'r12_enrollment_owner_changed' using errcode='42501';end if;
 return p;
end $$;

-- This fingerprint authenticates deployed database definitions/ACLs, not remote
-- CI truth. External facts are the separately recorded trusted-operator review.
create function private.r12_direct_enrollment_definition_hash() returns text language sql stable set search_path='' as $$
 select encode(extensions.digest(convert_to(coalesce(string_agg(
 encode(extensions.digest(convert_to(concat_ws(E'\n',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),
 pg_get_functiondef(p.oid),coalesce(p.proacl::text,''),coalesce(p.proconfig::text,''),p.proowner::text),'UTF8'),'sha256'),'hex'),
 '' order by n.nspname collate "C",p.proname collate "C",pg_get_function_identity_arguments(p.oid) collate "C"),''),'UTF8'),'sha256'),'hex')
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('private','public')
 and (p.proname like 'r12_%' or p.proname like 'r05_%' or p.proname like 'r07_%' or p.proname like 'stage13v2_budget_authority%')
$$;
create function private.r12_direct_enrollment_evidence(package jsonb,evidence jsonb) returns void language plpgsql set search_path='' as $$
declare release jsonb:=evidence->'release';provider jsonb:=evidence->'provider';pk public.packs;x jsonb;k text;pins jsonb:=package->'grantReview'->'researchPins';snapshot jsonb;worker public.worker_definitions;workflow public.workflow_definitions;names text[]:='{}';begin
 perform private.r12_direct_scan(evidence);perform private.r04_keys(evidence,array['version','reviewedAt','expiresAt','release','provider','security','pack','model']);
 perform private.r04_keys(release,array['repository','commitSha','treeSha','databaseDefinitionHash','qualificationRuns','deploymentReceiptHash']);
 perform private.r04_keys(provider,array['provider','providerProjectId','providerAccountHash','credentialBindingHash','projectReadbackHash','tariffEvidenceHash','settlementContractHash','retentionReviewHash']);
 perform private.r04_keys(evidence->'security',array['approvalHash','scope','recordHash']);
 perform private.r04_keys(evidence->'pack',array['packId','manifestHash','qualificationHash']);
 perform private.r04_keys(evidence->'model',array['inferenceCatalogHash','routeReviewHash','schemaReviewHash','dataUseReviewHash','inferenceContract']);
 if evidence->'model'->'inferenceContract' is distinct from '{"version":"r12.direct-inference-contract.1","publicQuoteVersion":"r12.public-research-quote.3","inferenceQuoteVersion":"r12.direct-inference-quote.1","catalogVersion":"r12.direct-inference-catalog.1","luna":{"modelId":"openai/gpt-5.6-luna","canonicalModelId":"openai/gpt-5.6-luna-20260709","endpoint":"azure/us","providerName":"Azure"},"reviewer":{"modelId":"anthropic/claude-sonnet-4.6","canonicalModelId":"anthropic/claude-4.6-sonnet-20260217","endpoint":"amazon-bedrock/us","providerName":"Amazon Bedrock"}}'::jsonb then raise exception 'r12_enrollment_inference_contract_required';end if;
 if evidence->>'version' is distinct from 'r12.direct-enrollment-operator-review.1' or evidence->>'reviewedAt' is null or evidence->>'expiresAt' is null
 or not isfinite((evidence->>'reviewedAt')::timestamptz) or not isfinite((evidence->>'expiresAt')::timestamptz)
 or (evidence->>'reviewedAt')::timestamptz>clock_timestamp() or (evidence->>'expiresAt')::timestamptz<=(evidence->>'reviewedAt')::timestamptz
 or (evidence->>'expiresAt')::timestamptz<(package->>'expiresAt')::timestamptz
 or package->>'reviewEvidenceHash' is distinct from private.stage14_hash(evidence)
 or release->>'repository' is distinct from 'SSB100/agent-labs' or coalesce(release->>'commitSha','')!~'^[a-f0-9]{40}$' or coalesce(release->>'treeSha','')!~'^[a-f0-9]{40}$'
 or release->>'databaseDefinitionHash' is distinct from private.r12_direct_enrollment_definition_hash()
 or provider->>'provider' is distinct from 'steel' or evidence->'security'->>'scope' is distinct from 'r12.direct-steel-insights.1'
 or evidence->'model'->>'inferenceCatalogHash' is distinct from package->'grantReview'->'researchPins'->>'inferenceCatalogHash'
 then raise exception 'r12_enrollment_independent_review_required';end if;
 foreach k in array array['databaseDefinitionHash','deploymentReceiptHash'] loop if coalesce(release->>k,'')!~'^[a-f0-9]{64}$' then raise exception 'r12_enrollment_release_evidence_required';end if;end loop;
 foreach k in array array['providerAccountHash','credentialBindingHash','projectReadbackHash','tariffEvidenceHash','settlementContractHash','retentionReviewHash'] loop if coalesce(provider->>k,'')!~'^[a-f0-9]{64}$' then raise exception 'r12_enrollment_provider_evidence_required';end if;end loop;
 foreach k in array array['approvalHash','recordHash'] loop if coalesce(evidence->'security'->>k,'')!~'^[a-f0-9]{64}$' then raise exception 'r12_enrollment_security_approval_required';end if;end loop;
 foreach k in array array['inferenceCatalogHash','routeReviewHash','schemaReviewHash','dataUseReviewHash'] loop if coalesce(evidence->'model'->>k,'')!~'^[a-f0-9]{64}$' then raise exception 'r12_enrollment_model_review_required';end if;end loop;
 if jsonb_typeof(release->'qualificationRuns') is distinct from 'array' or jsonb_array_length(release->'qualificationRuns')<>3 then raise exception 'r12_enrollment_release_evidence_required';end if;
 for x in select value from jsonb_array_elements(release->'qualificationRuns') loop
 perform private.r04_keys(x,array['workflow','runId','headSha','conclusion','artifactHash']);
 if x->>'workflow' not in ('ci.yml','direct-etsy-qualification.yml','etsy-browser-boundary.yml') or coalesce(x->>'runId','')!~'^[1-9][0-9]{0,19}$'
 or x->>'headSha' is distinct from release->>'commitSha' or x->>'conclusion' is distinct from 'success' or coalesce(x->>'artifactHash','')!~'^[a-f0-9]{64}$'
 or x->>'workflow'=any(names) then raise exception 'r12_enrollment_release_evidence_required';end if;names:=array_append(names,x->>'workflow');end loop;
 if cardinality(names)<>3 or not(names@>array['ci.yml','direct-etsy-qualification.yml','etsy-browser-boundary.yml']) then raise exception 'r12_enrollment_release_evidence_required';end if;
 select * into pk from public.packs where id=(evidence->'pack'->>'packId')::uuid;
 if pk.id is null or pk.status<>'qualified' or pk.id::text is distinct from package->'grantReview'->'researchPins'->>'packId'
 or private.stage14_hash(pk.manifest) is distinct from evidence->'pack'->>'manifestHash'
 or private.stage14_hash(pk.qualification_evidence) is distinct from evidence->'pack'->>'qualificationHash'
 or jsonb_typeof(pk.qualification_evidence) is distinct from 'object' or not(pk.qualification_evidence?'source')
 or exists(select 1 from jsonb_array_elements_text(pk.manifest->'evals') v where pk.qualification_evidence->'checks'->>v is distinct from 'passed')
 then raise exception 'r12_enrollment_qualified_release_required';end if;
 snapshot:=jsonb_build_object('rootPackId',pk.id,'releases',private.stage10_resolve(pk.id,true));
 if pins->'snapshot' is distinct from snapshot or pins->>'snapshotHash' is distinct from private.r04_hash(snapshot)
 or exists(select 1 from jsonb_array_elements(snapshot->'releases') release_row where release_row->>'status' is distinct from 'qualified')
 then raise exception 'r12_enrollment_installed_release_required';end if;
 foreach k in array array['plan','source','strategy','review'] loop
 select * into worker from public.worker_definitions where id=(pins->'workers'->k->>'id')::uuid;
 if worker.id is null or worker.status<>'qualified' or private.r04_hash(to_jsonb(worker)) is distinct from pins->'workers'->k->>'hash'
 or not exists(select 1 from jsonb_array_elements(snapshot->'releases') release_row cross join lateral jsonb_array_elements(release_row->'manifest'->'workers') item
 where (release_row->>'id')::uuid=worker.pack_id and item->'manifest'->'worker'->>'workerKey'=worker.worker_key and item->'manifest'->'worker'->>'version'=worker.version)
 then raise exception 'r12_enrollment_worker_release_required';end if;
 if k<>'source' and (worker.worker_key is distinct from 'product.discovery-direct.'||k or worker.version is distinct from '1.0.0'
 or worker.model_requirements->>'executionMode' is distinct from 'r12.direct-model'
 or worker.model_requirements->>'qualificationScope' is distinct from 'r12_direct_controller_only'
 or worker.model_requirements->>'providerModelId' is distinct from evidence->'model'->'inferenceContract'->(case when k='review' then 'reviewer' else 'luna' end)->>'modelId'
 or worker.model_requirements->>'canonicalModelId' is distinct from evidence->'model'->'inferenceContract'->(case when k='review' then 'reviewer' else 'luna' end)->>'canonicalModelId'
 or worker.model_requirements->>'endpoint' is distinct from evidence->'model'->'inferenceContract'->(case when k='review' then 'reviewer' else 'luna' end)->>'endpoint')
 then raise exception 'r12_enrollment_model_release_required';end if;end loop;
 select * into workflow from public.workflow_definitions where id=(pins->>'workflowDefinitionId')::uuid;
 if workflow.id is null or workflow.status<>'qualified' or workflow.pack_id<>pk.id or private.r04_hash(to_jsonb(workflow)) is distinct from pins->>'workflowHash'
 or not exists(select 1 from jsonb_array_elements(pk.manifest->'workflows') item where item->>'key'=workflow.workflow_key and item->>'version'=workflow.version)
 then raise exception 'r12_enrollment_workflow_release_required';end if;
end $$;

-- Only these five reviewed fact types can be published. Definitions and pack
-- installations must already exist through their established release APIs.
create function private.r12_direct_enrollment_registries(package jsonb,evidence jsonb) returns void language plpgsql set search_path='' as $$
declare reg jsonb:=package->'registry';r jsonb:=reg->'browserRoute';o jsonb:=reg->'ownerRenderer';s jsonb:=reg->'sourceQualification';v jsonb:=reg->'verificationCandidate';w jsonb:=reg->'researchRenderer';
 route private.r12_direct_browser_routes;old jsonb;op jsonb;k text;e private.r12_direct_test_envelopes;project uuid;expiry timestamptz:=(package->>'expiresAt')::timestamptz;begin
 perform private.r04_keys(reg,array['browserRoute','ownerRenderer','sourceQualification','verificationCandidate','researchRenderer']);
 perform private.r04_keys(r,array['route_hash','tariff_hash','qualification_hash','credential_binding_hash','provider_project_id','provider_account_hash','maximum_session_ms','maximum_session_microunits','settlement_contract_hash','content','content_hash','valid_from','valid_until']);
 perform private.r04_keys(o,array['route_hash','provider_project_id','policy','policy_hash','review_hash','valid_from','valid_until']);
 perform private.r04_keys(s,array['qualification_hash','worker_definition_id','worker_hash','workflow_definition_id','workflow_hash','provider_project_id','route_hash','source_policy_hash','capture_policy_hash','purpose','content','valid_from','valid_until']);
 perform private.r04_keys(v,array['review_hash','route_hash','provider_project_id','policy_hash','content','valid_from','valid_until']);
 perform private.r04_keys(w,array['review_hash','qualification_hash','candidate_review_hash','route_hash','provider_project_id','policy_hash','content','valid_from','valid_until']);
 route:=jsonb_populate_record(null::private.r12_direct_browser_routes,r);project:=route.provider_project_id;
 if project is null or evidence->'provider'->>'providerProjectId' is distinct from project::text
 or evidence->'provider'->>'providerAccountHash' is distinct from route.provider_account_hash
 or evidence->'provider'->>'credentialBindingHash' is distinct from route.credential_binding_hash
 or evidence->'provider'->>'tariffEvidenceHash' is distinct from route.tariff_hash
 or evidence->'provider'->>'settlementContractHash' is distinct from route.settlement_contract_hash
 or route.content_hash is distinct from private.stage14_hash(route.content)
 or route.content->>'version' is distinct from 'r12.steel-browser-route.1'
 or route.content->'usageBound' is distinct from jsonb_build_object('version','r12.steel-usage-bound.1','maximumProxyBytes',0,'tariffCoversSessionAndProfileLifecycle',true,'captchaDisabled',true,'extraServicesDisabled',true)
 or coalesce(route.content->>'priceEvidenceHash','')!~'^[a-f0-9]{64}$' or jsonb_typeof(route.content->'retentionDisclosure') is distinct from 'string' or length(route.content->>'retentionDisclosure') not between 20 and 2000
 or route.valid_from>clock_timestamp() or route.valid_until<expiry or route.maximum_session_ms not between 15000 and 900000 or route.maximum_session_microunits not between 1 and 10000000
 then raise exception 'r12_enrollment_tariff_project_review_required';end if;
 perform private.r04_keys(route.content,array['version','usageBound','priceEvidenceHash','retentionDisclosure']);
 foreach k in array array['setupOperation','verificationOperation'] loop
 op:=package->'grantReview'->k;perform private.r04_keys(op,array['operationKey','workflowDefinitionId','workflowHash','qualificationHash','routeHash','maximumMicrounits']);
 if op->>'operationKey' is distinct from (case when k='setupOperation' then 'browser.etsy.owner_handoff.create' else 'browser.etsy.account_verification.create' end)
 or op->>'workflowDefinitionId' is distinct from package->'grantReview'->'researchPins'->>'workflowDefinitionId' or op->>'workflowHash' is distinct from package->'grantReview'->'researchPins'->>'workflowHash'
 or op->>'qualificationHash' is distinct from route.qualification_hash or op->>'routeHash' is distinct from route.route_hash
 or private.r05_money(op->'maximumMicrounits')<route.maximum_session_microunits or private.r05_money(op->'maximumMicrounits')>=private.r05_money(package->'grantReview'->'maximumTestMicrounits')
 then raise exception 'r12_enrollment_setup_bounds_required';end if;end loop;
 if private.r05_money(package->'grantReview'->'setupOperation'->'maximumMicrounits')+private.r05_money(package->'grantReview'->'verificationOperation'->'maximumMicrounits')>=private.r05_money(package->'grantReview'->'maximumTestMicrounits') then raise exception 'r12_enrollment_setup_bounds_required';end if;
 if o->>'route_hash' is distinct from route.route_hash or o->>'provider_project_id' is distinct from project::text or o->>'policy_hash' is distinct from private.stage14_hash(o->'policy')
 or o->'policy'->>'version' is distinct from 'etsy.owner-bootstrap-policy.1' or (o->>'valid_from')::timestamptz>clock_timestamp() or (o->>'valid_until')::timestamptz<expiry
 or o->>'review_hash' is distinct from private.stage14_hash(o-'review_hash')
 then raise exception 'r12_enrollment_owner_renderer_review_required';end if;
 perform private.r12_direct_owner_bootstrap_check(o->'policy');
 if s->>'qualification_hash' is distinct from private.stage14_hash(s->'content') or s->>'route_hash' is distinct from route.route_hash or s->>'provider_project_id' is distinct from project::text
 or s->>'purpose' is distinct from 'etsy_insights_read_only' or s->'content'->'rendererPolicy'->>'version' is distinct from 'etsy.insights-renderer-research-policy.4'
 or (s->>'valid_from')::timestamptz>clock_timestamp() or (s->>'valid_until')::timestamptz<expiry
 or v->>'route_hash' is distinct from route.route_hash or v->>'provider_project_id' is distinct from project::text or v->>'review_hash' is distinct from private.stage14_hash(v->'content')
 or w->>'qualification_hash' is distinct from s->>'qualification_hash' or w->>'candidate_review_hash' is distinct from v->>'review_hash'
 or w->>'route_hash' is distinct from route.route_hash or w->>'provider_project_id' is distinct from project::text or w->>'review_hash' is distinct from private.stage14_hash(w->'content')
 or (v->>'valid_from')::timestamptz>clock_timestamp() or (v->>'valid_until')::timestamptz<expiry or (w->>'valid_from')::timestamptz>clock_timestamp() or (w->>'valid_until')::timestamptz<expiry
 then raise exception 'r12_enrollment_source_review_required';end if;
 -- Exact retries may reuse the same immutable facts; conflicting replacements
 -- fail rather than updating a historical review or refreshing its validity.
 select to_jsonb(x) into old from private.r12_direct_browser_routes x where route_hash=route.route_hash;
 if old is null then insert into private.r12_direct_browser_routes select (jsonb_populate_record(null::private.r12_direct_browser_routes,r)).*;elsif old is distinct from to_jsonb(route) then raise exception 'r12_enrollment_registry_conflict';end if;
 select to_jsonb(x) into old from private.r12_direct_owner_renderer_reviews x where route_hash=route.route_hash;
 if old is null then insert into private.r12_direct_owner_renderer_reviews select (jsonb_populate_record(null::private.r12_direct_owner_renderer_reviews,o)).*;elsif old is distinct from to_jsonb(jsonb_populate_record(null::private.r12_direct_owner_renderer_reviews,o)) then raise exception 'r12_enrollment_registry_conflict';end if;
 select to_jsonb(x) into old from private.r12_direct_source_qualifications x where qualification_hash=s->>'qualification_hash';
 if old is null then insert into private.r12_direct_source_qualifications select (jsonb_populate_record(null::private.r12_direct_source_qualifications,s)).*;elsif old is distinct from to_jsonb(jsonb_populate_record(null::private.r12_direct_source_qualifications,s)) then raise exception 'r12_enrollment_registry_conflict';end if;
 select to_jsonb(x) into old from private.r12_verification_candidate_reviews x where review_hash=v->>'review_hash';
 if old is null then insert into private.r12_verification_candidate_reviews select (jsonb_populate_record(null::private.r12_verification_candidate_reviews,v)).*;elsif old is distinct from to_jsonb(jsonb_populate_record(null::private.r12_verification_candidate_reviews,v)) then raise exception 'r12_enrollment_registry_conflict';end if;
 select to_jsonb(x) into old from private.r12_proof_bound_source_reviews x where review_hash=w->>'review_hash';
 if old is null then insert into private.r12_proof_bound_source_reviews select (jsonb_populate_record(null::private.r12_proof_bound_source_reviews,w)).*;elsif old is distinct from to_jsonb(jsonb_populate_record(null::private.r12_proof_bound_source_reviews,w)) then raise exception 'r12_enrollment_registry_conflict';end if;
 perform private.r12_candidate_review(v->>'review_hash',route.route_hash,project);
 perform private.r12_research_renderer_review(s->>'qualification_hash',v->>'review_hash');
 e.business_id:=(package->>'businessId')::uuid;e.expires_at:=expiry;e.content:=package->'grantReview';
 perform private.r12_direct_research_pins(e);perform private.r12_direct_profile(e,'{}'::jsonb,expiry);
 if exists(select 1 from private.r12_direct_browser_route_revocations where route_hash=route.route_hash)
 or exists(select 1 from private.r12_direct_owner_renderer_revocations where route_hash=route.route_hash)
 or exists(select 1 from private.r12_direct_source_qualification_revocations where qualification_hash=s->>'qualification_hash')
 or exists(select 1 from private.r12_verification_candidate_revocations where review_hash=v->>'review_hash')
 or exists(select 1 from private.r12_proof_bound_source_revocations where review_hash=w->>'review_hash')
 then raise exception 'r12_enrollment_review_inactive';end if;
end $$;

create function private.r12_direct_publish_enrollment_review(p_package jsonb,p_review_evidence jsonb) returns jsonb language plpgsql set search_path='' as $$
declare h text:=private.stage14_hash(p_package);p private.r12_direct_enrollment_packages;state jsonb;review private.r12_direct_grant_reviews;profile jsonb;
 old_profile private.r12_owner_profiles;scope private.r12_discovery_scopes;selection jsonb;template jsonb:=p_package->'grantReview'->'profileTemplate';created timestamptz:=clock_timestamp();expiry timestamptz;begin
 if current_user in ('anon','authenticated','service_role') or not pg_has_role(current_user,(select proowner from pg_proc where oid='private.r12_direct_publish_enrollment_review(jsonb,jsonb)'::regprocedure),'USAGE') then raise exception 'r12_enrollment_operator_required' using errcode='42501';end if;
 perform private.r12_direct_scan(p_package);perform private.r04_keys(p_package,array['version','businessId','goalId','ownerId','grantId','serverKeyHash','rootId','profileId','originProfileId','originProfileHash','expectedState','grantReview','registry','validFrom','expiresAt','reviewEvidenceHash']);
 if p_package->>'version' is distinct from 'r12.direct-enrollment-package.1' or coalesce(p_package->>'serverKeyHash','')!~'^[a-f0-9]{64}$'
 or jsonb_typeof(p_package->'validFrom') is distinct from 'string' or jsonb_typeof(p_package->'expiresAt') is distinct from 'string'
 or not isfinite((p_package->>'validFrom')::timestamptz) or not isfinite((p_package->>'expiresAt')::timestamptz)
 then raise exception 'r12_enrollment_package_required';end if;expiry:=(p_package->>'expiresAt')::timestamptz;
 select * into p from private.r12_direct_enrollment_packages where package_hash=h;
 if found then
  if p.review_evidence is distinct from p_review_evidence then raise exception 'r12_enrollment_idempotency_conflict';end if;
  return jsonb_build_object('version','r12.direct-enrollment-publication.1','reviewedPackageHash',h,'businessId',p.business_id,'goalId',p.goal_id,'ownerId',p.owner_id,'grantId',p.grant_id,'expiresAt',private.r12_direct_time(p.expires_at),'authorityCreated',false);
 end if;
 if expiry<=created+interval '35 minutes' or expiry>(p_package->>'validFrom')::timestamptz+interval '31 days' or (p_package->>'validFrom')::timestamptz>created
 or not exists(select 1 from public.businesses where id=(p_package->>'businessId')::uuid and owner_user_id=(p_package->>'ownerId')::uuid)
 or exists(select 1 from private.r12_owner_bootstrap_grants where id=(p_package->>'grantId')::uuid)
 or exists(select 1 from private.r12_owner_profiles where id=(p_package->>'profileId')::uuid)
 then raise exception 'r12_enrollment_package_identity_required';end if;
 state:=private.r12_direct_enrollment_state((p_package->>'businessId')::uuid,(p_package->>'goalId')::uuid,(p_package->>'rootId')::uuid);
 if state is distinct from p_package->'expectedState' then raise exception 'r12_enrollment_current_snapshot_changed';end if;
 perform private.r12_direct_enrollment_evidence(p_package,p_review_evidence);
 perform private.r04_keys(p_package->'grantReview',array['version','grantId','goalId','goalRevision','goalHash','providerProjectId','routeHash','maximumTestMicrounits','maximumAttemptsInWindow','cumulativeDispatchesCeiling','setupOperation','verificationOperation','researchPins','profileTemplate','approvalHash','expiresAt']);
 if p_package->'grantReview'->>'version' is distinct from 'r12.direct-grant-review.1' or p_package->'grantReview'->'grantId' is distinct from p_package->'grantId'
 or p_package->'grantReview'->'goalId' is distinct from p_package->'goalId' or p_package->'grantReview'->'goalRevision' is distinct from state->'goalRevision'
 or p_package->'grantReview'->'goalHash' is distinct from state->'goalHash' or p_package->'grantReview'->>'providerProjectId' is distinct from p_package->'registry'->'browserRoute'->>'provider_project_id'
 or p_package->'grantReview'->>'routeHash' is distinct from p_package->'registry'->'browserRoute'->>'route_hash'
 or (p_package->'grantReview'->>'expiresAt')::timestamptz is distinct from expiry or coalesce(p_package->'grantReview'->>'approvalHash','')!~'^[a-f0-9]{64}$'
 or coalesce(p_package->'grantReview'->>'maximumTestMicrounits','')!~'^[1-9][0-9]{0,7}$' or private.r05_money(p_package->'grantReview'->'maximumTestMicrounits')>10000000
 or jsonb_typeof(p_package->'grantReview'->'maximumAttemptsInWindow') is distinct from 'number' or coalesce(p_package->'grantReview'->>'maximumAttemptsInWindow','')!~'^[1-9][0-9]?$'
 or (p_package->'grantReview'->>'maximumAttemptsInWindow')::integer>32 or jsonb_typeof(p_package->'grantReview'->'cumulativeDispatchesCeiling') is distinct from 'number'
 or (p_package->'grantReview'->>'cumulativeDispatchesCeiling')::integer not between 4 and 64
 or template->>'id' is distinct from p_package->>'profileId' then raise exception 'r12_enrollment_review_bounds_required';end if;
 select * into old_profile from private.r12_owner_profiles where id=(p_package->>'originProfileId')::uuid and profile_hash=p_package->>'originProfileHash';
 select scope_row.* into strict scope from private.r07_heads head_row join private.r07_plans plan_row on plan_row.id=head_row.plan_id join private.r12_discovery_scopes scope_row on scope_row.id=(plan_row.content->>'discoveryScopeId')::uuid where head_row.business_id=(p_package->>'businessId')::uuid and head_row.goal_id=(p_package->>'goalId')::uuid;
 if old_profile.id is null or old_profile.profile_hash is distinct from private.stage14_hash(old_profile.profile)
 or not exists(select 1 from private.r12_owner_bootstrap_grants g where g.root_id=(p_package->>'rootId')::uuid and g.business_id=(p_package->>'businessId')::uuid and g.owner_id=(p_package->>'ownerId')::uuid and g.profile_id=old_profile.id)
 or scope.amendment->>'profileHash' is distinct from old_profile.profile_hash
 then raise exception 'r12_enrollment_historical_profile_required';end if;
 selection:=scope.amendment->'intent'->'comparisonUniverse';
 if template->'markets' is distinct from selection->'markets' or template->>'audience' is distinct from selection->'audiences'->>0
 or template->>'productFormat' is distinct from selection->>'productType'
 or template->>'marketSetKey' is distinct from scope.amendment->'selection'->>'marketSetKey' or template->>'topicKey' is distinct from scope.amendment->'selection'->>'topicKey'
 or template->>'publicGoal' is distinct from (select goal_row.content->>'objective' from private.r04_goal_versions goal_row
 where goal_row.business_id=(p_package->>'businessId')::uuid and goal_row.goal_id=(p_package->>'goalId')::uuid
 and goal_row.revision=(state->>'goalRevision')::integer and goal_row.content_hash=state->>'goalHash')
 then raise exception 'r12_enrollment_original_selection_required';end if;
 perform private.r12_direct_enrollment_registries(p_package,p_review_evidence);
 profile:=jsonb_build_object('version','r12.direct-source-profile-review.1','id',p_package->'profileId','businessId',p_package->'businessId','goalId',p_package->'goalId','goalHash',state->'goalHash',
 'originProfileId',old_profile.id,'originProfileHash',old_profile.profile_hash,'profileTemplate',template,'sourcePurpose','etsy_insights_aggregate_research',
 'sourcePolicyHash',p_package->'grantReview'->'researchPins'->'sourcePolicyHash','capturePolicyHash',p_package->'grantReview'->'researchPins'->'capturePolicyHash',
 'validFrom',private.r12_direct_time((p_package->>'validFrom')::timestamptz),'validUntil',private.r12_direct_time(expiry),'reviewEvidenceHash',p_package->'reviewEvidenceHash');
 insert into private.r12_owner_profiles(id,profile,profile_hash,pins,pins_hash) values((p_package->>'profileId')::uuid,profile,private.stage14_hash(profile),p_package->'grantReview'->'researchPins',private.stage14_hash(p_package->'grantReview'->'researchPins'));
 insert into private.r12_direct_enrollment_packages(package_hash,business_id,goal_id,owner_id,grant_id,profile_id,root_id,content,review_evidence,review_evidence_hash,operator_role,operator_session_role,expires_at)
 values(h,(p_package->>'businessId')::uuid,(p_package->>'goalId')::uuid,(p_package->>'ownerId')::uuid,(p_package->>'grantId')::uuid,(p_package->>'profileId')::uuid,(p_package->>'rootId')::uuid,p_package,p_review_evidence,private.stage14_hash(p_review_evidence),current_user,session_user,expiry) returning * into p;
 return jsonb_build_object('version','r12.direct-enrollment-publication.1','reviewedPackageHash',h,'businessId',p.business_id,'goalId',p.goal_id,'ownerId',p.owner_id,'grantId',p.grant_id,'expiresAt',private.r12_direct_time(p.expires_at),'authorityCreated',false);
end $$;

create function private.r12_direct_enrollment_qualification(p private.r12_direct_enrollment_packages) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('releaseHash',private.stage14_hash(p.review_evidence->'release'),'routeHash',p.content->'grantReview'->>'routeHash','tariffHash',p.content->'registry'->'browserRoute'->>'tariff_hash',
 'sourceQualificationHash',p.content->'registry'->'sourceQualification'->>'qualification_hash','ownerRendererReviewHash',p.content->'registry'->'ownerRenderer'->>'review_hash',
 'verificationCandidateReviewHash',p.content->'registry'->'verificationCandidate'->>'review_hash','researchRendererReviewHash',p.content->'registry'->'researchRenderer'->>'review_hash',
 'landingControlsHash',p.content->'registry'->'verificationCandidate'->'content'->>'landingControlsHash','reviewExpiresAt',private.r12_direct_time(p.expires_at))
$$;
create function private.r12_direct_enrollment_bounds(p private.r12_direct_enrollment_packages) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('currency','USD','maximumTestMicrounits',p.content->'grantReview'->>'maximumTestMicrounits','maximumUnitsInWindow',p.content->'grantReview'->'maximumAttemptsInWindow','cumulativeDispatchesCeiling',p.content->'grantReview'->'cumulativeDispatchesCeiling')
$$;
create function private.r12_direct_enrollment_preview(p private.r12_direct_enrollment_packages,state jsonb) returns jsonb language plpgsql set search_path='' as $$
declare rt jsonb:=state->'currentGrantRoot';amount bigint:=private.r05_money(p.content->'grantReview'->'maximumTestMicrounits');root_expiry timestamptz;begin
 select greatest(p.expires_at,coalesce((select expires_at from private.r12_owner_grant_root_revisions where root_id=p.root_id and revision=(rt->>'revision')::integer),p.expires_at)) into root_expiry;
 -- Valid explicit initial grants can exceed the old immutable base root. Keep
 -- that history intact, but require a separate review rather than silently
 -- adding catch-up authority in this narrow one-envelope interface.
 if (rt->>'scopesUsed')::integer>(rt->>'maximumScopes')::integer or (rt->>'allocationUsedMicrounits')::bigint>(rt->>'maximumAllocationMicrounits')::bigint then raise exception 'r12_enrollment_cumulative_review_required';end if;
 if (rt->>'revision')::integer>=32 or (rt->>'maximumScopes')::integer>=32 or (rt->>'maximumAllocationMicrounits')::bigint+amount>9007199254740991 then raise exception 'r12_enrollment_lifetime_bound';end if;
 return jsonb_build_object('version','r12.owner-direct-enrollment-proposal.1','businessId',p.business_id,'goalId',p.goal_id,'ownerId',p.owner_id,'reviewedPackageHash',p.package_hash,'grantId',p.grant_id,'profileId',p.profile_id,
 'authorityRootId',state->'authorityRootId','bindingId',state->'bindingId','originHash',state->'originHash','businessRevision',state->'businessRevision','businessHash',state->'businessHash','goalRevision',state->'goalRevision','goalHash',state->'goalHash',
 'currentGrantRoot',rt,'proposedGrantRoot',jsonb_build_object('revision',(rt->>'revision')::integer+1,'previousHash',rt->>'revisionHash','maximumScopes',(rt->>'maximumScopes')::integer+1,
 'maximumAllocationMicrounits',((rt->>'maximumAllocationMicrounits')::bigint+amount)::text,'expiresAt',private.r12_direct_time(root_expiry)),
 'testBounds',private.r12_direct_enrollment_bounds(p),'qualification',private.r12_direct_enrollment_qualification(p),'expiresAt',private.r12_direct_time(p.expires_at),'authorityCreated',false);
end $$;
create function private.r12_direct_enrollment_receipt(s private.r12_direct_enrollment_proposals) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('version','r12.owner-direct-enrollment-receipt.1','businessId',s.business_id,'goalId',s.goal_id,'proposalId',s.id,'proposalHash',s.proposal_hash,
 'confirmed',exists(select 1 from private.r12_direct_enrollment_grants g where g.proposal_id=s.id),'createdAt',private.r12_direct_time(s.created_at),'expiresAt',private.r12_direct_time(s.expires_at),'preview',s.content)
$$;

create function public.r12_owner_direct_enrollment_server(p_business_id uuid,p_operation text,p_payload jsonb,p_server_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.r12_direct_enrollment_packages;s private.r12_direct_enrollment_proposals;old private.r12_direct_enrollment_submissions;rv private.r12_owner_grant_root_revisions;
 gr private.r12_owner_bootstrap_grants;r private.r12_direct_grant_reviews;state jsonb;preview jsonb;h text;stamp timestamptz:=clock_timestamp();submission uuid;begin
 perform private.r05_owner(p_business_id);perform private.r04_safe(p_payload);
 if p_operation='prepare' then perform private.r04_keys(p_payload,array['version','goalId','reviewedPackageHash','submissionId']);
  if p_payload->>'version' is distinct from 'r12.owner-direct-enrollment-input.1' then raise exception 'r12_enrollment_input_required';end if;
  select * into p from private.r12_direct_enrollment_packages where package_hash=p_payload->>'reviewedPackageHash' and business_id=p_business_id and goal_id=(p_payload->>'goalId')::uuid and owner_id=auth.uid();
 elsif p_operation='confirm' then perform private.r04_keys(p_payload,array['version','proposalId','proposalHash','submissionId']);
  if p_payload->>'version' is distinct from 'r12.owner-direct-enrollment-confirmation.1' then raise exception 'r12_enrollment_input_required';end if;
  select * into s from private.r12_direct_enrollment_proposals where id=(p_payload->>'proposalId')::uuid and proposal_hash=p_payload->>'proposalHash' and business_id=p_business_id and owner_id=auth.uid();
  if s.id is null then raise exception 'r12_enrollment_exact_proposal_required';end if;
  select * into p from private.r12_direct_enrollment_packages where package_hash=s.package_hash and business_id=p_business_id and owner_id=auth.uid();
 else raise exception 'r12_enrollment_operation_unavailable';end if;
 if p.package_hash is null or p.content->>'serverKeyHash' is distinct from encode(extensions.digest(p_server_key,'sha256'),'hex') then raise exception 'r12_enrollment_server_binding_required' using errcode='42501';end if;
 submission:=(p_payload->>'submissionId')::uuid;if submission is null then raise exception 'r12_enrollment_input_required';end if;h:=private.stage14_hash(p_payload);
 perform 1 from public.businesses where id=p_business_id and owner_user_id=auth.uid() for update;
 select * into old from private.r12_direct_enrollment_submissions where business_id=p_business_id and submission_id=submission;
 if found then
  if old.operation<>p_operation or old.input_hash<>h then raise exception 'r12_enrollment_idempotency_conflict';end if;
  select * into strict s from private.r12_direct_enrollment_proposals where id=old.proposal_id and package_hash=p.package_hash and owner_id=auth.uid();return private.r12_direct_enrollment_receipt(s);
 end if;
 if p_operation='confirm' and exists(select 1 from private.r12_direct_enrollment_grants where proposal_id=s.id and package_hash=p.package_hash and grant_id=p.grant_id) then return private.r12_direct_enrollment_receipt(s);end if;
 p:=private.r12_direct_enrollment_package_active(p.package_hash);
 if p.expires_at<=stamp+interval '35 minutes' then raise exception 'r12_enrollment_review_inactive';end if;
 if exists(select 1 from private.r12_direct_enrollment_grants where package_hash=p.package_hash or grant_id=p.grant_id) then raise exception 'r12_enrollment_package_consumed';end if;
 state:=private.r12_direct_enrollment_state(p.business_id,p.goal_id,p.root_id);
 if state is distinct from p.content->'expectedState' then raise exception 'r12_enrollment_current_snapshot_changed';end if;
 preview:=private.r12_direct_enrollment_preview(p,state);
 if p_operation='prepare' then
  s.id:=gen_random_uuid();insert into private.r12_direct_enrollment_proposals values(s.id,p.business_id,p.goal_id,p.owner_id,p.package_hash,preview,private.stage14_hash(preview),p.expires_at,stamp) returning * into s;
 else
  if s.content is distinct from preview or s.proposal_hash is distinct from private.stage14_hash(s.content) or s.expires_at<=stamp then raise exception 'r12_enrollment_stale_proposal';end if;
  rv.root_id:=p.root_id;rv.revision:=(preview->'proposedGrantRoot'->>'revision')::integer;rv.previous_hash:=preview->'proposedGrantRoot'->>'previousHash';
  rv.previous_maximum_scopes:=(preview->'currentGrantRoot'->>'maximumScopes')::integer;rv.previous_maximum_allocation_microunits:=private.r05_money(preview->'currentGrantRoot'->'maximumAllocationMicrounits');
  rv.maximum_scopes:=(preview->'proposedGrantRoot'->>'maximumScopes')::integer;rv.maximum_allocation_microunits:=private.r05_money(preview->'proposedGrantRoot'->'maximumAllocationMicrounits');
  rv.approval_hash:=s.proposal_hash;rv.expires_at:=(preview->'proposedGrantRoot'->>'expiresAt')::timestamptz;rv.content_hash:=private.stage14_hash(private.r12_owner_grant_root_revision_content(rv));rv.created_at:=stamp;
  insert into private.r12_owner_grant_root_revisions select rv.*;
  insert into private.r12_direct_enrollment_grants values(p.grant_id,p.package_hash,s.id,rv.revision,rv.content_hash,p.owner_id,stamp);
  insert into private.r12_owner_bootstrap_grants(id,root_id,business_id,owner_id,business_revision,business_hash,profile_id,maximum_scopes,maximum_allocation_microunits,server_key_hash,approval_hash,valid_from,valid_until,root_revision,root_revision_hash,continuation_bounds,adaptive_bounds)
  values(p.grant_id,p.root_id,p.business_id,p.owner_id,(state->>'businessRevision')::integer,state->>'businessHash',p.profile_id,rv.maximum_scopes,rv.maximum_allocation_microunits,p.content->>'serverKeyHash',s.proposal_hash,stamp,p.expires_at,rv.revision,rv.content_hash,null,null);
  r.grant_id:=p.grant_id;r.goal_id:=p.goal_id;r.goal_revision:=(state->>'goalRevision')::integer;r.goal_hash:=state->>'goalHash';
  r.provider_project_id:=(p.content->'grantReview'->>'providerProjectId')::uuid;r.route_hash:=p.content->'grantReview'->>'routeHash';
  r.maximum_test_microunits:=private.r05_money(p.content->'grantReview'->'maximumTestMicrounits');r.maximum_attempts:=(p.content->'grantReview'->>'maximumAttemptsInWindow')::integer;r.cumulative_dispatches_ceiling:=(p.content->'grantReview'->>'cumulativeDispatchesCeiling')::integer;
  r.setup_operation:=p.content->'grantReview'->'setupOperation';r.verification_operation:=p.content->'grantReview'->'verificationOperation';r.research_pins:=p.content->'grantReview'->'researchPins';r.profile_template:=p.content->'grantReview'->'profileTemplate';r.approval_hash:=p.content->'grantReview'->>'approvalHash';r.expires_at:=p.expires_at;r.created_at:=stamp;r.content_hash:=private.stage14_hash(private.r12_direct_grant_review_body(r));
  insert into private.r12_direct_grant_reviews select r.*;
 end if;
 insert into private.r12_direct_enrollment_submissions values(p_business_id,submission,p_operation,h,s.id);
 return private.r12_direct_enrollment_receipt(s);
end $$;

-- Read-only ancestry verification. It never republishes facts or refreshes
-- their timestamps, and remains required after a grant has materialized.
create function private.r12_direct_enrollment_ancestor(h text) returns void language plpgsql set search_path='' as $$
declare p private.r12_direct_enrollment_packages;v private.r12_owner_profiles;r jsonb;actual jsonb;profile jsonb;e private.r12_direct_test_envelopes;begin
 select * into strict p from private.r12_direct_enrollment_packages where package_hash=h;
 perform 1 from public.businesses where id=p.business_id for update;
 perform 1 from private.r12_owner_grant_roots where id=p.root_id for update;
 p:=private.r12_direct_enrollment_package_active(h);
 perform private.r12_direct_enrollment_evidence(p.content,p.review_evidence);
 r:=p.content->'registry';
 select to_jsonb(x) into actual from private.r12_direct_browser_routes x where route_hash=r->'browserRoute'->>'route_hash';
 if actual is distinct from to_jsonb(jsonb_populate_record(null::private.r12_direct_browser_routes,r->'browserRoute')) then raise exception 'r12_enrollment_registry_changed';end if;
 select to_jsonb(x) into actual from private.r12_direct_owner_renderer_reviews x where route_hash=r->'ownerRenderer'->>'route_hash';
 if actual is distinct from to_jsonb(jsonb_populate_record(null::private.r12_direct_owner_renderer_reviews,r->'ownerRenderer')) then raise exception 'r12_enrollment_registry_changed';end if;
 select to_jsonb(x) into actual from private.r12_direct_source_qualifications x where qualification_hash=r->'sourceQualification'->>'qualification_hash';
 if actual is distinct from to_jsonb(jsonb_populate_record(null::private.r12_direct_source_qualifications,r->'sourceQualification')) then raise exception 'r12_enrollment_registry_changed';end if;
 select to_jsonb(x) into actual from private.r12_verification_candidate_reviews x where review_hash=r->'verificationCandidate'->>'review_hash';
 if actual is distinct from to_jsonb(jsonb_populate_record(null::private.r12_verification_candidate_reviews,r->'verificationCandidate')) then raise exception 'r12_enrollment_registry_changed';end if;
 select to_jsonb(x) into actual from private.r12_proof_bound_source_reviews x where review_hash=r->'researchRenderer'->>'review_hash';
 if actual is distinct from to_jsonb(jsonb_populate_record(null::private.r12_proof_bound_source_reviews,r->'researchRenderer')) then raise exception 'r12_enrollment_registry_changed';end if;
 perform private.r12_research_renderer_review(r->'sourceQualification'->>'qualification_hash',r->'verificationCandidate'->>'review_hash');
 if exists(select 1 from private.r12_direct_browser_route_revocations where route_hash=r->'browserRoute'->>'route_hash')
 or exists(select 1 from private.r12_direct_owner_renderer_revocations where route_hash=r->'ownerRenderer'->>'route_hash')
 or exists(select 1 from private.r12_owner_profile_revocations where profile_id=p.profile_id)
 then raise exception 'r12_enrollment_review_inactive';end if;
 profile:=jsonb_build_object('version','r12.direct-source-profile-review.1','id',p.profile_id,'businessId',p.business_id,'goalId',p.goal_id,'goalHash',p.content->'expectedState'->'goalHash',
 'originProfileId',p.content->'originProfileId','originProfileHash',p.content->'originProfileHash','profileTemplate',p.content->'grantReview'->'profileTemplate','sourcePurpose','etsy_insights_aggregate_research',
 'sourcePolicyHash',p.content->'grantReview'->'researchPins'->'sourcePolicyHash','capturePolicyHash',p.content->'grantReview'->'researchPins'->'capturePolicyHash',
 'validFrom',private.r12_direct_time((p.content->>'validFrom')::timestamptz),'validUntil',private.r12_direct_time(p.expires_at),'reviewEvidenceHash',p.review_evidence_hash);
 select * into v from private.r12_owner_profiles where id=p.profile_id;
 if v.id is null or v.profile is distinct from profile or v.profile_hash is distinct from private.stage14_hash(profile)
 or v.pins is distinct from p.content->'grantReview'->'researchPins' or v.pins_hash is distinct from private.stage14_hash(v.pins) then raise exception 'r12_enrollment_profile_changed';end if;
 e.business_id:=p.business_id;e.expires_at:=p.expires_at;e.content:=p.content->'grantReview';perform private.r12_direct_research_pins(e);
end $$;

create function private.r12_direct_enrollment_grant_ancestor(grant_uuid uuid) returns void language plpgsql set search_path='' as $$
declare m private.r12_direct_enrollment_grants;p private.r12_direct_enrollment_packages;g private.r12_owner_bootstrap_grants;s private.r12_direct_enrollment_proposals;rv private.r12_owner_grant_root_revisions;begin
 select * into m from private.r12_direct_enrollment_grants where grant_id=grant_uuid;
 if m.grant_id is null then return;end if;
 select * into strict p from private.r12_direct_enrollment_packages where package_hash=m.package_hash;
 select * into strict s from private.r12_direct_enrollment_proposals where id=m.proposal_id;
 select * into strict g from private.r12_owner_bootstrap_grants where id=m.grant_id;
 select * into strict rv from private.r12_owner_grant_root_revisions where root_id=p.root_id and revision=m.root_revision;
 if s.package_hash is distinct from p.package_hash or s.proposal_hash is distinct from private.stage14_hash(s.content)
 or g.id is distinct from p.grant_id or g.owner_id is distinct from p.owner_id or g.business_id is distinct from p.business_id or g.profile_id is distinct from p.profile_id or g.root_id is distinct from p.root_id
 or g.root_revision is distinct from m.root_revision or g.root_revision_hash is distinct from m.root_revision_hash or rv.content_hash is distinct from m.root_revision_hash
 or g.approval_hash is distinct from s.proposal_hash or rv.approval_hash is distinct from s.proposal_hash or m.owner_id is distinct from p.owner_id
 or g.maximum_scopes is distinct from (s.content->'proposedGrantRoot'->>'maximumScopes')::integer
 or g.maximum_allocation_microunits is distinct from private.r05_money(s.content->'proposedGrantRoot'->'maximumAllocationMicrounits')
 or g.server_key_hash is distinct from p.content->>'serverKeyHash' or g.valid_until is distinct from p.expires_at
 or g.continuation_bounds is not null or g.adaptive_bounds is not null then raise exception 'r12_enrollment_grant_ancestry_changed';end if;
 perform private.r12_direct_enrollment_ancestor(p.package_hash);
end $$;

-- Mapping must already exist in this same transaction. It cannot excuse an
-- unrelated grant or bypass the exact latest root revision / cumulative caps.
create function private.r12_direct_enrollment_extension(g private.r12_owner_bootstrap_grants) returns boolean language plpgsql set search_path='' as $$
declare m private.r12_direct_enrollment_grants;p private.r12_direct_enrollment_packages;s private.r12_direct_enrollment_proposals;begin
 select * into m from private.r12_direct_enrollment_grants where grant_id=g.id;if m.grant_id is null then return false;end if;
 select * into strict p from private.r12_direct_enrollment_packages where package_hash=m.package_hash;
 select * into strict s from private.r12_direct_enrollment_proposals where id=m.proposal_id;
 if g.business_id is distinct from p.business_id or g.owner_id is distinct from p.owner_id or g.root_id is distinct from p.root_id or g.profile_id is distinct from p.profile_id
 or g.root_revision is distinct from m.root_revision or g.root_revision_hash is distinct from m.root_revision_hash or m.owner_id is distinct from p.owner_id
 or s.package_hash is distinct from p.package_hash or s.proposal_hash is distinct from private.stage14_hash(s.content)
 or g.approval_hash is distinct from s.proposal_hash or g.server_key_hash is distinct from p.content->>'serverKeyHash'
 or g.maximum_scopes is distinct from (s.content->'proposedGrantRoot'->>'maximumScopes')::integer
 or g.maximum_allocation_microunits is distinct from private.r05_money(s.content->'proposedGrantRoot'->'maximumAllocationMicrounits')
 or g.valid_until is distinct from p.expires_at or g.continuation_bounds is not null or g.adaptive_bounds is not null then raise exception 'r12_enrollment_extension_invalid';end if;
 perform private.r12_direct_enrollment_ancestor(p.package_hash);return true;
end $$;

do $$ declare src text;old text;begin
 src:=pg_get_functiondef('private.r12_owner_extension_grant_guard()'::regprocedure);
 old:='or (new.continuation_bounds is null and new.adaptive_bounds is null) or (new.continuation_bounds is not null and new.adaptive_bounds is not null)';
 if strpos(src,old)=0 then raise exception 'r12_enrollment_extension_guard_drift';end if;
 src:=replace(src,old,'or (new.continuation_bounds is null and new.adaptive_bounds is null and not private.r12_direct_enrollment_extension(new)) or (new.continuation_bounds is not null and new.adaptive_bounds is not null)');execute src;
 -- Preserve public/private original OIDs and all function metadata. Exact body
 -- insertions avoid cached callers retaining a renamed delegate.
 src:=pg_get_functiondef('private.r12_direct_grant_check(uuid,uuid,uuid,text)'::regprocedure);
 old:='perform private.r12_owner_grant_revision_current(gr,rt,clock_timestamp());return r;';
 if strpos(src,old)=0 then raise exception 'r12_enrollment_grant_check_drift';end if;
 execute replace(src,old,'perform private.r12_owner_grant_revision_current(gr,rt,clock_timestamp());perform private.r12_direct_enrollment_grant_ancestor(gr.id);return r;');
 src:=pg_get_functiondef('private.r12_direct_test_current(uuid)'::regprocedure);
 old:=$x$then raise exception 'r12_direct_current_test_required';end if;$x$;
 if strpos(src,old)=0 then raise exception 'r12_enrollment_current_test_drift';end if;
 execute replace(src,old,old||' perform private.r12_direct_enrollment_grant_ancestor(gr.id);');
 src:=pg_get_functiondef('public.r12_owner_direct_enrollment_server(uuid,text,jsonb,text)'::regprocedure);
 old:='p:=private.r12_direct_enrollment_package_active(p.package_hash);';
 if strpos(src,old)=0 then raise exception 'r12_enrollment_server_drift';end if;
 execute replace(src,old,old||' perform private.r12_direct_enrollment_ancestor(p.package_hash);');
end $$;

create function public.r12_owner_direct_enrollment_read(p_business_id uuid,p_goal_id uuid,p_proposal_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.r12_direct_enrollment_packages;s private.r12_direct_enrollment_proposals;state jsonb;preview jsonb;offers jsonb:='[]'::jsonb;reason text:='reviewed_package_required';current_receipt jsonb:=null;begin
 perform private.r05_owner(p_business_id);
 if p_goal_id is null or not exists(select 1 from public.goals where id=p_goal_id and business_id=p_business_id) then raise exception 'r12_enrollment_goal_unavailable';end if;
 select * into s from private.r12_direct_enrollment_proposals where business_id=p_business_id and goal_id=p_goal_id and owner_id=auth.uid() and (p_proposal_id is null or id=p_proposal_id) order by created_at desc,id desc limit 1;
 if p_proposal_id is not null and s.id is null then raise exception 'r12_enrollment_exact_proposal_required';end if;
 if s.id is not null then
  if s.proposal_hash is distinct from private.stage14_hash(s.content) or s.content->>'businessId' is distinct from p_business_id::text or s.content->>'goalId' is distinct from p_goal_id::text or s.content->>'ownerId' is distinct from auth.uid()::text then raise exception 'r12_enrollment_proposal_corrupt';end if;
  current_receipt:=private.r12_direct_enrollment_receipt(s);
 end if;
 if p_proposal_id is not null then reason:='historical_selection';
 elsif exists(select 1 from private.r12_direct_enrollment_grants m join private.r12_direct_enrollment_packages x on x.package_hash=m.package_hash where x.business_id=p_business_id and x.goal_id=p_goal_id and x.owner_id=auth.uid()) then reason:='already_enrolled';
 else
 for p in select * from private.r12_direct_enrollment_packages where business_id=p_business_id and goal_id=p_goal_id and owner_id=auth.uid() order by created_at desc,package_hash limit 10 loop
  begin
   perform private.r12_direct_enrollment_ancestor(p.package_hash);
   if p.expires_at<=clock_timestamp()+interval '35 minutes' then raise exception 'r12_enrollment_review_inactive';end if;
   state:=private.r12_direct_enrollment_state(p.business_id,p.goal_id,p.root_id);
   if state is distinct from p.content->'expectedState' then raise exception 'r12_enrollment_current_snapshot_changed';end if;
   preview:=private.r12_direct_enrollment_preview(p,state);
   offers:=offers||jsonb_build_array(jsonb_build_object('reviewedPackageHash',p.package_hash,'grantId',p.grant_id,'expiresAt',private.r12_direct_time(p.expires_at),'testBounds',private.r12_direct_enrollment_bounds(p),'qualification',private.r12_direct_enrollment_qualification(p)));
  exception when raise_exception then
   case sqlerrm
   when 'r12_enrollment_review_inactive','r12_candidate_review_inactive','r12_landing_review_inactive','r12_research_renderer_review_inactive' then reason:='reviewed_package_inactive';
   when 'r12_enrollment_cumulative_review_required' then reason:='reviewed_package_required';
   when 'r12_enrollment_lifetime_bound','r12_direct_origin_lifetime_bound' then reason:='lifetime_bound_exhausted';
   when 'r12_direct_unresolved_liability','r12_direct_origin_unresolved_liability','r12_direct_origin_pending_reservation','r12_direct_origin_qualified_financial_disposition_required' then reason:='unresolved_liability';
   when 'r12_enrollment_current_origin_unavailable','r12_enrollment_current_snapshot_changed','r12_direct_origin_current_predecessor_required','r12_direct_origin_irreversibly_closed','r12_owner_genuine_closed_lineage_required' then reason:='current_origin_unavailable';
   else raise;end case;
  end;
 end loop;
 end if;
 return jsonb_build_object('version','r12.owner-direct-enrollment-catalog.1','businessId',p_business_id,'goalId',p_goal_id,'ownerId',auth.uid(),'eligible',jsonb_array_length(offers)>0,'reason',case when jsonb_array_length(offers)>0 then null else reason end,'offers',offers,'current',current_receipt);
end $$;

-- Reviewed packages precede any test envelope. Revocation must also wait
-- for those same Businesses while enrollment/confirmation is in progress.
create or replace function private.r12_renderer_review_lock_businesses(route text,qualification text default null) returns void language plpgsql set search_path='' as $$ begin
 perform b.id from public.businesses b where
 exists(select 1 from private.r12_direct_test_envelopes e where e.business_id=b.id and e.content->'setupOperation'->>'routeHash'=route and (qualification is null or e.content->'researchPins'->>'executionReviewHash'=qualification))
 or exists(select 1 from private.r12_direct_enrollment_packages p where p.business_id=b.id and p.content->'grantReview'->>'routeHash'=route and (qualification is null or p.content->'grantReview'->'researchPins'->>'executionReviewHash'=qualification))
 order by b.id for update;
end $$;

create function private.r12_direct_enrollment_grant_visible(g uuid) returns boolean language plpgsql set search_path='' as $$ begin
 perform private.r12_direct_enrollment_grant_ancestor(g);return true;
 exception when raise_exception then
 if sqlerrm in ('r12_enrollment_review_inactive','r12_landing_review_inactive','r12_research_renderer_review_inactive') then return false;end if;raise;
end $$;
do $$ declare fn record;src text;needle text:='where g.business_id=p_business_id and g.owner_id=auth.uid() and r.goal_id=p_goal_id';changed integer:=0;begin
 for fn in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname like 'r12_owner_direct_read%' loop
  src:=pg_get_functiondef(fn.oid);
  if strpos(src,needle)>0 then execute replace(src,needle,needle||' and private.r12_direct_enrollment_grant_visible(g.id)');changed:=changed+1;end if;
 end loop;
 if changed=0 then raise exception 'r12_enrollment_direct_catalog_drift';end if;
end $$;

-- Direct purpose profiles never appear as selectable legacy/adaptive authority.
-- Modify the exact legacy catalog producer wherever preserved wrappers call it.
do $$ declare fn record;src text;needle text:=$needle$where p.profile->>'version'='r12.owner-research-profile.1' and gr.business_id=p_business_id and gr.owner_id=auth.uid()$needle$;changed integer:=0;begin
 for fn in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname like 'r12_owner_research_read%' loop
  src:=pg_get_functiondef(fn.oid);
  if strpos(src,needle)>0 then execute replace(src,needle,needle||' and not exists(select 1 from private.r12_direct_enrollment_grants eg where eg.grant_id=gr.id)');changed:=changed+1;end if;
 end loop;
 if changed=0 then raise exception 'r12_enrollment_legacy_catalog_drift';end if;
end $$;

do $$ declare fn record;begin
 for fn in select p.oid::regprocedure name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and (p.proname like 'r12_direct_enrollment_%' or p.proname='r12_direct_publish_enrollment_review') loop execute format('revoke all on function %s from public,anon,authenticated,service_role',fn.name);end loop;
end $$;
revoke all on function public.r12_owner_direct_enrollment_read(uuid,uuid,uuid),public.r12_owner_direct_enrollment_server(uuid,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.r12_owner_direct_enrollment_read(uuid,uuid,uuid),public.r12_owner_direct_enrollment_server(uuid,text,jsonb,text) to authenticated;
commit;
