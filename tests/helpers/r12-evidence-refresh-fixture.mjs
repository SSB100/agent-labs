/** Sanitized synthetic re-captures only. No live page, proof or approval is loaded. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {discoveryV2Hash as hash} from '../../.core-tests/products/discovery-v2.js';
import {discoveryAddendumReferences} from '../../.core-tests/products/discovery-r12-evidence-addendum.js';
const digest=value=>createHash('sha256').update(value,'utf8').digest('hex');
export function refreshR12ObservationsFixture(oldScope,profile,reviewedAt){
 const old=oldScope.amendment.profile.observations;
 const independentReviewHash=hash({scopeId:profile.id,kind:'Explicitly synthetic independent recapture review'});
 profile.observations={...profile.observations,independentReviewHash,observations:old.observations.map((item,index)=>({
  ...structuredClone(item),id:'evi-'+digest(`inert refreshed observation ${profile.id} ${index}`).slice(0,24),
  retrievedAt:new Date(Date.parse(reviewedAt)-500).toISOString(),expiresAt:profile.expiresAt,
  captureHash:index===0?item.captureHash:digest(`inert recaptured bytes ${profile.id} ${index}`),
  context:item.context+' Synthetic renewed provenance preserves this exact cited fact and establishes no measured demand or execution authority.',
  contentHash:digest(item.context+' Synthetic renewed provenance preserves this exact cited fact and establishes no measured demand or execution authority.'),
  limitations:[...item.limitations,'The synthetic renewed capture preserves the quoted fact; unchanged bytes do not establish a new commercial conclusion.'],
  access:item.access==='public_search_index'?'public_document_read':item.access,
  sourceReviewHash:digest(`inert renewed factual review ${profile.id} ${index}`),
 }))};
 assert.notEqual(profile.observations.id,old.id);
 for(const [index,observation]of profile.observations.observations.entries())assert.ok(Date.parse(observation.retrievedAt)>Date.parse(old.observations[index].retrievedAt));
 profile.pinnedLearningPlan.evidenceRefs=discoveryAddendumReferences(profile.observations);
 return independentReviewHash;
}
export function r12EvidenceRefreshCertificateFixture(oldScope,envelope,ownerId){
 const old=oldScope.amendment.profile,newer=envelope.profile;
 const certificate={version:'r12.focused-pilot-evidence-refresh.1',businessId:envelope.businessId,ownerId,scopeId:envelope.id,goalId:envelope.goalId,budgetAuthorityRootId:envelope.budgetAuthorityRootId,
  abandonedScopeId:oldScope.id,abandonedScopeHash:oldScope.amendment_hash,
  priorObservationsHash:hash(old.observations.observations),refreshedObservationsHash:hash(newer.observations.observations),
  priorAddendumHash:hash(old.observations),refreshedAddendumHash:hash(newer.observations),
  priorEvidenceRefsHash:hash(old.pinnedLearningPlan.evidenceRefs),refreshedEvidenceRefsHash:hash(newer.pinnedLearningPlan.evidenceRefs),
  ownerApprovalEvidenceHash:envelope.approvalHash,independentReviewHash:envelope.independentReviewHash,reviewedAt:envelope.createdAt,pairs:[]};
 certificate.pairs=old.observations.observations.map((prior,index)=>{
  const observation=newer.observations.observations[index];
  const pair={priorObservationId:prior.id,refreshedObservationId:observation.id,priorObservationHash:hash(prior),refreshedObservationHash:hash(observation),factSpanHash:digest(Array.from(prior.context).slice(prior.start,prior.end).join('')),pairReviewHash:''};
  pair.pairReviewHash=hash({version:'r12.focused-pilot-evidence-pair-review.1',scopeId:certificate.scopeId,priorObservationHash:pair.priorObservationHash,refreshedObservationHash:pair.refreshedObservationHash,factSpanHash:pair.factSpanHash,independentReviewHash:certificate.independentReviewHash,reviewedAt:certificate.reviewedAt});return pair;
 });
 return certificate;
}
export async function assertR12EvidenceRefreshStageNegatives({oldScope,stageInput,rejected,count}){
 const original=await count(),guards=[];
 const rebind=input=>{const e=input.envelope,a=input.recoveryAuthorization;e.profileHash=hash(e.profile);a.scopeHash=hash(e);a.profileHash=e.profileHash;input.proposal.scopeHash=hash(e);input.proposal.interpretationHash=hash(a);};
 const badCases=[
  ['no_certificate',x=>{delete x.recoveryAuthorization.evidenceRefresh;},false],
  ['time_fields_without_new_review',x=>{x.envelope.profile.observations.observations.forEach((v,i)=>{v.captureHash=oldScope.amendment.profile.observations.observations[i].captureHash;v.sourceReviewHash=oldScope.amendment.profile.observations.observations[i].sourceReviewHash;});},true],
  ['stale_recapture',x=>{const v=x.envelope.profile.observations.observations[0];v.retrievedAt=new Date(Date.now()-86400001).toISOString();v.expiresAt=new Date(Date.now()-1).toISOString();},true],
  ['changed_source_identity',x=>{x.envelope.profile.observations.observations[0].sourceId='src-'+digest('different source').slice(0,24);},true],
  ['changed_source_url',x=>{x.envelope.profile.observations.observations[0].url+='?substitution=1';},true],
  ['changed_source_kind',x=>{x.envelope.profile.observations.observations[0].kind='official_operating_fact';},true],
  ['changed_market',x=>{x.envelope.profile.observations.observations[0].countries=['US'];},true],
  ['changed_geography_role',x=>{x.envelope.profile.observations.observations[0].geographyRole='seller_jurisdiction';},true],
  ['changed_dimensions',x=>{x.envelope.profile.observations.observations[0].dimensions=['demand'];},true],
  ['access_downgrade',x=>{x.envelope.profile.observations.observations.at(-1).access='public_search_index';},true],
  ['changed_cited_span',x=>{const o=x.envelope.profile.observations.observations[0];o.context='Z'+o.context.slice(1);o.contentHash=digest(o.context);},true],
  ['changed_span_offsets',x=>{x.envelope.profile.observations.observations[0].start=1;},true],
  ['wrong_independent_review',x=>{x.recoveryAuthorization.evidenceRefresh.independentReviewHash='0'.repeat(64);},false],
  ['wrong_pair_review',x=>{x.recoveryAuthorization.evidenceRefresh.pairs[0].pairReviewHash='0'.repeat(64);},false],
  ['wrong_owner_approval',x=>{x.recoveryAuthorization.evidenceRefresh.ownerApprovalEvidenceHash='0'.repeat(64);},false],
  ['wrong_abandoned_proof',x=>{x.recoveryAuthorization.evidenceRefresh.abandonedScopeHash='0'.repeat(64);},false],
  ['future_review',x=>{x.recoveryAuthorization.evidenceRefresh.reviewedAt=new Date(Date.now()+60000).toISOString();},false],
  ...[['changed_learning_ref_order',refs=>refs.reverse()],['changed_learning_ref_count',refs=>refs.pop()],['changed_learning_ref_identity',refs=>{refs[0].sourceId='src-'+digest('substituted ref').slice(0,24);}]].map(([name,edit])=>[name,x=>{edit(x.envelope.profile.pinnedLearningPlan.evidenceRefs);x.recoveryAuthorization.evidenceRefresh=r12EvidenceRefreshCertificateFixture(oldScope,x.envelope,x.recoveryAuthorization.ownerId);},false]),
 ];
 for(const [name,mutate,rebuild]of badCases){
  const input=structuredClone(stageInput);mutate(input);
  if(rebuild){input.envelope.profile.pinnedLearningPlan.evidenceRefs=discoveryAddendumReferences(input.envelope.profile.observations);input.recoveryAuthorization.evidenceRefresh=r12EvidenceRefreshCertificateFixture(oldScope,input.envelope,input.recoveryAuthorization.ownerId);}
  rebind(input);await rejected(input);assert.deepEqual(await count(),original,`${name} must not consume a recovery slot or create authority`);guards.push(name);
 }
 return guards;
}
