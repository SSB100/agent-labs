import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';

// Entirely inert administrative authority. No fixture makes a provider request.
export const RESEARCH_KEY='inert-r11-public-research-authority-only-123456789';
export const RESEARCH_CAPABILITY='inert-r11-public-research-runtime-only-123456789';
export const RESEARCH_OWNER='95110000-0000-4000-8000-000000000001';
export const RESEARCH_OTHER='95110000-0000-4000-8000-000000000002';
export const RESEARCH_PACK='95110000-0000-4000-8000-000000000011';
export const RESEARCH_WORKFLOW='95110000-0000-4000-8000-000000000012';
export const RESEARCH_DOMAINS=['gardening.example','retail.example'];
export const RESEARCH_CLASSES=['generic_public_query','public_evidence'];
export const sha=value=>createHash('sha256').update(value).digest('hex');
export const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
export const hash=value=>sha(canonical(value));
export const value=async(db,sql,args=[])=>(await db.query(sql,args)).rows[0]?.result;
export const authenticate=(db,user=RESEARCH_OWNER)=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
export function validateResearchPostgresUrl(url){
 const u=new URL(url);
 assert.ok(['postgres:','postgresql:'].includes(u.protocol)&&u.hostname==='127.0.0.1'&&u.username==='r11_test'&&u.pathname==='/r11_research_test'&&!u.search&&!u.hash,'Only fresh isolated loopback r11_test/r11_research_test is allowed');
 if(u.port)assert.ok(Number(u.port)>=1024&&Number(u.port)<=65535,'Invalid isolated PostgreSQL port');
 return url;
}
export async function setupResearchFixture(db,{modelId='inert/model',registryValidUntil=null}={}){
 await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)',[RESEARCH_OWNER,'r11-research@example.invalid',RESEARCH_OTHER,'r11-other@example.invalid']);
 await db.query("insert into public.packs(id,pack_key,version,name,kind,status) values($1,'r11.research.inert','1.0.0','R11 inert research SQL only','workflow','qualified')",[RESEARCH_PACK]);
 await db.query("insert into public.workflow_definitions(id,pack_id,workflow_key,version,name,status) values($1,$2,'r11.research.inert','1.0.0','R11 inert research','qualified')",[RESEARCH_WORKFLOW,RESEARCH_PACK]);
 for(const [operation,liability,domains,classes] of [
  ['research.search',60,RESEARCH_DOMAINS,RESEARCH_CLASSES],['research.model',40,RESEARCH_DOMAINS,RESEARCH_CLASSES],
  ['creative.text',40,[],['business_context']],['creative.image',40,RESEARCH_DOMAINS,RESEARCH_CLASSES],
 ])await db.query("insert into private.r05_operations values($1,$2,$3,'openrouter',$7,'Research planning','USD','model',10000,4000,$4,$5,$6,repeat('a',64),repeat('b',64),repeat('c',64),clock_timestamp()-interval '1 hour',coalesce($8::timestamptz,clock_timestamp()+interval '1 day'))",[operation,RESEARCH_PACK,RESEARCH_WORKFLOW,liability,JSON.stringify(domains),JSON.stringify(classes),modelId,registryValidUntil]);
 await db.query("insert into private.r05_server_keys values($1,clock_timestamp()+interval '1 day')",[sha(RESEARCH_KEY)]);
 await authenticate(db);
}
const transition=(db,business,operation,payload)=>value(db,'select public.r04_quest_transition($1,$2,$3,$4) result',[business,operation,payload,randomUUID()]);
export const financialOwner=(db,s,operation,payload)=>value(db,'select public.r05_policy_owner($1,$2,$3,$4) result',[s.businessId,operation,payload,randomUUID()]);
export const financial=(db,s,operation,payload,key=RESEARCH_KEY)=>value(db,'select public.r05_admission_server($1,$2,$3,$4) result',[s.businessId,operation,payload,key]);
export const research=(db,s,operation,payload,key=RESEARCH_KEY)=>value(db,'select public.r11_research_server($1,$2,$3,$4) result',[s.businessId,operation,payload,key]);
export const revoke=(db,s)=>value(db,'select public.r11_research_revoke($1,$2) result',[s.businessId,s.policy.id]);
export async function seedResearch(db,{ceiling=200,policyOverrides={},enroll=true,operatingExpiresAt=null,proofValidUntil=null}={}){
 await authenticate(db);
 const businessId=randomUUID(),installationId=randomUUID(),workflowRunId=randomUUID();
 await db.query('insert into public.businesses(id,owner_user_id,name) values($1,$2,$3)',[businessId,RESEARCH_OWNER,'R11 isolated public research']);
 await transition(db,businessId,'business.save',{expectedRevision:0,content:{brandContext:'Original research',operatingRules:'Only finite model costs',allowedActivity:'Research planning',restrictions:'No commerce'},preference:'setup'});
 const goal=await transition(db,businessId,'quest.save',{goalId:null,expectedRevision:0,content:{title:'Research',originalIntent:'Research one market',objective:'Research one market',parsed:{target:{amount:'1',currency:null,metric:'units'},budget:{amount:'1',currency:'USD'},deadline:{date:`${new Date().getUTCFullYear()+1}-12-31`,time:'12:00',timezone:'UTC'},scope:'Research planning',geography:['New Zealand'],stopConstraints:['No commerce']},ambiguities:[]}});
 await transition(db,businessId,'quest.preference',{goalId:goal.id,expectedRevision:1,preference:'ready'});
 await db.query("insert into public.installed_packs(id,business_id,root_pack_id,root_pack_key,status,snapshot) values($1,$2,$3,'r11.research.inert','active','{}')",[installationId,businessId,RESEARCH_PACK]);
 await db.query("insert into public.workflow_runs(id,business_id,goal_id,workflow_definition_id,idempotency_key,status,runtime_capability_hash,pack_installation_id,pack_snapshot) values($1,$2,$3,$4,'r11-inert','running',$5,$6,'{}')",[workflowRunId,businessId,goal.id,RESEARCH_WORKFLOW,sha(RESEARCH_CAPABILITY),installationId]);
 const now=Date.now(),s={businessId,workflowRunId,goalId:goal.id,installationId};
 const operatingPayload={version:'r05.1',goalId:goal.id,goalRevision:2,businessRevision:1,currency:'USD',businessLifetimeLimitMicrounits:String(ceiling),policyLimitMicrounits:String(ceiling),categoryLimits:[{category:'model',microunits:String(ceiling)}],expectedCapRevision:0,expectedExposureMicrounits:'0',startsAt:new Date(now-60000).toISOString(),expiresAt:operatingExpiresAt??new Date(now+3600000).toISOString(),maximumDispatches:10,minimumIntervalSeconds:0,stopOnTarget:false,financialMode:'bounded_model_cost_only',operations:[]};
 for(const [operationKey,liability,sourceDomains,dataClasses] of [['research.search',60,RESEARCH_DOMAINS,RESEARCH_CLASSES],['research.model',40,RESEARCH_DOMAINS,RESEARCH_CLASSES],['creative.text',40,[],['business_context']],['creative.image',40,RESEARCH_DOMAINS,RESEARCH_CLASSES]])operatingPayload.operations.push({operationKey,installationId,workflowDefinitionId:RESEARCH_WORKFLOW,purpose:'Research planning',provider:'openrouter',category:'model',accountId:null,accountRevision:null,sourceDomains,dataClasses,maximumPerOperationMicrounits:String(liability)});
 const op=await financialOwner(db,s,'propose',operatingPayload);
 await financialOwner(db,s,'confirm',{policyId:op.id,policyHash:op.hash});
 await db.query("insert into private.r05_policy_proofs values($1,$2,repeat('d',64),coalesce($3::timestamptz,clock_timestamp()+interval '1 day'))",[op.id,op.hash,proofValidUntil]);
 const query='What public reports describe adult gardening gift formats and practical preferences?';
 s.operatingPolicyId=op.id;s.operatingPolicyHash=op.hash;s.operatingPayload=operatingPayload;
 s.policy={version:'r11.public-research.1',id:randomUUID(),businessId,ownerId:RESEARCH_OWNER,workflowRunId,goalId:goal.id,operatingPolicyId:op.id,query,allowedDomains:[...RESEARCH_DOMAINS],excludedDomains:['etsy.com','etsy.me','etsystatic.com'],sourceReviews:RESEARCH_DOMAINS.map(domain=>({domain,basis:'documented_api_factual_snippets',reviewHash:'1'.repeat(64)})),queryReviewHash:hash({query,classification:'generic_nonpersonal_public_research'}),termsReviewHash:'2'.repeat(64),independentReviewHash:'3'.repeat(64),approvalHash:'4'.repeat(64),modelId:'inert/model',providerEndpoint:'azure/us',recipients:{router:'openrouter.ai',search:'exa.ai',inferenceEndpoint:'azure/us'},retention:{inference:'no_training_zdr',search:'query_retention_improvement_training_possible',application:'bounded_attributed_audit_evidence'},validFrom:new Date(now-60000).toISOString(),validUntil:new Date(now+3600000).toISOString(),maximumMicrousd:100,searchMicrousd:60,selectorMicrousd:40,priceLimit:{prompt:0.44,completion:1.98,request:0},quoteHash:'5'.repeat(64),quoteValidUntil:new Date(now+3600000).toISOString(),...policyOverrides};
 s.policyHash=hash(s.policy);s.search={requestHash:sha(`search-logical-${s.policy.id}`),wireHash:sha(`search-wire-${s.policy.id}`),wireBytes:1000,maxTokens:4000};
 if(enroll)await enrollResearch(db,s);
 return s;
}
export const enrollResearch=(db,s)=>db.query('insert into private.r11_research_policies(id,business_id,owner_id,workflow_run_id,goal_id,operating_policy_id,policy,policy_canonical,policy_hash,search_request_hash,search_wire_hash,search_wire_bytes,search_max_tokens) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[s.policy.id,s.businessId,s.policy.ownerId,s.workflowRunId,s.goalId,s.operatingPolicyId,s.policy,canonical(s.policy),s.policyHash,s.search.requestHash,s.search.wireHash,s.search.wireBytes,s.search.maxTokens]);
export function admission(s,phase='search',overrides={}){
 const wire=phase==='search'?s.search:s.selector;
 return {workflowRunId:s.workflowRunId,runtimeCapability:RESEARCH_CAPABILITY,operationKey:phase==='search'?'research.search':'research.model',requestHash:wire.requestHash,wireRequestHash:wire.wireHash,wireRequestBytes:wire.wireBytes,idempotencyKey:`r11:${s.policy.id}:${phase}`,providerModelId:s.policy.modelId,maximumOutputTokens:wire.maxTokens,accounting:{kind:'r05'},sourceDomains:s.policy.allowedDomains,dataClasses:[...RESEARCH_CLASSES],accountId:null,accountRevision:null,currency:'USD',liabilityMicrounits:String(phase==='search'?s.policy.searchMicrousd:s.policy.selectorMicrousd),...overrides};
}
export const guard=(db,s,phase='search',overrides={},payloadOverrides={})=>research(db,s,'guard',{policyId:s.policy.id,phase,collectionId:phase==='search'?null:s.collectionId,admission:admission(s,phase,overrides),...payloadOverrides});
export const settle=(db,s,requestId,providerRequestId=`inert-${randomUUID()}`,actual='20')=>financial(db,s,'settle',{requestId,currency:'USD',actualMicrounits:actual,providerRequestId,receiptHash:hash({requestId,actual,providerRequestId})});
export function collectionPayload(s,searchRequestId,providerRequestId){
 const now=Date.now(),excerpt='Adult gardeners often value practical tools and containers suited to their available growing space. This observation does not establish sales or profitability.',contentHash=sha(excerpt),url='https://gardening.example/report',sourceId=`src-${sha(`${url}:${contentHash}`).slice(0,24)}`;
 const collection={collectionVersion:'1.0',query:s.policy.query,sources:[{id:sourceId,url,title:'Independent gardening report',retrievedAt:new Date(now).toISOString(),publishedAt:null,retrievalExpiresAt:new Date(now+86400000).toISOString(),contentHash,excerpt,provider:'openrouter.exa'}],evidence:[{id:`evi-${sha(`${sourceId}:${excerpt.slice(0,320)}`).slice(0,24)}`,sourceId,quote:excerpt.slice(0,320)}],providerMetadata:{providerRequestId,policyId:s.policy.id,policyHash:s.policyHash,searchRequestId,searchRequests:1,engine:'exa',requestedInferenceEndpoint:s.policy.providerEndpoint}};
 const collectionHash=hash(collection),lineage={version:s.policy.version,policyId:s.policy.id,policyHash:s.policyHash,collectionHash,searchRequestId,providerRequestId,sourceDomains:s.policy.allowedDomains};
 s.selector={requestHash:sha(`select-logical-${collectionHash}`),wireHash:sha(`select-wire-${collectionHash}`),wireBytes:2000,maxTokens:1000};
 return {policyId:s.policy.id,searchRequestId,providerRequestId,collection,collectionCanonical:canonical(collection),collectionHash,lineage,lineageCanonical:canonical(lineage),lineageHash:hash(lineage),selectorRequestHash:s.selector.requestHash,selectorWireHash:s.selector.wireHash,selectorWireBytes:s.selector.wireBytes,selectorMaxTokens:s.selector.maxTokens};
}
export async function collectedResearch(db,s){
 const marked=await guard(db,s);assert.equal(marked.shouldDispatch,true);
 const providerRequestId=`inert-${randomUUID()}`;await settle(db,s,marked.requestId,providerRequestId);
 const payload=collectionPayload(s,marked.requestId,providerRequestId),result=await research(db,s,'collect',payload);s.collectionId=result.collectionId;
 return {marked,payload,result};
}
export async function counts(db,s){
 return (await db.query('select (select count(*)::int from private.r05_requests where business_id=$1) requests,(select count(*)::int from private.r05_reservations where business_id=$1) reservations,(select count(*)::int from private.r05_markers where business_id=$1) markers,(select count(*)::int from private.r11_research_bindings where business_id=$1) bindings,(select count(*)::int from private.r11_research_collections where business_id=$1) collections',[s.businessId])).rows[0];
}
export function recanonicalizeCollection(payload){
 payload.collectionCanonical=canonical(payload.collection);payload.collectionHash=hash(payload.collection);payload.lineage.collectionHash=payload.collectionHash;payload.lineageCanonical=canonical(payload.lineage);payload.lineageHash=hash(payload.lineage);return payload;
}
export async function legacyResearchExposure(db,s,amount=40){
 const candidate=randomUUID(),experiment=randomUUID(),reservation=randomUUID();
 await db.query("insert into public.product_candidates(id,business_id,fingerprint,concept,audience,hypothesis,original_design,rights_status,source_domains) values($1,$2,repeat('a',64),'Original design','Adult audience','An inert research hypothesis',true,'confirmed',array['example.invalid'])",[candidate,s.businessId]);
 await db.query("insert into public.product_experiments(id,business_id,candidate_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan) values($1,$2,$3,$4,repeat('b',64),'An inert research hypothesis','{}','Adult audience','reserved',private.stage13_plan())",[experiment,s.businessId,candidate,s.workflowRunId]);
 await db.query("insert into public.product_research_cost_reservations(id,business_id,experiment_id,workflow_run_id,attempt_key,reserved_microusd,request_hash,estimate) values($1,$2,$3,$4,'selector:luna.standard',$5,repeat('e',64),'{}')",[reservation,s.businessId,experiment,s.workflowRunId,amount]);
 return reservation;
}
