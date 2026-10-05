-- INERT isolated replay fixture only. Never applied by a migration or application request.
insert into auth.users(id,email) values
 ('99090000-0000-4000-8000-000000000001','r09-reviewer@example.invalid'),
 ('99090000-0000-4000-8000-000000000002','r09-outsider@example.invalid');
-- R09 intentionally has no installed producer keys, provider settings, or live reviews.
do $$ declare f record; begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'r09_%' loop
 if has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE') or has_function_privilege('service_role',f.oid,'EXECUTE') then raise exception 'r09_private_function_acl_leak'; end if;
 end loop;
 if (select count(*) from private.r09_reviews)<>0 or (select count(*) from private.r09_releases)<>0 then raise exception 'r09_unexpected_live_seed'; end if;
end $$;
