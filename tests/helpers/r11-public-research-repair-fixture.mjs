import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RESEARCH_KEY,RESEARCH_CAPABILITY,RESEARCH_OWNER,RESEARCH_OTHER,RESEARCH_SESSION,RESEARCH_OTHER_SESSION,RESEARCH_PACK,RESEARCH_WORKFLOW,RESEARCH_DOMAINS,RESEARCH_CLASSES,authenticate,admission,collectionPayload,financial,hash,sha,canonical,value,legacyResearchExposure} from './r11-public-research-fixture.mjs';
import {OWNER_PROOF_KEY,seedOwnerGrant,importOwnerGrant,activateOwnerGrant,completionPayload} from './r11-public-research-owner-proof.mjs';

// Inert isolated SQL helpers. No provider transport, production URL or credential access.
export const REPAIR_REASONS=['provider_response_invalid','response_model_unqualified','response_provider_unqualified','source_contract_invalid','collection_persistence_failed','selector_output_invalid','result_persistence_failed','cost_unverified_or_over_cap','internal_failure'];
export const REPAIR_PROVIDER_ERRORS=['configuration_required','authentication_required','rate_limited','provider_timeout','provider_unavailable','provider_rejected','malformed_model_output','tool_qualification_failed'];
export const researchV2=(db,s,operation,payload,key=s.serverKey??RESEARCH_KEY)=>value(db,'select public.r11_research_server_v2($1,$2,$3,$4) result',[s.businessId,operation,payload,key]);
export const repairWorkspace=(db,s)=>value(db,'select public.r11_research_workspace_v2($1) result',[s.businessId]);
export const repairStop=(db,s)=>value(db,'select public.r11_research_stop_v2($1,$2) result',[s.businessId,s.policy.id]);
export const repairContinue=(db,s,grantHash=s.grantHash)=>value(db,'select public.r11_research_continue($1,$2,$3) result',[s.businessId,s.grant.id,grantHash]);
export const repairAdmission=(s,phase='search',overrides={})=>admission(s,phase,{...(s.operationKeys?{operationKey:s.operationKeys[phase]}:{}),runtimeCapability:s.runtimeCapability??RESEARCH_CAPABILITY,...overrides});
export const repairGuard=(db,s,phase='search',overrides={},payloadOverrides={})=>researchV2(db,s,'guard',{policyId:s.policy.id,phase,collectionId:phase==='search'?null:s.collectionId,admission:repairAdmission(s,phase,overrides),...payloadOverrides});
export const repairSettle=(db,s,requestId,providerRequestId=`inert-repair-${randomUUID()}`,actual='20')=>financial(db,s,'settle',{requestId,currency:'USD',actualMicrounits:actual,providerRequestId,receiptHash:hash({requestId,actual,providerRequestId})},s.serverKey??RESEARCH_KEY);
export const repairObservation=(s,overrides={})=>({modelIdentity:'request_alias',observedModelId:s.policy.modelId,providerIdentity:'exact',observedProvider:'Azure',finishReason:'stop',searchRequests:1,annotationCount:1,approvedDomainCounts:s.policy.allowedDomains.map((domain,index)=>({domain,count:index===0?1:0})),rejectedDomainCount:0,malformedAnnotationCount:0,providerError:null,...overrides});
export const emptyRepairObservation=(s)=>({modelIdentity:'missing',observedModelId:null,providerIdentity:'missing',observedProvider:null,finishReason:'missing',searchRequests:null,annotationCount:null,approvedDomainCounts:(s?.policy.allowedDomains??RESEARCH_DOMAINS).map(domain=>({domain,count:0})),rejectedDomainCount:0,malformedAnnotationCount:0,providerError:null});
export const repairFailure=(s,phase='none',requestId=null,overrides={})=>({policyId:s.policy.id,phase,requestId,reason:'internal_failure',observation:emptyRepairObservation(s),...overrides});
export const repairFail=(db,s,payload=repairFailure(s),key=s.serverKey??RESEARCH_KEY)=>researchV2(db,s,'fail',payload,key);
export async function repairCollect(db,s){
 const marked=await repairGuard(db,s);assert.equal(marked.shouldDispatch,true);
 const receipt=`inert-repair-search-${randomUUID()}`;await repairSettle(db,s,marked.requestId,receipt);
 const payload=collectionPayload(s,marked.requestId,receipt),result=await researchV2(db,s,'collect',payload);
 s.collectionId=result.collectionId;s.lineage=payload.lineage;
 return{marked,payload,result,collection:payload.collection};
}
export async function prepareRepairCompletion(db,s){
 return prepareRepairSelectorCompletion(db,s,await repairCollect(db,s));
}
export async function prepareRepairSelectorCompletion(db,s,collected){
 const marked=await repairGuard(db,s,'select');assert.equal(marked.shouldDispatch,true);
 const receipt=`inert-repair-selector-${randomUUID()}`;await repairSettle(db,s,marked.requestId,receipt);
 return{...collected,selected:marked,completion:completionPayload(s,collected.collection,marked.requestId,receipt)};
}
export const repairPolicy=async(db,s)=>(await repairWorkspace(db,s)).policies.find(p=>p.policyId===s.policy.id);
export const workflowStatus=(db,s)=>value(db,'select status result from public.workflow_runs where id=$1',[s.workflowRunId]);
export const r05FunctionSnapshot="select p.oid::regprocedure::text id,pg_get_functiondef(p.oid) body,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' and p.proname like 'r05_%' order by 1";
export async function repairStateSnapshot(db,s){
 const tables=['r05_requests','r05_reservations','r05_markers','r05_settlements','r05_receipt_claims','r11_research_policies','r11_research_bindings','r11_research_collections','r11_research_results'];
 const rows={};for(const table of tables)rows[table]=(await db.query(`select to_jsonb(t) row from private.${table} t where business_id=$1 order by to_jsonb(t)::text`,[s.businessId])).rows;
 rows.revocations=(await db.query('select to_jsonb(r) row from private.r11_research_revocations r join private.r11_research_policies p on p.id=r.policy_id where p.business_id=$1 order by r.policy_id',[s.businessId])).rows;
 rows.workflow=await value(db,'select to_jsonb(w) result from public.workflow_runs w where id=$1',[s.workflowRunId]);
 return rows;
}

export const importContinuationGrant=(db,s)=>db.query('insert into private.r11_research_continuation_grants(id,business_id,owner_id,grant_json,grant_canonical,grant_hash) values($1,$2,$3,$4,$5,$6)',[s.grant.id,s.businessId,s.grant.ownerId,s.grant,canonical(s.grant),s.grantHash]);
export async function setupContinuationFixture(db,{windowMs=240000}={}){
 const validFrom=new Date(Date.now()-5000).toISOString(),validUntil=new Date(Date.now()+windowMs).toISOString();
 await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)',[RESEARCH_OWNER,'r11-repair@example.invalid',RESEARCH_OTHER,'r11-repair-other@example.invalid']);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2),($3,$4)',[RESEARCH_SESSION,RESEARCH_OWNER,RESEARCH_OTHER_SESSION,RESEARCH_OTHER]);
 await db.query("insert into public.packs(id,pack_key,version,name,kind,status) values($1,'r11.research.inert','1.0.0','R11 inert repair SQL only','workflow','qualified')",[RESEARCH_PACK]);
 await db.query("insert into public.workflow_definitions(id,pack_id,workflow_key,version,name,status) values($1,$2,'r11.research.inert','1.0.0','R11 inert repair','qualified')",[RESEARCH_WORKFLOW,RESEARCH_PACK]);
 for(const [operation,liability] of [['research.search',149560],['research.model',26311]])await db.query("insert into private.r05_operations values($1,$2,$3,'openrouter','inert/model','Research planning','USD','model',10000,4000,$4,$5,$6,repeat('a',64),repeat('b',64),repeat('c',64),$7,$8)",[operation,RESEARCH_PACK,RESEARCH_WORKFLOW,liability,JSON.stringify(RESEARCH_DOMAINS),JSON.stringify(RESEARCH_CLASSES),validFrom,validUntil]);
 await db.query("insert into private.r05_server_keys values($1,$2::timestamptz+interval '20 minutes')",[sha(OWNER_PROOF_KEY),validUntil]);await authenticate(db);
 return{validFrom,validUntil};
}
export async function seedContinuationPredecessor(db,options){
 const s=await seedOwnerGrant(db,{...options,expectedExposure:'598063',enroll:false});s.serverKey=OWNER_PROOF_KEY;
 s.grant.researchPolicy.searchMicrousd=149560;s.grant.researchPolicy.selectorMicrousd=26311;
 s.grant.operatingPolicy.operations[0].maximumPerOperationMicrounits='149560';s.grant.operatingPolicy.operations[1].maximumPerOperationMicrounits='26311';s.grantHash=hash(s.grant);await importOwnerGrant(db,s);
 const historicalGoalId=randomUUID(),historicalWorkflowRunId=randomUUID();
 await db.query("insert into public.goals(id,business_id,title,description,status) values($1,$2,'Historical research','Original objective','draft')",[historicalGoalId,s.businessId]);
 await db.query("insert into public.workflow_runs(id,business_id,goal_id,workflow_definition_id,idempotency_key,status,state) values($1,$2,$3,$4,$5,'completed',$6)",[historicalWorkflowRunId,s.businessId,historicalGoalId,RESEARCH_WORKFLOW,`inert-historical-${randomUUID()}`,{legacyAllowanceMicrousd:2000000,legacyRemainingMicrousd:1890520}]);
 const reservation=await legacyResearchExposure(db,{...s,workflowRunId:historicalWorkflowRunId},598063);
 await db.query("insert into public.product_research_cost_settlements(business_id,reservation_id,reported_microusd,provider_request_id,fingerprint) values($1,$2,598063,$3,$4)",[s.businessId,reservation,`inert-historical-${randomUUID()}`,sha(reservation)]);
 await activateOwnerGrant(db,s);s.operatingPayload={...s.grant.operatingPolicy,goalId:s.goalId};s.historicalWorkflowRunId=historicalWorkflowRunId;
 const marked=await repairGuard(db,s);assert.equal(marked.shouldDispatch,true);await repairSettle(db,s,marked.requestId,`inert-predecessor-${randomUUID()}`,'10068');await repairStop(db,s);
 return s;
}
export async function seedContinuationGrant(db,predecessor,{enroll=true,maximumMicrousd=239932,validFrom=new Date(Date.now()-5000).toISOString(),validUntil=new Date(Date.now()+240000).toISOString()}={}){
 const continuation=(await repairWorkspace(db,predecessor)).continuation;
 assert.ok(continuation,'Stopped predecessor must expose a continuation context');assert.equal(continuation.eligible,true);
 const policyId=randomUUID(),workflowRunId=randomUUID(),runtimeCapability=`inert-r11v2-runtime-${randomUUID()}`,serverKey=`inert-r11v2-authority-${randomUUID()}`;
 const operationKeys={search:`research.search.r11v2.${policyId}`,select:`research.model.r11v2.${policyId}`};
 await db.query("insert into private.r05_server_keys values($1,$2::timestamptz+interval '20 minutes')",[sha(serverKey),validUntil]);
 for(const [phase,oldKey] of [['search','research.search'],['select','research.model']])await db.query("insert into private.r05_operations select $1,pack_id,workflow_definition_id,provider,provider_model_id,purpose,currency,category,maximum_request_bytes,maximum_output_tokens,liability_microunits,source_domains,data_classes,qualification_hash,eligibility_hash,quote_hash,$2::timestamptz,$3::timestamptz from private.r05_operations where operation_key=$4",[operationKeys[phase],validFrom,validUntil,oldKey]);
 const businessContent=await value(db,'select v.content result from private.r04_business_state s join private.r04_business_versions v using(business_id,revision) where s.business_id=$1',[predecessor.businessId]);
 const goalContent=await value(db,'select v.content result from private.r04_goal_state s join private.r04_goal_versions v using(goal_id,business_id,revision) where s.goal_id=$1',[predecessor.goalId]);
 const researchPolicy=structuredClone(predecessor.policy);for(const key of ['id','businessId','ownerId','workflowRunId','goalId','operatingPolicyId'])delete researchPolicy[key];Object.assign(researchPolicy,{validFrom,validUntil,quoteValidUntil:validUntil,maximumMicrousd,quoteHash:'c'.repeat(64)});
 const operatingPolicy={...structuredClone(predecessor.operatingPayload),goalRevision:continuation.goalRevision+2,businessRevision:continuation.businessRevision+1,businessLifetimeLimitMicrounits:continuation.lifetimeCapMicrounits,policyLimitMicrounits:String(maximumMicrousd),categoryLimits:[{category:'model',microunits:String(maximumMicrousd)}],expectedCapRevision:continuation.capRevision,expectedExposureMicrounits:continuation.exposureMicrounits,startsAt:validFrom,expiresAt:validUntil,maximumDispatches:2};delete operatingPolicy.goalId;
 operatingPolicy.operations=operatingPolicy.operations.filter(op=>op.operationKey.startsWith('research.')).map(op=>({...op,operationKey:operationKeys[op.operationKey==='research.search'?'search':'select']}));
 const search={requestHash:sha(`continuation-logical-${policyId}`),wireHash:sha(`continuation-wire-${policyId}`),wireBytes:1000,maxTokens:4000};
 const grant={version:'r11.owner-continuation-grant.1',id:randomUUID(),businessId:predecessor.businessId,ownerId:RESEARCH_OWNER,policyId,workflowRunId,runtimeCapabilityHash:sha(runtimeCapability),serverKeyHash:sha(serverKey),installationId:predecessor.installationId,installationSnapshotHash:hash({}),workflowDefinitionId:RESEARCH_WORKFLOW,continuation,businessContent,goalContent,operatingPolicy,researchPolicy,search,interpretationHash:'6'.repeat(64),approvalHash:researchPolicy.approvalHash};
 const s={businessId:predecessor.businessId,installationId:predecessor.installationId,goalId:predecessor.goalId,workflowRunId,search,grant,grantHash:hash(grant),runtimeCapability,serverKey,operationKeys,predecessor};
 if(enroll)await importContinuationGrant(db,s);return s;
}
export async function activateContinuation(db,s,activatedResult){
 const result=activatedResult??await repairContinue(db,s),loaded=await researchV2(db,s,'load',{policyId:s.grant.policyId});
 s.policy=loaded.policy;s.policyHash=loaded.policyHash;s.operatingPolicyId=s.policy.operatingPolicyId;s.operatingPayload={...s.grant.operatingPolicy,goalId:s.goalId};
 return{result,loaded};
}
export async function continuationStateSnapshot(db,s){
 const rows={};for(const table of ['r04_business_state','r04_business_versions','r04_goal_state','r04_goal_versions','r05_policies','r05_confirmations','r05_cap_versions','r11_research_policies','r11_research_attempts'])rows[table]=(await db.query(`select to_jsonb(t) row from private.${table} t where business_id=$1 order by to_jsonb(t)::text`,[s.businessId])).rows;
 rows.workflow_runs=(await db.query('select to_jsonb(w) row from public.workflow_runs w where business_id=$1 order by id',[s.businessId])).rows;
 return rows;
}

export async function addRepairExposure(db,s,amount=1){
 const id=randomUUID();await db.query("insert into public.product_research_cost_reservations(id,business_id,experiment_id,workflow_run_id,attempt_key,reserved_microusd,request_hash,estimate) select $1,business_id,id,workflow_run_id,'search:luna.standard',$3,$4,'{}' from public.product_experiments where business_id=$2 order by created_at,id limit 1",[id,s.businessId,amount,sha(id)]);return id;
}
