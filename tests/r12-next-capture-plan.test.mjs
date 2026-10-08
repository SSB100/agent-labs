import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {r12NextSnapshotFiles,r12NextCapturePlan,assertR12CaptureFiles} from './helpers/r12-next-capture-plan.mjs';

test('terminal capture retains the entire review producer before its real snapshot consumer',()=>{
 const stages=r12NextCapturePlan({terminalOnly:true}),available=new Set();
 assert.deepEqual(stages.map(stage=>stage.name),['base','review']);
 for(const stage of stages){for(const input of stage.inputs)assert.ok(available.has(input),`${stage.name} input ${input}`);for(const output of stage.outputs){assert.ok(!available.has(output));available.add(output);}}
 for(const file of Object.values(r12NextSnapshotFiles('focused-successor-preparation')))assert.ok(available.has(file),file);
 const baseOnly=new Set(stages[0].outputs);assert.ok(Object.values(r12NextSnapshotFiles('focused-successor-preparation')).every(file=>!baseOnly.has(file)),'Base capture alone cannot satisfy the terminal reset');
});
test('default full capture preserves every existing scenario dependency',()=>{
 const files=new Set(r12NextCapturePlan().flatMap(stage=>stage.outputs));
 for(const scenario of ['current','pending','scheduled-review','completed','bootstrap','review-preparation','review-ready','review-successor-preparation','review-successor-ready','evidence-preparation','evidence-ready','pilot-preparation','focused-successor-preparation'])for(const file of Object.values(r12NextSnapshotFiles(scenario)))assert.ok(files.has(file),`${scenario}: ${file}`);
 assert.throws(()=>r12NextSnapshotFiles('../other'));
});
test('capture checks reject missing or empty artifacts before the next producer or browser starts',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'r12-next-dependencies-'));
 try{await assert.rejects(assertR12CaptureFiles(directory,['evidence-metadata.json']));await writeFile(path.join(directory,'evidence-metadata.json'),'');await assert.rejects(assertR12CaptureFiles(directory,['evidence-metadata.json']),/empty/);await writeFile(path.join(directory,'evidence-metadata.json'),'{}');await assertR12CaptureFiles(directory,['evidence-metadata.json']);}finally{await rm(directory,{recursive:true,force:true});}
});
