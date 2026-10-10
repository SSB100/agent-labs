/** Native observed-lock proof only. All provider IO is inert; no PGlite race
 * claim, remote target, credential transmission or database reset is allowed. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {proofBoundResearchDatabase} from './r12-proof-bound-research-database.mjs';
import {proofBoundResearchControllerFixture} from './r12-proof-bound-research-controller-fixture.mjs';
import {proofBoundResearchRuntimeComposition,INERT_DIRECT_RUNTIME_ROOT} from './r12-proof-bound-research-runtime-fixture.mjs';
import {asRole,orderedRace,validateOwnerInitialRaceEnvironment} from './r12-owner-initial-postgres-races.mjs';
import {one} from './r12-owner-initial-sql-fixture.mjs';
import {discoveryV2Hash as hash} from '../../.core-tests/products/discovery-v2-hash.js';
export {validateOwnerInitialRaceEnvironment as validateRendererRevocationRaceEnvironment};
function createRequest(s){return{version:'r12.etsy-insights-source-admission.1',operation:'create',sequence:0,requestHash:hash(s),
 ...Object.fromEntries(['operationId','sourceAttemptId','businessId','goalId','authorityRootId','scopeId','scopeHash','providerProjectId','originDirectRunId','windowAttemptOrdinal','attemptOrdinal','criteriaHash','questionHash','quoteHash','executionQuoteHash','executionQuoteProofHash','sourcePolicyHash','capturePolicyHash','maximumBrowserMicrounits'].map(k=>[k,s[k]])),windowId:s.window.windowId,windowOrdinal:s.window.windowOrdinal,accountBindingHash:s.accountBinding.bindingHash,accountVerificationHash:s.accountBinding.accountVerificationHash,sessionId:null,contextId:null,pageId:null,documentEpoch:null,targetId:null,captureHash:null};}
export async function exerciseRendererRevocationRaces(env=process.env){
 const target=validateOwnerInitialRaceEnvironment(env),require=createRequire(path.resolve(target.host,'package.json')),{Client}=require('pg');
 assert.equal(require('pg/package.json').version,'8.16.3');
 const db=await proofBoundResearchDatabase(),holder=new Client({connectionString:target.url,ssl:false,application_name:'r12-renderer-revocation-holder'}),waiter=new Client({connectionString:target.url,ssl:false,application_name:'r12-renderer-revocation-waiter'}),connected=[],races=[];
 const prior={VERCEL_ENV:process.env.VERCEL_ENV,R05_ADMISSION_SERVER_KEY:process.env.R05_ADMISSION_SERVER_KEY},fetch=globalThis.fetch;let external=0;
 globalThis.fetch=async()=>{external++;throw Error('External transport forbidden');};Object.assign(process.env,{VERCEL_ENV:'production',R05_ADMISSION_SERVER_KEY:INERT_DIRECT_RUNTIME_ROOT});
 try{
  for(const c of [holder,waiter]){await c.connect();connected.push(c);assert.deepEqual(await one(c,'select current_user actor,current_database() db,host(inet_server_addr()) address'),{actor:'r12_test',db:'r12_test',address:target.address});}
  for(const kind of ['candidate','research','route','qualification','grant_review'])for(const first of ['admission','revocation']){
   const f=await proofBoundResearchControllerFixture(db),runtime=proofBoundResearchRuntimeComposition(db,f);assert.equal((await runtime.step()).reason,'accepted');const a=await f.schedule('source'),request=createRequest(a.inputs);await f.rpc('qualify_renderer',{attemptId:a.attemptId},'source');
   const admit=c=>asRole(c,'anon','r12_direct_controller_server',[f.authority.f.businessId,f.prepared.scopeId,'source_admit',{request},f.keys.source]);
   const target={candidate:['r12_verification_candidate_revocations','review_hash',f.candidateReviewHash],research:['r12_proof_bound_source_revocations','review_hash',f.sourceReviewHash],route:['r12_direct_browser_route_revocations','route_hash',f.authority.routeHash],qualification:['r12_direct_source_qualification_revocations','qualification_hash',f.authority.prepared.preview.researchPins.executionReviewHash],grant_review:['r12_direct_grant_review_revocations','grant_id',f.authority.f.grantId]}[kind];
   const revoke=c=>c.query(`insert into private.${target[0]}(${target[1]}) values($1)`,[target[2]]);
   const result=await orderedRace({observer:db,holder,waiter,first:first==='admission'?admit:revoke,second:first==='admission'?revoke:admit});
   assert.equal(result.observedLockWait,true);
   if(first==='admission'){assert.ok(result.first.reservationId);assert.equal(result.second.error,undefined);}
   else assert.match(result.second.error?.message??'',/etsy_handoff_authority_inactive|r12_landing_review_inactive|r12_research_renderer_review_inactive|r12_direct_qualified_route_required|r12_direct_reviewed_grant_required|r12_direct_current_test_required|r12_direct_.*(revoked|qualification|review|route)/);
   const counts=await one(db,'select (select count(*)::int from private.r05_reservations where request_id=$1) reservations,(select count(*)::int from private.r12_direct_source_transport_claims where attempt_id=$2) transport',[a.requestId,a.attemptId]);
   assert.deepEqual(counts,{reservations:first==='admission'?1:0,transport:0});
   if(first==='admission'){
    await assert.rejects(f.rpc('source_transport',{attemptId:a.attemptId,request:{provider:'steel',operation:'browser.etsy.insights.create',method:'POST',endpoint:'https://api.steel.dev/v1/sessions'}},'source'),/etsy_handoff_authority_inactive|r12_landing_review_inactive|r12_research_renderer_review_inactive|r12_direct_qualified_route_required|r12_direct_reviewed_grant_required|r12_direct_current_test_required|r12_direct_.*(revoked|qualification|review|route)/);
    const due=await f.rpc('cleanup_due',{},'source');assert.equal(due.items.length,1,'Durable admitted cleanup remains readable after revocation');
   }
   assert.equal(runtime.browserPosts.length,0);races.push({kind,first,observedLockWait:true,waitEvent:result.waitEvent,counts});
  }
  assert.equal(external,0);return{engine:'postgresql',passed:true,races,providerCreates:0,externalCalls:external};
 }finally{globalThis.fetch=fetch;for(const[k,v]of Object.entries(prior))if(v===undefined)delete process.env[k];else process.env[k]=v;await Promise.all(connected.map(c=>c.end()));await db.close();}
}
