-- Explicit verification-only candidate boundary. No production review, grant,
-- route, profile, account binding or research readiness is enrolled here.
begin;
create table private.r12_verification_candidate_reviews(
 review_hash text primary key check(review_hash=private.stage14_hash(content)),route_hash text not null references private.r12_direct_browser_routes(route_hash),
 provider_project_id uuid not null,policy_hash text not null check(policy_hash=private.stage14_hash(content->'policy')),
 content jsonb not null,valid_from timestamptz not null,valid_until timestamptz not null check(valid_until>valid_from));
create table private.r12_verification_candidate_revocations(review_hash text primary key references private.r12_verification_candidate_reviews(review_hash),created_at timestamptz not null default clock_timestamp());
create table private.r12_verification_candidate_selections(operation_id uuid primary key references private.r12_etsy_steel_verification_runs(operation_id),review_hash text not null references private.r12_verification_candidate_reviews(review_hash),created_at timestamptz not null default clock_timestamp());
do $$ declare n text;begin foreach n in array array['r12_verification_candidate_reviews','r12_verification_candidate_revocations','r12_verification_candidate_selections'] loop
 execute format('alter table private.%I enable row level security',n);execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);
 execute format('create trigger r12_candidate_immutable before insert or update or delete on private.%I for each row execute function private.r05_guard()',n);
end loop;end $$;
create function private.r12_candidate_manifest() returns jsonb language sql immutable set search_path='' as $manifest$ select '{"version":"etsy.insights-renderer-candidate-manifest.3","documentUrl":"https://www.etsy.com/your/shops/me/marketplace-insights","observedAt":"2026-10-10T14:16:46.000Z","observation":"read_only_dom_src_attributes","networkTrace":false,"methodRule":"GET_only_no_non_GET_claim","necessity":"unestablished","purpose":"etsy_insights_verify_only","pathnameHashAlgorithm":"canonical_json_string_sha256","allowedImages":[{"origin":"https://i.etsystatic.com","pathnameHash":"1f86bdc3c7a4732b37809d6b263e2498872bf13418ab5e056b8119f3e0b3fc93","hasQuery":false,"method":"GET","resourceType":"image"},{"origin":"https://i.etsystatic.com","pathnameHash":"512d02ff511c568bb2564e23315c351cf145bdce47fb1c85dee8c44ed3f17293","hasQuery":false,"method":"GET","resourceType":"image"},{"origin":"https://i.etsystatic.com","pathnameHash":"b161c101e74b3ce29eabdb74afdc3f49e4d8e3a083ce46882568d1161d1ff35a","hasQuery":false,"method":"GET","resourceType":"image"},{"origin":"https://i.etsystatic.com","pathnameHash":"b5230bec2419c083a4441f5d40806744e9bc8b2b5000af7c57c7a2550164c04d","hasQuery":false,"method":"GET","resourceType":"image"}],"blockedCandidates":[{"origin":"https://analytics.tiktok.com","pathnameHash":"1acf9f1a6a2fbc3ea8fe4c22e68a82e16c8b357bb48d3de46c8bd0deae2cfc68","hasQuery":true,"method":"GET","resourceType":"script"},{"origin":"https://analytics.tiktok.com","pathnameHash":"437773a266ef535a87d3feb8b6874c0166747f24547816ce0938e3464bff23b3","hasQuery":false,"method":"GET","resourceType":"script"},{"origin":"https://analytics.tiktok.com","pathnameHash":"d58e2aaee7edc958ce7b82cf9f8b76aed45bdeeb47d19a8ffe08cab3bdd18fe0","hasQuery":false,"method":"GET","resourceType":"script"},{"origin":"https://bat.bing.com","pathnameHash":"06639cd87af7d163d8087c4192e2b924bbccd584d05d407a613c0d47a2c22b93","hasQuery":false,"method":"GET","resourceType":"script"},{"origin":"https://bat.bing.com","pathnameHash":"29435e9ceae58e202246aba89e66c4d92416c455a50faca9bc6e89b709f6361b","hasQuery":true,"method":"GET","resourceType":"image"},{"origin":"https://bat.bing.com","pathnameHash":"7eaffe48a564a81f58f22b312e150f415a09a55e0e43bc496994fe6cc66006e8","hasQuery":false,"method":"GET","resourceType":"script"},{"origin":"https://bat.bing.com","pathnameHash":"adc25a5595151ef065d6c8ba52f0a99349f888f512e0d0f51ce0228c45c1f751","hasQuery":false,"method":"GET","resourceType":"script"},{"origin":"https://bat.bing.com","pathnameHash":"af2e5b14bf0d25f1f459be576daa1fbef86e9366e7fd1ca1e56127fd44c3f99d","hasQuery":false,"method":"GET","resourceType":"script"},{"origin":"https://ct.pinterest.com","pathnameHash":"6ddf53fbe5bf4b8b46a2d2e1822074b136334f829b8a2a7f54da52374f97ead3","hasQuery":false,"method":"GET","resourceType":"script"},{"origin":"https://googleads.g.doubleclick.net","pathnameHash":"bffd482f876a96b98b86aa8a3c95d40db747b90f397e5f781ac964affd736ebc","hasQuery":true,"method":"GET","resourceType":"script"},{"origin":"https://i.etsystatic.com","pathnameHash":"933e89b27e04b26fa002db9ad1a027817071d289c3e773bed4529eb13fb7d34f","hasQuery":true,"method":"GET","resourceType":"image"},{"origin":"https://js.adsrvr.org","pathnameHash":"c202281b629cf7667e6f72ddcf10fb07cedb3779ed468101595656a95d47e9fa","hasQuery":false,"method":"GET","resourceType":"script"},{"origin":"https://pt.ispot.tv","pathnameHash":"3f16679dbe7d48c5a8c05d35b8dc0aac495b463617bbbe87548705fe88ddefba","hasQuery":true,"method":"GET","resourceType":"image"},{"origin":"https://res4.applovin.com","pathnameHash":"01c6551d66b4449affd8653772e4289b5aec6b18e19372ed507e587827c9df80","hasQuery":false,"method":"GET","resourceType":"script"},{"origin":"https://res4.applovin.com","pathnameHash":"2bf4ce6b5837f8d213bd4ca6c076032be5c9304fcc2f57a476d88931c66ede83","hasQuery":false,"method":"GET","resourceType":"script"},{"origin":"https://res4.applovin.com","pathnameHash":"3d41e2079c01e8f7771f400d9043d1f013edcd507fde50020e2ef14b53e0e9cb","hasQuery":false,"method":"GET","resourceType":"script"},{"origin":"https://s.axon.ai","pathnameHash":"c0ab38910d5751850f170d1eb653b414ac6497ed14583763100101a92288c11d","hasQuery":false,"method":"GET","resourceType":"script"},{"origin":"https://s.pinimg.com","pathnameHash":"78cb606e22059f7c4822569b8de5a1ae639d4ae3bc44dff30435dac5b4118d96","hasQuery":false,"method":"GET","resourceType":"script"},{"origin":"https://s.pinimg.com","pathnameHash":"84b6b3a4f81048a23e7fd5cabbce80121ba7c929ffc3671689f4453e9124b819","hasQuery":false,"method":"GET","resourceType":"script"},{"origin":"https://sierra.chat","pathnameHash":"c66e52b17d06cdd39f799f8b96edab20a7dc836a1b4ed095ea7d32ed4ac4e3f1","hasQuery":false,"method":"GET","resourceType":"script"},{"origin":"https://tr.snapchat.com","pathnameHash":"c7ac0c9fafd683ccc23298d969c8b44d195986005cd9a884f90f6c0c5d522b27","hasQuery":true,"method":"GET","resourceType":"image"},{"origin":"https://web.btncdn.com","pathnameHash":"716f98a03b439b43244533cb8a2e9f003c7ab63ff38cacdaf9e386df4b504066","hasQuery":false,"method":"GET","resourceType":"script"},{"origin":"https://www.facebook.com","pathnameHash":"6e5a047b111e0ba381c9e1cc34187dea1daa6bc9f6642b44a173febacbf8c698","hasQuery":true,"method":"GET","resourceType":"image"},{"origin":"https://www.googletagmanager.com","pathnameHash":"44175c8c26dd92b745294ead1e46dce3eff132d7f00ada5a7e28f6d3e80e1a8f","hasQuery":true,"method":"GET","resourceType":"script"},{"origin":"https://www.googletagmanager.com","pathnameHash":"51d356b3c50108af4259c7b486633073deb9e89f32f2827407bd9c973a3b9a84","hasQuery":true,"method":"GET","resourceType":"script"},{"origin":"https://www.googletagmanager.com","pathnameHash":"f205bd21081d28e445916c2f3a53076b9d3c8ad78a9b16866f624f19b09fef11","hasQuery":true,"method":"GET","resourceType":"script"}]}'::jsonb $manifest$;
create function private.r12_candidate_policy(p jsonb) returns void language plpgsql set search_path='' as $$
declare m jsonb:=private.r12_candidate_manifest();field text;item jsonb;begin
 perform private.r04_safe(p);perform private.r04_keys(p,array['version','purpose','maximumRequests','navigation','sameOrigin','post','extraction','provenanceHash','allowedImages','blockedCandidates']);
 if p->>'version' is distinct from 'etsy.insights-renderer-candidate-policy.3' or p->>'purpose' is distinct from 'etsy_insights_verify_only'
 or p->>'navigation' is distinct from 'fixed_insights_get_only' or p->>'sameOrigin' is distinct from 'renderer_get_only' or p->>'post' is distinct from 'denied' or p->>'extraction' is distinct from 'visible_landing_readiness_only'
 or private.stage14_hash(m) is distinct from '612ef724d56e73e0e4a0dbe98d0606091d973af6420b3deef065b740ad80bc5f' or p->>'provenanceHash' is distinct from private.stage14_hash(m)
 or jsonb_typeof(p->'maximumRequests') is distinct from 'number' or coalesce(p->>'maximumRequests','')!~'^[1-9][0-9]{0,2}$' or (p->>'maximumRequests')::integer>512
 then raise exception 'r12_candidate_policy_unqualified';end if;
 foreach field in array array['allowedImages','blockedCandidates'] loop
 if jsonb_typeof(p->field) is distinct from 'array' or jsonb_array_length(p->field)>64 or (select count(distinct private.stage14_hash(x)) from jsonb_array_elements(p->field) x)<>jsonb_array_length(p->field) then raise exception 'r12_candidate_policy_unqualified';end if;
 for item in select value from jsonb_array_elements(p->field) loop
 perform private.r04_keys(item,array['origin','pathnameHash','hasQuery','method','resourceType']);
 if not exists(select 1 from jsonb_array_elements(m->field) x where x.value=item) then raise exception 'r12_candidate_reference_unobserved';end if;
 end loop;end loop;
end $$;
create function private.r12_candidate_review(id text,route text,project uuid,active_required boolean default true) returns private.r12_verification_candidate_reviews language plpgsql set search_path='' as $$
declare r private.r12_verification_candidate_reviews;c jsonb;begin
 select * into strict r from private.r12_verification_candidate_reviews where review_hash=id;c:=r.content;
 perform private.r04_safe(c);perform private.r04_keys(c,array['version','purpose','routeHash','providerProjectId','policy','policyHash','landingControlsVersion','landingControlsHash','validFrom','validUntil']);perform private.r12_candidate_policy(c->'policy');
 if r.review_hash is distinct from private.stage14_hash(c) or r.route_hash is distinct from route or r.provider_project_id is distinct from project
 or c->>'version' is distinct from 'r12.insights-verification-candidate-review.3' or c->>'purpose' is distinct from 'etsy_insights_verify_only'
 or c->>'routeHash' is distinct from route or c->>'providerProjectId' is distinct from project::text or c->>'policyHash' is distinct from r.policy_hash
 or c->>'landingControlsVersion' is distinct from 'etsy.insights-landing-controls.2' or c->>'landingControlsHash' is distinct from '0ee4c99ed0b65e3efd499cadf1059613311df10d815db1892ef03efa167c5d7b'
 or (c->>'validFrom')::timestamptz is distinct from r.valid_from or (c->>'validUntil')::timestamptz is distinct from r.valid_until
 then raise exception 'r12_candidate_review_unqualified';end if;
 if active_required and (r.valid_from>clock_timestamp() or r.valid_until<=clock_timestamp() or exists(select 1 from private.r12_verification_candidate_revocations x where x.review_hash=r.review_hash)) then raise exception 'r12_landing_review_inactive';end if;
 return r;
end $$;
-- A route review is selected once, when the immutable setup is prepared. Its
-- exact hash is part of the owner's single approval; later reviews cannot
-- silently upgrade an existing setup or its saved verification.
create table private.r12_candidate_setup_reviews(
 operation_id uuid primary key references private.r12_etsy_steel_setups(operation_id),
 review_hash text not null references private.r12_verification_candidate_reviews(review_hash),
 content jsonb not null,content_hash text not null unique check(content_hash=private.stage14_hash(content)));
create table private.r12_candidate_setup_approvals(
 operation_id uuid primary key references private.r12_candidate_setup_reviews(operation_id),
 content jsonb not null,content_hash text not null unique check(content_hash=private.stage14_hash(content)));
do $$ declare n text;begin foreach n in array array['r12_candidate_setup_reviews','r12_candidate_setup_approvals'] loop
 execute format('alter table private.%I enable row level security',n);execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);
 execute format('create trigger r12_candidate_immutable before insert or update or delete on private.%I for each row execute function private.r05_guard()',n);
end loop;end $$;
create function private.r12_candidate_bind_setup(operation uuid) returns void language plpgsql set search_path='' as $$
declare s private.r12_etsy_steel_setups;e private.r12_direct_test_envelopes;route private.r12_direct_browser_routes;r private.r12_verification_candidate_reviews;selected text;n integer;body jsonb;begin
 select * into strict s from private.r12_etsy_steel_setups where operation_id=operation;select * into strict e from private.r12_direct_test_envelopes where id=s.envelope_id;select * into strict route from private.r12_direct_browser_routes where route_hash=s.route_hash;
 select count(*),min(x.review_hash) into n,selected from private.r12_verification_candidate_reviews x where x.route_hash=s.route_hash and x.valid_from<=clock_timestamp() and x.valid_until>clock_timestamp() and not exists(select 1 from private.r12_verification_candidate_revocations z where z.review_hash=x.review_hash);
 if n=0 then
 if exists(select 1 from private.r12_verification_candidate_reviews x where x.route_hash=s.route_hash) then raise exception 'r12_landing_review_inactive';end if;return;end if;
 if n<>1 then raise exception 'r12_candidate_review_ambiguous';end if;
 r:=private.r12_candidate_review(selected,s.route_hash,route.provider_project_id);
 body:=jsonb_build_object('version','etsy.steel-setup-renderer-review.1','operationId',s.operation_id,'businessId',s.business_id,'ownerId',s.owner_id,'scopeHash',s.scope_hash,'disclosureHash',s.disclosure_hash,'approvalRevision',s.approval_revision,'reviewHash',r.review_hash,'policyVersion',r.content->'policy'->>'version','policyHash',r.policy_hash,'landingControlsVersion',r.content->'landingControlsVersion','landingControlsHash',r.content->'landingControlsHash','expiresAt',private.r12_direct_time(least(r.valid_until,route.valid_until,e.expires_at,s.profile_expires_at)));
 insert into private.r12_candidate_setup_reviews values(operation,r.review_hash,body,private.stage14_hash(body));
end $$;
create function private.r12_candidate_setup_check(operation uuid,require_approved boolean default true,active_required boolean default true) returns private.r12_verification_candidate_reviews language plpgsql set search_path='' as $$
declare s private.r12_etsy_steel_setups;e private.r12_direct_test_envelopes;route private.r12_direct_browser_routes;m private.r12_candidate_setup_reviews;a private.r12_candidate_setup_approvals;approval private.r12_etsy_steel_approvals;r private.r12_verification_candidate_reviews;expected jsonb;begin
 select * into strict s from private.r12_etsy_steel_setups where operation_id=operation;select * into m from private.r12_candidate_setup_reviews where operation_id=operation;
 if m.operation_id is null then return null;end if;
 select * into strict e from private.r12_direct_test_envelopes where id=s.envelope_id;select * into strict route from private.r12_direct_browser_routes where route_hash=s.route_hash;
 r:=private.r12_candidate_review(m.review_hash,s.route_hash,route.provider_project_id,false);
 expected:=jsonb_build_object('version','etsy.steel-setup-renderer-review.1','operationId',s.operation_id,'businessId',s.business_id,'ownerId',s.owner_id,'scopeHash',s.scope_hash,'disclosureHash',s.disclosure_hash,'approvalRevision',s.approval_revision,'reviewHash',r.review_hash,'policyVersion',r.content->'policy'->>'version','policyHash',r.policy_hash,'landingControlsVersion',r.content->'landingControlsVersion','landingControlsHash',r.content->'landingControlsHash','expiresAt',private.r12_direct_time(least(r.valid_until,route.valid_until,e.expires_at,s.profile_expires_at)));
 if m.content is distinct from expected or m.content_hash is distinct from private.stage14_hash(expected) or s.scope->>'providerProjectId' is distinct from route.provider_project_id::text then raise exception 'r12_candidate_setup_review_changed';end if;
 select * into a from private.r12_candidate_setup_approvals where operation_id=operation;
 if require_approved or a.operation_id is not null then
 select * into approval from private.r12_etsy_steel_approvals where operation_id=operation;
 expected:=expected||jsonb_build_object('version','etsy.steel-setup-renderer-approval.1','setupReviewHash',m.content_hash,'approvedBy',s.owner_id,'approvedAt',private.r12_direct_time(approval.created_at));
 if a.operation_id is null or approval.operation_id is null or approval.owner_id is distinct from s.owner_id or approval.scope_hash is distinct from s.scope_hash or approval.disclosure_hash is distinct from s.disclosure_hash or approval.approval_revision is distinct from s.approval_revision or a.content is distinct from expected or a.content_hash is distinct from private.stage14_hash(expected) then raise exception 'r12_candidate_owner_approval_required';end if;
 end if;
 if active_required then
 perform private.r12_candidate_review(m.review_hash,s.route_hash,route.provider_project_id,true);
 if (m.content->>'expiresAt')::timestamptz<=clock_timestamp() then raise exception 'r12_landing_review_inactive';end if;
 end if;
 return r;
end $$;
-- Preserve the public function OID, argument names, ACL and response shape.
do $$ declare src text;header text:='CREATE OR REPLACE FUNCTION public.r12_etsy_steel_owner(';begin
 src:=pg_get_functiondef('public.r12_etsy_steel_owner(uuid,text,jsonb)'::regprocedure);
 if strpos(src,header)<>1 then raise exception 'r12_candidate_owner_delegate_header_changed';end if;
 execute overlay(src placing 'CREATE OR REPLACE FUNCTION private.r12_candidate_owner_before_review(' from 1 for length(header));
end $$;
create or replace function public.r12_etsy_steel_owner(p_business_id uuid,p_operation text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.r12_etsy_steel_setups;m private.r12_candidate_setup_reviews;a private.r12_etsy_steel_approvals;body jsonb;result jsonb;begin
 if p_operation<>'approve' then return private.r12_candidate_owner_before_review(p_business_id,p_operation,p_payload);end if;
 perform private.r05_owner(p_business_id);
 select * into s from private.r12_etsy_steel_setups where operation_id=(p_payload->>'operationId')::uuid and business_id=p_business_id and owner_id=auth.uid();
 if s.operation_id is null then raise exception 'etsy_handoff_owner_required' using errcode='42501';end if;
 select * into m from private.r12_candidate_setup_reviews where operation_id=s.operation_id;
 if m.operation_id is null then return private.r12_candidate_owner_before_review(p_business_id,p_operation,p_payload);end if;
 perform private.r04_keys(p_payload,array['operationId','scopeHash','disclosureHash','expectedApprovalRevision','persistentAccessApproved','budgetApproved','rendererReviewHash']);
 if p_payload->>'rendererReviewHash' is distinct from m.review_hash then raise exception 'r12_candidate_owner_review_changed';end if;
 perform private.r12_candidate_setup_check(s.operation_id,false,true);
 result:=private.r12_candidate_owner_before_review(p_business_id,p_operation,p_payload-'rendererReviewHash');
 select * into strict a from private.r12_etsy_steel_approvals where operation_id=s.operation_id;
 body:=m.content||jsonb_build_object('version','etsy.steel-setup-renderer-approval.1','setupReviewHash',m.content_hash,'approvedBy',s.owner_id,'approvedAt',private.r12_direct_time(a.created_at));
 insert into private.r12_candidate_setup_approvals values(s.operation_id,body,private.stage14_hash(body)) on conflict(operation_id) do nothing;
 perform private.r12_candidate_setup_check(s.operation_id,true,true);return result;
end $$;
create function public.r12_owner_etsy_steel_renderer_review(p_business_id uuid,p_operation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.r12_etsy_steel_setups;m private.r12_candidate_setup_reviews;e private.r12_direct_test_envelopes;r private.r12_direct_browser_routes;state text;result jsonb;begin
 perform private.r05_owner(p_business_id);
 select * into s from private.r12_etsy_steel_setups where operation_id=p_operation_id and business_id=p_business_id and owner_id=auth.uid();
 if s.operation_id is null then return null;end if;
 result:=jsonb_build_object('version','etsy.steel-owner-renderer-review.1','operationId',s.operation_id,'status','legacy','reviewHash',null,'policyVersion',null,'policyHash',null,'landingControlsVersion',null,'landingControlsHash',null,'purpose',null,'expiresAt',null,'sourceReadiness','unqualified');
 select * into m from private.r12_candidate_setup_reviews where operation_id=s.operation_id;if m.operation_id is null then return result;end if;
 -- Validate all immutable pins before classifying known inactivity.
 perform private.r12_candidate_setup_check(s.operation_id,false,false);
 state:=case when exists(select 1 from private.r12_candidate_setup_approvals where operation_id=s.operation_id) then 'approved' else 'awaiting_approval' end;
 begin perform private.r12_candidate_setup_check(s.operation_id,false,true);
 exception when raise_exception then if sqlerrm='r12_landing_review_inactive' then state:='inactive';else raise;end if;end;
 select * into strict e from private.r12_direct_test_envelopes where id=s.envelope_id;select * into strict r from private.r12_direct_browser_routes where route_hash=s.route_hash;
 if s.approval_expires_at<=clock_timestamp() or s.profile_expires_at<=clock_timestamp() or e.expires_at<=clock_timestamp() or r.valid_from>clock_timestamp() or r.valid_until<=clock_timestamp()
 or exists(select 1 from private.r12_etsy_steel_stops where operation_id=s.operation_id)
 or exists(select 1 from private.r12_etsy_steel_setups x where x.business_id=s.business_id and x.account_id=s.account_id and x.sequence>s.sequence)
 or exists(select 1 from private.r12_direct_test_revocations where envelope_id=e.id) or exists(select 1 from private.r12_direct_browser_route_revocations where route_hash=s.route_hash)
 or exists(select 1 from private.r05_revocations where policy_id=e.policy_id) or private.r05_paused(s.business_id,'business',s.business_id) or private.r05_paused(s.business_id,'quest',e.goal_id) then state:='inactive';end if;
 return result||jsonb_build_object('status',state,'reviewHash',m.review_hash,'policyVersion',m.content->'policyVersion','policyHash',m.content->'policyHash','landingControlsVersion',m.content->'landingControlsVersion','landingControlsHash',m.content->'landingControlsHash','purpose','etsy_insights_verify_only','expiresAt',m.content->'expiresAt');
end $$;
revoke all on function public.r12_owner_etsy_steel_renderer_review(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.r12_owner_etsy_steel_renderer_review(uuid,uuid) to authenticated;
-- Existing server prepare is the only sidecar producer. All active handoff and
-- verification stages recheck the selected owner approval through current().
-- Stop and admitted cleanup do not call current(), and remain reachable.
do $$ declare src text;old text:=$old$  return jsonb_build_object('operationId',operation_id,'scope',scope,'scopeHash',private.stage14_hash(scope),'disclosure',p_payload->'disclosure',$old$;begin
 src:=pg_get_functiondef('public.r12_etsy_steel_server(uuid,text,jsonb,text)'::regprocedure);
 if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'r12_candidate_prepare_patch_required';end if;
 execute replace(src,old,'  perform private.r12_candidate_bind_setup(operation_id);'||chr(10)||old);
 src:=pg_get_functiondef('private.r12_etsy_steel_current(uuid,boolean)'::regprocedure);old:=' return s;';
 if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'r12_candidate_current_patch_required';end if;
 execute replace(src,old,' perform private.r12_candidate_setup_check(s.operation_id,true,p_login);'||chr(10)||old);
 -- A saved binding is structurally checked by the proof validator before its
 -- active review is checked. Pending verification has no proof to validate.
 src:=pg_get_functiondef('public.r12_owner_etsy_steel_verification_read(uuid,uuid)'::regprocedure);
 old:=$old$if sqlerrm in ('etsy_handoff_authority_inactive','r12_direct_current_test_required') then$old$;
 if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'r12_candidate_owner_inactive_patch_required';end if;
 execute replace(src,old,$new$if sqlerrm in ('etsy_handoff_authority_inactive','r12_direct_current_test_required','r12_landing_review_inactive') then$new$);
end $$;
create function private.r12_candidate_qualification(operation uuid,active_required boolean default true) returns jsonb language plpgsql set search_path='' as $$
declare v private.r12_etsy_steel_verification_runs;s private.r12_etsy_steel_setups;selected private.r12_verification_candidate_selections;r private.r12_verification_candidate_reviews;q private.r12_direct_verification_renderer_qualifications;p jsonb;begin
 select * into strict v from private.r12_etsy_steel_verification_runs where operation_id=operation;select * into strict s from private.r12_etsy_steel_setups where operation_id=v.setup_operation_id;
 select * into strict selected from private.r12_verification_candidate_selections where operation_id=operation;
 r:=private.r12_candidate_setup_check(s.operation_id,true,false);
 if r.review_hash is distinct from selected.review_hash then raise exception 'r12_candidate_setup_selection_changed';end if;p:=r.content->'policy';
 select * into strict q from private.r12_direct_verification_renderer_qualifications where operation_id=operation;
 perform private.r04_keys(q.content,array['version','requestHash','qualificationHash','expiresAt','maximumRequests','policy','policyHash','landingControlsVersion','landingControlsHash']);
 if q.content->>'version' is distinct from 'r12.etsy-insights-renderer-qualification.2' or q.content->>'qualificationHash' is distinct from q.qualification_hash or q.qualification_hash is distinct from private.stage14_hash(q.content-'qualificationHash')
 or q.content->>'requestHash' is distinct from v.scope_hash or q.content->'policy' is distinct from p or q.content->>'policyHash' is distinct from r.policy_hash
 or q.content->'maximumRequests' is distinct from p->'maximumRequests' or jsonb_typeof(q.content->'expiresAt') is distinct from 'string' or coalesce(q.content->>'expiresAt','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' or (q.content->>'expiresAt')::timestamptz>least(v.expires_at,r.valid_until)
 or q.content->'landingControlsVersion' is distinct from r.content->'landingControlsVersion' or q.content->'landingControlsHash' is distinct from r.content->'landingControlsHash'
 then raise exception 'r12_candidate_saved_qualification_required';end if;
 if active_required then perform private.r12_candidate_review(selected.review_hash,s.route_hash,(s.scope->>'providerProjectId')::uuid);end if;
 return q.content;
end $$;
-- A candidate decision records either permission or a known blocked request.
-- Acknowledging a block never permits its network continuation.
create function private.r12_candidate_classify(policy jsonb,d jsonb) returns text language plpgsql set search_path='' as $$
declare identity jsonb;begin
 perform private.r12_candidate_policy(policy);
 if d->>'requestKind'='same_origin' then
 if d->>'url'!~'^https://www[.]etsy[.]com/' then raise exception 'r12_candidate_request_denied';end if;
 if d->'navigation'='true'::jsonb then
 if d->>'url' is distinct from 'https://www.etsy.com/your/shops/me/marketplace-insights' or d->>'method' is distinct from 'GET' or d->>'resourceType' is distinct from 'document' then raise exception 'r12_candidate_request_denied';end if;return 'allow';end if;
 if d->'navigation' is distinct from 'false'::jsonb then raise exception 'r12_candidate_request_denied';end if;
 return private.r12_direct_owner_renderer_classify(jsonb_build_object('version','etsy.insights-renderer-policy.1','staticOrigins','[]'::jsonb,'maximumRequests',policy->'maximumRequests','navigation','fixed_insights_get_only','sameOrigin','renderer_get_only','post','denied','extraction','visible_aggregate_dom_only'),d);
 elsif d->>'requestKind'='external' then
 if d->>'method' is distinct from 'GET' or d->'navigation' is distinct from 'false'::jsonb or d->>'resourceType' not in ('image','script') or jsonb_typeof(d->'hasQuery') is distinct from 'boolean' then raise exception 'r12_candidate_request_denied';end if;
 identity:=jsonb_build_object('origin',d->'origin','pathnameHash',d->'pathnameHash','hasQuery',d->'hasQuery','method',d->'method','resourceType',d->'resourceType');
 if policy->'allowedImages'@>jsonb_build_array(identity) and d->>'origin'='https://i.etsystatic.com' and d->>'resourceType'='image' and d->'hasQuery'='false'::jsonb then return 'allow';end if;
 if policy->'blockedCandidates'@>jsonb_build_array(identity) then return 'deny_candidate_ancillary';end if;
 end if;raise exception 'r12_candidate_request_denied';
end $$;
-- Copy the old implementation to a delegate, preserving the original OID and
-- named-argument interface so warm callers resolve the new dispatcher.
do $$ declare src text;header text:='CREATE OR REPLACE FUNCTION private.r12_direct_verification_renderer(';begin
 src:=pg_get_functiondef('private.r12_direct_verification_renderer(uuid,text,jsonb)'::regprocedure);
 if strpos(src,header)<>1 then raise exception 'r12_candidate_delegate_header_changed';end if;
 execute overlay(src placing 'CREATE OR REPLACE FUNCTION private.r12_verification_renderer_before_candidate(' from 1 for length(header));
end $$;
create or replace function private.r12_direct_verification_renderer(operation uuid,mode text,payload jsonb default '{}'::jsonb) returns jsonb language plpgsql set search_path='' as $$
declare v private.r12_etsy_steel_verification_runs;s private.r12_etsy_steel_setups;e private.r12_direct_test_envelopes;route private.r12_direct_browser_routes;
 q private.r12_direct_verification_renderer_qualifications;r private.r12_verification_candidate_reviews;selected text;body jsonb;d jsonb;disposition text;n integer;begin
 select * into strict v from private.r12_etsy_steel_verification_runs where operation_id=operation;select * into strict s from private.r12_etsy_steel_setups where operation_id=v.setup_operation_id;
 select * into q from private.r12_direct_verification_renderer_qualifications where operation_id=operation;
 if q.operation_id is not null and q.content->'policy'->>'version' is distinct from 'etsy.insights-renderer-candidate-policy.3' then
 if exists(select 1 from private.r12_candidate_setup_reviews where operation_id=s.operation_id) then raise exception 'r12_candidate_setup_selection_changed';end if;
 return private.r12_verification_renderer_before_candidate(operation,mode,payload);end if;
 r:=private.r12_candidate_setup_check(s.operation_id,true,true);
 if r.review_hash is null then return private.r12_verification_renderer_before_candidate(operation,mode,payload);end if;selected:=r.review_hash;
 s:=private.r12_etsy_steel_current(v.setup_operation_id,true);select * into strict e from private.r12_direct_test_envelopes where id=s.envelope_id;perform private.r12_direct_test_current(e.id);
 select * into strict route from private.r12_direct_browser_routes where route_hash=s.route_hash;
 if v.expires_at<=clock_timestamp() or not exists(select 1 from private.r05_reservations where request_id=v.request_id) then raise exception 'r12_candidate_authority_required';end if;
 if mode='qualify_renderer' then
 perform private.r04_keys(payload,array['operationId']);if payload->>'operationId' is distinct from operation::text then raise exception 'r12_candidate_operation_changed';end if;
 if q.operation_id is not null then return private.r12_candidate_qualification(operation);end if;
 r:=private.r12_candidate_review(selected,s.route_hash,route.provider_project_id);
 body:=jsonb_build_object('version','r12.etsy-insights-renderer-qualification.2','requestHash',v.scope_hash,'expiresAt',private.r12_direct_time(least(v.expires_at,r.valid_until,route.valid_until,e.expires_at)),'maximumRequests',r.content->'policy'->'maximumRequests','policy',r.content->'policy','policyHash',r.policy_hash,'landingControlsVersion',r.content->'landingControlsVersion','landingControlsHash',r.content->'landingControlsHash');
 body:=body||jsonb_build_object('qualificationHash',private.stage14_hash(body));
 insert into private.r12_verification_candidate_selections values(operation,r.review_hash,clock_timestamp());insert into private.r12_direct_verification_renderer_qualifications values(operation,body,body->>'qualificationHash',clock_timestamp());return body;end if;
 if q.operation_id is null then raise exception 'r12_candidate_saved_qualification_required';end if;body:=private.r12_candidate_qualification(operation);
 if (body->>'expiresAt')::timestamptz<=clock_timestamp() then raise exception 'r12_candidate_qualification_expired';end if;
 if mode='check' then return body;end if;
 if mode<>'admit_renderer' then raise exception 'r12_candidate_operation_invalid';end if;
 perform private.r04_keys(payload,array['operationId','request']);d:=payload->'request';perform private.r04_safe(d);
 perform private.r04_keys(d,array['version','operationId','requestId','scopeHash','qualificationHash','policyHash','provenanceHash','sequence','disposition','decisionHash','requestKind','method','resourceType','navigation']||case when d->>'requestKind'='same_origin' then array['url'] else array['origin','pathnameHash','hasQuery'] end);
 if payload->>'operationId' is distinct from operation::text or d->>'version' is distinct from 'etsy.insights-verification-renderer-request.3'
 or d->>'operationId' is distinct from operation::text or d->>'requestId' is distinct from v.request_id::text or d->>'scopeHash' is distinct from v.scope_hash
 or d->>'qualificationHash' is distinct from q.qualification_hash or d->'policyHash' is distinct from body->'policyHash' or d->'provenanceHash' is distinct from body->'policy'->'provenanceHash'
 or d->>'decisionHash' is distinct from private.stage14_hash(d-'decisionHash') or jsonb_typeof(d->'sequence') is distinct from 'number' or coalesce(d->>'sequence','')!~'^[1-9][0-9]{0,2}$'
 or not exists(select 1 from private.r12_etsy_steel_verification_dispatches where operation_id=operation)
 or exists(select 1 from private.r12_etsy_steel_verification_release where operation_id=operation)
 or exists(select 1 from private.r12_direct_browser_receipts where operation_id=operation)
 or exists(select 1 from private.r12_direct_browser_evidence where operation_id=operation and kind='release')
 then raise exception 'r12_candidate_decision_unqualified';end if;
 n:=(d->>'sequence')::integer;if n<>(select count(*)+1 from private.r12_direct_verification_renderer_requests where operation_id=operation) or n>(body->>'maximumRequests')::integer then raise exception 'r12_candidate_decision_replayed';end if;
 disposition:=private.r12_candidate_classify(body->'policy',d);if d->>'disposition' is distinct from disposition then raise exception 'r12_candidate_disposition_mismatch';end if;
 insert into private.r12_direct_verification_renderer_requests values(operation,n,d,private.stage14_hash(d),clock_timestamp());
 return jsonb_build_object('accepted',true,'allowed',disposition='allow','sequence',n,'disposition',disposition,'decisionHash',d->>'decisionHash','qualificationHash',q.qualification_hash,'policyHash',body->>'policyHash','provenanceHash',body->'policy'->>'provenanceHash');
end $$;
create function private.r12_candidate_verification_check(operation uuid,proof jsonb,accepting boolean default true) returns void language plpgsql set search_path='' as $$
declare v private.r12_etsy_steel_verification_runs;s private.r12_etsy_steel_setups;q private.r12_direct_verification_renderer_qualifications;p jsonb;begin
 select * into q from private.r12_direct_verification_renderer_qualifications where operation_id=operation;

 if proof->>'version' is distinct from 'etsy.steel-account-verification.2' then raise exception 'r12_landing_proof_version';end if;
 select * into strict v from private.r12_etsy_steel_verification_runs where operation_id=operation;
 select * into strict s from private.r12_etsy_steel_setups where operation_id=v.setup_operation_id;
 p:=private.r12_candidate_qualification(operation,false);
 perform private.r04_keys(q.content,array['version','requestHash','qualificationHash','expiresAt','maximumRequests','policy','policyHash','landingControlsVersion','landingControlsHash']);
 perform private.r04_keys(proof,array['version','operationId','setupOperationId','handoffId','profileBindingId','profileBindingRevision','providerProjectId','testEnvelopeId','testEnvelopeHash','profileId','sessionId','contextId','pageId','observedShopName','observedShopId','verifiedAt','expiresAt','accountIdentityVerified','insightsAccessVerified','visibleShopHref','canonicalUrl','insightsHeading','queryControlWitnessHash','documentEpoch','verifiedContextHash','verificationHash','landingControlsVersion','landingControlsHash']);
 if p is null
 or q.qualification_hash is distinct from private.stage14_hash(q.content-'qualificationHash') or q.content->>'qualificationHash' is distinct from q.qualification_hash
 or proof->>'verificationHash' is distinct from private.stage14_hash(proof-'verificationHash')
 or proof->>'verifiedContextHash' is distinct from private.stage14_hash(jsonb_build_object('version','etsy.steel-visible-account-context.2')||(proof-'version'-'expiresAt'-'accountIdentityVerified'-'insightsAccessVerified'-'verifiedContextHash'-'verificationHash'))
 or q.content->>'version' is distinct from 'r12.etsy-insights-renderer-qualification.2' or q.content->>'requestHash' is distinct from v.scope_hash
 or q.content->'policyHash' is distinct from p->'policyHash' or q.content->'policy' is distinct from p->'policy'
 or q.content->'landingControlsVersion' is distinct from p->'landingControlsVersion' or q.content->'landingControlsHash' is distinct from p->'landingControlsHash'
 or proof->'landingControlsVersion' is distinct from p->'landingControlsVersion' or proof->'landingControlsHash' is distinct from p->'landingControlsHash'
 or proof->>'queryControlWitnessHash' is distinct from '2a8a7e0a2a4d45abf0f4a71b4a5674006eaec9aa45b8d67c841ac4041131a435'
 or not exists(select 1 from private.r12_direct_verification_renderer_requests x where x.operation_id=operation and x.content->>'qualificationHash'=q.qualification_hash
 and x.content->>'version'='etsy.insights-verification-renderer-request.3' and x.content->>'requestKind'='same_origin' and x.content->>'decisionHash'=private.stage14_hash(x.content-'decisionHash') and x.content->'policyHash'=p->'policyHash' and x.content->'provenanceHash'=p->'policy'->'provenanceHash'
 and x.content->'navigation'='true'::jsonb and x.content->>'method'='GET' and x.content->>'resourceType'='document'
 and x.content->>'url'='https://www.etsy.com/your/shops/me/marketplace-insights' and coalesce(x.content->>'disposition','allow')='allow')
 then raise exception 'r12_landing_saved_qualification_required';end if;
 -- Schema and immutable hashes/pins are checked before ordinary inactivity,
 -- so a corrupt record cannot be disguised by revoking its review.
 perform private.r12_candidate_qualification(operation);
 -- A completed binding may outlive its short execution permit, but accepting
 -- a new proof still requires the current one-shot execution authority.
 if accepting then perform private.r12_direct_verification_renderer(operation,'check');end if;
end $$;

do $$ declare src text;header text:='CREATE OR REPLACE FUNCTION private.r12_landing_verification_check(';begin
 src:=pg_get_functiondef('private.r12_landing_verification_check(uuid,jsonb,boolean)'::regprocedure);
 if strpos(src,header)<>1 then raise exception 'r12_candidate_delegate_header_changed';end if;
 execute overlay(src placing 'CREATE OR REPLACE FUNCTION private.r12_landing_verification_before_candidate(' from 1 for length(header));
end $$;
create or replace function private.r12_landing_verification_check(operation uuid,proof jsonb,accepting boolean default true) returns void language plpgsql set search_path='' as $$
begin
 if exists(select 1 from private.r12_direct_verification_renderer_qualifications where operation_id=operation and content->'policy'->>'version'='etsy.insights-renderer-candidate-policy.3') then perform private.r12_candidate_verification_check(operation,proof,accepting);
 else
 if exists(select 1 from private.r12_candidate_setup_reviews m join private.r12_etsy_steel_verification_runs v on v.setup_operation_id=m.operation_id where v.operation_id=operation) then raise exception 'r12_candidate_setup_selection_changed';end if;
 perform private.r12_landing_verification_before_candidate(operation,proof,accepting);end if;
end $$;
-- Account identity is distinct from paid source readiness. This exact saved
-- candidate policy is verification-only until a later reviewed source extension.
create function private.r12_candidate_research_check(binding jsonb) returns void language plpgsql set search_path='' as $$
begin
 if exists(select 1 from private.r12_etsy_steel_verifications v join private.r12_direct_verification_renderer_qualifications q on q.operation_id=(v.verification->>'operationId')::uuid
 where v.binding=r12_candidate_research_check.binding and q.content->'policy'->>'version'='etsy.insights-renderer-candidate-policy.3') then raise exception 'r12_candidate_research_unqualified';end if;
end $$;
do $$ declare src text;old text:=$old$ s:=private.r12_etsy_steel_current(c.operation_id,false);$old$;replacement text:=$new$ s:=private.r12_etsy_steel_current(c.operation_id,false);
 perform private.r12_candidate_research_check(v.binding);$new$;begin
 src:=pg_get_functiondef('private.r12_direct_account_check(private.r12_direct_test_envelopes,jsonb,boolean)'::regprocedure);
 if (length(src)-length(replace(src,old,'')))/length(old)<>1 then raise exception 'r12_candidate_research_fence_patch_required';end if;execute replace(src,old,replacement);
end $$;
do $$ declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and (p.proname like 'r12_candidate_%' or p.proname in ('r12_verification_renderer_before_candidate','r12_landing_verification_before_candidate','r12_direct_verification_renderer','r12_landing_verification_check')) loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;end $$;
commit;
