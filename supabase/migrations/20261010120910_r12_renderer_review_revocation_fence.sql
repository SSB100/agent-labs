-- Serialize revocation with the existing Business-locked paid admission gates.
-- No review or access is enrolled; cleanup remains outside current-review gates.
begin;
create function private.r12_renderer_review_lock_businesses(route text,qualification text default null) returns void language plpgsql set search_path='' as $$ begin
 -- Select by immutable envelope pins, not only an already-visible setup row:
 -- this includes a concurrently prepared setup whose sidecar is uncommitted.
 perform b.id from public.businesses b where exists(select 1 from private.r12_direct_test_envelopes e where e.business_id=b.id and e.content->'setupOperation'->>'routeHash'=route and (qualification is null or e.content->'researchPins'->>'executionReviewHash'=qualification)) order by b.id for update;
end $$;
create function private.r12_candidate_review_revocation_lock() returns trigger language plpgsql set search_path='' as $$
declare r private.r12_verification_candidate_reviews;begin
 select * into strict r from private.r12_verification_candidate_reviews where review_hash=new.review_hash;
 perform private.r12_renderer_review_lock_businesses(r.route_hash);return new;
end $$;
create trigger r12_candidate_revocation_business_lock before insert on private.r12_verification_candidate_revocations for each row execute function private.r12_candidate_review_revocation_lock();
revoke all on function private.r12_renderer_review_lock_businesses(text,text),private.r12_candidate_review_revocation_lock() from public,anon,authenticated,service_role;
-- Existing route, source and setup renderer reviews are equally authoritative
-- at paid gates. Their revocations must join the same Business-lock order.
create function private.r12_direct_review_revocation_lock() returns trigger language plpgsql set search_path='' as $$
declare route text;business uuid;begin
 if tg_table_schema<>'private' or tg_op<>'INSERT' then raise exception 'r12_review_revocation_target_invalid';end if;
 if tg_table_name in ('r12_direct_browser_route_revocations','r12_direct_owner_renderer_revocations','r12_direct_verification_renderer_revocations') then
  perform private.r12_renderer_review_lock_businesses(new.route_hash);
 elsif tg_table_name='r12_direct_source_qualification_revocations' then
  select route_hash into strict route from private.r12_direct_source_qualifications where qualification_hash=new.qualification_hash;
  perform private.r12_renderer_review_lock_businesses(route,new.qualification_hash);
 elsif tg_table_name='r12_direct_grant_review_revocations' then
  select g.business_id into strict business from private.r12_owner_bootstrap_grants g join private.r12_direct_grant_reviews r on r.grant_id=g.id where r.grant_id=new.grant_id;
  perform 1 from public.businesses where id=business for update;
 else raise exception 'r12_review_revocation_target_invalid';end if;return new;
end $$;
do $$ declare name text;begin
 foreach name in array array['r12_direct_browser_route_revocations','r12_direct_source_qualification_revocations','r12_direct_grant_review_revocations','r12_direct_owner_renderer_revocations','r12_direct_verification_renderer_revocations'] loop
  execute format('create trigger r12_review_revocation_business_lock before insert on private.%I for each row execute function private.r12_direct_review_revocation_lock()',name);
 end loop;
end $$;
revoke all on function private.r12_direct_review_revocation_lock() from public,anon,authenticated,service_role;
commit;
