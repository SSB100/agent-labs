import {fixture} from './r12-adaptive-inputs-fixture.mjs';
import {id,now} from './r12-adaptive-fixture.mjs';
import {discoveryV2Hash as hash} from '../../.core-tests/products/discovery-v2.js';
import {qualifyEtsyOwnerResearchQuote} from '../../.core-tests/products/discovery-r12-adaptive-quote.js';
import {r12CatalogFixture} from './r12-provider-fixture.mjs';
export function etsyObserved(){
  const f=fixture(),stamp=new Date(now-1000).toISOString();
  const observations=['candidate nature','candidate botanical','negative reference'].map((term,i)=>{
    const content=`${term}: conversion Very low. No numerical conversion rate or buyer country was displayed.`;
    return{id:id(600+i),sourceId:`owner-source-${i}`,provenance:'owner_reported_capture',source:{url:'https://www.etsy.com/your/shops/me/marketplace-insights',interface:'Owner keyword insights',capturedAt:stamp,captureHash:String(i+1).repeat(64)},context:{productFormat:'Original adult printed T-shirt',category:'Adult apparel',query:term,windowStart:new Date(now-86400000).toISOString(),windowEnd:stamp,locale:'en-NZ',geography:{kind:'unknown',countries:[],basis:'Buyer segmentation was not displayed.'}},content,contentHash:hash(content),metrics:[{id:'conversion',label:'Conversion band',displayed:'Very low',start:0,end:Array.from(content).length,kind:'ordinal',scale:['Very low','Low','High'],value:'Very low',definition:'Provider relative conversion band; no numeric rate supplied.'}],limitations:['Negative signal retained; no candidate sales or country-level demand demonstrated.'],dataClass:'aggregate_nonpersonal'};
  });
  const c=observations[0].context,baseline={version:'r12.owner-observation-baseline.1',declaredAt:stamp,timing:'retrospective',productFormat:c.productFormat,category:c.category,windowStart:c.windowStart,windowEnd:c.windowEnd,locale:c.locale,candidateObservationIds:observations.slice(0,2).map(o=>o.id),referenceObservationId:observations[2].id,hypothesis:'A narrower adult interest may justify a bounded original design experiment.',positiveCriterion:'A supported contrast supplies an informative bounded learning test.',negativeCriterion:'Contrary observations defeat the specific premise.',inconclusiveCriterion:'Missing comparable exposure leaves demand unknown.'};
  const body={version:'r12.owner-observations.1',id:id(590),businessId:f.raw.businessId,ownerId:id(591),createdAt:stamp,observations,baseline,privacyAttestation:'reviewed_aggregate_only_no_credentials_or_customer_data'},bundle={...body,bundleHash:hash(body)};
  const manifest=[{bundleId:bundle.id,bundleHash:bundle.bundleHash,selectedObservationIds:observations.map(o=>o.id)}],selection={manifestHash:hash(manifest),manifest};
  f.raw.preview.ownerObservationRef=selection;f.raw.scope.ownerObservationRef=selection;
  f.ctx.plan.discoveryScopeHash=hash(f.raw.scope);f.ctx.planHash=hash(f.ctx.plan);f.raw.planHash=f.ctx.planHash;
  f.raw.action.scopeHash=hash(f.raw.scope);f.raw.actionHash=hash(f.raw.action);
  Object.assign(f.raw.intentPins,{ownerObservationRef:selection,scopeHash:hash(f.raw.scope),actionHash:f.raw.actionHash});f.ctx.attempt.adaptiveActionHash=f.raw.actionHash;
  f.raw.ownerObservationContext={version:'r12.owner-observation-context.1',intentId:f.raw.intent.id,businessId:f.raw.businessId,ownerId:bundle.ownerId,scopeId:f.raw.scope.id,scopeHash:hash(f.raw.scope),approvalHash:f.raw.scope.approvalHash,...selection,bundles:[bundle]};
  const p=f.raw.preview,scope=f.raw.scope;
  const quote=qualifyEtsyOwnerResearchQuote(r12CatalogFixture(now),now);
  const profile={...scope.profile,version:'r12.owner-research-profile.3',allowedDomains:['etsy.com'],sourceReviews:[{domain:'etsy.com',basis:'owner_reported_capture',reviewHash:'a'.repeat(64)}]};
  Object.assign(p,{version:'r12.adaptive-research-preview.2',maximumNewChildren:3,profileHash:hash(profile),quoteHash:quote.quoteHash});
  Object.assign(scope,{version:'r12.discovery-owner-adaptive.2',profile,profileHash:p.profileHash,quoteHash:quote.quoteHash,allowedDomains:['etsy.com']});
  scope.intent.comparisonUniverse.sourceDomains=['etsy.com'];scope.intent.limits.maximumNewCollections=0;
  const plan=f.ctx.plan;Object.assign(plan,{format:'r12.discovery-adaptive.2',maximumChildren:p.predecessor.baseChildren+3,discoveryScopeHash:hash(scope)});
  const phases=['plan','strategy','review'];plan.steps=plan.steps.filter(s=>phases.includes(s.key));plan.steps.forEach((s,i)=>{s.dependsOn=phases.slice(0,i);});
  Object.assign(f.raw.action,{version:'r12.adaptive-action.2',scopeHash:hash(scope),phases});f.raw.actionHash=hash(f.raw.action);
  Object.assign(f.raw.intentPins,{scopeVersion:scope.version,scopeHash:hash(scope),actionHash:f.raw.actionHash});
  f.ctx.planHash=hash(plan);f.raw.planHash=f.ctx.planHash;f.ctx.attempt.adaptiveActionHash=f.raw.actionHash;
  f.raw.ownerObservationContext.scopeHash=hash(scope);f.raw.version='r12.discovery-adaptive-inputs.2';f.quote=quote;f.outputs.plan.queryFocus=[];
  return f;
}
