import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript');
function harness(recoveryScopeId,error=false){
 const calls=[],m={exports:{}};
 const deps={'server-only':{},'node:crypto':require('node:crypto'),'../core/reviewed-knowledge':{readQuestKnowledge:v=>v},'./supabase/runtime':{createRuntimeClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return error?{error:{message:'private key must not escape'}}:{data:{status:'ok'}};}})}};
 const js=ts.transpileModule(readFileSync('src/lib/quest-controller-runtime.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',js)(name=>{assert.ok(name in deps,name);return deps[name];},m,m.exports);
 return{calls,store:m.exports.createQuestControllerStore('business','goal',{controllerKey:'inert-controller-key-01234567890123456789',admissionKey:'inert-admission-key-01234567890123456789',...(recoveryScopeId?{recoveryScopeId}:{})})};
}
test('only explicit recovery dispatch uses the bounded endpoint and binds the scope',async()=>{
 const h=harness('recovery-scope');
 for(const operation of ['claim','schedule','reserve','dispatch','response','settle','cancel'])await h.store.command(operation,{attemptId:'attempt',wireHash:'a'.repeat(64)},7);
 assert.deepEqual(h.calls.map(x=>x.name),['r07_controller','r07_controller','r07_controller','r12_recovery_dispatch','r07_controller','r07_controller','r07_controller']);
 const dispatch=h.calls[3];assert.equal(dispatch.args.p_scope_id,'recovery-scope');assert.equal(Object.hasOwn(dispatch.args,'p_operation'),false);assert.equal(dispatch.args.p_epoch,7);
 for(const c of h.calls.filter(x=>x!==dispatch)){assert.equal(Object.hasOwn(c.args,'p_scope_id'),false);assert.ok(c.args.p_operation);}
});
test('ordinary dispatch retains generic RPC and rejection never falls back or retries',async()=>{
 const ordinary=harness();await ordinary.store.command('dispatch',{attemptId:'attempt'},1);assert.equal(ordinary.calls[0].name,'r07_controller');
 const denied=harness('recovery-scope',true);await assert.rejects(denied.store.command('dispatch',{attemptId:'attempt'},1),/^Error: quest_controller_transition_unverified$/);assert.equal(denied.calls.length,1);assert.equal(denied.calls[0].name,'r12_recovery_dispatch');
});
