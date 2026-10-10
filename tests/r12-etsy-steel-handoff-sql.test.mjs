import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {one} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {prepareSteelHandoffFixture} from './helpers/r12-etsy-steel-handoff-sql-fixture.mjs';
import {buildEtsySteelHandoffDisclosure,validateEtsySteelHandoffScope} from '../.core-tests/accounts/etsy-steel-handoff-contracts.js';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2-hash.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),host=process.env.R12_SQL_TEST_HOST;
test('Steel owner approval, encrypted handoff CAS, separate verification, exact transport and durable cleanup',{skip:!host,timeout:300000},async()=>{
 const req=createRequire(path.resolve(host,'package.json')),{PGlite}=req('@electric-sql/pglite'),{pgcrypto}=req('@electric-sql/pglite/contrib/pgcrypto');
 const db=new PGlite({extensions:{pgcrypto}}),original=globalThis.fetch;globalThis.fetch=async()=>{throw Error('No external HTTP permitted');};
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const file of readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')&&x<='20261010120145_r12_etsy_steel_owner_handoff.sql').sort())await db.exec(readFileSync(path.join(root,'supabase/migrations',file),'utf8'));
  const x=await prepareSteelHandoffFixture(db),a=await x.prepare();
  assert.equal(a.prepared.status,'pending_approval');assert.deepEqual(a.prepared.disclosure,buildEtsySteelHandoffDisclosure(a.scope));assert.deepEqual(validateEtsySteelHandoffScope(a.scope),a.scope);
  assert.equal((await one(db,'select count(*)::int n from private.r05_markers')).n,0);
  await assert.rejects(a.admit('create'),/authority_inactive/);
  const badApproval={operationId:a.scope.operationId,scopeHash:hash(a.scope),disclosureHash:'f'.repeat(64),expectedApprovalRevision:a.scope.approvalRevision,persistentAccessApproved:true,budgetApproved:true};
  await assert.rejects(x.owner('approve',badApproval),/approval_changed/);
  await assert.rejects(x.owner('read',{operationId:a.scope.operationId},randomUUID()),/owner_required/);
  assert.equal((await a.approve()).status,'approved');
  const reserved=await a.admit('create');assert.equal(reserved.reservedBrowserMicrounits,'1000');
  assert.equal((await one(db,'select count(*)::int n from private.r12_etsy_steel_cleanup where operation_id=$1',[a.scope.operationId])).n,1);
  await assert.rejects(a.admit('create'),/recovery_required|unknown_liability/);
  await assert.rejects(a.transport('browser.etsy.owner_handoff.create','POST','https://evil.invalid/v1/sessions'),/transport_denied/);
  await a.transport('browser.etsy.owner_handoff.create','POST','https://api.steel.dev/v1/sessions');
  await assert.rejects(a.transport('browser.etsy.owner_handoff.create','POST','https://api.steel.dev/v1/sessions'),/duplicate key/);
  await assert.rejects(a.publish({disconnectProof:{version:'etsy.steel-owner-disconnect.1',sessionId:a.scope.operationId,cdpDisconnected:true,observersDrained:false,inFlightCommandsSettled:true,appCaptureStopped:true,routeHandlersDrained:true,eventListenersRemoved:true}}),/record|storage/);
  const record=await a.publish();
  const read=await x.owner('read',{operationId:a.scope.operationId});assert.equal(JSON.stringify(read).includes('account-v1.'),false);assert.equal('profileId' in read,false);
  assert.deepEqual(await x.server('load',{owner:a.owner,handoffId:a.handoffId}),record);
  await a.admit('owner_view');
  const returned=await a.admit('owner_return');await x.server('consume',{record,owner:a.owner,action:'return',permit:returned});
  await assert.rejects(a.admit('owner_view'),/consumed_or_expired/);
  await assert.rejects(x.server('consume',{record,owner:a.owner,action:'return',permit:returned}),/duplicate key/);
  await a.admit('profile_readback');
  await assert.rejects(a.transport('browser.etsy.profile.readback','GET','https://api.steel.dev/v1/profiles/'+randomUUID()),/transport_denied/);
  await a.transport('browser.etsy.profile.readback','GET','https://api.steel.dev/v1/profiles/'+a.profileId);
  const accept=await a.admit('accept_profile'),body={version:'etsy.steel-profile-candidate.1',handoffId:a.handoffId,scopeHash:hash(a.scope),
   ...Object.fromEntries(['ownerId','businessId','testEnvelopeId','testEnvelopeHash','accountId','accountRevision','expectedShopName','expectedShopId','approvalId','approvalRevision','purpose','providerProjectId'].map(k=>[k,a.scope[k]])),
   profileId:a.profileId,sourceSessionId:a.scope.operationId,expiresAt:a.scope.profileAccessExpiresAt,accountIdentityVerified:false,insightsAccessVerified:false,reuseRequiresFreshAuthority:true};
  const candidate={...body,candidateHash:hash(body)},saved=await x.server('candidate',{candidate,permit:accept});
  assert.equal(saved.candidateHash,candidate.candidateHash);
  await assert.rejects(x.server('resolve',{binding:{profileBindingId:saved.bindingId,bindingHash:'a'.repeat(64)}}),/verified_binding_required/);
  await assert.rejects(x.server('verify',{binding:{profileBindingId:saved.bindingId},verification:{}}),/server_authority_required/);
  const receiptBody={version:'etsy.steel-owner-handoff-receipt.1',operationId:a.scope.operationId,scopeHash:hash(a.scope),handoffId:a.handoffId,
   status:'profile_pending_verification',reason:'separate_account_and_insights_verification_required',releaseState:'verified',liabilityState:'receipt_required',
   reservationId:reserved.reservationId,reservationHash:reserved.reservationHash,profileBindingId:saved.bindingId,profileBindingRevision:saved.revision,accountIdentityVerified:false,insightsAccessVerified:false};
  const receipt={...receiptBody,receiptHash:hash(receiptBody)};await x.server('receipt',{receipt});
  const sessionIdentity=await x.ledger(a.scope.operationId,'bind_session',{sessionId:a.scope.operationId,providerProjectId:a.scope.providerProjectId,providerAccountHash:hash({account:'inert'})});
  const providerReadbackHash=hash({operationId:a.scope.operationId,providerStatus:'released'});
  const release=await x.ledger(a.scope.operationId,'evidence',{kind:'release',providerRecordId:randomUUID(),content:{operationId:a.scope.operationId,sessionId:a.scope.operationId,providerProjectId:a.scope.providerProjectId,terminal:true,observersDisposed:true,providerStatus:'released',providerReadbackHash,disposalProofHash:hash(record.disconnectProof)}});
  await x.server('cleanup_complete',{operationId:a.scope.operationId,releaseEvidenceHash:release.evidenceHash},'cleanup');
  await x.ledger(a.scope.operationId,'receipt',receipt);
  const usage=await x.ledger(a.scope.operationId,'evidence',{kind:'usage_bound',providerRecordId:randomUUID(),content:{operationId:a.scope.operationId,sessionId:a.scope.operationId,providerProjectId:a.scope.providerProjectId,usageIdentityHash:sessionIdentity.usageIdentityHash,tariffHash:x.x.tariffHash,qualificationHash:x.x.qualificationHash,withinQualifiedLimits:true,maximumMicrounits:'1000',requestedTimeoutMs:60000,providerTimeoutMs:60000,durationMs:1000,proxyBytesUsed:0,proxySource:null,solveCaptcha:false,extraServicesDisabled:true,providerReadbackHash}});
  await x.ledger(a.scope.operationId,'reconcile',{releaseProofHash:release.evidenceHash,usageProofHash:usage.evidenceHash,billingProofHash:null});
  const verificationInputs=await x.verifier('prepare',{setupOperationId:a.scope.operationId}),vs=verificationInputs.scope;
  assert.equal(vs.operationId,a.scope.verificationOperationId);assert.equal(vs.profileId,a.profileId);assert.equal(vs.purpose,'etsy_insights_verify_only');
  await x.verifier('admit',{operationId:vs.operationId});
  const verificationTransport={operationId:vs.operationId,request:{provider:'steel',operation:'browser.etsy.insights.create',method:'POST',endpoint:'https://api.steel.dev/v1/sessions'}};
  await x.verifier('transport',verificationTransport);await assert.rejects(x.verifier('transport',verificationTransport),/duplicate key/);
  await x.ledger(vs.operationId,'bind_session',{sessionId:vs.operationId,providerProjectId:vs.providerProjectId,providerAccountHash:hash({account:'inert'})});
  const verificationRelease=await x.ledger(vs.operationId,'evidence',{kind:'release',providerRecordId:randomUUID(),content:{operationId:vs.operationId,sessionId:vs.operationId,providerProjectId:vs.providerProjectId,terminal:true,observersDisposed:true,providerStatus:'released',providerReadbackHash:hash({sessionId:vs.operationId,status:'released'}),disposalProofHash:hash({sessionId:vs.operationId,disposed:true})}});
  await x.verifier('cleanup_complete',{operationId:vs.operationId,releaseEvidenceHash:verificationRelease.evidenceHash});
  const vrBody={version:'etsy.steel-account-verification-receipt.1',operationId:vs.operationId,scopeHash:verificationInputs.scopeHash,status:'verified',releaseState:'verified',liabilityState:'receipt_required'};
  await x.ledger(vs.operationId,'receipt',{...vrBody,receiptHash:hash(vrBody)});
  const context={version:'etsy.steel-visible-account-context.1',operationId:vs.operationId,setupOperationId:a.scope.operationId,handoffId:a.handoffId,testEnvelopeId:a.scope.testEnvelopeId,testEnvelopeHash:a.scope.testEnvelopeHash,sessionId:vs.operationId,contextId:randomUUID(),pageId:randomUUID(),providerProjectId:a.scope.providerProjectId,profileId:a.profileId,observedShopName:a.scope.expectedShopName,observedShopId:null,
   profileBindingId:saved.bindingId,profileBindingRevision:saved.revision,documentEpoch:1,canonicalUrl:'https://www.etsy.com/your/shops/me/marketplace-insights',visibleShopHref:'https://www.etsy.com/shop/'+a.scope.expectedShopName+'?ref=seller-platform-mcnav',insightsHeading:'Marketplace Insights',
   queryControlWitnessHash:hash({formAriaLabel:'search bar form',inputAriaLabel:'Input to search for keywords',inputType:'text',buttonName:'Search',buttonType:'submit',formVisible:true,inputVisible:true,inputEnabled:true,buttonVisible:true,buttonEnabled:true}),verifiedAt:new Date(Date.now()-1000).toISOString()};
  const proofBody={version:'etsy.steel-account-verification.1',operationId:a.scope.verificationOperationId,setupOperationId:a.scope.operationId,handoffId:a.handoffId,profileBindingId:saved.bindingId,profileBindingRevision:saved.revision,
   testEnvelopeId:a.scope.testEnvelopeId,testEnvelopeHash:a.scope.testEnvelopeHash,...Object.fromEntries(Object.entries(context).filter(([key])=>key!=='version')),expiresAt:a.scope.profileAccessExpiresAt,
   accountIdentityVerified:true,insightsAccessVerified:true,verifiedContextHash:hash(context)};
  const verification={...proofBody,verificationHash:hash(proofBody)},bindingBody={version:'r12.etsy-insights-account-binding.1',
   ...Object.fromEntries(['businessId','goalId','authorityRootId','testEnvelopeId','testEnvelopeHash','purpose','providerProjectId','approvalId','approvalRevision','disclosureHash'].map(k=>[k,a.scope[k]])),
   ...Object.fromEntries(['profileBindingId','profileBindingRevision','verifiedContextHash','observedShopName','observedShopId','verifiedAt','expiresAt'].map(k=>[k,verification[k]])),
   handoffReceiptHash:receipt.receiptHash,profileCandidateHash:candidate.candidateHash,accountVerificationHash:verification.verificationHash};
  const binding={...bindingBody,bindingHash:hash(bindingBody)};
  const forgedBody={...proofBody,queryControlWitnessHash:'f'.repeat(64)},forgedVerification={...forgedBody,verificationHash:hash(forgedBody)};
  const forgedBindingBody={...bindingBody,accountVerificationHash:forgedVerification.verificationHash},forgedBinding={...forgedBindingBody,bindingHash:hash(forgedBindingBody)};
  await assert.rejects(x.verifier('verify',{binding:forgedBinding,verification:forgedVerification}),/same_context_verification_required/);
  assert.equal((await x.verifier('verify',{binding,verification})).verified,true);
  assert.equal((await x.server('resolve',{binding})).profileId,a.profileId);
  const stopped=await x.owner('stop',{operationId:a.scope.operationId});assert.equal(stopped.status,'stopped');
  await assert.rejects(x.server('resolve',{binding}),/authority_inactive/);
  await assert.rejects(a.transport('browser.etsy.owner_handoff.status','GET','https://api.steel.dev/v1/sessions/'+a.scope.operationId),/authority_inactive/);
  await a.transport('browser.etsy.session.release','POST','https://api.steel.dev/v1/sessions/'+a.scope.operationId+'/release','cleanup');
  await a.transport('browser.etsy.session.release_readback','GET','https://api.steel.dev/v1/sessions/'+a.scope.operationId,'cleanup');
  await assert.rejects(a.transport('browser.etsy.owner_handoff.create','POST','https://api.steel.dev/v1/sessions','cleanup'),/transport_denied/);
  // Expired login approval cannot keep a view alive or stop mandatory cleanup.
  const y=await prepareSteelHandoffFixture(db),b=await y.prepare({approvalExpiresAt:new Date(Date.now()+800).toISOString()});
  await b.approve();await b.admit('create');
  await b.transport('browser.etsy.owner_handoff.create','POST','https://api.steel.dev/v1/sessions');
  const expiredRecord=await b.publish();await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(b.scope.approvalExpiresAt)-Date.now()+30)));
  await assert.rejects(b.admit('owner_view'),/authority_inactive/);
  assert.deepEqual(await y.server('load',{owner:b.owner,handoffId:b.handoffId}),expiredRecord);
  assert.equal((await y.server('consume',{owner:b.owner,record:expiredRecord,action:'stop',permit:null})).consumed,true);
  const due=await y.server('cleanup_due',{},'cleanup');assert.equal(due.operations.length,1);assert.equal(due.operations[0].sessionId,b.scope.operationId);
  await b.transport('browser.etsy.session.release','POST','https://api.steel.dev/v1/sessions/'+b.scope.operationId+'/release','cleanup');
  assert.equal((await y.owner('stop',{operationId:b.scope.operationId})).status,'stopped');
  // An unapproved new revision revokes stale reads; it never inherits approval.
  const z=await prepareSteelHandoffFixture(db),older=await z.prepare();await older.approve();
  const newer=await z.prepare({accountId:older.scope.accountId});
  await assert.rejects(older.admit('create'),/authority_inactive/);await assert.rejects(older.approve(),/approval_changed/);
  await assert.rejects(newer.admit('create'),/authority_inactive/);
  const acl=await one(db,"select has_function_privilege('anon','public.r12_etsy_steel_owner(uuid,text,jsonb)','EXECUTE') owner,has_table_privilege('authenticated','private.r12_etsy_steel_handoffs','SELECT') secret,has_function_privilege('service_role','private.r12_etsy_steel_account_binding_check(jsonb)','EXECUTE') binding");assert.deepEqual(acl,{owner:false,secret:false,binding:false});
  const tables=await one(db,"select bool_and(rowsecurity) rls,bool_and(not has_table_privilege('anon',format('%I.%I',schemaname,tablename),'SELECT,INSERT,UPDATE,DELETE')) anon,bool_and(not has_table_privilege('service_role',format('%I.%I',schemaname,tablename),'SELECT,INSERT,UPDATE,DELETE')) service from pg_tables where schemaname='private' and tablename like 'r12_etsy_steel_%'");
  assert.deepEqual(tables,{rls:true,anon:true,service:true});
 }catch(error){if(error.where)error.message+='\n'+error.where;throw error;}finally{globalThis.fetch=original;await db.close();}
});
