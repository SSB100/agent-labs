-- Catalog/ACL contract only; runtime fixtures are isolated in tests/r10-viewer-sql.test.mjs.
begin;
do $$ declare t text; f record; begin
 foreach t in array array['r10_server_keys','r10_enrollments','r10_writers','r10_close_audits'] loop
 if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname=t and c.relrowsecurity) then raise exception 'R10 RLS missing: %',t; end if;
 if has_table_privilege('anon','private.'||t,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated','private.'||t,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('service_role','private.'||t,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'R10 private table exposed: %',t; end if;
 end loop;
 for f in select p.oid,p.proname,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('private','public') and p.proname like 'r10_%' loop
 if has_function_privilege('service_role',f.oid,'EXECUTE') then raise exception 'R10 service role bypass: %',f.proname; end if;
 if f.nspname='private' and (has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE')) then raise exception 'R10 helper exposed: %',f.proname; end if;
 end loop;
end $$;
rollback;
