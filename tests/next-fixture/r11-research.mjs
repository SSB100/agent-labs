import {createHash,createHmac} from 'node:crypto';
import {id} from './data.mjs';

export const r11Scope={businessId:id(1),otherBusinessId:id(2),foreignBusinessId:id(999999),grantId:id(911001),policyId:id(911002),workflowRunId:id(911003),goalId:id(911004),operatingPolicyId:id(911005),collectionId:id(911006)};
export const R11_INERT_SERVER_KEY='inert-next-r11-authority-placeholder-000000000000';
export const R11_QUERY='What public industry reporting describes practical adult gardening product preferences?';
export const R11_QUOTE_HASH='da72596d20ade100bbf994636c645ef3b7c03b4a033054f3017911a9245ea1be';
export const R11_CONTINUATION_QUOTE_HASH='52bbd10682da06b0eff537916e0cfdd882c2d007a7f090024f98e2a4379f0ec9';
export const R11_CANONICAL_MODEL='openai/gpt-5.6-luna-20260709';
export const R11_RAW_SENTINEL='RAW_R11_PROVIDER_TEXT_MUST_NOT_PERSIST';
export const r11ContinuationScope={grantId:id(912001),policyId:id(912002),workflowRunId:id(912003),operatingPolicyId:id(912005)};
export const R11_RESET={r11Research:true,resetResearch:true,r11HoldLoads:false,r11Historical:false,r11Expired:false,r11ReadUnavailable:false,r11CatalogUnavailable:false,r11ProviderFailure:null,r11GenerationResponses:[],r11UnknownCost:false,r11InvalidSelection:false,r11InvalidSources:false,r11InvalidModel:false,r11InvalidProvider:false,r11AliasModel:false,r11CompleteFailure:false,r11CollectFailure:false,r11FailJournalFailure:false,r11StopFailure:false};
export const R11_EXCERPT='Adult gardeners often value practical tools and containers suited to the available growing space. This is a bounded public observation from an inert qualification fixture.';
export const r11Endpoint={name:'Azure | openai/gpt-5.6-luna-20260709',model_id:'openai/gpt-5.6-luna',provider_name:'Azure',tag:'azure/us',status:0,context_length:1050000,max_completion_tokens:128000,supported_parameters:['reasoning','max_completion_tokens','tools','tool_choice','response_format','structured_outputs'],pricing:{prompt:'0.00000022',completion:'0.00000132',input_cache_read:'0.000000022',input_cache_write:'0.000000275',overrides:[{min_prompt_tokens:272000,prompt:'0.00000044',completion:'0.00000198',input_cache_read:'0.000000044',input_cache_write:'0.00000055'}]}};
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
export const r11Hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
export function researchCatalogFixture(url,log,control){
 log.push({kind:'inert-r11-public-catalog',url});
 if(control.r11CatalogUnavailable)throw Error('Inert catalog unavailable');
 if(url==='https://openrouter.ai/api/v1/models')return{data:[{id:'openai/gpt-5.6-luna',canonical_slug:R11_CANONICAL_MODEL,links:{details:`/api/v1/models/${R11_CANONICAL_MODEL}/endpoints`}}]};
 if([`https://openrouter.ai/api/v1/models/${R11_CANONICAL_MODEL}/endpoints`,'https://openrouter.ai/api/v1/models/openai/gpt-5.6-luna/endpoints'].includes(url))return{data:{id:'openai/gpt-5.6-luna',endpoints:[structuredClone(r11Endpoint)]}};
 if(url==='https://openrouter.ai/api/v1/endpoints/zdr')return{data:[structuredClone(r11Endpoint)]};
 throw Error('Unreviewed inert public catalog');
}
/** A read-only synthetic generation record, independently matched to one
 * admitted fixture response. The test-only response queue controls transport,
 * never the paid request or saved state. No credential or caller data accepted. */
export function researchGenerationFixture(state,input,log,control){
 if(Object.keys(input??{}).join(',')!=='url'||typeof input.url!=='string')throw Error('Inert generation input unavailable');
 const match=/^https:\/\/openrouter\.ai\/api\/v1\/generation\?id=(gen-[A-Za-z0-9_-]{1,296})$/.exec(input.url);
 const call=match&&state.r11Research?.providerCalls.find(row=>row.receiptId===match[1]);
 if(!call)throw Error('Inert exact generation unavailable');
 log.push({kind:'inert-r11-generation-read',url:input.url,generationId:call.receiptId});
 const scenario=control.r11GenerationResponses?.shift()??'success';
 if(scenario==='not_found'||scenario==='unauthorized')return{status:scenario==='not_found'?404:401,body:R11_RAW_SENTINEL};
 if(scenario==='invalid_json')return{status:200,body:'{"private":"'+R11_RAW_SENTINEL};
 if(scenario==='invalid_envelope')return{status:200,body:JSON.stringify({error:R11_RAW_SENTINEL})};
 if(!['success','wrong_generation'].includes(scenario))throw Error('Unreviewed inert generation response');
 return{status:200,body:JSON.stringify({data:{id:scenario==='wrong_generation'?'gen-'+R11_RAW_SENTINEL:call.receiptId,provider_name:control.r11InvalidProvider?R11_RAW_SENTINEL:'Azure',model:R11_CANONICAL_MODEL,
  provider_responses:[{provider_name:control.r11InvalidProvider?R11_RAW_SENTINEL:'Azure',model_permaslug:R11_CANONICAL_MODEL,status:200}]}})};
}
export const r11Search={requestHash:'2274c20fe35e47b44fdbb711dbd284d48293cea77a8e1c1088ca8c3fe138421f',wireHash:'4c966df85e61d3cd2666f37a10fe2d3334a90e29f71a3217be4e8b056cca3e19',wireBytes:844,maxTokens:4000};
export function seedResearchFixture(state,options={}){
 const now=Date.now(),policy={version:'r11.public-research.1',id:r11Scope.policyId,businessId:r11Scope.businessId,ownerId:state.owner,workflowRunId:r11Scope.workflowRunId,goalId:r11Scope.goalId,operatingPolicyId:r11Scope.operatingPolicyId,query:R11_QUERY,
  allowedDomains:['gardening.example'],excludedDomains:['etsy.com','etsy.me','etsystatic.com'],sourceReviews:[{domain:'gardening.example',basis:'documented_api_factual_snippets',reviewHash:'1'.repeat(64)}],queryReviewHash:r11Hash({query:R11_QUERY,classification:'generic_nonpersonal_public_research'}),termsReviewHash:'2'.repeat(64),independentReviewHash:'3'.repeat(64),approvalHash:'4'.repeat(64),modelId:'openai/gpt-5.6-luna',providerEndpoint:'azure/us',recipients:{router:'openrouter.ai',search:'exa.ai',inferenceEndpoint:'azure/us'},retention:{inference:'no_training_zdr',search:'query_retention_improvement_training_possible',application:'bounded_attributed_audit_evidence'},validFrom:new Date(now-60_000).toISOString(),validUntil:new Date(now+240_000).toISOString(),maximumMicrousd:250_000,searchMicrousd:149_560,selectorMicrousd:26_311,priceLimit:{prompt:0.44,completion:1.98,request:0},quoteHash:R11_QUOTE_HASH,quoteValidUntil:new Date(now+240_000).toISOString()};
 const runtimeCapability=createHmac('sha256',R11_INERT_SERVER_KEY).update(canonical({version:'r11.owner-runtime.1',businessId:r11Scope.businessId,ownerId:state.owner,policyId:r11Scope.policyId,workflowRunId:r11Scope.workflowRunId})).digest('base64url');
 const businessContent={brandContext:'Synthetic adult gardening research Business',operatingRules:'Only the reviewed bounded public evidence proof',allowedActivity:'Research planning',restrictions:'No account or buyer data, commerce, publishing, store writes or product selection'};
 const goalContent={title:'One public gardening evidence proof',originalIntent:'Learn how adult gardeners describe practical tools and containers using one bounded public source proof',objective:'Retain one attributed evidence pack without claiming sales or profitability',parsed:{target:{amount:'1',currency:null,metric:'units'},budget:{amount:'0.25',currency:'USD'},deadline:{date:policy.validUntil.slice(0,10),time:policy.validUntil.slice(11,19),timezone:'UTC'},scope:'Research planning',geography:['New Zealand'],stopConstraints:['Stop after one search and one evidence selector','No store writes, publishing, product selection, automatic retry or fallback']},ambiguities:[]};
 const installationId=id(911030),workflowDefinitionId=id(911031),priorHeldMicrounits='125000';
 const operatingPolicy={version:'r05.1',goalRevision:2,businessRevision:1,currency:'USD',businessLifetimeLimitMicrounits:'375000',policyLimitMicrounits:'250000',categoryLimits:[{category:'model',microunits:'250000'}],expectedCapRevision:0,expectedExposureMicrounits:priorHeldMicrounits,startsAt:policy.validFrom,expiresAt:policy.validUntil,maximumDispatches:2,minimumIntervalSeconds:0,stopOnTarget:false,financialMode:'bounded_model_cost_only',operations:[['research.search',policy.searchMicrousd],['research.model',policy.selectorMicrousd]].map(([operationKey,amount])=>({operationKey,installationId,workflowDefinitionId,purpose:'Research planning',provider:'openrouter',category:'model',accountId:null,accountRevision:null,sourceDomains:[...policy.allowedDomains],dataClasses:['generic_public_query','public_evidence'],maximumPerOperationMicrounits:String(amount)}))};
 const grant={version:'r11.owner-proof-grant.1',id:r11Scope.grantId,businessId:r11Scope.businessId,ownerId:state.owner,policyId:r11Scope.policyId,workflowRunId:r11Scope.workflowRunId,serverKeyHash:createHash('sha256').update(R11_INERT_SERVER_KEY).digest('hex'),runtimeCapabilityHash:createHash('sha256').update(runtimeCapability).digest('hex'),installationId,installationSnapshotHash:r11Hash({fixture:true}),workflowDefinitionId,businessContent,goalContent,operatingPolicy,researchPolicy:policy,search:structuredClone(r11Search),interpretationHash:r11Hash(goalContent),approvalHash:policy.approvalHash};
 const research={createdAt:new Date(now).toISOString(),businessId:r11Scope.businessId,ownerId:state.owner,priorHeldMicrounits,lifetimeCapMicrounits:'375000',continuationGrants:[],outcomes:[],grants:[{grantId:r11Scope.grantId,grantHash:r11Hash(grant),grant,used:false,expired:false,revoked:false}],policies:[],providerCalls:[],settlements:[],collections:[],results:[],markers:[],revocations:[]};
 if(options.r11Historical)seedHistoricalResearch(research);
 return research;
}

const error=message=>({data:null,error:{code:'42501',message}});
const ok=data=>({data:structuredClone(data),error:null});
const authority=(research,policyId,workflowRunId,version)=>version===2?createHmac('sha256',R11_INERT_SERVER_KEY).update(canonical({version:'r11.attempt-admission.1',businessId:research.businessId,ownerId:research.ownerId,policyId,workflowRunId})).digest('base64url'):R11_INERT_SERVER_KEY;
const capability=(research,policyId,workflowRunId)=>createHmac('sha256',R11_INERT_SERVER_KEY).update(canonical({version:'r11.owner-runtime.1',businessId:research.businessId,ownerId:research.ownerId,policyId,workflowRunId})).digest('base64url');
const operationKeys=(policyId,version)=>({search:version===2?`research.search.r11v2.${policyId}`:'research.search',select:version===2?`research.model.r11v2.${policyId}`:'research.model'});
function activateFixtureGrant(research,entry){
 entry.used=true;const grant=entry.grant,policy=structuredClone(grant.researchPolicy),attemptVersion=grant.version==='r11.owner-continuation-grant.1'?2:1;
 const proof={policyId:policy.id,workflowRunId:policy.workflowRunId,goalId:policy.goalId,operatingPolicyId:policy.operatingPolicyId,policy,policyHash:r11Hash(policy),status:'ready',revoked:false,expired:false,phases:[],result:null,attemptVersion,operationKeys:operationKeys(policy.id,attemptVersion),workflowStatus:'ready',terminalReconciliationRequired:false};
 research.policies.push(proof);return proof;
}
function seedHistoricalResearch(research){
 research.priorHeldMicrounits='598063';research.lifetimeCapMicrounits='848063';
 const entry=research.grants[0],old=entry.grant.researchPolicy;
 old.validFrom=new Date(Date.now()-600_000).toISOString();old.validUntil=new Date(Date.now()-300_000).toISOString();old.quoteValidUntil=old.validUntil;
 entry.grant.operatingPolicy.expectedExposureMicrounits='598063';entry.grant.operatingPolicy.businessLifetimeLimitMicrounits='848063';entry.grantHash=r11Hash(entry.grant);
 const proof=activateFixtureGrant(research,entry);proof.revoked=true;proof.terminalReconciliationRequired=true;proof.workflowStatus='running';
 const marker={business:research.businessId,policyId:proof.policyId,phase:'search',requestId:id(911010),wireHash:r11Search.wireHash};
 research.markers.push(marker);research.providerCalls.push({kind:'inert-r11-provider',business:research.businessId,policyId:proof.policyId,phase:'search',requestId:marker.requestId,receiptId:'gen-r11-historical-search-receipt',historical:true});
 research.settlements.push({requestId:marker.requestId,currency:'USD',actualMicrounits:'10068',providerRequestId:'gen-r11-historical-search-receipt',receiptHash:r11Hash({fixture:'historical-search-receipt'})});
 research.revocations.push({policyId:proof.policyId,historical:true});
}
function continuationProjection(research,policies,exposure){
 if(!policies.length)return null;
 const predecessor=policies[0],remaining=BigInt(research.lifetimeCapMicrounits)-BigInt(exposure.heldMicrounits);
 const reason=exposure.hasUnknown?'unknown_exposure':predecessor.terminalReconciliationRequired?'terminal_reconciliation_required':!predecessor.revoked?'predecessor_active':policies.length>1?'continuation_exists':remaining<=0?'budget_exhausted':'ready';
 return{predecessorPolicyId:predecessor.policyId,predecessorWorkflowRunId:predecessor.workflowRunId,currentOperatingPolicyId:predecessor.operatingPolicyId,goalId:predecessor.goalId,goalRevision:2,businessRevision:1,capRevision:1,lifetimeCapMicrounits:research.lifetimeCapMicrounits,exposureMicrounits:exposure.heldMicrounits,remainingMicrounits:String(remaining>0?remaining:0),eligible:reason==='ready',reason};
}
function projection(state,business,control,empty=false){
 const research=state.r11Research;
 const policies=empty?[]:(research?.policies??[]).filter(item=>item.policy.businessId===business).map(item=>{
  const phases=research.markers.filter(marker=>marker.policyId===item.policyId).map(marker=>{
   const settlements=research.settlements.filter(row=>row.requestId===marker.requestId),known=settlements.filter(row=>row.actualMicrounits!==null);
   const actualMicrounits=known.length?String(known.reduce((maximum,row)=>BigInt(row.actualMicrounits)>maximum?BigInt(row.actualMicrounits):maximum,0n)):null;
   return{phase:marker.phase,requestId:marker.requestId,marked:true,settled:!!settlements.length,actualMicrounits,providerRequestId:settlements[0]?.providerRequestId??null};
  });
  const collection=research.collections.find(row=>row.policyId===item.policyId),result=research.results.find(row=>row.policyId===item.policyId)??null;
  const expired=!!control.r11Expired||Date.parse(item.policy.validUntil)<=Date.now();
  return{...item,phases,result,expired,outcomes:research.outcomes.filter(row=>row.policyId===item.policyId),operations:item.operationKeys,status:result?'completed':item.revoked?'revoked':expired?'expired':phases.some(row=>row.phase==='select')?'selection_recording_pending':collection?'collection_ready':phases.some(row=>row.phase==='search')?'search_recording_pending':'ready'};
 });
 const visible=rows=>empty?[]:rows.filter(item=>item.grant.businessId===business).map(item=>({...item,expired:!!control.r11Expired||Date.parse(item.grant.researchPolicy.validUntil)<=Date.now()}));
 const grants=visible(research?.grants??[]),continuationGrants=visible(research?.continuationGrants??[]);
 let held=business===research?.businessId&&!empty?Number(research.priorHeldMicrounits??'0'):0,hasUnknown=false;
 for(const proof of policies)for(const phase of proof.phases){const liability=phase.phase==='search'?proof.policy.searchMicrousd:proof.policy.selectorMicrousd;if(phase.actualMicrounits===null){held+=liability;hasUnknown=true;}else held+=Number(phase.actualMicrounits);}
 const exposure={currency:'USD',heldMicrounits:String(held),hasUnknown};
 return{businessId:business,ownerId:state.owner,exposure,grants,continuationGrants,policies,grantTotal:grants.length,continuationGrantTotal:continuationGrants.length,policyTotal:policies.length,continuation:research?continuationProjection(research,policies,exposure):null};
}
/** Test-only installation of independently reviewed metadata, never an owner action. */
export function installResearchContinuationFixture(state,control={}){
 const research=state.r11Research,context=projection(state,research.businessId,control).continuation;
 if(!context?.eligible||research.continuationGrants.length)throw Error('Inert continuation not eligible');
 const original=research.grants[0].grant,grant=structuredClone(original),ids=r11ContinuationScope;
 const preparedAt=Date.now(),validFrom=new Date(preparedAt).toISOString(),validUntil=new Date(preparedAt+30*60_000).toISOString();
 Object.assign(grant,{version:'r11.owner-continuation-grant.1',id:ids.grantId,policyId:ids.policyId,workflowRunId:ids.workflowRunId,continuation:context});
 Object.assign(grant.researchPolicy,{version:'r11.public-research.2',id:ids.policyId,workflowRunId:ids.workflowRunId,goalId:context.goalId,operatingPolicyId:ids.operatingPolicyId,validFrom,validUntil,quoteValidUntil:validUntil,maximumMicrousd:239932,quoteHash:R11_CONTINUATION_QUOTE_HASH});
 Object.assign(grant.operatingPolicy,{goalRevision:context.goalRevision+2,businessRevision:context.businessRevision+1,expectedCapRevision:context.capRevision,expectedExposureMicrounits:context.exposureMicrounits,businessLifetimeLimitMicrounits:context.lifetimeCapMicrounits,policyLimitMicrounits:'239932',categoryLimits:[{category:'model',microunits:'239932'}],startsAt:validFrom,expiresAt:validUntil});
 grant.operatingPolicy.operations.forEach((operation,index)=>{operation.operationKey=operationKeys(ids.policyId,2)[index===0?'search':'select'];});
 grant.serverKeyHash=createHash('sha256').update(authority(research,ids.policyId,ids.workflowRunId,2)).digest('hex');
 grant.runtimeCapabilityHash=createHash('sha256').update(capability(research,ids.policyId,ids.workflowRunId)).digest('hex');
 if(control.r11ContinuationTamper==='budget'){grant.operatingPolicy.policyLimitMicrounits='250000';grant.researchPolicy.maximumMicrousd=250000;}
 if(control.r11ContinuationTamper==='predecessor')grant.continuation.predecessorPolicyId=r11Scope.otherBusinessId;
 research.continuationGrants.push({grantId:ids.grantId,grantHash:r11Hash(grant),grant,used:false,expired:false,revoked:false});
}
function saveOutcome(research,proof,kind,phase,requestId,reason,observation,effects){
 let outcome=research.outcomes.find(item=>item.policyId===proof.policyId&&item.kind===kind);const replayed=!!outcome;
 if(!outcome){outcome={outcomeId:id(913000+research.outcomes.length),policyId:proof.policyId,kind,phase,requestId,reason,observation:structuredClone(observation),createdAt:new Date().toISOString()};research.outcomes.push(outcome);effects.push({kind:'in-memory-r11-outcome',business:research.businessId,policyId:proof.policyId,outcomeKind:kind,outcomeId:outcome.outcomeId});}
 if(!proof.revoked){proof.revoked=true;research.revocations.push({policyId:proof.policyId});effects.push({kind:'in-memory-r11-research-revocation',business:research.businessId,policyId:proof.policyId});}
 if(!research.results.some(result=>result.policyId===proof.policyId))proof.workflowStatus=kind==='owner_stopped'?'cancelled':'needs_owner';
 proof.terminalReconciliationRequired=false;
 return{outcomeId:outcome.outcomeId,recorded:true,replayed,workflowStatus:proof.workflowStatus};
}
export function researchOwnerFixture(state,name,args,effects,control,mode='normal'){
 const business=args.p_business_id;
 if(!state.businesses.some(item=>item.id===business))return error('Inert exact owner mismatch');
 if(mode==='unavailable'||control.r11ReadUnavailable)return error('Inert research read unavailable');
 if(name==='r11_research_workspace_v2')return ok(projection(state,business,control,mode==='empty'));
 const research=state.r11Research;
 if(!research)return error('Inert research fixture not enabled');
 if(name==='r11_research_bootstrap'||name==='r11_research_continue'){
  const continued=name==='r11_research_continue',entries=continued?research.continuationGrants:research.grants;
  const entry=entries.find(item=>item.grantId===args.p_grant_id&&item.grantHash===args.p_grant_hash&&item.grant.researchPolicy.businessId===business);
  if(!entry||entry.expired||entry.revoked||control.r11Expired||Date.parse(entry.grant.researchPolicy.validUntil)<=Date.now())return error('Inert exact grant unavailable');
  const replayed=entry.used;
  if(!replayed){
   if(continued){const current=projection(state,business,control).continuation,g=entry.grant;
    if(!current?.eligible||canonical(g.continuation)!==canonical(current)||g.researchPolicy.goalId!==current.goalId||g.operatingPolicy.businessLifetimeLimitMicrounits!==current.lifetimeCapMicrounits||g.operatingPolicy.expectedExposureMicrounits!==current.exposureMicrounits||g.operatingPolicy.policyLimitMicrounits!==String(g.researchPolicy.maximumMicrousd)||BigInt(g.operatingPolicy.policyLimitMicrounits)>BigInt(current.remainingMicrounits))return error('Inert continuation scope or cap mismatch');
   }
   const proof=activateFixtureGrant(research,entry);
   effects.push({kind:continued?'in-memory-r11-research-continuation':'in-memory-r11-research-activation',business,grantId:entry.grantId,policyId:proof.policyId});
  }
  return ok({policyId:entry.grant.researchPolicy.id,workflowRunId:entry.grant.researchPolicy.workflowRunId,activated:true,replayed});
 }
 if(name==='r11_research_stop_v2'){
  const proof=research.policies.find(item=>item.policyId===args.p_policy_id&&item.policy.businessId===business);
  if(!proof)return error('Inert exact proof unavailable');
  if(control.r11StopFailure)return error('Inert Stop response unavailable');
  const marker=research.markers.find(item=>item.policyId===proof.policyId&&item.phase==='search');
  if(proof.revoked&&Date.parse(proof.policy.validUntil)<=Date.now()&&marker&&research.settlements.some(row=>row.requestId===marker.requestId&&row.actualMicrounits!==null)&&!research.collections.some(row=>row.policyId===proof.policyId)&&!research.markers.some(row=>row.policyId===proof.policyId&&row.phase==='select')&&!research.results.some(result=>result.policyId===proof.policyId)&&!research.outcomes.some(item=>item.policyId===proof.policyId&&item.kind==='failure'))saveOutcome(research,proof,'failure','search',marker.requestId,'legacy_failure_undetermined',null,effects);
  return ok({...saveOutcome(research,proof,'owner_stopped','none',null,'owner_stopped',null,effects),policyId:proof.policyId,revoked:true});
 }
 return error('Inert research owner operation unavailable');
}
export function researchProviderFixture(state,input,effects,control){
 if(Object.keys(input.scope??{}).sort().join(',')!=='businessId,workflowRunId')throw Error('Inert provider scope contains unexpected private fields');
 const research=state.r11Research,proof=research?.policies.find(item=>item.policy.businessId===input.scope.businessId&&item.workflowRunId===input.scope.workflowRunId);
 if(!proof||!['search','select'].includes(input.phase))throw Error('Inert provider exact proof unavailable');
 const marker=research.markers.find(row=>row.policyId===proof.policyId&&row.phase===input.phase);
 if(!marker||marker.wireHash!==createHash('sha256').update(JSON.stringify(input.body)).digest('hex')||research.providerCalls.some(row=>row.requestId===marker.requestId))throw Error('Inert provider unmarked or replayed request');
 const wire=JSON.stringify(input.body);
 if([proof.policy.businessId,proof.policy.ownerId,R11_INERT_SERVER_KEY,authority(research,proof.policyId,proof.workflowRunId,proof.attemptVersion)].some(value=>wire.includes(value)))throw Error('Inert provider wire contains private scope');
 const receiptId=`gen-r11-${proof.policyId}-${input.phase}-receipt`;
 const call={kind:'inert-r11-provider',business:proof.policy.businessId,policyId:proof.policyId,phase:input.phase,requestId:marker.requestId,receiptId};
 research.providerCalls.push(call);effects.push(call);
 return{receiptId,fail:control.r11ProviderFailure===input.phase,unknownCost:!!control.r11UnknownCost,invalidSelection:!!control.r11InvalidSelection,invalidSources:!!control.r11InvalidSources,invalidModel:!!control.r11InvalidModel,invalidProvider:!!control.r11InvalidProvider,aliasModel:!!control.r11AliasModel};
}
export function researchRuntimeFixture(state,name,args,effects,control){
 try{
  const research=state.r11Research,payload=args.p_payload??{},business=args.p_business_id;
  if(!research||!state.businesses.some(item=>item.id===business))return error('Inert runtime Business unavailable');
  const marker=research.markers.find(row=>row.requestId===payload.requestId&&row.business===business);
  const proof=research.policies.find(item=>item.policy.businessId===business&&item.policyId===(name==='r05_admission_server'?marker?.policyId:payload.policyId));
  if(!proof||args.p_server_key!==authority(research,proof.policyId,proof.workflowRunId,proof.attemptVersion))return error('Inert runtime authority mismatch');
  if(name==='r05_admission_server'){
   if(args.p_operation!=='settle')return error('Inert financial operation unavailable');
   const call=research.providerCalls.find(row=>row.requestId===payload.requestId);
   if(!marker||!call||call.receiptId!==payload.providerRequestId||payload.currency!=='USD'||!/^[a-f0-9]{64}$/.test(payload.receiptHash??'')||
      !(payload.actualMicrounits===null||typeof payload.actualMicrounits==='string'&&/^(0|[1-9][0-9]*)$/.test(payload.actualMicrounits)&&BigInt(payload.actualMicrounits)<=9007199254740991n))return error('Inert exact settlement unavailable');
   const existing=research.settlements.find(row=>row.requestId===payload.requestId&&row.receiptHash===payload.receiptHash);
   if(existing&&(existing.currency!==payload.currency||existing.actualMicrounits!==payload.actualMicrounits||existing.providerRequestId!==payload.providerRequestId))return error('Inert settlement conflict');
   if(!existing){research.settlements.push({...payload});effects.push({kind:'in-memory-r11-settlement',business,requestId:payload.requestId,actualMicrounits:payload.actualMicrounits,receiptHash:payload.receiptHash});}
   return ok({decision:'allowed'});
  }
  if(name!=='r11_research_server_v2')return error('Inert runtime version unavailable');
  if(args.p_operation==='fail'){
   if(control.r11FailJournalFailure)return error('Inert failure journal unavailable');
   const reasons=['provider_response_invalid','response_model_unqualified','response_provider_unqualified','source_contract_invalid','collection_persistence_failed','selector_output_invalid','result_persistence_failed','cost_unverified_or_over_cap','internal_failure'];
   if(Object.keys(payload).sort().join(',')!=='observation,phase,policyId,reason,requestId'||!['none','search','select'].includes(payload.phase)||!reasons.includes(payload.reason)||JSON.stringify(payload).includes(R11_RAW_SENTINEL))return error('Inert bounded outcome invalid');
   const phaseMarker=research.markers.find(item=>item.policyId===proof.policyId&&item.phase===payload.phase);
   if(payload.phase==='none'&&research.markers.some(item=>item.policyId===proof.policyId)||payload.requestId!== (phaseMarker?.requestId??null))return error('Inert failure request mismatch');
   if(research.results.some(result=>result.policyId===proof.policyId)||payload.phase==='search'&&research.collections.some(collection=>collection.policyId===proof.policyId))return ok({outcomeId:null,recorded:false,replayed:false,superseded:true,reason:'phase_progressed',workflowStatus:proof.workflowStatus});
   return ok(saveOutcome(research,proof,'failure',payload.phase,phaseMarker?.requestId??null,payload.reason,payload.observation,effects));
  }
  if(proof.revoked||control.r11Expired||Date.parse(proof.policy.validUntil)<=Date.now())return error('Inert exact active research policy unavailable');
  if(args.p_operation==='load')return ok({policy:proof.policy,policyHash:proof.policyHash,search:r11Search,collection:research.collections.find(item=>item.policyId===proof.policyId)??null,attemptVersion:proof.attemptVersion,operationKeys:proof.operationKeys});
  if(args.p_operation==='guard'){
   if(!['search','select'].includes(payload.phase))return error('Inert phase unavailable');
   const markedAt=Date.now(),quoteUntil=Date.parse(payload.quoteValidUntil);
   if(proof.policy.version==='r11.public-research.2'&&(typeof payload.quoteValidUntil!=='string'||!Number.isFinite(quoteUntil)||quoteUntil<=markedAt||quoteUntil>markedAt+5*60_000))return error('Inert fresh phase quote required');
   if(proof.policy.version==='r11.public-research.1'&&Object.hasOwn(payload,'quoteValidUntil'))return error('Inert legacy quote contract changed');
   const previous=research.markers.find(item=>item.policyId===proof.policyId&&item.phase===payload.phase);
   if(previous)return ok({decision:'blocked',shouldDispatch:false,requestId:previous.requestId});
   const collection=research.collections.find(item=>item.policyId===proof.policyId),wire=payload.phase==='search'?r11Search:collection?.selector;
   const admission=payload.admission,expectedCapability=capability(research,proof.policyId,proof.workflowRunId);
   if(!wire||admission?.runtimeCapability!==expectedCapability||admission?.workflowRunId!==proof.workflowRunId||admission?.operationKey!==proof.operationKeys[payload.phase]||admission?.requestHash!==wire.requestHash||admission?.wireRequestHash!==wire.wireHash||admission?.wireRequestBytes!==wire.wireBytes||admission?.maximumOutputTokens!==wire.maxTokens||admission?.idempotencyKey!==`r11:${proof.policyId}:${payload.phase}`||admission?.accounting?.kind!=='r05'||r11Hash(admission?.sourceDomains)!==r11Hash(proof.policy.allowedDomains))return error('Inert admission descriptor mismatch');
   if(payload.phase==='select'&&(!collection||payload.collectionId!==collection.id))return error('Inert selector collection mismatch');
   const requestId=id(911010+research.markers.length),newMarker={business,policyId:proof.policyId,phase:payload.phase,requestId,wireHash:wire.wireHash,...(proof.policy.version==='r11.public-research.2'?{quoteValidUntil:payload.quoteValidUntil,markedAt:new Date(markedAt).toISOString()}: {})};
   research.markers.push(newMarker);proof.workflowStatus='running';effects.push({kind:'in-memory-r11-dispatch-marker',...newMarker});
   return ok({decision:'allowed',shouldDispatch:true,requestId});
  }
  if(args.p_operation==='collect'){
   if(control.r11CollectFailure)return error('Inert collection persistence unavailable');
   const marker=research.markers.find(item=>item.policyId===proof.policyId&&item.phase==='search'),settlement=research.settlements.find(item=>item.requestId===marker?.requestId);
   if(!marker||payload.searchRequestId!==marker.requestId||!settlement||settlement.actualMicrounits===null||settlement.providerRequestId!==payload.providerRequestId||r11Hash(payload.collection)!==payload.collectionHash||r11Hash(payload.lineage)!==payload.lineageHash||canonical(payload.collection)!==payload.collectionCanonical||canonical(payload.lineage)!==payload.lineageCanonical)return error('Inert collection lineage unavailable');
   const saved={id:id(911006+research.collections.length),policyId:proof.policyId,collection:payload.collection,collectionHash:payload.collectionHash,lineage:payload.lineage,lineageHash:payload.lineageHash,selector:{requestHash:payload.selectorRequestHash,wireHash:payload.selectorWireHash,wireBytes:payload.selectorWireBytes,maxTokens:payload.selectorMaxTokens}};
   if(!research.collections.some(item=>item.policyId===proof.policyId)){research.collections.push(saved);effects.push({kind:'in-memory-r11-collection',business,policyId:proof.policyId,collectionId:saved.id});}
   return ok({collectionId:saved.id,collectionHash:saved.collectionHash,lineageHash:saved.lineageHash,replayed:false});
  }
  if(args.p_operation==='complete'){
   if(control.r11CompleteFailure)return error('Inert durable result unavailable');
   const collection=research.collections.find(item=>item.policyId===proof.policyId),marker=research.markers.find(item=>item.policyId===proof.policyId&&item.phase==='select'),settlement=research.settlements.find(item=>item.requestId===marker?.requestId);
   if(!collection||!marker||!settlement||settlement.actualMicrounits===null||payload.collectionId!==collection.id||payload.selectorRequestId!==marker.requestId||payload.providerRequestId!==settlement.providerRequestId||canonical(payload.evidencePack)!==payload.evidencePackCanonical||r11Hash(payload.evidencePack)!==payload.evidencePackHash)return error('Inert final result lineage unavailable');
   let result=research.results.find(item=>item.policyId===proof.policyId);
   if(!result){result={resultId:id(911020+research.results.length),policyId:proof.policyId,evidencePack:payload.evidencePack,evidencePackHash:payload.evidencePackHash,collectionId:collection.id,selectorRequestId:marker.requestId,providerRequestId:settlement.providerRequestId,createdAt:new Date().toISOString()};research.results.push(result);proof.workflowStatus='completed';effects.push({kind:'in-memory-r11-validated-result',business,policyId:proof.policyId,resultId:result.resultId});}
   return ok({...result,complete:true,replayed:false});
  }
  return error('Inert runtime operation unavailable');
 }catch{return error('Inert research runtime unavailable');}
}
