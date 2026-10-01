import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../.core-tests/etsy/contracts.js');
export const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
export function packageFixture() {
  const bytes = new Uint8Array([137,80,78,71,13,10,26,10,1,2,3,4]);
  return { bytes, package: { version:'1.0', id:id(1),businessId:id(2),goalId:id(3),workflowRunId:id(4),productIdentity:'approved-product-1',candidateId:id(5),decisionId:id(6),creativeApprovalId:id(7),creativeRunId:id(8),printfulResourceId:id(9),printfulReceiptId:id(10),productFactsHash:'a'.repeat(64),approvedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),title:'Synthetic original shirt',description:'Fixture only. Original illustration on a cotton shirt.',quantity:3,priceMinor:3295,currency:'NZD',taxonomyId:482,shippingProfileId:21,readinessStateId:22,productionPartnerIds:[23],tags:['original shirt'],materials:['cotton'],properties:[{propertyId:100,valueIds:[200],values:['White'],scaleId:null}],images:[{assetId:id(11),sha256:C.bytesHash(bytes),storagePath:`${id(2)}/${id(8)}/version-1.png`,mediaType:'image/png',altText:'Original illustration on a white shirt'}] } };
}
export function engineFixture() {
  const {bytes,package:p} = packageFixture();
  let state={id:id(20),actionIntentId:id(21),resourceId:id(22),receiptId:id(23),businessId:p.businessId,connectionId:id(24),shopId:100,connectionRevision:id(25),packageHash:C.hash(p),identity:'',listingId:null,operations:[],status:'ready',reason:null};
  state.identity=C.draftIdentity(state,p);
  const connection={businessId:p.businessId,connectionId:state.connectionId,shopId:100,revision:state.connectionRevision,userId:101,currency:'NZD',status:'connected',expiresAt:p.expiresAt,accessToken:'fixture-only-token'};
  let locked=false, cancelled=false, listing=null, imageRows=[],propertyRows=[]; const calls=[];const receipts=[];const resources=[];
  const store={
    async acquire(){if(locked)throw new C.EtsyError('draft_in_progress');locked=true;return structuredClone(state);},
    async save(s){state=structuredClone(s);if(cancelled)state.status='cancelled';},
    async guard(){if(cancelled)throw new C.EtsyError('cancelled');return{connection:structuredClone(connection),package:structuredClone(p)};},
    async image(){return bytes;},async finish(s,r,e){if(cancelled)throw new C.EtsyError('cancelled');state=structuredClone(s);receipts.push(r);resources.push(e);},async release(){locked=false;},
  };
  const provider={
    async shop(){calls.push('shop');return{shop_id:100,user_id:101,currency_code:'NZD'};},
    async findDraft(){calls.push('find');return structuredClone(listing);},
    async create(pkg,identity){calls.push('POST listing');const body=C.draftBody(pkg,identity);listing={...body,listing_id:500,shop_id:100,state:'draft',listing_type:'physical',price:{amount:pkg.priceMinor,divisor:100,currency_code:pkg.currency},production_partners:pkg.productionPartnerIds.map(production_partner_id=>({production_partner_id}))};return structuredClone(listing);},
    async listing(){calls.push('GET listing');return structuredClone(listing);},
    async images(){calls.push('GET images');return structuredClone(imageRows);},
    async upload(listingId,uploaded,rank,alt){calls.push('POST image');if(C.bytesHash(uploaded)!==p.images[rank-1].sha256)throw new Error('wrong bytes');const row={listing_id:listingId,listing_image_id:600+rank,rank,alt_text:alt};imageRows.push(row);return row;},
    async properties(){calls.push('GET properties');return structuredClone(propertyRows);},
    async setProperty(listingId,prop){calls.push('PUT property');propertyRows.push({property_id:prop.propertyId,value_ids:prop.valueIds,values:prop.values,scale_id:prop.scaleId});return propertyRows.at(-1);},
  };
  return {p,connection,bytes,store,provider,calls,receipts,resources,get state(){return state;},get listing(){return listing;},get images(){return imageRows;},get properties(){return propertyRows;},cancel(){cancelled=true;state.status='cancelled';}};
}
