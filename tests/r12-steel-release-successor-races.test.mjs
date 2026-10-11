/** Native PostgreSQL only: positive multi-backend Business-lock evidence.
 * Each named case gets a separate fresh disposable CI database. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {confirmedRepairFixture,inertReleaseSuccessor,rehash,currentRelease,hash,one,useInertSuccessor,admitSavedReplacementCreate} from './helpers/r12-steel-release-successor-fixture.mjs';
import {asRole,orderedRace,validateOwnerInitialRaceEnvironment} from './helpers/r12-owner-initial-postgres-races.mjs';
import {publishInertRepairAttestation} from './helpers/r12-steel-setup-recovery-fixture.mjs';
import {steelConfigRequest,admitSteelConfig} from './helpers/r12-steel-config-sql-fixture.mjs';
const options={skip:process.env.R12_REQUIRE_POSTGRES==='1'?false:'Native PostgreSQL required; PGlite is not lock-race qualification',timeout:240000};
async function clients(db,run){const target=validateOwnerInitialRaceEnvironment(process.env),{Client}=createRequire(resolve(target.host,'package.json'))('pg'),holder=new Client({connectionString:target.url,application_name:'single-successor-holder'}),waiter=new Client({connectionString:target.url,application_name:'single-successor-waiter'});try{await holder.connect();await waiter.connect();return await run({holder,waiter,observer:db});}finally{await holder.end();await waiter.end();}}
const publish=(c,b)=>one(c,'select private.r12_steel_publish_release_successor($1) value',[b]).then(x=>x.value);
async function setupPayload(db,x){const scope={...x.setup.scope,operationId:x.proposal.replacementOperationId,accountRevision:randomUUID(),approvalId:randomUUID(),approvalRevision:randomUUID(),verificationOperationId:randomUUID(),approvedAt:new Date(Date.now()-1000).toISOString(),approvalExpiresAt:new Date(Date.now()+900000).toISOString()};delete scope.disclosureHash;const disclosure=(await one(db,'select private.r12_etsy_steel_disclosure($1) value',[scope])).value;scope.disclosureHash=hash(disclosure);return{scope,disclosure};}
const prepare=(c,x,payload)=>asRole(c,'anon','r12_etsy_steel_server',[x.f.businessId,'prepare',payload,x.bridge.keys.handoff]);
const counts=db=>one(db,'select (select count(*)::int from private.r12_steel_setup_release_successors) successors,(select count(*)::int from private.r12_steel_setup_repair_debits) debits,(select count(*)::int from private.r05_markers) markers,(select count(*)::int from private.r05_reservations) reservations,(select count(*)::int from private.r12_steel_create_config_uses) uses');

test('native successor identical publication and conflicting retries serialize',options,async()=>{
 const {db,x}=await confirmedRepairFixture({successorBeforeHistory:true});try{
  const body=await inertReleaseSuccessor(db,x),before=await counts(db);
  await clients(db,async connections=>{const same=await orderedRace({...connections,first:c=>publish(c,body),second:c=>publish(c,body)});assert.equal(same.observedLockWait,true);assert.deepEqual(same.second.value,same.first);const conflict=await orderedRace({...connections,first:c=>publish(c,body),second:c=>publish(c,rehash(body,{securityApprovalHash:hash('conflict')}))});assert.equal(conflict.observedLockWait,true);assert.match(conflict.second.error.message,/successor_conflict/);});
  assert.deepEqual(await counts(db),{...before,successors:1});console.log('Native successor publisher retry locks verified');
 }finally{await db.close();}
});
test('native successor publication wins setup and revocation fences paid creation',options,async()=>{
 const {db,x}=await confirmedRepairFixture({successorBeforeHistory:true});try{
  const body=await inertReleaseSuccessor(db,x),payload=await setupPayload(db,x),before=await counts(db);
  await clients(db,async connections=>{const race=await orderedRace({...connections,first:c=>publish(c,body),second:c=>prepare(c,x,payload)});assert.equal(race.observedLockWait,true);assert.equal(race.second.error,undefined);assert.equal(race.second.value.operationId,body.replacementOperationId);});
  assert.equal((await currentRelease(db,x)).review_hash,body.reviewHash);assert.deepEqual(await counts(db),{...before,successors:1});
  useInertSuccessor(x,body);await publishInertRepairAttestation(db,x);
  // The racing prepare already saved the scope. Read it, approve its exact
  // disclosure and admit create without attempting a forbidden second prepare.
  const {view}=await admitSavedReplacementCreate(x,payload.scope);await admitSteelConfig(db,x.f.businessId,steelConfigRequest(view.scope,{setup:true,configuration:x.repair.configuration}),x.bridge.keys.handoff);const reserved=await counts(db);
  await clients(db,async connections=>{const race=await orderedRace({...connections,first:c=>c.query('insert into private.r12_steel_setup_release_successor_revocations(review_hash) values($1)',[body.reviewHash]),second:c=>asRole(c,'anon','r12_etsy_steel_server',[x.f.businessId,'transport',{operationId:body.replacementOperationId,request:{provider:'steel',operation:'browser.etsy.owner_handoff.create',method:'POST',endpoint:'https://api.steel.dev/v1/sessions'}},x.bridge.keys.handoff])});assert.equal(race.observedLockWait,true);assert.match(race.second.error.message,/successor_inactive/);});
  assert.deepEqual(await counts(db),reserved);await assert.rejects(currentRelease(db,x),/successor_inactive/);console.log('Native publisher-before-setup and successor-revocation-before-create locks verified');
 }finally{await db.close();}
});
test('native saved setup wins and prevents release transfer',options,async()=>{
 const {db,x}=await confirmedRepairFixture({successorBeforeHistory:true});try{
  const body=await inertReleaseSuccessor(db,x),payload=await setupPayload(db,x),before=await counts(db);
  await clients(db,async connections=>{const race=await orderedRace({...connections,first:c=>prepare(c,x,payload),second:c=>publish(c,body)});assert.equal(race.observedLockWait,true);assert.match(race.second.error.message,/unused_replacement_required/);});
  assert.deepEqual(await counts(db),before);assert.equal((await currentRelease(db,x)).review_hash,body.predecessorReviewHash);console.log('Native setup-before-publisher lock verified');
 }finally{await db.close();}
});
test('native original release revocation wins successor publication',options,async()=>{
 const {db,x}=await confirmedRepairFixture({successorBeforeHistory:true});try{
  const body=await inertReleaseSuccessor(db,x),before=await counts(db);
  await clients(db,async connections=>{const race=await orderedRace({...connections,first:c=>c.query('insert into private.r12_steel_setup_repair_release_revocations(review_hash) values($1)',[body.predecessorReviewHash]),second:c=>publish(c,body)});assert.equal(race.observedLockWait,true);assert.match(race.second.error.message,/release_inactive/);});
  assert.deepEqual(await counts(db),before);console.log('Native original-revocation-before-publisher lock verified');
 }finally{await db.close();}
});

test('native publication wins original revocation and effective release then fails closed',options,async()=>{
 const {db,x}=await confirmedRepairFixture({successorBeforeHistory:true});try{
  const body=await inertReleaseSuccessor(db,x),before=await counts(db);
  await clients(db,async connections=>{const race=await orderedRace({...connections,first:c=>publish(c,body),second:c=>c.query('insert into private.r12_steel_setup_repair_release_revocations(review_hash) values($1)',[body.predecessorReviewHash])});assert.equal(race.observedLockWait,true);assert.equal(race.second.error,undefined);});
  assert.deepEqual(await counts(db),{...before,successors:1});await assert.rejects(currentRelease(db,x),/release_inactive/);console.log('Native publisher-before-original-revocation lock verified');
 }finally{await db.close();}
});
