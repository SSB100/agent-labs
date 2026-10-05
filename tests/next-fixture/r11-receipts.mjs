/** Independent, inert database receipt ledger. Never a provider or production RPC. */
import {createHash} from 'node:crypto';
import {id} from './data.mjs';
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys.split(',').sort().join(',');
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const fail=()=>{throw Error('Inert exact durable receipt unavailable');};
export const researchFixtureNow=control=>Number.isSafeInteger(control.r11Now)?control.r11Now:Date.now();
const transient=d=>['transport_failure','timeout'].includes(d.code)||d.code==='api_failure'&&(d.httpStatus===404||d.httpStatus===429||d.httpStatus>=500);
/** Match the existing collector: rejected repeats reserve neither URL nor content. */
export function receiptCollectionAnnotations(annotations){
 const seenUrls=new Set(),seenContent=new Set();
 return annotations.filter(row=>{const citation=row.url_citation,contentHash=createHash('sha256').update(citation.content).digest('hex');if(seenUrls.has(citation.url)||seenContent.has(contentHash))return false;seenUrls.add(citation.url);seenContent.add(contentHash);return true;});
}
export function receiptMetadata(research,proof,entry,control){
 const claim=entry.claims.at(-1),observation=claim?.observation,now=researchFixtureNow(control),next=claim?Math.max(claim.createdAt+120_000,Date.parse(observation?.retryAfterAt??'')||0):null;
 let status;
 if(research.outcomes.some(row=>row.policyId===proof.policyId&&row.kind==='owner_stopped')||proof.revoked&&!observation?.terminal)status='stopped';
 else if(now>=Date.parse(entry.receiptExpiresAt))status='expired';
 else if(observation?.proof)status='verified';
 else if(observation?.terminal)status='terminal';
 else if(claim?.attempt===3&&(observation||now>=next))status='exhausted';
 else if(claim&&!observation&&now<next)status='checking_receipt';
 else status='awaiting_receipt';
 return{phase:entry.candidate.phase,requestId:entry.requestId,candidateHash:entry.candidateHash,status,attempts:claim?.attempt??0,nextCheckAt:['awaiting_receipt','checking_receipt'].includes(status)&&next!==null?new Date(next).toISOString():null,receiptExpiresAt:entry.receiptExpiresAt,diagnostic:observation?.diagnostic??null,proofHash:observation?.proof?.proofHash??null};
}
export function receiptEntries(research,proof,control,privateOutput=false){
 return(research.receiptCandidates??[]).filter(row=>row.policyId===proof.policyId).map(row=>({...receiptMetadata(research,proof,row,control),...(privateOutput?{candidate:structuredClone(row.candidate),proof:structuredClone(row.claims.at(-1)?.observation?.proof??null)}:{})}));
}
function validateCandidate(research,proof,payload,hash,rawSentinel){
 const candidate=payload.candidate,marker=research.markers.find(row=>row.policyId===proof.policyId&&row.requestId===payload.requestId);
 if(!marker||!exact(candidate,'version,phase,providerRequestId,providerModelId,receivedAt,reportedMicrousd,output,observation')||candidate.version!=='r11.receipt-candidate.1'||candidate.phase!==marker.phase||candidate.providerModelId!=='openai/gpt-5.6-luna'&&candidate.providerModelId!=='openai/gpt-5.6-luna-20260709'||!iso(candidate.receivedAt)||hash(candidate)!==payload.candidateHash||JSON.stringify(candidate).includes(rawSentinel)||Buffer.byteLength(JSON.stringify(candidate))>24_576)fail();
 if(!research.settlements.some(row=>row.requestId===marker.requestId&&row.providerRequestId===candidate.providerRequestId&&row.currency==='USD'&&row.actualMicrounits===String(candidate.reportedMicrousd))||!research.providerCalls.some(row=>row.requestId===marker.requestId&&row.receiptId===candidate.providerRequestId)||!Number.isSafeInteger(candidate.reportedMicrousd)||candidate.reportedMicrousd<0||candidate.reportedMicrousd>(marker.phase==='search'?proof.policy.searchMicrousd:proof.policy.selectorMicrousd))fail();
 if(marker.phase==='search'){
  if(!Array.isArray(candidate.output)||candidate.output.length<1||candidate.output.length>4)fail();
  for(const row of candidate.output){if(!exact(row,'type,url_citation')||row.type!=='url_citation'||!exact(row.url_citation,'url,title,content'))fail();const c=row.url_citation,url=new URL(c.url);if(url.protocol!=='https:'||!proof.policy.allowedDomains.includes(url.hostname)||typeof c.title!=='string'||c.title.length>250||typeof c.content!=='string'||c.content.length<30||c.content.length>1800||c.content.replace(/\s+/g,' ').trim()!==c.content)fail();}
 }else if(!exact(candidate.output,'selections,limitations')||!Array.isArray(candidate.output.selections)||!Array.isArray(candidate.output.limitations)||!research.collections.some(row=>row.policyId===proof.policyId))fail();
 return marker;
}
export function receiptOperation({research,proof,operation,payload,effects,control,hash,rawSentinel,saveOutcome}){
 const now=researchFixtureNow(control);research.receiptCandidates??=[];
 if(operation==='stage_receipt'){
  if(!exact(payload,'policyId,requestId,candidate,candidateHash'))fail();validateCandidate(research,proof,payload,hash,rawSentinel);
  const prior=research.receiptCandidates.find(row=>row.policyId===proof.policyId&&row.candidate.phase===payload.candidate.phase);
  if(prior){if(prior.requestId!==payload.requestId||prior.candidateHash!==payload.candidateHash||hash(prior.candidate)!==hash(payload.candidate))fail();return{...receiptMetadata(research,proof,prior,control),staged:true,replayed:true};}
  const receiptExpiresAt=new Date(Date.parse(proof.policy.validUntil)+30*60_000).toISOString();if(proof.revoked||now>=Date.parse(receiptExpiresAt))fail();
  const entry={policyId:proof.policyId,requestId:payload.requestId,candidateHash:payload.candidateHash,candidate:structuredClone(payload.candidate),receiptExpiresAt,claims:[]};research.receiptCandidates.push(entry);
  effects.push({kind:'in-memory-r11-receipt-stage',policyId:proof.policyId,requestId:entry.requestId,candidateHash:entry.candidateHash});return{...receiptMetadata(research,proof,entry,control),staged:true,replayed:false};
 }
 if(!exact(payload,operation==='claim_receipt'?'policyId,phase,candidateHash':'policyId,phase,candidateHash,claimId,proof,diagnostic,retryAfterAt'))fail();
 const entry=research.receiptCandidates.find(row=>row.policyId===proof.policyId&&row.candidate.phase===payload.phase&&row.candidateHash===payload.candidateHash);if(!entry)fail();
 const check=receiptMetadata(research,proof,entry,control);
 if(operation==='claim_receipt'){
  const reason=['verified','terminal','exhausted','expired','stopped'].includes(check.status)?check.status:check.nextCheckAt&&Date.parse(check.nextCheckAt)>now?'cooldown':null;
  if(reason)return{...check,claimed:false,claimId:null,reason};
  const claim={id:id(914000+research.receiptCandidates.reduce((total,row)=>total+row.claims.length,0)),attempt:check.attempts+1,createdAt:now,observation:null};entry.claims.push(claim);
  effects.push({kind:'in-memory-r11-receipt-claim',policyId:proof.policyId,requestId:entry.requestId,claimId:claim.id,attempt:claim.attempt});return{...receiptMetadata(research,proof,entry,control),claimed:true,claimId:claim.id,reason:'claimed'};
 }
 const claim=entry.claims.at(-1);if(!claim||claim.id!==payload.claimId||Boolean(payload.proof)===Boolean(payload.diagnostic))fail();
 if(payload.proof){const p=payload.proof,{proofHash,...body}=p;if(!exact(p,'generationId,providerName,modelId,requestedEndpoint,providerResponses,proofHash')||p.generationId!==entry.candidate.providerRequestId||p.providerName!=='Azure'||p.requestedEndpoint!=='azure/us'||proofHash!==hash(body)||payload.retryAfterAt!==null)fail();}
 else if(!exact(payload.diagnostic,'code,httpStatus')||JSON.stringify(payload.diagnostic).includes(rawSentinel)||payload.retryAfterAt!==null&&(!iso(payload.retryAfterAt)||!transient(payload.diagnostic)))fail();
 const observation={proof:structuredClone(payload.proof),diagnostic:structuredClone(payload.diagnostic),retryAfterAt:payload.retryAfterAt,terminal:!!payload.diagnostic&&!transient(payload.diagnostic)};
 if(claim.observation){if(hash(claim.observation)!==hash(observation))fail();return{...check,recorded:true,replayed:true};}
 if(['expired','stopped'].includes(check.status))fail();
 if(observation.terminal&&control.r11FailJournalFailure)fail();
 claim.observation=observation;
 if(observation.terminal){const d=observation.diagnostic,o={...entry.candidate.observation,responseProviderHash:createHash('sha256').update('Azure').digest('hex'),inferenceRouteStatus:['generation_mismatch','provider_mismatch','model_mismatch','provider_responses_invalid','response_invalid','json_invalid','response_too_large','redirect_rejected'].includes(d.code)?'invalid':'unavailable',inferenceRouteProofHash:null,inferenceRouteFailureCode:d.code,inferenceRouteHttpStatus:d.httpStatus,inferenceRouteAttempts:claim.attempt};saveOutcome(research,proof,'failure',payload.phase,entry.requestId,'response_provider_unqualified',o,effects);}
 effects.push({kind:'in-memory-r11-receipt-record',policyId:proof.policyId,requestId:entry.requestId,claimId:claim.id,terminal:observation.terminal});return{...receiptMetadata(research,proof,entry,control),recorded:true,replayed:false};
}
