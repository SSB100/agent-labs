-- Read only exact immutable completed R07 dependencies and their private R12
-- source/receipt lineage. No legacy worker artifact is copied or relabelled.
begin;
-- Historical reconstruction is private and used only with an exact already-
-- marked candidate whose receipt is verified within its original grace.
-- Ownership, Goal state and latest-root checks remain current.
do $migration$
declare definition text;signature text:='r12_discovery_scope_current(p private.r07_plans)';expiry text:=$expiry$(s.amendment->>'expiresAt')::timestamptz<=clock_timestamp()$expiry$;begin
 definition:=pg_get_functiondef('private.r12_discovery_scope_current(private.r07_plans)'::regprocedure);
 if (length(definition)-length(replace(definition,signature,'')))/length(signature)<>1 or (length(definition)-length(replace(definition,expiry,'')))/length(expiry)<>1 then raise exception 'r12_historical_scope_drift';end if;
 execute replace(replace(definition,signature,'r12_discovery_scope_at(p private.r07_plans,effective_at timestamp with time zone)'),expiry,$replacement$(s.amendment->>'expiresAt')::timestamptz<=effective_at$replacement$);
end $migration$;
revoke all on function private.r12_discovery_scope_at(private.r07_plans,timestamptz) from public,anon,authenticated,service_role;

create function private.r12_discovery_phase_inputs(a private.r07_attempts,p private.r07_plans) returns jsonb language plpgsql set search_path='' as $$
declare s private.r12_discovery_scopes;prior public.product_experiments;budget jsonb;own_held bigint:=0;own_pending bigint:=0;step jsonb;installation public.installed_packs;
 pin jsonb;dep private.r07_attempts;response private.r07_responses;wire private.r12_discovery_wires;c private.r12_discovery_candidates;r private.r05_requests;mark timestamptz;proof jsonb;dependencies jsonb:='[]';output jsonb;validation_at timestamptz:=clock_timestamp();input_mode text:='dispatch';begin
 select own_candidate.* into c from private.r12_discovery_candidates own_candidate join private.r12_discovery_wires own_wire on own_wire.request_id=own_candidate.request_id where own_wire.attempt_id=a.id and own_wire.business_id=p.business_id;
 if c.request_id is not null and private.r12_discovery_receipt_status(c)->>'status'='verified' then
 select created_at into strict validation_at from private.r05_markers where request_id=c.request_id;input_mode:='receipt';
 s:=private.r12_discovery_scope_at(p,validation_at);
 else s:=private.r12_discovery_scope_current(p);end if;
 select * into strict prior from public.product_experiments where id=s.prior_round_id;
 select value into step from jsonb_array_elements(p.content->'steps') x where x->>'key'=a.step_key;
 select * into installation from public.installed_packs where id=(step->>'installationId')::uuid and business_id=p.business_id and status='active' for share;
 if installation.id is null or private.r04_hash(installation.snapshot) is distinct from step->>'packSnapshotHash' then raise exception 'r12_knowledge_installation_changed';end if;
 budget:=private.stage13v2_budget_authority(s.prior_round_id,true);
 select coalesce(sum(e.held),0),coalesce(sum(e.held) filter(where e.is_pending),0) into own_held,own_pending from private.r12_discovery_exposure(s.budget_authority_root_id) e join private.r05_requests req on req.id=e.request_id where req.workflow_run_id=a.id;
 if jsonb_array_length(a.dependency_pins)>4 then raise exception 'r12_dependency_bound';end if;
 for pin in select value from jsonb_array_elements(a.dependency_pins) loop
 select * into dep from private.r07_attempts where id=(pin->>'attemptId')::uuid and business_id=p.business_id and plan_id=p.id and step_key=pin->>'stepKey' and status='completed';
 select * into response from private.r07_responses where attempt_id=dep.id and business_id=p.business_id and content_hash=pin->>'resultHash';
 select * into wire from private.r12_discovery_wires where attempt_id=dep.id and business_id=p.business_id and scope_id=s.id;
 select * into c from private.r12_discovery_candidates where request_id=wire.request_id;
 select * into r from private.r05_requests where id=wire.request_id and business_id=p.business_id;
 select created_at into mark from private.r05_markers where request_id=wire.request_id;
 if dep.id is null or response.attempt_id is null or response.content->>'outcome' is distinct from 'accepted' or wire.request_id is null or c.request_id is null or mark is null or private.r12_discovery_receipt_status(c)->>'status' is distinct from 'verified' then raise exception 'r12_completed_dependency_required';end if;
 select ro.proof into proof from private.r12_discovery_receipt_checks rc join private.r12_discovery_receipt_observations ro on ro.check_id=rc.id where rc.request_id=c.request_id and ro.proof is not null;
 if proof is null then raise exception 'r12_verified_dependency_required';end if;
 dependencies:=dependencies||jsonb_build_array(jsonb_build_object('stepKey',dep.step_key,'attemptId',dep.id,'artifactId',response.artifact_id,'responseHash',response.content_hash,'responseCanonicalHash',private.stage14_hash(response.content),'response',response.content,
 'binding',jsonb_build_object('scopeId',s.id,'attemptId',dep.id,'requestId',r.id,'phase',dep.step_key,'request',(wire.binding->>'requestJson')::jsonb,'maximumMicrousd',r.liability_microunits,'dispatchedAt',mark,'receiptExpiresAt',c.receipt_expires_at),
 'candidate',c.candidate,'proof',proof));
 end loop;
 output:=jsonb_build_object('version','r12.discovery-inputs.1','businessId',p.business_id,'planId',p.id,'attemptId',a.id,'inputMode',input_mode,'validationAt',validation_at,'knowledgeSnapshot',installation.snapshot,'knowledgeSnapshotHash',private.r04_hash(installation.snapshot),'knowledgeCanonicalHash',private.stage14_hash(installation.snapshot),
 'original',jsonb_build_object('businessId',s.business_id,'budgetAuthorityRootId',s.budget_authority_root_id,'priorRoundId',s.prior_round_id,'semanticGoalHash',prior.variables->>'semanticGoalHash','priorIntent',prior.variables->'intent','maximumMicrousd',budget->'maximumMicrousd','committedMicrousd',(budget->>'committedMicrousd')::bigint-own_held,'hasUncertainCosts',(budget->>'pendingExposureMicrousd')::bigint>own_pending),
 'amendment',s.amendment,'dependencies',dependencies);
 if octet_length(output::text)>524288 then raise exception 'r12_complete_input_bound';end if;
 if input_mode='receipt' then
 select own_candidate.* into c from private.r12_discovery_candidates own_candidate join private.r12_discovery_wires own_wire on own_wire.request_id=own_candidate.request_id where own_wire.attempt_id=a.id and own_wire.business_id=p.business_id;
 if private.r12_discovery_receipt_status(c)->>'status' is distinct from 'verified' then raise exception 'r12_receipt_grace_ended';end if;
 perform private.r12_discovery_scope_at(p,validation_at);
 else perform private.r12_discovery_scope_current(p);end if;return output;
end $$;
revoke all on function private.r12_discovery_phase_inputs(private.r07_attempts,private.r07_plans) from public,anon,authenticated,service_role;
do $migration$
declare definition text;old text:=$old$ select * into rb from private.r07_bindings where attempt_id=a.id and business_id=p_business_id;$old$;replacement text;begin
 definition:=pg_get_functiondef('public.r12_discovery_server(uuid,uuid,text,jsonb,text)'::regprocedure);
 replacement:=$new$ if p_operation='inputs' then
 perform private.r04_keys(p_payload,array[]::text[]);v:=private.r12_discovery_phase_inputs(a,p);perform private.r12_discovery_key(key_hash);return v;end if;
$new$||old;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_inputs_server_drift';end if;
 execute replace(definition,old,replacement);
end $migration$;
commit;
