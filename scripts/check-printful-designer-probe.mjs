#!/usr/bin/env node
// Local files only. No browser, network, credentials, database or provider calls.
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const args=process.argv.slice(2);
if(args.length===1&&args[0]==='--help'){
 console.log('After npm run pretest: node scripts/check-printful-designer-probe.mjs candidate.json artwork.png mockup.png');
 console.log('candidate.json contains {expectation,candidate}. Reads only those three local files. Exit 0 means the candidate contract passes, never live qualification or execution permission. See docs/checkpoints/STAGE_15_DESIGNER_PROBE.md.');
 process.exit(0);
}
async function boundedFile(path,limit){
 const handle=await open(path,constants.O_RDONLY|constants.O_NONBLOCK);
 try{
  const stat=await handle.stat();
  if(!stat.isFile()||stat.size<1||stat.size>limit)throw Error('invalid_local_file');
  const bytes=Buffer.alloc(stat.size+1);let offset=0;
  while(offset<bytes.length){const result=await handle.read(bytes,offset,bytes.length-offset,offset);if(result.bytesRead===0)break;offset+=result.bytesRead;}
  if(offset!==stat.size)throw Error('local_file_changed');
  return bytes.subarray(0,offset);
 }finally{await handle.close();}
}
try{
 if(args.length!==3||args.some(a=>a.startsWith('--')))throw Error('three_local_files_required');
 const {checkDesignerProbe,DESIGNER_PROBE_LIMITS}=require('../.core-tests/printful/designer-qualification.js');
 const document=JSON.parse((await boundedFile(args[0],262144)).toString('utf8'));
 if(!document||typeof document!=='object'||Array.isArray(document)||Object.keys(document).sort().join(',')!=='candidate,expectation')throw Error('candidate_document_required');
 const [artworkBytes,mockupBytes]=await Promise.all([
  boundedFile(args[1],DESIGNER_PROBE_LIMITS.maximumArtworkBytes),
  boundedFile(args[2],DESIGNER_PROBE_LIMITS.maximumMockupBytes),
 ]);
 const result=await checkDesignerProbe({...document,artworkBytes,mockupBytes});
 console.log(JSON.stringify({notice:'OFFLINE CANDIDATE CHECK ONLY. Captures and review statements are not authenticated; this grants no permission.',...result},null,2));
 process.exitCode=result.status==='candidate_contract_satisfied'?0:1;
}catch{
 console.log(JSON.stringify({status:'blocked',reason:'bounded_local_candidate_files_and_compiled_checker_required',liveQualified:false,executionAuthorized:false}));
 process.exitCode=2;
}
