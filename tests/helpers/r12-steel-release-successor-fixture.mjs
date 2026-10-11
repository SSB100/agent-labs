/** Synthetic operator evidence only, exercising real immutable SQL publishers. */
import {createHmac,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {setupRecoveryDatabase,setupRecoveryFixture,publishInertRepairRelease,publishInertRepairAttestation,applyReleaseSuccessor} from './r12-steel-setup-recovery-fixture.mjs';
import {INERT_STEEL_CONFIG} from './r12-steel-config-sql-fixture.mjs';
import {one} from './r12-owner-initial-sql-fixture.mjs';
import {discoveryV2Hash as hash} from '../../.core-tests/products/discovery-v2-hash.js';
export {hash,one,applyReleaseSuccessor};
export async function confirmedRepairFixture({successorBeforeHistory=false,shortProposal=false}={}){
 const db=await setupRecoveryDatabase();
 try{
  if(successorBeforeHistory)await applyReleaseSuccessor(db);
  // A naturally expiring proposal from the actual owner endpoint. This only
  // shortens the inert proposal's review window before any package is published.
  if(shortProposal){const {definition}=await one(db,"select pg_get_functiondef('public.r12_owner_steel_replacement(uuid,text,jsonb)'::regprocedure) definition");await db.exec(definition.replace("clock_timestamp()+interval '5 minutes'","clock_timestamp()+interval '2 seconds'"));}
  const x=await setupRecoveryFixture(db,{configureEnrollment:a=>{a.registry.browserRoute.maximum_session_microunits=25000;a.grantReview.setupOperation.maximumMicrounits='25000';a.grantReview.verificationOperation.maximumMicrounits='25000';a.grantReview.cumulativeDispatchesCeiling=57;},setupScope:a=>({profileAccessExpiresAt:a.prepared.expiresAt,maximumBrowserMicrounits:'25000',verificationMaximumMicrounits:'25000'})});
  await x.stop();const recovery=await x.recovery('record',{...x.pins,usage:x.usage});
  await publishInertRepairRelease(db,x);const oldAttestation=await publishInertRepairAttestation(db,x);
  const {proposal}=await x.replacement('prepare',{operationId:x.setup.scope.operationId,recoveryHash:recovery.recoveryHash,submissionId:randomUUID()});
  await x.replacement('confirm',{proposalId:proposal.proposalId,proposalHash:proposal.proposalHash,submissionId:randomUUID()});
  x.predecessor=x.repair;x.proposal=proposal;x.oldAttestation=oldAttestation;
  return{db,x};
 }catch(error){await db.close();throw error;}
}
export async function inertReleaseSuccessor(db,x,{expiresAt=null}={}){
 const {debit,definition,envelope,scope,package:pkg}=await one(db,`select to_jsonb(d) debit,private.r12_direct_enrollment_definition_hash() definition,to_jsonb(e) envelope,s.scope,to_jsonb(p) package from private.r12_steel_setup_repair_debits d join private.r12_direct_test_envelopes e on e.id=d.envelope_id join private.r12_etsy_steel_setups s on s.operation_id=d.original_operation_id join private.r12_steel_setup_repair_releases r on r.envelope_id=e.id join private.r12_direct_enrollment_packages p on p.package_hash=r.package_hash where e.id=$1`,[x.authority.prepared.testEnvelopeId]);
 const old=x.predecessor.review,deployment={environment:'production',deploymentId:'dpl_inert_exact_single_successor',releaseCommitSha:'4'.repeat(40)},configuration={...old.configuration,...deployment};
 const release={...old.release,commitSha:deployment.releaseCommitSha,treeSha:'5'.repeat(40),databaseDefinitionHash:definition,deploymentReceiptHash:hash('inert-single-successor-deployment'),qualificationRuns:old.release.qualificationRuns.map((r,i)=>({...r,runId:String(1900+i),headSha:deployment.releaseCommitSha,artifactHash:hash({inertSingleSuccessor:r.workflow})}))};
 const body={version:'r12.steel-setup-release-successor.1',businessId:x.f.businessId,ownerId:x.f.ownerId,goalId:x.f.goalId,testEnvelopeId:envelope.id,testEnvelopeHash:envelope.content_hash,originalOperationId:scope.operationId,originalScopeHash:hash(scope),replacementOperationId:debit.replacement_operation_id,accountId:scope.accountId,providerProjectId:scope.providerProjectId,providerAccountHash:pkg.content.registry.browserRoute.provider_account_hash,routeHash:x.authority.routeHash,predecessorReviewHash:old.reviewHash,proposalId:debit.proposal_id,proposalHash:debit.content.proposalHash,debitHash:debit.debit_hash,recoveryHash:debit.content.recoveryHash,reviewedPackageHash:old.reviewedPackageHash,unchangedTermsHash:old.unchangedTermsHash,configuration,configurationHash:hash(configuration),release,securityApprovalHash:hash('inert-successor-security-approval'),releaseTransferApprovalHash:hash('inert-exact-release-transfer'),reviewedAt:new Date().toISOString(),expiresAt:expiresAt??new Date(Math.min(Date.parse(old.expiresAt),Date.parse(scope.profileAccessExpiresAt))).toISOString()};
 return {...body,reviewHash:hash(body)};
}
export function useInertSuccessor(x,review){const configuration=review.configuration,configurationHash=hash(configuration),credentialBindingHash=createHmac('sha256',INERT_STEEL_CONFIG.apiKey).update('r12.steel-credential-binding.1\n'+configurationHash).digest('hex');x.repair={review,deployment:{environment:configuration.environment,deploymentId:configuration.deploymentId,releaseCommitSha:configuration.releaseCommitSha},configuration:{configuration,configurationHash,credentialBindingHash}};}
export const publishSuccessor=(db,body)=>one(db,'select private.r12_steel_publish_release_successor($1) result',[body]).then(r=>r.result);
export const rehash=(body,change)=>{const result={...body,...change};delete result.reviewHash;return{...result,reviewHash:hash(result)};};
export const currentRelease=(db,x)=>one(db,'select to_jsonb(private.r12_steel_setup_repair_release_current($1)) result',[x.authority.prepared.testEnvelopeId]).then(r=>r.result);
export async function preservedRows(db){const tables=['r12_steel_setup_repair_releases','r12_steel_setup_repair_debits','r12_steel_setup_replacement_proposals','r12_steel_setup_recoveries','r12_direct_test_envelopes','r12_direct_enrollment_packages','r12_direct_browser_accounting'];const rows={};for(const table of tables)rows[table]=(await db.query(`select to_jsonb(t) row from private.${table} t order by to_jsonb(t)::text`)).rows;return rows;}

/** Continue the already-saved scope through owner read/approval and normal
 * admission. SQL prepare is deliberately NOT a replayable read operation. */
export async function admitSavedReplacementCreate(x,expectedScope){
 const view=await x.bridge.owner('read',{operationId:expectedScope.operationId});
 assert.deepEqual(view.scope,expectedScope);assert.equal(view.scopeHash,hash(expectedScope));
 await x.approve(view);
 const request={version:'etsy.steel-owner-handoff-admission.1',operation:'create',requestId:randomUUID(),scopeHash:view.scopeHash,
  ...Object.fromEntries(['operationId','ownerId','businessId','authorityRootId','testEnvelopeId','testEnvelopeHash','providerProjectId','accountId','accountRevision','approvalId','approvalRevision','disclosureHash','quoteHash','maximumBrowserMicrounits'].map(k=>[k,view.scope[k]])),
  handoffId:null,sessionId:null,profileId:null,reservationId:null,reservationHash:null};
 const admission=await x.bridge.server('admit',{request});return{view,admission};
}
