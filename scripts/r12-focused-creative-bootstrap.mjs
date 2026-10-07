/** Finite focused creative enrollment. Import has no side effects. This recipe
 * never reads secrets, derives keys, launches workflows or contacts providers.
 * Genuine owner Prepare and policy confirmation are separate prerequisites. */
const declarations=`
 x jsonb;prep jsonb;q jsonb;staged jsonb;stage_body jsonb;policy jsonb;operations jsonb:='[]';op jsonb;v jsonb;scope jsonb;price_limits jsonb:='{}';
 a public.creative_approvals;r public.creative_runs;w public.workflow_runs;i public.installed_packs;p private.r05_policies;enrolled private.r12_focused_creative_scopes;
 cap private.r05_cap_versions;business private.r04_business_state;goal private.r04_goal_state;registered private.r05_operations;
 b uuid;owner_id uuid;stage_id uuid;k text;phase text;model text;field text;amount bigint;total bigint:=0;exposure text;phase_ceilings jsonb:='{}';
 stamp timestamptz;cutoff timestamptz;dispatch_until timestamptz;receipt_until timestamptz;hash text;
`;
const input=`
 select payload into strict x from pg_temp.r12_bootstrap_input;
 if current_user in ('anon','authenticated','service_role') then raise exception 'r12_creative_operator_required';end if;
 if jsonb_typeof(x) is distinct from 'object' or octet_length(x::text)>131072 then raise exception 'r12_creative_operator_input';end if;
 perform private.r12_pilot_safe(x);prep:=x->'preparation';q:=x->'quote';
`;
const resolve=`
 perform private.r04_keys(prep,array['businessId','approvalId','creativeRunId','workflowRunId','goalId','approvalHash','admissionKeyHash','runtimeCapabilityHash','dispatchAuthorized']);
 select * into a from public.creative_approvals where id=(prep->>'approvalId')::uuid and business_id=(prep->>'businessId')::uuid;
 b:=a.business_id;owner_id:=a.owner_user_id;
 perform 1 from public.businesses where id=b and owner_user_id=owner_id for update;
 if not found then raise exception 'r12_creative_operator_owner_changed';end if;
 select * into r from public.creative_runs where id=(prep->>'creativeRunId')::uuid and approval_id=a.id and business_id=b;
 select * into w from public.workflow_runs where id=(prep->>'workflowRunId')::uuid and id=r.workflow_run_id and business_id=b;
 select * into i from public.installed_packs where id=(a.snapshot->'focusedPilotBinding'->>'creativeInstallationId')::uuid and business_id=b and status='active';
 if a.id is null or r.id is null or w.id is null or i.id is null or not(a.snapshot ? 'focusedPilotBinding')
 or prep->'dispatchAuthorized' is distinct from 'false'::jsonb or prep->>'approvalHash' is distinct from a.approval_hash
 or prep->>'goalId' is distinct from w.goal_id::text or w.goal_id::text is distinct from a.snapshot->'focusedPilotBinding'->'adoption'->>'goalId'
 or not coalesce(prep->>'admissionKeyHash' ~ '^[a-f0-9]{64}$',false) or not coalesce(prep->>'runtimeCapabilityHash' ~ '^[a-f0-9]{64}$',false)
 or prep->>'runtimeCapabilityHash' is distinct from w.runtime_capability_hash
 or prep->>'runtimeCapabilityHash' is distinct from (select capability_hash from private.creative_run_capabilities where creative_run_id=r.id)
 or w.pack_installation_id is distinct from i.id or w.pack_snapshot is distinct from r.catalog_snapshot
 or w.input->'focusedPilotBinding' is distinct from a.snapshot->'focusedPilotBinding'
 or private.stage14_hash(i.snapshot) is distinct from a.snapshot->'focusedPilotBinding'->>'creativeInstallationSnapshotHash'
 then raise exception 'r12_creative_exact_owner_prepare_required';end if;
 stage_id:=private.stage4_deterministic_uuid('r12:focused-creative-stage:'||r.id);
`;
const freshRun=`
 if w.status<>'queued' or w.runtime_launch_status is distinct from 'reserved' or w.runtime_run_id is not null or w.runtime_launch_nonce is null
 or w.current_stage_key is distinct from 'brief:1' or exists(select 1 from public.creative_cost_reservations where creative_run_id=r.id)
 or exists(select 1 from private.r05_requests where workflow_run_id=w.id)
 or exists(select 1 from public.events where id=private.stage4_deterministic_uuid('r12:focused-creative-launch:'||r.id))
 then raise exception 'r12_creative_fresh_prepared_run_required';end if;
 perform private.stage14_assert_focused_adoption(a.candidate_id,a.snapshot);
 select * into business from private.r04_business_state where business_id=b;
 select * into goal from private.r04_goal_state where goal_id=w.goal_id and business_id=b;
 if goal.revision is distinct from (a.snapshot->'focusedPilotBinding'->'adoption'->>'goalRevision')::integer then raise exception 'r12_creative_goal_revision_frozen';end if;
 cutoff:=least(a.expires_at,r.capability_expires_at);stamp:=date_trunc('milliseconds',clock_timestamp());
 if cutoff<stamp+interval '60 minutes' then raise exception 'r12_creative_full_window_unavailable';end if;
`;
const quote=`
 perform private.r04_keys(q,array['version','approvalQuote','luna','reviewer','imagePricingFingerprint','imageCatalogHash','visionArchitectureHash','bounds','proposalOnly','dispatchAuthorized','quoteHash','verifiedAt','validUntil']);
 if q->>'version' is distinct from 'r12.focused-creative-quote.1' or q->'proposalOnly' is distinct from 'true'::jsonb or q->'dispatchAuthorized' is distinct from 'false'::jsonb
 or q->>'quoteHash' is distinct from private.stage14_hash(q-array['quoteHash','verifiedAt','validUntil'])
 or jsonb_typeof(q->'verifiedAt') is distinct from 'string' or jsonb_typeof(q->'validUntil') is distinct from 'string'
 or isfinite((q->>'verifiedAt')::timestamptz) is not true or isfinite((q->>'validUntil')::timestamptz) is not true
 or (q->>'verifiedAt')::timestamptz>clock_timestamp() or (q->>'validUntil')::timestamptz<=clock_timestamp()
 or (q->>'validUntil')::timestamptz<>(q->>'verifiedAt')::timestamptz+interval '5 minutes'
 or q->'bounds' is distinct from '{"textRequestBytes":24576,"originalImageBytes":3700000,"visionWireBytes":5000000,"maximumImages":1}'::jsonb
 or q->'approvalQuote'->>'generatorModel' is distinct from 'black-forest-labs/flux.2-klein-4b'
 or q->'approvalQuote'->'providerBinding' is distinct from a.quote->'providerBinding'
 or q->'approvalQuote'->'maximumCalls' is distinct from '4'::jsonb or q->'approvalQuote'->'maximaMicrousd'->'generation' is distinct from '70000'::jsonb
 then raise exception 'r12_creative_fresh_qualified_quote_required';end if;
 foreach field in array array['imagePricingFingerprint','imageCatalogHash','visionArchitectureHash'] loop
 if not coalesce(q->>field ~ '^[a-f0-9]{64}$',false) then raise exception 'r12_creative_quote_evidence_required';end if;end loop;
 foreach k in array array['brief:1','screen:1','generate:1','review:1'] loop
 phase:=split_part(k,':',1);field:=case when phase='generate' then 'generation' else phase end;amount:=(a.quote->'maximaMicrousd'->>field)::bigint;
 if amount not between 1 and 1000000 or (q->'approvalQuote'->'maximaMicrousd'->>field)::bigint not between 1 and amount then raise exception 'r12_creative_approved_ceiling_exceeded';end if;
 phase_ceilings:=phase_ceilings||jsonb_build_object(k,amount);total:=total+amount;
 if phase<>'generate' then
 v:=q->case when phase='brief' then 'luna' else 'reviewer' end;
 model:=case when phase='brief' then 'openai/gpt-5.6-luna' else 'anthropic/claude-haiku-4.5' end;
 if v->>'modelId' is distinct from model or v->>'canonicalModelId' is distinct from (case when phase='brief' then 'openai/gpt-5.6-luna-20260709' else 'anthropic/claude-4.5-haiku-20251001' end)
 or v->>'endpoint' is distinct from (case when phase='brief' then 'azure/us' else 'amazon-bedrock/us' end)
 or v->>'providerName' is distinct from (case when phase='brief' then 'Azure' else 'Amazon Bedrock' end)
 or v->'priceLimit'->'request' is distinct from '0'::jsonb
 or jsonb_typeof(v->'priceLimit'->'prompt') is distinct from 'number' or jsonb_typeof(v->'priceLimit'->'completion') is distinct from 'number'
 or (v->'priceLimit'->>'prompt')::numeric not between 0.000001 and 1000000 or (v->'priceLimit'->>'completion')::numeric not between 0.000001 and 1000000
 or ceil((32768+case when phase='review' then 8192 else 0 end)*(v->'priceLimit'->>'prompt')::numeric+(case when phase='brief' then 2500 else 1800 end)*(v->'priceLimit'->>'completion')::numeric)>amount
 then raise exception 'r12_creative_quote_route_or_price_changed';end if;
 price_limits:=price_limits||jsonb_build_object(k,v->'priceLimit');end if;
 end loop;
 if total>a.maximum_microusd then raise exception 'r12_creative_approved_total_exceeded';end if;
`;
export const STAGING_SQL=`DO $r12_creative_stage$ <<recipe>> DECLARE ${declarations} BEGIN
${input}
 perform private.r04_keys(x,array['preparation','quote','sourceDomains','dataClassesByPhase','executionReviewHash','eligibilityReviewHash','interpretationHash']);
 foreach field in array array['executionReviewHash','eligibilityReviewHash','interpretationHash'] loop
 if not coalesce(x->>field ~ '^[a-f0-9]{64}$',false) then raise exception 'r12_creative_operator_review_required';end if;end loop;
${resolve}${freshRun}${quote}
 if exists(select 1 from public.events where id=stage_id) or exists(select 1 from private.r12_focused_creative_scopes where creative_run_id=r.id)
 or exists(select 1 from private.r05_server_keys where key_hash=prep->>'admissionKeyHash') or exists(select 1 from private.r07_server_keys where key_hash=prep->>'admissionKeyHash')
 then raise exception 'r12_creative_stage_exists_or_key_reused';end if;
 perform private.r04_strings(x->'sourceDomains',8);perform private.r04_keys(x->'dataClassesByPhase',array['brief:1','screen:1','generate:1','review:1']);
 -- Lexical operation order matches the existing owner OperatingControls form.
 foreach k in array array['brief:1','generate:1','review:1','screen:1'] loop
 phase:=split_part(k,':',1);amount:=(phase_ceilings->>k)::bigint;perform private.r04_strings(x->'dataClassesByPhase'->k,8);
 model:=case when phase='brief' then 'openai/gpt-5.6-luna' when phase='generate' then 'black-forest-labs/flux.2-klein-4b' else 'anthropic/claude-haiku-4.5' end;
 insert into private.r05_operations(operation_key,pack_id,workflow_definition_id,provider,provider_model_id,purpose,currency,category,maximum_request_bytes,maximum_output_tokens,liability_microunits,source_domains,data_classes,qualification_hash,eligibility_hash,quote_hash,valid_from,valid_until)
 values('creative.r12.'||a.id||'.'||phase,i.root_pack_id,w.workflow_definition_id,'openrouter',model,'Private original-design learning','USD','model',case when phase='review' then 5000000 else 24576 end,case when phase='brief' then 2500 when phase='generate' then 0 else 1800 end,amount,x->'sourceDomains',x->'dataClassesByPhase'->k,x->>'executionReviewHash',x->>'eligibilityReviewHash',q->>'quoteHash',stamp,cutoff);
 operations:=operations||jsonb_build_array(jsonb_build_object('operationKey','creative.r12.'||a.id||'.'||phase,'installationId',i.id,'workflowDefinitionId',w.workflow_definition_id,'purpose','Private original-design learning','provider','openrouter','category','model','accountId',null,'accountRevision',null,'sourceDomains',x->'sourceDomains','dataClasses',x->'dataClassesByPhase'->k,'maximumPerOperationMicrounits',amount::text));
 end loop;
 select * into cap from private.r05_cap_versions where business_id=b and currency='USD' order by revision desc limit 1;
 select coalesce(sum(held),0)::text into exposure from private.r05_exposure(b) where currency='USD';
 if cap.business_id is null or exists(select 1 from private.r05_exposure(b) where unknown) then raise exception 'r12_creative_known_business_cap_required';end if;
 policy:=jsonb_build_object('version','r05.1','goalId',w.goal_id,'goalRevision',goal.revision,'businessRevision',business.revision,'currency','USD','businessLifetimeLimitMicrounits',cap.maximum_microunits::text,'policyLimitMicrounits',total::text,'categoryLimits',jsonb_build_array(jsonb_build_object('category','model','microunits',total::text)),'expectedCapRevision',cap.revision,'expectedExposureMicrounits',exposure,'startsAt',to_char(stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'expiresAt',to_char(cutoff at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'maximumDispatches',4,'minimumIntervalSeconds',0,'stopOnTarget',false,'financialMode','bounded_model_cost_only','operations',operations);
 stage_body:=jsonb_build_object('version','r12.focused-creative-stage.1','preparation',prep,'quote',q,'operatingPolicy',policy,'sourceDomains',x->'sourceDomains','dataClassesByPhase',x->'dataClassesByPhase','priceLimitsByPhase',price_limits,'executionReviewHash',x->'executionReviewHash','eligibilityReviewHash',x->'eligibilityReviewHash','interpretationHash',x->'interpretationHash');hash:=private.stage14_hash(stage_body);
 insert into public.events(id,business_id,workflow_run_id,event_type,actor_type,payload) values(stage_id,b,w.id,'r12.focused.creative.staged','system',stage_body||jsonb_build_object('stageHash',hash));
 insert into pg_temp.r12_bootstrap_result values(jsonb_build_object('preparation',prep,'stageHash',hash,'operatingPolicy',policy,'authorityCreated',false,'providerCalls',0,'shouldDispatch',false));
END $r12_creative_stage$;`;
export const ACTIVATION_SQL=`DO $r12_creative_activate$ <<recipe>> DECLARE ${declarations} BEGIN
${input}
 perform private.r04_keys(x,array['preparation','stageHash','policyId','policyHash','quote']);
${resolve}${freshRun}${quote}
 select payload into staged from public.events where id=stage_id and business_id=b and workflow_run_id=w.id and event_type='r12.focused.creative.staged';
 select * into p from private.r05_policies where id=(x->>'policyId')::uuid and business_id=b and goal_id=w.goal_id;
 if staged is null or staged->'preparation' is distinct from prep or staged->>'stageHash' is distinct from x->>'stageHash'
 or private.stage14_hash(staged-'stageHash') is distinct from x->>'stageHash' or p.id is null or p.content_hash is distinct from x->>'policyHash'
 or p.payload is distinct from staged->'operatingPolicy' or p.actor_id<>owner_id or p.goal_revision<>goal.revision or p.business_revision<>business.revision
 or not exists(select 1 from private.r05_confirmations where policy_id=p.id and business_id=b and actor_id=owner_id)
 or exists(select 1 from private.r05_revocations where policy_id=p.id) then raise exception 'r12_creative_exact_owner_policy_required';end if;
 foreach k in array array['brief:1','screen:1','review:1'] loop
 if (price_limits->k->>'prompt')::numeric>(staged->'priceLimitsByPhase'->k->>'prompt')::numeric or (price_limits->k->>'completion')::numeric>(staged->'priceLimitsByPhase'->k->>'completion')::numeric then raise exception 'r12_creative_staged_price_ceiling_exceeded';end if;end loop;
 foreach k in array array['brief:1','screen:1','generate:1','review:1'] loop
 phase:=split_part(k,':',1);select * into registered from private.r05_operations where operation_key='creative.r12.'||a.id||'.'||phase;
 if registered.operation_key is null or registered.qualification_hash is distinct from staged->>'executionReviewHash' or registered.eligibility_hash is distinct from staged->>'eligibilityReviewHash'
 or registered.quote_hash is distinct from staged->'quote'->>'quoteHash' or registered.source_domains is distinct from staged->'sourceDomains' or registered.data_classes is distinct from staged->'dataClassesByPhase'->k
 or registered.liability_microunits<>(phase_ceilings->>k)::bigint or registered.valid_until<stamp+interval '30 minutes'
 or exists(select 1 from private.r05_operation_revocations where operation_key=registered.operation_key) then raise exception 'r12_creative_staged_operation_changed';end if;end loop;
 dispatch_until:=stamp+interval '30 minutes';receipt_until:=dispatch_until+interval '30 minutes';
 if receipt_until>cutoff or dispatch_until>(p.payload->>'expiresAt')::timestamptz or stamp<(p.payload->>'startsAt')::timestamptz
 or exists(select 1 from private.r05_server_keys where key_hash=prep->>'admissionKeyHash') or exists(select 1 from private.r07_server_keys where key_hash=prep->>'admissionKeyHash')
 or exists(select 1 from private.r12_focused_creative_scopes where creative_run_id=r.id) then raise exception 'r12_creative_activation_window_or_key_conflict';end if;
 scope:=jsonb_build_object('version','r12.focused-creative-scope.1','businessId',b,'ownerId',owner_id,'creativeRunId',r.id,'workflowRunId',w.id,'approvalId',a.id,'approvalHash',a.approval_hash,'adoptionHash',private.stage14_hash(a.snapshot->'focusedPilotBinding'->'adoption'),'installationId',i.id,'installationSnapshotHash',private.stage14_hash(i.snapshot),'startsAt',stamp,'expiresAt',dispatch_until,'receiptUntil',receipt_until,'quoteHash',private.stage14_hash(a.quote),'phaseCeilings',phase_ceilings,'sourceDomains',staged->'sourceDomains','dataClassesByPhase',staged->'dataClassesByPhase','priceLimitsByPhase',staged->'priceLimitsByPhase');
 insert into private.r05_policy_proofs(policy_id,policy_hash,evidence_hash,valid_until) values(p.id,p.content_hash,staged->>'interpretationHash',receipt_until);
 insert into private.r05_server_keys(key_hash,expires_at) values(prep->>'admissionKeyHash',receipt_until);
 insert into private.r12_focused_creative_scopes(creative_run_id,business_id,workflow_run_id,approval_id,policy_id,admission_key_hash,scope,scope_hash) values(r.id,b,w.id,a.id,p.id,prep->>'admissionKeyHash',scope,private.stage14_hash(scope));
 insert into pg_temp.r12_bootstrap_result values(jsonb_build_object('businessId',b,'creativeRunId',r.id,'workflowRunId',w.id,'approvalId',a.id,'policyId',p.id,'policyHash',p.content_hash,'scopeHash',private.stage14_hash(scope),'scope',scope,'authorityCreated',true,'providerCalls',0,'shouldDispatch',false));
END $r12_creative_activate$;`;
export const CLOSE_SQL=`DO $r12_creative_close$ DECLARE ${declarations} BEGIN
${input}
 perform private.r04_keys(x,array['preparation','scopeHash','policyId','policyHash']);
${resolve}
 select * into enrolled from private.r12_focused_creative_scopes where creative_run_id=r.id and business_id=b;
 select * into p from private.r05_policies where id=(x->>'policyId')::uuid and business_id=b;
 if enrolled.creative_run_id is null or enrolled.scope_hash is distinct from x->>'scopeHash' or enrolled.policy_id is distinct from p.id
 or p.content_hash is distinct from x->>'policyHash' or enrolled.admission_key_hash is distinct from prep->>'admissionKeyHash'
 or not(w.status in ('completed','failed','needs_owner','cancelled') or exists(select 1 from private.r05_revocations where policy_id=p.id and business_id=b))
 then raise exception 'r12_creative_exact_terminal_or_owner_stop_required';end if;
 insert into private.r05_server_revocations(key_hash) values(enrolled.admission_key_hash) on conflict do nothing;
 insert into pg_temp.r12_bootstrap_result values(jsonb_build_object('businessId',b,'creativeRunId',r.id,'admissionRevoked',true,'activeAuthority',false,'providerCalls',0));
END $r12_creative_close$;`;
export async function runOperatorRecipe(client,kind,input){
 if(!['stage','activate','close'].includes(kind)||!input||typeof input!=='object'||Array.isArray(input))throw Error('Exact focused creative recipe required');
 const encoded=JSON.stringify(input);if(Buffer.byteLength(encoded)>131072)throw Error('Focused creative bootstrap input too large');
 await client.query('begin');try{
  await client.query("set local timezone='UTC'; set local lock_timeout='5s'; set local statement_timeout='30s'");
  await client.query('create temporary table r12_bootstrap_input(payload jsonb not null) on commit drop; create temporary table r12_bootstrap_result(payload jsonb not null) on commit drop');
  await client.query('insert into pg_temp.r12_bootstrap_input(payload) values($1::jsonb)',[encoded]);
  await client.query(kind==='stage'?STAGING_SQL:kind==='activate'?ACTIVATION_SQL:CLOSE_SQL);
  const rows=(await client.query('select payload from pg_temp.r12_bootstrap_result')).rows;if(rows.length!==1)throw Error('Exact creative operator result required');
  await client.query('commit');return rows[0].payload;
 }catch(error){await client.query('rollback').catch(()=>{});throw error;}
}
