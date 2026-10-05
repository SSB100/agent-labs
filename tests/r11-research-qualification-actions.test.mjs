import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const businessId='11000000-0000-4000-8000-000000000001',policyId='11000000-0000-4000-8000-000000000003',grantId='11000000-0000-4000-8000-000000000004',workflowRunId='11000000-0000-4000-8000-000000000005',grantHash='a'.repeat(64);
function fixture({owned=true,signedIn=true,fail=false}={}){
 const calls=[],revalidations=[],context={userId:'owner'};let ownershipChecks=0,authCalls=0;
 const deps={'next/cache':{revalidatePath:path=>revalidations.push(path)},'next/navigation':{redirect:path=>{throw Error(`REDIRECT:${path}`);}},'@/lib/core-ui/data':{requireOwnerUiContext:async()=>{authCalls++;if(!signedIn)throw Error('REDIRECT:/login');return context;}},'@/lib/core-ui/owner-business':{verifyOwnerBusiness:async(c,b)=>{assert.equal(c,context);assert.equal(b,businessId);ownershipChecks++;return owned;}},'@/research/qualification-server':Object.fromEntries(['prepareResearchBootstrap','activateResearchGrant','runResearchProof','stopResearchProof'].map(name=>[name,async(...args)=>{calls.push({name,args});if(fail)throw Error('private-secret-diagnostic');return{businessId,policyId,workflowRunId,serverKeyHash:grantHash,quote:{maximumMicrousd:250000}};}]))};
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
 const f=fixture({owned:false});assert.equal((await f.prepareResearchSetup(initial,form())).status,'unavailable');for(const name of ['activateResearchProof','runResearchProofAction','stopResearchProofAction'])await assert.rejects(f[name](form()),/REDIRECT:\/dashboard\/research-qualification\?business=/);assert.equal(f.calls.length,0);assert.equal(f.ownershipChecks(),4);
});
test('activation requires both consent statements and exact grant fingerprint',async()=>{
 for(const overrides of [{readConsent:'off'},{retentionConsent:'off'},{grantHash:'bad'},{grantId:'bad'}]){const f=fixture();await assert.rejects(f.activateResearchProof(form(overrides)),/notice=consent-required/);assert.equal(f.calls.length,0);assert.equal(f.authCalls(),0);}
 const f=fixture();for(let i=0;i<2;i++)await assert.rejects(f.activateResearchProof(form()),/notice=review-activation/);for(const call of f.calls){assert.equal(call.name,'activateResearchGrant');assert.deepEqual(call.args.slice(1),[businessId,grantId,grantHash]);}
});
test('Run and Stop pass only exact policy scope and never create a new execution identity',async()=>{
 const f=fixture();for(const name of ['runResearchProofAction','runResearchProofAction','stopResearchProofAction'])await assert.rejects(f[name](form()),/REDIRECT:/);assert.deepEqual(f.calls.map(c=>c.name),['runResearchProof','runResearchProof','stopResearchProof']);for(const call of f.calls)assert.deepEqual(call.args.slice(1),[businessId,policyId]);assert.deepEqual(f.revalidations,Array(3).fill('/dashboard/research-qualification'));
});
test('failure feedback redacts errors and never claims activation, evidence, or confirmed Stop',async()=>{
 const f=fixture({fail:true}),state=await f.prepareResearchSetup(initial,form());assert.equal(state.status,'unavailable');assert.equal(state.preparation,null);assert.doesNotMatch(state.message,/private-secret/);await assert.rejects(f.activateResearchProof(form()),/notice=check-saved-state/);await assert.rejects(f.runResearchProofAction(form()),/notice=review-proof/);await assert.rejects(f.stopResearchProofAction(form()),/notice=review-stop/);
});
test('session recovery redirects are preserved instead of becoming fake result notices',async()=>{
 const f=fixture({signedIn:false});for(const name of ['activateResearchProof','runResearchProofAction','stopResearchProofAction'])await assert.rejects(f[name](form()),/^Error: REDIRECT:\/login$/);await assert.rejects(f.prepareResearchSetup(initial,form()),/^Error: REDIRECT:\/login$/);assert.equal(f.calls.length,0);assert.equal(f.revalidations.length,0);
});
test('malformed Business never reaches an auth or mutation service',async()=>{
 const f=fixture();for(const name of ['activateResearchProof','runResearchProofAction','stopResearchProofAction'])await assert.rejects(f[name](form({businessId:'foreign'})),/Exact Business unavailable/);assert.equal(f.authCalls(),0);assert.equal(f.calls.length,0);
});
