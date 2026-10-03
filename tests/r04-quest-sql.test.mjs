import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { r04SqlBootstrap } from './helpers/r04-sql-bootstrap.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Optional isolated PostgreSQL host; never reads credentials or a remote URL.
// PGlite has one backend: stale-CAS tests are real SQL, not parallel lock-contention proof.
const sql=file=>readFileSync(file,'utf8').replaceAll('\r\n','\n');
test('R04 full migration replay and real owner/immutability/version/lineage contract', {skip:!process.env.R04_SQL_TEST_HOST}, async(t)=>{
 const require=createRequire(path.resolve(process.env.R04_SQL_TEST_HOST,'package.json'));
 const {PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
 const db=new PGlite({extensions:{pgcrypto}});
 try {
 await db.exec(r04SqlBootstrap);
 const files=readdirSync(path.join(root,'supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();
 for(const file of files) {
  const source=sql(path.join(root,'supabase/migrations',file));
  if(file.endsWith('_r04_business_quest_identity.sql')) {
   const marker=' to authenticated;\ncommit;';assert.equal(source.split(marker).length,2);
   await assert.rejects(db.exec(source.replace(marker,' to r04_nonexistent_role;\ncommit;')));
   await db.exec('rollback');
   assert.equal((await db.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname like 'r04_%'")).rows[0].n,0,'Failed installation rolls back all new relations');
   assert.equal((await db.query("select count(*)::int n from pg_trigger where tgname='r04_managed_goal_guard'")).rows[0].n,0,'Failed installation leaves legacy goals unchanged');
  }
  await db.exec(source);
 }
 // Older SQL suites expect this named local qualification fixture. These are inert synthetic rows.
 await db.exec("insert into auth.users(id,email) values('94040000-0000-4000-8000-000000000301','r04-legacy-fixture@example.invalid'); insert into public.businesses(id,owner_user_id,name) values('94040000-0000-4000-8000-000000000302','94040000-0000-4000-8000-000000000301','Stage 9 Live Qualification');");
 // Offline SQL fixture only: no browser/provider is launched or live-qualified by this harness.
 await db.exec("update public.browser_provider_definitions set status='qualified',evaluation='{\"syntheticSqlFixture\":true}' where is_default;");
 const functions=(await db.query("select p.proname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('service_role',p.oid,'execute') service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'r04_%'")).rows;
 assert.equal(functions.length,3);
 for(const f of functions){assert.equal(f.prosecdef,true);assert.equal(f.anon,false);assert.equal(f.service,false);assert.ok(f.proconfig.includes('search_path=""'));}
 const tables=(await db.query("select c.relname,c.relrowsecurity,has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') access from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='r' and c.relname like 'r04_%'")).rows;
 assert.equal(tables.length,9);for(const t of tables){assert.equal(t.relrowsecurity,true);assert.equal(t.access,false);}
 const failures=[];
 const suites=readdirSync(path.join(root,'supabase/tests')).filter(f=>f.endsWith('.sql')&&f!=='r04_research_lineage.sql').sort();
 for(const file of suites) {
  try {
   let source=sql(path.join(root,'supabase/tests',file));
   if(file==='stage13_v2_shared_goal_budget.sql') {
    assert.equal([...source.matchAll(/rollback;\s*$/g)].length,1,'Lineage fixture must run before the exact final rollback');
    source=source.replace(/rollback;\s*$/,()=>sql(path.join(root,'supabase/tests/r04_research_lineage.sql'))+'\nrollback;');
   }
   if(file==='stage17_listing.sql') {
    // This older test seeds one administrative synthetic Printful receipt directly.
    // Later Stage15 requires a transaction admission even for admin fixture setup.
    // Scope it to that fixture block only; remove it before any tested source/owner checks.
    const start="insert into public.action_intents(id,business_id,action_type,capability,status,idempotency_key,created_by_type) values(intent,b,'printful.product.configure','printful.foundation','completed','stage17-source-probe','system');";
    const end='insert into listing_source_fixture values(input);';
    assert.equal(source.split(start).length,2);assert.equal(source.split(end).length,2);
    source=source.replace(start,()=>`insert into private.printful_product_mutation_admissions values(txid_current());\n${start}`)
      .replace(end,()=>`${end}\ndelete from private.printful_product_mutation_admissions where transaction_id=txid_current();`);
   }
   await db.exec(source);
  }
  catch(error) { failures.push(`${file}: ${error.message}\n${error.where ?? ''}\n${error.internalQuery ?? ''}`); await db.exec('rollback'); }
 }
 assert.equal(failures.length,0,`${suites.length} SQL suites attempted; failures:\n${failures.join('\n\n')}`);
 t.diagnostic(`${suites.length} SQL suites passed, including R04 lineage assertions inside the shared-budget fixture; no suites excluded.`);
 assert.equal((await db.query('select count(*)::int count from private.r04_submissions')).rows[0].count,0,'SQL fixtures must roll back');
 } finally {await db.close();}
});
