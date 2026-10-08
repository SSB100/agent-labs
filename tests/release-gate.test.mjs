import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ciGateMode,qualifyRelease,REQUIRED_RELEASE_JOBS} from '../scripts/verify-release-gate.mjs';
const success=()=>Object.fromEntries(REQUIRED_RELEASE_JOBS.map(name=>[name,{result:'success'}]));
const identity={commit:'a'.repeat(40),tree:'b'.repeat(40)};
test('draft diagnostics never qualify release, even with forged complete-looking job results',()=>{
 assert.equal(ciGateMode('pull_request',{pull_request:{draft:true}}),'focused');
 assert.throws(()=>qualifyRelease({mode:'focused',needs:success(),...identity}),/do not qualify/);
});
test('release requires every named check on an exact commit and tree',()=>{
 assert.equal(qualifyRelease({mode:'release',needs:success(),...identity}).qualified,true);
 for(const name of REQUIRED_RELEASE_JOBS)for(const result of ['skipped','failure','cancelled','in_progress',undefined]){
  const needs=success();if(result===undefined)delete needs[name];else needs[name]={result};
  assert.throws(()=>qualifyRelease({mode:'release',needs,...identity}),/Required release check/);
 }
 assert.throws(()=>qualifyRelease({mode:'release',needs:success(),commit:'main',tree:identity.tree}),/Exact tested/);
});
test('ready PR and main retain full qualification; malformed or unknown mode fails closed',()=>{
 assert.equal(ciGateMode('pull_request',{pull_request:{draft:false}}),'release');
 assert.equal(ciGateMode('push',{ref:'refs/heads/main'}),'release');
 assert.throws(()=>ciGateMode('workflow_dispatch',{}));
 assert.equal(ciGateMode('workflow_dispatch',{inputs:{gate:'focused'}}),'focused');
 assert.throws(()=>ciGateMode('pull_request',{}));
 assert.throws(()=>ciGateMode('workflow_dispatch',{inputs:{gate:'skip'}}));
 assert.throws(()=>ciGateMode('push',{ref:'refs/heads/other'}));
});
test('actual workflow selects the same focused/full modes and requires every named release dependency',()=>{
 const {load}=createRequire(import.meta.url)('js-yaml');
 const workflow=load(readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8'));
 assert.ok(workflow.on.pull_request.types.includes('ready_for_review'));
 assert.deepEqual(workflow.on.push.branches,['main']);
 assert.equal(workflow.on.workflow_dispatch.inputs.gate.default,'release');
 const events=[['pull_request',{pull_request:{draft:true}}],['pull_request',{pull_request:{draft:false}}],['push',{ref:'refs/heads/main'}],['workflow_dispatch',{inputs:{gate:'focused'}}],['workflow_dispatch',{inputs:{gate:'release'}}]];
 for(const [eventName,event] of events){
  const mode=ciGateMode(eventName,event),github={event_name:eventName,event},inputs=event.inputs??{};
  const selected=job=>new Function('github','inputs',`return (${workflow.jobs[job].if});`)(github,inputs);
  for(const name of REQUIRED_RELEASE_JOBS)assert.equal(selected(name),mode==='release',name);
  assert.equal(selected('r12-focused'),mode==='focused');
 }
 assert.equal(workflow.jobs['release-qualification'].if,'always()');
 assert.deepEqual(new Set(workflow.jobs['release-qualification'].needs),new Set([...REQUIRED_RELEASE_JOBS,'r12-focused']));
 const focused=workflow.jobs['r12-focused'].steps;
 assert.ok(focused.some(step=>step.run==='node scripts/verify-r03-next.mjs --r12-terminal-only'));
 assert.ok(focused.some(step=>step.env?.R12_TERMINAL_BOUNDARY_PREFLIGHT==='1'&&step.run?.includes('tests/r12-terminal-boundary-preflight.test.mjs')));
});
test('failed focused CLI evidence keeps the actual tested identity and cannot exit successfully',()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'agent-labs-release-gate-'));
 try{
  execFileSync('git',['init','-q',directory]);
  execFileSync('git',['-C',directory,'-c','user.name=Inert fixture','-c','user.email=inert@example.invalid','commit','--allow-empty','-qm','Inert release gate fixture']);
  const eventPath=path.join(directory,'event.json');writeFileSync(eventPath,JSON.stringify({pull_request:{draft:true}}));
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/verify-release-gate.mjs',import.meta.url))],{cwd:directory,encoding:'utf8',env:{...process.env,GITHUB_EVENT_PATH:eventPath,GITHUB_EVENT_NAME:'pull_request',GITHUB_RUN_ID:'123',RELEASE_NEEDS_JSON:JSON.stringify(success())}});
  assert.equal(result.status,1);const decision=JSON.parse(readFileSync(path.join(directory,'test-results/release-qualification.json'),'utf8'));
  assert.equal(decision.qualified,false);assert.equal(decision.mode,'focused');assert.equal(decision.runId,'123');
  assert.equal(decision.commit,execFileSync('git',['-C',directory,'rev-parse','HEAD'],{encoding:'utf8'}).trim());
  assert.equal(decision.tree,execFileSync('git',['-C',directory,'rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim());
 }finally{rmSync(directory,{recursive:true,force:true});}
});
