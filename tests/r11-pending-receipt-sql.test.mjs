import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {RESEARCH_KEY,RESEARCH_OTHER,RESEARCH_OWNER,authenticate,setupResearchFixture,value,hash,sha,counts,recanonicalizeCollection,validateResearchPostgresUrl} from './helpers/r11-public-research-fixture.mjs';
import {researchV2,repairWorkspace,repairStop,r05FunctionSnapshot,repairSettle,repairObservation,repairFail,repairFailure} from './helpers/r11-public-research-repair-fixture.mjs';
import {windowGuard,freshPhaseQuote} from './helpers/r11-public-research-window-fixture.mjs';
import {completionPayload} from './helpers/r11-public-research-owner-proof.mjs';
import {pendingReceiptPostgresRaces} from './helpers/r11-pending-receipt-races.mjs';
import {PENDING_MODEL,pendingFixture,stagePending,claimPending,pendingProof,recordPending,seedPastClaims} from './helpers/r11-pending-receipt-fixture.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),host=process.env.R11_SQL_TEST_HOST;
const migration='20261005220220_r11_research_pending_receipts.sql';
const source=name=>readFileSync(path.join(root,'supabase/migrations',name),'utf8');
const load=(db,s)=>researchV2(db,s,'load',{policyId:s.policy.id});
async function snapshot(db,pattern){const out={};for(const {tablename} of (await db.query('select tablename from pg_tables where schemaname=\'private\' and tablename like $1 order by 1',[pattern])).rows)out[tablename]=(await db.query(`select to_jsonb(t) row from private.${tablename} t order by to_jsonb(t)::text`)).rows;return out;}

test('R11 bounded staged receipt SQL preserves history and never regenerates while pending',{skip:!host,timeout:120000},async t=>{
 const req=createRequire(path.resolve(host,'package.json')),{PGlite}=req('@electric-sql/pglite'),{pgcrypto}=req('@electric-sql/pglite/contrib/pgcrypto');const db=new PGlite({extensions:{pgcrypto}});
 try{
 await db.exec(r04SqlBootstrap+sessionBootstrap);
 for(const name of readdirSync(path.join(root,'supabase/migrations')).filter(n=>n.endsWith('.sql')).sort()){if(name===migration)break;await db.exec(source(name));}
 await setupResearchFixture(db,{modelId:PENDING_MODEL});
 const historical=await pendingFixture(db);await repairFail(db,historical,repairFailure(historical,'search',historical.marked.requestId));
 const beforeR05=(await db.query(r05FunctionSnapshot)).rows,beforeRows=await snapshot(db,'r05_%'),history=await snapshot(db,'r11_research_%');
 const publicAcl=(await db.query("select oid::regprocedure::text id,proacl::text acl from pg_proc where proname in ('r11_research_server_v2','r11_research_workspace_v2') order by 1")).rows;
 await assert.rejects(db.exec(source(migration).replace(/commit;\s*$/,()=>"do $$ begin raise exception 'pending_rollback';end $$;commit;")),/pending_rollback/);await db.exec('rollback');
 assert.equal(await value(db,"select to_regclass('private.r11_research_receipt_candidates')::text result"),null);
 assert.deepEqual(await snapshot(db,'r11_research_%'),history);assert.deepEqual(await snapshot(db,'r05_%'),beforeRows);
 await db.exec(source(migration));assert.deepEqual((await db.query(r05FunctionSnapshot)).rows,beforeR05);assert.deepEqual(await snapshot(db,'r05_%'),beforeRows);
 for(const [table,rows] of Object.entries(history))assert.deepEqual((await db.query(`select to_jsonb(t) row from private.${table} t order by to_jsonb(t)::text`)).rows,rows);
 assert.deepEqual((await db.query("select oid::regprocedure::text id,proacl::text acl from pg_proc where proname in ('r11_research_server_v2','r11_research_workspace_v2') order by 1")).rows,publicAcl);
 await t.test('private tables/helpers deny every client role and workspace contains metadata only',async()=>{
  const s=await pendingFixture(db);const staged=await stagePending(db,s);assert.equal(staged.status,'awaiting_receipt');assert.equal(staged.attempts,0);assert.equal((await stagePending(db,s)).replayed,true);
  assert.deepEqual((await load(db,s)).receiptCandidates[0].candidate,s.candidate);
  const workspace=await repairWorkspace(db,s),item=workspace.policies.find(p=>p.policyId===s.policy.id);assert.equal(item.receiptChecks[0].candidateHash,s.candidateHash);assert.equal(JSON.stringify(workspace).includes(s.candidate.output[0].url_citation.content),false);assert.equal('candidate' in item.receiptChecks[0],false);
  for(const role of ['anon','authenticated','service_role']){
   await db.exec(`set role ${role}`);await assert.rejects(db.query('select * from private.r11_research_receipt_candidates'),/permission denied/);await assert.rejects(db.query('select private.r11_research_receipt_status(null)'),/permission denied/);await db.exec('reset role');
  }
  await authenticate(db,RESEARCH_OTHER);await assert.rejects(repairWorkspace(db,s),/owner_required/);await authenticate(db);
 });
 await t.test('immutable exact request/cost/source candidate rejects mutation and mismatched receipt before any GET claim',async()=>{
  const s=await pendingFixture(db),before=await counts(db,s);
  for(const change of [c=>{c.extra='raw-wrapper';},c=>{c.providerRequestId='gen-wrong';},c=>{c.reportedMicrousd=21;},c=>{c.output=[];},c=>{c.output[0].url_citation.url='https://etsy.com/private';},c=>{c.output[0].url_citation.content='x'.repeat(1801);},c=>{c.output[0].url_citation.headers={secret:'no'};},c=>{c.output[0].url_citation.title='Unnormalized  title';},c=>{c.output[0].url_citation.content+='\n';},c=>{c.observation.observedModelId='wrong';}]){const c=structuredClone(s.candidate);change(c);await assert.rejects(stagePending(db,s,c),/r11_|r04_/);}
  assert.deepEqual(await counts(db,s),before);await stagePending(db,s);
  const c=structuredClone(s.candidate);c.output[0].url_citation.title='Changed';await assert.rejects(stagePending(db,s,c),/candidate_conflict/);
  await assert.rejects(db.query("update private.r11_research_receipt_candidates set candidate=candidate||'{\"x\":1}' where request_id=$1",[s.marked.requestId]),/immutable_history/);
  const wrongKey=`inert-wrong-key-${randomUUID()}-123456789`;await db.query("insert into private.r05_server_keys values($1,clock_timestamp()+interval '1 hour')",[sha(wrongKey)]);await assert.rejects(researchV2(db,s,'claim_receipt',{policyId:s.policy.id,phase:'search',candidateHash:s.candidateHash},wrongKey),/candidate_required/);
  const other=await pendingFixture(db);await assert.rejects(researchV2(db,other,'claim_receipt',{policyId:s.policy.id,phase:'search',candidateHash:s.candidateHash}),/receipt_scope/);
  await db.query('update public.businesses set owner_user_id=$2 where id=$1',[s.businessId,RESEARCH_OTHER]);await assert.rejects(load(db,s),/receipt_scope/);await db.query('update public.businesses set owner_user_id=$2 where id=$1',[s.businessId,RESEARCH_OWNER]);
 });
 await t.test('claim before I/O is exclusive, cooldown survives restart and longer Retry-After never shortens',async()=>{
  const s=await pendingFixture(db);await stagePending(db,s);const before=await counts(db,s);
  const answers=await Promise.all([claimPending(db,s),claimPending(db,s),claimPending(db,s)]);assert.equal(answers.filter(x=>x.claimed).length,1);assert.equal(answers.filter(x=>x.reason==='cooldown').length,2);
  const claim=answers.find(x=>x.claimed);assert.equal(claim.attempts,1);assert.equal(claim.status,'checking_receipt');assert.ok(Date.parse(claim.nextCheckAt)>=Date.now()+118000);
  const retryAfterAt=new Date(Date.now()+600000).toISOString(),result=await recordPending(db,s,claim,{diagnostic:{code:'api_failure',httpStatus:429},retryAfterAt});assert.equal(result.status,'awaiting_receipt');assert.equal(Date.parse(result.nextCheckAt),Date.parse(retryAfterAt));
  assert.equal((await recordPending(db,s,claim,{diagnostic:{code:'api_failure',httpStatus:429},retryAfterAt})).replayed,true);
  await assert.rejects(recordPending(db,s,claim,{diagnostic:{code:'timeout',httpStatus:null}}),/record_conflict/);
  assert.equal((await claimPending(db,s)).reason,'cooldown');assert.equal((await load(db,s)).receiptCandidates[0].attempts,1);assert.deepEqual(await counts(db,s),before);
  const replay=await windowGuard(db,s,'search',s.quote);assert.equal(replay.shouldDispatch,false);assert.equal(replay.requestId,s.marked.requestId);
 });
 await t.test('three actual claims per phase are monotone, lost replies consume claims and exhaustion retains output',async()=>{
  const s=await pendingFixture(db);await stagePending(db,s);const lost=await seedPastClaims(db,s,2);const third=await claimPending(db,s);assert.equal(third.attempts,3);assert.equal(third.claimed,true);
  await assert.rejects(recordPending(db,s,lost,{proof:pendingProof(s)}),/claim_invalid/);
  await recordPending(db,s,third,{diagnostic:{code:'timeout',httpStatus:null}});assert.equal((await claimPending(db,s)).reason,'exhausted');
  const saved=(await load(db,s)).receiptCandidates[0];assert.equal(saved.status,'exhausted');assert.deepEqual(saved.candidate,s.candidate);assert.equal(await value(db,'select count(*)::int result from private.r11_research_receipt_checks where request_id=$1',[s.marked.requestId]),3);
  await assert.rejects(db.query("insert into private.r11_research_receipt_checks(request_id,attempt) values($1,4)",[s.marked.requestId]),/check constraint/);
  await assert.rejects(db.query('delete from private.r11_research_receipt_checks where request_id=$1',[s.marked.requestId]),/immutable_history/);
  assert.equal(await value(db,'select count(*)::int result from private.r11_research_collections where policy_id=$1',[s.policy.id]),0);
 });
 await t.test('exact proof is required for collect via both server entry points; wrong receipt/provider/hash stays pending',async()=>{
  const s=await pendingFixture(db);await stagePending(db,s);await seedPastClaims(db,s,2);const claim=await claimPending(db,s);
  for(const proof of [pendingProof(s,{generationId:'gen-other'}),pendingProof(s,{providerName:'Other'}),pendingProof(s,{modelId:'unreviewed/model'}),pendingProof(s,{providerResponses:[{providerName:'Azure',modelId:PENDING_MODEL,status:500}]}),{...pendingProof(s),proofHash:'a'.repeat(64)}])await assert.rejects(recordPending(db,s,claim,{proof}),/proof_invalid/);
  await assert.rejects(researchV2(db,s,'collect',s.payload),/verified_receipt_required/);
  await assert.rejects(value(db,'select public.r11_research_server($1,\'collect\',$2,$3) result',[s.businessId,s.payload,RESEARCH_KEY]),/verified_receipt_required/);
  const verified=await recordPending(db,s,claim,{proof:pendingProof(s)});assert.equal(verified.status,'verified');assert.equal((await claimPending(db,s)).reason,'verified');
  const altered=structuredClone(s.payload);altered.collection.sources[0].title='Changed title';recanonicalizeCollection(altered);await assert.rejects(researchV2(db,s,'collect',altered),/staged_output_mismatch/);
  const collected=await researchV2(db,s,'collect',s.payload);assert.ok(collected.collectionId);s.collectionId=collected.collectionId;s.lineage=s.payload.lineage;
  const search=s;const mark=await windowGuard(db,s,'select',freshPhaseQuote());const receipt=`gen-inert-select-${randomUUID()}`;await repairSettle(db,s,mark.requestId,receipt);
  const completion=completionPayload(s,s.payload.collection,mark.requestId,receipt),selected={...s,marked:mark,receipt,candidate:{...s.candidate,phase:'select',providerRequestId:receipt,receivedAt:new Date().toISOString(),output:completion.selection,observation:repairObservation(s,{searchRequests:0,annotationCount:0,approvedDomainCounts:s.policy.allowedDomains.map(domain=>({domain,count:0}))})}};selected.candidateHash=hash(selected.candidate);
  await stagePending(db,selected);await assert.rejects(researchV2(db,s,'complete',completion),/verified_receipt_required/);await seedPastClaims(db,selected,2);const selectedClaim=await claimPending(db,selected);await recordPending(db,selected,selectedClaim,{proof:pendingProof(selected)});await researchV2(db,s,'complete',completion);
  assert.equal(await value(db,'select count(*)::int result from private.r11_research_receipt_candidates where policy_id=$1',[s.policy.id]),2);assert.equal(await value(db,'select count(*)::int result from private.r05_markers where business_id=$1',[s.businessId]),2);assert.equal(await value(db,'select count(*)::int result from private.r11_research_results where policy_id=$1',[s.policy.id]),1);
  assert.equal((await load(db,search)).receiptCandidates.length,2);assert.equal(await value(db,'select count(*)::int result from private.r11_research_receipt_checks q join private.r11_research_receipt_candidates c on c.request_id=q.request_id where c.policy_id=$1',[s.policy.id]),6);
 });
 for(const duplicate of ['url','content'])await t.test(`fully validated duplicate ${duplicate} citations retain raw counts and use greedy collection projection`,async()=>{
  const s=await pendingFixture(db),first=s.candidate.output[0],otherContent='Independent reports also describe compact containers and durable tools for adults working in small garden spaces.',otherUrl='https://gardening.example/second-report';
  const skipped={type:'url_citation',url_citation:{url:duplicate==='url'?first.url_citation.url:otherUrl,title:'Skipped repeated citation',content:duplicate==='content'?first.url_citation.content:otherContent}};
  const retained={type:'url_citation',url_citation:{url:otherUrl,title:'Second retained citation',content:otherContent}};
  s.candidate.output=[first,skipped,retained];s.candidate.observation=repairObservation(s,{annotationCount:3,approvedDomainCounts:s.policy.allowedDomains.map((domain,index)=>({domain,count:index===0?3:0}))});s.candidateHash=hash(s.candidate);
  // Even a citation that deduplication would skip must pass all source checks.
  for(const mutate of [c=>{c.output[1].url_citation.content='Too short';},c=>{c.output[1].url_citation.url='https://etsy.com/forbidden';},c=>{c.output[1].url_citation.headers={unsafe:'raw'};}]){const invalid=structuredClone(s.candidate);mutate(invalid);await assert.rejects(stagePending(db,s,invalid),/r11_|r04_/);}
  await stagePending(db,s);const claim=await claimPending(db,s);await recordPending(db,s,claim,{proof:pendingProof(s)});
  // Retaining only the first source would incorrectly mark the skipped
  // citation's unretained content/URL as seen. The third citation must survive.
  await assert.rejects(researchV2(db,s,'collect',s.payload),/staged_output_mismatch/);
  const contentHash=sha(otherContent),id=`src-${sha(`${otherUrl}:${contentHash}`).slice(0,24)}`;
  s.payload.collection.sources.push({...s.payload.collection.sources[0],id,url:otherUrl,title:retained.url_citation.title,contentHash,excerpt:otherContent});
  s.payload.collection.evidence.push({id:`evi-${sha(`${id}:${otherContent}`).slice(0,24)}`,sourceId:id,quote:otherContent});recanonicalizeCollection(s.payload);
  const collected=await researchV2(db,s,'collect',s.payload);s.collectionId=collected.collectionId;s.lineage=s.payload.lineage;
  const loaded=await load(db,s);assert.equal(loaded.receiptCandidates[0].candidate.output.length,3);assert.equal(loaded.receiptCandidates[0].candidate.observation.annotationCount,3);assert.deepEqual(loaded.collection.collection.sources.map(x=>[x.url,x.excerpt]),[[first.url_citation.url,first.url_citation.content],[otherUrl,otherContent]]);
  const marked=await windowGuard(db,s,'select',freshPhaseQuote()),receipt=`gen-inert-dedup-${randomUUID()}`;await repairSettle(db,s,marked.requestId,receipt);const completion=completionPayload(s,s.payload.collection,marked.requestId,receipt),selected={...s,marked,receipt,candidate:{...s.candidate,phase:'select',providerRequestId:receipt,receivedAt:new Date().toISOString(),output:completion.selection,observation:repairObservation(s,{searchRequests:0,annotationCount:0,approvedDomainCounts:s.policy.allowedDomains.map(domain=>({domain,count:0}))})}};selected.candidateHash=hash(selected.candidate);
  await stagePending(db,selected);const selectedClaim=await claimPending(db,selected);await recordPending(db,selected,selectedClaim,{proof:pendingProof(selected)});assert.ok((await researchV2(db,s,'complete',completion)).resultId);assert.equal((await counts(db,s)).markers,2);
 });
 await t.test('terminal diagnostics stay terminal and owner Stop blocks further claims, recording and promotion',async()=>{
  for(const diagnostic of [{code:'api_failure',httpStatus:401},{code:'api_failure',httpStatus:null},{code:'generation_mismatch',httpStatus:200}]){
   const s=await pendingFixture(db);await stagePending(db,s);const claim=await claimPending(db,s);const result=await recordPending(db,s,claim,{diagnostic});assert.equal(result.status,'terminal');assert.equal((await claimPending(db,s)).reason,'terminal');const item=(await repairWorkspace(db,s)).policies[0];assert.equal(item.revoked,true);assert.equal(item.status,'needs_owner');assert.equal(item.outcomes[0].reason,'response_provider_unqualified');assert.equal(item.outcomes[0].observation.inferenceRouteFailureCode,diagnostic.code);await assert.rejects(load(db,s),/receipt_inactive/);assert.equal(await value(db,'select count(*)::int result from private.r11_research_results where policy_id=$1',[s.policy.id]),0);
  }
  const s=await pendingFixture(db);await stagePending(db,s);const claim=await claimPending(db,s);await repairStop(db,s);assert.equal((await claimPending(db,s)).reason,'stopped');await assert.rejects(recordPending(db,s,claim,{proof:pendingProof(s)}),/receipt_inactive/);await assert.rejects(load(db,s),/receipt_inactive/);assert.equal((await repairWorkspace(db,s)).policies[0].receiptChecks[0].status,'stopped');
 });
 await t.test('a terminal-record failure rolls back its observation, revocation and workflow while retaining the consumed claim',async()=>{
  const s=await pendingFixture(db);await stagePending(db,s);const claim=await claimPending(db,s),before=await counts(db,s);
  await db.exec(`create function private.r11_pending_test_failure() returns trigger language plpgsql as $$ begin if new.id='${s.workflowRunId}' and new.status='needs_owner' then raise exception 'inert_record_rollback';end if;return new;end $$;create trigger r11_pending_test_failure before update on public.workflow_runs for each row execute function private.r11_pending_test_failure();`);
  await assert.rejects(recordPending(db,s,claim,{diagnostic:{code:'provider_mismatch',httpStatus:200}}),/inert_record_rollback/);
  assert.equal(await value(db,'select count(*)::int result from private.r11_research_receipt_observations where check_id=$1',[claim.claimId]),0);assert.equal(await value(db,'select count(*)::int result from private.r11_research_revocations where policy_id=$1',[s.policy.id]),0);assert.equal(await value(db,'select count(*)::int result from private.r11_research_outcomes where policy_id=$1',[s.policy.id]),0);assert.equal((await claimPending(db,s)).reason,'cooldown');assert.deepEqual(await counts(db,s),before);
  await db.exec('drop trigger r11_pending_test_failure on public.workflow_runs;drop function private.r11_pending_test_failure()');
 });
 await t.test('search may verify after dispatch expiry but cannot collect or admit an unused selector',async()=>{
  const validFrom=new Date(Date.now()-1000).toISOString(),validUntil=new Date(Date.now()+1500).toISOString();const s=await pendingFixture(db,{policyOverrides:{validFrom,validUntil,quoteValidUntil:validUntil}});await stagePending(db,s);
  await new Promise(r=>setTimeout(r,Math.max(0,Date.parse(validUntil)-Date.now()+50)));const loaded=await load(db,s);assert.equal(loaded.receiptCandidates[0].status,'awaiting_receipt');const claim=await claimPending(db,s);await recordPending(db,s,claim,{proof:pendingProof(s)});
  await assert.rejects(researchV2(db,s,'collect',s.payload),/policy_inactive/);assert.equal(await value(db,'select count(*)::int result from private.r05_markers where business_id=$1',[s.businessId]),1);
  assert.equal(Date.parse((await load(db,s)).receiptCandidates[0].receiptExpiresAt),Date.parse(validUntil)+1800000);
 });
 await t.test('already marked selector can verify and finish during unchanged receipt grace after dispatch expiry',async()=>{
  const validFrom=new Date(Date.now()-1000).toISOString(),validUntil=new Date(Date.now()+2000).toISOString();const s=await pendingFixture(db,{policyOverrides:{validFrom,validUntil,quoteValidUntil:validUntil}});await stagePending(db,s);const claim=await claimPending(db,s);await recordPending(db,s,claim,{proof:pendingProof(s)});const collected=await researchV2(db,s,'collect',s.payload);s.collectionId=collected.collectionId;s.lineage=s.payload.lineage;
  const marked=await windowGuard(db,s,'select',freshPhaseQuote()),receipt=`gen-inert-grace-${randomUUID()}`;await repairSettle(db,s,marked.requestId,receipt);const completion=completionPayload(s,s.payload.collection,marked.requestId,receipt),selected={...s,marked,receipt,candidate:{...s.candidate,phase:'select',providerRequestId:receipt,receivedAt:new Date().toISOString(),output:completion.selection,observation:repairObservation(s,{searchRequests:0,annotationCount:0,approvedDomainCounts:s.policy.allowedDomains.map(domain=>({domain,count:0}))})}};selected.candidateHash=hash(selected.candidate);await stagePending(db,selected);
  await new Promise(r=>setTimeout(r,Math.max(0,Date.parse(validUntil)-Date.now()+50)));assert.equal((await load(db,s)).receiptCandidates.length,2);const selectedClaim=await claimPending(db,selected);await recordPending(db,selected,selectedClaim,{proof:pendingProof(selected)});const completed=await researchV2(db,s,'complete',completion);assert.ok(completed.resultId);assert.equal(await value(db,'select status result from public.workflow_runs where id=$1',[s.workflowRunId]),'completed');
  assert.equal(await value(db,'select count(*)::int result from private.r05_markers where business_id=$1',[s.businessId]),2);
 });
 await t.test('expiry blocks output access and GETs without cleanup or authority renewal',async()=>{
  const s=await pendingFixture(db);
  // Test-only insert-time clock shortening, never shipped by the migration.
  await db.exec(`create function private.r11_pending_test_expiry() returns trigger language plpgsql as $$ begin if new.request_id='${s.marked.requestId}' then new.receipt_expires_at=clock_timestamp()+interval '100 milliseconds';end if;return new;end $$;create trigger r11_pending_test_expiry before insert on private.r11_research_receipt_candidates for each row execute function private.r11_pending_test_expiry();`);
  await stagePending(db,s);await new Promise(r=>setTimeout(r,150));assert.equal((await claimPending(db,s)).reason,'expired');await assert.rejects(load(db,s),/receipt_inactive/);assert.deepEqual(await value(db,'select candidate result from private.r11_research_receipt_candidates where request_id=$1',[s.marked.requestId]),s.candidate);assert.equal((await repairWorkspace(db,s)).policies[0].receiptChecks[0].status,'expired');
  await db.exec('drop trigger r11_pending_test_expiry on private.r11_research_receipt_candidates;drop function private.r11_pending_test_expiry()');
 });
 assert.deepEqual((await db.query(r05FunctionSnapshot)).rows,beforeR05);
 }finally{await db.close();}
});


const pgUrl=process.env.R11_PUBLIC_RESEARCH_POSTGRES_URL;
test('R11 durable receipt physical PostgreSQL claim, Stop and record races',{
 skip:!host||!pgUrl?'Requires the hosted isolated loopback PostgreSQL service; PGlite is not physical concurrency evidence':false,timeout:120000,
},async t=>{
 // CI runs the existing primary SQL group first, then this pending suite in
 // a separate process on the same isolated service. The primary owns the exact
 // cluster roles; this fixed fresh database avoids schema/model collisions.
 // Existing databases and roles are never altered, reset or dropped.
 validateResearchPostgresUrl(pgUrl);
 const req=createRequire(path.resolve(host,'package.json')),{Client}=req('pg');
 const admin=new Client({connectionString:pgUrl,connectionTimeoutMillis:5000,statement_timeout:15000,application_name:'r11-pending-isolated-database'});let db;
 try{
  await admin.connect();const target=(await admin.query('select current_database() db,current_user actor,inet_server_addr()::text address')).rows[0];
  assert.equal(target.db,'r11_research_test');assert.equal(target.actor,'r11_test');assert.equal(admin.connection.stream.remoteAddress,'127.0.0.1');assert.ok(target.address);
  assert.equal(await value(admin,"select count(*)::int result from pg_database where datname='r11_research_pending_test'"),0,'Require absent fixed disposable pending database; never reset or drop an existing database');
  // Assert the workflow prerequisite immediately; polling cannot resolve a
  // primary test file that the runner has not scheduled yet.
  assert.equal(await value(admin,"select count(*)::int result from pg_roles where rolname in ('anon','authenticated','service_role')"),3,'Run the existing primary R11 SQL group to completion before this pending suite on the same isolated PostgreSQL service');
  await admin.query('create database r11_research_pending_test template template0');
  const isolated=new URL(pgUrl);isolated.pathname='/r11_research_pending_test';
  db=new Client({connectionString:isolated.href,connectionTimeoutMillis:5000,statement_timeout:15000,application_name:'r11-pending-isolated'});await db.connect();
  const actual=(await db.query('select current_database() db,current_user actor,inet_server_addr()::text address')).rows[0];assert.equal(actual.db,'r11_research_pending_test');assert.equal(actual.actor,'r11_test');assert.equal(db.connection.stream.remoteAddress,'127.0.0.1');assert.ok(actual.address);
  assert.equal(Number((await db.query("select count(*) from pg_tables where schemaname in ('public','private','auth','storage')")).rows[0].count),0,'Fresh empty pending database required');
  const clusterRoles='create role anon; create role authenticated; create role service_role bypassrls;';assert.ok(r04SqlBootstrap.startsWith(clusterRoles));db.exec=sql=>db.query(sql);
  await db.exec(r04SqlBootstrap.slice(clusterRoles.length)+sessionBootstrap);
  for(const name of readdirSync(path.join(root,'supabase/migrations')).filter(n=>n.endsWith('.sql')).sort())await db.exec(source(name));
  await setupResearchFixture(db,{modelId:PENDING_MODEL});
  await pendingReceiptPostgresRaces(t,{db,Client,pgUrl:isolated.href});
 }finally{if(db)await db.end();await admin.end();}
});
