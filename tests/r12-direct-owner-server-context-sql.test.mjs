import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {directControllerDatabase} from './helpers/r12-direct-controller-database.mjs';
import {directControllerFixture} from './helpers/r12-direct-controller-fixture.mjs';
import {directModelDispatch} from './helpers/r12-direct-controller-model-fixture.mjs';
import {one,ownerInitialRpc} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {validatePublicResearchBrowserQuote} from '../.core-tests/products/discovery-r12-public-preparation.js';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2-hash.js';
test('owner server derives initial tariff quotes and exact private verified source context without creating authority',{
 skip:!process.env.R12_SQL_TEST_HOST&&!process.env.R12_REQUIRE_POSTGRES&&!process.env.R12_POSTGRES_URL,timeout:180000,
},async()=>{
 const db=await directControllerDatabase(),originalFetch=globalThis.fetch;let network=0;
 globalThis.fetch=async()=>{network++;throw Error('No external transport permitted');};
 try{
  for(const name of ['20261010120610_r12_direct_source_renderer_v2.sql','20261010120620_r12_direct_owner_server_context.sql'])await db.exec(readFileSync('supabase/migrations/'+name,'utf8'));
  const counts=()=>one(db,`select (select count(*)::int from private.r12_direct_test_envelopes) envelopes,
   (select count(*)::int from private.r12_direct_test_confirmations) confirmations,(select count(*)::int from private.r05_reservations) reservations,
   (select count(*)::int from private.r12_owner_bootstrap_grants) grants,(select count(*)::int from private.r12_direct_browser_accounting) accounting`);
  const f=await directControllerFixture(db,{onPrepared:async a=>{
   const before=await counts(),context=await a.server('initial_quote_context',{grantId:a.f.grantId});
   assert.equal(context.version,'r12.direct-initial-quote-context.1');assert.equal(context.businessId,a.f.businessId);assert.equal(context.goalId,a.f.goalId);
   assert.equal(context.grantId,a.f.grantId);assert.equal(context.grantReviewHash,a.prepared.preview.grantReviewHash);
   const body={...context};delete body.contextHash;assert.equal(context.contextHash,hash(body));
   for(const [name,operation] of [['setupQuote','setupOperation'],['verificationQuote','verificationOperation']]){
    validatePublicResearchBrowserQuote(context[name]);assert.equal(context[name].maximumMicrounits,a.prepared.preview[operation].maximumMicrounits);
    assert.equal(context[name].routeHash,a.routeHash);assert.equal(context[name].providerProjectId,a.project);
    assert.ok(Date.parse(context[name].validUntil)<=Date.parse(context.routeAuthority.routeQualifiedUntil));
   }
   assert.equal(context.routeAuthority.reason,'still_valid_private_route_revalidation');assert.equal(context.routeAuthority.maximumSessionMs,60000);
   assert.equal(context.routeAuthority.revalidatedAt,context.setupQuote.verifiedAt);
   const route=await one(db,'select content_hash,valid_from,valid_until from private.r12_direct_browser_routes where route_hash=$1',[a.routeHash]);
   assert.equal(context.routeAuthority.routeEvidenceHash,route.content_hash);
   assert.equal(Date.parse(context.routeAuthority.routeQualifiedFrom),new Date(route.valid_from).getTime());
   assert.equal(Date.parse(context.routeAuthority.routeQualifiedUntil),new Date(route.valid_until).getTime());
   assert.deepEqual(await counts(),before);
   await assert.rejects(a.server('initial_quote_context',{grantId:a.f.grantId},'wrong'),/reviewed_grant_required/);
   await assert.rejects(a.server('initial_quote_context',{grantId:randomUUID()}),/reviewed_grant_required/);
   await assert.rejects(ownerInitialRpc(db,randomUUID(),'r12_owner_direct_server',[a.f.businessId,'initial_quote_context',{grantId:a.f.grantId},a.f.bootstrapKey]),/owner_required/);
   await assert.rejects(a.server('research_source_context',{testEnvelopeId:a.prepared.testEnvelopeId,testEnvelopeHash:a.prepared.testEnvelopeHash}),/confirmed_test_required/);
   const draft=await a.server('prepare_test',{input:{...a.input,submissionId:randomUUID()},setupQuote:context.setupQuote,verificationQuote:context.verificationQuote});
   assert.deepEqual(draft.preview.setupQuote,context.setupQuote);assert.deepEqual(draft.preview.verificationQuote,context.verificationQuote);
   return a;
  }});f.authority.db=db;
  const payload={testEnvelopeId:f.authority.prepared.testEnvelopeId,testEnvelopeHash:f.authority.prepared.testEnvelopeHash},before=await counts();
  const context=await f.authority.server('research_source_context',payload),body={...context};delete body.contextHash;
  assert.equal(context.version,'r12.direct-research-source-context.1');assert.equal(context.contextHash,hash(body));
  assert.equal(context.businessId,f.authority.f.businessId);assert.equal(context.goalId,f.authority.f.goalId);
  assert.deepEqual(context.sourceAccess,f.prepared.preview.scope.sourceAccess);
  assert.deepEqual(context.sourceAccess.accountBinding,f.approved.accountBinding);
  assert.equal(JSON.stringify(context).includes(f.approved.profileId),false);
  assert.equal(Object.hasOwn(context,'profileId'),false);assert.equal(Object.hasOwn(context,'sessionId'),false);
  assert.deepEqual(await counts(),before);
  await assert.rejects(f.authority.server('research_source_context',payload,'wrong'),/reviewed_grant_required/);
  await assert.rejects(f.authority.server('research_source_context',{...payload,testEnvelopeHash:'f'.repeat(64)}),/confirmed_test_required/);
  await db.exec('begin');
  try{
   await db.query('insert into private.r12_direct_browser_route_revocations(route_hash) values($1)',[f.authority.routeHash]);
   await assert.rejects(db.query('select public.r12_owner_direct_server($1,$2,$3,$4)',[f.authority.f.businessId,'initial_quote_context',{grantId:f.authority.f.grantId},f.authority.f.bootstrapKey]),/browser_quote_unqualified/);
  }finally{await db.exec('rollback');}
  const attempt=await f.schedule('plan');await directModelDispatch(f,attempt);
  await assert.rejects(f.authority.server('research_source_context',payload),/unresolved_liability/,'Unknown model charge never becomes usable source context');
  await f.authority.server('stop_test',{...payload,submissionId:randomUUID()});
  await assert.rejects(f.authority.server('research_source_context',payload),/current_test_required/);
  assert.deepEqual(await one(db,"select has_function_privilege('authenticated','private.r12_direct_initial_quote_context(uuid,jsonb,text)','execute') quote,has_function_privilege('anon','public.r12_owner_direct_server(uuid,text,jsonb,text)','execute') anonymous,has_function_privilege('authenticated','private.r12_direct_owner_source_context(uuid,jsonb,text)','execute') source"),{quote:false,anonymous:false,source:false});
  assert.equal(network,0);
 }finally{globalThis.fetch=originalFetch;await db.close();}
});
