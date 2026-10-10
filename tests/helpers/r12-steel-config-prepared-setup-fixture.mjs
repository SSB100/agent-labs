/** Genuine owner-approved, financially reserved setup immediately before paid
 * transport. Useful to qualify lock order without a fake scope/permit row. */
import {enrollmentOriginFixture,enrollReviewedDirectGrant,confirmEnrolledTestEnvelope,ENROLLMENT_ROOT} from './r12-direct-enrollment-sql-fixture.mjs';
import {bindDirectHandoffFixture} from './r12-direct-approved-setup-fixture.mjs';
import {candidateOwnerServer} from './r12-candidate-owner-server-fixture.mjs';
import {configureInertEnrollmentSteel,publishInertSteelAttestation,steelConfigRequest,admitSteelConfig,INERT_STEEL_DEPLOYMENT} from './r12-steel-config-sql-fixture.mjs';
import {deriveDirectServerKey} from '../../.core-tests/products/discovery-r12-public-server-key.js';
import {discoveryV2Hash as hash} from '../../.core-tests/products/discovery-v2-hash.js';

export async function prepareSteelConfigSetup(db,{admitConfig=true}={}){
 Object.assign(process.env,{R05_ADMISSION_SERVER_KEY:ENROLLMENT_ROOT,VERCEL_ENV:'production',VERCEL_DEPLOYMENT_ID:INERT_STEEL_DEPLOYMENT.deploymentId,VERCEL_GIT_COMMIT_SHA:INERT_STEEL_DEPLOYMENT.releaseCommitSha});
 return enrollmentOriginFixture(db,{onReady:async original=>{
  configureInertEnrollmentSteel(original);
  const enrolled=await enrollReviewedDirectGrant(db,original),test=await confirmEnrolledTestEnvelope(db,enrolled),f={...enrolled.f,grantId:enrolled.grantId,bootstrapKey:enrolled.bootstrapKey};
  const authority={db,f,project:enrolled.project,routeHash:enrolled.routeHash,tariffHash:enrolled.registry.browserRoute.tariff_hash,qualificationHash:enrolled.registry.browserRoute.qualification_hash,
   prepared:test.prepared,quote:test.context.setupQuote,confirm:async()=>test.confirmed,
   server:(operation,payload,key=enrolled.bootstrapKey)=>f.rpc('r12_owner_direct_server',[f.businessId,operation,payload,key]),
   key:purpose=>deriveDirectServerKey(enrolled.bootstrapKey,{businessId:f.businessId,goalId:f.goalId,testEnvelopeId:test.prepared.testEnvelopeId,envelopeHash:test.prepared.testEnvelopeHash,routeHash:enrolled.routeHash,purpose})};
  const bridge=await bindDirectHandoffFixture(db,authority),setup=await bridge.prepare(),owner=candidateOwnerServer(db,setup.scope),review=await owner.read();
  await owner.approve({operationId:setup.scope.operationId,scopeHash:hash(setup.scope),disclosureHash:setup.scope.disclosureHash,expectedApprovalRevision:setup.scope.approvalRevision,persistentAccessApproved:true,budgetApproved:true,rendererReviewHash:review.reviewHash});
  const reserved=await setup.admit('create'),published=await publishInertSteelAttestation(db,authority.routeHash),request=steelConfigRequest(setup.scope,{setup:true});
  const permit=admitConfig?await admitSteelConfig(db,f.businessId,request,bridge.keys.handoff):null;
  const createRequest={provider:'steel',operation:'browser.etsy.owner_handoff.create',method:'POST',endpoint:'https://api.steel.dev/v1/sessions'};
  return{authority,enrolled,bridge,setup,reserved,request,permit,attestation:published.attestation,businessId:f.businessId,operationId:setup.scope.operationId,createRequest};
 }});
}
