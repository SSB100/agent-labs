import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createHmac} from 'node:crypto';
const require=createRequire(import.meta.url),ts=require('typescript');
const core=path.resolve(process.env.R12_ENROLLMENT_CORE_DIR??'.core-tests');
const contract=require(path.join(core,'products/discovery-r12-direct-enrollment-contracts.js'));
const {publicResearchHash:hash}=require(path.join(core,'products/discovery-r12-public-utils.js'));
const uuid=n=>`b3100000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const pins={businessId:uuid(1),goalId:uuid(2),ownerId:uuid(3)};
const clone=x=>structuredClone(x);
function fixture(){
 const createdAt=new Date(Date.now()-1000).toISOString(),expiresAt=new Date(Date.now()+3600000).toISOString();
 const qualification=Object.fromEntries(['releaseHash','routeHash','tariffHash','sourceQualificationHash','ownerRendererReviewHash','verificationCandidateReviewHash','researchRendererReviewHash','landingControlsHash'].map(k=>[k,hash(k)]));qualification.reviewExpiresAt=expiresAt;
 const preview={version:'r12.owner-direct-enrollment-proposal.1',...pins,reviewedPackageHash:hash('reviewed'),grantId:uuid(4),profileId:uuid(5),authorityRootId:uuid(6),bindingId:uuid(7),originHash:hash('original'),businessRevision:12,businessHash:hash('business'),goalRevision:8,goalHash:hash('goal'),currentGrantRoot:{rootId:uuid(8),revision:1,revisionHash:hash('previous'),maximumScopes:5,maximumAllocationMicrounits:'18000000',scopesUsed:5,allocationUsedMicrounits:'18000000'},proposedGrantRoot:{revision:2,previousHash:hash('previous'),maximumScopes:6,maximumAllocationMicrounits:'28000000',expiresAt},testBounds:{currency:'USD',maximumTestMicrounits:'10000000',maximumUnitsInWindow:10,cumulativeDispatchesCeiling:60},qualification,expiresAt,authorityCreated:false};
 const receipt={version:'r12.owner-direct-enrollment-receipt.1',businessId:pins.businessId,goalId:pins.goalId,proposalId:uuid(9),proposalHash:hash(preview),confirmed:false,createdAt,expiresAt,preview};
 const offer={reviewedPackageHash:preview.reviewedPackageHash,grantId:preview.grantId,expiresAt,testBounds:clone(preview.testBounds),qualification:clone(qualification)};
 const catalog={version:'r12.owner-direct-enrollment-catalog.1',...pins,eligible:true,reason:null,offers:[offer],current:null};
 return{preview,receipt,offer,catalog};
}
const rehash=r=>(r.proposalHash=hash(r.preview),r);
test('enrollment projections show cumulative allocated allowance separately from the finite test cash cap',()=>{
 const f=fixture(),r=contract.validateDirectEnrollmentReceipt(f.receipt,pins);assert.deepEqual(r,f.receipt);assert.notEqual(r,f.receipt);
 assert.equal(r.preview.currentGrantRoot.allocationUsedMicrounits,'18000000');assert.equal(r.preview.proposedGrantRoot.maximumAllocationMicrounits,'28000000');
 assert.deepEqual(contract.validateDirectEnrollmentCatalog(f.catalog,pins),f.catalog);
 const confirmed={...f.receipt,confirmed:true};assert.equal(contract.validateDirectEnrollmentReceipt(confirmed,pins).confirmed,true);assert.equal(confirmed.preview.authorityCreated,false,'Preview remains a pre-confirmation record, not the grant receipt status');
});
for(const [name,change] of [
 ['new root',r=>{r.preview.proposedGrantRoot.rootId=uuid(12);}],['reset allocation',r=>{r.preview.proposedGrantRoot.maximumAllocationMicrounits='10000000';}],
 ['omit old scopes',r=>{r.preview.proposedGrantRoot.maximumScopes=1;}],['extra scope',r=>{r.preview.proposedGrantRoot.maximumScopes=7;}],
 ['changed previous hash',r=>{r.preview.proposedGrantRoot.previousHash=hash('other');}],['skip revision',r=>{r.preview.proposedGrantRoot.revision=3;}],
 ['uncovered historical allocation',r=>{r.preview.currentGrantRoot.allocationUsedMicrounits='19000000';}],['uncovered historical scopes',r=>{r.preview.currentGrantRoot.scopesUsed=6;}],
 ['oversize test',r=>{r.preview.testBounds.maximumTestMicrounits='10000001';}],['zero test',r=>{r.preview.testBounds.maximumTestMicrounits='0';}],
 ['unbounded window',r=>{r.preview.testBounds.maximumUnitsInWindow=33;}],['invalid lifetime dispatch bound',r=>{r.preview.testBounds.cumulativeDispatchesCeiling=3;}],
 ['fabricated approval',r=>{r.preview.authorityCreated=true;}],['raw provider profile',r=>{r.preview.qualification.profileId=uuid(11);}],
 ['wrong owner',r=>{r.preview.ownerId=uuid(12);}],['wrong Goal',r=>{r.preview.goalId=uuid(12);}],
 ['extend review expiry',r=>{r.preview.qualification.reviewExpiresAt=r.createdAt;}],['bad timestamp',r=>{r.createdAt='not a time';}],
 ])test(`enrollment receipt rejects ${name}`,()=>{const f=fixture();change(f.receipt);rehash(f.receipt);assert.throws(()=>contract.validateDirectEnrollmentReceipt(f.receipt,pins),/r12_direct_enrollment_unavailable/);});
test('repair-aware window and actual-dispatch ceilings are distinct bounds',()=>{
 const f=fixture();f.receipt.preview.testBounds.maximumUnitsInWindow=32;f.receipt.preview.testBounds.cumulativeDispatchesCeiling=64;rehash(f.receipt);
 assert.equal(contract.validateDirectEnrollmentReceipt(f.receipt,pins).preview.testBounds.maximumUnitsInWindow,32);
 // This validates a reviewed envelope only. Actual SQL must reserve each
 // cycle/repair suffix against retained cumulative dispatches before sending.
});
test('valid above-base historical usage requires separate review instead of an automatic catch-up proposal',()=>{
 const f=fixture(),p=f.receipt.preview;p.currentGrantRoot.maximumScopes=1;p.currentGrantRoot.maximumAllocationMicrounits='2000000';
 // Such history can be genuine under older explicit grants. This narrow
 // endpoint does not reinterpret it as a fresh extension approval.
 rehash(f.receipt);const before=clone(f.receipt);assert.throws(()=>contract.validateDirectEnrollmentReceipt(f.receipt,pins));assert.deepEqual(f.receipt,before);
 const unavailable={...f.catalog,eligible:false,reason:'reviewed_package_required',offers:[],current:null};
 assert.deepEqual(contract.validateDirectEnrollmentCatalog(unavailable,pins),unavailable);
});
test('input and confirmation allow references only, never owner-selected reviews, limits, verifier or authority',()=>{
 const f=fixture(),i={version:'r12.owner-direct-enrollment-input.1',goalId:pins.goalId,reviewedPackageHash:f.preview.reviewedPackageHash,submissionId:uuid(15)};
 assert.deepEqual(contract.validateDirectEnrollmentInput(i),i);
 for(const k of ['rootId','bootstrapKeyHash','qualified','maximumTestMicrounits','tariff','profileId'])assert.throws(()=>contract.validateDirectEnrollmentInput({...i,[k]:'forged'}));
 const c={version:'r12.owner-direct-enrollment-confirmation.1',proposalId:f.receipt.proposalId,proposalHash:f.receipt.proposalHash,submissionId:uuid(16)};assert.deepEqual(contract.validateDirectEnrollmentConfirmation(c),c);
 assert.throws(()=>contract.validateDirectEnrollmentConfirmation({...c,grantId:f.preview.grantId}));
});
test('historical selected receipts remain readable but cannot advertise another offer',()=>{
 const f=fixture();f.receipt.createdAt='2020-01-01T00:00:00.000Z';f.receipt.expiresAt=f.receipt.preview.expiresAt=f.receipt.preview.proposedGrantRoot.expiresAt=f.receipt.preview.qualification.reviewExpiresAt='2020-01-02T00:00:00.000Z';f.receipt.confirmed=true;rehash(f.receipt);
 const c={...f.catalog,eligible:false,reason:'historical_selection',offers:[],current:f.receipt};assert.deepEqual(contract.validateDirectEnrollmentCatalog(c,{...pins,proposalId:f.receipt.proposalId}),c);
 assert.throws(()=>contract.validateDirectEnrollmentCatalog({...c,offers:[f.offer]},{...pins,proposalId:f.receipt.proposalId}));
 assert.throws(()=>contract.validateDirectEnrollmentCatalog({...c,current:null},{...pins,proposalId:f.receipt.proposalId}));
});
test('pending review is explicit and malformed catalog cannot impersonate eligibility',()=>{
 const f=fixture();for(const reason of contract.DIRECT_ENROLLMENT_REASONS)assert.equal(contract.validateDirectEnrollmentCatalog({...f.catalog,eligible:false,reason,offers:[]},pins).eligible,false);
 for(const bad of [{...f.catalog,offers:[]},{...f.catalog,reason:'ready'},{...f.catalog,offers:[f.offer,f.offer]},{...f.catalog,ownerId:uuid(10)},{...f.catalog,eligible:false,reason:null}])assert.throws(()=>contract.validateDirectEnrollmentCatalog(bad,pins));
});
test('untrusted descriptor/serialization code is never executed by projection validation',()=>{
 let invoked=0;const f=fixture();Object.defineProperty(f.receipt,'preview',{get(){invoked++;return{};},enumerable:true});assert.throws(()=>contract.validateDirectEnrollmentReceipt(f.receipt));assert.equal(invoked,0);
 const j=fixture();j.receipt.toJSON=()=>{invoked++;return{};};assert.throws(()=>contract.validateDirectEnrollmentReceipt(j.receipt));assert.equal(invoked,0);
});
function loadActualServer(){
 const compile=(file,imports)=>{const source=readFileSync(file,'utf8'),compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2017,module:ts.ModuleKind.CommonJS}}).outputText;const compiledModule={exports:{}};new Function('require','module','exports',compiled)(name=>{if(Object.hasOwn(imports,name))return imports[name];throw Error('Unexpected dependency '+name);},compiledModule,compiledModule.exports);return compiledModule.exports;};
 const owner=compile('src/lib/core-ui/owner-business.ts',{});
 return compile('src/products/discovery-r12-direct-enrollment-server.ts',{'server-only':{},'node:crypto':require('node:crypto'),'../lib/core-ui/owner-business':owner,'../core/request-deadline':require(path.join(core,'core/request-deadline.js')),'./discovery-r12-public-utils':require(path.join(core,'products/discovery-r12-public-utils.js')),'./discovery-r12-direct-enrollment-contracts':contract});
}
function serverFixture(){
 const f=fixture(),calls=[];let user=pins.ownerId,claimsError=false,readReply=null,writeReply=null;
 const context={userId:pins.ownerId,businesses:[{id:pins.businessId}],supabase:{auth:{getClaims:async()=>({data:{claims:{sub:user}},error:claimsError?'denied':null})},rpc:async(name,args)=>{
  calls.push({name,args});if(name==='r12_owner_direct_enrollment_read')return{data:readReply??(args.p_proposal_id?{...f.catalog,eligible:false,reason:'historical_selection',offers:[],current:f.receipt}:f.catalog),error:null};
  return{data:writeReply??{...f.receipt,confirmed:args.p_operation==='confirm'},error:null};
 }}};
 return{...f,calls,context,setUser:x=>{user=x;},setClaimsError:x=>{claimsError=x;},setRead:x=>{readReply=x;},setWrite:x=>{writeReply=x;}};
}
test('actual owner server composes read, exact pending proposal and separately confirmed grant without provider transport',async()=>{
 const saved={VERCEL_ENV:process.env.VERCEL_ENV,R05_ADMISSION_SERVER_KEY:process.env.R05_ADMISSION_SERVER_KEY};let external=0;const priorFetch=globalThis.fetch;globalThis.fetch=async()=>{external++;throw Error('No provider transport');};
 Object.assign(process.env,{VERCEL_ENV:'production',R05_ADMISSION_SERVER_KEY:'inert-enrollment-root-'.repeat(3)});
 try{const api=loadActualServer(),f=serverFixture();
  const r=await api.prepareDirectEnrollment(f.context,pins.businessId,pins.goalId,f.preview.reviewedPackageHash);assert.equal(r.confirmed,false);
  const write=f.calls.find(c=>c.args.p_operation==='prepare');assert.deepEqual(Object.keys(write.args.p_payload).sort(),['goalId','reviewedPackageHash','submissionId','version']);
  const expected=createHmac('sha256',process.env.R05_ADMISSION_SERVER_KEY).update(JSON.stringify({version:'r12.owner-bootstrap.1',businessId:pins.businessId,ownerId:pins.ownerId,grantId:f.preview.grantId})).digest('base64url');assert.equal(write.args.p_server_key,expected);
  const confirmed=await api.confirmDirectEnrollment(f.context,pins.businessId,pins.goalId,r.proposalId,r.proposalHash);assert.equal(confirmed.confirmed,true);assert.equal(f.calls.filter(c=>c.args.p_operation==='confirm').length,1);
  f.receipt.confirmed=true;await api.confirmDirectEnrollment(f.context,pins.businessId,pins.goalId,r.proposalId,r.proposalHash);assert.equal(f.calls.filter(c=>c.args.p_operation==='confirm').length,1,'Exact confirmed replay is read-only');
  assert.equal(external,0);assert.equal(JSON.stringify(confirmed).includes(expected),false);
 }finally{globalThis.fetch=priorFetch;for(const[k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
for(const [name,mutate,action] of [
 ['wrong authenticated owner',f=>f.setUser(uuid(91)),'prepare'],['failed owner claims',f=>f.setClaimsError(true),'prepare'],
 ['absent reviewed package',f=>{f.catalog.offers=[];f.catalog.eligible=false;f.catalog.reason='reviewed_package_required';},'prepare'],
 ['expired offer',f=>{f.offer.expiresAt='2020-01-01T00:00:00.000Z';},'prepare'],
 ['expired pending proposal',f=>{f.receipt.createdAt='2020-01-01T00:00:00.000Z';f.receipt.expiresAt=f.receipt.preview.expiresAt='2020-01-02T00:00:00.000Z';rehash(f.receipt);},'confirm'],
 ['foreign read projection',f=>f.setRead({...f.catalog,ownerId:uuid(92)}),'prepare'],
 ])test(`actual owner server denies ${name} before enrollment mutation`,async()=>{
 const env={VERCEL_ENV:process.env.VERCEL_ENV,R05_ADMISSION_SERVER_KEY:process.env.R05_ADMISSION_SERVER_KEY};Object.assign(process.env,{VERCEL_ENV:'production',R05_ADMISSION_SERVER_KEY:'inert-enrollment-root-'.repeat(3)});
 try{const api=loadActualServer(),f=serverFixture();mutate(f);await assert.rejects(action==='prepare'?api.prepareDirectEnrollment(f.context,pins.businessId,pins.goalId,f.preview.reviewedPackageHash):api.confirmDirectEnrollment(f.context,pins.businessId,pins.goalId,f.receipt.proposalId,f.receipt.proposalHash));assert.equal(f.calls.filter(x=>x.name.endsWith('_server')).length,0);}finally{for(const[k,v]of Object.entries(env))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
test('actual server rejects swapped grant, changed reviewed bounds and unconfirmed mutation readbacks',async()=>{
 const env={VERCEL_ENV:process.env.VERCEL_ENV,R05_ADMISSION_SERVER_KEY:process.env.R05_ADMISSION_SERVER_KEY};Object.assign(process.env,{VERCEL_ENV:'production',R05_ADMISSION_SERVER_KEY:'inert-enrollment-root-'.repeat(3)});
 try{const api=loadActualServer();for(const change of [r=>{r.preview.grantId=uuid(93);},r=>{r.preview.testBounds.maximumUnitsInWindow=9;},r=>{r.confirmed=true;}]){const f=serverFixture(),r=clone(f.receipt);change(r);rehash(r);f.setWrite(r);await assert.rejects(api.prepareDirectEnrollment(f.context,pins.businessId,pins.goalId,f.preview.reviewedPackageHash));}
  const f=serverFixture();f.setWrite(f.receipt);await assert.rejects(api.confirmDirectEnrollment(f.context,pins.businessId,pins.goalId,f.receipt.proposalId,f.receipt.proposalHash));
 }finally{for(const[k,v]of Object.entries(env))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
