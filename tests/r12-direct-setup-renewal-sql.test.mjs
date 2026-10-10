import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {validatePublicResearchOwnerTestReceipt} from '../.core-tests/products/discovery-r12-public-preparation.js';
import {deriveDirectServerKey} from '../.core-tests/products/discovery-r12-public-server-key.js';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2-hash.js';
import {ETSY_RENDERER_DOM_REFERENCE_MANIFEST as manifest,ETSY_RENDERER_DOM_REFERENCE_HASH as provenanceHash} from '../.core-tests/browser/etsy-insights-renderer-evidence.js';
import {qualifyInertOwnerRenderer} from './helpers/r12-direct-setup-renewal-fixture.mjs';
import {bindDirectHandoffFixture} from './helpers/r12-direct-approved-setup-fixture.mjs';
import {runDirectApprovedSetup} from './helpers/r12-direct-approved-setup-fixture.mjs';
import {prepareDirectTestAuthorityFixture} from './helpers/r12-direct-test-authority-fixture.mjs';
import {one,ownerInitialRuntimeRpc} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {validateOwnerInitialRaceEnvironment} from './helpers/r12-owner-initial-postgres-races.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),host=process.env.R12_SQL_TEST_HOST;
test('setup route revalidation preserves reviewed terms, two real sessions, unknown liabilities and renderer authority',{skip:!host&&process.env.R12_REQUIRE_POSTGRES!=='1',timeout:180000},async()=>{
 assert.ok(host);const req=createRequire(path.resolve(host,'package.json'));let db;
 if(process.env.R12_REQUIRE_POSTGRES==='1')assert.ok(process.env.R12_POSTGRES_URL);
 if(process.env.R12_POSTGRES_URL){const target=validateOwnerInitialRaceEnvironment(process.env),{Client}=req('pg');db=new Client({connectionString:process.env.R12_POSTGRES_URL});await db.connect();db.exec=sql=>db.query(sql);db.close=()=>db.end();assert.deepEqual(await one(db,'select current_user actor,current_database() db,host(inet_server_addr()) address'),{actor:'r12_test',db:'r12_test',address:target.address});assert.equal(Number((await one(db,"select count(*) n from pg_tables where schemaname in ('public','private')")).n),0);}
 else{const {PGlite}=req('@electric-sql/pglite'),{pgcrypto}=req('@electric-sql/pglite/contrib/pgcrypto');db=new PGlite({extensions:{pgcrypto}});}
 const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('External transport forbidden');};
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const file of readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')&&x.slice(0,14)<='20261010120430').sort())await db.exec(readFileSync(path.join(root,'supabase/migrations',file),'utf8'));
  assert.deepEqual((await one(db,'select private.r12_direct_renderer_reference_manifest() p')).p,manifest);
  const rendererPolicy={version:'etsy.insights-renderer-policy.2',staticOrigins:[],maximumRequests:256,navigation:'fixed_insights_get_only',sameOrigin:'renderer_get_only',post:'denied',extraction:'visible_aggregate_dom_only',staticAssets:[manifest.images[0]],optionalTelemetry:[manifest.optionalTelemetry[0]],provenanceHash};
  const classify=async d=>(await one(db,'select private.r12_direct_owner_renderer_classify($1,$2) p',[rendererPolicy,d])).p;
  const req={url:'https://www.etsy.com/',method:'GET',resourceType:'document',navigation:true};assert.equal(await classify(req),'allow');
  const asset=rendererPolicy.staticAssets[0],telemetry=rendererPolicy.optionalTelemetry[0];
  assert.equal(await classify({url:asset.origin+asset.path,method:'GET',resourceType:'image',navigation:false}),'allow');
  assert.equal(await classify({url:telemetry.origin+telemetry.path,method:'GET',resourceType:telemetry.resourceType,navigation:false}),'deny_optional_telemetry');
  for(const bad of [{...req,method:'POST'},{...req,url:'https://www.etsy.com/signin'},{...req,url:asset.origin+asset.path},{url:telemetry.origin+telemetry.path+'?id=private',method:'GET',resourceType:telemetry.resourceType,navigation:false},{url:asset.origin+'/unknown.jpg',method:'GET',resourceType:'image',navigation:false},{url:'https://www.etsy.com/%6cogin',method:'GET',resourceType:'fetch',navigation:false}])await assert.rejects(classify(bad),/renderer_/);
  const bootstrapPolicy={version:'etsy.owner-bootstrap-policy.1',documentUrl:'https://www.etsy.com/',documentMethod:'GET',maximumRequests:256,subresources:'deny_without_evidence',redirects:'fatal',auth:'fatal',childTargets:'fatal'};
  const bootstrapClassify=async d=>(await one(db,'select private.r12_direct_owner_renderer_classify($1,$2) p',[bootstrapPolicy,d])).p;
  assert.equal(await bootstrapClassify(req),'allow_owner_document');
  assert.equal(await bootstrapClassify({url:'https://unreviewed.example/',method:'POST',resourceType:'xhr',navigation:false}),'deny_owner_subresource');
  for(const bad of [{...req,url:'https://www.etsy.com/signin'},{...req,method:'POST'},{url:'https://unreviewed.example/path',method:'GET',resourceType:'image',navigation:false}])await assert.rejects(bootstrapClassify(bad),/bootstrap_/);
  await assert.rejects(db.query('select private.r12_direct_renderer_policy_check($1)',[bootstrapPolicy]),/invalid/);
  await prepareDirectTestAuthorityFixture(db,{configureReview:ctx=>qualifyInertOwnerRenderer(db,{...ctx,policy:rendererPolicy,verificationPolicy:rendererPolicy}),onPrepared:async initial=>{
   const at=Date.now(),qBody={...initial.quote,verifiedAt:new Date(at).toISOString(),validUntil:new Date(at+3500).toISOString()};delete qBody.browserQuoteHash;
   const quote={...qBody,browserQuoteHash:hash(qBody)},input={...initial.input,submissionId:randomUUID()};
   const prepared=await initial.server('prepare_test',{input,setupQuote:quote,verificationQuote:quote});
   const confirmPayload={testEnvelopeId:prepared.testEnvelopeId,testEnvelopeHash:prepared.testEnvelopeHash,submissionId:randomUUID()};
   const x={...initial,prepared,quote,input,confirmPayload,confirm:()=>initial.server('confirm_test',confirmPayload),key:async purpose=>deriveDirectServerKey(initial.f.bootstrapKey,{businessId:initial.f.businessId,goalId:initial.f.goalId,testEnvelopeId:prepared.testEnvelopeId,envelopeHash:prepared.testEnvelopeHash,routeHash:initial.routeHash,purpose})};
   await x.confirm();validatePublicResearchOwnerTestReceipt(prepared,{businessId:x.f.businessId,goalId:x.f.goalId});
   const renew=(setupId,kind,key)=>ownerInitialRuntimeRpc(db,'r12_direct_setup_quote_revalidate',[x.f.businessId,setupId,kind,key]);
   const priorEnvelope=(await one(db,'select content_hash from private.r12_direct_test_envelopes where id=$1',[prepared.testEnvelopeId])).content_hash;
   let proof;
   let lastDecision;
   const setup=await runDirectApprovedSetup(db,x,{afterCreate:async({a,x:handoff})=>{
    const q=await ownerInitialRuntimeRpc(db,'r12_direct_owner_renderer_qualification',[x.f.businessId,a.scope.operationId,await x.key('handoff')]);
    const decision={version:'etsy.owner-handoff-renderer-request.2',operationId:a.scope.operationId,providerProjectId:x.project,qualificationHash:q.qualificationHash,policyHash:q.policyHash,provenanceHash,sequence:1,...req,disposition:'allow'};
    const record=d=>handoff.server('renderer_decision',{operationId:a.scope.operationId,decision:d});
    await assert.rejects(record({...decision,qualificationHash:'e'.repeat(64)}),/decision_unverified/);
    await assert.rejects(record({...decision,sequence:2}),/decision_replay/);
    assert.deepEqual(await record(decision),{accepted:true});await assert.rejects(record(decision),/decision_replay/);
    await assert.rejects(record({...decision,sequence:2,url:telemetry.origin+telemetry.path,resourceType:telemetry.resourceType,navigation:false}),/disposition_mismatch/);
    const denied={...decision,sequence:2,url:telemetry.origin+telemetry.path,resourceType:telemetry.resourceType,navigation:false,disposition:'deny_optional_telemetry'};
    assert.deepEqual(await record(denied),{accepted:true});lastDecision={...decision,sequence:3};
   },afterVerificationCreate:async({x:handoff,verificationInputs,verificationRenderer})=>{
    const v=verificationInputs,op=v.scope.operationId,q=verificationRenderer;
    assert.equal(q.requestHash,v.scopeHash);assert.deepEqual(q.policy,rendererPolicy);
    const request={version:'etsy.insights-verification-renderer-request.2',operationId:op,requestId:v.requestId,scopeHash:v.scopeHash,qualificationHash:q.qualificationHash,sequence:1,url:'https://www.etsy.com/your/shops/me/marketplace-insights',method:'GET',resourceType:'document',navigation:true,disposition:'allow',policyHash:q.policyHash,provenanceHash};
    const record=r=>handoff.verifier('admit_renderer',{operationId:op,request:r});
    await assert.rejects(record({...request,scopeHash:'e'.repeat(64)}),/request_unverified/);
    assert.equal((await record(request)).accepted,true);await assert.rejects(record(request),/renderer_replay/);
    await assert.rejects(record({...request,sequence:2,url:'https://www.etsy.com/'}),/navigation_denied/);
    assert.equal((await record({...request,sequence:2,url:telemetry.origin+telemetry.path,resourceType:telemetry.resourceType,navigation:false,disposition:'deny_optional_telemetry'})).allowed,false);
   },beforeVerification:async({a,x:handoff})=>{
    const renderer=await ownerInitialRuntimeRpc(db,'r12_direct_owner_renderer_qualification',[x.f.businessId,a.scope.operationId,await x.key('handoff')]);
    assert.deepEqual(renderer.policy,rendererPolicy);assert.equal(renderer.qualificationHash,hash(Object.fromEntries(Object.entries(renderer).filter(([k])=>k!=='qualificationHash'))));
    const exposed=(await one(db,'select private.r12_direct_test_exposure($1) x',[prepared.testEnvelopeId])).x;assert.equal(exposed.boundedPendingMicrounits,'1000');assert.equal(exposed.hasUnknownOrUnbounded,false);
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(quote.validUntil)-Date.now()+30)));
    await assert.rejects(handoff.verifier('prepare',{setupOperationId:a.scope.operationId}),/revalidation_required/);
    await assert.rejects(renew(a.scope.operationId,'verification',await x.key('handoff')),/key_required/);
    proof=await renew(a.scope.operationId,'verification',await x.key('verification'));
    assert.equal(proof.operationId,a.scope.verificationOperationId);assert.equal(proof.approvedQuoteHash,quote.browserQuoteHash);assert.equal(proof.reason,'still_valid_private_route_revalidation');
    assert.deepEqual(await renew(a.scope.operationId,'verification',await x.key('verification')),proof);
    const terms=q=>Object.fromEntries(Object.entries(q).filter(([k])=>!['browserQuoteHash','verifiedAt','validUntil'].includes(k)));
    assert.deepEqual(terms(proof.executionQuote),terms(quote));assert.ok(Date.parse(proof.executionQuote.validUntil)<=Date.parse(proof.routeQualifiedUntil));
    assert.equal((await one(db,'select private.r12_direct_test_exposure($1) x',[prepared.testEnvelopeId])).x.boundedPendingMicrounits,'1000');
   }});
   await assert.rejects(setup.server('renderer_decision',{operationId:setup.setupOperation,decision:lastDecision}),/decision_unverified/);
   assert.equal((await one(db,'select count(*)::int n from private.r12_direct_owner_renderer_decisions where operation_id=$1',[setup.setupOperation])).n,2);
   assert.ok(proof);assert.equal(setup.verificationAccounting.quoteHash,quote.browserQuoteHash,'Original approved quote stays in accounting provenance');
   assert.equal((await one(db,'select content_hash from private.r12_direct_test_envelopes where id=$1',[prepared.testEnvelopeId])).content_hash,priorEnvelope);
   const uses=(await db.query('select stage,execution_quote_hash,proof_hash from private.r12_direct_setup_quote_uses where operation_id=$1 order by stage',[setup.verificationOperation])).rows;
   assert.equal(uses.length,3);assert.ok(uses.every(u=>u.execution_quote_hash===proof.executionQuote.browserQuoteHash&&u.proof_hash===proof.proofHash));
   const counts=(await one(db,'select private.r12_direct_provider_operation_counts($1) x',[prepared.testEnvelopeId])).x;
   assert.deepEqual(counts,{historicalResearchDispatches:5,researchDispatches:0,ownerLoginDispatches:1,ownerVerificationDispatches:1,providerDispatchesTotal:7});
   const h=await bindDirectHandoffFixture(db,x),anotherId=randomUUID();await renew(anotherId,'setup',await x.key('handoff'));
   const another=await h.prepare({operationId:anotherId});await another.approve();await assert.rejects(another.admit('create'),/setup_session_limit/);
   assert.equal((await one(db,'select private.r12_direct_test_exposure($1) x',[prepared.testEnvelopeId])).x.boundedPendingMicrounits,'2000');
   // SQL NULL must not make a self-hashed, unbound receipt acceptable.
   for(const pins of [{},{scopeHash:null,requestHash:null},{scopeHash:'e'.repeat(64)},{requestHash:'e'.repeat(64)}]){
    const body={version:'etsy.steel-owner-handoff-receipt.1',operationId:setup.setupOperation,...pins};
    await assert.rejects(setup.ledger(setup.setupOperation,'receipt',{...body,receiptHash:hash(body)}),/receipt_mismatch/);
   }
   const wrongType={version:'fabricated.1',operationId:setup.setupOperation,scopeHash:hash(setup.scope)};
   await assert.rejects(setup.ledger(setup.setupOperation,'receipt',{...wrongType,receiptHash:hash(wrongType)}),/receipt_mismatch/);
   await db.query('insert into private.r12_direct_browser_route_revocations(route_hash) values($1)',[x.routeHash]);
   await assert.rejects(renew(randomUUID(),'setup',await x.key('handoff')),/unresolved|unqualified|inactive/);
   assert.equal((await one(db,'select private.r12_direct_test_exposure($1) x',[prepared.testEnvelopeId])).x.hasUnknownOrUnbounded,true);
   assert.equal((await one(db,"select has_table_privilege('authenticated','private.r12_direct_setup_quote_revalidations','INSERT') x")).x,false);
  }});
  await prepareDirectTestAuthorityFixture(db,{configureReview:ctx=>qualifyInertOwnerRenderer(db,{...ctx,policy:bootstrapPolicy,verificationPolicy:rendererPolicy}),onPrepared:async x=>{
   const result=await runDirectApprovedSetup(db,x,{afterCreate:async({a,x:handoff})=>{
    const q=await ownerInitialRuntimeRpc(db,'r12_direct_owner_renderer_qualification',[x.f.businessId,a.scope.operationId,await x.key('handoff')]);
    assert.equal(q.version,'etsy.owner-bootstrap-qualification.1');assert.deepEqual(q.policy,bootstrapPolicy);
    const decision={version:'etsy.owner-bootstrap-request.1',operationId:a.scope.operationId,providerProjectId:x.project,qualificationHash:q.qualificationHash,policyHash:q.policyHash,sequence:1,...req,disposition:'allow_owner_document'};
    const record=d=>handoff.server('renderer_decision',{operationId:a.scope.operationId,decision:d});
    assert.deepEqual(await record(decision),{accepted:true});
    await assert.rejects(record({...decision,sequence:2,provenanceHash}),/invalid_fields/);
    assert.deepEqual(await record({...decision,sequence:2,url:'http://unreviewed.example/',method:'POST',resourceType:'xhr',navigation:false,disposition:'deny_owner_subresource'}),{accepted:true});
    await assert.rejects(record({...decision,sequence:3,url:'https://www.etsy.com/signin'}),/navigation_denied/);
   }});
   assert.equal(result.accountBinding.purpose,'etsy_insights_read_only');
   assert.equal(result.setupAccounting.status,'qualified_bounded_pending');assert.equal(result.verificationAccounting.status,'qualified_bounded_pending');
  }});
  assert.equal(network,0);
 }finally{globalThis.fetch=originalFetch;await db.close();}
});
