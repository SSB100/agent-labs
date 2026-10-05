import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const businessId='11000000-0000-4000-8000-000000000001',policyId='11000000-0000-4000-8000-000000000003',grantId='11000000-0000-4000-8000-000000000004',workflowRunId='11000000-0000-4000-8000-000000000005',grantHash='a'.repeat(64);
class PublicResearchQualificationError extends Error { constructor(recorded){super('private-provider-secret-diagnostic');this.recorded=recorded;this.outcomeId=null;this.reason='private-provider-secret-reason';} }
function fixture({owned=true,signedIn=true,fail=false,runError=null}={}){
 const calls=[],revalidations=[],context={userId:'owner'};let ownershipChecks=0,authCalls=0;
 const deps={'@/research/qualification-outcome':{PublicResearchQualificationError},'next/cache':{revalidatePath:path=>revalidations.push(path)},'next/navigation':{redirect:path=>{throw Error(`REDIRECT:${path}`);}},'@/lib/core-ui/data':{requireOwnerUiContext:async()=>{authCalls++;if(!signedIn)throw Error('REDIRECT:/login');return context;}},'@/lib/core-ui/owner-business':{verifyOwnerBusiness:async(c,b)=>{assert.equal(c,context);assert.equal(b,businessId);ownershipChecks++;return owned;}},'@/research/qualification-server':Object.fromEntries(['prepareResearchBootstrap','activateResearchGrant','runResearchProof','stopResearchProof','reconcileResearchProof'].map(name=>[name,async(...args)=>{calls.push({name,args});if(name==='runResearchProof'&&runError)throw runError;if(fail)throw Error('private-secret-diagnostic');return{businessId,policyId,workflowRunId,serverKeyHash:grantHash,quote:{maximumMicrousd:250000}};}]))};
 const source=ts.transpileModule(readFileSync('src/app/dashboard/research-qualification/actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,m={exports:{}};
 runInNewContext(`(function(require,module,exports){${source}\n})`,{})(name=>{assert.ok(name in deps,name);return deps[name];},m,m.exports);return{...m.exports,calls,revalidations,ownershipChecks:()=>ownershipChecks,authCalls:()=>authCalls};
}
function form(overrides={}){const data=new FormData();for(const [key,value]of Object.entries({businessId,policyId,workflowRunId,grantId,grantHash,readConsent:'on',retentionConsent:'on',...overrides}))data.set(key,value);return data;}
const initial={status:'idle',message:'',preparation:null};
test('explicit preparation uses exact stable IDs and returns only the sanctioned nonsecret metadata',async()=>{
 const f=fixture();for(let i=0;i<2;i++){const state=await f.prepareResearchSetup(initial,form());assert.equal(state.status,'prepared');assert.equal(state.preparation.policyId,policyId);assert.match(state.message,/No grant was installed/);}assert.equal(f.calls.length,2);for(const call of f.calls){assert.equal(call.name,'prepareResearchBootstrap');assert.deepEqual(call.args.slice(1),[businessId,policyId,workflowRunId]);}assert.equal(f.revalidations.length,0);
});
test('prepare rejects malformed and duplicate scope before auth or quote work',async()=>{
 for(const field of ['businessId','policyId','workflowRunId']){const f=fixture(),data=form({[field]:'bad'});assert.equal((await f.prepareResearchSetup(initial,data)).status,'unavailable');assert.equal(f.authCalls(),0);assert.equal(f.calls.length,0);}
 const f=fixture(),data=form();data.append('policyId',policyId);assert.equal((await f.prepareResearchSetup(initial,data)).status,'unavailable');assert.equal(f.authCalls(),0);
});
test('owner lookup failure blocks preparation and mutations without reading provider configuration',async()=>{
 const f=fixture({owned:false});assert.equal((await f.prepareResearchSetup(initial,form())).status,'unavailable');for(const name of ['activateResearchProof','runResearchProofAction','stopResearchProofAction','reconcileResearchProofAction'])await assert.rejects(f[name](form()),/REDIRECT:\/dashboard\/research-qualification\?business=/);assert.equal(f.calls.length,0);assert.equal(f.ownershipChecks(),5);
});
test('activation requires both consent statements and exact grant fingerprint',async()=>{
 for(const overrides of [{readConsent:'off'},{retentionConsent:'off'},{grantHash:'bad'},{grantId:'bad'}]){const f=fixture();await assert.rejects(f.activateResearchProof(form(overrides)),/notice=consent-required/);assert.equal(f.calls.length,0);assert.equal(f.authCalls(),0);}
 const f=fixture();for(let i=0;i<2;i++)await assert.rejects(f.activateResearchProof(form()),/notice=review-activation/);for(const call of f.calls){assert.equal(call.name,'activateResearchGrant');assert.deepEqual(call.args.slice(1),[businessId,grantId,grantHash]);}
});
test('Run and Stop pass only exact policy scope and never create a new execution identity',async()=>{
 const f=fixture();for(const name of ['runResearchProofAction','runResearchProofAction','stopResearchProofAction','reconcileResearchProofAction'])await assert.rejects(f[name](form()),/REDIRECT:/);assert.deepEqual(f.calls.map(c=>c.name),['runResearchProof','runResearchProof','stopResearchProof','reconcileResearchProof']);for(const call of f.calls)assert.deepEqual(call.args.slice(1),[businessId,policyId]);assert.deepEqual(f.revalidations,Array(4).fill('/dashboard/research-qualification'));
});
test('failure feedback redacts errors and never claims activation, evidence, or confirmed Stop',async()=>{
 const f=fixture({fail:true}),state=await f.prepareResearchSetup(initial,form());assert.equal(state.status,'unavailable');assert.equal(state.preparation,null);assert.doesNotMatch(state.message,/private-secret/);await assert.rejects(f.activateResearchProof(form()),/notice=check-saved-state/);await assert.rejects(f.runResearchProofAction(form()),/notice=review-proof/);await assert.rejects(f.stopResearchProofAction(form()),/notice=review-stop/);await assert.rejects(f.reconcileResearchProofAction(form()),/notice=review-reconciliation/);
});
test('session recovery redirects are preserved instead of becoming fake result notices',async()=>{
 const f=fixture({signedIn:false});for(const name of ['activateResearchProof','runResearchProofAction','stopResearchProofAction','reconcileResearchProofAction'])await assert.rejects(f[name](form()),/^Error: REDIRECT:\/login$/);await assert.rejects(f.prepareResearchSetup(initial,form()),/^Error: REDIRECT:\/login$/);assert.equal(f.calls.length,0);assert.equal(f.revalidations.length,0);
});
test('malformed Business never reaches an auth or mutation service',async()=>{
 const f=fixture();for(const name of ['activateResearchProof','runResearchProofAction','stopResearchProofAction','reconcileResearchProofAction'])await assert.rejects(f[name](form({businessId:'foreign'})),/Exact Business unavailable/);assert.equal(f.authCalls(),0);assert.equal(f.calls.length,0);
});

test('continuation preparation binds the predecessor but creates no authority or dispatch',async()=>{
 const f=fixture(),predecessorPolicyId='11000000-0000-4000-8000-000000000006';
 for(let i=0;i<2;i++)assert.equal((await f.prepareResearchSetup(initial,form({mode:'continuation',predecessorPolicyId}))).status,'prepared');
 assert.equal(f.calls.length,2);for(const call of f.calls){assert.equal(call.name,'prepareResearchBootstrap');assert.deepEqual(call.args.slice(1),[businessId,policyId,workflowRunId,predecessorPolicyId]);}assert.equal(f.revalidations.length,0);
});
test('ambiguous continuation mode or predecessor is rejected before ownership and quote reads',async()=>{
 const predecessorPolicyId='11000000-0000-4000-8000-000000000006';
 for(const overrides of [{mode:'bad'},{mode:'continuation'},{mode:'continuation',predecessorPolicyId:'bad'},{mode:'continuation',predecessorPolicyId:policyId},{mode:'initial',predecessorPolicyId},{predecessorPolicyId}]){
  const f=fixture();assert.equal((await f.prepareResearchSetup(initial,form(overrides))).status,'unavailable');assert.equal(f.authCalls(),0);assert.equal(f.calls.length,0);
 }
 for(const field of ['mode','predecessorPolicyId']){const f=fixture(),data=form({mode:'continuation',predecessorPolicyId});data.append(field,data.get(field));assert.equal((await f.prepareResearchSetup(initial,data)).status,'unavailable');assert.equal(f.authCalls(),0);}
});
test('legacy Stop reconciliation is explicit and separate from Run, ordinary Stop and preparation',async()=>{
 const f=fixture();for(let i=0;i<2;i++)await assert.rejects(f.reconcileResearchProofAction(form()),/notice=review-reconciliation/);
 assert.deepEqual(f.calls.map(call=>call.name),['reconcileResearchProof','reconcileResearchProof']);for(const call of f.calls)assert.deepEqual(call.args.slice(1),[businessId,policyId]);assert.deepEqual(f.revalidations,Array(2).fill('/dashboard/research-qualification'));
});

test('an unsaved typed failure diagnostic gets a dedicated safe notice without retrying',async()=>{
 const f=fixture({runError:new PublicResearchQualificationError(false)});
 await assert.rejects(f.runResearchProofAction(form()),error=>{assert.match(error.message,/notice=diagnostic-unavailable$/);assert.doesNotMatch(error.message,/private-provider-secret/);return true;});
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'runResearchProof');assert.deepEqual(f.calls[0].args.slice(1),[businessId,policyId]);assert.deepEqual(f.revalidations,['/dashboard/research-qualification']);
});
test('saved typed failures and generic lookalikes require durable outcome readback',async()=>{
 for(const runError of [new PublicResearchQualificationError(true),Object.assign(Error('private-provider-secret'),{recorded:false,outcomeId:null}),{recorded:false,reason:'private-provider-secret'}]){
  const f=fixture({runError});await assert.rejects(f.runResearchProofAction(form()),/notice=review-proof$/);assert.equal(f.calls.length,1);
 }
});
