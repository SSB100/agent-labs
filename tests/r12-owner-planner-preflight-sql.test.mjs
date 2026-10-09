import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {ownerInitialSqlFixture,ownerInitialRpc,one} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {r12QuoteFixture} from './helpers/r12-provider-fixture.mjs';

const host=process.env.R12_SQL_TEST_HOST??process.env.R11_SQL_TEST_HOST;
test('owner planner preflight binds exact setup, current installation, and quote before initial confirmation',{skip:!host,timeout:120000},async()=>{
 const req=createRequire(path.resolve(host,'package.json')),{PGlite}=req('@electric-sql/pglite'),{pgcrypto}=req('@electric-sql/pglite/contrib/pgcrypto'),db=new PGlite({extensions:{pgcrypto}});
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  const f=await ownerInitialSqlFixture(db),setup=await f.prepare(),payload=f.confirmPayload(setup);
  const preflight=await f.rpc('r12_owner_research_preflight',[f.businessId,setup.setupId,setup.setupHash,payload.quote]);
  assert.equal(preflight.version,'r12.owner-planner-preflight-input.1');
  assert.equal(preflight.setupId,setup.setupId);
  assert.equal(preflight.scopeId,setup.scopeId);
  assert.equal(preflight.intent.comparisonUniverse.selectionQuestion,setup.preview.approvedQuery);
  assert.deepEqual(preflight.knowledgeSnapshot,f.pins.snapshot);
  assert.match(preflight.inputHash,/^[a-f0-9]{64}$/);
  await assert.rejects(ownerInitialRpc(db,randomUUID(),'r12_owner_research_preflight',[f.businessId,setup.setupId,setup.setupHash,payload.quote]),/r12_owner_required/);
  const counts=()=>one(db,`select (select count(*)::int from private.r05_confirmations where business_id=$1) confirmations,
   (select count(*)::int from private.r12_owner_activations where business_id=$1) activations,
   (select count(*)::int from private.r12_discovery_scopes where business_id=$1) scopes,
   (select count(*)::int from private.r05_cap_versions where business_id=$1) caps,
   (select count(*)::int from private.r07_heads where business_id=$1) heads`,[f.businessId]);
  const before=await counts();
  const {preflight:unused,...withoutPreflight}=payload;
  assert.ok(unused);
  await assert.rejects(f.server('confirm',withoutPreflight),/r12_owner_planner_preflight_required/);
  const receipt=payload.preflight;
  await assert.rejects(f.server('confirm',{...payload,preflight:{...receipt,requestBytes:12289}}),/r12_owner_planner_preflight_required/);
  await assert.rejects(f.server('confirm',{...payload,preflight:{...receipt,inputHash:'0'.repeat(64)}}),/r12_owner_planner_preflight_stale/);
  await assert.rejects(f.server('confirm',{...payload,quote:r12QuoteFixture(Date.now()-500)}),/r12_owner_planner_preflight_stale/);
  const installationId=(await one(db,'select installation_id from private.r12_owner_setups where id=$1',[setup.setupId])).installation_id;
  await db.query("update public.installed_packs set status='superseded',superseded_at=clock_timestamp() where id=$1",[installationId]);
  await assert.rejects(f.server('confirm',payload),/r12_owner_installation_changed/);
  await db.query("update public.installed_packs set status='active',superseded_at=null where id=$1",[installationId]);
  assert.deepEqual(await counts(),before,'Rejected preflights leave authority, allocation and cap unchanged');
  const activated=await f.server('confirm',payload);
  assert.equal(activated.activated,true);
  assert.equal((await f.server('confirm',payload)).setupId,setup.setupId);
  assert.equal((await f.server('confirm',withoutPreflight)).replayed,true,'Already activated submission replays without a new preflight');
 }finally{await db.close();}
});
