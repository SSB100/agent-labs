/** Inert, genuine four-plan owner history plus a newly reviewed Etsy-only V3 adaptive grant.
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

export async function prepareFourPlanEtsyFixture(db,{legacy=null}={}){
 return exerciseFourPlanResearchHistory(db,{legacy,onClosed:async({f,predecessor,history})=>{
  // A normal owner revises only the same Goal's amount after every predecessor
  // has closed. The old plan/attempt/response rows are never rewritten.
  const updated={...f.content,parsed:{...f.content.parsed,budget:{amount:'10',currency:'USD'}}};
  const head=await one(db,'select revision from private.r04_goal_state where goal_id=$1',[f.goalId]);
  await f.rpc('r04_quest_transition',[f.businessId,'quest.save',{goalId:f.goalId,expectedRevision:head.revision,content:updated},randomUUID()]);
  const draft=await one(db,'select revision from private.r04_goal_state where goal_id=$1',[f.goalId]);
  await f.rpc('r04_quest_transition',[f.businessId,'quest.preference',{goalId:f.goalId,expectedRevision:draft.revision,preference:'ready'},randomUUID()]);
  const goal=await one(db,'select v.* from private.r04_goal_versions v join private.r04_goal_state s using(goal_id,business_id,revision) where v.goal_id=$1',[f.goalId]);
  const {bundle,ownerObservationRef}=etsyObservationFixture(f.businessId,f.ownerId);
  // Private intake works without any adaptive grant or bootstrap secret.
  assert.equal((await one(db,'select count(*)::int n from private.r12_owner_bootstrap_grants where business_id=$1 and adaptive_bounds is not null',[f.businessId])).n,0);
  const saved=await f.rpc('r12_owner_observation_server',[f.businessId,'save',{bundle},'']);
  assert.deepEqual(saved.bundle,bundle);
  const revision=await appendOwnerGrantRootRevision(db,f.rootId,{maximumScopes:5,maximumAllocationMicrounits:'18000000',expiresAt:f.profile.validUntil});
  const profile={...f.profile,version:'r12.owner-research-profile.3',id:randomUUID(),maximumRunMicrousd:10000000,
   allowedDomains:['etsy.com'],sourceReviews:[{domain:'etsy.com',basis:'owner_reported_capture',reviewHash:'a'.repeat(64)}]};
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
  const quote=qualifyAdaptiveResearchQuote(r12CatalogFixture(),Date.now(),'r12.adaptive-quote.2');
  const baseInput={businessId:f.businessId,goalId:f.goalId,goalRevision:goal.revision,profileId:profile.id,profileHash,
   grantId,marketSetKey:'gb',topicKey:'astronomy',maximumActions:10,maximumRunMicrounits:'10000000',ownerObservationRef,
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
   baseInput,prepare,confirm,bundle,ownerObservationRef,...first};
 }});
}

export function etsyObservationFixture(businessId,ownerId,{sourceUrl='https://www.etsy.com/your/shops/me/stats'}={}){
 const stamp=new Date(Date.now()-1000).toISOString(),windowStart=new Date(Date.now()-86400000).toISOString();
 const observations=['candidate astronomy','candidate stargazing','negative reference'].map((query,i)=>{
  const content=`${query}: conversion Very low. No numeric conversion rate or buyer country was displayed.`;
  return{id:randomUUID(),sourceId:`etsy-owner-${i}`,provenance:'owner_reported_capture',
   source:{url:sourceUrl,interface:'Etsy Shop Manager aggregate capture',capturedAt:stamp,captureHash:String(i+1).repeat(64)},
   context:{productFormat:'Original adult printed T-shirt',category:'Adult apparel',query,windowStart,windowEnd:stamp,
    locale:'en-GB',geography:{kind:'unknown',countries:[],basis:'Buyer segmentation was not displayed.'}},
   content,contentHash:discoveryV2Hash(content),metrics:[{id:'conversion',label:'Conversion band',displayed:'Very low',
    start:0,end:Array.from(content).length,kind:'ordinal',scale:['Very low','Low','High'],value:'Very low',
    definition:'Owner-captured relative band; no numeric rate supplied.'}],
   limitations:['Negative signal retained; no candidate sales or country-level demand demonstrated.'],dataClass:'aggregate_nonpersonal'};
 });
 const c=observations[0].context;
 const baseline={version:'r12.owner-observation-baseline.1',declaredAt:stamp,timing:'retrospective',productFormat:c.productFormat,
  category:c.category,windowStart,windowEnd:stamp,locale:c.locale,candidateObservationIds:observations.slice(0,2).map(o=>o.id),
  referenceObservationId:observations[2].id,hypothesis:'An adult interest may justify a bounded original design learning experiment.',
  positiveCriterion:'Supported contrast supplies an informative bounded learning test.',negativeCriterion:'Contrary observations defeat the premise.',
  inconclusiveCriterion:'Missing comparable exposure leaves demand unknown.'};
 const body={version:'r12.owner-observations.1',id:randomUUID(),businessId,ownerId,createdAt:stamp,observations,baseline,
  privacyAttestation:'reviewed_aggregate_only_no_credentials_or_customer_data'};
 const bundle={...body,bundleHash:discoveryV2Hash(body)};
 const manifest=[{bundleId:bundle.id,bundleHash:bundle.bundleHash,selectedObservationIds:observations.map(o=>o.id)}];
 return {bundle,ownerObservationRef:{manifestHash:discoveryV2Hash(manifest),manifest}};
}

export {bindAdaptivePlanner as bindEtsyPlanner} from './r12-adaptive-postgres-races.mjs';
