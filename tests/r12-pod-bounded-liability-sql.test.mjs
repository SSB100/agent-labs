/** Isolated full-chain SQL qualification. Provider/termination/billing leaves are
 * synthetic test observations, never evidence about an actual Steel session. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {setupRecoveryFixture} from './helpers/r12-steel-setup-recovery-fixture.mjs';
import {podSqlFixture,podQuoteFixture,podPlannerPreflight,podRpc,podOne} from './helpers/r12-pod-sql-fixture.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),host=process.env.R12_SQL_TEST_HOST;
test('POD bounded liability requires existing proven termination, usage and tariff chain while retaining full R05 held money',{
 skip:!host,timeout:240000,
},async t=>{
 const require=createRequire(path.resolve(host,'package.json')),{PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
 const db=new PGlite({extensions:{pgcrypto}}),oldFetch=globalThis.fetch;let network=0;
 globalThis.fetch=async()=>{network++;throw Error('External provider traffic forbidden');};
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const file of readdirSync(root+'/supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(root+'/supabase/migrations/'+file,'utf8'));
  // This fixture uses genuine owner enrollment, confirmation, setup approval,
  // configuration admission and one marked synthetic transport reservation.
  const x=await setupRecoveryFixture(db),business=x.f.businessId,operation=x.setup.scope.operationId;
  const request=(await podOne(db,'select request_id from private.r12_direct_browser_operations where id=$1',[operation])).request_id;
  const source=(await podOne(db,'select source_key from private.r05_requests where id=$1',[request])).source_key;
  const state=async()=>podOne(db,`select
   (select jsonb_build_object('held',held::text,'unknown',unknown) from private.r05_exposure($1) where source_key=$2) raw,
   private.r12_pod_bounded_source($1,$2,1000) bounded,
   private.r12_pod_blocking_unknown($1) blocking,private.r12_pod_finance($1) finance,
   (select count(*)::int from private.r05_releases where request_id=$3) releases`,[business,source,request]);
  await x.stop();
  const baseline=await state();assert.deepEqual(baseline.raw,{held:'1000',unknown:true});assert.equal(baseline.bounded,false);assert.equal(baseline.blocking,true);
  await t.test('missing terminal/usage proof cannot qualify held exposure',async()=>{
   for(const key of ['providerTimeoutMs','durationMs','proxyBytesUsed','solveCaptcha']){
    const result=await x.recovery('record',{...x.pins,usage:{...x.usage,[key]:null}});assert.equal(result.status,'unknown');
    const current=await state();assert.equal(current.bounded,false);assert.equal(current.blocking,true);assert.deepEqual(current.raw,baseline.raw);assert.equal(current.releases,0);
   }
   assert.equal((await podOne(db,'select count(*)::int n from private.r12_steel_setup_recoveries where operation_id=$1',[operation])).n,0);
   await assert.rejects(x.bridge.ledger(operation,'reconcile',{releaseProofHash:'0'.repeat(64),usageProofHash:'1'.repeat(64),billingProofHash:null}),/release_proof_required|receipt/);
   assert.equal((await state()).blocking,true);
  });
  const recovered=await x.recovery('record',{...x.pins,usage:x.usage});
  const proof=(await podOne(db,'select content from private.r12_steel_setup_recoveries where operation_id=$1',[operation])).content;
  await t.test('exact no-handoff terminal proof qualifies bounded pending without inventing disposal or actual cost',async()=>{
   assert.equal(recovered.status,'qualified_bounded_pending');assert.equal(proof.localObserverDisposal,'unattested');assert.equal(Object.hasOwn(proof,'observersDisposed'),false);
   const current=await state();assert.equal(current.bounded,true);assert.equal(current.blocking,false);assert.deepEqual(current.raw,baseline.raw);assert.equal(current.releases,0);
   assert.equal(current.finance.hasUnknown,true);assert.equal(current.finance.hasBlockingUnknown,false);assert.equal(current.finance.boundedPendingMicrounits,'1000');
   assert.equal(BigInt(current.finance.committedMicrounits),BigInt(baseline.finance.committedMicrounits));
   assert.equal((await podOne(db,'select count(*)::int n from private.r05_settlements where request_id=$1',[request])).n,0);
  });
  await t.test('revoking exact route restores global POD blocking without removing hold',async()=>{
   await db.exec('begin');try{
    await db.query('insert into private.r12_direct_browser_route_revocations(route_hash) values($1)',[x.authority.routeHash]);
    const current=await state();assert.equal(current.bounded,false);assert.equal(current.blocking,true);assert.deepEqual(current.raw,baseline.raw);assert.equal(current.releases,0);
   }finally{await db.exec('rollback');}
   assert.equal((await state()).bounded,true);
  });
  // A new POD permission is separately reviewed and confirmed on the same
  // Business; no legacy stopped grant/root/unit is mapped or reactivated.
  const catalog=await podSqlFixture(db),content=structuredClone(catalog.content);
  const goal=await x.f.rpc('r04_quest_transition',[business,'quest.save',{goalId:null,expectedRevision:0,content},randomUUID()]);
  await x.f.rpc('r04_quest_transition',[business,'quest.preference',{goalId:goal.id,expectedRevision:1,preference:'ready'},randomUUID()]);
  const finance=(await state()).finance,quote=podQuoteFixture();
  const owner=(op,payload)=>podRpc(db,'authenticated',x.f.ownerId,'r12_pod_owner_server',[business,op,payload,catalog.bootstrapKey]);
  const prepare=()=>owner('prepare',{input:{...catalog.input,businessId:business,goalId:goal.id,submissionId:randomUUID(),
   businessLifetimeLimitMicrounits:String(BigInt(finance.maximumMicrounits)>BigInt(finance.committedMicrounits)+10000000n?BigInt(finance.maximumMicrounits):BigInt(finance.committedMicrounits)+10000000n)},quote});
  const prepared=await prepare();Object.defineProperty(prepared,'_preflight',{value:{quote,receipt:await podPlannerPreflight(prepared,quote)}});
  const confirmed=await owner('confirm',catalog.confirmPayload(prepared));assert.equal(confirmed.activated,true);
  const session=(await podOne(db,'select usage_identity_hash from private.r12_direct_browser_sessions where operation_id=$1',[operation])).usage_identity_hash;
  const bill=async amount=>{
   const e=await x.bridge.ledger(operation,'evidence',{kind:'billing',providerRecordId:'inert-pod-billing-'+randomUUID(),content:{operationId:operation,sessionId:operation,
    providerProjectId:x.setup.scope.providerProjectId,qualified:true,usageIdentityHash:session,tariffHash:x.authority.tariffHash,qualificationHash:x.authority.qualificationHash,currency:'USD',actualMicrounits:String(amount)}});
   return x.bridge.ledger(operation,'reconcile',{releaseProofHash:proof.releaseEvidenceHash,usageProofHash:proof.usageEvidenceHash,billingProofHash:e.evidenceHash});
  };
  await t.test('known billing with above-bound anomaly still blocks POD and conservatively preserves exposure',async()=>{
   assert.equal((await bill(400)).accounting.status,'final_actual');
   const anomaly=await bill(1500);assert.equal(anomaly.accepted,false);assert.equal(anomaly.anomaly.reason,'actual_above_reserved_bound');
   const current=await state();assert.deepEqual(current.raw,{held:'1500',unknown:false});assert.equal(current.bounded,false);assert.equal(current.blocking,true);assert.equal(current.finance.hasBlockingUnknown,true);assert.equal(current.releases,0);
   assert.ok(BigInt(current.finance.committedMicrounits)>=BigInt(baseline.finance.committedMicrounits)+500n);
   await assert.rejects(prepare(),/r12_pod_unresolved_liability/);
  });
  assert.equal(network,0);
 }finally{globalThis.fetch=oldFetch;await db.close();}
});
