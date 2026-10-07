/** Disposable full SQL fixture. Trusted fixture registration is not a production recipe. */
import assert from 'node:assert/strict';
import {randomUUID,createHash,createHmac} from 'node:crypto';
import {createRequire} from 'node:module';
import {focusedProfileFixture,focusedStrategyOutput} from './r12-focused-profile-fixture.mjs';
import {runOperatorRecipe} from '../../scripts/r12-focused-pilot-bootstrap.mjs';
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
export async function exerciseFocusedPilotLifecycle(db,closed,{nested=false,ownerPreparationReceipt=null,stageOnly=false}={}){
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0],recipeClient=reviewRecipeClient(db,nested);
 const ownerRpc=async(name,args)=>{await db.exec('savepoint pilot_owner_rpc');await db.exec('set role authenticated');try{return(await one(`select public.${name}(${args.map((_,n)=>`$${n+1}`).join(',')}) result`,args)).result;}catch(error){await db.exec('rollback to savepoint pilot_owner_rpc');throw error;}finally{await db.exec('reset role');await db.exec('release savepoint pilot_owner_rpc');}};
 const oldPlan=await one('select * from private.r07_plans where id=$1',[closed.activated.planId]);
 const oldScope=await one('select * from private.r12_discovery_scopes where id=$1',[closed.metadata.scopeId]);
 const saved=(await one('select public.r12_discovery_result_read($1,$2) result',[oldPlan.business_id,oldScope.amendment.predecessorScopeId])).result;
 const historic=runtime.reconstructDiscoveryR12Result(saved,oldPlan.business_id,oldScope.amendment.predecessorScopeId);assert.equal(historic.review.outcome,'NEEDS_MORE_EVIDENCE');
 const oldFrozen=await one('select (select jsonb_agg(to_jsonb(v) order by revision) from private.r04_goal_versions v where goal_id=$1) goals,(select jsonb_agg(to_jsonb(p) order by version) from private.r07_plans p where goal_id=$1) plans,(select to_jsonb(h) from private.r07_heads h where goal_id=$1) head,(select jsonb_agg(to_jsonb(l) order by experiment_id) from private.r04_research_links l where goal_id=$1) links',[oldPlan.goal_id]);
 const now=Date.now(),start=new Date(now-1000).toISOString(),end=ownerPreparationReceipt?.setupUntil??new Date(Math.floor((now+7200000)/1000)*1000).toISOString(),p=focusedProfileFixture(),sid=ownerPreparationReceipt?.preparationId??randomUUID();
 p.id=sid;p.businessId=oldPlan.business_id;p.originalGoalId=oldPlan.goal_id;p.budgetAuthorityRootId=oldScope.budget_authority_root_id;p.priorRoundId=oldScope.prior_round_id;
 p.originalIntentHash=hash(saved.inputs.original.priorIntent);p.originalSemanticGoalHash=saved.inputs.original.semanticGoalHash;
 p.intent={...p.intent,id:sid,businessId:p.businessId,objective:R12_PILOT_OBJECTIVE,expiresAt:end};p.learningQuestion=R12_PILOT_QUESTION;p.intent.comparisonUniverse.selectionQuestion=p.learningQuestion;p.candidate=structuredClone(historic.dossier.shortlist[0]);p.intent.comparisonUniverse.audiences=[p.candidate.audience];
 p.createdAt=start;p.expiresAt=end;p.history.acceptedReviewScopeId=oldScope.amendment.predecessorScopeId;p.history.acceptedReviewHash=hash(historic.review);p.history.record=focusedPilotHistoricalRecord(historic);p.history.recordHash=hash(p.history.record);
 p.observations={...p.observations,id:randomUUID(),businessId:p.businessId,predecessorScopeId:p.history.acceptedReviewScopeId,predecessorReviewHash:p.history.acceptedReviewHash,createdAt:start,expiresAt:end,observations:p.observations.observations.map(o=>({...o,retrievedAt:new Date(now-120000).toISOString(),expiresAt:end}))};
 p.pinnedLearningPlan.evidenceRefs=discoveryAddendumReferences(p.observations);
 const quote=r12PilotQuoteFixture(now);assert.deepEqual(quote.ceilings,{strategy:66671,review:211236});assert.equal(quote.maximumMicrousd,277907);
 // Conservative inert quoted ceilings are bounded; real operator uses fresh pilot qualification.
 const {quoteHash:_hash,verifiedAt:_verified,validUntil:_valid,...quoteBody}=quote;void[_hash,_verified,_valid];quote.quoteHash=hash(quoteBody);
 p.researchAllocationMicrousd=quote.maximumMicrousd;
 const content=r12PilotGoalContent({businessId:p.businessId,sourceScopeId:oldScope.id,preparationId:sid,setupUntil:end});
 let create;
 if(ownerPreparationReceipt){assert.equal(ownerPreparationReceipt.businessId,p.businessId);assert.equal(ownerPreparationReceipt.sourceScopeId,oldScope.id);assert.equal(ownerPreparationReceipt.closedPlanHash,oldPlan.content_hash);create={id:ownerPreparationReceipt.goalId};const exactGoal=await one('select content from private.r04_goal_versions where goal_id=$1 order by revision desc limit 1',[create.id]);assert.deepEqual(exactGoal.content,content);}
 else {
 const saveId=randomUUID();create=await ownerRpc('r04_quest_transition',[p.businessId,'quest.save',{goalId:null,expectedRevision:0,content},saveId]);
 assert.equal(create.revision,1);assert.notEqual(create.id,oldPlan.goal_id);assert.equal((await ownerRpc('r04_quest_transition',[p.businessId,'quest.save',{goalId:null,expectedRevision:0,content},saveId])).id,create.id);
 const ready=await ownerRpc('r04_quest_transition',[p.businessId,'quest.preference',{goalId:create.id,expectedRevision:1,preference:'ready'},randomUUID()]);assert.equal(ready.revision,2);
 }
 p.goalId=create.id;p.observations.goalId=p.goalId;
 const e={version:'r12.discovery-focused-pilot.1',id:sid,businessId:p.businessId,goalId:p.goalId,budgetAuthorityRootId:p.budgetAuthorityRootId,priorRoundId:p.priorRoundId,profile:p,profileHash:hash(p),originalGoalId:p.originalGoalId,closedPlanId:oldPlan.id,closedPlanHash:oldPlan.content_hash,acceptedReviewScopeId:p.history.acceptedReviewScopeId,acceptedReviewHash:p.history.acceptedReviewHash,acceptedReviewRecordHash:p.history.recordHash,originalIntentHash:p.originalIntentHash,originalSemanticGoalHash:p.originalSemanticGoalHash,allowedDomains:p.intent.comparisonUniverse.sourceDomains,excludedDomains:['etsy.com','etsy.me','etsystatic.com'],approvedQuery:p.learningQuestion,approvalHash:'b'.repeat(64),independentReviewHash:'c'.repeat(64),createdAt:start,expiresAt:end};
 const scopeInsert=env=>db.query('insert into private.r12_discovery_scopes(id,business_id,goal_id,budget_authority_root_id,prior_round_id,amendment,amendment_hash) values($1,$2,$3,$4,$5,$6,$7)',[env.id,env.businessId,env.goalId,env.budgetAuthorityRootId,env.priorRoundId,env,hash(env)]);
 const expectRejected=async(action,pattern)=>{await db.exec('savepoint pilot_negative');try{await assert.rejects(action,pattern);}finally{await db.exec('rollback to savepoint pilot_negative');await db.exec('release savepoint pilot_negative');}};
 for(const mutate of [x=>x.closedPlanHash='0'.repeat(64),x=>x.closedPlanId=randomUUID(),x=>{x.profile.candidate.concept+=' changed';x.profileHash=hash(x.profile);},x=>{x.profile.intent.comparisonUniverse.selectionQuestion+=' changed';x.profileHash=hash(x.profile);},x=>{x.acceptedReviewHash='0'.repeat(64);x.profile.history.acceptedReviewHash=x.acceptedReviewHash;x.profile.observations.predecessorReviewHash=x.acceptedReviewHash;x.profileHash=hash(x.profile);}]){const bad=structuredClone(e);mutate(bad);await expectRejected(()=>scopeInsert(bad));}
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
 const stageInput={envelope:e,proposal,quote,executionReviewHash,eligibilityReviewHash};
 const staged=await runOperatorRecipe(recipeClient,'stage',stageInput);assert.equal(staged.authorityCreated,false);
 if(!stageOnly){
 const otherSave=await ownerRpc('r04_quest_transition',[p.businessId,'quest.save',{goalId:null,expectedRevision:0,content},randomUUID()]);await ownerRpc('r04_quest_transition',[p.businessId,'quest.preference',{goalId:otherSave.id,expectedRevision:1,preference:'ready'},randomUUID()]);
 const duplicate=structuredClone(e);duplicate.id=randomUUID();duplicate.goalId=otherSave.id;duplicate.profile.id=duplicate.id;duplicate.profile.goalId=otherSave.id;duplicate.profile.intent.id=duplicate.id;duplicate.profile.observations.goalId=otherSave.id;duplicate.profileHash=hash(duplicate.profile);
 await expectRejected(()=>scopeInsert(duplicate),/r12_one_focused_pilot_per_closed_plan/);
 }
 const fixtureMetadata={...closed.metadata,businessId:p.businessId,goalId:p.goalId,scopeId:sid,ownerId:oldPlan.owner_id,sourceScopeId:oldScope.id,originalGoalId:oldPlan.goal_id,focusedProfile:p,focusedEnvelope:e,proposal,stageInput,staged,quote,executionReviewHash,eligibilityReviewHash};
 if(stageOnly)return {metadata:fixtureMetadata,staged,stageInput};

 const confirmation=await ownerRpc('r12_review_owner_confirm',[p.businessId,sid,hash(proposal)]);assert.equal(confirmation.executionAuthorized,false);
 assert.equal((await ownerRpc('r12_review_owner_confirm',[p.businessId,sid,hash(proposal)])).replayed,true);
 const derive=role=>createHmac('sha256','inert-r12-owner-root-configuration-0123456789').update(JSON.stringify({version:'r12.scoped-authority.1',role,businessId:p.businessId,ownerId:oldPlan.owner_id,scopeId:sid})).digest('base64url');
 const controller=derive('controller'),admission=derive('admission'),lease='inert-pilot-lease-'+randomUUID();
 const activationInput={businessId:p.businessId,scopeId:sid,scopeHash:hash(e),proposalHash:hash(proposal),policyId:confirmation.policyId,policyHash:confirmation.policyHash,
  quote,executionReviewHash,eligibilityReviewHash,controllerKeyHash:digest(controller),admissionKeyHash:digest(admission)};
 const activated=await runOperatorRecipe(recipeClient,'activate',activationInput);const plan=activated.plan;
 assert.equal(activated.providerCalls,0);assert.equal(activated.planId,null);assert.equal(activated.shouldDispatch,false);
 const rpc=async(name,args)=>{await db.exec('savepoint pilot_effect_rpc');await db.exec('set role anon');try{return(await one(`select public.${name}(${args.map((_,n)=>`$${n+1}`).join(',')}) result`,args)).result;}catch(error){await db.exec('rollback to savepoint pilot_effect_rpc');throw error;}finally{await db.exec('reset role');await db.exec('release savepoint pilot_effect_rpc');}};
 const command=(op,payload,epoch=null)=>rpc('r07_controller',[p.businessId,p.goalId,op,payload,randomUUID(),controller,lease,epoch,admission]);
 await command('plan',{plan,expectedVersion:0,reason:'Inert finite independent focused pilot',evidenceHash:hash(e)});
 const snapshot=await command('read',{});assert.equal(snapshot.planVersion??(await one('select version from private.r07_plans where id=$1',[snapshot.planId])).version,1);
 const operation=(attemptId,operation,payload)=>rpc('r12_discovery_server',[p.businessId,attemptId,operation,payload,controller]);
 const effectStore={operation,settle:(attemptId,settlement)=>command('settle',{attemptId,settlement}),dispatchedAt:async attemptId=>(await operation(attemptId,'load',{})).dispatchedAt};
 const store={read:()=>command('read',{}),command:(op,payload,epoch)=>command(op,['schedule','reserve'].includes(op)?{...payload,runtimeCapability:'inert-focused-pilot-capability-0123456789'}:payload,epoch)};
 let posts=0,gets=0,delay=true;const actualWires={};let prepared;
 const decode=value=>{const f=v=>Array.isArray(v)?v.map(f):v&&typeof v==='object'?Object.keys(v).length===1&&'$text'in v?value.sharedText[v.$text]:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,f(x)])):v;return f(value);};
 const fetcher=async(url,init)=>{
  if(init.method==='POST'){
   posts++;const body=JSON.parse(init.body),phase=body.model==='anthropic/claude-haiku-4.5'?'review':'strategy';actualWires[phase]=Buffer.byteLength(init.body);assert.ok(actualWires[phase]<=49152);
   const input=decode(JSON.parse(body.messages[1].content));assert.equal(input.previousDecision,undefined);assert.equal(input.candidates.length,1);assert.deepEqual(input.comparisonUniverse.markets,[{countryCode:'GB',currency:'GBP'}]);
   const strat=focusedStrategyOutput(prepared),output=phase==='strategy'?strat:{marketCountryCode:'GB',candidateKey:'C1',outcome:'TEST',sufficiencyRationale:'The proposed original composition inspection answers the fixed private learning question while preserving all commercial unknowns and separate execution approvals.',dimensions:strat.candidates[0].dimensions.map(d=>({dimension:d.dimension,verdict:d.uncertainties.length?'nonblocking_unknown':'sufficient_for_test',rationale:'The finding supports only the bounded private composition test and preserves every commercial unknown.',evidence:d.facts.map(x=>x.evidence)})),checks:REVIEW_CHECKS_V2.map(check=>({check,outcome:'PASS',rationale:'The fixed private proposal preserves source limitations, originality constraints and separate execution approvals.'})),additionalUncertainties:[]};
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
 for(const phase of phaseKeys){assert.equal((await tick()).reason,'scheduled');assert.equal((await tick()).reason,'reserved');try{await tick();}catch(error){if(error.message!=='r12_discovery_receipt_pending')throw error;}assert.equal(posts,phase==='strategy'?1:2);
  const held=(await one('select private.stage13v2_budget_authority($1,false) result',[p.priorRoundId])).result;assert.equal(held.knownActualMicrousd,budgetBefore.knownActualMicrousd+10*posts);
  await db.exec('alter table private.r12_discovery_receipt_checks disable trigger r12_discovery_history_guard');await db.query("update private.r12_discovery_receipt_checks set created_at=clock_timestamp()-interval '121 seconds' where request_id in(select request_id from private.r12_discovery_wires where scope_id=$1)",[sid]);await db.exec('alter table private.r12_discovery_receipt_checks enable trigger r12_discovery_history_guard');delay=false;
  for(let i=0;i<3;i++){const result=await tick();if(result.reason==='response_projected'||result.status==='completed')break;}delay=true;
 }
 const done=await tick();assert.equal(done.status,'completed');assert.equal(posts,2);
 const savedPilot=await ownerRpc('r12_discovery_result_read',[p.businessId,sid]),result=runtime.reconstructDiscoveryR12Result(savedPilot,p.businessId,sid);assert.equal(result.review.outcome,'TEST');assert.deepEqual(result.assessment.testPlan,p.pinnedLearningPlan);assert.deepEqual(result.phaseReceipts.map(r=>r.phase),phaseKeys);assert.deepEqual(result.dossier.packRefs,[]);
 const budgetAfter=(await one('select private.stage13v2_budget_authority($1,false) b',[p.priorRoundId])).b;assert.equal(budgetAfter.knownActualMicrousd,budgetBefore.knownActualMicrousd+20);assert.equal(budgetAfter.maximumMicrousd,2000000);
 assert.deepEqual(await one('select (select jsonb_agg(to_jsonb(v) order by revision) from private.r04_goal_versions v where goal_id=$1) goals,(select jsonb_agg(to_jsonb(p) order by version) from private.r07_plans p where goal_id=$1) plans,(select to_jsonb(h) from private.r07_heads h where goal_id=$1) head,(select jsonb_agg(to_jsonb(l) order by experiment_id) from private.r04_research_links l where goal_id=$1) links',[oldPlan.goal_id]),oldFrozen);
 return {providerCalls:0,inertPosts:posts,inertReceiptGets:gets,actualWires,newGoal:p.goalId,oldGoalUnchanged:true,newPlanVersion:1,outcome:result.review.outcome,cumulativeRootIncrement:20,savedPilot};
}
