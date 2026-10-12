/** Isolated thorough-profile SQL fixture. All identities and response material
 * are synthetic; this helper never sends a provider request. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {r12CatalogFixture} from './r12-provider-fixture.mjs';
import {podSource,podHash,podSha,podOne,podRpc,podSqlFixture,podInertOutputs} from './r12-pod-sql-fixture.mjs';
const phases=['plan','search1','select1','strategy','review'];
export const podThoroughSqlQuote=()=>{
 const now=Date.now(),catalogs=r12CatalogFixture(now);
 // Synthetic exact-route fixture, not a claim about current provider capacity.
 for(const key of ['lunaAlias','lunaCanonical','reviewerAlias','reviewerCanonical'])for(const e of catalogs[key].payload.data.endpoints){e.context_length=2097152;e.max_prompt_tokens=2097152;e.max_completion_tokens=65536;}
 for(const e of catalogs.zdr.payload.data){e.context_length=2097152;e.max_prompt_tokens=2097152;e.max_completion_tokens=65536;}
 return podSource('products/discovery-r12-quote').qualifyPodResearchQuote(catalogs,now,true);
};
export async function podThoroughSqlTemplate(db,f,{recovery=false}={}){
 for(const manifest of podSource('products/discovery-r12-pod-packs').podResearchPackManifests(true))if(!await podOne(db,'select id from public.packs where pack_key=$1 and version=$2',[manifest.packKey,manifest.version]))await db.query('select private.stage10_register_pack($1)',[manifest]);
 const pack=await podOne(db,"select id from public.packs where pack_key='workflow.pod-research' and version='2.0.0'");
 const workflow=await podOne(db,"select id,private.r04_hash(to_jsonb(w)) hash from public.workflow_definitions w where workflow_key='product.pod-research.one' and version='2.0.0'");
 const snapshot=(await podOne(db,"select jsonb_build_object('rootPackId',$1::uuid,'releases',private.stage10_resolve($1,true)) s",[pack.id])).s;
 const workers={};for(const phase of phases)workers[phase]=await podOne(db,"select id,private.r04_hash(to_jsonb(w)) hash from public.worker_definitions w where worker_key=$1 and version='2.0.0'",['product.pod-research.'+(['search1','select1'].includes(phase)?'research':phase)]);
 const templateId=randomUUID(),limits=podSource('products/discovery-r12-pod-profile').POD_THOROUGH_LIMITS;
 const pins={...f.pins,packId:pack.id,snapshot,snapshotHash:(await podOne(db,'select private.r04_hash($1) h',[snapshot])).h,workflowDefinitionId:workflow.id,workflowHash:workflow.hash,plannerWorkerDefinitionId:workers.plan.id,workers,
 schemas:podSource('products/discovery-r12-pod-runtime').podResearchSchemaPins(recovery,true),recovery,profile:'r12.pod-thorough.1',profileHash:podHash(limits)};
 const templateHash=podHash({version:'inert-counted-failure-template.1',templateId,pins,sourcePolicy:f.sourcePolicy});
 await db.query('insert into private.r12_pod_templates(id,version,source_policy,source_policy_hash,pins,pins_hash,server_key_hash,reviewed_bundle_hash,valid_from,valid_until) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[templateId,'r12.pod-template.4',f.sourcePolicy,podHash(f.sourcePolicy),pins,podHash(pins),podSha(f.bootstrapKey),templateHash,f.sourcePolicy.validFrom,f.sourcePolicy.validUntil]);
 return{templateId,templateHash,pins};
}
export async function podThoroughSqlActivation(db,{fixture=null,goalId=null,quoteOverride=null}={}){
 const original=fixture??await podSqlFixture(db),f=goalId===null?original:{...original,goalId,input:{...original.input,goalId}},
 {templateId,templateHash}=await podThoroughSqlTemplate(db,f);
 const quoted=quoteOverride??podThoroughSqlQuote(),prepared=await f.server('prepare',{input:{...f.input,templateId,templateHash,submissionId:randomUUID()},quote:quoted});
 const runtime=podSource('products/discovery-r12-pod-runtime'),wire=podSource('products/discovery-r12-wire');
 const request=runtime.buildPodPlannerRequest('0'.repeat(64),prepared.preview.sourcePolicyHash,prepared.preview.publicBrief,prepared.preview.sourcePolicy.excludedDomains,null,true);
 const inspected=await wire.inspectDiscoveryR12Wire(wire.routeDiscoveryR12Request(request,'plan',quoted.luna,false,false,true,true),'plan',false,false,false,true,true);
 const controller='inert-counted-controller-'+prepared.scopeId,admission='inert-counted-admission-'+prepared.scopeId,lease='inert-counted-lease-'+randomUUID();
 await f.server('confirm',{setupId:prepared.setupId,setupHash:prepared.setupHash,submissionId:randomUUID(),controllerKeyHash:podSha(controller),admissionKeyHash:podSha(admission),quote:quoted,
 preflight:{setupHash:prepared.setupHash,sourcePolicyHash:prepared.preview.sourcePolicyHash,requestHash:inspected.requestHash,wireHash:inspected.wireHash,wireBytes:inspected.wireBytes}});
 const authority=await podOne(db,"select a.plan,p.payload->'operations' operations,s.amendment scope from private.r12_discovery_authorities a join private.r12_pod_setups st on st.scope_id=a.scope_id join private.r05_policies p on p.id=st.policy_id join private.r12_discovery_scopes s on s.id=a.scope_id where a.scope_id=$1",[prepared.scopeId]);
 const command=(operation,payload,epoch=null,token=lease)=>podRpc(db,'anon',null,'r07_controller',[f.businessId,f.goalId,operation,payload,randomUUID(),controller,token,epoch,admission]);
 await command('plan',{plan:authority.plan,expectedVersion:0,reason:'Inert counted-failure qualification',evidenceHash:'7'.repeat(64)});
 const pass=(op,payload={})=>podRpc(db,'anon',null,'r12_pod_pass_server',[f.businessId,prepared.scopeId,op,payload,controller]);
 const effect=(attemptId,op,payload={})=>podRpc(db,'anon',null,'r12_discovery_server',[f.businessId,attemptId,op,payload,controller]);
 return{f,prepared,...authority,controller,admission,lease,command,pass,effect,read:()=>command('read',{})};
}

export async function podThoroughFailedReviewRuntime(db,{failedReviewPass=0,usefulPass=1,unsafeSearchPath=null,nextConsumerCapacity=false}={}){
 const a=await podThoroughSqlActivation(db),posted=[],got=[],sent=[],outputs=Array.from({length:5},(_,passOrdinal)=>podInertOutputs({passOrdinal,useful:passOrdinal===usefulPass}));
 const store={read:a.read,readAdaptiveAction:()=>a.pass('context'),command:(op,payload,epoch)=>op==='adaptive_complete_action'?a.pass('complete',payload):a.command(op,['schedule','reserve'].includes(op)?{...payload,runtimeCapability:'inert-thorough-runtime-'+a.scope.id}:payload,epoch)};
 const rt=podSource('products/discovery-r12-runtime'),registry={};
 if(unsafeSearchPath!==null){assert.ok(['/account','/profile'].includes(unsafeSearchPath));outputs[0].search1.annotations[0].url_citation.url='https://census.gov'+unsafeSearchPath;}
 if(nextConsumerCapacity){
  const prose=n=>('Synthetic public evidence does not establish purchase intent or delivered cost. '.repeat(Math.ceil(n/79))).slice(0,n-1)+'.';
  const o=outputs[0],original=o.search1.annotations[0].url_citation.content;
  o.search1.annotations=Array.from({length:25},(_,i)=>({type:'url_citation',url_citation:{url:'https://census.gov/inert-capacity-'+i,title:'Synthetic public context '+i,content:original+' Synthetic context '+i+'. '+prose(7400)}}));
  o.strategy.explorationSummary=prose(12000);o.strategy.candidates[0].rationale=prose(6000);o.strategy.candidates[0].alternativeExplanation=prose(6000);
  o.strategy.candidates[0].dimensions.forEach(d=>d.rationale=prose(6000));o.strategy.recommendation.rationale=prose(12000);o.strategy.recommendation.nextTest=prose(8000);o.strategy.limitations=[prose(4000)];
 }
 const executingRelease={version:'r12.executing-release.1',repository:'SSB100/agent-labs',environment:'production',commitSha:'c'.repeat(40),deploymentId:'dpl_inert_thorough_capacity_sql'};
 for(const step of a.plan.steps){const phase=step.key;
 registry[step.adapter]=podSource('products/discovery-r12-adapter').createDiscoveryR12QuestAdapter({scope:a.scope,phase,identity:{qualificationHash:step.qualificationHash,workflowDefinitionId:step.workflowDefinitionId,workerDefinitionId:step.workerDefinitionId,mode:'qualification'},executingRelease,
 dataClasses:a.operations.find(o=>o.operationKey===step.operationKey).dataClasses,
 store:{operation:a.effect,settle:async(attemptId,settlement)=>a.command('settle',{attemptId,settlement},(await a.read()).head.epoch),dispatchedAt:async id=>(await a.effect(id,'load')).dispatchedAt},
 request:async ctx=>rt.buildDiscoveryR12PhaseRequest(ctx,rt.readDiscoveryR12PhaseInputs(ctx,await a.effect(ctx.attempt.id,'inputs'))),quote:async()=>podThoroughSqlQuote(),
 project:async(q,ctx,request)=>rt.projectDiscoveryR12Phase(ctx,rt.readDiscoveryR12PhaseInputs(ctx,await a.effect(ctx.attempt.id,'inputs')),q,request),
 config:{apiKey:'inert-thorough-no-network',baseUrl:'https://openrouter.ai/api/v1',appUrl:'https://agent-labs-two.vercel.app',appName:'Agent Labs'},
 fetcher:async(url,init)=>{const model=phase==='review'?'anthropic/claude-4.5-haiku-20251001':'openai/gpt-5.6-luna-20260709';
 if(init.method==='GET'){got.push(phase);return new Response(JSON.stringify({data:{id:new URL(url).searchParams.get('id'),provider_name:phase==='review'?'Amazon Bedrock':'Azure',model}}));}
 assert.equal(init.method,'POST');const state=await a.read(),attempt=state.attempts.find(x=>x.stepKey===phase&&x.status==='dispatched'),ordinal=attempt.adaptiveActionOrdinal;
 posted.push(phase);sent.push({phase,ordinal,request:JSON.parse(init.body)});const output=outputs[ordinal];
 return new Response(JSON.stringify({id:'gen-inert-counted-review-'+attempt.id,model,choices:[{finish_reason:'stop',message:phase==='search1'?{content:'Synthetic offline research fixture.',annotations:output.search1.annotations}:{content:phase==='review'&&ordinal===failedReviewPass?'{"broken":':JSON.stringify(output[phase])}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,cost:nextConsumerCapacity&&phase==='strategy'?0.00012299999999999998:({plan:5000,search1:8000,select1:5000,strategy:6000,review:4912}[phase])/1000000,...(phase==='search1'?{server_tool_use_details:{web_search_requests:1}}:{})}}));}
 });}
 const tick=async()=>{if(!await store.readAdaptiveAction()){const admission=await a.pass('admit',{quote:podThoroughSqlQuote()});if(!admission.admitted)return{status:admission.completed?'completed':'waiting',reason:admission.reason};}return podSource('core/quest-controller').driveQuestOnce(store,{adapters:registry,reconcile:true});};
 return{...a,store,registry,outputs,posted,got,sent,tick};
}
