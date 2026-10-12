/** Native PostgreSQL only. Requires the existing guarded fresh local CI reset.
 * No PGlite substitute, HTTP transport, deployment or paid/provider operation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {validateOwnerInitialRaceEnvironment,orderedRace,asRole} from './helpers/r12-owner-initial-postgres-races.mjs';
import {podSqlFixture,podOne,podActivate,podQuoteFixture,podHash,podPlannerPreflight,podRpc} from './helpers/r12-pod-sql-fixture.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const owner=(db,f,operation,payload)=>asRole(db,'authenticated','r12_pod_owner_server',
 [f.businessId,operation,payload,operation==='stop'?'':f.bootstrapKey],f.ownerId);
const stopPayload=prepared=>({setupId:prepared.setupId,setupHash:prepared.setupHash,submissionId:randomUUID()});
const pass=(db,a,operation,payload={})=>asRole(db,'anon','r12_pod_pass_server',
 [a.f.businessId,a.prepared.scopeId,operation,payload,a.controller]);
const passState=(db,businessId)=>podOne(db,`select
 (select count(*)::int from private.r12_pod_passes p join private.r12_discovery_scopes s on s.id=p.scope_id where s.business_id=$1) passes,
 private.r12_pod_outstanding_hold($1)::text outstanding,
 private.r12_adaptive_outstanding_hold($1)::text shared_outstanding,
 (select coalesce(sum(held),0)::text from private.r05_exposure($1)) issued,
 (select count(*)::int from private.r05_markers where business_id=$1) markers`,[businessId]);

// A conservative synthetic quote reaches the exact owner cap without a
// provider call. Its existing routes, bytes, output bounds and hash stay valid.
function fullBudgetQuote(){
 const q=podQuoteFixture();q.ceilings={plan:2000000,search1:2000000,select1:2000000,strategy:2000000,review:2000000};q.maximumMicrousd=10000000;
 const {quoteHash:_hash,verifiedAt:_verified,validUntil:_valid,...body}=q;void[_hash,_verified,_valid];q.quoteHash=podHash(body);return q;
}
async function activateOnBusiness(db,f,goalId,quote){
 const prepared=await f.server('prepare',{input:{...f.input,goalId,submissionId:randomUUID()},quote});
 Object.defineProperty(prepared,'_preflight',{value:{quote,receipt:await podPlannerPreflight(prepared,quote)}});
 await f.server('confirm',f.confirmPayload(prepared));
 const controller='inert-pod-controller-'+prepared.scopeId,admission='inert-pod-admission-'+prepared.scopeId;
 const {plan}=await podOne(db,'select plan from private.r12_discovery_authorities where scope_id=$1',[prepared.scopeId]);
 await podRpc(db,'anon',null,'r07_controller',[f.businessId,goalId,'plan',{
  plan,expectedVersion:0,reason:'Inert native race pass admission',evidenceHash:'7'.repeat(64)},randomUUID(),controller,null,null,admission]);
 return{f,prepared,controller,admission,plan};
}
async function authorityCounts(db,f,confirmation){
 return podOne(db,`select
  (select count(*)::int from private.r12_pod_activations where business_id=$1) activations,
  (select count(*)::int from private.r12_discovery_scopes where business_id=$1) scopes,
  (select count(*)::int from private.r12_discovery_authorities where business_id=$1) authorities,
  (select count(*)::int from private.r05_confirmations where business_id=$1) confirmations,
  (select count(*)::int from private.r05_cap_versions where business_id=$1) caps,
  (select count(*)::int from private.r07_server_keys where key_hash=$2) controller_keys,
  (select count(*)::int from private.r05_server_keys where key_hash=$3) admission_keys,
  (select count(*)::int from private.r12_owner_bootstrap_grants where business_id=$1) legacy_grants,
  (select count(*)::int from private.r05_requests where business_id=$1) requests,
  (select count(*)::int from private.r05_markers where business_id=$1) markers,
  (select count(*)::int from private.r12_discovery_transport_claims tc join private.r05_requests r on r.id=tc.request_id where r.business_id=$1) transport_claims`,
 [f.businessId,confirmation.controllerKeyHash,confirmation.admissionKeyHash]);
}
const expectedCounts=activated=>({activations:activated,scopes:activated,authorities:activated,confirmations:activated,caps:activated,
 controller_keys:activated,admission_keys:activated,legacy_grants:0,requests:0,markers:0,transport_claims:0});

const requested=process.env.R12_REQUIRE_POSTGRES==='1';
test('Native PostgreSQL serializes POD confirmation, Stop and template revocation with observed lock waits',{
 skip:requested?false:'R12_REQUIRE_POSTGRES=1 not set; native PostgreSQL races unqualified, with no PGlite fallback',timeout:120000,
},async()=>{
 const target=validateOwnerInitialRaceEnvironment(process.env),require=createRequire(path.resolve(target.host,'package.json'));
 assert.equal(require('pg/package.json').version,'8.16.3','Use the existing pinned native SQL host');
 const {Client}=require('pg'),clients=['observer','holder','waiter'].map(label=>new Client({connectionString:target.url,ssl:false,
  application_name:'r12-pod-'+label,connectionTimeoutMillis:5000}));
 const [db,holder,waiter]=clients,connected=new Set(),originalFetch=globalThis.fetch,races=[];let httpCalls=0;
 globalThis.fetch=async()=>{httpCalls++;throw Error('All HTTP is forbidden in POD PostgreSQL races');};
 try{
  for(const client of clients){
   await client.connect();connected.add(client);client.exec=sql=>client.query(sql);await client.query("set timezone='UTC'");
   assert.deepEqual(await podOne(client,'select current_user actor,current_database() db,host(inet_server_addr()) address'),
    {actor:'r12_test',db:'r12_test',address:target.address});
  }
  assert.equal((await podOne(db,"select count(*)::int n from pg_tables where schemaname in ('public','private')")).n,0,
   'Refuse a populated database; run the existing guarded fresh reset before this suite');
  assert.deepEqual((await db.query("select rolname from pg_roles where rolname in ('anon','authenticated','service_role')")).rows,[],
   'Fresh cluster bootstrap roles required');
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const file of readdirSync(root+'/supabase/migrations').filter(name=>name.endsWith('.sql')).sort())
   await db.exec(readFileSync(root+'/supabase/migrations/'+file,'utf8'));
  const record=(name,race)=>{assert.equal(race.observedLockWait,true);races.push({name,observedLockWait:true,waitEvent:race.waitEvent});};

  // Both real backends contend for the Business lock; the same submission is
  // replayed only after the winning activation and cap append become visible.
  const duplicate=await podSqlFixture(db),prepared=await duplicate.prepare(),confirmation=duplicate.confirmPayload(prepared);
  const confirmed=await orderedRace({observer:db,holder,waiter,
   first:client=>owner(client,duplicate,'confirm',confirmation),second:client=>owner(client,duplicate,'confirm',confirmation)});
  assert.equal(confirmed.first.activated,true);assert.equal(confirmed.second.error,undefined,confirmed.second.error?.message);
  assert.deepEqual(confirmed.second.value,confirmed.first);assert.equal(confirmed.first.scopeId,prepared.scopeId);
  assert.deepEqual(await authorityCounts(db,duplicate,confirmation),expectedCounts(1));
  assert.equal((await podOne(db,"select count(*)::int n from private.r12_pod_submissions where business_id=$1 and operation='confirm'",[duplicate.businessId])).n,1);
  record('concurrent-identical-confirm-one-activation-and-cap',confirmed);

  const stopped=await podSqlFixture(db),stoppedSetup=await stopped.prepare(),stoppedConfirmation=stopped.confirmPayload(stoppedSetup);
  const stopFirst=await orderedRace({observer:db,holder,waiter,
   first:client=>owner(client,stopped,'stop',stopPayload(stoppedSetup)),second:client=>owner(client,stopped,'confirm',stoppedConfirmation)});
  assert.equal(stopFirst.first.stopped,true);assert.match(stopFirst.second.error?.message??'',/r12_pod_stale_or_stopped_review/);
  assert.deepEqual(await authorityCounts(db,stopped,stoppedConfirmation),expectedCounts(0));
  assert.equal((await podOne(db,'select count(*)::int n from private.r05_revocations where policy_id=$1',[stoppedSetup.policyId])).n,1);
  record('stop-before-confirm-creates-no-authority',stopFirst);

  const revoked=await podSqlFixture(db),revokedSetup=await revoked.prepare(),revokedConfirmation=revoked.confirmPayload(revokedSetup);
  const revocationFirst=await orderedRace({observer:db,holder,waiter,
   first:async client=>{
    // The actual revocation trigger locks dependent Businesses before the
    // template. Do not inject a substitute lock or weaken the authority guard.
    await client.query('insert into private.r12_pod_template_revocations(template_id,reason) values($1,$2)',
     [revoked.templateId,'Synthetic native race: template revoked before confirmation']);
    return{revoked:true};
   },second:client=>owner(client,revoked,'confirm',revokedConfirmation)});
  assert.equal(revocationFirst.first.revoked,true);assert.match(revocationFirst.second.error?.message??'',/r12_pod_template_unavailable/);
  assert.deepEqual(await authorityCounts(db,revoked,revokedConfirmation),expectedCounts(0));
  assert.equal((await podOne(db,'select count(*)::int n from private.r12_pod_template_revocations where template_id=$1',[revoked.templateId])).n,1);
  record('template-revocation-before-confirm-creates-no-authority',revocationFirst);

  const duplicatePass=await podActivate(db),passQuote=podQuoteFixture();
  const samePass=await orderedRace({observer:db,holder,waiter,
   first:client=>pass(client,duplicatePass,'admit',{quote:passQuote}),
   second:client=>pass(client,duplicatePass,'admit',{quote:passQuote})});
  assert.equal(samePass.first.admitted,true);assert.equal(samePass.first.ordinal,0);
  assert.equal(samePass.second.error,undefined,samePass.second.error?.message);
  assert.equal(samePass.second.value.admitted,true);assert.equal(samePass.second.value.replayed,true);
  assert.deepEqual(await passState(db,duplicatePass.f.businessId),{
   passes:1,outstanding:String(passQuote.maximumMicrousd),shared_outstanding:String(passQuote.maximumMicrousd),issued:'0',markers:0});
  record('concurrent-identical-pass-one-whole-pass-hold',samePass);

  for(const stopWins of [true,false]){
   const a=await podActivate(db),quote=podQuoteFixture(),stop=stopPayload(a.prepared);
   const stopping=await orderedRace({observer:db,holder,waiter,
    first:client=>stopWins?owner(client,a.f,'stop',stop):pass(client,a,'admit',{quote}),
    second:client=>stopWins?pass(client,a,'admit',{quote}):owner(client,a.f,'stop',stop)});
   if(stopWins){assert.equal(stopping.first.stopped,true);if(stopping.second.error)assert.match(stopping.second.error.message,/r12_pod_scope_stopped_or_changed|r12_pod_pass_gate_closed/);
    else{assert.equal(stopping.second.value.admitted,false);assert.equal(stopping.second.value.stopped,true);}}
   else{assert.equal(stopping.first.admitted,true);assert.equal(stopping.second.error,undefined);assert.equal(stopping.second.value.stopped,true);}
   assert.deepEqual(await passState(db,a.f.businessId),{passes:stopWins?0:1,outstanding:'0',shared_outstanding:'0',issued:'0',markers:0});
   record(stopWins?'stop-before-pass-no-hold':'pass-before-stop-unissued-hold-released',stopping);
  }

  // Two independently confirmed policies do not double the Business ceiling.
  // Both qualify before either admission; the second backend must observe the
  // first whole-pass hold after waiting for the same Business row.
  const budget=await podSqlFixture(db),quote=fullBudgetQuote();
  const firstPass=await activateOnBusiness(db,budget,budget.goalId,quote);
  const secondGoal=await budget.rpc('r04_quest_transition',[budget.businessId,'quest.save',{
   goalId:null,expectedRevision:0,content:{...structuredClone(budget.content),title:'Independent second POD research question'}},randomUUID()]);
  await budget.rpc('r04_quest_transition',[budget.businessId,'quest.preference',{goalId:secondGoal.id,expectedRevision:1,preference:'ready'},randomUUID()]);
  const secondPass=await activateOnBusiness(db,budget,secondGoal.id,quote);
  const budgetRace=await orderedRace({observer:db,holder,waiter,
   first:client=>pass(client,firstPass,'admit',{quote}),second:client=>pass(client,secondPass,'admit',{quote})});
  assert.equal(budgetRace.first.admitted,true);assert.equal(budgetRace.second.error,undefined,budgetRace.second.error?.message);
  assert.equal(budgetRace.second.value.admitted,false);assert.equal(budgetRace.second.value.reason,'remaining_budget_below_quoted_pass');
  assert.deepEqual(await passState(db,budget.businessId),{passes:1,outstanding:'10000000',shared_outstanding:'10000000',issued:'0',markers:0});
  assert.equal((await podOne(db,"select maximum_microunits::text cap from private.r05_cap_versions where business_id=$1 order by revision desc limit 1",[budget.businessId])).cap,'10000000');
  record('two-policies-one-business-ten-dollar-total-hold',budgetRace);
  await budget.server('stop',stopPayload(firstPass.prepared));
  const terminalRetry=await podRpc(db,'anon',null,'r12_pod_pass_server',[
   budget.businessId,secondPass.prepared.scopeId,'admit',{quote},secondPass.controller]);
  assert.equal(terminalRetry.admitted,false);assert.equal(terminalRetry.completed,true);
  assert.equal(terminalRetry.reason,'remaining_budget_below_quoted_pass');
  assert.deepEqual(await passState(db,budget.businessId),{passes:1,outstanding:'0',shared_outstanding:'0',issued:'0',markers:0},
   'Releasing a competing hold cannot strand a new pass on an already terminal head');

  assert.equal(httpCalls,0);assert.equal(races.length,7);assert.ok(races.every(race=>race.observedLockWait));
  console.log('POD native PostgreSQL race qualification:',JSON.stringify({version:'r12.pod-postgres-races.1',engine:'postgresql',
   passed:true,providerCalls:0,transportHttpCalls:httpCalls,races}));
 }finally{
  globalThis.fetch=originalFetch;
  await Promise.all(clients.map(async client=>{if(connected.has(client))await client.query('rollback').catch(()=>{});await client.end().catch(()=>{});}));
 }
});
