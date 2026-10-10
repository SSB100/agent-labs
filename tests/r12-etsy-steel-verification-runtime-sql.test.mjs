/** Real verification orchestration through migrated public RPCs; provider IO is inert. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {prepareDirectTestAuthorityFixture} from './helpers/r12-direct-test-authority-fixture.mjs';
import {runDirectApprovedSetup} from './helpers/r12-direct-approved-setup-fixture.mjs';
import {qualifyInertOwnerRenderer} from './helpers/r12-direct-setup-renewal-fixture.mjs';
import {one,ownerInitialRpc} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {validateOwnerInitialRaceEnvironment} from './helpers/r12-owner-initial-postgres-races.mjs';
import {sqlBackedEtsySteelVerification} from './helpers/r12-etsy-steel-verification-runtime-sql-fixture.mjs';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2-hash.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),host=process.env.R12_SQL_TEST_HOST;

test('actual verification runtime persists SQL binding only after admitted no-query proof, cleanup and held accounting',
 {skip:!host&&process.env.R12_REQUIRE_POSTGRES!=='1',timeout:180000},async()=>{
 assert.ok(host);const req=createRequire(path.resolve(host,'package.json'));let db;
 if(process.env.R12_REQUIRE_POSTGRES==='1')assert.ok(process.env.R12_POSTGRES_URL);
 if(process.env.R12_POSTGRES_URL){
  const target=validateOwnerInitialRaceEnvironment(process.env),{Client}=req('pg');db=new Client({connectionString:target.url});await db.connect();db.exec=sql=>db.query(sql);db.close=()=>db.end();
  assert.deepEqual(await one(db,'select current_user actor,current_database() db,host(inet_server_addr()) address'),{actor:'r12_test',db:'r12_test',address:target.address});
  assert.equal(Number((await one(db,"select count(*) n from pg_tables where schemaname in ('public','private')")).n),0);
 }else{const {PGlite}=req('@electric-sql/pglite'),{pgcrypto}=req('@electric-sql/pglite/contrib/pgcrypto');db=new PGlite({extensions:{pgcrypto}});}
 const oldFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('External transport forbidden by inert integration test');};
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const name of readdirSync(path.join(root,'supabase/migrations')).filter(n=>n.endsWith('.sql')&&n.slice(0,14)<='20261010120445').sort())await db.exec(readFileSync(path.join(root,'supabase/migrations',name),'utf8'));
  for(const mode of ['verified','wrong_shop','owner_stop','renderer_revoked']){
   await prepareDirectTestAuthorityFixture(db,{configureReview:ctx=>qualifyInertOwnerRenderer(db,ctx),onPrepared:authority=>runDirectApprovedSetup(db,authority,{
    runVerification:async ctx=>{
     const {x,a,saved}=ctx,id=a.scope.verificationOperationId;
     const ownerRead=()=>ownerInitialRpc(db,a.scope.ownerId,'r12_owner_etsy_steel_verification_read',[a.scope.businessId,a.scope.operationId]);
     assert.equal((await ownerRead()).reason,'awaiting_verification');
     const runtime=sqlBackedEtsySteelVerification(ctx,{...(mode==='wrong_shop'?{shop:'OtherInertShop'}:{}),
      ...(mode==='renderer_revoked'?{beforeRendererRequest:async()=>db.query('insert into private.r12_direct_verification_renderer_revocations(route_hash) values($1)',[authority.routeHash])}:{}),
      ...(mode==='owner_stop'?{beforeNavigate:async()=>x.owner('stop',{operationId:a.scope.operationId})}:{})});
     const result=await runtime.run(),calls=runtime.calls.map(x=>x.operation),inputs=runtime.prepared;
     assert.equal(result.accountingConfirmed,true,mode+': actual bounded accounting must be persisted');
     assert.equal(runtime.providerRequests.filter(x=>x.url==='https://api.steel.dev/v1/sessions').length,1);
     assert.equal(runtime.providerRequests.filter(x=>x.url.endsWith('/release')).length,1);
     assert.equal(runtime.providerRequests.filter(x=>x.method==='GET').length,2,'Terminal release and independent accounting usage are both read');
     assert.equal(calls.filter(x=>x==='admit').length,1);assert.equal(calls.filter(x=>x==='admit_renderer').length,1);
     assert.ok(calls.indexOf('ledger:reconcile')<calls.indexOf('cleanup_complete'));
     assert.equal(runtime.browser.events.includes('submit'),false);assert.equal(runtime.browser.events.includes('fill'),false);
     assert.equal(runtime.browser.events.includes('screenshot'),false);assert.equal(runtime.browser.getView(),'landing');
     const denied=mode==='renderer_revoked';
     assert.equal(runtime.browser.cdpCommands.filter(x=>x.name==='Fetch.continueRequest').length,denied?0:1);
     assert.equal(runtime.browser.cdpCommands.filter(x=>x.name==='Fetch.failRequest').length,denied?1:0,'A SQL-revoked renderer is blocked before request continuation');
     const requests=(await db.query('select sequence,content from private.r12_direct_verification_renderer_requests where operation_id=$1 order by sequence',[id])).rows;
     assert.equal(requests.length,denied?0:1);
     if(!denied){assert.equal(requests[0].sequence,1);assert.deepEqual(requests[0].content,runtime.calls.find(x=>x.operation==='admit_renderer').payload.request);}
     assert.equal(runtime.browser.browser.isConnected(),false);
     const durable=await one(db,`select (select count(*)::int from private.r12_etsy_steel_verification_dispatches where operation_id=$1) dispatches,
      (select count(*)::int from private.r12_etsy_steel_verification_release where operation_id=$1) cleanup,
      (select content from private.r12_direct_browser_receipts where operation_id=$1) receipt,
      (select content from private.r12_direct_browser_accounting where operation_id=$1 order by revision desc limit 1) accounting`,[id]);
     assert.equal(durable.dispatches,1);assert.equal(durable.cleanup,1);assert.deepEqual(durable.receipt,result.receipt);
     assert.equal(durable.receipt.scopeHash,inputs.scopeHash);assert.equal(durable.accounting.status,'qualified_bounded_pending');
     assert.equal(durable.accounting.actualMicrounits,null);assert.equal(durable.accounting.providerBillingRecordHash,null);
     const read=await x.ledger(id,'read',{});assert.equal(read.anomalies.length,0);assert.equal(read.accounting.length,1);
     const exposure=await one(db,'select count(*)::int operations,sum(held)::text held,sum(pending_maximum)::text pending,sum(known_actual)::text actual,bool_or(unknown) unknown from private.r12_direct_browser_exposure($1)',[a.scope.businessId]);
     assert.deepEqual(exposure,{operations:2,held:'2000',pending:'2000',actual:'0',unknown:false},'Both separately paid setup maxima stay held without claiming invoice settlement');
     const persisted=await one(db,'select binding,verification from private.r12_etsy_steel_verifications where binding_id=$1',[saved.bindingId]);
     if(mode==='verified'){
      assert.equal(result.status,'verified');assert.ok(calls.indexOf('cleanup_complete')<calls.indexOf('verify'));
      assert.deepEqual(persisted.binding,result.binding);assert.equal(persisted.verification.observedShopName,a.scope.expectedShopName);
      assert.equal(persisted.verification.operationId,id);assert.equal(persisted.verification.sessionId,id);
      assert.equal(persisted.verification.canonicalUrl,'https://www.etsy.com/your/shops/me/marketplace-insights');
      assert.equal(persisted.verification.verificationHash,hash(Object.fromEntries(Object.entries(persisted.verification).filter(([k])=>k!=='verificationHash'))));
      const view={version:'etsy.steel-owner-verification-view.1',operationId:a.scope.operationId,status:'verified',accountBindingHash:result.binding.bindingHash,
       observedShopName:a.scope.expectedShopName,verifiedAt:result.binding.verifiedAt,expiresAt:result.binding.expiresAt,reason:'verification_verified'};
      assert.deepEqual(await ownerRead(),view);assert.deepEqual(await ownerRead(),view,'Reload uses saved SQL proof');
      assert.equal(JSON.stringify(view).includes(a.profileId),false);assert.equal(JSON.stringify(view).includes(id),false);
      const resolved=await x.server('resolve',{binding:result.binding});assert.equal(resolved.profileId,a.profileId);
      await assert.rejects(runtime.run(),/etsy_verification_recovery_required/);
      assert.equal(runtime.providerRequests.filter(x=>x.url==='https://api.steel.dev/v1/sessions').length,1,'Retry cannot create twice');
     }else{
      assert.equal(result.status,'paused');assert.equal(result.binding,null);assert.equal(persisted,undefined);assert.equal(calls.includes('verify'),false);
      const view=await ownerRead();assert.equal(view.status,mode==='owner_stop'?'stopped':'failed');
      assert.equal(view.reason,mode==='owner_stop'?'owner_stopped':'verification_paused');
      for(const key of ['accountBindingHash','observedShopName','verifiedAt','expiresAt'])assert.equal(view[key],null);
     }
     return result;
    },
   })});
  }
  assert.equal(network,0);
 }catch(error){if(error.where)error.message+='\n'+error.where;throw error;}finally{globalThis.fetch=oldFetch;await db.close();}
});
