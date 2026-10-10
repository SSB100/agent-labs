import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';
import {directControllerDatabase} from './helpers/r12-direct-controller-database.mjs';
import {directControllerFixture} from './helpers/r12-direct-controller-fixture.mjs';
import {directModelDispatch,directModelExpectation} from './helpers/r12-direct-controller-model-fixture.mjs';
import {directRepairFailedReceipt} from './helpers/r12-direct-controller-repair-model-fixture.mjs';
import {r12PhaseOutputFixture} from './helpers/r12-phase-output-fixture.mjs';
import {one} from './helpers/r12-owner-initial-sql-fixture.mjs';
import * as model from '../.core-tests/products/discovery-r12-public-model.js';
import {validatePublicResearchState} from '../.core-tests/products/discovery-r12-public-cycle.js';
test('already persisted .1 state/input/wire/candidate/original archive stay byte-equivalent across the repair migration',{skip:!process.env.R12_SQL_TEST_HOST&&!process.env.R12_REQUIRE_POSTGRES&&!process.env.R12_POSTGRES_URL,timeout:180000},async()=>{const db=await directControllerDatabase();try{
 const f=await directControllerFixture(db);f.authority.db=db;const a=await f.schedule('plan'),d=await directModelDispatch(f,a),output=r12PhaseOutputFixture(f.profile.audience).plan;output.queryFocus=[];const receipt=directRepairFailedReceipt(f,a,d,output);await f.rpc('candidate',{attemptId:a.attemptId,candidate:receipt.candidate});
 const capture=async()=>({view:await f.read(),attempt:await f.rpc('attempt',{attemptId:a.attemptId}),persisted:await one(db,`select
 (select to_jsonb(x) from private.r12_direct_phase_input_snapshots x where attempt_id=$1) input,
 (select to_jsonb(x) from private.r12_direct_phase_wires x where attempt_id=$1) wire,
 (select to_jsonb(x) from private.r12_direct_model_candidates x where attempt_id=$1) candidate,
 (select to_jsonb(x) from private.r07_attempts x where id=$1) r07_attempt,
 (select private.stage14_hash(private.r12_direct_origin_snapshot(s.business_id,s.goal_id,(z.packet->'predecessor'->'closure'->>'predecessorPlanVersion')::integer)) from private.r12_direct_research_setups s join private.r12_direct_test_envelopes e on e.id=s.envelope_id join private.r12_direct_origin_freezes z on z.predecessor_plan_id=(e.content->'origin'->'predecessor'->'closure'->>'predecessorPlanId')::uuid where s.scope_id=$2) origin_hash`,[a.attemptId,f.prepared.scopeId])});
 const before=await capture();validatePublicResearchState(before.view.state,f.policy);const ctx=model.readPublicResearchModelInputs(before.attempt.inputs,directModelExpectation(before.attempt.inputs)),wireBefore=await model.inspectPublicResearchModelWire(ctx),expected=model.projectPublicResearchModelPhase(ctx,receipt.candidate,d.dispatch.binding,receipt.proof);
 for(const name of readdirSync('supabase/migrations').filter(x=>x.endsWith('.sql')&&x.slice(0,14)>'20261010120600'&&x.slice(0,14)<='20261010120700').sort())await db.exec(readFileSync('supabase/migrations/'+name,'utf8'));
 const after=await capture();assert.deepEqual(after,before);validatePublicResearchState(after.view.state,f.policy);const afterCtx=model.readPublicResearchModelInputs(after.attempt.inputs,directModelExpectation(after.attempt.inputs)),wireAfter=await model.inspectPublicResearchModelWire(afterCtx);assert.deepEqual(wireAfter,wireBefore);
 const done=await f.rpc('model_receipt',{attemptId:a.attemptId,...receipt});assert.equal(done.accepted,true);assert.deepEqual(done.result,expected);assert.equal(done.state.version,'r12.direct-etsy-attempt-state.1');validatePublicResearchState(done.state,f.policy);const settled=(await capture()).persisted;for(const key of ['input','wire','candidate','origin_hash'])assert.deepEqual(settled[key],before.persisted[key]);assert.equal(settled.r07_attempt.input_hash,before.persisted.r07_attempt.input_hash);assert.deepEqual(settled.r07_attempt.dependency_pins,before.persisted.r07_attempt.dependency_pins);assert.equal((await f.rpc('model_receipt',{attemptId:a.attemptId,...receipt})).replayed,true);
 }finally{await db.close();}});
