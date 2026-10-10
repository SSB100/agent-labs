import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {directControllerDatabase} from './helpers/r12-direct-controller-database.mjs';
import {directControllerFixture} from './helpers/r12-direct-controller-fixture.mjs';
import {directControllerSource} from './helpers/r12-direct-controller-source-fixture.mjs';
import {directModelDispatch,directModelComplete,directModelExpectation} from './helpers/r12-direct-controller-model-fixture.mjs';
import {one,ownerInitialRpc} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {r12PhaseOutputFixture} from './helpers/r12-phase-output-fixture.mjs';
import {PUBLIC_RESEARCH_DIMENSIONS} from '../.core-tests/products/discovery-r12-public-quality.js';
import {publicResearchQuestionHash} from '../.core-tests/products/discovery-r12-public-contracts.js';
import * as model from '../.core-tests/products/discovery-r12-public-model.js';
import {qualifyGenerationRouteProof} from '../.core-tests/research/generation-route.js';

test('late final review settles and closes its cycle without replacing newer plans or owner control',{
 skip:!process.env.R12_SQL_TEST_HOST&&!process.env.R12_REQUIRE_POSTGRES&&!process.env.R12_POSTGRES_URL,timeout:180000,
},async()=>{
 const db=await directControllerDatabase();
 try{
  for(const name of ['20261010120610_r12_direct_source_renderer_v2.sql','20261010120620_r12_direct_owner_server_context.sql','20261010120630_r12_direct_late_receipt_head_fence.sql'])await db.exec(readFileSync('supabase/migrations/'+name,'utf8'));
  const f=await directControllerFixture(db);f.authority.db=db;
  const b=f.authority.f.businessId,g=f.authority.f.goalId,owner=f.authority.f.ownerId;
  const outputs=r12PhaseOutputFixture(f.profile.audience);outputs.plan.queryFocus=[];
  await directModelComplete(f,await f.schedule('plan'),outputs.plan);
  await directControllerSource(f,await f.schedule('source'));
  outputs.strategy.marketComparisons=outputs.strategy.marketComparisons.filter(x=>x.countryCode==='GB');
  const strategy=await directModelComplete(f,await f.schedule('strategy'),{assessment:outputs.strategy,measurement:null});
  const review=await f.schedule('review'),dispatch=await directModelDispatch(f,review);
  const ctx=model.readPublicResearchModelInputs(dispatch.dispatch.inputs,directModelExpectation(dispatch.dispatch.inputs));
  const ref=ctx.evidence.find(x=>x.kind==='searches').ref;
  const quality=Object.fromEntries(PUBLIC_RESEARCH_DIMENSIONS.map(d=>[d,{score:3,anchorId:`${d}.3`,rationale:'Literal aggregate observations leave candidate demand and exposure unresolved.',evidenceRefs:[ref],contraryRefs:[ref],missingFacts:['Eligible exposure is unknown.']} ]));
  const next={...f.initial,query:'astronomy graduation gifts',namedGap:'Which astronomy graduation gift wording is visible?',questionHash:publicResearchQuestionHash('Which astronomy graduation gift wording is visible?')};
  const output={version:'r12.direct-etsy-review.1',proposalHash:strategy.expected.proposalHash,quality,hypothesisFinding:'undetermined',learningRecommendation:'NME',conclusion:'The descriptive result is concrete but the hypothesis remains unmeasured.',conclusionEvidenceRefs:[ref],contraryEvidenceRefs:[ref],proposedCommand:next};
  const route=f.quote.inference.reviewer,id='gen-inert-late-review-'+randomUUID();
  const candidate={version:'r12.discovery-response.1',scopeId:f.prepared.scopeId,attemptId:review.attemptId,requestId:review.requestId,phase:'review',requestHash:dispatch.wire.requestHash,providerRequestId:id,providerModelId:route.modelId,receivedAt:new Date().toISOString(),reportedMicrousd:1,output};
  const proof=qualifyGenerationRouteProof({data:{id,provider_name:route.providerName,model:route.modelId}},{generationId:id,providerName:route.providerName,acceptedResponseModelIds:route.acceptedResponseModelIds,requestedEndpoint:route.endpoint});
  const expected=model.projectPublicResearchModelPhase(ctx,candidate,dispatch.dispatch.binding,proof);
  await f.rpc('candidate',{attemptId:review.attemptId,candidate});
  const head=async()=>(await one(db,'select to_jsonb(h) body from private.r07_heads h where business_id=$1 and goal_id=$2',[b,g])).body;
  const counters=async()=>one(db,`select (select count(*)::int from private.r05_markers) markers,
   (select count(*)::int from private.r05_reservations) reservations,(select count(*)::int from private.r12_direct_phase_attempts) attempts`);
  const beforeCounts=await counters();
  const receive=async()=>{
   const result=await f.rpc('model_receipt',{attemptId:review.attemptId,candidate,proof});assert.equal(result.accepted,true);
   assert.deepEqual((await one(db,'select content from private.r07_responses where attempt_id=$1',[review.attemptId])).content.result,expected);
   assert.equal((await one(db,'select actual_microunits::text cost from private.r05_settlements where request_id=$1',[review.requestId])).cost,'1');
   const closure=await one(db,'select status,review from private.r12_direct_cycle_closures where scope_id=$1 and ordinal=1',[f.prepared.scopeId]);assert.equal(closure.status,'completed');assert.deepEqual(closure.review,expected.normalized);
   assert.equal((await one(db,'select status from private.r07_attempts where id=$1',[review.attemptId])).status,'completed');
   assert.deepEqual(await counters(),beforeCounts,'late settlement adds no reservation, marker or attempt');
   const frozen=await head();assert.equal((await f.rpc('model_receipt',{attemptId:review.attemptId,candidate,proof})).replayed,true);assert.deepEqual(await head(),frozen);
   return result;
  };
  const branch=async(label,control,check)=>{
   await db.exec('begin');try{await control();const controlled=await head();await receive();await check(controlled,await head());}catch(error){error.message=label+': '+error.message;throw error;}finally{await db.exec('rollback');}
  };
  // These are adversarial head snapshots, not paid successor receipts or new authority.
  await branch('newer current plan',async()=>{
   const current=(await one(db,'select to_jsonb(p) body from private.r07_plans p where id=$1',[f.prepared.planId])).body;
   const successor={...current,id:randomUUID(),version:current.version+1,previous_plan_id:current.id,content:{format:'r07.1',steps:[]},reason:'Synthetic unexecuted successor head for late-receipt fence qualification'};
   successor.content_hash=(await one(db,'select private.r04_hash($1) hash',[successor.content])).hash;
   await db.query('insert into private.r07_plans select (jsonb_populate_record(null::private.r07_plans,$1)).*',[successor]);
   await db.query("update private.r07_heads set plan_id=$1,state='ready',reason='newer_plan_control',revision=revision+1 where goal_id=$2",[successor.id,g]);
  },async(before,after)=>assert.deepEqual(after,before));
  for(const state of ['paused','stopped','completed','blocked','needs_owner','waiting'])await branch('existing '+state,async()=>{
   await db.query('update private.r07_heads set state=$1,reason=$2,revision=revision+1 where goal_id=$3',[state,'explicit_owner_'+state,g]);
  },async(before,after)=>assert.deepEqual(after,before));
  await branch('explicit Stop',async()=>{
   await f.authority.server('stop_test',{testEnvelopeId:f.authority.prepared.testEnvelopeId,testEnvelopeHash:f.authority.prepared.testEnvelopeHash,submissionId:randomUUID()},'');
  },async(before,after)=>{assert.equal(after.state,'stopped');assert.deepEqual(after,before);});
  for(const kind of ['business','quest'])await branch('owner '+kind+' pause',async()=>{
   await ownerInitialRpc(db,owner,'r05_policy_owner',[b,'pause',{kind,id:kind==='business'?b:g},randomUUID()]);
  },async(before,after)=>{assert.equal(after.plan_id,before.plan_id);assert.equal(after.state,'paused');assert.equal(after.reason,'scope_paused');});
  await branch('owner policy revocation',async()=>{
   const p=await one(db,'select p.id,p.content_hash from private.r05_policies p join private.r12_direct_test_envelopes e on e.policy_id=p.id where e.id=$1',[f.authority.prepared.testEnvelopeId]);
   await ownerInitialRpc(db,owner,'r05_policy_owner',[b,'revoke',{policyId:p.id,policyHash:p.content_hash},randomUUID()]);
  },async(before,after)=>{assert.equal(after.plan_id,before.plan_id);assert.equal(after.state,'blocked');assert.equal(after.reason,'policy_revoked');});
  const normal=await receive();assert.equal(normal.state.questComplete,false);assert.equal((await head()).state,'ready');
  assert.equal((await one(db,'select count(*)::int n from private.r12_direct_cycle_closures where scope_id=$1',[f.prepared.scopeId])).n,1);
 }finally{await db.close();}
});
