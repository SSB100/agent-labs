import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ciGateMode,qualifyRelease,focusedDiagnostic,REQUIRED_RELEASE_JOBS} from '../scripts/verify-release-gate.mjs';
const success=()=>Object.fromEntries(REQUIRED_RELEASE_JOBS.map(name=>[name,{result:'success'}]));
test('legacy quote diagnostic is explicit and cannot select or qualify release mode',()=>{
 const marker='<!-- r12-diagnostic: legacy-quote -->';
 assert.equal(focusedDiagnostic('pull_request',{pull_request:{draft:true,body:marker}}),'legacy-quote');
 assert.equal(focusedDiagnostic('pull_request',{pull_request:{draft:true,body:'ordinary correction'}}),'terminal');
 assert.equal(focusedDiagnostic('workflow_dispatch',{inputs:{gate:'focused'}}),'terminal');
 assert.equal(focusedDiagnostic('workflow_dispatch',{inputs:{gate:'focused',diagnostic:'owner-ui'}}),'owner-ui');
 assert.throws(()=>focusedDiagnostic('workflow_dispatch',{inputs:{gate:'focused',diagnostic:'unknown'}}),/Unknown focused diagnostic/);
 assert.throws(()=>focusedDiagnostic('pull_request',{pull_request:{draft:false,body:marker}}),/cannot qualify/);
 assert.throws(()=>focusedDiagnostic('workflow_dispatch',{inputs:{gate:'release'},pull_request:{body:marker}}),/cannot qualify/);
});
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
 const events=[['pull_request',{pull_request:{draft:true}}],['pull_request',{pull_request:{draft:false}}],['pull_request',{pull_request:{draft:true,head:{ref:'codex/r12-etsy-owner-baselines-20261010'}}}],['push',{ref:'refs/heads/main'}],['workflow_dispatch',{inputs:{gate:'focused'}}],['workflow_dispatch',{inputs:{gate:'focused',diagnostic:'owner-ui'}}],['workflow_dispatch',{inputs:{gate:'release'}}],['workflow_dispatch',{inputs:{gate:'release',diagnostic:'owner-ui'}}]];
 for(const [eventName,event] of events){
  const mode=ciGateMode(eventName,event),github={event_name:eventName,event,head_ref:event.pull_request?.head?.ref},inputs=event.inputs??{};
  const selected=job=>new Function('github','inputs',`return (${workflow.jobs[job].if});`)(github,inputs);
  for(const name of REQUIRED_RELEASE_JOBS)assert.equal(selected(name),mode==='release',name);
  assert.equal(selected('r12-focused'),mode==='focused');
 }
 assert.equal(workflow.jobs['release-qualification'].if,'always()');
 assert.deepEqual(new Set(workflow.jobs['release-qualification'].needs),new Set([...REQUIRED_RELEASE_JOBS,'r12-focused']));
 const focused=workflow.jobs['r12-focused'].steps;
 assert.ok(focused.some(step=>step.run==='node scripts/verify-r03-next.mjs --r12-terminal-only'));
 const fullNext=workflow.jobs['r03-next'].steps.find(step=>step.run?.includes('scripts/verify-r03-next.mjs'));
 assert.ok(fullNext.run.split('\n').some(line=>line.trim()==='node scripts/verify-r03-next.mjs'),'The required full browser job must retain the default complete journey');
 const entry=focused.find(step=>step.env?.R12_TERMINAL_BOUNDARY_PREFLIGHT==='1');
 assert.equal(entry.run,'node --test tests/r12-terminal-boundary-preflight.test.mjs','A fresh service must bootstrap before any reused-database reset');
 assert.ok(!focused.slice(0,focused.indexOf(entry)).some(step=>step.run?.includes('reset-r12-ci-database')));
 for(const selectedCase of ['terminal','legacy-quote','owner-ui']){
  const selected=focused.filter(step=>!step.if||step.if==='always()'||new Function('steps',`return (${step.if});`)({selection:{outputs:{case:selectedCase}}}));
  assert.equal(selected.some(step=>step.run?.includes('verify-r12-legacy-quote.mjs')),selectedCase==='legacy-quote');
  assert.equal(selected.some(step=>step.run==='node scripts/verify-r03-next.mjs --r12-terminal-only'),selectedCase==='terminal');
  assert.equal(selected.some(step=>step.run?.includes('playwright-core install')),selectedCase!=='legacy-quote');
  assert.equal(selected.some(step=>step.run?.includes('node scripts/verify-r12-owner-next.mjs')),selectedCase==='owner-ui');
  assert.equal(selected.some(step=>step.run?.includes('node --test tests/console-decisions-browser.test.mjs')),selectedCase==='owner-ui');
 }
 const timeout=workflow.jobs['r12-focused']['timeout-minutes'].replace(/^\$\{\{\s*|\s*\}\}$/g,'');
 const minutes=(eventName,diagnostic)=>new Function('github','inputs',`return (${timeout});`)({event_name:eventName},{diagnostic});
 assert.equal(minutes('workflow_dispatch','owner-ui'),10);
 assert.equal(minutes('workflow_dispatch','terminal'),20);
 assert.equal(minutes('pull_request',undefined),20);
 const ownerDiagnostic=focused.find(step=>step.run?.includes('node scripts/verify-r12-owner-next.mjs'));
 assert.match(ownerDiagnostic.env.NODE_OPTIONS,/block-network\.mjs$/);
 assert.equal(ownerDiagnostic.env.R12_REQUIRE_POSTGRES,undefined,'Owner browser diagnostics use isolated PGlite without a native concurrency claim');
 assert.ok(focused.some(step=>step.if==='always()'&&step.with?.path?.includes('test-results/r12-owner-next/')));
 const legacy=focused.find(step=>step.run?.includes('verify-r12-legacy-quote.mjs'));
 assert.match(legacy.run,/set -o pipefail/);assert.match(legacy.run,/tee test-results\/r12-legacy-quote.log/);
 assert.ok(focused.some(step=>step.if==='always()'&&step.with?.path?.includes('test-results/r12-legacy-quote.*')));
 const sql=workflow.jobs['r12-sql'].steps;
 assert.ok(sql.some(step=>step.run?.includes('tee /tmp/r12-scope-tests.log')&&step.run.includes('set -o pipefail')));
 assert.ok(sql.some(step=>step.if==='always()'&&step.with?.path?.includes('/tmp/r12-scope-tests.log')));
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

test('explicit Etsy recovery draft requires full qualification, including native adaptive races',()=>{
 assert.equal(ciGateMode('pull_request',{pull_request:{draft:true,head:{ref:'codex/r12-etsy-owner-baselines-20261010'}}}),'release');
 assert.equal(ciGateMode('pull_request',{pull_request:{draft:true,head:{ref:'unrelated-draft'}}}),'focused');
 assert.ok(REQUIRED_RELEASE_JOBS.includes('r12-adaptive-races'));
 const needs=success();needs['r12-adaptive-races']={result:'skipped'};
 assert.throws(()=>qualifyRelease({mode:'release',needs,...identity}),/r12-adaptive-races/);
});
