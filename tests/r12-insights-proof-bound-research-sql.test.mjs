/** Actual source/model/driver composition; all provider and renderer IO is inert. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {proofBoundResearchDatabase} from './helpers/r12-proof-bound-research-database.mjs';
import {proofBoundResearchControllerFixture} from './helpers/r12-proof-bound-research-controller-fixture.mjs';
import {proofBoundResearchRuntimeComposition,INERT_DIRECT_RUNTIME_ROOT} from './helpers/r12-proof-bound-research-runtime-fixture.mjs';
import {one,ownerInitialRpc} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2-hash.js';
const enabled=!!process.env.R12_SQL_TEST_HOST;
test('proof-bound research executes one actual source query through the independent reviewer with exact saved readiness',{skip:!enabled,timeout:240000},async t=>{
 const db=await proofBoundResearchDatabase(),fetch=globalThis.fetch,env={VERCEL_ENV:process.env.VERCEL_ENV,R05_ADMISSION_SERVER_KEY:process.env.R05_ADMISSION_SERVER_KEY};let external=0;
 globalThis.fetch=async()=>{external++;throw Error('No external calls');};Object.assign(process.env,{VERCEL_ENV:'production',R05_ADMISSION_SERVER_KEY:INERT_DIRECT_RUNTIME_ROOT});
 try{
  const f=await proofBoundResearchControllerFixture(db),h=proofBoundResearchRuntimeComposition(db,f);t.diagnostic('Actual durable driver SHA256 '+h.sourceHash);
  for(const role of ['anon','authenticated','service_role']){assert.equal((await one(db,"select count(*)::int n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='private' and (p.proname like 'r12_research_renderer_%' or p.proname like '%_before_research4' or p.proname in ('r12_renderer_review_lock_businesses','r12_candidate_review_revocation_lock','r12_research_review_revocation_lock','r12_direct_review_revocation_lock')) and has_function_privilege($1,p.oid,'EXECUTE')",[role])).n,0);for(const table of ['r12_proof_bound_source_reviews','r12_proof_bound_source_revocations'])assert.equal((await one(db,"select has_table_privilege($1,'private.'||$2,'SELECT,INSERT,UPDATE,DELETE') access",[role,table])).access,false);}
  assert.equal((await one(db,"select count(*)::int n from pg_trigger where not tgisinternal and tgname in ('r12_candidate_revocation_business_lock','r12_review_revocation_business_lock','r12_research_revocation_business_lock')")).n,7);
  assert.equal(f.verificationResult.status,'verified');assert.equal(f.verificationRuntime.browser.events.includes('submit'),false);
  assert.equal((await h.step()).reason,'accepted',JSON.stringify(h.sqlErrors));h.faults.sourceFinishUnavailable=1;
  assert.equal((await h.step()).reason,'source_recovery_pending',JSON.stringify({errors:h.sqlErrors,results:h.sourceResults}));
  assert.equal(h.browserPosts.length,1,JSON.stringify({results:h.sourceResults,errors:h.sqlErrors,calls:h.calls.filter(x=>['qualify_renderer','source_admit','source_transport'].includes(x.operation))}));assert.equal(h.sourceResults[0].run.receipt.status,'completed');
  assert.equal((await h.step()).reason,'source_reconciled',JSON.stringify(h.sqlErrors));assert.equal(h.browserPosts.length,1);
  assert.equal((await h.step()).reason,'accepted',JSON.stringify(h.sqlErrors));assert.equal((await h.step()).reason,'accepted',JSON.stringify(h.sqlErrors));
  const state=(await f.read()).state;assert.equal(state.attempts[0].status,'completed');assert.equal(state.attempts[0].review.outcome,'NME');assert.equal(state.sourceOperationsStarted,1);assert.equal(state.modelDispatchesUsed,3);
  assert.deepEqual(h.modelPosts.map(x=>x.phase),['plan','strategy','review']);assert.equal(h.browsers[0].events.filter(x=>x==='submit').length,1);assert.equal(h.browsers[0].browser.isConnected(),false);
  const source=h.browserPosts[0],q=(await one(db,'select content from private.r12_direct_source_renderer_qualifications where attempt_id=$1',[source.attemptId])).content;
  assert.equal(q.version,'r12.etsy-insights-renderer-qualification.3');assert.equal(q.qualificationHash,hash(Object.fromEntries(Object.entries(q).filter(([k])=>k!=='qualificationHash'))));
  assert.equal(q.readiness.verificationOperationId,f.approved.verificationOperation);assert.equal(q.readiness.verificationHash,f.approved.accountBinding.accountVerificationHash);assert.equal(q.readiness.accountBindingHash,f.approved.accountBinding.bindingHash);assert.equal(q.readiness.verifiedContextHash,f.approved.accountBinding.verifiedContextHash);
  const verificationPermit=await one(db,'select expires_at from private.r12_etsy_steel_verification_runs where operation_id=$1',[f.approved.verificationOperation]);assert.ok(Date.parse(q.readiness.expiresAt)>new Date(verificationPermit.expires_at).getTime(),'Completed verification execution expiry is not reused as research readiness expiry');
  const rows=(await db.query('select request from private.r12_direct_source_renderer_requests where attempt_id=$1 order by sequence',[source.attemptId])).rows.map(x=>x.request);
  assert.equal(rows.length,3);assert.deepEqual(rows.map(x=>x.disposition),['allow','deny_candidate_ancillary','allow']);assert.equal(h.browsers[0].cdpCommands.filter(x=>x.name==='Fetch.failRequest').length,1);
  for(const r of rows){const{decisionHash,...body}=r;assert.equal(decisionHash,hash(body));assert.equal(r.qualificationHash,q.qualificationHash);}
  assert.equal(JSON.stringify(rows).includes('/bat.js'),false);
  const finance=await one(db,'select sum(held)::text held,sum(pending_maximum)::text pending,sum(known_actual)::text actual,bool_or(unknown) unknown from private.r12_direct_browser_exposure($1)',[f.authority.f.businessId]);assert.deepEqual(finance,{held:'3000',pending:'3000',actual:'0',unknown:false});
  await db.query('insert into private.r12_proof_bound_source_revocations(review_hash) values($1)',[f.sourceReviewHash]);
  await assert.rejects(f.rpc('qualify_renderer',{attemptId:source.attemptId},'source'),/r12_research_renderer_review_inactive/);
  assert.equal((await ownerInitialRpc(db,f.authority.f.ownerId,'r12_owner_etsy_steel_verification_read',[f.authority.f.businessId,f.approved.setupOperation])).status,'verified','Source revocation does not invent account identity failure');
  await f.rpc('source_transport',{attemptId:source.attemptId,request:{provider:'steel',operation:'browser.etsy.session.release',method:'POST',endpoint:'https://api.steel.dev/v1/sessions/'+source.operationId+'/release'}},'source');
  assert.equal(external,0);
 }finally{globalThis.fetch=fetch;for(const[k,v]of Object.entries(env))if(v===undefined)delete process.env[k];else process.env[k]=v;await db.close();}
});

test('proof-bound preparation rejects both cross-mode bindings and absent source review before any paid research work',{skip:!enabled,timeout:240000},async()=>{
 const db=await proofBoundResearchDatabase();try{
  for(const options of [{legacyVerification:true},{sourceReview:false},{sourceReview:false,sourceRendererPolicy:{version:'etsy.insights-renderer-policy.1',staticOrigins:[],maximumRequests:256,navigation:'fixed_insights_get_only',sameOrigin:'renderer_get_only',post:'denied',extraction:'visible_aggregate_dom_only'}}]){
   let captured;await assert.rejects(proofBoundResearchControllerFixture(db,{...options,beforeResearch:ctx=>{captured=ctx;}}),/r12_research_candidate_verification_required|r12_candidate_research_unqualified/);
   assert.ok(captured);const envelope=captured.authority.prepared.testEnvelopeId;
   assert.equal((await one(db,'select count(*)::int n from private.r12_direct_research_setups where envelope_id=$1',[envelope])).n,0);
   assert.equal((await one(db,"select count(*)::int n from private.r12_direct_request_bindings where envelope_id=$1 and kind in ('research_model','research_source')",[envelope])).n,0);
  }
 }finally{await db.close();}
});

test('proof-bound source rejects changed stored readiness and completes cleanup after in-flight review revocation',{skip:!enabled,timeout:240000},async()=>{
 const db=await proofBoundResearchDatabase(),fetch=globalThis.fetch,prior={VERCEL_ENV:process.env.VERCEL_ENV,R05_ADMISSION_SERVER_KEY:process.env.R05_ADMISSION_SERVER_KEY};let external=0;
 globalThis.fetch=async()=>{external++;throw Error('No external calls');};Object.assign(process.env,{VERCEL_ENV:'production',R05_ADMISSION_SERVER_KEY:INERT_DIRECT_RUNTIME_ROOT});
 try{
  const f=await proofBoundResearchControllerFixture(db),h=proofBoundResearchRuntimeComposition(db,f,{afterSourceCreate:()=>db.query('insert into private.r12_proof_bound_source_revocations(review_hash) values($1)',[f.sourceReviewHash])});
  assert.equal((await h.step()).reason,'accepted');const a=await f.schedule('source'),q=await f.rpc('qualify_renderer',{attemptId:a.attemptId},'source');
  await assert.rejects(f.rpc('qualify_renderer',{attemptId:a.attemptId,readiness:q.readiness},'source'),/r04_invalid_fields/);
  // Privileged test-only corruption is rolled back. Public roles cannot mutate
  // these immutable rows; validators still independently reject changed pins.
  const mutations=[
   ["alter table private.r12_proof_bound_source_reviews disable trigger user;update private.r12_proof_bound_source_reviews set provider_project_id='00000000-0000-4000-8000-000000000099' where review_hash=$1",[f.sourceReviewHash],/r12_research_renderer_review_changed/],
   ["alter table private.r12_direct_source_renderer_qualifications disable trigger user;update private.r12_direct_source_renderer_qualifications set content=jsonb_set(content,'{readiness,accountBindingHash}',to_jsonb(repeat('f',64))),qualification_hash=private.stage14_hash(jsonb_set(content,'{readiness,accountBindingHash}',to_jsonb(repeat('f',64)))-'qualificationHash') where attempt_id=$1",[a.attemptId],/r12_research_renderer_qualification_changed/],
   ["alter table private.r12_direct_browser_accounting disable trigger user;delete from private.r12_direct_browser_accounting where operation_id=$1",[f.approved.verificationOperation],/r12_research_verification_cleanup_accounting_required/],
   ["insert into private.r12_proof_bound_source_revocations(review_hash) values($1)",[f.sourceReviewHash],/r12_research_renderer_review_inactive/],
  ];
  for(const[sql,params,error]of mutations){await db.exec('begin');try{const commands=sql.split(';');for(const command of commands)await db.query(command,command.includes('$1')?params:[]);await db.exec('set local role anon');await assert.rejects(db.query('select public.r12_direct_controller_server($1,$2,$3,$4,$5)',[f.authority.f.businessId,f.prepared.scopeId,'qualify_renderer',{attemptId:a.attemptId},f.keys.source]),error);}finally{await db.exec('rollback');}}
  assert.deepEqual(await f.rpc('qualify_renderer',{attemptId:a.attemptId},'source'),q);
  assert.equal((await one(db,'select count(*)::int n from private.r05_reservations where request_id=$1',[a.requestId])).n,0);
  await h.step();assert.equal(h.modelPosts.length,1);assert.equal(h.browserPosts.length,1);assert.equal(h.browsers[0].events.includes('submit'),false);
  assert.equal(h.sourceResults[0].run.receipt.status,'paused',JSON.stringify({results:h.sourceResults,errors:h.sqlErrors}));
  assert.equal(h.sourceResults[0].accounting,'qualified_bounded_pending',JSON.stringify(h.sourceResults));
  assert.equal(h.browsers[0].browser.isConnected(),false);
  assert.equal((await one(db,'select count(*)::int n from private.r12_direct_source_cleanup_proofs where attempt_id=$1',[a.attemptId])).n,1);
  assert.equal((await one(db,"select count(*)::int n from private.r12_direct_browser_evidence where operation_id=$1 and kind='release' and content->'terminal'='true'::jsonb and content->'observersDisposed'='true'::jsonb",[a.inputs.operationId])).n,1);
  assert.equal(external,0);
 }finally{globalThis.fetch=fetch;for(const[k,v]of Object.entries(prior))if(v===undefined)delete process.env[k];else process.env[k]=v;await db.close();}
});
