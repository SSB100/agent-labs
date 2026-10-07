import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {r12FocusedAdoptionMigration,assertLegacyFunctionContract,assertR12FocusedAdoptionTransition} from './helpers/r12-legacy-function-contracts.mjs';
import {R10_KEY,R10_AUTH,R10_OTHER_AUTH,R10_OWNER,R10_SOURCE,value,sessionBootstrap,setupR10,authenticate,seedR10,enroll,owner,catalog,server,writer,frame,startR10,close} from './helpers/r10-sql-fixture.mjs';
const root=process.cwd(),host=process.env.R10_SQL_TEST_HOST,required=process.env.R10_REQUIRE_POSTGRES==='1';
function fixtureUrl(value){const u=new URL(value);assert.ok(['postgres:','postgresql:'].includes(u.protocol)&&u.hostname==='127.0.0.1'&&u.pathname==='/r10_test'&&u.username==='r10_test'&&!u.search&&!u.hash,'Only a fresh loopback r10_test database is allowed');return u.href;}
test('R10 SQL fixture rejects production destinations',()=>{for(const url of ['postgresql://r10_test:x@db.example.com/r10_test','postgresql://postgres:x@127.0.0.1/r10_test','postgresql://r10_test:x@127.0.0.1/production'])assert.throws(()=>fixtureUrl(url));});
test('R10 isolated SQL lifecycle, exact authenticated scope, one-shot epochs and acknowledged revocation',{skip:!host&&!required},async t=>{
 const require=createRequire(path.resolve(host??root,'package.json'));let db,Client,config;
 if(required){assert.ok(process.env.R10_POSTGRES_URL);({Client}=require('pg'));config={connectionString:fixtureUrl(process.env.R10_POSTGRES_URL),statement_timeout:15000};const c=new Client(config);await c.connect();db={exec:s=>c.query(s),query:(s,p)=>c.query(s,p),close:()=>c.end()};assert.equal((await db.query("select count(*)::int n from pg_namespace where nspname in ('auth','private','storage')")).rows[0].n,0,'Fresh isolated cluster required');}
 else{const{PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');db=new PGlite({extensions:{pgcrypto}});}
 const functions="select p.oid::regprocedure::text id,pg_get_functiondef(p.oid) body,p.proacl::text acl,p.proowner::text owner,p.prosecdef security_definer,p.proconfig config,p.provolatile volatility,p.proparallel parallel,p.proisstrict strict,p.proleakproof leakproof,p.proretset returns_set,pg_get_function_result(p.oid) result,pg_get_function_arguments(p.oid) arguments from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' order by 1";
 const tables="select c.oid::regclass::text id,c.relacl::text acl,c.relrowsecurity rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','v','p') order by 1";
 try{
 await db.exec(r04SqlBootstrap+sessionBootstrap);let beforeFns,beforeTables,beforeRows,adoptionReviewed=false;
 const preservedRows=async()=>{const out={};for(const name of ['private.r04_envelopes','private.r04_confirmations','private.r05_policies','private.r05_server_keys','private.r07_server_keys','private.r07_plans','private.r09_releases','private.browser_session_secrets'])out[name]=await value(db,`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') result from ${name} t`);return out;};
 for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()){
 const sql=readFileSync(`supabase/migrations/${file}`,'utf8');
 if(file.endsWith('_r10_private_browser_viewer.sql')){beforeFns=(await db.query(functions)).rows;beforeTables=(await db.query(tables)).rows;beforeRows=await preservedRows();await assert.rejects(db.exec(sql.replace(/commit;\s*$/,()=>"do $$ begin raise exception 'r10_rollback'; end $$; commit;")),/r10_rollback/);await db.exec('rollback');assert.deepEqual((await db.query(functions)).rows,beforeFns);assert.deepEqual((await db.query(tables)).rows,beforeTables);assert.deepEqual(await preservedRows(),beforeRows);}
 const beforeAdoption=file===r12FocusedAdoptionMigration?(await db.query(functions)).rows:null;
 await db.exec(sql);
 if(beforeAdoption)adoptionReviewed=assertR12FocusedAdoptionTransition(beforeAdoption,(await db.query(functions)).rows);
 if(file.endsWith('_r10_private_browser_viewer.sql')){const afterFns=new Map((await db.query(functions)).rows.map(x=>[x.id,x]));for(const x of beforeFns)assert.deepEqual(afterFns.get(x.id),x);}
 }
 // Exact R10 byte preservation is checked above; later scoped bodies may change.
 // Only the verified R12 Stage14 transition may change prior function metadata.
 assert.ok(adoptionReviewed,'Exact R12 adoption transition was checked');
 assert.deepEqual(await preservedRows(),beforeRows);const afterFns=new Map((await db.query(functions)).rows.map(x=>[x.id,x]));for(const x of beforeFns)assertLegacyFunctionContract(afterFns.get(x.id),x,adoptionReviewed);const afterTables=new Map((await db.query(tables)).rows.map(x=>[x.id,x]));for(const x of beforeTables)assert.deepEqual(afterTables.get(x.id),x);
 for(const table of ['r10_server_keys','r10_enrollments','r10_writers','r10_close_audits'])assert.equal(await value(db,`select count(*)::int result from private.${table}`),0,'No key, enrollment or grant seeded');
 await db.exec(readFileSync('supabase/tests/r10_private_browser_viewer.sql','utf8'));await setupR10(db,root);
 let s=await seedR10(db),other=await seedR10(db);assert.equal((await owner(db,s)).status,'available');assert.deepEqual(await enroll(db,s),await owner(db,s));
 for(const patch of [{sourceHash:'a'.repeat(64)},{approvalReference:'changed'},{grantSeconds:121},{maxRuntimeSeconds:121},{ownerId:randomUUID()},{businessId:other.businessId},{questId:other.questId},{authSessionId:R10_OTHER_AUTH}])await assert.rejects(enroll(db,s,patch),/r10_invalid_enrollment|r10_enrollment_conflict/);
 for(const patch of [{provider:'other'},{currency:'EUR'},{maximumMicrounits:'1'},{maximumMicrounits:'1000001'},{estimatedMaximumMicrounits:'0'},{billingQuantumSeconds:0},{billingQuantumSeconds:121},{quoteHash:'bad'},{quoteValidUntil:new Date(Date.now()-1000).toISOString()},{quoteValidUntil:new Date(Date.now()+90000000).toISOString()}])await assert.rejects(enroll(db,{...s,sessionId:randomUUID(),workflowRunId:randomUUID(),cost:{...s.cost,...patch}}),/r10_invalid_cost_quote|r10_cost_bound_exceeded|r10_stale_cost_quote/);
 assert.equal((await owner(db,s)).approvedExposure.liabilityStatus,'not_dispatched');
 // Enrollment creates fresh exact Core identities; neither legacy reuse nor conflicting research can join.
 const legacyRun=await value(db,'select w result from public.r05_fixture where b=$1',[s.businessId]);await assert.rejects(enroll(db,{...s,workflowRunId:legacyRun,sessionId:randomUUID()}),/duplicate key/);
 const unmanaged=randomUUID();await db.query("insert into public.goals(id,business_id,title) values($1,$2,'Legacy unmanaged goal')",[unmanaged,s.businessId]);await assert.rejects(enroll(db,{...s,questId:unmanaged,workflowRunId:randomUUID(),sessionId:randomUUID()}),/managed_ready_quest_required/);
 const candidate=randomUUID(),experiment=randomUUID();await db.query("insert into public.product_candidates(id,business_id,fingerprint,concept,audience,hypothesis,original_design,rights_status,source_domains) values($1,$2,repeat('d',64),'Inert public concept','Inert audience','No market claim',true,'confirmed',array['example.invalid'])",[candidate,s.businessId]);
 await assert.rejects(db.query("insert into public.product_experiments(id,business_id,candidate_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan) values($1,$2,$3,$4,repeat('d',64),'No market claim','{}','Inert audience','reserved',private.stage13_plan())",[experiment,s.businessId,candidate,s.workflowRunId]),/dedicated_workflow_only/);
 await assert.rejects(db.query("insert into private.r04_research_links(experiment_id,business_id,goal_id,goal_revision,workflow_run_id,evidence,evidence_hash,actor_id) values($1,$2,$3,2,$4,'{}',repeat('a',64),$5)",[experiment,s.businessId,s.questId,s.workflowRunId,R10_OWNER]),/dedicated_workflow_only/);
 await assert.rejects(db.query("insert into public.browser_sessions(business_id,workflow_run_id,provider_definition_id,browser_identity_id) values($1,$2,$3,$4)",[s.businessId,s.workflowRunId,randomUUID(),randomUUID()]),/dedicated_workflow_only/);
 await assert.rejects(db.query('update private.r10_enrollments set expires_at=expires_at where session_id=$1',[s.sessionId]),/immutable_enrollment/);
 await assert.rejects(db.query("update public.workflow_definitions set name='Forged' where id='a1100000-0000-4000-8000-000000000002'"),/immutable_definition/);
 await db.exec('set role authenticated');
 for(const operation of ['claim','attest','created'])await assert.rejects(owner(db,s,operation),/invalid_owner_operation/);
 await assert.rejects(db.query("insert into public.workflow_runs(business_id,goal_id,workflow_definition_id,idempotency_key) values($1,$2,'a1100000-0000-4000-8000-000000000002','forged-r10')",[s.businessId,s.questId]),/projection_guarded_rpc_required/);
 await assert.rejects(db.query("update public.workflow_runs set state='{\"forged\":true}' where id=$1",[s.workflowRunId]),/projection_guarded_rpc_required/);
 await assert.rejects(db.query("update public.task_contracts set status='completed' where workflow_run_id=$1",[s.workflowRunId]),/projection_guarded_rpc_required/);
 await assert.rejects(db.query("update public.worker_runs set status='completed' where workflow_run_id=$1",[s.workflowRunId]),/projection_guarded_rpc_required/);
 await assert.rejects(enroll(db,s),/permission denied/);await assert.rejects(server(db,s,'claim',writer(s),'forged'),/server_authority_required/);
 assert.equal(await owner(db,{...s,sessionId:other.sessionId}),null);assert.equal(await owner(db,{...s,workflowRunId:other.workflowRunId}),null);await assert.rejects(owner(db,{...s,businessId:other.businessId}),/owner_required/);
 await authenticate(db,R10_OWNER,R10_OTHER_AUTH);assert.equal(await owner(db,s),null);await authenticate(db);await db.exec('reset role');
 await assert.rejects(server(db,{...s,authSessionId:R10_OTHER_AUTH},'claim',writer(s)),/scope_unavailable/);await assert.rejects(server(db,{...s,businessId:other.businessId},'claim',writer(s)),/scope_unavailable/);
 const claim=await server(db,s,'claim',writer(s));assert.equal(claim.status,'starting');assert.equal(claim.epoch,1);assert.ok(claim.timeoutMs>0&&claim.timeoutMs<=120000);assert.equal(claim.maxFrames,120);assert.equal(claim.sourceHash,R10_SOURCE);assert.deepEqual(claim.cost,s.cost);
 assert.equal(await value(db,'select public.r08_workflow_quest($1,$2) result',[s.businessId,s.workflowRunId]),s.questId);
 assert.equal(await value(db,'select status result from public.workflow_runs where id=$1',[s.workflowRunId]),'running');assert.equal(await value(db,'select status result from public.worker_runs where workflow_run_id=$1',[s.workflowRunId]),'running');
 await assert.rejects(server(db,s,'claim',writer(s)),/one_shot_consumed/);await assert.rejects(server(db,s,'claim',{writerId:randomUUID()}),/one_shot_consumed/);
 await assert.rejects(server(db,s,'created',{...writer(s),providerSessionId:'inert'}),/invalid_created/);
 await server(db,s,'create_dispatched',writer(s));assert.equal((await server(db,s,'read')).createDispatched,true);assert.equal((await owner(db,s)).approvedExposure.liabilityStatus,'unknown');await assert.rejects(server(db,s,'create_dispatched',writer(s)),/already_dispatched/);
 await server(db,s,'created',{...writer(s),providerSessionId:'inert-one'});await assert.rejects(server(db,s,'created',{...writer(s),providerSessionId:'inert-two'}),/invalid_created/);
 assert.equal((await server(db,s,'permit',frame(s))).allowed,false);
 await assert.rejects(server(db,s,'attest',{...frame(s),sourceHash:'a'.repeat(64)}),/attestation_fenced/);
 await server(db,s,'attest',{...frame(s),sourceHash:R10_SOURCE});let permit=await server(db,s,'permit',frame(s));assert.equal(permit.allowed,true);assert.ok(Date.parse(permit.leaseUntil)-Date.parse(permit.serverNow)<=2000);
 for(const patch of [{epoch:2},{pageId:randomUUID()},{contextId:randomUUID()},{writerId:randomUUID()}]){const op={...frame(s),...patch};if(patch.epoch||patch.writerId)await assert.rejects(server(db,s,'permit',op),/fenced/);else assert.equal((await server(db,s,'permit',op)).allowed,false);}
 await assert.rejects(server(db,s,'attest',{...frame(s),pageId:randomUUID(),sourceHash:R10_SOURCE}),/attestation_fenced/);
 const summary=await owner(db,s);assert.equal(summary.status,'watching');for(const secret of [R10_KEY,R10_AUTH,s.writerId,'inert-one','sourceHash','providerSessionId','approvalReference'])assert.ok(!JSON.stringify(summary).includes(secret));
 await db.exec('begin read only; set local role authenticated');assert.equal((await owner(db,s)).status,'watching');assert.equal((await catalog(db,s,s.workflowRunId)).selected.sessionId,s.sessionId);await db.exec('rollback');
 await assert.rejects(db.query("update public.businesses set owner_user_id='95050000-0000-4000-8000-000000000002' where id=$1",[s.businessId]),/revoke_and_close_ack_required/);
 await assert.rejects(db.query("update public.workflow_runs set status='completed' where id=$1",[s.workflowRunId]),/revoke_and_close_ack_required/);
 await assert.rejects(db.query('update private.r04_goal_state set revision=1 where goal_id=$1',[s.questId]),/revoke_and_close_ack_required/);
 await db.exec('set role authenticated');assert.equal((await owner(db,s,'revoke')).status,'revocation_pending');await db.exec('reset role');assert.equal((await server(db,s,'permit',frame(s))).allowed,false);
 await db.query("update private.r10_writers set hard_deadline=clock_timestamp()-interval '1 second' where session_id=$1",[s.sessionId]);assert.equal((await owner(db,s)).status,'revocation_pending');assert.equal((await owner(db,s)).streamClosure,'unconfirmed');
 assert.equal((await close(db,s)).status,'revoked');assert.equal((await owner(db,s)).streamClosure,'acknowledged');assert.equal((await close(db,s)).status,'revoked');await assert.rejects(close(db,s,{releaseResult:'failed'}),/close_conflict/);
 const audit=await value(db,'select payload result from private.r10_close_audits where session_id=$1',[s.sessionId]);assert.equal(audit.streamClosure,'acknowledged');assert.equal(audit.capturedFrames,0);assert.equal(audit.liabilityStatus,'unknown');assert.equal((await owner(db,s)).approvedExposure.actualMicrounits,null);assert.equal(await value(db,'select status result from public.worker_runs where workflow_run_id=$1',[s.workflowRunId]),'completed');
 await assert.rejects(db.query("update public.artifacts set content='{}' where workflow_run_id=$1",[s.workflowRunId]),/immutable_close_audit/);
 await assert.rejects(db.query("update private.r10_close_audits set payload='{}' where session_id=$1",[s.sessionId]),/immutable_enrollment/);
 await db.query("update public.workflow_runs set status='completed' where id=$1",[s.workflowRunId]);assert.equal((await owner(db,s)).status,'revoked');
 // A fixed epoch can refresh only its exact current context; suspension is irreversible.
 s=await seedR10(db);await startR10(db,s);await server(db,s,'suspend',{...writer(s),epoch:1});assert.equal((await server(db,s,'attest',{...frame(s),sourceHash:R10_SOURCE})).allowed,false);assert.equal((await server(db,s,'permit',frame(s))).allowed,false);await close(db,s);
 // Unsent cancellation proves there is no writer; cancellation never creates one.
 s=await seedR10(db);assert.equal((await owner(db,s,'revoke')).status,'revoked');assert.equal((await server(db,s,'claim',writer(s))).allowed,false);
 // Ambiguous create has no retry and cannot be relabelled never-sent.
 s=await seedR10(db);await server(db,s,'claim',writer(s));await server(db,s,'create_dispatched',writer(s));await assert.rejects(close(db,s,{releaseResult:'not_created'}),/ambiguous_create/);await close(db,s,{outcome:'uncertain',releaseResult:'unknown',providerReceiptHash:null});assert.equal((await server(db,s,'claim',writer(s))).allowed,false);
 // A late provider response remains denied, but retains the private handle for cleanup.
 s=await seedR10(db);await server(db,s,'claim',writer(s));await server(db,s,'create_dispatched',writer(s));await owner(db,s,'revoke');assert.equal((await server(db,s,'created',{...writer(s),providerSessionId:'inert-late-provider'})).allowed,false);assert.equal((await server(db,s,'read')).providerSessionId,'inert-late-provider');assert.ok(!JSON.stringify(await owner(db,s)).includes('inert-late-provider'));await close(db,s);
 // Current authenticated session loss fails all subsequent capture delivery.
 s=await seedR10(db);await startR10(db,s);await db.query('update auth.sessions set not_after=clock_timestamp() where id=$1',[R10_AUTH]);assert.equal((await server(db,s,'permit',frame(s))).allowed,false);await assert.rejects(owner(db,s),/owner_required/);await close(db,s);await db.query('update auth.sessions set not_after=null where id=$1',[R10_AUTH]);
 // Finite budgets and freshness use server time, with expiry not masquerading as physical ACK.
 s=await seedR10(db);await startR10(db,s);await db.query("update private.r10_writers set attested_at=clock_timestamp()-interval '5 seconds' where session_id=$1",[s.sessionId]);assert.equal((await server(db,s,'permit',frame(s))).allowed,false);await server(db,s,'attest',{...frame(s),sourceHash:R10_SOURCE});await db.query('update private.r10_writers set permits_issued=240 where session_id=$1',[s.sessionId]);assert.equal((await server(db,s,'permit',frame(s))).allowed,false);await close(db,s);
 s=await seedR10(db,{grantSeconds:1});await startR10(db,s);await pause(1100);assert.equal((await server(db,s,'permit',frame(s))).allowed,false);assert.equal((await owner(db,s)).status,'expired');assert.equal((await owner(db,s)).streamClosure,'unconfirmed');await close(db,s);
 // Crash recovery needs positive trusted evidence, never expiry; unknown counts stay unknown.
 s=await seedR10(db);await startR10(db,s);await owner(db,s,'revoke');await assert.rejects(value(db,'select private.r10_recover_close($1,$2,$3) result',[s.sessionId,'a'.repeat(64),'b'.repeat(64)]),/recovery_preconditions/);await db.query("update private.r10_writers set hard_deadline=clock_timestamp()-interval '3 seconds' where session_id=$1",[s.sessionId]);await assert.rejects(value(db,'select private.r10_recover_close($1,$2,$3) result',[s.sessionId,null,null]),/recovery_evidence/);assert.equal((await owner(db,s)).streamClosure,'unconfirmed');assert.equal((await value(db,'select private.r10_recover_close($1,$2,$3) result',[s.sessionId,'a'.repeat(64),'b'.repeat(64)])).status,'revoked');const recovery=await value(db,'select payload result from private.r10_close_audits where session_id=$1',[s.sessionId]);assert.equal(recovery.capturedFrames,null);assert.equal(recovery.deliveredFrames,null);assert.equal(recovery.closureAuthority,'administrator_verified_recovery');assert.equal(recovery.liabilityStatus,'unknown');
 // Catalog's exact selection is independent of its bounded recent list.
 s=await seedR10(db);const first=s;for(let n=0;n<42;n++){s={...first,workflowRunId:randomUUID(),sessionId:randomUUID()};await enroll(db,s);}const page=await catalog(db,first,first.workflowRunId);assert.equal(page.items.length,40);assert.equal(page.selected.sessionId,first.sessionId);assert.ok(!page.items.some(x=>x.sessionId===first.sessionId));assert.equal((await catalog(db,first,other.workflowRunId)).selected,null);
 await authenticate(db,'95050000-0000-4000-8000-000000000002',R10_AUTH);await assert.rejects(owner(db,first),/owner_required/);await authenticate(db);
 for(const role of ['anon','service_role']){await db.exec(`set role ${role}`);await assert.rejects(owner(db,first),/permission denied/);await assert.rejects(catalog(db,first),/permission denied/);await assert.rejects(enroll(db,first),/permission denied/);await assert.rejects(db.query('select * from private.r10_writers'),/permission denied/);if(role==='service_role')await assert.rejects(server(db,first,'read'),/permission denied/);await db.exec('reset role');}
 if(required)await qualifyRaces(db,Client,config,t);
 t.diagnostic(`${required?'PostgreSQL 17':'PGlite'}: rollback/prior contracts, empty authority, owner/Quest/run/session binding, one-shot provider liability, epochs, drain ACK and bounded catalog passed`);
 }finally{await db.close();}
});

async function qualifyRaces(db,Client,config,t){
 const left=new Client(config),right=new Client(config);await Promise.all([left.connect(),right.connect()]);
 async function begin(c){await c.query('begin');await authenticate(c);}
 async function lockWait(){const until=Date.now()+10000;while(Date.now()<until){const row=(await db.query('select wait_event_type,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',[right.processID])).rows[0];if(row?.wait_event_type==='Lock'&&row.blockers.includes(left.processID))return;await pause(15);}throw new Error('R10 operation did not reach observed lock wait');}
 async function race(first,second,afterWait=async()=>{}){await begin(left);await begin(right);let pending;try{const a=await first();pending=second().then(result=>({result}),error=>({error}));await lockWait();await afterWait();await left.query('commit');const b=await pending;await right.query(b.error?'rollback':'commit');return {a,b};}catch(error){await left.query('rollback').catch(()=>{});if(pending)await pending;await right.query('rollback').catch(()=>{});throw error;}}
 try{
 let s=await seedR10(db);let result=await race(()=>server(left,s,'claim',writer(s)),()=>server(right,s,'claim',{writerId:randomUUID()}));assert.equal(result.a.allowed,true);assert.match(result.b.error?.message??'',/one_shot_consumed/);await close(db,s,{releaseResult:'not_created'});
 s=await seedR10(db);await server(db,s,'claim',writer(s));result=await race(()=>server(left,s,'create_dispatched',writer(s)),()=>server(right,s,'create_dispatched',writer(s)));assert.equal(result.a.allowed,true);assert.match(result.b.error?.message??'',/already_dispatched/);await close(db,s,{outcome:'uncertain',releaseResult:'unknown',providerReceiptHash:null});
 s=await seedR10(db);await startR10(db,s);result=await race(()=>owner(left,s,'revoke'),()=>server(right,s,'permit',frame(s)));assert.equal(result.a.status,'revocation_pending');assert.equal(result.b.result.allowed,false);await close(db,s);
 s=await seedR10(db);await startR10(db,s);result=await race(()=>server(left,s,'permit',frame(s)),()=>owner(right,s,'revoke'));assert.equal(result.a.allowed,true);assert.equal(result.b.result.status,'revocation_pending');assert.equal((await owner(db,s)).streamClosure,'unconfirmed');await close(db,s);
 s=await seedR10(db);result=await race(()=>left.query("update public.businesses set owner_user_id='95050000-0000-4000-8000-000000000002' where id=$1",[s.businessId]),()=>server(right,s,'claim',writer(s)));assert.equal(result.b.result.allowed,false);assert.equal(result.b.result.reason,'owner_changed');
 s=await seedR10(db);result=await race(()=>server(left,s,'claim',writer(s)),()=>right.query("update public.businesses set owner_user_id='95050000-0000-4000-8000-000000000002' where id=$1",[s.businessId]));assert.match(result.b.error?.message??'',/revoke_and_close_ack_required/);await close(db,s,{releaseResult:'not_created'});
 // Grant expires behind a later authorization lock; final wall-clock check must reject.
 s=await seedR10(db,{grantSeconds:3});result=await race(()=>left.query('select * from auth.sessions where id=$1 for update',[R10_AUTH]),()=>server(right,s,'claim',writer(s)),()=>pause(3200));assert.equal(result.b.result.allowed,false);assert.equal(result.b.result.reason,'expired');
 // read cannot retain an authority check from before the writer lock wait.
 s=await seedR10(db);const shortKey='inert-r10-short-lived-authority-123456789';await db.query("insert into private.r10_server_keys values(encode(extensions.digest(convert_to($1,'UTF8'),'sha256'),'hex'),clock_timestamp()+interval '2 seconds')",[shortKey]);result=await race(()=>left.query('select * from private.r10_writers where session_id=$1 for update',[s.sessionId]),()=>server(right,s,'read',{},shortKey),()=>pause(2200));assert.match(result.b.error?.message??'',/server_authority_required/);
 // Core projection lock wait may expire a claim; transaction must roll it all back.
 s=await seedR10(db,{grantSeconds:3});result=await race(()=>left.query('select * from public.worker_runs where workflow_run_id=$1 for update',[s.workflowRunId]),()=>server(right,s,'claim',writer(s)),()=>pause(3200));assert.match(result.b.error?.message??'',/claim_stale/);assert.equal(await value(db,'select status result from public.workflow_runs where id=$1',[s.workflowRunId]),'queued');assert.equal(await value(db,'select writer_id result from private.r10_writers where session_id=$1',[s.sessionId]),null);
 t.diagnostic('Nine observed PostgreSQL lock waits: claim/claim, create/create, revoke/permit, permit/revoke, owner/claim, claim/owner, auth-lock/expiry, read/key-expiry, projection/claim-expiry');
 }finally{await Promise.all([left.end(),right.end()]);}
}
