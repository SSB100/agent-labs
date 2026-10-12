-- Qualified .3 failed effects are immutable observations, never accepted output.
-- Same scope, same counted pass/call/search ledger, same three metadata reads.
-- Definition only: this migration creates no grant, activation or paid effect.
begin;
create table private.r12_pod_failed_effects (
 request_id uuid primary key references private.r12_discovery_wires(request_id),
 attempt_id uuid not null unique references private.r07_attempts(id),
 scope_id uuid not null references private.r12_discovery_scopes(id),
 subject jsonb not null, subject_hash text not null check(subject_hash=private.stage14_hash(subject)),
 receipt_expires_at timestamptz not null check(isfinite(receipt_expires_at)),
 created_at timestamptz not null default clock_timestamp(),
 check(octet_length(subject::text)<=8192)
);
alter table private.r12_pod_failed_effects enable row level security;
revoke all on private.r12_pod_failed_effects from public,anon,authenticated,service_role;
create trigger pod_failed_effect_immutable before insert or update or delete on private.r12_pod_failed_effects
 for each row execute function private.r12_discovery_history_guard();
-- A receipt belongs to a dispatched wire. It may prove a rejected generation
-- without fabricating an accepted candidate. The original (request,attempt)
-- unique key and attempt BETWEEN 1 AND 3 remain the single shared allowance.
alter table private.r12_discovery_receipt_checks drop constraint r12_discovery_receipt_checks_request_id_fkey;
alter table private.r12_discovery_receipt_checks add constraint r12_discovery_receipt_checks_request_id_fkey
 foreign key(request_id) references private.r12_discovery_wires(request_id);
create function private.r12_pod_receipt_subject_guard() returns trigger language plpgsql set search_path='' as $$ begin
 if not exists(select 1 from private.r12_discovery_candidates where request_id=new.request_id)
 and not exists(select 1 from private.r12_pod_failed_effects f join private.r12_discovery_scopes s on s.id=f.scope_id
 where f.request_id=new.request_id and s.origin='pod_goal' and s.amendment->>'version'='r12.pod-research-goal.3')
 then raise exception 'r12_receipt_subject_required';end if;
 return new;
end $$;
create trigger pod_receipt_subject before insert on private.r12_discovery_receipt_checks
 for each row execute function private.r12_pod_receipt_subject_guard();

create function private.r12_pod_counted_receipt_status(request uuid,expiry timestamptz) returns jsonb
language plpgsql stable set search_path='' as $$
declare q private.r12_discovery_receipt_checks;o private.r12_discovery_receipt_observations;first_at timestamptz;n timestamptz;state text;begin
 select * into q from private.r12_discovery_receipt_checks where request_id=request order by attempt desc limit 1;
 select * into o from private.r12_discovery_receipt_observations where check_id=q.id;
 select min(created_at) into first_at from private.r12_discovery_receipt_checks where request_id=request;
 -- Immediate, first + 2m, first + 8m; an outstanding read gets at least its
 -- previous 2m claim window. A later provider Retry-After always wins.
 n:=case when q.id is null then null else greatest(q.created_at+interval '2 minutes',
  first_at+case when q.attempt=1 then interval '2 minutes' when q.attempt=2 then interval '8 minutes' else interval '0' end,o.retry_after_at) end;
 if clock_timestamp()>=expiry then state:='expired';
 elsif o.proof is not null then state:='verified';
 elsif o.terminal then state:='terminal';
 elsif q.attempt=3 and (o.check_id is not null or clock_timestamp()>=n) then state:='exhausted';
 elsif q.id is not null and o.check_id is null and clock_timestamp()<n then state:='checking_receipt';
 else state:='awaiting_receipt';end if;
 return jsonb_build_object('requestId',request,'status',state,'attempts',coalesce(q.attempt,0),
 'nextCheckAt',case when state in ('awaiting_receipt','checking_receipt') then n else null end,
 'receiptExpiresAt',expiry,'diagnostic',o.diagnostic,'proofHash',o.proof->>'proofHash');
end $$;
alter function private.r12_discovery_receipt_status(private.r12_discovery_candidates) rename to r12_discovery_receipt_status_before_counted_failure;
create function private.r12_discovery_receipt_status(c private.r12_discovery_candidates) returns jsonb
language plpgsql stable set search_path='' as $$ begin
 if exists(select 1 from private.r12_discovery_wires w join private.r12_discovery_scopes s on s.id=w.scope_id
 where w.request_id=c.request_id and s.origin='pod_goal' and s.amendment->>'version'='r12.pod-research-goal.3') then
 return private.r12_pod_counted_receipt_status(c.request_id,c.receipt_expires_at)||jsonb_build_object('candidateHash',c.candidate_hash);end if;
 return private.r12_discovery_receipt_status_before_counted_failure(c);
end $$;

create function private.r12_pod_failed_effect_projection(f private.r12_pod_failed_effects) returns jsonb
language sql stable set search_path='' as $$
 select case when f.request_id is null then null else jsonb_build_object('subject',f.subject,'subjectHash',f.subject_hash,
 'receipt',private.r12_pod_counted_receipt_status(f.request_id,f.receipt_expires_at)||jsonb_build_object('subjectHash',f.subject_hash),
 'proof',(select o.proof from private.r12_discovery_receipt_checks q join private.r12_discovery_receipt_observations o on o.check_id=q.id where q.request_id=f.request_id and o.proof is not null)) end
$$;
create function private.r12_pod_failed_proof_validate(f private.r12_pod_failed_effects,v jsonb) returns void
language plpgsql set search_path='' as $$
declare provider text;endpoint text;models jsonb;x jsonb;begin
 provider:=case when f.subject->>'phase'='review' then 'Amazon Bedrock' else 'Azure' end;
 endpoint:=case when provider='Azure' then 'azure/us' else 'amazon-bedrock/us' end;
 models:=case when provider='Azure' then '["openai/gpt-5.6-luna","openai/gpt-5.6-luna-20260709"]'::jsonb else '["anthropic/claude-haiku-4.5","anthropic/claude-4.5-haiku-20251001"]'::jsonb end;
 perform private.r04_keys(v,array['generationId','providerName','modelId','requestedEndpoint','providerResponses','proofHash']);
 if v->>'generationId' is distinct from f.subject->>'providerRequestId' or v->>'providerName' is distinct from provider
 or v->>'requestedEndpoint' is distinct from endpoint or not coalesce(models ? (v->>'modelId'),false)
 or v->>'proofHash' is distinct from private.stage14_hash(v-'proofHash') or jsonb_typeof(v->'providerResponses') is distinct from 'array'
 or jsonb_array_length(v->'providerResponses')>64 then raise exception 'r12_receipt_proof_invalid';end if;
 for x in select value from jsonb_array_elements(v->'providerResponses') loop
 perform private.r04_keys(x,array['providerName','modelId','status']);
 if x->>'providerName' is distinct from provider or not coalesce(models ? (x->>'modelId'),false) or x->'status' is distinct from '200'::jsonb then raise exception 'r12_receipt_proof_invalid';end if;
 end loop;
end $$;

-- Called only after the existing scoped application/controller, producer,
-- Business, plan, marked request and receipt-window gates in the R12 server.
create function private.r12_pod_failed_effect_server(a private.r07_attempts,p private.r07_plans,w private.r12_discovery_wires,r private.r05_requests,op text,payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare s private.r12_discovery_scopes;d private.r12_pod_passes;f private.r12_pod_failed_effects;
 received private.r12_discovery_response_observations;rejected private.r12_discovery_response_observations;
 q private.r12_discovery_receipt_checks;o private.r12_discovery_receipt_observations;c private.r12_discovery_candidates;
 v jsonb;state jsonb;identity jsonb;models jsonb;mark timestamptz;expiry timestamptz;retry_at timestamptz;terminal boolean;code text;http integer;begin
 select * into s from private.r12_discovery_scopes where id=w.scope_id;
 if s.origin is distinct from 'pod_goal' or s.amendment->>'version' is distinct from 'r12.pod-research-goal.3'
 or p.content->>'format' is distinct from 'r12.pod-research.2' or p.content->>'discoveryScopeId' is distinct from s.id::text
 or p.content->>'discoveryScopeHash' is distinct from s.amendment_hash or w.attempt_id is distinct from a.id
 or w.business_id is distinct from p.business_id or r.workflow_run_id is distinct from a.id or r.policy_id is distinct from p.policy_id
 or r.payload->>'operationKey' is distinct from 'research.r12.'||s.id::text||'.'||a.step_key
 or w.binding_hash is distinct from private.stage14_hash(w.binding) or w.binding->>'attemptId' is distinct from a.id::text
 or w.binding->>'requestId' is distinct from r.id::text or w.binding->>'requestHash' is distinct from r.payload->>'requestHash'
 or w.binding->>'wireHash' is distinct from r.payload->>'wireRequestHash' then raise exception 'r12_pod_failed_effect_scope_required';end if;
 select * into d from private.r12_pod_passes where scope_id=s.id and ordinal=a.adaptive_action_ordinal and content_hash=a.adaptive_action_hash;
 select created_at into mark from private.r05_markers where request_id=r.id and business_id=p.business_id;
 if d.scope_id is null or mark is null or not exists(select 1 from private.r07_markers where attempt_id=a.id and business_id=p.business_id)
 or not exists(select 1 from private.r12_discovery_transport_claims where request_id=r.id)
 or not exists(select 1 from private.r12_pod_pass_calls where scope_id=s.id and ordinal=d.ordinal and attempt_id=a.id and request_id=r.id and phase=a.step_key)
 then raise exception 'r12_pod_failed_effect_marked_pass_required';end if;
 expiry:=least((p.content->>'expiresAt')::timestamptz+interval '30 minutes',mark+interval '60 minutes',
 (select receipt_until from private.r12_discovery_authorities where scope_id=s.id and plan=p.content and controller_key_hash=w.producer_key_hash));
 select * into f from private.r12_pod_failed_effects where request_id=r.id;
 if op='failure_stage' then
 perform private.r04_keys(payload,array['received']);identity:=payload->'received';
 perform private.r04_keys(identity,array['providerRequestId','providerModelId','actualMicrounits']);
 select * into received from private.r12_discovery_response_observations where request_id=r.id and kind='received';
 select * into rejected from private.r12_discovery_response_observations where request_id=r.id and kind='rejected';
 select * into c from private.r12_discovery_candidates where request_id=r.id;
 models:=case when a.step_key='review' then '["anthropic/claude-haiku-4.5","anthropic/claude-4.5-haiku-20251001"]'::jsonb else '["openai/gpt-5.6-luna","openai/gpt-5.6-luna-20260709"]'::jsonb end;
 if received.request_id is null or rejected.request_id is null or rejected.payload->'observationSaved' is distinct from 'true'::jsonb
 or not coalesce(rejected.payload->>'code' in ('json_parse','response_schema','response_size','finish_reason','next_consumer_capacity'),false)
 or (a.step_key='search1' and (c.request_id is null or rejected.payload->>'code'='response_schema'))
 or not coalesce(received.payload->>'contentState' in ('complete','oversized'),false)
 or (rejected.payload->>'code'='finish_reason' and received.payload->>'finishReason' is distinct from 'length')
 or (rejected.payload->>'code'<>'finish_reason' and received.payload->>'finishReason' is distinct from 'stop')
 or identity->>'providerRequestId' is distinct from received.payload->>'providerRequestId'
 or identity->>'providerModelId' is distinct from received.payload->>'providerModelId'
 or not coalesce(identity->>'providerRequestId' ~ '^gen-[A-Za-z0-9_-]+$',false)
 or length(identity->>'providerRequestId')>300
 or not coalesce(models ? (identity->>'providerModelId'),false)
 or jsonb_typeof(identity->'actualMicrounits') is distinct from 'string' or not coalesce(identity->>'actualMicrounits' ~ '^(0|[1-9][0-9]{0,7})$',false)
 or (identity->>'actualMicrounits')::bigint>r.liability_microunits
 or (c.request_id is not null and (c.candidate->>'providerRequestId' is distinct from identity->>'providerRequestId'
 or c.candidate->>'providerModelId' is distinct from identity->>'providerModelId' or c.candidate->>'reportedMicrousd' is distinct from identity->>'actualMicrounits'))
 then raise exception 'r12_pod_known_recoverable_failure_required';end if;
 if a.step_key='search1' then perform private.r12_pod_candidate_sources(a,p,c.candidate);end if;
 v:=jsonb_build_object('version','r12.pod-failed-effect.3','scopeId',s.id,'scopeHash',s.amendment_hash,'planId',p.id,'planHash',p.content_hash,
 'actionOrdinal',d.ordinal,'actionHash',d.content_hash,'attemptId',a.id,'requestId',r.id,'phase',a.step_key,'bindingHash',w.binding_hash,
 'wireHash',w.binding->>'wireHash','requestHash',w.binding->>'requestHash','providerRequestId',identity->>'providerRequestId',
 'providerModelId',identity->>'providerModelId','actualMicrounits',identity->>'actualMicrounits','observationHash',received.payload_hash,
 'diagnosticHash',rejected.payload_hash,'failureKind',rejected.payload->>'code','receiptExpiresAt',expiry);
 if f.request_id is not null then
 if f.subject is distinct from v then raise exception 'r12_pod_failed_effect_conflict';end if;
 return private.r12_pod_failed_effect_projection(f)||jsonb_build_object('staged',true,'replayed',true);end if;
 if clock_timestamp()>=expiry or exists(select 1 from private.r07_responses where attempt_id=a.id)
 or exists(select 1 from private.r12_pod_pass_closures where scope_id=s.id and ordinal=d.ordinal)
 then raise exception 'r12_pod_failed_effect_inactive';end if;
 insert into private.r12_pod_failed_effects(request_id,attempt_id,scope_id,subject,subject_hash,receipt_expires_at)
 values(r.id,a.id,s.id,v,private.stage14_hash(v),expiry) returning * into f;
 return private.r12_pod_failed_effect_projection(f)||jsonb_build_object('staged',true,'replayed',false);
 end if;
 if f.request_id is null or payload->>'subjectHash' is distinct from f.subject_hash then raise exception 'r12_pod_failed_effect_required';end if;
 state:=private.r12_pod_counted_receipt_status(f.request_id,f.receipt_expires_at)||jsonb_build_object('subjectHash',f.subject_hash);
 if op='failure_claim' then
 perform private.r04_keys(payload,array['subjectHash']);
 if state->>'status' in ('verified','terminal','exhausted','expired') then return state||jsonb_build_object('claimed',false,'claimId',null,'reason',state->>'status');end if;
 if state->>'nextCheckAt' is not null and clock_timestamp()<(state->>'nextCheckAt')::timestamptz then return state||jsonb_build_object('claimed',false,'claimId',null,'reason','cooldown');end if;
 insert into private.r12_discovery_receipt_checks(request_id,attempt) values(r.id,(state->>'attempts')::integer+1) returning * into q;
 return private.r12_pod_counted_receipt_status(f.request_id,f.receipt_expires_at)||jsonb_build_object('subjectHash',f.subject_hash,'claimed',true,'claimId',q.id,'reason','claimed');
 elsif op<>'failure_record' then raise exception 'r12_pod_failed_effect_operation_invalid';end if;
 perform private.r04_keys(payload,array['subjectHash','claimId','proof','diagnostic','retryAfterAt']);
 select * into q from private.r12_discovery_receipt_checks where id=(payload->>'claimId')::uuid and request_id=r.id;
 if q.id is null or exists(select 1 from private.r12_discovery_receipt_checks where request_id=r.id and attempt>q.attempt) then raise exception 'r12_receipt_claim_invalid';end if;
 if (payload->'proof'='null'::jsonb)=(payload->'diagnostic'='null'::jsonb) or not(payload ?& array['proof','diagnostic','retryAfterAt']) then raise exception 'r12_receipt_record_invalid';end if;
 if payload->'proof'<>'null'::jsonb then
 perform private.r12_pod_failed_proof_validate(f,payload->'proof');terminal:=false;
 if payload->'retryAfterAt' is distinct from 'null'::jsonb then raise exception 'r12_retry_after_invalid';end if;
 else
 perform private.r04_keys(payload->'diagnostic',array['code','httpStatus']);code:=payload->'diagnostic'->>'code';
 if not coalesce(code in ('invalid_request','configuration_unavailable','transport_failure','timeout','redirect_rejected','api_failure','response_too_large','json_invalid','response_invalid','generation_mismatch','provider_mismatch','model_mismatch','provider_responses_invalid'),false) then raise exception 'r12_diagnostic_invalid';end if;
 if payload->'diagnostic'->'httpStatus'<>'null'::jsonb then
 if jsonb_typeof(payload->'diagnostic'->'httpStatus') is distinct from 'number' or payload->'diagnostic'->>'httpStatus' !~ '^[1-5][0-9]{2}$' then raise exception 'r12_diagnostic_invalid';end if;http:=(payload->'diagnostic'->>'httpStatus')::integer;end if;
 terminal:=not(code in ('transport_failure','timeout') or code='api_failure' and coalesce(http in (404,429) or http between 500 and 599,false));
 if payload->'retryAfterAt'<>'null'::jsonb then
 if terminal or jsonb_typeof(payload->'retryAfterAt') is distinct from 'string' or payload->>'retryAfterAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then raise exception 'r12_retry_after_invalid';end if;
 retry_at:=(payload->>'retryAfterAt')::timestamptz;if not isfinite(retry_at) then raise exception 'r12_retry_after_invalid';end if;end if;
 end if;
 select * into o from private.r12_discovery_receipt_observations where check_id=q.id;
 if o.check_id is not null then
 if o.proof is distinct from nullif(payload->'proof','null'::jsonb) or o.diagnostic is distinct from nullif(payload->'diagnostic','null'::jsonb) or o.retry_after_at is distinct from retry_at then raise exception 'r12_receipt_record_conflict';end if;
 return state||jsonb_build_object('recorded',true,'replayed',true);end if;
 if clock_timestamp()>=f.receipt_expires_at then raise exception 'r12_receipt_inactive';end if;
 insert into private.r12_discovery_receipt_observations(check_id,proof,diagnostic,retry_after_at,terminal)
 values(q.id,nullif(payload->'proof','null'::jsonb),nullif(payload->'diagnostic','null'::jsonb),retry_at,terminal);
 return private.r12_pod_counted_receipt_status(f.request_id,f.receipt_expires_at)||jsonb_build_object('subjectHash',f.subject_hash,'recorded',true,'replayed',false);
end $$;

-- Fail closed at the response trigger: .3 failures use their actual proof and
-- known R05 charge, while every accepted/legacy output keeps the old validator.
create function private.r12_pod_failed_response_valid(a private.r07_attempts,p private.r07_plans,v jsonb) returns boolean
language plpgsql stable set search_path='' as $$
declare f private.r12_pod_failed_effects;state jsonb;begin
 select * into f from private.r12_pod_failed_effects where attempt_id=a.id;
 if f.request_id is null or f.subject->>'planId' is distinct from p.id::text or f.subject->>'planHash' is distinct from p.content_hash
 or f.subject->>'actionHash' is distinct from a.adaptive_action_hash or f.subject->>'actionOrdinal' is distinct from a.adaptive_action_ordinal::text
 or v->>'outcome' is distinct from 'failed' or v->>'planHash' is distinct from p.content_hash or v->>'inputHash' is distinct from a.input_hash
 or v->'result'->>'verdict' is distinct from 'reject' or v->'result'->>'failureSubjectHash' is distinct from f.subject_hash
 or v->'result'->>'diagnosticHash' is distinct from f.subject->>'diagnosticHash'
 or not exists(select 1 from private.r12_discovery_scopes s where s.id=f.scope_id and s.origin='pod_goal' and s.amendment->>'version'='r12.pod-research-goal.3')
 then return false;end if;
 perform private.r04_keys(v->'result',array['verdict','failureSubjectHash','routeProofHash','diagnosticHash']);
 state:=private.r12_pod_counted_receipt_status(f.request_id,f.receipt_expires_at);
 return coalesce(state->>'status'='verified' and v->'result'->>'routeProofHash'=state->>'proofHash',false)
 and exists(select 1 from private.r05_settlements z where z.request_id=f.request_id
 and z.actual_microunits=(f.subject->>'actualMicrounits')::bigint and z.provider_request_id=f.subject->>'providerRequestId')
 and not exists(select 1 from private.r05_settlements z where z.request_id=f.request_id
 and (z.provider_request_id is distinct from f.subject->>'providerRequestId'
 or (z.actual_microunits is not null and z.actual_microunits<>(f.subject->>'actualMicrounits')::bigint)));
end $$;
do $patch$ declare d text;needle text;begin
 d:=pg_get_functiondef('private.r12_discovery_response_guard()'::regprocedure);
 needle:=$old$ if p.content->>'format'='r07.1' then return new;end if;$old$;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'r12_counted_failure_response_patch_drift';end if;
 d:=replace(d,needle,$new$ if exists(select 1 from private.r12_pod_failed_effects where attempt_id=a.id) then
 if private.r12_pod_failed_response_valid(a,p,new.content) is distinct from true then raise exception 'r12_pod_failed_response_unverified';end if;
 return new;end if;
 if p.content->>'format'='r07.1' then return new;end if;$new$);execute d;
end $patch$;

-- New operations enter after exactly the same shared R12 authority gates.
do $patch$ declare d text;needle text;begin
 d:=pg_get_functiondef('private.r12_discovery_server_before_funding_proof(uuid,uuid,text,jsonb,text)'::regprocedure);
 needle:=$old$ if p_operation='send' then$old$;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'r12_counted_failure_server_patch_drift';end if;
 d:=replace(d,needle,$new$ if p_operation in ('failure_stage','failure_claim','failure_record') then
 v:=private.r12_pod_failed_effect_server(a,p,w,r,p_operation,p_payload);perform private.r12_discovery_key(key_hash);return v;end if;
 if p_operation='stage' and exists(select 1 from private.r12_pod_failed_effects where request_id=r.id) then raise exception 'r12_pod_failed_output_cannot_be_candidate';end if;
 if p_operation='send' then$new$);
 needle:=$old$p_operation in ('inputs','load','stage','claim','record','observe','diagnose')$old$;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'r12_counted_failure_receipt_authority_patch_drift';end if;
 d:=replace(d,needle,$new$p_operation in ('inputs','load','stage','claim','record','observe','diagnose','failure_stage','failure_claim','failure_record')$new$);execute d;
 d:=pg_get_functiondef('public.r12_discovery_server(uuid,uuid,text,jsonb,text)'::regprocedure);
 needle:=$old$ return result;$old$;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'r12_counted_failure_load_patch_drift';end if;
 d:=replace(d,needle,$new$ if p_operation='load' then
 result:=result||jsonb_build_object('failedEffect',(select private.r12_pod_failed_effect_projection(f) from private.r12_pod_failed_effects f where f.attempt_id=p_attempt_id));end if;
 return result;$new$);execute d;
end $patch$;

alter table private.r12_pod_pass_closures drop constraint r12_pod_pass_closures_outcome_check;
alter table private.r12_pod_pass_closures add constraint r12_pod_pass_closures_outcome_check check(outcome in ('HYPOTHESIS_TO_TEST','INSUFFICIENT_EVIDENCE','FAILED_OUTPUT'));
alter table private.r12_pod_pass_closures alter column review_attempt_id drop not null;
alter table private.r12_pod_pass_closures alter column review_hash drop not null;
alter table private.r12_pod_pass_closures add column failed_attempt_id uuid unique references private.r07_attempts(id);
alter table private.r12_pod_pass_closures add column failure_subject_hash text;
alter table private.r12_pod_pass_closures add constraint r12_pod_pass_closure_subject_shape check(
 (outcome='FAILED_OUTPUT' and review_attempt_id is null and review_hash is null and failed_attempt_id is not null
 and failure_subject_hash is not null and failure_subject_hash ~ '^[a-f0-9]{64}$')
 or (outcome in ('HYPOTHESIS_TO_TEST','INSUFFICIENT_EVIDENCE') and review_attempt_id is not null and review_hash is not null
 and failed_attempt_id is null and failure_subject_hash is null));
create function private.r12_pod_close_failed_pass(s private.r12_discovery_scopes,p private.r07_plans,d private.r12_pod_passes) returns jsonb
language plpgsql set search_path='' as $$
declare a private.r07_attempts;r private.r07_responses;f private.r12_pod_failed_effects;paid bigint;failed_position integer;dep private.r07_attempts;accepted jsonb;begin
 if s.amendment->>'version' is distinct from 'r12.pod-research-goal.3' then return null;end if;
 select failed.* into a from private.r12_pod_pass_calls call join private.r07_attempts failed on failed.id=call.attempt_id
 where call.scope_id=s.id and call.ordinal=d.ordinal and failed.status='failed' and failed.adaptive_action_hash=d.content_hash;
 if a.id is null then return null;end if;
 select * into r from private.r07_responses where attempt_id=a.id;
 select * into f from private.r12_pod_failed_effects where attempt_id=a.id;
 failed_position:=array_position(array['plan','search1','select1','strategy','review'],a.step_key);
 if failed_position is null or (select count(*) from private.r12_pod_pass_calls call where call.scope_id=s.id and call.ordinal=d.ordinal)<>failed_position
 or exists(select 1 from private.r12_pod_pass_calls call join private.r07_attempts attempt on attempt.id=call.attempt_id
 left join private.r07_responses result on result.attempt_id=attempt.id where call.scope_id=s.id and call.ordinal=d.ordinal
 and (array_position(array['plan','search1','select1','strategy','review'],call.phase)>failed_position
 or call.phase<>attempt.step_key or (call.attempt_id<>a.id and (attempt.status<>'completed' or result.content->>'outcome' is distinct from 'accepted'))))
 then raise exception 'r12_pod_failed_pass_prefix_required';end if;
 if (select count(*) from private.r12_pod_pass_calls call join private.r07_attempts attempt on attempt.id=call.attempt_id
 where call.scope_id=s.id and call.ordinal=d.ordinal and attempt.status='failed')<>1
 or private.r12_pod_failed_response_valid(a,p,r.content) is distinct from true
 or exists(select 1 from private.r07_attempts pending where pending.plan_id=p.id and pending.adaptive_action_ordinal=d.ordinal
 and (pending.adaptive_action_hash is distinct from d.content_hash or pending.status not in ('completed','failed')))
 or exists(select 1 from private.r12_pod_pass_calls call join private.r07_attempts attempt on attempt.id=call.attempt_id
 where call.scope_id=s.id and call.ordinal=d.ordinal and (attempt.status not in ('completed','failed')
 or not exists(select 1 from private.r05_settlements z where z.request_id=call.request_id and z.actual_microunits is not null and z.provider_request_id is not null)))
 then raise exception 'r12_pod_failed_pass_unsettled';end if;
 -- Reconstruct every accepted prefix through its original provenance guard.
 -- An older null-cost observation is allowed only for this same generation;
 -- contradictory known costs or served identities cannot be averaged away.
 paid:=(f.subject->>'actualMicrounits')::bigint;
 for dep in select attempt.* from private.r12_pod_pass_calls call join private.r07_attempts attempt on attempt.id=call.attempt_id
 where call.scope_id=s.id and call.ordinal=d.ordinal and call.attempt_id<>a.id loop
 accepted:=private.r12_pod_completed_dependency(dep,p);
 if accepted->'candidate'->'reportedMicrousd' is null or accepted->'candidate'->'reportedMicrousd'='null'::jsonb
 or exists(select 1 from private.r05_settlements z join private.r12_pod_pass_calls call on call.request_id=z.request_id
 where call.attempt_id=dep.id and (z.provider_request_id is distinct from accepted->'candidate'->>'providerRequestId'
 or (z.actual_microunits is not null and z.actual_microunits<>(accepted->'candidate'->>'reportedMicrousd')::bigint)))
 then raise exception 'r12_pod_failed_pass_conflicting_charge';end if;
 paid:=paid+(accepted->'candidate'->>'reportedMicrousd')::bigint;
 end loop;
 -- No accepted candidate or success response is minted for the failed phase.
 insert into private.r12_pod_pass_closures(scope_id,ordinal,action_hash,outcome,committed_microunits,created_at,failed_attempt_id,failure_subject_hash)
 values(s.id,d.ordinal,d.content_hash,'FAILED_OUTPUT',paid,clock_timestamp(),a.id,f.subject_hash);
 return jsonb_build_object('closed',true,'outcome','FAILED_OUTPUT','committedMicrounits',paid::text,'reviewAccepted',false,'failureSubjectHash',f.subject_hash);
end $$;
do $patch$ declare d text;needle text;begin
 d:=pg_get_functiondef('public.r12_pod_pass_server(uuid,uuid,text,jsonb,text)'::regprocedure);
 needle:=$old$ if (select count(*) from private.r12_pod_pass_calls call join private.r07_attempts a on a.id=call.attempt_id$old$;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'r12_counted_failure_completion_patch_drift';end if;
 d:=replace(d,needle,$new$ body:=private.r12_pod_close_failed_pass(s,p,d);if body is not null then return body;end if;
 if (select count(*) from private.r12_pod_pass_calls call join private.r07_attempts a on a.id=call.attempt_id$new$);execute d;
end $patch$;

-- Failed history carries accepted query/candidate identities where available;
-- it explicitly contains no accepted independent review or rewritten output.
alter function private.r12_pod_pass_history(private.r07_plans,integer) rename to r12_pod_pass_history_before_counted_failure;
create function private.r12_pod_pass_history(p private.r07_plans,pass integer) returns jsonb
language plpgsql stable set search_path='' as $$
declare s private.r12_discovery_scopes;closed private.r12_pod_pass_closures;f private.r12_pod_failed_effects;
 recovery private.r12_pod_recoveries;queries jsonb;hypotheses jsonb;hashes jsonb;review jsonb;begin
 select * into s from private.r12_discovery_scopes where id=(p.content->>'discoveryScopeId')::uuid;
 if s.amendment->>'version' is distinct from 'r12.pod-research-goal.3' then return private.r12_pod_pass_history_before_counted_failure(p,pass);end if;
 select * into recovery from private.r12_pod_recoveries where scope_id=s.id;
 if recovery.setup_id is not null and pass=(recovery.proof->>'usedPasses')::integer then return recovery.history;end if;
 if pass=0 then return null;end if;
 select * into closed from private.r12_pod_pass_closures where scope_id=s.id and ordinal=pass-1;
 if closed.scope_id is null or closed.outcome not in ('FAILED_OUTPUT','INSUFFICIENT_EVIDENCE') then raise exception 'r12_pod_refinement_predecessor_required';end if;
 select coalesce(jsonb_agg(jsonb_build_object('pass',call.ordinal,'query',c.candidate->'output'->>'query','sourceDomains',c.candidate->'output'->'sourceDomains') order by call.ordinal),'[]'::jsonb) into queries
 from private.r12_pod_pass_calls call join private.r12_discovery_candidates c on c.request_id=call.request_id
 join private.r07_attempts a on a.id=call.attempt_id and a.status='completed' join private.r07_responses r on r.attempt_id=a.id and r.content->>'outcome'='accepted'
 where call.scope_id in(s.id,(recovery.proof->>'predecessorScopeId')::uuid) and call.ordinal<pass and call.phase='plan';
 select coalesce(jsonb_agg(jsonb_build_object('productType',v->>'productType','niche',v->>'niche','audience',v->>'audience')),'[]'::jsonb) into hypotheses
 from private.r12_pod_pass_calls call join private.r12_discovery_candidates c on c.request_id=call.request_id
 join private.r07_attempts a on a.id=call.attempt_id and a.status='completed' join private.r07_responses r on r.attempt_id=a.id and r.content->>'outcome'='accepted',
 lateral jsonb_array_elements(c.candidate->'output'->'candidates')v where call.scope_id=s.id and call.ordinal=closed.ordinal and call.phase='strategy';
 if jsonb_array_length(queries)>pass then raise exception 'r12_pod_refinement_history_incomplete';end if;
 if closed.outcome='FAILED_OUTPUT' then
 select * into f from private.r12_pod_failed_effects where attempt_id=closed.failed_attempt_id and scope_id=s.id and subject_hash=closed.failure_subject_hash;
 if f.request_id is null then raise exception 'r12_pod_failed_history_required';end if;
 select coalesce(jsonb_agg(jsonb_build_object('phase',call.phase,'responseHash',r.content_hash) order by array_position(array['plan','search1','select1','strategy','review'],call.phase)),'[]'::jsonb) into hashes
 from private.r12_pod_pass_calls call join private.r07_attempts a on a.id=call.attempt_id and a.status='completed'
 join private.r07_responses r on r.attempt_id=a.id and r.content->>'outcome'='accepted' where call.scope_id=s.id and call.ordinal=closed.ordinal;
 return jsonb_build_object('version','r12.pod-failed-pass-history.3','kind','failed_pass_context','previousPass',closed.ordinal,
 'reviewAccepted',false,'failureSubjectHash',f.subject_hash,'failureDiagnosticHash',f.subject->>'diagnosticHash',
 'failureKind',f.subject->>'failureKind','failedPhase',f.subject->>'phase','priorQueries',queries,'priorCandidates',hypotheses,'acceptedOutputHashes',hashes);
 end if;
 select c.candidate->'output' into review from private.r12_pod_pass_calls call join private.r12_discovery_candidates c on c.request_id=call.request_id
 join private.r07_responses r on r.attempt_id=call.attempt_id and r.content_hash=closed.review_hash and r.content->>'outcome'='accepted'
 where call.scope_id=s.id and call.ordinal=closed.ordinal and call.phase='review' and call.attempt_id=closed.review_attempt_id;
 if review is null then raise exception 'r12_pod_refinement_history_incomplete';end if;
 return jsonb_build_object('version','r12.pod-refinement-history.2','previousPass',closed.ordinal,'previousReviewHash',closed.review_hash,
 'reviewEvidenceNamespace','pass-'||closed.ordinal,'priorQueries',queries,'review',review,'priorCandidates',hypotheses);
end $$;

-- Safe normal-return lease handoff. The existing controller validates its
-- scoped keys first and holds the Business/head locks. No persistent token is
-- issued: a next invocation must claim using its own fresh random token.
do $patch$ declare d text;needle text;begin
 d:=pg_get_functiondef('public.r07_controller(uuid,uuid,text,jsonb,uuid,text,text,bigint,text)'::regprocedure);
 needle:=$old$ elsif p_operation='plan' then$old$;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'r12_counted_failure_lease_patch_drift';end if;
 d:=replace(d,needle,$new$ elsif p_operation='release_lease' then
 perform private.r04_keys(clean,array['planId','planHash']);
 if p.id is null or clean->>'planId' is distinct from p.id::text or clean->>'planHash' is distinct from p.content_hash
 or not exists(select 1 from private.r12_discovery_scopes scope where scope.id=(p.content->>'discoveryScopeId')::uuid
 and scope.origin='pod_goal' and scope.amendment->>'version'='r12.pod-research-goal.3')
 then raise exception 'r12_pod_lease_plan_required';end if;
 if h.plan_id is distinct from p.id or h.lease_epoch is distinct from p_epoch or h.lease_hash is distinct from lease
 or h.lease_expires_at is null or h.lease_expires_at<=clock_timestamp() or lease is null then raise exception 'r07_stale_controller';end if;
 if exists(select 1 from private.r07_attempts pending join private.r07_bindings release_binding on release_binding.attempt_id=pending.id
 join private.r07_markers marker on marker.attempt_id=pending.id where pending.plan_id=p.id and pending.status='dispatched'
 and not exists(select 1 from private.r12_discovery_transport_claims claim where claim.request_id=release_binding.request_id))
 then raise exception 'r12_pod_unclaimed_dispatch_lease';end if;
 update private.r07_heads set lease_hash=null,lease_expires_at=null,lease_epoch=lease_epoch+1 where goal_id=p_goal_id;
 result:=jsonb_build_object('released',true,'planId',p.id,'shouldDispatch',false);
 elsif p_operation='plan' then$new$);execute d;
end $patch$;

-- A competing *unmarked* reservation is a transient hold only while its
-- exact current R07 plan is still permitted. This is classification, not a
-- release or a discount to the actual admission inequality below.
create function private.r12_pod_transient_reservations(b uuid,policy uuid default null) returns bigint
language sql volatile set search_path='' as $$
 select coalesce(sum(e.held),0)::bigint from private.r05_exposure(b)e
 join private.r05_requests r on r.business_id=b and r.source_key=e.source_key and r.policy_id=e.policy_id and r.currency=e.currency
 join private.r05_reservations reservation on reservation.request_id=r.id and reservation.business_id=b
 join private.r07_bindings binding on binding.request_id=r.id and binding.business_id=b
 join private.r07_attempts attempt on attempt.id=binding.attempt_id and attempt.id=r.workflow_run_id and attempt.business_id=b
 join private.r07_plans plan on plan.id=attempt.plan_id and plan.business_id=b and plan.goal_id=attempt.goal_id and plan.policy_id=r.policy_id
 join private.r07_heads head on head.business_id=b and head.goal_id=attempt.goal_id and head.plan_id=plan.id
 where e.currency='USD' and (policy is null or r.policy_id=policy) and e.unknown=false and e.held=r.liability_microunits
 and r.payload->'accounting'->>'kind'='r05' and r.idempotency_key='r07:'||attempt.id::text
 and attempt.status in ('scheduled','reserved') and head.state in ('ready','running','waiting')
 and not exists(select 1 from private.r05_markers where request_id=r.id)
 and not exists(select 1 from private.r07_markers where attempt_id=attempt.id)
 and not exists(select 1 from private.r05_releases where request_id=r.id)
 and not exists(select 1 from private.r05_settlements where request_id=r.id)
 and private.r07_gate(plan) is null
$$;
revoke all on function private.r12_pod_transient_reservations(uuid,uuid) from public,anon,authenticated,service_role;
do $patch$ declare d text;needle text;begin
 d:=pg_get_functiondef('public.r12_pod_pass_server(uuid,uuid,text,jsonb,text)'::regprocedure);
 needle:=$old$then update private.r07_heads set state='completed',reason='remaining_budget_below_quoted_pass'$old$;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'r12_pod_contention_patch_drift';end if;
 d:=replace(d,needle,$new$then
 -- Preserve the complete exposure + outstanding hold inequality and unknown
 -- cost gate above. Only classify its failure; every retry repeats that gate.
 if s.amendment->>'version'='r12.pod-research-goal.3'
 and paid-private.r12_pod_transient_reservations(p_business_id,p.policy_id)+ceiling<=(s.amendment->>'maximumMicrousd')::bigint
 and total-private.r12_pod_transient_reservations(p_business_id)+ceiling<=(finance->>'maximumMicrounits')::bigint then
 return jsonb_build_object('admitted',false,'waiting',true,'reason','pass_funding_contention',
 'wakeAt',least(clock_timestamp()+interval '30 seconds',(s.amendment->>'expiresAt')::timestamptz));end if;
 update private.r07_heads set state='completed',reason='remaining_budget_below_quoted_pass'$new$);execute d;
end $patch$;

-- Small saved-state projection for the owning UI, after its existing owner
-- authorization. This describes persisted work, never claims worker liveness.
create function private.r12_pod_counted_runtime_projection(scope uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare d private.r12_pod_passes;c private.r12_pod_pass_closures;f private.r12_pod_failed_effects;begin
 select * into d from private.r12_pod_passes where scope_id=scope order by ordinal desc limit 1;
 select * into c from private.r12_pod_pass_closures where scope_id=scope order by ordinal desc limit 1;
 select failed.* into f from private.r12_pod_failed_effects failed join private.r12_pod_pass_calls call on call.request_id=failed.request_id
 where failed.scope_id=scope and call.ordinal=d.ordinal;
 return jsonb_build_object('latestPassOrdinal',d.ordinal,'currentPassOpen',d.scope_id is not null and not exists(
 select 1 from private.r12_pod_pass_closures closed where closed.scope_id=scope and closed.ordinal=d.ordinal),
 'latestClosureOutcome',c.outcome,'failedEffectReceiptStatus',case when f.request_id is null then null else private.r12_pod_counted_receipt_status(f.request_id,f.receipt_expires_at)->>'status' end);
end $$;
do $patch$ declare d text;needle text;begin
 d:=pg_get_functiondef('public.r12_discovery_owner_read(uuid,uuid,boolean)'::regprocedure);needle:=$old$ return result;$old$;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'r12_counted_failure_owner_projection_patch_drift';end if;
 d:=replace(d,needle,$new$ if exists(select 1 from private.r12_discovery_scopes s where s.id=p_scope_id and s.business_id=p_business_id
 and s.origin='pod_goal' and s.amendment->>'version'='r12.pod-research-goal.3') then
 result:=result||jsonb_build_object('podRuntime',private.r12_pod_counted_runtime_projection(p_scope_id));end if;
 return result;$new$);execute d;
end $patch$;
revoke all on function private.r12_pod_counted_runtime_projection(uuid) from public,anon,authenticated,service_role;

revoke all on function private.r12_pod_receipt_subject_guard(),private.r12_pod_counted_receipt_status(uuid,timestamptz),
 private.r12_discovery_receipt_status_before_counted_failure(private.r12_discovery_candidates),
 private.r12_discovery_receipt_status(private.r12_discovery_candidates),
 private.r12_pod_failed_effect_projection(private.r12_pod_failed_effects),private.r12_pod_failed_proof_validate(private.r12_pod_failed_effects,jsonb),
 private.r12_pod_failed_effect_server(private.r07_attempts,private.r07_plans,private.r12_discovery_wires,private.r05_requests,text,jsonb),
 private.r12_pod_failed_response_valid(private.r07_attempts,private.r07_plans,jsonb),
 private.r12_pod_close_failed_pass(private.r12_discovery_scopes,private.r07_plans,private.r12_pod_passes),
 private.r12_pod_pass_history_before_counted_failure(private.r07_plans,integer),private.r12_pod_pass_history(private.r07_plans,integer)
 from public,anon,authenticated,service_role;
commit;
