/** Native PostgreSQL only. Two disposable copies of one committed synthetic
 * recovery preserve the source fixture and all immutable predecessor history.
 * No provider, HTTP server, Production URL, history rewrite or external call. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {validateR12HttpDatabase,prepareCommittedR12Recovery} from './r12-postgrest-http.mjs';
import {runOperatorRecipe as recoveryRecipe} from '../../scripts/r12-focused-pilot-unsent-recovery-bootstrap.mjs';
import {runOperatorRecipe as terminalRecipe} from '../../scripts/r12-terminal-technical-qualification-bootstrap.mjs';
import {validateR12CiResetTarget} from '../../scripts/reset-r12-ci-database.mjs';

export const R12_RACE_DATABASES=Object.freeze(['r12_race_send_first','r12_race_revoke_first']);
export function r12RaceExpectedServerAddress(env){
 validateR12HttpDatabase(env.R12_POSTGRES_URL);
 if(env.R12_CI_POSTGRES_ADDRESS){validateR12CiResetTarget(env);return env.R12_CI_POSTGRES_ADDRESS;}
 return'127.0.0.1';
}
export function validateR12RaceReportPath(value){assert.match(value,/^\/tmp\/r12-[a-z0-9_-]+\.json$/,'Only a nonsecret /tmp/r12-*.json report path is allowed');return value;}
export function r12RaceDatabaseUrl(source,name){
 validateR12HttpDatabase(source);
 assert.ok(R12_RACE_DATABASES.includes(name),'Only the two named disposable race databases are allowed');
 const url=new URL(source);url.pathname='/'+name;return url.toString();
}
const digest=value=>createHash('sha256').update(value).digest('hex');
const one=async(db,sql,args=[])=>(await db.query(sql,args)).rows[0];
const result=async(db,sql,args=[])=>(await one(db,sql,args)).result;
const observed=p=>p.then(value=>({value}),error=>({error}));

// Polling is only a scheduler yield. Positive pg_stat_activity/pg_locks evidence,
// including the exact blocking backend, is required before the holder commits.
async function waitForBusinessLock(observer,waiter,holder,pending){
 const until=performance.now()+2500;
 while(performance.now()<until){
  assert.equal(pending.done,false,'Competing operation finished before the required observed lock wait');
  const state=await one(observer,`select a.wait_event_type,a.wait_event,pg_blocking_pids(a.pid) blockers,
   exists(select 1 from pg_locks l where l.pid=a.pid and not l.granted) waiting_lock,
   exists(select 1 from pg_locks l where l.pid=$2 and l.relation='public.businesses'::regclass and l.granted) holder_business_lock
   from pg_stat_activity a where a.pid=$1`,[waiter.processID,holder.processID]);
  if(state?.wait_event_type==='Lock'&&state.blockers.includes(holder.processID)&&state.waiting_lock&&state.holder_business_lock)return state;
  await pause(10);
 }
 assert.fail('Competing operation never reached a positively observed Business lock wait');
}
function pendingQuery(action){const state={done:false};state.promise=observed(action()).then(outcome=>{state.done=true;return outcome;});return state;}
async function begin(db){await db.query('begin isolation level read committed');await db.query("set local statement_timeout='15s'; set local lock_timeout='5s'; set local timezone='UTC'");}
async function asRole(db,role,sql,args){
 assert.ok(['anon','authenticated'].includes(role));await db.query('set local role '+role);
 // A rejected statement leaves the transaction aborted; its caller rolls back.
 const value=await result(db,sql,args);await db.query('reset role');return value;
}
async function command(db,ctx,operation,payload={},epoch=null){
 return asRole(db,'anon','select public.r07_controller($1,$2,$3,$4,$5,$6,$7,$8,$9) result',[
  ctx.metadata.businessId,ctx.metadata.goalId,operation,payload,randomUUID(),ctx.controller,ctx.lease,epoch,ctx.admission]);
}
async function dispatch(db,ctx){
 await begin(db);
 try{
  const lease=await command(db,ctx,'claim',{seconds:60});
  const dispatched=await asRole(db,'anon','select public.r12_recovery_dispatch($1,$2,$3,$4,$5,$6,$7,$8,$9) result',[
   ctx.metadata.businessId,ctx.metadata.goalId,ctx.scopeId,ctx.payload,randomUUID(),ctx.controller,ctx.lease,Number(lease.epoch),ctx.admission]);
  assert.equal(dispatched.shouldDispatch,true);await db.query('commit');
 }catch(error){await db.query('rollback');throw error;}
}
function send(db,ctx){
 return asRole(db,'anon','select public.r12_recovery_server($1,$2,$3,$4,$5,$6) result',[
  ctx.metadata.businessId,ctx.scopeId,ctx.payload.attemptId,'send',{wireHash:ctx.payload.wireHash},ctx.controller]);
}
async function ownerStop(db,ctx){
 const session=await one(db,'select id from auth.sessions where user_id=$1 and (not_after is null or not_after>clock_timestamp()) order by not_after desc limit 1',[ctx.metadata.ownerId]);
 assert.ok(session,'A real synthetic owner session is required');
 await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true),set_config('request.jwt.claim.session_id',$3,true)",[
  ctx.metadata.ownerId,JSON.stringify({sub:ctx.metadata.ownerId,session_id:session.id,role:'authenticated'}),session.id]);
 const stopped=await asRole(db,'authenticated',"select public.r05_policy_owner($1,'revoke',$2,$3) result",[
  ctx.metadata.businessId,{policyId:ctx.plan.policyId,policyHash:ctx.plan.policyHash},randomUUID()]);
 assert.equal(stopped.id,ctx.plan.policyId);assert.equal(stopped.status,'revoked');return stopped;
}
function closeInput(ctx){return{businessId:ctx.metadata.businessId,scopeId:ctx.scopeId,scopeHash:ctx.metadata.staged.scopeHash,
 policyId:ctx.plan.policyId,policyHash:ctx.plan.policyHash,planHash:ctx.activated.planHash,recoveryAuthorizationHash:ctx.metadata.authorizationHash};}
function reconciliationInput(ctx,requestId,markedRequestHash){return{businessId:ctx.metadata.businessId,scopeId:ctx.scopeId,
 scopeHash:ctx.metadata.staged.scopeHash,planHash:ctx.activated.planHash,requestId,recoveryAuthorizationHash:ctx.metadata.authorizationHash,
 markedRequestHash,ownerApprovalEvidenceHash:digest('inert race reconciliation approval '+ctx.scopeId),
 independentReviewHash:digest('inert race reconciliation independent review '+ctx.scopeId)};}
async function financial(db,ctx){
 return one(db,`select private.stage13v2_budget_authority($1,false) root,
  (select coalesce(sum(held),0)::text from private.r05_exposure($2) where currency='USD') exposure,
  (select count(*)::int from private.r05_releases where request_id=$3) releases,
  (select count(*)::int from private.r07_events where attempt_id=$4 and operation='r12.marked_pretransport_reconciled') proofs,
  (select count(*)::int from private.r12_discovery_transport_claims where request_id=$3) claims,
  (select to_jsonb(m) from private.r05_markers m where request_id=$3) financial_marker,
  (select to_jsonb(m) from private.r07_markers m where attempt_id=$4) controller_marker,
  (select status from private.r07_attempts where id=$4) status,
  (select count(*)::int from private.r12_discovery_response_observations where request_id=$3) responses,
  (select count(*)::int from private.r12_discovery_candidates where request_id=$3) candidates,
  (select count(*)::int from private.r05_settlements where request_id=$3) settlements`,[
  ctx.metadata.focusedProfile.priorRoundId,ctx.metadata.businessId,ctx.requestId,ctx.payload.attemptId]);
}
async function revocations(db,ctx){return one(db,`select
 exists(select 1 from private.r05_revocations where policy_id=$1) policy,
 exists(select 1 from private.r07_server_revocations where key_hash=$2) controller,
 exists(select 1 from private.r05_server_revocations where key_hash=$3) admission`,[ctx.plan.policyId,digest(ctx.controller),digest(ctx.admission)]);}
async function predecessorHistory(db,ctx){
 const checks=[
  ['r07_attempts','plan_id<>$1',[ctx.planId]],['r07_heads','plan_id<>$1',[ctx.planId]],
  ['r07_markers','attempt_id<>$1',[ctx.payload.attemptId]],['r07_events','plan_id<>$1',[ctx.planId]],
  ['r05_markers','request_id<>$1',[ctx.requestId]],['r05_releases','request_id<>$1',[ctx.requestId]],
  ['r12_discovery_transport_claims','request_id<>$1',[ctx.requestId]],
  ...['r05_requests','r05_settlements','r07_plans','r07_responses','r12_discovery_wires','r12_discovery_scopes','r12_discovery_authorities','r12_pilot_unsent_recovery_authorizations','r12_discovery_response_observations'].map(table=>[table,'true',[]]),
 ];
 const saved={};for(const[table,where,args]of checks)saved[table]=(await one(db,`select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by to_jsonb(x)::text),'')) hash from private.${table} x where ${where}`,args)).hash;
 return saved;
}
function assertMarkedHeld(value){assert.equal(value.root.pendingExposureMicrousd,66671);assert.equal(value.root.hasUncertainCosts,true);
 assert.equal(value.releases,0);assert.equal(value.proofs,0);assert.ok(value.financial_marker);assert.ok(value.controller_marker);assert.equal(value.status,'dispatched');}
function assertNoResponse(value){assert.equal(value.responses,0);assert.equal(value.candidates,0);assert.equal(value.settlements,0);}

async function raceCopy({Client,source,name,ctx,reviewRecipeClient}){
 const connectionString=r12RaceDatabaseUrl(source,name),clients=[];
 const connect=async label=>{const db=new Client({connectionString,ssl:false,application_name:'r12-reconciliation-'+label,connectionTimeoutMillis:5000});clients.push(db);await db.connect();await db.query("set timezone='UTC'");db.exec=sql=>db.query(sql);return db;};
 let a,b,observer,pending;
 try{
  observer=await connect('observer');a=await connect('send');b=await connect('stop');
  assert.deepEqual(await one(observer,'select current_database() db,current_user actor'),{db:name,actor:'r12_test'});
  const history=await predecessorHistory(observer,ctx);await dispatch(observer,ctx);
  const baseline=await financial(observer,ctx);assertMarkedHeld(baseline);assert.equal(baseline.claims,0);assertNoResponse(baseline);
  assert.deepEqual(await revocations(observer,ctx),{policy:false,controller:false,admission:false});
  let lockEvidence;
  if(name==='r12_race_send_first'){
   await begin(a);assert.deepEqual(await send(a,ctx),{shouldDispatch:true,reason:'claimed_once'});
   assert.equal((await financial(a,ctx)).claims,1,'The transport claim is tentative in the send transaction');
   assert.equal((await financial(observer,ctx)).claims,0,'The tentative claim is not committed yet');
   await begin(b);pending=pendingQuery(()=>ownerStop(b,ctx));
   lockEvidence=await waitForBusinessLock(observer,b,a,pending);await a.query('commit');
   const stopped=await pending.promise;assert.ifError(stopped.error);await b.query('commit');
   const closed=await recoveryRecipe(b,'close',closeInput(ctx));assert.equal(closed.activeAuthority,false);
   assert.equal(closed.releasedRequests,0);assert.equal(closed.releasedMicrousd,'0');assert.equal(closed.rootPendingMicrousd,66671);
   assert.deepEqual(await revocations(observer,ctx),{policy:true,controller:true,admission:true});
   // A claim makes a reviewable markedRequestHash impossible. The exact-target
   // recipe must reject effect evidence before evaluating this synthetic hash;
   // accepting a hash mismatch as the rejection would not prove this guard.
   const input=reconciliationInput(ctx,ctx.requestId,digest('ineligible committed transport claim '+ctx.requestId));
   await assert.rejects(()=>terminalRecipe(b,'reconcile',input),error=>error.message==='r12_pretransport_effect_evidence_present');
   const after=await financial(observer,ctx);assertMarkedHeld(after);assert.equal(after.claims,1);assertNoResponse(after);
   assert.equal(after.exposure,baseline.exposure);assert.deepEqual(after.root,baseline.root);
   assert.deepEqual(after.financial_marker,baseline.financial_marker);assert.deepEqual(after.controller_marker,baseline.controller_marker);
  }else{
   await begin(b);
   await b.query('select id from public.businesses where id=$1 for update',[ctx.metadata.businessId]);
   await ownerStop(b,ctx);
   const nested=reviewRecipeClient(b,true),closed=await recoveryRecipe(nested,'close',closeInput(ctx));
   assert.equal(closed.activeAuthority,false);assert.equal(closed.releasedRequests,0);assert.equal(closed.rootPendingMicrousd,66671);
   const markedRequestHash=(await one(b,"select private.stage14_hash(private.r12_pilot_marked_context($1)->'markedRequest') hash",[ctx.scopeId])).hash;
   const input=reconciliationInput(ctx,ctx.requestId,markedRequestHash),reconciled=await terminalRecipe(nested,'reconcile',input);
   assert.equal(reconciled.releasedMicrousd,'66671');assert.equal(reconciled.providerCalls,0);assert.equal(reconciled.closure.authorityClosed,true);
   assert.deepEqual(await revocations(b,ctx),{policy:true,controller:true,admission:true});
   // The other backend still sees active authority and a marked full hold, so
   // its cheap deny gate must pass and reach the canonical Business lock.
   assert.deepEqual(await revocations(observer,ctx),{policy:false,controller:false,admission:false});
   assert.deepEqual(await financial(observer,ctx),baseline);
   await begin(a);pending=pendingQuery(()=>send(a,ctx));
   lockEvidence=await waitForBusinessLock(observer,a,b,pending);await b.query('commit');
   const denied=await pending.promise;assert.ok(denied.error,'Queued send must reject after revocations commit');
   assert.equal(denied.error.code,'42501');assert.equal(denied.error.message,'r12_controller_authority_required',
    'The canonical current key check, after Business serialization, must reject; the nonlocking cheap gate saw active authority');
   await a.query('rollback');
   const after=await financial(observer,ctx);assert.equal(after.claims,0);assert.equal(after.releases,1);assert.equal(after.proofs,1);assertNoResponse(after);
   assert.equal(after.root.pendingExposureMicrousd,0);assert.equal(after.root.hasUncertainCosts,false);
   assert.equal(after.root.knownActualMicrousd,baseline.root.knownActualMicrousd);assert.equal(Number(baseline.exposure)-Number(after.exposure),66671);
   assert.equal(after.status,'dispatched');assert.deepEqual(after.financial_marker,baseline.financial_marker);assert.deepEqual(after.controller_marker,baseline.controller_marker);
   const replay=await terminalRecipe(b,'reconcile',input);assert.equal(replay.replayed,true);assert.deepEqual(replay.closure,reconciled.closure);
   assert.deepEqual(await financial(observer,ctx),after,'Reconciliation replay cannot release twice or write a second proof');
  }
  assert.deepEqual(await predecessorHistory(observer,ctx),history,'Every committed predecessor remains byte-identical in the disposable copy');
  return{order:name==='r12_race_send_first'?'send_before_reconcile':'reconcile_before_send',observedLockWait:true,
   waitEvent:lockEvidence.wait_event,providerCalls:0,transportHttpCalls:0,claims:name==='r12_race_send_first'?1:0,
   releasedMicrousd:name==='r12_race_send_first'?'0':'66671',reconciliationProofs:name==='r12_race_send_first'?0:1};
 }finally{
  // Release both holders before awaiting any failed competing statement.
  await Promise.all([a,b].filter(Boolean).map(db=>db.query('rollback').catch(()=>{})));
  if(pending)await pending.promise;
  await Promise.all(clients.map(db=>db.end().catch(()=>{})));
 }
}

export async function exerciseR12ReconciliationRaces(){
 assert.equal(process.env.R12_RECONCILIATION_RACES,'1','The explicit offline race flag is required');
 for(const flag of ['R12_RPC_HTTP_ONLY','R12_SQL_FULL_SHAPE','R12_REQUIRE_POSTGRES'])assert.equal(process.env[flag],'1',flag+' is required');
 const source=validateR12HttpDatabase(process.env.R12_POSTGRES_URL),expectedAddress=r12RaceExpectedServerAddress(process.env),host=process.env.R12_SQL_TEST_HOST??process.env.R11_SQL_TEST_HOST;
 assert.ok(host,'An existing native PostgreSQL client installation is required');
 const require=createRequire(path.resolve(host,'package.json')),{Client}=require('pg');
 const {reviewRecipeClient}=await import('./r12-review-fixture.mjs');
 const adminUrl=new URL(source);adminUrl.pathname='/postgres';
 // Administrative URL is derived solely from the validated loopback fixture.
 // Never accept caller-supplied clone names, maintenance URLs or credentials.
 const admin=new Client({connectionString:adminUrl.toString(),ssl:false,application_name:'r12-reconciliation-clone',connectionTimeoutMillis:5000});
 const created=[];let fixture,ctx,originalHistory,originalFinancial,sourceCheck;
 const originalFetch=globalThis.fetch;let networkAttempts=0;
 globalThis.fetch=async()=>{networkAttempts++;throw Error('All HTTP is forbidden in offline reconciliation races');};
 try{
  await admin.connect();await admin.query("set timezone='UTC'");
  const identity=await one(admin,"select current_user actor,current_database() db,(select rolsuper from pg_roles where rolname=current_user) superuser,host(inet_server_addr()) address");
  assert.deepEqual(identity,{actor:'r12_test',db:'postgres',superuser:true,address:expectedAddress});
  assert.deepEqual(await one(admin,"select pg_get_userbyid(datdba) owner,datistemplate template from pg_database where datname='r12_test'"),{owner:'r12_test',template:false},'Only the exact owned source fixture may be cloned');
  const existing=(await admin.query('select datname from pg_database where datname=any($1::text[])',[R12_RACE_DATABASES])).rows;
  assert.deepEqual(existing,[],'Refuse to overwrite or drop preexisting race databases');
  fixture=await prepareCommittedR12Recovery();ctx=fixture.context;
  ctx.requestId=(await one(ctx.db,'select request_id from private.r07_bindings where attempt_id=$1',[ctx.payload.attemptId])).request_id;
  assert.equal(ctx.metadata.authorization.version,'r12.focused-pilot-unsent-recovery-authorization.1');
  assert.deepEqual(ctx.httpRuntime.counters(),{inertPosts:0,inertReceiptGets:0});
  originalHistory=await predecessorHistory(ctx.db,ctx);originalFinancial=await financial(ctx.db,ctx);
  assert.equal(originalFinancial.status,'reserved');assert.equal(originalFinancial.claims,0);
  assert.equal(originalFinancial.financial_marker,null);assert.equal(originalFinancial.controller_marker,null);
  await fixture.close();fixture=null;
  assert.equal((await one(admin,"select count(*)::int n from pg_stat_activity where datname='r12_test'")).n,0,'The committed source must have no connected backend before cloning');
  for(const name of R12_RACE_DATABASES){
   r12RaceDatabaseUrl(source,name);await admin.query(`create database "${name}" with template "r12_test" owner "r12_test"`);created.push(name);
  }
  const races=[];for(const name of R12_RACE_DATABASES)races.push(await raceCopy({Client,source,name,ctx,reviewRecipeClient}));
  sourceCheck=new Client({connectionString:source,ssl:false,connectionTimeoutMillis:5000});await sourceCheck.connect();await sourceCheck.query("set timezone='UTC'");
  assert.deepEqual(await predecessorHistory(sourceCheck,ctx),originalHistory);
  assert.deepEqual(await financial(sourceCheck,ctx),originalFinancial,'The committed source is still the untouched RESERVED fixture');
  assert.deepEqual(await revocations(sourceCheck,ctx),{policy:false,controller:false,admission:false});
  assert.equal(networkAttempts,0);return{version:'r12.marked-reconciliation-races.1',providerCalls:0,transportHttpCalls:0,sourcePreserved:true,races,passed:true};
 }finally{
  globalThis.fetch=originalFetch;
  if(fixture)await fixture.close();if(sourceCheck)await sourceCheck.end().catch(()=>{});
  // Only databases created by this invocation may be removed. No FORCE and no
  // session termination: unexpected connections fail cleanup visibly.
  try{for(const name of created){r12RaceDatabaseUrl(source,name);await admin.query(`drop database "${name}"`);}}
  finally{await admin.end().catch(()=>{});}
 }
}
