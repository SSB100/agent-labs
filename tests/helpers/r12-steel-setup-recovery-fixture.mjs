/** Inert provider leaves, genuine owner enrollment/test/access/config admission.
 * No handoff or disposal proof is fabricated for the failed login. */
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {asRole,orderedRace,validateOwnerInitialRaceEnvironment} from './r12-owner-initial-postgres-races.mjs';
import {steelConfigResearchRuntimeComposition} from './r12-steel-config-source-fixture.mjs';
import {landingSqlVerification} from './r12-landing-verification-sql-fixture.mjs';
import {randomUUID,createHmac} from 'node:crypto';
import {steelConfigDatabase,configureInertEnrollmentSteel,publishInertSteelAttestation,inertSteelAttestation,steelConfigRequest,admitSteelConfig,INERT_STEEL_CONFIG,INERT_STEEL_DEPLOYMENT} from './r12-steel-config-sql-fixture.mjs';
import {enrollmentOriginFixture,enrollReviewedDirectGrant,ENROLLMENT_ROOT} from './r12-direct-enrollment-sql-fixture.mjs';
import {bindDirectHandoffFixture} from './r12-direct-approved-setup-fixture.mjs';
import {ownerInitialRpc,ownerInitialRuntimeRpc,one} from './r12-owner-initial-sql-fixture.mjs';
import {deriveDirectServerKey} from '../../.core-tests/products/discovery-r12-public-server-key.js';
import {discoveryV2Hash as hash} from '../../.core-tests/products/discovery-v2-hash.js';
export const RECOVERY_MIGRATION='20261011024924_r12_steel_setup_recovery.sql';
export async function setupRecoveryDatabase({apply=true}={}){const db=await steelConfigDatabase();try{for(const name of ['20261010121400_r12_steel_existing_session_readback.sql','20261010215020_r12_legacy_terminal_origin.sql','20261010230616_r12_steel_readback_authorization.sql',...(apply?[RECOVERY_MIGRATION]:[])])await db.exec(readFileSync('supabase/migrations/'+name,'utf8'));return db;}catch(e){await db.close();throw e;}}
export async function setupRecoveryFixture(db,{quoteValidForMs=null,setupScope={},configureEnrollment=null,beforeInitialFunding=null}={}){
 Object.assign(process.env,{R05_ADMISSION_SERVER_KEY:ENROLLMENT_ROOT,VERCEL_ENV:'production',VERCEL_DEPLOYMENT_ID:INERT_STEEL_DEPLOYMENT.deploymentId,VERCEL_GIT_COMMIT_SHA:INERT_STEEL_DEPLOYMENT.releaseCommitSha});
 return enrollmentOriginFixture(db,{beforeInitialFunding,onReady:async original=>{
  configureInertEnrollmentSteel(original);if(configureEnrollment)configureEnrollment(original);const enrolled=await enrollReviewedDirectGrant(db,original),f={...enrolled.f,grantId:enrolled.grantId,bootstrapKey:enrolled.bootstrapKey};
  const server=(operation,payload)=>f.rpc('r12_owner_direct_server',[f.businessId,operation,payload,enrolled.bootstrapKey]);
  const context=await server('initial_quote_context',{grantId:enrolled.grantId});
  if(quoteValidForMs!==null){
   for(const name of ['setupQuote','verificationQuote']){const {browserQuoteHash,...body}=context[name];void browserQuoteHash;body.validUntil=new Date(Date.now()+quoteValidForMs).toISOString();context[name]={...body,browserQuoteHash:hash(body)};}
  }
  const origin=(await one(db,'select private.r12_direct_origin_build($1,$2) x',[f.businessId,f.goalId])).x;
  const funding=(await one(db,'select private.r12_direct_funding_snapshot($1) x',[f.businessId])).x,amount=10000000n;
  const cap=k=>({currentRevision:funding[k].revision,currentLimitMicrounits:funding[k].currentLimitMicrounits,proposedLimitMicrounits:String(BigInt(funding[k].currentLimitMicrounits)>BigInt(funding[k].conservativeExposureMicrounits)+amount?BigInt(funding[k].currentLimitMicrounits):BigInt(funding[k].conservativeExposureMicrounits)+amount)});
  const input={version:'r12.owner-direct-test-input.1',businessId:f.businessId,goalId:f.goalId,grantId:enrolled.grantId,predecessorScopeId:origin.predecessor.closure.predecessorScopeId,predecessorScopeHash:origin.predecessor.closure.predecessorScopeHash,maximumAttemptsInWindow:9,maximumRunMicrounits:String(amount),capProposal:{version:'r12.public-cap-proposal.1',business:cap('business'),root:cap('root')},submissionId:randomUUID()};
  if(funding.bindingKind==='r05_business')input.capProposal.root.proposedLimitMicrounits=input.capProposal.business.proposedLimitMicrounits;
  const prepared=await server('prepare_test',{input,setupQuote:context.setupQuote,verificationQuote:context.verificationQuote});
  const confirmed=await server('confirm_test',{testEnvelopeId:prepared.testEnvelopeId,testEnvelopeHash:prepared.testEnvelopeHash,submissionId:randomUUID()});
  const authority={db,f,project:enrolled.project,routeHash:enrolled.routeHash,tariffHash:enrolled.registry.browserRoute.tariff_hash,qualificationHash:enrolled.registry.browserRoute.qualification_hash,prepared,quote:context.setupQuote,confirm:async()=>confirmed,server,key:purpose=>deriveDirectServerKey(enrolled.bootstrapKey,{businessId:f.businessId,goalId:f.goalId,testEnvelopeId:prepared.testEnvelopeId,envelopeHash:prepared.testEnvelopeHash,routeHash:enrolled.routeHash,purpose})};
  const bridge=await bindDirectHandoffFixture(db,authority),setup=await bridge.prepare(typeof setupScope==='function'?setupScope(authority):setupScope);
  const approve=async s=>{const review=await ownerInitialRpc(db,f.ownerId,'r12_owner_etsy_steel_renderer_review',[f.businessId,s.scope.operationId]);return bridge.owner('approve',{operationId:s.scope.operationId,scopeHash:hash(s.scope),disclosureHash:s.scope.disclosureHash,expectedApprovalRevision:s.scope.approvalRevision,persistentAccessApproved:true,budgetApproved:true,rendererReviewHash:review.reviewHash});};
  await approve(setup);const reserved=await setup.admit('create');await publishInertSteelAttestation(db,authority.routeHash);
  await admitSteelConfig(db,f.businessId,steelConfigRequest(setup.scope,{setup:true}),bridge.keys.handoff);
  await setup.transport('browser.etsy.owner_handoff.create','POST','https://api.steel.dev/v1/sessions');
  const body={version:'etsy.steel-owner-handoff-receipt.1',operationId:setup.scope.operationId,scopeHash:hash(setup.scope),handoffId:null,status:'failed',reason:'handoff_expired',releaseState:'unconfirmed',liabilityState:'unknown',reservationId:reserved.reservationId,reservationHash:reserved.reservationHash,profileBindingId:null,profileBindingRevision:null,accountIdentityVerified:false,insightsAccessVerified:false};
  const receipt={...body,receiptHash:hash(body)};await bridge.server('receipt',{receipt});
  const pins={operationId:setup.scope.operationId,failedReceiptHash:receipt.receiptHash};
  const recovery=(operation,payload=pins,key=bridge.keys.evidence)=>ownerInitialRuntimeRpc(db,'r12_etsy_steel_recovery_server',[f.businessId,operation,payload,key]);
  const replacement=(operation,payload,actor=f.ownerId)=>ownerInitialRpc(db,actor,'r12_owner_steel_replacement',[f.businessId,operation,payload]);
  const usage={version:'etsy.steel-terminal-usage.1',sessionId:setup.scope.operationId,providerProjectId:enrolled.project,providerStatus:'released',providerTimeoutMs:setup.scope.maximumSessionMs,durationMs:13000,proxyBytesUsed:0,proxySource:null,solveCaptcha:false};
  return{f,enrolled,authority,bridge,setup,approve,reserved,receipt,pins,recovery,replacement,usage,stop:()=>bridge.owner('stop',{operationId:setup.scope.operationId})};
 }});
}

/** Successor disposal/capture callbacks are explicitly inert; the failed
 * predecessor continues using only its distinct remote-terminal proof. */
export async function finishReplacementVerification(db,f,a,reserved){
 const x=f.bridge,authority=f.authority;
 const record=await a.publish();await a.admit('owner_view');const returned=await a.admit('owner_return');
 await x.server('consume',{record,owner:a.owner,action:'return',permit:returned});await a.admit('profile_readback');
 await a.transport('browser.etsy.profile.readback','GET','https://api.steel.dev/v1/profiles/'+a.profileId);
 const accept=await a.admit('accept_profile'),body={version:'etsy.steel-profile-candidate.1',handoffId:a.handoffId,scopeHash:hash(a.scope),
  ...Object.fromEntries(['ownerId','businessId','testEnvelopeId','testEnvelopeHash','accountId','accountRevision','expectedShopName','expectedShopId','approvalId','approvalRevision','purpose','providerProjectId'].map(k=>[k,a.scope[k]])),
  profileId:a.profileId,sourceSessionId:a.scope.operationId,expiresAt:a.scope.profileAccessExpiresAt,accountIdentityVerified:false,insightsAccessVerified:false,reuseRequiresFreshAuthority:true};
 const candidate={...body,candidateHash:hash(body)},saved=await x.server('candidate',{candidate,permit:accept});
 const receiptBody={version:'etsy.steel-owner-handoff-receipt.1',operationId:a.scope.operationId,scopeHash:hash(a.scope),handoffId:a.handoffId,
  status:'profile_pending_verification',reason:'separate_account_and_insights_verification_required',releaseState:'verified',liabilityState:'receipt_required',
  reservationId:reserved.reservationId,reservationHash:reserved.reservationHash,profileBindingId:saved.bindingId,profileBindingRevision:saved.revision,accountIdentityVerified:false,insightsAccessVerified:false};
 const receipt={...receiptBody,receiptHash:hash(receiptBody)};await x.server('receipt',{receipt});
 async function finishAccounting(operationId,receipt){
  const session=await x.ledger(operationId,'bind_session',{sessionId:operationId,providerProjectId:a.scope.providerProjectId,providerAccountHash:hash({account:'inert'})});
  const providerReadbackHash=hash({operationId,providerStatus:'released',durationMs:1000});
  const release=await x.ledger(operationId,'evidence',{kind:'release',providerRecordId:randomUUID(),content:{operationId,sessionId:operationId,providerProjectId:a.scope.providerProjectId,terminal:true,observersDisposed:true,providerStatus:'released',providerReadbackHash,disposalProofHash:hash({operationId,disposed:true})}});
  await x.ledger(operationId,'receipt',receipt);
  const usage=await x.ledger(operationId,'evidence',{kind:'usage_bound',providerRecordId:randomUUID(),content:{operationId,sessionId:operationId,providerProjectId:a.scope.providerProjectId,usageIdentityHash:session.usageIdentityHash,tariffHash:authority.tariffHash,qualificationHash:authority.qualificationHash,withinQualifiedLimits:true,maximumMicrounits:'1000',requestedTimeoutMs:60000,providerTimeoutMs:60000,durationMs:1000,proxyBytesUsed:0,proxySource:null,solveCaptcha:false,extraServicesDisabled:true,providerReadbackHash}});
  const accounting=await x.ledger(operationId,'reconcile',{releaseProofHash:release.evidenceHash,usageProofHash:usage.evidenceHash,billingProofHash:null});
  return {release,accounting:accounting.accounting};
 }
 const setupAccounting=await finishAccounting(a.scope.operationId,receipt);
 await x.server('cleanup_complete',{operationId:a.scope.operationId,releaseEvidenceHash:setupAccounting.release.evidenceHash},'cleanup');

 const runtime=landingSqlVerification({authority,x,a,record,candidate,receipt,saved,setupAccounting});
 runtime.input.config=INERT_STEEL_CONFIG;
 runtime.input.createConfigurationGuard={deployment:f.repair?.deployment??INERT_STEEL_DEPLOYMENT,admit:request=>admitSteelConfig(db,f.f.businessId,request,x.keys.verification)};
 const result=await runtime.run();if(result.status!=='verified')throw Error('Replacement verification failed: '+JSON.stringify(result));return result;
}
export async function setupRecoveryRace(db,kind,x,payload){
 if(!process.env.R12_POSTGRES_URL)return null;
 const target=validateOwnerInitialRaceEnvironment(process.env),require=createRequire(resolve(target.host,'package.json')),{Client}=require('pg');
 const holder=new Client({connectionString:target.url,application_name:'setup-recovery-holder'}),waiter=new Client({connectionString:target.url,application_name:'setup-recovery-waiter'});
 try{await holder.connect();await waiter.connect();
 const action=(client,value)=>kind==='release_revoke'?(value.revoke?client.query('insert into private.r12_steel_setup_repair_release_revocations(review_hash) values($1)',[x.repair.review.reviewHash]):asRole(client,'anon','r12_etsy_steel_server',[x.f.businessId,'transport',value,x.bridge.keys.handoff])):kind==='ledger_revoke'?(value.revoke?client.query("insert into private.r12_direct_browser_evidence_key_revocations(key_hash) values(encode(extensions.digest($1,'sha256'),'hex'))",[x.bridge.keys.evidence]):asRole(client,'anon','r12_direct_browser_ledger',[x.f.businessId,x.setup.scope.operationId,'read',{},x.bridge.keys.evidence])):kind==='confirm'?asRole(client,'authenticated','r12_owner_steel_replacement',[x.f.businessId,'confirm',value],x.f.ownerId):asRole(client,'anon','r12_etsy_steel_server',[x.f.businessId,'transport',value,x.bridge.keys.handoff]);
 return await orderedRace({observer:db,holder,waiter,first:c=>action(c,payload.first),second:c=>action(c,payload.second)});
 }finally{await holder.end();await waiter.end();}
}

/** New release/CI/configuration evidence is explicitly synthetic operator
 * qualification. The actual immutable publisher validates every retained pin. */
export async function publishInertRepairRelease(db,x,{beforePublish=null}={}){
 const row=await one(db,`select to_jsonb(p) package,to_jsonb(e) envelope,private.r12_direct_enrollment_definition_hash() definition,private.r12_steel_setup_repair_terms(e,p) terms from private.r12_direct_test_envelopes e join private.r12_direct_test_confirmations tc on tc.envelope_id=e.id join private.r12_direct_enrollment_grants g on g.grant_id=tc.grant_id join private.r12_direct_enrollment_packages p on p.package_hash=g.package_hash where e.id=$1`,[x.authority.prepared.testEnvelopeId]);
 const deployment={environment:'production',deploymentId:'dpl_inert_recovery_successor',releaseCommitSha:'2'.repeat(40)},configuration={version:'r12.steel-runtime-configuration.1',provider:'steel',baseUrl:'https://api.steel.dev',region:null,providerProjectId:x.setup.scope.providerProjectId,...deployment},configurationHash=hash(configuration);
 const release={...row.package.review_evidence.release,commitSha:deployment.releaseCommitSha,treeSha:'3'.repeat(40),databaseDefinitionHash:row.definition,deploymentReceiptHash:hash('inert-successor-deployment-receipt'),qualificationRuns:row.package.review_evidence.release.qualificationRuns.map(r=>({...r,headSha:deployment.releaseCommitSha,artifactHash:hash({inertSuccessor:r.workflow})}))};
 const body={version:'r12.steel-setup-repair-release.1',businessId:x.f.businessId,ownerId:x.f.ownerId,goalId:x.f.goalId,testEnvelopeId:row.envelope.id,testEnvelopeHash:row.envelope.content_hash,originalOperationId:x.setup.scope.operationId,failedReceiptHash:x.receipt.receiptHash,reviewedPackageHash:row.package.package_hash,originalReleaseHash:hash(row.package.review_evidence.release),replacementOperationId:randomUUID(),configuration,configurationHash,release,unchangedTermsHash:row.terms,securityApprovalHash:hash('inert-repair-security-approval'),reviewedAt:new Date().toISOString(),expiresAt:new Date(Math.min(Date.parse(row.envelope.expires_at),Date.parse(row.package.expires_at))).toISOString()};
 const review={...body,reviewHash:hash(body)};if(beforePublish)await beforePublish(review);const published=(await one(db,'select private.r12_steel_publish_repair_release($1) x',[review])).x;
 const credentialBindingHash=createHmac('sha256',INERT_STEEL_CONFIG.apiKey).update('r12.steel-credential-binding.1\n'+configurationHash).digest('hex');
 x.repair={review,published,deployment,configuration:{configuration,configurationHash,credentialBindingHash},oldPackage:row.package};
 return x.repair;
}
export async function publishInertRepairAttestation(db,x){
 const {configuration}=x.repair;
 const attestation=await inertSteelAttestation(db,x.authority.routeHash,{mutate:b=>{Object.assign(b,configuration,{deploymentEvidenceHash:x.repair.review.release.deploymentReceiptHash});Object.assign(b.independentReadback,{configurationHash:configuration.configurationHash,credentialBindingHash:configuration.credentialBindingHash});}});
 const published=(await one(db,'select private.r12_steel_publish_config_attestation($1) x',[attestation])).x;return{attestation,published};
}

export async function startReplacementResearchRuntime(db,x,verified,replacement,prepared,quote,initial){
 const authority=x.authority;
 const confirmed=await authority.server('confirm_research',{setupId:prepared.setupId,setupHash:prepared.setupHash,submissionId:randomUUID()});
 const keys=Object.fromEntries(await Promise.all(['controller','admission','source'].map(async purpose=>[purpose,await authority.key(purpose)])));
 const rpc=(operation,payload={},purpose=operation==='dispatch'?'admission':operation.startsWith('source_')?'source':'controller')=>ownerInitialRuntimeRpc(db,'r12_direct_controller_server',[x.f.businessId,prepared.scopeId,operation,payload,keys[purpose]??purpose]);
 const f={enrollment:x.enrolled,authority,approved:{...x.bridge,keys:x.bridge.keys,profileId:replacement.profileId,accountBinding:verified.binding},inference:x.enrolled.inference,quote,initial,prepared,confirmed,keys,rpc,policy:prepared.preview.policy,profile:prepared.preview.profile};
 Object.assign(process.env,{VERCEL_DEPLOYMENT_ID:x.repair.deployment.deploymentId,VERCEL_GIT_COMMIT_SHA:x.repair.deployment.releaseCommitSha});
 return{f,runtime:steelConfigResearchRuntimeComposition(db,f,{policyVersion:f.policy.version,deployment:x.repair.deployment})};
}

export const applySetupRecovery=db=>db.exec(readFileSync('supabase/migrations/'+RECOVERY_MIGRATION,'utf8'));

export const RELEASE_SUCCESSOR_MIGRATION='20261011111003_r12_steel_single_release_successor.sql';
export const applyReleaseSuccessor=db=>db.exec(readFileSync('supabase/migrations/'+RELEASE_SUCCESSOR_MIGRATION,'utf8'));
