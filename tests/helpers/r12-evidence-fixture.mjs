/** Disposable fixture only: actual SQL/operator/owner boundary, inert providers. */
import { randomUUID, createHash, createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { discoveryV2Hash } from '../../.core-tests/products/discovery-v2.js';
import { parseR12ReviewOwnerWorkspace } from '../../.core-tests/products/discovery-r12-review-preparation-contract.js';
import { runOperatorRecipe } from '../../scripts/r12-evidence-continuation-bootstrap.mjs';
import { reviewRecipeClient } from './r12-review-fixture.mjs';
import { r12AddendumFixture } from './r12-addendum-fixture.mjs';
import { r12QuoteFixture } from './r12-provider-fixture.mjs';

export async function prepareR12EvidenceFixture(db, originalMetadata, { nested=false, capture=async()=>{} }={}) {
 const one=async(sql,args=[])=>{try{return(await db.query(sql,args)).rows[0];}catch(error){throw new Error('Evidence fixture query: '+sql.slice(0,160)+' :: '+error.message,{cause:error});}}, client=reviewRecipeClient(db,nested);
 const previous=await one(`select p.*,s.id scope_id,s.amendment,s.amendment_hash from private.r07_heads h join private.r07_plans p on p.id=h.plan_id join private.r12_discovery_scopes s on s.id=(p.content->>'discoveryScopeId')::uuid where p.content->>'format'='r12.discovery-review.1'`);
 assert.equal(previous.version,3);
 const review=await one(`select private.r12_discovery_completed_phase(a,p) phase from private.r07_attempts a join private.r07_plans p on p.id=a.plan_id where p.id=$1 and a.step_key='review'`,[previous.id]);
 assert.equal(review.phase.response.result.outcome,'NEEDS_MORE_EVIDENCE');
 const paid=await one(`select z.receipt_hash,z.actual_microunits::text actual from private.r05_settlements z where z.request_id=$1 order by z.actual_microunits desc nulls last,z.id desc limit 1`,[review.phase.binding.requestId]);
 const original=await one('select * from private.r07_plans where id=$1',[previous.amendment.sourcePlanId]);
 const originalPolicy=await one('select payload from private.r05_policies where id=$1',[original.policy_id]);
 const business=await one('select v.* from private.r04_business_versions v join private.r04_business_state s using(business_id,revision) where business_id=$1',[previous.business_id]);
 const goal=await one('select v.* from private.r04_goal_versions v join private.r04_goal_state s using(goal_id,business_id,revision) where goal_id=$1',[previous.goal_id]);
 const cap=await one("select * from private.r05_cap_versions where business_id=$1 and currency='USD' order by revision desc limit 1",[previous.business_id]);
 const exposure=await one("select coalesce(sum(held),0)::text amount from private.r05_exposure($1) where currency='USD'",[previous.business_id]);
 const now=Date.now(),start=new Date(now-1000).toISOString(),end=new Date(Math.floor((now+90*60000)/1000)*1000).toISOString(),scopeId=randomUUID();
 const addendum=r12AddendumFixture({businessId:previous.business_id},now-1000);addendum.id=randomUUID();addendum.goalId=previous.goal_id;addendum.predecessorScopeId=previous.scope_id;addendum.predecessorReviewHash=review.phase.response.result.reviewHash;addendum.expiresAt=end;addendum.observations[0].expiresAt=end;
 const history=[...previous.amendment.reviewHistory,{scopeId:previous.scope_id,scopeHash:previous.amendment_hash,planId:previous.id,planHash:previous.content_hash,attemptId:review.phase.attemptId,requestId:review.phase.binding.requestId,settlementHash:paid.receipt_hash,actualMicrounits:paid.actual}];
 const envelope={...previous.amendment,version:'r12.discovery-evidence-continuation.1',id:scopeId,predecessorPlanId:previous.id,predecessorScopeId:previous.scope_id,predecessorScopeHash:previous.amendment_hash,reviewHistory:history,baseDispatches:6,baseChildren:7,baseKnownMicrounits:String(Number(previous.amendment.baseKnownMicrounits)+Number(paid.actual)),addendum,addendumHash:discoveryV2Hash(addendum),executionSourceDomains:[...new Set([...previous.amendment.allowedDomains,'example.org'])].sort(),createdAt:start,expiresAt:end};
 const quote=r12QuoteFixture(Date.now(),true),keys=['strategy','review'],amount=keys.reduce((sum,phase)=>sum+quote.ceilings[phase],0);
 const policy={...originalPolicy.payload,businessRevision:business.revision+1,goalRevision:goal.revision+2,businessLifetimeLimitMicrounits:String(cap.maximum_microunits),policyLimitMicrounits:String(amount),categoryLimits:[{category:'model',microunits:String(amount)}],expectedCapRevision:cap.revision,expectedExposureMicrounits:exposure.amount,startsAt:start,expiresAt:end,maximumDispatches:2,operations:keys.map(phase=>({...originalPolicy.payload.operations.find(op=>op.operationKey.endsWith('.'+phase)),operationKey:`research.r12.${scopeId}.${phase}`,sourceDomains:envelope.executionSourceDomains,maximumPerOperationMicrounits:String(quote.ceilings[phase])}))};
 const businessContent={...business.content,allowedActivity:`One strategy and one independent review for the original Goal ${previous.goal_id}, using its original saved sources plus the exact reviewed public evidence addendum.`,operatingRules:`Preserve all original phases, both earlier reviews, source timestamps and known costs. Permit exactly two new model calls ending ${end}, thirty minutes of receipt-only grace and three metadata checks per call. This is the fourth and final plan revision.`,restrictions:'No new collection, creative generation, store action, paid retry, repair, pivot, fallback or funding reset. Stop for stale evidence, unknown or excessive cost, scope change, expiry or owner withdrawal.'};
 const goalContent=structuredClone(goal.content);goalContent.parsed={...goalContent.parsed,deadline:{date:end.slice(0,10),time:end.slice(11,19),timezone:'UTC'},scope:'Assess the original candidates and all four geographic markets using the reviewed factual addendum. A bounded private test may select one market while retaining all commercial unknowns.',stopConstraints:['Exactly one new strategy and one independent review; no new collection, retry, repair or pivot.','Preserve every earlier result and charge under the unchanged original research root.','Stop on stale evidence, unknown or excessive cost, expiry or owner withdrawal. The decision grants no creative or store permission.']};
 const proposal={version:'r12.review-owner-proposal.1',scopeId,scopeHash:discoveryV2Hash(envelope),businessId:previous.business_id,ownerId:previous.owner_id,goalId:previous.goal_id,expectedBusinessRevision:business.revision,expectedBusinessHash:business.content_hash,expectedGoalRevision:goal.revision,expectedGoalHash:goal.content_hash,businessContent,goalContent,operatingPolicy:policy,interpretationHash:'c'.repeat(64)};
 const stageInput={envelope,proposal,quote,executionReviewHash:'d'.repeat(64),eligibilityReviewHash:'e'.repeat(64)};
 const before=await one("select (select count(*) from private.r07_server_keys) controller,(select count(*) from private.r05_server_keys) admission");
 for(const mutate of [x=>x.envelope.reviewHistory.pop(),x=>x.envelope.baseDispatches=0,x=>x.envelope.addendum.predecessorReviewHash='0'.repeat(64),x=>x.envelope.executionSourceDomains=['example.org'],x=>x.proposal.operatingPolicy.maximumDispatches=3,x=>x.quote.validUntil=x.quote.verifiedAt]){
  const bad=structuredClone(stageInput);mutate(bad);await assert.rejects(runOperatorRecipe(client,'stage',bad));
  assert.equal((await one('select count(*)::int n from private.r12_discovery_scopes where id=$1',[scopeId])).n,0);
 }
 const staged=await runOperatorRecipe(client,'stage',stageInput);assert.equal(staged.authorityCreated,false);
 assert.deepEqual(await one("select (select count(*) from private.r07_server_keys) controller,(select count(*) from private.r05_server_keys) admission"),before);
 await assert.rejects(runOperatorRecipe(client,'stage',stageInput));
 const session=randomUUID();await db.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,clock_timestamp()+interval '1 hour')",[session,previous.owner_id]);await db.query("select set_config('request.jwt.claims',$1,false),set_config('request.jwt.claim.sub',$2,false)",[JSON.stringify({sub:previous.owner_id,session_id:session,role:'authenticated'}),previous.owner_id]);
 await capture('evidence-preparation');
 await db.exec('set role authenticated');
 let confirmed;
 try {
  const view=(await one('select public.r12_review_owner_read($1,$2) result',[previous.business_id,scopeId])).result;
  assert.equal(parseR12ReviewOwnerWorkspace(view,previous.business_id,scopeId,previous.owner_id).scope.addendumHash,envelope.addendumHash);
  confirmed=(await one('select public.r12_review_owner_confirm($1,$2,$3) result',[previous.business_id,scopeId,staged.proposalHash])).result;
  assert.equal(confirmed.executionAuthorized,false);assert.equal((await one('select public.r12_review_owner_confirm($1,$2,$3) result',[previous.business_id,scopeId,staged.proposalHash])).result.replayed,true);
 }finally{await db.exec('reset role').catch(()=>{});}
 const derive=role=>createHmac('sha256','inert-r12-owner-root-configuration-0123456789').update(JSON.stringify({version:'r12.scoped-authority.1',role,businessId:previous.business_id,ownerId:previous.owner_id,scopeId})).digest('base64url'),hash=text=>createHash('sha256').update(text).digest('hex');
 const activationInput={businessId:previous.business_id,scopeId,scopeHash:staged.scopeHash,proposalHash:staged.proposalHash,policyId:confirmed.policyId,policyHash:confirmed.policyHash,quote:r12QuoteFixture(Date.now(),true),executionReviewHash:'d'.repeat(64),eligibilityReviewHash:'e'.repeat(64),controllerKeyHash:hash(derive('controller')),admissionKeyHash:hash(derive('admission'))};
 for(const mutate of [x=>x.admissionKeyHash=x.controllerKeyHash,x=>x.policyHash='0'.repeat(64),x=>x.scopeHash='0'.repeat(64),x=>x.quote.validUntil=x.quote.verifiedAt]){
  const bad=structuredClone(activationInput);mutate(bad);await assert.rejects(runOperatorRecipe(client,'activate',bad));
  assert.equal((await one('select count(*)::int n from private.r12_discovery_authorities where scope_id=$1',[scopeId])).n,0);
 }
 const activated=await runOperatorRecipe(client,'activate',activationInput);
 assert.equal(activated.shouldDispatch,false);assert.equal(activated.providerCalls,0);
 assert.deepEqual((await db.query('select step_key from private.r07_reused where plan_id=$1 order by step_key',[activated.planId])).rows.map(x=>x.step_key),['plan','search1','select1']);
 assert.equal((await one('select version from private.r07_plans where id=$1',[activated.planId])).version,4);
 assert.equal((await one('select private.r12_initialize_evidence_continuation($1) result',[scopeId])).result.replayed,true);
 await assert.rejects(runOperatorRecipe(client,'activate',activationInput));
 const metadata={...originalMetadata,businessId:previous.business_id,goalId:previous.goal_id,ownerId:previous.owner_id,authSessionId:session,scopeId,sourceScopeId:envelope.sourceScopeId,predecessorScopeId:previous.scope_id,plan:activated.plan,evidenceEnvelope:envelope,quote,executionReviewHash:'d'.repeat(64),eligibilityReviewHash:'e'.repeat(64)};
 await capture('evidence-ready',metadata);
 return{metadata,envelope,stageInput,activated,proposal,staged};
}
