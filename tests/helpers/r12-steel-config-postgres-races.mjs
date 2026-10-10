/** Native multi-session qualification only. The target must be a fresh isolated
 * r12_test cluster; neither PGlite nor sequential calls establish race evidence. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {r04SqlBootstrap} from './r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './r10-sql-fixture.mjs';
import {asRole,orderedRace,validateOwnerInitialRaceEnvironment} from './r12-owner-initial-postgres-races.mjs';
import {one} from './r12-owner-initial-sql-fixture.mjs';
import {prepareSteelConfigSetup} from './r12-steel-config-prepared-setup-fixture.mjs';
import {admitSteelConfig} from './r12-steel-config-sql-fixture.mjs';

export const STEEL_CONFIG_RACE_CUTOFF='20261010121300';
export const validateSteelConfigRaceEnvironment=validateOwnerInitialRaceEnvironment;
export const steelConfigRaceMigrations=files=>files.filter(file=>/^\d{14}_.+\.sql$/.test(file)&&file.slice(0,14)<=STEEL_CONFIG_RACE_CUTOFF).sort();
const transport=(db,f,request=f.createRequest,key=f.bridge.keys.handoff)=>asRole(db,'anon','r12_etsy_steel_server',[f.businessId,'transport',{operationId:f.operationId,request},key]);
const revoke=(db,f)=>db.query('insert into private.r12_steel_config_attestation_revocations(attestation_hash) values($1)',[f.attestation.attestationHash]).then(()=>({revoked:true}));
const counts=(db,f)=>one(db,`select
 (select count(*)::int from private.r12_steel_create_config_requests where operation_id=$1) requests,
 (select count(*)::int from private.r12_steel_create_config_permits where operation_id=$1) permits,
 (select count(*)::int from private.r12_steel_create_config_uses where operation_id=$1) uses,
 (select count(*)::int from private.r12_etsy_steel_dispatches where operation_id=$1) claims,
 (select count(*)::int from private.r05_reservations where request_id=$2) reservations,
 (select count(*)::int from private.r05_markers where request_id=$2) markers`,[f.operationId,f.reserved.reservationId]);

export async function exerciseSteelConfigPostgresRaces(env=process.env){
 const target=validateSteelConfigRaceEnvironment(env),require=createRequire(resolve(target.host,'package.json'));
 assert.equal(require('pg/package.json').version,'8.16.3');
 const {Client}=require('pg'),clients=['observer','holder','waiter'].map(label=>new Client({connectionString:target.url,ssl:false,application_name:'r12-steel-config-'+label,connectionTimeoutMillis:5000}));
 const [db,holder,waiter]=clients,connected=new Set(),races=[],savedFetch=globalThis.fetch;let externalCalls=0;
 globalThis.fetch=async()=>{externalCalls++;throw Error('External transport forbidden in native Steel config races');};
 const race=actions=>orderedRace({observer:db,holder,waiter,...actions});
 const record=(name,result)=>{assert.equal(result.observedLockWait,true);races.push({name,observedLockWait:true,waitEvent:result.waitEvent});};
 try{
  for(const client of clients){await client.connect();connected.add(client);client.exec=sql=>client.query(sql);await client.query("set timezone='UTC'");assert.deepEqual(await one(client,'select current_user actor,current_database() db,host(inet_server_addr()) address'),{actor:'r12_test',db:'r12_test',address:target.address});}
  assert.equal((await one(db,"select count(*)::int n from pg_tables where schemaname in ('public','private')")).n,0,'A fresh isolated database is required');
  assert.deepEqual((await db.query("select rolname from pg_roles where rolname in ('anon','authenticated','service_role')")).rows,[]);
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  const files=steelConfigRaceMigrations(readdirSync('supabase/migrations'));
  assert.ok(files.some(file=>file.startsWith(STEEL_CONFIG_RACE_CUTOFF+'_')),'Only the final named migration can qualify native Steel config admission');
  for(const file of files)await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));

  const revoked=await prepareSteelConfigSetup(db),revokedBefore=await counts(db,revoked);
  const revocationFirst=await race({first:client=>revoke(client,revoked),second:client=>transport(client,revoked)});
  assert.deepEqual(revocationFirst.first,{revoked:true});assert.match(revocationFirst.second.error?.message??'',/r12_steel_config_permit_required/);
  assert.deepEqual(await counts(db,revoked),revokedBefore);
  await assert.rejects(admitSteelConfig(db,revoked.businessId,revoked.request,revoked.bridge.keys.handoff),/r12_steel_config_attestation_required/);
  record('revocation-before-create-no-use-or-claim',revocationFirst);

  const admitted=await prepareSteelConfigSetup(db),admittedBefore=await counts(db,admitted);
  const createFirst=await race({first:client=>transport(client,admitted),second:client=>revoke(client,admitted)});
  assert.deepEqual(createFirst.first,{allowed:true,operationId:admitted.operationId});assert.equal(createFirst.second.error,undefined);
  assert.deepEqual(await counts(db,admitted),{...admittedBefore,uses:1,claims:1});
  await assert.rejects(admitSteelConfig(db,admitted.businessId,admitted.request,admitted.bridge.keys.handoff),/r12_steel_config_(operation_inactive|create_already_consumed)/);
  for(const [operation,method,suffix]of [['browser.etsy.session.release','POST','/release'],['browser.etsy.session.release_readback','GET','']]){
   const result=await admitted.bridge.server('transport',{operationId:admitted.operationId,request:{provider:'steel',operation,method,endpoint:'https://api.steel.dev/v1/sessions/'+admitted.operationId+suffix}},'cleanup');
   assert.deepEqual(result,{allowed:true,operationId:admitted.operationId});
  }
  assert.deepEqual(await counts(db,admitted),{...admittedBefore,uses:1,claims:1});
  record('create-before-revocation-one-use-cleanup-survives',createFirst);

  const duplicate=await prepareSteelConfigSetup(db),duplicateBefore=await counts(db,duplicate);
  const duplicateCreate=await race({first:client=>transport(client,duplicate),second:client=>transport(client,duplicate)});
  assert.deepEqual(duplicateCreate.first,{allowed:true,operationId:duplicate.operationId});assert.match(duplicateCreate.second.error?.message??'',/r12_steel_config_operation_inactive|duplicate key/);
  assert.deepEqual(await counts(db,duplicate),{...duplicateBefore,uses:1,claims:1});
  record('duplicate-create-consumes-once',duplicateCreate);
  assert.equal(externalCalls,0);return{version:'r12.steel-config-postgres-races.1',engine:'postgresql',passed:true,races,providerCalls:0,externalCalls};
 }finally{globalThis.fetch=savedFetch;await Promise.all(clients.map(async client=>{if(connected.has(client))await client.query('rollback').catch(()=>{});await client.end().catch(()=>{});}));}
}
