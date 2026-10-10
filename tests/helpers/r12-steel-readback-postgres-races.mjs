/** Actual PostgreSQL sessions only. Sequential SQL/PGlite is never presented as
 * concurrency evidence; no provider, route, grant, or create authority exists. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {asRole,orderedRace,validateOwnerInitialRaceEnvironment} from './r12-owner-initial-postgres-races.mjs';
import {bootstrapReadback,readbackFixture,readbackOwner,claimReadback,readbackServer,proofPayload,readbackCounts,one,sha,readbackMigrations} from './r12-steel-readback-sql-fixture.mjs';
import {authorizedReadbackFixture,publishReadbackAuthorization} from './r12-steel-readback-authorization-fixture.mjs';
export const validateSteelReadbackRaceEnvironment=validateOwnerInitialRaceEnvironment;
export {readbackMigrations};
const server=(db,f,operation,payload)=>asRole(db,'authenticated','r12_steel_config_readback_server',[f.businessId,operation,payload,f.key],f.ownerId);
const claim=(db,f)=>server(db,f,'claim',{targetHash:f.target.targetHash,submissionId:randomUUID()});
const cancel=(db,f)=>server(db,f,'cancel',{targetHash:f.target.targetHash});
const revoke=(db,f)=>db.query("insert into private.r12_steel_readback_revocations(target_hash,reason) values($1,'operator_revoked')",[f.target.targetHash]).then(()=>({revoked:true}));
export async function exerciseSteelReadbackPostgresRaces(env=process.env){
 const target=validateSteelReadbackRaceEnvironment(env),require=createRequire(resolve(target.host,'package.json'));assert.equal(require('pg/package.json').version,'8.16.3');
 const{Client}=require('pg'),clients=['observer','holder','waiter'].map(label=>new Client({connectionString:target.url,ssl:false,application_name:'r12-steel-readback-'+label,connectionTimeoutMillis:5000})),[db,holder,waiter]=clients,connected=new Set(),races=[];
 const savedFetch=globalThis.fetch;let externalCalls=0;globalThis.fetch=async()=>{externalCalls++;throw Error('No external transport in metadata races');};
 const race=actions=>orderedRace({observer:db,holder,waiter,...actions});
 const record=(name,result)=>{assert.equal(result.observedLockWait,true);races.push({name,observedLockWait:true,waitEvent:result.waitEvent});};
 try{
  for(const c of clients){await c.connect();connected.add(c);c.exec=sql=>c.query(sql);await c.query("set timezone='UTC'");assert.deepEqual(await one(c,'select current_user actor,current_database() db,host(inet_server_addr()) address'),{actor:'r12_test',db:'r12_test',address:target.address});}
  assert.equal((await one(db,"select count(*)::int n from pg_tables where schemaname in ('public','private')")).n,0,'Fresh isolated database required');assert.deepEqual((await db.query("select rolname from pg_roles where rolname in ('anon','authenticated','service_role')")).rows,[]);
  await bootstrapReadback(db);
  for(const exceptional of [false,true]){
  const fixture=()=>exceptional?authorizedReadbackFixture(db):readbackFixture(db);
  const label=name=>(exceptional?'one-shot-':'historical-')+name;
  const f=await fixture(),duplicate=await race({first:c=>claim(c,f),second:c=>claim(c,f)});assert.equal(duplicate.first.mayFetch,true);assert.equal(duplicate.second.value.mayFetch,false);assert.equal(duplicate.second.value.status.status,'pending');assert.equal((await one(db,'select count(*)::int n from private.r12_steel_readback_claims where target_hash=$1',[f.target.targetHash])).n,1);record(label('competing-claims-one-fetch-permission'),duplicate);
  for(const firstCancel of [true,false]){
   const f=await fixture(),r=await race({first:c=>firstCancel?cancel(c,f):claim(c,f),second:c=>firstCancel?claim(c,f):cancel(c,f)});
   if(firstCancel){assert.equal(r.first.status,'cancelled');assert.equal(r.second.value.mayFetch,false);assert.equal(r.second.value.status.status,'cancelled');}
   else{assert.equal(r.first.mayFetch,true);assert.equal(r.second.value.status,'cancelled');await assert.rejects(readbackServer(db,f,'record',proofPayload(f,r.first)),/result_conflict/);}
   record(label(firstCancel?'cancel-before-claim-no-fetch':'claim-before-cancel-no-late-proof'),r);
  }
  for(const firstRevoke of [true,false]){
   const f=await fixture(),r=await race({first:c=>firstRevoke?revoke(c,f):claim(c,f),second:c=>firstRevoke?claim(c,f):revoke(c,f)});
   if(firstRevoke){assert.equal(r.first.revoked,true);if(exceptional)assert.match(r.second.error?.message??'',/authorization_required/);else{assert.equal(r.second.value.mayFetch,false);assert.equal(r.second.value.status.status,'review_required');}}
   else{assert.equal(r.first.mayFetch,true);assert.equal(r.second.value.revoked,true);await assert.rejects(readbackServer(db,f,'record',proofPayload(f,r.first)),exceptional?/authorization_required/:/claim_expired/);}
   record(label(firstRevoke?'revoke-before-claim-no-fetch':'claim-before-revoke-no-late-proof'),r);
  }
  for(const firstCancel of [true,false]){
   const f=await fixture(),a=await claimReadback(db,f),payload=proofPayload(f,a),r=await race({first:c=>firstCancel?cancel(c,f):server(c,f,'record',payload),second:c=>firstCancel?server(c,f,'record',payload):cancel(c,f)});
   if(firstCancel){assert.equal(r.first.status,'cancelled');assert.match(r.second.error?.message??'',/result_conflict/);}
   else{assert.equal(r.first.status,'verified');assert.equal(r.second.value.status,'verified');assert.equal(r.second.value.proofHash,r.first.proofHash);}
   record(label(firstCancel?'cancel-before-record-no-proof':'record-before-cancel-retains-proof'),r);
  }
  for(const revokeFirst of [true,false]){
   const f=await fixture(),c=await claimReadback(db,f),payload=proofPayload(f,c);
   const r=await race({first:conn=>revokeFirst?revoke(conn,f):server(conn,f,'record',payload),second:conn=>revokeFirst?server(conn,f,'record',payload):revoke(conn,f)});
   if(revokeFirst){assert.equal(r.first.revoked,true);assert.match(r.second.error?.message??'',exceptional?/authorization_required/:/claim_expired/);}
   else{assert.equal(r.first.status,'verified');assert.equal(r.second.value.revoked,true);}
   record(label('target-revocation-'+(revokeFirst?'before-':'after-')+'record'),r);
  }
  for(const stage of ['claim','record'])for(const revokeFirst of [true,false]){
   const f=await fixture();if(!exceptional){f.key='inert-root-revocation-race-'+randomUUID();await db.query("insert into private.r05_server_keys(key_hash,expires_at) values($1,clock_timestamp()+interval '1 day')",[sha(f.key)]);}
   const a=stage==='record'?await claimReadback(db,f):null,payload=a?proofPayload(f,a):null;
   const work=c=>stage==='claim'?claim(c,f):server(c,f,'record',payload),rootRevoke=c=>c.query('insert into private.r05_server_revocations(key_hash) values($1)',[sha(f.key)]).then(()=>({revoked:true}));
   const r=await race({first:c=>revokeFirst?rootRevoke(c):work(c),second:c=>revokeFirst?work(c):rootRevoke(c),lockRelation:'private.r05_server_keys'});
   if(revokeFirst){assert.equal(r.first.revoked,true);assert.match(r.second.error?.message??'',/server_required/);assert.equal((await one(db,'select count(*)::int n from private.r12_steel_readback_results where target_hash=$1',[f.target.targetHash])).n,0);}
   else{assert.equal(r.second.value.revoked,true);if(stage==='claim'){assert.equal(r.first.mayFetch,true);await assert.rejects(readbackServer(db,f,'record',proofPayload(f,r.first)),/server_required/);}else assert.equal(r.first.status,'verified');}
   record(label('root-revocation-'+(revokeFirst?'before-':'after-')+stage),r);
  }
  for(const stage of ['claim','record']){
   const f=await fixture(),other=await readbackOwner(db),c=stage==='record'?await claimReadback(db,f):null;
   const r=await race({first:conn=>conn.query('update public.businesses set owner_user_id=$2 where id=$1',[f.businessId,other.ownerId]).then(()=>({changed:true})),second:conn=>stage==='claim'?claim(conn,f):server(conn,f,'record',proofPayload(f,c))});
   assert.equal(r.first.changed,true);assert.match(r.second.error?.message??'',/owner_required/);record(label('owner-change-before-'+stage),r);
  }
  }
  for(const revokeFirst of [true,false]){
   const f=await authorizedReadbackFixture(db,{publish:false}),publish=conn=>publishReadbackAuthorization(conn,f.authorization),rootRevoke=conn=>conn.query('insert into private.r05_server_revocations(key_hash) values($1)',[sha(f.key)]).then(()=>({revoked:true}));
   const r=await race({first:conn=>revokeFirst?rootRevoke(conn):publish(conn),second:conn=>revokeFirst?publish(conn):rootRevoke(conn),lockRelation:'private.r05_server_keys'});
   if(revokeFirst){assert.equal(r.first.revoked,true);assert.match(r.second.error?.message??'',/expired_root_required/);}
   else{assert.equal(r.first.metadataOnly,true);assert.equal(r.second.value.revoked,true);await assert.rejects(claimReadback(db,f),/server_required/);}
   record('one-shot-root-revocation-'+(revokeFirst?'before-':'after-')+'publication',r);
  }
  for(const stopFirst of [true,false]){
   const f=await authorizedReadbackFixture(db),stop=conn=>asRole(conn,'authenticated','r05_policy_owner',[f.businessId,'pause',{kind:'quest',id:f.goalId},randomUUID()],f.ownerId);
   const r=await race({first:conn=>stopFirst?stop(conn):claim(conn,f),second:conn=>stopFirst?claim(conn,f):stop(conn)});
   if(stopFirst){assert.equal(r.first.paused,true);assert.match(r.second.error?.message??'',/goal_required/);}
   else{assert.equal(r.first.mayFetch,true);assert.equal(r.second.value.paused,true);assert.equal((await readbackServer(db,f,'record',proofPayload(f,r.first))).status,'verified');}
   record('one-shot-'+(stopFirst?'stop-before-claim-no-fetch':'claim-before-stop-honest-record'),r);
  }
  const counts=await readbackCounts(db);for(const k of ['attestations','permits','uses','routes','grants','operations'])assert.equal(counts[k],0);assert.equal(externalCalls,0);
  return{version:'r12.steel-readback-postgres-races.2',engine:'postgresql',passed:true,races,externalCalls,providerCalls:0,noCreateAuthority:true};
 }finally{globalThis.fetch=savedFetch;await Promise.all(clients.map(async c=>{if(connected.has(c))await c.query('rollback').catch(()=>{});await c.end().catch(()=>{});}));}
}
