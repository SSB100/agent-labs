import {etsySteelHash,handoffAssert,handoffExact} from './etsy-steel-handoff-contracts';

/** This bootstrap enables only an owner-controlled login handoff. It does not
 * certify rendering, account identity, shop ownership, or Insights access. */
export type EtsyOwnerBootstrapPolicy={
 version:'etsy.owner-bootstrap-policy.1';documentUrl:'https://www.etsy.com/';documentMethod:'GET';maximumRequests:number;
 subresources:'deny_without_evidence';redirects:'fatal';auth:'fatal';childTargets:'fatal';
};
export const ETSY_OWNER_BOOTSTRAP_POLICY:EtsyOwnerBootstrapPolicy=Object.freeze({
 version:'etsy.owner-bootstrap-policy.1',documentUrl:'https://www.etsy.com/',documentMethod:'GET',maximumRequests:256,
 subresources:'deny_without_evidence',redirects:'fatal',auth:'fatal',childTargets:'fatal',
});
export function validateEtsyOwnerBootstrapPolicy(raw:unknown):EtsyOwnerBootstrapPolicy{
 handoffExact(raw,'version,documentUrl,documentMethod,maximumRequests,subresources,redirects,auth,childTargets','handoff_bootstrap_policy_invalid');
 const p=raw as EtsyOwnerBootstrapPolicy;
 handoffAssert(p.version==='etsy.owner-bootstrap-policy.1'&&p.documentUrl==='https://www.etsy.com/'&&p.documentMethod==='GET'&&
  Number.isSafeInteger(p.maximumRequests)&&p.maximumRequests>=1&&p.maximumRequests<=512&&p.subresources==='deny_without_evidence'&&
  p.redirects==='fatal'&&p.auth==='fatal'&&p.childTargets==='fatal','handoff_bootstrap_policy_invalid');
 return structuredClone(p);
}
export const etsyOwnerBootstrapPolicyHash=(p:EtsyOwnerBootstrapPolicy)=>etsySteelHash(validateEtsyOwnerBootstrapPolicy(p));
export function classifyEtsyOwnerBootstrapRequest(policy:EtsyOwnerBootstrapPolicy,r:{url:string;method:string;resourceType:string;navigation:boolean}):{disposition:'allow_owner_document'|'deny_owner_subresource';url:string}{
 const p=validateEtsyOwnerBootstrapPolicy(policy);
 handoffAssert(typeof r.url==='string'&&r.url.length<=8000&&/^[A-Z]{1,16}$/.test(r.method)&&/^[a-z]{1,32}$/.test(r.resourceType),'handoff_bootstrap_request_invalid');
 let u:URL;try{u=new URL(r.url);}catch{throw Error('handoff_bootstrap_request_invalid');}
 if(r.navigation||r.resourceType==='document'){
  handoffAssert(r.navigation&&r.resourceType==='document'&&r.method==='GET'&&r.url===p.documentUrl,'handoff_bootstrap_navigation_denied');
  return{disposition:'allow_owner_document',url:p.documentUrl};
 }
 handoffAssert(['http:','https:'].includes(u.protocol),'handoff_bootstrap_transport_unknown');
 // Every HTTP(S) subresource is denied. Its path, query, credentials and fragment
 // are not needed for that decision and are never sent to the audit recorder.
 return{disposition:'deny_owner_subresource',url:u.origin+'/'};
}
