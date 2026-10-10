/** Use the real proof-bound source runtime after the actual planner completes. */
import assert from 'node:assert/strict';
import {proofBoundResearchRuntimeComposition} from './r12-proof-bound-research-runtime-fixture.mjs';
export async function directSonnetSource(f){
 const runtime=proofBoundResearchRuntimeComposition(f.authority.db,f,{policyVersion:f.policy.version});
 const result=await runtime.step();assert.equal(result.reason,'source_recorded',JSON.stringify({result,errors:runtime.sqlErrors,source:runtime.sourceResults}));
 assert.equal(runtime.browserPosts.length,1);assert.equal(runtime.sourceResults[0].run.receipt.status,'completed');
 const state=(await f.read()).state,cycle=f.policy.version==='r12.direct-etsy-attempt-policy.2'?state.logicalCycles[0]:state.attempts[0];
 assert.ok(cycle.sourceProof);return{runtime,sourceProof:cycle.sourceProof,attemptId:runtime.browserPosts[0].attemptId};
}
