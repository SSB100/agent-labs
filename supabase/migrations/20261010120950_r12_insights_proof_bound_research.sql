-- Research policy .4 is a separate reviewed permission. Candidate verification
-- alone never enables a query. No review, grant or live access is enrolled here.
begin;
create table private.r12_proof_bound_source_reviews(
 review_hash text primary key check(review_hash=private.stage14_hash(content)),
 qualification_hash text not null references private.r12_direct_source_qualifications(qualification_hash),
 candidate_review_hash text not null references private.r12_verification_candidate_reviews(review_hash),
 route_hash text not null references private.r12_direct_browser_routes(route_hash),provider_project_id uuid not null,
 policy_hash text not null check(policy_hash=private.stage14_hash(content->'policy')),content jsonb not null,
 valid_from timestamptz not null,valid_until timestamptz not null check(valid_until>valid_from),unique(qualification_hash,candidate_review_hash));
create table private.r12_proof_bound_source_revocations(review_hash text primary key references private.r12_proof_bound_source_reviews(review_hash),created_at timestamptz not null default clock_timestamp());
do $$ declare n text;begin foreach n in array array['r12_proof_bound_source_reviews','r12_proof_bound_source_revocations'] loop
 execute format('alter table private.%I enable row level security',n);execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);
 execute format('create trigger r12_research_renderer_immutable before insert or update or delete on private.%I for each row execute function private.r05_guard()',n);
end loop;end $$;
create function private.r12_research_review_revocation_lock() returns trigger language plpgsql set search_path='' as $$
declare r private.r12_proof_bound_source_reviews;begin
 select * into strict r from private.r12_proof_bound_source_reviews where review_hash=new.review_hash;
 perform private.r12_renderer_review_lock_businesses(r.route_hash,r.qualification_hash);return new;
end $$;
create trigger r12_research_revocation_business_lock before insert on private.r12_proof_bound_source_revocations for each row execute function private.r12_research_review_revocation_lock();
revoke all on function private.r12_research_review_revocation_lock() from public,anon,authenticated,service_role;
create function private.r12_research_renderer_policy(p jsonb) returns void language plpgsql set search_path='' as $$ begin
 perform private.r04_safe(p);perform private.r04_keys(p,array['version','purpose','maximumRequests','navigation','sameOrigin','post','extraction','candidatePolicy','candidatePolicyHash']);perform private.r12_candidate_policy(p->'candidatePolicy');
 if p->>'version' is distinct from 'etsy.insights-renderer-research-policy.4' or p->>'purpose' is distinct from 'etsy_insights_aggregate_research'
 or p->>'navigation' is distinct from 'fixed_insights_query_get_only' or p->>'sameOrigin' is distinct from 'renderer_get_only' or p->>'post' is distinct from 'denied' or p->>'extraction' is distinct from 'visible_aggregate_dom_only'
 or p->>'candidatePolicyHash' is distinct from private.stage14_hash(p->'candidatePolicy') or jsonb_typeof(p->'maximumRequests') is distinct from 'number' or coalesce(p->>'maximumRequests','')!~'^[1-9][0-9]{0,2}$' or (p->>'maximumRequests')::integer>(p->'candidatePolicy'->>'maximumRequests')::integer
 then raise exception 'r12_research_renderer_policy_unqualified';end if;
end $$;
create function private.r12_research_renderer_review(qualification text,candidate_review text) returns private.r12_proof_bound_source_reviews language plpgsql set search_path='' as $$
declare r private.r12_proof_bound_source_reviews;q private.r12_direct_source_qualifications;c private.r12_verification_candidate_reviews;p jsonb;expected jsonb;begin
 select * into r from private.r12_proof_bound_source_reviews where qualification_hash=qualification and candidate_review_hash=candidate_review;
 if r.review_hash is null then raise exception 'r12_candidate_research_unqualified';end if;
 select * into strict q from private.r12_direct_source_qualifications where qualification_hash=qualification;
 c:=private.r12_candidate_review(candidate_review,q.route_hash,q.provider_project_id,false);p:=q.content->'rendererPolicy';perform private.r12_research_renderer_policy(p);
 expected:=jsonb_build_object('version','r12.insights-proof-bound-source-review.4','purpose','etsy_insights_aggregate_research','qualificationHash',q.qualification_hash,'candidateReviewHash',c.review_hash,'candidatePolicyHash',c.policy_hash,'routeHash',q.route_hash,'providerProjectId',q.provider_project_id,'policy',p,'policyHash',private.stage14_hash(p),'landingControlsVersion',c.content->'landingControlsVersion','landingControlsHash',c.content->'landingControlsHash','validFrom',private.r12_direct_time(r.valid_from),'validUntil',private.r12_direct_time(r.valid_until));
 if r.content is distinct from expected or r.review_hash is distinct from private.stage14_hash(expected) or r.policy_hash is distinct from private.stage14_hash(p) or r.route_hash is distinct from q.route_hash or r.provider_project_id is distinct from q.provider_project_id
 or q.qualification_hash is distinct from private.stage14_hash(q.content) or p->'candidatePolicy' is distinct from c.content->'policy' or p->>'candidatePolicyHash' is distinct from c.policy_hash
 or r.valid_from<greatest(q.valid_from,c.valid_from) or r.valid_until>least(q.valid_until,c.valid_until)
 then raise exception 'r12_research_renderer_review_changed';end if;
 perform private.r12_candidate_review(candidate_review,q.route_hash,q.provider_project_id,true);
 if r.valid_from>clock_timestamp() or r.valid_until<=clock_timestamp() or q.valid_from>clock_timestamp() or q.valid_until<=clock_timestamp()
 or exists(select 1 from private.r12_proof_bound_source_revocations where review_hash=r.review_hash) or exists(select 1 from private.r12_direct_source_qualification_revocations where qualification_hash=q.qualification_hash)
 then raise exception 'r12_research_renderer_review_inactive';end if;return r;
end $$;
-- This preparation-time check is independent of a not-yet-created source
-- attempt. The envelope already pins the new source qualification; the actual
-- saved verification pins the candidate review. That immutable pair is unique.
create function private.r12_research_renderer_binding(binding jsonb) returns jsonb language plpgsql set search_path='' as $$
declare v private.r12_etsy_steel_verifications;c private.r12_etsy_steel_candidates;s private.r12_etsy_steel_setups;e private.r12_direct_test_envelopes;route private.r12_direct_browser_routes;selected private.r12_verification_candidate_selections;review private.r12_proof_bound_source_reviews;q jsonb;op uuid;receipt private.r12_direct_browser_receipts;accounting private.r12_direct_browser_accounting;release_hash text;expires timestamptz;begin
 select * into v from private.r12_etsy_steel_verifications where binding_hash=r12_research_renderer_binding.binding->>'bindingHash' and private.r12_etsy_steel_verifications.binding=r12_research_renderer_binding.binding;
 if v.binding_id is null then raise exception 'r12_research_verified_binding_required';end if;
 select * into strict c from private.r12_etsy_steel_candidates where binding_id=v.binding_id;s:=private.r12_etsy_steel_current(c.operation_id,false);
 select * into strict e from private.r12_direct_test_envelopes where id=s.envelope_id;select * into strict route from private.r12_direct_browser_routes where route_hash=s.route_hash;
 perform private.r12_etsy_steel_account_binding_check(binding);
 select * into selected from private.r12_verification_candidate_selections where operation_id=(v.verification->>'operationId')::uuid;
 if selected.operation_id is null then raise exception 'r12_research_candidate_verification_required';end if;
 q:=private.r12_candidate_qualification(selected.operation_id,true);
 review:=private.r12_research_renderer_review(e.content->'researchPins'->>'executionReviewHash',selected.review_hash);
 if review.route_hash is distinct from s.route_hash or review.provider_project_id is distinct from route.provider_project_id
 or binding->>'testEnvelopeId' is distinct from e.id::text or binding->>'testEnvelopeHash' is distinct from e.content_hash or binding->>'providerProjectId' is distinct from route.provider_project_id::text
 or review.content->'candidatePolicyHash' is distinct from q->'policyHash' then raise exception 'r12_research_renderer_binding_changed';end if;
 foreach op in array array[s.operation_id,selected.operation_id] loop
 select * into receipt from private.r12_direct_browser_receipts where operation_id=op;
 select * into accounting from private.r12_direct_browser_accounting where operation_id=op order by revision desc limit 1;
 if op=s.operation_id then select release_evidence_hash into release_hash from private.r12_etsy_steel_cleanup_proofs where operation_id=op;
 else select release_evidence_hash into release_hash from private.r12_etsy_steel_verification_release where operation_id=op;end if;
 if receipt.operation_id is null or accounting.operation_id is null or release_hash is null
 or receipt.content->>'status' is distinct from (case when op=s.operation_id then 'profile_pending_verification' else 'verified' end)
 or accounting.content->>'operationReceiptHash' is distinct from receipt.receipt_hash or accounting.content->>'releaseProofHash' is distinct from release_hash
 or accounting.content->>'envelopeHash' is distinct from e.content_hash or accounting.content->>'providerProjectId' is distinct from route.provider_project_id::text
 or exists(select 1 from private.r12_direct_browser_anomalies where operation_id=op)
 or not exists(select 1 from private.r12_direct_browser_evidence x where x.evidence_hash=release_hash and x.operation_id=op and x.kind='release' and x.content->'terminal'='true'::jsonb and x.content->'observersDisposed'='true'::jsonb and x.content->>'providerStatus'='released')
 then raise exception 'r12_research_verification_cleanup_accounting_required';end if;
 end loop;
 -- Shared financial admission remains at the existing preparation/reserve
 -- gates. Rechecking it here would classify this very in-flight source as
 -- unresolved and prevent its already-admitted transport and cleanup.
 expires:=least((binding->>'expiresAt')::timestamptz,e.expires_at,route.valid_until,review.valid_until);
 if expires<=clock_timestamp() then raise exception 'r12_research_renderer_readiness_expired';end if;
 return jsonb_build_object('reviewHash',review.review_hash,'policy',review.content->'policy','policyHash',review.policy_hash,'landingControlsVersion',review.content->'landingControlsVersion','landingControlsHash',review.content->'landingControlsHash','readiness',jsonb_build_object('version','etsy.insights-research-readiness.1','verificationOperationId',selected.operation_id,'verificationHash',v.verification_hash,'verifiedContextHash',v.verification->'verifiedContextHash','candidatePolicyHash',q->'policyHash','providerProjectId',route.provider_project_id,'profileBindingId',c.binding_id,'profileBindingRevision',c.binding_revision,'accountBindingHash',v.binding_hash,'expiresAt',private.r12_direct_time(expires)));
end $$;
create or replace function private.r12_candidate_research_check(binding jsonb) returns void language plpgsql set search_path='' as $$ begin
 if exists(select 1 from private.r12_etsy_steel_verifications v join private.r12_direct_verification_renderer_qualifications q on q.operation_id=(v.verification->>'operationId')::uuid where v.binding=r12_candidate_research_check.binding and q.content->'policy'->>'version'='etsy.insights-renderer-candidate-policy.3')
 or exists(select 1 from private.r12_direct_test_envelopes e join private.r12_direct_source_qualifications q on q.qualification_hash=e.content->'researchPins'->>'executionReviewHash' where e.id=(binding->>'testEnvelopeId')::uuid and q.content->'rendererPolicy'->>'version'='etsy.insights-renderer-research-policy.4') then perform private.r12_research_renderer_binding(binding);end if;
end $$;
create function private.r12_research_renderer_attempt(attempt uuid) returns jsonb language plpgsql set search_path='' as $$
declare a private.r12_direct_phase_attempts;b jsonb;body jsonb;old private.r12_direct_source_renderer_qualifications;expires timestamptz;begin
 select * into strict a from private.r12_direct_phase_attempts where attempt_id=attempt and phase='source';
 b:=private.r12_research_renderer_binding(a.source_scope->'accountBinding');
 expires:=least((b->'readiness'->>'expiresAt')::timestamptz,(a.source_scope->>'expiresAt')::timestamptz);
 if expires<=clock_timestamp() or a.source_scope->>'providerProjectId' is distinct from b->'readiness'->>'providerProjectId' then raise exception 'r12_research_renderer_readiness_expired';end if;
 b:=jsonb_set(b,'{readiness,expiresAt}',to_jsonb(private.r12_direct_time(expires)));
 body:=jsonb_build_object('version','r12.etsy-insights-renderer-qualification.3','requestHash',private.stage14_hash(a.source_scope),'expiresAt',private.r12_direct_time(expires),'maximumRequests',b->'policy'->'maximumRequests','policy',b->'policy','policyHash',b->'policyHash','landingControlsVersion',b->'landingControlsVersion','landingControlsHash',b->'landingControlsHash','readiness',b->'readiness');
 body:=body||jsonb_build_object('qualificationHash',private.stage14_hash(body));
 select * into old from private.r12_direct_source_renderer_qualifications where attempt_id=attempt;
 if old.attempt_id is not null and (old.content is distinct from body or old.qualification_hash is distinct from body->>'qualificationHash') then raise exception 'r12_research_renderer_qualification_changed';end if;return body;
end $$;
create function private.r12_research_renderer_classify(p jsonb,d jsonb,query text) returns text language plpgsql set search_path='' as $$ begin
 perform private.r12_research_renderer_policy(p);
 if d='{}'::jsonb then return null;end if;
 if d->>'requestKind'='same_origin' then
 if d->>'url'!~'^https://www[.]etsy[.]com/' then raise exception 'r12_research_renderer_request_denied';end if;
 perform private.r12_direct_renderer_check_v1(jsonb_build_object('version','etsy.insights-renderer-policy.1','staticOrigins','[]'::jsonb,'maximumRequests',p->'maximumRequests','navigation','fixed_insights_get_only','sameOrigin','renderer_get_only','post','denied','extraction','visible_aggregate_dom_only'),d,query);return 'allow';
 elsif d->>'requestKind'='external' then return private.r12_candidate_classify(p->'candidatePolicy',d);
 end if;raise exception 'r12_research_renderer_request_denied';
end $$;
-- Preserve original OIDs and named argument interfaces for warm callers.
do $$ declare src text;old text;signature text;begin
 foreach old in array array['r12_direct_renderer_check','r12_landing_source','r12_direct_source_port'] loop
 signature:=case old when 'r12_direct_renderer_check' then 'jsonb,jsonb,text' when 'r12_landing_source' then 'uuid' else 'uuid,text,jsonb' end;
 src:=pg_get_functiondef(('private.'||old||'('||signature||')')::regprocedure);
 if strpos(src,'CREATE OR REPLACE FUNCTION private.'||old||'(')<>1 then raise exception 'r12_research_renderer_delegate_changed';end if;
 execute overlay(src placing 'CREATE OR REPLACE FUNCTION private.'||old||'_before_research4(' from 1 for length('CREATE OR REPLACE FUNCTION private.'||old||'('));
 end loop;
end $$;
create or replace function private.r12_direct_renderer_check(p jsonb,r jsonb,query text) returns void language plpgsql set search_path='' as $$ begin
 if p->>'version'='etsy.insights-renderer-research-policy.4' then perform private.r12_research_renderer_classify(p,r,query);
 else perform private.r12_direct_renderer_check_before_research4(p,r,query);end if;
end $$;
create or replace function private.r12_landing_source(attempt uuid) returns jsonb language plpgsql set search_path='' as $$
declare p jsonb;q jsonb;begin
 select source.content->'rendererPolicy' into strict p from private.r12_direct_phase_attempts a join private.r12_direct_research_setups s on s.scope_id=a.scope_id join private.r12_direct_test_envelopes e on e.id=s.envelope_id join private.r12_direct_source_qualifications source on source.qualification_hash=e.content->'researchPins'->>'executionReviewHash' where a.attempt_id=attempt and a.phase='source';
 if p->>'version'='etsy.insights-renderer-research-policy.4' then q:=private.r12_research_renderer_attempt(attempt);return jsonb_build_object('landingControlsVersion',q->'landingControlsVersion','landingControlsHash',q->'landingControlsHash','expiresAt',q->'expiresAt');end if;
 if exists(select 1 from private.r12_direct_source_renderer_qualifications where attempt_id=attempt and content->>'version'='r12.etsy-insights-renderer-qualification.3') then raise exception 'r12_research_renderer_qualification_changed';end if;
 return private.r12_landing_source_before_research4(attempt);
end $$;
create or replace function private.r12_direct_source_port(p_scope uuid,operation text,payload jsonb) returns jsonb language plpgsql set search_path='' as $$
declare s private.r12_direct_research_setups;a private.r12_direct_phase_attempts;p jsonb;q jsonb;d jsonb;old private.r12_direct_source_renderer_qualifications;n integer;disposition text;begin
 -- These operations keep the original exact endpoint, receipt and cleanup
 -- boundaries, including recovery after Stop or review revocation.
 if operation not in ('qualify_renderer','admit_renderer') then return private.r12_direct_source_port_before_research4(p_scope,operation,payload);end if;
 perform private.r04_keys(payload,array['attemptId']||case when operation='admit_renderer' then array['request'] else array[]::text[] end);
 s:=private.r12_direct_research_current(p_scope);
 select * into a from private.r12_direct_phase_attempts where scope_id=p_scope and attempt_id=(payload->>'attemptId')::uuid and phase='source' for update;
 if a.attempt_id is null then raise exception 'r12_direct_actual_source_required';end if;
 select source.content->'rendererPolicy' into strict p from private.r12_direct_source_qualifications source join private.r12_direct_test_envelopes e on source.qualification_hash=e.content->'researchPins'->>'executionReviewHash' where e.id=s.envelope_id;
 if p->>'version' is distinct from 'etsy.insights-renderer-research-policy.4' then
 if payload->'request'->>'version'='r12.etsy-insights-renderer-request.3' then raise exception 'r12_research_renderer_qualification_changed';end if;
 return private.r12_direct_source_port_before_research4(p_scope,operation,payload);end if;
 q:=private.r12_research_renderer_attempt(a.attempt_id);
 select * into old from private.r12_direct_source_renderer_qualifications where attempt_id=a.attempt_id;
 if operation='qualify_renderer' then
 if old.attempt_id is null then insert into private.r12_direct_source_renderer_qualifications values(a.attempt_id,q,q->>'qualificationHash',clock_timestamp());end if;return q;end if;
 d:=payload->'request';perform private.r04_safe(d);
 perform private.r04_keys(d,array['version','operationId','sourceAttemptId','requestHash','qualificationHash','policyHash','provenanceHash','sequence','disposition','decisionHash','requestKind','method','resourceType','navigation']||case when d->>'requestKind'='same_origin' then array['url'] else array['origin','pathnameHash','hasQuery'] end);
 if old.attempt_id is null or d->>'version' is distinct from 'r12.etsy-insights-renderer-request.3'
 or d->>'operationId' is distinct from a.source_scope->>'operationId' or d->>'sourceAttemptId' is distinct from a.attempt_id::text or d->>'requestHash' is distinct from private.stage14_hash(a.source_scope)
 or d->>'qualificationHash' is distinct from q->>'qualificationHash' or d->'policyHash' is distinct from q->'policyHash' or d->'provenanceHash' is distinct from p->'candidatePolicy'->'provenanceHash'
 or d->>'decisionHash' is distinct from private.stage14_hash(d-'decisionHash') or jsonb_typeof(d->'sequence') is distinct from 'number' or coalesce(d->>'sequence','')!~'^[1-9][0-9]{0,2}$'
 or not exists(select 1 from private.r12_direct_source_transport_claims where attempt_id=a.attempt_id)
 or not exists(select 1 from private.r07_attempts where id=a.attempt_id and status='dispatched')
 or exists(select 1 from private.r12_direct_source_cleanup_proofs where attempt_id=a.attempt_id) or exists(select 1 from private.r12_direct_phase_receipts where attempt_id=a.attempt_id)
 or exists(select 1 from private.r12_direct_browser_receipts where operation_id=(a.source_scope->>'operationId')::uuid) or exists(select 1 from private.r12_direct_browser_evidence where operation_id=(a.source_scope->>'operationId')::uuid and kind='release')
 then raise exception 'r12_research_renderer_decision_unqualified';end if;
 n:=(d->>'sequence')::integer;
 if n<>(select count(*)+1 from private.r12_direct_source_renderer_requests where attempt_id=a.attempt_id) or n>(q->>'maximumRequests')::integer then raise exception 'r12_research_renderer_decision_replayed';end if;
 disposition:=private.r12_research_renderer_classify(p,d,a.source_scope->>'query');if d->>'disposition' is distinct from disposition then raise exception 'r12_research_renderer_disposition_mismatch';end if;
 insert into private.r12_direct_source_renderer_requests values(a.attempt_id,n,d,private.stage14_hash(d),clock_timestamp());
 return jsonb_build_object('accepted',true,'allowed',disposition='allow','sequence',n,'disposition',disposition,'decisionHash',d->>'decisionHash','qualificationHash',q->>'qualificationHash','policyHash',q->>'policyHash','provenanceHash',p->'candidatePolicy'->>'provenanceHash');
end $$;
do $$ declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and (p.proname like 'r12_research_renderer_%' or p.proname like '%_before_research4' or p.proname in ('r12_candidate_research_check','r12_direct_renderer_check','r12_landing_source','r12_direct_source_port')) loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;end $$;
commit;
