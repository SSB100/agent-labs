/** Real legacy funding rows and owner/R07/R05/R12 calls; synthetic transport only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {prepareFourPlanEtsyFixture} from './helpers/r12-etsy-activation-fixture.mjs';
import {startAdaptivePlanner,bindAdaptivePlanner} from './helpers/r12-adaptive-postgres-races.mjs';
import {runEtsyAction} from './helpers/r12-etsy-runtime-fixture.mjs';
import {validateOwnerInitialRaceEnvironment} from './helpers/r12-owner-initial-postgres-races.mjs';
import {one,sha,ownerInitialRuntimeRpc} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {r12CatalogFixture} from './helpers/r12-provider-fixture.mjs';
import {qualifyAdaptiveResearchQuote} from '../.core-tests/products/discovery-r12-adaptive-quote.js';
import {preflightAdaptiveOwnerPlanner} from '../.core-tests/products/discovery-r12-adaptive-planner-preflight.js';
import {validateAdaptiveExecutionScope} from '../.core-tests/products/discovery-r12-adaptive-execution-scope.js';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),host=process.env.R12_SQL_TEST_HOST;
test('legacy funding proof reproduces genuine chained approvals without rewriting old scope or snapshot hashes',
 {skip:!host&&process.env.R12_REQUIRE_POSTGRES!=='1',timeout:240000},async()=>{
 assert.ok(host,'Pinned SQL test host required');
 const req=createRequire(path.resolve(host,'package.json'));let db;
 if(process.env.R12_REQUIRE_POSTGRES==='1')assert.ok(process.env.R12_POSTGRES_URL,'Native PostgreSQL required by gate');
 if(process.env.R12_POSTGRES_URL){
  const target=validateOwnerInitialRaceEnvironment(process.env),{Client}=req('pg');db=new Client({connectionString:process.env.R12_POSTGRES_URL});
  await db.connect();db.exec=sql=>db.query(sql);db.close=()=>db.end();
  assert.deepEqual(await one(db,'select current_user actor,current_database() db,host(inet_server_addr()) address'),{actor:'r12_test',db:'r12_test',address:target.address});
  assert.equal(Number((await db.query("select count(*) from pg_tables where schemaname in ('public','private')")).rows[0].count),0,'Fresh disposable database required');
 }else{const {PGlite}=req('@electric-sql/pglite'),{pgcrypto}=req('@electric-sql/pglite/contrib/pgcrypto');db=new PGlite({extensions:{pgcrypto}});}
 const originalFetch=globalThis.fetch;let networkCalls=0;
 globalThis.fetch=async()=>{networkCalls++;throw Error('External transport forbidden in funding qualification');};
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const file of readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())await db.exec(readFileSync(path.join(root,'supabase/migrations',file),'utf8'));
  assert.deepEqual(await one(db,`select has_function_privilege('authenticated','private.r12_adaptive_funding_proof(uuid)','EXECUTE') helper,
   has_function_privilege('anon','private.r12_discovery_server_before_funding_proof(uuid,uuid,text,jsonb,text)','EXECUTE') bypass,
   has_function_privilege('authenticated','private.r12_discovery_owner_read_before_funding_proof(uuid,uuid,boolean)','EXECUTE') owner_bypass`),
   {helper:false,bypass:false,owner_bypass:false});
  const x=await prepareFourPlanEtsyFixture(db,{legacy:{committedMicrounits:1900000}});
  assert.ok(x.catalog.funding.revision>0,'Four genuine legacy-root plans produce a persisted historical funding revision');
  const before=await one(db,`select (select count(*)::int from private.r12_owner_funding_revisions where binding_id=$1) revisions,
   (select private.stage14_hash(jsonb_agg(to_jsonb(p) order by p.version)) from private.r07_plans p where goal_id=$2) plans`,[x.f.bindingId,x.f.goalId]);
  const fundingBinding=(await one(db,'select binding_id from private.r12_adaptive_setups where id=$1',[x.prepared.setupId])).binding_id;
  // Reproduce the exact historical .1 mode used by the native race gate,
  // over these same genuine predecessors. No marker survives the rollback.
  await db.exec('begin');
  const oldProfile={...x.f.profile,version:'r12.owner-research-profile.2',id:randomUUID(),maximumRunMicrousd:10000000};
  const oldHash=hash(oldProfile),oldGrant=randomUUID(),oldKey='inert-legacy-funding-'+randomUUID();
  await db.query('insert into private.r12_owner_profiles(id,profile,profile_hash,pins,pins_hash) values($1,$2,$3,$4,$5)',
   [oldProfile.id,oldProfile,oldHash,x.f.pins,hash(x.f.pins)]);
  await db.query(`insert into private.r12_owner_bootstrap_grants(id,root_id,business_id,owner_id,business_revision,business_hash,
   profile_id,maximum_scopes,maximum_allocation_microunits,server_key_hash,approval_hash,valid_from,valid_until,
   adaptive_bounds,root_revision,root_revision_hash)
   select $1,root_id,business_id,owner_id,business_revision,business_hash,$2,maximum_scopes,maximum_allocation_microunits,
    $3,approval_hash,valid_from,valid_until,jsonb_set(adaptive_bounds,'{profileHash}',to_jsonb($4::text)),root_revision,root_revision_hash
   from private.r12_owner_bootstrap_grants where id=$5`,[oldGrant,oldProfile.id,sha(oldKey),oldHash,x.grantId]);
  const oldQuote=qualifyAdaptiveResearchQuote(r12CatalogFixture());
  const oldInput={...x.baseInput,profileId:oldProfile.id,profileHash:oldHash,grantId:oldGrant,ownerObservationRef:null,submissionId:randomUUID()};
  const oldPrepared=await x.f.rpc('r12_owner_adaptive_server',[x.f.businessId,'prepare',{input:oldInput,quote:oldQuote},oldKey]);
  const oldPacket=await x.f.rpc('r12_owner_adaptive_preflight',[x.f.businessId,oldPrepared.setupId,oldPrepared.setupHash,oldQuote]);
  const oldPreflight=await preflightAdaptiveOwnerPlanner(oldPacket,oldQuote);
  const oldConfirm={businessId:x.f.businessId,setupId:oldPrepared.setupId,setupHash:oldPrepared.setupHash,submissionId:randomUUID(),
   quote:oldQuote,preflight:oldPreflight,controllerKeyHash:sha('inert-adaptive-controller-'+oldPrepared.scopeId),
   admissionKeyHash:sha('inert-adaptive-admission-'+oldPrepared.scopeId)};
  const oldFixture={...x,prepared:oldPrepared,quote:oldQuote,confirm:()=>x.f.rpc('r12_owner_adaptive_server',[x.f.businessId,'confirm',oldConfirm,oldKey])};
  const oldStarted=await startAdaptivePlanner(db,oldFixture);
  assert.equal(oldStarted.raw.scope.version,'r12.discovery-owner-adaptive.1');
  assert.equal(oldStarted.raw.fundingProof.approvalRevision.revision,oldStarted.raw.fundingProof.currentRevision.revision+1);
  await bindAdaptivePlanner(db,oldFixture,oldStarted,{reserve:true,marker:true});
  assert.deepEqual((await ownerInitialRuntimeRpc(db,'r12_discovery_server',[x.f.businessId,oldStarted.context.attempt.id,'load',{},oldStarted.controller])).fundingProof,oldStarted.raw.fundingProof);
  await db.exec('rollback');
  // A smaller reviewed envelope can retain an existing positive legacy revision.
  // This branch uses genuine confirmation and is rolled back, not fabricated.
  await db.exec('begin');
  const amount=1000000;
  const unchanged=await x.prepare({maximumRunMicrounits:String(amount),
   businessLifetimeLimitMicrounits:String(Math.max(Number(x.catalog.business.currentLimitMicrounits),Number(x.catalog.business.committedMicrounits)+amount)),
   researchLifetimeLimitMicrounits:String(Math.max(Number(x.catalog.funding.currentLimitMicrounits),Number(x.catalog.funding.committedMicrounits)+amount))});
  assert.equal(unchanged.prepared.preview.funding.currentLimitMicrounits,unchanged.prepared.preview.funding.proposedLimitMicrounits);
  const same=await startAdaptivePlanner(db,{...x,...unchanged,confirm:()=>x.confirm(unchanged)});
  assert.deepEqual(same.raw.fundingProof.currentRevision,same.raw.fundingProof.approvalRevision);
  validateAdaptiveExecutionScope(same.raw.scope,same.raw.preview,Date.parse(same.raw.scope.createdAt),same.raw.fundingProof);
  await db.exec('rollback');

  const started=await startAdaptivePlanner(db,x),proof=started.raw.fundingProof,scope=started.raw.scope;
  assert.equal(proof.version,'r12.adaptive-funding-proof.1');assert.equal(proof.bindingId,fundingBinding);
  assert.equal(proof.ownerId,x.f.ownerId);assert.equal(proof.policyId,x.prepared.policyId);
  assert.equal(proof.scopeHash,hash(scope));assert.equal(proof.setupHash,x.prepared.setupHash);
  assert.equal(proof.currentRevision.revision,x.prepared.preview.funding.revision);
  assert.equal(hash(proof.currentRevision),x.prepared.preview.funding.bindingHash);
  assert.equal(hash(proof.approvalRevision),scope.fundingApproval.hash);
  assert.equal(proof.approvalRevision.revision,proof.currentRevision.revision+1);
  assert.equal(proof.approvalRevision.previousHash,x.prepared.preview.funding.bindingHash);
  assert.equal(proof.approvalRevision.committedMicrounits,x.prepared.preview.funding.committedMicrounits);
  assert.notEqual(scope.fundingApproval.hash,hash({bindingId:fundingBinding,revision:scope.fundingApproval.revision,maximumMicrounits:scope.fundingApproval.maximumMicrounits}));
  validateAdaptiveExecutionScope(scope,started.raw.preview,Date.parse(scope.createdAt),proof);
  assert.throws(()=>validateAdaptiveExecutionScope(scope,started.raw.preview,Date.parse(scope.createdAt)),/funding_proof_unverified/);
  const activation=await x.f.rpc('r12_discovery_owner_read',[x.f.businessId,scope.id,true]);
  assert.deepEqual(activation.activation.fundingProof,proof);
  const load=()=>ownerInitialRuntimeRpc(db,'r12_discovery_server',[x.f.businessId,started.context.attempt.id,'load',{},started.controller]);
  await assert.rejects(load(),/r12_reservation_required/);
  const stored=await one(db,'select content,content_hash from private.r12_adaptive_input_snapshots where attempt_id=$1',[started.context.attempt.id]);
  assert.equal(stored.content.fundingProof,undefined,'Sidecar never changes the saved request-time snapshot');
  const {fundingProof:ignored,...savedInput}=started.raw;void ignored;assert.deepEqual(stored.content,savedInput);
  const immutable=await one(db,`select (select to_jsonb(s) from private.r12_discovery_scopes s where s.id=$1) scope,
   (select to_jsonb(s) from private.r12_adaptive_setups s where s.scope_id=$1) setup,
   (select to_jsonb(i) from private.r12_adaptive_input_snapshots i where i.attempt_id=$2) snapshot`,[scope.id,started.context.attempt.id]);
  for(let n=0;n<2;n++){
   assert.deepEqual((await x.f.rpc('r12_discovery_owner_read',[x.f.businessId,scope.id,true])).activation.fundingProof,proof);
   assert.deepEqual((await ownerInitialRuntimeRpc(db,'r12_discovery_server',[x.f.businessId,started.context.attempt.id,'inputs',{},started.controller])).fundingProof,proof);
  }
  await assert.rejects(ownerInitialRuntimeRpc(db,'r12_discovery_server',[x.f.businessId,started.context.attempt.id,'inputs',{fundingProof:proof},started.controller]),error=>{assert.equal(error.message,'r04_invalid_fields');return true;});
  assert.deepEqual(await one(db,`select (select to_jsonb(s) from private.r12_discovery_scopes s where s.id=$1) scope,
   (select to_jsonb(s) from private.r12_adaptive_setups s where s.scope_id=$1) setup,
   (select to_jsonb(i) from private.r12_adaptive_input_snapshots i where i.attempt_id=$2) snapshot`,[scope.id,started.context.attempt.id]),immutable);
  await db.exec('begin');
  const late=await runEtsyAction(db,x,started,{stopAfterResponse:true,onFirstPost:async()=>{
   await x.f.rpc('r12_owner_adaptive_server',[x.f.businessId,'stop',{businessId:x.f.businessId,setupId:x.prepared.setupId,setupHash:x.prepared.setupHash,submissionId:randomUUID()},'']);
  }});
  assert.equal(late.posts,1);assert.equal(late.gets,1);
  assert.deepEqual((await load()).fundingProof,proof,'Ordinary Stop preserves authenticated funding provenance for the marked receipt');
  assert.deepEqual((await ownerInitialRuntimeRpc(db,'r12_discovery_server',[x.f.businessId,started.context.attempt.id,'inputs',{},started.controller])).fundingProof,proof);
  await db.exec('rollback');
  const complete=await runEtsyAction(db,x,started,{nextKind:'followup'});
  assert.deepEqual(complete.phases,['plan','strategy','review']);assert.equal(complete.posts,3);assert.equal(complete.gets,3);
  assert.deepEqual((await load()).fundingProof,proof);
  assert.equal((await one(db,'select count(*)::int n from private.r12_owner_funding_revisions where binding_id=$1',[fundingBinding])).n,before.revisions+1);
  assert.equal((await one(db,'select private.stage14_hash(jsonb_agg(to_jsonb(p) order by p.version)) hash from private.r07_plans p where goal_id=$1 and version<=4',[x.f.goalId])).hash,before.plans);
  assert.equal(networkCalls,0);
 }finally{globalThis.fetch=originalFetch;await db.close();}
});
