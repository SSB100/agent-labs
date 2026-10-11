import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {confirmedRepairFixture,inertReleaseSuccessor,publishSuccessor,rehash,currentRelease,preservedRows,applyReleaseSuccessor,hash,one,useInertSuccessor,admitSavedReplacementCreate} from './helpers/r12-steel-release-successor-fixture.mjs';
import {publishInertRepairAttestation} from './helpers/r12-steel-setup-recovery-fixture.mjs';
import {admitSteelConfig,steelConfigRequest} from './helpers/r12-steel-config-sql-fixture.mjs';
import {validateEtsySteelReplacementView} from '../.core-tests/accounts/etsy-steel-replacement.js';
const enabled=!!process.env.R12_SQL_TEST_HOST;
test('single successor upgrades historical confirmed debit without rewritten terms or new authority',{skip:!enabled,timeout:240000},async()=>{
 const fetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No provider traffic');};
 const {db,x}=await confirmedRepairFixture({shortProposal:true});
 try{
  assert.equal(x.proposal.originalHeldMaximumMicrounits,'25000');assert.equal(x.proposal.cumulativeDispatchesCeiling,57);assert.equal(x.proposal.maximumTestMicrounits,'10000000');
  const old=await preservedRows(db),oldDefinition=x.predecessor.review.release.databaseDefinitionHash,before=await one(db,'select (select count(*)::int from private.r05_reservations) reservations,(select count(*)::int from private.r05_markers) markers,(select count(*)::int from private.r12_steel_create_config_uses) uses');
  await applyReleaseSuccessor(db);assert.notEqual((await one(db,'select private.r12_direct_enrollment_definition_hash() h')).h,oldDefinition);
  await assert.rejects(currentRelease(db,x),/release_inactive/);
  const review=await inertReleaseSuccessor(db,x);
  // Each changed pin is rehashed, demonstrating semantic checks, not merely a
  // stale content hash. No protected row is directly changed by these tests.
  for(const key of ['businessId','ownerId','goalId','testEnvelopeId','originalOperationId','replacementOperationId','accountId','providerProjectId','proposalId'])await assert.rejects(publishSuccessor(db,rehash(review,{[key]:randomUUID()})),/invalid|lineage/);
  for(const key of ['testEnvelopeHash','originalScopeHash','providerAccountHash','routeHash','proposalHash','debitHash','recoveryHash','reviewedPackageHash','unchangedTermsHash'])await assert.rejects(publishSuccessor(db,rehash(review,{[key]:hash('wrong '+key)})),/invalid|lineage/);
  await assert.rejects(publishSuccessor(db,rehash(review,{predecessorReviewHash:hash('absent')})),/no rows/);
  await assert.rejects(publishSuccessor(db,rehash(review,{expiresAt:new Date(Date.parse(review.expiresAt)+1000).toISOString()})),/invalid/);
  for(const change of [{databaseDefinitionHash:oldDefinition},{commitSha:x.predecessor.review.release.commitSha},{treeSha:x.predecessor.review.release.treeSha},{deploymentReceiptHash:x.predecessor.review.release.deploymentReceiptHash},{qualificationRuns:review.release.qualificationRuns.slice(1)},{qualificationRuns:review.release.qualificationRuns.map(r=>({...r,headSha:'f'.repeat(40)}))},{qualificationRuns:review.release.qualificationRuns.map(r=>({...r,conclusion:'failure'}))}])await assert.rejects(publishSuccessor(db,rehash(review,{release:{...review.release,...change}})),/invalid|review_required|evidence_required/);
  for(const change of [{providerProjectId:randomUUID()},{baseUrl:'https://other.invalid'},{region:'other'},{environment:'preview'},{deploymentId:x.predecessor.deployment.deploymentId}]){const c={...review.configuration,...change};await assert.rejects(publishSuccessor(db,rehash(review,{configuration:c,configurationHash:hash(c)})),/invalid/);}
  for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);try{await assert.rejects(publishSuccessor(db,review),/permission denied/);}finally{await db.exec('reset role');}}
  assert.equal((await one(db,'select count(*)::int n from private.r12_steel_setup_release_successors')).n,0);
  // Current-test validation occurs AFTER inserting inside the same transaction.
  // A stopped test makes publication roll back without leaving a successor.
  await db.exec('begin');try{await db.query('insert into private.r12_direct_grant_review_revocations(grant_id) values($1)',[x.f.grantId]);await assert.rejects(publishSuccessor(db,review),/authority_unavailable|current_test_required/);}finally{await db.exec('rollback');}
  assert.equal((await one(db,'select count(*)::int n from private.r12_steel_setup_release_successors')).n,0);
  // A real short-lived successor expires without silently selecting its predecessor.
  const expiring=await inertReleaseSuccessor(db,x,{expiresAt:new Date(Date.now()+1500).toISOString()});
  await db.exec('begin');try{await publishSuccessor(db,expiring);await new Promise(r=>setTimeout(r,Math.max(0,Date.parse(expiring.expiresAt)-Date.now()+25)));await assert.rejects(currentRelease(db,x),/successor_inactive/);}finally{await db.exec('rollback');}
  await new Promise(r=>setTimeout(r,Math.max(0,Date.parse(x.proposal.expiresAt)-Date.now()+25)));assert.ok(Date.parse(x.proposal.expiresAt)<Date.now());
  const result=await publishSuccessor(db,review);assert.deepEqual(result,{reviewHash:review.reviewHash,authorityCreated:false});assert.deepEqual(await publishSuccessor(db,review),result);
  await assert.rejects(publishSuccessor(db,rehash(review,{securityApprovalHash:hash('different approval')})),/conflict/);
  await assert.rejects(publishSuccessor(db,rehash(review,{predecessorReviewHash:review.reviewHash})),/no rows/);
  const current=await currentRelease(db,x);assert.equal(current.review_hash,review.reviewHash);assert.deepEqual(current.content,review);assert.equal(current.content.reviewHash,hash(Object.fromEntries(Object.entries(current.content).filter(([k])=>k!=='reviewHash'))));
  await db.query('select private.r12_direct_test_current($1)',[review.testEnvelopeId]);
  const view=validateEtsySteelReplacementView(await x.replacement('read',{operationId:review.originalOperationId}),x.f.businessId,review.originalOperationId);
  assert.deepEqual(view.proposal,x.proposal);assert.equal(view.effectiveRelease.effectiveReviewHash,review.reviewHash);assert.equal(view.effectiveRelease.predecessorReviewHash,x.proposal.releaseSuccessorHash);assert.equal(view.effectiveRelease.debitHash,review.debitHash);assert.equal(view.effectiveRelease.releaseCommitSha,review.release.commitSha);
  const{projectionHash,...projection}=view.effectiveRelease;assert.equal(projectionHash,hash(projection));
  assert.deepEqual(await preservedRows(db),old);assert.deepEqual(await one(db,'select (select count(*)::int from private.r05_reservations) reservations,(select count(*)::int from private.r05_markers) markers,(select count(*)::int from private.r12_steel_create_config_uses) uses'),before);
  for(const table of ['r12_steel_setup_release_successors','r12_steel_setup_release_successor_revocations']){const security=await one(db,`select relrowsecurity,has_table_privilege('anon',c.oid,'SELECT') anon,has_table_privilege('authenticated',c.oid,'INSERT') authenticated,has_table_privilege('service_role',c.oid,'INSERT') service from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname=$1`,[table]);assert.deepEqual(security,{relrowsecurity:true,anon:false,authenticated:false,service:false});}
  await assert.rejects(db.query('update private.r12_steel_setup_release_successors set content=content'),/immutable_history/);
  await assert.rejects(db.query('delete from private.r12_steel_setup_release_successors'),/immutable_history/);
  for(const table of ['r12_steel_setup_repair_release_revocations','r12_steel_setup_release_successor_revocations']){await db.exec('begin');try{await db.query(`insert into private.${table}(review_hash) values($1)`,[table.includes('successor')?review.reviewHash:review.predecessorReviewHash]);await assert.rejects(currentRelease(db,x),/inactive/);}finally{await db.exec('rollback');}}
  await assert.rejects(db.query('select private.r12_steel_setup_repair_create_release($1,$2,$3)',[review.testEnvelopeId,review.replacementOperationId,x.oldAttestation.attestation]),/exact_release_required/);
  assert.equal((await one(db,'select private.r12_steel_setup_repair_attestation($1) valid',[x.oldAttestation.attestation])).valid,false);
  useInertSuccessor(x,review);const freshAttestation=await publishInertRepairAttestation(db,x);
  await db.query('select private.r12_steel_setup_repair_create_release($1,$2,$3)',[review.testEnvelopeId,review.replacementOperationId,freshAttestation.attestation]);
  await assert.rejects(db.query('select private.r12_steel_setup_repair_create_release($1,$2,$3)',[review.testEnvelopeId,randomUUID(),freshAttestation.attestation]),/lineage_required/);
  const replacement=await x.bridge.prepare({operationId:review.replacementOperationId,accountId:review.accountId,profileAccessExpiresAt:x.setup.scope.profileAccessExpiresAt,maximumBrowserMicrounits:'25000',verificationMaximumMicrounits:'25000'});
  await assert.rejects(replacement.admit('create'),/inactive|approval|current/);
  await assert.rejects(x.bridge.prepare(replacement.scope),/etsy_handoff_prepare_replay/,'Prepare must not be used to reopen saved scope');
  await admitSavedReplacementCreate(x,replacement.scope);
  await assert.rejects(admitSteelConfig(db,x.f.businessId,steelConfigRequest(replacement.scope,{setup:true,configuration:x.predecessor.configuration}),x.bridge.keys.handoff),/required|inactive|invalid/);
  await admitSteelConfig(db,x.f.businessId,steelConfigRequest(replacement.scope,{setup:true,configuration:x.repair.configuration}),x.bridge.keys.handoff);
  await replacement.transport('browser.etsy.owner_handoff.create','POST','https://api.steel.dev/v1/sessions');
  await assert.rejects(replacement.transport('browser.etsy.owner_handoff.create','POST','https://api.steel.dev/v1/sessions'),/inactive|already|duplicate/);
  await assert.rejects(x.bridge.prepare({maximumBrowserMicrounits:'25000',verificationMaximumMicrounits:'25000'}),/exact_replacement|required|unresolved/);
  const after=await one(db,'select (select count(*)::int from private.r05_reservations) reservations,(select count(*)::int from private.r05_markers) markers,(select count(*)::int from private.r12_steel_create_config_uses) uses');assert.deepEqual(after,{reservations:before.reservations+1,markers:before.markers+1,uses:before.uses+1});
  assert.equal((await one(db,'select private.r12_direct_research_unit_limit($1) n',[review.testEnvelopeId])).n,8);assert.equal((await one(db,'select count(*)::int n from private.r12_steel_setup_repair_debits')).n,1);
  assert.deepEqual(await preservedRows(db),old);assert.equal(network,0);
  console.log('Single successor inert qualification',JSON.stringify({historicalDefinitionChanged:true,expiredConfirmedProposal:true,originalRowsUnchanged:true,originalHeldMicrounits:'25000',combinedCapMicrounits:'10000000',cumulativeDispatchesCeiling:57,oneDebit:true,researchUnits:8,noExtraReservationOrDispatchOnPublication:true,freshAccessRequired:true,freshConfigurationRequired:true,noCascade:true,noFallback:true,networkCalls:network}));
 }finally{globalThis.fetch=fetch;await db.close();}
});
