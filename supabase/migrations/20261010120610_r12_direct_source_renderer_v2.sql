-- Explicit reviewed source renderer .2. An accepted denial is an audit result,
-- never permission to transmit. Owner-only bootstrap cannot enter this lane.
begin;
alter function private.r12_direct_renderer_check(jsonb,jsonb,text) rename to r12_direct_renderer_check_v1;
create function private.r12_direct_source_renderer_classify(p jsonb,r jsonb,query text) returns text
language plpgsql set search_path='' as $$
declare origin text;legacy jsonb;begin
 if p->>'version' is distinct from 'etsy.insights-renderer-policy.2' then raise exception 'r12_direct_renderer_v2_policy_required';end if;
 perform private.r12_direct_renderer_policy_check(p);
 if r='{}'::jsonb then return null;end if;
 origin:=substring(r->>'url' from '^(https://[a-zA-Z0-9.-]+)');
 if r->'navigation'='true'::jsonb or origin='https://www.etsy.com' then
  -- Reuse the exact source navigation/query/private-path checks, including
  -- bounded percent decoding. Owner landing rules are not source rules.
  legacy:=(p-'staticAssets'-'optionalTelemetry'-'provenanceHash')||jsonb_build_object('version','etsy.insights-renderer-policy.1');
  perform private.r12_direct_renderer_check_v1(legacy,r,query);return 'allow';
 end if;
 -- Offsite source resources are exact observed references. Optional telemetry
 -- must already be redacted to origin+pathname before immutable persistence.
 return private.r12_direct_owner_renderer_classify(p,r);
end $$;
create function private.r12_direct_renderer_check(p jsonb,r jsonb,query text) returns void
language plpgsql set search_path='' as $$ begin
 if p->>'version'='etsy.insights-renderer-policy.1' then perform private.r12_direct_renderer_check_v1(p,r,query);
 elsif p->>'version'='etsy.insights-renderer-policy.2' then perform private.r12_direct_source_renderer_classify(p,r,query);
 else raise exception 'r12_direct_renderer_policy_required';end if;
end $$;
create function private.r12_direct_source_renderer_admit_v2(p_scope uuid,payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare s private.r12_direct_research_setups;a private.r12_direct_phase_attempts;q private.r12_direct_source_qualifications;
 old private.r12_direct_source_renderer_qualifications;p jsonb;r jsonb;n integer;disposition text;begin
 perform private.r04_keys(payload,array['attemptId','request']);
 s:=private.r12_direct_research_current(p_scope);
 select * into a from private.r12_direct_phase_attempts where scope_id=p_scope and attempt_id=(payload->>'attemptId')::uuid and phase='source' for update;
 if a.attempt_id is null or (a.source_scope->>'expiresAt')::timestamptz<=clock_timestamp() then raise exception 'r12_direct_actual_source_required';end if;
 select x.* into strict q from private.r12_direct_source_qualifications x join private.r12_direct_test_envelopes e on x.qualification_hash=e.content->'researchPins'->>'executionReviewHash' where e.id=s.envelope_id;
 p:=q.content->'rendererPolicy';perform private.r12_direct_source_renderer_classify(p,'{}'::jsonb,a.source_scope->>'query');
 select * into old from private.r12_direct_source_renderer_qualifications where attempt_id=a.attempt_id;
 r:=payload->'request';perform private.r04_keys(r,array['version','operationId','sourceAttemptId','requestHash','qualificationHash','sequence','url','method','resourceType','navigation','policyHash','provenanceHash','disposition']);
 if old.attempt_id is null or (old.content->>'expiresAt')::timestamptz<=clock_timestamp()
 or old.content->'policy' is distinct from p or old.content->>'policyHash' is distinct from private.stage14_hash(p)
 or r->>'version' is distinct from 'r12.etsy-insights-renderer-request.2'
 or r->>'operationId' is distinct from a.source_scope->>'operationId'
 or r->>'sourceAttemptId' is distinct from a.attempt_id::text
 or r->>'requestHash' is distinct from private.stage14_hash(a.source_scope)
 or r->>'qualificationHash' is distinct from old.qualification_hash
 or r->>'policyHash' is distinct from private.stage14_hash(p)
 or r->>'provenanceHash' is distinct from p->>'provenanceHash'
 or jsonb_typeof(r->'sequence') is distinct from 'number' or coalesce(r->>'sequence','')!~'^[1-9][0-9]{0,2}$'
 or not exists(select 1 from private.r12_direct_source_transport_claims where attempt_id=a.attempt_id)
 or exists(select 1 from private.r12_direct_source_cleanup_proofs where attempt_id=a.attempt_id)
 or not exists(select 1 from private.r07_attempts where id=a.attempt_id and status='dispatched')
 or exists(select 1 from private.r12_direct_phase_receipts where attempt_id=a.attempt_id)
 or exists(select 1 from private.r12_direct_browser_receipts where operation_id=(a.source_scope->>'operationId')::uuid)
 or exists(select 1 from private.r12_direct_browser_evidence where operation_id=(a.source_scope->>'operationId')::uuid and kind='release')
 then raise exception 'r12_direct_renderer_admission_denied';end if;
 n:=(r->>'sequence')::integer;
 if n<>(select count(*)+1 from private.r12_direct_source_renderer_requests where attempt_id=a.attempt_id) or n>(p->>'maximumRequests')::integer then raise exception 'r12_direct_renderer_admission_denied';end if;
 disposition:=private.r12_direct_source_renderer_classify(p,r,a.source_scope->>'query');
 if r->>'disposition' is distinct from disposition then raise exception 'r12_direct_renderer_disposition_mismatch';end if;
 insert into private.r12_direct_source_renderer_requests values(a.attempt_id,n,r,private.stage14_hash(r),clock_timestamp());
 return jsonb_build_object('accepted',true,'allowed',disposition='allow','sequence',n,'disposition',disposition);
end $$;
do $$ declare src text;old text;replacement text;begin
 src:=pg_get_functiondef('private.r12_direct_source_port(uuid,text,jsonb)'::regprocedure);
 old:=$a$if operation='admit_renderer' then$a$;
 replacement:=$a$if operation='admit_renderer' and payload->'request'->>'version'='r12.etsy-insights-renderer-request.2' then return private.r12_direct_source_renderer_admit_v2(p_scope,payload);end if;
 if operation='admit_renderer' then
 if p->>'version' is distinct from 'etsy.insights-renderer-policy.1' then raise exception 'r12_direct_renderer_version_mismatch';end if;
 if not exists(select 1 from private.r07_attempts where id=a.attempt_id and status='dispatched')
 or exists(select 1 from private.r12_direct_phase_receipts where attempt_id=a.attempt_id)
 or exists(select 1 from private.r12_direct_browser_receipts where operation_id=(a.source_scope->>'operationId')::uuid)
 or exists(select 1 from private.r12_direct_browser_evidence where operation_id=(a.source_scope->>'operationId')::uuid and kind='release')
 or exists(select 1 from private.r12_direct_source_cleanup_proofs where attempt_id=a.attempt_id)
 then raise exception 'r12_direct_renderer_admission_denied';end if;$a$;
 if strpos(src,old)=0 then raise exception 'r12_direct_source_renderer_v2_patch_required';end if;
 execute replace(src,old,replacement);
end $$;
revoke all on function private.r12_direct_renderer_check_v1(jsonb,jsonb,text),private.r12_direct_renderer_check(jsonb,jsonb,text),
 private.r12_direct_source_renderer_classify(jsonb,jsonb,text),private.r12_direct_source_renderer_admit_v2(uuid,jsonb)
 from public,anon,authenticated,service_role;
commit;
