import { createRequire } from 'node:module';
import { packageFixture, id } from './etsy-fixtures.mjs';
const require = createRequire(import.meta.url);
const C = require('../.core-tests/etsy/contracts.js');
const P = require('../.core-tests/etsy-publication/contracts.js');
export { id };
/** Explicitly synthetic only: no authentic model review, provider fee source,
 * real shop, account credentials, live publication or qualification is claimed. */
export function publicationFixture() {
  const now = Date.now(), iso = delta => new Date(now + delta).toISOString();
  const p = packageFixture().package; p.quantity = 1;
  const connection = { businessId:p.businessId, connectionId:id(24), shopId:100, revision:id(25), userId:101, currency:p.currency, status:'connected', expiresAt:iso(3600000), accessToken:'synthetic-only-token' };
  const identity = C.draftIdentity(connection,p);
  const body = C.draftBody(p,identity);
  const listing = {...body,listing_id:500,shop_id:100,state:'draft',listing_type:'physical',return_policy_id:77,price:{amount:p.priceMinor,divisor:100,currency_code:p.currency},production_partners:p.productionPartnerIds.map(production_partner_id=>({production_partner_id}))};
  const images = p.images.map((image,index)=>({listing_id:500,listing_image_id:601+index,rank:index+1,alt_text:image.altText}));
  const properties = p.properties.map(prop=>({property_id:prop.propertyId,value_ids:prop.valueIds,values:prop.values,scale_id:prop.scaleId}));
  const preflight = { quantity:1, shouldAutoRenew:false, shippingProfileId:p.shippingProfileId, returnPolicyId:77,
    shippingProfile:{shipping_profile_id:p.shippingProfileId,user_id:101,is_deleted:false,origin_country_iso:'NZ',origin_postal_code:'1010',profile_type:'manual',domestic_handling_fee:0,international_handling_fee:0,shipping_profile_destinations:[{shipping_profile_destination_id:81,shipping_profile_id:p.shippingProfileId,origin_country_iso:'NZ',destination_country_iso:'NZ',destination_region:'none',primary_cost:{amount:500,divisor:100,currency_code:'NZD'},secondary_cost:{amount:0,divisor:100,currency_code:'NZD'},shipping_carrier_id:null,mail_class:null,min_delivery_days:2,max_delivery_days:5}],shipping_profile_upgrades:[]},
    returnPolicy:{return_policy_id:77,shop_id:100,accepts_returns:false,accepts_exchanges:false,return_deadline:null},
    processingProfile:{shop_id:100,readiness_state_id:p.readinessStateId,readiness_state:'made_to_order',min_processing_days:2,max_processing_days:5,processing_days_display_label:'Synthetic 2–5 days'},
  };
  const draft = {runId:id(20),receiptId:id(21),resourceId:id(22),packageHash:C.hash(p),responseHash:C.hash({listing,images,properties}),listingId:500,shopId:100,identity,imageMappings:p.images.map((image,index)=>({assetId:image.assetId,sha256:image.sha256,listingImageId:601+index})),verifiedAt:iso(-500)};
  const state = {id:id(30),actionIntentId:id(31),resourceId:id(32),receiptId:id(33),businessId:p.businessId,connectionId:connection.connectionId,shopId:100,connectionRevision:connection.revision,listingId:500,identity,packageHash:C.hash(p),reviewHash:C.hash({syntheticReview:'APPROVE'}),draftReceiptHash:C.hash({syntheticDraftReceipt:draft}),approvalHash:'',disclosureHash:C.hash({syntheticDisclosure:'example only; no provider fee evidence'}),preflightHash:C.hash(preflight),requestHash:'',status:'ready',reason:null,stopRequested:false,providerState:'unknown',activation:null};
  state.requestHash = P.publicationRequestHash(state);
  const quote = {version:'1.0',provider:'etsy',scope:'one_listing_activation',sourceKind:'verified_provider_checkout',sourceReceiptId:id(34),sourceHash:C.hash({syntheticQuote:'test only'}),shopId:100,listingId:500,billingCurrency:'NZD',listingFeeMinor:40,taxMinor:6,fxMinor:1,otherMandatoryFeesMinor:0,maximumTotalMinor:47,verifiedAt:iso(-1000),expiresAt:iso(300000),disclosureHash:state.disclosureHash};
  const approval = {id:id(35),requestHash:state.requestHash,quoteHash:C.hash(quote),disclosureHash:state.disclosureHash,billingCurrency:'NZD',maximumTotalMinor:47,approvedQuantity:1,paymentMethod:'etsy_payment_account',commitment:'publish_existing_quantity_manual_renewal',dataSharing:'make_exact_reviewed_listing_public',approvedAt:iso(-100),expiresAt:iso(300000)};
  state.approvalHash=C.hash(approval);
  const context={package:p,connection,draft,reviewHash:state.reviewHash,draftReceiptHash:state.draftReceiptHash,approvalHash:state.approvalHash,disclosureHash:state.disclosureHash,preflightHash:state.preflightHash,requestHash:state.requestHash,financial:{quote,approval},preflight,stopRequested:false};
  const providerPreflight=structuredClone(preflight);
  let saved=structuredClone(state),locked=false,cancelled=false,sourceCurrent=true;
  const calls=[], receipts=[], resources=[];
  const store={
    async acquire(){if(locked)throw new C.EtsyError('publication_in_progress');locked=true;return structuredClone(saved);},
    async save(value){if(saved.activation && (!value.activation || value.activation.requestHash!==saved.activation.requestHash || value.activation.sentAt!==saved.activation.sentAt))throw new Error('immutable activation violated');saved=structuredClone(value);saved.stopRequested ||= cancelled;},
    async guard(mode){if(mode==='publish'&&!sourceCurrent)throw new C.EtsyError('stale_package_or_approval');return {...structuredClone(context),stopRequested:cancelled||context.stopRequested};},
    async finish(value,receipt,resource){if(receipts.length)throw new Error('duplicate receipt');saved=structuredClone(value);saved.stopRequested ||= cancelled;receipts.push(structuredClone(receipt));resources.push(structuredClone(resource));},
    async release(){locked=false;},
  };
  const provider={
    async shop(){calls.push('GET shop');return{shop_id:100,user_id:101,currency_code:'NZD'};},
    async listing(listingId){calls.push('GET listing');if(listingId!==500)throw new Error('foreign read');return structuredClone(listing);},
    async images(listingId){calls.push('GET images');if(listingId!==500)throw new Error('foreign read');return structuredClone(images);},
    async properties(listingId){calls.push('GET properties');if(listingId!==500)throw new Error('foreign read');return structuredClone(properties);},
    async shippingProfile(profileId){calls.push('GET shipping');if(profileId!==p.shippingProfileId)throw new Error('foreign profile');return structuredClone(providerPreflight.shippingProfile);},
    async returnPolicy(policyId){calls.push('GET return');if(policyId!==77)throw new Error('foreign policy');return structuredClone(providerPreflight.returnPolicy);},
    async processingProfile(profileId){calls.push('GET processing');if(profileId!==p.readinessStateId)throw new Error('foreign processing');return structuredClone(providerPreflight.processingProfile);},
    async activate(listingId){calls.push('PATCH active');if(listingId!==500)throw new Error('foreign mutation');listing.state='active';return structuredClone(listing);},
  };
  return {now,p,connection,context,listing,images,properties,preflight,providerPreflight,draft,quote,approval,store,provider,calls,receipts,resources,get state(){return saved;},cancel(){cancelled=true;saved.stopRequested=true;if(!saved.activation)saved.status='cancelled';},driftSource(){sourceCurrent=false;}};
}
