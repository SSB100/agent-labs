/** Safe read projection qualification. All provider callbacks/reviews are inert. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {prepareDirectTestAuthorityFixture} from './helpers/r12-direct-test-authority-fixture.mjs';
import {bindDirectHandoffFixture,runDirectApprovedSetup} from './helpers/r12-direct-approved-setup-fixture.mjs';
import {qualifyInertOwnerRenderer} from './helpers/r12-direct-setup-renewal-fixture.mjs';
import {one,ownerInitialRpc} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {validateOwnerInitialRaceEnvironment} from './helpers/r12-owner-initial-postgres-races.mjs';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2-hash.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),host=process.env.R12_SQL_TEST_HOST;
const fields=['version','operationId','status','accountBindingHash','observedShopName','verifiedAt','expiresAt','reason'].sort();
function inactive(view,status,reason){
 assert.deepEqual(Object.keys(view).sort(),fields);assert.equal(view.version,'etsy.steel-owner-verification-view.1');
 assert.equal(view.status,status);assert.equal(view.reason,reason);
 for(const key of ['accountBindingHash','observedShopName','verifiedAt','expiresAt'])assert.equal(view[key],null);
}
test('owner verification view is durable, current, private and distinct from in-progress or paused proof',{skip:!host&&process.env.R12_REQUIRE_POSTGRES!=='1',timeout:180000},async()=>{
 assert.ok(host);const req=createRequire(path.resolve(host,'package.json'));let db;
 if(process.env.R12_REQUIRE_POSTGRES==='1')assert.ok(process.env.R12_POSTGRES_URL);
 if(process.env.R12_POSTGRES_URL){
  const target=validateOwnerInitialRaceEnvironment(process.env),{Client}=req('pg');db=new Client({connectionString:target.url});await db.connect();db.exec=sql=>db.query(sql);db.close=()=>db.end();
  assert.deepEqual(await one(db,'select current_user actor,current_database() db,host(inet_server_addr()) address'),{actor:'r12_test',db:'r12_test',address:target.address});
  assert.equal(Number((await one(db,"select count(*) n from pg_tables where schemaname in ('public','private')")).n),0);
 }else{const {PGlite}=req('@electric-sql/pglite'),{pgcrypto}=req('@electric-sql/pglite/contrib/pgcrypto');db=new PGlite({extensions:{pgcrypto}});}
 const oldFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No external transport permitted');};
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const name of readdirSync(path.join(root,'supabase/migrations')).filter(n=>n.endsWith('.sql')&&n.slice(0,14)<='20261010120445').sort())await db.exec(readFileSync(path.join(root,'supabase/migrations',name),'utf8'));
  await prepareDirectTestAuthorityFixture(db,{configureReview:ctx=>qualifyInertOwnerRenderer(db,ctx),onPrepared:async authority=>{
   const b=authority.f.businessId,owner=authority.f.ownerId;
   const read=(operationId,actor=owner,business=b)=>ownerInitialRpc(db,actor,'r12_owner_etsy_steel_verification_read',[business,operationId]);
   assert.equal(await read(randomUUID()),null);
   const completed=await runDirectApprovedSetup(db,authority,{
    afterCreate:async({a})=>{assert.equal(await read(a.scope.operationId),null);},
    beforeVerification:async({a})=>{inactive(await read(a.scope.operationId),'pending_verification','awaiting_verification');},
    afterVerificationCreate:async({a,x,verificationInputs})=>{
     inactive(await read(a.scope.operationId),'pending_verification','verification_in_progress');
     for(const status of ['paused','verified']){
      await db.exec('begin');
      try{
       const body={version:'etsy.steel-account-verification-receipt.1',operationId:verificationInputs.scope.operationId,scopeHash:verificationInputs.scopeHash,status,reason:'inert test only',releaseState:'verified',liabilityState:'receipt_required'};
       await x.ledger(body.operationId,'receipt',{...body,receiptHash:hash(body)});
       inactive(await read(a.scope.operationId),status==='paused'?'failed':'pending_verification',status==='paused'?'verification_paused':'binding_persistence_pending');
      }finally{await db.exec('rollback');}
     }
    },
   });
   const expected={version:'etsy.steel-owner-verification-view.1',operationId:completed.setupOperation,status:'verified',accountBindingHash:completed.accountBinding.bindingHash,
    observedShopName:completed.accountBinding.observedShopName,verifiedAt:completed.accountBinding.verifiedAt,expiresAt:completed.accountBinding.expiresAt,reason:'verification_verified'};
   assert.deepEqual(await read(completed.setupOperation),expected);
   assert.deepEqual(await read(completed.setupOperation),expected,'Reload reads immutable saved proof, not an in-memory return result');
   assert.equal(JSON.stringify(expected).includes(completed.profileId),false);
   await assert.rejects(read(completed.setupOperation,randomUUID()),/owner_required/);
   const otherBusiness=randomUUID();await db.query('insert into public.businesses(id,owner_user_id,name) values($1,$2,$3)',[otherBusiness,owner,'Inert cross-business owner']);
   assert.equal(await read(completed.setupOperation,owner,otherBusiness),null,'Owning both Businesses does not cross operation scope');
   for(const sql of [
    ['insert into private.r12_owner_grant_revocations(grant_id,reason) values($1,$2)',[authority.f.grantId,'inert revocation']],
    ['insert into private.r12_direct_test_revocations(envelope_id,reason) values($1,$2)',[authority.prepared.testEnvelopeId,'inert revocation']],
   ]){
    await db.exec('begin');try{await db.query(...sql);inactive(await read(completed.setupOperation),'invalidated','authority_inactive');}finally{await db.exec('rollback');}
   }
   const bindingFixture=await bindDirectHandoffFixture(db,authority);
   await db.exec('begin');
   try{await bindingFixture.prepare({accountId:completed.scope.accountId});inactive(await read(completed.setupOperation),'invalidated','account_revision_changed');}finally{await db.exec('rollback');}
   await db.exec('begin');
   try{
    await db.exec("create or replace function private.r12_etsy_steel_current(p_operation uuid,p_login boolean default true) returns private.r12_etsy_steel_setups language plpgsql set search_path='' as $$ begin raise exception 'inert_integrity_failure';end $$");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);await db.exec('set local role authenticated');
    await assert.rejects(db.query('select public.r12_owner_etsy_steel_verification_read($1,$2)',[b,completed.setupOperation]),/inert_integrity_failure/);
   }finally{await db.exec('rollback');}
   // A private synthetic candidacy snapshot isolates expiry projection without
   // creating another provider operation or modifying immutable history.
   const short=await bindingFixture.prepare({approvalExpiresAt:new Date(Date.now()+3000).toISOString(),profileAccessExpiresAt:new Date(Date.now()+4000).toISOString()});await short.approve();
   const candidateBody={version:'inert-owner-view-candidate.1',operationId:short.scope.operationId,expiresAt:short.scope.profileAccessExpiresAt};
   const candidate={...candidateBody,candidateHash:hash(candidateBody)};
   await db.query('insert into private.r12_etsy_steel_candidates(binding_id,binding_revision,operation_id,candidate,candidate_hash) values($1,$2,$3,$4,$5)',[randomUUID(),randomUUID(),short.scope.operationId,candidate,candidate.candidateHash]);
   inactive(await read(short.scope.operationId),'pending_verification','awaiting_verification');
   await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(short.scope.approvalExpiresAt)-Date.now()+30)));
   inactive(await read(short.scope.operationId),'expired','verification_expired');
   await completed.owner('stop',{operationId:completed.setupOperation});inactive(await read(completed.setupOperation),'stopped','owner_stopped');
   assert.equal(network,0);
  }});
  const acl=await one(db,"select has_function_privilege('authenticated','public.r12_owner_etsy_steel_verification_read(uuid,uuid)','EXECUTE') owner,has_function_privilege('anon','public.r12_owner_etsy_steel_verification_read(uuid,uuid)','EXECUTE') anon,has_function_privilege('service_role','public.r12_owner_etsy_steel_verification_read(uuid,uuid)','EXECUTE') service");
  assert.deepEqual(acl,{owner:true,anon:false,service:false});
 }catch(error){if(error.where)error.message+='\n'+error.where;throw error;}finally{globalThis.fetch=oldFetch;await db.close();}
});
