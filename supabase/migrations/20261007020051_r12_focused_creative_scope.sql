-- Definition-only focused creative durable receipts after pilot/adoption helpers; no authority seeded.
begin;
-- Scratch definition-only draft. No enrolled scopes, keys, policies or calls.
create table private.r12_focused_creative_scopes (
 creative_run_id uuid primary key references public.creative_runs(id),
 business_id uuid not null references public.businesses(id),
 workflow_run_id uuid not null unique,
 approval_id uuid not null unique,
 policy_id uuid not null,
 admission_key_hash text not null unique references private.r05_server_keys(key_hash),
 scope jsonb not null,scope_hash text not null check(scope_hash=private.stage14_hash(scope)),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(creative_run_id,workflow_run_id,business_id) references public.creative_runs(id,workflow_run_id,business_id),
 foreign key(approval_id,business_id) references public.creative_approvals(id,business_id),
 foreign key(policy_id,business_id) references private.r05_policies(id,business_id),
 unique(creative_run_id,business_id)
);
create table private.r12_focused_creative_wires (
 creative_run_id uuid not null,business_id uuid not null,call_key text not null check(call_key in('brief:1','screen:1','generate:1','review:1')),
 binding jsonb not null,binding_hash text not null check(binding_hash=private.stage14_hash(binding)),
 created_at timestamptz not null default clock_timestamp(),primary key(creative_run_id,call_key),
 foreign key(creative_run_id,business_id) references private.r12_focused_creative_scopes(creative_run_id,business_id),
 check(octet_length(binding::text)<=10500000)
);
create table private.r12_focused_creative_sends (
 creative_run_id uuid not null,business_id uuid not null,call_key text not null,request_id uuid not null unique,
 binding_hash text not null,created_at timestamptz not null default clock_timestamp(),primary key(creative_run_id,call_key),
 foreign key(creative_run_id,call_key) references private.r12_focused_creative_wires(creative_run_id,call_key),
 foreign key(request_id,business_id) references private.r05_requests(id,business_id)
);
create table private.r12_focused_creative_observations (
 creative_run_id uuid not null,business_id uuid not null,call_key text not null,
 observation jsonb not null,observation_hash text not null check(observation_hash=private.stage14_hash(observation)),
 created_at timestamptz not null default clock_timestamp(),primary key(creative_run_id,call_key),
 foreign key(creative_run_id,call_key) references private.r12_focused_creative_sends(creative_run_id,call_key),check(octet_length(observation::text)<=65536)
);
create table private.r12_focused_creative_candidates (
 creative_run_id uuid not null,business_id uuid not null,call_key text not null,generation_id text not null unique,
 candidate jsonb not null,candidate_hash text not null check(candidate_hash=private.stage14_hash(candidate)),
 created_at timestamptz not null default clock_timestamp(),primary key(creative_run_id,call_key),
 foreign key(creative_run_id,call_key) references private.r12_focused_creative_sends(creative_run_id,call_key),check(octet_length(candidate::text)<=65536)
);
create table private.r12_focused_creative_checks (
 id uuid primary key default gen_random_uuid(),creative_run_id uuid not null,business_id uuid not null,call_key text not null,
 ordinal integer not null check(ordinal between 1 and 3),candidate_hash text not null,
 created_at timestamptz not null default clock_timestamp(),unique(creative_run_id,call_key,ordinal),
 foreign key(creative_run_id,call_key) references private.r12_focused_creative_candidates(creative_run_id,call_key)
);
create table private.r12_focused_creative_receipts (
 check_id uuid primary key references private.r12_focused_creative_checks(id),
 proof jsonb,diagnostic jsonb,retry_after_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),check((proof is null)<>(diagnostic is null)),
 check(octet_length(coalesce(proof,diagnostic)::text)<=65536)
);
do $private_tables$
declare t text;begin
 foreach t in array array['r12_focused_creative_scopes','r12_focused_creative_wires','r12_focused_creative_sends','r12_focused_creative_observations','r12_focused_creative_candidates','r12_focused_creative_checks','r12_focused_creative_receipts'] loop
 execute format('alter table private.%I enable row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger r12_focused_creative_immutable before insert or update or delete on private.%I for each row execute function private.r12_discovery_history_guard()',t);
 end loop;
end $private_tables$;

-- Only the focused launch event becomes a single-use authority receipt.
create function private.r12_focused_creative_launch_event_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if (tg_op<>'INSERT' and old.event_type in ('r12.focused.creative.launch_claimed','r12.focused.creative.staged'))
 or (tg_op<>'DELETE' and new.event_type in ('r12.focused.creative.launch_claimed','r12.focused.creative.staged')) then
  if tg_op<>'INSERT' or current_user in ('anon','authenticated','service_role') then raise exception 'r12_creative_launch_claim_immutable' using errcode='42501';end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger r12_focused_creative_launch_event_guard before insert or update or delete on public.events for each row execute function private.r12_focused_creative_launch_event_guard();

create function private.r12_focused_creative_scope_check(q private.r12_focused_creative_scopes,p_current boolean default true)
returns void language plpgsql set search_path='' as $$
declare v jsonb:=q.scope;r public.creative_runs;a public.creative_approvals;w public.workflow_runs;p private.r05_policies;i public.installed_packs;
 k text;amount bigint;total bigint:=0;op jsonb;route jsonb;begin
 perform private.r12_pilot_safe(v);
 perform private.r04_keys(v,array['version','businessId','ownerId','creativeRunId','workflowRunId','approvalId','approvalHash','adoptionHash','installationId','installationSnapshotHash','startsAt','expiresAt','receiptUntil','quoteHash','phaseCeilings','sourceDomains','dataClassesByPhase','priceLimitsByPhase']);
 select * into r from public.creative_runs where id=q.creative_run_id and business_id=q.business_id and workflow_run_id=q.workflow_run_id;
 select * into a from public.creative_approvals where id=q.approval_id and business_id=q.business_id;
 select * into w from public.workflow_runs where id=q.workflow_run_id and business_id=q.business_id;
 select * into p from private.r05_policies where id=q.policy_id and business_id=q.business_id;
 if v->>'version' is distinct from 'r12.focused-creative-scope.1' or v->>'creativeRunId' is distinct from q.creative_run_id::text
 or v->>'businessId' is distinct from q.business_id::text or v->>'workflowRunId' is distinct from q.workflow_run_id::text or v->>'approvalId' is distinct from q.approval_id::text
 or q.scope_hash is distinct from private.stage14_hash(v) or r.id is null or a.id is null or w.id is null or p.id is null or r.approval_id<>a.id
 or v->>'ownerId' is distinct from a.owner_user_id::text or a.approval_hash is distinct from v->>'approvalHash' or private.stage14_hash(a.snapshot) is distinct from a.approval_hash
 or not(a.snapshot ? 'focusedPilotBinding') or a.snapshot->'maximumGenerations' is distinct from '1'::jsonb
 or v->>'adoptionHash' is distinct from private.stage14_hash(a.snapshot->'focusedPilotBinding'->'adoption')
 or v->'installationId' is distinct from a.snapshot->'focusedPilotBinding'->'creativeInstallationId'
 or v->'installationSnapshotHash' is distinct from a.snapshot->'focusedPilotBinding'->'creativeInstallationSnapshotHash'
 or v->>'quoteHash' is distinct from private.stage14_hash(a.quote)
 or w.goal_id::text is distinct from a.snapshot->'focusedPilotBinding'->'adoption'->>'goalId'
 or w.pack_snapshot is distinct from r.catalog_snapshot or w.input->'focusedPilotBinding' is distinct from a.snapshot->'focusedPilotBinding'
 or w.runtime_capability_hash is distinct from (select capability_hash from private.creative_run_capabilities where creative_run_id=r.id)
 or p.goal_id is distinct from w.goal_id or p.actor_id is distinct from a.owner_user_id or p.payload->'maximumDispatches' is distinct from '4'::jsonb
 or p.payload->>'financialMode' is distinct from 'bounded_model_cost_only'
 or a.quote->>'generatorModel' is distinct from 'black-forest-labs/flux.2-klein-4b'
 or a.quote->>'directorModel' is distinct from 'openai/gpt-5.6-luna' or a.quote->>'reviewerModel' is distinct from 'anthropic/claude-haiku-4.5'
 then raise exception 'r12_creative_scope_identity';end if;
 foreach k in array array['startsAt','expiresAt','receiptUntil'] loop
 if jsonb_typeof(v->k) is distinct from 'string' or not isfinite((v->>k)::timestamptz) then raise exception 'r12_creative_scope_time';end if;end loop;
 if (v->>'expiresAt')::timestamptz<>(v->>'startsAt')::timestamptz+interval '30 minutes'
 or (v->>'receiptUntil')::timestamptz<>(v->>'expiresAt')::timestamptz+interval '30 minutes'
 or (v->>'receiptUntil')::timestamptz>r.capability_expires_at or (v->>'receiptUntil')::timestamptz>a.expires_at
 or (v->>'expiresAt')::timestamptz>(p.payload->>'expiresAt')::timestamptz
 or (v->>'startsAt')::timestamptz<(p.payload->>'startsAt')::timestamptz then raise exception 'r12_creative_scope_time';end if;
 perform private.r04_keys(v->'phaseCeilings',array['brief:1','screen:1','generate:1','review:1']);
 perform private.r04_keys(v->'dataClassesByPhase',array['brief:1','screen:1','generate:1','review:1']);
 perform private.r04_keys(v->'priceLimitsByPhase',array['brief:1','screen:1','review:1']);
 perform private.r04_strings(v->'sourceDomains',8);
 if jsonb_array_length(p.payload->'operations')<>4 then raise exception 'r12_creative_exact_operations';end if;
 foreach k in array array['brief:1','screen:1','generate:1','review:1'] loop
 amount:=private.r05_money(to_jsonb(v->'phaseCeilings'->>k));
 if jsonb_typeof(v->'phaseCeilings'->k) is distinct from 'number' or amount not between 1 and 1000000
 or amount is distinct from (a.quote->'maximaMicrousd'->>(case k when 'generate:1' then 'generation' else split_part(k,':',1) end))::bigint
 or (k='generate:1' and amount<>70000) then raise exception 'r12_creative_exact_ceiling';end if;
 total:=total+amount;
 perform private.r04_strings(v->'dataClassesByPhase'->k,8);
 select value into op from jsonb_array_elements(p.payload->'operations') x where x->>'operationKey'='creative.r12.'||a.id||'.'||split_part(k,':',1);
 if op is null or op->>'provider' is distinct from 'openrouter' or op->'sourceDomains' is distinct from v->'sourceDomains'
 or op->'dataClasses' is distinct from v->'dataClassesByPhase'->k or op->>'installationId' is distinct from v->>'installationId'
 or op->'accountId' is distinct from 'null'::jsonb or op->'accountRevision' is distinct from 'null'::jsonb
 or private.r05_money(op->'maximumPerOperationMicrounits')<>amount then raise exception 'r12_creative_exact_operations';end if;
 if k<>'generate:1' then
 route:=v->'priceLimitsByPhase'->k;perform private.r04_keys(route,array['prompt','completion','request']);
 if route->'request' is distinct from '0'::jsonb or jsonb_typeof(route->'prompt') is distinct from 'number' or jsonb_typeof(route->'completion') is distinct from 'number'
 or (route->>'prompt')::numeric not between 0.000001 and 1000000 or (route->>'completion')::numeric not between 0.000001 and 1000000
 or ceil((32768+case when k='review:1' then 8192 else 0 end)*(route->>'prompt')::numeric+(case when k='brief:1' then 2500 else 1800 end)*(route->>'completion')::numeric)>amount then raise exception 'r12_creative_uncovered_price_ceiling';end if;
 end if;end loop;
 if total> a.maximum_microusd or total<>private.r05_money(p.payload->'policyLimitMicrounits') then raise exception 'r12_creative_scope_budget';end if;
 if not exists(select 1 from private.r05_server_keys key where key.key_hash=q.admission_key_hash and key.expires_at>=(v->>'receiptUntil')::timestamptz and key.expires_at<=(v->>'receiptUntil')::timestamptz+interval '5 seconds')
 or exists(select 1 from private.r07_server_keys where key_hash=q.admission_key_hash)
 or exists(select 1 from private.r12_discovery_authorities old where q.admission_key_hash in(old.admission_key_hash,old.controller_key_hash))
 then raise exception 'r12_creative_separate_finite_admission_key';end if;
 if p_current then
 if not exists(select 1 from public.businesses where id=q.business_id and owner_user_id=a.owner_user_id)
 or exists(select 1 from private.r05_revocations where policy_id=p.id) or exists(select 1 from private.r05_server_revocations where key_hash=q.admission_key_hash)
 or not exists(select 1 from private.r05_confirmations where policy_id=p.id and business_id=q.business_id and actor_id=a.owner_user_id)
 or not exists(select 1 from private.r04_goal_state where business_id=q.business_id and goal_id=p.goal_id and revision=p.goal_revision)
 or not exists(select 1 from private.r04_business_state where business_id=q.business_id and revision=p.business_revision)
 or private.r05_paused(q.business_id,'business',q.business_id) or private.r05_paused(q.business_id,'quest',p.goal_id)
 or private.r05_paused(q.business_id,'pack',(v->>'installationId')::uuid) then raise exception 'r12_creative_authority_stopped';end if;
 select * into i from public.installed_packs where id=(v->>'installationId')::uuid and business_id=q.business_id and status='active';
 if i.id is null or private.stage14_hash(i.snapshot) is distinct from v->>'installationSnapshotHash' or w.pack_installation_id<>i.id then raise exception 'r12_creative_knowledge_changed';end if;
 perform private.stage14_assert_focused_adoption(a.candidate_id,a.snapshot);
 end if;
end $$;

create function private.r12_focused_creative_scope_insert() returns trigger language plpgsql set search_path='' as $$
begin
 perform 1 from public.businesses where id=new.business_id for update;
 perform private.r12_focused_creative_scope_check(new,true);
 if (new.scope->>'startsAt')::timestamptz>clock_timestamp() or (new.scope->>'expiresAt')::timestamptz<=clock_timestamp()
 or exists(select 1 from public.creative_cost_reservations where creative_run_id=new.creative_run_id)
 or exists(select 1 from private.r05_requests where workflow_run_id=new.workflow_run_id) then raise exception 'r12_creative_fresh_scope_required';end if;
 return new;
end $$;
create trigger r12_focused_creative_scope_validate before insert on private.r12_focused_creative_scopes for each row execute function private.r12_focused_creative_scope_insert();

create function private.r12_focused_creative_wire_check(q private.r12_focused_creative_scopes,k text,v jsonb)
returns void language plpgsql set search_path='' as $$
declare d jsonb:=v->'descriptor';req jsonb:=v->'request';body jsonb;msg jsonb;part jsonb;pic jsonb;expected_messages jsonb;clean_req jsonb;
 model text;endpoint text;tokens integer;images integer:=0;dispatch_quote jsonb;price_limits jsonb;verified_at timestamptz;valid_until timestamptz;raw bytea;encoded text;original private.r12_focused_creative_candidates;phase_output public.creative_phase_outputs;
 reserved public.creative_cost_reservations;begin
 if k not in ('brief:1','screen:1','generate:1','review:1') or octet_length(v::text)>10500000 then raise exception 'r12_creative_binding_bound';end if;
 perform private.r04_keys(v,array['version','scopeHash','callKey','request','requestHash','wireBody','wireHash','descriptor','dispatchQuote']);
 if v->>'version' is distinct from 'r12.focused-creative-wire.1' or v->>'scopeHash' is distinct from q.scope_hash or v->>'callKey' is distinct from k
 or jsonb_typeof(v->'wireBody') is distinct from 'string' or v->>'wireHash' is distinct from private.stage13_hash(v->>'wireBody')
 or octet_length(v->>'wireBody')>(case when k='review:1' then 5000000 else 24576 end) then raise exception 'r12_creative_binding_identity';end if;
 body:=(v->>'wireBody')::jsonb;
 model:=case k when 'brief:1' then 'openai/gpt-5.6-luna' when 'generate:1' then 'black-forest-labs/flux.2-klein-4b' else 'anthropic/claude-haiku-4.5' end;
 endpoint:=case k when 'brief:1' then 'azure/us' when 'generate:1' then 'black-forest-labs' else 'amazon-bedrock/us' end;
 tokens:=case k when 'brief:1' then 2500 when 'generate:1' then 0 else 1800 end;
 dispatch_quote:=v->'dispatchQuote';
 if k='generate:1' then
  if dispatch_quote is distinct from 'null'::jsonb then raise exception 'r12_creative_image_quote_contract';end if;
 else
  perform private.r04_keys(dispatch_quote,array['version','callKey','modelId','endpoint','verifiedAt','validUntil','sourceQuoteHash','priceLimits','maximumMicrousd','quoteHash']);
  if dispatch_quote->>'version' is distinct from 'r12.focused-creative-dispatch-quote.1' or dispatch_quote->>'callKey' is distinct from k
   or dispatch_quote->>'modelId' is distinct from model or dispatch_quote->>'endpoint' is distinct from endpoint
   or dispatch_quote->>'quoteHash' is distinct from private.stage14_hash(dispatch_quote-'quoteHash')
   or not coalesce(dispatch_quote->>'sourceQuoteHash' ~ '^[a-f0-9]{64}$',false)
   or jsonb_typeof(dispatch_quote->'maximumMicrousd') is distinct from 'number'
   or not coalesce(dispatch_quote->>'maximumMicrousd' ~ '^[1-9][0-9]{0,6}$',false)
   or (dispatch_quote->>'maximumMicrousd')::bigint>(q.scope->'phaseCeilings'->>k)::bigint
  then raise exception 'r12_creative_dispatch_quote_identity';end if;
  verified_at:=(dispatch_quote->>'verifiedAt')::timestamptz;valid_until:=(dispatch_quote->>'validUntil')::timestamptz;
  if jsonb_typeof(dispatch_quote->'verifiedAt') is distinct from 'string' or jsonb_typeof(dispatch_quote->'validUntil') is distinct from 'string'
   or isfinite(verified_at) is not true or isfinite(valid_until) is not true or verified_at>clock_timestamp()
   or clock_timestamp()>=valid_until or valid_until<>verified_at+interval '5 minutes' then raise exception 'r12_creative_dispatch_quote_time';end if;
  price_limits:=dispatch_quote->'priceLimits';perform private.r04_keys(price_limits,array['prompt','completion','request']);
  if price_limits->'request' is distinct from '0'::jsonb or jsonb_typeof(price_limits->'prompt') is distinct from 'number'
   or jsonb_typeof(price_limits->'completion') is distinct from 'number'
   or (price_limits->>'prompt')::numeric not between 0.000001 and (q.scope->'priceLimitsByPhase'->k->>'prompt')::numeric
   or (price_limits->>'completion')::numeric not between 0.000001 and (q.scope->'priceLimitsByPhase'->k->>'completion')::numeric
   or ceil((32768+case when k='review:1' then 8192 else 0 end)*(price_limits->>'prompt')::numeric+tokens*(price_limits->>'completion')::numeric)>(dispatch_quote->>'maximumMicrousd')::bigint
  then raise exception 'r12_creative_dispatch_quote_ceiling';end if;
 end if;

 perform private.r04_keys(d,array['workflowRunId','operationKey','requestHash','idempotencyKey','providerModelId','wireRequestHash','wireRequestBytes','maximumOutputTokens','accounting','sourceDomains','dataClasses','accountId','accountRevision','currency','liabilityMicrounits']||case when k='generate:1' then array['maximumOutputImages'] else array[]::text[] end);
 perform private.r04_safe(d);
 if d->>'workflowRunId' is distinct from q.workflow_run_id::text or d->>'operationKey' is distinct from 'creative.r12.'||q.approval_id||'.'||split_part(k,':',1)
 or d->>'requestHash' is distinct from v->>'requestHash' or d->>'requestHash' !~ '^[a-f0-9]{64}$' or d->>'idempotencyKey' is distinct from q.workflow_run_id::text||':creative:'||k
 or d->>'providerModelId' is distinct from model or d->>'wireRequestHash' is distinct from v->>'wireHash'
 or d->'wireRequestBytes' is distinct from to_jsonb(octet_length(v->>'wireBody')) or d->'maximumOutputTokens' is distinct from to_jsonb(tokens)
 or (k='generate:1' and d->'maximumOutputImages' is distinct from '1'::jsonb)
 or d->'accounting' is distinct from jsonb_build_object('kind','creative','runId',q.creative_run_id,'callKey',k)
 or d->'sourceDomains' is distinct from q.scope->'sourceDomains' or d->'dataClasses' is distinct from q.scope->'dataClassesByPhase'->k
 or d->'accountId' is distinct from 'null'::jsonb or d->'accountRevision' is distinct from 'null'::jsonb or d->>'currency' is distinct from 'USD'
 or private.r05_money(d->'liabilityMicrounits')<>(q.scope->'phaseCeilings'->>k)::bigint
 or body->>'model' is distinct from model or body->'provider'->'only' is distinct from jsonb_build_array(endpoint) or body->'provider'->'allow_fallbacks' is distinct from 'false'::jsonb
 then raise exception 'r12_creative_descriptor_mismatch';end if;
 select * into reserved from public.creative_cost_reservations where creative_run_id=q.creative_run_id and business_id=q.business_id and call_key=k;
 if reserved.creative_run_id is null or reserved.request_hash is distinct from v->>'requestHash' or reserved.model is distinct from model
 or reserved.reserved_microusd<>(q.scope->'phaseCeilings'->>k)::bigint then raise exception 'r12_creative_exact_reservation_required';end if;
 if k='generate:1' then
 perform private.r04_keys(req,array['prompt','quote']);perform private.r04_safe(req);
 perform private.r04_keys(body,array['model','prompt','aspect_ratio','n','output_format','size','provider']);perform private.r04_keys(body->'provider',array['only','allow_fallbacks']);
 if body->'n' is distinct from '1'::jsonb or body->>'aspect_ratio' is distinct from '1:1' or body->>'size' is distinct from '1024x1024' or body->>'output_format' is distinct from 'png'
 or body->'prompt' is distinct from req->'prompt' or body->'prompt' is distinct from (select output->'imagePrompt' from public.creative_phase_outputs where creative_run_id=q.creative_run_id and call_key='brief:1')
 or v->>'requestHash' is distinct from private.stage14_hash(body) or req->'quote'->>'requestHash' is distinct from v->>'requestHash'
 or req->'quote'->>'quoteId' is distinct from private.stage14_hash((req->'quote')-'quoteId')
 or req->'quote'->>'promptHash' is distinct from private.stage13_hash(req->>'prompt')
 or req->'quote'->>'version' is distinct from 'flux-klein-png-1.0' or req->'quote'->>'modelId' is distinct from model
 or req->'quote'->>'source' is distinct from 'https://openrouter.ai/api/v1/images/models/black-forest-labs/flux.2-klein-4b/endpoints'
 or req->'quote'->'estimatedMicrousd' is distinct from '70000'::jsonb
 or not isfinite((req->'quote'->>'verifiedAt')::timestamptz) or abs(extract(epoch from clock_timestamp()-(req->'quote'->>'verifiedAt')::timestamptz))>300
 then raise exception 'r12_creative_exact_native_png_request';end if;
 else
 perform private.r04_keys(body,array['model','max_tokens','messages','response_format','provider','stream']);
 perform private.r04_keys(body->'provider',array['only','allow_fallbacks','require_parameters','data_collection','zdr','max_price']);
 if body->'max_tokens' is distinct from to_jsonb(tokens) or body->'stream' is distinct from 'false'::jsonb
 or body->'provider'->'require_parameters' is distinct from 'true'::jsonb or body->'provider'->>'data_collection' is distinct from 'deny' or body->'provider'->'zdr' is distinct from 'true'::jsonb
 or body->'provider'->'max_price' is distinct from q.scope->'priceLimitsByPhase'->k
 or body->'response_format'->>'type' is distinct from 'json_schema' or body->'response_format'->'json_schema'->'strict' is distinct from 'true'::jsonb
 or v->>'requestHash' is distinct from private.stage14_hash(req) or req->'model'->>'providerModelId' is distinct from model
 or req->'providerOnly' is distinct from jsonb_build_array(endpoint) or req->>'providerDataCollection' is distinct from 'deny' or req->'providerZdr' is distinct from 'true'::jsonb
 or req->'requireReturnedModel' is distinct from 'true'::jsonb or req->'providerPriceLimit' is distinct from q.scope->'priceLimitsByPhase'->k
 or req->'maxOutputTokens' is distinct from to_jsonb(tokens) then raise exception 'r12_creative_exact_text_route';end if;
 if jsonb_typeof(req->'messages') is distinct from 'array' or jsonb_array_length(req->'messages') not between 1 and 4 then raise exception 'r12_creative_messages';end if;
 expected_messages:='[]';
 for msg in select value from jsonb_array_elements(req->'messages') loop
 perform private.r04_keys(msg,array['role','content']||case when msg ? 'images' then array['images'] else array[]::text[] end);
 if msg->>'role' not in('system','user') or jsonb_typeof(msg->'content') is distinct from 'string' then raise exception 'r12_creative_messages';end if;
 perform private.r04_safe(msg-'images');
 if msg ? 'images' then
 if k<>'review:1' or msg->>'role'<>'user' or jsonb_typeof(msg->'images') is distinct from 'array' or jsonb_array_length(msg->'images')<>1 then raise exception 'r12_creative_original_image_required';end if;
 pic:=msg->'images'->0;perform private.r04_keys(pic,array['mediaType','base64']);encoded:=pic->>'base64';
 if pic->>'mediaType' is distinct from 'image/png' or jsonb_typeof(pic->'base64') is distinct from 'string' or char_length(encoded)>4933336
 or encoded !~ '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' then raise exception 'r12_creative_original_image_required';end if;
 raw:=decode(encoded,'base64');
 if octet_length(raw)>3700000 or substring(raw from 1 for 8)<>decode('89504e470d0a1a0a','hex') or replace(encode(raw,'base64'),E'\n','') is distinct from encoded then raise exception 'r12_creative_original_image_required';end if;
 select * into original from private.r12_focused_creative_candidates where creative_run_id=q.creative_run_id and call_key='generate:1';
 select * into phase_output from public.creative_phase_outputs where creative_run_id=q.creative_run_id and call_key='generate:1';
 if original.creative_run_id is null or phase_output.creative_run_id is null or original.candidate->'output'->>'sourceSha256' is distinct from encode(extensions.digest(raw,'sha256'),'hex')
 or original.candidate->'output'->'sourceBytes' is distinct from to_jsonb(octet_length(raw))
 or phase_output.output->>'storagePath' is distinct from original.candidate->'output'->>'storagePath'
 or phase_output.output->'inspection'->>'sha256' is distinct from original.candidate->'output'->>'sourceSha256'
 then raise exception 'r12_creative_original_pixels_changed';end if;
 images:=images+1;
 expected_messages:=expected_messages||jsonb_build_array(jsonb_build_object('role',msg->>'role','content',jsonb_build_array(jsonb_build_object('type','text','text',msg->>'content'),jsonb_build_object('type','image_url','image_url',jsonb_build_object('url','data:image/png;base64,'||encoded)))));
 else expected_messages:=expected_messages||jsonb_build_array(jsonb_build_object('role',msg->>'role','content',msg->>'content'));end if;
 end loop;
 if images<>(case when k='review:1' then 1 else 0 end) or body->'messages' is distinct from expected_messages then raise exception 'r12_creative_messages_changed';end if;
 select req||jsonb_build_object('messages',jsonb_agg(m.value-'images' order by m.ordinality)) into clean_req from jsonb_array_elements(req->'messages') with ordinality m;
 if octet_length(clean_req::text)>24576 then raise exception 'r12_creative_text_bound';end if;perform private.r12_pilot_safe(clean_req);
 end if;
end $$;

create function private.r12_focused_creative_proof_check(proof jsonb,candidate jsonb) returns void language plpgsql set search_path='' as $$
#variable_conflict use_variable
declare k text:=candidate->>'callKey';provider text;endpoint text;models jsonb;r jsonb;image_receipt jsonb;created_time timestamptz;sent_time timestamptz;begin
 if k not in('brief:1','screen:1','generate:1','review:1') then raise exception 'r12_creative_route_unverified';end if;
 provider:=case k when 'brief:1' then 'Azure' when 'generate:1' then 'Black Forest Labs' else 'Amazon Bedrock' end;
 endpoint:=case k when 'brief:1' then 'azure/us' when 'generate:1' then 'black-forest-labs' else 'amazon-bedrock/us' end;
 models:=case k when 'brief:1' then '["openai/gpt-5.6-luna","openai/gpt-5.6-luna-20260709"]'::jsonb when 'generate:1' then '["black-forest-labs/flux.2-klein-4b"]'::jsonb else '["anthropic/claude-haiku-4.5","anthropic/claude-4.5-haiku-20251001"]'::jsonb end;
 perform private.r04_keys(proof,array['version','generationId','providerName','modelId','requestedEndpoint','providerResponses','proofHash']||case when k='generate:1' then array['imageReceipt'] else array[]::text[] end);perform private.r12_pilot_safe(proof);
 if proof->>'version' is distinct from 'r12.focused-creative-route.1' or proof->>'generationId' is distinct from candidate->>'generationId'
 or proof->>'providerName' is distinct from provider or proof->>'requestedEndpoint' is distinct from endpoint or not coalesce(models ? (proof->>'modelId'),false)
 or proof->>'proofHash' is distinct from private.stage14_hash(proof-'proofHash') or jsonb_typeof(proof->'providerResponses') is distinct from 'array' or jsonb_array_length(proof->'providerResponses')>64 then raise exception 'r12_creative_route_unverified';end if;
 if k='generate:1' then
  image_receipt:=proof->'imageReceipt';perform private.r04_keys(image_receipt,array['apiType','createdAt','totalCostMicrousd','mediaCompletions','mediaPrompts']);
  created_time:=(image_receipt->>'createdAt')::timestamptz;
  if image_receipt->>'apiType' is distinct from 'image' or jsonb_typeof(image_receipt->'createdAt') is distinct from 'string'
   or isfinite(created_time) is not true or isfinite((candidate->>'receivedAt')::timestamptz) is not true
   or created_time<(candidate->>'receivedAt')::timestamptz-interval '30 minutes' or created_time>(candidate->>'receivedAt')::timestamptz+interval '60 seconds'
   or jsonb_typeof(image_receipt->'totalCostMicrousd') is distinct from 'number' or jsonb_typeof(candidate->'reportedMicrousd') is distinct from 'number'
   or image_receipt->'totalCostMicrousd' is distinct from candidate->'reportedMicrousd'
   or not coalesce(image_receipt->'mediaCompletions' in ('null'::jsonb,'1'::jsonb),false)
   or not coalesce(image_receipt->'mediaPrompts' in ('null'::jsonb,'0'::jsonb),false) then raise exception 'r12_creative_image_receipt_unverified';end if;
  select sent.created_at into sent_time from private.r12_focused_creative_sends sent join private.r12_focused_creative_candidates saved on saved.creative_run_id=sent.creative_run_id and saved.call_key=sent.call_key
   where saved.candidate_hash=private.stage14_hash(candidate) and saved.call_key='generate:1';
  if sent_time is not null and created_time<sent_time-interval '60 seconds' then raise exception 'r12_creative_image_receipt_precedes_send';end if;
 end if;
 for r in select value from jsonb_array_elements(proof->'providerResponses') loop
 perform private.r04_keys(r,array['providerName','modelId','status']);
 if r->>'providerName' is distinct from provider or not coalesce(models ? (r->>'modelId'),false) or r->'status' is distinct from '200'::jsonb then raise exception 'r12_creative_route_unverified';end if;end loop;
end $$;

create function private.r12_focused_creative_receipt(q private.r12_focused_creative_scopes,k text)
returns jsonb language plpgsql set search_path='' as $$
declare c private.r12_focused_creative_candidates;latest private.r12_focused_creative_checks;o private.r12_focused_creative_receipts;
 attempts integer:=0;expires timestamptz:=(q.scope->>'receiptUntil')::timestamptz;next_at timestamptz;status text;begin
 select * into c from private.r12_focused_creative_candidates where creative_run_id=q.creative_run_id and call_key=k;
 select count(*)::integer into attempts from private.r12_focused_creative_checks where creative_run_id=q.creative_run_id and call_key=k;
 select * into latest from private.r12_focused_creative_checks where creative_run_id=q.creative_run_id and call_key=k order by ordinal desc limit 1;
 select * into o from private.r12_focused_creative_receipts where check_id=latest.id;
 begin perform private.r12_focused_creative_scope_check(q,true);exception when others then status:='stopped';end;
 if status is null then
 if clock_timestamp()>=expires then status:='expired';
 elsif c.creative_run_id is null then status:='unknown';
 elsif exists(select 1 from private.r12_focused_creative_receipts observed join private.r12_focused_creative_checks checked on checked.id=observed.check_id where checked.creative_run_id=q.creative_run_id and checked.call_key=k and observed.proof is not null) then status:='verified';
 elsif o.diagnostic->>'code' in ('receipt_invalid','receipt_terminal') then status:='terminal';
 elsif latest.id is not null and o.check_id is null and latest.created_at+interval '120 seconds'>clock_timestamp() then status:='checking_receipt';next_at:=latest.created_at+interval '120 seconds';
 elsif attempts>=3 then status:='exhausted';
 else status:='awaiting_receipt';next_at:=greatest(coalesce(latest.created_at+interval '120 seconds',clock_timestamp()),coalesce(o.retry_after_at,clock_timestamp()));end if;
 end if;
 return jsonb_build_object('status',status,'attempts',attempts,'nextCheckAt',case when next_at is null then null else to_jsonb(next_at) end,'receiptExpiresAt',expires);
end $$;

create function private.r12_focused_creative_operation(r public.creative_runs,a public.creative_approvals,w public.workflow_runs,operation text,payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
#variable_conflict use_variable
declare q private.r12_focused_creative_scopes;k text:=payload->>'callKey';v jsonb;h text;binding private.r12_focused_creative_wires;
 sent private.r12_focused_creative_sends;c private.r12_focused_creative_candidates;observation private.r12_focused_creative_observations;
 checked private.r12_focused_creative_checks;observed private.r12_focused_creative_receipts;request private.r05_requests;settlement public.creative_cost_settlements;
 state jsonb;proof jsonb;models jsonb;at_time timestamptz;begin
 select * into q from private.r12_focused_creative_scopes where creative_run_id=r.id and business_id=r.business_id and workflow_run_id=w.id and approval_id=a.id;
 if q.creative_run_id is null then raise exception 'r12_creative_scope_required';end if;
 if operation='r12_launch_claim' then
  perform private.r04_keys(payload,array[]::text[]);
  perform private.r12_focused_creative_scope_check(q,true);
  if r.capability_expires_at<=clock_timestamp() or clock_timestamp()<(q.scope->>'startsAt')::timestamptz
   or clock_timestamp()>=(q.scope->>'expiresAt')::timestamptz then raise exception 'r12_creative_dispatch_closed';end if;
  if exists(select 1 from public.events where id=private.stage4_deterministic_uuid('r12:focused-creative-launch:'||r.id)) then
   return jsonb_build_object('shouldStart',false,'creativeRunId',r.id,'workflowRunId',w.id,'launchNonce',w.runtime_launch_nonce);end if;
  if w.status<>'queued' or w.runtime_launch_status is distinct from 'reserved' or w.runtime_run_id is not null
   or w.current_stage_key is distinct from 'brief:1' or w.runtime_launch_nonce is null
   or exists(select 1 from public.creative_cost_reservations where creative_run_id=r.id)
   or exists(select 1 from private.r05_requests where workflow_run_id=w.id) then raise exception 'r12_creative_fresh_launch_required';end if;
  insert into public.events(id,business_id,workflow_run_id,event_type,actor_type,actor_id,payload)
   values(private.stage4_deterministic_uuid('r12:focused-creative-launch:'||r.id),r.business_id,w.id,'r12.focused.creative.launch_claimed','system',a.owner_user_id::text,
    jsonb_build_object('creativeRunId',r.id,'approvalId',a.id,'approvalHash',a.approval_hash,'scopeHash',q.scope_hash,'policyId',q.policy_id));
  return jsonb_build_object('shouldStart',true,'creativeRunId',r.id,'workflowRunId',w.id,'launchNonce',w.runtime_launch_nonce);
 end if;
 if coalesce(k,'') not in ('brief:1','screen:1','generate:1','review:1') then raise exception 'r12_creative_scope_required';end if;
 select * into binding from private.r12_focused_creative_wires where creative_run_id=r.id and call_key=k;
 select * into sent from private.r12_focused_creative_sends where creative_run_id=r.id and call_key=k;
 select * into c from private.r12_focused_creative_candidates where creative_run_id=r.id and call_key=k;
 select * into observation from private.r12_focused_creative_observations where creative_run_id=r.id and call_key=k;
 if operation='r12_load' then
 perform private.r04_keys(payload,array['callKey']);
 state:=private.r12_focused_creative_receipt(q,k);
 select result.proof into proof from private.r12_focused_creative_checks check_row join private.r12_focused_creative_receipts result on result.check_id=check_row.id where check_row.creative_run_id=r.id and check_row.call_key=k and result.proof is not null;
 return jsonb_build_object('scope',q.scope,'phase',jsonb_build_object('binding',binding.binding,'candidate',c.candidate,'proof',proof,'receipt',state),'dispatchedAt',sent.created_at);
 end if;
 perform private.r12_focused_creative_scope_check(q,true);
 if clock_timestamp()>=(q.scope->>'receiptUntil')::timestamptz then raise exception 'r12_creative_receipt_expired';end if;
 if operation in ('r12_bind','r12_send') then
 if w.status<>'running' or w.current_stage_key is distinct from k or clock_timestamp()<(q.scope->>'startsAt')::timestamptz or clock_timestamp()>=(q.scope->>'expiresAt')::timestamptz then raise exception 'r12_creative_dispatch_closed';end if;
 end if;
 if operation='r12_bind' then
 perform private.r04_keys(payload,array['callKey','binding','bindingHash']);v:=payload->'binding';h:=payload->>'bindingHash';
 if h is distinct from private.stage14_hash(v) then raise exception 'r12_creative_binding_hash';end if;
 if binding.creative_run_id is not null then
 if binding.binding is distinct from v or binding.binding_hash is distinct from h then raise exception 'r12_creative_binding_conflict';end if;
 return jsonb_build_object('bound',true,'replayed',true,'shouldDispatch',false);end if;
 if sent.creative_run_id is not null then raise exception 'r12_creative_already_sent';end if;
 perform private.r12_focused_creative_wire_check(q,k,v);
 insert into private.r12_focused_creative_wires(creative_run_id,business_id,call_key,binding,binding_hash) values(r.id,r.business_id,k,v,h);
 return jsonb_build_object('bound',true,'replayed',false,'shouldDispatch',false);
 elsif operation='r12_send' then
 perform private.r04_keys(payload,array['callKey','bindingHash','requestId']);
 if sent.creative_run_id is not null then return jsonb_build_object('shouldDispatch',false,'reason','already_sent');end if;
 if binding.creative_run_id is null or binding.binding_hash is distinct from payload->>'bindingHash' then raise exception 'r12_creative_binding_required';end if;
 select * into request from private.r05_requests where id=(payload->>'requestId')::uuid and business_id=r.business_id and workflow_run_id=w.id and policy_id=q.policy_id;
 if request.id is null or request.payload is distinct from binding.binding->'descriptor' or request.source_key is distinct from 'creative:'||r.id||':'||k
 or not exists(select 1 from private.r05_markers where request_id=request.id and business_id=r.business_id and created_at<(q.scope->>'expiresAt')::timestamptz)
 or exists(select 1 from private.r05_releases where request_id=request.id) then raise exception 'r12_creative_exact_marker_required';end if;
 perform private.r12_focused_creative_wire_check(q,k,binding.binding);
 insert into private.r12_focused_creative_sends(creative_run_id,business_id,call_key,request_id,binding_hash) values(r.id,r.business_id,k,request.id,binding.binding_hash);
 return jsonb_build_object('shouldDispatch',true);
 elsif operation='r12_observe' then
 perform private.r04_keys(payload,array['callKey','observation','observationHash']);v:=payload->'observation';h:=payload->>'observationHash';
 if sent.creative_run_id is null or h is distinct from private.stage14_hash(v) or octet_length(v::text)>65536 then raise exception 'r12_creative_observation_invalid';end if;
 perform private.r12_pilot_safe(v);
 if k='generate:1' then
 perform private.r04_keys(v,array['version','receivedAt','receipt','storagePath','sourceSha256','sourceBytes']);
 if v->>'version' is distinct from 'r12.focused-creative-image-observation.1' or v->>'storagePath' is distinct from r.business_id::text||'/'||r.id||'/version-1.png'
 or not coalesce(v->>'sourceSha256' ~ '^[a-f0-9]{64}$',false) or (v->>'sourceBytes')::bigint not between 33 and 3700000 then raise exception 'r12_creative_image_observation_invalid';end if;
 else perform private.r04_keys(v,array['version','receivedAt','response']);
 if v->>'version' is distinct from 'r12.focused-creative-observation.1' or jsonb_typeof(v->'response') is distinct from 'object' then raise exception 'r12_creative_observation_invalid';end if;end if;
 at_time:=(v->>'receivedAt')::timestamptz;
 if jsonb_typeof(v->'receivedAt') is distinct from 'string' or isfinite(at_time) is not true or at_time<sent.created_at or at_time>clock_timestamp()+interval '5 minutes' or at_time>=(q.scope->>'receiptUntil')::timestamptz then raise exception 'r12_creative_observation_time';end if;
 if observation.creative_run_id is not null then
 if observation.observation is distinct from v or observation.observation_hash is distinct from h then raise exception 'r12_creative_observation_conflict';end if;
 return jsonb_build_object('saved',true,'replayed',true);end if;
 insert into private.r12_focused_creative_observations(creative_run_id,business_id,call_key,observation,observation_hash) values(r.id,r.business_id,k,v,h);
 return jsonb_build_object('saved',true,'replayed',false);
 elsif operation='r12_stage' then
 perform private.r04_keys(payload,array['callKey','candidate','candidateHash']);v:=payload->'candidate';h:=payload->>'candidateHash';
 perform private.r12_pilot_safe(v);perform private.r04_keys(v,array['version','scopeHash','callKey','bindingHash','generationId','modelId','receivedAt','reportedMicrousd','output','outputHash']);
 models:=case k when 'brief:1' then '["openai/gpt-5.6-luna","openai/gpt-5.6-luna-20260709"]'::jsonb when 'generate:1' then '["black-forest-labs/flux.2-klein-4b"]'::jsonb else '["anthropic/claude-haiku-4.5","anthropic/claude-4.5-haiku-20251001"]'::jsonb end;
 if binding.creative_run_id is null or sent.creative_run_id is null or v->>'version' is distinct from 'r12.focused-creative-candidate.1'
 or v->>'scopeHash' is distinct from q.scope_hash or v->>'callKey' is distinct from k or v->>'bindingHash' is distinct from binding.binding_hash
 or h is distinct from private.stage14_hash(v) or v->>'outputHash' is distinct from private.stage14_hash(v->'output') or jsonb_typeof(v->'output') is distinct from 'object'
 or (v->>'generationId' !~ '^gen-[A-Za-z0-9_-]+$' or length(v->>'generationId') not between 5 and 300) or not coalesce(models ? (v->>'modelId'),false)
 or (v->'reportedMicrousd' is distinct from 'null'::jsonb and (jsonb_typeof(v->'reportedMicrousd') is distinct from 'number' or v->>'reportedMicrousd' !~ '^(0|[1-9][0-9]{0,6})$' or (v->>'reportedMicrousd')::bigint>(q.scope->'phaseCeilings'->>k)::bigint))
 then raise exception 'r12_creative_candidate_invalid';end if;
 at_time:=(v->>'receivedAt')::timestamptz;
 if jsonb_typeof(v->'receivedAt') is distinct from 'string' or isfinite(at_time) is not true or at_time<sent.created_at or at_time>clock_timestamp()+interval '5 minutes' or at_time>=(q.scope->>'receiptUntil')::timestamptz then raise exception 'r12_creative_candidate_time';end if;
 if k='generate:1' then
 if v->'output'->>'mediaType' is distinct from 'image/png' or v->'output'->>'storagePath' is distinct from r.business_id::text||'/'||r.id||'/version-1.png'
 or not coalesce(v->'output'->>'sourceSha256' ~ '^[a-f0-9]{64}$',false) or (v->'output'->>'sourceBytes')::bigint not between 33 and 3700000
 or v->'output'->'receipt'->>'generationId' is distinct from v->>'generationId'
 or v->'output'->>'prompt' is distinct from binding.binding->'request'->>'prompt'
 or not exists(select 1 from storage.objects where bucket_id='creative-assets' and name=v->'output'->>'storagePath' and metadata->>'mimetype'='image/png' and (metadata->>'size')::bigint=(v->'output'->>'sourceBytes')::bigint)
 then raise exception 'r12_creative_original_png_candidate_required';end if;
 else
 if observation.creative_run_id is null or observation.observation->'response'->>'id' is distinct from v->>'generationId'
 or observation.observation->'response'->>'model' is distinct from v->>'modelId'
 or observation.observation->'response'->'choices'->0->>'finish_reason' is distinct from 'stop'
 or (observation.observation->'response'->'choices'->0->'message'->>'content')::jsonb is distinct from v->'output'
 then raise exception 'r12_creative_candidate_observation_required';end if;end if;
 if c.creative_run_id is not null then
 if c.candidate is distinct from v or c.candidate_hash is distinct from h then raise exception 'r12_creative_candidate_conflict';end if;
 return jsonb_build_object('saved',true,'replayed',true);end if;
 insert into private.r12_focused_creative_candidates(creative_run_id,business_id,call_key,generation_id,candidate,candidate_hash) values(r.id,r.business_id,k,v->>'generationId',v,h);
 return jsonb_build_object('saved',true,'replayed',false);
 elsif operation='r12_claim' then
 perform private.r04_keys(payload,array['callKey','candidateHash']);
 if c.creative_run_id is null or c.candidate_hash is distinct from payload->>'candidateHash' then raise exception 'r12_creative_candidate_required';end if;
 select * into settlement from public.creative_cost_settlements where creative_run_id=r.id and business_id=r.business_id and call_key=k;
 if settlement.creative_run_id is null or settlement.provider_request_id is distinct from c.generation_id or settlement.reported_microusd is null
 or settlement.reported_microusd is distinct from (c.candidate->>'reportedMicrousd')::bigint then return jsonb_build_object('claimed',false,'receipt',jsonb_build_object('status','unknown','attempts',0,'nextCheckAt',null,'receiptExpiresAt',q.scope->'receiptUntil'));end if;
 state:=private.r12_focused_creative_receipt(q,k);
 if state->>'status' is distinct from 'awaiting_receipt' or (state->>'nextCheckAt')::timestamptz>clock_timestamp() then return jsonb_build_object('claimed',false,'receipt',state);end if;
 insert into private.r12_focused_creative_checks(creative_run_id,business_id,call_key,ordinal,candidate_hash) values(r.id,r.business_id,k,(state->>'attempts')::integer+1,c.candidate_hash) returning * into checked;
 return jsonb_build_object('claimed',true,'claimId',checked.id,'receipt',private.r12_focused_creative_receipt(q,k));
 elsif operation='r12_record' then
 perform private.r04_keys(payload,array['callKey','candidateHash','claimId','proof','diagnostic','retryAfterAt']);
 select * into checked from private.r12_focused_creative_checks where id=(payload->>'claimId')::uuid and creative_run_id=r.id and call_key=k and candidate_hash=payload->>'candidateHash';
 if checked.id is null or c.candidate_hash is distinct from checked.candidate_hash then raise exception 'r12_creative_receipt_claim_required';end if;
 select * into observed from private.r12_focused_creative_receipts where check_id=checked.id;
 v:=nullif(payload->'proof','null'::jsonb);state:=nullif(payload->'diagnostic','null'::jsonb);
 if (v is null)=(state is null) then raise exception 'r12_creative_receipt_shape';end if;
 if v is not null then perform private.r12_focused_creative_proof_check(v,c.candidate);
 if payload->'retryAfterAt' is distinct from 'null'::jsonb then raise exception 'r12_creative_receipt_shape';end if;
 else
 perform private.r04_keys(state,array['code','httpStatus']);
 if not coalesce(state->>'code' in ('receipt_pending','receipt_terminal','receipt_invalid','receipt_transport'),false)
 or (state->'httpStatus' is distinct from 'null'::jsonb and (jsonb_typeof(state->'httpStatus') is distinct from 'number' or state->>'httpStatus' !~ '^[1-5][0-9]{2}$')) then raise exception 'r12_creative_receipt_diagnostic';end if;
 end if;
 at_time:=(payload->>'retryAfterAt')::timestamptz;
 if at_time is not null and (not isfinite(at_time) or at_time<checked.created_at+interval '120 seconds') then raise exception 'r12_creative_receipt_retry_after';end if;
 if state->>'code' in ('receipt_pending','receipt_transport') and at_time is null then raise exception 'r12_creative_receipt_retry_after';end if;
 if observed.check_id is not null then
 if observed.proof is distinct from v or observed.diagnostic is distinct from state or observed.retry_after_at is distinct from at_time then raise exception 'r12_creative_receipt_conflict';end if;
 return jsonb_build_object('recorded',true,'replayed',true);end if;
 insert into private.r12_focused_creative_receipts(check_id,proof,diagnostic,retry_after_at) values(checked.id,v,state,at_time);
 return jsonb_build_object('recorded',true,'replayed',false,'receipt',private.r12_focused_creative_receipt(q,k));
 end if;
 raise exception 'r12_creative_operation_unknown';
end $$;

create function private.r12_focused_creative_persist_guard(r public.creative_runs,a public.creative_approvals,payload jsonb)
returns void language plpgsql set search_path='' as $$
declare q private.r12_focused_creative_scopes;k text:=payload->>'callKey';c private.r12_focused_creative_candidates;proof jsonb;output jsonb:=payload->'output';settled public.creative_cost_settlements;begin
 perform private.r04_keys(payload,array['callKey','candidateHash','proofHash','output']);
 select * into q from private.r12_focused_creative_scopes where creative_run_id=r.id and business_id=r.business_id;
 if q.creative_run_id is null then raise exception 'r12_creative_scope_required';end if;
 perform private.r12_focused_creative_scope_check(q,true);
 if private.r12_focused_creative_receipt(q,k)->>'status' is distinct from 'verified' then raise exception 'r12_creative_qualified_receipt_required';end if;
 select * into c from private.r12_focused_creative_candidates where creative_run_id=r.id and call_key=k and candidate_hash=payload->>'candidateHash';
 select observed.proof into proof from private.r12_focused_creative_checks checked join private.r12_focused_creative_receipts observed on observed.check_id=checked.id where checked.creative_run_id=r.id and checked.call_key=k and checked.candidate_hash=c.candidate_hash and observed.proof->>'proofHash'=payload->>'proofHash';
 select * into settled from public.creative_cost_settlements where creative_run_id=r.id and business_id=r.business_id and call_key=k;
 if c.creative_run_id is null or proof is null or settled.creative_run_id is null or settled.reported_microusd is null
 or settled.reported_microusd is distinct from (c.candidate->>'reportedMicrousd')::bigint or settled.provider_request_id is distinct from c.generation_id
 or settled.receipt->'evidence' is distinct from c.candidate
 then raise exception 'r12_creative_qualified_receipt_required';end if;
 perform private.r12_focused_creative_proof_check(proof,c.candidate);
 if k='generate:1' then
 if output->>'storagePath' is distinct from c.candidate->'output'->>'storagePath' or output->>'prompt' is distinct from c.candidate->'output'->>'prompt'
 or output->'inspection'->>'sha256' is distinct from c.candidate->'output'->>'sourceSha256'
 or output->'inspection'->'bytes' is distinct from c.candidate->'output'->'sourceBytes'
 or output->'inspection'->'width' is distinct from '1024'::jsonb or output->'inspection'->'height' is distinct from '1024'::jsonb
 or output->'generatedAt' is distinct from c.candidate->'receivedAt'
 or output->>'model' is distinct from 'black-forest-labs/flux.2-klein-4b' or output->>'provider' is distinct from 'openrouter'
 then raise exception 'r12_creative_original_png_changed';end if;
 else
 if output is distinct from c.candidate->'output' then raise exception 'r12_creative_candidate_output_changed';end if;
 end if;
end $$;

create function private.r12_focused_creative_reserve_guard(r public.creative_runs,a public.creative_approvals,payload jsonb)
returns void language plpgsql set search_path='' as $$
declare q private.r12_focused_creative_scopes;k text:=payload->>'callKey';begin
 select * into q from private.r12_focused_creative_scopes where creative_run_id=r.id and business_id=r.business_id and approval_id=a.id;
 if q.creative_run_id is null or k not in('brief:1','screen:1','generate:1','review:1') then raise exception 'r12_creative_scope_required';end if;
 perform private.r12_focused_creative_scope_check(q,true);
 if clock_timestamp()<(q.scope->>'startsAt')::timestamptz or clock_timestamp()>=(q.scope->>'expiresAt')::timestamptz
 or payload->'reservedMicrousd' is distinct from q.scope->'phaseCeilings'->k
 or payload->'estimate' is distinct from jsonb_build_object('version','r12.focused-creative-ceiling.1','quoteHash',q.scope->>'quoteHash','fixedCeiling',true)
 then raise exception 'r12_creative_fixed_reservation_required';end if;
end $$;

create function private.r12_focused_creative_admission_key(b uuid,operation text,payload jsonb,key_hash text)
returns void language plpgsql set search_path='' as $$
declare q private.r12_focused_creative_scopes;k text;binding private.r12_focused_creative_wires;begin
 select * into q from private.r12_focused_creative_scopes where admission_key_hash=key_hash;
 if q.creative_run_id is null then
 if coalesce(payload->>'operationKey','') like 'creative.r12.%'
 or (payload->>'kind'='creative' and exists(select 1 from private.r12_focused_creative_scopes where creative_run_id=(payload->>'runId')::uuid)) then raise exception 'r12_creative_scoped_admission_key_required';end if;
 return;end if;
 if q.business_id<>b or clock_timestamp()>=(q.scope->>'receiptUntil')::timestamptz then raise exception 'r12_creative_scoped_admission_key_required';end if;
 if operation='legacy_settle' then
 k:=payload->>'callKey';
 if payload->>'kind' is distinct from 'creative' or payload->>'runId' is distinct from q.creative_run_id::text or payload->>'workflowRunId' is distinct from q.workflow_run_id::text

 then raise exception 'r12_creative_exact_financial_source_required';end if;
 if not exists(select 1 from private.r12_focused_creative_sends where creative_run_id=q.creative_run_id and business_id=b and call_key=k) then
  select * into binding from private.r12_focused_creative_wires where creative_run_id=q.creative_run_id and business_id=b and call_key=k;
  if binding.creative_run_id is null or payload->'reportedMicrousd' is distinct from '0'::jsonb or payload->'providerRequestId' is distinct from 'null'::jsonb
   or payload->'receipt'->'evidence' is distinct from jsonb_build_object('failure','focused_dispatch_denied','transportAuthorized',false,'bindingHash',binding.binding_hash)
   or payload->'receipt'->'outputValidated' is distinct from 'false'::jsonb
   or not exists(select 1 from public.creative_cost_reservations reserved where reserved.creative_run_id=q.creative_run_id and reserved.business_id=b and reserved.call_key=k and reserved.request_hash=binding.binding->>'requestHash')
   or exists(select 1 from private.r12_focused_creative_candidates where creative_run_id=q.creative_run_id and call_key=k)
   or exists(select 1 from private.r12_focused_creative_observations where creative_run_id=q.creative_run_id and call_key=k)
  then raise exception 'r12_creative_exact_financial_source_required';end if;
 end if;
 -- Existing R05 financial reconciliation/capability checks still run, even if
 -- an owner stopped new work after the provider accepted its one request.
 return;
 elsif operation not in ('prepare','guard') then raise exception 'r12_creative_exact_admission_operation';end if;
 k:=payload->'accounting'->>'callKey';
 perform private.r12_focused_creative_scope_check(q,true);
 if clock_timestamp()<(q.scope->>'startsAt')::timestamptz or clock_timestamp()>=(q.scope->>'expiresAt')::timestamptz
 or payload->>'workflowRunId' is distinct from q.workflow_run_id::text or payload->'accounting' is distinct from jsonb_build_object('kind','creative','runId',q.creative_run_id,'callKey',k)
 then raise exception 'r12_creative_exact_admission_scope';end if;
 select * into binding from private.r12_focused_creative_wires where creative_run_id=q.creative_run_id and call_key=k;
 if binding.creative_run_id is null or payload-'runtimeCapability' is distinct from binding.binding->'descriptor' then raise exception 'r12_creative_exact_bound_descriptor';end if;
end $$;

create function private.r12_focused_creative_request_check(r private.r05_requests) returns void language plpgsql set search_path='' as $$
declare q private.r12_focused_creative_scopes;binding private.r12_focused_creative_wires;begin
 if r.payload->>'operationKey' not like 'creative.r12.%' then return;end if;
 select * into q from private.r12_focused_creative_scopes where creative_run_id=(r.payload->'accounting'->>'runId')::uuid and business_id=r.business_id and workflow_run_id=r.workflow_run_id;
 if q.creative_run_id is null or r.policy_id is distinct from q.policy_id or r.payload->'accounting'->>'kind' is distinct from 'creative' then raise exception 'r12_creative_exact_policy_required';end if;
 perform private.r12_focused_creative_scope_check(q,true);
 if clock_timestamp()>=(q.scope->>'expiresAt')::timestamptz then raise exception 'r12_creative_dispatch_closed';end if;
 select * into binding from private.r12_focused_creative_wires where creative_run_id=q.creative_run_id and call_key=r.payload->'accounting'->>'callKey';
 if binding.creative_run_id is null or r.payload is distinct from binding.binding->'descriptor' then raise exception 'r12_creative_exact_bound_descriptor';end if;
end $$;
create function private.r12_focused_creative_request_guard() returns trigger language plpgsql set search_path='' as $$
declare r private.r05_requests;begin
 select * into strict r from private.r05_requests where id=new.request_id and business_id=new.business_id;
 perform private.r12_focused_creative_request_check(r);return new;
end $$;
create trigger r12_focused_creative_request_guard before insert on private.r05_reservations for each row execute function private.r12_focused_creative_request_guard();
create trigger r12_focused_creative_request_guard before insert on private.r05_markers for each row execute function private.r12_focused_creative_request_guard();


alter table private.r05_operations drop constraint r05_operations_operation_key_r12_check;
alter table private.r05_operations add constraint r05_operations_operation_key_r12_creative_check check (
 operation_key in ('research.search','research.model','creative.text','creative.image','listing.specialist','listing.reviewer','listing.qualification','browser.planner')
 or operation_key ~ '^research\.(search|model)\.r11v2\.[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
 or operation_key ~ '^research\.r12\.[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(plan|search1|select1|strategy|review)$'
 or operation_key ~ '^creative\.r12\.[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(brief|screen|generate|review)$');
alter table private.r05_operations drop constraint r05_operations_maximum_output_tokens_check;
alter table private.r05_operations add constraint r05_operations_maximum_output_tokens_check check (
 maximum_output_tokens between 1 and 1000000 or (operation_key ~ '^creative\.r12\.[a-f0-9-]{36}\.generate$' and maximum_output_tokens=0));
alter table private.r05_operations drop constraint r05_operations_maximum_request_bytes_check;
alter table private.r05_operations add constraint r05_operations_maximum_request_bytes_check check (
 maximum_request_bytes between 1 and 1048576 or (operation_key ~ '^creative\.r12\.[a-f0-9-]{36}\.review$' and maximum_request_bytes between 1048577 and 5000000));


-- Exact released-function anchor 1: public.creative_runtime_transition(uuid,uuid,text,text,jsonb)
do $creative_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.creative_runtime_transition(uuid,uuid,text,text,jsonb)'::regprocedure);
 old:=$old$length(p_payload::text)>150000$old$;replacement:=$new$octet_length(p_payload::text)>(case when p_operation='r12_bind' then 10500000 else 150000 end)$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_creative_definition_drift_1';end if;
 execute replace(definition,old,replacement);
end $creative_patch$;


-- Exact released-function anchor 2: public.creative_runtime_transition(uuid,uuid,text,text,jsonb)
do $creative_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.creative_runtime_transition(uuid,uuid,text,text,jsonb)'::regprocedure);
 old:=$old$  select cr.* into r from public.creative_runs cr join private.creative_run_capabilities secret on secret.creative_run_id=cr.id$old$;replacement:=$new$  -- Match the already-present capability before taking the shared Business
  -- lock, then preserve Business -> creative run -> workflow lock order.
  perform 1 from public.businesses b where b.id=p_business_id and exists(
    select 1 from public.creative_runs cr join private.creative_run_capabilities cap on cap.creative_run_id=cr.id
    join private.r12_focused_creative_scopes scoped on scoped.creative_run_id=cr.id
    where cr.id=p_creative_run_id and cr.business_id=b.id and cap.capability_hash=private.stage13_hash(p_runtime_capability)) for update;
  select cr.* into r from public.creative_runs cr join private.creative_run_capabilities secret on secret.creative_run_id=cr.id$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_creative_definition_drift_2';end if;
 execute replace(definition,old,replacement);
end $creative_patch$;


-- Exact released-function anchor 3: public.creative_runtime_transition(uuid,uuid,text,text,jsonb)
do $creative_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.creative_runtime_transition(uuid,uuid,text,text,jsonb)'::regprocedure);
 old:=$old$  -- Time-limited capability cannot be refreshed by replaying begin. Owner must approve a new run.$old$;replacement:=$new$  if a.snapshot ? 'focusedPilotBinding' then
    if p_operation='persist_phase' then raise exception 'r12_creative_qualified_persist_required';end if;
    if p_operation='r12_persist' then
      perform private.r12_focused_creative_persist_guard(r,a,p_payload);
      p_payload:=jsonb_build_object('callKey',p_payload->>'callKey','output',p_payload->'output');p_operation:='persist_phase';
    elsif p_operation like 'r12\_%' escape '\' then
      return private.r12_focused_creative_operation(r,a,w,p_operation,p_payload);
    elsif p_operation='load' then
      if not exists(select 1 from public.events e where e.id=private.stage4_deterministic_uuid('r12:focused-creative-launch:'||r.id)
       and e.business_id=r.business_id and e.workflow_run_id=w.id and e.event_type='r12.focused.creative.launch_claimed'
       and e.payload->>'approvalHash'=a.approval_hash) then raise exception 'r12_creative_launch_claim_required';end if;
    elsif p_operation='reserve_call' then perform private.r12_focused_creative_reserve_guard(r,a,p_payload);
    elsif p_operation='record_call' and not exists(select 1 from private.r05_legacy_attestations att
      where att.business_id=r.business_id and att.workflow_run_id=w.id and att.source_key='creative:'||r.id||':'||(p_payload->>'callKey')
      and att.provider_request_id is not distinct from p_payload->>'providerRequestId' and att.reported_microusd is not distinct from (p_payload->>'reportedMicrousd')::bigint) then
      raise exception 'r12_creative_trusted_financial_receipt_required';end if;
  elsif p_operation like 'r12\_%' escape '\' then raise exception 'r12_creative_adopted_approval_required';end if;
  -- Time-limited capability cannot be refreshed by replaying begin. Owner must approve a new run.$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_creative_definition_drift_3';end if;
 execute replace(definition,old,replacement);
end $creative_patch$;


-- Exact released-function anchor 4: public.creative_runtime_transition(uuid,uuid,text,text,jsonb)
do $creative_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.creative_runtime_transition(uuid,uuid,text,text,jsonb)'::regprocedure);
 old:=$old$    if a.purpose<>'simulation' then
      if price_quote$old$;replacement:=$new$    if a.snapshot ? 'focusedPilotBinding' then
      perform private.r12_focused_creative_reserve_guard(r,a,p_payload);
    elsif a.purpose<>'simulation' then
      if price_quote$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_creative_definition_drift_4';end if;
 execute replace(definition,old,replacement);
end $creative_patch$;


-- Exact released-function anchor 5: public.creative_runtime_transition(uuid,uuid,text,text,jsonb)
do $creative_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.creative_runtime_transition(uuid,uuid,text,text,jsonb)'::regprocedure);
 old:=$old$provenance is distinct from settled.receipt->'provenance'$old$;replacement:=$new$(not(a.snapshot ? 'focusedPilotBinding') and provenance is distinct from settled.receipt->'provenance')$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_creative_definition_drift_5';end if;
 execute replace(definition,old,replacement);
end $creative_patch$;


-- Exact released-function anchor 6: public.creative_runtime_transition(uuid,uuid,text,text,jsonb)
do $creative_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.creative_runtime_transition(uuid,uuid,text,text,jsonb)'::regprocedure);
 old:=$old$settled.receipt->'outputValidated' is distinct from 'true'::jsonb or$old$;replacement:=$new$(settled.receipt->'outputValidated' is distinct from 'true'::jsonb and not(a.snapshot ? 'focusedPilotBinding' and phase='generate')) or$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_creative_definition_drift_6';end if;
 execute replace(definition,old,replacement);
end $creative_patch$;


-- Exact released-function anchor 7: public.creative_runtime_transition(uuid,uuid,text,text,jsonb)
do $creative_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.creative_runtime_transition(uuid,uuid,text,text,jsonb)'::regprocedure);
 old:=$old$when receipt->'outputValidated'='true'::jsonb then 'succeeded' else 'failed' end)$old$;replacement:=$new$when receipt->'outputValidated'='true'::jsonb then 'succeeded' when a.snapshot ? 'focusedPilotBinding' and phase='generate' then 'uncertain' else 'failed' end)$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_creative_definition_drift_7';end if;
 execute replace(definition,old,replacement);
end $creative_patch$;


-- Exact released-function anchor 8: public.r05_admission_server(uuid,text,jsonb,text)
do $creative_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.r05_admission_server(uuid,text,jsonb,text)'::regprocedure);
 old:=$old$ perform private.r12_admission_key_scope(p_business_id,p_operation,p_payload,encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex'));$old$;replacement:=$new$ perform private.r12_focused_creative_admission_key(p_business_id,p_operation,p_payload,encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex'));
 perform private.r12_admission_key_scope(p_business_id,p_operation,p_payload,encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex'));$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_creative_definition_drift_8';end if;
 execute replace(definition,old,replacement);
end $creative_patch$;


-- Exact released-function anchor 9: public.r05_admission_server(uuid,text,jsonb,text)
do $creative_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.r05_admission_server(uuid,text,jsonb,text)'::regprocedure);
 old:=$old$array['workflowRunId','runtimeCapability','operationKey','requestHash','idempotencyKey','providerModelId','wireRequestHash','wireRequestBytes','maximumOutputTokens','accounting','sourceDomains','dataClasses','accountId','accountRevision','currency','liabilityMicrounits']);$old$;replacement:=$new$array['workflowRunId','runtimeCapability','operationKey','requestHash','idempotencyKey','providerModelId','wireRequestHash','wireRequestBytes','maximumOutputTokens','accounting','sourceDomains','dataClasses','accountId','accountRevision','currency','liabilityMicrounits']||case when p_payload->>'operationKey' ~ '^creative\.r12\.[a-f0-9-]{36}\.generate$' then array['maximumOutputImages'] else array[]::text[] end);$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_creative_definition_drift_9';end if;
 execute replace(definition,old,replacement);
end $creative_patch$;


-- Exact released-function anchor 10: public.r05_admission_server(uuid,text,jsonb,text)
do $creative_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.r05_admission_server(uuid,text,jsonb,text)'::regprocedure);
 old:=$old$(saved->>'maximumOutputTokens') !~ '^[1-9][0-9]{0,6}$'$old$;replacement:=$new$(case when saved->>'operationKey' ~ '^creative\.r12\.[a-f0-9-]{36}\.generate$' then saved->'maximumOutputTokens' is distinct from '0'::jsonb or saved->'maximumOutputImages' is distinct from '1'::jsonb else (saved->>'maximumOutputTokens') !~ '^[1-9][0-9]{0,6}$' end)$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_creative_definition_drift_10';end if;
 execute replace(definition,old,replacement);
end $creative_patch$;


-- Exact released-function anchor 11: private.r11_research_key(text)
do $creative_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r11_research_key(text)'::regprocedure);
 old:=$old$ if exists(select 1 from private.r12_discovery_authorities q where h in(q.controller_key_hash,q.admission_key_hash))$old$;replacement:=$new$ if exists(select 1 from private.r12_focused_creative_scopes q where q.admission_key_hash=h) then raise exception 'r12_creative_key_not_r11_authority' using errcode='42501';end if;
 if exists(select 1 from private.r12_discovery_authorities q where h in(q.controller_key_hash,q.admission_key_hash))$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_creative_definition_drift_11';end if;
 execute replace(definition,old,replacement);
end $creative_patch$;


-- Exact released-function anchor 12: private.r11_research_marker()
do $creative_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r11_research_marker()'::regprocedure);
 old:=$old$ select * into o from private.r05_operations where operation_key=r.payload->>'operationKey';$old$;replacement:=$new$ select * into o from private.r05_operations where operation_key=r.payload->>'operationKey';
 if r.payload->>'operationKey' ~ '^creative\.r12\.[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(brief|screen|generate|review)$' then
 perform private.r12_focused_creative_request_check(r);
 if private.r05_admissible(r) is not null then raise exception 'r12_creative_current_financial_gate_required';end if;
 perform private.r12_focused_creative_request_check(r);return new;end if;$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_creative_definition_drift_12';end if;
 execute replace(definition,old,replacement);
end $creative_patch$;


do $private_functions$
declare fn record;begin
 for fn in select p.oid::regprocedure identity from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'r12_focused_creative_%' loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',fn.identity);
 end loop;
end $private_functions$;
commit;
