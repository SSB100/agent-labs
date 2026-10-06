/** REVIEW ARTIFACT ONLY. No connection, environment lookup, provider call, or
 * automatic execution. Supply a dedicated approved operator client for SQL;
 * ownerBodies must be sent by the genuine owner-authenticated application.
 * Both SQL recipes require all eight frozen R12 migrations already applied.
 */
export const TARGET = Object.freeze({
  businessId:'91ff7c87-60e4-4dbb-8e84-be63b53c2c79',
  rootId:'3ebba15b-eaac-457e-8828-1311070b89fa',
  priorId:'065bc246-98eb-4f1b-90ba-aa76facb2727',
  packId:'7afd0fea-4faf-44ff-8362-846d116fece5',
  workflowId:'231fd18c-49d0-426c-88d6-a95f44516721',
  objective:'Research the best-supported starting geographic market for original nature T-shirts, recommend up to three concepts, and prepare the strongest for review.'
});
export const APPROVED_QUERY='Find published aggregate apparel-shopping evidence relevant to original nature T-shirts for adult outdoor/nature enthusiasts in US, GB, AU and NZ. Prioritize dated apparel quality, durability, price/value, design preferences and online purchase criteria from Ipsos and peer-reviewed Australian/New Zealand consumer studies. Keep exact country, study date, respondent population, sample denominator and sponsor with each factual snippet. Label UK evidence as UK, not GB, and narrow or broad apparel samples as adjacent rather than nature-shirt demand. Exclude marketplace listings, individual reviews, participant quotations, personal data and article artwork. Return inspectable factual excerpts and source URLs; identify countries or niche-demand questions with no relevant evidence.';
const literal=v=>`'${v.replaceAll("'","''")}'`;
const phases=`(values
 (0,'plan',23246,12288,1500,'98b4ff1e-8791-4403-8cec-0b4fd7fdaa79'::uuid,'product.discovery-v2.plan','3dc803226210cbf285e35791fec8d0b91de987442e0d4d7f38cbf1b5d8575f8a'),
 (1,'search1',149560,8192,4000,'c1551958-a0fd-47cc-bf86-fa0398a5261b'::uuid,'product.discovery-v2.research','f5f7ff8b09c98c1c5fd96146547372e821fe8545c73cdf98a7210d5fc88167e0'),
 (2,'select1',26311,16384,1000,'c1551958-a0fd-47cc-bf86-fa0398a5261b'::uuid,'product.discovery-v2.research','f5f7ff8b09c98c1c5fd96146547372e821fe8545c73cdf98a7210d5fc88167e0'),
 (3,'strategy',50451,32768,5000,'ebba060f-6f95-4a3f-93ff-c62b3809d7d2'::uuid,'product.discovery-v2.strategy','7537fdf72bdab5857de4549fe713bd9307b5c0ec5c23d0a9c6de1b7468e4451f'),
 (4,'review',157168,32768,4000,'b4632bb9-28b0-4e42-baea-5e661dea2952'::uuid,'product.discovery-v2.review','bf4b9fc6cc86ba4acb0b9fdb0c9d3406129dfda4e3a90fee48f2ff1d567beaa5')
) as v(ord,phase,amount,bytes,tokens,worker_id,worker_key,worker_hash)`;
const declarations=`
 x jsonb; b constant uuid := '${TARGET.businessId}'; root_id constant uuid := '${TARGET.rootId}'; prior_id constant uuid := '${TARGET.priorId}';
 pack_id constant uuid := '${TARGET.packId}'; workflow_id constant uuid := '${TARGET.workflowId}';
 g uuid; sid uuid; iid uuid; owner_id uuid; cutoff timestamptz; stamp timestamptz; d timestamptz; r timestamptz;
 goal private.r04_goal_versions; root public.product_experiments; prior public.product_experiments; cap private.r05_cap_versions;
 q jsonb; snapshot jsonb; budget jsonb; amendment jsonb; source_scope private.r12_discovery_scopes;
 fd public.workflow_definitions; wd public.worker_definitions; op private.r05_operations; adapter private.r07_adapters; p private.r05_policies;
 phase record; field text; expected_ops jsonb:='[]'; steps jsonb:='[]'; plan jsonb; policy jsonb; source_domains jsonb:='["ipsos.com","mdpi.com"]';
 data_classes jsonb; purpose text; operation_key text; adapter_key text; model_id text;
 phase_keys text[]:=array['plan','search1','select1','strategy','review'];
`;
const sharedChecks=(capRevision,capMaximum)=>`
 select payload into strict x from pg_temp.r12_bootstrap_input;
 g:=(x->>'goalId')::uuid;sid:=(x->>'scopeId')::uuid;iid:=(x->>'installationId')::uuid;owner_id:=(x->>'ownerId')::uuid;
 cutoff:=(x->>'sourceCutoff')::timestamptz;q:=x->'quote';
 if g is null or sid is null or iid is null or owner_id is null or sid in(root_id,prior_id) or cutoff is null or not isfinite(cutoff) then raise exception 'bootstrap_invalid_identity';end if;
 foreach field in array array['goalHash','approvalHash','ipsosReviewHash','mdpiReviewHash','independentReviewHash','executionReviewHash','eligibilityReviewHash'] loop
  if jsonb_typeof(x->field) is distinct from 'string' or x->>field !~ '^[a-f0-9]{64}$' then raise exception 'bootstrap_actual_review_hash_required: %',field;end if;
 end loop;
 -- This is operator SQL. No auth claims or role/session impersonation are set.
 if current_user in('anon','authenticated','service_role') then raise exception 'bootstrap_operator_required';end if;
 perform 1 from public.businesses where id=b and owner_user_id=owner_id for update;
 if not found then raise exception 'bootstrap_owner_changed';end if;
 select * into strict root from public.product_experiments where id=root_id and business_id=b for update;
 select * into strict prior from public.product_experiments where id=prior_id and business_id=b;
 if root.discovery_version<>'pod-discovery-2.0' or root.parent_discovery_id is not null or root.candidate_id is not null or root.status<>'failed'
  or root.variables->>'budgetAuthorityRootId'<>root_id::text or root.variables->'intent'->'limits'->'maximumMicrousd'<>'400000'::jsonb
  or private.stage14_hash(root.variables->'intent') is distinct from '92894207fbcc149e7e4cf91c924c5feb9adae732321966f86a70b8fa5d8b75fa'
  or prior.discovery_version<>'pod-discovery-2.0' or prior.parent_discovery_id is not null or prior.candidate_id is not null or prior.status<>'failed'
  or prior.variables->>'budgetAuthorityRootId'<>root_id::text or prior.variables->'intent'->'limits'->'maximumMicrousd'<>'2000000'::jsonb
  or private.stage14_hash(prior.variables->'intent') is distinct from 'f6be5c7bfde7b19fb4bb09a10f13b9d30d519785f7f9a8508a00b3cfe46d8170'
  or prior.variables->>'semanticGoalHash'<>'6e174b6a90ce9515abe3d27043501b01329f65dc8f25e93ed814b00f917cfcd7'
  then raise exception 'bootstrap_original_intent_drift';end if;
 if exists(select 1 from public.product_experiments e where e.business_id=b and e.discovery_version='pod-discovery-2.0' and e.parent_discovery_id is null and e.candidate_id is null and e.variables->>'budgetAuthorityRootId'=root_id::text and (e.created_at,e.id)>(prior.created_at,prior.id)) then raise exception 'bootstrap_latest_round_changed';end if;
 budget:=private.stage13v2_budget_authority(prior_id,true);
 if budget->'maximumMicrousd' is distinct from '2000000'::jsonb or budget->'committedMicrousd' is distinct from '109480'::jsonb or budget->'hasUncertainCosts' is distinct from 'false'::jsonb or jsonb_array_length(budget->'chainRootIds')<>9 then raise exception 'bootstrap_root_funding_changed';end if;
 if not exists(select 1 from private.r04_business_state s join private.r04_business_versions v using(business_id,revision) where s.business_id=b and s.revision=6 and v.preference='setup' and v.content_hash='97441d08503e1640763a6da50c191ae13aa4b23e86ffe0e2b25b3789005ead12') then raise exception 'bootstrap_business_pin_changed';end if;
 select v.* into strict goal from private.r04_goal_state s join private.r04_goal_versions v using(goal_id,business_id,revision) where s.business_id=b and s.goal_id=g;
 if goal.revision is distinct from (x->>'goalRevision')::integer or goal.content_hash is distinct from x->>'goalHash' or goal.actor_id<>owner_id or goal.preference<>'ready'
  or goal.content->>'objective' is distinct from ${literal(TARGET.objective)} or goal.content->>'originalIntent' is distinct from ${literal(TARGET.objective)}
  or goal.content->'parsed'->'geography' is distinct from '["US","GB","AU","NZ"]'::jsonb or goal.content->'parsed'->'budget' is distinct from '{"amount":"2","currency":"USD"}'::jsonb
  or goal.content->'ambiguities' is distinct from '[]'::jsonb then raise exception 'bootstrap_goal_pin_changed';end if;
 perform private.r04_parsed(goal.content->'parsed',true);
 if (((goal.content->'parsed'->'deadline'->>'date')||' '||(goal.content->'parsed'->'deadline'->>'time'))::timestamp at time zone (goal.content->'parsed'->'deadline'->>'timezone')) is distinct from cutoff then raise exception 'bootstrap_goal_deadline_mismatch';end if;
 if exists(select 1 from public.product_experiments e where e.business_id=b and e.discovery_version='pod-discovery-2.0' and ((budget->'chainRootIds') ? e.id::text or (budget->'chainRootIds') ? e.parent_discovery_id::text)
  and not exists(select 1 from private.r04_research_links l where l.experiment_id=e.id and l.business_id=b and l.goal_id=g and l.authority_root_id=root_id)) then raise exception 'bootstrap_owner_research_link_required';end if;
 if private.r05_paused(b,'business',b) or private.r05_paused(b,'quest',g) or private.r05_paused(b,'pack',iid) then raise exception 'bootstrap_scope_paused';end if;
 select * into strict cap from private.r05_cap_versions where business_id=b and currency='USD' order by revision desc limit 1;
 if cap.revision<>${capRevision} or cap.maximum_microunits<>${capMaximum} or (select coalesce(sum(held),0) from private.r05_exposure(b) where currency='USD')<>646851 or exists(select 1 from private.r05_exposure(b) where unknown) then raise exception 'bootstrap_business_financial_drift';end if;
 if exists(select 1 from private.r07_plans where business_id=b and goal_id=g) then raise exception 'bootstrap_goal_already_has_plan';end if;
 -- Share-lock exact registered definitions/releases; never promote them.
 perform 1 from public.packs where id=pack_id and pack_key='workflow.product-discovery-v2' and version='1.0.0' and status='experimental' for share;
 if not found then raise exception 'bootstrap_root_pack_changed';end if;
 snapshot:=jsonb_build_object('rootPackId',pack_id,'releases',private.stage10_resolve(pack_id,true));
 perform 1 from public.packs where id in(select (v->>'id')::uuid from jsonb_array_elements(snapshot->'releases') v) order by id for share;
 snapshot:=jsonb_build_object('rootPackId',pack_id,'releases',private.stage10_resolve(pack_id,true));
 if private.r04_hash(snapshot) is distinct from '6fe1a97c3667b5a9074a53a5156c2357c362871cd2ebd5735c19c39a9f344db0' or jsonb_array_length(snapshot->'releases')<>11 then raise exception 'bootstrap_snapshot_drift';end if;
 if cutoff>'2026-10-30T08:00:00Z'::timestamptz or cutoff<=clock_timestamp()+interval '30 minutes' then raise exception 'bootstrap_setup_window_insufficient';end if;
 select * into strict fd from public.workflow_definitions where id=workflow_id for share;
 if fd.workflow_key<>'product.discovery-v2.one' or fd.version<>'1.0.0' or fd.status<>'experimental' or fd.pack_id<>pack_id or private.r04_hash(to_jsonb(fd)) is distinct from '937e21bb9863a31de0cfbb48d97ae675b7a6a540cb05a029ad83e1dbb876e993' then raise exception 'bootstrap_workflow_definition_drift';end if;
 for phase in select * from ${phases} order by ord loop
  select * into strict wd from public.worker_definitions where id=phase.worker_id for share;
  if wd.worker_key<>phase.worker_key or wd.version<>'1.0.0' or wd.status<>'experimental' or private.r04_hash(to_jsonb(wd))<>phase.worker_hash then raise exception 'bootstrap_worker_definition_drift: %',phase.phase;end if;
 end loop;
 -- q must be fresh output from the reviewed six-catalog helper, not owner data.
 if q->>'version' is distinct from 'r12.discovery-quote.1' or q->'ceilings' is distinct from '{"plan":23246,"search1":149560,"select1":26311,"strategy":50451,"review":157168}'::jsonb
  or q->'maximumMicrousd' is distinct from '406736'::jsonb or q->'maximumCalls' is distinct from '5'::jsonb or q->'maximumCollections' is distinct from '1'::jsonb
  or q->'proposalOnly' is distinct from 'true'::jsonb or q->'dispatchAuthorized' is distinct from 'false'::jsonb
  or q->>'quoteHash' is distinct from private.stage14_hash(q-array['quoteHash','verifiedAt','validUntil'])
  or jsonb_typeof(q->'verifiedAt') is distinct from 'string' or jsonb_typeof(q->'validUntil') is distinct from 'string'
  or q->'retention' is distinct from '{"inference":"no_training_zdr","search":"query_retention_improvement_training_possible","schemas":"static_nonprivate_schema_only"}'::jsonb
  or q->'luna'->'acceptedResponseModelIds' is distinct from '["openai/gpt-5.6-luna","openai/gpt-5.6-luna-20260709"]'::jsonb
  or q->'reviewer'->'acceptedResponseModelIds' is distinct from '["anthropic/claude-haiku-4.5","anthropic/claude-4.5-haiku-20251001"]'::jsonb
  or not isfinite((q->>'verifiedAt')::timestamptz) or not isfinite((q->>'validUntil')::timestamptz) or (q->>'verifiedAt')::timestamptz>clock_timestamp() or (q->>'validUntil')::timestamptz<=clock_timestamp()
  or (q->>'validUntil')::timestamptz-(q->>'verifiedAt')::timestamptz<>interval '5 minutes'
  or q->'luna'->>'modelId' is distinct from 'openai/gpt-5.6-luna' or q->'luna'->>'canonicalModelId' is distinct from 'openai/gpt-5.6-luna-20260709'
  or q->'luna'->>'endpoint' is distinct from 'azure/us' or q->'luna'->>'providerName' is distinct from 'Azure'
  or q->'reviewer'->>'modelId' is distinct from 'anthropic/claude-haiku-4.5' or q->'reviewer'->>'canonicalModelId' is distinct from 'anthropic/claude-4.5-haiku-20251001'
  or q->'reviewer'->>'endpoint' is distinct from 'amazon-bedrock/us' or q->'reviewer'->>'providerName' is distinct from 'Amazon Bedrock'
  then raise exception 'bootstrap_fresh_exact_quote_required';end if;
`;
const phaseVariables=`
 operation_key:='research.r12.'||sid::text||'.'||phase.phase;adapter_key:='r12.discovery.'||sid::text||'.'||phase.phase;
 model_id:=case when phase.phase='review' then 'anthropic/claude-haiku-4.5' else 'openai/gpt-5.6-luna' end;
 purpose:='R12 original nature-shirt research: '||phase.phase;
 data_classes:=case when phase.phase='search1' then '["generic_public_query","public_evidence"]'::jsonb else '["business_context","public_evidence"]'::jsonb end;
`;
const addExpectedOperation=`
 expected_ops:=expected_ops||jsonb_build_array(jsonb_build_object('operationKey',operation_key,'installationId',iid,'workflowDefinitionId',workflow_id,'purpose',purpose,'provider','openrouter','category','model','accountId',null,'accountRevision',null,'sourceDomains',source_domains,'dataClasses',data_classes,'maximumPerOperationMicrounits',phase.amount::text));
`;
const buildPolicy=`
 -- Match the existing genuine-owner form's stable operation order and ISO UTC precision.
 select jsonb_agg(item order by item->>'operationKey') into expected_ops from jsonb_array_elements(expected_ops) item;
 policy:=jsonb_build_object('version','r05.1','goalId',g,'goalRevision',goal.revision,'businessRevision',6,'currency','USD','businessLifetimeLimitMicrounits','1053587','policyLimitMicrounits','406736','categoryLimits',jsonb_build_array(jsonb_build_object('category','model','microunits','406736')),'expectedCapRevision',6,'expectedExposureMicrounits','646851','startsAt',to_char((amendment->>'createdAt')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'expiresAt',to_char((amendment->>'expiresAt')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'maximumDispatches',5,'minimumIntervalSeconds',0,'stopOnTarget',false,'operations',expected_ops,'financialMode','bounded_model_cost_only');
`;
export const STAGING_SQL=`DO $r12_bootstrap$ <<recipe>> DECLARE ${declarations} BEGIN
${sharedChecks(6,848063)}
 stamp:=date_trunc('milliseconds',clock_timestamp());
 if cutoff>stamp+interval '1 day' then raise exception 'bootstrap_source_cutoff_exceeds_one_day';end if;
 if exists(select 1 from public.installed_packs where id=iid or business_id=b and root_pack_id=pack_id) or exists(select 1 from private.r12_discovery_scopes where id=sid or business_id=b and goal_id=g) then raise exception 'bootstrap_staging_identity_already_used';end if;
 amendment:=jsonb_build_object('version','r12.discovery-source-scope.1','id',sid,'businessId',b,'goalId',g,'budgetAuthorityRootId',root_id,'priorRoundId',prior_id,
  'originalIntentHash',private.stage14_hash(prior.variables->'intent'),'originalSemanticGoalHash',prior.variables->>'semanticGoalHash',
  'allowedDomains',source_domains,'excludedDomains','["etsy.com","etsy.me","etsystatic.com"]'::jsonb,
  'sourceReviews',jsonb_build_array(jsonb_build_object('domain','ipsos.com','basis','documented_api_factual_snippets','reviewHash',x->>'ipsosReviewHash'),jsonb_build_object('domain','mdpi.com','basis','documented_api_factual_snippets','reviewHash',x->>'mdpiReviewHash')),
  'approvalHash',x->>'approvalHash','independentReviewHash',x->>'independentReviewHash','approvedQuery',${literal(APPROVED_QUERY)},
  'purposeReviewHash',private.stage14_hash(jsonb_build_object('query',${literal(APPROVED_QUERY)},'classification','generic_nonpersonal_public_research')),'createdAt',stamp,'expiresAt',cutoff);
 insert into public.installed_packs(id,business_id,root_pack_id,root_pack_key,status,snapshot) values(iid,b,pack_id,'workflow.product-discovery-v2','active',snapshot);
 insert into private.r12_discovery_scopes(id,business_id,goal_id,budget_authority_root_id,prior_round_id,amendment,amendment_hash) values(sid,b,g,root_id,prior_id,amendment,private.stage14_hash(amendment));
 for phase in select * from ${phases} order by ord loop
  ${phaseVariables}
  insert into private.r05_operations(operation_key,pack_id,workflow_definition_id,provider,provider_model_id,purpose,currency,category,maximum_request_bytes,maximum_output_tokens,liability_microunits,source_domains,data_classes,qualification_hash,eligibility_hash,quote_hash,valid_from,valid_until)
   values(operation_key,pack_id,workflow_id,'openrouter',model_id,purpose,'USD','model',phase.bytes,phase.tokens,phase.amount,source_domains,data_classes,x->>'executionReviewHash',x->>'eligibilityReviewHash',q->>'quoteHash',stamp,cutoff);
  insert into private.r07_adapters(adapter_key,qualification_hash,workflow_definition_id,worker_definition_id,workflow_hash,worker_hash,operation_key,role,purpose,artifact_type,mode,valid_from,valid_until,knowledge_valid_until)
   values(adapter_key,x->>'executionReviewHash',workflow_id,phase.worker_id,private.r04_hash(to_jsonb(fd)),phase.worker_hash,operation_key,phase.phase,purpose,'r12.discovery.'||phase.phase,'qualification',stamp,cutoff,'2026-10-30T08:00:00Z');
  ${addExpectedOperation}
 end loop;
 ${buildPolicy}
 perform private.r05_policy_validate(b,policy);
 insert into pg_temp.r12_bootstrap_result values(jsonb_build_object('businessId',b,'scopeId',sid,'installationId',iid,'goalId',g,'goalRevision',goal.revision,'goalHash',goal.content_hash,'amendment',amendment,'amendmentHash',private.stage14_hash(amendment),'snapshotHash',private.r04_hash(snapshot),'policyPayload',policy,'policyPayloadHash',private.r04_hash(policy),'authorityCreated',false));
END $r12_bootstrap$;`;

export const ACTIVATION_SQL=`DO $r12_bootstrap$ <<recipe>> DECLARE ${declarations} BEGIN
${sharedChecks(7,1053587)}
 foreach field in array array['policyHash','policyInterpretationHash','controllerKeyHash','admissionKeyHash','amendmentHash'] loop
  if jsonb_typeof(x->field) is distinct from 'string' or x->>field !~ '^[a-f0-9]{64}$' then raise exception 'bootstrap_actual_activation_hash_required: %',field;end if;
 end loop;
 if x->>'controllerKeyHash'=x->>'admissionKeyHash' or exists(select 1 from private.r07_server_keys where key_hash in(x->>'controllerKeyHash',x->>'admissionKeyHash')) or exists(select 1 from private.r05_server_keys where key_hash in(x->>'controllerKeyHash',x->>'admissionKeyHash')) then raise exception 'bootstrap_fresh_separate_verifier_hashes_required';end if;
 select * into strict source_scope from private.r12_discovery_scopes where id=sid and business_id=b and goal_id=g;
 amendment:=source_scope.amendment;stamp:=(amendment->>'createdAt')::timestamptz;
 if source_scope.amendment_hash is distinct from x->>'amendmentHash' or private.stage14_hash(amendment) is distinct from x->>'amendmentHash'
  or source_scope.budget_authority_root_id<>root_id or source_scope.prior_round_id<>prior_id or (amendment->>'expiresAt')::timestamptz<>cutoff
  or amendment->>'approvalHash' is distinct from x->>'approvalHash' or amendment->>'independentReviewHash' is distinct from x->>'independentReviewHash'
  or amendment->'allowedDomains' is distinct from source_domains or amendment->>'approvedQuery' is distinct from ${literal(APPROVED_QUERY)}
  or amendment->'sourceReviews' is distinct from jsonb_build_array(jsonb_build_object('domain','ipsos.com','basis','documented_api_factual_snippets','reviewHash',x->>'ipsosReviewHash'),jsonb_build_object('domain','mdpi.com','basis','documented_api_factual_snippets','reviewHash',x->>'mdpiReviewHash')) then raise exception 'bootstrap_staged_scope_mismatch';end if;
 perform 1 from public.installed_packs i where i.id=iid and i.business_id=b and i.root_pack_id=recipe.pack_id and i.root_pack_key='workflow.product-discovery-v2' and i.status='active' and i.snapshot=recipe.snapshot for share;
 if not found then raise exception 'bootstrap_staged_installation_changed';end if;
 for phase in select * from ${phases} order by ord loop
  ${phaseVariables}
  select z.* into strict op from private.r05_operations z where z.operation_key=recipe.operation_key for share;
  select z.* into strict adapter from private.r07_adapters z where z.adapter_key=recipe.adapter_key for share;
  if op.pack_id<>pack_id or op.workflow_definition_id<>workflow_id or op.provider<>'openrouter' or op.provider_model_id<>model_id or op.purpose<>purpose or op.currency<>'USD' or op.category<>'model'
   or op.maximum_request_bytes<>phase.bytes or op.maximum_output_tokens<>phase.tokens or op.liability_microunits<>phase.amount or op.source_domains<>source_domains or op.data_classes<>data_classes
   or op.qualification_hash<>x->>'executionReviewHash' or op.eligibility_hash<>x->>'eligibilityReviewHash' or op.quote_hash<>q->>'quoteHash' or op.valid_from<>stamp or op.valid_until<>cutoff
   or adapter.qualification_hash<>x->>'executionReviewHash' or adapter.workflow_definition_id<>workflow_id or adapter.worker_definition_id<>phase.worker_id or adapter.workflow_hash<>private.r04_hash(to_jsonb(fd)) or adapter.worker_hash<>phase.worker_hash
   or adapter.operation_key<>operation_key or adapter.role<>phase.phase or adapter.purpose<>purpose or adapter.artifact_type<>'r12.discovery.'||phase.phase or adapter.mode<>'qualification' or adapter.valid_from<>stamp or adapter.valid_until<>cutoff or adapter.knowledge_valid_until<cutoff
   or exists(select 1 from private.r05_operation_revocations z where z.operation_key=op.operation_key) or exists(select 1 from private.r07_adapter_revocations z where z.adapter_key=adapter.adapter_key) then raise exception 'bootstrap_staged_registration_changed: %',phase.phase;end if;
  ${addExpectedOperation}
 end loop;
 ${buildPolicy}
 select * into strict p from private.r05_policies where id=(x->>'policyId')::uuid and business_id=b;
 if p.content_hash is distinct from x->>'policyHash' or p.content_hash is distinct from private.r04_hash(policy) or p.payload is distinct from policy or p.actor_id<>owner_id or cap.policy_id<>p.id
  or not exists(select 1 from private.r05_confirmations c where c.policy_id=p.id and c.business_id=b and c.actor_id=owner_id) or exists(select 1 from private.r05_revocations where policy_id=p.id) then raise exception 'bootstrap_exact_owner_policy_required';end if;
 perform private.r05_policy_validate(b,p.payload);
 if exists(select 1 from private.r12_discovery_authorities where scope_id=sid) or exists(select 1 from private.r05_policy_proofs where policy_id=p.id) then raise exception 'bootstrap_activation_already_present';end if;
 -- Start the paid window only after every setup/recheck above has completed.
 stamp:=date_trunc('milliseconds',clock_timestamp());d:=stamp+interval '30 minutes';r:=d+interval '30 minutes';
 if d>cutoff or (q->>'validUntil')::timestamptz<=stamp then raise exception 'bootstrap_activation_window_or_quote_expired';end if;
 for phase in select * from ${phases} order by ord loop
  ${phaseVariables}
  steps:=steps||jsonb_build_array(jsonb_build_object('key',phase.phase,'kind',case when phase.phase='search1' then 'research' when phase.phase='review' then 'review' else 'work' end,
   'objective','Complete the bounded original nature-shirt '||phase.phase||' phase','reason','Use only verified saved dependencies within the original research allowance',
   'adapter',adapter_key,'qualificationHash',x->>'executionReviewHash','installationId',iid,'packSnapshotHash',private.r04_hash(snapshot),'workflowDefinitionId',workflow_id,'workerDefinitionId',phase.worker_id,
   'role',phase.phase,'operationKey',operation_key,'purpose',purpose,'dependsOn',to_jsonb(phase_keys[1:phase.ord]),'expectedArtifactType','r12.discovery.'||phase.phase,'maximumMicrounits',phase.amount::text,
   'expiresAt',d,'notBefore',stamp,'measurement',null,'maximumRepairs',0));
 end loop;
 plan:=jsonb_build_object('format','r12.discovery.1','discoveryScopeId',sid,'discoveryScopeHash',source_scope.amendment_hash,'businessId',b,'goalId',g,'goalRevision',goal.revision,'goalHash',goal.content_hash,
  'businessRevision',6,'businessHash','97441d08503e1640763a6da50c191ae13aa4b23e86ffe0e2b25b3789005ead12','policyId',p.id,'policyHash',p.content_hash,'authorityRootId',b,
  'plannerWorkerDefinitionId','98b4ff1e-8791-4403-8cec-0b4fd7fdaa79','currency','USD','maximumMicrounits','406736','deadline',d,'expiresAt',d,'maximumRepairs',0,'maximumPivots',0,'maximumChildren',5,'maximumDispatches',5,
  'requiredChecks','["review"]'::jsonb,'finishCondition','all_required_outputs_verified','stopConditions','["no_permitted_work","deadline","repair_exhausted","owner_stopped"]'::jsonb,'steps',steps);
 insert into private.r05_policy_proofs(policy_id,policy_hash,evidence_hash,valid_until) values(p.id,p.content_hash,x->>'policyInterpretationHash',d);
 insert into private.r07_server_keys(key_hash,expires_at) values(x->>'controllerKeyHash',r);
 insert into private.r05_server_keys(key_hash,expires_at) values(x->>'admissionKeyHash',r);
 insert into private.r12_discovery_authorities(scope_id,business_id,goal_id,controller_key_hash,admission_key_hash,plan,plan_hash,mode,approval_hash,execution_review_hash,valid_until,receipt_until)
  values(sid,b,g,x->>'controllerKeyHash',x->>'admissionKeyHash',plan,private.r04_hash(plan),'qualification',x->>'approvalHash',x->>'executionReviewHash',d,r);
 insert into pg_temp.r12_bootstrap_result values(jsonb_build_object('businessId',b,'goalId',g,'scopeId',sid,'plan',plan,'planHash',private.r04_hash(plan),'activatedAt',stamp,'dispatchUntil',d,'receiptUntil',r,'providerCalls',0));
END $r12_bootstrap$;`;

/** Minimal parameter transport for the two SQL recipes. Fresh dedicated client;
 * no caller transaction. No retries/upserts: uncertain outcome requires readback.
 * The temporary input is not authentication/session context and is dropped at commit.
 */
export async function runOperatorRecipe(client,kind,input){
 if(!['stage','activate'].includes(kind))throw Error('Unknown bootstrap recipe');
 await client.query('begin');
 try{
  await client.query("set local timezone='UTC'; set local lock_timeout='5s'; set local statement_timeout='30s'");
  await client.query('create temporary table r12_bootstrap_input(payload jsonb not null) on commit drop; create temporary table r12_bootstrap_result(payload jsonb not null) on commit drop');
  await client.query('insert into pg_temp.r12_bootstrap_input(payload) values($1::jsonb)',[JSON.stringify(input)]);
  await client.query(kind==='stage'?STAGING_SQL:ACTIVATION_SQL);
  const result=(await client.query('select payload from pg_temp.r12_bootstrap_result')).rows;
  if(result.length!==1)throw Error('Unexpected bootstrap result');
  await client.query('commit');return result[0].payload;
 }catch(error){await client.query('rollback').catch(()=>{});throw error;}
}

/** Pure owner API bodies: each submissionId is a new caller-generated UUID.
 * Send using the genuine existing owner session, never the operator connection.
 */
export function ownerGoalCreateBody(sourceCutoff,submissionId){
 const cutoff=new Date(sourceCutoff);if(!Number.isFinite(cutoff.getTime())||cutoff.toISOString()!==sourceCutoff||cutoff.getUTCMilliseconds()!==0)throw Error('Use an approved whole-second UTC cutoff');
 const content={title:'Original nature-shirt geographic research',originalIntent:TARGET.objective,objective:TARGET.objective,
  parsed:{target:{amount:'1',currency:null,metric:'units'},budget:{amount:'2',currency:'USD'},deadline:{date:sourceCutoff.slice(0,10),time:sourceCutoff.slice(11,19),timezone:'UTC'},geography:['US','GB','AU','NZ'],
   scope:'One research packet for original nature T-shirts for adult outdoor and nature enthusiasts, comparing US/GB/AU/NZ and at most three concepts. Preserve the existing cumulative USD 2 research root and all prior costs. This slice permits only five bounded research calls, at most USD 0.406736 in total; no creative, listing, publication or commerce action.',
   stopConstraints:[
    'Only the approved ipsos.com/mdpi.com factual-snippet source scope and exact generic public query. No marketplace listings, individual reviews, participant quotations, personal data or artwork.',
    'At most planner, one Exa search, one selector, strategist and independent reviewer. No paid retry, fallback, pivot or extra collection. Each next phase needs saved valid output, known cost and verified route receipt.',
    'Final scoped dispatch authority lasts at most thirty minutes after setup; receipt-only grace lasts thirty more minutes. At most three single metadata GET claims per phase, fifteen total, separated by at least 120 seconds or longer Retry-After.',
    'Stop on expiry, owner withdrawal, changed scope, unresolved/over-limit cost, invalid source/output or exhausted/terminal receipt evidence. Higher phase quotes cannot raise any allowance. Research TEST/REJECT/NEEDS_MORE_EVIDENCE grants no creative or commerce permission.'
   ]},ambiguities:[]};
 return{p_business_id:TARGET.businessId,p_operation:'quest.save',p_payload:{goalId:null,expectedRevision:0,content},p_submission_id:submissionId};
}
export const ownerReadyBody=(goalId,expectedRevision,submissionId)=>({p_business_id:TARGET.businessId,p_operation:'quest.preference',p_payload:{goalId,expectedRevision,preference:'ready'},p_submission_id:submissionId});
export const ownerLinkPreviewBody=()=>({p_business_id:TARGET.businessId,p_experiment_id:TARGET.priorId});
export const ownerLinkBody=(goalId,expectedRevision,submissionId)=>({p_business_id:TARGET.businessId,p_operation:'research.link',p_payload:{goalId,expectedRevision,experimentId:TARGET.priorId},p_submission_id:submissionId});
export const ownerPrepareBody=scopeId=>({businessId:TARGET.businessId,scopeId});
export const ownerPolicyProposeBody=(staged,submissionId)=>({p_business_id:TARGET.businessId,p_operation:'propose',p_payload:staged.policyPayload,p_submission_id:submissionId});
export const ownerPolicyConfirmBody=(policyId,policyHash,submissionId)=>({p_business_id:TARGET.businessId,p_operation:'confirm',p_payload:{policyId,policyHash},p_submission_id:submissionId});
