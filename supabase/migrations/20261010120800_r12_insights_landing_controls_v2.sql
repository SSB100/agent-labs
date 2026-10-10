-- Explicit observed landing controls .2. Definitions only: no review, route,
-- grant, candidate, session or production access is enrolled by this migration.
-- Renderer policy versions are independent from selector/landing versions.
begin;
create table private.r12_landing_reviews(
 purpose text not null check(purpose in ('verification','source')),authority_hash text not null check(authority_hash~'^[a-f0-9]{64}$'),
 route_hash text not null references private.r12_direct_browser_routes(route_hash),provider_project_id uuid not null,
 renderer_policy_hash text not null check(renderer_policy_hash~'^[a-f0-9]{64}$'),
 content jsonb not null,review_hash text not null unique check(review_hash=private.stage14_hash(content)),
 valid_from timestamptz not null,valid_until timestamptz not null check(valid_until>valid_from),primary key(purpose,authority_hash));
create table private.r12_landing_review_revocations(review_hash text primary key references private.r12_landing_reviews(review_hash),created_at timestamptz not null default clock_timestamp());
do $$ declare n text;begin foreach n in array array['r12_landing_reviews','r12_landing_review_revocations'] loop
 execute format('alter table private.%I enable row level security',n);execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);
 execute format('create trigger r12_landing_immutable before insert or update or delete on private.%I for each row execute function private.r05_guard()',n);
end loop;end $$;
-- No public enrollment function. A separately reviewed exact authority is needed
-- for each purpose; a self-hashed caller payload cannot qualify a selector.
create function private.r12_landing_review(purpose text,authority_hash text,route_hash text,project uuid,policy_hash text,check_active boolean default true) returns jsonb language plpgsql set search_path='' as $$
declare r private.r12_landing_reviews;c jsonb;begin
 select x.* into r from private.r12_landing_reviews x where x.purpose=r12_landing_review.purpose and x.authority_hash=r12_landing_review.authority_hash;
 if r.review_hash is null then return null;end if;c:=r.content;
 perform private.r04_safe(c);perform private.r04_keys(c,array['version','purpose','authorityHash','routeHash','providerProjectId','rendererPolicyHash','landingControlsVersion','landingControlsHash','queryControlWitnessHash','validFrom','validUntil']);
 if r.route_hash is distinct from route_hash or r.provider_project_id is distinct from project or r.renderer_policy_hash is distinct from policy_hash

 or c->>'version' is distinct from 'r12.insights-landing-review.2' or c->>'purpose' is distinct from purpose or c->>'authorityHash' is distinct from authority_hash
 or c->>'routeHash' is distinct from route_hash or c->>'providerProjectId' is distinct from project::text or c->>'rendererPolicyHash' is distinct from policy_hash
 or (c->>'validFrom')::timestamptz is distinct from r.valid_from or (c->>'validUntil')::timestamptz is distinct from r.valid_until
 or c->>'landingControlsVersion' is distinct from 'etsy.insights-landing-controls.2'
 or c->>'landingControlsHash' is distinct from '0ee4c99ed0b65e3efd499cadf1059613311df10d815db1892ef03efa167c5d7b'
 or c->>'queryControlWitnessHash' is distinct from '2a8a7e0a2a4d45abf0f4a71b4a5674006eaec9aa45b8d67c841ac4041131a435'
 then raise exception 'r12_landing_review_unqualified';end if;
 if check_active and (r.valid_from>clock_timestamp() or r.valid_until<=clock_timestamp() or exists(select 1 from private.r12_landing_review_revocations x where x.review_hash=r.review_hash)) then raise exception 'r12_landing_review_inactive';end if;
 return jsonb_build_object('landingControlsVersion',c->'landingControlsVersion','landingControlsHash',c->'landingControlsHash','expiresAt',c->'validUntil');
end $$;
create function private.r12_landing_verification_check(operation uuid,proof jsonb,accepting boolean default true) returns void language plpgsql set search_path='' as $$
declare v private.r12_etsy_steel_verification_runs;s private.r12_etsy_steel_setups;r private.r12_direct_verification_renderer_reviews;q private.r12_direct_verification_renderer_qualifications;p jsonb;begin
 select * into q from private.r12_direct_verification_renderer_qualifications where operation_id=operation;
 if proof->>'version'='etsy.steel-account-verification.1' then
 if q.content->>'version'='r12.etsy-insights-renderer-qualification.2' then raise exception 'r12_landing_proof_downgrade';end if;return;end if;
 if proof->>'version' is distinct from 'etsy.steel-account-verification.2' then raise exception 'r12_landing_proof_version';end if;
 select * into strict v from private.r12_etsy_steel_verification_runs where operation_id=operation;
 select * into strict s from private.r12_etsy_steel_setups where operation_id=v.setup_operation_id;
 select * into strict r from private.r12_direct_verification_renderer_reviews where route_hash=s.route_hash;
 p:=private.r12_landing_review('verification',r.review_hash,s.route_hash,r.provider_project_id,r.policy_hash,false);
 perform private.r04_keys(q.content,array['version','requestHash','qualificationHash','expiresAt','maximumRequests','policy','policyHash','landingControlsVersion','landingControlsHash']);
 perform private.r04_keys(proof,array['version','operationId','setupOperationId','handoffId','profileBindingId','profileBindingRevision','providerProjectId','testEnvelopeId','testEnvelopeHash','profileId','sessionId','contextId','pageId','observedShopName','observedShopId','verifiedAt','expiresAt','accountIdentityVerified','insightsAccessVerified','visibleShopHref','canonicalUrl','insightsHeading','queryControlWitnessHash','documentEpoch','verifiedContextHash','verificationHash','landingControlsVersion','landingControlsHash']);
 if p is null
 or q.qualification_hash is distinct from private.stage14_hash(q.content-'qualificationHash') or q.content->>'qualificationHash' is distinct from q.qualification_hash
 or proof->>'verificationHash' is distinct from private.stage14_hash(proof-'verificationHash')
 or proof->>'verifiedContextHash' is distinct from private.stage14_hash(jsonb_build_object('version','etsy.steel-visible-account-context.2')||(proof-'version'-'expiresAt'-'accountIdentityVerified'-'insightsAccessVerified'-'verifiedContextHash'-'verificationHash'))
 or q.content->>'version' is distinct from 'r12.etsy-insights-renderer-qualification.2' or q.content->>'requestHash' is distinct from v.scope_hash
 or q.content->>'policyHash' is distinct from r.policy_hash or q.content->'policy' is distinct from r.policy
 or q.content->'landingControlsVersion' is distinct from p->'landingControlsVersion' or q.content->'landingControlsHash' is distinct from p->'landingControlsHash'
 or proof->'landingControlsVersion' is distinct from p->'landingControlsVersion' or proof->'landingControlsHash' is distinct from p->'landingControlsHash'
 or proof->>'queryControlWitnessHash' is distinct from '2a8a7e0a2a4d45abf0f4a71b4a5674006eaec9aa45b8d67c841ac4041131a435'
 or not exists(select 1 from private.r12_direct_verification_renderer_requests x where x.operation_id=operation and x.content->>'qualificationHash'=q.qualification_hash
 and x.content->'navigation'='true'::jsonb and x.content->>'method'='GET' and x.content->>'resourceType'='document'
 and x.content->>'url'='https://www.etsy.com/your/shops/me/marketplace-insights' and coalesce(x.content->>'disposition','allow')='allow')
 then raise exception 'r12_landing_saved_qualification_required';end if;
 -- Schema and immutable hashes/pins are checked before ordinary inactivity,
 -- so a corrupt record cannot be disguised by revoking its review.
 perform private.r12_landing_review('verification',r.review_hash,s.route_hash,r.provider_project_id,r.policy_hash);
 if r.valid_from>clock_timestamp() or r.valid_until<=clock_timestamp() or exists(select 1 from private.r12_direct_verification_renderer_revocations where route_hash=s.route_hash) then raise exception 'r12_landing_review_inactive';end if;
 -- A completed binding may outlive its short execution permit, but accepting
 -- a new proof still requires the current one-shot execution authority.
 if accepting then perform private.r12_direct_verification_renderer(operation,'check');end if;
end $$;
create function private.r12_landing_source(attempt uuid) returns jsonb language plpgsql set search_path='' as $$
declare a private.r12_direct_phase_attempts;s private.r12_direct_research_setups;e private.r12_direct_test_envelopes;q private.r12_direct_source_qualifications;old private.r12_direct_source_renderer_qualifications;v private.r12_etsy_steel_verifications;p jsonb;begin
 select * into strict a from private.r12_direct_phase_attempts where attempt_id=attempt and phase='source';
 select * into strict s from private.r12_direct_research_setups where scope_id=a.scope_id;
 select * into strict e from private.r12_direct_test_envelopes where id=s.envelope_id;
 select * into strict q from private.r12_direct_source_qualifications where qualification_hash=e.content->'researchPins'->>'executionReviewHash';
 select * into old from private.r12_direct_source_renderer_qualifications where attempt_id=attempt;
 -- Already saved .1 qualifications remain exact .1. Never upgrade them in place.
 if old.content->>'version'='r12.etsy-insights-renderer-qualification.1' then return null;end if;
 p:=private.r12_landing_review('source',q.qualification_hash,q.route_hash,q.provider_project_id,private.stage14_hash(q.content->'rendererPolicy'));
 if p is null then
 if old.content->>'version'='r12.etsy-insights-renderer-qualification.2' then raise exception 'r12_landing_review_required';end if;return null;end if;
 if old.attempt_id is not null and (old.content->>'version' is distinct from 'r12.etsy-insights-renderer-qualification.2'
 or old.content->'landingControlsVersion' is distinct from p->'landingControlsVersion' or old.content->'landingControlsHash' is distinct from p->'landingControlsHash') then raise exception 'r12_landing_source_qualification_changed';end if;
 perform private.r12_etsy_steel_account_binding_check(a.source_scope->'accountBinding');
 select * into v from private.r12_etsy_steel_verifications where binding_hash=a.source_scope->'accountBinding'->>'bindingHash';
 if v.binding_id is null or v.verification->>'version' is distinct from 'etsy.steel-account-verification.2'
 or v.verification->'landingControlsVersion' is distinct from p->'landingControlsVersion' or v.verification->'landingControlsHash' is distinct from p->'landingControlsHash'
 then raise exception 'r12_landing_verified_account_required';end if;
 perform private.r12_landing_verification_check((v.verification->>'operationId')::uuid,v.verification,false);
 return p;
end $$;

do $$ declare src text;old text:=$old$v2 boolean;begin$old$;replacement text:=$new$v2 boolean;landing jsonb;begin$new$;begin
 src:=pg_get_functiondef('private.r12_direct_verification_renderer(uuid,text,jsonb)'::regprocedure);
 if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'r12_landing_patch_required: private.r12_direct_verification_renderer(uuid,text,jsonb)';end if;execute replace(src,old,replacement);
end $$;

do $$ declare src text;old text:=$old$if old.operation_id is not null then return old.content;end if;$old$;replacement text:=$new$if old.operation_id is not null then
 if old.content->>'version'='r12.etsy-insights-renderer-qualification.2' then landing:=private.r12_landing_review('verification',r.review_hash,s.route_hash,route.provider_project_id,r.policy_hash);if landing is null or old.content->'landingControlsVersion' is distinct from landing->'landingControlsVersion' or old.content->'landingControlsHash' is distinct from landing->'landingControlsHash' then raise exception 'r12_landing_review_required';end if;end if;
 return old.content;end if;$new$;begin
 src:=pg_get_functiondef('private.r12_direct_verification_renderer(uuid,text,jsonb)'::regprocedure);
 if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'r12_landing_patch_required: private.r12_direct_verification_renderer(uuid,text,jsonb)';end if;execute replace(src,old,replacement);
end $$;

do $$ declare src text;old text:=$old$body:=body||jsonb_build_object('qualificationHash',private.stage14_hash(body));$old$;replacement text:=$new$landing:=private.r12_landing_review('verification',r.review_hash,s.route_hash,route.provider_project_id,r.policy_hash);
 if landing is not null then body:=body||jsonb_build_object('version','r12.etsy-insights-renderer-qualification.2','landingControlsVersion',landing->'landingControlsVersion','landingControlsHash',landing->'landingControlsHash','expiresAt',private.r12_direct_time(least((body->>'expiresAt')::timestamptz,(landing->>'expiresAt')::timestamptz)));end if;
 body:=body||jsonb_build_object('qualificationHash',private.stage14_hash(body));$new$;begin
 src:=pg_get_functiondef('private.r12_direct_verification_renderer(uuid,text,jsonb)'::regprocedure);
 if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'r12_landing_patch_required: private.r12_direct_verification_renderer(uuid,text,jsonb)';end if;execute replace(src,old,replacement);
end $$;

do $$ declare src text;old text:=$old$if mode='check' then return old.content;end if;$old$;replacement text:=$new$if old.content->>'version'='r12.etsy-insights-renderer-qualification.2' then landing:=private.r12_landing_review('verification',r.review_hash,s.route_hash,route.provider_project_id,r.policy_hash);if landing is null or old.content->'landingControlsVersion' is distinct from landing->'landingControlsVersion' or old.content->'landingControlsHash' is distinct from landing->'landingControlsHash' then raise exception 'r12_landing_review_required';end if;end if;
 if mode='check' then return old.content;end if;$new$;begin
 src:=pg_get_functiondef('private.r12_direct_verification_renderer(uuid,text,jsonb)'::regprocedure);
 if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'r12_landing_patch_required: private.r12_direct_verification_renderer(uuid,text,jsonb)';end if;execute replace(src,old,replacement);
end $$;

do $$ declare src text;old text:=$old$'documentEpoch','verifiedContextHash','verificationHash']);$old$;replacement text:=$new$'documentEpoch','verifiedContextHash','verificationHash']||case when proof->>'version'='etsy.steel-account-verification.2' then array['landingControlsVersion','landingControlsHash'] else array[]::text[] end);
  perform private.r12_landing_verification_check(vr.operation_id,proof);$new$;begin
 src:=pg_get_functiondef('public.r12_etsy_steel_server(uuid,text,jsonb,text)'::regprocedure);
 if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'r12_landing_patch_required: public.r12_etsy_steel_server(uuid,text,jsonb,text)';end if;execute replace(src,old,replacement);
end $$;

do $$ declare src text;old text:=$old$jsonb_build_object('version','etsy.steel-visible-account-context.1')$old$;replacement text:=$new$jsonb_build_object('version',case when proof->>'version'='etsy.steel-account-verification.2' then 'etsy.steel-visible-account-context.2' else 'etsy.steel-visible-account-context.1' end)$new$;begin
 src:=pg_get_functiondef('public.r12_etsy_steel_server(uuid,text,jsonb,text)'::regprocedure);
 if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'r12_landing_patch_required: public.r12_etsy_steel_server(uuid,text,jsonb,text)';end if;execute replace(src,old,replacement);
end $$;

do $$ declare src text;old text:=$old$proof->>'version' is distinct from 'etsy.steel-account-verification.1'$old$;replacement text:=$new$(proof->>'version' in ('etsy.steel-account-verification.1','etsy.steel-account-verification.2')) is not true$new$;begin
 src:=pg_get_functiondef('public.r12_etsy_steel_server(uuid,text,jsonb,text)'::regprocedure);
 if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'r12_landing_patch_required: public.r12_etsy_steel_server(uuid,text,jsonb,text)';end if;execute replace(src,old,replacement);
end $$;

do $$ declare src text;old text:=$old$private.stage14_hash('{"formAriaLabel":"search bar form","inputAriaLabel":"Input to search for keywords","inputType":"text","buttonName":"Search","buttonType":"submit","formVisible":true,"inputVisible":true,"inputEnabled":true,"buttonVisible":true,"buttonEnabled":true}'::jsonb)$old$;replacement text:=$new$(case when proof->>'version'='etsy.steel-account-verification.2' then '2a8a7e0a2a4d45abf0f4a71b4a5674006eaec9aa45b8d67c841ac4041131a435' else private.stage14_hash('{"formAriaLabel":"search bar form","inputAriaLabel":"Input to search for keywords","inputType":"text","buttonName":"Search","buttonType":"submit","formVisible":true,"inputVisible":true,"inputEnabled":true,"buttonVisible":true,"buttonEnabled":true}'::jsonb) end)$new$;begin
 src:=pg_get_functiondef('public.r12_etsy_steel_server(uuid,text,jsonb,text)'::regprocedure);
 if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'r12_landing_patch_required: public.r12_etsy_steel_server(uuid,text,jsonb,text)';end if;execute replace(src,old,replacement);
end $$;

do $$ declare src text;old text:=$old$s:=private.r12_etsy_steel_current(c.operation_id,false);$old$;replacement text:=$new$s:=private.r12_etsy_steel_current(c.operation_id,false);
 if v.verification->>'version'='etsy.steel-account-verification.2' then perform private.r12_landing_verification_check((v.verification->>'operationId')::uuid,v.verification,false);end if;$new$;begin
 src:=pg_get_functiondef('private.r12_etsy_steel_account_binding_check(jsonb)'::regprocedure);
 if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'r12_landing_patch_required: private.r12_etsy_steel_account_binding_check(jsonb)';end if;execute replace(src,old,replacement);
end $$;

do $$ declare src text;old text:=$old$if p_operation='inputs' then$old$;replacement text:=$new$if p_operation='inputs' then
  if exists(select 1 from private.r12_direct_verification_renderer_qualifications q where q.operation_id=v.operation_id and q.content->>'version'='r12.etsy-insights-renderer-qualification.2') then perform private.r12_direct_verification_renderer(v.operation_id,'check');end if;$new$;begin
 src:=pg_get_functiondef('public.r12_etsy_steel_verification_server(uuid,text,jsonb,text)'::regprocedure);
 if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'r12_landing_patch_required: public.r12_etsy_steel_verification_server(uuid,text,jsonb,text)';end if;execute replace(src,old,replacement);
end $$;

do $$ declare src text;old text:=$old$n integer;begin$old$;replacement text:=$new$n integer;landing jsonb;begin$new$;begin
 src:=pg_get_functiondef('private.r12_direct_source_port(uuid,text,jsonb)'::regprocedure);
 if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'r12_landing_patch_required: private.r12_direct_source_port(uuid,text,jsonb)';end if;execute replace(src,old,replacement);
end $$;

do $$ declare src text;old text:=$old$s:=private.r12_direct_research_current(p_scope);if (a.source_scope->>'expiresAt')$old$;replacement text:=$new$s:=private.r12_direct_research_current(p_scope);perform private.r12_landing_source(a.attempt_id);if (a.source_scope->>'expiresAt')$new$;begin
 src:=pg_get_functiondef('private.r12_direct_source_port(uuid,text,jsonb)'::regprocedure);
 if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'r12_landing_patch_required: private.r12_direct_source_port(uuid,text,jsonb)';end if;execute replace(src,old,replacement);
end $$;

do $$ declare src text;old text:=$old$if operation='resolve_source' then$old$;replacement text:=$new$landing:=private.r12_landing_source(a.attempt_id);
 if operation='resolve_source' then$new$;begin
 src:=pg_get_functiondef('private.r12_direct_source_port(uuid,text,jsonb)'::regprocedure);
 if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'r12_landing_patch_required: private.r12_direct_source_port(uuid,text,jsonb)';end if;execute replace(src,old,replacement);
end $$;

do $$ declare src text;old text:=$old$v:=v||jsonb_build_object('qualificationHash',private.stage14_hash(v));$old$;replacement text:=$new$if landing is not null then v:=v||jsonb_build_object('version','r12.etsy-insights-renderer-qualification.2','landingControlsVersion',landing->'landingControlsVersion','landingControlsHash',landing->'landingControlsHash','expiresAt',private.r12_direct_time(least((v->>'expiresAt')::timestamptz,(landing->>'expiresAt')::timestamptz)));end if;
 v:=v||jsonb_build_object('qualificationHash',private.stage14_hash(v));$new$;begin
 src:=pg_get_functiondef('private.r12_direct_source_port(uuid,text,jsonb)'::regprocedure);
 if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'r12_landing_patch_required: private.r12_direct_source_port(uuid,text,jsonb)';end if;execute replace(src,old,replacement);
end $$;

do $$ declare src text;old text:=$old$previous jsonb;begin$old$;replacement text:=$new$previous jsonb;landing jsonb;begin$new$;begin
 src:=pg_get_functiondef('private.r12_direct_source_admit(uuid,jsonb)'::regprocedure);
 if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'r12_landing_patch_required: private.r12_direct_source_admit(uuid,jsonb)';end if;execute replace(src,old,replacement);
end $$;

do $$ declare src text;old text:=$old$if seq=0 then$old$;replacement text:=$new$landing:=private.r12_landing_source(a.attempt_id);
 if seq=3 and landing is not null and r->>'targetId' is distinct from 'observed-insights-landing-controls.2' then raise exception 'r12_landing_submit_control_required';end if;
 if seq=0 then$new$;begin
 src:=pg_get_functiondef('private.r12_direct_source_admit(uuid,jsonb)'::regprocedure);
 if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'r12_landing_patch_required: private.r12_direct_source_admit(uuid,jsonb)';end if;execute replace(src,old,replacement);
end $$;

-- Only the new explicit .2 review expiry/revocation signal becomes an owner-safe
-- inactive status. All schema/hash/pin/integrity failures continue to propagate.
do $$ declare src text;old text:=$old$  perform private.r12_etsy_steel_account_binding_check(v.binding);
  state:='verified';reason:='verification_verified';$old$;replacement text:=$new$  begin
   perform private.r12_etsy_steel_account_binding_check(v.binding);
   state:='verified';reason:='verification_verified';
  exception when raise_exception then
   if sqlerrm='r12_landing_review_inactive' then state:='invalidated';reason:='authority_inactive';else raise;end if;
  end;$new$;begin
 src:=pg_get_functiondef('public.r12_owner_etsy_steel_verification_read(uuid,uuid)'::regprocedure);
 if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'r12_landing_owner_view_patch_required';end if;execute replace(src,old,replacement);
end $$;

do $$ declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'r12_landing_%' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;end $$;
commit;
