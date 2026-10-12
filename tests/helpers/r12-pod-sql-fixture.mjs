/** Isolated NEW POD qualification only. Synthetic template/catalog/receipts are
 * never live permission, market evidence, credentials or provider transport. */
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {r12CatalogFixture} from './r12-provider-fixture.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(import.meta.url),ts=require('typescript'),modules=new Map();
/** Read current production TS rather than silently exercising stale .core-tests. */
export function podSource(name){
 const file=path.resolve(root,'src',name.endsWith('.ts')?name:name+'.ts');
 if(modules.has(file))return modules.get(file).exports;
 const mod={exports:{}};modules.set(file,mod);
 const compiled=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const local=name=>{if(name==='server-only')return{};if(!name.startsWith('.'))return require(name);let resolved=path.resolve(path.dirname(file),name);if(existsSync(resolved+'.ts'))resolved+='.ts';else if(existsSync(path.join(resolved,'index.ts')))resolved=path.join(resolved,'index.ts');else return require(resolved);return podSource(path.relative(root+'/src',resolved));};
 new Function('require','module','exports','__filename','__dirname',compiled)(local,mod,mod.exports,file,path.dirname(file));return mod.exports;
}
export const podQuoteFixture=(now=Date.now())=>podSource('products/discovery-r12-quote').qualifyPodResearchQuote(r12CatalogFixture(now),now);
export const podHash=v=>podSource('research/qualification').publicResearchHash(v);
export const podSha=v=>createHash('sha256').update(v).digest('hex');
export const podOne=async(db,sql,args=[])=>(await db.query(sql,args)).rows[0];
export const POD_PHASES=['plan','search1','select1','strategy','review'];
export const POD_OBJECTIVE='Research viable print-on-demand products to sell on Etsy.';
export async function podRpc(db,role,owner,name,args){
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner??'']);await db.exec('set role '+role);
 try{return(await podOne(db,`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).result;}catch(error){error.message=`${name}: ${error.message}; ${error.where??''}`;throw error;}finally{await db.exec('reset role');}
}
export async function podPlannerPreflight(prepared,quote){
 const runtime=podSource('products/discovery-r12-pod-runtime'),wire=podSource('products/discovery-r12-wire');
 const request=runtime.buildPodPlannerRequest('0'.repeat(64),prepared.preview.sourcePolicyHash,prepared.preview.publicBrief,prepared.preview.sourcePolicy.excludedDomains),routed=wire.routeDiscoveryR12Request(request,'plan',quote.luna,false,false,true);
 const inspected=await wire.inspectDiscoveryR12Wire(routed,'plan',false,false,false,true);
 return{setupHash:prepared.setupHash,sourcePolicyHash:prepared.preview.sourcePolicyHash,requestHash:inspected.requestHash,wireHash:inspected.wireHash,wireBytes:inspected.wireBytes};
}
export async function podSqlFixture(db,{objective=POD_OBJECTIVE,maximumMicrounits='10000000',businessLifetimeLimitMicrounits='10000000'}={}){
 const ownerId=randomUUID(),businessId=randomUUID(),templateId=randomUUID(),bootstrapKey='inert-pod-template-'+randomUUID();
 await db.query('insert into auth.users(id,email) values($1,$2)',[ownerId,ownerId+'@example.invalid']);
 await db.query('insert into public.businesses(id,owner_user_id,name) values($1,$2,$3)',[businessId,ownerId,'Synthetic NEW POD business']);
 const rpc=(name,args)=>podRpc(db,'authenticated',ownerId,name,args);
 await rpc('r04_quest_transition',[businessId,'business.save',{expectedRevision:0,content:{brandContext:'Public product research',operatingRules:'Finite costs and independent review',allowedActivity:'Public POD recommendations only',restrictions:'No commerce, publishing or account access'},preference:'setup'},randomUUID()]);
 const content={title:'Explore print-on-demand product opportunities',originalIntent:objective,objective,parsed:{researchMode:'r12.pod-research-intent.1',target:null,budget:{amount:'10',currency:'USD'},deadline:{date:new Date(Date.now()+86400000).toISOString().slice(0,10),time:'23:59:59',timezone:'UTC'},scope:'Public print-on-demand product research for Etsy; recommendations only.',geography:[],stopConstraints:['No commerce or publication','Stop on unknown cost']},ambiguities:[]};
 const goal=await rpc('r04_quest_transition',[businessId,'quest.save',{goalId:null,expectedRevision:0,content},randomUUID()]);
 await rpc('r04_quest_transition',[businessId,'quest.preference',{goalId:goal.id,expectedRevision:1,preference:'ready'},randomUUID()]);
 for(const manifest of podSource('products/discovery-r12-pod-packs').podResearchPackManifests())if(!await podOne(db,'select id from public.packs where pack_key=$1 and version=$2',[manifest.packKey,manifest.version]))await db.query('select private.stage10_register_pack($1)',[manifest]);
 const pack=await podOne(db,"select id from public.packs where pack_key='workflow.pod-research' and version='1.0.0'"),workflow=await podOne(db,"select id,private.r04_hash(to_jsonb(w)) hash from public.workflow_definitions w where workflow_key='product.pod-research.one' and version='1.0.0'");
 const snapshot=(await podOne(db,"select jsonb_build_object('rootPackId',$1::uuid,'releases',private.stage10_resolve($1,true)) s",[pack.id])).s;
 const workers={};for(const phase of POD_PHASES)workers[phase]=await podOne(db,"select id,private.r04_hash(to_jsonb(w)) hash from public.worker_definitions w where worker_key=$1 and version='1.0.0'",['product.pod-research.'+(['search1','select1'].includes(phase)?'research':phase)]);
 const validFrom=new Date(Date.now()-60000).toISOString(),validUntil=new Date(Date.now()+86400000).toISOString();
 const sourcePolicy={version:'r12.pod-source-policy.1',reviewId:randomUUID(),method:'openrouter_exa_factual_snippets',purpose:'public_pod_market_research',excludedDomains:['etsy.com','etsy.me','etsystatic.com'],restrictionsRevision:'1'.repeat(64),termsReviewHash:'2'.repeat(64),independentReviewHash:'3'.repeat(64),recipients:{router:'openrouter.ai',search:'exa.ai',researcher:'azure/us',reviewer:'amazon-bedrock/us'},retention:{inference:'no_training_zdr',search:'query_retention_improvement_training_possible',application:'bounded_attributed_audit_evidence'},validFrom,validUntil};
 const pins={packId:pack.id,snapshot,snapshotHash:(await podOne(db,'select private.r04_hash($1) h',[snapshot])).h,workflowDefinitionId:workflow.id,workflowHash:workflow.hash,plannerWorkerDefinitionId:workers.plan.id,workers,executionReviewHash:'4'.repeat(64),eligibilityReviewHash:'5'.repeat(64),policyInterpretationHash:'6'.repeat(64),knowledgeValidUntil:validUntil,schemas:podSource('products/discovery-r12-pod-runtime').podResearchSchemaPins()};
 const templateHash=podHash({version:'inert-pod-template-review.1',templateId,sourcePolicy,pins});
 await db.query('insert into private.r12_pod_templates(id,version,source_policy,source_policy_hash,pins,pins_hash,server_key_hash,reviewed_bundle_hash,valid_from,valid_until) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[templateId,'r12.pod-template.2',sourcePolicy,podHash(sourcePolicy),pins,podHash(pins),podSha(bootstrapKey),templateHash,validFrom,validUntil]);
 const input={businessId,goalId:goal.id,goalRevision:2,templateId,templateHash,publicBrief:{objective,publicConstraints:[],fulfilmentContext:'printful_available'},maximumMicrounits:String(maximumMicrounits),businessLifetimeLimitMicrounits:String(businessLifetimeLimitMicrounits),submissionId:randomUUID()};
 const server=(operation,payload,key=bootstrapKey)=>rpc('r12_pod_owner_server',[businessId,operation,payload,key]);
 const prepare=async(changes={})=>{const quote=podQuoteFixture(),result=await server('prepare',{input:{...input,...changes},quote});Object.defineProperty(result,'_preflight',{value:{quote,receipt:await podPlannerPreflight(result,quote)}});return result;};
 const confirmPayload=prepared=>({setupId:prepared.setupId,setupHash:prepared.setupHash,submissionId:randomUUID(),controllerKeyHash:podSha('inert-pod-controller-'+prepared.scopeId),admissionKeyHash:podSha('inert-pod-admission-'+prepared.scopeId),quote:prepared._preflight.quote,preflight:prepared._preflight.receipt});
 return{db,ownerId,businessId,goalId:goal.id,templateId,sourcePolicy,pins,input,content,bootstrapKey,rpc,server,prepare,confirmPayload,read:()=>rpc('r12_pod_research_read',[businessId,goal.id,null])};
}
export async function podActivate(db,options={}){
 const f=await podSqlFixture(db,options),prepared=await f.prepare(),activated=await f.server('confirm',f.confirmPayload(prepared));
 const controller='inert-pod-controller-'+prepared.scopeId,admission='inert-pod-admission-'+prepared.scopeId,lease='inert-pod-controller-lease-'+prepared.scopeId;
 const command=(operation,payload,epoch=null)=>podRpc(db,'anon',null,'r07_controller',[f.businessId,f.goalId,operation,payload,randomUUID(),controller,lease,epoch,admission]);
 const authority=await podOne(db,"select a.plan,p.payload->'operations' operations from private.r12_discovery_authorities a join private.r12_pod_setups s on s.scope_id=a.scope_id join private.r05_policies p on p.id=s.policy_id where a.scope_id=$1",[prepared.scopeId]);
 await command('plan',{plan:authority.plan,expectedVersion:0,reason:'Inert owner-approved POD continuation',evidenceHash:'7'.repeat(64)});
 const pass=(operation,payload={})=>podRpc(db,'anon',null,'r12_pod_pass_server',[f.businessId,prepared.scopeId,operation,payload,controller]);
 const store={read:()=>command('read',{}),readAdaptiveAction:()=>pass('context'),command:(op,payload,epoch)=>op==='adaptive_complete_action'?pass('complete',payload):command(op,['schedule','reserve'].includes(op)?{...payload,runtimeCapability:'inert-pod-runtime-'+prepared.scopeId}:payload,epoch)};
 const inputs=attemptId=>podRpc(db,'anon',null,'r12_discovery_server',[f.businessId,attemptId,'inputs',{},controller]);
 return{f,prepared,activated,controller,admission,lease,command,store,inputs,pass,operations:authority.operations,plan:authority.plan,scope:(await podOne(db,'select amendment from private.r12_discovery_scopes where id=$1',[prepared.scopeId])).amendment};
}
export async function exercisePodOwnerAdmission(db){
 const f=await podSqlFixture(db),catalog=await f.read();assert.equal(catalog.goal.content.objective,POD_OBJECTIVE);assert.equal(catalog.goal.content.parsed.target,null);assert.deepEqual(catalog.goal.content.parsed.geography,[]);
 const prepared=await f.prepare();assert.equal(prepared.confirmed,false);assert.equal(prepared.activated,false);assert.equal(prepared.preview.authorityCreated,false);
 assert.deepEqual(await podOne(db,'select (select count(*)::int from private.r12_discovery_scopes where business_id=$1) scopes,(select count(*)::int from private.r05_requests where business_id=$1) requests',[f.businessId]),{scopes:0,requests:0});
 const confirm=f.confirmPayload(prepared),activated=await f.server('confirm',confirm);assert.equal(activated.activated,true);assert.deepEqual(await f.server('confirm',confirm),activated);
 const row=await podOne(db,'select * from private.r12_discovery_scopes where id=$1',[prepared.scopeId]);assert.equal(row.origin,'pod_goal');assert.equal(row.prior_round_id,null);assert.equal(row.budget_authority_root_id,null);assert.deepEqual(row.amendment.publicBrief,f.input.publicBrief);
 assert.deepEqual(await podOne(db,'select (select count(*)::int from public.product_experiments where business_id=$1) legacy,(select count(*)::int from private.r12_owner_activations where business_id=$1) old_activations,(select count(*)::int from private.r12_owner_bootstrap_grants where business_id=$1) old_grants',[f.businessId]),{legacy:0,old_activations:0,old_grants:0});
 const other=randomUUID();await db.query('insert into auth.users(id,email) values($1,$2)',[other,other+'@example.invalid']);
 await assert.rejects(podRpc(db,'authenticated',other,'r12_pod_research_read',[f.businessId,f.goalId,null]),/owner/);
 await assert.rejects(podRpc(db,'authenticated',other,'r12_pod_owner_server',[f.businessId,'confirm',confirm,f.bootstrapKey]),/owner/);
 const stoppedFixture=await podSqlFixture(db),stopped=await stoppedFixture.prepare();await stoppedFixture.server('stop',{setupId:stopped.setupId,setupHash:stopped.setupHash,submissionId:randomUUID()},'');
 await assert.rejects(stoppedFixture.server('confirm',stoppedFixture.confirmPayload(stopped)),/stale_or_stopped/);
 assert.equal((await podOne(db,'select count(*)::int n from private.r12_discovery_scopes where business_id=$1',[stoppedFixture.businessId])).n,0);
 return{prepared:prepared.setupId,scope:row.id,legacyAuthorityCount:0};
}
export async function exercisePodFirstInputs(db){
 const a=await podActivate(db);await a.pass('admit',{quote:podQuoteFixture()});const action=await a.pass('context'),claim=await a.command('claim',{seconds:120}),attemptId=randomUUID();
 const scheduled=await a.store.command('schedule',{stepKey:'plan',attemptId,actionHash:action.actionHash,actionOrdinal:action.ordinal,reason:'Inert first planner phase',evidenceHash:'8'.repeat(64)},claim.epoch);assert.equal(scheduled.attemptId,attemptId);
 const raw=await a.inputs(attemptId);assert.equal(raw.version,'r12.pod-research-inputs.2');assert.equal(raw.inputMode,'dispatch');assert.equal(raw.committedMicrousd,0);assert.equal(raw.hasUncertainCosts,false);assert.deepEqual(raw.dependencies,[]);assert.equal(raw.amendment.publicBrief.objective,POD_OBJECTIVE);
 const saved=await a.store.read(),context={planId:saved.planId,planHash:saved.planHash,plan:saved.plan,step:saved.plan.steps[0],attempt:saved.attempts[0],knowledge:saved.knowledge};
 const runtime=podSource('products/discovery-r12-runtime'),request=runtime.buildDiscoveryR12PhaseRequest(context,runtime.readDiscoveryR12PhaseInputs(context,raw)),payload=JSON.parse(request.messages[1].content);
 assert.deepEqual(payload.publicBrief,a.f.input.publicBrief);assert.equal('markets' in payload,false);assert.equal('approvedQuery' in payload,false);assert.equal('candidates' in payload,false);assert.equal(JSON.stringify(payload).includes(a.f.businessId),false);
 await a.f.server('stop',{setupId:a.prepared.setupId,setupHash:a.prepared.setupHash,submissionId:randomUUID()},'');
 await assert.rejects(a.inputs(attemptId),/stopped|revoked|policy/);
 return{version:raw.version,firstRequestBuilt:true};
}

export function podInertOutputs({passOrdinal=0,useful=false}={}){
 const {POD_DIMENSIONS,POD_REVIEW_CHECKS}=podSource('products/discovery-r12-pod-analysis');
 const excerpt='Synthetic technical fixture: these aggregate public observations do not measure Etsy sales, buyer willingness to pay, profitable fulfilment or commercial demand. They support only questions for further validation.';
 const outputs={
  plan:{comparisonRationale:'Explore multiple POD product types through aggregate needs, production limitations and reasons ideas may fail.',query:'Compare aggregate consumer needs for made-to-order printed products and production limitations without assuming a product category.',sourceDomains:['census.gov','printful.com'],sourceChoiceRationale:'Compare primary aggregated public observations with official POD feasibility information.',hypotheses:[{productType:'Exploratory printed object',niche:'Unproven general niche',audience:'An aggregate buyer group',hypothesis:'A useful printed object may address an unmet practical need; no demand has been measured.',contraryExplanation:'The observed interest may not translate into purchases or a viable margin.'}]},
  search1:{annotations:[{type:'url_citation',url_citation:{url:'https://census.gov/inert-sql-fixture',title:'Inert public-source fixture',content:excerpt}}]},
  select1:{selections:[{sourceKey:'S1',quote:excerpt.slice(0,150)}],limitations:['no_sales_metrics','no_current_prices']},
  strategy:{explorationSummary:'This inert report demonstrates evidence assessment without asserting real market observations or product demand.',candidates:[{productType:'Evidence-led printed object',niche:'A different unproven niche',audience:'An independently chosen aggregate audience',rationale:'The evidence changes the initial hypothesis but cannot establish actual willingness to buy a product.',support:[],counterevidence:['E1'],alternativeExplanation:'Generic interest and supplier availability are compatible with no profitable Etsy demand.',dimensions:POD_DIMENSIONS.map(dimension=>({dimension,verdict:'uncertain',rationale:'This synthetic source provides no candidate-specific measurement for the dimension.',evidence:[],missing:['Representative relevant observations remain unavailable.']}))}],recommendation:{outcome:'INSUFFICIENT_EVIDENCE',candidateIndex:null,rationale:'The actual retained source does not support a market recommendation beyond further evidence gathering.',nextTest:'Measure buyer intent and delivered costs before committing to any creative, listing or production work.'},limitations:['The source is a technical fixture, not evidence of real demand.'],etsyDemandVerified:false,commercialViabilityVerified:false},
  review:{outcome:'INSUFFICIENT_EVIDENCE',candidateIndex:null,rationale:'The independent review finds that the bounded source cannot establish candidate-specific buyer demand or margins.',checks:POD_REVIEW_CHECKS.map(check=>({check,verdict:'FAIL',rationale:'The available synthetic evidence does not satisfy a real commercial research requirement.',evidence:['E1']})),missingEvidence:['Actual buyer intent and fulfilment economics remain unmeasured.'],nextTest:'Obtain representative buyer evidence and current delivered costs before recommending a product test.',etsyDemandVerified:false,commercialViabilityVerified:false}
 };
 const queries=[outputs.plan.query,'Investigate aggregate reasons buyers reject customized printed home accessories and measure independently described material and delivery limitations.','Compare practical gift use cases and official production constraints for personalized printed objects with limited purchase-intent evidence.','Assess aggregate unmet needs for printed desk accessories while checking evidence quality, substitutes, and delivered production costs.','Investigate functional customization needs for printed home organization items and reasons apparent interest may not become viable purchases.'];
 assert.ok(Number.isInteger(passOrdinal)&&passOrdinal>=0&&passOrdinal<5);outputs.plan.query=queries[passOrdinal];
 if(passOrdinal>0){outputs.plan.sourceDomains=['ons.gov.uk','printful.com'];outputs.search1.annotations[0].url_citation.url='https://ons.gov.uk/inert-sql-fixture-pass-'+passOrdinal;}
 outputs.strategy.candidates[0].productType='Evidence-led printed object for pass '+(passOrdinal+1);
 if(useful){outputs.strategy.candidates[0].support=['E1'];outputs.strategy.recommendation={...outputs.strategy.recommendation,outcome:'HYPOTHESIS_TO_TEST',candidateIndex:0,rationale:'This entirely synthetic fixture supports only a bounded hypothesis to test; demand and profitable production remain unverified.'};outputs.review={...outputs.review,outcome:'HYPOTHESIS_TO_TEST',candidateIndex:0,rationale:'The independent synthetic review retains only a worthwhile hypothesis for further validation, without verifying Etsy demand or commercial viability.',checks:outputs.review.checks.map(check=>({...check,verdict:'PASS',rationale:'The limited proposal is explicitly a hypothesis to test and preserves the evidence gaps without commercial claims.'}))};}
 return outputs;
}
export async function podRuntimeFixture(db,{afterStage=null,usefulPass=0,fixtureOptions={},activation=null}={}){
 const a=activation??await podActivate(db,fixtureOptions),outputsByPass=Array.from({length:5},(_,passOrdinal)=>podInertOutputs({passOrdinal,useful:passOrdinal===usefulPass})),output=outputsByPass[0],runtime=podSource('products/discovery-r12-runtime'),adapter=podSource('products/discovery-r12-adapter');
 const executingRelease={version:'r12.executing-release.1',repository:'SSB100/agent-labs',environment:'production',commitSha:'a'.repeat(40),deploymentId:'dpl_inert_pod_sql_only'};
 const posted=[],got=[],sentRequests=[],registry={},generationPasses=new Map();
 const effects={
  operation:async(attemptId,operation,payload)=>{const result=await podRpc(db,'anon',null,'r12_discovery_server',[a.f.businessId,attemptId,operation,payload,a.controller]);if(operation==='stage'&&afterStage)await afterStage({...a,attemptId,candidate:payload.candidate});return result;},
  settle:async(attemptId,settlement)=>{const current=await a.store.read();await a.command('settle',{attemptId,settlement},current.head.epoch);},
  dispatchedAt:async attemptId=>{const loaded=await podRpc(db,'anon',null,'r12_discovery_server',[a.f.businessId,attemptId,'load',{},a.controller]);assert.equal(typeof loaded.dispatchedAt,'string');return loaded.dispatchedAt;},
 };
 for(const step of a.plan.steps){const phase=step.key;registry[step.adapter]=adapter.createDiscoveryR12QuestAdapter({scope:a.scope,podRecovery:a.podRecovery??null,phase,identity:{qualificationHash:step.qualificationHash,workflowDefinitionId:step.workflowDefinitionId,workerDefinitionId:step.workerDefinitionId,mode:'qualification'},executingRelease,
   dataClasses:a.operations.find(operation=>operation.operationKey===step.operationKey).dataClasses,store:effects,
   request:async ctx=>runtime.buildDiscoveryR12PhaseRequest(ctx,runtime.readDiscoveryR12PhaseInputs(ctx,await a.inputs(ctx.attempt.id))),
   quote:async()=>podQuoteFixture(),
   project:async(qualified,ctx,request)=>runtime.projectDiscoveryR12Phase(ctx,runtime.readDiscoveryR12PhaseInputs(ctx,await a.inputs(ctx.attempt.id)),qualified,request),
   config:{apiKey:'inert-pod-sql-no-network',baseUrl:'https://openrouter.ai/api/v1',appUrl:'https://agent-labs-two.vercel.app',appName:'Agent Labs'},
   fetcher:async(url,init)=>{
    const model=phase==='review'?'anthropic/claude-4.5-haiku-20251001':'openai/gpt-5.6-luna-20260709';
    if(init.method==='POST'){
     const snapshot=await a.store.read(),attempt=snapshot.attempts.filter(x=>x.stepKey===phase&&x.status==='dispatched').sort((x,y)=>y.adaptiveActionOrdinal-x.adaptiveActionOrdinal)[0];assert.ok(attempt);const passOrdinal=attempt.adaptiveActionOrdinal,output=outputsByPass[passOrdinal],id='gen-inert-pod-'+phase+'-p'+passOrdinal+'-'+a.scope.id;generationPasses.set(id,passOrdinal);sentRequests.push({phase,passOrdinal,body:JSON.parse(init.body)});
     posted.push(phase);const body=JSON.parse(init.body);assert.deepEqual(body.provider.only,[phase==='review'?'amazon-bedrock/us':'azure/us']);assert.equal(body.provider.zdr,true);
     assert.equal((await podOne(db,'select count(*)::int n from private.r12_discovery_transport_claims tc join private.r12_discovery_wires w using(request_id) where w.scope_id=$1',[a.scope.id])).n,posted.length);
     if(phase==='search1'){assert.equal(body.messages[1].content,output.plan.query);assert.deepEqual(body.tools[0].parameters.allowed_domains,[...output.plan.sourceDomains].sort());}
     const message=phase==='search1'?{content:'Explicitly synthetic source material.',annotations:output.search1.annotations}:{content:JSON.stringify(output[phase])};
     return new Response(JSON.stringify({id,model,choices:[{finish_reason:'stop',message}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,cost:0.00001,...(phase==='search1'?{server_tool_use_details:{web_search_requests:1}}:{})}}),{status:200});
    }
    assert.equal(init.method,'GET');got.push(phase);const id=new URL(url).searchParams.get('id');assert.ok(generationPasses.has(id));
    assert.equal((await podOne(db,"select count(*)::int n from private.r12_discovery_candidates where candidate->>'providerRequestId'=$1",[id])).n,1);
    return new Response(JSON.stringify({data:{id,provider_name:phase==='review'?'Amazon Bedrock':'Azure',model}}),{status:200});
   }
  });}
 const tick=async()=>{if(!await a.store.readAdaptiveAction()){const admitted=await a.pass('admit',{quote:podQuoteFixture()});if(admitted.admitted!==true)return{status:admitted.completed?'completed':admitted.stopped?'stopped':'waiting',reason:admitted.reason};}return podSource('core/quest-controller').driveQuestOnce(a.store,{adapters:registry,reconcile:true});};
 return{...a,registry,effects,posted,got,output,outputsByPass,sentRequests,tick,executingRelease};
}
export async function exercisePodUnknownHold(db){
 const a=await podRuntimeFixture(db);assert.equal((await a.tick()).reason,'scheduled');assert.equal((await a.tick()).reason,'reserved');
 const snapshot=await a.store.read(),attempt=snapshot.attempts[0],step=snapshot.plan.steps[0],ctx={planId:snapshot.planId,planHash:snapshot.planHash,plan:snapshot.plan,attempt,step,knowledge:snapshot.knowledge};
 await a.registry[step.adapter].prepare(ctx);const marked=await a.command('dispatch',{attemptId:attempt.id,wireHash:attempt.wireHash},snapshot.head.epoch);assert.equal(marked.shouldDispatch,true);
 assert.equal((await a.f.read()).finance.hasUnknown,true);assert.equal((await a.f.read()).finance.hasBlockingUnknown,true);assert.equal((await a.f.read()).finance.boundedPendingMicrounits,'0');assert.equal(a.posted.length,0);
 await assert.rejects(a.f.prepare({submissionId:randomUUID()}),/r12_pod_unresolved_liability/);
 await a.f.server('stop',{setupId:a.prepared.setupId,setupHash:a.prepared.setupHash,submissionId:randomUUID()},'');
 assert.equal((await a.f.read()).finance.hasUnknown,true,'Stop preserves the marked uncertain liability');
 assert.equal(a.posted.length,0);return{inertPosts:0,unknownHoldRetained:true};
}
async function assertPodDeferredSources(a,ordinal=0){
 const db=a.f.db,snapshot=await a.store.read(),attempt=snapshot.attempts.find(x=>x.stepKey==='search1'&&x.adaptiveActionOrdinal===ordinal),output=a.outputsByPass[ordinal];
 assert.equal(attempt.status,'reserved');assert.equal(snapshot.attempts.find(x=>x.stepKey==='plan'&&x.adaptiveActionOrdinal===ordinal).status,'completed');
 const check=async domains=>(await podOne(db,`select private.r12_pod_request_sources_match(jsonb_populate_record(null::private.r05_requests,to_jsonb(r)||jsonb_build_object('payload',jsonb_set(r.payload,'{sourceDomains}',$2::jsonb))),o,operation_scope) allowed from private.r05_requests r join private.r05_operations o on o.operation_key=r.payload->>'operationKey' join private.r05_policies p on p.id=r.policy_id cross join lateral jsonb_array_elements(p.payload->'operations') operation_scope where r.id=$1 and operation_scope->>'operationKey'=o.operation_key`,[attempt.requestId,domains])).allowed;
 const admissible=async domains=>(await podOne(db,`select private.r05_admissible(jsonb_populate_record(null::private.r05_requests,to_jsonb(r)||jsonb_build_object('payload',jsonb_set(r.payload,'{sourceDomains}',$2::jsonb)))) reason from private.r05_requests r where r.id=$1`,[attempt.requestId,domains])).reason;
 assert.equal(await check([...output.plan.sourceDomains].sort()),true);assert.equal(await admissible([...output.plan.sourceDomains].sort()),null);
 for(const domains of [[],['etsy.com'],['ons.gov.uk'],['census.gov']]){assert.equal(await check(domains),false,'The declaration cannot substitute sources for the accepted plan');assert.equal(await admissible(domains),'wire_scope_or_quote_mismatch');}
 if(ordinal>0)assert.equal(await admissible([...a.outputsByPass[0].plan.sourceDomains].sort()),'wire_scope_or_quote_mismatch','First-pass domains cannot replace current accepted source pins');
 const raw=await a.inputs(attempt.id);assert.equal(raw.dependencies.length,1);assert.equal(raw.dependencies[0].response.outcome,'accepted');assert.equal(raw.dependencies[0].executingRelease.commitSha,a.executingRelease.commitSha);
 const context={planId:snapshot.planId,planHash:snapshot.planHash,plan:snapshot.plan,step:snapshot.plan.steps.find(x=>x.key==='search1'),attempt,knowledge:snapshot.knowledge};
 const rt=podSource('products/discovery-r12-runtime');
 for(const mutate of [d=>d.candidate.output.sourceDomains=['ons.gov.uk'],d=>d.response.result.researchPlanHash='0'.repeat(64),d=>d.proof.proofHash='0'.repeat(64)]){const altered=structuredClone(raw);mutate(altered.dependencies[0]);assert.throws(()=>rt.buildDiscoveryR12PhaseRequest(context,rt.readDiscoveryR12PhaseInputs(context,altered)));}
 return true;
}
export async function exercisePodRuntime(db,{reverseSourceDomains=false}={}){
 const a=await podRuntimeFixture(db);if(reverseSourceDomains)a.output.plan.sourceDomains.reverse();let complete=false,sourceChecks=false;
 for(let transition=0;transition<30;transition++){
  const before=await a.store.read();if(!sourceChecks&&before.attempts.some(x=>x.stepKey==='search1'&&x.status==='reserved'))sourceChecks=await assertPodDeferredSources(a);
  const result=await a.tick();if(result.status==='completed'){complete=true;break;}assert.equal(result.status,'progress',JSON.stringify(result));
 }
 assert.equal(complete,true);assert.equal(sourceChecks,true);assert.deepEqual(a.posted,POD_PHASES);assert.deepEqual(a.got,POD_PHASES);
 const final=await a.store.read();assert.equal(final.attempts.length,5);assert.ok(final.attempts.every(x=>x.status==='completed'));
 assert.equal(final.head.dispatches,5);assert.equal(final.head.repairsUsed,0);assert.equal(final.head.pivotsUsed,0);
 const raw=await podRpc(db,'authenticated',a.f.ownerId,'r12_discovery_result_read',[a.f.businessId,a.scope.id]);
 assert.equal(raw.version,'r12.pod-saved-result.2');
 assert.deepEqual(raw.inputs.dependencies[0].candidate.output.sourceDomains,a.output.plan.sourceDomains,'Raw provider candidate keeps its original domain ordering');
 for(const invalid of [['census.gov','census.gov'],['census.gov',5],['etsy.com']])await assert.rejects(db.query('select private.r12_pod_domains($1,$2)',[invalid,a.scope.sourcePolicy]));
 const podRuntime=podSource('products/discovery-r12-pod-runtime'),result=podRuntime.reconstructPodResearchResult(raw.context,podRuntime.readPodResearchPhaseInputs(raw.context,raw.inputs),raw.current);
 assert.equal(result.review.outcome,'HYPOTHESIS_TO_TEST');assert.equal(result.phaseReceipts.length,5);assert.equal(result.executionAuthorized,false);assert.equal(result.objective,POD_OBJECTIVE);
 assert.equal((await a.f.read()).finance.committedMicrounits,'50');assert.equal((await a.f.read()).finance.hasUnknown,false);
 assert.equal((await a.tick()).status,'completed');assert.equal(a.posted.length,5);
 assert.ok(result.phaseReceipts.every(receipt=>receipt.executingRelease.commitSha===a.executingRelease.commitSha));
 await db.query('insert into private.r12_pod_template_revocations(template_id,reason) values($1,$2)',[a.f.templateId,'Synthetic post-completion revocation']);
 await a.f.server('stop',{setupId:a.prepared.setupId,setupHash:a.prepared.setupHash,submissionId:randomUUID()},'');
 const historical=await podRpc(db,'authenticated',a.f.ownerId,'r12_discovery_result_read',[a.f.businessId,a.scope.id]);
 assert.deepEqual(podRuntime.reconstructPodResearchResult(historical.context,podRuntime.readPodResearchPhaseInputs(historical.context,historical.inputs),historical.current),result);
 assert.equal(a.posted.length,5);assert.equal(a.got.length,5);
 return{inertPosts:a.posted.length,inertReceiptGets:a.got.length,providerCalls:0,outcome:result.review.outcome,deferredSourcesVerified:true};
}

export async function exercisePodRuntimeCapabilities(db){
 const a=await podActivate(db),b=await podActivate(db);
 const read=(businessId,scopeId,key)=>podRpc(db,'anon',null,'r12_pod_runtime_read',[businessId,scopeId,key]);
 const good=await read(a.f.businessId,a.scope.id,a.f.bootstrapKey);
 assert.equal(good.ownerId,a.f.ownerId);assert.equal(good.activeWindow,true);assert.deepEqual(good.activation.plan,a.plan);
 assert.equal(good.activation.operations.length,5);
 for(const args of [[a.f.businessId,a.scope.id,'inert-wrong-application-capability-0123456789'],[b.f.businessId,a.scope.id,a.f.bootstrapKey],[a.f.businessId,b.scope.id,a.f.bootstrapKey],[a.f.businessId,a.scope.id,b.f.bootstrapKey]])await assert.rejects(read(...args),/r12_pod_runtime_authority_unavailable/);
 assert.equal((await podOne(db,'select count(*)::int n from private.r05_requests where business_id in($1,$2)',[a.f.businessId,b.f.businessId])).n,0);
 return{wrongCapabilityRejected:true,crossBusinessRejected:true,providerCalls:0};
}
export async function exercisePodUnsentCancellation(db){
 const a=await podRuntimeFixture(db);assert.equal((await a.tick()).reason,'scheduled');assert.equal((await a.tick()).reason,'reserved');
 const before=await a.store.read(),attempt=before.attempts[0];assert.equal(attempt.status,'reserved');
 const exposure=await a.f.read();assert.ok(Number(exposure.finance.committedMicrounits)>0);assert.equal(exposure.finance.hasUnknown,false);
 assert.equal((await podOne(db,'select count(*)::int n from private.r05_markers where request_id=$1',[attempt.requestId])).n,0);
 await a.f.server('stop',{setupId:a.prepared.setupId,setupHash:a.prepared.setupHash,submissionId:randomUUID()},'');
 const cancelled=await a.command('cancel',{attemptId:attempt.id,evidenceHash:podHash({kind:'inert-proven-unsent',requestId:attempt.requestId})},before.head.epoch);
 assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.shouldDispatch,false);
 assert.equal((await a.store.read()).attempts[0].status,'cancelled');assert.equal((await a.f.read()).finance.committedMicrounits,'0');assert.equal((await a.f.read()).finance.hasUnknown,false);
 assert.deepEqual(await podOne(db,'select (select count(*)::int from private.r05_releases where request_id=$1) releases,(select count(*)::int from private.r05_markers where request_id=$1) markers,(select count(*)::int from private.r05_settlements where request_id=$1) settlements',[attempt.requestId]),{releases:1,markers:0,settlements:0});
 assert.equal(a.posted.length,0);assert.equal(a.got.length,0);
 return{unmarkedReservationReleased:true,paidLiabilityCreated:false,providerCalls:0};
}
export async function exercisePodStoppedStagedReceipt(db){
 let staged=0;
 const a=await podRuntimeFixture(db,{afterStage:async run=>{
  staged++;assert.equal(staged,1);assert.equal(run.candidate.phase,'plan');
  const before=await podOne(db,'select (select count(*)::int from private.r12_discovery_candidates where request_id=$1) candidates,(select count(*)::int from private.r05_markers where request_id=$1) markers,(select count(*)::int from private.r05_settlements where request_id=$1) settlements',[run.candidate.requestId]);
  assert.deepEqual(before,{candidates:1,markers:1,settlements:0});
  assert.equal((await run.f.read()).finance.hasUnknown,true);
  await run.f.server('stop',{setupId:run.prepared.setupId,setupHash:run.prepared.setupHash,submissionId:randomUUID()},'');
  await db.query('insert into private.r12_pod_template_revocations(template_id,reason) values($1,$2)',[run.f.templateId,'Synthetic revocation after durable candidate, before settlement and route receipt']);
  const window=await podRpc(db,'anon',null,'r12_pod_runtime_read',[run.f.businessId,run.scope.id,run.f.bootstrapKey]);assert.equal(window.activeWindow,false);
 }});
 assert.equal((await a.tick()).reason,'scheduled');assert.equal((await a.tick()).reason,'reserved');
 assert.equal((await a.tick()).reason,'response_persisted');
 assert.equal(staged,1);assert.deepEqual(a.posted,['plan']);assert.deepEqual(a.got,['plan']);
 const responded=await a.store.read(),attempt=responded.attempts[0];assert.equal(attempt.status,'responded');
 const finance=(await a.f.read()).finance;assert.equal(finance.committedMicrounits,'10');assert.equal(finance.hasUnknown,false);
 const records=await podOne(db,`select (select count(*)::int from private.r05_settlements where request_id=$1) settlements,(select count(*)::int from private.r12_discovery_receipt_observations o join private.r12_discovery_receipt_checks c on c.id=o.check_id where c.request_id=$1 and o.proof is not null) proofs,(select count(*)::int from private.r05_releases where request_id=$1) releases`,[attempt.requestId]);assert.ok(records.settlements>=1);assert.equal(records.proofs,1);assert.equal(records.releases,0);
 assert.equal((await a.tick()).reason,'response_projected');assert.equal((await a.store.read()).attempts[0].status,'completed');
 const receiptInput=await a.inputs(attempt.id);assert.equal(receiptInput.inputMode,'receipt');
 const fresh=await a.tick();assert.ok(['blocked','stopped'].includes(fresh.status),JSON.stringify(fresh));assert.match(fresh.reason,/stopped|revoked|policy|unavailable/);
 assert.equal((await a.store.read()).attempts.length,1);assert.equal(a.posted.length,1);assert.equal(a.got.length,1);
 return{candidateSavedBeforeStop:true,settledAfterStopAndTemplateRevocation:true,exactReceiptReadAfterStop:true,freshDispatchRefused:true,inertPosts:1,inertReceiptGets:1,providerCalls:0};
}

export async function exercisePodPassHold(db){
 const a=await podRuntimeFixture(db),quote=podQuoteFixture(),hold=async()=>Number((await podOne(db,'select private.r12_adaptive_outstanding_hold($1) amount',[a.f.businessId])).amount);
 const first=await a.pass('admit',{quote});assert.equal(first.admitted,true);assert.equal(first.ordinal,0);assert.equal(await hold(),quote.maximumMicrousd);
 const original=await a.pass('context'),again=await a.pass('admit',{quote:podQuoteFixture()});assert.equal(again.replayed,true);assert.deepEqual(await a.pass('context'),original);assert.equal(await hold(),quote.maximumMicrousd);
 assert.equal((await a.tick()).reason,'scheduled');assert.equal(await hold(),quote.maximumMicrousd);
 const current=await a.store.read(),attempt=current.attempts[0],context={planId:current.planId,planHash:current.planHash,plan:current.plan,step:current.plan.steps[0],attempt,knowledge:current.knowledge};
 const call=await a.registry[context.step.adapter].prepare(context),submissionId=randomUUID(),payload={attemptId:attempt.id,descriptor:call.descriptor,runtimeCapability:'inert-pod-runtime-'+a.scope.id};
 const reserve=()=>podRpc(db,'anon',null,'r07_controller',[a.f.businessId,a.f.goalId,'reserve',payload,submissionId,a.controller,a.lease,current.head.epoch,a.admission]);
 const reserved=await reserve();assert.equal(reserved.status,'reserved');assert.equal(await hold(),quote.maximumMicrousd-quote.ceilings.plan);
 const exposure=Number((await a.f.read()).finance.committedMicrounits);assert.equal(exposure,quote.ceilings.plan);assert.equal(exposure+await hold(),quote.maximumMicrousd,'Reservation converts exactly one call from the existing whole-pass hold');
 const replay=await reserve();assert.equal(replay.status,'reserved');assert.equal(replay.replayed,true);assert.equal(replay.shouldDispatch,false);
 await assert.rejects(a.store.command('reserve',payload,current.head.epoch),/r07_not_scheduled/,'A different submission cannot reserve an already-reserved attempt');
 assert.equal(await hold(),quote.maximumMicrousd-quote.ceilings.plan);assert.equal((await podOne(db,'select count(*)::int n from private.r12_pod_pass_calls where scope_id=$1',[a.scope.id])).n,1);
 await assert.rejects(a.pass('complete',{actionHash:original.actionHash,actionOrdinal:0}),/r12_pod_pass_unsettled/);
 await a.f.server('stop',{setupId:a.prepared.setupId,setupHash:a.prepared.setupHash,submissionId:randomUUID()},'');assert.equal(await hold(),0);
 assert.equal(Number((await a.f.read()).finance.committedMicrounits),quote.ceilings.plan,'Stop releases unissued pass hold but preserves the outstanding reservation');
 await a.command('cancel',{attemptId:attempt.id,evidenceHash:podHash({kind:'inert-unmarked-pass-cancel',attemptId:attempt.id})},current.head.epoch);
 assert.equal((await a.f.read()).finance.committedMicrounits,'0');assert.equal(a.posted.length,0);
 return{wholePassHeldOnce:true,perCallConversionExact:true,replayDoesNotReset:true,stopPreservesUnresolvedReservation:true};
}
export async function exercisePodMultipass(db,{usefulPass=1,budgetExhausted=false}={}){
 const quote=podQuoteFixture(),a=await podRuntimeFixture(db,{usefulPass,fixtureOptions:budgetExhausted?{maximumMicrounits:String(quote.maximumMicrousd+25)}:{}});
 const sourceChecks=new Set();let terminal;
 for(let transition=0;transition<140;transition++){
  const snapshot=await a.store.read(),reserved=snapshot.attempts.find(x=>x.stepKey==='search1'&&x.status==='reserved');
  if(reserved&&!sourceChecks.has(reserved.adaptiveActionOrdinal)){
   const ordinal=reserved.adaptiveActionOrdinal;await assertPodDeferredSources(a,ordinal);sourceChecks.add(ordinal);
   const raw=await a.inputs(reserved.id);assert.equal(raw.pass.ordinal,ordinal);assert.equal(raw.pass.historyHash,podHash(raw.pass.history));
   if(ordinal>0){
    assert.equal(raw.pass.history.previousPass,ordinal-1);assert.equal(raw.pass.history.review.outcome,'INSUFFICIENT_EVIDENCE');assert.equal(raw.pass.history.priorQueries.length,ordinal);
    assert.equal(raw.pass.history.priorQueries[ordinal-1].query,a.outputsByPass[ordinal-1].plan.query);
    const previous=snapshot.attempts.find(x=>x.stepKey==='review'&&x.adaptiveActionOrdinal===ordinal-1);assert.equal(raw.pass.history.previousReviewHash,previous.responseHash);
    const oldPlanner=snapshot.attempts.find(x=>x.stepKey==='plan'&&x.adaptiveActionOrdinal===ordinal-1);
    assert.ok(raw.dependencies.every(d=>d.attemptId!==oldPlanner.id),'New pass dependencies never reuse an old planner');
    const mutated=structuredClone(raw);mutated.dependencies[0]=(await a.inputs(snapshot.attempts.find(x=>x.stepKey==='search1'&&x.adaptiveActionOrdinal===ordinal-1).id)).dependencies[0];
    const rt=podSource('products/discovery-r12-runtime'),ctx={planId:snapshot.planId,planHash:snapshot.planHash,plan:snapshot.plan,step:snapshot.plan.steps.find(s=>s.key==='search1'),attempt:reserved,knowledge:snapshot.knowledge};
    assert.throws(()=>rt.readDiscoveryR12PhaseInputs(ctx,mutated));
   }
  }
  const result=await a.tick();if(result.status==='completed'){terminal=result;break;}assert.equal(result.status,'progress',JSON.stringify(result));
 }
 assert.ok(terminal,'Finite five-pass workflow must stop');const passCount=budgetExhausted?1:usefulPass===null?5:usefulPass+1,callCount=passCount*5;
 assert.equal(terminal.reason,budgetExhausted?'remaining_budget_below_quoted_pass':usefulPass===null?'five_pass_limit':'reviewed_hypothesis_ready');
 assert.equal(a.posted.length,callCount);assert.equal(a.got.length,callCount);assert.equal(sourceChecks.size,passCount);
 const final=await a.store.read();assert.equal(final.version,1);assert.equal(final.attempts.length,callCount);assert.equal(final.head.dispatches,callCount);assert.equal(final.head.childrenCreated,5);assert.equal(final.head.repairsUsed,0);assert.equal(final.head.pivotsUsed,0);assert.ok(final.attempts.every(x=>x.status==='completed'));
 const ledger=await podOne(db,'select (select count(*)::int from private.r12_pod_passes where scope_id=$1) passes,(select count(*)::int from private.r12_pod_pass_closures where scope_id=$1) closures,(select count(*)::int from private.r12_pod_pass_calls where scope_id=$1) calls,(select count(*)::int from private.r05_cap_versions where business_id=$2) caps,private.r12_adaptive_outstanding_hold($2)::text hold',[a.scope.id,a.f.businessId]);assert.deepEqual(ledger,{passes:passCount,closures:passCount,calls:callCount,caps:1,hold:'0'});
 assert.equal((await a.f.read()).finance.committedMicrounits,String(callCount*10));assert.equal((await a.f.read()).finance.hasBlockingUnknown,false);
 const plannerRequests=a.sentRequests.filter(x=>x.phase==='plan');assert.equal(plannerRequests.length,passCount);assert.equal(JSON.parse(plannerRequests[0].body.messages[1].content).refinement,null);
 for(let ordinal=1;ordinal<passCount;ordinal++){
  const refinement=JSON.parse(plannerRequests[ordinal].body.messages[1].content).refinement;assert.equal(refinement.previousPass,ordinal-1);assert.equal(refinement.review.outcome,'INSUFFICIENT_EVIDENCE');assert.equal(refinement.priorQueries.length,ordinal);assert.notEqual(a.outputsByPass[ordinal].plan.query,a.outputsByPass[ordinal-1].plan.query);
 }
 const raw=await podRpc(db,'authenticated',a.f.ownerId,'r12_discovery_result_read',[a.f.businessId,a.scope.id]),rt=podSource('products/discovery-r12-pod-runtime');assert.equal(raw.version,'r12.pod-saved-result.2');
 const saved=rt.reconstructPodResearchResult(raw.context,rt.readPodResearchPhaseInputs(raw.context,raw.inputs),raw.current);assert.equal(saved.passNumber,passCount);assert.equal(saved.maximumPasses,5);assert.equal(saved.review.outcome,budgetExhausted||usefulPass===null?'INSUFFICIENT_EVIDENCE':'HYPOTHESIS_TO_TEST');assert.equal(saved.executionAuthorized,false);
 const replay=await a.tick();assert.equal(replay.status,'completed');assert.equal(a.posted.length,callCount);assert.deepEqual(await podOne(db,'select (select count(*)::int from private.r12_pod_passes where scope_id=$1) passes,(select count(*)::int from private.r05_cap_versions where business_id=$2) caps',[a.scope.id,a.f.businessId]),{passes:passCount,caps:1});
 return{passes:passCount,inertPosts:callCount,inertReceiptGets:callCount,providerCalls:0,reason:terminal.reason,singlePolicyCap:true,priorReviewLineageVerified:true};
}

export async function exercisePodRevokedController(db){
 const a=await podActivate(db);
 await db.query('insert into private.r07_server_revocations(key_hash) values($1)',[podSha(a.controller)]);
 for(const [operation,payload] of [['admit',{quote:podQuoteFixture()}],['context',{}],['complete',{actionHash:'a'.repeat(64),actionOrdinal:0}]])await assert.rejects(a.pass(operation,payload),/r12_pod_pass_authority_required/);
 assert.deepEqual(await podOne(db,'select (select count(*)::int from private.r12_pod_passes where scope_id=$1) passes,(select count(*)::int from private.r05_requests where business_id=$2) requests,private.r12_adaptive_outstanding_hold($2)::text hold',[a.scope.id,a.f.businessId]),{passes:0,requests:0,hold:'0'});
 return{revokedControllerCannotAdmitOrReadOrComplete:true,providerCalls:0};
}
