import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {prepareDirectBrowserLedgerFixture} from './helpers/r12-direct-browser-ledger-fixture.mjs';
import {one} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {publicResearchBrowserExposure,validatePublicResearchBrowserAccounting} from '../.core-tests/products/discovery-r12-public-accounting.js';
import {validateOwnerInitialRaceEnvironment} from './helpers/r12-owner-initial-postgres-races.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),host=process.env.R12_SQL_TEST_HOST;
test('direct browser accounting retains qualified maxima, pending holds and durable anomalies',{skip:!host&&process.env.R12_REQUIRE_POSTGRES!=='1',timeout:120000},async()=>{
 assert.ok(host);const req=createRequire(path.resolve(host,'package.json'));let db;
 if(process.env.R12_REQUIRE_POSTGRES==='1')assert.ok(process.env.R12_POSTGRES_URL);
 if(process.env.R12_POSTGRES_URL){const target=validateOwnerInitialRaceEnvironment(process.env),{Client}=req('pg');db=new Client({connectionString:process.env.R12_POSTGRES_URL});await db.connect();db.exec=sql=>db.query(sql);db.close=()=>db.end();assert.deepEqual(await one(db,'select current_user actor,current_database() db,host(inet_server_addr()) address'),{actor:'r12_test',db:'r12_test',address:target.address});assert.equal(Number((await one(db,"select count(*) n from pg_tables where schemaname in ('public','private')")).n),0);}
 else{const {PGlite}=req('@electric-sql/pglite'),{pgcrypto}=req('@electric-sql/pglite/contrib/pgcrypto');db=new PGlite({extensions:{pgcrypto}});}
 const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('External transport forbidden');};
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  // An explicitly bounded slice prevents half-written later migrations from
  // contaminating this accounting qualification. Full-chain gate is separate.
  for(const file of readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')&&x.slice(0,14)<='20261010115441').sort())await db.exec(readFileSync(path.join(root,'supabase/migrations',file),'utf8'));
  const x=await prepareDirectBrowserLedgerFixture(db),a=await x.createOperation();
  await assert.rejects(x.check(1),/unresolved_liability/);
  await assert.rejects(a.register(),/unresolved_liability|recovery_required/);
  await assert.rejects(x.ledger(a.operationId,'read',{},'wrong'),/evidence_key_required/);
  const originalRead=await x.ledger(a.operationId,'read');assert.equal(originalRead.operationMaximumMicrounits,'1000');assert.equal(originalRead.scopeHash,a.receipt.scopeHash);assert.equal(originalRead.requestHash,a.requestHash);
  const qualification=originalRead.qualification;
  assert.equal(qualification.providerProjectId,x.project);assert.equal(qualification.maximumSessionMs,60000);
  assert.deepEqual(qualification.usageBound,{version:'r12.steel-usage-bound.1',maximumProxyBytes:0,tariffCoversSessionAndProfileLifecycle:true,captchaDisabled:true,extraServicesDisabled:true});
  assert.equal(Object.hasOwn(qualification,'credentialBindingHash'),false);
  const observed=(await one(db,'select content from private.r12_direct_browser_evidence where evidence_hash=$1',[a.usageHash])).content;
  const qualifies=async body=>(await one(db,`select private.r12_direct_browser_usage_qualified(o,r,s,$2,rel.content) ok from private.r12_direct_browser_operations o join private.r12_direct_browser_routes r on r.route_hash=o.route_hash join private.r12_direct_browser_sessions s on s.operation_id=o.id join private.r12_direct_browser_evidence rel on rel.evidence_hash=$3 where o.id=$1`,[a.operationId,body,a.releaseHash])).ok;
  assert.equal(await qualifies(observed),true);
  for(const key of ['requestedTimeoutMs','providerTimeoutMs','durationMs','proxyBytesUsed','proxySource','solveCaptcha','extraServicesDisabled','providerReadbackHash']){
   const missing={...observed};delete missing[key];assert.equal(await qualifies(missing),false,'missing '+key+' is never assumed');
  }
  for(const changes of [{maximumMicrounits:'1'},{maximumMicrounits:'999'},{providerTimeoutMs:60001},{durationMs:60001},{proxyBytesUsed:1},{proxySource:'steel'},{solveCaptcha:true},{requestedTimeoutMs:'60000'},{durationMs:1.5},{extraServicesDisabled:false},{providerReadbackHash:'f'.repeat(64)}])assert.equal(await qualifies({...observed,...changes}),false);
  const genericRelease=await a.evidence('release',{terminal:true,observersDisposed:true});
  await assert.rejects(x.ledger(a.operationId,'reconcile',{releaseProofHash:genericRelease,usageProofHash:a.usageHash,billingProofHash:null}),/release_proof_required/);
  const pending=await a.reconcile();assert.equal(pending.accounting.status,'qualified_bounded_pending');assert.equal(pending.accounting.actualMicrounits,null);
  assert.equal((await x.exposure()).boundedPendingMicrounits,'1000');assert.equal((await x.exposure()).knownActualMicrounits,'0');
  assert.equal((await one(db,'select unknown from private.r05_exposure($1) where source_key=$2',[x.f.businessId,'direct:'+a.operationId])).unknown,true,'Historical lane stays strict');
  const b=await x.createOperation();await b.reconcile();await x.check(500);await assert.rejects(x.check(501),/test_limit/);
  const bill100=await a.bill(100);await a.reconcile(bill100);await a.reconcile(bill100);
  assert.equal((await x.exposure()).knownActualMicrounits,'100');assert.equal((await x.exposure()).boundedPendingMicrounits,'1000');
  await a.reconcile(await a.bill(200));await a.reconcile(await a.bill(50));
  assert.equal((await x.exposure()).knownActualMicrounits,'200');
  assert.equal((await a.reconcile()).accounting.status,'final_actual');
  const read=await x.ledger(a.operationId,'read');assert.equal(read.accounting.length,4);assert.equal(read.accounting[3].previousRecordHash,read.accounting[2].recordHash);
  assert.equal((await one(db,'select max(actual_microunits)::text amount from private.r05_settlements where request_id=$1',[a.requestId])).amount,'200');
  const above=await a.reconcile(await a.bill(1500));assert.equal(above.accepted,false);assert.equal(above.anomaly.reason,'actual_above_reserved_bound');
  const ex=await x.exposure();assert.equal(ex.knownActualMicrounits,'200');assert.equal(ex.boundedPendingMicrounits,'2300');assert.equal(ex.committedMicrounits,'2500');assert.equal(ex.hasUnknownOrUnbounded,true);await assert.rejects(x.check(0),/unresolved/);
  const ar=await x.ledger(a.operationId,'read'),br=await x.ledger(b.operationId,'read');
  const lineage={businessId:x.f.businessId,goalId:x.f.goalId,authorityRootId:x.root,envelopeHash:x.envelopeHash};
  for(const row of [...ar.accounting,...br.accounting])validatePublicResearchBrowserAccounting(row,lineage);
  const pure=publicResearchBrowserExposure([...ar.accounting,...br.accounting,...ar.accounting].reverse(),lineage,ar.anomalies);
  assert.equal(pure.knownActualMicrounits,ex.knownActualMicrounits);assert.equal(pure.heldMaximumMicrounits,ex.boundedPendingMicrounits);assert.equal(pure.conservativeExposureMicrounits,ex.committedMicrounits);assert.equal(pure.hasUnknownOrUnbounded,ex.hasUnknownOrUnbounded);
  const bad=await b.reconcile(await b.bill(10,{currency:'EUR'}));assert.equal(bad.accepted,false);assert.equal(bad.anomaly.reason,'unqualified_billing');
  assert.equal((await x.ledger(a.operationId,'read')).anomalies.length,1);
  const bUsage=(await one(db,'select content from private.r12_direct_browser_evidence where evidence_hash=$1',[b.usageHash])).content;
  delete bUsage.solveCaptcha;const missingEvidence=await b.evidence('usage_bound',bUsage);
  const missingResult=await x.ledger(b.operationId,'reconcile',{releaseProofHash:b.releaseHash,usageProofHash:missingEvidence,billingProofHash:null});
  assert.equal(missingResult.accepted,false);assert.equal(missingResult.anomaly.reason,'unbounded_usage');
  assert.equal((await x.ledger(b.operationId,'read')).anomalies.length,2,'Unknown usage survives the refused qualification transaction');

  await db.query('insert into private.r12_direct_test_revocations(envelope_id,reason) values($1,$2)',[x.id,'owner_stopped']);await assert.rejects(x.check(0),/authority_unavailable/);
  assert.equal((await x.ledger(b.operationId,'read')).accounting[0].status,'qualified_bounded_pending');
  assert.deepEqual(await one(db,"select has_table_privilege('authenticated','private.r12_direct_browser_accounting','INSERT') direct_write,has_function_privilege('anon','private.r12_direct_browser_register(uuid,uuid,uuid,text,jsonb,text,text)','EXECUTE') private_create"),{direct_write:false,private_create:false});
  // Root liabilities retain historical spend and each distinct browser request.
  const y=await prepareDirectBrowserLedgerFixture(db,{maximum:2500,legacy:{committedMicrounits:1900000}});
  const ya=await y.createOperation();await ya.reconcile();
  const historical=await one(db,'select private.stage13v2_budget_authority($1,false) x',[y.root]);
  assert.equal(historical.x.knownActualMicrousd,1900000);assert.equal(historical.x.pendingExposureMicrousd,1000);
  assert.equal(historical.x.committedMicrousd,1901000);assert.equal(historical.x.hasUncertainCosts,true);
  await y.check(1500);await assert.rejects(y.check(1501),/test_limit/);
  await db.query('insert into private.r12_direct_browser_route_revocations(route_hash) values($1)',[y.routeHash]);
  assert.equal((await y.exposure()).hasUnknownOrUnbounded,true);await assert.rejects(y.check(0),/unresolved/);
  // Reconciliation remains available after Stop; no new operation is allowed.
  const z=await prepareDirectBrowserLedgerFixture(db),za=await z.createOperation();await za.reconcile();
  await db.query('insert into private.r12_direct_test_revocations(envelope_id,reason) values($1,$2)',[z.id,'owner_stopped']);
  await za.reconcile(await za.bill(50));assert.equal((await z.exposure()).knownActualMicrounits,'50');assert.equal((await z.exposure()).boundedPendingMicrounits,'0');
  await assert.rejects(z.check(1),/authority_unavailable/);
  assert.equal(network,0);
 }finally{globalThis.fetch=originalFetch;await db.close();}
});
