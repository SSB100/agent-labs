import { discoveryV2Hash as hash } from './discovery-v2';
import type { DiscoveryAdaptiveOwnerScope } from './discovery-r12-adaptive-execution-scope';
import type { AdaptiveResearchPreview } from './discovery-r12-adaptive-scope';

export type AdaptiveFundingRevision = {
  bindingId:string; revision:number; previousHash:string; previousMaximumMicrounits:string;
  maximumMicrounits:string; committedMicrounits:string; policyId:string; ownerId:string;
};
/** Same-owner SQL readback only. A self-hash is integrity, never authority.
 * Revision bodies must reproduce the hashes in the already immutable approval. */
export type AdaptiveFundingProof = {
  version:'r12.adaptive-funding-proof.1'; businessId:string; scopeId:string; scopeHash:string;
  setupId:string; setupHash:string; bindingId:string; ownerId:string; policyId:string;
  currentRevision:AdaptiveFundingRevision|null; approvalRevision:AdaptiveFundingRevision|null; proofHash:string;
};
const fail=():never=>{throw new Error('r12_adaptive_funding_proof_unverified');};
const id=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const digest=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const money=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,15})$/.test(v)&&BigInt(v)<=BigInt(Number.MAX_SAFE_INTEGER);
const keys=(v:unknown,k:string)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===k;
export function validateAdaptiveFundingProof(scope:Pick<DiscoveryAdaptiveOwnerScope,'businessId'|'id'|'setupId'|'setupHash'|'funding'|'fundingApproval'>,preview:Pick<AdaptiveResearchPreview,'funding'>,raw:AdaptiveFundingProof|null=null):void {
  const f=preview.funding,a=scope.fundingApproval,bindingId=scope.funding.bindingId;
  const increased=f.currentLimitMicrounits!==f.proposedLimitMicrounits;
  if(!keys(a,'hash,maximumMicrounits,revision')||a.revision!==f.revision+(increased?1:0)||a.maximumMicrounits!==f.proposedLimitMicrounits||!digest(a.hash))fail();
  const compact=(revision:number,maximumMicrounits:string)=>hash({bindingId,revision,maximumMicrounits});
  if(scope.funding.kind==='r05_business'||a.revision===0){
    if(raw!==null||f.bindingHash!==compact(f.revision,f.currentLimitMicrounits)||a.hash!==compact(a.revision,a.maximumMicrounits))fail();
    return;
  }
  if(!keys(raw,'approvalRevision,bindingId,businessId,currentRevision,ownerId,policyId,proofHash,scopeHash,scopeId,setupHash,setupId,version'))fail();
  const p=raw!,{proofHash,...body}=p;
  if(p.version!=='r12.adaptive-funding-proof.1'||p.businessId!==scope.businessId||p.scopeId!==scope.id||p.scopeHash!==hash(scope)||
    p.setupId!==scope.setupId||p.setupHash!==scope.setupHash||p.bindingId!==bindingId||![p.ownerId,p.policyId].every(id)||!digest(proofHash)||hash(body)!==proofHash)fail();
  const revision=(r:AdaptiveFundingRevision|null,n:number,maximum:string,expectedHash:string)=>{
    if(n===0){if(r!==null||expectedHash!==compact(n,maximum))fail();return;}
    if(!keys(r,'bindingId,committedMicrounits,maximumMicrounits,ownerId,policyId,previousHash,previousMaximumMicrounits,revision'))fail();
    const v=r!;
    if(v.bindingId!==bindingId||v.revision!==n||v.maximumMicrounits!==maximum||v.ownerId!==p.ownerId||!id(v.policyId)||!digest(v.previousHash)||
      !money(v.maximumMicrounits)||!money(v.previousMaximumMicrounits)||!money(v.committedMicrounits)||
      BigInt(v.previousMaximumMicrounits)>=BigInt(v.maximumMicrounits)||BigInt(v.committedMicrounits)>BigInt(v.previousMaximumMicrounits)||hash(v)!==expectedHash)fail();
  };
  revision(p.currentRevision,f.revision,f.currentLimitMicrounits,f.bindingHash);
  revision(p.approvalRevision,a.revision,a.maximumMicrounits,a.hash);
  if(increased){const r=p.approvalRevision!;if(r.previousHash!==f.bindingHash||r.previousMaximumMicrounits!==f.currentLimitMicrounits||r.committedMicrounits!==f.committedMicrounits||r.policyId!==p.policyId)fail();}
  else if(hash(p.currentRevision)!==hash(p.approvalRevision))fail();
}
