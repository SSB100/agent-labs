/** Actual PostgreSQL multi-session qualification only. Every URL is constrained
 * to the fresh disposable loopback r12_test database. No provider transport,
 * production connection, migration repair, or sequential substitute for races. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {r04SqlBootstrap} from './r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './r10-sql-fixture.mjs';
import {validateR12HttpDatabase} from './r12-postgrest-http.mjs';
import {r12RaceExpectedServerAddress} from './r12-recovery-reconciliation-races.mjs';
import {ownerInitialSqlFixture,ownerInitialRuntimeRpc,one} from './r12-owner-initial-sql-fixture.mjs';
import {r12QuoteFixture} from './r12-provider-fixture.mjs';
import {discoveryV2Hash as hash} from '../../.core-tests/products/discovery-v2.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(import.meta.url);
const core=name=>require('../../.core-tests/'+name+'.js');
const phaseRuntime='inert-owner-race-phase-runtime-capability-0123456789';
const bootstrapRoot='inert-owner-race-bootstrap-root-configuration-0123456789';
export function validateOwnerInitialRaceEnvironment(env){
 assert.equal(env.R12_REQUIRE_POSTGRES,'1','Owner-initial races require real PostgreSQL; PGlite is not a race substitute');
 assert.ok(env.R12_SQL_TEST_HOST,'Pinned native SQL test host required');
 assert.ok(!env.PGOPTIONS&&!env.PGSERVICE&&!env.PGSERVICEFILE,'Inherited database options are forbidden');
 validateR12HttpDatabase(env.R12_POSTGRES_URL);
 return {url:env.R12_POSTGRES_URL,address:r12RaceExpectedServerAddress(env),host:env.R12_SQL_TEST_HOST};
}
const observe=promise=>promise.then(value=>({value}),error=>({error}));
function pending(action){const state={done:false};state.promise=observe(action()).then(value=>{state.done=true;return value;});return state;}
async function begin(db){await db.query('begin isolation level read committed');await db.query("set local statement_timeout='20s';set local lock_timeout='10s';set local timezone='UTC'");}
async function asRole(db,role,name,args,ownerId=null){
 assert.ok(['anon','authenticated'].includes(role));assert.match(name,/^[a-z][a-z0-9_]+$/);
 if(ownerId)await db.query("select set_config('request.jwt.claim.sub',$1,true)",[ownerId]);
 await db.query('set local role '+role);
 const result=(await one(db,`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).result;
 await db.query('reset role');return result;
}
function owner(db,f,operation,payload){return asRole(db,'authenticated','r12_owner_research_server',[f.businessId,operation,payload,operation.startsWith('stop')?'':f.bootstrapKey],f.ownerId);}
async function waitForBusinessLock(observer,waiter,holder,inflight){
 const until=performance.now()+5000;
 while(performance.now()<until){
  assert.equal(inflight.done,false,'Contender completed without the required observed lock wait');
  const evidence=await one(observer,`select a.wait_event_type,a.wait_event,pg_blocking_pids(a.pid) blockers,
   exists(select 1 from pg_locks l where l.pid=a.pid and not l.granted) waiting_lock,
   exists(select 1 from pg_locks l where l.pid=$2 and l.relation='public.businesses'::regclass and l.granted) holder_business_lock
   from pg_stat_activity a where a.pid=$1`,[waiter.processID,holder.processID]);
  if(evidence?.wait_event_type==='Lock'&&evidence.blockers.includes(holder.processID)&&evidence.waiting_lock&&evidence.holder_business_lock)return {waitEvent:evidence.wait_event,observedLockWait:true};
  await pause(10);
 }
 assert.fail('No positively observed Business lock wait between the two PostgreSQL backends');
}
async function orderedRace({observer,holder,waiter,first,second}){
 await begin(holder);await begin(waiter);let inflight;
 try{
  const firstResult=await first(holder);inflight=pending(()=>second(waiter));
  const evidence=await waitForBusinessLock(observer,waiter,holder,inflight);
  await holder.query('commit');const secondResult=await inflight.promise;
  await waiter.query(secondResult.error?'rollback':'commit');
  return {first:firstResult,second:secondResult,...evidence};
 }finally{
  await holder.query('rollback').catch(()=>{});await waiter.query('rollback').catch(()=>{});
  if(inflight)await inflight.promise;
 }
}
async function counts(db,f){return one(db,`select
 (select count(*)::int from private.r12_owner_activations where business_id=$1) activations,
 (select count(*)::int from private.r12_discovery_scopes where business_id=$1) scopes,
 (select count(*)::int from private.r12_discovery_authorities where business_id=$1) authorities,
 (select count(*)::int from private.r05_confirmations where business_id=$1) confirmations,
 (select count(*)::int from private.r05_cap_versions where business_id=$1) caps,
 (select count(*)::int from private.r12_owner_funding_revisions where binding_id=$2) funding_revisions,
 (select count(*)::int from private.r07_server_keys k join private.r12_discovery_authorities a on a.controller_key_hash=k.key_hash where a.business_id=$1) controller_verifiers,
 (select count(*)::int from private.r05_server_keys k join private.r12_discovery_authorities a on a.admission_key_hash=k.key_hash where a.business_id=$1) admission_verifiers,
 (select count(*)::int from private.r05_reservations where business_id=$1) reservations,
 (select count(*)::int from private.r05_markers where business_id=$1) dispatch_markers,
 (select count(*)::int from private.r12_discovery_transport_claims t join private.r05_requests r on r.id=t.request_id where r.business_id=$1) transport_claims`,[f.businessId,f.bindingId]);}
async function newGoal(f,label){
 const content={...structuredClone(f.content),title:'Owner race '+label,originalIntent:f.content.originalIntent+' '+label,objective:f.content.objective+' '+label};
 const goal=await f.rpc('r04_quest_transition',[f.businessId,'quest.save',{goalId:null,expectedRevision:0,content},randomUUID()]);
 await f.rpc('r04_quest_transition',[f.businessId,'quest.preference',{goalId:goal.id,expectedRevision:1,preference:'ready'},randomUUID()]);return goal.id;
}
export function conservativeOwnerRaceQuote(){
 const q=r12QuoteFixture();q.ceilings.plan=500000;
 q.maximumMicrousd=Object.values(q.ceilings).reduce((a,b)=>a+b,0);
 const {quoteHash:_hash,verifiedAt:_verified,validUntil:_valid,...body}=q;void[_hash,_verified,_valid];q.quoteHash=hash(body);
 assert.ok(q.maximumMicrousd<1000000&&2*q.ceilings.plan>q.maximumMicrousd);
 return q;
}
async function prepare(f,{goalId=f.goalId,businessLimit='6000000',researchLimit=businessLimit,quote=r12QuoteFixture()}={}){
 const input={...f.input,goalId,submissionId:randomUUID(),businessLifetimeLimitMicrounits:businessLimit,researchLifetimeLimitMicrounits:researchLimit};
 return f.server('prepare',{input,quote});
}
async function startPlanner(db,f,receipt){
 const controller='inert-controller-'+receipt.scopeId,admission='inert-admission-'+receipt.scopeId,lease='inert-owner-race-lease-'+receipt.scopeId;
 const view=await f.rpc('r12_discovery_owner_read',[f.businessId,receipt.scopeId,true]);
 const command=(op,payload,epoch=null)=>ownerInitialRuntimeRpc(db,'r07_controller',[f.businessId,receipt.goalId,op,payload,randomUUID(),controller,lease,epoch,admission]);
 await command('plan',{plan:view.activation.plan,expectedVersion:0,reason:'Inert PostgreSQL race qualification',evidenceHash:'7'.repeat(64)});
 const claim=await command('claim',{seconds:120}),attemptId=randomUUID();
 const scheduled=await command('schedule',{stepKey:'plan',attemptId,reason:'Inert competing planner reservation',evidenceHash:'8'.repeat(64),runtimeCapability:phaseRuntime},claim.epoch);
 assert.equal(scheduled.status,'scheduled');
 const snapshot=await command('read',{}),plan=core('core/quest-plan').compileQuestPlan(snapshot.plan);
 const context={planId:snapshot.planId,planHash:snapshot.planHash,plan,step:plan.steps[0],attempt:snapshot.attempts[0],knowledge:core('core/reviewed-knowledge').readQuestKnowledge(snapshot.knowledge,snapshot.businessId,snapshot.planId)};
 const raw=await ownerInitialRuntimeRpc(db,'r12_discovery_server',[f.businessId,attemptId,'inputs',{},controller]);
 const runtime=core('products/discovery-r12-runtime'),request=runtime.buildDiscoveryR12PhaseRequest(context,runtime.readDiscoveryR12PhaseInputs(context,raw));
 const adapter=core('products/discovery-r12-adapter').createDiscoveryR12QuestAdapter({scope:raw.amendment,phase:'plan',identity:{qualificationHash:context.step.qualificationHash,workflowDefinitionId:context.step.workflowDefinitionId,workerDefinitionId:context.step.workerDefinitionId,mode:'qualification'},dataClasses:['business_context','public_evidence'],quote:async()=>r12QuoteFixture(),request:async()=>request,
  config:{apiKey:'inert-never-transmitted-race-configuration',baseUrl:'https://openrouter.ai/api/v1',appUrl:'https://agent-labs.example.invalid',appName:'Inert race fixture'},
  store:{operation:async()=>{throw Error('No effect-store mutation in reservation preparation');},settle:async()=>{throw Error('No settlement in reservation race');},dispatchedAt:async()=>{throw Error('No dispatch in reservation race');}},project:async()=>{throw Error('No provider output in reservation race');},fetcher:async()=>{throw Error('No HTTP transport in reservation races');}});
 const call=await adapter.prepare(context);
 assert.equal(call.descriptor.liabilityMicrounits,'500000');
 return {f,goalId:receipt.goalId,attemptId,controller,admission,lease,epoch:claim.epoch,payload:{attemptId,descriptor:call.descriptor,runtimeCapability:phaseRuntime}};
}
function reserve(db,ctx){return asRole(db,'anon','r07_controller',[ctx.f.businessId,ctx.goalId,'reserve',ctx.payload,randomUUID(),ctx.controller,ctx.lease,ctx.epoch,ctx.admission]);}

/** Exported so the exact financial setup can be smoke-tested in isolation;
 * only exerciseOwnerInitialPostgresRaces establishes concurrent race evidence. */
export async function prepareOwnerInitialFinancialContenders(db,kind){
 assert.ok(['native','legacy'].includes(kind));
 const f=await ownerInitialSqlFixture(db,{bootstrapRoot,legacy:kind==='legacy'?{committedMicrounits:1900000}:null});
 const quote=conservativeOwnerRaceQuote(),businessLimit=kind==='native'?String(quote.maximumMicrousd):'6000000',researchLimit=kind==='legacy'?String(1900000+quote.maximumMicrousd):businessLimit;
 const first=await prepare(f,{businessLimit,researchLimit,quote});await f.server('confirm',f.confirmPayload(first));
 const secondGoal=await newGoal(f,'distinct second research question');
 const second=await prepare(f,{goalId:secondGoal,businessLimit,researchLimit,quote:conservativeOwnerRaceQuote()});await f.server('confirm',f.confirmPayload(second));
 const firstPlanner=await startPlanner(db,f,first),secondPlanner=await startPlanner(db,f,second);
 return {f,firstPlanner,secondPlanner,maximum:kind==='legacy'?1900000+quote.maximumMicrousd:quote.maximumMicrousd,priorKnown:kind==='legacy'?1900000:0};
}

export async function exerciseOwnerInitialPostgresRaces(env=process.env){
 const target=validateOwnerInitialRaceEnvironment(env),req=createRequire(path.resolve(target.host,'package.json'));
 assert.equal(req('pg/package.json').version,'8.16.3','Pinned pg client required');const {Client}=req('pg');
 const clients=['observer','holder','waiter'].map(label=>new Client({connectionString:target.url,ssl:false,application_name:'r12-owner-initial-'+label,connectionTimeoutMillis:5000}));
 const [db,holder,waiter]=clients,connected=new Set();const originalFetch=globalThis.fetch;let transportCalls=0;const races=[];
 globalThis.fetch=async()=>{transportCalls++;throw Error('All HTTP is forbidden in owner-initial PostgreSQL races');};
 try{
  for(const client of clients){await client.connect();connected.add(client);client.exec=sql=>client.query(sql);await client.query("set timezone='UTC'");
   assert.deepEqual(await one(client,'select current_user actor,current_database() db,host(inet_server_addr()) address'),{actor:'r12_test',db:'r12_test',address:target.address});}
  assert.equal((await one(db,"select count(*)::int n from pg_tables where schemaname in ('public','private')")).n,0,'Refuse nonempty database; use the existing guarded reset before this suite');
  assert.deepEqual((await db.query("select rolname from pg_roles where rolname in ('anon','authenticated','service_role')")).rows,[],'Fresh cluster bootstrap roles required');
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const file of readdirSync(root+'/supabase/migrations').filter(x=>x.endsWith('.sql')).sort())await db.exec(readFileSync(root+'/supabase/migrations/'+file,'utf8'));
  const record=(name,r)=>{assert.equal(r.observedLockWait,true);races.push({name,observedLockWait:true,waitEvent:r.waitEvent});};

  // Preparation replay identity is the owner input, not volatile server quote
  // timestamps. The winning immutable quote is retained without authority.
  const staging=await ownerInitialSqlFixture(db,{bootstrapRoot}),stagingInput={...staging.input},firstQuote=r12QuoteFixture(Date.now()-1000),secondQuote=r12QuoteFixture();
  assert.notEqual(firstQuote.verifiedAt,secondQuote.verifiedAt);
  const setupRace=await orderedRace({observer:db,holder,waiter,first:c=>owner(c,staging,'prepare',{input:stagingInput,quote:firstQuote}),second:c=>owner(c,staging,'prepare',{input:stagingInput,quote:secondQuote})});
  assert.equal(setupRace.second.error,undefined);assert.equal(setupRace.second.value.replayed,true);assert.equal(setupRace.first.setupId,setupRace.second.value.setupId);assert.equal(setupRace.second.value.preview.quote.verifiedAt,firstQuote.verifiedAt);assert.equal(setupRace.second.value.activated,false);
  const stagedCounts=await one(db,`select
   (select count(*)::int from private.r12_owner_setups where business_id=$1) setups,
   (select count(*)::int from private.r05_policies where business_id=$1) policies,
   (select count(*)::int from private.r05_operations where operation_key like 'research.r12.'||$2::text||'.%') operations,
   (select count(*)::int from private.r07_adapters where adapter_key like 'r12.discovery.'||$2::text||'.%') adapters,
   (select count(*)::int from private.r12_discovery_scopes where business_id=$1) scopes`,[staging.businessId,setupRace.first.scopeId]);
  assert.deepEqual(stagedCounts,{setups:1,policies:1,operations:5,adapters:5,scopes:0});record('duplicate-prepare-retains-one-exact-setup-and-quote',setupRace);

  // Exact retry: both sessions return one immutable activation receipt.
  const exact=await ownerInitialSqlFixture(db,{bootstrapRoot,legacy:{committedMicrounits:1900000}}),prepared=await prepare(exact,{researchLimit:'3000000'}),confirmation=exact.confirmPayload(prepared);
  const duplicate=await orderedRace({observer:db,holder,waiter,first:c=>owner(c,exact,'confirm',confirmation),second:c=>owner(c,exact,'confirm',confirmation)});
  assert.equal(duplicate.first.activated,true);assert.equal(duplicate.second.error,undefined);assert.equal(duplicate.second.value.replayed,true);assert.equal(duplicate.second.value.scopeId,prepared.scopeId);
  assert.deepEqual(await counts(db,exact),{activations:1,scopes:1,authorities:1,confirmations:1,caps:1,funding_revisions:1,controller_verifiers:1,admission_verifiers:1,reservations:0,dispatch_markers:0,transport_claims:0});record('duplicate-confirmation-one-cap-one-root-revision',duplicate);

  // Different submissions/setups cannot create a second initial scope on a Goal.
  const same=await ownerInitialSqlFixture(db,{bootstrapRoot}),sameA=await prepare(same),sameB=await prepare(same);
  const sameGoal=await orderedRace({observer:db,holder,waiter,first:c=>owner(c,same,'confirm',same.confirmPayload(sameA)),second:c=>owner(c,same,'confirm',same.confirmPayload(sameB))});
  assert.match(sameGoal.second.error?.message??'',/initial_run_already_exists/);assert.equal((await counts(db,same)).authorities,1);assert.equal((await counts(db,same)).caps,1);record('same-goal-two-setups-one-activation',sameGoal);

  for(const stopFirst of [true,false]){
   const f=await ownerInitialSqlFixture(db,{bootstrapRoot}),s=await prepare(f),confirm=f.confirmPayload(s),stop={setupId:s.setupId,setupHash:s.setupHash,submissionId:randomUUID()};
   const race=await orderedRace({observer:db,holder,waiter,first:c=>owner(c,f,stopFirst?'stop':'confirm',stopFirst?stop:confirm),second:c=>owner(c,f,stopFirst?'confirm':'stop',stopFirst?confirm:stop)});
   const n=await counts(db,f);assert.equal(n.scopes,stopFirst?0:1);assert.equal(n.caps,stopFirst?0:1);assert.equal(n.controller_verifiers,stopFirst?0:1);assert.equal(n.admission_verifiers,stopFirst?0:1);assert.equal(n.dispatch_markers,0);
   assert.equal((await one(db,'select count(*)::int n from private.r05_revocations where policy_id=$1',[s.policyId])).n,1);
   if(stopFirst)assert.match(race.second.error?.message??'',/setup_stopped|revoked/);else{
    assert.equal(race.second.error,undefined);assert.equal(race.second.value.stopped,true);
    const workspace=await f.rpc('r12_discovery_owner_read',[f.businessId,s.scopeId,false]);assert.equal(workspace.activeWindow,false);assert.equal(workspace.policyRevoked,true);
    await assert.rejects(f.rpc('r12_discovery_scope_read',[f.businessId,s.scopeId]),/scope_changed/);
   }
   record(stopFirst?'stop-before-activation-no-authority':'activation-before-stop-authority-revoked',race);
  }

  // Grant consumption is checked under the same Business/root locks.
  for(const bound of ['count','allocation']){
   const grant=await ownerInitialSqlFixture(db,{bootstrapRoot,maximumScopes:bound==='count'?1:4,maximumAllocation:bound==='allocation'?r12QuoteFixture().maximumMicrousd:8000000}),grantGoal=await newGoal(grant,'grant competitor');
   const grantA=await prepare(grant),grantB=await prepare(grant,{goalId:grantGoal});
   const grantRace=await orderedRace({observer:db,holder,waiter,first:c=>owner(c,grant,'confirm',grant.confirmPayload(grantA)),second:c=>owner(c,grant,'confirm',grant.confirmPayload(grantB))});
   assert.match(grantRace.second.error?.message??'',/grant_exhausted/);assert.equal((await counts(db,grant)).activations,1);
   if(bound==='allocation')assert.equal(Number((await one(db,'select sum(allocation_microunits)::text n from private.r12_owner_activations where grant_root_id=$1',[grant.rootId])).n),r12QuoteFixture().maximumMicrousd);
   record('distinct-goals-share-finite-grant-'+bound,grantRace);
  }

  for(const kind of ['native','legacy']){
   const ctx=await prepareOwnerInitialFinancialContenders(db,kind);
   const race=await orderedRace({observer:db,holder,waiter,first:c=>reserve(c,ctx.firstPlanner),second:c=>reserve(c,ctx.secondPlanner)});
   assert.equal(race.first.status,'reserved');
   if(race.second.error)assert.match(race.second.error.message,/funding_(uncertain|exceeded)|financial_cap_exceeded|unresolved_prior_liability/);else assert.notEqual(race.second.value.status,'reserved');
   const n=await counts(db,ctx.f);assert.equal(n.reservations,1);assert.equal(n.dispatch_markers,0);assert.equal(n.transport_claims,0);
   const budget=(await ctx.f.read()).funding.budget;assert.equal(budget.committedMicrousd,ctx.priorKnown+500000);assert.equal(budget.pendingExposureMicrousd,500000);assert.equal(budget.hasUncertainCosts,true);assert.ok(budget.committedMicrousd<=ctx.maximum);assert.ok(ctx.priorKnown+1000000>ctx.maximum);
   if(kind==='legacy')assert.equal(Number((await one(db,'select private.stage13v2_funded_ceiling($1) n',[ctx.f.legacy.rootId])).n),2000000);
   record(kind==='native'?'distinct-goals-cannot-overspend-business':'distinct-goals-cannot-overspend-legacy-root',race);
  }
  assert.equal(transportCalls,0);return {version:'r12.owner-initial-postgres-races.1',engine:'postgresql',passed:true,providerCalls:0,transportHttpCalls:0,races};
 }finally{
  globalThis.fetch=originalFetch;
  await Promise.all(clients.map(async client=>{if(connected.has(client))await client.query('rollback').catch(()=>{});await client.end().catch(()=>{});}));
 }
}
