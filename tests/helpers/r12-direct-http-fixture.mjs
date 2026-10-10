/** Genuine archived cycles for the separate native HTTP boundary. Provider IO is inert. */
import {randomUUID} from 'node:crypto';
import {r12CatalogFixture} from './r12-provider-fixture.mjs';
import {qualifyEtsyOwnerResearchQuote} from '../../.core-tests/products/discovery-r12-adaptive-quote.js';
import assert from 'node:assert/strict';
import {directModelComplete,directModelExpectation} from './r12-direct-controller-model-fixture.mjs';
import {directControllerSource} from './r12-direct-controller-source-fixture.mjs';
import {r12PhaseOutputFixture} from './r12-phase-output-fixture.mjs';
import * as model from '../../.core-tests/products/discovery-r12-public-model.js';
import {PUBLIC_RESEARCH_DIMENSIONS} from '../../.core-tests/products/discovery-r12-public-quality.js';
import {publicResearchQuestionHash,publicResearchCriteriaHash} from '../../.core-tests/products/discovery-r12-public-contracts.js';

export function directHttpModelOutput(f,attempt){
 const raw=r12PhaseOutputFixture(f.profile.audience),i=attempt.inputs;
 raw.plan.queryFocus=[];raw.plan.proposals=raw.plan.proposals.slice(0,1);
 if(attempt.phase==='plan')return raw.plan;
 raw.strategy.marketComparisons=raw.strategy.marketComparisons.filter(x=>x.countryCode==='GB');raw.strategy.candidates=raw.strategy.candidates.slice(0,1);raw.strategy.recommendation.alternatives=raw.strategy.recommendation.alternatives.slice(0,1);
 if(attempt.phase==='strategy')return{assessment:raw.strategy,measurement:null};
 const ctx=model.readPublicResearchModelInputs(i,directModelExpectation(i)),ref=ctx.evidence.filter(x=>x.kind==='searches').at(-1).ref;
 const quality=Object.fromEntries(PUBLIC_RESEARCH_DIMENSIONS.map(d=>[d,{score:3,anchorId:`${d}.3`,rationale:'Observed display remains descriptive; eligible exposure is still unknown.',evidenceRefs:[ref],contraryRefs:[ref],missingFacts:['Eligible exposure remains unknown.']}]));
 const state=i.state,n=state.windowAttemptsStarted,pivot=state.nmeCountInEpoch===3,query=`astronomy gift HTTP comparison ${n+1}`;
 const command={...f.initial,kind:pivot?'pivot':'targeted',query,namedGap:`Which exact astronomy gift display applies to HTTP comparison ${n+1}?`,questionHash:publicResearchQuestionHash(`Which exact astronomy gift display applies to HTTP comparison ${n+1}?`),criteriaHash:pivot?publicResearchCriteriaHash('search_terms',query):state.epochCriteriaHash,changedCriterion:pivot?{dimension:'search_terms',before:state.attempts.at(-1).command.query,after:query}:null};
 return{version:'r12.direct-etsy-review.1',proposalHash:i.dependencies.strategy.response.result.proposalHash,quality,hypothesisFinding:'undetermined',learningRecommendation:'NME',conclusion:'The witnessed display cannot establish commercial demand or refute the hypothesis.',conclusionEvidenceRefs:[ref],contraryEvidenceRefs:[ref],proposedCommand:command};
}
export async function prepareDirectHttpHistory(f,cycles=8){
 assert.equal(cycles,8,'HTTP qualification pins eight genuine completed predecessors');
 for(let n=1;n<=cycles;n++){
  const refreshed=await f.rpc('observe_quote',{inferenceQuote:qualifyEtsyOwnerResearchQuote(r12CatalogFixture(),Date.now())});
  for(const phase of ['plan','source','strategy','review']){
   const attempt=await f.schedule(phase,{executionQuote:refreshed.quote});assert.equal(attempt.ordinal,n);
   if(phase==='source')await directControllerSource(f,attempt);else await directModelComplete(f,attempt,directHttpModelOutput(f,attempt));
  }
 }
 const state=(await f.read()).state;assert.equal(state.windowAttemptsStarted,8);assert.equal(state.modelDispatchesUsed,24);assert.equal(state.sourceOperationsStarted,8);assert.equal(state.nextAttemptKind,'pivot');return state;
}
export function directHttpSchedulePayload(state){return{phase:'plan',attemptId:randomUUID(),runtimeCapability:'inert-direct-http-capability-'+randomUUID(),expectedStateHash:state.stateHash};}
