import assert from 'node:assert/strict';
import {hash,seedResearch} from './r11-public-research-fixture.mjs';
import {researchV2,repairAdmission,repairWorkspace,repairStop,repairGuard,repairSettle,repairFail,repairFailure,seedContinuationPredecessor,seedContinuationGrant,importContinuationGrant,activateContinuation} from './r11-public-research-repair-fixture.mjs';

// Inert source-policy V2 fixtures. Existing V1 helpers and their deadlines stay unchanged.
export const THIRTY_MINUTES=30*60*1000;
export const sourceWindow=(now=Date.now(),duration=THIRTY_MINUTES)=>({validFrom:new Date(now-1000).toISOString(),validUntil:new Date(now-1000+duration).toISOString()});
export const freshPhaseQuote=(now=Date.now(),duration=60000)=>new Date(now+duration).toISOString();
export function seedWindowResearch(db,{policyOverrides={},...options}={}){
 const window=sourceWindow();
 return seedResearch(db,{...options,policyOverrides:{version:'r11.public-research.2',...window,quoteValidUntil:window.validUntil,...policyOverrides}});
}
export const windowGuard=(db,s,phase='search',quoteValidUntil=freshPhaseQuote(),payloadOverrides={})=>researchV2(db,s,'guard',{policyId:s.policy.id,phase,collectionId:phase==='search'?null:s.collectionId,admission:repairAdmission(s,phase),quoteValidUntil,...payloadOverrides});

// seedContinuationGrant originally prepares a first continuation. Normalize only
// its inert input operation labels when constructing later continuations; no
// persisted registry row or earlier fixture is altered.
export async function seedWindowContinuation(db,predecessor,{version='r11.public-research.2',enroll=true,...options}={}){
 const normalized={...predecessor,operatingPayload:{...predecessor.operatingPayload,operations:predecessor.operatingPayload.operations.map(operation=>({...operation,operationKey:operation.operationKey.startsWith('research.search')?'research.search':'research.model'}))}};
 const window=version==='r11.public-research.2'?sourceWindow():{validFrom:new Date(Date.now()-1000).toISOString(),validUntil:new Date(Date.now()+240000).toISOString()};
 const s=await seedContinuationGrant(db,normalized,{...window,...options,enroll:false});
 s.predecessor=predecessor;s.grant.researchPolicy.version=version;s.grantHash=hash(s.grant);
 if(enroll)await importContinuationGrant(db,s);
 return s;
}
export async function seedUnusedThirdPredecessor(db,options){
 const original=await seedContinuationPredecessor(db,options);let current=original;
 for(let i=0;i<2;i++){
  const next=await seedWindowContinuation(db,current,{version:'r11.public-research.1',maximumMicrousd:i===0?239932:230554});
  await activateContinuation(db,next);
  if(i===0){const marked=await repairGuard(db,next);await repairSettle(db,next,marked.requestId,`inert-window-predecessor-${next.grant.id}`,'9378');await repairFail(db,next,repairFailure(next,'search',marked.requestId));}
  else await repairStop(db,next);
  current=next;
 }
 const context=(await repairWorkspace(db,current)).continuation;
 assert.equal(context.businessRevision,3);assert.equal(context.goalRevision,6);assert.equal(context.capRevision,3);
 assert.equal(context.exposureMicrounits,'617509');assert.equal(context.lifetimeCapMicrounits,'848063');assert.equal(context.remainingMicrounits,'230554');
 return{original,predecessor:current};
}
