import assert from 'node:assert/strict';
import {stat} from 'node:fs/promises';
import path from 'node:path';

export function r12NextSnapshotFiles(scenario){
 assert.ok(['current','pending','scheduled-review','completed','bootstrap','review-preparation','review-ready','review-successor-preparation','review-successor-ready','evidence-preparation','evidence-ready','pilot-preparation','focused-successor-preparation'].includes(scenario));
 const metadata=scenario==='bootstrap'?'bootstrap-metadata.json':(scenario.startsWith('evidence-')||scenario.startsWith('pilot-')||scenario.startsWith('focused-successor-'))?'evidence-metadata.json':scenario.startsWith('review-successor-')?'successor-metadata.json':scenario.startsWith('review-')?'continuation-metadata.json':'metadata.json';
 const snapshot=`${['pilot-preparation','focused-successor-preparation'].includes(scenario)?'evidence-ready':scenario}.tgz`;
 return {metadata,snapshot};
}
export function r12NextCapturePlan({terminalOnly=false}={}){
 const stages=[
  {name:'base',script:'tests/r12-discovery-scope-sql.test.mjs',args:['--r12-next-capture'],outputVariable:'R12_NEXT_FIXTURE_OUTPUT',timeoutMs:240000,log:'r12-sql-capture.log',inputs:[],outputs:['metadata.json','current.tgz','pending.tgz','scheduled-review.tgz','completed.tgz']},
  {name:'review',script:'tests/helpers/r12-review-next-capture.mjs',args:[],outputVariable:'R12_REVIEW_NEXT_OUTPUT',log:'r12-review-capture.log',inputs:['metadata.json','scheduled-review.tgz'],outputs:['continuation-metadata.json','review-preparation.tgz','review-ready.tgz','successor-metadata.json','review-successor-preparation.tgz','review-successor-ready.tgz','evidence-metadata.json','evidence-preparation.tgz','evidence-ready.tgz']},
 ];
 if(!terminalOnly)stages.push({name:'bootstrap',script:'tests/helpers/r12-bootstrap-rehearsal.mjs',args:[],outputVariable:'R12_BOOTSTRAP_NEXT_OUTPUT',log:'r12-bootstrap-capture.log',inputs:[],outputs:['bootstrap-metadata.json','bootstrap.tgz']});
 return stages;
}
export async function assertR12CaptureFiles(directory,files){
 for(const name of files){const value=await stat(path.join(directory,name));assert.ok(value.isFile()&&value.size>0,`Required R12 capture is empty: ${name}`);}
}
