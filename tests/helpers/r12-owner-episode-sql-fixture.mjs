/** Inert qualification only: genuine initial execution, owner policy confirmation,
 * Stop and durable continuation. No forged phase completion or provider network. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {exerciseOwnerInitialRuntime,ownerInitialPhaseOutputs} from './r12-owner-initial-runtime.mjs';
import {one,sha,ownerInitialRuntimeRpc,ownerInitialRpc,ownerInitialSqlFixture,ownerPreflightPrepared,ownerConfirmPayload} from './r12-owner-initial-sql-fixture.mjs';
import {r12QuoteFixture} from './r12-provider-fixture.mjs';
import {appendOwnerGrantRootRevision,enrollOwnerExtensionGrant} from './r12-owner-grant-extension-sql-fixture.mjs';
import {ownerGoalFixture} from './r12-owner-goal-fixture.mjs';
import {discoveryV2Hash as hash} from '../../.core-tests/products/discovery-v2.js';
import {driveQuestOnce} from '../../.core-tests/core/quest-controller.js';
import {createDiscoveryR12QuestAdapter} from '../../.core-tests/products/discovery-r12-adapter.js';
import {readDiscoveryR12PhaseInputs,buildDiscoveryR12PhaseRequest,projectDiscoveryR12Phase,reconstructDiscoveryR12Result} from '../../.core-tests/products/discovery-r12-runtime.js';

export async function enrollOwnerEpisodeGrant(db,f,{maximumEpisodes=3,maximumAllocationMicrounits='6000000'}={}){
 const grantId=randomUUID(),bootstrapKey='inert-owner-episode-grant-'+grantId;
 await db.query(`insert into private.r12_owner_bootstrap_grants(id,root_id,business_id,owner_id,business_revision,business_hash,profile_id,server_key_hash,approval_hash,valid_from,valid_until,continuation_bounds,created_at)
 select $1,root_id,business_id,owner_id,business_revision,business_hash,profile_id,$2,$3,valid_from,valid_until,jsonb_build_object('maximumEpisodes',$4::integer,'maximumAllocationMicrounits',$5::text,'expiresAt',valid_until),
 greatest(clock_timestamp(),(select max(created_at)+interval '1 microsecond' from private.r12_owner_bootstrap_grants where business_id=$7))
 from private.r12_owner_bootstrap_grants where id=$6`,[grantId,sha(bootstrapKey),'7'.repeat(64),maximumEpisodes,maximumAllocationMicrounits,f.grantId,f.businessId]);
 return {...f,grantId,bootstrapKey,input:{...f.input,grantId},server:async(op,payload,key=bootstrapKey)=>{
  const result=await ownerInitialRpc(db,f.ownerId,'r12_owner_research_server',[f.businessId,op,payload,key]);
  return op==='prepare'||op==='prepare_episode'?ownerPreflightPrepared(f.rpc,f.businessId,result):result;
 }};
}
export async function episodeInput(db,f){
 const proof=(await one(db,'select private.r12_owner_episode_predecessor($1,$2) proof',[f.businessId,f.goalId])).proof;
 return {...f.input,submissionId:randomUUID(),predecessorPlanId:proof.predecessorPlanId,predecessorPlanHash:proof.predecessorPlanHash,predecessorScopeId:proof.predecessorScopeId,predecessorScopeHash:proof.predecessorScopeHash};
}
export async function exerciseOwnerEpisodeCatalogSql(db){
 const f=await ownerInitialSqlFixture(db),continuation=await enrollOwnerEpisodeGrant(db,f);
 const addGrant=async bounds=>{const id=randomUUID();await db.query(`insert into private.r12_owner_bootstrap_grants(id,root_id,business_id,owner_id,business_revision,business_hash,profile_id,server_key_hash,approval_hash,valid_from,valid_until,continuation_bounds,created_at)
 select $1,root_id,business_id,owner_id,business_revision,business_hash,profile_id,$2,approval_hash,valid_from,valid_until,$3,
 greatest(clock_timestamp(),(select max(created_at)+interval '1 microsecond' from private.r12_owner_bootstrap_grants where business_id=$5))
 from private.r12_owner_bootstrap_grants where id=$4`,[id,sha('inert-catalog-grant-'+id),bounds,f.grantId,f.businessId]);return id;};
 const initialOnly=await addGrant(null);
 const selected=async expected=>{const read=await f.read();assert.equal(read.profiles.length,1,'Keep one bounded row per profile');assert.equal(read.profiles[0].grantId,expected);};
 await selected(initialOnly);
 const prepared=await f.prepare();await f.server('confirm',f.confirmPayload(prepared));
 assert.equal((await one(db,'select count(*)::int n from private.r07_plans where goal_id=$1',[f.goalId])).n,0,'Activation alone selects continuation grants');
 await selected(continuation.grantId);
 const expiresAt=(await one(db,"select (clock_timestamp()-interval '10 seconds')::text stamp")).stamp;
 await addGrant({maximumEpisodes:3,maximumAllocationMicrounits:'6000000',expiresAt});await selected(continuation.grantId);
 const shortExpiry=(await one(db,"select (clock_timestamp()+interval '34 minutes')::text stamp")).stamp;
 await addGrant({maximumEpisodes:3,maximumAllocationMicrounits:'6000000',expiresAt:shortExpiry});await selected(continuation.grantId);
 const newest=await enrollOwnerEpisodeGrant(db,f);await selected(newest.grantId);
 return {oneProfile:true,newestInitialPreserved:true,ineligibleContinuationSkipped:true};
}
export async function runOwnerEpisodePhases(db,f,receipt,{onReserved=null,onFirstPost=null,expectStopped=false}={}){
 const view=await f.rpc('r12_discovery_owner_read',[f.businessId,receipt.scopeId,true]),scope=view.activation.scope,plan=view.activation.plan;
 const controller='inert-controller-'+receipt.scopeId,admission='inert-admission-'+receipt.scopeId,lease='inert-episode-lease-'+receipt.scopeId;
 const command=(op,payload,epoch=null)=>ownerInitialRuntimeRpc(db,'r07_controller',[f.businessId,f.goalId,op,['schedule','reserve'].includes(op)?{...payload,runtimeCapability:'inert-owner-episode-runtime-capability'}:payload,randomUUID(),controller,lease,epoch,admission]);
 const store={read:()=>command('read',{}),command};
 const operation=(attemptId,op,payload)=>ownerInitialRuntimeRpc(db,'r12_discovery_server',[f.businessId,attemptId,op,payload,controller]);
 const effects={operation,settle:(attemptId,settlement)=>command('settle',{attemptId,settlement}),dispatchedAt:async attemptId=>(await operation(attemptId,'load',{})).dispatchedAt};
 const outputs=ownerInitialPhaseOutputs(scope),adapters={};let posts=0,gets=0,postError;
 for(const step of plan.steps){const phase=step.key,generationId='gen-owner-episode-'+scope.id+'-'+phase;
  adapters[step.adapter]=createDiscoveryR12QuestAdapter({scope,phase,identity:{qualificationHash:step.qualificationHash,workflowDefinitionId:step.workflowDefinitionId,workerDefinitionId:step.workerDefinitionId,mode:'qualification'},dataClasses:phase==='search1'?['generic_public_query','public_evidence']:['business_context','public_evidence'],store:effects,
   config:{apiKey:'inert-owner-episode-only',baseUrl:'https://openrouter.ai/api/v1',appUrl:'https://agent-labs-two.vercel.app',appName:'Agent Labs'},quote:async()=>r12QuoteFixture(),
   request:async ctx=>buildDiscoveryR12PhaseRequest(ctx,readDiscoveryR12PhaseInputs(ctx,await operation(ctx.attempt.id,'inputs',{}))),
   project:async(qualified,ctx,request)=>projectDiscoveryR12Phase(ctx,readDiscoveryR12PhaseInputs(ctx,await operation(ctx.attempt.id,'inputs',{})),qualified,request),
   fetcher:async(_url,init)=>{const model=phase==='review'?'anthropic/claude-4.5-haiku-20251001':'openai/gpt-5.6-luna-20260709';
    if(init.method==='POST'){posts++;if(posts===1&&onFirstPost)try{await onFirstPost({scope,controller,admission});}catch(error){postError=error;throw error;}const message=phase==='search1'?{content:'Explicitly synthetic public context.',annotations:outputs.search1.annotations}:{content:JSON.stringify(outputs[phase])};return new Response(JSON.stringify({id:generationId,model,choices:[{finish_reason:'stop',message}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,cost:.00001,...(phase==='search1'?{server_tool_use_details:{web_search_requests:1}}:{})}}),{status:200});}
    gets++;return new Response(JSON.stringify({data:{id:generationId,provider_name:phase==='review'?'Amazon Bedrock':'Azure',model}}),{status:200});}
  });
 }
 let last;for(let n=0;n<30;n++){try{last=await driveQuestOnce(store,{adapters,reconcile:true});}catch(error){if(expectStopped&&!postError&&error.message==='r12_discovery_receipt_pending'&&error.receipt?.status==='stopped'){last={status:'stopped',reason:'receipt_stopped'};break;}throw postError??error;}if(onReserved&&last.reason==='reserved')await onReserved({db,f,receipt,store,operation,controller,admission,last});if(last.status==='completed'||(expectStopped&&last.status!=='progress'))break;assert.equal(last.status,'progress',JSON.stringify(last));}
 if(expectStopped){assert.equal(posts,1);assert.equal(gets,0);assert.equal(last.status,'stopped');return {posts,gets,last,store};}
 assert.equal(last.status,'completed');assert.equal(posts,5);assert.equal(gets,5);assert.equal((await driveQuestOnce(store,{adapters,reconcile:true})).status,'completed');
 const raw=await f.rpc('r12_discovery_result_read',[f.businessId,receipt.scopeId]);const result=reconstructDiscoveryR12Result(raw,f.businessId,receipt.scopeId);assert.equal(result.review.outcome,'NEEDS_MORE_EVIDENCE');
 return {posts,gets,result,store};
}
export async function exerciseOwnerEpisodeSql(db,{legacy=null}={}){
 return exerciseOwnerInitialRuntime(db,{legacy,onCompleted:async ctx=>{
  const initial=ctx.f,oldGoal=await one(db,'select to_jsonb(s) state from private.r04_goal_state s where goal_id=$1',[initial.goalId]);
  await ctx.server.stopDiscoveryR12(ctx.context,initial.businessId,ctx.scope.id,true);
  const firstInput=await episodeInput(db,initial);
  await assert.rejects(initial.server('prepare_episode',{input:firstInput,quote:r12QuoteFixture()}),/episode_grant_required/);
  const f=await enrollOwnerEpisodeGrant(db,initial,{maximumEpisodes:2});
  const input=await episodeInput(db,f),a=await f.server('prepare_episode',{input,quote:r12QuoteFixture()});
  assert.equal(a.preview.version,'r12.owner-research-episode-preview.1');assert.equal(a.preview.episodeNumber,1);assert.equal(a.preview.predecessorClosure.baseChildren,5);assert.equal(a.preview.predecessorClosure.baseKnownMicrounits,'50');
  const competitor=await f.server('prepare_episode',{input:{...input,submissionId:randomUUID()},quote:r12QuoteFixture()});
  await db.query('update private.r07_heads set children_created=children_created+1 where goal_id=$1',[f.goalId]);
  await assert.rejects(f.server('confirm_episode',f.confirmPayload(a)),/lifetime_bound/);
  await db.query('update private.r07_heads set children_created=children_created-1 where goal_id=$1',[f.goalId]);
  assert.equal((await one(db,'select count(*)::int n from private.r12_owner_episode_activations where goal_id=$1',[f.goalId])).n,0);
  const confirmation=f.confirmPayload(a),{preflight:episodePreflight,...withoutEpisodePreflight}=confirmation;
  assert.ok(episodePreflight);
  await assert.rejects(f.server('confirm_episode',withoutEpisodePreflight),/r12_owner_planner_preflight_required/);
  assert.equal((await one(db,'select count(*)::int n from private.r12_owner_episode_activations where setup_id=$1',[a.setupId])).n,0);
  const active=await f.server('confirm_episode',confirmation);assert.equal(active.activated,true);assert.deepEqual(await f.server('confirm_episode',confirmation),{...active,replayed:true});
  assert.equal((await f.server('confirm_episode',withoutEpisodePreflight)).replayed,true);
  const workspace=await ctx.owner.readDiscoveryR12Workspace(ctx.context,f.businessId,a.scopeId);assert.equal(workspace.available,true);assert.equal(workspace.record.ownerEpisode.episodeNumber,1);
  await assert.rejects(db.query('update private.r12_owner_episode_closures set proof=proof where goal_id=$1',[f.goalId]),/immutable/);
  await assert.rejects(db.query('delete from private.r12_owner_episode_activations where goal_id=$1',[f.goalId]),/immutable/);
  await enrollOwnerEpisodeGrant(db,initial,{maximumEpisodes:1});
  assert.equal((await f.read()).profiles[0].grantId,f.grantId,'A newer exhausted episode-count grant cannot mask an eligible grant');
  await enrollOwnerEpisodeGrant(db,initial,{maximumEpisodes:3,maximumAllocationMicrounits:String(r12QuoteFixture().maximumMicrousd)});
  assert.equal((await f.read()).profiles[0].grantId,f.grantId,'A newer exhausted cumulative allocation grant cannot mask an eligible grant');
  await assert.rejects(f.server('confirm_episode',f.confirmPayload(competitor)),/stale|predecessor|closed_lineage|unresolved|grant/);
  const head=await one(db,'select * from private.r07_heads where goal_id=$1',[f.goalId]);assert.equal(head.children_created,5);assert.equal(head.dispatches,5);
  assert.equal((await one(db,'select version from private.r07_plans where id=$1',[head.plan_id])).version,2);
  assert.equal((await one(db,'select count(*)::int n from private.r05_markers where business_id=$1',[f.businessId])).n,5);
  await f.server('stop',{setupId:a.setupId,setupHash:a.setupHash,submissionId:randomUUID()},'');
  assert.equal((await one(db,'select count(*)::int n from private.r12_owner_episode_activations where goal_id=$1',[f.goalId])).n,1);
  const b=await f.server('prepare_episode',{input:await episodeInput(db,f),quote:r12QuoteFixture()});assert.equal(b.preview.episodeNumber,2);
  await f.server('confirm_episode',f.confirmPayload(b));
  const run=await runOwnerEpisodePhases(db,f,b);
  assert.equal(run.result.ownerEpisode.episodeNumber,2);
  const final=await one(db,'select children_created,dispatches,repairs_used,pivots_used from private.r07_heads where goal_id=$1',[f.goalId]);assert.deepEqual(final,{children_created:10,dispatches:10,repairs_used:0,pivots_used:0});
  await f.server('stop',{setupId:b.setupId,setupHash:b.setupHash,submissionId:randomUUID()},'');
  await assert.rejects(f.server('prepare_episode',{input:await episodeInput(db,f),quote:r12QuoteFixture()}),/episode_grant_exhausted/);
  assert.deepEqual(await one(db,'select to_jsonb(s) state from private.r04_goal_state s where goal_id=$1',[f.goalId]),oldGoal);
  assert.deepEqual(await f.rpc('r12_discovery_result_read',[f.businessId,ctx.scope.id]),ctx.rawResult);
  const fund=await f.read();assert.equal(fund.funding.budget.committedMicrousd,100+(legacy?.committedMicrounits??0));
  if(!legacy){
   const late=await enrollOwnerEpisodeGrant(db,initial,{maximumEpisodes:3}),c=await late.server('prepare_episode',{input:await episodeInput(db,late),quote:r12QuoteFixture()});
   await late.server('confirm_episode',late.confirmPayload(c));
   const activePlan=await one(db,'select p.* from private.r07_plans p join private.r07_heads h on h.plan_id=p.id where h.goal_id=$1',[late.goalId]);
   const lateInput={...late.input,submissionId:randomUUID(),predecessorPlanId:activePlan.id,predecessorPlanHash:activePlan.content_hash,predecessorScopeId:c.scopeId,predecessorScopeHash:activePlan.content.discoveryScopeHash};
   await runOwnerEpisodePhases(db,late,c,{expectStopped:true,onFirstPost:async({controller,admission})=>{
    await late.server('stop',{setupId:c.setupId,setupHash:c.setupHash,submissionId:randomUUID()},'');
    await assert.rejects(late.server('prepare_episode',{input:lateInput,quote:r12QuoteFixture()}),/unresolved_liability/);
    assert.equal((await one(db,'select count(*)::int n from private.r07_server_revocations where key_hash=$1',[sha(controller)])).n,0);
    assert.equal((await one(db,'select count(*)::int n from private.r05_server_revocations where key_hash=$1',[sha(admission)])).n,0);
   }});
   const afterReceipt=await one(db,'select plan_id,children_created,dispatches from private.r07_heads where goal_id=$1',[late.goalId]);assert.deepEqual(afterReceipt,{plan_id:activePlan.id,children_created:11,dispatches:11});
   assert.equal((await one(db,'select count(*)::int n from private.r05_exposure($1) where unknown',[late.businessId])).n,0,'Late receipt resolves the old request after Stop');
   await late.server('stop',{setupId:c.setupId,setupHash:c.setupHash,submissionId:randomUUID()},'');
   await assert.rejects(late.server('prepare_episode',{input:await episodeInput(db,late),quote:r12QuoteFixture()}),/grant_exhausted/);
  }
  return {providerCalls:0,initialPosts:5,episodePosts:run.posts,episodes:legacy?2:3,lateReceiptPosts:legacy?0:1,goalUnchanged:true};
 }});
}

export async function exerciseHistoricalOwnerEpisodeSql(db,evidence){
 const {businessId,goalId,ownerId}=evidence.metadata;
 const originalGoalCount=(await one(db,'select count(*)::int n from public.goals where business_id=$1',[businessId])).n;
 const old=await one(db,`select (select jsonb_agg(to_jsonb(p) order by version) from private.r07_plans p where goal_id=$1) plans,
 (select jsonb_agg(to_jsonb(a) order by id) from private.r07_attempts a where goal_id=$1) attempts,
 (select jsonb_agg(to_jsonb(v) order by revision) from private.r04_goal_versions v where goal_id=$1) goals`,[goalId]);
 const latest=await one(db,'select * from private.r07_plans where business_id=$1 and goal_id=$2 order by version desc limit 1',[businessId,goalId]);assert.equal(latest.version,4);
 const scope=await one(db,"select * from private.r12_discovery_scopes where id=($1::jsonb->>'discoveryScopeId')::uuid",[latest.content]);
 const initialRound=await one(db,'select * from public.product_experiments where id=$1',[scope.prior_round_id]);
 const profile=ownerGoalFixture().profile;profile.id=randomUUID();profile.maximumRunMicrousd=2000000;
 const installed=await one(db,'select * from public.installed_packs where id=$1',[latest.content.steps[0].installationId]);
 const catalogSnapshot=(await one(db,"select jsonb_build_object('rootPackId',$1::uuid,'releases',private.stage10_resolve($1,true)) snapshot",[installed.snapshot.rootPackId])).snapshot;
 const workflow=await one(db,'select id,private.r04_hash(to_jsonb(w)) hash from public.workflow_definitions w where pack_id=$1',[installed.snapshot.rootPackId]);
 const workers={};for(const phase of ['plan','search1','select1','strategy','review'])workers[phase]=await one(db,"select id,private.r04_hash(to_jsonb(w)) hash from public.worker_definitions w where worker_key=$1 and version='1.0.0' and pack_id in(select (v->>'id')::uuid from jsonb_array_elements($2::jsonb->'releases')v)",['product.discovery-v2.'+(['search1','select1'].includes(phase)?'research':phase),installed.snapshot]);
 const pins={packId:installed.snapshot.rootPackId,snapshot:catalogSnapshot,snapshotHash:(await one(db,'select private.r04_hash($1) hash',[catalogSnapshot])).hash,workflowDefinitionId:workflow.id,workflowHash:workflow.hash,plannerWorkerDefinitionId:workers.plan.id,workers,executionReviewHash:'d'.repeat(64),eligibilityReviewHash:'e'.repeat(64),policyInterpretationHash:'f'.repeat(64),knowledgeValidUntil:profile.validUntil};
 const bindingId=randomUUID(),rootId=randomUUID(),grantId=randomUUID(),bootstrapKey='inert-historical-episode-grant-'+grantId;
 const br=await one(db,'select v.* from private.r04_business_versions v join private.r04_business_state s using(business_id,revision) where business_id=$1',[businessId]);
 const gv=await one(db,'select v.* from private.r04_goal_versions v join private.r04_goal_state s using(business_id,goal_id,revision) where goal_id=$1',[goalId]);
 await db.query('insert into private.r12_owner_profiles values($1,$2,$3,$4,$5,clock_timestamp())',[profile.id,profile,hash(profile),pins,hash(pins)]);
 await db.query("insert into private.r12_owner_funding_bindings(id,business_id,kind,authority_root_id,original_semantic_goal_hash) values($1,$2,'legacy_research_root',$3,$4)",[bindingId,businessId,scope.budget_authority_root_id,initialRound.variables.semanticGoalHash]);
 const amount=Number(r12QuoteFixture().maximumMicrousd);
 await db.query('insert into private.r12_owner_grant_roots(id,business_id,binding_id,maximum_scopes,maximum_allocation_microunits,approval_hash) values($1,$2,$3,1,$4,$5)',[rootId,businessId,bindingId,amount,'1'.repeat(64)]);
 await db.query(`insert into private.r12_owner_bootstrap_grants(id,root_id,business_id,owner_id,business_revision,business_hash,profile_id,server_key_hash,approval_hash,valid_from,valid_until,continuation_bounds)
 values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[grantId,rootId,businessId,ownerId,br.revision,br.content_hash,profile.id,sha(bootstrapKey),'2'.repeat(64),profile.validFrom,profile.validUntil,{maximumEpisodes:1,maximumAllocationMicrounits:String(amount),expiresAt:profile.validUntil}]);
 const rpc=async(name,args)=>{await db.exec('savepoint episode_owner_rpc');try{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[ownerId]);await db.exec('set local role authenticated');const result=(await one(db,`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).result;await db.exec('reset role');return result;}catch(error){await db.exec('rollback to savepoint episode_owner_rpc');throw error;}finally{await db.exec('release savepoint episode_owner_rpc');}};
 const f={db,businessId,goalId,ownerId,bindingId,rootId,grantId,profile,pins,bootstrapKey,rpc,input:{businessId,goalId,goalRevision:gv.revision,profileId:profile.id,profileHash:hash(profile),grantId,marketSetKey:'gb',topicKey:'gardening',businessLifetimeLimitMicrounits:'6000000',researchLifetimeLimitMicrounits:'6000000',submissionId:randomUUID()},server:async(op,payload,key=bootstrapKey)=>{
  const result=await rpc('r12_owner_research_server',[businessId,op,payload,key]);
  return op==='prepare'||op==='prepare_episode'?ownerPreflightPrepared(rpc,businessId,result):result;
 },confirmPayload:ownerConfirmPayload};
 const baselineMarkers=(await one(db,'select count(*)::int n from private.r05_markers where business_id=$1',[businessId])).n;
 const input=await episodeInput(db,f),prepared=await f.server('prepare_episode',{input,quote:r12QuoteFixture()});assert.equal(prepared.preview.predecessorClosure.predecessorPlanVersion,4);
 await f.server('confirm_episode',f.confirmPayload(prepared));const head=await one(db,'select * from private.r07_heads where goal_id=$1',[goalId]);
 const successor=await one(db,'select * from private.r07_plans where id=$1',[head.plan_id]);assert.equal(successor.version,5);assert.equal(successor.previous_plan_id,latest.id);assert.equal(successor.content.format,'r12.discovery-episode.1');
 const run=await runOwnerEpisodePhases(db,f,prepared);assert.equal(run.posts,5);
 const markersAfterFirst=(await one(db,'select count(*)::int n from private.r05_markers where business_id=$1',[businessId])).n;
 assert.equal(markersAfterFirst,baselineMarkers+5,'The genuine first continuation sends exactly five inert calls');
 const stopFirst=await f.server('stop',{setupId:prepared.setupId,setupHash:prepared.setupHash,submissionId:randomUUID()},'');assert.equal(stopFirst.stopped,true);
 const used=await one(db,`select count(*)::int scopes,coalesce(sum(allocation_microunits),0)::bigint allocation from private.r12_owner_episode_activations where grant_root_id=$1`,[rootId]);
 assert.equal(used.scopes,1);assert.equal(Number(used.allocation),amount);
 const oldGrant=await enrollOwnerEpisodeGrant(db,f,{maximumEpisodes:2,maximumAllocationMicrounits:String(2*amount)});
 oldGrant.server=(op,payload,key=oldGrant.bootstrapKey)=>rpc('r12_owner_research_server',[businessId,op,payload,key]);
 await assert.rejects(oldGrant.server('prepare_episode',{input:await episodeInput(db,oldGrant),quote:r12QuoteFixture()}),/r12_owner_grant_exhausted/,'A fresh legacy grant cannot inherit an extension');
 const revision=await appendOwnerGrantRootRevision(db,rootId,{maximumScopes:2,maximumAllocationMicrounits:String(2*amount),expiresAt:profile.validUntil});
 assert.equal(revision.revision,1);
 await assert.rejects(oldGrant.server('prepare_episode',{input:await episodeInput(db,oldGrant),quote:r12QuoteFixture()}),/r12_owner_grant_exhausted/,'A legacy grant stays on the original root ceiling');
 const extended=await enrollOwnerExtensionGrant(db,f,revision,{maximumEpisodes:2,maximumAllocationMicrounits:String(2*amount)});
 extended.server=(op,payload,key=extended.bootstrapKey)=>rpc('r12_owner_research_server',[businessId,op,payload,key]);
 const next=await extended.server('prepare_episode',{input:await episodeInput(db,extended),quote:r12QuoteFixture()});
 assert.equal(next.preview.predecessorClosure.predecessorPlanVersion,5);assert.equal(next.preview.episodeNumber,2);assert.deepEqual(next.preview.grantRootRevision,revision);
 const nextActive=await extended.server('confirm_episode',extended.confirmPayload(next));assert.equal(nextActive.activated,true);
 const head6=await one(db,'select * from private.r07_heads where business_id=$1 and goal_id=$2',[businessId,goalId]);
 const plan6=await one(db,'select * from private.r07_plans where id=$1',[head6.plan_id]);assert.equal(plan6.version,6);assert.equal(plan6.previous_plan_id,successor.id);
 assert.equal(plan6.content.maximumChildren,next.preview.predecessorClosure.baseChildren+5);assert.equal(plan6.content.maximumDispatches,next.preview.predecessorClosure.baseDispatches+5);
 assert.equal((await one(db,'select grant_root_id from private.r12_owner_episode_activations where setup_id=$1',[next.setupId])).grant_root_id,rootId);
 const stopNext=await extended.server('stop',{setupId:next.setupId,setupHash:next.setupHash,submissionId:randomUUID()},'');assert.equal(stopNext.stopped,true);
 const cumulative=await one(db,`select count(*)::int scopes,coalesce(sum(allocation_microunits),0)::bigint allocation from private.r12_owner_episode_activations where grant_root_id=$1`,[rootId]);
 assert.equal(cumulative.scopes,2);assert.equal(Number(cumulative.allocation),2*amount);
 assert.equal((await one(db,'select count(*)::int n from private.r05_markers where business_id=$1',[businessId])).n,markersAfterFirst,'Second episode Stop consumes its allocation before any call');
 const before=await one(db,`select (select jsonb_agg(to_jsonb(p) order by version) from private.r07_plans p where goal_id=$1 and version<=4) plans,
 (select jsonb_agg(to_jsonb(a) order by a.id) from private.r07_attempts a join private.r07_plans p on p.id=a.plan_id where a.goal_id=$1 and p.version<=4) attempts,
 (select jsonb_agg(to_jsonb(v) order by revision) from private.r04_goal_versions v where goal_id=$1) goals`,[goalId]);assert.deepEqual(before,old);
 assert.equal((await one(db,'select count(*)::int n from public.goals where business_id=$1',[businessId])).n,originalGoalCount);
 return {providerCalls:0,episodePosts:5,predecessorVersion:4,successorVersion:5,oldHistoryUnchanged:true};
}
