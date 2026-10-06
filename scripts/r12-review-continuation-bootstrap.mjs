/** Reviewed operator recipe; import has no side effects.
 * Caller supplies an approved, dedicated operator client. No environment,
 * credentials, provider requests, owner impersonation or automatic retry.
 * Requires R12 response-observation and lineage-successor migrations; history length1..2, original Core plan limit unchanged.
 *
 * stage: {envelope,proposal,quote,executionReviewHash,eligibilityReviewHash}
 * activate: {businessId,scopeId,scopeHash,proposalHash,policyId,policyHash,
 *   quote,executionReviewHash,eligibilityReviewHash,controllerKeyHash,admissionKeyHash}
 * Quote must come from the existing trusted R12 catalog qualifier. No raw
 * catalogs or owner-produced quote become authority through this module.
 */
const declarations=`
 x jsonb;e jsonb;v jsonb;q jsonb;source jsonb;policy jsonb;expected_operation jsonb;old_step jsonb;step jsonb;plan jsonb;initialized jsonb;
 b uuid;g uuid;sid uuid;owner_id uuid;cutoff timestamptz;goal_cutoff timestamptz;stamp timestamptz;dispatch_until timestamptz;receipt_until timestamptz;
 amount bigint;field text;operation_key text;adapter_key text;
 s private.r12_discovery_scopes;staged private.r12_review_owner_proposals;confirmed private.r12_review_owner_confirmations;
 original_plan private.r07_plans;old_op private.r05_operations;old_adapter private.r07_adapters;op private.r05_operations;adapter private.r07_adapters;
 wd public.worker_definitions;fd public.workflow_definitions;i public.installed_packs;
 business private.r04_business_versions;goal private.r04_goal_versions;cap private.r05_cap_versions;p private.r05_policies;budget jsonb;
`;
const input=`
 select payload into strict x from pg_temp.r12_bootstrap_input;
 if current_user in ('anon','authenticated','service_role') then raise exception 'r12_review_operator_required';end if;
 if jsonb_typeof(x) is distinct from 'object' or octet_length(x::text)>131072 then raise exception 'r12_review_operator_input_invalid';end if;
 foreach field in array array['executionReviewHash','eligibilityReviewHash'] loop
 if jsonb_typeof(x->field) is distinct from 'string' or x->>field !~ '^[a-f0-9]{64}$' then raise exception 'r12_review_operator_review_hash_required';end if;end loop;
 q:=x->'quote';
`;
const quote=`
 perform private.r04_keys(q,array['version','maximumCalls','maximumCollections','luna','reviewer','ceilings','maximumMicrousd','retention','proposalOnly','dispatchAuthorized','quoteHash','verifiedAt','validUntil']);
 if q->>'version' is distinct from 'r12.discovery-quote.1' or q->'maximumCalls' is distinct from '5'::jsonb or q->'maximumCollections' is distinct from '1'::jsonb
 or q->'proposalOnly' is distinct from 'true'::jsonb or q->'dispatchAuthorized' is distinct from 'false'::jsonb
 or q->>'quoteHash' is distinct from private.stage14_hash(q-array['quoteHash','verifiedAt','validUntil'])
 or jsonb_typeof(q->'verifiedAt') is distinct from 'string' or jsonb_typeof(q->'validUntil') is distinct from 'string'
 or not isfinite((q->>'verifiedAt')::timestamptz) or not isfinite((q->>'validUntil')::timestamptz)
 or (q->>'verifiedAt')::timestamptz>clock_timestamp() or (q->>'validUntil')::timestamptz<=clock_timestamp()
 or (q->>'validUntil')::timestamptz-(q->>'verifiedAt')::timestamptz<>interval '5 minutes'
 or q->'retention' is distinct from '{"inference":"no_training_zdr","search":"query_retention_improvement_training_possible","schemas":"static_nonprivate_schema_only"}'::jsonb
 or q->'reviewer'->>'modelId' is distinct from 'anthropic/claude-haiku-4.5'
 or q->'reviewer'->>'canonicalModelId' is distinct from 'anthropic/claude-4.5-haiku-20251001'
 or q->'reviewer'->>'endpoint' is distinct from 'amazon-bedrock/us' or q->'reviewer'->>'providerName' is distinct from 'Amazon Bedrock'
 or q->'reviewer'->'acceptedResponseModelIds' is distinct from '["anthropic/claude-haiku-4.5","anthropic/claude-4.5-haiku-20251001"]'::jsonb
 or q->'luna'->>'modelId' is distinct from 'openai/gpt-5.6-luna' or q->'luna'->>'canonicalModelId' is distinct from 'openai/gpt-5.6-luna-20260709'
 or q->'luna'->>'endpoint' is distinct from 'azure/us' or q->'luna'->>'providerName' is distinct from 'Azure'
 or q->'reviewer'->'priceLimit'->'request' is distinct from '0'::jsonb
 or jsonb_typeof(q->'reviewer'->'priceLimit'->'prompt') is distinct from 'number' or jsonb_typeof(q->'reviewer'->'priceLimit'->'completion') is distinct from 'number'
 or (q->'reviewer'->'priceLimit'->>'prompt')::numeric<=0 or (q->'reviewer'->'priceLimit'->>'completion')::numeric<=0
 or jsonb_typeof(q->'ceilings'->'review') is distinct from 'number' or q->'ceilings'->>'review' !~ '^[1-9][0-9]{0,6}$'
 then raise exception 'r12_review_fresh_exact_quote_required';end if;
`;
const resolve=`
 b:=s.business_id;g:=s.goal_id;sid:=s.id;e:=s.amendment;cutoff:=(e->>'expiresAt')::timestamptz;owner_id:=(v->>'ownerId')::uuid;
 perform 1 from public.businesses where id=b and owner_user_id=owner_id for update;
 if not found then raise exception 'r12_review_operator_owner_changed';end if;
 perform 1 from public.product_experiments where id=s.budget_authority_root_id and business_id=b for update;
 if not found then raise exception 'r12_review_operator_root_unavailable';end if;
 source:=private.r12_review_source(s,clock_timestamp(),true);
 -- A shorter actual source/Knowledge lifetime cannot be replaced by setup time.
 perform private.r12_review_source(s,cutoff-interval '1 microsecond',true);
 budget:=private.stage13v2_budget_authority(s.prior_round_id,true);
 if budget->'maximumMicrousd' is distinct from '2000000'::jsonb or budget->'hasUncertainCosts' is distinct from 'false'::jsonb then raise exception 'r12_review_original_funding_required';end if;
 select * into original_plan from private.r07_plans where id=(e->>'sourcePlanId')::uuid and business_id=b and goal_id=g and content_hash=e->>'sourcePlanHash';
 if original_plan.id is null then raise exception 'r12_review_operator_source_plan_changed';end if;
 select value into old_step from jsonb_array_elements(original_plan.content->'steps') phase where phase->>'key'='review';
 select registered.* into old_op from private.r05_operations registered where registered.operation_key=old_step->>'operationKey' for share;
 select registered.* into old_adapter from private.r07_adapters registered where registered.adapter_key=old_step->>'adapter' for share;
 select * into fd from public.workflow_definitions where id=(old_step->>'workflowDefinitionId')::uuid for share;
 select * into wd from public.worker_definitions where id=(old_step->>'workerDefinitionId')::uuid for share;
 select * into i from public.installed_packs where id=(old_step->>'installationId')::uuid and business_id=b for share;
 if old_op.operation_key is null or old_adapter.adapter_key is null or fd.id is null or wd.id is null or i.id is null or i.status<>'active'
 or private.r04_hash(i.snapshot) is distinct from old_step->>'packSnapshotHash' or i.snapshot is distinct from source->'knowledgeSnapshot'
 or old_adapter.workflow_definition_id<>fd.id or old_adapter.worker_definition_id<>wd.id
 or old_adapter.workflow_hash is distinct from private.r04_hash(to_jsonb(fd)) or old_adapter.worker_hash is distinct from private.r04_hash(to_jsonb(wd))
 or old_adapter.qualification_hash is distinct from old_step->>'qualificationHash' or old_adapter.mode<>'qualification' or old_adapter.role<>'review' or old_adapter.knowledge_valid_until<cutoff
 or old_adapter.operation_key<>old_op.operation_key or old_adapter.artifact_type<>'r12.discovery.review' or old_adapter.purpose<>old_op.purpose
 or old_op.workflow_definition_id<>fd.id or old_op.pack_id<>fd.pack_id or old_op.provider<>'openrouter' or old_op.provider_model_id<>'anthropic/claude-haiku-4.5'
 or old_op.currency<>'USD' or old_op.category<>'model' or old_op.maximum_request_bytes<>32768 or old_op.maximum_output_tokens<>4000
 or old_op.liability_microunits<>private.r05_money(old_step->'maximumMicrounits') or old_op.source_domains is distinct from e->'allowedDomains'
 or fd.workflow_key<>'product.discovery-v2.one' or fd.version<>'1.0.0' or fd.status not in ('experimental','qualified','assisted','autonomous')
 or wd.worker_key<>'product.discovery-v2.review' or wd.version<>'1.0.0' or wd.status not in ('experimental','qualified','assisted','autonomous')
 or exists(select 1 from private.r05_operation_revocations revoked where revoked.operation_key=old_op.operation_key)
 or exists(select 1 from private.r07_adapter_revocations revoked where revoked.adapter_key=old_adapter.adapter_key)
 then raise exception 'r12_review_original_reviewer_definition_changed';end if;
 policy:=v->'operatingPolicy';amount:=private.r05_money(policy->'policyLimitMicrounits');
 if amount<1 or amount>old_op.liability_microunits or (q->'ceilings'->>'review')::bigint>amount or amount>(budget->>'remainingMicrousd')::bigint then raise exception 'r12_review_approved_ceiling_exceeded';end if;
 operation_key:='research.r12.'||sid||'.review';adapter_key:='r12.discovery.'||sid||'.review';
 expected_operation:=jsonb_build_object('operationKey',operation_key,'installationId',i.id,'workflowDefinitionId',fd.id,'purpose',old_op.purpose,'provider',old_op.provider,'category',old_op.category,
 'accountId',null,'accountRevision',null,'sourceDomains',old_op.source_domains,'dataClasses',old_op.data_classes,'maximumPerOperationMicrounits',amount::text);
 if policy->'operations' is distinct from jsonb_build_array(expected_operation) or policy->'maximumDispatches' is distinct from '1'::jsonb then raise exception 'r12_review_exact_owner_operation_required';end if;
 if private.r05_paused(b,'business',b) or private.r05_paused(b,'quest',g) or private.r05_paused(b,'pack',i.id) then raise exception 'r12_review_operator_scope_paused';end if;
`;

export const STAGING_SQL=`DO $r12_review_bootstrap$ <<recipe>> DECLARE ${declarations} BEGIN
${input}
 perform private.r04_keys(x,array['envelope','proposal','quote','executionReviewHash','eligibilityReviewHash']);
 e:=x->'envelope';v:=x->'proposal';
 if jsonb_typeof(e) is distinct from 'object' or jsonb_typeof(v) is distinct from 'object' then raise exception 'r12_review_exact_staging_data_required';end if;
 s:=jsonb_populate_record(null::private.r12_discovery_scopes,jsonb_build_object('id',e->>'id','business_id',e->>'businessId','goal_id',e->>'goalId',
 'budget_authority_root_id',e->>'budgetAuthorityRootId','prior_round_id',e->>'priorRoundId','amendment',e,'amendment_hash',private.stage14_hash(e)));
${quote}
${resolve}
 perform private.r12_validate_review_envelope(s);
 if v->>'scopeId' is distinct from sid::text or v->>'scopeHash' is distinct from s.amendment_hash or v->>'businessId' is distinct from b::text or v->>'goalId' is distinct from g::text then raise exception 'r12_review_staging_proposal_mismatch';end if;
 if cutoff<=clock_timestamp()+interval '1 hour' or cutoff>(e->>'createdAt')::timestamptz+interval '1 day' then raise exception 'r12_review_setup_window_insufficient';end if;
 if exists(select 1 from private.r12_discovery_scopes where id=sid
 or (e->>'version'='r12.discovery-review-continuation.1' and amendment->>'sourcePlanId'=e->>'sourcePlanId')
 or (e->>'version'='r12.discovery-review-continuation.2' and amendment->>'version'='r12.discovery-review-continuation.2'
 and amendment->>'predecessorPlanId'=e->>'predecessorPlanId'))
 or exists(select 1 from private.r05_operations registered where registered.operation_key=recipe.operation_key)
 or exists(select 1 from private.r07_adapters registered where registered.adapter_key=recipe.adapter_key) then raise exception 'r12_review_staging_identity_already_used';end if;
 stamp:=date_trunc('milliseconds',clock_timestamp());
 insert into private.r12_discovery_scopes(id,business_id,goal_id,budget_authority_root_id,prior_round_id,amendment,amendment_hash)
 values(sid,b,g,s.budget_authority_root_id,s.prior_round_id,e,s.amendment_hash);
 insert into private.r05_operations(operation_key,pack_id,workflow_definition_id,provider,provider_model_id,purpose,currency,category,maximum_request_bytes,maximum_output_tokens,liability_microunits,source_domains,data_classes,qualification_hash,eligibility_hash,quote_hash,valid_from,valid_until)
 values(operation_key,old_op.pack_id,fd.id,old_op.provider,old_op.provider_model_id,old_op.purpose,'USD','model',32768,4000,amount,old_op.source_domains,old_op.data_classes,x->>'executionReviewHash',x->>'eligibilityReviewHash',q->>'quoteHash',stamp,cutoff);
 insert into private.r07_adapters(adapter_key,qualification_hash,workflow_definition_id,worker_definition_id,workflow_hash,worker_hash,operation_key,role,purpose,artifact_type,mode,valid_from,valid_until,knowledge_valid_until)
 values(adapter_key,x->>'executionReviewHash',fd.id,wd.id,private.r04_hash(to_jsonb(fd)),private.r04_hash(to_jsonb(wd)),operation_key,'review',old_op.purpose,'r12.discovery.review','qualification',stamp,cutoff,cutoff);
 insert into private.r12_review_owner_proposals(scope_id,business_id,owner_id,proposal,proposal_hash) values(sid,b,owner_id,v,private.stage14_hash(v));
 if (q->>'validUntil')::timestamptz<=clock_timestamp() or cutoff<=clock_timestamp()+interval '1 hour' then raise exception 'r12_review_staging_window_or_quote_expired';end if;
 insert into pg_temp.r12_bootstrap_result values(jsonb_build_object('businessId',b,'goalId',g,'scopeId',sid,'sourceScopeId',e->>'sourceScopeId','scopeHash',s.amendment_hash,'proposalHash',private.stage14_hash(v),
 'operationKey',operation_key,'adapterKey',adapter_key,'policyPayload',policy,'policyPayloadHash',private.r04_hash(policy),'setupUntil',cutoff,'quoteHash',q->>'quoteHash','authorityCreated',false,'providerCalls',0));
END $r12_review_bootstrap$;`;

export const ACTIVATION_SQL=`DO $r12_review_bootstrap$ <<recipe>> DECLARE ${declarations} BEGIN
${input}
 perform private.r04_keys(x,array['businessId','scopeId','scopeHash','proposalHash','policyId','policyHash','quote','executionReviewHash','eligibilityReviewHash','controllerKeyHash','admissionKeyHash']);
 foreach field in array array['businessId','scopeId','policyId'] loop
 if jsonb_typeof(x->field) is distinct from 'string' or x->>field !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then raise exception 'r12_review_activation_identity_invalid';end if;end loop;
 foreach field in array array['scopeHash','proposalHash','policyHash','controllerKeyHash','admissionKeyHash'] loop
 if jsonb_typeof(x->field) is distinct from 'string' or x->>field !~ '^[a-f0-9]{64}$' then raise exception 'r12_review_activation_hash_invalid';end if;end loop;
 select * into s from private.r12_discovery_scopes where id=(x->>'scopeId')::uuid and business_id=(x->>'businessId')::uuid;
 select * into staged from private.r12_review_owner_proposals where scope_id=s.id and business_id=s.business_id;
 if s.id is null or not coalesce(s.amendment->>'version' in ('r12.discovery-review-continuation.1','r12.discovery-review-continuation.2'),false) or s.amendment_hash is distinct from x->>'scopeHash'
 or private.stage14_hash(s.amendment) is distinct from x->>'scopeHash' or staged.scope_id is null or staged.proposal_hash is distinct from x->>'proposalHash'
 or private.stage14_hash(staged.proposal) is distinct from x->>'proposalHash' then raise exception 'r12_review_exact_staged_hashes_required';end if;
 v:=staged.proposal;
${quote}
${resolve}
 perform private.r12_validate_review_envelope(s);
 select * into confirmed from private.r12_review_owner_confirmations where scope_id=sid and business_id=b;
 select * into p from private.r05_policies where id=(x->>'policyId')::uuid and business_id=b and goal_id=g for share;
 select bv.* into business from private.r04_business_versions bv join private.r04_business_state bs using(business_id,revision) where bv.business_id=b;
 select gv.* into goal from private.r04_goal_versions gv join private.r04_goal_state gs using(goal_id,business_id,revision) where gv.business_id=b and gv.goal_id=g;
 select * into cap from private.r05_cap_versions where business_id=b and currency='USD' order by revision desc limit 1;
 if confirmed.scope_id is null or confirmed.actor_id<>owner_id or confirmed.proposal_hash<>staged.proposal_hash
 or confirmed.policy_id is distinct from p.id or confirmed.policy_hash is distinct from x->>'policyHash'
 or p.id is null or p.actor_id<>owner_id or p.content_hash is distinct from x->>'policyHash' or p.payload is distinct from policy or p.content_hash is distinct from private.r04_hash(policy)
 or business.revision is distinct from confirmed.business_revision or business.revision<>(v->>'expectedBusinessRevision')::integer+1 or business.actor_id<>owner_id or business.preference<>'setup'
 or business.content is distinct from v->'businessContent' or business.content_hash is distinct from private.r04_hash(v->'businessContent')
 or goal.revision is distinct from confirmed.goal_revision or goal.revision<>(v->>'expectedGoalRevision')::integer+2 or goal.actor_id<>owner_id or goal.preference<>'ready'
 or goal.content is distinct from v->'goalContent' or goal.content_hash is distinct from private.r04_hash(v->'goalContent')
 or cap.policy_id is distinct from p.id or cap.revision<>(policy->>'expectedCapRevision')::integer+1 or cap.maximum_microunits<>private.r05_money(policy->'businessLifetimeLimitMicrounits')
 or not exists(select 1 from private.r05_confirmations c where c.policy_id=p.id and c.business_id=b and c.actor_id=owner_id)
 or exists(select 1 from private.r05_revocations where policy_id=p.id)
 or not exists(select 1 from private.r05_policy_proofs proof where proof.policy_id=p.id and proof.policy_hash=p.content_hash and proof.evidence_hash=v->>'interpretationHash' and proof.valid_until>clock_timestamp())
 then raise exception 'r12_review_actual_owner_confirmation_required';end if;
 perform private.r05_policy_validate(b,policy);
 if exists(select 1 from private.r05_exposure(b) where unknown)
 or (select coalesce(sum(held),0) from private.r05_exposure(b) where currency='USD')<>private.r05_money(policy->'expectedExposureMicrounits')
 then raise exception 'r12_review_activation_financial_drift';end if;
 select registered.* into op from private.r05_operations registered where registered.operation_key=recipe.operation_key for share;
 select registered.* into adapter from private.r07_adapters registered where registered.adapter_key=recipe.adapter_key for share;
 if op.operation_key is null or op.pack_id<>old_op.pack_id or op.workflow_definition_id<>fd.id or op.provider<>old_op.provider or op.provider_model_id<>old_op.provider_model_id
 or op.purpose<>old_op.purpose or op.currency<>'USD' or op.category<>'model' or op.maximum_request_bytes<>32768 or op.maximum_output_tokens<>4000 or op.liability_microunits<>amount
 or op.source_domains is distinct from old_op.source_domains or op.data_classes is distinct from old_op.data_classes
 or op.qualification_hash is distinct from x->>'executionReviewHash' or op.eligibility_hash is distinct from x->>'eligibilityReviewHash'
 or op.quote_hash is distinct from q->>'quoteHash' or op.valid_until<>cutoff or op.valid_from>clock_timestamp()
 or adapter.adapter_key is null or adapter.qualification_hash is distinct from x->>'executionReviewHash' or adapter.workflow_definition_id<>fd.id or adapter.worker_definition_id<>wd.id
 or adapter.workflow_hash is distinct from private.r04_hash(to_jsonb(fd)) or adapter.worker_hash is distinct from private.r04_hash(to_jsonb(wd))
 or adapter.operation_key<>op.operation_key or adapter.role<>'review' or adapter.purpose<>op.purpose or adapter.artifact_type<>'r12.discovery.review' or adapter.mode<>'qualification'
 or adapter.valid_from<>op.valid_from or adapter.valid_until<>cutoff or adapter.knowledge_valid_until<cutoff
 or exists(select 1 from private.r05_operation_revocations revoked where revoked.operation_key=op.operation_key) or exists(select 1 from private.r07_adapter_revocations revoked where revoked.adapter_key=adapter.adapter_key)
 then raise exception 'r12_review_staged_registration_changed';end if;
 if x->>'controllerKeyHash'=x->>'admissionKeyHash' or exists(select 1 from private.r07_server_keys where key_hash in(x->>'controllerKeyHash',x->>'admissionKeyHash'))
 or exists(select 1 from private.r05_server_keys where key_hash in(x->>'controllerKeyHash',x->>'admissionKeyHash'))
 or exists(select 1 from private.r12_discovery_authorities where scope_id=sid) then raise exception 'r12_review_fresh_separate_verifier_hashes_required';end if;
 goal_cutoff:=(((goal.content->'parsed'->'deadline'->>'date')||' '||(goal.content->'parsed'->'deadline'->>'time'))::timestamp at time zone (goal.content->'parsed'->'deadline'->>'timezone'));
 stamp:=date_trunc('milliseconds',clock_timestamp());dispatch_until:=stamp+interval '30 minutes';receipt_until:=dispatch_until+interval '30 minutes';
 if not isfinite(goal_cutoff) or receipt_until>least(cutoff,goal_cutoff,(policy->>'expiresAt')::timestamptz)
 or (policy->>'startsAt')::timestamptz>stamp or (q->>'validUntil')::timestamptz<=stamp then raise exception 'r12_review_activation_window_or_quote_expired';end if;
 step:=old_step||jsonb_build_object('adapter',adapter_key,'qualificationHash',x->>'executionReviewHash','operationKey',operation_key,'maximumMicrounits',amount::text,
 'objective','Independently review the exact four preserved research outputs','reason','Only the missing independent reviewer is authorized; no research phase may regenerate',
 'expiresAt',dispatch_until,'notBefore',stamp,'maximumRepairs',0,'measurement',null);
 plan:=original_plan.content||jsonb_build_object('format','r12.discovery-review.1','discoveryScopeId',sid,'discoveryScopeHash',s.amendment_hash,
 'goalRevision',goal.revision,'goalHash',goal.content_hash,'businessRevision',business.revision,'businessHash',business.content_hash,'policyId',p.id,'policyHash',p.content_hash,
 'maximumMicrounits',((e->>'baseKnownMicrounits')::bigint+amount)::text,'maximumChildren',(e->>'baseChildren')::integer+1,'maximumDispatches',(e->>'baseDispatches')::integer+1,
 'maximumRepairs',0,'maximumPivots',0,'deadline',dispatch_until,'expiresAt',dispatch_until,'steps',jsonb_build_array(step));
 insert into private.r07_server_keys(key_hash,expires_at) values(x->>'controllerKeyHash',receipt_until);
 insert into private.r05_server_keys(key_hash,expires_at) values(x->>'admissionKeyHash',receipt_until);
 insert into private.r12_discovery_authorities(scope_id,business_id,goal_id,controller_key_hash,admission_key_hash,plan,plan_hash,mode,approval_hash,execution_review_hash,valid_until,receipt_until)
 values(sid,b,g,x->>'controllerKeyHash',x->>'admissionKeyHash',plan,private.r04_hash(plan),'qualification',e->>'approvalHash',x->>'executionReviewHash',dispatch_until,receipt_until);
 initialized:=private.r12_initialize_review_continuation(sid);
 if initialized->'shouldDispatch' is distinct from 'false'::jsonb or initialized->'replayed' is distinct from 'false'::jsonb
 or (q->>'validUntil')::timestamptz<=clock_timestamp() or dispatch_until<=clock_timestamp() then raise exception 'r12_review_activation_not_verified';end if;
 insert into pg_temp.r12_bootstrap_result values(jsonb_build_object('businessId',b,'goalId',g,'scopeId',sid,'scopeHash',s.amendment_hash,'proposalHash',staged.proposal_hash,'policyId',p.id,'policyHash',p.content_hash,
 'planId',initialized->>'planId','plan',plan,'planHash',private.r04_hash(plan),'activatedAt',stamp,'dispatchUntil',dispatch_until,'receiptUntil',receipt_until,
 'authorityCreated',true,'providerCalls',0,'shouldDispatch',false));
END $r12_review_bootstrap$;`;

/** Close only the exact already owner-revoked continuation; retain all history. */
export const CLOSE_SQL=`DO $r12_review_close$ DECLARE x jsonb;s private.r12_discovery_scopes;q private.r12_discovery_authorities;p private.r05_policies; BEGIN
 select payload into strict x from pg_temp.r12_bootstrap_input;
 if current_user in ('anon','authenticated','service_role') then raise exception 'r12_review_operator_required';end if;
 perform private.r04_safe(x);perform private.r04_keys(x,array['businessId','scopeId','scopeHash','policyId','policyHash','planHash']);
 perform 1 from public.businesses where id=(x->>'businessId')::uuid for update;
 select * into s from private.r12_discovery_scopes where id=(x->>'scopeId')::uuid and business_id=(x->>'businessId')::uuid;
 select * into q from private.r12_discovery_authorities where scope_id=s.id and business_id=s.business_id;
 select * into p from private.r05_policies where id=(x->>'policyId')::uuid and business_id=s.business_id;
 if s.id is null or q.scope_id is null or p.id is null or not coalesce(s.amendment->>'version' in ('r12.discovery-review-continuation.1','r12.discovery-review-continuation.2'),false)
 or s.amendment_hash is distinct from x->>'scopeHash' or q.plan_hash is distinct from x->>'planHash' or q.plan->>'policyId' is distinct from p.id::text
 or p.content_hash is distinct from x->>'policyHash' or q.plan->>'policyHash' is distinct from p.content_hash or not private.r12_authority_owner_current(q)
 or not exists(select 1 from private.r05_revocations where policy_id=p.id and business_id=s.business_id)
 then raise exception 'r12_review_exact_owner_stop_required';end if;
 insert into private.r07_server_revocations(key_hash) values(q.controller_key_hash) on conflict do nothing;
 insert into private.r05_server_revocations(key_hash) values(q.admission_key_hash) on conflict do nothing;
 insert into pg_temp.r12_bootstrap_result values(jsonb_build_object('businessId',s.business_id,'scopeId',s.id,'policyRevoked',true,'controllerRevoked',true,'admissionRevoked',true,'activeAuthority',false,'providerCalls',0));
END $r12_review_close$;`;

/** Dedicated client, no caller transaction. No retries or upserts: uncertain
 * completion requires exact readback. The temporary input contains only the
 * reviewed payload and nonsecret hashes, never authentication/session context.
 */
export async function runOperatorRecipe(client,kind,input){
 if(!['stage','activate','close'].includes(kind))throw Error('Unknown review bootstrap recipe');
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Review bootstrap object required');
 const encoded=JSON.stringify(input);if(Buffer.byteLength(encoded,'utf8')>131072)throw Error('Review bootstrap input too large');
 await client.query('begin');
 try{
  await client.query("set local timezone='UTC'; set local lock_timeout='5s'; set local statement_timeout='30s'");
  await client.query('create temporary table r12_bootstrap_input(payload jsonb not null) on commit drop; create temporary table r12_bootstrap_result(payload jsonb not null) on commit drop');
  await client.query('insert into pg_temp.r12_bootstrap_input(payload) values($1::jsonb)',[encoded]);
  await client.query(kind==='stage'?STAGING_SQL:kind==='activate'?ACTIVATION_SQL:CLOSE_SQL);
  const rows=(await client.query('select payload from pg_temp.r12_bootstrap_result')).rows;
  if(rows.length!==1)throw Error('Unexpected review bootstrap result');
  await client.query('commit');return rows[0].payload;
 }catch(error){await client.query('rollback').catch(()=>{});throw error;}
}
