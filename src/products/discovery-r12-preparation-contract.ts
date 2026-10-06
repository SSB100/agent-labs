import type {R04QuestContent} from '../core/quest-contract';
export const R12_ORIGINAL_OBJECTIVE = "Research the best-supported starting geographic market for original nature T-shirts, recommend up to three concepts, and prepare the strongest for review.";
const TEMPLATE: R04QuestContent = {
  "title": "Original nature-shirt geographic research",
  "originalIntent": "Research the best-supported starting geographic market for original nature T-shirts, recommend up to three concepts, and prepare the strongest for review.",
  "objective": "Research the best-supported starting geographic market for original nature T-shirts, recommend up to three concepts, and prepare the strongest for review.",
  "parsed": {
    "target": {
      "amount": "1",
      "currency": null,
      "metric": "units"
    },
    "budget": {
      "amount": "2",
      "currency": "USD"
    },
    "deadline": {
      "date": "2026-10-06",
      "time": "12:00:00",
      "timezone": "UTC"
    },
    "geography": [
      "US",
      "GB",
      "AU",
      "NZ"
    ],
    "scope": "One research packet for original nature T-shirts for adult outdoor and nature enthusiasts, comparing US/GB/AU/NZ and at most three concepts. Preserve the existing cumulative USD 2 research root and all prior costs. This slice permits only five bounded research calls, at most USD 0.406736 in total; no creative, listing, publication or commerce action.",
    "stopConstraints": [
      "Only the approved ipsos.com/mdpi.com factual-snippet source scope and exact generic public query. No marketplace listings, individual reviews, participant quotations, personal data or artwork.",
      "At most planner, one Exa search, one selector, strategist and independent reviewer. No paid retry, fallback, pivot or extra collection. Each next phase needs saved valid output, known cost and verified route receipt.",
      "Final scoped dispatch authority lasts at most thirty minutes after setup; receipt-only grace lasts thirty more minutes. At most three single metadata GET claims per phase, fifteen total, separated by at least 120 seconds or longer Retry-After.",
      "Stop on expiry, owner withdrawal, changed scope, unresolved/over-limit cost, invalid source/output or exhausted/terminal receipt evidence. Higher phase quotes cannot raise any allowance. Research TEST/REJECT/NEEDS_MORE_EVIDENCE grants no creative or commerce permission."
    ]
  },
  "ambiguities": []
};
export type R12PreparationInput={businessId:string;priorRoundId:string;preparationId:string;sourceCutoff:string};
export type R12PreparationReceipt=R12PreparationInput&{ownerId:string;scopeId:string;priorId:string;goalId:string;goalRevision:2;goalHash:string;installationId:string;rootId:string;controllerKeyHash:string;admissionKeyHash:string;authorityCreated:false};
export type R12PreparationState={message:string;receipt:R12PreparationReceipt|null};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function validateR12PreparationIdentity(input:R12PreparationInput){
 if(!input||Object.keys(input).sort().join(',')!=='businessId,preparationId,priorRoundId,sourceCutoff'||![input.businessId,input.priorRoundId,input.preparationId].every(id=>typeof id==='string'&&UUID.test(id)))throw Error('preparation_identity_invalid');
 const cutoff=new Date(input.sourceCutoff);
 if(typeof input.sourceCutoff!=='string'||!Number.isFinite(cutoff.getTime())||cutoff.toISOString()!==input.sourceCutoff||cutoff.getUTCMilliseconds()!==0)throw Error('preparation_cutoff_invalid');
 return input;
}
export function validateR12Preparation(input:R12PreparationInput,now=Date.now()){validateR12PreparationIdentity(input);const until=Date.parse(input.sourceCutoff);if(until<=now+1800000||until>now+86400000)throw Error('preparation_cutoff_invalid');return input;}
export function r12PreparationGoalContent(sourceCutoff:string,objective=R12_ORIGINAL_OBJECTIVE):R04QuestContent{
 const cutoff=new Date(sourceCutoff);if(!Number.isFinite(cutoff.getTime())||cutoff.toISOString()!==sourceCutoff||cutoff.getUTCMilliseconds()!==0||objective!==R12_ORIGINAL_OBJECTIVE)throw Error('preparation_original_intent_invalid');
 const content=structuredClone(TEMPLATE);content.originalIntent=objective;content.objective=objective;content.parsed.deadline={date:sourceCutoff.slice(0,10),time:sourceCutoff.slice(11,19),timezone:'UTC'};return content;
}
export function r12PreparationHref(input:R12PreparationInput){return '/dashboard?'+new URLSearchParams({view:'research',type:'r12-prepare',business:input.businessId,prior:input.priorRoundId,preparation:input.preparationId,sourceCutoff:input.sourceCutoff});}
