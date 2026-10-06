-- R12 review response observations are unqualified private history only.
-- No authority/key/adapter/operation enrollment; no dispatch, funding, receipt
-- claim or accepted artifact is created by this migration.
-- The existing candidate table requires a qualified response shape, and receipt
-- checks reference it. Putting malformed/schema-failed output there would
-- weaken candidate admission and receipt eligibility; keep it separate.
-- Same owner-controlled history retention as r12_discovery_candidates: no public
-- table access, no delete cascade/TTL, and the existing immutable history guard.
begin;
create table private.r12_discovery_response_observations(
 request_id uuid not null references private.r12_discovery_wires(request_id),
 kind text not null check(kind in ('received','rejected')),
 payload jsonb not null,payload_hash text not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(request_id,kind),
 check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=131072
   and payload_hash=private.stage14_hash(payload))
);
alter table private.r12_discovery_response_observations enable row level security;
revoke all on private.r12_discovery_response_observations from public,anon,authenticated,service_role;
create trigger r12_discovery_history_guard before insert or update or delete
 on private.r12_discovery_response_observations for each row execute function private.r12_discovery_history_guard();

-- CREATE OR REPLACE retains both existing public RPC ACLs. Existing operations
-- below are copied unchanged from 20261006081027; only the observation branch
-- and safe owner fields are added.
CREATE OR REPLACE FUNCTION public.r12_discovery_server(p_business_id uuid, p_attempt_id uuid, p_operation text, p_payload jsonb, p_server_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare key_hash text;a private.r07_attempts;p private.r07_plans;s private.r12_discovery_scopes;r private.r05_requests;rb private.r07_bindings;w private.r12_discovery_wires;c private.r12_discovery_candidates;q private.r12_discovery_receipt_checks;o private.r12_discovery_receipt_observations;
 response_observation private.r12_discovery_response_observations;received private.r12_discovery_response_observations;
 response_kind text;response_hash text;response_stamp text;schema_paths text[];issue jsonb;
 v jsonb;state jsonb;mark timestamptz;expiry timestamptz;retry_at timestamptz;code text;http integer;terminal boolean;max_bytes integer;models jsonb;begin
 if p_server_key is null or length(p_server_key) not between 32 and 200 then raise exception 'r12_controller_authority_required' using errcode='42501';end if;
 perform 1 from public.businesses where id=p_business_id for update;if not found then raise exception 'r12_business_unavailable';end if;
 key_hash:=encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex');perform private.r12_discovery_key(key_hash);
 select * into a from private.r07_attempts where id=p_attempt_id and business_id=p_business_id;select * into p from private.r07_plans where id=a.plan_id and business_id=p_business_id;
 if a.id is null or not coalesce(p.content->>'format' in ('r12.discovery.1','r12.discovery-review.1'),false) or not exists(select 1 from public.businesses where id=p_business_id and owner_user_id=p.owner_id) then raise exception 'r12_attempt_scope_required';end if;
 if not exists(select 1 from private.r12_discovery_authorities scoped_auth where scoped_auth.business_id=p_business_id and scoped_auth.goal_id=p.goal_id and scoped_auth.plan=p.content and scoped_auth.controller_key_hash=key_hash and scoped_auth.receipt_until>clock_timestamp() and private.r12_authority_owner_current(scoped_auth)) then raise exception 'r12_exact_scoped_controller_authority_required';end if;
 if p_operation='inputs' then
 perform private.r04_keys(p_payload,array[]::text[]);v:=private.r12_discovery_phase_inputs(a,p);perform private.r12_discovery_key(key_hash);return v;end if;
 select * into rb from private.r07_bindings where attempt_id=a.id and business_id=p_business_id;select * into r from private.r05_requests where id=rb.request_id and business_id=p_business_id;
 if r.id is null then raise exception 'r12_reservation_required';end if;
 select * into w from private.r12_discovery_wires where request_id=r.id;
 if w.request_id is not null and w.producer_key_hash<>key_hash then raise exception 'r12_producer_key_changed';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>131072 then raise exception 'r12_payload_invalid';end if;
 if p_operation='bind' then
 perform private.r04_keys(p_payload,array['binding','bindingHash']);v:=p_payload->'binding';
 if p_payload->>'bindingHash' is distinct from private.stage14_hash(v) then raise exception 'r12_wire_hash_mismatch';end if;
 if w.request_id is not null then
 if w.binding is distinct from v or w.binding_hash is distinct from p_payload->>'bindingHash' then raise exception 'r12_wire_conflict';end if;return jsonb_build_object('bound',true,'bindingHash',w.binding_hash,'replayed',true);end if;
 if a.status<>'reserved' or exists(select 1 from private.r05_markers where request_id=r.id) then raise exception 'r12_unsent_reservation_required';end if;
 s:=private.r12_discovery_scope_current(p);if private.r07_gate(p,(select value from jsonb_array_elements(p.content->'steps') x where x->>'key'=a.step_key)) is not null then raise exception 'r12_current_gate_required';end if;
 perform private.r12_discovery_wire_validate(r,a,p,s,v);
 insert into private.r12_discovery_wires(request_id,business_id,attempt_id,scope_id,binding,binding_hash,producer_key_hash) values(r.id,p_business_id,a.id,s.id,v,p_payload->>'bindingHash',key_hash);
 return jsonb_build_object('bound',true,'bindingHash',p_payload->>'bindingHash','replayed',false);
 end if;
 if w.request_id is null then
 if p_operation='load' then perform private.r04_keys(p_payload,array[]::text[]);return jsonb_build_object('binding',null,'candidate',null,'receipt',null,'proof',null,'diagnostic',null,'observationSaved',false);end if;
 raise exception 'r12_wire_binding_required';end if;
 if p_operation='send' then
 perform private.r04_keys(p_payload,array['wireHash']);
 if p_payload->>'wireHash' is distinct from rb.wire_hash or not exists(select 1 from private.r05_markers where request_id=r.id) or not exists(select 1 from private.r07_markers where attempt_id=a.id) then raise exception 'r12_marked_wire_required';end if;
 if exists(select 1 from private.r12_discovery_transport_claims where request_id=r.id) then return jsonb_build_object('shouldDispatch',false,'reason','already_claimed');end if;
 if a.status<>'dispatched' or not exists(select 1 from private.r07_heads head join private.r07_markers marker on marker.attempt_id=a.id and marker.lease_epoch=head.lease_epoch where head.goal_id=a.goal_id and head.plan_id=p.id and head.lease_expires_at>clock_timestamp()) then raise exception 'r12_original_dispatch_lease_required';end if;
 s:=private.r12_discovery_scope_current(p);if private.r07_gate(p,(select value from jsonb_array_elements(p.content->'steps') x where x->>'key'=a.step_key)) is not null then raise exception 'r12_current_gate_required';end if;
 perform private.r12_discovery_wire_validate(r,a,p,s,w.binding);
 if private.r05_admissible(r) is not null then raise exception 'r12_current_financial_gate_required';end if;
 -- Recheck after operation/pack/registry lock waits before returning one-shot permission.
 s:=private.r12_discovery_scope_current(p);
 if private.r07_gate(p,(select value from jsonb_array_elements(p.content->'steps') x where x->>'key'=a.step_key)) is not null then raise exception 'r12_current_gate_required';end if;
 perform private.r12_discovery_wire_validate(r,a,p,s,w.binding);
 perform private.r12_discovery_key(key_hash);
 insert into private.r12_discovery_transport_claims(request_id) values(r.id);
 perform private.r12_discovery_key(key_hash);return jsonb_build_object('shouldDispatch',true,'reason','claimed_once');
 end if;
 if p_operation in ('observe','diagnose') then
 -- Both operations remain behind the existing key, owner-current authority,
 -- Business, Goal, exact plan, request and producer-key checks above.
 if p_operation='observe' then
 perform private.r04_keys(p_payload,array['observation','observationHash']);
 v:=p_payload->'observation';response_kind:='received';response_hash:=p_payload->>'observationHash';
 perform private.r04_keys(v,array['scopeId','attemptId','requestId','version','receivedAt','providerRequestId','providerModelId','finishReason','nativeFinishReason','contentState','content','contentBytes','contentHash']);
 else
 perform private.r04_keys(p_payload,array['diagnostic','diagnosticHash']);
 v:=p_payload->'diagnostic';response_kind:='rejected';response_hash:=p_payload->>'diagnosticHash';
 perform private.r04_keys(v,array['scopeId','attemptId','requestId','version','recordedAt','code','httpStatus','observationSaved','issues']);
 end if;
 select created_at into mark from private.r05_markers where request_id=r.id and business_id=p_business_id;
 if a.step_key is distinct from 'review' or w.business_id is distinct from p_business_id
 or w.attempt_id is distinct from a.id or a.goal_id is distinct from p.goal_id
 or w.scope_id::text is distinct from p.content->>'discoveryScopeId'
 or r.workflow_run_id is distinct from a.id or r.policy_id is distinct from p.policy_id
 or r.payload->>'operationKey' is distinct from 'research.r12.'||w.scope_id::text||'.review'
 or w.binding_hash is distinct from private.stage14_hash(w.binding)
 or w.binding->>'scopeId' is distinct from w.scope_id::text or w.binding->>'scopeHash' is distinct from p.content->>'discoveryScopeHash'
 or w.binding->>'attemptId' is distinct from a.id::text or w.binding->>'requestId' is distinct from r.id::text
 or w.binding->>'phase' is distinct from 'review' or w.binding->>'requestHash' is distinct from r.payload->>'requestHash'
 or v->>'scopeId' is distinct from w.scope_id::text or v->>'attemptId' is distinct from a.id::text
 or v->>'requestId' is distinct from r.id::text or response_hash is distinct from private.stage14_hash(v)
 then raise exception 'r12_review_response_identity_invalid';end if;
 if mark is null or not exists(select 1 from private.r12_discovery_transport_claims where request_id=r.id)
 or not exists(select 1 from private.r07_markers where attempt_id=a.id and business_id=p_business_id)
 then raise exception 'r12_dispatch_required';end if;
 expiry:=least((p.content->>'expiresAt')::timestamptz+interval '30 minutes',mark+interval '60 minutes',
 (select receipt_until from private.r12_discovery_authorities where scope_id=w.scope_id and plan=p.content and controller_key_hash=key_hash));
 response_stamp:=v->>(case when response_kind='received' then 'receivedAt' else 'recordedAt' end);
 if not isfinite(expiry) or clock_timestamp()>=expiry
 or jsonb_typeof(v->(case when response_kind='received' then 'receivedAt' else 'recordedAt' end)) is distinct from 'string'
 or length(response_stamp)>40 or response_stamp !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
 or not isfinite(response_stamp::timestamptz) or response_stamp::timestamptz<mark
 or response_stamp::timestamptz>=expiry or response_stamp::timestamptz>clock_timestamp()+interval '5 minutes'
 then raise exception 'r12_review_response_time_invalid';end if;
 select * into received from private.r12_discovery_response_observations where request_id=r.id and kind='received';
 select * into response_observation from private.r12_discovery_response_observations where request_id=r.id and kind=response_kind;
 if response_observation.request_id is not null then
 if response_observation.payload is distinct from v or response_observation.payload_hash is distinct from response_hash
 then raise exception 'r12_review_response_conflict';end if;
 return jsonb_build_object('saved',true,'kind',response_kind,'replayed',true);
 end if;
 if response_kind='received' then
 if v->>'version' is distinct from 'r12.review-observation.1'
 or not coalesce(v->>'contentState' in ('complete','oversized','redacted','missing','unsupported'),false)
 or jsonb_typeof(v->'contentBytes') is distinct from 'number' or v->>'contentBytes' !~ '^(0|[1-9][0-9]{0,15})$'
 or (v->>'contentBytes')::numeric>9007199254740991
 or (v->'providerRequestId'<>'null'::jsonb and (jsonb_typeof(v->'providerRequestId') is distinct from 'string' or v->>'providerRequestId' !~ '^gen-[A-Za-z0-9_-]+$' or length(v->>'providerRequestId')>300))
 or (v->'providerModelId'<>'null'::jsonb and (jsonb_typeof(v->'providerModelId') is distinct from 'string' or v->>'providerModelId' !~ '^[A-Za-z0-9][A-Za-z0-9_./:-]{0,159}$'))
 or (v->'finishReason'<>'null'::jsonb and (jsonb_typeof(v->'finishReason') is distinct from 'string' or v->>'finishReason' not in ('stop','length','content_filter','tool_calls','error')))
 or (v->'nativeFinishReason'<>'null'::jsonb and (jsonb_typeof(v->'nativeFinishReason') is distinct from 'string' or v->>'nativeFinishReason' !~ '^[a-z][a-z0-9_]{0,47}$'))
 then raise exception 'r12_review_observation_invalid';end if;
 if v->>'contentState'='complete' then
 if jsonb_typeof(v->'content') is distinct from 'string' or octet_length(convert_to(v->>'content','UTF8'))>16384
 or (v->>'contentBytes')::numeric is distinct from octet_length(convert_to(v->>'content','UTF8'))::numeric
 or v->>'contentHash' is distinct from encode(extensions.digest(convert_to(v->>'content','UTF8'),'sha256'),'hex')
 -- Screen decoded completion text, not JSON-escaped text. Mirrors the TS
 -- credential predicate; rejected raw text is never inserted or echoed.
 or v->>'content' ~* $credential$-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|\y(api[ _-]?key|access[ _-]?token|refresh[ _-]?token|client[ _-]?secret|password|passwd|secret[ _-]?key|secret|token|bearer)[[:space:]]*(:=|:|=|is[[:space:]]+|[[:space:]]+)[[:space:]]*[^[:space:]]+|\yauthorization[[:space:]]*:[[:space:]]*basic[[:space:]]+[^[:space:]]+|\y(sk_(live|test)_[A-Za-z0-9]{8,}|rk_live_[A-Za-z0-9]{8,}|sk-(proj-)?[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|ASIA[A-Z0-9]{16})\y|\yeyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\y|\y(postgres(ql)?|mysql|mongodb(\+srv)?)://[^[:space:]/@:]+:[^[:space:]/@]+@|\yhttps?://[^[:space:]/@:]+:[^[:space:]/@]+@$credential$
 then raise exception 'r12_review_observation_content_invalid';end if;
 elsif v->>'contentState' in ('oversized','redacted') then
 if v->'content' is distinct from 'null'::jsonb or jsonb_typeof(v->'contentHash') is distinct from 'string'
 or v->>'contentHash' !~ '^[a-f0-9]{64}$'
 or (v->>'contentState'='oversized' and (v->>'contentBytes')::numeric<=16384)
 or (v->>'contentState'='redacted' and (v->>'contentBytes')::numeric not between 1 and 16384)
 then raise exception 'r12_review_observation_content_invalid';end if;
 elsif v->'content' is distinct from 'null'::jsonb or v->'contentHash' is distinct from 'null'::jsonb
 or v->'contentBytes' is distinct from '0'::jsonb then raise exception 'r12_review_observation_content_invalid';end if;
 -- A rejected(false) record is immutable historical truth; a late observation
 -- may not turn its persisted observationSaved assertion into falsehood.
 if exists(select 1 from private.r12_discovery_response_observations where request_id=r.id and kind='rejected')
 then raise exception 'r12_review_response_already_rejected';end if;
 else
 if v->>'version' is distinct from 'r12.review-diagnostic.1'
 or not coalesce(v->>'code' in ('transport','provider_envelope','json_parse','response_identity','finish_reason','response_time','response_cost','response_schema','response_size','observation_storage','candidate_binding','candidate_storage','domain_validation'),false)
 or v->'observationSaved' is distinct from to_jsonb(received.request_id is not null)
 or (received.request_id is not null and response_stamp::timestamptz<(received.payload->>'receivedAt')::timestamptz)
 or (v->'httpStatus'<>'null'::jsonb and (jsonb_typeof(v->'httpStatus') is distinct from 'number' or v->>'httpStatus' !~ '^[1-5][0-9]{2}$'))
 or jsonb_typeof(v->'issues') is distinct from 'array' or jsonb_array_length(v->'issues')>12
 or (v->>'code'<>'response_schema' and v->'issues'<>'[]'::jsonb)
 then raise exception 'r12_review_diagnostic_invalid';end if;
 -- The saved request is already schema-hash-bound by wire admission. Only
 -- declared schema paths survive; model-chosen property names cannot enter UI.
 with recursive nodes(path,node) as (
 select '$'::text,((w.binding->>'requestJson')::jsonb)->'outputSchema'
 union all
 select child.path,child.node from nodes n cross join lateral (
 select n.path||'.'||x.key path,x.value node from jsonb_each(coalesce(n.node->'properties','{}'::jsonb)) x
 union all select n.path||'[]',n.node->'items' where n.node ? 'items'
 union all select n.path,x.value from jsonb_array_elements(coalesce(n.node->'anyOf','[]'::jsonb)) x
 ) child
 ) select array_agg(distinct path) into schema_paths from nodes;
 for issue in select value from jsonb_array_elements(v->'issues') loop
 perform private.r04_keys(issue,array['path','constraint','limit']);
 if jsonb_typeof(issue->'path') is distinct from 'string' or length(issue->>'path')>180
 or not coalesce(regexp_replace(issue->>'path','\[[0-9]+\]','[]','g')=any(schema_paths),false)
 or not coalesce(issue->>'constraint' in ('min_length','max_length','min_items','max_items','enum','const','unique_items','pattern','type','shape'),false)
 then raise exception 'r12_review_diagnostic_issue_invalid';end if;
 if issue->>'constraint' in ('min_length','max_length','min_items','max_items') then
 if jsonb_typeof(issue->'limit') is distinct from 'number' or issue->>'limit' !~ '^(0|[1-9][0-9]{0,6})$'
 or (issue->>'limit')::numeric>1000000 then raise exception 'r12_review_diagnostic_issue_invalid';end if;
 elsif issue->'limit' is distinct from 'null'::jsonb then raise exception 'r12_review_diagnostic_issue_invalid';end if;
 end loop;
 end if;
 perform private.r12_discovery_key(key_hash);
 insert into private.r12_discovery_response_observations(request_id,kind,payload,payload_hash)
 values(r.id,response_kind,v,response_hash);
 return jsonb_build_object('saved',true,'kind',response_kind,'replayed',false);
 end if;
 select * into c from private.r12_discovery_candidates where request_id=r.id;
 if p_operation='load' then
 perform private.r04_keys(p_payload,array[]::text[]);
 return jsonb_build_object('diagnostic',(select ro.payload from private.r12_discovery_response_observations ro where ro.request_id=r.id and ro.kind='rejected'),'observationSaved',exists(select 1 from private.r12_discovery_response_observations ro where ro.request_id=r.id and ro.kind='received'),'dispatchedAt',(select created_at from private.r05_markers where request_id=r.id),'binding',w.binding,'candidate',c.candidate,'receipt',case when c.request_id is null then null else private.r12_discovery_receipt_status(c) end,'proof',(select ro.proof from private.r12_discovery_receipt_checks rc join private.r12_discovery_receipt_observations ro on ro.check_id=rc.id where rc.request_id=c.request_id and ro.proof is not null));
 end if;
 if p_operation='stage' then
 perform private.r04_keys(p_payload,array['candidate','candidateHash']);v:=p_payload->'candidate';
 perform private.r04_keys(v,array['version','scopeId','attemptId','requestId','phase','requestHash','providerRequestId','providerModelId','receivedAt','reportedMicrousd','output']);
 select created_at into mark from private.r05_markers where request_id=r.id;
 if mark is null or not exists(select 1 from private.r12_discovery_transport_claims where request_id=r.id) or not exists(select 1 from private.r07_markers where attempt_id=a.id) then raise exception 'r12_dispatch_required';end if;
 expiry:=least((p.content->>'expiresAt')::timestamptz+interval '30 minutes',mark+interval '60 minutes');
 models:=case when a.step_key='review' then '["anthropic/claude-haiku-4.5","anthropic/claude-4.5-haiku-20251001"]'::jsonb else '["openai/gpt-5.6-luna","openai/gpt-5.6-luna-20260709"]'::jsonb end;
 max_bytes:=case when a.step_key='strategy' then 73728 when a.step_key='search1' then 28672 else 20480 end;
 if v->>'version' is distinct from 'r12.discovery-response.1' or v->>'scopeId' is distinct from w.scope_id::text or v->>'attemptId' is distinct from a.id::text or v->>'requestId' is distinct from r.id::text or v->>'phase' is distinct from a.step_key or v->>'requestHash' is distinct from r.payload->>'requestHash' or p_payload->>'candidateHash' is distinct from private.stage14_hash(v) or octet_length(v::text)>max_bytes or jsonb_typeof(v->'output') is distinct from 'object' or not coalesce(models ? (v->>'providerModelId'),false) or (not coalesce(v->>'providerRequestId' ~ '^gen-[A-Za-z0-9_-]+$',false) or length(v->>'providerRequestId')>300) or jsonb_typeof(v->'receivedAt') is distinct from 'string' or not isfinite((v->>'receivedAt')::timestamptz) or (v->>'receivedAt')::timestamptz<mark or (v->>'receivedAt')::timestamptz>=expiry or (v->>'receivedAt')::timestamptz>clock_timestamp()+interval '5 minutes' then raise exception 'r12_candidate_invalid';end if;
 if v->'reportedMicrousd' is distinct from 'null'::jsonb and (jsonb_typeof(v->'reportedMicrousd') is distinct from 'number' or v->>'reportedMicrousd' !~ '^(0|[1-9][0-9]{0,6})$' or (v->>'reportedMicrousd')::bigint>r.liability_microunits) then raise exception 'r12_candidate_cost_invalid';end if;
 if c.request_id is not null then
 if c.candidate is distinct from v or c.candidate_hash is distinct from p_payload->>'candidateHash' then raise exception 'r12_candidate_conflict';end if;return private.r12_discovery_receipt_status(c)||jsonb_build_object('staged',true,'replayed',true);end if;
 if clock_timestamp()>=expiry then raise exception 'r12_receipt_expired';end if;
 insert into private.r12_discovery_candidates(request_id,candidate,candidate_hash,receipt_expires_at) values(r.id,v,p_payload->>'candidateHash',expiry) returning * into c;
 return private.r12_discovery_receipt_status(c)||jsonb_build_object('staged',true,'replayed',false);
 end if;
 if c.request_id is null or p_payload->>'candidateHash' is distinct from c.candidate_hash then raise exception 'r12_candidate_required';end if;
 state:=private.r12_discovery_receipt_status(c);
 if p_operation='claim' then
 perform private.r04_keys(p_payload,array['candidateHash']);
 if state->>'status' in ('verified','terminal','exhausted','expired','stopped') then return state||jsonb_build_object('claimed',false,'claimId',null,'reason',state->>'status');end if;
 if state->>'nextCheckAt' is not null and clock_timestamp()<(state->>'nextCheckAt')::timestamptz then return state||jsonb_build_object('claimed',false,'claimId',null,'reason','cooldown');end if;
 insert into private.r12_discovery_receipt_checks(request_id,attempt) values(r.id,(state->>'attempts')::integer+1) returning * into q;
 perform private.r12_discovery_key(key_hash);return private.r12_discovery_receipt_status(c)||jsonb_build_object('claimed',true,'claimId',q.id,'reason','claimed');
 elsif p_operation<>'record' then raise exception 'r12_operation_unavailable';end if;
 perform private.r04_keys(p_payload,array['candidateHash','claimId','proof','diagnostic','retryAfterAt']);
 select * into q from private.r12_discovery_receipt_checks where id=(p_payload->>'claimId')::uuid and request_id=r.id;
 if q.id is null or exists(select 1 from private.r12_discovery_receipt_checks where request_id=r.id and attempt>q.attempt) then raise exception 'r12_receipt_claim_invalid';end if;
 if (p_payload->'proof'='null'::jsonb)=(p_payload->'diagnostic'='null'::jsonb) then raise exception 'r12_receipt_record_invalid';end if;
 if p_payload->'proof'<>'null'::jsonb then
 perform private.r12_discovery_proof_validate(c,p_payload->'proof');terminal:=false;
 if p_payload->'retryAfterAt' is distinct from 'null'::jsonb then raise exception 'r12_retry_after_invalid';end if;
 else
 perform private.r04_keys(p_payload->'diagnostic',array['code','httpStatus']);code:=p_payload->'diagnostic'->>'code';
 if jsonb_typeof(p_payload->'diagnostic'->'code') is distinct from 'string' or code not in ('invalid_request','configuration_unavailable','transport_failure','timeout','redirect_rejected','api_failure','response_too_large','json_invalid','response_invalid','generation_mismatch','provider_mismatch','model_mismatch','provider_responses_invalid') then raise exception 'r12_diagnostic_invalid';end if;
 if p_payload->'diagnostic'->'httpStatus'<>'null'::jsonb then
 if jsonb_typeof(p_payload->'diagnostic'->'httpStatus') is distinct from 'number' or p_payload->'diagnostic'->>'httpStatus' !~ '^[1-5][0-9]{2}$' then raise exception 'r12_diagnostic_invalid';end if;http:=(p_payload->'diagnostic'->>'httpStatus')::integer;end if;
 terminal:=not(code in ('transport_failure','timeout') or code='api_failure' and coalesce(http in (404,429) or http between 500 and 599,false));
 if p_payload->'retryAfterAt'<>'null'::jsonb then
 if terminal or jsonb_typeof(p_payload->'retryAfterAt') is distinct from 'string' or p_payload->>'retryAfterAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then raise exception 'r12_retry_after_invalid';end if;
 retry_at:=(p_payload->>'retryAfterAt')::timestamptz;if not isfinite(retry_at) then raise exception 'r12_retry_after_invalid';end if;end if;
 end if;
 select * into o from private.r12_discovery_receipt_observations where check_id=q.id;
 if o.check_id is not null then
 if o.proof is distinct from nullif(p_payload->'proof','null'::jsonb) or o.diagnostic is distinct from nullif(p_payload->'diagnostic','null'::jsonb) or o.retry_after_at is distinct from retry_at then raise exception 'r12_receipt_record_conflict';end if;
 return state||jsonb_build_object('recorded',true,'replayed',true);end if;
 if state->>'status' in ('expired','stopped') then raise exception 'r12_receipt_inactive';end if;
 insert into private.r12_discovery_receipt_observations(check_id,proof,diagnostic,retry_after_at,terminal) values(q.id,nullif(p_payload->'proof','null'::jsonb),nullif(p_payload->'diagnostic','null'::jsonb),retry_at,terminal);
 perform private.r12_discovery_key(key_hash);return private.r12_discovery_receipt_status(c)||jsonb_build_object('recorded',true,'replayed',false);
end $function$;

CREATE OR REPLACE FUNCTION public.r12_discovery_owner_read(p_business_id uuid, p_scope_id uuid, p_activation boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare source_scope private.r12_discovery_scopes;authority private.r12_discovery_authorities;saved_plan private.r07_plans;head private.r07_heads;
 phase_plan_id uuid;source_plan private.r07_plans;step jsonb;attempt private.r07_attempts;binding private.r07_bindings;request private.r05_requests;candidate private.r12_discovery_candidates;response private.r07_responses;
 phases jsonb:='[]';receipt jsonb;actual bigint;held bigint;marked boolean;reserved boolean;known_total bigint:=0;held_total bigint:=0;unknown_cost boolean:=false;active boolean;stopped boolean;policy_revoked boolean;paused boolean;budget jsonb;begin
 if private.is_business_owner(p_business_id) is distinct from true then raise exception 'r12_owner_required' using errcode='42501';end if;
 select * into source_scope from private.r12_discovery_scopes where id=p_scope_id and business_id=p_business_id;if source_scope.id is null then return null;end if;
 if not coalesce(source_scope.amendment->>'version' in ('r12.discovery-source-scope.1','r12.discovery-review-continuation.1'),false) then raise exception 'r12_unknown_owner_scope';end if;
 if source_scope.amendment->>'version'='r12.discovery-review-continuation.1' then
 select * into source_plan from private.r07_plans where id=(source_scope.amendment->>'sourcePlanId')::uuid and business_id=p_business_id and goal_id=source_scope.goal_id and content_hash=source_scope.amendment->>'sourcePlanHash';
 if source_plan.id is null then raise exception 'r12_review_owner_source_unavailable';end if;end if;
 select * into authority from private.r12_discovery_authorities where scope_id=source_scope.id;
 select * into saved_plan from private.r07_plans where business_id=p_business_id and goal_id=source_scope.goal_id and content->>'discoveryScopeId'=source_scope.id::text order by version desc limit 1;
 select * into head from private.r07_heads where plan_id=saved_plan.id;
 stopped:=authority.scope_id is null or exists(select 1 from private.r05_revocations where policy_id=(authority.plan->>'policyId')::uuid) or private.r05_paused(p_business_id,'business',p_business_id) or private.r05_paused(p_business_id,'quest',source_scope.goal_id)
 or not exists(select 1 from private.r04_goal_state gs join private.r04_goal_versions gv using(goal_id,business_id,revision) where gs.goal_id=source_scope.goal_id and gs.business_id=p_business_id and gs.revision=(authority.plan->>'goalRevision')::integer and gv.preference='ready')
 or not exists(select 1 from private.r04_business_state bs join private.r04_business_versions bv using(business_id,revision) where bs.business_id=p_business_id and bs.revision=(authority.plan->>'businessRevision')::integer and bv.preference='setup');
 policy_revoked:=exists(select 1 from private.r05_revocations where policy_id=(authority.plan->>'policyId')::uuid);
 paused:=private.r05_paused(p_business_id,'business',p_business_id) or private.r05_paused(p_business_id,'quest',source_scope.goal_id) or exists(select 1 from jsonb_array_elements(authority.plan->'steps') st where private.r05_paused(p_business_id,'pack',(st->>'installationId')::uuid));
 active:=not stopped and not paused and authority.valid_until>clock_timestamp() and exists(select 1 from private.r07_server_keys k where k.key_hash=authority.controller_key_hash and k.expires_at>clock_timestamp() and not exists(select 1 from private.r07_server_revocations rev where rev.key_hash=k.key_hash)) and exists(select 1 from private.r05_server_keys k where k.key_hash=authority.admission_key_hash and k.expires_at>clock_timestamp() and not exists(select 1 from private.r05_server_revocations rev where rev.key_hash=k.key_hash));
 if authority.scope_id is not null or source_plan.id is not null then
 for step in select value from jsonb_array_elements(case when source_plan.id is null then authority.plan->'steps' else source_plan.content->'steps' end) loop
 phase_plan_id:=case when source_plan.id is not null and step->>'key'<>'review' then source_plan.id else saved_plan.id end;
 select * into attempt from private.r07_attempts where plan_id=phase_plan_id and business_id=p_business_id and step_key=step->>'key' order by private.r07_attempts.attempt desc limit 1;
 select * into binding from private.r07_bindings where attempt_id=attempt.id;
 select * into request from private.r05_requests where id=binding.request_id;
 select * into candidate from private.r12_discovery_candidates where request_id=request.id;
 select * into response from private.r07_responses where attempt_id=attempt.id;
 select max(actual_microunits) into actual from private.r05_settlements where request_id=request.id and provider_request_id is not null;
 marked:=exists(select 1 from private.r05_markers where request_id=request.id);reserved:=exists(select 1 from private.r05_reservations where request_id=request.id) and not exists(select 1 from private.r05_releases where request_id=request.id);
 held:=case when reserved and actual is null then request.liability_microunits else 0 end;
 receipt:=case when candidate.request_id is null then null else private.r12_discovery_receipt_status(candidate)-array['requestId','candidateHash','proofHash'] end;
 known_total:=known_total+coalesce(actual,0);held_total:=held_total+held;unknown_cost:=unknown_cost or marked and actual is null;
 phases:=phases||jsonb_build_array(jsonb_build_object('phase',step->>'key','status',coalesce(attempt.status,'not_started'),'reason',attempt.reason,'attemptId',attempt.id,'artifactId',response.artifact_id,
 'responseObservation',(select jsonb_build_object('receivedAt',ro.payload->'receivedAt','finishReason',ro.payload->'finishReason','nativeFinishReason',ro.payload->'nativeFinishReason',
 'contentState',ro.payload->'contentState','contentBytes',ro.payload->'contentBytes','contentHash',ro.payload->'contentHash')
 from private.r12_discovery_response_observations ro where ro.request_id=request.id and ro.kind='received'),
 'responseDiagnostic',(select jsonb_build_object('recordedAt',ro.payload->'recordedAt','code',ro.payload->'code',
 'httpStatus',ro.payload->'httpStatus','observationSaved',ro.payload->'observationSaved','issues',ro.payload->'issues')
 from private.r12_discovery_response_observations ro where ro.request_id=request.id and ro.kind='rejected'),
 'candidateSaved',candidate.request_id is not null,'receipt',receipt,'knownMicrousd',actual::text,'heldMicrousd',held::text,'unknownCost',marked and actual is null,'outcome',response.content->'result'->>'outcome'));
 end loop;end if;
 budget:=private.stage13v2_budget_authority(source_scope.prior_round_id,false);
 return jsonb_build_object('version','r12.discovery-workspace.1','businessId',p_business_id,'scopeId',source_scope.id,'goalId',source_scope.goal_id,
 'title',(select content->>'title' from private.r04_goal_versions where goal_id=source_scope.goal_id order by revision desc limit 1),
 'approvedQuery',source_scope.amendment->>'approvedQuery','sourceDomains',source_scope.amendment->'allowedDomains','priorRoundId',source_scope.prior_round_id,'budgetAuthorityRootId',source_scope.budget_authority_root_id,
 'planId',saved_plan.id,'planHash',saved_plan.content_hash,'state',case when authority.scope_id is null then 'awaiting_authority' when head.state='completed' then 'completed' when policy_revoked then 'stopped' when paused then 'paused' when stopped then 'blocked' else coalesce(head.state,'prepared') end,'reason',case when policy_revoked then 'owner_stopped' when paused then 'scope_paused' when stopped and authority.scope_id is not null then 'scope_changed' else head.reason end,'policyRevoked',policy_revoked,'paused',paused,
 'activeWindow',active,'dispatchUntil',authority.valid_until,'receiptUntil',authority.receipt_until,'phases',phases,
 'cost',jsonb_build_object('knownMicrousd',known_total::text,'heldMicrousd',held_total::text,'hasUnknown',unknown_cost),'rootFunding',budget,
 'activation',case when p_activation and authority.scope_id is not null then jsonb_build_object('scope',source_scope.amendment,'plan',authority.plan,'planHash',authority.plan_hash,'mode',authority.mode,
 'controllerKeyHash',authority.controller_key_hash,'admissionKeyHash',authority.admission_key_hash,'operations',(select payload->'operations' from private.r05_policies where id=(authority.plan->>'policyId')::uuid)) else null end);
end $function$;

commit;
