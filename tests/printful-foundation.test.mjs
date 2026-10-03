import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const C=require('../.core-tests/printful/contracts.js');
const P=require('../.core-tests/printful/pricing.js');
const F=require('../.core-tests/printful/configuration.js');
const {validateCoreContract}=require('../.core-tests/core/validation.js');
const businessId='11111111-1111-4111-8111-111111111111';
const assetId='22222222-2222-4222-8222-222222222222';
function fixture(){
  const now=Date.now(),context={mode:'fixture',observedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString()};
  const productBody={data:{id:71,name:'Synthetic T-shirt',type:'T-Shirt',is_discontinued:false,placements:[{placement:'front',technique:'dtg',layers:[{type:'file'}],conflicting_placements:[]}]}};
  const variantBody={data:{id:4018,catalog_product_id:71,name:'Synthetic white large',size:'L',color:'White',placement_dimensions:[{placement:'front',width:12,height:16,orientation:'any'}]}};
  const priceBody={data:{currency:'USD',product:{id:71,placements:[{id:'front',technique_key:'dtg',price:'5.75'}]},variant:{id:4018,techniques:[{technique_key:'dtg',price:'9.50',discounted_price:'8.50'}]}}};
  const product=C.parseCatalogProduct(productBody,C.catalogProductId(71),context),variant=C.parseCatalogVariant(variantBody,C.catalogVariantId(4018),product.id,context);
  const prices=C.parseVariantPrices(priceBody,variant,{...context,currency:'USD',sellingRegion:'north_america',productionCurrency:null});
  const asset={businessId,assetVersionId:assetId,sha256:'a'.repeat(64),mimeType:'image/png',colorSpace:'srgb',widthPx:1024,heightPx:1024,designWidthIn:6.5,designHeightIn:6.5,
    printRequirement:{variantId:4018,placement:'front',technique:'dtg',minimumDpi:150,sourceUrl:'https://www.printful.com/creating-dtg-file',verifiedAt:context.observedAt,expiresAt:context.expiresAt},creativeApprovalId:null,creativeRunId:null};
  return {context,productBody,variantBody,priceBody,product,variant,prices,asset};
}
test('provider contract keeps product and variant IDs distinct and rejects a mismatched parent',()=>{
  const f=fixture();assert.equal(f.product.id.kind,'catalog_product');assert.equal(f.variant.id.kind,'catalog_variant');
  assert.throws(()=>C.parseCatalogProduct(f.productBody,C.catalogVariantId(71),f.context),/variant ID/);
  assert.throws(()=>C.parseCatalogVariant(f.variantBody,C.catalogVariantId(4018),C.catalogProductId(999),f.context),/identity/);
  assert.throws(()=>C.printfulReadRequest('variant',C.catalogProductId(4018)),/different identity/);
});
test('catalog provenance is bounded, immutable by copying and never confers live qualification',()=>{
  const f=fixture();assert.equal(f.product.provenance.mode,'fixture');assert.equal(f.product.provenance.liveQualified,false);
  f.productBody.data.name='Changed';assert.equal(f.product.name,'Synthetic T-shirt');
  assert.equal(f.product.provenance.responseHash.length,64);
  assert.throws(()=>C.assertFreshPrintful({...f.product.provenance,expiresAt:new Date(Date.now()-1).toISOString()}),/stale/);
  assert.throws(()=>C.parseCatalogProduct({...f.productBody,data:{...f.productBody.data,placements:[...f.productBody.data.placements,...f.productBody.data.placements]}},C.catalogProductId(71),f.context),/duplicate/);
  assert.equal(f.prices.provenance.currency,undefined);
});
test('provider decimal strings are exact and ambiguous money/currencies fail closed',()=>{
  for(const [raw,expected] of [['0',0],['0.01',1],['9.5',950],['19.75',1975]])assert.equal(C.decimalMinor(raw),expected);
  for(const raw of [9.5,'-1','1e3','1.001','01.00','NaN','Infinity'])assert.throws(()=>C.decimalMinor(raw),/price/);
  assert.throws(()=>C.supportedCurrency('JPY'),/bounded pricing/);
  const f=fixture();assert.throws(()=>C.parseVariantPrices(f.priceBody,f.variant,{...f.context,currency:'NZD',sellingRegion:'new_zealand',productionCurrency:null}),/currency differs/);
});
test('single ordinary DTG placement is included once and unverified discounts are not applied',()=>{
  const f=fixture(),cost=P.singlePlacementProductionCost(f.prices,'front');
  assert.equal(cost.productionMinor,950);assert.equal(cost.discountedPriceUsed,false);assert.notEqual(cost.productionMinor,950+575);
  assert.equal(cost.executionAuthorized,false);assert.ok(cost.excludes.includes('shipping'));
  assert.throws(()=>P.singlePlacementProductionCost(f.prices,'label_inside'),/ordinary/);
  assert.throws(()=>P.singlePlacementProductionCost(f.prices,'back'),/exact DTG/);
});
function pricing(){return {currency:'USD',itemPriceMinor:3000,shippingChargedMinor:500,discountBps:1000,productionMinor:950,fulfilmentShippingMinor:500,sellerTaxCostMinor:0,marketplaceFee:{fixedMinor:20,rateBps:650,basis:'item_plus_shipping'},paymentFee:{fixedMinor:25,rateBps:300,basis:'item_plus_shipping'},refundReserveBps:200,targetMarginBps:3000,assumptionLabel:'Synthetic fee scenario; no seller bank country inferred'};}
test('deterministic pricing distinguishes revenue, costs, fees, allowance and profit',()=>{
  const result=P.evaluatePrintPricing(pricing());assert.equal(result.status,'scenario_calculated');
  assert.equal(result.discountMinor,300);assert.equal(result.revenueMinor,3200);assert.equal(result.marketplaceFeeMinor,228);assert.equal(result.paymentFeeMinor,121);assert.equal(result.refundReserveMinor,64);assert.equal(result.totalCostMinor,1863);assert.equal(result.profitMinor,1337);assert.equal(result.marginBps,4178);assert.equal(result.meetsTarget,true);assert.equal(result.executionAuthorized,false);
});
test('unknown fees, shipping and tax remain unknown, including explicitly zero versus missing',()=>{
  const input=pricing();input.paymentFee=null;input.fulfilmentShippingMinor=null;
  const result=P.evaluatePrintPricing(input);assert.equal(result.status,'needs_inputs');assert.equal(result.profitMinor,null);assert.equal(result.meetsTarget,null);assert.deepEqual(result.missing.sort(),['fulfilmentShippingMinor','paymentFee']);
  assert.throws(()=>P.evaluatePrintPricing({...pricing(),discountBps:-1}),/basis points/);
  assert.throws(()=>P.evaluatePrintPricing({...pricing(),productionMinor:1.5}),/minor units/);
});
test('pricing rounds fee deductions conservatively and handles a real negative margin',()=>{
  const result=P.evaluatePrintPricing({...pricing(),itemPriceMinor:1,shippingChargedMinor:0,discountBps:0,productionMinor:3,fulfilmentShippingMinor:0,marketplaceFee:{fixedMinor:0,rateBps:1,basis:'item'},paymentFee:{fixedMinor:0,rateBps:0,basis:'item'},refundReserveBps:0});
  assert.equal(result.marketplaceFeeMinor,1);assert.equal(result.profitMinor,-3);assert.equal(result.marginBps,-30000);assert.equal(result.meetsTarget,false);
});
test('print planning binds a same-Business PNG to the current exact variant and physical dimensions',()=>{
  const f=fixture(),input={businessId,product:f.product,variant:f.variant,placement:'front',storeKind:'manual_api',asset:f.asset};
  const plan=F.planPrintfulConfiguration(input);assert.equal(plan.state,'proposal');assert.equal(plan.executionAuthorized,false);assert.equal(plan.operation,'create_native_sync_product');assert.ok(plan.effectiveDpi>150);assert.equal(plan.assetSha256,f.asset.sha256);
  assert.throws(()=>F.planPrintfulConfiguration({...input,asset:{...f.asset,businessId:'33333333-3333-4333-8333-333333333333'}}),/Business/);
  assert.throws(()=>F.planPrintfulConfiguration({...input,asset:{...f.asset,designWidthIn:13}}),/print area/);
  assert.throws(()=>F.planPrintfulConfiguration({...input,asset:{...f.asset,widthPx:500,heightPx:500}}),/upscaling/);
  assert.throws(()=>F.planPrintfulConfiguration({...input,asset:{...f.asset,printRequirement:{...f.asset.printRequirement,variantId:999}}}),/print rule/);
});
test('ecommerce-linked configuration is mapping, never native-store creation or Etsy publishing',()=>{
  const f=fixture(),plan=F.planPrintfulConfiguration({businessId,product:f.product,variant:f.variant,placement:'front',storeKind:'ecommerce_linked',asset:f.asset});
  assert.equal(plan.operation,'map_existing_ecommerce_variant');assert.ok(plan.requires.includes('existing_imported_ecommerce_variant'));assert.equal(plan.publicationAuthorized,false);assert.equal(plan.orderSubmissionAuthorized,false);
});
test('mock configuration uses Core receipt shape without claiming an external resource or live verification',()=>{
  const f=fixture(),plan=F.planPrintfulConfiguration({businessId,product:f.product,variant:f.variant,placement:'front',storeKind:'manual_api',asset:f.asset});
  const now=new Date().toISOString(),intent={id:'44444444-4444-4444-8444-444444444444',businessId,createdAt:now,updatedAt:now,workflowRunId:null,taskContractId:null,actionType:'printful.product.configure',capability:'fulfilment.print',status:'proposed',request:{executionMode:'simulation',planHash:plan.requestHash,assetSha256:plan.assetSha256},risk:{simulation:true},financialImpact:{amountMinor:0},idempotencyKey:'synthetic-configuration-1',createdByType:'system',createdById:null};
  validateCoreContract('actionIntent',intent);
  const result=F.simulatePrintfulConfiguration(intent,plan,{receiptId:'55555555-5555-4555-8555-555555555555',occurredAt:now,attempt:1});
  validateCoreContract('actionReceipt',result.receipt);assert.equal(result.externalResource,null);assert.equal(result.receipt.provider,'mock.printful');assert.equal(result.receipt.responseSummary.liveVerified,false);assert.equal(result.receipt.responseSummary.externalActionExecuted,false);
  assert.throws(()=>F.simulatePrintfulConfiguration({...intent,request:{...intent.request,executionMode:'live'}},plan,{receiptId:assetId,occurredAt:now,attempt:1}),/live action/);
  assert.throws(()=>F.simulatePrintfulConfiguration(intent,plan,{receiptId:assetId,occurredAt:now,attempt:2}),/single/);
});
test('uncertain external mutation requires reconciliation and never authorizes blind retry',()=>{
  const result=F.printfulMutationRecovery('uncertain','saved-product-identity');assert.equal(result.next,'reconcile_by_saved_external_id');assert.equal(result.retryAllowed,false);assert.equal(result.executionAuthorized,false);
});

const {PrintfulCatalogAdapter}=require('../.core-tests/printful/adapter.js');
const mockConnection=()=>({businessId,externalResourceId:'66666666-6666-4666-8666-666666666666',storeId:123,provider:'printful',status:'connected',permittedOperations:['catalog.read'],credential:'synthetic-secret-not-a-real-token'});
const jsonResponse=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
test('catalog transport denies absent operating admission before sending credentials',async()=>{
 let calls=0;const adapter=new PrintfulCatalogAdapter({mode:'fixture',freshnessMs:1000,authorize:async()=>mockConnection(),fetcher:async()=>{calls++;throw Error('must not call');}});
 await assert.rejects(adapter.product(businessId,C.catalogProductId(71)));assert.equal(calls,0);
});
test('read adapter is fixed-host GET-only and excludes credentials from normalized artifacts and receipts',async()=>{
  const f=fixture(),calls=[];const adapter=new PrintfulCatalogAdapter({ admitDispatch: async () => {},mode:'fixture',freshnessMs:60000,authorize:async()=>mockConnection(),fetcher:async(url,init)=>{calls.push({url,init});return jsonResponse(url.includes('/prices')?f.priceBody:url.includes('catalog-variants')?f.variantBody:f.productBody);}});
  const product=await adapter.product(businessId,C.catalogProductId(71));const variant=await adapter.variant(businessId,C.catalogVariantId(4018),product.value.id);const prices=await adapter.prices(businessId,variant.value,'USD','north_america');
  assert.equal(prices.value.techniques[0].regularMinor,950);assert.equal(calls.length,3);
  assert.ok(calls.every(call=>call.init.method==='GET'&&call.init.redirect==='error'&&new URL(call.url).origin==='https://api.printful.com'));
  assert.ok(calls.every(call=>call.init.headers['X-PF-Store-Id']==='123'));
  assert.equal(product.receipt.executionMode,'fixture');assert.equal(product.receipt.liveQualified,false);assert.equal(product.receipt.externalMutation,false);
  assert.ok(!JSON.stringify([product,variant,prices]).includes(mockConnection().credential));
});
test('read adapter denies missing/cross-Business authority before transport and fixture mode has no live default',async()=>{
  assert.throws(()=>new PrintfulCatalogAdapter({ admitDispatch: async () => {},mode:'fixture',freshnessMs:1000,authorize:async()=>mockConnection()}),/mock transport/);
  let calls=0;const fetcher=async()=>{calls++;throw Error('unexpected fetch');};
  for(const connection of [{...mockConnection(),businessId:assetId},{...mockConnection(),permittedOperations:['catalog.read','orders.write']},{...mockConnection(),status:'revoked'}]){
    const adapter=new PrintfulCatalogAdapter({ admitDispatch: async () => {},mode:'fixture',freshnessMs:1000,authorize:async()=>connection,fetcher});
    await assert.rejects(()=>adapter.product(businessId,C.catalogProductId(71)),/verified same-Business/);
  }assert.equal(calls,0);
});
test('read failure retains safe categories without retrying or echoing provider/authentication content',async()=>{
  for(const status of [401,403,404,429,500]){let calls=0;const adapter=new PrintfulCatalogAdapter({ admitDispatch: async () => {},mode:'fixture',freshnessMs:1000,authorize:async()=>mockConnection(),fetcher:async()=>{calls++;return new Response(mockConnection().credential,{status});}});await assert.rejects(()=>adapter.product(businessId,C.catalogProductId(71)),error=>{assert.ok(!error.message.includes(mockConnection().credential));assert.ok(error.category);return true;});assert.equal(calls,1);}
  const adapter=new PrintfulCatalogAdapter({ admitDispatch: async () => {},mode:'fixture',freshnessMs:1000,authorize:async()=>{throw Error(mockConnection().credential);},fetcher:async()=>{throw Error('unexpected');}});
  await assert.rejects(()=>adapter.product(businessId,C.catalogProductId(71)),error=>error.category==='connection_required'&&!error.message.includes(mockConnection().credential));
});
test('read adapter rejects oversized/malformed bodies and preserves the requested ID across asynchronous authorization',async()=>{
  const f=fixture();for(const response of [new Response('broken',{headers:{'content-type':'application/json'}}),new Response('{}',{headers:{'content-type':'application/json','content-length':'2000001'}})]){
    const adapter=new PrintfulCatalogAdapter({ admitDispatch: async () => {},mode:'fixture',freshnessMs:1000,authorize:async()=>mockConnection(),fetcher:async()=>response});await assert.rejects(()=>adapter.product(businessId,C.catalogProductId(71)),error=>error.category==='invalid_response');
  }
  const id=C.catalogProductId(71);const adapter=new PrintfulCatalogAdapter({ admitDispatch: async () => {},mode:'fixture',freshnessMs:1000,authorize:async()=>{id.value=999;return mockConnection();},fetcher:async url=>{assert.match(url,/\/71$/);return jsonResponse(f.productBody);}});
  assert.equal((await adapter.product(businessId,id)).value.id.value,71);
});

test('configuration hash binds both physical dimensions even when minimum DPI is identical',()=>{
  const f=fixture(),input={businessId,product:f.product,variant:f.variant,placement:'front',storeKind:'manual_api',asset:{...f.asset,designWidthIn:6.4,designHeightIn:6.4}};
  const a=F.planPrintfulConfiguration(input),b=F.planPrintfulConfiguration({...input,asset:{...input.asset,designHeightIn:3.2,heightPx:512}});
  assert.equal(a.effectiveDpi,b.effectiveDpi);assert.notEqual(a.requestHash,b.requestHash);
  assert.equal(a.designWidthIn,6.4);assert.equal(b.designHeightIn,3.2);
});

test('print planning rejects implicit artwork distortion',()=>{
 const f=fixture();assert.throws(()=>F.planPrintfulConfiguration({businessId,product:f.product,variant:f.variant,placement:'front',storeKind:'manual_api',asset:{...f.asset,designHeightIn:5}}),/aspect ratio/);
});

test('price identities are copied and modified configuration proposals cannot create receipts',()=>{
 const f=fixture(),original=f.prices.variantId.value;f.variant.id.value=999;assert.equal(f.prices.variantId.value,original);
 const g=fixture(),plan=F.planPrintfulConfiguration({businessId,product:g.product,variant:g.variant,placement:'front',storeKind:'manual_api',asset:g.asset});
 F.assertPrintfulConfigurationPlan(plan);
 for(const change of [{variantId:999},{requires:[]},{executionAuthorized:true}])assert.throws(()=>F.assertPrintfulConfigurationPlan({...plan,...change}));
});
test('valid JSON with malformed provider schema is categorized without echoing response data',async()=>{
 const adapter=new PrintfulCatalogAdapter({ admitDispatch: async () => {},mode:'fixture',freshnessMs:1000,authorize:async()=>mockConnection(),fetcher:async()=>jsonResponse({secret:'synthetic-secret'})});
 await assert.rejects(()=>adapter.product(businessId,C.catalogProductId(71)),error=>error.category==='invalid_response'&&!error.message.includes('synthetic-secret'));
});
