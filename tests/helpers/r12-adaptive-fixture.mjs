import { discoveryV2Hash } from '../../.core-tests/products/discovery-v2.js';
export const id = n => `12080000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const now = Date.parse('2026-10-10T03:00:00Z');
// Inert contract examples. SQL must independently reconstruct all these pins.
export function fixture(native = false) {
  const predecessor = { version:'r12.owner-episode-closure.1', businessId:id(1), goalId:id(2),
    predecessorPlanId:id(3), predecessorPlanHash:'a'.repeat(64), predecessorPlanVersion:7,
    predecessorScopeId:id(4), predecessorScopeHash:'b'.repeat(64), goalRevision:14, goalHash:'c'.repeat(64),
    businessRevision:17, businessHash:'d'.repeat(64), authorityRootId:native?id(1):id(5),
    priorRoundId:native?null:id(6), originalSemanticGoalHash:native?null:'e'.repeat(64),
    headRevision:207, headState:'completed', headReason:'all_required_outputs_verified',
    baseChildren:19, baseDispatches:17, baseRepairs:0, basePivots:0, baseKnownMicrounits:'129774', historyHash:'f'.repeat(64) };
  return { version:'r12.adaptive-research-preview.1', businessId:id(1), goalId:id(2), predecessor,
    predecessorHash:discoveryV2Hash(predecessor), imports:['plan','search1','select1','strategy','review'].map((phase,i)=>({phase,attemptId:id(20+i),artifactId:id(30+i),responseHash:'1'.repeat(64),receiptProofHash:'2'.repeat(64)})),
    ownerObservationRef:null, profileId:id(7), profileHash:'3'.repeat(64), quoteHash:'4'.repeat(64), expiresAt:'2026-10-10T09:00:00Z',
    maximumActions:10, maximumPaidCalls:47, maximumNewChildren:5, maximumRunMicrounits:'10000000',
    funding:{authorityRootId:predecessor.authorityRootId,bindingHash:'5'.repeat(64),revision:native?18:0,committedMicrounits:native?'803107':'265736',pendingMicrounits:'0',currentLimitMicrounits:native?'1176054':'2000000',proposedLimitMicrounits:native?'10803107':'10265736',hasUnknown:false},
    business:{capRevision:18,committedMicrounits:'803107',currentLimitMicrounits:'1176054',proposedLimitMicrounits:'10803107',hasUnknown:false},authorityCreated:false };
}

export function planFixture(preview=fixture()) {
  const scope={id:id(40),hash:'6'.repeat(64)},c=preview.predecessor;
  const keys=['plan','search1','select1','strategy','review'];
  const plan={format:'r12.discovery-adaptive.1',discoveryScopeId:scope.id,discoveryScopeHash:scope.hash,businessId:preview.businessId,goalId:preview.goalId,
    goalRevision:c.goalRevision,goalHash:c.goalHash,businessRevision:c.businessRevision,businessHash:c.businessHash,policyId:id(41),policyHash:'7'.repeat(64),authorityRootId:preview.businessId,
    plannerWorkerDefinitionId:id(60),currency:'USD',maximumMicrounits:String(BigInt(c.baseKnownMicrounits)+BigInt(preview.maximumRunMicrounits)),deadline:preview.expiresAt,expiresAt:preview.expiresAt,
    maximumRepairs:c.baseRepairs+preview.maximumActions,maximumPivots:c.basePivots+preview.maximumActions,maximumChildren:c.baseChildren+5,maximumDispatches:c.baseDispatches+preview.maximumPaidCalls,
    requiredChecks:['review'],finishCondition:'all_required_outputs_verified',stopConditions:['no_permitted_work','deadline','repair_exhausted','owner_stopped'],
    steps:keys.map((key,index)=>({key,kind:key==='search1'?'research':key==='review'?'review':'work',objective:'Perform this phase for the exact approved research question',reason:'Independently bound adaptive research action',
      adapter:`r12.discovery.${scope.id}.${key}`,qualificationHash:'8'.repeat(64),installationId:id(70),packSnapshotHash:'9'.repeat(64),workflowDefinitionId:id(71),workerDefinitionId:id(key==='review'?61:60),
      role:key,operationKey:`research.r12.${scope.id}.${key}`,purpose:'Original POD T-shirt research within the saved Goal',dependsOn:keys.slice(0,index),expectedArtifactType:`r12.discovery.${key}`,
      maximumMicrounits:preview.maximumRunMicrounits,expiresAt:preview.expiresAt,notBefore:'2026-10-10T02:59:00Z',measurement:null,maximumRepairs:0}))};
  return {preview,scope,plan};
}
