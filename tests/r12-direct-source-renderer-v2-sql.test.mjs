/** Actual owner/controller/source receipt path; all provider callbacks are inert. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {directControllerDatabase} from './helpers/r12-direct-controller-database.mjs';
import {directControllerFixture} from './helpers/r12-direct-controller-fixture.mjs';
import {directModelComplete} from './helpers/r12-direct-controller-model-fixture.mjs';
import {directControllerSource} from './helpers/r12-direct-controller-source-fixture.mjs';
import {r12PhaseOutputFixture} from './helpers/r12-phase-output-fixture.mjs';
import {one} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2-hash.js';
import {ETSY_RENDERER_DOM_REFERENCE_MANIFEST as manifest,ETSY_RENDERER_DOM_REFERENCE_HASH as provenanceHash} from '../.core-tests/browser/etsy-insights-renderer-evidence.js';
test('reviewed source renderer .2 records denied telemetry without transport permission or borrowed bootstrap authority',{
 skip:!process.env.R12_SQL_TEST_HOST&&!process.env.R12_REQUIRE_POSTGRES&&!process.env.R12_POSTGRES_URL,timeout:180000,
},async()=>{
 const db=await directControllerDatabase(),fetchBefore=globalThis.fetch;let network=0;
 globalThis.fetch=async()=>{network++;throw Error('External transport forbidden');};
 try{
  await db.exec(readFileSync('supabase/migrations/20261010120610_r12_direct_source_renderer_v2.sql','utf8'));
  const policy={version:'etsy.insights-renderer-policy.2',staticOrigins:[],maximumRequests:256,navigation:'fixed_insights_get_only',sameOrigin:'renderer_get_only',post:'denied',extraction:'visible_aggregate_dom_only',staticAssets:[manifest.images[0]],optionalTelemetry:[manifest.optionalTelemetry[0]],provenanceHash};
  const classify=async(request,p=policy)=>(await one(db,'select private.r12_direct_source_renderer_classify($1,$2,$3) disposition',[p,request,'astronomy gifts'])).disposition;
  const root='https://www.etsy.com/your/shops/me/marketplace-insights',navigation={url:root,method:'GET',resourceType:'document',navigation:true};
  assert.equal(await classify(navigation),'allow');
  assert.equal(await classify({...navigation,url:root+'/search?query=astronomy+gifts&search_trigger=landing_search_bar'}),'allow');
  for(const request of [{...navigation,url:'https://www.etsy.com/'},{...navigation,url:root+'/search?query=wrong'},{...navigation,url:root+'/search?query=astronomy+gifts&query=astronomy+gifts'},{...navigation,url:root+'/search?query=astronomy+gifts&search_trigger=unapproved'},{url:'https://www.etsy.com/%256cogin',method:'GET',resourceType:'fetch',navigation:false},{method:'GET',resourceType:'image',navigation:false},{...navigation,method:'POST'}])await assert.rejects(classify(request),/renderer_/);
  await assert.rejects(classify(navigation,{version:'etsy.owner-bootstrap-policy.1',documentUrl:'https://www.etsy.com/',documentMethod:'GET',maximumRequests:256,subresources:'deny_without_evidence',redirects:'fatal',auth:'fatal',childTargets:'fatal'}),/v2_policy_required/);
  const f=await directControllerFixture(db,{sourceRendererPolicy:policy});f.authority.db=db;
  const planner=await f.schedule('plan'),output=r12PhaseOutputFixture(f.profile.audience).plan;output.queryFocus=[];
  await directModelComplete(f,planner,output);
  const source=await f.schedule('source');let qualification,last;
  const port={...f,rpc:async(operation,payload,purpose)=>{
   if(operation==='qualify_renderer'){
    qualification=await f.rpc(operation,payload,purpose);assert.deepEqual(qualification.policy,policy);return qualification;
   }
   if(operation==='cleanup_complete'){
    assert.equal((await one(db,'select count(*)::int n from private.r12_direct_source_cleanup_proofs where attempt_id=$1',[source.attemptId])).n,0);
    await assert.rejects(f.rpc('admit_renderer',{attemptId:source.attemptId,request:{...last,sequence:4}},'source'),/admission_denied/,'Saved release evidence alone closes renderer admission before cleanup acknowledgement');
    return f.rpc(operation,payload,purpose);
   }
   if(operation!=='admit_renderer')return f.rpc(operation,payload,purpose);
   await assert.rejects(f.rpc(operation,payload,purpose),/version_mismatch/,'A .1 request cannot borrow .2 source qualification');
   const request={...payload.request,version:'r12.etsy-insights-renderer-request.2',policyHash:hash(policy),provenanceHash,disposition:'allow'};
   assert.deepEqual(await f.rpc(operation,{...payload,request},purpose),{accepted:true,allowed:true,sequence:1,disposition:'allow'});
   await assert.rejects(f.rpc(operation,{...payload,request},purpose),/admission_denied/);
   const telemetry=policy.optionalTelemetry[0],denial={...request,sequence:2,url:telemetry.origin+telemetry.path,resourceType:telemetry.resourceType,navigation:false,disposition:'deny_optional_telemetry'};
   for(const change of [{disposition:'allow'},{policyHash:'f'.repeat(64)},{provenanceHash:'e'.repeat(64)},{url:denial.url+'?private=value'},{method:'POST'},{resourceType:'xhr'},{sequence:3},{sequence:null},{sourceAttemptId:planner.attemptId},{url:'https://unknown.example/pixel'},{version:'etsy.owner-bootstrap-request.1'}])await assert.rejects(f.rpc(operation,{...payload,request:{...denial,...change}},purpose));
   const result=await f.rpc(operation,{...payload,request:denial},purpose);
   assert.deepEqual(result,{accepted:true,allowed:false,sequence:2,disposition:'deny_optional_telemetry'});
   const asset=policy.staticAssets[0];last={...request,sequence:3,url:asset.origin+asset.path,resourceType:asset.resourceType,navigation:false};
   assert.deepEqual(await f.rpc(operation,{...payload,request:last},purpose),{accepted:true,allowed:true,sequence:3,disposition:'allow'});
   // Exercise a genuine admitted paused terminal receipt in an isolated
   // rollback branch before any cleanup proof or release evidence exists.
   const ss=source.inputs,pins=Object.fromEntries(['operationId','sourceAttemptId','businessId','goalId','authorityRootId','scopeId','scopeHash','providerProjectId','originDirectRunId','windowAttemptOrdinal','attemptOrdinal','criteriaHash','questionHash','quoteHash','executionQuoteHash','executionQuoteProofHash','sourcePolicyHash','capturePolicyHash','maximumBrowserMicrounits'].map(k=>[k,ss[k]]));
   const reservation=await one(db,'select request_id,reservation_hash from private.r12_direct_browser_operations where id=$1',[ss.operationId]);
   const body={version:'r12.etsy-insights-source-receipt.1',...pins,requestHash:hash(ss),windowId:ss.window.windowId,windowOrdinal:ss.window.windowOrdinal,maximumAttemptsInWindow:ss.window.maximumAttemptsInWindow,baseAttemptsStarted:ss.window.baseAttemptsStarted,accountBindingHash:ss.accountBinding.bindingHash,accountVerificationHash:ss.accountBinding.accountVerificationHash,status:'paused',reason:'inert_terminal_boundary',capturedAt:new Date().toISOString(),captureHash:hash([]),captures:[],witnesses:[],screenshotStorage:null,releaseState:'unconfirmed',liabilityState:'unknown',reservationId:reservation.request_id,reservationHash:reservation.reservation_hash,sessionId:ss.operationId,actionsUsed:1};
   await db.exec('begin');
   try{
    await f.rpc('source_receipt',{attemptId:source.attemptId,receipt:{...body,receiptHash:hash(body)}},'source');
    assert.equal((await one(db,'select count(*)::int n from private.r12_direct_source_cleanup_proofs where attempt_id=$1',[source.attemptId])).n,0);
    await assert.rejects(db.query('select public.r12_direct_controller_server($1,$2,$3,$4,$5)',[f.authority.f.businessId,f.prepared.scopeId,'admit_renderer',{attemptId:source.attemptId,request:{...last,sequence:4}},f.keys.source]),/admission_denied/,'Saved terminal receipt closes renderer admission before cleanup acknowledgement');
   }finally{await db.exec('rollback');}
   return {accepted:true,allowed:true,sequence:1,disposition:'allow'};
  }};
  const completed=await directControllerSource(port,source);assert.equal(completed.done.accepted,true);
  const rows=(await db.query('select sequence,request as content from private.r12_direct_source_renderer_requests where attempt_id=$1 order by sequence',[source.attemptId])).rows;
  assert.equal(rows.length,3);assert.equal(rows[1].content.disposition,'deny_optional_telemetry');assert.equal(rows[1].content.url,policy.optionalTelemetry[0].origin+policy.optionalTelemetry[0].path);
  assert.equal((await one(db,'select count(*)::int n from private.r12_direct_source_transport_claims where attempt_id=$1',[source.attemptId])).n,1);
  await assert.rejects(f.rpc('admit_renderer',{attemptId:source.attemptId,request:{...last,sequence:4}},'source'),/admission_denied/,'No renderer admission after saved physical release');
  assert.deepEqual((await one(db,"select has_function_privilege('anon','private.r12_direct_source_renderer_admit_v2(uuid,jsonb)','execute') anon,has_function_privilege('authenticated','private.r12_direct_source_renderer_admit_v2(uuid,jsonb)','execute') owner")),{anon:false,owner:false});
  assert.equal(network,0);
 }finally{globalThis.fetch=fetchBefore;await db.close();}
});

test('source renderer .1 retains its exact success response while terminal release also fences late callbacks',{
 skip:!process.env.R12_SQL_TEST_HOST&&!process.env.R12_REQUIRE_POSTGRES&&!process.env.R12_POSTGRES_URL,timeout:180000,
},async()=>{
 const db=await directControllerDatabase(),fetchBefore=globalThis.fetch;let network=0;
 globalThis.fetch=async()=>{network++;throw Error('External transport forbidden');};
 try{
  await db.exec(readFileSync('supabase/migrations/20261010120610_r12_direct_source_renderer_v2.sql','utf8'));
  const f=await directControllerFixture(db);f.authority.db=db;
  const planner=await f.schedule('plan'),output=r12PhaseOutputFixture(f.profile.audience).plan;output.queryFocus=[];await directModelComplete(f,planner,output);
  const source=await f.schedule('source');let request;
  const port={...f,rpc:async(operation,payload,purpose)=>{
   if(operation==='admit_renderer'){
    request=payload.request;const response=await f.rpc(operation,payload,purpose);assert.deepEqual(response,{allowed:true,sequence:1});return response;
   }
   if(operation==='cleanup_complete'){
    assert.equal((await one(db,'select count(*)::int n from private.r12_direct_source_cleanup_proofs where attempt_id=$1',[source.attemptId])).n,0);
    await assert.rejects(f.rpc('admit_renderer',{attemptId:source.attemptId,request:{...request,sequence:2}},'source'),/admission_denied/);
   }
   return f.rpc(operation,payload,purpose);
  }};
  assert.equal((await directControllerSource(port,source)).done.accepted,true);
  assert.equal((await one(db,'select count(*)::int n from private.r12_direct_source_renderer_requests where attempt_id=$1',[source.attemptId])).n,1);
  assert.equal(network,0);
 }finally{globalThis.fetch=fetchBefore;await db.close();}
});
