import {createHash,createHmac} from 'node:crypto';
import {id} from './data.mjs';

export const r11Scope={businessId:id(1),otherBusinessId:id(2),foreignBusinessId:id(999999),grantId:id(911001),policyId:id(911002),workflowRunId:id(911003),goalId:id(911004),operatingPolicyId:id(911005),collectionId:id(911006)};
export const R11_INERT_SERVER_KEY='inert-next-r11-authority-placeholder-000000000000';
export const R11_QUERY='What public industry reporting describes practical adult gardening product preferences?';
export const R11_QUOTE_HASH='e2877d506a6d2e85ecabb0f2f208ad52d91ace5843d29185f600ccc8834280a7';
export const R11_EXCERPT='Adult gardeners often value practical tools and containers suited to the available growing space. This is a bounded public observation from an inert qualification fixture.';
export const r11Endpoint={name:'Azure | openai/gpt-5.6-luna-20260709',model_id:'openai/gpt-5.6-luna',provider_name:'Azure',tag:'azure/us',status:0,context_length:1050000,max_completion_tokens:128000,supported_parameters:['reasoning','max_completion_tokens','tools','tool_choice','response_format','structured_outputs'],pricing:{prompt:'0.00000022',completion:'0.00000132',input_cache_read:'0.000000022',input_cache_write:'0.000000275',overrides:[{min_prompt_tokens:272000,prompt:'0.00000044',completion:'0.00000198',input_cache_read:'0.000000044',input_cache_write:'0.00000055'}]}};
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
export const r11Hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
export function researchCatalogFixture(url,log,control){
 log.push({kind:'inert-r11-public-catalog',url});
 if(control.r11CatalogUnavailable)throw Error('Inert catalog unavailable');
 if(url==='https://openrouter.ai/api/v1/models/openai/gpt-5.6-luna/endpoints')return{data:{id:'openai/gpt-5.6-luna',endpoints:[structuredClone(r11Endpoint)]}};
 if(url==='https://openrouter.ai/api/v1/endpoints/zdr')return{data:[structuredClone(r11Endpoint)]};
 throw Error('Unreviewed inert public catalog');
}
export const r11Search={requestHash:'2274c20fe35e47b44fdbb711dbd284d48293cea77a8e1c1088ca8c3fe138421f',wireHash:'4c966df85e61d3cd2666f37a10fe2d3334a90e29f71a3217be4e8b056cca3e19',wireBytes:844,maxTokens:4000};
export function seedResearchFixture(state){
 const now=Date.now(),policy={version:'r11.public-research.1',id:r11Scope.policyId,businessId:r11Scope.businessId,ownerId:state.owner,workflowRunId:r11Scope.workflowRunId,goalId:r11Scope.goalId,operatingPolicyId:r11Scope.operatingPolicyId,query:R11_QUERY,
  allowedDomains:['gardening.example'],excludedDomains:['etsy.com','etsy.me','etsystatic.com'],sourceReviews:[{domain:'gardening.example',basis:'documented_api_factual_snippets',reviewHash:'1'.repeat(64)}],queryReviewHash:r11Hash({query:R11_QUERY,classification:'generic_nonpersonal_public_research'}),termsReviewHash:'2'.repeat(64),independentReviewHash:'3'.repeat(64),approvalHash:'4'.repeat(64),modelId:'openai/gpt-5.6-luna',providerEndpoint:'azure/us',recipients:{router:'openrouter.ai',search:'exa.ai',inferenceEndpoint:'azure/us'},retention:{inference:'no_training_zdr',search:'query_retention_improvement_training_possible',application:'bounded_attributed_audit_evidence'},validFrom:new Date(now-60_000).toISOString(),validUntil:new Date(now+240_000).toISOString(),maximumMicrousd:250_000,searchMicrousd:149_560,selectorMicrousd:26_311,priceLimit:{prompt:0.44,completion:1.98,request:0},quoteHash:R11_QUOTE_HASH,quoteValidUntil:new Date(now+240_000).toISOString()};
 const runtimeCapability=createHmac('sha256',R11_INERT_SERVER_KEY).update(canonical({version:'r11.owner-runtime.1',businessId:r11Scope.businessId,ownerId:state.owner,policyId:r11Scope.policyId,workflowRunId:r11Scope.workflowRunId})).digest('base64url');
 const businessContent={brandContext:'Synthetic adult gardening research Business',operatingRules:'Only the reviewed bounded public evidence proof',allowedActivity:'Research planning',restrictions:'No account or buyer data, commerce, publishing, store writes or product selection'};
 const goalContent={title:'One public gardening evidence proof',originalIntent:'Learn how adult gardeners describe practical tools and containers using one bounded public source proof',objective:'Retain one attributed evidence pack without claiming sales or profitability',parsed:{target:{amount:'1',currency:null,metric:'units'},budget:{amount:'0.25',currency:'USD'},deadline:{date:policy.validUntil.slice(0,10),time:policy.validUntil.slice(11,19),timezone:'UTC'},scope:'Research planning',geography:['New Zealand'],stopConstraints:['Stop after one search and one evidence selector','No store writes, publishing, product selection, automatic retry or fallback']},ambiguities:[]};
 const installationId=id(911030),workflowDefinitionId=id(911031),priorHeldMicrounits='125000';
 const operatingPolicy={version:'r05.1',goalRevision:2,businessRevision:1,currency:'USD',businessLifetimeLimitMicrounits:'375000',policyLimitMicrounits:'250000',categoryLimits:[{category:'model',microunits:'250000'}],expectedCapRevision:0,expectedExposureMicrounits:priorHeldMicrounits,startsAt:policy.validFrom,expiresAt:policy.validUntil,maximumDispatches:2,minimumIntervalSeconds:0,stopOnTarget:false,financialMode:'bounded_model_cost_only',operations:[['research.search',policy.searchMicrousd],['research.model',policy.selectorMicrousd]].map(([operationKey,amount])=>({operationKey,installationId,workflowDefinitionId,purpose:'Research planning',provider:'openrouter',category:'model',accountId:null,accountRevision:null,sourceDomains:[...policy.allowedDomains],dataClasses:['generic_public_query','public_evidence'],maximumPerOperationMicrounits:String(amount)}))};
 const grant={version:'r11.owner-proof-grant.1',id:r11Scope.grantId,businessId:r11Scope.businessId,ownerId:state.owner,policyId:r11Scope.policyId,workflowRunId:r11Scope.workflowRunId,serverKeyHash:createHash('sha256').update(R11_INERT_SERVER_KEY).digest('hex'),runtimeCapabilityHash:createHash('sha256').update(runtimeCapability).digest('hex'),installationId,installationSnapshotHash:r11Hash({fixture:true}),workflowDefinitionId,businessContent,goalContent,operatingPolicy,researchPolicy:policy,search:structuredClone(r11Search),interpretationHash:r11Hash(goalContent),approvalHash:policy.approvalHash};
 return{createdAt:new Date(now).toISOString(),businessId:r11Scope.businessId,ownerId:state.owner,priorHeldMicrounits,grants:[{grantId:r11Scope.grantId,grantHash:r11Hash(grant),grant,used:false,expired:false,revoked:false}],policies:[],providerCalls:[],settlements:[],collections:[],results:[],markers:[],revocations:[]};
}

const error=message=>({data:null,error:{code:'42501',message}});
const ok=data=>({data:structuredClone(data),error:null});
function activeProof(state,business,policyId,control){
 const proof=state.r11Research?.policies.find(item=>item.policyId===policyId&&item.policy.businessId===business);
 if(!proof||proof.revoked||control.r11Expired||Date.parse(proof.policy.validUntil)<=Date.now())throw Error('Inert exact active research policy unavailable');
 return proof;
}
function projection(state,business,control,empty=false){
 const research=state.r11Research;
 const policies=empty?[]:(research?.policies??[]).filter(item=>item.policy.businessId===business).map(item=>{
  const phases=research.markers.filter(marker=>marker.policyId===item.policyId).map(marker=>{const settlement=research.settlements.find(row=>row.requestId===marker.requestId);return{phase:marker.phase,requestId:marker.requestId,marked:true,settled:!!settlement,actualMicrounits:settlement?.actualMicrounits??null,providerRequestId:settlement?.providerRequestId??null};});
  const collection=research.collections.find(row=>row.policyId===item.policyId),result=research.results.find(row=>row.policyId===item.policyId)??null;
  const expired=!!control.r11Expired||Date.parse(item.policy.validUntil)<=Date.now();
  return{...item,phases,result,expired,status:result?'completed':item.revoked?'revoked':expired?'expired':phases.some(row=>row.phase==='select')?'selection_recording_pending':collection?'collection_ready':phases.some(row=>row.phase==='search')?'search_recording_pending':'ready'};
 });
 const grants=empty?[]:(research?.grants??[]).filter(item=>item.grant.researchPolicy.businessId===business).map(item=>({...item,expired:!!control.r11Expired||Date.parse(item.grant.researchPolicy.validUntil)<=Date.now()}));
 let held=business===research?.businessId&&!empty?Number(research.priorHeldMicrounits??'0'):0,hasUnknown=false;
 for(const proof of policies)for(const phase of proof.phases){const liability=phase.phase==='search'?proof.policy.searchMicrousd:proof.policy.selectorMicrousd;if(phase.actualMicrounits===null){held+=liability;hasUnknown=true;}else held+=Number(phase.actualMicrounits);}
 return{businessId:business,ownerId:state.owner,exposure:{currency:'USD',heldMicrounits:String(held),hasUnknown},grants,policies,grantTotal:grants.length,policyTotal:policies.length};
}
export function researchOwnerFixture(state,name,args,effects,control,mode='normal'){
 const business=args.p_business_id;
 if(!state.businesses.some(item=>item.id===business))return error('Inert exact owner mismatch');
 if(mode==='unavailable'||control.r11ReadUnavailable)return error('Inert research read unavailable');
 if(name==='r11_research_workspace')return ok(projection(state,business,control,mode==='empty'));
 const research=state.r11Research;
 if(!research)return error('Inert research fixture not enabled');
 if(name==='r11_research_bootstrap'){
  const grant=research.grants.find(item=>item.grantId===args.p_grant_id&&item.grantHash===args.p_grant_hash&&item.grant.researchPolicy.businessId===business);
  if(!grant||grant.expired||grant.revoked||control.r11Expired)return error('Inert exact grant unavailable');
  if(!grant.used){
   grant.used=true;const policy=structuredClone(grant.grant.researchPolicy);
   research.policies.push({policyId:policy.id,workflowRunId:policy.workflowRunId,goalId:policy.goalId,operatingPolicyId:policy.operatingPolicyId,policy,policyHash:r11Hash(policy),status:'ready',revoked:false,expired:false,phases:[],result:null});
   effects.push({kind:'in-memory-r11-research-activation',business,grantId:grant.grantId,policyId:policy.id});
  }
  return ok({policyId:grant.grant.researchPolicy.id,workflowRunId:grant.grant.researchPolicy.workflowRunId,activated:true,replayed:grant.used});
 }
 if(name==='r11_research_revoke'){
  const proof=research.policies.find(item=>item.policyId===args.p_policy_id&&item.policy.businessId===business);
  if(!proof)return error('Inert exact proof unavailable');
  if(control.r11StopFailure)return error('Inert Stop response unavailable');
  if(!proof.revoked){proof.revoked=true;effects.push({kind:'in-memory-r11-research-revocation',business,policyId:proof.policyId});}
  return ok({policyId:proof.policyId,revoked:true});
 }
 return error('Inert research owner operation unavailable');
}
export function researchProviderFixture(state,input,effects,control){
 const research=state.r11Research,proof=research?.policies.find(item=>item.policy.businessId===input.scope?.businessId&&item.workflowRunId===input.scope?.workflowRunId);
 if(!proof||!['search','select'].includes(input.phase))throw Error('Inert provider exact proof unavailable');
 const marker=research.markers.find(row=>row.policyId===proof.policyId&&row.phase===input.phase);
 if(!marker||marker.wireHash!==createHash('sha256').update(JSON.stringify(input.body)).digest('hex')||research.providerCalls.some(row=>row.requestId===marker.requestId))throw Error('Inert provider unmarked or replayed request');
 const wire=JSON.stringify(input.body);
 if([proof.policy.businessId,proof.policy.ownerId,R11_INERT_SERVER_KEY].some(value=>wire.includes(value)))throw Error('Inert provider wire contains private scope');
 const receiptId=`inert-r11-${input.phase}-receipt`;
 const call={kind:'inert-r11-provider',business:proof.policy.businessId,policyId:proof.policyId,phase:input.phase,requestId:marker.requestId,receiptId};
 research.providerCalls.push(call);effects.push(call);
 return{receiptId,fail:control.r11ProviderFailure===input.phase,unknownCost:!!control.r11UnknownCost,invalidSelection:!!control.r11InvalidSelection};
}
export function researchRuntimeFixture(state,name,args,effects,control){
 try{
  if(args.p_server_key!==R11_INERT_SERVER_KEY||!state.r11Research)return error('Inert runtime authority mismatch');
  const research=state.r11Research,payload=args.p_payload??{},business=args.p_business_id;
  if(!state.businesses.some(item=>item.id===business))return error('Inert runtime Business unavailable');
  if(name==='r05_admission_server'){
   if(args.p_operation!=='settle')return error('Inert financial operation unavailable');
   const marker=research.markers.find(row=>row.requestId===payload.requestId&&row.business===business),call=research.providerCalls.find(row=>row.requestId===payload.requestId);
   if(!marker||!call||call.receiptId!==payload.providerRequestId||payload.currency!=='USD')return error('Inert exact settlement unavailable');
   if(!research.settlements.some(row=>row.requestId===payload.requestId)){research.settlements.push({...payload});effects.push({kind:'in-memory-r11-settlement',business,requestId:payload.requestId,actualMicrounits:payload.actualMicrounits});}
   return ok({decision:'allowed'});
  }
  const proof=activeProof(state,business,payload.policyId,control);
  if(args.p_operation==='load')return ok({policy:proof.policy,policyHash:proof.policyHash,search:r11Search,collection:research.collections.find(item=>item.policyId===proof.policyId)??null});
  if(args.p_operation==='guard'){
   if(!['search','select'].includes(payload.phase))return error('Inert phase unavailable');
   const previous=research.markers.find(item=>item.policyId===proof.policyId&&item.phase===payload.phase);
   if(previous)return ok({decision:'blocked',shouldDispatch:false,requestId:previous.requestId});
   const collection=research.collections.find(item=>item.policyId===proof.policyId),wire=payload.phase==='search'?r11Search:collection?.selector;
   const admission=payload.admission,expectedCapability=createHmac('sha256',R11_INERT_SERVER_KEY).update(canonical({version:'r11.owner-runtime.1',businessId:business,ownerId:state.owner,policyId:proof.policyId,workflowRunId:proof.workflowRunId})).digest('base64url');
   if(!wire||admission?.runtimeCapability!==expectedCapability||admission?.workflowRunId!==proof.workflowRunId||admission?.requestHash!==wire.requestHash||admission?.wireRequestHash!==wire.wireHash||admission?.wireRequestBytes!==wire.wireBytes||admission?.maximumOutputTokens!==wire.maxTokens||admission?.idempotencyKey!==`r11:${proof.policyId}:${payload.phase}`||admission?.accounting?.kind!=='r05'||r11Hash(admission?.sourceDomains)!==r11Hash(proof.policy.allowedDomains))return error('Inert admission descriptor mismatch');
   if(payload.phase==='select'&&(!collection||payload.collectionId!==collection.id))return error('Inert selector collection mismatch');
   const requestId=id(payload.phase==='search'?911010:911011),marker={business,policyId:proof.policyId,phase:payload.phase,requestId,wireHash:wire.wireHash};
   research.markers.push(marker);effects.push({kind:'in-memory-r11-dispatch-marker',...marker});
   return ok({decision:'allowed',shouldDispatch:true,requestId});
  }
  if(args.p_operation==='collect'){
   const marker=research.markers.find(item=>item.policyId===proof.policyId&&item.phase==='search'),settlement=research.settlements.find(item=>item.requestId===marker?.requestId);
   if(!marker||payload.searchRequestId!==marker.requestId||!settlement||settlement.actualMicrounits===null||settlement.providerRequestId!==payload.providerRequestId||r11Hash(payload.collection)!==payload.collectionHash||r11Hash(payload.lineage)!==payload.lineageHash||canonical(payload.collection)!==payload.collectionCanonical||canonical(payload.lineage)!==payload.lineageCanonical)return error('Inert collection lineage unavailable');
   const saved={id:r11Scope.collectionId,policyId:proof.policyId,collection:payload.collection,collectionHash:payload.collectionHash,lineage:payload.lineage,lineageHash:payload.lineageHash,selector:{requestHash:payload.selectorRequestHash,wireHash:payload.selectorWireHash,wireBytes:payload.selectorWireBytes,maxTokens:payload.selectorMaxTokens}};
   if(!research.collections.some(item=>item.policyId===proof.policyId)){research.collections.push(saved);effects.push({kind:'in-memory-r11-collection',business,policyId:proof.policyId,collectionId:saved.id});}
   return ok({collectionId:saved.id,collectionHash:saved.collectionHash,lineageHash:saved.lineageHash,replayed:false});
  }
  if(args.p_operation==='complete'){
   if(control.r11CompleteFailure)return error('Inert durable result unavailable');
   const collection=research.collections.find(item=>item.policyId===proof.policyId),marker=research.markers.find(item=>item.policyId===proof.policyId&&item.phase==='select'),settlement=research.settlements.find(item=>item.requestId===marker?.requestId);
   if(!collection||!marker||!settlement||settlement.actualMicrounits===null||payload.collectionId!==collection.id||payload.selectorRequestId!==marker.requestId||payload.providerRequestId!==settlement.providerRequestId||canonical(payload.evidencePack)!==payload.evidencePackCanonical||r11Hash(payload.evidencePack)!==payload.evidencePackHash)return error('Inert final result lineage unavailable');
   let result=research.results.find(item=>item.policyId===proof.policyId);
   if(!result){result={resultId:id(911020),policyId:proof.policyId,evidencePack:payload.evidencePack,evidencePackHash:payload.evidencePackHash,collectionId:collection.id,selectorRequestId:marker.requestId,providerRequestId:settlement.providerRequestId,createdAt:new Date().toISOString()};research.results.push(result);effects.push({kind:'in-memory-r11-validated-result',business,policyId:proof.policyId,resultId:result.resultId});}
   return ok({...result,complete:true,replayed:false});
  }
  return error('Inert runtime operation unavailable');
 }catch{return error('Inert research runtime unavailable');}
}
