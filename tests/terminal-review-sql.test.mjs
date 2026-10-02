import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Use the existing isolated PGlite host, never a hosted/production connection.
// TERMINAL_REVIEW_SQL_TEST_HOST=/tmp/account-sql-runner node --test tests/terminal-review-sql.test.mjs
// PGlite is real PostgreSQL but one backend: this does NOT claim parallel lock-contention coverage.
test('terminal review isolated migration replay, ACL/RLS, rollback, no-mutation and real RPC regressions', {skip:!process.env.TERMINAL_REVIEW_SQL_TEST_HOST}, async()=>{
 const require=createRequire(path.resolve(process.env.TERMINAL_REVIEW_SQL_TEST_HOST,'package.json'));
 const {PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
 const db=new PGlite({extensions:{pgcrypto}});
 try {
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema extensions; create extension pgcrypto with schema extensions;
create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',aud text,role text,encrypted_password text,email_confirmed_at timestamptz,raw_app_meta_data jsonb,created_at timestamptz,updated_at timestamptz);
grant usage on schema auth to authenticated,anon,service_role; grant execute on function auth.uid() to authenticated,anon,service_role;
create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb default '{}',owner uuid,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated; grant select,insert,update,delete on storage.objects to anon,authenticated;
create publication supabase_realtime;
`);
 const files=readdirSync(path.join(root,'supabase/migrations')).filter(name=>name.endsWith('.sql')).sort();
 const filename=files.find(name=>name.endsWith('_terminal_creative_review_acknowledgement.sql'));
 for(const file of files.filter(name=>name!==filename)) await db.exec(readFileSync(path.join(root,'supabase/migrations',file),'utf8'));
 async function snapshot(){
  const relations=(await db.query("select n.nspname,c.relname,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind='r' order by 1,2")).rows;
  const rows={};
  for(const relation of relations)rows[relation.nspname+'.'+relation.relname]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) data from "${relation.nspname}"."${relation.relname}" t`)).rows[0].data;
  const functions=(await db.query("select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) identity,p.proowner,p.proacl,p.prosecdef,p.proconfig,p.prosrc,p.probin,p.provolatile,p.proleakproof,p.proisstrict,p.proretset,p.prorettype,p.proargtypes from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') order by 1,2,3")).rows;
  return {relations,rows,functions};
 }
 const before=await snapshot(),migration=readFileSync(path.join(root,'supabase/migrations',filename),'utf8');
 await assert.rejects(db.exec(migration.replace('to authenticated;', 'to terminal_nonexistent_role;')));
 assert.deepEqual(await snapshot(),before, 'ACL failure cannot leave a default PUBLIC-executable function');
 await db.exec('begin');await db.exec(migration);
 const after=await snapshot();
 assert.deepEqual(after.relations,before.relations);assert.deepEqual(after.rows,before.rows);
 assert.deepEqual(after.functions.filter(f=>f.proname!=='acknowledge_terminal_creative_review'),before.functions);
 assert.equal(after.functions.length,before.functions.length+1);
 await db.exec('rollback');assert.deepEqual(await snapshot(),before);
 await db.exec('begin');await db.exec(migration);await assert.rejects(db.exec('select 1/0'));await db.exec('rollback');assert.deepEqual(await snapshot(),before);
 await db.exec(migration);const baseline=await snapshot();
 for(const suite of ['terminal_creative_review_acknowledgement.sql','stage14_creative.sql','stage14_v2_decision_dispatch.sql']){
  await db.exec(readFileSync(path.join(root,'supabase/tests',suite),'utf8'));
  assert.deepEqual(await snapshot(),baseline,`${suite} must fully roll back synthetic fixtures`);
 }
 }finally{await db.close();}
});
