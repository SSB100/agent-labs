import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync,appendFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export const REQUIRED_RELEASE_JOBS=Object.freeze(['quality','r04-sql','r05-sql','r06-sql','r07-sql','r08-sql','r09-sql','r10-sql','r11-sql','r11-research-sql','r12-sql','r12-adaptive-races','r03-next','r12-direct','r12-etsy-browser']);
export function ciGateMode(eventName,event){
 if(eventName==='pull_request'){
  assert.equal(typeof event.pull_request?.draft,'boolean','A pull request must declare draft status');
  return event.pull_request.draft && event.pull_request.head?.ref!=='codex/r12-etsy-owner-baselines-20261010'?'focused':'release';
 }
 if(eventName==='workflow_dispatch'){
  const mode=event.inputs?.gate;
  assert.ok(['focused','release'].includes(mode),'Unknown requested gate');return mode;
 }
 assert.ok(eventName==='push'&&['refs/heads/main','refs/heads/codex/r12-steel-insights-wip-20261010'].includes(event.ref),'Unsupported qualification event');
 return 'release';
}
export function qualifyRelease({mode,needs,commit,tree}){
 assert.equal(mode,'release','Focused diagnostics do not qualify a release');
 for(const value of [commit,tree])assert.match(value,/^[a-f0-9]{40}$/,'Exact tested commit and tree are required');
 for(const name of REQUIRED_RELEASE_JOBS)assert.equal(needs[name]?.result,'success',`Required release check did not succeed: ${name}`);
 return {version:'agent-labs.release-qualification.1',qualified:true,mode,commit,tree,requiredJobs:Object.fromEntries(REQUIRED_RELEASE_JOBS.map(name=>[name,needs[name].result]))};
}
export function focusedDiagnostic(eventName,event){
 assert.equal(ciGateMode(eventName,event),'focused','Diagnostic selection cannot qualify or replace release checks');
 if(eventName==='workflow_dispatch'){
  const selected=event.inputs?.diagnostic??'terminal';
  assert.ok(['terminal','owner-ui'].includes(selected),'Unknown focused diagnostic');
  return selected;
 }
 return eventName==='pull_request'&&event.pull_request.body?.includes('<!-- r12-diagnostic: legacy-quote -->')?'legacy-quote':'terminal';
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href&&process.argv.includes('--select-focused')){
 const selected=focusedDiagnostic(process.env.GITHUB_EVENT_NAME,JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8')));
 appendFileSync(process.env.GITHUB_OUTPUT,`case=${selected}\n`);console.log(`Non-release diagnostic: ${selected}`);
}else if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let result;const identity={mode:null,commit:null,tree:null,eventName:process.env.GITHUB_EVENT_NAME??null,runId:process.env.GITHUB_RUN_ID??null};
 try{
  identity.commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();identity.tree=execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim();
  const event=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
  identity.mode=ciGateMode(process.env.GITHUB_EVENT_NAME,event);
  result={...qualifyRelease({...identity,needs:JSON.parse(process.env.RELEASE_NEEDS_JSON)}),eventName:identity.eventName,runId:identity.runId};
 }catch(error){result={version:'agent-labs.release-qualification.1',qualified:false,...identity,reason:error.message};process.exitCode=1;}
 mkdirSync('test-results',{recursive:true});writeFileSync('test-results/release-qualification.json',JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));
}
