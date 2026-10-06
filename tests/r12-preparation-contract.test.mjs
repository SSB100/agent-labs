import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ownerGoalCreateBody} from '../scripts/r12-research-bootstrap.mjs';
import {r12PreparationGoalContent,r12PreparationHref,validateR12Preparation,validateR12PreparationIdentity} from '../.core-tests/products/discovery-r12-preparation-contract.js';
const now=Date.parse('2026-10-06T10:00:00Z'),cutoff='2026-10-06T12:00:00.000Z';
const input=()=>({businessId:randomUUID(),priorRoundId:randomUUID(),preparationId:randomUUID(),sourceCutoff:cutoff});
test('R12 visible preparation preserves the reviewed exact Goal payload',()=>{
 assert.deepEqual(r12PreparationGoalContent(cutoff),ownerGoalCreateBody(cutoff,randomUUID()).p_payload.content);
 const changed=r12PreparationGoalContent(cutoff);changed.parsed.stopConstraints.length=0;assert.ok(r12PreparationGoalContent(cutoff).parsed.stopConstraints.length);
});
test('R12 setup URL preserves canonical nonsecret identities and exact cutoff',()=>{
 const value=input();validateR12Preparation(value,now);const url=new URL(r12PreparationHref(value),'https://fixture.invalid');
 assert.equal(url.searchParams.get('preparation'),value.preparationId);assert.equal(url.searchParams.get('sourceCutoff'),cutoff);
 for(const key of ['businessId','priorRoundId','preparationId']){const bad={...value,[key]:'ABCDEF00-0000-4000-8000-000000000001'};assert.throws(()=>validateR12Preparation(bad,now));}
 for(const sourceCutoff of ['bad','2026-10-06T12:00:00Z','2026-10-06T12:00:00.001Z','2026-10-06T10:30:00.000Z','2026-10-07T10:00:01.000Z'])assert.throws(()=>validateR12Preparation({...value,sourceCutoff},now));
 validateR12PreparationIdentity({...value,sourceCutoff:'2026-10-01T00:00:00.000Z'});
 assert.throws(()=>validateR12Preparation({...value,unreviewed:'extra'},now));
});
