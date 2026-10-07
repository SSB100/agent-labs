import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import {runInNewContext} from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript'),crypto=require('node:crypto');
const id=n=>`12000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function harness(recovery,invalid=false,setupMs=0){
 let now=0,ticks=0,authority;const business=id(1),goal=id(2),scopeId=id(3),owner=id(4),root='inert-root-key-0123456789012345678901234567';
 const derive=role=>crypto.createHmac('sha256',root).update(JSON.stringify({version:'r12.scoped-authority.1',role,businessId:business,ownerId:owner,scopeId})).digest('base64url');
 const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
 const scope={id:scopeId,businessId:business,goalId:goal,version:'r12.discovery-focused-pilot.1'},plan={businessId:business,goalId:goal,discoveryScopeId:scopeId,discoveryScopeHash:'scope-hash',steps:[]};
 const row={businessId:business,scopeId,goalId:goal,activation:{mode:'qualification',controllerKeyHash:hash(derive('controller')),admissionKeyHash:hash(derive('admission')),scope,plan,planHash:'plan-hash',operations:[]},...(recovery?{focusedSuccessor:{authorization:{version:'r12.focused-pilot-unsent-recovery-authorization.1'}}}:{})};
 const context={userId:owner,supabase:{auth:{getClaims:async()=>({data:{claims:{sub:owner}}})},rpc:async()=>{now+=setupMs;return{data:row};}}};
 class FakeDate extends Date{static now(){return now;}}
 const deps={'server-only':{},'node:crypto':crypto,'../lib/core-ui/owner-business':{verifyOwnerBusiness:async()=>true},'../core/quest-plan':{compileQuestPlan:x=>x},'../core/quest-controller':{driveQuestOnce:async()=>{ticks++;now+=75000;return{status:'progress'};}},'./discovery-v2':{discoveryV2Hash:()=> 'scope-hash'},'./discovery-r12-runtime':{},'./discovery-r12-adapter':{DiscoveryR12ReceiptPending:class extends Error{}},'./discovery-r12-wire':{DISCOVERY_R12_PHASES:[]},'./discovery-r12-server-dependencies':{discoveryR12ServerDependencies:()=>({createController:(_b,_g,a)=>{authority=a;return{read:async()=>({planHash:'plan-hash'})};},createClient:()=>({})})},'./discovery-r12-focused-successor':{validateR12FocusedSuccessor:x=>{if(invalid)throw Error('invalid proof');return x;}}};
 const m={exports:{}},js=ts.transpileModule(readFileSync('src/products/discovery-r12-server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(`(function(require,module,exports){${js}\n})`,{Date:FakeDate,process:{env:{VERCEL_ENV:'production',R05_ADMISSION_SERVER_KEY:root,OPENROUTER_API_KEY:'inert-provider-key'}}})(name=>{assert.ok(name in deps,name);return deps[name];},m,m.exports);
 return{run:()=>m.exports.continueDiscoveryR12(context,business,scopeId),ticks:()=>ticks,authority:()=>authority,scopeId};
}
test('recovery stops starting transitions at150s while ordinary workflow retains200s',async()=>{
 const recovery=harness(true),ordinary=harness(false);
 assert.equal((await recovery.run()).reason,'continue_saved_progress');assert.equal(recovery.ticks(),2);assert.equal(recovery.authority().recoveryScopeId,recovery.scopeId);
 assert.equal((await ordinary.run()).reason,'continue_saved_progress');assert.equal(ordinary.ticks(),3);assert.equal(Object.hasOwn(ordinary.authority(),'recoveryScopeId'),false);
});
test('rejected owner recovery proof cannot construct controller or execute a transition',async()=>{const h=harness(true,true);await assert.rejects(h.run(),/invalid proof/);assert.equal(h.authority(),undefined);assert.equal(h.ticks(),0);});
test('recovery setup time consumes the same request budget',async()=>{const h=harness(true,false,150000);assert.equal((await h.run()).reason,'continue_saved_progress');assert.equal(h.ticks(),0);});
