/** Explicit quote.3 also preserves the separately versioned original cycle policy. */
import test from 'node:test';import assert from 'node:assert/strict';
import {directSonnetDatabase} from './helpers/r12-direct-sonnet-database.mjs';
import {directSonnetFixture} from './helpers/r12-direct-sonnet-fixture.mjs';
import {directSonnetModelComplete as complete} from './helpers/r12-direct-sonnet-model-fixture.mjs';
import {directRepairReview} from './helpers/r12-direct-controller-repair-review-fixture.mjs';
import {directSonnetSource} from './helpers/r12-direct-sonnet-source-fixture.mjs';
import {r12PhaseOutputFixture} from './helpers/r12-phase-output-fixture.mjs';
import {validatePublicResearchState} from '../.core-tests/products/discovery-r12-public-cycle.js';
test('fresh standard-cycle envelope qualifies the actual Sonnet reviewer without changing its cycle policy',{skip:!process.env.R12_SQL_TEST_HOST&&!process.env.R12_REQUIRE_POSTGRES&&!process.env.R12_POSTGRES_URL,timeout:180000},async()=>{const db=await directSonnetDatabase();try{
 const f=await directSonnetFixture(db,{policyVersion:1});f.authority.db=db;assert.equal(f.policy.version,'r12.direct-etsy-attempt-policy.1');assert.equal(f.quote.version,'r12.public-research-quote.3');
 const output=r12PhaseOutputFixture(f.profile.audience);output.plan.queryFocus=[];output.strategy.marketComparisons=output.strategy.marketComparisons.filter(x=>x.countryCode==='GB');
 await complete(f,await f.schedule('plan'),output.plan);await directSonnetSource(f);
 const strategy=await complete(f,await f.schedule('strategy'),{assessment:output.strategy,measurement:null}),review=await f.schedule('review');
 const completed=await complete(f,review,directRepairReview(f,review,strategy.expected.proposalHash));assert.equal(completed.candidate.providerModelId,'anthropic/claude-sonnet-4.6');assert.equal(completed.proof.requestedEndpoint,'amazon-bedrock/us');
 const state=(await f.read()).state;validatePublicResearchState(state,f.policy);assert.equal(state.windowAttemptsStarted,1);assert.equal(state.modelDispatchesUsed,3);assert.equal(state.sourceOperationsStarted,1);assert.equal(state.questComplete,false);
 }finally{await db.close();}});
