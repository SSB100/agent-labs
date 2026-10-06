/** Builds a continuation only in the caller's isolated inert database. */
import {runOperatorRecipe} from '../../scripts/r12-review-continuation-bootstrap.mjs';
import {r12QuoteFixture} from './r12-provider-fixture.mjs';
import {randomUUID,createHash,createHmac} from 'node:crypto';
import assert from 'node:assert/strict';
import {discoveryV2Hash} from '../../.core-tests/products/discovery-v2.js';
export function reviewRecipeClient(db,nested=false){
 return{query:async(sql,args)=>{
  if(nested&&sql==='begin')return db.query('savepoint r12_review_recipe');
  if(nested&&sql==='commit'){await db.exec('drop table pg_temp.r12_bootstrap_input,pg_temp.r12_bootstrap_result');return db.query('release savepoint r12_review_recipe');}
  if(nested&&sql==='rollback'){await db.query('rollback to savepoint r12_review_recipe');return db.query('release savepoint r12_review_recipe');}
  return args?db.query(sql,args):/^\s*(DO|set local|create temporary)/.test(sql)?db.exec(sql):db.query(sql);
 }};
}
export async function prepareR12ReviewFixture(db,originalMetadata,{nested=false,capture=async()=>{}}={}){
 const one=async(sql,params=[])=>(await db.query(sql,params)).rows[0],hash=value=>createHash('sha256').update(value).digest('hex');
 const recipeClient=reviewRecipeClient(db,nested);
 const snapshot=async name=>capture(name);
const old=await one("select p.*,s.amendment,s.amendment_hash,s.prior_round_id,s.budget_authority_root_id,q.controller_key_hash,q.admission_key_hash from private.r07_plans p join private.r12_discovery_scopes s on s.id=(p.content->>'discoveryScopeId')::uuid join private.r12_discovery_authorities q on q.scope_id=s.id where p.content->>'format'='r12.discovery.1'");
const oldAttempts=(await db.query('select * from private.r07_attempts where plan_id=$1',[old.id])).rows;
await db.query('insert into private.r05_revocations(policy_id,business_id,actor_id) values($1,$2,$3)',[old.policy_id,old.business_id,old.owner_id]);
await db.query('insert into private.r07_server_revocations(key_hash) values($1)',[old.controller_key_hash]);await db.query('insert into private.r05_server_revocations(key_hash) values($1)',[old.admission_key_hash]);
const deps=[];for(const key of ['plan','search1','select1','strategy']){const a=oldAttempts.find(a=>a.step_key===key),r=await one('select * from private.r07_responses where attempt_id=$1',[a.id]);deps.push({stepKey:key,attemptId:a.id,artifactId:r.artifact_id,responseHash:r.content_hash});}
const scopeId=randomUUID(),now=Date.now(),start=new Date(now-1000).toISOString(),end=new Date(Math.floor((now+90*60000)/1000)*1000).toISOString();
const e={version:'r12.discovery-review-continuation.1',id:scopeId,businessId:old.business_id,goalId:old.goal_id,budgetAuthorityRootId:old.budget_authority_root_id,priorRoundId:old.prior_round_id,sourceScopeId:old.content.discoveryScopeId,sourceScopeHash:old.amendment_hash,sourcePlanId:old.id,sourcePlanHash:old.content_hash,sourceReviewAttemptId:oldAttempts.find(a=>a.step_key==='review').id,sourcePhases:deps,baseDispatches:4,baseChildren:5,baseKnownMicrounits:'40',allowedDomains:old.amendment.allowedDomains,excludedDomains:old.amendment.excludedDomains,approvedQuery:old.amendment.approvedQuery,approvalHash:'a'.repeat(64),independentReviewHash:'b'.repeat(64),createdAt:start,expiresAt:end};
const newScope={amendment_hash:(await one('select private.stage14_hash($1::jsonb) hash',[e])).hash};
const oldPolicy=await one('select payload from private.r05_policies where id=$1',[old.policy_id]);const reviewStep=old.content.steps.find(s=>s.key==='review');const oldOp=oldPolicy.payload.operations.find(o=>o.operationKey===reviewStep.operationKey);const newOpKey=`research.r12.${scopeId}.review`;
const business=await one('select v.* from private.r04_business_versions v join private.r04_business_state s using(business_id,revision) where business_id=$1',[old.business_id]);
const goal=await one('select v.* from private.r04_goal_versions v join private.r04_goal_state s using(goal_id,business_id,revision) where goal_id=$1',[old.goal_id]);
const cap=await one("select * from private.r05_cap_versions where business_id=$1 and currency='USD' order by revision desc limit 1",[old.business_id]);const exposure=await one("select coalesce(sum(held),0)::text amount from private.r05_exposure($1) where currency='USD'",[old.business_id]);
const policy={...oldPolicy.payload,goalRevision:goal.revision+2,businessRevision:business.revision+1,businessLifetimeLimitMicrounits:String(cap.maximum_microunits),policyLimitMicrounits:reviewStep.maximumMicrounits,categoryLimits:[{category:'model',microunits:reviewStep.maximumMicrounits}],expectedCapRevision:cap.revision,expectedExposureMicrounits:exposure.amount,startsAt:start,expiresAt:end,maximumDispatches:1,operations:[{...oldOp,operationKey:newOpKey}]};
const businessContent={...business.content,allowedActivity:`One newly approved independent review for Goal ${old.goal_id}, execution scope ${scopeId}, reusing the exact four completed phases from source scope ${old.content.discoveryScopeId}.`,operatingRules:`Preserve original source timestamps, artifacts, generation identities, all prior charges and the cumulative USD 2 research root. Permit only one independent reviewer generation under the new confirmed policy, ending ${end}, with at most thirty minutes of receipt-only grace. No planner, search, selector, strategist replay, paid retry, repair, pivot or fallback. Old policy and verifier revocations remain closed.`,restrictions:`Research only. No creative generation, product drafts, listings, publication, commerce, account changes, private participant data or funding reset. Stop on changed scope, invalid or stale evidence, unknown/over-limit cost, expiry, receipt exhaustion or owner withdrawal.`};
const goalContent=structuredClone(goal.content);goalContent.parsed={...goalContent.parsed,deadline:{date:end.slice(0,10),time:end.slice(11,19),timezone:'UTC'},scope:`Complete only the remaining independent reviewer phase for source plan ${old.id}, preserving its exact plan/search1/select1/strategy outputs and original funding root. The new execution scope is ${scopeId}.`,stopConstraints:[`Exactly one new reviewer generation; no additional collection, regeneration, paid retry, repair, pivot or fallback.`,`Preserve source timestamps, original assessment and dossier identity, and all known costs under the unchanged USD 2 research root.`,`Dispatch ends ${end}; only the already generated review may use the following thirty-minute receipt grace, with at most three metadata GET claims.`,`Stop on invalid or stale evidence, unknown or over-limit cost, changed scope, expiry or owner withdrawal. Any research outcome grants no creative or commerce permission.`]};
const proposal={version:'r12.review-owner-proposal.1',scopeId,scopeHash:newScope.amendment_hash,businessId:old.business_id,ownerId:old.owner_id,goalId:old.goal_id,expectedBusinessRevision:business.revision,expectedBusinessHash:business.content_hash,expectedGoalRevision:goal.revision,expectedGoalHash:goal.content_hash,businessContent,goalContent,operatingPolicy:policy,interpretationHash:'c'.repeat(64)};
const stageInput={envelope:e,proposal,quote:r12QuoteFixture(),executionReviewHash:'d'.repeat(64),eligibilityReviewHash:'e'.repeat(64)};
const keysBefore=(await one('select (select count(*) from private.r07_server_keys) controllers,(select count(*) from private.r05_server_keys) admissions'));
for(const mutate of [x=>x.extraPermission=true,x=>x.envelope.sourcePhases.reverse(),x=>x.envelope.sourceScopeHash='0'.repeat(64),x=>x.envelope.sourceReviewAttemptId=x.envelope.sourcePhases[3].attemptId,x=>x.envelope.approvedQuery+=' Expanded source purpose',x=>x.proposal.operatingPolicy.maximumDispatches=5,x=>x.proposal.operatingPolicy.operations.push(x.proposal.operatingPolicy.operations[0]),x=>x.proposal.operatingPolicy.businessLifetimeLimitMicrounits=String(Number(x.proposal.operatingPolicy.businessLifetimeLimitMicrounits)+1),x=>x.quote.validUntil=x.quote.verifiedAt,x=>x.quote.reviewer.endpoint='anthropic']){
 const bad=structuredClone(stageInput);mutate(bad);await assert.rejects(runOperatorRecipe(recipeClient,'stage',bad));
 assert.equal((await one('select count(*)::int n from private.r12_discovery_scopes where id=$1',[scopeId])).n,0);
}
const staged=await runOperatorRecipe(recipeClient,'stage',stageInput);assert.equal(staged.authorityCreated,false);
assert.deepEqual(await one('select (select count(*) from private.r07_server_keys) controllers,(select count(*) from private.r05_server_keys) admissions'),keysBefore,'Staging enrolls no verifier');
assert.equal((await one('select count(*)::int n from private.r12_discovery_authorities where scope_id=$1',[scopeId])).n,0);
await assert.rejects(runOperatorRecipe(recipeClient,'stage',stageInput),'Uncertain stage completion requires readback, not another staged scope');

const q=await one('select * from private.r12_review_owner_proposals where scope_id=$1',[scopeId]);
const session=randomUUID();await db.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,clock_timestamp()+interval '1 hour')",[session,old.owner_id]);await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:old.owner_id,session_id:session,role:'authenticated'})]);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[old.owner_id]);
await snapshot('review-preparation');
await db.exec('set role authenticated');const read=await one('select public.r12_review_owner_read($1,$2) result',[old.business_id,old.content.discoveryScopeId]);assert.equal(read.result.scopeId,scopeId);assert.equal(read.result.eligible,true);assert.deepEqual(read.result.scope,e);
const confirmed=(await one('select public.r12_review_owner_confirm($1,$2,$3) result',[old.business_id,scopeId,q.proposal_hash])).result;
assert.equal(confirmed.executionAuthorized,false);assert.equal(confirmed.replayed,false);assert.equal((await one('select public.r12_review_owner_confirm($1,$2,$3) result',[old.business_id,scopeId,q.proposal_hash])).result.replayed,true);await db.exec('reset role');
const derive=role=>createHmac('sha256','inert-r12-owner-root-configuration-0123456789').update(JSON.stringify({version:'r12.scoped-authority.1',role,businessId:old.business_id,ownerId:old.owner_id,scopeId})).digest('base64url');const controller=derive('controller'),admission=derive('admission');
const activationInput={businessId:old.business_id,scopeId,scopeHash:staged.scopeHash,proposalHash:staged.proposalHash,policyId:confirmed.policyId,policyHash:confirmed.policyHash,quote:r12QuoteFixture(),executionReviewHash:'d'.repeat(64),eligibilityReviewHash:'e'.repeat(64),controllerKeyHash:hash(controller),admissionKeyHash:hash(admission)};
for(const mutate of [x=>x.admissionKeyHash=x.controllerKeyHash,x=>x.controllerKeyHash=old.controller_key_hash,x=>x.policyHash='0'.repeat(64),x=>x.proposalHash='0'.repeat(64),x=>x.scopeHash='0'.repeat(64),x=>x.quote.validUntil=x.quote.verifiedAt,x=>{x.quote.ceilings.review++;const{quoteHash:unusedHash,verifiedAt:unusedAt,validUntil:unusedUntil,...value}=x.quote;void unusedHash;void unusedAt;void unusedUntil;x.quote.quoteHash=discoveryV2Hash(value);}]){const bad=structuredClone(activationInput);mutate(bad);await assert.rejects(runOperatorRecipe(recipeClient,'activate',bad));assert.equal((await one('select count(*)::int n from private.r12_discovery_authorities where scope_id=$1',[scopeId])).n,0);}
const activated=await runOperatorRecipe(recipeClient,'activate',activationInput);
await assert.rejects(runOperatorRecipe(recipeClient,'activate',activationInput),'Activation cannot silently open a second window');
assert.equal((await one('select private.r12_initialize_review_continuation($1) result',[scopeId])).result.replayed,true);
const initialized={planId:activated.planId,planHash:activated.planHash,shouldDispatch:false};assert.equal(activated.shouldDispatch,false);assert.equal(Date.parse(activated.receiptUntil)-Date.parse(activated.dispatchUntil),1800000);
const h=await one('select * from private.r07_heads where goal_id=$1',[old.goal_id]);assert.equal(h.dispatches,4);assert.equal(h.children_created,5);assert.equal((await one('select count(*)::int n from private.r07_reused where plan_id=$1',[initialized.planId])).n,4);

 const metadata={businessId:old.business_id,goalId:old.goal_id,scopeId,sourceScopeId:old.content.discoveryScopeId,ownerId:old.owner_id,authSessionId:session,plan:activated.plan,quote:originalMetadata.quote,outputs:originalMetadata.outputs,executionReviewHash:'d'.repeat(64),eligibilityReviewHash:'e'.repeat(64)};
 await capture('review-ready',metadata);
 return{metadata,staged,proposal,activated,controller,admission};
}
