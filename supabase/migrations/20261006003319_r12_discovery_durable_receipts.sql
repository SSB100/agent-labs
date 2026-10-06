-- R12 private response staging and bounded metadata reads. No authority, source
-- approval, adapter enrollment, paid dispatch or credentials are seeded here.
begin;
create table private.r12_discovery_wires(
 request_id uuid primary key,business_id uuid not null,attempt_id uuid not null unique,scope_id uuid not null references private.r12_discovery_scopes(id),
 binding jsonb not null,binding_hash text not null,producer_key_hash text not null references private.r07_server_keys(key_hash),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(request_id,business_id) references private.r05_requests(id,business_id),foreign key(attempt_id,business_id) references private.r07_attempts(id,business_id),
 check(octet_length(binding::text)<=131072 and binding_hash=private.stage14_hash(binding))
);
create table private.r12_discovery_transport_claims(
 request_id uuid primary key references private.r12_discovery_wires(request_id),created_at timestamptz not null default clock_timestamp()
);
create table private.r12_discovery_candidates(
 request_id uuid primary key references private.r12_discovery_wires(request_id),candidate jsonb not null,candidate_hash text not null,
 receipt_expires_at timestamptz not null,created_at timestamptz not null default clock_timestamp(),
 check(octet_length(candidate::text)<=73728 and candidate_hash=private.stage14_hash(candidate) and isfinite(receipt_expires_at))
);
create table private.r12_discovery_receipt_checks(
 id uuid primary key default gen_random_uuid(),request_id uuid not null references private.r12_discovery_candidates(request_id),
 attempt integer not null check(attempt between 1 and 3),created_at timestamptz not null default clock_timestamp(),unique(request_id,attempt)
);
create table private.r12_discovery_receipt_observations(
 check_id uuid primary key references private.r12_discovery_receipt_checks(id),proof jsonb,diagnostic jsonb,retry_after_at timestamptz,terminal boolean not null,
 created_at timestamptz not null default clock_timestamp(),check((proof is not null)<>(diagnostic is not null)),check(retry_after_at is null or isfinite(retry_after_at))
);
create function private.r12_discovery_history_guard() returns trigger language plpgsql set search_path='' as $$ begin
 if current_user in ('anon','authenticated','service_role') then raise exception 'r12_trusted_server_required' using errcode='42501';end if;
 if tg_op<>'INSERT' then raise exception 'r12_immutable_discovery_history';end if;return new;
end $$;
do $$ declare t text;begin
 foreach t in array array['r12_discovery_wires','r12_discovery_transport_claims','r12_discovery_candidates','r12_discovery_receipt_checks','r12_discovery_receipt_observations'] loop
 execute format('alter table private.%I enable row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger r12_discovery_history_guard before insert or update or delete on private.%I for each row execute function private.r12_discovery_history_guard()',t);
 end loop;
end $$;

create function private.r12_discovery_key(h text) returns void language plpgsql set search_path='' as $$ begin
 perform 1 from private.r07_server_keys where key_hash=h for share;
 if not found or not exists(select 1 from private.r07_server_keys k where k.key_hash=h and k.expires_at>clock_timestamp() and not exists(select 1 from private.r07_server_revocations r where r.key_hash=k.key_hash)) then raise exception 'r12_controller_authority_required' using errcode='42501';end if;
end $$;

create function private.r12_discovery_wire_validate(r private.r05_requests,a private.r07_attempts,p private.r07_plans,s private.r12_discovery_scopes,v jsonb) returns void language plpgsql set search_path='' as $$
declare body jsonb;q jsonb;route jsonb;msg jsonb;phase text:=a.step_key;maximum_bytes integer;tokens integer;begin
 perform private.r04_keys(v,array['version','scopeId','scopeHash','attemptId','requestId','phase','requestJson','requestHash','wireBody','wireHash','quote','dependencyPins']);
 if v->>'version' is distinct from 'r12.discovery-wire.1' or v->>'scopeId' is distinct from s.id::text or v->>'scopeHash' is distinct from s.amendment_hash or v->>'attemptId' is distinct from a.id::text or v->>'requestId' is distinct from r.id::text or v->>'phase' is distinct from phase or v->'dependencyPins' is distinct from a.dependency_pins or r.workflow_run_id<>a.id or r.policy_id<>p.policy_id or r.payload->>'operationKey' is distinct from 'research.r12.'||s.id::text||'.'||phase then raise exception 'r12_wire_scope_mismatch';end if;
 if v->>'requestHash' is distinct from private.stage14_hash((v->>'requestJson')::jsonb) or r.payload->>'requestHash' is distinct from v->>'requestHash' or v->>'wireHash' is distinct from encode(extensions.digest(convert_to(v->>'wireBody','UTF8'),'sha256'),'hex') or r.payload->>'wireRequestHash' is distinct from v->>'wireHash' or jsonb_typeof(v->'wireBody') is distinct from 'string' then raise exception 'r12_wire_hash_mismatch';end if;
 maximum_bytes:=case phase when 'plan' then 12288 when 'search1' then 8192 when 'select1' then 16384 when 'strategy' then 32768 when 'review' then 32768 end;
 tokens:=case phase when 'plan' then 1500 when 'search1' then 4000 when 'select1' then 1000 when 'strategy' then 5000 when 'review' then 4000 end;
 if maximum_bytes is null or octet_length(v->>'wireBody')>maximum_bytes or octet_length(v->>'wireBody') is distinct from (r.payload->>'wireRequestBytes')::integer or (r.payload->>'maximumOutputTokens')::integer is distinct from tokens then raise exception 'r12_wire_bound_mismatch';end if;
 body:=(v->>'wireBody')::jsonb;q:=v->'quote';route:=q->(case when phase='review' then 'reviewer' else 'luna' end);
 if q->>'version' is distinct from 'r12.discovery-quote.1' or q->>'quoteHash' is distinct from private.stage14_hash(q-array['quoteHash','verifiedAt','validUntil']) or q->'maximumCalls' is distinct from '5'::jsonb or q->'maximumCollections' is distinct from '1'::jsonb or q->'proposalOnly' is distinct from 'true'::jsonb or q->'dispatchAuthorized' is distinct from 'false'::jsonb or jsonb_typeof(q->'verifiedAt') is distinct from 'string' or jsonb_typeof(q->'validUntil') is distinct from 'string' or not isfinite((q->>'verifiedAt')::timestamptz) or not isfinite((q->>'validUntil')::timestamptz) or (q->>'verifiedAt')::timestamptz>clock_timestamp() or (q->>'validUntil')::timestamptz<=clock_timestamp() or (q->>'validUntil')::timestamptz-(q->>'verifiedAt')::timestamptz<>interval '5 minutes' then raise exception 'r12_fresh_quote_required';end if;
 if jsonb_typeof(q->'ceilings'->phase) is distinct from 'number' or q->'ceilings'->>phase !~ '^[1-9][0-9]{0,6}$' or (q->'ceilings'->>phase)::bigint>r.liability_microunits then raise exception 'r12_quote_liability_mismatch';end if;
 if route->>'modelId' is distinct from (case when phase='review' then 'anthropic/claude-haiku-4.5' else 'openai/gpt-5.6-luna' end) or route->>'endpoint' is distinct from (case when phase='review' then 'amazon-bedrock/us' else 'azure/us' end) or route->>'providerName' is distinct from (case when phase='review' then 'Amazon Bedrock' else 'Azure' end) or body->>'model' is distinct from route->>'modelId' or r.payload->>'providerModelId' is distinct from body->>'model' or body->'max_tokens' is distinct from to_jsonb(tokens) or body->'stream' is distinct from 'false'::jsonb or body->'provider'->'only' is distinct from jsonb_build_array(route->>'endpoint') or body->'provider'->'allow_fallbacks' is distinct from 'false'::jsonb or body->'provider'->'require_parameters' is distinct from 'true'::jsonb or body->'provider'->'data_collection' is distinct from '"deny"'::jsonb or body->'provider'->'zdr' is distinct from 'true'::jsonb or body->'provider'->'max_price' is distinct from route->'priceLimit' then raise exception 'r12_exact_route_required';end if;
 if r.payload->'sourceDomains' is distinct from s.amendment->'allowedDomains' then raise exception 'r12_source_provenance_required';end if;
 perform private.r04_keys(body->'provider',array['only','allow_fallbacks','require_parameters','data_collection','zdr','max_price']);
 if jsonb_typeof(body->'messages') is distinct from 'array' or jsonb_array_length(body->'messages') not between 1 and 4 or exists(select 1 from jsonb_array_elements(body->'messages') m where jsonb_typeof(m->'content') is distinct from 'string' or not coalesce(m->>'role' in ('system','user'),false)) then raise exception 'r12_text_only_phase_required';end if;
 for msg in select value from jsonb_array_elements(body->'messages') loop perform private.r04_keys(msg,array['role','content']);end loop;
 if phase='search1' then
 perform private.r04_keys(body,array['model','provider','messages','tools','tool_choice','max_tool_calls','max_tokens','stream']);
 if body->'tools' is distinct from jsonb_build_array(jsonb_build_object('type','openrouter:web_search','parameters',jsonb_build_object('engine','exa','mode','fast','max_uses',1,'max_results',4,'max_total_results',4,'max_characters',1800,'allowed_domains',s.amendment->'allowedDomains','excluded_domains',s.amendment->'excludedDomains'))) or body->>'tool_choice' is distinct from 'required' or body->'max_tool_calls' is distinct from '1'::jsonb or ((v->>'requestJson')::jsonb)->'allowedDomains' is distinct from s.amendment->'allowedDomains' or ((v->>'requestJson')::jsonb)->'excludedDomains' is distinct from s.amendment->'excludedDomains' then raise exception 'r12_exact_search_scope_required';end if;
 elsif body ?| array['tools','plugins','tool_choice','max_tool_calls'] or body->'response_format'->>'type' is distinct from 'json_schema' then raise exception 'r12_text_only_phase_required';end if;
 if phase<>'search1' then
 perform private.r04_keys(body,array['model','provider','messages','response_format','max_tokens','stream']||case when phase='select1' then array['reasoning'] else array[]::text[] end);
 perform private.r04_keys(body->'response_format',array['type','json_schema']);perform private.r04_keys(body->'response_format'->'json_schema',array['name','strict','schema']);
 if body->'response_format'->'json_schema'->'strict' is distinct from 'true'::jsonb or body->'response_format'->'json_schema'->>'name' is distinct from (case phase when 'plan' then 'geographic_discovery_plan_v2' when 'select1' then 'discovery_evidence_selection_v2' when 'strategy' then 'product_discovery_v2_strategy' when 'review' then 'product_discovery_v2_review' end) or (phase='select1' and body->'reasoning' is distinct from '{"effort":"none"}'::jsonb) or (phase<>'select1' and body ? 'reasoning') then raise exception 'r12_static_nonprivate_schema_required';end if;
 if private.stage14_hash(((v->>'requestJson')::jsonb)->'outputSchema') is distinct from (case phase
 when 'plan' then 'b49dfc9ddc8c2dc3c496c3d4ccf350ea383150b724dedaf3e9d99fbbe7ebcf10'
 when 'select1' then 'e1bedf858d2286df3a2007c6a17040eb4c2e42ef8f92c445979be74f02e3a39c'
 when 'strategy' then '5515b1bc5c413c852525df2fb9641f710be92418bb3bf68746577cf1663c24a3'
 when 'review' then 'd1ab02be3a01b43f6c407070b284c37b8079e10eb2991013009d2c502bbd7e54' end)
 or private.stage14_hash(body->'response_format'->'json_schema'->'schema') is distinct from (case phase
 when 'plan' then 'ca9d827a2c2027e579902b91e4b368b4ebcd01bde1109a8332c61848c8e4c8d8'
 when 'select1' then '8ecda611f97e9ad9fb515c985be2eb93cdc1dd034d6e758760e888449d8a5cc9'
 when 'strategy' then '4d8489ecc1a39768e42f07969bb96054d40861de28ef0cd110645927a048204b'
 when 'review' then '81c1f3d20dce36cd6f00e3dabf8b7bce069cf5d03628d770e7ef40172b5d734c' end)
 then raise exception 'r12_static_nonprivate_schema_required';end if;end if;
end $$;

create function private.r12_discovery_receipt_status(c private.r12_discovery_candidates) returns jsonb language plpgsql stable set search_path='' as $$
declare w private.r12_discovery_wires;a private.r07_attempts;p private.r07_plans;h private.r07_heads;q private.r12_discovery_receipt_checks;o private.r12_discovery_receipt_observations;n timestamptz;state text;begin
 select * into w from private.r12_discovery_wires where request_id=c.request_id;select * into a from private.r07_attempts where id=w.attempt_id;select * into p from private.r07_plans where id=a.plan_id;select * into h from private.r07_heads where goal_id=a.goal_id;
 select * into q from private.r12_discovery_receipt_checks where request_id=c.request_id order by attempt desc limit 1;
 select * into o from private.r12_discovery_receipt_observations where check_id=q.id;n:=greatest(q.created_at+interval '120 seconds',o.retry_after_at);
 if h.reason='owner_stopped' or h.plan_id<>p.id or exists(select 1 from private.r05_revocations where policy_id=p.policy_id) or private.r05_paused(p.business_id,'business',p.business_id) or private.r05_paused(p.business_id,'quest',p.goal_id) or not exists(select 1 from public.businesses where id=p.business_id and owner_user_id=p.owner_id) or not exists(select 1 from private.r04_goal_state gs join private.r04_goal_versions gv using(goal_id,business_id,revision) where gs.goal_id=p.goal_id and gs.business_id=p.business_id and gs.revision=(p.content->>'goalRevision')::integer and gv.preference='ready')
 or not exists(select 1 from private.r04_business_state bs join private.r04_business_versions bv using(business_id,revision) where bs.business_id=p.business_id and bs.revision=(p.content->>'businessRevision')::integer and bv.preference='setup')
 or exists(select 1 from jsonb_array_elements(p.content->'steps') step where step->>'key'=a.step_key and (private.r05_paused(p.business_id,'pack',(step->>'installationId')::uuid) or exists(select 1 from private.r07_adapter_revocations revoked where revoked.adapter_key=step->>'adapter') or exists(select 1 from private.r05_operation_revocations revoked where revoked.operation_key=step->>'operationKey')))
 then state:='stopped';
 elsif clock_timestamp()>=c.receipt_expires_at then state:='expired';
 elsif o.proof is not null then state:='verified';
 elsif o.terminal then state:='terminal';
 elsif q.attempt=3 and (o.check_id is not null or clock_timestamp()>=n) then state:='exhausted';
 elsif q.id is not null and o.check_id is null and clock_timestamp()<n then state:='checking_receipt';else state:='awaiting_receipt';end if;
 return jsonb_build_object('requestId',c.request_id,'candidateHash',c.candidate_hash,'status',state,'attempts',coalesce(q.attempt,0),'nextCheckAt',case when state in ('awaiting_receipt','checking_receipt') then n else null end,'receiptExpiresAt',c.receipt_expires_at,'diagnostic',o.diagnostic,'proofHash',o.proof->>'proofHash');
end $$;

create function private.r12_discovery_proof_validate(c private.r12_discovery_candidates,v jsonb) returns void language plpgsql set search_path='' as $$
declare provider text;endpoint text;models jsonb;x jsonb;begin
 provider:=case when c.candidate->>'phase'='review' then 'Amazon Bedrock' else 'Azure' end;endpoint:=case when provider='Azure' then 'azure/us' else 'amazon-bedrock/us' end;
 models:=case when provider='Azure' then '["openai/gpt-5.6-luna","openai/gpt-5.6-luna-20260709"]'::jsonb else '["anthropic/claude-haiku-4.5","anthropic/claude-4.5-haiku-20251001"]'::jsonb end;
 perform private.r04_keys(v,array['generationId','providerName','modelId','requestedEndpoint','providerResponses','proofHash']);
 if v->>'generationId' is distinct from c.candidate->>'providerRequestId' or v->>'providerName' is distinct from provider or v->>'requestedEndpoint' is distinct from endpoint or not coalesce(models ? (v->>'modelId'),false) or v->>'proofHash' is distinct from private.stage14_hash(v-'proofHash') or jsonb_typeof(v->'providerResponses') is distinct from 'array' or jsonb_array_length(v->'providerResponses')>64 then raise exception 'r12_receipt_proof_invalid';end if;
 for x in select value from jsonb_array_elements(v->'providerResponses') loop perform private.r04_keys(x,array['providerName','modelId','status']);if x->>'providerName' is distinct from provider or not coalesce(models ? (x->>'modelId'),false) or x->'status' is distinct from '200'::jsonb then raise exception 'r12_receipt_proof_invalid';end if;end loop;
end $$;

create function public.r12_discovery_server(p_business_id uuid,p_attempt_id uuid,p_operation text,p_payload jsonb,p_server_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare key_hash text;a private.r07_attempts;p private.r07_plans;s private.r12_discovery_scopes;r private.r05_requests;rb private.r07_bindings;w private.r12_discovery_wires;c private.r12_discovery_candidates;q private.r12_discovery_receipt_checks;o private.r12_discovery_receipt_observations;
 v jsonb;state jsonb;mark timestamptz;expiry timestamptz;retry_at timestamptz;code text;http integer;terminal boolean;max_bytes integer;models jsonb;begin
 if p_server_key is null or length(p_server_key) not between 32 and 200 then raise exception 'r12_controller_authority_required' using errcode='42501';end if;
 perform 1 from public.businesses where id=p_business_id for update;if not found then raise exception 'r12_business_unavailable';end if;
 key_hash:=encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex');perform private.r12_discovery_key(key_hash);
 select * into a from private.r07_attempts where id=p_attempt_id and business_id=p_business_id;select * into p from private.r07_plans where id=a.plan_id and business_id=p_business_id;
 if a.id is null or p.content->>'format' is distinct from 'r12.discovery.1' or not exists(select 1 from public.businesses where id=p_business_id and owner_user_id=p.owner_id) then raise exception 'r12_attempt_scope_required';end if;
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
 if p_operation='load' then perform private.r04_keys(p_payload,array[]::text[]);return jsonb_build_object('binding',null,'candidate',null,'receipt',null,'proof',null);end if;
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
 select * into c from private.r12_discovery_candidates where request_id=r.id;
 if p_operation='load' then
 perform private.r04_keys(p_payload,array[]::text[]);
 return jsonb_build_object('dispatchedAt',(select created_at from private.r05_markers where request_id=r.id),'binding',w.binding,'candidate',c.candidate,'receipt',case when c.request_id is null then null else private.r12_discovery_receipt_status(c) end,'proof',(select ro.proof from private.r12_discovery_receipt_checks rc join private.r12_discovery_receipt_observations ro on ro.check_id=rc.id where rc.request_id=c.request_id and ro.proof is not null));
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
end $$;

-- Generic R07 response ingestion cannot publish an R12 output before its own
-- durable candidate and documented route receipt are verified.
create function private.r12_discovery_response_guard() returns trigger language plpgsql set search_path='' as $$
declare a private.r07_attempts;p private.r07_plans;c private.r12_discovery_candidates;state jsonb;begin
 select * into a from private.r07_attempts where id=new.attempt_id;select * into p from private.r07_plans where id=a.plan_id;
 if p.content->>'format'<>'r12.discovery.1' then return new;end if;
 select c0.* into c from private.r12_discovery_candidates c0 join private.r12_discovery_wires w on w.request_id=c0.request_id where w.attempt_id=a.id and w.business_id=new.business_id;
 if c.request_id is null then raise exception 'r12_verified_candidate_required';end if;
 state:=private.r12_discovery_receipt_status(c);
 if state->>'status'<>'verified' or new.content->'result'->>'candidateHash' is distinct from c.candidate_hash or new.content->'result'->>'routeProofHash' is distinct from state->>'proofHash' or new.content->'result'->'output' is distinct from c.candidate->'output' or c.candidate->'reportedMicrousd'='null'::jsonb or not exists(select 1 from private.r05_settlements z where z.request_id=c.request_id and z.actual_microunits=(c.candidate->>'reportedMicrousd')::bigint and z.provider_request_id=c.candidate->>'providerRequestId') then raise exception 'r12_verified_candidate_required';end if;
 return new;
end $$;
revoke all on function private.r12_discovery_response_guard() from public,anon,authenticated,service_role;
create trigger r12_discovery_response_guard before insert on private.r07_responses for each row execute function private.r12_discovery_response_guard();

-- A sent marker still needs the exact source, request, route and fresh quote.
-- This only replaces the earlier deliberately closed marker branch; all shared
-- funding/current-scope checks remain in the original guard.
create function private.r12_discovery_mark_guard(r private.r05_requests,a private.r07_attempts,p private.r07_plans,s private.r12_discovery_scopes) returns void language plpgsql set search_path='' as $$
declare w private.r12_discovery_wires;begin
 select * into w from private.r12_discovery_wires where request_id=r.id and business_id=r.business_id and attempt_id=a.id and scope_id=s.id;
 if w.request_id is null then raise exception 'r12_source_dispatch_bridge_unavailable';end if;
 perform private.r12_discovery_key(w.producer_key_hash);
 perform private.r12_discovery_wire_validate(r,a,p,s,w.binding);
end $$;
revoke all on function private.r12_discovery_mark_guard(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes) from public,anon,authenticated,service_role;
do $migration$
declare definition text;old text:=$old$if tg_table_name='r05_markers' then raise exception 'r12_source_dispatch_bridge_unavailable';end if;$old$;begin
 definition:=pg_get_functiondef('private.r12_discovery_financial_guard()'::regprocedure);
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_financial_guard_drift';end if;
 execute replace(definition,old,'if tg_table_name=''r05_markers'' then perform private.r12_discovery_mark_guard(r,a,p,scope);end if;');
end $migration$;

-- R11's default-deny source marker delegates only the exact R12 operation
-- family to the new positive validator. Every unrelated source remains closed.
create function private.r12_discovery_routed_marker(r private.r05_requests) returns void language plpgsql set search_path='' as $$
declare a private.r07_attempts;p private.r07_plans;s private.r12_discovery_scopes;begin
 select * into a from private.r07_attempts where id=r.workflow_run_id and business_id=r.business_id;select * into p from private.r07_plans where id=a.plan_id;
 if a.id is null or p.id is null then raise exception 'r12_exact_controller_request_required';end if;
 s:=private.r12_discovery_scope_current(p);perform private.r12_discovery_mark_guard(r,a,p,s);
 if private.r05_admissible(r) is not null then raise exception 'r12_current_financial_gate_required';end if;
 s:=private.r12_discovery_scope_current(p);perform private.r12_discovery_mark_guard(r,a,p,s);
end $$;
revoke all on function private.r12_discovery_routed_marker(private.r05_requests) from public,anon,authenticated,service_role;
do $migration$
declare definition text;old text:=$old$ select * into o from private.r05_operations where operation_key=r.payload->>'operationKey';$old$;replacement text;begin
 definition:=pg_get_functiondef('private.r11_research_marker()'::regprocedure);
 replacement:=old||$new$
 if r.payload->>'operationKey' ~ '^research\.r12\.[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(plan|search1|select1|strategy|review)$' then
 perform private.r12_discovery_routed_marker(r);return new;end if;$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_r11_source_marker_drift';end if;
 execute replace(definition,old,replacement);
end $migration$;

revoke all on function public.r12_discovery_server(uuid,uuid,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.r12_discovery_server(uuid,uuid,text,jsonb,text) to authenticated,service_role;
do $$ declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('r12_discovery_history_guard','r12_discovery_key','r12_discovery_wire_validate','r12_discovery_receipt_status','r12_discovery_proof_validate') loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f);end loop;
end $$;
commit;
