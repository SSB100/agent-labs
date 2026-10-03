import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sql=file=>readFileSync(file,'utf8').replaceAll('\r\n','\n');
test('R05 isolated full migration replay, rollback, finance and admission security',{skip:!process.env.R04_SQL_TEST_HOST},async t=>{
 const require=createRequire(path.resolve(process.env.R04_SQL_TEST_HOST,'package.json'));
 const {PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
 const db=new PGlite({extensions:{pgcrypto}});
 try{
 await db.exec(r04SqlBootstrap);
 for(const file of readdirSync(path.join(root,'supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()){
  const source=sql(path.join(root,'supabase/migrations',file));
  if(file.endsWith('_r05_operating_envelope.sql')){
   const old=(await db.query("select p.oid::regprocedure::text signature,md5(pg_get_functiondef(p.oid)) hash,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' order by p.oid")).rows;
   const marker=' to anon;\ncommit;';assert.equal(source.split(marker).length,2);
   await assert.rejects(db.exec(source.replace(marker,' to r05_no_such_role;\ncommit;')));await db.exec('rollback');
   assert.equal((await db.query("select count(*)::int n from pg_tables where schemaname='private' and tablename like 'r05_%'")).rows[0].n,0);
   await db.exec(source);
   const after=(await db.query("select p.oid::regprocedure::text signature,md5(pg_get_functiondef(p.oid)) hash,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' and p.proname not like 'r05_%' order by p.oid")).rows;
   assert.deepEqual(after,old,'Existing function bodies and grants remain byte-identical');
  }else await db.exec(source);
 }
 assert.equal((await db.query('select count(*)::int n from private.r05_server_keys')).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from private.r05_operations')).rows[0].n,0);
 const tables=(await db.query("select c.relname,c.relrowsecurity,has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') access from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='r' and c.relname like 'r05_%'")).rows;
 assert.ok(tables.length>=15);for(const table of tables){assert.equal(table.relrowsecurity,true);assert.equal(table.access,false);}
 try{await db.exec(sql(path.join(root,'supabase/tests/r05_operating_envelope.sql')));}catch(e){throw new Error(`${e.message}\n${e.where??''}\n${e.internalQuery??''}`);}
 for(const file of ['stage15_product_configuration.sql','stage18_etsy_publication.sql']) {
  const source=sql(path.join(root,'supabase/tests',file));assert.equal([...source.matchAll(/rollback;\s*$/g)].length,1);
  try{await db.exec(source.replace(/rollback;\s*$/,()=>sql(path.join(root,'supabase/tests/r05_existing_effect_readback.sql'))+'\nrollback;'));}
  catch(e){throw new Error(`${file}: ${e.message}\n${e.where??''}\n${e.internalQuery??''}`);}
 }
 await db.exec("insert into auth.users(id,email) values('95050000-0000-4000-8000-000000000991','r05-readonly@example.invalid'); insert into public.businesses(id,owner_user_id,name) values('95050000-0000-4000-8000-000000000992','95050000-0000-4000-8000-000000000991','R05 read-only fixture');");
 await db.exec("begin read only; set local role authenticated; select set_config('request.jwt.claim.sub','95050000-0000-4000-8000-000000000991',true); select public.r05_admission_read('95050000-0000-4000-8000-000000000992'); commit;");
 t.diagnostic('Actual SQL: owner/server/capability isolation, exact wire model/hash, immutable markers, replay, budgets, unknown readback, overage, revoke/pause, safe choices, DML fencing. Single PGlite backend is not a concurrency proof.');
 }finally{await db.close();}
});
