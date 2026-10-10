/** Native observed-lock qualification. External review facts and provider
 * leaves are inert fixtures; this suite never enrolls a real account or grant. */
import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {r04SqlBootstrap} from './r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './r10-sql-fixture.mjs';
import {asRole,orderedRace,validateOwnerInitialRaceEnvironment} from './r12-owner-initial-postgres-races.mjs';
import {one,sha} from './r12-owner-initial-sql-fixture.mjs';
import {enrollmentOriginFixture,publishReviewedDirectPackage,ENROLLMENT_ROOT} from './r12-direct-enrollment-sql-fixture.mjs';
export const validateEnrollmentRaceEnvironment=validateOwnerInitialRaceEnvironment;
export const ENROLLMENT_RACE_CUTOFF='20261010121000';
export const enrollmentRaceMigrations=files=>files.filter(x=>/^\d{14}_.+\.sql$/.test(x)&&x.slice(0,14)<=ENROLLMENT_RACE_CUTOFF).sort();
const owner=(db,x,operation,payload)=>asRole(db,'authenticated','r12_owner_direct_enrollment_server',[x.f.businessId,operation,payload,x.bootstrapKey],x.f.ownerId);
const confirmation=p=>({version:'r12.owner-direct-enrollment-confirmation.1',proposalId:p.proposalId,proposalHash:p.proposalHash,submissionId:randomUUID()});
async function prepared(db,x){
 const {built,published}=await publishReviewedDirectPackage(db,x);
 const p=await x.f.rpc('r12_owner_direct_enrollment_server',[x.f.businessId,'prepare',{version:'r12.owner-direct-enrollment-input.1',goalId:x.f.goalId,reviewedPackageHash:published.reviewedPackageHash,submissionId:randomUUID()},x.bootstrapKey]);
 return{...x,built,published,prepared:p};
}
async function counts(db,x){return one(db,`select
 (select count(*)::int from private.r12_direct_enrollment_grants m join private.r12_direct_enrollment_packages p using(package_hash) where p.business_id=$1) grants,
 (select count(*)::int from private.r12_owner_grant_root_revisions where root_id=$2) revisions,
 (select count(*)::int from private.r05_reservations where business_id=$1) reservations,
 (select count(*)::int from private.r05_markers where business_id=$1) markers,
 private.r12_direct_grant_usage($2) usage`,[x.f.businessId,x.f.rootId]);}
export async function exerciseEnrollmentPostgresRaces(env=process.env){
 const target=validateEnrollmentRaceEnvironment(env),require=createRequire(resolve(target.host,'package.json'));assert.equal(require('pg/package.json').version,'8.16.3');
 const {Client}=require('pg'),clients=['observer','holder','waiter'].map(label=>new Client({connectionString:target.url,ssl:false,application_name:'r12-enrollment-'+label,connectionTimeoutMillis:5000}));
 const [db,holder,waiter]=clients,connected=new Set(),races=[],savedFetch=globalThis.fetch;let externalCalls=0,authenticatedAutocommit=false;
 globalThis.fetch=async()=>{externalCalls++;throw Error('External transport forbidden in native enrollment races');};
 const race=actions=>orderedRace({observer:db,holder,waiter,...actions});
 const record=(name,result)=>{assert.equal(result.observedLockWait,true);races.push({name,observedLockWait:true,waitEvent:result.waitEvent});};
 try{
  for(const c of clients){await c.connect();connected.add(c);c.exec=sql=>c.query(sql);await c.query("set timezone='UTC'");assert.deepEqual(await one(c,'select current_user actor,current_database() db,host(inet_server_addr()) address'),{actor:'r12_test',db:'r12_test',address:target.address});}
  assert.equal((await one(db,"select count(*)::int n from pg_tables where schemaname in ('public','private')")).n,0,'Fresh isolated database required');
  assert.deepEqual((await db.query("select rolname from pg_roles where rolname in ('anon','authenticated','service_role')")).rows,[]);
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  const files=enrollmentRaceMigrations(readdirSync('supabase/migrations'));assert.ok(files.some(x=>x.startsWith(ENROLLMENT_RACE_CUTOFF+'_')),'Only the final named migration can qualify native enrollment');
  for(const f of files)await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
  await enrollmentOriginFixture(db,{onReady:async raw=>{
   const x=await prepared(db,raw),before=await counts(db,x);
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[x.f.ownerId]);await db.exec('set role authenticated');
   try{const result=(await one(db,'select public.r12_owner_direct_enrollment_server($1,$2,$3,$4) x',[x.f.businessId,'confirm',confirmation(x.prepared),x.bootstrapKey])).x;
    assert.equal(result.confirmed,true);assert.equal((await one(db,'select current_user actor')).actor,'authenticated');authenticatedAutocommit=true;
   }finally{await db.exec('reset role');}
   assert.deepEqual(await counts(db,x),{...before,grants:1,revisions:before.revisions+1});
  }});
  // Two exact simultaneous confirmations of one proposal are idempotent.
  await enrollmentOriginFixture(db,{onReady:async raw=>{
   const x=await prepared(db,raw),before=await counts(db,x),p=confirmation(x.prepared);
   const r=await race({first:c=>owner(c,x,'confirm',p),second:c=>owner(c,x,'confirm',p)});
   assert.equal(r.first.confirmed,true);assert.equal(r.second.error,undefined);assert.deepEqual(r.second.value,r.first);
   assert.deepEqual(await counts(db,x),{...before,grants:1,revisions:before.revisions+1});record('duplicate-confirm-one-root-revision',r);
  }});
  // Different genuine reviewed packages cannot both append from the same root
  // snapshot. The loser must obtain a genuinely new reviewed proposal.
  await enrollmentOriginFixture(db,{onReady:async raw=>{
   const x=await prepared(db,raw),grantId=randomUUID(),profileId=randomUUID();
   const bootstrapKey=createHmac('sha256',ENROLLMENT_ROOT).update(JSON.stringify({version:'r12.owner-bootstrap.1',businessId:x.f.businessId,ownerId:x.f.ownerId,grantId})).digest('base64url');
   const y=await prepared(db,{...raw,grantId,profileId,bootstrapKey,serverKeyHash:sha(bootstrapKey)}),before=await counts(db,x);
   const r=await race({first:c=>owner(c,x,'confirm',confirmation(x.prepared)),second:c=>owner(c,y,'confirm',confirmation(y.prepared))});
   assert.equal(r.first.confirmed,true);assert.match(r.second.error?.message??'',/r12_enrollment_current_snapshot_changed/);
   assert.deepEqual(await counts(db,x),{...before,grants:1,revisions:before.revisions+1});record('competing-packages-one-cumulative-extension',r);
  }});
  for(const firstRevocation of [true,false])await enrollmentOriginFixture(db,{onReady:async raw=>{
   const x=await prepared(db,raw),before=await counts(db,x);
   const revoke=c=>c.query('insert into private.r12_direct_enrollment_revocations(package_hash,reason) values($1,$2)',[x.published.reviewedPackageHash,'Inert reviewed revocation race']).then(()=>({revoked:true}));
   const confirm=c=>owner(c,x,'confirm',confirmation(x.prepared));
   const r=await race({first:firstRevocation?revoke:confirm,second:firstRevocation?confirm:revoke});
   if(firstRevocation){assert.match(r.second.error?.message??'',/r12_enrollment_review_inactive/);assert.deepEqual(await counts(db,x),before);}
   else{assert.equal(r.first.confirmed,true);assert.equal(r.second.error,undefined);assert.deepEqual(await counts(db,x),{...before,grants:1,revisions:before.revisions+1});await assert.rejects(x.f.rpc('r12_owner_direct_server',[x.f.businessId,'initial_quote_context',{grantId:x.grantId},x.bootstrapKey]),/r12_enrollment_review_inactive/);}
   record(firstRevocation?'package-revocation-before-confirm-no-grant':'confirmation-before-revocation-no-later-authority',r);
  }});
  // Candidate review revocation precedes envelope creation. Its ordered lock
  // population must include immutable reviewed packages, not only envelopes.
  await enrollmentOriginFixture(db,{onReady:async raw=>{
   const x=await prepared(db,raw),before=await counts(db,x);
   const r=await race({first:c=>c.query('insert into private.r12_verification_candidate_revocations(review_hash) values($1)',[x.registry.verificationCandidate.review_hash]).then(()=>({revoked:true})),second:c=>owner(c,x,'confirm',confirmation(x.prepared))});
   assert.match(r.second.error?.message??'',/r12_landing_review_inactive/);assert.deepEqual(await counts(db,x),before);record('candidate-revocation-before-envelope-blocks-confirm',r);
  }});
  assert.equal(externalCalls,0);return{version:'r12.direct-enrollment-postgres-races.1',engine:'postgresql',passed:true,races,authenticatedAutocommit,providerCalls:0,externalCalls};
 }finally{globalThis.fetch=savedFetch;await Promise.all(clients.map(async c=>{if(connected.has(c))await c.query('rollback').catch(()=>{});await c.end().catch(()=>{});}));}
}
