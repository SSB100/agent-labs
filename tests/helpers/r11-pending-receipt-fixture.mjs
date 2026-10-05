import {randomUUID} from 'node:crypto';
import {hash,collectionPayload} from './r11-public-research-fixture.mjs';
import {researchV2,repairObservation,repairSettle} from './r11-public-research-repair-fixture.mjs';
import {seedWindowResearch,windowGuard,freshPhaseQuote} from './r11-public-research-window-fixture.mjs';

export const PENDING_MODEL='openai/gpt-5.6-luna';
export async function pendingFixture(db,{policyOverrides={}}={}){
 const s=await seedWindowResearch(db,{policyOverrides:{modelId:PENDING_MODEL,...policyOverrides}});
 s.quote=freshPhaseQuote();s.marked=await windowGuard(db,s,'search',s.quote);s.receipt=`gen-inert-pending-${randomUUID()}`;
 await repairSettle(db,s,s.marked.requestId,s.receipt);
 s.payload=collectionPayload(s,s.marked.requestId,s.receipt);
 s.candidate={version:'r11.receipt-candidate.1',phase:'search',providerRequestId:s.receipt,providerModelId:s.policy.modelId,receivedAt:s.payload.collection.sources[0].retrievedAt,reportedMicrousd:20,output:s.payload.collection.sources.map(source=>({type:'url_citation',url_citation:{url:source.url,title:source.title,content:source.excerpt}})),observation:repairObservation(s)};
 s.candidateHash=hash(s.candidate);return s;
}
export const stagePending=(db,s,candidate=s.candidate)=>researchV2(db,s,'stage_receipt',{policyId:s.policy.id,requestId:s.marked.requestId,candidate,candidateHash:hash(candidate)});
export const claimPending=(db,s)=>researchV2(db,s,'claim_receipt',{policyId:s.policy.id,phase:s.candidate.phase,candidateHash:s.candidateHash});
export const pendingProof=(s,overrides={})=>{const proof={generationId:s.receipt,providerName:'Azure',modelId:PENDING_MODEL,requestedEndpoint:'azure/us',providerResponses:[],...overrides};return {...proof,proofHash:hash(proof)};};
export const recordPending=(db,s,claim,{proof=null,diagnostic=null,retryAfterAt=null}={})=>researchV2(db,s,'record_receipt',{policyId:s.policy.id,phase:s.candidate.phase,candidateHash:s.candidateHash,claimId:claim.claimId,proof,diagnostic,retryAfterAt});
// Inert administrative fixture only: append consumed historical claims with past
// timestamps. Production RPCs cannot choose a clock, reset counters, or mutate
// history; these fixtures let PGlite cover the exact 120-second boundary cheaply.
export async function seedPastClaims(db,s,count){
 let claim;for(let attempt=1;attempt<=count;attempt++)claim=(await db.query("insert into private.r11_research_receipt_checks(request_id,attempt,created_at) values($1,$2,clock_timestamp()-interval '121 seconds') returning id",[s.marked.requestId,attempt])).rows[0];
 return {claimId:claim.id};
}
