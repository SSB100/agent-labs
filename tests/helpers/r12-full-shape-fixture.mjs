/** Public, invented data only. No saved operator scope or wire is loaded here. */
import {createHash} from 'node:crypto';
import {focusedProfileFixture,focusedStrategyOutput} from './r12-focused-profile-fixture.mjs';
import {r12PhaseOutputFixture} from './r12-phase-output-fixture.mjs';
const digest=text=>createHash('sha256').update(text).digest('hex');
export function fullShapePhaseOutputFixture(audience){
 const output=r12PhaseOutputFixture(audience);
 const third='A synthetic public apparel report explains that original nature designs remain untested hypotheses. No purchases, conversion, representative country ranking or profitability has been measured.';
 output.search1.annotations.push({type:'url_citation',url_citation:{url:'https://adult-design.example/report-3',title:'Explicitly synthetic third public-source fixture',content:third}});
 output.select1.selections.push({sourceKey:'S3',quote:third.slice(0,120)});
 for(const [index,annotation] of output.search1.annotations.entries()){
  annotation.url_citation.content+=' '+Array.from({length:6},(_,n)=>`Synthetic context paragraph ${index+1}.${n+1} describes the published scope and unresolved sampling limits. It establishes neither measured sales nor a country-specific advantage for an original design.`).join(' ');
 }
 // Full structure: three candidates, all 27 classified questions, three public
 // sources, and nine independent review uncertainties. Every value is invented.
 for(const [i,candidate] of output.strategy.candidates.entries())for(const dimension of candidate.dimensions){
  const adjacent={demand:'E1',creative_opportunity:'E2',marketing_potential:'E3'}[dimension.dimension];
  if(adjacent){dimension.evidenceStrength='adjacent';dimension.facts=[{evidence:adjacent,relevance:'The synthetic published context is adjacent to this candidate question only; it measures no candidate-specific demand, sales, conversion or profitability.'}];}
  const uncertainty=dimension.uncertainties[0];
  uncertainty.question=`What direct ${dimension.dimension} evidence supports synthetic concept ${i+1} before a private test?`;
  uncertainty.reason='The synthetic context does not resolve this candidate-specific question; retain the gap before creative spending.';
 }
 output.review.additionalUncertainties=output.strategy.candidates[0].dimensions.map(d=>({dimension:d.dimension,question:d.uncertainties[0].question,blockingForTest:true,reason:'Independent review preserves this unresolved question; synthetic public context grants no creative or commerce permission.'}));
 const prose=(text,limit)=>(text+' This explicitly synthetic independent assessment preserves the unresolved commercial questions and grants no creative execution, publication, commerce or spending permission.'.repeat(8)).slice(0,limit).trimEnd();
 output.review.sufficiencyRationale=prose(output.review.sufficiencyRationale,699);
 output.review.checks.forEach(check=>{check.rationale=prose(check.rationale,239);});
 output.review.additionalUncertainties.forEach(uncertainty=>{uncertainty.reason=prose(uncertainty.reason,199);});
 return output;
}
export function fullShapeProfileFixture(){
 const p=focusedProfileFixture(),original=p.observations.observations;
 p.observations.observations=Array.from({length:5},(_,index)=>{
  const source=structuredClone(original[index===4?1:0]);
  const kind=index===4?'official_operating_fact':'retail_offer';
  source.id=`evi-${String(index+1).repeat(24)}`;source.sourceId=`src-${String(index+1).repeat(24)}`;
  source.url=index===4?'https://help.printful.com/hc/en-us/articles/synthetic-print-guide':`https://rapanuiclothing.com/products/synthetic-nature-shirt-${index+1}`;
  source.title=`Explicitly synthetic public ${kind} observation ${index+1}`;
  source.context=`Synthetic observation ${index+1}. ${source.context} This invented public-source context records only the bounded offer or file requirement. It contains no measured purchases, representative demand, fee estimate, seller location, customer data, or permission to generate, publish or sell a product.`;
  source.contentHash=digest(source.context);source.captureHash=digest(`synthetic full-shape capture ${index+1}`);source.sourceReviewHash=digest(`synthetic public review ${index+1}`);
  source.end=Math.min(300,source.context.length);
  source.limitations=['Synthetic qualification data only; this source is never fetched and establishes no live fact or permission.', 'An offer or operating guideline does not establish demand, conversion, profitability, ownership, rights clearance or physical print quality.'];
  return source;
 });
 p.pinnedLearningPlan.successCriteria=[
  'All intended original elements remain distinguishable at each fixed preview size, with no clipping, missing marks or unintended text.',
  'The inspection records the exact preview dimensions and observed visual hierarchy without treating an aesthetic result as evidence of demand.',
  'The original composition remains independent from third-party artwork, brand identifiers and protected characters throughout the private check.'
 ];
 p.pinnedLearningPlan.failureCriteria=[
  'Any missing element, clipping, unintended text or unreadable intended detail fails the private composition test.',
  'Stop if the fixed inspection cannot establish the proposed visual hierarchy or if any copied or protected element appears.'
 ];
 return p;
}

export function fullShapeFocusedStrategyOutput(prepared){
 const output=focusedStrategyOutput(prepared),retail=prepared.evidencePool.filter(e=>e.sourceContext.kind==='retail_offer');
 const competition=output.candidates[0].dimensions.find(d=>d.dimension==='competition');
 competition.facts=retail.slice(0,3).map(e=>({evidence:e.key,relevance:'This synthetic GB offer supplies limited competing-category context only.'}));
 const differentiation=output.candidates[0].dimensions.find(d=>d.dimension==='differentiation');
 differentiation.finding='supported';differentiation.evidenceStrength='direct';differentiation.uncertainties=[];
 differentiation.facts=retail.slice(3).map(e=>({evidence:e.key,relevance:'This synthetic offer bounds category differentiation without establishing demand.'}));
 return output;
}
