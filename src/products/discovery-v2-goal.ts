import { DISCOVERY_V2, discoveryV2Hash, validateDiscoveryIntentV2, type DiscoveryIntentV2 } from "./discovery-v2";
export const DISCOVERY_GOAL_DEFAULT = "Research the best-supported starting geographic market for original nature T-shirts, recommend up to three concepts, and prepare the strongest for review.";
export const DISCOVERY_MARKET_SCOPE = "Compare the United States, United Kingdom, Australia and New Zealand as a bounded English-language starting set. Check dated marketplace observations, delivered prices and fulfilment constraints separately; this is not a claim about every possible market.";
export function boundedDiscoveryRefreshFocus(value:string){
  const focus=value.trim();
  if(focus && (focus.length<20 || focus.length>200))throw new Error("An optional research focus must contain 20–200 characters within this preserved goal.");
  return focus;
}
export function buildDiscoveryIntentFromGoal(options: {id:string;businessId:string;goal:string;audienceHint?:string;maximumMicrousd:number;maximumCollections:1|2;now?:number}): DiscoveryIntentV2 {
  if (![1,2].includes(options.maximumCollections)) throw new Error("A new research goal requires one or two source collections.");
  const goal=options.goal.trim(),audience=options.audienceHint?.trim() || "Adult outdoor and nature enthusiasts";
  // Products supplies the declared original-shirt context, so "research the best market" is sufficient.
  // Obvious unrelated action requests are rejected locally rather than sent to an unlimited planner.
  if(/(?:\bbook\b.{0,40}\b(?:flight|hotel|restaurant)\b|\bsend\b.{0,30}\b(?:email|message)\b|\b(?:build|develop)\b.{0,30}\b(?:app|website|software)\b)/i.test(goal)) throw new Error("This page supports bounded original-T-shirt research; other jobs need their own supported workflow.");
  if (audience.length<3 || audience.length>160) throw new Error("An optional audience constraint must contain3–160 characters.");
  const intent:DiscoveryIntentV2={version:DISCOVERY_V2,id:options.id,businessId:options.businessId,objective:goal,
    comparisonUniverse:{productType:"original_pod_tshirt",markets:[{countryCode:"US",currency:"USD"},{countryCode:"GB",currency:"GBP"},{countryCode:"AU",currency:"AUD"},{countryCode:"NZ",currency:"NZD"}],audiences:[audience],sourceDomains:["etsy.com","printful.com"],
      selectionQuestion:"Which of the compared geographic markets is the best-supported starting point for a bounded original-shirt experiment, considering dated adjacent buyer observations, delivered-price scenarios, fulfilment and explicit unknown fees?"},
    limits:{maximumAlternatives:3,maximumNewCollections:options.maximumCollections,maximumMicrousd:options.maximumMicrousd,maximumGenerations:1},expiresAt:new Date((options.now??Date.now())+86400000).toISOString()};
  validateDiscoveryIntentV2(intent,options.now);return intent;
}
export function discoveryGoalBudgetScope(intent:DiscoveryIntentV2){return{intentId:intent.id,maximumCollections:intent.limits.maximumNewCollections,maximumMicrousd:intent.limits.maximumMicrousd,policyHash:discoveryV2Hash(intent)};}
export function parseDiscoveryAllowance(value:string,maximumMicrousd=1_000_000){
  if(![1_000_000,2_000_000].includes(maximumMicrousd)||!/^[0-2](?:\.\d{1,6})?$/.test(value))throw new Error("Enter an explicit bounded research allowance in US dollars.");
  const amount=Math.round(Number(value)*1e6);if(amount<1 || amount>maximumMicrousd)throw new Error(`The research allowance must be positive and at most US$${maximumMicrousd/1e6}.`);return amount;
}

/** Copies the preserved goal, never extends its universe or silently funds another round. */
export function buildDiscoveryAnalysisIntent(options:{prior:DiscoveryIntentV2;id:string;maximumMicrousd:number;now?:number}):DiscoveryIntentV2{
  const intent=structuredClone(options.prior);
  intent.id=options.id;
  intent.expiresAt=new Date((options.now??Date.now())+86400000).toISOString();
  intent.limits.maximumNewCollections=0;
  intent.limits.maximumMicrousd=options.maximumMicrousd;
  validateDiscoveryIntentV2(intent,options.now);
  return intent;
}
