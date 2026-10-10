import { quoteTextTokenCost } from "../research/qualification-quote";
import { DISCOVERY_V2_BUDGET } from "./discovery-v2-budget";
import { containsCredentialLikeValue, containsCredentialLikeContent } from "../core/quest-intake";
import { validateAdaptiveResearchQuote,type EtsyAdaptiveResearchQuote } from "./discovery-r12-adaptive-quote";
import { validatePublicResearchPredecessor,validatePublicResearchOriginHistory,type PublicResearchPredecessor,type PublicResearchOriginHistory } from "./discovery-r12-public-origin";
import { validatePublicResearchCapProposal,projectPublicResearchCapProposal,type PublicResearchCapProposal } from "./discovery-r12-public-caps";
import { exactPublicKeys as exact,publicHash as hash,publicInteger as integer,publicMoney as money,publicResearchFail as fail,publicResearchHash,publicText as text,publicTime as time,publicUuid as uuid,publicBoundedJson,verifyPublicSelfHash } from "./discovery-r12-public-utils";
export type PublicResearchBrowserQuote={version:"r12.public-browser-quote.1";provider:"steel";category:"browser";providerProjectId:string;zeroCostQualificationHash:string|null;routeHash:string;priceEvidenceHash:string;settlementContractHash:string;tariffHash:string;qualificationHash:string;maximumMicrounits:string;verifiedAt:string;validUntil:string;qualified:boolean;retentionDisclosure:string;browserQuoteHash:string};
export function validatePublicResearchBrowserQuote(raw:unknown,now=Date.now()):PublicResearchBrowserQuote{
 if(!exact(raw,"version,provider,category,providerProjectId,zeroCostQualificationHash,routeHash,priceEvidenceHash,settlementContractHash,tariffHash,qualificationHash,maximumMicrounits,verifiedAt,validUntil,qualified,retentionDisclosure,browserQuoteHash"))return fail();const q=raw as unknown as PublicResearchBrowserQuote;
 if(q.version!=="r12.public-browser-quote.1"||q.provider!=="steel"||q.category!=="browser"||!uuid(q.providerProjectId)||![q.routeHash,q.priceEvidenceHash,q.settlementContractHash,q.tariffHash,q.qualificationHash].every(hash)||(q.zeroCostQualificationHash!==null&&!hash(q.zeroCostQualificationHash))||typeof q.qualified!=="boolean"||!text(q.retentionDisclosure,4000)||!Number.isFinite(now)||time(q.verifiedAt)>now||time(q.validUntil)<=now||time(q.validUntil)-time(q.verifiedAt)>300000||(money(q.maximumMicrounits)===BigInt(0)&&(q.zeroCostQualificationHash===null||q.qualified!==true)))return fail();
 verifyPublicSelfHash(raw,"browserQuoteHash");return structuredClone(q);
}
export type PublicResearchLegacyQuote={version:"r12.public-research-quote.1";inference:EtsyAdaptiveResearchQuote;browser:PublicResearchBrowserQuote;maximumAttemptsInWindow:number;maximumModelDispatches:number;maximumSourceOperations:number;phaseMaximumMicrounits:{plan:string;source:string;strategy:string;review:string};maximumAttemptMicrounits:string;maximumWindowMicrounits:string;originalRunMaximumMicrounits:string;verifiedAt:string;validUntil:string;proposalOnly:true;dispatchAuthorized:false;quoteHash:string};
export function qualifyPublicResearchQuote(inference:EtsyAdaptiveResearchQuote,browser:PublicResearchBrowserQuote,originalRunMaximumMicrounits:string,now=Date.now(),maximumAttemptsInWindow=10):PublicResearchLegacyQuote{
 validateAdaptiveResearchQuote(inference,now);validatePublicResearchBrowserQuote(browser,now);const maximum=money(originalRunMaximumMicrounits);
 if(inference.version!=="r12.adaptive-quote.2"||maximum<=BigInt(0)||maximum>BigInt(10000000)||!integer(maximumAttemptsInWindow,1,32))return fail();
 const phaseMaximumMicrounits={plan:String(inference.ceilings.plan),source:browser.maximumMicrounits,strategy:String(inference.ceilings.strategy),review:String(inference.ceilings.review)},attempt=Object.values(phaseMaximumMicrounits).reduce((s,x)=>s+money(x),BigInt(0));
 const body={version:"r12.public-research-quote.1"as const,inference,browser,maximumAttemptsInWindow,maximumModelDispatches:3*maximumAttemptsInWindow,maximumSourceOperations:maximumAttemptsInWindow,phaseMaximumMicrounits,maximumAttemptMicrounits:attempt.toString(),maximumWindowMicrounits:(attempt*BigInt(maximumAttemptsInWindow)).toString(),originalRunMaximumMicrounits,verifiedAt:new Date(Math.max(time(inference.verifiedAt),time(browser.verifiedAt))).toISOString(),validUntil:new Date(Math.min(time(inference.validUntil),time(browser.validUntil))).toISOString(),proposalOnly:true as const,dispatchAuthorized:false as const};return{...body,quoteHash:publicResearchHash(body)};
}
export type PublicResearchWindowQuote=Omit<PublicResearchLegacyQuote,"version"> & {version:"r12.public-research-quote.2";modelRequestBytes:{plan:number;strategy:number;review:number}};
export type PublicResearchQuote=PublicResearchLegacyQuote|PublicResearchWindowQuote;
export const PUBLIC_RESEARCH_WINDOW_REQUEST_BYTES=Object.freeze({plan:32_768,strategy:65_536,review:65_536});
/** Separately reviewed .4 window bounds. Never changes a legacy inference
 * quote or expands an already approved public quote through renewal. */
export function qualifyPublicResearchWindowQuote(inference:EtsyAdaptiveResearchQuote,browser:PublicResearchBrowserQuote,originalRunMaximumMicrounits:string,now=Date.now(),maximumAttemptsInWindow=10):PublicResearchWindowQuote{
 const legacy=qualifyPublicResearchQuote(inference,browser,originalRunMaximumMicrounits,now,maximumAttemptsInWindow);
 const ceiling=(phase:"plan"|"strategy"|"review")=>String(quoteTextTokenCost(phase==="review"?inference.reviewer.tokenPricesUsd:inference.luna.tokenPricesUsd,PUBLIC_RESEARCH_WINDOW_REQUEST_BYTES[phase]+DISCOVERY_V2_BUDGET.formattingTokenAllowance,inference.outputTokens[phase]));
 const phaseMaximumMicrounits={plan:ceiling("plan"),source:browser.maximumMicrounits,strategy:ceiling("strategy"),review:ceiling("review")},attempt=Object.values(phaseMaximumMicrounits).reduce((sum,x)=>sum+money(x),BigInt(0));
 const{quoteHash,...original}=legacy;void quoteHash;
 const body={...original,version:"r12.public-research-quote.2"as const,modelRequestBytes:{...PUBLIC_RESEARCH_WINDOW_REQUEST_BYTES},phaseMaximumMicrounits,maximumAttemptMicrounits:attempt.toString(),maximumWindowMicrounits:(attempt*BigInt(maximumAttemptsInWindow)).toString()};return{...body,quoteHash:publicResearchHash(body)};
}
export function publicResearchModelRequestBytes(quote:PublicResearchQuote){
 if(quote.version==="r12.public-research-quote.2")return quote.modelRequestBytes;
 if(quote.version==="r12.public-research-quote.1")return quote.inference.requestBytes;
 return fail("r12_public_quote_version_unqualified");
}
export function validatePublicResearchQuote(raw:unknown,now=Date.now()):PublicResearchQuote{
 const version=(raw as {version?:unknown}|null)?.version;
 if(version!=="r12.public-research-quote.1"&&version!=="r12.public-research-quote.2")return fail();
 if(!exact(raw,"version,inference,browser,maximumAttemptsInWindow,maximumModelDispatches,maximumSourceOperations,phaseMaximumMicrounits,maximumAttemptMicrounits,maximumWindowMicrounits,originalRunMaximumMicrounits,verifiedAt,validUntil,proposalOnly,dispatchAuthorized,quoteHash"+(version==="r12.public-research-quote.2"?",modelRequestBytes":"")))return fail();const q=raw as unknown as PublicResearchQuote;
 const expected=(version==="r12.public-research-quote.2"?qualifyPublicResearchWindowQuote:qualifyPublicResearchQuote)(q.inference,q.browser,q.originalRunMaximumMicrounits,now,q.maximumAttemptsInWindow);if(publicResearchHash(q)!==publicResearchHash(expected))return fail();return structuredClone(q);
}
export type PublicResearchOwnerTestInput={version:"r12.owner-direct-test-input.1";businessId:string;goalId:string;grantId:string;predecessorScopeId:string;predecessorScopeHash:string;maximumAttemptsInWindow:number;maximumRunMicrounits:string;capProposal:PublicResearchCapProposal;submissionId:string};
export function validatePublicResearchOwnerTestInput(raw:unknown):PublicResearchOwnerTestInput{
 if(!exact(raw,"version,businessId,goalId,grantId,predecessorScopeId,predecessorScopeHash,maximumAttemptsInWindow,maximumRunMicrounits,capProposal,submissionId"))return fail();const i=raw as unknown as PublicResearchOwnerTestInput;
 if(i.version!=="r12.owner-direct-test-input.1"||![i.businessId,i.goalId,i.grantId,i.predecessorScopeId,i.submissionId].every(uuid)||!hash(i.predecessorScopeHash)||!integer(i.maximumAttemptsInWindow,1,32)||money(i.maximumRunMicrounits)<=BigInt(0)||money(i.maximumRunMicrounits)>BigInt(10000000))return fail();validatePublicResearchCapProposal(i.capProposal);return structuredClone(i);
}
export type PublicResearchSetupOperation={operationKey:string;workflowDefinitionId:string;workflowHash:string;qualificationHash:string;routeHash:string;quoteHash:string;maximumMicrounits:string};
type CapLedger={revision:number;currentLimitMicrounits:string;conservativeExposureMicrounits:string;headroomMicrounits:string};
export type PublicResearchOwnerFunding={bindingId:string;bindingKind:"r05_business"|"legacy_research_root";authorityRootId:string;business:CapLedger;root:CapLedger&{bindingHash:string};funding:Record<string,unknown>};
export type PublicResearchOwnerTestEnvelope={version:"r12.owner-direct-test-envelope.1";testEnvelopeId:string;businessId:string;goalId:string;ownerId:string;authorityRootId:string;bindingId:string;policyId:string;grantId:string;grantRootId:string;grantReviewHash:string;originDirectRunId:string;input:PublicResearchOwnerTestInput;origin:{predecessor:PublicResearchPredecessor;originHistory:PublicResearchOriginHistory};originHash:string;funding:PublicResearchOwnerFunding;capProposal:PublicResearchCapProposal;maximumMicrounits:string;maximumAttemptsInWindow:number;setupOperation:PublicResearchSetupOperation;verificationOperation:PublicResearchSetupOperation;setupQuote:PublicResearchBrowserQuote;verificationQuote:PublicResearchBrowserQuote;
 /** Private reviewed bootstrap projections only. These are not executable worker
  * or profile authority; research activation requires separate exact schemas. */
 researchPins:Record<string,unknown>;profileTemplate:Record<string,unknown>;requiresPersistentAccessApproval:true;existingGoalBudget:{amount:string;currency:string|null};expiresAt:string};
export type PublicResearchOwnerTestReceipt={version:"r12.owner-direct-test-receipt.1";businessId:string;goalId:string;testEnvelopeId:string;testEnvelopeHash:string;confirmed:boolean;stopped:boolean;createdAt:string;expiresAt:string;preview:PublicResearchOwnerTestEnvelope};
function inertProjection(v:unknown):v is Record<string,unknown>{if(!v||typeof v!=="object"||Array.isArray(v)||containsCredentialLikeValue(v))return false;publicBoundedJson(v,65536);return true;}
/** Complete private reviewed-pins projection only. This changes neither the
 * legacy generic projection limits nor any provider wire/token/cash ceiling. */
export function validatePublicResearchReviewedPinsProjection(raw:unknown):Record<string,unknown>{
 const active=new WeakSet<object>();let nodes=0,bytes=0;
 const add=(n:number)=>{bytes+=n;if(bytes>262144)return fail("r12_public_reviewed_pins_bounds");};
 function visit(value:unknown,depth:number):void{
  if(++nodes>12000||depth>24)return fail("r12_public_reviewed_pins_bounds");
  if(typeof value==="string"){if(containsCredentialLikeContent(value))return fail("r12_public_reviewed_pins_unverified");add(Buffer.byteLength(JSON.stringify(value)));return;}
  if(value===null||typeof value==="boolean"||typeof value==="number"&&Number.isFinite(value)){add(Buffer.byteLength(JSON.stringify(value)));return;}
  if(!value||typeof value!=="object"||active.has(value))return fail("r12_public_reviewed_pins_unverified");
  const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
  if(array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)return fail("r12_public_reviewed_pins_unverified");
  active.add(value);add(2);
  const keys=Reflect.ownKeys(value);if(keys.length>12000)return fail("r12_public_reviewed_pins_bounds");
  if(array){const length=Object.getOwnPropertyDescriptor(value,"length");if(!length||!("value"in length)||!Number.isSafeInteger(length.value)||length.value<0||length.value>12000||keys.length!==length.value+1)return fail("r12_public_reviewed_pins_unverified");}
  let emitted=0;
  for(const key of keys){
   if(typeof key!=="string"||containsCredentialLikeContent(key))return fail("r12_public_reviewed_pins_unverified");
   const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!("value"in d))return fail("r12_public_reviewed_pins_unverified");
   if(array&&key==="length")continue;
   if(!d.enumerable||array&&!/^(0|[1-9][0-9]*)$/.test(key))return fail("r12_public_reviewed_pins_unverified");
   if(emitted++)add(1);if(!array)add(Buffer.byteLength(JSON.stringify(key))+1);visit(d.value,depth+1);
  }
  active.delete(value);
 }
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return fail("r12_public_reviewed_pins_unverified");
 try{visit(raw,0);return structuredClone(raw)as Record<string,unknown>;}catch{return fail("r12_public_reviewed_pins_unverified");}
}
function validateFunding(v:PublicResearchOwnerFunding,businessId:string,rootId:string,bindingId:string):void{
 if(!exact(v,"bindingId,bindingKind,authorityRootId,business,root,funding")||v.bindingId!==bindingId||v.authorityRootId!==rootId||!["r05_business","legacy_research_root"].includes(v.bindingKind)||!exact(v.business,"revision,currentLimitMicrounits,conservativeExposureMicrounits,headroomMicrounits")||!exact(v.root,"revision,currentLimitMicrounits,conservativeExposureMicrounits,headroomMicrounits,bindingHash")||!hash(v.root.bindingHash)||!inertProjection(v.funding))return fail();
 for(const k of ["business","root"]as const){const x=v[k],limit=money(x.currentLimitMicrounits),exposure=money(x.conservativeExposureMicrounits);if(!integer(x.revision)||money(x.headroomMicrounits)!==(limit>exposure?limit-exposure:BigInt(0)))return fail();}
 const f=v.funding;if(!exact(f,"binding,revision,hash,maximumMicrounits,committedMicrounits,pendingMicrounits,hasUnknown,budget")||!exact(f.binding,"kind,bindingId,authorityRootId,priorRoundId,originalSemanticGoalHash")||f.binding.kind!==v.bindingKind||f.binding.bindingId!==bindingId||f.binding.authorityRootId!==rootId||f.hash!==v.root.bindingHash||f.revision!==v.root.revision||f.maximumMicrounits!==v.root.currentLimitMicrounits||f.committedMicrounits!==v.root.conservativeExposureMicrounits||f.hasUnknown!==false||money(f.pendingMicrounits)!==BigInt(0)||!inertProjection(f.budget))return fail();
 if(v.bindingKind==="r05_business"){if(rootId!==businessId||f.binding.priorRoundId!==null||f.binding.originalSemanticGoalHash!==null||v.business.revision!==v.root.revision||v.business.currentLimitMicrounits!==v.root.currentLimitMicrounits||v.business.conservativeExposureMicrounits!==v.root.conservativeExposureMicrounits)return fail();}
 else if(rootId===businessId||!uuid(f.binding.priorRoundId)||!hash(f.binding.originalSemanticGoalHash))return fail();
}
/** Receipt-only reader: expired and stopped saved envelopes remain readable.
 * It validates immutable integrity/binding, not live dispatch authorization. */
export function validatePublicResearchOwnerTestReceipt(raw:unknown,expected:{businessId:string;goalId:string;testEnvelopeId?:string;testEnvelopeHash?:string}):PublicResearchOwnerTestReceipt{
 if(!exact(raw,"version,businessId,goalId,testEnvelopeId,testEnvelopeHash,confirmed,stopped,createdAt,expiresAt,preview"))return fail();
 // Inspect data descriptors before JSON serialization or canonical hashing can
 // evaluate a hostile accessor in this otherwise inert reviewed projection.
 const previewDescriptor=Object.getOwnPropertyDescriptor(raw,"preview");if(!previewDescriptor||!("value"in previewDescriptor)||!previewDescriptor.value||typeof previewDescriptor.value!=="object")return fail();
 const pinsDescriptor=Object.getOwnPropertyDescriptor(previewDescriptor.value,"researchPins");if(!pinsDescriptor||!("value"in pinsDescriptor))return fail();validatePublicResearchReviewedPinsProjection(pinsDescriptor.value);
 publicBoundedJson(raw);const r=raw as unknown as PublicResearchOwnerTestReceipt;
 if(r.version!=="r12.owner-direct-test-receipt.1"||![r.businessId,r.goalId,r.testEnvelopeId].every(uuid)||!hash(r.testEnvelopeHash)||typeof r.confirmed!=="boolean"||typeof r.stopped!=="boolean"||time(r.expiresAt)<=time(r.createdAt))return fail();for(const[k,v]of Object.entries(expected))if(r[k as keyof typeof r]!==v)return fail();
 const p=r.preview;if(!exact(p,"version,testEnvelopeId,businessId,goalId,ownerId,authorityRootId,bindingId,policyId,grantId,grantRootId,grantReviewHash,originDirectRunId,input,origin,originHash,funding,capProposal,maximumMicrounits,maximumAttemptsInWindow,setupOperation,verificationOperation,setupQuote,verificationQuote,researchPins,profileTemplate,requiresPersistentAccessApproval,existingGoalBudget,expiresAt")||p.version!=="r12.owner-direct-test-envelope.1"||p.requiresPersistentAccessApproval!==true||![p.ownerId,p.authorityRootId,p.bindingId,p.policyId,p.grantId,p.grantRootId,p.originDirectRunId].every(uuid)||![p.grantReviewHash,p.originHash].every(hash)||p.testEnvelopeId!==r.testEnvelopeId||p.businessId!==r.businessId||p.goalId!==r.goalId||p.expiresAt!==r.expiresAt||publicResearchHash(p)!==r.testEnvelopeHash)return fail();
 const i=validatePublicResearchOwnerTestInput(p.input);if(i.businessId!==p.businessId||i.goalId!==p.goalId||i.grantId!==p.grantId||i.maximumAttemptsInWindow!==p.maximumAttemptsInWindow||i.maximumRunMicrounits!==p.maximumMicrounits||publicResearchHash(i.capProposal)!==publicResearchHash(p.capProposal))return fail();
 if(!exact(p.origin,"predecessor,originHistory")||publicResearchHash(p.origin)!==p.originHash)return fail();const predecessor=validatePublicResearchPredecessor(p.origin.predecessor),closure=predecessor.closure;
 if(closure.businessId!==p.businessId||closure.goalId!==p.goalId||closure.authorityRootId!==p.authorityRootId||closure.predecessorScopeId!==i.predecessorScopeId||closure.predecessorScopeHash!==i.predecessorScopeHash)return fail();
 validatePublicResearchOriginHistory(p.origin.originHistory,{businessId:p.businessId,goalId:p.goalId,predecessorScopeId:closure.predecessorScopeId,predecessorClosureHash:publicResearchHash(closure)});
 validateFunding(p.funding,p.businessId,p.authorityRootId,p.bindingId);const projection=projectPublicResearchCapProposal(p.capProposal,{business:{capRevision:p.funding.business.revision,limitMicrounits:p.funding.business.currentLimitMicrounits,headroomMicrounits:p.funding.business.headroomMicrounits,conservativeExposureMicrounits:p.funding.business.conservativeExposureMicrounits},root:{capRevision:p.funding.root.revision,limitMicrounits:p.funding.root.currentLimitMicrounits,headroomMicrounits:p.funding.root.headroomMicrounits,conservativeExposureMicrounits:p.funding.root.conservativeExposureMicrounits}});
 if(money(projection.business.projectedHeadroomMicrounits)<money(p.maximumMicrounits)||money(projection.root.projectedHeadroomMicrounits)<money(p.maximumMicrounits))return fail();
 if(p.funding.bindingKind==="r05_business"&&p.capProposal.business.proposedLimitMicrounits!==p.capProposal.root.proposedLimitMicrounits)return fail();
 for(const[operation,quote]of [[p.setupOperation,p.setupQuote],[p.verificationOperation,p.verificationQuote]]as const){if(!exact(operation,"operationKey,workflowDefinitionId,workflowHash,qualificationHash,routeHash,quoteHash,maximumMicrounits")||!text(operation.operationKey,120)||!uuid(operation.workflowDefinitionId)||![operation.workflowHash,operation.qualificationHash,operation.routeHash,operation.quoteHash].every(hash))return fail();validatePublicResearchBrowserQuote(quote,time(quote.verifiedAt));if(quote.qualified!==true||operation.quoteHash!==quote.browserQuoteHash||operation.routeHash!==quote.routeHash||operation.qualificationHash!==quote.qualificationHash||operation.maximumMicrounits!==quote.maximumMicrounits||money(operation.maximumMicrounits)<=BigInt(0)||quote.zeroCostQualificationHash!==null)return fail();}
 if(p.setupQuote.providerProjectId!==p.verificationQuote.providerProjectId||p.setupQuote.routeHash!==p.verificationQuote.routeHash||p.setupOperation.operationKey===p.verificationOperation.operationKey||money(p.setupOperation.maximumMicrounits)+money(p.verificationOperation.maximumMicrounits)>=money(p.maximumMicrounits)||!inertProjection(p.profileTemplate)||!exact(p.existingGoalBudget,"amount,currency")||!text(p.existingGoalBudget.amount,120)||(p.existingGoalBudget.currency!==null&&!text(p.existingGoalBudget.currency,30)))return fail();
 return structuredClone(r);
}

export type PublicResearchProfile={version:"r12.owner-research-profile.4";id:string;businessId:string;goalId:string;goalHash:string;marketSetKey:string;topicKey:string;publicGoal:string;productFormat:string;category:string;markets:Array<{countryCode:string;currency:string}>;audience:string;sourceAccess:import("./discovery-r12-public-source").PublicResearchSourceAccess;maximumAttemptsInWindow:number;originalRunMaximumMicrounits:string;validUntil:string;profileHash:string};
export function validatePublicResearchProfile(raw:unknown):PublicResearchProfile{
 if(!exact(raw,"version,id,businessId,goalId,goalHash,marketSetKey,topicKey,publicGoal,productFormat,category,markets,audience,sourceAccess,maximumAttemptsInWindow,originalRunMaximumMicrounits,validUntil,profileHash"))return fail();const p=raw as unknown as PublicResearchProfile;
 if(p.version!=="r12.owner-research-profile.4"||![p.id,p.businessId,p.goalId].every(uuid)||!hash(p.goalHash)||![p.marketSetKey,p.topicKey,p.publicGoal,p.productFormat,p.category,p.audience].every(x=>text(x,2000))||!integer(p.maximumAttemptsInWindow,1,32)||money(p.originalRunMaximumMicrounits)<=BigInt(0)||money(p.originalRunMaximumMicrounits)>BigInt(10000000)||!Array.isArray(p.markets)||p.markets.length<1||p.markets.length>4||new Set(p.markets.map(x=>x.countryCode)).size!==p.markets.length)return fail();
 for(const m of p.markets)if(!exact(m,"countryCode,currency")||!/^[A-Z]{2}$/.test(m.countryCode)||!/^[A-Z]{3}$/.test(m.currency))return fail();time(p.validUntil);verifyPublicSelfHash(raw,"profileHash");return structuredClone(p);
}
