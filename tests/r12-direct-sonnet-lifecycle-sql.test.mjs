/** Genuine R07/R05/controller rows and model serializer, with inert provider leaves. */
import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {directSonnetDatabase} from './helpers/r12-direct-sonnet-database.mjs';
import {directSonnetFixture} from './helpers/r12-direct-sonnet-fixture.mjs';
import {directSonnetModelComplete as complete,directSonnetModelDispatch as dispatch,directSonnetReceipt as receipt} from './helpers/r12-direct-sonnet-model-fixture.mjs';
import {directRepairReview} from './helpers/r12-direct-controller-repair-review-fixture.mjs';
import {directSonnetSource} from './helpers/r12-direct-sonnet-source-fixture.mjs';
import {r12PhaseOutputFixture} from './helpers/r12-phase-output-fixture.mjs';
import {one} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {r12CatalogFixture} from './helpers/r12-provider-fixture.mjs';
import {qualifyEtsyOwnerResearchQuote} from '../.core-tests/products/discovery-r12-adaptive-quote.js';
import {qualifyPublicResearchWindowQuote} from '../.core-tests/products/discovery-r12-public-preparation.js';
import {directSonnetCatalogFixture} from './helpers/r12-direct-sonnet-catalog-fixture.mjs';
import {qualifyDirectSonnetInferenceQuote} from '../.core-tests/products/discovery-r12-public-reviewer-quote.js';
import {validatePublicResearchRepairState} from '../.core-tests/products/discovery-r12-public-repair.js';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2-hash.js';
const options={skip:!process.env.R12_SQL_TEST_HOST&&!process.env.R12_REQUIRE_POSTGRES&&!process.env.R12_POSTGRES_URL,timeout:180000};
test('new envelope binds Sonnet reviewer; real settled reviewer failure and replacement retain source, units and all costs',options,async()=>{const db=await directSonnetDatabase();try{
 const f=await directSonnetFixture(db,{beforePrepare:async({authority,context,payload})=>{const old=qualifyPublicResearchWindowQuote(qualifyEtsyOwnerResearchQuote(r12CatalogFixture()),context.browserQuote,'10000000');await assert.rejects(authority.server('prepare_research_v2',{...payload,quote:old,submissionId:randomUUID()}),/enrolled_sonnet_quote_required/);}});f.authority.db=db;assert.equal(f.quote.version,'r12.public-research-quote.3');assert.equal(f.quote.inference.reviewer.modelId,'anthropic/claude-sonnet-4.6');
 const output=r12PhaseOutputFixture(f.profile.audience);output.plan.queryFocus=[];output.strategy.marketComparisons=output.strategy.marketComparisons.filter(x=>x.countryCode==='GB');
 await complete(f,await f.schedule('plan'),output.plan);const captured=await directSonnetSource(f),originalSource=captured.sourceProof;
 const strategy=await complete(f,await f.schedule('strategy'),{assessment:output.strategy,measurement:null});
 const reviewer=await f.schedule('review'),d=await dispatch(f,reviewer),r=receipt(f,reviewer,d);assert.equal(r.candidate.providerModelId,'anthropic/claude-sonnet-4.6');r.candidate.providerModelId='anthropic/claude-4.6-sonnet-20260217';const{proofHash:originalProofHash,...canonicalProof}={...r.proof,modelId:r.candidate.providerModelId};void originalProofHash;r.proof={...canonicalProof,proofHash:hash(canonicalProof)};
 const marker=await one(db,'select to_jsonb(m) marker from private.r05_markers m where request_id=$1',[reviewer.requestId]);
 await assert.rejects(f.rpc('candidate',{attemptId:reviewer.attemptId,candidate:{...r.candidate,providerModelId:'anthropic/claude-haiku-4.5'}}),/candidate_binding/);
 for(const change of [{modelId:'anthropic/claude-haiku-4.5'},{requestedEndpoint:'amazon-bedrock'},{providerName:'Anthropic'},{providerResponses:[{providerName:'Amazon Bedrock',modelId:'anthropic/claude-haiku-4.5',status:200}]}]){
  const{proofHash,...body}={...r.proof,...change};void proofHash;await assert.rejects(f.rpc('model_receipt',{attemptId:reviewer.attemptId,candidate:r.candidate,proof:{...body,proofHash:hash(body)}}),/proof_invalid/);
 }
 assert.equal((await one(db,'select count(*)::int n from private.r05_settlements where request_id=$1',[reviewer.requestId])).n,0);assert.deepEqual(await one(db,'select to_jsonb(m) marker from private.r05_markers m where request_id=$1',[reviewer.requestId]),marker);
 const failed=await f.rpc('model_receipt',{attemptId:reviewer.attemptId,...r});assert.equal(failed.accepted,false);assert.equal(failed.diagnostic,'r12_direct_response_schema');assert.equal(failed.state.nextAction,'repair_model');
 const refreshed=qualifyDirectSonnetInferenceQuote(directSonnetCatalogFixture(Date.now()));const observation=await f.rpc('observe_quote',{inferenceQuote:refreshed});assert.equal(observation.quote.version,'r12.public-research-quote.3');assert.equal(observation.observation.browserEvidenceKind,'still_valid_private_route_revalidation');assert.equal(observation.observation.browserProviderFetched,false);
 const replacement=await f.schedule('review',{executionQuote:observation.quote});assert.equal(replacement.countedUnitOrdinal,2);assert.equal(replacement.repairOrdinal,1);assert.deepEqual(replacement.inputs.state.logicalCycles[0].sourceProof,originalSource);
 const normalRpc=f.rpc;let stopped=false;f.rpc=async(operation,payload,...rest)=>{
  if(operation==='model_receipt'&&payload.attemptId===replacement.attemptId&&!stopped){stopped=true;await f.authority.server('stop_test',{testEnvelopeId:f.authority.prepared.testEnvelopeId,testEnvelopeHash:f.authority.prepared.testEnvelopeHash,submissionId:randomUUID()},'');}
  return normalRpc(operation,payload,...rest);
 };
 const final=await complete(f,replacement,directRepairReview(f,replacement,strategy.expected.proposalHash));assert.equal(stopped,true);assert.equal((await one(db,'select state from private.r07_heads where goal_id=$1',[f.authority.f.goalId])).state,'stopped');await assert.rejects(f.schedule('plan'),/stopped|revoked|inactive|current_test_required/);validatePublicResearchRepairState(final.done.state,f.policy);assert.equal(final.done.state.unitsConsumed,2);assert.equal(final.done.state.modelDispatchesUsed,4);assert.equal(final.done.state.sourceOperationsStarted,1);assert.equal(final.done.state.nextAction,'next_cycle');assert.deepEqual(final.done.state.logicalCycles[0].sourceProof,originalSource);
 const exposed=(await f.read()).testExposure;assert.equal(exposed.knownActualMicrounits,'4');assert.equal(exposed.boundedPendingMicrounits,'3000');assert.equal(exposed.hasUnknownOrUnbounded,false);assert.equal((await one(db,'select count(*)::int n from private.r12_direct_source_pngs')).n,1);
 const body=(await one(db,'select binding from private.r12_direct_phase_wires where attempt_id=$1',[replacement.attemptId])).binding;assert.equal(JSON.parse(body.wireBody).model,'anthropic/claude-sonnet-4.6');assert.deepEqual(JSON.parse(body.wireBody).provider.only,['amazon-bedrock/us']);assert.equal(JSON.parse(body.wireBody).provider.zdr,true);
 const saved=await one(db,'select to_jsonb(r) value from private.r12_direct_phase_receipts r where attempt_id=$1',[reviewer.attemptId]);await f.rpc('model_receipt',{attemptId:reviewer.attemptId,...r});assert.deepEqual(await one(db,'select to_jsonb(r) value from private.r12_direct_phase_receipts r where attempt_id=$1',[reviewer.attemptId]),saved);
 console.log('Direct Sonnet inert qualification',JSON.stringify({quoteVersion:f.quote.version,model:f.quote.inference.reviewer.modelId,phaseMaxima:f.quote.phaseMaximumMicrounits,units:final.done.state.unitsConsumed,browserCalls:final.done.state.sourceOperationsStarted,modelCalls:final.done.state.modelDispatchesUsed,knownActualMicrounits:exposed.knownActualMicrounits,boundedPendingMicrounits:exposed.boundedPendingMicrounits,externalProviderCalls:0}));
 }finally{await db.close();}});
