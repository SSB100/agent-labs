/** Inert, genuine four-plan owner history plus a newly reviewed V2 adaptive grant.
 * Preparation and planner preflight are real; no adaptive provider call occurs. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {exerciseFourPlanResearchHistory} from './r12-adaptive-history-fixture.mjs';
import {appendOwnerGrantRootRevision} from './r12-owner-grant-extension-sql-fixture.mjs';
import {one,sha} from './r12-owner-initial-sql-fixture.mjs';
import {r12CatalogFixture} from './r12-provider-fixture.mjs';
import {qualifyAdaptiveResearchQuote} from '../../.core-tests/products/discovery-r12-adaptive-quote.js';
import {preflightAdaptiveOwnerPlanner} from '../../.core-tests/products/discovery-r12-adaptive-planner-preflight.js';
import {discoveryV2Hash} from '../../.core-tests/products/discovery-v2.js';

export async function prepareFourPlanAdaptiveFixture(db,{legacy=null}={}){
 return exerciseFourPlanResearchHistory(db,{legacy,onClosed:async({f,predecessor,history})=>{
  // A normal owner revises only the same Goal's amount after every predecessor
  // has closed. The old plan/attempt/response rows are never rewritten.
  const updated={...f.content,parsed:{...f.content.parsed,budget:{amount:'10',currency:'USD'}}};
  const head=await one(db,'select revision from private.r04_goal_state where goal_id=$1',[f.goalId]);
  await f.rpc('r04_quest_transition',[f.businessId,'quest.save',{goalId:f.goalId,expectedRevision:head.revision,content:updated},randomUUID()]);
  const draft=await one(db,'select revision from private.r04_goal_state where goal_id=$1',[f.goalId]);
  await f.rpc('r04_quest_transition',[f.businessId,'quest.preference',{goalId:f.goalId,expectedRevision:draft.revision,preference:'ready'},randomUUID()]);
  const goal=await one(db,'select v.* from private.r04_goal_versions v join private.r04_goal_state s using(goal_id,business_id,revision) where v.goal_id=$1',[f.goalId]);
  const revision=await appendOwnerGrantRootRevision(db,f.rootId,{maximumScopes:5,maximumAllocationMicrounits:'18000000',expiresAt:f.profile.validUntil});
  const profile={...f.profile,version:'r12.owner-research-profile.2',id:randomUUID(),maximumRunMicrousd:10000000};
  const profileHash=discoveryV2Hash(profile),grantId=randomUUID(),key='inert-adaptive-bootstrap-'+randomUUID();
  await db.query('insert into private.r12_owner_profiles(id,profile,profile_hash,pins,pins_hash) values($1,$2,$3,$4,$5)',
   [profile.id,profile,profileHash,f.pins,discoveryV2Hash(f.pins)]);
  const bounds={version:'r12.owner-adaptive-grant.1',goalId:f.goalId,goalRevision:goal.revision,goalHash:goal.content_hash,
   profileHash,maximumActions:10,maximumRunMicrounits:'10000000',expiresAt:f.profile.validUntil,
   rootRevision:revision.revision,rootRevisionHash:revision.hash,allowsPaidFollowups:true};
  await db.query(`insert into private.r12_owner_bootstrap_grants(id,root_id,business_id,owner_id,business_revision,business_hash,
   profile_id,maximum_scopes,maximum_allocation_microunits,server_key_hash,approval_hash,valid_from,valid_until,
   adaptive_bounds,root_revision,root_revision_hash) values($1,$2,$3,$4,$5,$6,$7,5,18000000,$8,$9,$10,$11,$12,$13,$14)`,
   [grantId,f.rootId,f.businessId,f.ownerId,f.businessRevision,f.businessHash,profile.id,sha(key),'9'.repeat(64),
    profile.validFrom,profile.validUntil,bounds,revision.revision,revision.hash]);
  const catalog=await f.rpc('r12_owner_adaptive_read',[f.businessId,f.goalId,null]);
  assert.equal(catalog.eligible,true);
  assert.equal(catalog.grants.length,1);
  const quote=qualifyAdaptiveResearchQuote(r12CatalogFixture());
  const baseInput={businessId:f.businessId,goalId:f.goalId,goalRevision:goal.revision,profileId:profile.id,profileHash,
   grantId,marketSetKey:'gb',topicKey:'astronomy',maximumActions:10,maximumRunMicrounits:'10000000',ownerObservationRef:null,
   predecessorPlanId:predecessor.predecessorPlanId,predecessorPlanHash:predecessor.predecessorPlanHash,
   predecessorScopeId:predecessor.predecessorScopeId,predecessorScopeHash:predecessor.predecessorScopeHash,
   businessLifetimeLimitMicrounits:String(Math.max(Number(catalog.business.currentLimitMicrounits),Number(catalog.business.committedMicrounits)+10000000)),
   researchLifetimeLimitMicrounits:String(Math.max(Number(catalog.funding.currentLimitMicrounits),Number(catalog.funding.committedMicrounits)+10000000))};
  const prepare=async(changes={})=>{
   const input={...baseInput,submissionId:randomUUID(),...changes};
   const prepared=await f.rpc('r12_owner_adaptive_server',[f.businessId,'prepare',{input,quote},key]);
   const packet=await f.rpc('r12_owner_adaptive_preflight',[f.businessId,prepared.setupId,prepared.setupHash,quote]);
   const preflight=await preflightAdaptiveOwnerPlanner(packet,quote);
   const confirmPayload={businessId:f.businessId,setupId:prepared.setupId,setupHash:prepared.setupHash,
    submissionId:randomUUID(),quote,preflight,
    controllerKeyHash:sha('inert-adaptive-controller-'+prepared.scopeId),
    admissionKeyHash:sha('inert-adaptive-admission-'+prepared.scopeId)};
   return {input,prepared,packet,preflight,confirmPayload};
  };
  const first=await prepare();
  const confirm=async(candidate=first)=>f.rpc('r12_owner_adaptive_server',[f.businessId,'confirm',candidate.confirmPayload,key]);
  return {db,f,history,predecessor,goal,revision,profile,profileHash,grantId,key,quote,catalog,
   baseInput,prepare,confirm,...first};
 }});
}
