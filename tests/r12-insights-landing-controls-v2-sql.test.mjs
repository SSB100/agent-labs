/** Full migrated .2 qualification with genuine verification/source runtimes.
 * All browser/provider IO is inert; no live credentials, grants or calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {landingDatabase,landingPins,witnessHash,insertLandingReview} from './helpers/r12-landing-sql-fixture.mjs';
import {landingControllerFixture} from './helpers/r12-landing-controller-fixture.mjs';
import {landingSqlSource} from './helpers/r12-landing-source-sql-fixture.mjs';
import {directModelComplete} from './helpers/r12-direct-controller-model-fixture.mjs';
import {directControllerSource} from './helpers/r12-direct-controller-source-fixture.mjs';
import {r12PhaseOutputFixture} from './helpers/r12-phase-output-fixture.mjs';
import {prepareDirectTestAuthorityFixture} from './helpers/r12-direct-test-authority-fixture.mjs';
import {qualifyInertOwnerRenderer} from './helpers/r12-direct-setup-renewal-fixture.mjs';
import {runDirectApprovedSetup} from './helpers/r12-direct-approved-setup-fixture.mjs';
import {landingSqlVerification} from './helpers/r12-landing-verification-sql-fixture.mjs';
import {one,ownerInitialRpc} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2-hash.js';
import {ETSY_RENDERER_DOM_REFERENCE_HASH as provenanceHash} from '../.core-tests/browser/etsy-insights-renderer-evidence.js';
const enabled=!!process.env.R12_SQL_TEST_HOST;
const renderer2={version:'etsy.insights-renderer-policy.2',staticOrigins:[],maximumRequests:256,navigation:'fixed_insights_get_only',sameOrigin:'renderer_get_only',post:'denied',extraction:'visible_aggregate_dom_only',staticAssets:[],optionalTelemetry:[],provenanceHash};
const prepareSource=async f=>{const planner=await f.schedule('plan'),output=r12PhaseOutputFixture(f.profile.audience).plan;output.queryFocus=[];await directModelComplete(f,planner,output);return f.schedule('source');};
async function rollback(db,work){await db.exec('begin');try{return await work();}finally{await db.exec('rollback');await db.exec('reset role');}}
function rehashProof(p,b){
 const proof={...p};delete proof.verificationHash;delete proof.verifiedContextHash;
 const context={...proof,version:proof.version==='etsy.steel-account-verification.2'?'etsy.steel-visible-account-context.2':'etsy.steel-visible-account-context.1'};
 for(const k of ['expiresAt','accountIdentityVerified','insightsAccessVerified'])delete context[k];
 proof.verifiedContextHash=hash(context);proof.verificationHash=hash(proof);
 const binding={...b,verifiedContextHash:proof.verifiedContextHash,accountVerificationHash:proof.verificationHash};delete binding.bindingHash;binding.bindingHash=hash(binding);return{verification:proof,binding};
}
test('landing .2 requires genuine saved no-query verification and cleanup before actual source submit, while legacy IO stays .1',{skip:!enabled,timeout:240000},async()=>{
 const db=await landingDatabase(),fetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No external transport');};
 try{
  let checkedCleanup=false,checkedProof=false;
  const f=await landingControllerFixture(db,{sourceRendererPolicy:renderer2,verificationPolicy:renderer2,verificationOptions:{beforeRpc:async(operation,payload,ctx)=>{
   if(operation==='cleanup_complete'){
    const p={verification:{operationId:ctx.a.scope.verificationOperationId},binding:{profileBindingId:ctx.saved.bindingId}};
    await assert.rejects(ctx.x.verifier('verify',p),/etsy_handoff_verification_operation_required/,'A paid receipt cannot substitute for physical cleanup acceptance');checkedCleanup=true;
   }
   if(operation!=='verify')return;checkedProof=true;
   for(const changes of [{landingControlsHash:'f'.repeat(64)},{landingControlsVersion:'etsy.insights-landing-controls.1'},{queryControlWitnessHash:'e'.repeat(64)}]){
    await assert.rejects(ctx.x.verifier('verify',rehashProof({...payload.verification,...changes},payload.binding)),/r12_landing_saved_qualification_required/);
   }
   const old={...payload.verification,version:'etsy.steel-account-verification.1'};delete old.landingControlsVersion;delete old.landingControlsHash;
   await assert.rejects(ctx.x.verifier('verify',rehashProof(old,payload.binding)),/r12_landing_proof_downgrade/);
  }}});
  assert.equal(checkedCleanup,true);assert.equal(checkedProof,true);assert.equal(f.verificationResult.status,'verified');
  const id=f.approved.verificationOperation,stored=await one(db,'select verification,binding from private.r12_etsy_steel_verifications where binding_hash=$1',[f.approved.accountBinding.bindingHash]);
  assert.equal(stored.verification.version,'etsy.steel-account-verification.2');assert.equal(stored.verification.queryControlWitnessHash,witnessHash);
  for(const[k,v]of Object.entries(landingPins))assert.equal(stored.verification[k],v);
  const q=await one(db,'select content from private.r12_direct_verification_renderer_qualifications where operation_id=$1',[id]);assert.equal(q.content.version,'r12.etsy-insights-renderer-qualification.2');assert.equal(q.content.qualificationHash,hash(Object.fromEntries(Object.entries(q.content).filter(([k])=>k!=='qualificationHash'))));
  const nav=(await db.query('select content from private.r12_direct_verification_renderer_requests where operation_id=$1',[id])).rows;assert.equal(nav.length,1);assert.equal(nav[0].content.qualificationHash,q.content.qualificationHash);assert.equal(nav[0].content.url,'https://www.etsy.com/your/shops/me/marketplace-insights');
  assert.equal(f.verificationRuntime.browser.events.includes('submit'),false);assert.equal(f.verificationRuntime.browser.events.includes('fill'),false);assert.equal(f.verificationRuntime.browser.browser.isConnected(),false);
  const view=await ownerInitialRpc(db,f.authority.f.ownerId,'r12_owner_etsy_steel_verification_read',[f.authority.f.businessId,f.approved.setupOperation]);assert.equal(view.status,'verified');assert.equal(JSON.stringify(view).includes(f.approved.profileId),false);
  for(const table of ['r12_landing_review_revocations','r12_direct_verification_renderer_revocations'])await rollback(db,async()=>{
   if(table==='r12_landing_review_revocations')await db.query("insert into private.r12_landing_review_revocations select review_hash from private.r12_landing_reviews where purpose='verification' and route_hash=$1",[f.authority.routeHash]);
   else await db.query('insert into private.r12_direct_verification_renderer_revocations values($1,clock_timestamp())',[f.authority.routeHash]);
   const inactive=await ownerInitialRpc(db,f.authority.f.ownerId,'r12_owner_etsy_steel_verification_read',[f.authority.f.businessId,f.approved.setupOperation]);
   assert.equal(inactive.status,'invalidated');assert.equal(inactive.reason,'authority_inactive');for(const k of ['accountBindingHash','observedShopName','verifiedAt','expiresAt'])assert.equal(inactive[k],null);
   const changed=rehashProof({...stored.verification,landingControlsHash:'e'.repeat(64)},stored.binding);
   await assert.rejects(db.query('select private.r12_landing_verification_check($1,$2,false)',[id,changed.verification]),/r12_landing_saved_qualification_required/,'Malformed pins cannot be masked as ordinary revocation');
  });
  const source=await prepareSource(f);let targetChecked=false;
  const runtime=landingSqlSource(f,source,{beforeRpc:async(operation,payload)=>{
   if(operation==='source_admit'&&payload.request.operation==='submit_query'){
    assert.equal(payload.request.targetId,'observed-insights-landing-controls.2');
    await assert.rejects(f.rpc(operation,{request:{...payload.request,targetId:'observed-insights-query-form'}},'source'),/r12_landing_submit_control_required/);await rollback(db,async()=>{await db.query("insert into private.r12_landing_review_revocations select review_hash from private.r12_landing_reviews where purpose='source' and route_hash=$1",[f.authority.routeHash]);await assert.rejects(db.query('select public.r12_direct_controller_server($1,$2,$3,$4,$5)',[f.authority.f.businessId,f.prepared.scopeId,operation,payload,f.keys.source]),/r12_landing_review_inactive/);});targetChecked=true;
   }
  }}),result=await runtime.run();assert.equal(result.run.receipt.status,'completed',JSON.stringify(result));assert.equal(result.accounting,'qualified_bounded_pending');assert.equal(result.completion.accepted,true);assert.equal(targetChecked,true);
  assert.equal(runtime.providerRequests.filter(x=>x.path==='/v1/sessions').length,1);assert.equal(runtime.browser.events.filter(x=>x==='submit').length,1);assert.equal(runtime.browser.browser.isConnected(),false);
  const sq=(await one(db,'select content from private.r12_direct_source_renderer_qualifications where attempt_id=$1',[source.attemptId])).content;assert.equal(sq.version,'r12.etsy-insights-renderer-qualification.2');assert.equal(sq.landingControlsHash,landingPins.landingControlsHash);
  const sourceRequests=(await db.query('select request from private.r12_direct_source_renderer_requests where attempt_id=$1 order by sequence',[source.attemptId])).rows;assert.equal(sourceRequests.length,2);assert.ok(sourceRequests.every(r=>r.request.qualificationHash===sq.qualificationHash));
  const legacy=await landingControllerFixture(db,{landingVerification:false,landingSource:false});legacy.authority.db=db;const oldSource=await prepareSource(legacy),completed=await directControllerSource(legacy,oldSource);assert.equal(completed.done.accepted,true);
  const old=(await one(db,'select content from private.r12_direct_source_renderer_qualifications where attempt_id=$1',[oldSource.attemptId])).content;assert.equal(old.version,'r12.etsy-insights-renderer-qualification.1');assert.equal('landingControlsHash' in old,false);
  const lq=await one(db,'select * from private.r12_direct_source_qualifications where qualification_hash=$1',[legacy.authority.prepared.preview.researchPins.executionReviewHash]);await insertLandingReview(db,{purpose:'source',authorityHash:lq.qualification_hash,routeHash:lq.route_hash,project:lq.provider_project_id,policyHash:hash(lq.content.rendererPolicy),validFrom:new Date(lq.valid_from).toISOString(),validUntil:new Date(lq.valid_until).toISOString()});
  assert.deepEqual(await legacy.rpc('qualify_renderer',{attemptId:oldSource.attemptId},'source'),old,'Already saved .1 replay remains byte-exact');
  assert.equal(network,0);
 }finally{globalThis.fetch=fetch;await db.close();}
});

test('landing reviews fail closed for wrong pins, revoked authority, missing navigation and .1 source bindings before reserve',{skip:!enabled,timeout:240000},async()=>{
 const db=await landingDatabase(),fetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No external transport');};
 try{
  const f=await landingControllerFixture(db,{landingVerification:false}),source=await prepareSource(f),runtime=landingSqlSource(f,source),result=await runtime.run();
  assert.equal(result.run.receipt.status,'paused');assert.equal(runtime.providerRequests.length,0);assert.ok(source.requestId);assert.equal((await one(db,'select count(*)::int n from private.r05_reservations where request_id=$1',[source.requestId])).n,0);
  assert.ok(runtime.calls.some(x=>x.operation==='source_admit'));assert.equal((await one(db,'select count(*)::int n from private.r12_direct_source_cleanup where attempt_id=$1',[source.attemptId])).n,0);
  const base={purpose:'source',routeHash:f.authority.routeHash,project:f.authority.project,policyHash:hash({inert:'policy'}),validFrom:new Date(Date.now()-1000).toISOString(),validUntil:new Date(Date.now()+60000).toISOString()};
  // SQL's private review helper validates every immutable binding, never merely a self hash.
  const project=(await one(db,'select provider_project_id p from private.r12_direct_browser_routes where route_hash=$1',[base.routeHash])).p;base.project=project;
  for(const changes of [{providerProjectId:randomUUID()},{rendererPolicyHash:'f'.repeat(64)},{landingControlsHash:'e'.repeat(64)},{landingControlsVersion:'etsy.insights-landing-controls.1'},{queryControlWitnessHash:'d'.repeat(64)}]){
   await rollback(db,async()=>{const args={...base,authorityHash:hash({id:randomUUID()}),changes};await insertLandingReview(db,args);await assert.rejects(db.query('select private.r12_landing_review($1,$2,$3,$4,$5)',[args.purpose,args.authorityHash,args.routeHash,args.project,args.policyHash]),/r12_landing_review_unqualified/);});
  }
  for(const mode of ['verified_policy1','missing_navigation','revoked_after_create','missing_control']){
   await prepareDirectTestAuthorityFixture(db,{configureReview:async c=>{const extra=await qualifyInertOwnerRenderer(db,c);await insertLandingReview(db,{purpose:'verification',authorityHash:hash({inertVerificationReview:c.routeHash}),routeHash:c.routeHash,project:c.project,policyHash:hash({version:'etsy.insights-renderer-policy.1',staticOrigins:[],maximumRequests:256,navigation:'fixed_insights_get_only',sameOrigin:'renderer_get_only',post:'denied',extraction:'visible_aggregate_dom_only'}),validFrom:c.validFrom,validUntil:c.validUntil});return extra;},onPrepared:a=>runDirectApprovedSetup(db,a,{runVerification:async ctx=>{
    const h=landingSqlVerification(ctx,{emitRenderer:mode!=='missing_navigation',browserOptions:mode==='missing_control'?{missingInput:true}:{},beforeRendererRequest:mode==='revoked_after_create'?async()=>db.query("insert into private.r12_landing_review_revocations select review_hash from private.r12_landing_reviews where purpose='verification' and route_hash=$1",[a.routeHash]):null});
    let out;if(mode==='missing_navigation')await assert.rejects(h.run(),/r12_landing_saved_qualification_required/);else{out=await h.run();assert.equal(out.status,mode==='verified_policy1'?'verified':'paused');if(mode!=='verified_policy1')assert.equal(out.binding,null);assert.equal(out.accountingConfirmed,true);}
    assert.equal(h.providerRequests.filter(x=>x.url==='https://api.steel.dev/v1/sessions').length,1);assert.equal(h.providerRequests.filter(x=>x.url.endsWith('/release')).length,1);assert.equal(h.browser.events.includes('submit'),false);
    assert.equal((await one(db,'select count(*)::int n from private.r12_etsy_steel_verification_release where operation_id=$1',[ctx.a.scope.verificationOperationId])).n,1,'Cleanup remains possible after review revocation');
    assert.equal((await one(db,'select count(*)::int n from private.r12_etsy_steel_verifications where binding_id=$1',[ctx.saved.bindingId])).n,mode==='verified_policy1'?1:0);
    return out;
   }})});
  }
  for(const name of ['r12_landing_reviews','r12_landing_review_revocations']){
   assert.equal((await one(db,"select relrowsecurity enabled from pg_class where oid=('private.'||$1)::regclass",[name])).enabled,true);
   for(const role of ['anon','authenticated','service_role'])assert.equal((await one(db,'select has_table_privilege($1,$2,\'select,insert,update,delete\') allowed',[role,'private.'+name])).allowed,false);
  }
  for(const role of ['anon','authenticated','service_role'])assert.equal((await one(db,"select bool_or(has_function_privilege($1,p.oid,'execute')) allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'r12_landing_%'",[role])).allowed,false);
  assert.equal(network,0);
 }finally{globalThis.fetch=fetch;await db.close();}
});
