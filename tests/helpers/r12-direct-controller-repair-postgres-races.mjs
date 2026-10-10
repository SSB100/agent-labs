/** Native observed-lock qualification only. No PGlite substitute, provider
 * transport, database reset, production target or mutation of frozen fixtures. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {asRole,orderedRace,validateOwnerInitialRaceEnvironment} from './r12-owner-initial-postgres-races.mjs';
import {r04SqlBootstrap} from './r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './r10-sql-fixture.mjs';
import {one} from './r12-owner-initial-sql-fixture.mjs';
import {directRepairRaceFixture} from './r12-direct-controller-repair-race-fixture.mjs';
import {directRepairModelExpectation,directRepairModelFail,directRepairFailedReceipt} from './r12-direct-controller-repair-model-fixture.mjs';
import * as model from '../../.core-tests/products/discovery-r12-public-model.js';
import {validatePublicResearchRepairState} from '../../.core-tests/products/discovery-r12-public-repair.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const DIRECT_REPAIR_RACE_MIGRATION_CUTOFF='20261010120700';
export const directRepairRaceMigrationFiles=files=>files.filter(x=>/^\d{14}_.+\.sql$/.test(x)&&x.slice(0,14)<=DIRECT_REPAIR_RACE_MIGRATION_CUTOFF).sort();
export const validateDirectRepairRaceEnvironment=validateOwnerInitialRaceEnvironment;
const control=(db,f,operation,payload,purpose=operation==='dispatch'?'admission':'controller')=>asRole(db,'anon','r12_direct_controller_server',[f.authority.f.businessId,f.prepared.scopeId,operation,payload,f.keys[purpose]]);
const stop=(db,f,payload)=>asRole(db,'authenticated','r12_owner_direct_server',[f.authority.f.businessId,'stop_test',payload,''],f.authority.f.ownerId);
const stopPayload=f=>({testEnvelopeId:f.authority.prepared.testEnvelopeId,testEnvelopeHash:f.authority.prepared.testEnvelopeHash,submissionId:randomUUID()});
const schedulePayload=state=>({phase:'plan',attemptId:randomUUID(),runtimeCapability:'inert-repair-native-'+randomUUID(),expectedStateHash:state.stateHash});
async function counts(db,f){return one(db,`select
 (select count(*)::int from private.r12_direct_counted_units where scope_id=$1) units,
 (select count(*)::int from private.r12_direct_phase_attempts where scope_id=$1) phases,
 (select count(*)::int from private.r12_direct_phase_attempts a join private.r05_requests r on r.id=a.request_id where a.scope_id=$1) requests,
 (select count(*)::int from private.r12_direct_phase_attempts a join private.r05_reservations r on r.request_id=a.request_id where a.scope_id=$1) reservations,
 (select count(*)::int from private.r12_direct_phase_attempts a join private.r05_markers r on r.request_id=a.request_id where a.scope_id=$1) markers,
 (select count(*)::int from private.r12_direct_phase_attempts a join private.r05_settlements r on r.request_id=a.request_id where a.scope_id=$1) settlements,
 (select count(*)::int from private.r12_direct_phase_attempts a join private.r07_responses r on r.attempt_id=a.attempt_id where a.scope_id=$1) responses,
 (select count(*)::int from private.r12_direct_phase_attempts a join private.r12_direct_phase_receipts r on r.attempt_id=a.attempt_id where a.scope_id=$1) receipts,
 (select coalesce(sum(r.actual_microunits),0)::text from private.r12_direct_phase_attempts a join private.r05_settlements r on r.request_id=a.request_id where a.scope_id=$1) actual`,[f.prepared.scopeId]);}
async function frozenOrigin(db,f){return (await one(db,`select private.stage14_hash(private.r12_direct_origin_snapshot(s.business_id,s.goal_id,(z.packet->'predecessor'->'closure'->>'predecessorPlanVersion')::integer)) hash
 from private.r12_direct_research_setups s join private.r12_direct_test_envelopes e on e.id=s.envelope_id join private.r12_direct_origin_freezes z on z.predecessor_plan_id=(e.content->'origin'->'predecessor'->'closure'->>'predecessorPlanId')::uuid where s.scope_id=$1`,[f.prepared.scopeId])).hash;}
async function dispatchBinding(a){const i=a.inputs,ctx=model.readPublicResearchModelInputs(i,directRepairModelExpectation(i)),wire=await model.inspectPublicResearchModelWire(ctx),request=model.buildPublicResearchModelRequest(ctx);return {wire,binding:{version:'r12.discovery-wire.1',scopeId:i.policy.scopeId,scopeHash:i.policy.scopeHash,attemptId:a.attemptId,requestId:a.requestId,phase:a.phase,requestJson:JSON.stringify(request),requestHash:wire.requestHash,wireBody:wire.wire.body,wireHash:wire.wireHash,quote:i.quote,dependencyPins:a.dependencyPins}};}

export async function exerciseDirectRepairPostgresRaces(env=process.env){
 const target=validateDirectRepairRaceEnvironment(env),require=createRequire(path.resolve(target.host,'package.json'));
 assert.equal(require('pg/package.json').version,'8.16.3','Pinned native pg client required');const {Client}=require('pg');
 const clients=['observer','holder','waiter'].map(label=>new Client({connectionString:target.url,ssl:false,application_name:'r12-direct-repair-'+label,connectionTimeoutMillis:5000}));
 const [db,holder,waiter]=clients,connected=new Set(),races=[];const originalFetch=globalThis.fetch;let transportHttpCalls=0;
 globalThis.fetch=async()=>{transportHttpCalls++;throw Error('External HTTP is forbidden in native repair races');};
 const race=actions=>orderedRace({observer:db,holder,waiter,...actions});
 const record=(name,result,before,after)=>{assert.equal(result.observedLockWait,true);races.push({name,observedLockWait:true,waitEvent:result.waitEvent,before,after});};
 try{
  for(const client of clients){await client.connect();connected.add(client);client.exec=sql=>client.query(sql);await client.query("set timezone='UTC'");assert.deepEqual(await one(client,'select current_user actor,current_database() db,host(inet_server_addr()) address'),{actor:'r12_test',db:'r12_test',address:target.address});}
  assert.equal((await one(db,"select count(*)::int n from pg_tables where schemaname in ('public','private')")).n,0,'A fresh isolated database is required; this suite never resets one');
  assert.deepEqual((await db.query("select rolname from pg_roles where rolname in ('anon','authenticated','service_role')")).rows,[],'Fresh synthetic API roles required');
  await db.exec(r04SqlBootstrap+sessionBootstrap);const files=directRepairRaceMigrationFiles(readdirSync(root+'/supabase/migrations'));assert.ok(files.some(x=>x.startsWith(DIRECT_REPAIR_RACE_MIGRATION_CUTOFF+'_')));
  for(const file of files)await db.exec(readFileSync(root+'/supabase/migrations/'+file,'utf8'));
  const a=await directRepairRaceFixture(db);a.authority.db=db;const aOrigin=await frozenOrigin(db,a);
  for(let n=1;n<=9;n++)await directRepairModelFail(a,await a.schedule('plan'));
  const state=(await a.read()).state;validatePublicResearchRepairState(state,a.policy);assert.equal(state.unitsConsumed,9);assert.equal(state.nextAction,'repair_model');
  const before=await counts(db,a),first=schedulePayload(state),second=schedulePayload(state);
  const lastUnit=await race({first:c=>control(c,a,'schedule',first),second:c=>control(c,a,'schedule',second)});
  assert.equal(lastUnit.first.countedUnitOrdinal,10);assert.equal(lastUnit.first.repairOrdinal,9);assert.match(lastUnit.second.error?.message??'',/r12_direct_repair_phase_not_admitted/);
  const reserved=await counts(db,a);assert.deepEqual(reserved,{...before,units:10,phases:10});record('last-unit-competing-schedules-one-reservation',lastUnit,before,reserved);
  const winner=lastUnit.first,wire=await dispatchBinding(winner),halt=stopPayload(a);
  const markerFirst=await race({first:c=>control(c,a,'dispatch',{attemptId:winner.attemptId,binding:wire.binding}),second:c=>stop(c,a,halt)});
  assert.equal(markerFirst.first.shouldDispatch,true);assert.equal(markerFirst.second.error,undefined);assert.equal(markerFirst.second.value.stopped,true);
  const marked=await counts(db,a);assert.deepEqual(marked,{...reserved,requests:10,reservations:10,markers:10});record('repair-marker-before-stop-paid-unit-retained',markerFirst,reserved,marked);
  const stopped=(await a.read()).state;validatePublicResearchRepairState(stopped,a.policy);assert.equal(stopped.unitsConsumed,10);assert.equal((await a.read()).testExposure.hasUnknownOrUnbounded,true);
  await assert.rejects(a.schedule('plan'),/stopped|revoked|inactive|current_test_required/);
  // A genuine persisted but schema-invalid object with independently qualified
  // billing/route proof exercises failed close after Stop, without fabricating
  // a successful response or dropping the paid replacement cost.
  const receipt=directRepairFailedReceipt(a,winner,wire,{});await a.rpc('candidate',{attemptId:winner.attemptId,candidate:receipt.candidate});
  const recovery=await race({first:c=>control(c,a,'model_receipt',{attemptId:winner.attemptId,...receipt}),second:c=>control(c,a,'model_receipt',{attemptId:winner.attemptId,...receipt})});
  assert.equal(recovery.first.accepted,false);assert.equal(recovery.first.diagnostic,'r12_direct_response_schema');assert.equal(recovery.second.error,undefined);assert.equal(recovery.second.value.replayed,true);assert.equal(recovery.second.value.receiptHash,recovery.first.receiptHash);
  const settled=await counts(db,a);assert.deepEqual(settled,{...marked,settlements:10,receipts:10,actual:'10'});record('stopped-late-failure-exact-replay-one-settlement',recovery,marked,settled);
  const recovered=(await a.read());validatePublicResearchRepairState(recovered.state,a.policy);assert.equal(recovered.state.researchStageOutcome,'INVALID_RESEARCH');assert.equal(recovered.state.unitsReserved,10);assert.equal(recovered.state.unitsConsumed,10);assert.equal(recovered.testExposure.knownActualMicrounits,'10');assert.equal(recovered.testExposure.boundedPendingMicrounits,'2000');assert.equal(recovered.testExposure.hasUnknownOrUnbounded,false);assert.deepEqual(await one(db,'select state,plan_id,children_created,dispatches,repairs_used from private.r07_heads where goal_id=$1',[a.authority.f.goalId]),{state:'stopped',plan_id:a.prepared.planId,children_created:a.policy.cumulativeChildrenCeiling,dispatches:a.policy.baseDispatches+10,repairs_used:a.policy.baseRepairs+9});assert.equal(await frozenOrigin(db,a),aOrigin);
  assert.deepEqual((await a.rpc('attempt',{attemptId:winner.attemptId})).candidate,receipt.candidate);

  const b=await directRepairRaceFixture(db);b.authority.db=db;const bOrigin=await frozenOrigin(db,b);await directRepairModelFail(b,await b.schedule('plan'));const bState=(await b.read()).state,bBefore=await counts(db,b),replacement=schedulePayload(bState);
  const stopFirst=await race({first:c=>stop(c,b,stopPayload(b)),second:c=>control(c,b,'schedule',replacement)});
  assert.equal(stopFirst.first.stopped,true);assert.match(stopFirst.second.error?.message??'',/stopped|revoked|inactive|current_test_required/);const bAfter=await counts(db,b);assert.deepEqual(bAfter,bBefore);record('stop-before-repair-no-unit-request-or-marker',stopFirst,bBefore,bAfter);
  const bFinal=(await b.read()).state;validatePublicResearchRepairState(bFinal,b.policy);assert.equal(bFinal.unitsReserved,1);assert.equal(bFinal.unitsConsumed,1);assert.deepEqual(await one(db,'select state,plan_id,children_created,dispatches,repairs_used from private.r07_heads where goal_id=$1',[b.authority.f.goalId]),{state:'stopped',plan_id:b.prepared.planId,children_created:b.policy.cumulativeChildrenCeiling,dispatches:b.policy.baseDispatches+1,repairs_used:b.policy.baseRepairs});assert.equal(await frozenOrigin(db,b),bOrigin);
  assert.equal(transportHttpCalls,0);return {version:'r12.direct-repair-postgres-races.1',engine:'postgresql',passed:true,providerCalls:0,transportHttpCalls,migrationCutoff:DIRECT_REPAIR_RACE_MIGRATION_CUTOFF,races,originalHistoryPreserved:true};
 }finally{globalThis.fetch=originalFetch;await Promise.all(clients.map(async c=>{if(connected.has(c))await c.query('rollback').catch(()=>{});await c.end().catch(()=>{});}));}
}
