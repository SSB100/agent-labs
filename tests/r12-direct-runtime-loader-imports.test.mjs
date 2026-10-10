/** Import-graph regression only. No provider/SQL call or authority qualification. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {directRuntimeComposition} from './helpers/r12-direct-runtime-composition-fixture.mjs';
import {proofBoundResearchRuntimeComposition} from './helpers/r12-proof-bound-research-runtime-fixture.mjs';
for(const [name,compose]of [['historical direct',directRuntimeComposition],['proof-bound research',proofBoundResearchRuntimeComposition]])test(`${name} fixture loads every actual current runtime dependency before SQL work`,()=>{
 const fixture={policy:{version:'r12.direct-etsy-attempt-policy.1'},authority:{f:{},prepared:{}},prepared:{},profile:{}};
 const h=compose(null,fixture);assert.equal(typeof h.step,'function');assert.match(h.sourceHash,/^[a-f0-9]{64}$/);assert.deepEqual(h.calls,[]);assert.deepEqual(h.modelPosts,[]);assert.deepEqual(h.browserPosts,[]);
 assert.deepEqual(h.boundarySubstitutions,['historical_pre_21300_configuration_admission_leaf']);
});
