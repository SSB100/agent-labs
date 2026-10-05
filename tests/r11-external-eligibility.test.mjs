import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {verifyExternalEligibility,canonicalSourceDomains,externalSourceProvenance}=require('../.core-tests/core/external-eligibility.js');
const {requireRuntimeExternalSourceEligibility}=require('../.core-tests/lib/external-eligibility-runtime.js');
const {modelDispatchAdmission}=require('../.core-tests/lib/admission-runtime.js');
const id=n=>`11000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const now=Date.parse('2026-10-04T23:00:00Z');
function fixture(){
 const use={version:'r11.1',businessId:id(1),ownerId:id(2),applicationId:'inert.application.v1',provider:'openrouter',operation:'research.model',purpose:'bounded.research',dataUse:'retained_source_analysis',sourceDomains:['approved.example'],dataClasses:['public_evidence'],recipient:'openrouter',accountId:null,accountRevision:null,externalAccountId:null,lineageHash:'1'.repeat(64),evidenceId:id(3)};
 const snapshot={revoked:false,evidence:{id:id(3),version:'r11.1',use:structuredClone(use),approvalDocumentHash:'2'.repeat(64),termsReviewHash:'3'.repeat(64),independentReviewHash:'4'.repeat(64),retentionPolicyHash:'5'.repeat(64),validFrom:'2026-10-04T22:00:00Z',validUntil:'2026-10-05T00:00:00Z'}};
 return{use,snapshot};
}
test('R11 pure evidence contract accepts only an exact inert use; production source loader has no enabled records',()=>{
 const {use,snapshot}=fixture();verifyExternalEligibility(use,snapshot,now);
 assert.throws(()=>requireRuntimeExternalSourceEligibility({version:'r11.1',kind:'external_sources',requestHash:'a'.repeat(64),sourceDomains:use.sourceDomains,lineageHash:use.lineageHash}),/^Error: external_source_eligibility_unavailable$/);
});
for(const [key,value] of Object.entries({businessId:id(5),ownerId:id(6),applicationId:'other.application',provider:'other',operation:'research.search',purpose:'different.purpose',dataUse:'public_source_collection',recipient:'other.model',accountId:id(7),accountRevision:id(8),externalAccountId:'999',lineageHash:'6'.repeat(64),evidenceId:id(9)})){
 test(`R11 exact evidence rejects changed ${key}`,()=>{const {use,snapshot}=fixture();assert.throws(()=>verifyExternalEligibility({...use,[key]:value},snapshot,now),/eligibility_unavailable/);});
}
for(const changed of [null,{}, {revoked:true}, {revoked:null}, {revoked:undefined}])test('R11 absent or ambiguous revocation proof denies',()=>{
 const {use,snapshot}=fixture();assert.throws(()=>verifyExternalEligibility(use,changed===null?null:{...snapshot,...changed,...(Object.keys(changed).length?{}:{evidence:null})},now),/eligibility_unavailable/);
});
for(const key of ['approvalDocumentHash','termsReviewHash','independentReviewHash','retentionPolicyHash'])test(`R11 missing ${key} cannot use a bare credential or eligibility hash`,()=>{
 const {use,snapshot}=fixture();snapshot.evidence[key]='Personal Access';assert.throws(()=>verifyExternalEligibility(use,snapshot,now),/eligibility_unavailable/);
});
for(const [field,value] of [['validFrom','2026-10-04T23:00:00.001Z'],['validUntil','2026-10-04T23:00:00Z'],['validFrom','invalid'],['validUntil','invalid']])test(`R11 ${field} ${value} fails closed`,()=>{
 const {use,snapshot}=fixture();snapshot.evidence[field]=value;assert.throws(()=>verifyExternalEligibility(use,snapshot,now),/eligibility_unavailable/);
});
test('R11 unknown clocks, broadened data and subdomain use do not inherit eligibility',()=>{
 const {use,snapshot}=fixture();for(const clock of [NaN,Infinity])assert.throws(()=>verifyExternalEligibility(use,snapshot,clock));
 for(const change of [{dataClasses:['public_evidence','buyer_email']},{sourceDomains:['sub.approved.example']},{sourceDomains:['approved.example','etsy.com']}])assert.throws(()=>verifyExternalEligibility({...use,...change},snapshot,now));
});
test('R11 own-shop use requires exact account and revision and never grants research rights',()=>{
 const {use,snapshot}=fixture();Object.assign(use,{dataUse:'own_shop_operations',provider:'etsy',accountId:id(10),accountRevision:id(11),externalAccountId:'123'});snapshot.evidence.use=structuredClone(use);verifyExternalEligibility(use,snapshot,now);
 for(const change of [{accountId:null,accountRevision:null,externalAccountId:null},{accountRevision:id(12)},{dataUse:'retained_source_analysis'}])assert.throws(()=>verifyExternalEligibility({...use,...change},snapshot,now));
});
for(const value of [[],['*.etsy.com'],['ETSY.COM'],['https://etsy.com'],['etsy.com/'],['etsy.com.'],['etsy.com','etsy.com'],['localhost'],['user@etsy.com'],['etsy.com:443'],['foo..com'],Array.from({length:33},(_,i)=>`s${i}.example`)])test(`R11 rejects noncanonical/unbounded source scope ${JSON.stringify(value).slice(0,80)}`,()=>assert.throws(()=>canonicalSourceDomains(value)));
test('R11 retained-source analysis cannot erase provenance by omitting search tools',()=>{
 assert.throws(()=>externalSourceProvenance(['public_evidence'],[],undefined,'a'.repeat(64),'research.model'),/provenance_required/);
 assert.throws(()=>externalSourceProvenance(['public_evidence'],[],{version:'r11.1',kind:'external_sources',requestHash:'a'.repeat(64),sourceDomains:[],lineageHash:'1'.repeat(64)},'a'.repeat(64),'research.model'));
 const input={version:'r11.1',kind:'external_sources',requestHash:'a'.repeat(64),sourceDomains:['etsy.com'],lineageHash:'1'.repeat(64)};
 const result=externalSourceProvenance(['public_evidence'],[],input,'a'.repeat(64),'research.model');input.sourceDomains[0]='other.example';assert.deepEqual(result.sourceDomains,['etsy.com']);
 assert.throws(()=>externalSourceProvenance(['public_evidence'],['other.example'],result,'a'.repeat(64),'research.search'),/provenance_mismatch/);
});
test('R11 production model denies missing and even well-formed unqualified source lineage before any RPC',async t=>{
 const prior=process.env.R05_ADMISSION_SERVER_KEY;process.env.R05_ADMISSION_SERVER_KEY='inert-unusable-key';t.after(()=>{if(prior===undefined)delete process.env.R05_ADMISSION_SERVER_KEY;else process.env.R05_ADMISSION_SERVER_KEY=prior;});
 const scope={businessId:id(1),coreWorkflowRunId:id(2),runtimeCapability:'inert'},base={operationKey:'research.model',requestHash:'a'.repeat(64),callKey:'analysis:1',reservedMicrousd:100,providerModelId:'inert/model',accounting:{kind:'research',callKey:'analysis:1'},dataClasses:['public_evidence']};
 const wire={url:'https://openrouter.ai/api/v1/chat/completions',method:'POST',body:JSON.stringify({model:'inert/model',max_tokens:10,stream:false,messages:[{role:'user',content:'INERT SOURCE FIXTURE'}]})};
 await assert.rejects(modelDispatchAdmission(scope,base)(wire),/external_source_provenance_required/);
 await assert.rejects(modelDispatchAdmission(scope,{...base,sourceProvenance:{version:'r11.1',kind:'external_sources',requestHash:'a'.repeat(64),sourceDomains:['etsy.com'],lineageHash:'1'.repeat(64)}})(wire),/^Error: external_source_eligibility_unavailable$/);
});

test('R11 explicit source-free assertion binds exact saved request and never covers source-bearing classes or search',()=>{
 const value={version:'r11.1',kind:'source_free',requestHash:'a'.repeat(64)};
 assert.equal(externalSourceProvenance(['business_context'],[],value,'a'.repeat(64),'creative.text'),null);
 for(const data of [['business_context'],['private_image'],['product_evidence'],['public_evidence']])assert.throws(()=>externalSourceProvenance(data,[],undefined,'a'.repeat(64),'creative.text'),/provenance_required/);
 for(const data of [['product_evidence'],['public_evidence']])assert.throws(()=>externalSourceProvenance(data,[],value,'a'.repeat(64),'listing.specialist'),/provenance_mismatch/);
 assert.throws(()=>externalSourceProvenance(['business_context'],[],value,'b'.repeat(64),'creative.text'),/provenance_required/);
 for(const domains of [[],['etsy.com']])assert.throws(()=>externalSourceProvenance(['business_context'],domains,value,'a'.repeat(64),'research.search'));
 assert.throws(()=>externalSourceProvenance(['business_context'],[],{...value,sourceDomains:['etsy.com']},'a'.repeat(64),'creative.text'));
});
