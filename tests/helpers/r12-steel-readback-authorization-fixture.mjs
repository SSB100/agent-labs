/** Inert original-R11 provenance and one-shot operator review. No provider IO,
 * root renewal, synthetic grant, policy override or source-function stub. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setupResearchFixture,seedResearch,RESEARCH_OWNER,canonical} from './r11-public-research-fixture.mjs';
import {one,hash,sha,readbackTarget,publishReadback} from './r12-steel-readback-sql-fixture.mjs';
export async function originalReadbackR11(db,{key='inert-expired-original-r11-root-'+randomUUID(),context=null}={}){
 if(!await one(db,'select id from auth.users where id=$1',[RESEARCH_OWNER]))await setupResearchFixture(db);
 const original=await seedResearch(db,{enroll:false});
 if(context){
  const op=await one(db,'select id from private.r05_policies where business_id=$1 order by created_at limit 1',[context.businessId]);
  const run=await one(db,'select id from public.workflow_runs where business_id=$1 and goal_id=$2 order by created_at limit 1',[context.businessId,context.goalId]);
  assert.ok(op&&run,'A genuine earlier owner run and operating policy are required');
  Object.assign(original,{businessId:context.businessId,goalId:context.goalId,workflowRunId:run.id,operatingPolicyId:op.id});
  Object.assign(original.policy,{businessId:context.businessId,ownerId:context.ownerId,goalId:context.goalId,workflowRunId:run.id,operatingPolicyId:op.id});
  original.policyHash=hash(original.policy);
 }
 if(!await one(db,'select key_hash from private.r05_server_keys where key_hash=$1',[sha(key)]))await db.query("insert into private.r05_server_keys(key_hash,expires_at) values($1,clock_timestamp()-interval '1 hour')",[sha(key)]);
 const insert=async s=>db.query('insert into private.r11_research_policies(id,business_id,owner_id,workflow_run_id,goal_id,operating_policy_id,policy,policy_canonical,policy_hash,search_request_hash,search_wire_hash,search_wire_bytes,search_max_tokens,authority_key_hash) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[s.policy.id,s.businessId,s.policy.ownerId,s.workflowRunId,s.goalId,s.operatingPolicyId,s.policy,canonical(s.policy),s.policyHash,s.search.requestHash,s.search.wireHash,s.search.wireBytes,s.search.maxTokens,sha(key)]);
 await insert(original);
 const f={businessId:original.businessId,ownerId:original.policy.ownerId,goalId:original.goalId,providerProjectId:randomUUID(),key,original};
 if(!context){
  const saved=await one(db,'select content from private.r04_goal_versions where goal_id=$1 and revision=2',[f.goalId]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.ownerId]);
  const current=(await one(db,"select public.r04_quest_transition($1,'quest.save',$2,$3) result",[f.businessId,{goalId:null,expectedRevision:0,content:{...saved.content,title:'Current metadata-only Goal'}},randomUUID()])).result;
  await db.query("select public.r04_quest_transition($1,'quest.preference',$2,$3)",[f.businessId,{goalId:current.id,expectedRevision:1,preference:'ready'},randomUUID()]);
  f.goalId=current.id;assert.notEqual(f.goalId,original.goalId,'Historical R11 Goal is provenance, not the current metadata Goal');
 }
 f.addAssociation=async()=>{const policy={...original.policy,id:randomUUID()},copy={...original,policy,policyHash:hash(policy)};await insert(copy);return copy;};
 return f;
}
export async function readbackAuthorization(db,f,changes={}){
 const goal=await one(db,'select revision from private.r04_goal_state where goal_id=$1',[f.goalId]);
 const version=await one(db,'select content_hash hash from private.r04_goal_versions where goal_id=$1 and revision=$2',[f.goalId,goal.revision]);
 const body={version:'r12.steel-config-readback-authorization.1',targetHash:f.target.targetHash,businessId:f.businessId,ownerId:f.ownerId,goalId:f.goalId,goalRevision:goal.revision,goalHash:version.hash,serverKeyHash:sha(f.key),r11PolicyId:f.original.policy.id,r11PolicyHash:f.original.policyHash,purpose:'steel_existing_session_readback',approvalHash:hash('inert explicit owner metadata approval'),reviewEvidenceHash:hash('inert independent metadata-only review'),validFrom:new Date().toISOString(),expiresAt:f.target.expiresAt,...changes};
 delete body.authorizationHash;return{...body,authorizationHash:hash(body)};
}
export const publishReadbackAuthorization=async(db,body)=>(await one(db,'select private.r12_steel_publish_readback_authorization($1) result',[body])).result;
export async function authorizedReadbackFixture(db,{publish=true,targetChanges={},authorizationChanges={},key,context}={}){
 const f=await originalReadbackR11(db,{key,context});f.target=readbackTarget(f,targetChanges);await publishReadback(db,f.target);f.authorization=await readbackAuthorization(db,f,authorizationChanges);if(publish)f.authorizationReceipt=await publishReadbackAuthorization(db,f.authorization);return f;
}
export async function stopReadbackGoal(db,f,{business=false,financialPause=false}={}){
 const revision=(await one(db,'select revision from private.r04_goal_state where goal_id=$1',[f.goalId])).revision;
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.ownerId]);await db.exec('set role authenticated');
 try{return(await one(db,business||financialPause?'select public.r05_policy_owner($1,$2,$3,$4) result':'select public.r04_quest_transition($1,$2,$3,$4) result',[f.businessId,business||financialPause?'pause':'quest.preference',business||financialPause?{kind:business?'business':'quest',id:business?f.businessId:f.goalId}:{goalId:f.goalId,expectedRevision:revision,preference:'paused'},randomUUID()])).result;}finally{await db.exec('reset role');}
}
export const readbackPaidCounts=db=>one(db,`select
 (select count(*)::int from private.r05_policies) policies,
 (select count(*)::int from private.r05_requests) requests,
 (select count(*)::int from private.r12_owner_bootstrap_grants) grants,
 (select count(*)::int from private.r12_direct_test_envelopes) envelopes,
 (select count(*)::int from private.r12_direct_browser_routes) routes,
 (select count(*)::int from private.r12_direct_browser_operations) operations,
 (select count(*)::int from private.r12_steel_config_attestations) attestations,
 (select count(*)::int from private.r12_steel_create_config_permits) permits`);
