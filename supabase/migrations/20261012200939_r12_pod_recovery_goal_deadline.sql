-- Atomic owner-approved deadline-only revision for same-Goal POD recovery.
-- R05 deadline validation, all old grants/history and cumulative allowances stay unchanged.
begin;
create or replace function public.r12_pod_recovery_owner_server(p_business_id uuid,p_operation text,p_payload jsonb,p_server_key text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.r12_pod_setups;t private.r12_pod_templates;g private.r04_goal_versions;br private.r04_business_versions;
 old private.r12_pod_submissions;installed public.installed_packs;input jsonb;q jsonb;finance jsonb;brief jsonb;ops jsonb:='[]';steps jsonb:='[]';policy_body jsonb;proposed jsonb;preview jsonb;amendment jsonb;plan jsonb;approval text;
 submission uuid;setup_id uuid;sid uuid;iid uuid;stamp timestamptz:=clock_timestamp();cutoff timestamptz;dispatch_until timestamptz;receipt_until timestamptz;
 h text;phase text;operation_key text;purpose text;data_classes jsonb;model text;bytes integer;tokens integer;ord integer:=0;maximum bigint;amount bigint;
 source_context jsonb;recovery_proof jsonb;recovery_history jsonb;next_plan_id uuid:=gen_random_uuid();goal_content jsonb;goal_transition jsonb;prior_goal_revision integer;
 phase_keys text[]:=array['plan','search1','select1','strategy','review'];begin
 perform private.r05_owner(p_business_id);perform private.r04_safe(p_payload);
 if p_operation not in ('prepare','confirm') then raise exception 'r12_pod_operation_invalid';end if;
 if p_operation='prepare' then
 perform private.r04_keys(p_payload,array['input','quote']);input:=p_payload->'input';q:=p_payload->'quote';
 perform private.r04_keys(input,array['businessId','goalId','goalRevision','templateId','templateHash','publicBrief','maximumMicrounits','businessLifetimeLimitMicrounits','submissionId','predecessorSetupId','proofHash','historyHash','classificationHash','approveGoalDeadlineRevision']);
 if input->'approveGoalDeadlineRevision' is distinct from 'true'::jsonb then raise exception 'r12_pod_goal_deadline_revision_consent_required';end if;
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
 if p_operation='prepare' and (to_jsonb(g.revision) is distinct from source_context->'context'->'plan'->'goalRevision' or g.content_hash is distinct from source_context->'context'->'plan'->>'goalHash') then raise exception 'r12_pod_recovery_prior_goal_changed';end if;
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
 cutoff:=date_trunc('second',least(stamp+interval '35 minutes',t.valid_until,(t.source_policy->>'validUntil')::timestamptz,(t.pins->>'knowledgeValidUntil')::timestamptz));
 if cutoff<stamp+interval '30 minutes' then raise exception 'r12_pod_window_insufficient';end if;
 -- Explicit owner intent only; no old Goal version or policy is changed. These
 -- R04 transitions and the new policy proposal commit or roll back together.
 prior_goal_revision:=g.revision;
 goal_content:=jsonb_set(g.content,'{parsed,deadline}',jsonb_build_object('date',to_char(cutoff at time zone 'UTC','YYYY-MM-DD'),'time',to_char(cutoff at time zone 'UTC','HH24:MI:SS'),'timezone','UTC'));
 goal_transition:=public.r04_quest_transition(p_business_id,'quest.save',jsonb_build_object('goalId',g.goal_id,'expectedRevision',prior_goal_revision,'content',goal_content),private.stage4_deterministic_uuid('r12:pod-recovery:'||submission::text||':deadline'));
 if goal_transition->'revision' is distinct from to_jsonb(prior_goal_revision+1) then raise exception 'r12_pod_goal_deadline_revision_unverified';end if;
 goal_transition:=public.r04_quest_transition(p_business_id,'quest.preference',jsonb_build_object('goalId',g.goal_id,'expectedRevision',prior_goal_revision+1,'preference','ready'),private.stage4_deterministic_uuid('r12:pod-recovery:'||submission::text||':ready'));
 if goal_transition->'revision' is distinct from to_jsonb(prior_goal_revision+2) then raise exception 'r12_pod_goal_deadline_ready_unverified';end if;
 select v.* into strict g from private.r04_goal_versions v join private.r04_goal_state st using(business_id,goal_id,revision) where v.business_id=p_business_id and v.goal_id=(input->>'goalId')::uuid;
 if g.content is distinct from goal_content or g.revision<>prior_goal_revision+2 or g.preference<>'ready' then raise exception 'r12_pod_goal_deadline_revision_unverified';end if;
 -- The saved proposal and later confirmation bind the NEW current intent.
 -- The original request hash above remains the replay identity.
 input:=jsonb_set(input,'{goalRevision}',to_jsonb(g.revision));

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
commit;
