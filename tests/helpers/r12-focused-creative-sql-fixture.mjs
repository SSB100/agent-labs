/** Actual isolated SQL lifecycle with inert transport only. Enrollment is fixture scaffolding, never a production recipe. */
import assert from 'node:assert/strict';
import {focusedCreativeInstallationFixture} from './r12-focused-creative-install-fixture.mjs';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID,randomBytes,createHash,createHmac} from 'node:crypto';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),require=createRequire(import.meta.url);
const {creativeHash:hash}=require(repo+'/.core-tests/creative/contracts.js');
const {reconstructDiscoveryR12Result}=require(repo+'/.core-tests/products/discovery-r12-runtime.js');
const {currentProductionCandidate,productionCreativeApproval}=require(repo+'/.core-tests/creative/production-approval.js');
const {FLUX_KLEIN_APPROVAL_BINDING}=require(repo+'/.core-tests/creative/proposal.js');
const {SCREEN_CATEGORIES}=require(repo+'/.core-tests/creative/types.js');
export async function exerciseFocusedCreativeLifecycle(db,pilot){
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 const rpc=async(role,name,args)=>{await db.exec('savepoint creative_rpc');await db.exec('set role '+role);try{return(await one(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`,args)).result;}catch(error){await db.exec('rollback to savepoint creative_rpc');throw error;}finally{await db.exec('reset role');await db.exec('release savepoint creative_rpc');}};
 const reject=async(action,pattern)=>{await db.exec('savepoint creative_negative');try{await assert.rejects(action,pattern);}finally{await db.exec('rollback to savepoint creative_negative');await db.exec('release savepoint creative_negative');}};
 const raw=pilot.savedPilot;const sid=raw.context.plan.discoveryScopeId,businessId=raw.context.plan.businessId;
 const result=reconstructDiscoveryR12Result(raw,businessId,sid);
 const plan=await one('select * from private.r07_plans where id=$1',[result.planId]);
 const intent={version:'r12.focused-adoption-owner.1',scopeId:sid,profileHash:result.focusedPilotProfileHash,resultHash:hash(result),goalId:result.goalId,goalRevision:plan.content.goalRevision,goalHash:plan.content.goalHash,candidateId:result.focusedPilot.candidate.id,learningPlanHash:hash(result.focusedPilot.pinnedLearningPlan),originalResearchFundingRootId:result.originalFundingRootId,adoptForPrivateLearning:true,creativeExecutionAuthorized:false};
 // Test the migration's actual narrow owner grant; no fixture grant changes.
 assert.equal((await one("select has_function_privilege('authenticated','public.adopt_r12_focused_test(uuid,jsonb,jsonb)','execute') allowed")).allowed,true);
 for(const role of ['anon','service_role'])await reject(()=>rpc(role,'adopt_r12_focused_test',[sid,result,intent]),/permission denied/);
 const mutated=structuredClone(result);mutated.review.outcome='NEEDS_MORE_EVIDENCE';await reject(()=>rpc('authenticated','adopt_r12_focused_test',[sid,mutated,{...intent,resultHash:hash(mutated)}]),/r12_adoption_exact/);
 await reject(()=>rpc('authenticated','adopt_r12_focused_test',[sid,result,{...intent,creativeExecutionAuthorized:true}]),/exact_owner_adoption/);
 const adoption=await rpc('authenticated','adopt_r12_focused_test',[sid,result,intent]);
 assert.equal(adoption.executionAuthorized,false);assert.equal(adoption.cached,false);
 assert.equal((await rpc('authenticated','adopt_r12_focused_test',[sid,result,intent])).cached,true);
 const candidate=await one('select * from public.product_candidates where id=$1',[adoption.candidateId]);
 const decision=await one('select * from public.product_decisions where id=$1',[adoption.decisionId]);
 const experiment=await one('select * from public.product_experiments where id=$1',[adoption.experimentId]);
 assert.ok(currentProductionCandidate(candidate,[decision],[experiment]));

 const rootBefore=(await one('select private.stage13v2_budget_authority($1,false) result',[result.originalFundingRootId])).result;
 const goalBefore=await one('select to_jsonb(s) state,(select jsonb_agg(to_jsonb(v) order by revision) from private.r04_goal_versions v where v.goal_id=s.goal_id) versions from private.r04_goal_state s where s.goal_id=$1',[result.goalId]);
 const installed=await focusedCreativeInstallationFixture(db,{businessId,ownerId:plan.owner_id,adoptionId:adoption.adoptionId,nested:true,negativeCoverage:true});
 const installId=installed.installationId;
 const installation=await one('select snapshot from public.installed_packs where id=$1',[installId]);
 const approvalId=randomUUID(),now=Date.now();
 const spec={provider:'printful',product:'Synthetic fixed physical test product',garment:'Explicit cream cotton test garment',placement:'front center',sourceUrl:'https://www.printful.com/custom/mens/t-shirts',sourceExcerpt:'Inert source-backed print specification for a fixed physical placement. This fixture makes no live catalog or fulfillment claim.',verifiedAt:new Date(now-1000).toISOString(),maximumWidthInches:12,maximumHeightInches:16,designWidthInches:4,designHeightInches:4,minimumDpi:150,colorSpace:'srgb',background:'opaque',maximumBytes:3700000};
 const proposedApproval=productionCreativeApproval(currentProductionCandidate(candidate,[decision],[experiment]),{approvalId,printSpecification:spec,rightsConfirmed:true,creativeInstallationId:installId,creativeInstallationSnapshotHash:hash(installation.snapshot),designInstructions:'Create exactly one original botanical composition for the fixed private readability test, without reference artwork or any text.',rightsStatement:'Synthetic owner confirms an original concept and no supplied third-party reference artwork for this exact private fixture.',policyScreen:SCREEN_CATEGORIES.map(category=>({category,status:'clear',rationale:'Inert concept-specific screen for this original fixed private composition.',sourceUrls:['https://www.etsy.com/legal/creativity/']})),maximumMicrousd:100000,maximumGenerations:1,generatorModel:'black-forest-labs/flux.2-klein-4b'});
 const quote={version:'creative-estimate-1.0',verifiedAt:new Date(now).toISOString(),sourceUrls:['https://openrouter.ai/api/v1/models','https://openrouter.ai/api/v1/images/models/black-forest-labs/flux.2-klein-4b/endpoints','https://bfl.ai/legal/developer-terms-of-service','https://bfl.ai/legal/flux-api-service-terms'],generatorModel:'black-forest-labs/flux.2-klein-4b',directorModel:'openai/gpt-5.6-luna',reviewerModel:'anthropic/claude-haiku-4.5',maximaMicrousd:{brief:10000,screen:10000,generation:70000,review:10000},maximumEstimateMicrousd:100000,maximumCalls:4,estimateOnly:true,providerInvoiceGuarantee:false,providerBinding:FLUX_KLEIN_APPROVAL_BINDING};
 const approved=await rpc('authenticated','approve_creative_candidate',[candidate.id,proposedApproval,quote]);
 const approval=approved.snapshot,ownerId=plan.owner_id;
 const derive=role=>createHmac('sha256','inert-r12-owner-root-configuration-0123456789').update(JSON.stringify({version:'r12.scoped-authority.1',role,businessId,ownerId,scopeId:approvalId})).digest('base64url');
 const capability=derive('creative-runtime'),serverKey=derive('admission'),launchNonce=randomUUID();
 const begun=await rpc('authenticated','begin_creative_run',[approvalId,launchNonce,capability]);
 const runId=begun.creativeRunId,wid=begun.workflowRunId;
 let denyBeforeTransport=false;
 const staleBinding=original=>{const binding=structuredClone(original),old=new Date(Date.now()-360000).toISOString();binding.dispatchQuote.verifiedAt=old;binding.dispatchQuote.validUntil=new Date(Date.parse(old)+300000).toISOString();const{quoteHash:ignored,...body}=binding.dispatchQuote;void ignored;binding.dispatchQuote.quoteHash=hash(body);return binding;};
 const transition=async(operation,payload={})=>{
  if(operation==='r12_send'&&denyBeforeTransport)return rpc('anon','creative_runtime_transition',[runId,businessId,capability,operation,{...payload,bindingHash:'0'.repeat(64)}]);
  if(operation==='r12_bind'&&payload.binding.dispatchQuote){const bad=staleBinding(payload.binding);await reject(()=>rpc('anon','creative_runtime_transition',[runId,businessId,capability,operation,{...payload,binding:bad,bindingHash:hash(bad)}]),/dispatch_quote_time/);}
  if(operation==='r12_send'&&payload.callKey!=='generate:1'){
   await reject(async()=>{const saved=await one('select binding from private.r12_focused_creative_wires where creative_run_id=$1 and call_key=$2',[runId,payload.callKey]),bad=staleBinding(saved.binding);
    await db.exec('alter table private.r12_focused_creative_wires disable trigger r12_focused_creative_immutable');
    await db.query('update private.r12_focused_creative_wires set binding=$1,binding_hash=$2 where creative_run_id=$3 and call_key=$4',[bad,hash(bad),runId,payload.callKey]);
    await db.exec('alter table private.r12_focused_creative_wires enable trigger r12_focused_creative_immutable');
    await rpc('anon','creative_runtime_transition',[runId,businessId,capability,operation,{...payload,bindingHash:hash(bad)}]);
   },/dispatch_quote_time/);
  }
  return rpc('anon','creative_runtime_transition',[runId,businessId,capability,operation,payload]);
 };
 await assert.rejects(transition('load',{runtimeRunId:'inert-creative-'+wid}),/launch_claim_required/);
 await assert.rejects(transition('r12_launch_claim'),/scope_required/);
 const phases=['brief:1','screen:1','generate:1','review:1'];
 const dataClassesByPhase=Object.fromEntries(phases.map(k=>[k,k==='review:1'?['business_context','private_image']:['business_context']]));
 const {qualifiedQuote,catalogByUrl,imageCatalog}=await focusedCreativeCatalogFixture();
 const preparation={businessId,approvalId,creativeRunId:runId,workflowRunId:wid,goalId:result.goalId,approvalHash:approved.approvalHash,admissionKeyHash:createHash('sha256').update(serverKey).digest('hex'),runtimeCapabilityHash:createHash('sha256').update(capability).digest('hex'),dispatchAuthorized:false};
 const {runOperatorRecipe}=await import('../../scripts/r12-focused-creative-bootstrap.mjs');
 const {reviewRecipeClient}=await import(repo+'/tests/helpers/r12-review-fixture.mjs');
 const operator=reviewRecipeClient(db,true);
 const stageInput={preparation,quote:qualifiedQuote,sourceDomains:['printful.com'],dataClassesByPhase,executionReviewHash:'a'.repeat(64),eligibilityReviewHash:'b'.repeat(64),interpretationHash:'c'.repeat(64)};
 const staged=await runOperatorRecipe(operator,'stage',stageInput);assert.equal(staged.authorityCreated,false);assert.equal(staged.shouldDispatch,false);
 assert.equal((await one('select exists(select 1 from private.r05_server_keys where key_hash=$1) enrolled',[preparation.admissionKeyHash])).enrolled,false);
 await reject(()=>runOperatorRecipe(operator,'stage',stageInput),/stage_exists/);
 const proposed=await rpc('authenticated','r05_policy_owner',[businessId,'propose',staged.operatingPolicy,randomUUID()]);
 const activationInput={preparation,stageHash:staged.stageHash,policyId:proposed.id,policyHash:proposed.hash,quote:qualifiedQuote};
 await reject(()=>runOperatorRecipe(operator,'activate',activationInput),/exact_owner_policy/);
 await rpc('authenticated','r05_policy_owner',[businessId,'confirm',{policyId:proposed.id,policyHash:proposed.hash},randomUUID()]);
 const activated=await runOperatorRecipe(operator,'activate',activationInput);
 assert.equal(activated.shouldDispatch,false);assert.equal(activated.authorityCreated,true);
 await reject(()=>runOperatorRecipe(operator,'activate',activationInput),/activation_window_or_key_conflict/);
 const closeInput={preparation,scopeHash:activated.scopeHash,policyId:proposed.id,policyHash:proposed.hash};
 await reject(()=>runOperatorRecipe(operator,'close',closeInput),/terminal_or_owner_stop/);
 await reject(()=>rpc('anon','creative_runtime_transition',[runId,businessId,'wrong-runtime-capability-0123456789','r12_launch_claim',{}]),/capability denied/i);
 await reject(async()=>{await db.query("select set_config('request.jwt.claim.sub','95050000-0000-4000-8000-000000000002',false)");await rpc('authenticated','adopt_r12_focused_test',[sid,result,intent]);},/Business ownership required/);
 await reject(()=>transition('persist_phase',{callKey:'brief:1',output:{}}),/qualified_persist_required/);
 await reject(()=>db.query('select private.r11_research_key($1)',[createHash('sha256').update(serverKey).digest('hex')]),/not_r11_authority/);
 await reject(()=>rpc('anon','r05_admission_server',[businessId,'prepare',{operationKey:'browser.planner',accounting:{kind:'r05'}},serverKey]),/exact_admission/);
 assert.equal((await transition('r12_launch_claim')).shouldStart,true);assert.equal((await transition('r12_launch_claim')).shouldStart,false);
 await reject(async()=>{await db.exec('set role authenticated');await db.query("delete from public.events where workflow_run_id=$1 and event_type='r12.focused.creative.launch_claimed'",[wid]);},/launch_claim_immutable|permission denied for table events/);
 await reject(()=>db.query("update public.events set payload='{}' where workflow_run_id=$1 and event_type='r12.focused.creative.launch_claimed'",[wid]),/launch_claim_immutable/);

 const state=await transition('load',{runtimeRunId:'inert-creative-'+wid});assert.equal(state.status,'running');
 await db.exec('alter table private.r05_operations disable trigger r05_guard');
 await db.query("update private.r05_operations set valid_from=transaction_timestamp()-interval '1 second' where operation_key like $1",['creative.r12.'+approvalId+'.%']);
 await db.exec('alter table private.r05_operations enable trigger r05_guard');


 const ts=require('typescript'),m={exports:{}};
 const config={apiKey:'inert-focused-creative-provider-key',baseUrl:'https://openrouter.ai/api/v1',appUrl:'https://example.invalid',appName:'Inert Creative'};
 const deps={'node:crypto':require('node:crypto'),'../lib/supabase/runtime':{createRuntimeClient:()=>({rpc:async(name,args)=>{try{const data=await rpc('anon',name,[args.p_business_id,args.p_operation,args.p_payload,args.p_server_key]);return{data,error:null};}catch(error){return{data:null,error};}}})},'../models/openrouter':{...require(repo+'/.core-tests/models/openrouter.js'),getOpenRouterConfig:()=>config}};
 new Function('require','module','exports',ts.transpileModule(readFileSync(repo+'/src/workflows/creative-focused-transport.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(name=>deps[name]??require(repo+'/.core-tests/'+name.replace('../','')+'.js'),m,m.exports);
 const sharp=require('sharp'),basePng=await sharp(randomBytes(1024*1024*3),{raw:{width:1024,height:1024,channels:3}}).png().toBuffer();
 const targetBytes=3699999,data=Buffer.alloc(targetBytes-basePng.length-12,120);Buffer.from('INERT opaque fixture payload; no attestation or authority.').copy(data);
 const chunk=Buffer.alloc(data.length+12);chunk.writeUInt32BE(data.length,0);chunk.write('caBX',4);data.copy(chunk,8);
 const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
 let crc=0xffffffff;for(const byte of chunk.subarray(4,-4))crc=crcTable[(crc^byte)&255]^(crc>>>8);chunk.writeUInt32BE((crc^0xffffffff)>>>0,chunk.length-4);
 const png=Buffer.concat([basePng.subarray(0,-12),chunk,basePng.subarray(-12)]);assert.equal(png.length,targetBytes);

 const files=new Map(),trace=[],counts={posts:0,gets:0,uploads:0},wires={};
 const storage={upload:async(name,bytes,options)=>{assert.equal(options.upsert,false);assert.equal(files.has(name),false);files.set(name,Buffer.from(bytes));counts.uploads++;trace.push('stored');await db.query("insert into storage.objects(bucket_id,name,metadata) values('creative-assets',$1,$2)",[name,{mimetype:'image/png',size:bytes.length}]);return{error:null};},download:async name=>({error:null,data:files.has(name)?new Blob([files.get(name)]):null})};
 const response=(v,init={})=>new Response(JSON.stringify(v),{status:200,...init,headers:{'content-type':'application/json',...init.headers}});
 let activePhase='brief:1',delayed=true,phaseState=state;
 const brief={version:'1.0',approvalId,audience:approval.audience,concept:approval.concept,style:'Original botanical flat graphic style',hierarchy:'One original plant silhouette with clear spacing',typography:'No lettering, words or other text',placement:spec.placement,garmentCompatibility:spec.garment,colors:['#235431','#FFF9DE'],forbiddenElements:['No brands','No protected characters','No copied reference artwork'],originalityRequirements:'Create an original botanical arrangement without references or named brands.',imagePrompt:'Create one original botanical composition on an opaque cream square, without text, brands, copied artwork, protected characters or reference images.'};
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url,init={})=>{
  assert.ok(String(url).startsWith('https://openrouter.ai/api/v1/'),'Every external path is an inert OpenRouter fixture');
  if(String(url).includes('/images/models/'))return response(imageCatalog);
  if(catalogByUrl.has(String(url)))return response(catalogByUrl.get(String(url)));
  const phase=activePhase.split(':')[0],generationId='gen-creative-'+phase+'-'+runId;
  if(init.method==='POST'){
   counts.posts++;trace.push('POST:'+activePhase);wires[activePhase]=Buffer.byteLength(init.body);
   assert.equal((await one('select count(*)::int n from private.r12_focused_creative_sends where creative_run_id=$1 and call_key=$2',[runId,activePhase])).n,1);
   const wire=JSON.parse(init.body);
   assert.deepEqual(wire.provider.only,[activePhase==='generate:1'?'black-forest-labs':activePhase==='brief:1'?'azure/us':'amazon-bedrock/us']);
   if(activePhase==='generate:1'){assert.equal(wire.n,1);assert.equal(wire.size,'1024x1024');return response({data:[{b64_json:png.toString('base64')}],usage:{cost:.014}},{headers:{'x-generation-id':generationId,'x-request-id':'inert-image-request-'+runId}});}
   const output=activePhase==='brief:1'?brief:activePhase==='screen:1'?{version:'1.0',briefHash:hash(brief),approvalHash:approved.approvalHash,checks:SCREEN_CATEGORIES.map(category=>({category,status:'clear',rationale:'Inert independent screen of the exact private original composition.'})),outcome:'PASS'}:{version:'1.0',assetHash:phaseState.assets[0].inspection.sha256,briefHash:hash(brief),checks:['brief_alignment','print_constraints','originality_policy','target_audience','visual_clarity'].map(criterion=>({criterion,outcome:'PASS',rationale:'Inert independent review of the exact original PNG pixels.'})),outcome:'PASS',repairInstruction:null};
   if(activePhase==='review:1')assert.equal(wire.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(p=>p.type==='image_url').length,1);
   return response({id:generationId,model:activePhase==='brief:1'?'openai/gpt-5.6-luna-20260709':'anthropic/claude-4.5-haiku-20251001',choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,cost:.00001}});
  }
  assert.match(String(url),/\/generation\?id=/);counts.gets++;trace.push('GET:'+activePhase);
  assert.equal((await one('select count(*)::int n from private.r12_focused_creative_candidates where creative_run_id=$1 and call_key=$2',[runId,activePhase])).n,1,'Candidate is durable before receipt GET');
  if(activePhase==='generate:1'){assert.equal(files.size,1);assert.equal((await one('select count(*)::int n from public.creative_assets where creative_run_id=$1',[runId])).n,0,'Original is stored before proof, then inspected and accepted after proof');}
  if(delayed)return response({error:{message:'Inert metadata indexing delay'}},{status:404,headers:{'retry-after':'120'}});
  return response({data:{...(activePhase==='generate:1'?{api_type:'image',created_at:new Date().toISOString(),total_cost:.014,num_media_completion:1,num_media_prompt:0}:{}),id:generationId,provider_name:activePhase==='generate:1'?'Black Forest Labs':activePhase==='brief:1'?'Azure':'Amazon Bedrock',model:activePhase==='generate:1'?'black-forest-labs/flux.2-klein-4b':activePhase==='brief:1'?'openai/gpt-5.6-luna-20260709':'anthropic/claude-4.5-haiku-20251001'}});
 };
 const input={businessId,creativeRunId:runId,coreWorkflowRunId:wid,runtimeCapability:capability};
 const tick=()=>m.exports.executeFocusedCreativeTransport(input,phaseState,activePhase,{transition,storage});
 const advanceReceiptClock=async phase=>{
  await db.exec('alter table private.r12_focused_creative_checks disable trigger r12_focused_creative_immutable');
  await db.exec('alter table private.r12_focused_creative_receipts disable trigger r12_focused_creative_immutable');
  await db.query("update private.r12_focused_creative_checks set created_at=clock_timestamp()-interval '121 seconds' where creative_run_id=$1 and call_key=$2",[runId,phase]);
  await db.query("update private.r12_focused_creative_receipts set retry_after_at=clock_timestamp()-interval '1 second' where check_id in(select id from private.r12_focused_creative_checks where creative_run_id=$1 and call_key=$2)",[runId,phase]);
  await db.exec('alter table private.r12_focused_creative_checks enable trigger r12_focused_creative_immutable');
  await db.exec('alter table private.r12_focused_creative_receipts enable trigger r12_focused_creative_immutable');
 };

 try{
  await db.exec('savepoint creative_unsent');
  try{denyBeforeTransport=true;await assert.rejects(tick(),/binding_required|scope_unavailable|Operating policy denied model dispatch/);assert.equal(counts.posts,0);assert.equal(counts.gets,0);
   const zero=await one('select count(*)::int n,coalesce(sum(reported_microusd),0)::int amount,bool_and(provider_request_id is null) no_provider from public.creative_cost_settlements where creative_run_id=$1',[runId]);assert.deepEqual(zero,{n:1,amount:0,no_provider:true});
   assert.equal((await tick()).status,'blocked');assert.equal(counts.posts,0);
  }finally{denyBeforeTransport=false;await db.exec('rollback to savepoint creative_unsent');await db.exec('release savepoint creative_unsent');Object.assign(counts,{posts:0,gets:0,uploads:0});}
  for(const [index,phase] of phases.entries()){
   activePhase=phase;delayed=true;phaseState=await transition('load');
   assert.equal(phaseState.phaseKey,phase);
   assert.equal((await tick()).status,'waiting');assert.equal(counts.posts,index+1);assert.equal(counts.gets,index*2+1);
   assert.equal((await tick()).status,'waiting');assert.equal(counts.posts,index+1);assert.equal(counts.gets,index*2+1,'Immediate resume cannot recheck metadata');
   const pending=await transition('r12_load',{callKey:phase});
   await reject(()=>transition('r12_persist',{callKey:phase,candidateHash:hash(pending.phase.candidate),proofHash:'0'.repeat(64),output:pending.phase.candidate.output}),/qualified_receipt_required/);
   if(index===0){
    await db.exec('savepoint creative_exhaustion');const counted={...counts};
    try{
     await advanceReceiptClock(phase);assert.equal((await tick()).status,'waiting');
     await advanceReceiptClock(phase);assert.deepEqual(await tick(),{status:'blocked',reason:'exhausted'});
     assert.deepEqual(await tick(),{status:'blocked',reason:'exhausted'});assert.equal(counts.posts,1);assert.equal(counts.gets,3);
    }finally{await db.exec('rollback to savepoint creative_exhaustion');await db.exec('release savepoint creative_exhaustion');Object.assign(counts,counted);}
   }
   await advanceReceiptClock(phase);
   delayed=false;assert.equal((await tick()).status,'advanced');assert.equal(counts.posts,index+1);assert.equal(counts.gets,(index+1)*2);
  }
 }finally{globalThis.fetch=originalFetch;}
 const terminal=await transition('load');assert.equal(terminal.status,'completed');assert.equal(terminal.productionReady,true);
 assert.deepEqual([...files.values()][0],png);assert.equal(counts.uploads,1);
 const binaryBinding=await one("select octet_length(binding::text)::int bytes,binding->>'wireBody' wire from private.r12_focused_creative_wires where creative_run_id=$1 and call_key='review:1'",[runId]);assert.ok(binaryBinding.bytes>9800000&&binaryBinding.bytes<=10500000);assert.equal(Buffer.byteLength(binaryBinding.wire),wires['review:1']);assert.ok(wires['review:1']>4900000&&wires['review:1']<=5000000);
 const finance=await one("select (select count(*)::int from public.creative_cost_reservations where creative_run_id=$1) reservations,(select count(*)::int from public.creative_cost_settlements where creative_run_id=$1) settlements,(select coalesce(sum(reported_microusd),0)::int from public.creative_cost_settlements where creative_run_id=$1) total,(select count(*)::int from private.r05_requests where workflow_run_id=$2) requests,(select count(*)::int from private.r05_settlements s join private.r05_requests r on r.id=s.request_id where r.workflow_run_id=$2) duplicate_settlements",[runId,wid]);
 assert.deepEqual(finance,{reservations:4,settlements:4,total:14030,requests:4,duplicate_settlements:0});
 assert.deepEqual((await one('select private.stage13v2_budget_authority($1,false) result',[result.originalFundingRootId])).result,rootBefore,'Creative has no original USD2 research-root charges');
 assert.deepEqual(await one('select to_jsonb(s) state,(select jsonb_agg(to_jsonb(v) order by revision) from private.r04_goal_versions v where v.goal_id=s.goal_id) versions from private.r04_goal_state s where s.goal_id=$1',[result.goalId]),goalBefore,'Completed pilot Goal remains frozen');
 const closed=await runOperatorRecipe(operator,'close',closeInput);assert.equal(closed.admissionRevoked,true);assert.equal((await runOperatorRecipe(operator,'close',closeInput)).admissionRevoked,true);
 return {adoption:true,scope:true,providerCalls:0,inertPosts:counts.posts,inertReceiptGets:counts.gets,originalUploads:counts.uploads,finance,wires,productionReady:true,rootUnchanged:true,goalUnchanged:true,receiptExhaustionStops:true,unqualifiedPersistenceDenied:true,staleBindDenied:true,staleSendDenied:true,originalBytes:png.length,reviewBindingBytes:binaryBinding.bytes,unsentKnownZero:true};
}

async function focusedCreativeCatalogFixture(){
 const imageCatalog={id:'black-forest-labs/flux.2-klein-4b',endpoints:[{provider_name:'Black Forest Labs',provider_slug:'black-forest-labs',provider_tag:'black-forest-labs',supported_parameters:{aspect_ratio:{type:'enum',values:['1:1']},output_format:{type:'enum',values:['png','jpeg']},n:{type:'range',min:1,max:1},input_references:{type:'range',min:0,max:4},seed:{type:'boolean'}},allowed_passthrough_parameters:['steps','guidance','safety_tolerance'],supports_streaming:false,pricing:[{billable:'output_image',unit:'megapixel',cost_usd:.014}]}]};
 const {r12CatalogFixture}=await import(repo+'/tests/helpers/r12-provider-fixture.mjs');
 const publicCatalogs=r12CatalogFixture();
 const lowerInertPrices=value=>{if(Array.isArray(value)){value.forEach(lowerInertPrices);return;}if(!value||typeof value!=='object')return;if('prompt'in value||'completion'in value){for(const key of ['prompt','completion','input_cache_read','input_cache_write','input_cache_write_1h','internal_reasoning'])if(Number(value[key])>0)value[key]='0.00000001';}Object.values(value).forEach(lowerInertPrices);};
 Object.values(publicCatalogs).forEach(s=>lowerInertPrices(s.payload));
 for(const model of publicCatalogs.models.payload.data)model.architecture={input_modalities:['text','image'],output_modalities:['text']};
 const catalogByUrl=new Map(Object.values(publicCatalogs).map(s=>[s.url,s.payload]));

 const {qualifyFocusedCreativeQuote}=require(repo+'/.core-tests/creative/focused-quote.js');
 const now=Date.now(),qualifiedQuote=qualifyFocusedCreativeQuote(publicCatalogs,{url:'https://openrouter.ai/api/v1/images/models/black-forest-labs/flux.2-klein-4b/endpoints',fetchedAt:new Date(now-1000).toISOString(),payload:imageCatalog},true,now);
 return {qualifiedQuote,catalogByUrl,imageCatalog};
}
