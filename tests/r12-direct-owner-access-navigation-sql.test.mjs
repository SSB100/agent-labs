import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {directControllerDatabase} from './helpers/r12-direct-controller-database.mjs';
import {prepareDirectTestAuthorityFixture} from './helpers/r12-direct-test-authority-fixture.mjs';
import {qualifyInertOwnerRenderer} from './helpers/r12-direct-setup-renewal-fixture.mjs';
import {bindDirectHandoffFixture,runDirectApprovedSetup} from './helpers/r12-direct-approved-setup-fixture.mjs';
import {one,ownerInitialRpc} from './helpers/r12-owner-initial-sql-fixture.mjs';

test('owner catalog resumes only its exact envelope access operation with safe saved verification',{
 skip:!process.env.R12_SQL_TEST_HOST&&!process.env.R12_REQUIRE_POSTGRES&&!process.env.R12_POSTGRES_URL,timeout:180000,
},async()=>{
 const db=await directControllerDatabase();
 try{
  for(const n of ['20261010120610_r12_direct_source_renderer_v2.sql','20261010120620_r12_direct_owner_server_context.sql','20261010120630_r12_direct_late_receipt_head_fence.sql','20261010120640_r12_direct_owner_access_navigation.sql'])await db.exec(readFileSync('supabase/migrations/'+n,'utf8'));
  await prepareDirectTestAuthorityFixture(db,{configureReview:x=>qualifyInertOwnerRenderer(db,x),onPrepared:async authority=>{
   const b=authority.f.businessId,g=authority.f.goalId,owner=authority.f.ownerId,id=authority.prepared.testEnvelopeId;
   const read=(envelope=id,actor=owner,business=b,goal=g)=>ownerInitialRpc(db,actor,'r12_owner_direct_read',[business,goal,envelope]);
   assert.equal((await read()).ownerAccess,null);
   const other=await authority.prepare({submissionId:randomUUID()});
   assert.equal((await read(other.testEnvelopeId)).ownerAccess,null);
   await authority.confirm();
   const fixture=await bindDirectHandoffFixture(db,authority);
   await db.exec('begin');try{
    const a=await fixture.prepare();
    const check=async status=>{
     const result=await read();assert.equal(result.current.testEnvelopeId,id);
     assert.deepEqual(result.ownerAccess,{version:'r12.direct-owner-access-navigation.1',testEnvelopeId:id,operationId:a.scope.operationId,status,verification:null});
     assert.equal((await read(other.testEnvelopeId)).ownerAccess,null);
    };
    await check('pending_approval');await a.approve();await check('approved');
    await fixture.owner('stop',{operationId:a.scope.operationId});await check('stopped');
   }finally{await db.exec('rollback');}
   await db.exec('begin');try{
    const a=await fixture.prepare({approvalExpiresAt:new Date(Date.now()+2000).toISOString()});
    assert.equal((await read()).ownerAccess.operationId,a.scope.operationId);
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(a.scope.approvalExpiresAt)-Date.now()+30)));
    assert.equal((await read()).ownerAccess.status,'expired');
   }finally{await db.exec('rollback');}
   const completed=await runDirectApprovedSetup(db,authority,{
    afterCreate:async({a})=>{const view=(await read()).ownerAccess;assert.equal(view.operationId,a.scope.operationId);assert.equal(view.status,'approved');assert.equal(view.verification,null);},
    beforeVerification:async({a})=>{const view=(await read()).ownerAccess;assert.equal(view.operationId,a.scope.operationId);assert.equal(view.verification.status,'pending_verification');},
   });
   const expected={version:'r12.direct-owner-access-navigation.1',testEnvelopeId:id,operationId:completed.setupOperation,status:'approved',
    verification:await ownerInitialRpc(db,owner,'r12_owner_etsy_steel_verification_read',[b,completed.setupOperation])};
   assert.equal(expected.verification.status,'verified');
   const counts=()=>one(db,`select (select count(*)::int from private.r05_requests) requests,(select count(*)::int from private.r05_reservations) reservations,
    (select count(*)::int from private.r12_etsy_steel_setups) setups,(select count(*)::int from private.r12_etsy_steel_approvals) approvals,
    (select count(*)::int from private.r12_direct_browser_accounting) accounting`);
   const before=await counts();
   assert.deepEqual((await read()).ownerAccess,expected);assert.deepEqual((await read()).ownerAccess,expected,'Reload retains the actual saved operation');
   assert.deepEqual(await counts(),before,'Navigation creates no access, session, approval or cash authority');
   assert.equal((await read(other.testEnvelopeId)).ownerAccess,null,'Historical draft cannot borrow another envelope access');
   assert.equal((await read(null)).ownerAccess,null,'Latest draft selection remains aligned rather than leaking another envelope operation');
   assert.equal(JSON.stringify(expected).includes(completed.profileId),false);
   assert.deepEqual(Object.keys(expected).sort(),['version','testEnvelopeId','operationId','status','verification'].sort());
   await assert.rejects(read(id,randomUUID()),/owner_required/);
   const otherBusiness=randomUUID();await db.query('insert into public.businesses(id,owner_user_id,name) values($1,$2,$3)',[otherBusiness,owner,'Inert same-owner other Business']);
   await assert.rejects(read(id,owner,otherBusiness),/exact_test_required/);
   await assert.rejects(read(id,owner,b,randomUUID()),/exact_test_required/);
   await completed.owner('stop',{operationId:completed.setupOperation});
   const stopped=(await read()).ownerAccess;assert.equal(stopped.operationId,completed.setupOperation);assert.equal(stopped.status,'stopped');assert.equal(stopped.verification.status,'stopped');assert.equal(stopped.verification.accountBindingHash,null);
  }});
  assert.deepEqual(await one(db,"select has_function_privilege('authenticated','public.r12_owner_direct_read(uuid,uuid,uuid)','EXECUTE') owner,has_function_privilege('anon','public.r12_owner_direct_read(uuid,uuid,uuid)','EXECUTE') anon,has_function_privilege('authenticated','public.r12_owner_direct_read_before_access_navigation(uuid,uuid,uuid)','EXECUTE') old"),{owner:true,anon:false,old:false});
 }finally{await db.close();}
});
