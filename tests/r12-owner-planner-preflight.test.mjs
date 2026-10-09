import test from 'node:test';
import assert from 'node:assert/strict';
import {discoveryKnowledgeFixture} from './discovery-v2-fixtures.mjs';
import {ownerGoalFixture} from './helpers/r12-owner-goal-fixture.mjs';
import {r12QuoteFixture} from './helpers/r12-provider-fixture.mjs';
import {bindValidatedOwnerResearchIntent} from '../.core-tests/products/discovery-r12-goal-intent.js';
import {pinDiscoveryKnowledgeV2} from '../.core-tests/products/discovery-v2-knowledge.js';
import {buildDiscoveryR12OwnerPlannerRequest,preflightDiscoveryR12OwnerPlanner} from '../.core-tests/products/discovery-r12-planner-preflight.js';
import {routeDiscoveryR12Request,inspectDiscoveryR12Wire} from '../.core-tests/products/discovery-r12-wire.js';

function fixture(now=Date.now()){
  const {scope}=ownerGoalFixture(now);
  scope.intent.objective=('Evaluate original music and nature shirt hypotheses for adult buyers. Keep dated country, population and denominator context; retain literal "quoted" criteria, backslashes \\ and UTF-8 🎵 observations. ').repeat(8).slice(0,1059);
  assert.equal(scope.intent.objective.length,1059);
  const knowledgeSnapshot=discoveryKnowledgeFixture(now).snapshot;
  const input={version:'r12.owner-planner-preflight-input.1',setupId:scope.setupId,setupHash:scope.setupHash,scopeId:scope.id,
    cutoff:scope.expiresAt,intent:scope.intent,knowledgeSnapshot,inputHash:'f'.repeat(64)};
  return {input,quote:r12QuoteFixture(now)};
}

test('prospective owner planner preflight matches the concrete routed UTF-8 request and preserves full scope',async()=>{
  const {input,quote}=fixture();
  const receipt=await preflightDiscoveryR12OwnerPlanner(input,quote);
  assert.equal(receipt.version,'r12.owner-planner-preflight.1');
  assert.equal(receipt.inputHash,input.inputHash);
  assert.ok(receipt.requestBytes<=12288);
  assert.ok(receipt.wireBytes<=12288);
  const knowledge=pinDiscoveryKnowledgeV2(input.knowledgeSnapshot);
  const ownerInitial=bindValidatedOwnerResearchIntent(input.intent,{scopeId:input.scopeId,scopeHash:'0'.repeat(64),approvedQuery:input.intent.comparisonUniverse.selectionQuestion});
  const request=buildDiscoveryR12OwnerPlannerRequest(input.intent,knowledge,ownerInitial,ownerInitial.approvedQuery,0);
  const body=JSON.parse(request.messages[1].content);
  assert.deepEqual(body.intent,input.intent);
  assert.equal(Object.hasOwn(body,'focus'),false);
  assert.equal(body.approvedSearchQuery,input.intent.comparisonUniverse.selectionQuestion);
  assert.match(request.messages[0].content,/queryFocus is advisory and cannot expand it/);
  assert.equal(request.requestMetadata.r12CommittedBeforeAttemptMicrousd,0);
  assert.equal(request.requestMetadata.r12OwnerInitialScopeHash,'0'.repeat(64));
  const routed=routeDiscoveryR12Request(request,'plan',{modelId:quote.luna.modelId,endpoint:quote.luna.endpoint,priceLimit:quote.luna.priceLimit},false,true);
  const inspected=await inspectDiscoveryR12Wire(routed,'plan',false,false,true);
  assert.equal(receipt.requestBytes,Buffer.byteLength(JSON.stringify(routed),'utf8'));
  assert.equal(receipt.wireBytes,inspected.wireBytes);
  const wireBody=JSON.parse(inspected.wire.body);
  assert.deepEqual(JSON.parse(wireBody.messages[1].content).intent,input.intent);
});

test('prospective owner planner preflight rejects an oversized concrete request',async()=>{
  const {input,quote}=fixture();
  const release=input.knowledgeSnapshot.releases.find(r=>r.manifest.knowledge.some(k=>k.key==='product.research'));
  const guideline=release.manifest.knowledge.find(k=>k.key==='product.research').content.guidelines.find(g=>g.id==='hypotheses-not-sales');
  guideline.statement='Synthetic oversized public guidance '.repeat(500);
  await assert.rejects(preflightDiscoveryR12OwnerPlanner(input,quote),/r12_owner_planner_preflight_failed/);
});
