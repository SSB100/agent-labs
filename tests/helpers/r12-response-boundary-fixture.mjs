/** Synthetic prose only. Maximize declared prose/count bounds without changing
 * identity, outcome, evidence relevance or permission fields. A schema maximum
 * is not a promise that the later aggregate byte/wire ceilings admit it. */
import assert from 'node:assert/strict';
import {assertJsonSchemaValue} from '../../.core-tests/workers/schema-validator.js';
import worker from '../../.core-tests/products/discovery-v2-worker-contract.js';
import {discoveryV2Hash as hash,discoveryV2SnapshotByteLength,DISCOVERY_V2_SNAPSHOT_BYTES} from '../../.core-tests/products/discovery-v2.js';
import {discoveryAddendumReferences} from '../../.core-tests/products/discovery-r12-evidence-addendum.js';
import {qualifyGenerationRouteProof} from '../../.core-tests/research/generation-route.js';

const prose=(text,length)=>(text+' Synthetic limits remain unresolved.'.repeat(length)).slice(0,length-1).trimEnd().padEnd(length-1,'.')+'.';
export function maximumR12ResponseFixture({phase,output,request}){
 const result=structuredClone(output),schema=request.outputSchema;
 if(phase==='strategy'){
  for(const market of result.marketComparisons){
   market.assumptions=Array.from({length:4},(_,i)=>`Synthetic assumption ${i+1}: the bounded private test establishes no commercial readiness.`);
   market.limitations=Array.from({length:4},(_,i)=>`Synthetic limitation ${i+1}: demand, profitability and execution approvals remain unresolved.`);
   market.feeScenarios=['GB','US','CA','AU'].map(sellerBankCountry=>({...structuredClone(market.feeScenarios[0]),sellerBankCountry}));
  }
  for(const dimension of result.candidates[0].dimensions)dimension.uncertainties=Array.from({length:2},(_,i)=>({question:`What additional ${dimension.dimension} evidence resolves synthetic commercial question ${i+1} before commerce?`,blockingForTest:false,reason:'This separate commercial question does not block the fixed private composition test and grants no execution approval.'}));
 }else{
  assert.equal(phase,'review');
  result.dimensions.forEach(d=>{d.verdict='nonblocking_unknown';});
  result.additionalUncertainties=result.dimensions.flatMap(d=>Array.from({length:2},(_,i)=>({dimension:d.dimension,question:`What further ${d.dimension} evidence resolves independent synthetic commercial question ${i+1}?`,blockingForTest:false,reason:'Independent review retains the commercial unknown without blocking the fixed private composition inspection or authorizing execution.'})));
 }
 const visit=(value,node)=>{
  if(node.anyOf){const branch=node.anyOf.find(candidate=>{try{assertJsonSchemaValue(candidate,value);return true;}catch{return false;}});assert.ok(branch,'Existing synthetic value must match a schema branch');return visit(value,branch);}
  if(typeof value==='string'&&Number.isInteger(node.maxLength)&&!node.enum&&!Object.hasOwn(node,'const')&&!node.pattern)return prose(value,node.maxLength);
  if(Array.isArray(value))return value.map(item=>visit(item,node.items));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,visit(item,node.properties[key])]));
  return value;
 };
 const maximum=visit(result,schema);assertJsonSchemaValue(schema,maximum,'Maximum synthetic response');return maximum;
}

/** Nonsecret structural metrics only; never report source text or RPC values. */
export function r12ShapeMetrics(value){
 const metrics={jsonBytes:Buffer.byteLength(JSON.stringify(value)),objects:0,arrays:0,strings:0,stringBytes:0,maximumArrayLength:0};
 const visit=v=>{if(typeof v==='string'){metrics.strings++;metrics.stringBytes+=Buffer.byteLength(v);}else if(Array.isArray(v)){metrics.arrays++;metrics.maximumArrayLength=Math.max(metrics.maximumArrayLength,v.length);v.forEach(visit);}else if(v&&typeof v==='object'){metrics.objects++;Object.values(v).forEach(visit);}};visit(value);return metrics;
}

/** Unicode filler is confined to invented rationale prose, never facts/IDs.
 * Replacing one ASCII code unit with é adds exactly one UTF-8 byte while keeping
 * schema character counts fixed. Prove both the exact accepted cap and cap+1. */
export function fillR12ReviewByteBoundary(output,normalize){
 const value=structuredClone(output),fields=[[value,'sufficiencyRationale'],...value.dimensions.map(d=>[d,'rationale']),...value.checks.map(c=>[c,'rationale'])];
 const maximum=DISCOVERY_V2_SNAPSHOT_BYTES.reviewer;let remaining=maximum-discoveryV2SnapshotByteLength(normalize(value));
 assert.ok(remaining>=0);let spare;
 for(const [row,key]of fields){const chars=[...row[key]];for(let i=chars.length-1;i>=0;i--){if(chars[i].charCodeAt(0)>127)continue;if(remaining>0){chars[i]='é';remaining--;}else if(!spare)spare={row,key,index:i};}row[key]=chars.join('');}
 assert.equal(remaining,0,'This explicit prose family must reach the existing artifact cap');
 assert.equal(discoveryV2SnapshotByteLength(normalize(value)),maximum);assert.ok(spare);
 const prior=spare.row[spare.key];spare.row[spare.key]=prior.slice(0,spare.index)+'é'+prior.slice(spare.index+1);
 assert.throws(()=>normalize(value),/bounded serialized snapshot/,'One further UTF-8 byte must fail');spare.row[spare.key]=prior;return value;
}

/** Select the largest additional-question count at maximum prose lengths that
 * passes the real normalized artifact cap, including complete route metadata.
 * This maximizes this explicit family, not every possible permitted JSON value. */
export function acceptedR12ResponseBoundaryFixture(args,report=[]){
 const {phase,state,providerRequestId}=args,p=state.focusedPilot.profile;
 const analysis=(committed=state.committedBeforeAttemptMicrousd,at=state.validationAt)=>worker.prepareDiscoveryWorkerContextV2(p.intent,{version:'pod-discovery-2.0',intentId:p.id,businessId:p.businessId,shortlist:[p.candidate],packRefs:[],comparisonRationale:p.history.scopeChangeExplanation,addendumRef:{artifactId:p.observations.id,sha256:hash(p.observations)}},{knowledge:state.knowledge,packs:new Map(),candidates:new Map([[p.candidate.id,p.candidate]]),ownerRightsConfirmedCandidateIds:[],sellerBankCountry:p.observations.sellerBankCountry,committedMicrousd:committed,evidenceAddendum:p.observations,focusedPilot:state.focusedPilot},discoveryAddendumReferences(p.observations),at);
 const modelId=phase==='review'?'anthropic/claude-4.5-haiku-20251001':'openai/gpt-5.6-luna-20260709',providerName=phase==='review'?'Amazon Bedrock':'Azure';
 const qualifiedRoute=qualifyGenerationRouteProof({data:{id:providerRequestId,provider_name:providerName,model:modelId}},{generationId:providerRequestId,providerName,requestedEndpoint:phase==='review'?'amazon-bedrock/us':'azure/us',acceptedResponseModelIds:phase==='review'?['anthropic/claude-haiku-4.5',modelId]:['openai/gpt-5.6-luna',modelId]});
 const execution={modelId,providerRequestId,primaryOnly:true,qualifiedRoute};let output=maximumR12ResponseFixture(args),normalized,rejectedQuestionCount=null;
 if(phase==='strategy')normalized=worker.normalizeStrategistResponseV2(analysis(),output,execution,state.validationAt);
 else{
  const dep=state.dependencies[0],at=Date.parse(dep.binding.dispatchedAt),oldExecution={modelId:dep.candidate.providerModelId,providerRequestId:dep.candidate.providerRequestId,primaryOnly:true,qualifiedRoute:dep.proof};
  const assessment=worker.normalizeStrategistResponseV2(analysis(dep.binding.request.requestMetadata.r12CommittedBeforeAttemptMicrousd,at),dep.candidate.output,oldExecution,at);
  for(let count=output.additionalUncertainties.length;count>=0;count--){
   output.additionalUncertainties=output.additionalUncertainties.slice(0,count);
   try{normalized=worker.normalizeReviewerResponseV2(analysis(),assessment,output,{strategist:oldExecution,reviewer:execution},state.validationAt);break;}
   catch(error){assert.match(error.message,/bounded serialized snapshot/);rejectedQuestionCount=count;}
  }
  const normalize=value=>worker.normalizeReviewerResponseV2(analysis(),assessment,value,{strategist:oldExecution,reviewer:execution},state.validationAt);
  output=fillR12ReviewByteBoundary(output,normalize);normalized=normalize(output);
 }
 assert.ok(normalized,'A semantically accepted full artifact is required');
 report.push({phase,compact:r12ShapeMetrics(output),normalizedBytes:discoveryV2SnapshotByteLength(normalized),additionalUncertainties:output.additionalUncertainties?.length??null,rejectedQuestionCount});return output;
}
