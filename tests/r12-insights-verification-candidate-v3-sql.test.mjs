import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {candidateDatabase,withCandidateVerification,insertCandidateReview,policy,candidateImage,candidateScript,candidateQueriedImage} from './helpers/r12-candidate-verification-sql-fixture.mjs';
import {prepareDirectTestAuthorityFixture} from './helpers/r12-direct-test-authority-fixture.mjs';
import {qualifyInertOwnerRenderer} from './helpers/r12-direct-setup-renewal-fixture.mjs';
import {runDirectApprovedSetup,bindDirectHandoffFixture} from './helpers/r12-direct-approved-setup-fixture.mjs';
import {candidateOwnerServer} from './helpers/r12-candidate-owner-server-fixture.mjs';
import {candidateControllerFixture} from './helpers/r12-candidate-controller-fixture.mjs';
import {one,ownerInitialRpc} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2-hash.js';
const enabled=!!process.env.R12_SQL_TEST_HOST;
const keys=['accepted','allowed','sequence','disposition','decisionHash','qualificationHash','policyHash','provenanceHash'];
async function inertDb(work,options={}){const db=await candidateDatabase(options),fetch=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('No external transport');};try{await work(db);assert.equal(calls,0);}finally{globalThis.fetch=fetch;await db.close();}}
async function durable(db,ctx,h,result){
 const id=ctx.a.scope.verificationOperationId;
 assert.equal(result.accountingConfirmed,true);assert.equal(h.providerRequests.filter(x=>x.url==='https://api.steel.dev/v1/sessions').length,1);assert.equal(h.providerRequests.filter(x=>x.url.endsWith('/release')).length,1);
 assert.equal(h.browser.events.includes('fill'),false);assert.equal(h.browser.events.includes('submit'),false);assert.equal(h.browser.browser.isConnected(),false);
 assert.equal((await one(db,'select count(*)::int n from private.r12_etsy_steel_verification_release where operation_id=$1',[id])).n,1);
 const ledger=await ctx.x.ledger(id,'read',{});assert.equal(ledger.accounting[0].status,'qualified_bounded_pending');assert.equal(ledger.accounting[0].actualMicrounits,null);
 return (await db.query('select content from private.r12_direct_verification_renderer_requests where operation_id=$1 order by sequence',[id])).rows.map(x=>x.content);
}
let warmed,oldOids;
const signatures=['private.r12_direct_verification_renderer(uuid,text,jsonb)','private.r12_landing_verification_check(uuid,jsonb,boolean)','public.r12_etsy_steel_owner(uuid,text,jsonb)','private.r12_etsy_steel_current(uuid,boolean)'];
async function warmBeforeCandidate(db){
 oldOids=await Promise.all(signatures.map(s=>one(db,'select $1::regprocedure::oid oid',[s])));
 const authority=await prepareDirectTestAuthorityFixture(db,{configureReview:c=>qualifyInertOwnerRenderer(db,c)});
 const approved=await runDirectApprovedSetup(db,authority);
 assert.equal((await ownerInitialRpc(db,authority.f.ownerId,'r12_owner_etsy_steel_verification_read',[authority.f.businessId,approved.setupOperation])).status,'verified');
 warmed={authority,approved};
}
test('candidate verification persists exact hash-only decisions, complete cleanup and identity without granting research',{skip:!enabled,timeout:240000},async()=>inertDb(async db=>{
 let captured;
 assert.deepEqual(await Promise.all(signatures.map(s=>one(db,'select $1::regprocedure::oid oid',[s]))),oldOids,'Warm callers retain original function OIDs');
 await insertCandidateReview(db,warmed.authority);
 const legacy=candidateOwnerServer(db,warmed.approved.scope);assert.equal((await legacy.read()).status,'legacy');
 assert.equal((await ownerInitialRpc(db,warmed.authority.f.ownerId,'r12_owner_etsy_steel_verification_read',[warmed.authority.f.businessId,warmed.approved.setupOperation])).status,'verified');
 await withCandidateVerification(db,async({ctx,h,reviewHash})=>{
  captured={ctx,h,reviewHash};assert.equal((await ctx.ownerAdapter.read()).status,'approved');
  const replacement=await insertCandidateReview(db,ctx.authority,{policyValue:{...policy,maximumRequests:255}});assert.notEqual(replacement,reviewHash);
  assert.equal((await ctx.ownerAdapter.read()).reviewHash,reviewHash);
  const before=(await one(db,'select count(*)::int n from private.r05_requests')).n;await assert.rejects(ctx.x.prepare(),/r12_candidate_review_ambiguous/);assert.equal((await one(db,'select count(*)::int n from private.r05_requests')).n,before);
  const result=await h.run();assert.equal(result.status,'verified');const rows=await durable(db,ctx,h,result);assert.equal(rows.length,4);
  const qualification=h.calls.find(x=>x.operation==='qualify_renderer');assert.ok(qualification);
  const q=(await one(db,'select content from private.r12_direct_verification_renderer_qualifications where operation_id=$1',[ctx.a.scope.verificationOperationId])).content;
  assert.deepEqual(q.policy,policy);assert.equal(q.version,'r12.etsy-insights-renderer-qualification.2');
  assert.equal((await one(db,'select review_hash h from private.r12_verification_candidate_selections where operation_id=$1',[ctx.a.scope.verificationOperationId])).h,reviewHash);
  for(const row of rows){const{decisionHash,...body}=row;assert.equal(decisionHash,hash(body));assert.equal(row.qualificationHash,q.qualificationHash);assert.equal(row.policyHash,hash(policy));assert.equal(row.provenanceHash,policy.provenanceHash);}
  assert.deepEqual(rows.map(x=>x.disposition),['allow','allow','deny_candidate_ancillary','deny_candidate_ancillary']);
  assert.equal(JSON.stringify(rows.slice(1)).includes('/site-assets/'),false);assert.equal(JSON.stringify(rows).includes('never_retained'),false);assert.ok(rows.slice(1).every(x=>!('url' in x)));
  assert.equal(h.browser.cdpCommands.filter(x=>x.name==='Fetch.continueRequest').length,2);assert.equal(h.browser.cdpCommands.filter(x=>x.name==='Fetch.failRequest').length,2);
  const read=()=>ownerInitialRpc(db,ctx.a.scope.ownerId,'r12_owner_etsy_steel_verification_read',[ctx.a.scope.businessId,ctx.a.scope.operationId]);assert.equal((await read()).status,'verified');
  await db.query('insert into private.r12_verification_candidate_revocations(review_hash) values($1)',[reviewHash]);
  assert.equal((await ctx.ownerAdapter.read()).status,'inactive');
  const invalid=await read();assert.equal(invalid.status,'invalidated');assert.equal(invalid.reason,'authority_inactive');for(const key of ['accountBindingHash','observedShopName','verifiedAt','expiresAt'])assert.equal(invalid[key],null);
  await assert.rejects(ctx.x.verifier('qualify_renderer',{operationId:ctx.a.scope.verificationOperationId}),/r12_landing_review_inactive/,'Cannot downgrade or requalify an existing candidate operation after revocation');
  await ctx.x.verifier('transport',{operationId:ctx.a.scope.verificationOperationId,request:{provider:'steel',operation:'browser.etsy.session.release',method:'POST',endpoint:'https://api.steel.dev/v1/sessions/'+ctx.a.scope.verificationOperationId+'/release'}});
 },{beforeRpc:async(operation,payload,ctx)=>{
  if(operation!=='qualify_renderer')return;
  const id=ctx.a.scope.verificationOperationId;
  await db.exec('begin');try{
   await one(db,"select private.r12_verification_renderer_before_candidate($1,'qualify_renderer',$2) value",[id,payload]);
   await assert.rejects(one(db,"select private.r12_direct_verification_renderer($1,'qualify_renderer',$2)",[id,payload]),/r12_candidate_setup_selection_changed/);
  }finally{await db.exec('rollback');}
  await db.exec('begin');try{
   await one(db,"select private.r12_verification_renderer_before_candidate($1,'qualify_renderer',$2) value",[id,payload]);
   await assert.rejects(one(db,'select private.r12_landing_verification_check($1,$2,false)',[id,{}]),/r12_candidate_setup_selection_changed/);
  }finally{await db.exec('rollback');}
  await db.exec('begin');try{
   const run=await one(db,'select scope_hash from private.r12_etsy_steel_verification_runs where operation_id=$1',[id]);
   const selected=await one(db,'select review_hash from private.r12_candidate_setup_reviews where operation_id=$1',[ctx.a.scope.operationId]);
   const body={version:'r12.etsy-insights-renderer-qualification.2',requestHash:run.scope_hash,expiresAt:null,maximumRequests:policy.maximumRequests,policy,policyHash:hash(policy),landingControlsVersion:ctx.rendererReview.landingControlsVersion,landingControlsHash:ctx.rendererReview.landingControlsHash};
   const q={...body,qualificationHash:hash(body)};
   await db.query('insert into private.r12_verification_candidate_selections values($1,$2,clock_timestamp())',[id,selected.review_hash]);
   await db.query('insert into private.r12_direct_verification_renderer_qualifications values($1,$2,$3,clock_timestamp())',[id,q,q.qualificationHash]);
   await assert.rejects(one(db,'select private.r12_candidate_qualification($1,false)',[id]),/r12_candidate_saved_qualification_required/);
  }finally{await db.exec('rollback');}
 },beforeApproval:async({x,a,ownerAdapter,rendererReview,approval})=>{
  assert.equal(rendererReview.status,'awaiting_approval');assert.equal(rendererReview.sourceReadiness,'unqualified');assert.equal(Object.keys(rendererReview).length,11);
  const {rendererReviewHash,...legacyPayload}=approval;assert.ok(rendererReviewHash);
  await assert.rejects(ownerAdapter.approve(legacyPayload),/handoff_owner_state_unavailable/);await assert.rejects(ownerAdapter.approve({...approval,rendererReviewHash:'f'.repeat(64)}),/handoff_owner_state_unavailable/);
  await assert.rejects(x.owner('approve',legacyPayload),/r04_invalid_fields|object_keys_mismatch|r12_candidate_owner_review_changed|invalid.*keys/);
  await assert.rejects(a.admit('create'),/etsy_handoff_authority_inactive/);
  assert.equal((await one(db,'select count(*)::int n from private.r12_etsy_steel_approvals where operation_id=$1',[a.scope.operationId])).n,0);
 },afterRpc:async(operation,payload,result,ctx)=>{
  if(operation!=='admit_renderer')return;assert.deepEqual(Object.keys(result).sort(),[...keys].sort());assert.equal(result.accepted,true);assert.equal(result.allowed,payload.request.disposition==='allow');for(const key of keys.filter(k=>!['accepted','allowed'].includes(k)))assert.equal(result[key],payload.request[key]);
  await assert.rejects(ctx.x.verifier(operation,payload),/r12_candidate_decision_replayed/);
  for(const change of [{decisionHash:'e'.repeat(64)},{qualificationHash:'e'.repeat(64)},{policyHash:'e'.repeat(64)},{provenanceHash:'e'.repeat(64)},{requestId:randomUUID()}])await assert.rejects(ctx.x.verifier(operation,{...payload,request:{...payload.request,...change}}),/r12_candidate_decision_unqualified/);
 }});
 assert.ok(captured);
 for(const role of ['anon','authenticated','service_role']){
  for(const table of ['r12_verification_candidate_reviews','r12_verification_candidate_revocations','r12_verification_candidate_selections','r12_candidate_setup_reviews','r12_candidate_setup_approvals'])assert.equal((await one(db,"select has_table_privilege($1,$2,'select,insert,update,delete') allowed",[role,'private.'+table])).allowed,false);
  assert.equal((await one(db,"select bool_or(has_function_privilege($1,p.oid,'execute')) allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'r12_candidate_%'",[role])).allowed,false);
  assert.equal((await one(db,"select has_function_privilege($1,'public.r12_owner_etsy_steel_renderer_review(uuid,uuid)','execute') allowed",[role])).allowed,role==='authenticated');
 }
},{beforeCandidate:warmBeforeCandidate}));

test('candidate runtime rejects malformed exact acknowledgments before continuing blocked requests and still cleans up',{skip:!enabled,timeout:420000},async()=>inertDb(async db=>{
 const changes=[...keys.map(key=>({name:'missing '+key,change:r=>Object.fromEntries(Object.entries(r).filter(([k])=>k!==key))})),{name:'extra',change:r=>({...r,extra:true})},
  ...['decisionHash','qualificationHash','policyHash','provenanceHash'].map(key=>({name:'wrong '+key,change:r=>({...r,[key]:'f'.repeat(64)})})),
  {name:'sequence',change:r=>({...r,sequence:r.sequence+1})},{name:'disposition',change:r=>({...r,disposition:'allow'})},{name:'accepted',change:r=>({...r,accepted:false})},{name:'forged allowed',change:r=>({...r,allowed:true})}];
 for(const item of changes)await withCandidateVerification(db,async({ctx,h})=>{
  const result=await h.run();assert.equal(result.status,'paused',item.name);assert.equal(result.binding,null);const rows=await durable(db,ctx,h,result);assert.equal(rows.length,2);assert.equal(rows[1].disposition,'deny_candidate_ancillary');
  assert.equal(h.browser.cdpCommands.filter(x=>x.name==='Fetch.continueRequest').length,1,item.name+': only fixed landing GET may have continued');
  assert.equal((await one(db,'select count(*)::int n from private.r12_etsy_steel_verifications where binding_id=$1',[ctx.saved.bindingId])).n,0);
 },{requests:[{url:candidateScript,resourceType:'Script'}],acknowledge:(result,request)=>request.disposition==='deny_candidate_ancillary'?item.change(result):result});
}));

test('candidate identity cannot prepare research and blocked ancillary decisions cannot mask missing controls or material requests',{skip:!enabled,timeout:240000},async()=>inertDb(async db=>{
 let ctx,verifyPayload;
 await assert.rejects(candidateControllerFixture(db,{verificationOptions:{beforeRpc:async(operation,payload,current)=>{
  ctx=current;if(operation==='verify')verifyPayload=payload;
 }}}),/r12_candidate_research_unqualified/);
 assert.ok(verifyPayload);assert.equal((await one(db,'select count(*)::int n from private.r12_etsy_steel_verifications where binding_id=$1',[ctx.saved.bindingId])).n,1);
 assert.equal((await one(db,'select count(*)::int n from private.r12_direct_research_setups where envelope_id=$1',[ctx.a.scope.testEnvelopeId])).n,0);
 assert.equal((await one(db,"select count(*)::int n from private.r12_direct_request_bindings where envelope_id=$1 and kind in ('research_model','research_source')",[ctx.a.scope.testEnvelopeId])).n,0);
 await assert.rejects(ctx.authority.server('research_source_context',{testEnvelopeId:ctx.a.scope.testEnvelopeId,testEnvelopeHash:ctx.a.scope.testEnvelopeHash}),/r12_candidate_research_unqualified/);
 assert.equal((await ownerInitialRpc(db,ctx.a.scope.ownerId,'r12_owner_etsy_steel_verification_read',[ctx.a.scope.businessId,ctx.a.scope.operationId])).status,'verified');
 for(const item of [{name:'missing control',browserOptions:{missingInput:true}},{name:'unknown image',requests:[{url:candidateImage+'/other',resourceType:'Image'}]},{name:'material POST',requests:[{url:candidateScript,resourceType:'Script',method:'POST'}]},{name:'changed shop',browserOptions:{shop:'OtherShop'}}]){
  // landingSqlVerification owns shop from the approved scope; use the observed
  // label control mismatch rather than changing authority or manufacturing proof.
  const browserOptions=item.name==='changed shop'?{labelText:'Changed observed label'}:item.browserOptions;
  await withCandidateVerification(db,async({ctx,h})=>{const result=await h.run();assert.equal(result.status,'paused',item.name);assert.equal(result.binding,null);await durable(db,ctx,h,result);},
   {browserOptions,requests:item.requests??[{url:candidateScript,resourceType:'Script'},{url:candidateQueriedImage,resourceType:'Image'}]});
 }
}));

test('candidate owner sidecar rejects stale and cross-owner approval without reserving paid operations',{skip:!enabled,timeout:240000},async()=>inertDb(async db=>{
 const authority=await prepareDirectTestAuthorityFixture(db,{configureReview:c=>qualifyInertOwnerRenderer(db,c)}),reviewHash=await insertCandidateReview(db,authority);
 await authority.confirm();const x=await bindDirectHandoffFixture(db,authority),a=await x.prepare(),owner=candidateOwnerServer(db,a.scope),view=await owner.read();
 assert.equal(view.reviewHash,reviewHash);assert.equal(view.status,'awaiting_approval');
 const approval={operationId:a.scope.operationId,scopeHash:hash(a.scope),disclosureHash:a.scope.disclosureHash,expectedApprovalRevision:a.scope.approvalRevision,persistentAccessApproved:true,budgetApproved:true,rendererReviewHash:reviewHash};
 for(const change of [{scopeHash:'f'.repeat(64)},{disclosureHash:'f'.repeat(64)},{expectedApprovalRevision:randomUUID()},{persistentAccessApproved:false},{budgetApproved:false}])await assert.rejects(owner.approve({...approval,...change}),/handoff_owner_approval_required/);
 const outsider=randomUUID(),business=randomUUID();await db.query('insert into auth.users(id,email) values($1,$2)',[outsider,outsider+'@example.invalid']);await db.query('insert into public.businesses(id,owner_user_id,name) values($1,$2,$3)',[business,outsider,'Inert unrelated owner']);
 await assert.rejects(ownerInitialRpc(db,outsider,'r12_owner_etsy_steel_renderer_review',[a.scope.businessId,a.scope.operationId]),/owner/);
 assert.equal(await ownerInitialRpc(db,outsider,'r12_owner_etsy_steel_renderer_review',[business,a.scope.operationId]),null);
 await assert.rejects(x.owner('approve',approval,outsider),/owner/);
 await db.query('insert into private.r12_verification_candidate_revocations(review_hash) values($1)',[reviewHash]);
 assert.equal((await owner.read()).status,'inactive');await assert.rejects(owner.approve(approval),/handoff_owner_state_unavailable/);
 const newer=await insertCandidateReview(db,authority,{policyValue:{...policy,maximumRequests:255}});assert.notEqual(newer,reviewHash);
 assert.equal((await owner.read()).reviewHash,reviewHash);assert.equal((await owner.read()).status,'inactive');await assert.rejects(x.owner('approve',{...approval,rendererReviewHash:newer}),/r12_candidate_owner_review_changed/);
 assert.equal((await one(db,'select count(*)::int n from private.r12_etsy_steel_approvals where operation_id=$1',[a.scope.operationId])).n,0);
 assert.equal((await one(db,'select count(*)::int n from private.r05_reservations where request_id=$1',[a.prepared.requestId])).n,0);
 await owner.stop();assert.equal((await x.owner('read',{operationId:a.scope.operationId})).status,'stopped');assert.equal((await owner.read()).status,'inactive');
}));
