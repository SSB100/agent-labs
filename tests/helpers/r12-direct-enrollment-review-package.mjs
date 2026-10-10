/** Builds publication arguments for migrated-SQL tests only. It never publishes,
 * writes registry rows, creates grants, derives credentials, or qualifies remote
 * facts. The caller supplies explicitly inert external review evidence. */
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url);
const {discoveryV2Hash:hash}=require(resolve(process.env.R12_ENROLLMENT_CORE_DIR??'.core-tests','products/discovery-v2-hash.js'));
const fail=message=>{throw Error('inert_enrollment_package_'+message);};
const same=(a,b)=>hash(a)===hash(b);
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&same(Object.keys(x).sort(),keys.split(',').sort());
const isHash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(x);
const date=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
const one=async(db,sql,params)=>{if(!/^select\s/i.test(sql))fail('read_only');const result=await db.query(sql,params);if(result.rows?.length!==1)fail('lookup_required');return result.rows[0];};
export const DIRECT_ENROLLMENT_PACKAGE_KEYS='version,businessId,goalId,ownerId,grantId,serverKeyHash,rootId,profileId,originProfileId,originProfileHash,expectedState,grantReview,registry,validFrom,expiresAt,reviewEvidenceHash';
export const DIRECT_ENROLLMENT_REGISTRY_KEYS={
 browserRoute:'route_hash,tariff_hash,qualification_hash,credential_binding_hash,provider_project_id,provider_account_hash,maximum_session_ms,maximum_session_microunits,settlement_contract_hash,content,content_hash,valid_from,valid_until',
 ownerRenderer:'route_hash,provider_project_id,policy,policy_hash,review_hash,valid_from,valid_until',
 sourceQualification:'qualification_hash,worker_definition_id,worker_hash,workflow_definition_id,workflow_hash,provider_project_id,route_hash,source_policy_hash,capture_policy_hash,purpose,content,valid_from,valid_until',
 verificationCandidate:'review_hash,route_hash,provider_project_id,policy_hash,content,valid_from,valid_until',
 researchRenderer:'review_hash,qualification_hash,candidate_review_hash,route_hash,provider_project_id,policy_hash,content,valid_from,valid_until',
};

export async function buildDirectEnrollmentReviewPackage(db,input){
 const {businessId,goalId,rootId,ownerId,originProfileId,grantId,profileId,serverKeyHash,reviewedAt,validFrom,expiresAt}=input;
 if(![businessId,goalId,rootId,ownerId,originProfileId,grantId,profileId].every(uuid)||!isHash(serverKeyHash)||![reviewedAt,validFrom,expiresAt].every(date)||Date.parse(expiresAt)<=Date.parse(reviewedAt)||Date.parse(validFrom)>Date.parse(reviewedAt))fail('identity_required');
 const registry=structuredClone(input.registry),grantReview=structuredClone(input.grantReview),external=structuredClone(input.externalEvidence);
 if(!exact(registry,Object.keys(DIRECT_ENROLLMENT_REGISTRY_KEYS).join(',')))fail('registry_required');
 for(const[k,keys]of Object.entries(DIRECT_ENROLLMENT_REGISTRY_KEYS))if(!exact(registry[k],keys))fail('registry_projection_required');
 if(!exact(external,'release,provider,security,model')||!exact(external.release,'commitSha,treeSha,qualificationRuns,deploymentReceiptHash')||!exact(external.provider,'projectReadbackHash,retentionReviewHash')||!exact(external.security,'approvalHash,scope,recordHash')||!exact(external.model,'routeReviewHash,schemaReviewHash,dataUseReviewHash,inferenceContract'))fail('external_review_required');
 const expectedInference={version:'r12.direct-inference-contract.1',publicQuoteVersion:'r12.public-research-quote.3',inferenceQuoteVersion:'r12.direct-inference-quote.1',catalogVersion:'r12.direct-inference-catalog.1',luna:{modelId:'openai/gpt-5.6-luna',canonicalModelId:'openai/gpt-5.6-luna-20260709',endpoint:'azure/us',providerName:'Azure'},reviewer:{modelId:'anthropic/claude-sonnet-4.6',canonicalModelId:'anthropic/claude-4.6-sonnet-20260217',endpoint:'amazon-bedrock/us',providerName:'Amazon Bedrock'}};
 if(!same(external.model.inferenceContract,expectedInference))fail('inference_contract_required');
 const rp=grantReview.researchPins,r=registry.browserRoute;
 if(!rp||!uuid(rp.packId)||!uuid(rp.installationId)||!uuid(rp.workflowDefinitionId)||rp.executionReviewHash!==registry.sourceQualification.qualification_hash||r.content.version!=='r12.steel-browser-route.1')fail('review_pins_required');
 const read=await one(db,`select
 private.r12_direct_enrollment_state($1::uuid,$2::uuid,$3::uuid) as state,
 private.r12_direct_enrollment_definition_hash() as definition_hash,
 (select jsonb_build_object('id',p.id,'status',p.status,'manifestHash',private.stage14_hash(p.manifest),'qualificationHash',private.stage14_hash(p.qualification_evidence)) from public.packs p where p.id=$4::uuid) as pack,
 (select jsonb_build_object('id',i.id,'businessId',i.business_id,'rootPackId',i.root_pack_id,'status',i.status,'snapshotHash',private.r04_hash(i.snapshot),'canonicalSnapshotHash',private.stage14_hash(i.snapshot)) from public.installed_packs i where i.id=$5::uuid) as installation,
 (select profile_hash from private.r12_owner_profiles where id=$6::uuid) as origin_profile_hash,
 exists(select 1 from public.businesses where id=$1::uuid and owner_user_id=$7::uuid) as owner_matches,
 exists(select 1 from private.r12_owner_bootstrap_grants where id=$8::uuid) as grant_exists,
 exists(select 1 from private.r12_owner_profiles where id=$9::uuid) as profile_exists`,[businessId,goalId,rootId,rp.packId,rp.installationId,originProfileId,ownerId,grantId,profileId]);
 if(read.owner_matches!==true||read.grant_exists!==false||read.profile_exists!==false||!isHash(read.origin_profile_hash)||!isHash(read.definition_hash))fail('current_identity_required');
 if(read.pack?.id!==rp.packId||read.pack.status!=='qualified'||!isHash(read.pack.manifestHash)||!isHash(read.pack.qualificationHash)||read.installation?.id!==rp.installationId||read.installation.status!=='active'||read.installation.businessId!==businessId||read.installation.rootPackId!==rp.packId||read.installation.snapshotHash!==rp.snapshotHash||hash(rp.snapshot)!==read.installation.canonicalSnapshotHash)fail('registered_release_required');
 if(read.state?.currentGrantRoot?.rootId!==rootId||!isHash(read.state.goalHash))fail('current_state_required');
 // Fresh grant/profile identities do not reset or rebuild the source state.
 Object.assign(grantReview,{version:'r12.direct-grant-review.1',grantId,goalId,goalRevision:read.state.goalRevision,goalHash:read.state.goalHash,providerProjectId:r.provider_project_id,routeHash:r.route_hash,expiresAt});
 grantReview.profileTemplate={...grantReview.profileTemplate,id:profileId};
 const reviewEvidence={version:'r12.direct-enrollment-operator-review.1',reviewedAt,expiresAt,
  release:{repository:'SSB100/agent-labs',...external.release,databaseDefinitionHash:read.definition_hash},
  provider:{provider:'steel',providerProjectId:r.provider_project_id,providerAccountHash:r.provider_account_hash,credentialBindingHash:r.credential_binding_hash,...external.provider,tariffEvidenceHash:r.tariff_hash,settlementContractHash:r.settlement_contract_hash},
  security:external.security,pack:{packId:rp.packId,manifestHash:read.pack.manifestHash,qualificationHash:read.pack.qualificationHash},model:{inferenceCatalogHash:rp.inferenceCatalogHash,...external.model}};
 const pkg={version:'r12.direct-enrollment-package.1',businessId,goalId,ownerId,grantId,serverKeyHash,rootId,profileId,originProfileId,originProfileHash:read.origin_profile_hash,expectedState:structuredClone(read.state),grantReview,registry,validFrom,expiresAt,reviewEvidenceHash:hash(reviewEvidence)};
 if(!exact(pkg,DIRECT_ENROLLMENT_PACKAGE_KEYS))fail('shape');
 return{package:pkg,reviewEvidence};
}

/** Pure mirror of the SQL owner projection for DTO parity tests. Not publication
 * or authorization; SQL tests separately exercise the real private publisher. */
export function projectDirectEnrollmentReceipt({package:p,reviewEvidence},{proposalId,createdAt,confirmed=false,rootExpiresAt=p.expiresAt}){
 const rt=p.expectedState.currentGrantRoot,maximum=p.grantReview.maximumTestMicrounits;
 if(BigInt(rt.allocationUsedMicrounits)>BigInt(rt.maximumAllocationMicrounits)||rt.scopesUsed>rt.maximumScopes)fail('separate_cumulative_review_required');
 const preview={version:'r12.owner-direct-enrollment-proposal.1',businessId:p.businessId,goalId:p.goalId,ownerId:p.ownerId,reviewedPackageHash:hash(p),grantId:p.grantId,profileId:p.profileId,authorityRootId:p.expectedState.authorityRootId,bindingId:p.expectedState.bindingId,originHash:p.expectedState.originHash,businessRevision:p.expectedState.businessRevision,businessHash:p.expectedState.businessHash,goalRevision:p.expectedState.goalRevision,goalHash:p.expectedState.goalHash,currentGrantRoot:structuredClone(rt),
 proposedGrantRoot:{revision:rt.revision+1,previousHash:rt.revisionHash,maximumScopes:rt.maximumScopes+1,maximumAllocationMicrounits:(BigInt(rt.maximumAllocationMicrounits)+BigInt(maximum)).toString(),expiresAt:new Date(Math.max(Date.parse(rootExpiresAt),Date.parse(p.expiresAt))).toISOString()},
 testBounds:{currency:'USD',maximumTestMicrounits:maximum,maximumUnitsInWindow:p.grantReview.maximumAttemptsInWindow,cumulativeDispatchesCeiling:p.grantReview.cumulativeDispatchesCeiling},
 qualification:{releaseHash:hash(reviewEvidence.release),routeHash:p.grantReview.routeHash,tariffHash:p.registry.browserRoute.tariff_hash,sourceQualificationHash:p.registry.sourceQualification.qualification_hash,ownerRendererReviewHash:p.registry.ownerRenderer.review_hash,verificationCandidateReviewHash:p.registry.verificationCandidate.review_hash,researchRendererReviewHash:p.registry.researchRenderer.review_hash,landingControlsHash:p.registry.verificationCandidate.content.landingControlsHash,reviewExpiresAt:p.expiresAt},expiresAt:p.expiresAt,authorityCreated:false};
 return{version:'r12.owner-direct-enrollment-receipt.1',businessId:p.businessId,goalId:p.goalId,proposalId,proposalHash:hash(preview),confirmed,createdAt,expiresAt:p.expiresAt,preview};
}
