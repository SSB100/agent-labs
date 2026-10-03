import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { r04SqlBootstrap } from './helpers/r04-sql-bootstrap.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = file => readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n');
const fingerprintFunctions = `select p.oid::text id,n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,
 pg_get_functiondef(p.oid) definition,p.proacl::text acl,p.proowner::text owner
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.prokind='f' order by p.oid`;
const fingerprintTables = `select c.oid::text id,n.nspname,c.relname,c.relacl::text acl,c.relowner::text owner,c.relrowsecurity,c.relforcerowsecurity
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','private') and c.relkind in ('r','p','v','m') order by c.oid`;

function populatedLaneAssertions(lane) {
  const publication = lane === 'publication';
  const prefix = publication ? '18000000' : '15000000';
  const table = publication ? 'etsy_publication_runs' : 'printful_product_runs';
  const dataset = publication ? 'publication_runs' : 'printful_runs';
  const fixture = publication ? 'publication_fixture' : 'product_fixture';
  return `
  reset role;
  select set_config('request.jwt.claim.sub','${prefix}-1111-4111-8111-000000000090',true);
  ${publication ? "do $$ begin for i in 100..224 loop perform pg_temp.seed_publication_source(i); end loop; end $$;" : ''}
  create temp table r06_lane_expected as select f.run target,(select count(*) from private.${table}) total,
    (select oi.id from public.owner_interventions oi join private.${table} r on r.action_intent_id=oi.action_intent_id and r.business_id=oi.business_id where r.id=f.run and oi.intervention_type='${publication ? 'etsy.publication.reconcile' : 'printful.product.reconcile'}' order by oi.requested_at desc,oi.id desc limit 1) intervention
    from ${fixture} f;
  grant select on r06_lane_expected to authenticated;
  insert into public.businesses(id,owner_user_id,name) values('${prefix}-1111-4111-8111-000000000094','${prefix}-1111-4111-8111-000000000090','R06 same-owner separate Business');
  set local role authenticated;
  do $$ declare b uuid:='${prefix}-1111-4111-8111-000000000002'; e r06_lane_expected%rowtype; p jsonb; begin
    select * into strict e from r06_lane_expected;
    assert e.total>0 and e.intervention is not null;
    p:=public.r06_read(b,'${dataset}',jsonb_build_object('limit',1,'query','unmatched R06 search','interventionId',e.intervention));
    assert p->>'total'='0' and p->'items'='[]';
    assert p->'selection'->>'status'='found' and p->'selection'->'item'->>'id'=e.target::text;
    p:=public.r06_read(b,'${dataset}','{"limit":1}');
    assert (p->>'total')::int=e.total and jsonb_array_length(p->'items')=1;
    p:=public.r06_read(b,'${dataset}',jsonb_build_object('offset',e.total+25,'selectedId',e.target));
    assert (p->>'total')::int=e.total and p->'items'='[]' and p->'selection'->>'status'='found';
    perform pg_temp.expect_error(format('select public.r06_read(%L,%L,%L::jsonb)','${prefix}-1111-4111-8111-000000000094','${dataset}',jsonb_build_object('interventionId',e.intervention)),'intervention_not_found');
    perform pg_temp.expect_error(format('select public.r06_read(%L,%L,%L::jsonb)',b,'${dataset}',jsonb_build_object('interventionId',e.intervention,'selectedId',gen_random_uuid())),'intervention_not_found');
    ${publication ? `p:=public.r06_read(b,'publication_drafts','{"limit":25}');
      assert (p->>'total')::int>=125 and jsonb_array_length(p->'items')=25 and p->>'hasNext'='true';
      p:=public.r06_read(b,'publication_drafts',jsonb_build_object('offset',(p->>'total')::int-1));
      assert jsonb_array_length(p->'items')=1 and p->>'hasNext'='false';` : ''}
  end $$;
  reset role;
  `;
}

const postgresRequired = process.env.R06_REQUIRE_POSTGRES === '1';
function isolatedPostgresUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('R06 PostgreSQL requires an explicit isolated loopback fixture URL'); }
  assert.ok(['postgres:','postgresql:'].includes(url.protocol) && ['127.0.0.1','[::1]'].includes(url.hostname)
    && url.pathname === '/r06_test' && decodeURIComponent(url.username) === 'r06_test' && !url.search && !url.hash,
  'R06 PostgreSQL is restricted to loopback, role r06_test, database r06_test, and no connection options');
  return url.href;
}
test('R06 PostgreSQL URL guard rejects non-loopback and non-fixture destinations before connecting', () => {
  assert.ok(isolatedPostgresUrl('postgresql://r06_test:fixture@127.0.0.1:5432/r06_test'));
  for (const value of ['postgresql://r06_test:fixture@db.example.com/r06_test','postgresql://r06_test:fixture@127.0.0.1/production',
    'postgresql://postgres:fixture@127.0.0.1/r06_test','postgresql://r06_test:fixture@localhost/r06_test',
    'postgresql://r06_test:fixture@127.0.0.1/r06_test?options=-csearch_path%3Dpublic','not-a-url']) assert.throws(() => isolatedPostgresUrl(value));
});
test('R06 replays all migrations without changing old functions/grants and passes real SQL history/isolation', {
  skip: !postgresRequired && !process.env.R06_POSTGRES_URL && !process.env.R06_SQL_TEST_HOST,
}, async t => {
  assert.ok(!postgresRequired || process.env.R06_POSTGRES_URL, 'R06_REQUIRE_POSTGRES=1 requires R06_POSTGRES_URL; no skip or PGlite fallback');
  const require = createRequire(path.resolve(process.env.R06_SQL_TEST_HOST ?? root, 'package.json'));
  let db, backend;
  if (process.env.R06_POSTGRES_URL) {
    // Only a newly provisioned loopback fixture is allowed. Never read a normal
    // application DATABASE_URL or permit a remote/provider database fallback.
    const connectionString = isolatedPostgresUrl(process.env.R06_POSTGRES_URL);
    const { Client } = require('pg');
    const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });
    await client.connect();
    db = { exec: text => client.query(text), query: (text, args) => client.query(text, args), close: () => client.end() };
    backend = 'PostgreSQL';
  } else {
    const { PGlite } = require('@electric-sql/pglite');
    const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
    db = new PGlite({ extensions: { pgcrypto } }); backend = 'PGlite';
  }
  try {
    if (backend === 'PostgreSQL') {
      const target = (await db.query(`select current_database() database,current_user role,
        exists(select 1 from pg_namespace where nspname in ('auth','private','storage')) has_fixture_schemas,
        exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','S')) has_public_data,
        exists(select 1 from pg_roles where rolname in ('anon','authenticated','service_role')) has_fixture_roles`)).rows[0];
      assert.deepEqual(target, { database: 'r06_test', role: 'r06_test', has_fixture_schemas: false, has_public_data: false, has_fixture_roles: false },
        'Use a fresh isolated R06 fixture database and cluster; existing schemas, data or role bindings are not overwritten');
    }
    await db.exec(r04SqlBootstrap);
    const files = readdirSync(path.join(root, 'supabase/migrations')).filter(file => file.endsWith('.sql')).sort();
    let oldFunctions, oldTables, replayed = 0;
    for (const file of files) {
      if (file.endsWith('_r06_bounded_reads.sql')) {
        oldFunctions = (await db.query(fingerprintFunctions)).rows;
        oldTables = (await db.query(fingerprintTables)).rows;
        // Rehearse a failed additive install after every function/grant/index has
        // executed but before COMMIT. Rollback must restore the exact old tree.
        const source = sql(`supabase/migrations/${file}`);
        assert.equal([...source.matchAll(/commit;\s*$/g)].length, 1);
        await assert.rejects(db.exec(source.replace(/commit;\s*$/, () => "do $$ begin raise exception 'r06_failed_install_rehearsal'; end $$;\ncommit;")), /r06_failed_install_rehearsal/);
        await db.exec('rollback;');
        assert.deepEqual((await db.query(fingerprintFunctions)).rows, oldFunctions, 'Failed R06 install restores every legacy function/grant/owner');
        assert.deepEqual((await db.query(fingerprintTables)).rows, oldTables, 'Failed R06 install restores every legacy relation ACL/RLS/owner');
        assert.equal((await db.query(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname in ('public','private') and p.proname like 'r06_%'`)).rows[0].n, 0, 'Failed R06 install leaves no R06 function');
        assert.equal((await db.query(`select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname in ('public','private') and c.relkind='i' and c.relname like 'r06_%'`)).rows[0].n, 0, 'Failed R06 install leaves no R06 index');
        t.diagnostic('Failed-install rollback rehearsal passed before applying the exact R06 source');
      }
      await db.exec(sql(`supabase/migrations/${file}`));
      replayed++;
    }
    assert.ok(oldFunctions?.length && oldTables?.length, 'R06 migration was included in full replay');
    const currentFunctions = new Map((await db.query(fingerprintFunctions)).rows.map(row => [row.id, row]));
    const currentTables = new Map((await db.query(fingerprintTables)).rows.map(row => [row.id, row]));
    for (const prior of oldFunctions) assert.deepEqual(currentFunctions.get(prior.id), prior, `Legacy function unchanged: ${prior.nspname}.${prior.proname}(${prior.args})`);
    for (const prior of oldTables) assert.deepEqual(currentTables.get(prior.id), prior, `Legacy relation ACL/RLS/owner unchanged: ${prior.nspname}.${prior.relname}`);

    const functions = (await db.query(`select p.proname,p.provolatile,p.prosecdef,p.proconfig,p.proowner=(select oid from pg_roles where rolname=current_user) reviewed_owner,
      has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
      has_function_privilege('service_role',p.oid,'EXECUTE') service
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='r06_read'`)).rows;
    assert.equal(functions.length, 1, 'One reviewed signature, no accidental overload');
    const f = functions[0];
    assert.equal(f.provolatile, 's'); assert.equal(f.prosecdef, true); assert.equal(f.reviewed_owner, true);
    assert.ok(f.proconfig.includes('search_path=""'));
    assert.equal(f.anon, false); assert.equal(f.authenticated, true); assert.equal(f.service, false);

    await db.exec(sql('supabase/tests/r06_bounded_reads.sql'));
    assert.equal((await db.query("select count(*)::int n from public.businesses where id::text like '96060000-%'")).rows[0].n, 0, 'History fixtures roll back');

    // Reuse the existing offline administrative fixtures in their own rollback
    // transactions. Their explicitly synthetic upstream stubs are never retained.
    for (const [file, lane] of [['stage15_product_configuration.sql','printful'], ['stage18_etsy_publication.sql','publication']]) {
      const source = sql(`supabase/tests/${file}`);
      assert.equal([...source.matchAll(/rollback;\s*$/g)].length, 1);
      await db.exec(source.replace(/rollback;\s*$/, () => `${populatedLaneAssertions(lane)}\nrollback;`));
    }
    const restoredFunctions = new Map((await db.query(fingerprintFunctions)).rows.map(row => [row.id, row]));
    for (const prior of oldFunctions) assert.deepEqual(restoredFunctions.get(prior.id), prior, 'Synthetic fixture helper replacements roll back');

    // A committed, isolated fixture lets every read execute in a real READ ONLY
    // transaction. This catches mutation-admission wrappers and FOR UPDATE paths.
    await db.exec(`insert into auth.users(id,email) values('96060000-0000-4000-8000-900000000090','r06-read-only@example.invalid');
      insert into public.businesses(id,owner_user_id,name) values('96060000-0000-4000-8000-900000000001','96060000-0000-4000-8000-900000000090','R06 read only');
      insert into private.account_setup_runs(id,business_id,owner_id,provider,mode,idempotency_key,connection_id,profile_revision,disclosure,disclosure_hash,status,approval_expires_at)
      values('96060000-0000-4000-8000-900000000101','96060000-0000-4000-8000-900000000001','96060000-0000-4000-8000-900000000090','etsy','connect','r06-readonly-fixture','96060000-0000-4000-8000-900000000201','96060000-0000-4000-8000-900000000202','{}',repeat('a',64),'pending_approval',clock_timestamp()+interval '1 hour');`);
    await db.exec(`begin read only; set local role authenticated; select set_config('request.jwt.claim.sub','96060000-0000-4000-8000-900000000090',true);`);
    const datasets = ['account_state','etsy_state','listing_state','account_runs','account_unresolved','account_health','etsy_runs','publication_runs','publication_drafts','printful_runs','printful_sources','listing_runs','listing_qualifications','etsy_packages','listing_sources','product_candidates','product_experiments','product_decisions','production_candidates'];
    for (const dataset of datasets) {
      const result = await db.query('select public.r06_read($1::uuid,$2,$3::jsonb) value', ['96060000-0000-4000-8000-900000000001', dataset, dataset === 'account_runs' ? '{"selectedId":"96060000-0000-4000-8000-900000000101"}' : '{}']);
      assert.ok(result.rows[0].value, `${dataset} works without mutation authority in a read-only transaction`);
    }
    await db.exec('rollback');
    for (const table of ['listing_mutation_admissions','etsy_publication_mutation_admissions','printful_product_mutation_admissions']) {
      assert.equal((await db.query(`select count(*)::int n from private.${table}`)).rows[0].n, 0, `${table} remains empty`);
    }
    t.diagnostic(`${backend}: ${replayed} migrations replayed; ${oldFunctions.length} legacy functions and ${oldTables.length} ACL/RLS definitions unchanged; ${datasets.length} datasets pass READ ONLY`);
  } finally { await db.close(); }
});
