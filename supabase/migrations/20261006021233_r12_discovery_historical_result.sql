-- Read immutable completed discovery history without renewing execution scope.
-- No tables, authority enrollment, external calls or mutable result copy.
begin;
create function private.r12_discovery_completed_phase(a private.r07_attempts,p private.r07_plans) returns jsonb language plpgsql stable set search_path='' as $$
declare r private.r07_responses;w private.r12_discovery_wires;c private.r12_discovery_candidates;q private.r05_requests;mark timestamptz;proof jsonb;begin
 select * into r from private.r07_responses where attempt_id=a.id and business_id=p.business_id;
 select * into w from private.r12_discovery_wires where attempt_id=a.id and business_id=p.business_id and scope_id=(p.content->>'discoveryScopeId')::uuid;
 select * into c from private.r12_discovery_candidates where request_id=w.request_id;
 select * into q from private.r05_requests where id=w.request_id and business_id=p.business_id;
 select created_at into mark from private.r05_markers where request_id=w.request_id;
 select o.proof into proof from private.r12_discovery_receipt_checks rc join private.r12_discovery_receipt_observations o on o.check_id=rc.id where rc.request_id=c.request_id and o.proof is not null;
 if a.plan_id is distinct from p.id or a.business_id is distinct from p.business_id or a.status is distinct from 'completed' or r.content->>'outcome' is distinct from 'accepted'
 or p.content_hash is distinct from private.r04_hash(p.content) or r.content_hash is distinct from private.r04_hash(r.content)
 or not exists(select 1 from public.artifacts x where x.id=r.artifact_id and x.business_id=p.business_id and x.workflow_run_id=a.id and x.artifact_type='r12.discovery.'||a.step_key and x.content=r.content and x.checksum=r.content_hash)
 or r.content->>'planHash' is distinct from p.content_hash or r.content->>'inputHash' is distinct from a.input_hash or r.artifact_id is null or w.request_id is null or c.request_id is null or q.id is null or mark is null or proof is null
 or r.content->'result'->>'candidateHash' is distinct from c.candidate_hash or c.candidate_hash is distinct from private.stage14_hash(c.candidate)
 or r.content->'result'->>'outputHash' is distinct from private.stage14_hash(c.candidate->'output') or r.content->'result'->>'routeProofHash' is distinct from proof->>'proofHash'
 or c.candidate->'reportedMicrousd'='null'::jsonb or not exists(select 1 from private.r05_settlements z where z.request_id=c.request_id and z.actual_microunits=(c.candidate->>'reportedMicrousd')::bigint and z.provider_request_id=c.candidate->>'providerRequestId')
 then raise exception 'r12_completed_history_unverified';end if;
 return jsonb_build_object('stepKey',a.step_key,'attemptId',a.id,'artifactId',r.artifact_id,'responseHash',r.content_hash,'responseCanonicalHash',private.stage14_hash(r.content),'response',r.content,
 'binding',jsonb_build_object('scopeId',w.scope_id,'attemptId',a.id,'requestId',q.id,'phase',a.step_key,'request',(w.binding->>'requestJson')::jsonb,'maximumMicrousd',q.liability_microunits,'dispatchedAt',mark,'receiptExpiresAt',c.receipt_expires_at),
 'candidate',c.candidate,'proof',proof);
end $$;
revoke all on function private.r12_discovery_completed_phase(private.r07_attempts,private.r07_plans) from public,anon,authenticated,service_role;

create function public.r12_discovery_result_read(p_business_id uuid,p_scope_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s private.r12_discovery_scopes;p private.r07_plans;a private.r07_attempts;dep private.r07_attempts;prior public.product_experiments;installation public.installed_packs;
 step jsonb;pin jsonb;current_phase jsonb;dependency jsonb;dependencies jsonb:='[]';at_time timestamptz;committed bigint;output jsonb;begin
 if private.is_business_owner(p_business_id) is distinct from true then raise exception 'r12_owner_required' using errcode='42501';end if;
 select * into s from private.r12_discovery_scopes where id=p_scope_id and business_id=p_business_id;if s.id is null then return null;end if;
 select * into p from private.r07_plans where business_id=p_business_id and goal_id=s.goal_id and content->>'format'='r12.discovery.1' and content->>'discoveryScopeId'=s.id::text order by version desc limit 1;
 select * into a from private.r07_attempts where plan_id=p.id and business_id=p_business_id and step_key='review' and status='completed' order by private.r07_attempts.attempt desc limit 1;
 if a.id is null then return null;end if;
 if p.content->>'discoveryScopeHash' is distinct from s.amendment_hash or private.stage14_hash(s.amendment) is distinct from s.amendment_hash or jsonb_array_length(a.dependency_pins)<>4 then raise exception 'r12_completed_history_unverified';end if;
 current_phase:=private.r12_discovery_completed_phase(a,p);at_time:=(current_phase->'binding'->>'dispatchedAt')::timestamptz;
 committed:=(current_phase->'binding'->'request'->'requestMetadata'->>'r12CommittedBeforeAttemptMicrousd')::bigint;
 for pin in select value from jsonb_array_elements(a.dependency_pins) loop
 select * into dep from private.r07_attempts where id=(pin->>'attemptId')::uuid and plan_id=p.id and business_id=p_business_id and step_key=pin->>'stepKey';
 dependency:=private.r12_discovery_completed_phase(dep,p);
 if dependency->>'responseHash' is distinct from pin->>'resultHash' then raise exception 'r12_completed_history_unverified';end if;
 dependencies:=dependencies||jsonb_build_array(dependency);
 end loop;
 if (select array_agg(x->>'stepKey' order by x->>'stepKey') from jsonb_array_elements(dependencies)x) is distinct from array['plan','search1','select1','strategy'] then raise exception 'r12_completed_history_unverified';end if;
 select value into step from jsonb_array_elements(p.content->'steps')x where x->>'key'='review';
 select * into installation from public.installed_packs where id=(step->>'installationId')::uuid and business_id=p_business_id;
 if installation.id is null or private.r04_hash(installation.snapshot) is distinct from step->>'packSnapshotHash' then raise exception 'r12_completed_knowledge_unverified';end if;
 select * into prior from public.product_experiments where id=s.prior_round_id and business_id=p_business_id;
 if prior.id is null or committed is null or committed<0 or committed>=(prior.variables->'intent'->'limits'->>'maximumMicrousd')::bigint then raise exception 'r12_completed_history_unverified';end if;
 output:=jsonb_build_object('version','r12.discovery-saved-result.1','context',jsonb_build_object('planId',p.id,'planHash',p.content_hash,'plan',p.content,'step',step,
 'attempt',jsonb_build_object('id',a.id,'stepKey',a.step_key,'attempt',a.attempt,'status',a.status,'reason',a.reason,'inputHash',a.input_hash,'dependencyPins',a.dependency_pins,'repairEvidenceHash',a.repair_evidence_hash,'wireHash',null,'requestId',current_phase->'binding'->'requestId','responseHash',current_phase->'responseHash'),
 'knowledge',jsonb_build_object('format','r09.1','businessId',p_business_id,'planId',p.id,'pins','[]'::jsonb)),
 'inputs',jsonb_build_object('version','r12.discovery-inputs.1','businessId',p_business_id,'planId',p.id,'attemptId',a.id,'inputMode','receipt','validationAt',at_time,
 'knowledgeSnapshot',installation.snapshot,'knowledgeSnapshotHash',private.r04_hash(installation.snapshot),'knowledgeCanonicalHash',private.stage14_hash(installation.snapshot),
 'original',jsonb_build_object('businessId',s.business_id,'budgetAuthorityRootId',s.budget_authority_root_id,'priorRoundId',s.prior_round_id,'semanticGoalHash',prior.variables->>'semanticGoalHash','priorIntent',prior.variables->'intent','maximumMicrousd',prior.variables->'intent'->'limits'->'maximumMicrousd','committedMicrousd',committed,'hasUncertainCosts',false),
 'amendment',s.amendment,'dependencies',dependencies),'current',current_phase);
 if octet_length(output::text)>655360 then raise exception 'r12_completed_history_bound';end if;return output;
end $$;
revoke all on function public.r12_discovery_result_read(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.r12_discovery_result_read(uuid,uuid) to authenticated;
commit;
