/** Disposable full SQL fixture. Trusted fixture registration is not a production recipe. */
import assert from 'node:assert/strict';
import {pilotOwnerSqlApi} from './r12-pilot-owner-sql-fixture.mjs';
import {randomUUID,createHash,createHmac} from 'node:crypto';
import {createRequire} from 'node:module';
import {focusedProfileFixture,focusedStrategyOutput} from './r12-focused-profile-fixture.mjs';
import {runOperatorRecipe as runOriginalOperatorRecipe} from '../../scripts/r12-focused-pilot-bootstrap.mjs';
import {runOperatorRecipe as runSuccessorOperatorRecipe} from '../../scripts/r12-focused-pilot-successor-bootstrap.mjs';
import {reviewRecipeClient} from './r12-review-fixture.mjs';
import {r12PilotQuoteFixture} from './r12-provider-fixture.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const compiled=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../.core-tests'),req=createRequire(import.meta.url);
const runtime=req(compiled+'/products/discovery-r12-runtime.js'),{focusedPilotHistoricalRecord}=req(compiled+'/products/discovery-r12-focused-pilot-runtime.js');
const {discoveryV2Hash:hash,REVIEW_CHECKS_V2}=req(compiled+'/products/discovery-v2.js');
const {discoveryAddendumReferences}=req(compiled+'/products/discovery-r12-evidence-addendum.js');
const {createDiscoveryR12QuestAdapter}=req(compiled+'/products/discovery-r12-adapter.js');
const {driveQuestOnce}=req(compiled+'/core/quest-controller.js');
const {r12PilotGoalContent,R12_PILOT_OBJECTIVE,R12_PILOT_QUESTION}=req(compiled+'/products/discovery-r12-pilot-preparation-contract.js');
const {validateDiscoveryFocusedPilot}=req(compiled+'/products/discovery-r12-focused-pilot-scope.js');
const digest=text=>createHash('sha256').update(text).digest('hex');
export async function exerciseFocusedPilotLifecycle(db,closed,{nested=false,ownerPreparationReceipt=null,stageOnly=false,reviewFailure=false,successor=null,strategyOutcome='TEST',profileFixture=focusedProfileFixture,strategyOutput=focusedStrategyOutput,onReservedDispatch=null,recovery=null,actualOwnerPreparation=false,stopBeforeActivation=false}={}){
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0],recipeClient=reviewRecipeClient(db,nested),runOperatorRecipe=recovery?(await import('../../scripts/r12-focused-pilot-unsent-recovery-bootstrap.mjs')).runOperatorRecipe:successor?runSuccessorOperatorRecipe:runOriginalOperatorRecipe;
 const closedBroad=successor?successor.closedBroad:closed;
 const ownerRpc=async(name,args)=>{await db.exec('savepoint pilot_owner_rpc');await db.exec('set role authenticated');try{return(await one(`select public.${name}(${args.map((_,n)=>`$${n+1}`).join(',')}) result`,args)).result;}catch(error){await db.exec('rollback to savepoint pilot_owner_rpc');throw error;}finally{await db.exec('reset role');await db.exec('release savepoint pilot_owner_rpc');}};
 const oldPlan=await one('select * from private.r07_plans where id=$1',[closedBroad.activated.planId]);
 const oldScope=await one('select * from private.r12_discovery_scopes where id=$1',[closedBroad.metadata.scopeId]);
 const saved=(await one('select public.r12_discovery_result_read($1,$2) result',[oldPlan.business_id,oldScope.amendment.predecessorScopeId])).result;
 const historic=runtime.reconstructDiscoveryR12Result(saved,oldPlan.business_id,oldScope.amendment.predecessorScopeId);assert.equal(historic.review.outcome,'NEEDS_MORE_EVIDENCE');
 const oldFrozen=await one('select (select jsonb_agg(to_jsonb(v) order by revision) from private.r04_goal_versions v where goal_id=$1) goals,(select jsonb_agg(to_jsonb(p) order by version) from private.r07_plans p where goal_id=$1) plans,(select to_jsonb(h) from private.r07_heads h where goal_id=$1) head,(select jsonb_agg(to_jsonb(l) order by experiment_id) from private.r04_research_links l where goal_id=$1) links',[oldPlan.goal_id]);
 const ownerApi=actualOwnerPreparation?pilotOwnerSqlApi(db,oldPlan.business_id,oldPlan.owner_id):null;
 if(ownerApi&&!ownerPreparationReceipt){const input={businessId:oldPlan.business_id,sourceScopeId:recovery?.scopeId??successor?.scopeId??oldScope.id,preparationId:randomUUID(),setupUntil:successor?.metadata.focusedProfile.expiresAt??new Date(Math.floor((Date.now()+7200000)/1000)*1000).toISOString()};ownerPreparationReceipt=await ownerApi.preparation.prepareR12PilotGoal(ownerApi.context,input);assert.deepEqual(await ownerApi.preparation.prepareR12PilotGoal(ownerApi.context,input),ownerPreparationReceipt);assert.equal(ownerPreparationReceipt.authorityCreated,false);if(recovery)assert.equal(ownerPreparationReceipt.unsentClosureHash,hash(recovery.unsentClosure));}
 const now=Date.now(),start=new Date(now-1000).toISOString(),end=ownerPreparationReceipt?.setupUntil??successor?.metadata.focusedProfile.expiresAt??new Date(Math.floor((now+7200000)/1000)*1000).toISOString(),p=successor?structuredClone(successor.metadata.focusedProfile):profileFixture(),sid=ownerPreparationReceipt?.preparationId??randomUUID();
 p.id=sid;p.businessId=oldPlan.business_id;p.originalGoalId=oldPlan.goal_id;p.budgetAuthorityRootId=oldScope.budget_authority_root_id;p.priorRoundId=oldScope.prior_round_id;
 p.originalIntentHash=hash(saved.inputs.original.priorIntent);p.originalSemanticGoalHash=saved.inputs.original.semanticGoalHash;
 p.intent={...p.intent,id:sid,businessId:p.businessId,objective:R12_PILOT_OBJECTIVE,expiresAt:end};p.learningQuestion=R12_PILOT_QUESTION;p.intent.comparisonUniverse.selectionQuestion=p.learningQuestion;p.candidate=structuredClone(historic.dossier.shortlist[0]);p.intent.comparisonUniverse.audiences=[p.candidate.audience];
 p.createdAt=start;p.expiresAt=end;p.history.acceptedReviewScopeId=oldScope.amendment.predecessorScopeId;p.history.acceptedReviewHash=hash(historic.review);p.history.record=focusedPilotHistoricalRecord(historic);p.history.recordHash=hash(p.history.record);
 p.observations={...p.observations,id:randomUUID(),businessId:p.businessId,predecessorScopeId:p.history.acceptedReviewScopeId,predecessorReviewHash:p.history.acceptedReviewHash,createdAt:start,expiresAt:end,observations:successor?p.observations.observations:p.observations.observations.map(o=>({...o,retrievedAt:new Date(now-120000).toISOString(),expiresAt:end}))};
 p.pinnedLearningPlan.evidenceRefs=discoveryAddendumReferences(p.observations);
 const quote=r12PilotQuoteFixture(now);assert.deepEqual(quote.ceilings,{strategy:66671,review:211236});assert.equal(quote.maximumMicrousd,277907);
 // Conservative inert quoted ceilings are bounded; real operator uses fresh pilot qualification.
 const {quoteHash:_hash,verifiedAt:_verified,validUntil:_valid,...quoteBody}=quote;void[_hash,_verified,_valid];quote.quoteHash=hash(quoteBody);
 p.researchAllocationMicrousd=quote.maximumMicrousd;
 const content=r12PilotGoalContent({businessId:p.businessId,sourceScopeId:recovery?.scopeId??(successor?successor.metadata.scopeId:oldScope.id),preparationId:sid,setupUntil:end},!!successor,!!recovery);
 let create;
 if(ownerPreparationReceipt){assert.equal(ownerPreparationReceipt.businessId,p.businessId);assert.equal(ownerPreparationReceipt.sourceScopeId,recovery?.scopeId??(successor?successor.metadata.scopeId:oldScope.id));assert.equal(ownerPreparationReceipt.closedPlanHash,recovery?.unsentClosure.planHash??(successor?successor.closure.planHash:oldPlan.content_hash));create={id:ownerPreparationReceipt.goalId};const exactGoal=await one('select content from private.r04_goal_versions where goal_id=$1 order by revision desc limit 1',[create.id]);assert.deepEqual(exactGoal.content,content);}
 else {
 const saveId=randomUUID();create=await ownerRpc('r04_quest_transition',[p.businessId,'quest.save',{goalId:null,expectedRevision:0,content},saveId]);
 assert.equal(create.revision,1);assert.notEqual(create.id,oldPlan.goal_id);assert.equal((await ownerRpc('r04_quest_transition',[p.businessId,'quest.save',{goalId:null,expectedRevision:0,content},saveId])).id,create.id);
 const ready=await ownerRpc('r04_quest_transition',[p.businessId,'quest.preference',{goalId:create.id,expectedRevision:1,preference:'ready'},randomUUID()]);assert.equal(ready.revision,2);
 }
 p.goalId=create.id;p.observations.goalId=p.goalId;if(successor)p.observations.approvalHash=hash({sid,ownerApproval:'inert separately approved research successor'});
 const e={version:'r12.discovery-focused-pilot.1',id:sid,businessId:p.businessId,goalId:p.goalId,budgetAuthorityRootId:p.budgetAuthorityRootId,priorRoundId:p.priorRoundId,profile:p,profileHash:hash(p),originalGoalId:p.originalGoalId,closedPlanId:recovery?.unsentClosure.planId??(successor?successor.closure.planId:oldPlan.id),closedPlanHash:recovery?.unsentClosure.planHash??(successor?successor.closure.planHash:oldPlan.content_hash),acceptedReviewScopeId:p.history.acceptedReviewScopeId,acceptedReviewHash:p.history.acceptedReviewHash,acceptedReviewRecordHash:p.history.recordHash,originalIntentHash:p.originalIntentHash,originalSemanticGoalHash:p.originalSemanticGoalHash,allowedDomains:p.intent.comparisonUniverse.sourceDomains,excludedDomains:['etsy.com','etsy.me','etsystatic.com'],approvedQuery:p.learningQuestion,approvalHash:successor?p.observations.approvalHash:'b'.repeat(64),independentReviewHash:'c'.repeat(64),createdAt:start,expiresAt:end};
 const scopeInsert=env=>db.query('insert into private.r12_discovery_scopes(id,business_id,goal_id,budget_authority_root_id,prior_round_id,amendment,amendment_hash) values($1,$2,$3,$4,$5,$6,$7)',[env.id,env.businessId,env.goalId,env.budgetAuthorityRootId,env.priorRoundId,env,hash(env)]);
 const expectRejected=async(action,pattern)=>{await db.exec('savepoint pilot_negative');try{await assert.rejects(action,pattern);}finally{await db.exec('rollback to savepoint pilot_negative');await db.exec('release savepoint pilot_negative');}};
 if(!successor)for(const mutate of [x=>x.closedPlanHash='0'.repeat(64),x=>x.closedPlanId=randomUUID(),x=>{x.profile.candidate.concept+=' changed';x.profileHash=hash(x.profile);},x=>{x.profile.intent.comparisonUniverse.selectionQuestion+=' changed';x.profileHash=hash(x.profile);},x=>{x.acceptedReviewHash='0'.repeat(64);x.profile.history.acceptedReviewHash=x.acceptedReviewHash;x.profile.observations.predecessorReviewHash=x.acceptedReviewHash;x.profileHash=hash(x.profile);}]){const bad=structuredClone(e);mutate(bad);await expectRejected(()=>scopeInsert(bad));}
 const budgetBefore=(await one('select private.stage13v2_budget_authority($1,false) b',[p.priorRoundId])).b;
 assert.equal(budgetBefore.hasUncertainCosts,false);assert.equal(budgetBefore.maximumMicrousd,2000000);
 const business=await one('select v.* from private.r04_business_versions v join private.r04_business_state s using(business_id,revision) where business_id=$1',[p.businessId]);
 const goal=await one('select v.* from private.r04_goal_versions v join private.r04_goal_state s using(business_id,goal_id,revision) where goal_id=$1',[p.goalId]);
 const cap=await one("select * from private.r05_cap_versions where business_id=$1 and currency='USD' order by revision desc limit 1",[p.businessId]);
 const exposure=await one("select coalesce(sum(held),0)::text amount from private.r05_exposure($1) where currency='USD'",[p.businessId]);
 const originalPlan=await one('select * from private.r07_plans where id=$1',[oldScope.amendment.sourcePlanId]);
 const originalPolicy=(await one('select payload from private.r05_policies where id=$1',[originalPlan.policy_id])).payload;
 const phaseKeys=['strategy','review'],operations=[];const executionReviewHash=hash({sid,qualification:'inert focused pilot fixture'}),eligibilityReviewHash='e'.repeat(64);
 for(const phase of phaseKeys){
  const oldStep=originalPlan.content.steps.find(s=>s.key===phase),opKey=`research.r12.${sid}.${phase}`;
  operations.push({...originalPolicy.operations.find(op=>op.operationKey===oldStep.operationKey),operationKey:opKey,sourceDomains:e.allowedDomains,maximumPerOperationMicrounits:String(quote.ceilings[phase])});
 }

 const policy={...originalPolicy,goalId:p.goalId,businessRevision:business.revision+1,goalRevision:goal.revision+2,businessLifetimeLimitMicrounits:String(cap.maximum_microunits),policyLimitMicrounits:String(p.researchAllocationMicrousd),categoryLimits:[{category:'model',microunits:String(p.researchAllocationMicrousd)}],expectedCapRevision:cap.revision,expectedExposureMicrounits:exposure.amount,startsAt:start,expiresAt:end,maximumDispatches:2,operations};
 const proposal={version:'r12.review-owner-proposal.1',scopeId:sid,scopeHash:hash(e),businessId:p.businessId,ownerId:oldPlan.owner_id,goalId:p.goalId,expectedBusinessRevision:business.revision,expectedBusinessHash:business.content_hash,expectedGoalRevision:goal.revision,expectedGoalHash:goal.content_hash,businessContent:{...business.content,allowedActivity:'One separately scoped original design learning question for one GB candidate.',operatingRules:'One strategy and one independent review only. No new collection, retry, repair or pivot.',restrictions:'No creative generation, publication, commerce or change to historical research.'},goalContent:content,operatingPolicy:policy,interpretationHash:'d'.repeat(64)};
 let authorization=null;
 if(successor){
  authorization={version:'r12.focused-pilot-successor-authorization.1',businessId:p.businessId,ownerId:oldPlan.owner_id,scopeId:sid,scopeHash:hash(e),goalId:p.goalId,preparedGoalRevision:2,preparedGoalHash:goal.content_hash,profileHash:e.profileHash,ownerApprovalEvidenceHash:e.approvalHash,predecessorClosure:successor.closure,
   limits:{maximumSuccessors:1,maximumPaidCalls:2,maximumReceiptGets:6,maximumReceiptGetsPerCall:3,dispatchWindowSeconds:1800,receiptGraceSeconds:1800,maximumMicrousd:277907,maximumStrategyMicrousd:66671,maximumReviewMicrousd:211236,stopOnAnyNegative:true,researchOnly:true,paidRetryAllowed:false,searchAllowed:false,imageAllowed:false,storeActionsAllowed:false},createdAt:e.createdAt,expiresAt:e.expiresAt};
  if(recovery){authorization.version='r12.focused-pilot-unsent-recovery-authorization.1';authorization.limits.maximumRecoveries=1;authorization.unsentClosure=recovery.unsentClosure;}
  proposal.interpretationHash=hash(authorization);
 }
 const authorizationField=recovery?'recoveryAuthorization':'successorAuthorization',authorizationHashField=recovery?'recoveryAuthorizationHash':'successorAuthorizationHash';
 const stageInput={envelope:e,proposal,quote,executionReviewHash,eligibilityReviewHash,...(authorization?{[authorizationField]:authorization}:{})};
 if(successor){
  const count=async()=>one('select (select count(*) from private.r12_pilot_unsent_recovery_authorizations)::int recoveries,(select count(*) from private.r12_pilot_successor_authorizations)::int proofs,(select count(*) from private.r12_discovery_scopes)::int scopes,(select count(*) from private.r05_operations)::int operations,(select count(*) from private.r07_adapters)::int adapters');
  const before=await count();
  for(const mutate of [x=>x[authorizationField].scopeHash='0'.repeat(64),x=>x[authorizationField].preparedGoalHash='0'.repeat(64),x=>x[authorizationField].ownerId=randomUUID(),x=>x[authorizationField].ownerApprovalEvidenceHash='0'.repeat(64),x=>x[authorizationField].predecessorClosure.phases[0].settlementHash='0'.repeat(64),x=>x[authorizationField].limits.maximumPaidCalls=3,x=>x.proposal.interpretationHash='0'.repeat(64),...(recovery?[x=>x[authorizationField].unsentClosure.releaseHash='0'.repeat(64),x=>x[authorizationField].unsentClosure.requestHash='0'.repeat(64),x=>x[authorizationField].unsentClosure.absenceHash='0'.repeat(64),x=>x[authorizationField].unsentClosure.scopeId=sid,x=>x[authorizationField].limits.maximumRecoveries=2]:[])]){
   const bad=structuredClone(stageInput);mutate(bad);await expectRejected(()=>runOperatorRecipe(recipeClient,'stage',bad));assert.deepEqual(await count(),before);
  }
  await expectRejected(()=>runOriginalOperatorRecipe(recipeClient,'stage',{envelope:e,proposal,quote,executionReviewHash,eligibilityReviewHash}),/r12_pilot_closed_latest_plan_required|r12_one_focused|r12_successor_/);assert.deepEqual(await count(),before);
 }
 const staged=await runOperatorRecipe(recipeClient,'stage',stageInput);assert.equal(staged.authorityCreated,false);
 if(successor&&!recovery){
  const oldExpiry=saved.inputs.sourceAmendment.expiresAt;
  const historicalAt=new Date(Date.parse(oldExpiry)+1000).toISOString();
  if(Date.parse(historicalAt)<Date.parse(e.expiresAt)){
   const historicalSource=(await one('select private.r12_pilot_successor_source(s,$2::timestamptz,true) result from private.r12_discovery_scopes s where s.id=$1',[sid,historicalAt])).result;
   assert.equal(historicalSource.acceptedReview.inputs.sourceAmendment.expiresAt,oldExpiry,'An expired historical broad scope is not redated');
   assert.equal(historicalSource.successor.authorizationHash,hash(authorization));
  }
  await expectRejected(()=>runOperatorRecipe(recipeClient,'stage',stageInput),/duplicate key|unique constraint/);
  await expectRejected(()=>db.query('select private.r12_pilot_successor_closure($1)',[sid]),/r12_successor_first_focused_predecessor_required/);
 }
 if(!stageOnly&&!successor){
 const otherSave=await ownerRpc('r04_quest_transition',[p.businessId,'quest.save',{goalId:null,expectedRevision:0,content},randomUUID()]);await ownerRpc('r04_quest_transition',[p.businessId,'quest.preference',{goalId:otherSave.id,expectedRevision:1,preference:'ready'},randomUUID()]);
 const duplicate=structuredClone(e);duplicate.id=randomUUID();duplicate.goalId=otherSave.id;duplicate.profile.id=duplicate.id;duplicate.profile.goalId=otherSave.id;duplicate.profile.intent.id=duplicate.id;duplicate.profile.observations.goalId=otherSave.id;duplicate.profileHash=hash(duplicate.profile);
 await expectRejected(()=>scopeInsert(duplicate),/r12_one_focused_pilot_per_closed_plan/);
 }
 if(recovery){await expectRejected(()=>runOperatorRecipe(recipeClient,'stage',stageInput),/duplicate key|unique constraint/);await expectRejected(()=>db.query('select private.r12_pilot_unsent_closure($1)',[sid]),/r12_recovery_|no rows/);}
 const fixtureMetadata={...closedBroad.metadata,businessId:p.businessId,goalId:p.goalId,scopeId:sid,ownerId:oldPlan.owner_id,sourceScopeId:recovery?.scopeId??(successor?successor.metadata.scopeId:oldScope.id),originalGoalId:oldPlan.goal_id,focusedProfile:p,focusedEnvelope:e,proposal,stageInput,staged,quote,executionReviewHash,eligibilityReviewHash,...(authorization?{authorization,authorizationHash:hash(authorization),closedFocused:successor,...(recovery?{closedUnsent:recovery}:{})}:{})};
 if(stageOnly)return {metadata:fixtureMetadata,staged,stageInput};

 const confirmation=ownerApi?await ownerApi.confirmation.confirmR12ReviewPreparation(ownerApi.context,p.businessId,sid,hash(proposal)):await ownerRpc('r12_review_owner_confirm',[p.businessId,sid,hash(proposal)]);assert.equal(confirmation.executionAuthorized,false);
 assert.equal((await ownerRpc('r12_review_owner_confirm',[p.businessId,sid,hash(proposal)])).replayed,true);
 const derive=role=>createHmac('sha256','inert-r12-owner-root-configuration-0123456789').update(JSON.stringify({version:'r12.scoped-authority.1',role,businessId:p.businessId,ownerId:oldPlan.owner_id,scopeId:sid})).digest('base64url');
 const controller=derive('controller'),admission=derive('admission'),lease='inert-pilot-lease-'+randomUUID();
 const activationInput={businessId:p.businessId,scopeId:sid,scopeHash:hash(e),proposalHash:hash(proposal),policyId:confirmation.policyId,policyHash:confirmation.policyHash,
  quote,executionReviewHash,eligibilityReviewHash,controllerKeyHash:digest(controller),admissionKeyHash:digest(admission),...(authorization?{[authorizationHashField]:hash(authorization)}:{})};
 if(stopBeforeActivation){
  assert.ok(recovery&&ownerApi);const before=await one('select (select count(*) from private.r07_server_keys)::int controller,(select count(*) from private.r05_server_keys)::int admission');
  assert.deepEqual(await ownerApi.server.stopDiscoveryR12(ownerApi.context,p.businessId,sid),{stopped:true});
  await expectRejected(()=>runOperatorRecipe(recipeClient,'activate',activationInput),/owner_confirmation|revoked|stopped/);
  assert.deepEqual(await one('select (select count(*) from private.r07_server_keys)::int controller,(select count(*) from private.r05_server_keys)::int admission'),before);
  assert.equal((await one('select count(*)::int n from private.r12_discovery_authorities where scope_id=$1',[sid])).n,0);
  assert.equal((await one('select count(*)::int n from private.r12_pilot_unsent_recovery_authorizations where scope_id=$1',[sid])).n,1);
  assert.equal((await one('select count(*)::int n from private.r05_revocations where policy_id=$1',[confirmation.policyId])).n,1);
  return{metadata:fixtureMetadata,scopeId:sid,inertPosts:0,inertReceiptGets:0,providerCalls:0,activeAuthority:false,stoppedBeforeActivation:true};
 }
 const activated=await runOperatorRecipe(recipeClient,'activate',activationInput);const plan=activated.plan;
 assert.equal(activated.providerCalls,0);assert.equal(activated.planId,null);assert.equal(activated.shouldDispatch,false);assert.equal(plan.maximumMicrounits,'277907');assert.equal(plan.maximumDispatches,2);assert.equal(plan.maximumChildren,2);assert.equal(plan.maximumRepairs,0);assert.equal(plan.maximumPivots,0);assert.deepEqual(plan.steps.map(step=>step.maximumMicrounits),['66671','211236']);
 const authority=await one('select valid_until,receipt_until from private.r12_discovery_authorities where scope_id=$1',[sid]);assert.equal(Date.parse(authority.receipt_until)-Date.parse(authority.valid_until),1800000);if(ownerPreparationReceipt){assert.equal(activationInput.controllerKeyHash,ownerPreparationReceipt.controllerKeyHash);assert.equal(activationInput.admissionKeyHash,ownerPreparationReceipt.admissionKeyHash);}
 let externalRpc=null;
 const rpc=async(name,args)=>{if(externalRpc)return externalRpc(name,args);await db.exec('savepoint pilot_effect_rpc');await db.exec('set role anon');try{return(await one(`select public.${name}(${args.map((_,n)=>`$${n+1}`).join(',')}) result`,args)).result;}catch(error){await db.exec('rollback to savepoint pilot_effect_rpc');throw error;}finally{await db.exec('reset role');await db.exec('release savepoint pilot_effect_rpc');}};
 const command=(op,payload,epoch=null)=>rpc('r07_controller',[p.businessId,p.goalId,op,payload,randomUUID(),controller,lease,epoch,admission]);
 await command('plan',{plan,expectedVersion:0,reason:'Inert finite independent focused pilot',evidenceHash:hash(e)});
 const snapshot=await command('read',{});assert.equal(snapshot.planVersion??(await one('select version from private.r07_plans where id=$1',[snapshot.planId])).version,1);
 const operation=(attemptId,operation,payload)=>rpc('r12_discovery_server',[p.businessId,attemptId,operation,payload,controller]);
 const effectStore={operation,settle:(attemptId,settlement)=>command('settle',{attemptId,settlement}),dispatchedAt:async attemptId=>(await operation(attemptId,'load',{})).dispatchedAt};
 let capturedDispatch,captureDispatch=!!onReservedDispatch;
 const store={read:()=>command('read',{}),command:(op,payload,epoch)=>{if(captureDispatch&&op==='dispatch'){capturedDispatch={payload,epoch};return Promise.resolve({shouldDispatch:false,reason:'full_shape_dispatch_captured'});}return command(op,['schedule','reserve'].includes(op)?{...payload,runtimeCapability:'inert-focused-pilot-capability-0123456789'}:payload,epoch);}};
 let posts=0,gets=0,delay=true;const actualWires={};let prepared;
 const decode=value=>{const f=v=>Array.isArray(v)?v.map(f):v&&typeof v==='object'?Object.keys(v).length===1&&'$text'in v?value.sharedText[v.$text]:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,f(x)])):v;return f(value);};
 const fetcher=async(url,init)=>{
  if(init.method==='POST'){
   posts++;const body=JSON.parse(init.body),phase=body.model==='anthropic/claude-haiku-4.5'?'review':'strategy';actualWires[phase]=Buffer.byteLength(init.body);assert.ok(actualWires[phase]<=49152);
   const input=decode(JSON.parse(body.messages[1].content));assert.equal(input.previousDecision,undefined);assert.equal(input.candidates.length,1);assert.deepEqual(input.comparisonUniverse.markets,[{countryCode:'GB',currency:'GBP'}]);
   const strat=strategyOutput(prepared),output=phase==='strategy'?strat:{marketCountryCode:'GB',candidateKey:'C1',outcome:'TEST',sufficiencyRationale:'The proposed original composition inspection answers the fixed private learning question while preserving all commercial unknowns and separate execution approvals.',dimensions:strat.candidates[0].dimensions.map(d=>({dimension:d.dimension,verdict:d.uncertainties.length?'nonblocking_unknown':'sufficient_for_test',rationale:'The finding supports only the bounded private composition test and preserves every commercial unknown.',evidence:d.facts.map(x=>x.evidence)})),checks:REVIEW_CHECKS_V2.map(check=>({check,outcome:'PASS',rationale:'The fixed private proposal preserves source limitations, originality constraints and separate execution approvals.'})),additionalUncertainties:[]};
   if(phase==='review'&&reviewFailure)output.additionalUncertainties=[{dimension:'production_complexity',question:'Can this unverified design be printed without unresolved fine-detail loss?',blockingForTest:true,reason:'The response contradicts its TEST outcome with a blocking production question.'}];
   if(phase==='strategy'&&['NEEDS_MORE_EVIDENCE','REJECT'].includes(strategyOutcome)){output.usesPinnedLearningPlan=false;output.recommendation.proposedOutcome=strategyOutcome;}
   if(phase==='strategy'&&strategyOutcome==='INCONSISTENT')output.candidates[0].dimensions.find(d=>d.uncertainties.length).uncertainties[0].blockingForTest=true;
   if(phase==='strategy'&&strategyOutcome==='INVALID')output.unapprovedField='Invalid bounded fixture';
   return new Response(JSON.stringify({id:`gen-pilot-${phase}-${sid}`,model:phase==='review'?'anthropic/claude-4.5-haiku-20251001':'openai/gpt-5.6-luna-20260709',choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,cost:.00001}}),{status:200});
  }
  gets++;const phase=String(url).includes('gen-pilot-review')?'review':'strategy';
  assert.equal((await one('select count(*)::int n from private.r12_discovery_candidates c join private.r12_discovery_wires w on w.request_id=c.request_id where w.scope_id=$1 and w.binding->>\'phase\'=$2',[sid,phase])).n,1,'Candidate saved before any receipt request');
  if(delay)return new Response(JSON.stringify({error:{message:'Inert delayed receipt'}}),{status:404});
  return new Response(JSON.stringify({data:{id:`gen-pilot-${phase}-${sid}`,provider_name:phase==='review'?'Amazon Bedrock':'Azure',model:phase==='review'?'anthropic/claude-4.5-haiku-20251001':'openai/gpt-5.6-luna-20260709'}}),{status:200});
 };
 const adapters=Object.fromEntries(plan.steps.map(step=>[step.adapter,createDiscoveryR12QuestAdapter({scope:e,phase:step.key,identity:{qualificationHash:step.qualificationHash,workflowDefinitionId:step.workflowDefinitionId,workerDefinitionId:step.workerDefinitionId,mode:'qualification'},dataClasses:['business_context','public_evidence'],store:effectStore,request:async ctx=>{
  const raw=await operation(ctx.attempt.id,'inputs',{}),state=runtime.readDiscoveryR12PhaseInputs(ctx,raw);
  if(!prepared){const knowledge={snapshot:raw.knowledgeSnapshot,entries:raw.knowledgeSnapshot.entries};const validated=validateDiscoveryFocusedPilot(e,raw.original,Date.parse(raw.validationAt)),dossier={version:'pod-discovery-2.0',intentId:sid,businessId:p.businessId,shortlist:[p.candidate],packRefs:[],comparisonRationale:p.history.scopeChangeExplanation,addendumRef:{artifactId:p.observations.id,sha256:hash(p.observations)}};
   // Match the runtime's prepared context instead of inventing a source pack.
   const built=runtime.buildDiscoveryR12PhaseRequest(ctx,state);const input=decode(JSON.parse(built.messages[1].content));prepared={evidencePool:input.evidence.map(x=>({...x,sourceContext:x.sourceContext}))};void[knowledge,validated,dossier];return built;}
  return runtime.buildDiscoveryR12PhaseRequest(ctx,state);},quote:async()=>quote,project:async(qualified,ctx,request)=>runtime.projectDiscoveryR12Phase(ctx,runtime.readDiscoveryR12PhaseInputs(ctx,await operation(ctx.attempt.id,'inputs',{})),qualified,request),config:{apiKey:'inert-focused-pilot-provider',baseUrl:'https://openrouter.ai/api/v1',appUrl:'https://agent-labs-two.vercel.app',appName:'Agent Labs'},fetcher})]));
 const tick=()=>driveQuestOnce(store,{adapters,reconcile:true});
 const closeRun=async()=>{
  if(ownerApi)await ownerApi.server.stopDiscoveryR12(ownerApi.context,p.businessId,sid);else await ownerRpc('r05_policy_owner',[p.businessId,'revoke',{policyId:plan.policyId,policyHash:plan.policyHash},randomUUID()]);
  const closed=await runOperatorRecipe(recipeClient,'close',{businessId:p.businessId,scopeId:sid,scopeHash:hash(e),policyId:plan.policyId,policyHash:plan.policyHash,planHash:activated.planHash,...(authorization?{[authorizationHashField]:hash(authorization)}:{})});
  if(successor)assert.deepEqual((await one('select private.r12_pilot_successor_closure($1) closure',[successor.scopeId])).closure,successor.closure,'Closed predecessor receipt and charges remain byte-identical');
  if(recovery)assert.deepEqual((await one('select private.r12_pilot_unsent_closure($1) closure',[recovery.scopeId])).closure,recovery.unsentClosure,'Closed unsent receipt and released exposure remain immutable');
  assert.deepEqual(await one('select (select jsonb_agg(to_jsonb(v) order by revision) from private.r04_goal_versions v where goal_id=$1) goals,(select jsonb_agg(to_jsonb(p) order by version) from private.r07_plans p where goal_id=$1) plans,(select to_jsonb(h) from private.r07_heads h where goal_id=$1) head,(select jsonb_agg(to_jsonb(l) order by experiment_id) from private.r04_research_links l where goal_id=$1) links',[oldPlan.goal_id]),oldFrozen,'Every terminal outcome preserves original broad Goal and controller history');
  assert.equal(closed.activeAuthority,false);const closedView=await ownerRpc('r12_discovery_owner_read',[p.businessId,sid,false]);assert.equal(closedView.cost.heldMicrousd,'0');assert.equal(closedView.cost.hasUnknown,false);assert.equal(closedView.activeWindow,false);
  return closed;
 };
 for(const phase of phaseKeys){
  if(phase==='review'&&strategyOutcome!=='TEST'){
   const stopped=await tick();assert.equal(stopped.status,'blocked');assert.equal(stopped.reason,'r12_successor_strategy_terminal');assert.equal(posts,1);
   assert.equal((await one("select count(*)::int n from private.r07_attempts where plan_id=$1 and step_key='review'",[snapshot.planId])).n,0);
   await closeRun();return{providerCalls:0,inertPosts:posts,inertReceiptGets:gets,metadata:fixtureMetadata,closedBroad,scopeId:sid,planId:snapshot.planId,strategyOutcome,activeAuthority:false};
  }
  assert.equal((await tick()).reason,'scheduled');assert.equal((await tick()).reason,'reserved');
  if(onReservedDispatch&&phase==='strategy'){
   assert.equal((await tick()).reason,'full_shape_dispatch_captured');assert.equal(posts,0);assert.equal(gets,0);
   const captured=await onReservedDispatch({db,metadata:fixtureMetadata,closedBroad,scopeId:sid,planId:snapshot.planId,activated,plan,command,controller,admission,lease,ownerApi,closeRun,httpRuntime:{useRpc:rpc=>{externalRpc=rpc;captureDispatch=false;},tick,receiptReady:()=>{delay=false;},counters:()=>({inertPosts:posts,inertReceiptGets:gets})},...capturedDispatch});
   if(captured?.continueLifecycle!==true)return captured;captureDispatch=false;
  }
  if(phase==='strategy'&&strategyOutcome==='INVALID'){
   await assert.rejects(tick());assert.equal(posts,1);assert.equal(gets,0);
   const view=await ownerRpc('r12_discovery_owner_read',[p.businessId,sid,false]);assert.equal(view.phases[0].responseDiagnostic.code,'response_schema');assert.equal(view.phases[0].candidateSaved,false);assert.equal(view.cost.hasUnknown,false);
   await closeRun();return{providerCalls:0,inertPosts:posts,inertReceiptGets:gets,metadata:fixtureMetadata,closedBroad,scopeId:sid,planId:snapshot.planId,strategyOutcome,activeAuthority:false};
  }
  try{await tick();}catch(error){if(error.message!=='r12_discovery_receipt_pending')throw error;}assert.equal(posts,phase==='strategy'?1:2);
  const held=(await one('select private.stage13v2_budget_authority($1,false) result',[p.priorRoundId])).result;assert.equal(held.knownActualMicrousd,budgetBefore.knownActualMicrousd+10*posts);
  await db.exec('alter table private.r12_discovery_receipt_checks disable trigger r12_discovery_history_guard');await db.query("update private.r12_discovery_receipt_checks set created_at=clock_timestamp()-interval '121 seconds' where request_id in(select request_id from private.r12_discovery_wires where scope_id=$1)",[sid]);await db.exec('alter table private.r12_discovery_receipt_checks enable trigger r12_discovery_history_guard');delay=false;
  if(phase==='strategy'&&strategyOutcome==='INCONSISTENT'){
   await assert.rejects(tick(),/inconsistent_strategy|coherent|blocking/i);assert.equal(posts,1);
   const view=await ownerRpc('r12_discovery_owner_read',[p.businessId,sid,false]);assert.equal(view.phases[0].responseDiagnostic.code,'domain_validation');assert.equal(view.phases[0].candidateSaved,true);assert.equal(view.cost.hasUnknown,false);
   assert.equal((await one("select count(*)::int n from private.r07_attempts where plan_id=$1 and step_key='review'",[snapshot.planId])).n,0);
   await closeRun();return{providerCalls:0,inertPosts:posts,inertReceiptGets:gets,metadata:fixtureMetadata,closedBroad,scopeId:sid,planId:snapshot.planId,strategyOutcome,activeAuthority:false};
  }
  if(phase==='review'&&reviewFailure){
   await assert.rejects(tick(),/blocking|TEST|test|uncertaint/i);assert.equal(posts,2);
   await closeRun();const closure=(await one('select private.r12_pilot_successor_closure($1) result',[sid])).result;
   return{providerCalls:0,inertPosts:posts,inertReceiptGets:gets,metadata:fixtureMetadata,closedBroad,scopeId:sid,planId:snapshot.planId,closure,activeAuthority:false};
  }
  for(let i=0;i<3;i++){const result=await tick();if(result.reason==='response_projected'||result.status==='completed')break;}delay=true;
 }
 const done=await tick();assert.equal(done.status,'completed');assert.equal(posts,2);
 const savedPilot=await ownerRpc('r12_discovery_result_read',[p.businessId,sid]),result=runtime.reconstructDiscoveryR12Result(savedPilot,p.businessId,sid);assert.equal(result.review.outcome,'TEST');assert.deepEqual(result.assessment.testPlan,p.pinnedLearningPlan);assert.deepEqual(result.phaseReceipts.map(r=>r.phase),phaseKeys);assert.deepEqual(result.dossier.packRefs,[]);
 const budgetAfter=(await one('select private.stage13v2_budget_authority($1,false) b',[p.priorRoundId])).b;assert.equal(budgetAfter.knownActualMicrousd,budgetBefore.knownActualMicrousd+20);assert.equal(budgetAfter.maximumMicrousd,2000000);
 assert.deepEqual(await one('select (select jsonb_agg(to_jsonb(v) order by revision) from private.r04_goal_versions v where goal_id=$1) goals,(select jsonb_agg(to_jsonb(p) order by version) from private.r07_plans p where goal_id=$1) plans,(select to_jsonb(h) from private.r07_heads h where goal_id=$1) head,(select jsonb_agg(to_jsonb(l) order by experiment_id) from private.r04_research_links l where goal_id=$1) links',[oldPlan.goal_id]),oldFrozen);
 if(successor){
  await closeRun();
  await db.exec('savepoint successor_later_adoption');
  try{
   const ownerIntent={version:'r12.focused-adoption-owner.1',scopeId:sid,profileHash:e.profileHash,resultHash:hash(result),goalId:p.goalId,goalRevision:plan.goalRevision,goalHash:plan.goalHash,candidateId:p.candidate.id,learningPlanHash:hash(p.pinnedLearningPlan),originalResearchFundingRootId:p.budgetAuthorityRootId,adoptForPrivateLearning:true,creativeExecutionAuthorized:false};
   await expectRejected(()=>ownerRpc('adopt_r12_focused_test',[sid,result,{...ownerIntent,scopeId:successor.scopeId}]));
   const adoption=await ownerRpc('adopt_r12_focused_test',[sid,result,ownerIntent]);assert.equal(adoption.executionAuthorized,false);
   assert.equal((await one('select count(*)::int n from public.creative_runs')).n,0,'A research TEST plus explicit adoption creates no creative run');
  }finally{await db.exec('rollback to savepoint successor_later_adoption');await db.exec('release savepoint successor_later_adoption');}
 }
 return {metadata:fixtureMetadata,closedBroad,scopeId:sid,planId:snapshot.planId,activeAuthority:!successor,providerCalls:0,inertPosts:posts,inertReceiptGets:gets,actualWires,newGoal:p.goalId,oldGoalUnchanged:true,newPlanVersion:1,outcome:result.review.outcome,cumulativeRootIncrement:20,savedPilot};
}
