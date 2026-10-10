/** Local runs use PGlite and inert providers. Native qualification is required
 * separately in CI; no package here is a production release/security approval. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {enrollmentDatabase,enrollmentOriginFixture,enrollmentOwnerRuntime,confirmEnrolledTestEnvelope,ENROLLMENT_INFERENCE_CONTRACT,ENROLLMENT_ROOT} from './helpers/r12-direct-enrollment-sql-fixture.mjs';
import {buildDirectEnrollmentReviewPackage,projectDirectEnrollmentReceipt} from './helpers/r12-direct-enrollment-review-package.mjs';
import {one,sha,ownerInitialRuntimeRpc} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {r12QuoteFixture} from './helpers/r12-provider-fixture.mjs';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2-hash.js';
const enabled=!!process.env.R12_SQL_TEST_HOST||process.env.R12_REQUIRE_POSTGRES==='1';
const externalEvidence=()=>({release:{commitSha:'1'.repeat(40),treeSha:'2'.repeat(40),qualificationRuns:['ci.yml','direct-etsy-qualification.yml','etsy-browser-boundary.yml'].map((workflow,n)=>({workflow,runId:String(900+n),headSha:'1'.repeat(40),conclusion:'success',artifactHash:hash({inert:true,workflow})})),deploymentReceiptHash:hash('inert-deployment-evidence')},provider:{projectReadbackHash:hash('inert-project-readback'),retentionReviewHash:hash('inert-retention')},security:{approvalHash:hash('inert-security-approval'),scope:'r12.direct-steel-insights.1',recordHash:hash('inert-security-record')},model:{inferenceContract:ENROLLMENT_INFERENCE_CONTRACT,routeReviewHash:hash('inert-model-route'),schemaReviewHash:hash('inert-model-schema'),dataUseReviewHash:hash('inert-model-data-use')}});
async function counts(db,b){return one(db,`select
 (select count(*)::int from private.r12_owner_bootstrap_grants where business_id=$1) grants,
 (select count(*)::int from private.r12_owner_grant_root_revisions v join private.r12_owner_grant_roots r on r.id=v.root_id where r.business_id=$1) revisions,
 (select count(*)::int from private.r12_direct_enrollment_proposals where business_id=$1) proposals,
 (select count(*)::int from private.r12_direct_test_confirmations c join private.r12_direct_test_envelopes e on e.id=c.envelope_id where e.business_id=$1) tests,
 (select count(*)::int from private.r05_markers where business_id=$1) markers,
 (select count(*)::int from private.r05_reservations where business_id=$1) reservations`,[b]);}
async function packet(db,x){return buildDirectEnrollmentReviewPackage(db,{businessId:x.f.businessId,goalId:x.f.goalId,rootId:x.f.rootId,ownerId:x.f.ownerId,originProfileId:x.f.profileId,grantId:x.grantId,profileId:x.profileId,serverKeyHash:x.serverKeyHash,grantReview:x.grantReview,registry:x.registry,reviewedAt:x.reviewedAt,validFrom:x.validFrom,expiresAt:x.expiresAt,externalEvidence:externalEvidence()});}

test('reviewed publication then actual owner enrollment preserves exhausted root and creates only one direct grant',{skip:!enabled,timeout:240000},async()=>{
 const db=await enrollmentDatabase(),savedFetch=globalThis.fetch,oldEnv={VERCEL_ENV:process.env.VERCEL_ENV,R05_ADMISSION_SERVER_KEY:process.env.R05_ADMISSION_SERVER_KEY};let network=0;
 globalThis.fetch=async()=>{network++;throw Error('External transport forbidden');};Object.assign(process.env,{VERCEL_ENV:'production',R05_ADMISSION_SERVER_KEY:ENROLLMENT_ROOT});
 try{
 assert.deepEqual((await db.query(`select p.proname,role from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join unnest(array['anon','authenticated','service_role']) role
 where n.nspname='private' and (p.proname like 'r12_direct_enrollment_%' or p.proname='r12_direct_publish_enrollment_review') and has_function_privilege(role,p.oid,'EXECUTE')`)).rows,[]);
 assert.deepEqual((await db.query(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='r' and c.relname like 'r12_direct_enrollment_%' and not c.relrowsecurity`)).rows,[]);
 for(const name of ['r12_owner_direct_enrollment_read(uuid,uuid,uuid)','r12_owner_direct_enrollment_server(uuid,text,jsonb,text)'])assert.deepEqual(await one(db,"select has_function_privilege('authenticated',$1,'EXECUTE') owner,has_function_privilege('anon',$1,'EXECUTE') anonymous,has_function_privilege('service_role',$1,'EXECUTE') service",['public.'+name]),{owner:true,anonymous:false,service:false});
 await enrollmentOriginFixture(db,{onReady:async x=>{
  const f=x.f,b=f.businessId,g=f.goalId,ui=enrollmentOwnerRuntime(f),empty=await ui.server.readDirectEnrollmentCatalog(ui.context,b,g);
  assert.equal(empty.eligible,false);assert.equal(empty.reason,'reviewed_package_required');
  const before=await counts(db,b),usedBefore=(await one(db,'select private.r12_direct_grant_usage($1) x',[f.rootId])).x;
  assert.deepEqual(usedBefore,{scopes:1,allocationMicrounits:'406736'});
  const historical=await one(db,`select (select to_jsonb(r) from private.r12_owner_grant_roots r where id=$1) root,
  (select to_jsonb(g) from private.r12_owner_bootstrap_grants g where id=$2) grant_row,
  (select to_jsonb(p) from private.r12_owner_profiles p where id=$3) profile`,[f.rootId,f.grantId,f.profileId]);
  const built=await packet(db,x),pkg=built.package,evidence=built.reviewEvidence;
  await db.exec('set role authenticated');try{await assert.rejects(db.query('select private.r12_direct_publish_enrollment_review($1,$2)',[pkg,evidence]),/permission denied/);}finally{await db.exec('reset role');}
  await assert.rejects(f.rpc('r12_owner_direct_enrollment_server',[b,'prepare',pkg,x.bootstrapKey]),/r04_invalid_payload|keys|fields|version|unknown/);
  const malformed=structuredClone(pkg);malformed.serverKeyHash='a'.repeat(63);
  await assert.rejects(db.query('select private.r12_direct_publish_enrollment_review($1,$2)',[malformed,evidence]),/package_required/);
  const unreviewed=structuredClone(evidence);unreviewed.release.databaseDefinitionHash='f'.repeat(64);
  await assert.rejects(db.query('select private.r12_direct_publish_enrollment_review($1,$2)',[{...pkg,reviewEvidenceHash:hash(unreviewed)},unreviewed]),/independent_review_required/);
  const wrongModel=structuredClone(evidence);wrongModel.model.inferenceContract.reviewer.modelId='anthropic/claude-haiku-4.5';
  await assert.rejects(db.query('select private.r12_direct_publish_enrollment_review($1,$2)',[{...pkg,reviewEvidenceHash:hash(wrongModel)},wrongModel]),/inference_contract_required/);
  const oldWorker=structuredClone(pkg);oldWorker.grantReview.researchPins.workers.review=x.f.pins.workers.review;
  await assert.rejects(db.query('select private.r12_direct_publish_enrollment_review($1,$2)',[oldWorker,evidence]),/worker_release_required/);
  const changedObjective=structuredClone(pkg);changedObjective.grantReview.profileTemplate.publicGoal+=' A different model-facing objective.';
  await assert.rejects(db.query('select private.r12_direct_publish_enrollment_review($1,$2)',[changedObjective,evidence]),/original_selection_required/);
  assert.deepEqual(await counts(db,b),before);
  const published=(await one(db,'select private.r12_direct_publish_enrollment_review($1,$2) x',[pkg,evidence])).x;
  assert.equal(published.reviewedPackageHash,hash(pkg));assert.equal(published.authorityCreated,false);
  assert.deepEqual((await one(db,'select private.r12_direct_publish_enrollment_review($1,$2) x',[pkg,evidence])).x,published);
  assert.deepEqual(await counts(db,b),before,'Publication creates reviewed facts and profile, not a grant, policy, reservation or marker');
  const catalog=await ui.server.readDirectEnrollmentCatalog(ui.context,b,g);assert.equal(catalog.eligible,true);assert.equal(catalog.offers.length,1);
  // Every supported registration is an ancestor of the offer. Revocation is
  // tested through its actual append-only path, never by changing saved hashes.
  for(const [table,column,id] of [
   ['r12_direct_browser_route_revocations','route_hash',x.routeHash],
   ['r12_direct_owner_renderer_revocations','route_hash',x.routeHash],
   ['r12_direct_source_qualification_revocations','qualification_hash',x.registry.sourceQualification.qualification_hash],
   ['r12_verification_candidate_revocations','review_hash',x.registry.verificationCandidate.review_hash],
   ['r12_proof_bound_source_revocations','review_hash',x.registry.researchRenderer.review_hash],
  ]){
   await db.exec('begin');try{
    await db.query(`insert into private.${table}(${column}) values($1)`,[id]);
    await assert.rejects(db.query('select private.r12_direct_enrollment_ancestor($1)',[published.reviewedPackageHash]),/r12_(?:enrollment_review_inactive|landing_review_inactive|research_renderer_review_inactive|direct_source_qualification_required)/);
   }finally{await db.exec('rollback');}
  }
  for(const [sql,args,expected] of [
   ["update public.worker_definitions set status='retired' where id=$1",[x.grantReview.researchPins.workers.review.id],/r12_enrollment_(?:installed|worker|model)_release_required/],
   ["update public.installed_packs set status='superseded' where id=$1",[x.grantReview.researchPins.installationId],/r12_direct_catalog_unqualified/],
  ]){
   await db.exec('begin');try{await db.query(sql,args);await assert.rejects(db.query('select private.r12_direct_enrollment_ancestor($1)',[published.reviewedPackageHash]),expected);}finally{await db.exec('rollback');}
  }
  const prepared=await ui.server.prepareDirectEnrollment(ui.context,b,g,published.reviewedPackageHash);
  assert.equal(prepared.confirmed,false);assert.deepEqual(prepared,projectDirectEnrollmentReceipt(built,{proposalId:prepared.proposalId,createdAt:prepared.createdAt}));
  assert.deepEqual(prepared.preview.currentGrantRoot,{...pkg.expectedState.currentGrantRoot});
  assert.equal(prepared.preview.proposedGrantRoot.maximumScopes,2);assert.equal(prepared.preview.proposedGrantRoot.maximumAllocationMicrounits,'10406736');
  // A revoked unconfirmed proposal remains readable while a genuinely new
  // reviewed package can still be selected. No historical receipt is hidden.
  await db.exec('begin');try{
   await db.query('insert into private.r12_direct_enrollment_revocations(package_hash,reason) values($1,$2)',[published.reviewedPackageHash,'Inert superseded review']);
   const replacementGrant=randomUUID(),replacementProfile=randomUUID();
   const replacementKey=createHmac('sha256',ENROLLMENT_ROOT).update(JSON.stringify({version:'r12.owner-bootstrap.1',businessId:b,ownerId:f.ownerId,grantId:replacementGrant})).digest('base64url');
   const replacement=await packet(db,{...x,grantId:replacementGrant,profileId:replacementProfile,serverKeyHash:sha(replacementKey),reviewedAt:new Date(Date.now()).toISOString()});
   const fresh=(await one(db,'select private.r12_direct_publish_enrollment_review($1,$2) x',[replacement.package,replacement.reviewEvidence])).x;
   const mixed=await ui.server.readDirectEnrollmentCatalog(ui.context,b,g);assert.equal(mixed.current.proposalId,prepared.proposalId);assert.equal(mixed.eligible,true);assert.deepEqual(mixed.offers.map(o=>o.reviewedPackageHash),[fresh.reviewedPackageHash]);
   const newer=await ui.server.prepareDirectEnrollment(ui.context,b,g,fresh.reviewedPackageHash);assert.notEqual(newer.proposalId,prepared.proposalId);
   const historicalRead=await ui.server.readDirectEnrollmentCatalog(ui.context,b,g,prepared.proposalId);assert.equal(historicalRead.eligible,false);assert.deepEqual(historicalRead.current,prepared);
  }finally{await db.exec('rollback');}
  const input={version:'r12.owner-direct-enrollment-confirmation.1',proposalId:prepared.proposalId,proposalHash:prepared.proposalHash,submissionId:randomUUID()};
  await assert.rejects(f.rpc('r12_owner_direct_enrollment_server',[b,'confirm',input,'wrong-inert-key']),/server_binding_required/);
  const confirmed=await ui.server.confirmDirectEnrollment(ui.context,b,g,prepared.proposalId,prepared.proposalHash);
  assert.equal(confirmed.confirmed,true);assert.equal(confirmed.proposalHash,prepared.proposalHash);
  assert.deepEqual(await ui.server.confirmDirectEnrollment(ui.context,b,g,prepared.proposalId,prepared.proposalHash),confirmed);
  assert.deepEqual(await f.rpc('r12_owner_direct_enrollment_server',[b,'confirm',input,x.bootstrapKey]),confirmed);
  const after=await counts(db,b);assert.deepEqual(after,{...before,grants:before.grants+1,revisions:before.revisions+1,proposals:before.proposals+1});
  assert.deepEqual((await one(db,'select private.r12_direct_grant_usage($1) x',[f.rootId])).x,usedBefore,'Enrollment does not consume or refund a test allocation');
  assert.deepEqual(await one(db,`select (select to_jsonb(r) from private.r12_owner_grant_roots r where id=$1) root,(select to_jsonb(g) from private.r12_owner_bootstrap_grants g where id=$2) grant_row,(select to_jsonb(p) from private.r12_owner_profiles p where id=$3) profile`,[f.rootId,f.grantId,f.profileId]),historical);
  const newGrant=await one(db,'select * from private.r12_owner_bootstrap_grants where id=$1',[x.grantId]);assert.equal(newGrant.root_id,f.rootId);assert.equal(newGrant.profile_id,x.profileId);assert.equal(newGrant.adaptive_bounds,null);assert.equal(newGrant.continuation_bounds,null);
  const oldCatalog=await f.read();assert.ok(oldCatalog.profiles.every(p=>p.grantId!==x.grantId));
  await assert.rejects(db.query('select private.r12_owner_profile_check(p,clock_timestamp()) from private.r12_owner_profiles p where id=$1',[x.profileId]),/profile/);
  const closed=await ui.server.readDirectEnrollmentCatalog(ui.context,b,g);assert.equal(closed.reason,'already_enrolled');assert.deepEqual(closed.offers,[]);
  await assert.rejects(ownerInitialRuntimeRpc(db,'r12_owner_direct_enrollment_read',[b,g,null]),/permission denied/);
  const envelope=await confirmEnrolledTestEnvelope(db,x);
  assert.equal(envelope.confirmed.preview.grantId,x.grantId);assert.equal(envelope.confirmed.preview.maximumMicrounits,'10000000');
  assert.deepEqual((await one(db,'select private.r12_direct_grant_usage($1) x',[f.rootId])).x,{scopes:2,allocationMicrounits:'10406736'});
  const afterTest=await counts(db,b);assert.deepEqual(afterTest,{...after,tests:after.tests+1},'Separate spending confirmation consumes exactly one allocation and creates no provider reservation or marker');
  await db.query('insert into private.r12_direct_enrollment_revocations(package_hash,reason) values($1,$2)',[published.reviewedPackageHash,'Inert trusted-operator revocation test']);
  await assert.rejects(f.rpc('r12_owner_direct_server',[b,'initial_quote_context',{grantId:x.grantId},x.bootstrapKey]),/enrollment_review_inactive/);
  await assert.rejects(db.query('select private.r12_direct_test_current($1)',[envelope.confirmed.testEnvelopeId]),/enrollment_review_inactive/);
  assert.deepEqual((await ui.server.readDirectEnrollmentCatalog(ui.context,b,g,prepared.proposalId)).current,confirmed,'Historical receipt survives review revocation');
  assert.deepEqual(await counts(db,b),afterTest);
 }});
 // Genuine explicit owner-initial authority may exceed the old root. Preserve
 // that valid history, and expose a review limitation instead of catch-up caps.
 await enrollmentOriginFixture(db,{onReady:async x=>{
  const f=x.f,content={...structuredClone(f.content),title:'A separately reviewed gardening research goal',originalIntent:'Investigate original gardening apparel evidence.',objective:'Investigate original gardening apparel evidence.'};
  const goal=await f.rpc('r04_quest_transition',[f.businessId,'quest.save',{goalId:null,expectedRevision:0,content},randomUUID()]);
  await f.rpc('r04_quest_transition',[f.businessId,'quest.preference',{goalId:goal.id,expectedRevision:1,preference:'ready'},randomUUID()]);
  const grant=randomUUID(),key='inert-explicit-cumulative-initial-'+grant;
  await db.query(`insert into private.r12_owner_bootstrap_grants(id,root_id,business_id,owner_id,profile_id,maximum_scopes,maximum_allocation_microunits,server_key_hash,approval_hash,valid_from,valid_until,business_revision,business_hash) values($1,$2,$3,$4,$5,2,813472,$6,$7,$8,$9,$10,$11)`,[grant,f.rootId,f.businessId,f.ownerId,f.profileId,sha(key),hash({inertExplicitReview:grant}),f.profile.validFrom,f.profile.validUntil,f.businessRevision,f.businessHash]);
  const prepared=await f.server('prepare',{input:{...f.input,goalId:goal.id,grantId:grant,topicKey:'gardening',submissionId:randomUUID()},quote:r12QuoteFixture()},key);
  const activated=await f.server('confirm',f.confirmPayload(prepared),key);assert.equal(activated.activated,true);
  const rootBefore=await one(db,'select to_jsonb(r) x from private.r12_owner_grant_roots r where id=$1',[f.rootId]);
  assert.equal(rootBefore.x.maximum_scopes,1);
  const usage=(await one(db,'select private.r12_direct_grant_usage($1) x',[f.rootId])).x;assert.deepEqual(usage,{scopes:2,allocationMicrounits:'813472'});
  const built=await packet(db,x);await db.query('select private.r12_direct_publish_enrollment_review($1,$2)',[built.package,built.reviewEvidence]);
  const ui=enrollmentOwnerRuntime(f),view=await ui.server.readDirectEnrollmentCatalog(ui.context,f.businessId,f.goalId);
  assert.equal(view.eligible,false);assert.equal(view.reason,'reviewed_package_required');assert.deepEqual(view.offers,[]);
  await assert.rejects(f.rpc('r12_owner_direct_enrollment_server',[f.businessId,'prepare',{version:'r12.owner-direct-enrollment-input.1',goalId:f.goalId,reviewedPackageHash:hash(built.package),submissionId:randomUUID()},x.bootstrapKey]),/cumulative_review_required/);
  assert.deepEqual((await one(db,'select private.r12_direct_grant_usage($1) x',[f.rootId])).x,usage);
  assert.deepEqual(await one(db,'select to_jsonb(r) x from private.r12_owner_grant_roots r where id=$1',[f.rootId]),rootBefore);
 }});assert.equal(network,0);
 }catch(error){error.message+=' '+JSON.stringify({where:error.where,position:error.position,internalQuery:error.internalQuery});throw error;}
 finally{globalThis.fetch=savedFetch;for(const[k,v]of Object.entries(oldEnv)){if(v===undefined)delete process.env[k];else process.env[k]=v;}await db.close();}
});
