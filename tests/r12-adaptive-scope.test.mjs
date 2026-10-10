import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAdaptiveResearchPreview, adaptiveResearchRemainingCapacity } from '../.core-tests/products/discovery-r12-adaptive-scope.js';

import { fixture, id, now } from './helpers/r12-adaptive-fixture.mjs';
test('adaptive preview keeps genuine cumulative capacity and separate overlapping ledgers',()=>{
  for(const native of [false,true]) {
    const p=fixture(native);
    assert.deepEqual(validateAdaptiveResearchPreview(p,now),p);
    assert.deepEqual(adaptiveResearchRemainingCapacity(p.predecessor),{children:13,dispatches:47,maximumPaidCalls:47});
    assert.equal(p.authorityCreated,false);
  }
});
test('five new slots permit ten four-call followups while every attempt consumes dispatch capacity',()=>{
  const p=fixture();p.maximumPaidCalls=45;
  assert.doesNotThrow(()=>validateAdaptiveResearchPreview(p,now));
  p.maximumPaidCalls=48;
  assert.throws(()=>validateAdaptiveResearchPreview(p,now),/adaptive_preview_unverified/);
  p.maximumPaidCalls=45;p.maximumNewChildren=0;
  assert.throws(()=>validateAdaptiveResearchPreview(p,now));
});
test('preview rejects widened run cost, unknown liabilities, stale expiry and missing completion receipts',()=>{
  for(const mutate of [p=>p.maximumRunMicrounits='10000001',p=>p.maximumActions=11,p=>p.funding.pendingMicrounits='1',p=>p.business.hasUnknown=true,p=>p.funding.hasUnknown=true,p=>p.expiresAt='2026-10-10T02:59:59Z',p=>p.imports.pop(),p=>p.imports[4].receiptProofHash='',p=>p.imports[1].attemptId=p.imports[0].attemptId,p=>p.authorityCreated=true,p=>p.quoteHash='',p=>p.imports.reverse()]) {
    const p=fixture();mutate(p);assert.throws(()=>validateAdaptiveResearchPreview(p,now));
  }
});
test('closure and original native or legacy root cannot be replaced by a new identity',()=>{
  for(const mutate of [p=>p.goalId=id(99),p=>p.predecessor.baseChildren=0,p=>p.predecessor.historyHash='0'.repeat(64),p=>p.funding.authorityRootId=id(99),p=>p.predecessor.predecessorPlanHash='0'.repeat(64)]) {
    const p=fixture();mutate(p);assert.throws(()=>validateAdaptiveResearchPreview(p,now));
  }
});
test('both exact lifetime ceilings must cover the run without adding overlapping exposure twice',()=>{
  for(const ledger of ['funding','business']) {
    const p=fixture();p[ledger].proposedLimitMicrounits=String(BigInt(p[ledger].committedMicrounits)+9999999n);
    assert.throws(()=>validateAdaptiveResearchPreview(p,now));
  }
  assert.doesNotThrow(()=>validateAdaptiveResearchPreview(fixture(),now));
});
test('native funding is the same Business ledger and cannot invent a separate allowance',()=>{
  for(const field of ['revision','committedMicrounits','currentLimitMicrounits','proposedLimitMicrounits']) {
    const p=fixture(true);p.funding[field]=typeof p.funding[field]==='number'?19:String(BigInt(p.funding[field])+1n);
    assert.throws(()=>validateAdaptiveResearchPreview(p,now));
  }
});
