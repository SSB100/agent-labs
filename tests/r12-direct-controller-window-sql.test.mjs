import test from 'node:test';import assert from 'node:assert/strict';
import {directControllerDatabase} from './helpers/r12-direct-controller-database.mjs';
import {directControllerFixture} from './helpers/r12-direct-controller-fixture.mjs';
import {directControllerSource} from './helpers/r12-direct-controller-source-fixture.mjs';
import {directModelExpectation,directModelComplete} from './helpers/r12-direct-controller-model-fixture.mjs';
import {r12PhaseOutputFixture} from './helpers/r12-phase-output-fixture.mjs';
import {one} from './helpers/r12-owner-initial-sql-fixture.mjs';
import * as model from '../.core-tests/products/discovery-r12-public-model.js';
import {validatePublicResearchState} from '../.core-tests/products/discovery-r12-public-cycle.js';
import {PUBLIC_RESEARCH_DIMENSIONS} from '../.core-tests/products/discovery-r12-public-quality.js';
import {publicResearchQuestionHash,publicResearchCriteriaHash} from '../.core-tests/products/discovery-r12-public-contracts.js';
function nextCommand(f,state,n){const pivot=state.nmeCountInEpoch===3,query=`astronomy gift comparison ${n+1}`;return {...f.initial,kind:pivot?'pivot':'targeted',query,namedGap:`Which exact astronomy gift display applies to comparison ${n+1}?`,questionHash:publicResearchQuestionHash(`Which exact astronomy gift display applies to comparison ${n+1}?`),criteriaHash:pivot?publicResearchCriteriaHash('search_terms',query):state.epochCriteriaHash,changedCriterion:pivot?{dimension:'search_terms',before:state.attempts.at(-1).command.query,after:query}:null};}
test('ten distinct paid R07 cycles reuse four children, pivot after fourth NME and stop at window without completing Quest',{skip:!process.env.R12_SQL_TEST_HOST&&!process.env.R12_REQUIRE_POSTGRES&&!process.env.R12_POSTGRES_URL,timeout:300000},async()=>{
 const db=await directControllerDatabase();try{const f=await directControllerFixture(db);f.authority.db=db;const counts=await one(db,'select children_created,dispatches from private.r07_heads where goal_id=$1',[f.authority.f.goalId]),grants=await one(db,'select count(*)::int n from private.r12_direct_test_confirmations where grant_id=$1',[f.authority.f.grantId]);
 const output=r12PhaseOutputFixture(f.profile.audience);output.plan.queryFocus=[];output.plan.proposals=output.plan.proposals.slice(0,1);output.strategy.marketComparisons=output.strategy.marketComparisons.filter(x=>x.countryCode==='GB');output.strategy.candidates=output.strategy.candidates.slice(0,1);output.strategy.recommendation.alternatives=output.strategy.recommendation.alternatives.slice(0,1);
 for(let n=1;n<=10;n++){
  const plan=await f.schedule('plan');assert.equal(plan.ordinal,n);await directModelComplete(f,plan,output.plan);
  const source=await f.schedule('source');await directControllerSource(f,source);
  const strategy=await f.schedule('strategy'),s=await directModelComplete(f,strategy,{assessment:output.strategy,measurement:null});
  const review=await f.schedule('review'),ctx=model.readPublicResearchModelInputs(review.inputs,directModelExpectation(review.inputs)),ref=ctx.evidence.filter(x=>x.kind==='searches').at(-1).ref;
  const quality=Object.fromEntries(PUBLIC_RESEARCH_DIMENSIONS.map(d=>[d,{score:3,anchorId:`${d}.3`,rationale:'Observed display remains descriptive; eligible exposure is still unknown.',evidenceRefs:[ref],contraryRefs:[ref],missingFacts:['Eligible exposure remains unknown.']} ]));
  const raw={version:'r12.direct-etsy-review.1',proposalHash:s.expected.proposalHash,quality,hypothesisFinding:'undetermined',learningRecommendation:'NME',conclusion:'The witnessed display cannot establish commercial demand or refute the hypothesis.',conclusionEvidenceRefs:[ref],contraryEvidenceRefs:[ref],proposedCommand:nextCommand(f,review.inputs.state,n)};
  await directModelComplete(f,review,raw);const state=(await f.read()).state;validatePublicResearchState(state,f.policy);assert.equal(state.windowAttemptsStarted,n);assert.equal(state.questComplete,false);assert.equal(state.pivots,Number(f.policy.basePivots)+Math.floor((n-1)/4));if(n%4===0)assert.equal(state.nextAttemptKind,'pivot');console.log(`qualified direct cycle ${n}, dispatches=${state.cumulativeDispatchesUsed}, NME=${state.nmeCountInEpoch}, next=${state.nextAttemptKind}`);
 }
 const done=await f.read();assert.equal(done.testExposure.knownActualMicrounits,'30');assert.equal(done.testExposure.boundedPendingMicrounits,'12000');assert.equal(done.testExposure.committedMicrounits,'12030');assert.equal(done.testExposure.hasUnknownOrUnbounded,false);assert.equal(done.state.requiresReviewedRenewal,true);assert.equal(done.state.researchWindowComplete,true);assert.equal(done.state.terminal,'RESEARCH_INSUFFICIENT_AT_WINDOW_LIMIT');assert.equal(done.state.modelDispatchesUsed,30);assert.equal(done.state.sourceOperationsStarted,10);assert.equal(done.state.questComplete,false);assert.equal(done.state.researchStageOutcome,'RESEARCH_FAILED_QUALITY');
 const wireBounds=(await db.query("select a.phase,max(octet_length(w.binding->>'requestJson')) request_bytes,max(octet_length(w.binding->>'wireBody')) wire_bytes from private.r12_direct_phase_wires w join private.r12_direct_phase_attempts a on a.attempt_id=w.attempt_id group by a.phase order by a.phase")).rows;
 console.log('direct ten-cycle final accounting '+JSON.stringify({wireBounds,quote:f.quote.phaseMaximumMicrounits,maximumWindowMicrounits:f.quote.maximumWindowMicrounits,exposure:done.testExposure,cumulativeDispatches:done.state.cumulativeDispatchesUsed}));
 assert.deepEqual(await one(db,'select children_created,dispatches from private.r07_heads where goal_id=$1',[f.authority.f.goalId]),{children_created:counts.children_created,dispatches:counts.dispatches+40});
 assert.deepEqual(await one(db,'select count(*)::int n from private.r12_direct_test_confirmations where grant_id=$1',[f.authority.f.grantId]),grants);
 assert.equal((await one(db,'select count(*)::int n from private.r12_direct_research_cycles')).n,10);assert.equal((await one(db,'select count(*)::int n from private.r12_direct_source_pngs')).n,10);assert.equal((await one(db,'select count(*)::int n from private.r12_direct_model_candidates')).n,30);await assert.rejects(f.schedule('plan'),/phase_not_admitted/);
 }finally{await db.close();}
});
