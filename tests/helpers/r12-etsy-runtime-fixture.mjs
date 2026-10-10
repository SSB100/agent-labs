/** Real R07/R05/R12 lifecycle with synthetic model/receipt transport only. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {one,ownerInitialRuntimeRpc} from './r12-owner-initial-sql-fixture.mjs';
import {r12PhaseOutputFixture} from './r12-phase-output-fixture.mjs';
import {driveQuestOnce} from '../../.core-tests/core/quest-controller.js';
import {createDiscoveryR12QuestAdapter} from '../../.core-tests/products/discovery-r12-adapter.js';
import {readAdaptivePhaseInputs,projectAdaptivePhaseResponse} from '../../.core-tests/products/discovery-r12-adaptive-inputs.js';
import {buildAdaptivePhaseRequest} from '../../.core-tests/products/discovery-r12-adaptive-runtime.js';

export function etsyActionController(db,x,started){
 const adaptive=(operation,payload={})=>ownerInitialRuntimeRpc(db,'r12_adaptive_controller_server',[x.f.businessId,x.prepared.scopeId,operation,payload,started.controller]);
 const command=(operation,payload,epoch=null)=>operation==='adaptive_complete_action'?adaptive('complete_action',payload):
  ownerInitialRuntimeRpc(db,'r07_controller',[x.f.businessId,x.f.goalId,operation,['schedule','reserve'].includes(operation)?{...payload,runtimeCapability:started.payload.runtimeCapability}:payload,randomUUID(),started.controller,started.lease,epoch,started.admission]);
 return {read:()=>command('read',{}),command,readAdaptiveAction:()=>adaptive('action_context'),adaptive};
}
export async function runEtsyAction(db,x,started,{nextKind='followup',onFirstPost=null,stopAfterResponse=false}={}){
 const store=etsyActionController(db,x,started),scope=started.raw.scope,plan=started.context.plan;
 const operation=(attemptId,op,payload)=>ownerInitialRuntimeRpc(db,'r12_discovery_server',[x.f.businessId,attemptId,op,payload,started.controller]);
 const effects={operation,settle:(attemptId,settlement)=>store.command('settle',{attemptId,settlement}),dispatchedAt:async attemptId=>(await operation(attemptId,'load',{})).dispatchedAt};
 const outputs=r12PhaseOutputFixture(scope.intent.comparisonUniverse.audiences[0]);outputs.plan.queryFocus=[];
 const template=outputs.strategy.marketComparisons[0];outputs.strategy.marketComparisons=scope.intent.comparisonUniverse.markets.map(m=>({...structuredClone(template),...m,evidence:[],feeScenarios:[{...template.feeScenarios[0],sellerBankCountry:m.countryCode}]}));
 const adapters={},phases=[];let posts=0,gets=0;
 for(const step of plan.steps){const phase=step.key;
  adapters[step.adapter]=createDiscoveryR12QuestAdapter({scope,adaptivePreview:x.prepared.preview,phase,
   identity:{qualificationHash:step.qualificationHash,workflowDefinitionId:step.workflowDefinitionId,workerDefinitionId:step.workerDefinitionId,mode:'qualification'},
   dataClasses:['business_context','public_evidence'],store:effects,quote:async()=>x.quote,
   config:{apiKey:'inert-etsy-no-network',baseUrl:'https://openrouter.ai/api/v1',appUrl:'https://agent-labs.example.invalid',appName:'Inert Etsy owner capture'},
   request:async ctx=>{const raw=await operation(ctx.attempt.id,'inputs',{});let input;try{input=readAdaptivePhaseInputs(ctx,raw);}catch(error){throw new Error(error.message+' '+JSON.stringify({phase:ctx.step.key,finance:raw.intentPins.finance}),{cause:error});}return buildAdaptivePhaseRequest(input,input.validationAt);},
   project:async(qualified,ctx,request)=>projectAdaptivePhaseResponse(ctx,readAdaptivePhaseInputs(ctx,await operation(ctx.attempt.id,'inputs',{})),qualified,request),
   fetcher:async(url,init)=>{
    const model=phase==='review'?'anthropic/claude-4.5-haiku-20251001':'openai/gpt-5.6-luna-20260709';
    if(init.method==='POST'){
     posts++;phases.push(phase);assert.ok(['plan','strategy','review'].includes(phase));
     const wire=JSON.parse(init.body);assert.equal(wire.tools,undefined);assert.equal(wire.tool_choice,undefined);
     if(posts===1&&onFirstPost)await onFirstPost({phase,store});
     const body=JSON.parse(wire.messages[1].content),generationId='gen-inert-etsy-'+scope.id+'-'+phase+'-'+posts;
     const output=phase==='plan'?outputs.plan:phase==='strategy'?{assessment:outputs.strategy,measurement:null}:{
      version:'r12.adaptive-review.1',proposalHash:body.proposalHash,outcome:'NEEDS_MORE_EVIDENCE',
      ratings:Object.fromEntries(['evidence','learningValue','testDesign','feasibility'].map(k=>[k,{score:0,rationale:'The owner-reported observation leaves this bounded learning proposal unresolved.',evidenceRefs:[]}])) ,
      proposalConcerns:[],executionPrerequisites:[],additionalQuestions:[],sufficiencyRationale:'No proposal can establish candidate demand from these immutable owner-reported captures.',
      recommendedNextAction:{kind:nextKind,publicQuestion:'Which observed context can distinguish the remaining original apparel hypothesis?',
       hypothesis:'A bounded comparison might resolve the specific remaining uncertainty.',expectedInformationGain:'The result could eliminate or narrow the named original apparel assumption.',
       counterevidenceQuestion:'Which observation would refute the current proposed explanation?',gap:nextKind==='reasoning_review'?'reasoning':'evidence',
       reason:'The named uncertainty remains material and the permitted next step could change the assessment.'}};
     return new Response(JSON.stringify({id:generationId,model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,cost:.00001}}),{status:200});
    }
    assert.equal(init.method,'GET');gets++;
    const generationId=new URL(url).searchParams.get('id');assert.ok(generationId?.startsWith('gen-inert-etsy-'));
    return new Response(JSON.stringify({data:{id:generationId,provider_name:phase==='review'?'Amazon Bedrock':'Azure',model}}),{status:200});
   }});
 }
 let last;
 for(let i=0;i<24;i++){
  last=await driveQuestOnce(store,{adapters,reconcile:true});
  if(last.reason==='adaptive_action_closed'||stopAfterResponse&&last.reason==='response_persisted')break;
  assert.equal(last.status,'progress',JSON.stringify(last));
 }
 assert.equal(last?.reason,stopAfterResponse?'response_persisted':'adaptive_action_closed');
 const saved=await one(db,'select count(*)::int n from private.r12_adaptive_call_admissions where scope_id=$1',[scope.id]);
 return {posts,gets,phases,last,store,admissions:saved.n};
}
