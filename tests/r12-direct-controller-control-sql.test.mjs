import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {directControllerDatabase} from './helpers/r12-direct-controller-database.mjs';
import {directControllerFixture} from './helpers/r12-direct-controller-fixture.mjs';
import {directModelComplete} from './helpers/r12-direct-controller-model-fixture.mjs';
import {r12PhaseOutputFixture} from './helpers/r12-phase-output-fixture.mjs';
import {r12CatalogFixture} from './helpers/r12-provider-fixture.mjs';
import {qualifyEtsyOwnerResearchQuote} from '../.core-tests/products/discovery-r12-adaptive-quote.js';
import {qualifyPublicResearchWindowQuote} from '../.core-tests/products/discovery-r12-public-preparation.js';
import {one} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2-hash.js';

test('single durable runtime and authenticated current quote observations preserve original terms and pending exposure',{skip:!process.env.R12_SQL_TEST_HOST&&!process.env.R12_REQUIRE_POSTGRES&&!process.env.R12_POSTGRES_URL,timeout:180000},async()=>{
 const db=await directControllerDatabase();try{
  const f=await directControllerFixture(db,{initialQuoteTtlMs:3000});f.authority.db=db;assert.equal(f.quote.version,'r12.public-research-quote.2');assert.equal(f.quote.modelRequestBytes.plan,32768);assert.equal(f.quote.inference.requestBytes.plan,24576);assert.equal(f.quote.phaseMaximumMicrounits.plan,'43521');
  const baseline=await f.read(),run='wrun-inert-'+randomUUID();assert.equal(baseline.runtime,null);
  const attached=await f.rpc('attach_runtime',{runtimeRunId:run});assert.equal(attached.claimed,true);assert.equal(attached.replayed,false);
  assert.equal((await f.rpc('attach_runtime',{runtimeRunId:run})).replayed,true);
  const other=await f.rpc('attach_runtime',{runtimeRunId:'wrun-inert-'+randomUUID()});assert.equal(other.claimed,false);assert.equal(other.currentRuntimeRunId,run);
  assert.equal((await f.read()).runtime.runtimeRunId,run);assert.equal((await one(db,'select count(*)::int n from private.r12_direct_runtime_attachments')).n,1);
  await assert.rejects(f.rpc('attach_runtime',{runtimeRunId:run},'source'),/scoped_server_required/);
  const ownerContext=await f.authority.server('research_quote_context',{testEnvelopeId:f.authority.prepared.testEnvelopeId,testEnvelopeHash:f.authority.prepared.testEnvelopeHash});
  assert.equal(ownerContext.approvedQuote,null);assert.equal(ownerContext.maximumAttemptsInWindow,10);
  const context=await f.rpc('quote_context');assert.deepEqual(context.approvedQuote,f.quote);assert.equal(context.browserRevalidation.browserProviderFetched,false);
  assert.equal(context.browserRevalidation.browserEvidenceKind,'still_valid_private_route_revalidation');assert.equal(context.browserRevalidation.approvedBrowserVerifiedAt,f.quote.browser.verifiedAt);
  assert.equal(context.browserRevalidation.proofHash,hash(Object.fromEntries(Object.entries(context.browserRevalidation).filter(([k])=>k!=='proofHash'))));
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(f.quote.validUntil)-Date.now()+40)));await assert.rejects(f.schedule('plan'),/fresh_quote_required|quote_unqualified/);
  const inference=qualifyEtsyOwnerResearchQuote(r12CatalogFixture(),Date.now());
  const unobserved=qualifyPublicResearchWindowQuote(inference,context.browserQuote,f.quote.originalRunMaximumMicrounits);
  await assert.rejects(f.schedule('plan',{executionQuote:unobserved}),/current_catalog_evidence_required/);
  const observed=await f.rpc('observe_quote',{inferenceQuote:inference});
  assert.equal(observed.observation.inferenceIndependentlyFetched,true);assert.equal(observed.observation.browserProviderFetched,false);
  assert.equal(observed.observation.approvedBrowserVerifiedAt,f.quote.browser.verifiedAt);assert.equal(observed.routeEvidenceHash,hash(observed.observation));
  assert.deepEqual(observed.quote.phaseMaximumMicrounits,f.quote.phaseMaximumMicrounits);assert.deepEqual(observed.quote.modelRequestBytes,f.quote.modelRequestBytes);
  const originalView=structuredClone(observed.quote);originalView.modelRequestBytes.plan++;delete originalView.quoteHash;originalView.quoteHash=hash(originalView);await assert.rejects(f.schedule('plan',{executionQuote:originalView}),/request_byte_quote_invalid/);
  const a=await f.schedule('plan',{executionQuote:observed.quote});
  assert.equal(a.inputs.approvedQuote.quoteHash,f.quote.quoteHash);assert.equal(a.inputs.executionQuoteProof.executionQuoteHash,observed.quote.quoteHash);
  assert.equal(a.inputs.executionQuoteProof.routeEvidenceHash,observed.routeEvidenceHash);assert.equal(a.inputs.policy.quoteHash,f.quote.quoteHash);
  const output=r12PhaseOutputFixture(f.profile.audience).plan;output.queryFocus=[];await directModelComplete(f,a,output);
  const after=await f.read();assert.equal(after.testExposure.boundedPendingMicrounits,baseline.testExposure.boundedPendingMicrounits);assert.equal(after.state.windowAttemptsStarted,1);
  const route=f.quote.browser.routeHash;await db.query('insert into private.r12_direct_browser_route_revocations(route_hash) values($1)',[route]);
  await assert.rejects(f.rpc('quote_context'),/route_revoked|quote_unqualified|unresolved_liability|authority_inactive/);
  await assert.rejects(f.rpc('observe_quote',{inferenceQuote:inference}),/route_revoked|quote_unqualified|unresolved_liability|authority_inactive/);
 }finally{await db.close();}
});
