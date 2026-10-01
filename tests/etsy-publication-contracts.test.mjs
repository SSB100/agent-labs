import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {publicationFixture,id} from './etsy-publication-fixtures.mjs';
const require=createRequire(import.meta.url);
const P=require('../.core-tests/etsy-publication/contracts.js');
const {hash,verifyListing}=require('../.core-tests/etsy/contracts.js');
const preflight=f=>P.validatePublicationPreflight(f.preflight,f.listing,f.connection,f.p);
const financial=f=>P.validatePublicationFinancialAuthorization(f.context.financial,f.state,f.p,f.now);
const snapshot=f=>({listing:f.listing,images:f.images,properties:f.properties});

test('actual draft and active states are validated separately without relabelling provider responses',()=>{
  const f=publicationFixture();P.verifyPublicationReadback(snapshot(f),f.state,f.p,f.draft,'draft');assert.throws(()=>P.verifyPublicationReadback(snapshot(f),f.state,f.p,f.draft,'active'));
  f.listing.state='active';P.verifyPublicationReadback(snapshot(f),f.state,f.p,f.draft,'active');assert.throws(()=>verifyListing(f.listing,f.state,f.p,f.state.identity,500));assert.equal(f.listing.state,'active');
});
test('full preflight return/processing/shipping fields and fee components accept explicit synthetic evidence',()=>{const f=publicationFixture();assert.equal(preflight(f),hash(f.preflight));financial(f);});
for(const [name,change] of [
  ['deleted shipping profile',f=>f.preflight.shippingProfile.is_deleted=true],['origin ISO',f=>f.preflight.shippingProfile.origin_country_iso='invalid'],['postal origin absent',f=>f.preflight.shippingProfile.origin_postal_code=null],
  ['empty destination',f=>f.preflight.shippingProfile.shipping_profile_destinations=[{}]],['foreign destination',f=>f.preflight.shippingProfile.shipping_profile_destinations[0].shipping_profile_id=999],
  ['duplicate destination',f=>f.preflight.shippingProfile.shipping_profile_destinations.push({...f.preflight.shippingProfile.shipping_profile_destinations[0]})],['wrong cost currency',f=>f.preflight.shippingProfile.shipping_profile_destinations[0].primary_cost.currency_code='USD'],
  ['cost divisor',f=>f.preflight.shippingProfile.shipping_profile_destinations[0].primary_cost.divisor=0],['negative cost',f=>f.preflight.shippingProfile.shipping_profile_destinations[0].primary_cost.amount=-1],['missing secondary cost',f=>delete f.preflight.shippingProfile.shipping_profile_destinations[0].secondary_cost],
  ['missing delivery or carrier',f=>{f.preflight.shippingProfile.shipping_profile_destinations[0].min_delivery_days=null;f.preflight.shippingProfile.shipping_profile_destinations[0].max_delivery_days=null;}],
  ['reversed delivery days',f=>f.preflight.shippingProfile.shipping_profile_destinations[0].max_delivery_days=1],['unbounded delivery days',f=>f.preflight.shippingProfile.shipping_profile_destinations[0].max_delivery_days=100],
  ['conflicting destination region',f=>f.preflight.shippingProfile.shipping_profile_destinations[0].destination_region='eu'],['missing destination semantics',f=>delete f.preflight.shippingProfile.shipping_profile_destinations[0].destination_country_iso],
  ['incomplete upgrade',f=>f.preflight.shippingProfile.shipping_profile_upgrades=[{upgrade_id:1}]],['missing handling fee on calculated shipping',f=>{f.preflight.shippingProfile.profile_type='calculated';delete f.preflight.shippingProfile.domestic_handling_fee;}],
  ['negative handling fee',f=>f.preflight.shippingProfile.domestic_handling_fee=-1],['return policy identity',f=>f.preflight.returnPolicy.return_policy_id=100],['return policy absent boolean',f=>delete f.preflight.returnPolicy.accepts_returns],['accepted returns without deadline',f=>f.preflight.returnPolicy.accepts_returns=true],
  ['unsupported deadline',f=>{f.preflight.returnPolicy.accepts_returns=true;f.preflight.returnPolicy.return_deadline=20;}],['foreign processing shop',f=>f.preflight.processingProfile.shop_id=999],['foreign processing ID',f=>f.preflight.processingProfile.readiness_state_id=999],['unsupported processing',f=>f.preflight.processingProfile.readiness_state='ready_to_ship'],['reversed processing',f=>f.preflight.processingProfile.min_processing_days=10],['manual renewal false absent',f=>delete f.listing.should_auto_renew],
])test(`complete snapshot rejects ${name}`,()=>{const f=publicationFixture();change(f);assert.throws(()=>preflight(f));});
test('manual shipping need not invent absent calculated handling fees',()=>{const f=publicationFixture();delete f.preflight.shippingProfile.domestic_handling_fee;delete f.preflight.shippingProfile.international_handling_fee;preflight(f);});
test('explicit supported return deadline and region-only shipping remain valid',()=>{const f=publicationFixture();f.preflight.returnPolicy.accepts_returns=true;f.preflight.returnPolicy.return_deadline=30;f.preflight.shippingProfile.shipping_profile_destinations[0].destination_country_iso=null;f.preflight.shippingProfile.shipping_profile_destinations[0].destination_region='eu';preflight(f);});
for(const [name,change] of [
  ['missing trusted source',f=>f.quote.sourceKind='owner_typed_estimate'],['wrong source identity',f=>f.quote.sourceReceiptId='not-a-uuid'],['missing source hash',f=>f.quote.sourceHash='x'],['foreign fee listing',f=>f.quote.listingId=999],['foreign fee shop',f=>f.quote.shopId=999],['missing billing currency',f=>f.quote.billingCurrency=''],
  ['fractional fee',f=>f.quote.taxMinor=0.1],['negative tax',f=>f.quote.taxMinor=-1],['unbounded component',f=>f.quote.fxMinor=Infinity],['incorrect total',f=>f.quote.maximumTotalMinor++],['zero total',f=>{f.quote.maximumTotalMinor=0;f.quote.listingFeeMinor=0;f.quote.taxMinor=0;f.quote.fxMinor=0;}],
  ['replayed unrelated consent',f=>f.approval.requestHash='a'.repeat(64)],['unrelated disclosure',f=>f.approval.disclosureHash='a'.repeat(64)],['cap below quote',f=>f.approval.maximumTotalMinor=1],['different payment method',f=>f.approval.paymentMethod='card'],['ongoing renewal commitment',f=>f.approval.commitment='automatic_renewal'],['different public data',f=>f.approval.dataSharing='all_business_data'],
])test(`financial authorization rejects ${name} even if caller recomputes JSON hashes`,()=>{const f=publicationFixture();change(f);f.approval.quoteHash=hash(f.quote);f.state.approvalHash=hash(f.approval);assert.throws(()=>financial(f));});
test('billing currency is independently sourced and never inferred from listing currency',()=>{const f=publicationFixture();f.quote.billingCurrency='USD';f.approval.billingCurrency='USD';f.approval.quoteHash=hash(f.quote);f.state.approvalHash=hash(f.approval);financial(f);assert.equal(f.p.currency,'NZD');});
for(const field of ['listingId','connectionRevision','packageHash','reviewHash','draftReceiptHash','disclosureHash','preflightHash'])test(`request fingerprint binds ${field}`,()=>{const f=publicationFixture(),before=P.publicationRequestHash(f.state);f.state[field]=field==='listingId'?999:field==='connectionRevision'?id(99):'a'.repeat(64);assert.notEqual(P.publicationRequestHash(f.state),before);});
test('duplicate or forged provider image identity never passes independent readback',()=>{const f=publicationFixture();f.images.push({...f.images[0]});assert.throws(()=>P.verifyPublicationReadback(snapshot(f),f.state,f.p,f.draft,'draft'));f.images.pop();f.draft.imageMappings[0].sha256='b'.repeat(64);assert.throws(()=>P.verifyPublicationReadback(snapshot(f),f.state,f.p,f.draft,'draft'));});
test('rational provider money is exact and floating conversion cannot mask a cent difference',()=>{const f=publicationFixture();f.listing.price={amount:f.p.priceMinor*10,divisor:1000,currency_code:f.p.currency};P.verifyPublicationReadback(snapshot(f),f.state,f.p,f.draft,'draft');f.listing.price.amount++;assert.throws(()=>P.verifyPublicationReadback(snapshot(f),f.state,f.p,f.draft,'draft'));});

test('calculated shipping remains explicitly outside this initial qualification lane without rewriting the profile',()=>{const f=publicationFixture();f.preflight.shippingProfile.profile_type='calculated';assert.throws(()=>preflight(f),/publication_calculated_shipping_not_supported/);assert.equal(f.preflight.shippingProfile.profile_type,'calculated');});
