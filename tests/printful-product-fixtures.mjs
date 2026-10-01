import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const P=require('../.core-tests/printful/production.js');
const C=require('../.core-tests/printful/contracts.js');
const F=require('../.core-tests/printful/configuration.js');
export const id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
export function productFixture(){
  const now=Date.now(),observedAt=new Date(now-1000).toISOString(),expiresAt=new Date(now+60000).toISOString();
  const bytes=Buffer.alloc(48,7),assetSha256=createHash('sha256').update(bytes).digest('hex'),scope={businessId:id(1),connectionId:id(2),connectionRevision:id(3),storeId:123,storeKind:'manual_api'};
  const context={mode:'fixture',observedAt,expiresAt};
  const product=C.parseCatalogProduct({data:{id:71,name:'Synthetic shirt',type:'shirt',is_discontinued:false,placements:[{placement:'front',technique:'dtg',layers:[{type:'file'}],conflicting_placements:[]}]}},C.catalogProductId(71),context);
  const variant=C.parseCatalogVariant({data:{id:4018,catalog_product_id:71,name:'White L',size:'L',color:'white',placement_dimensions:[{placement:'front',width:12,height:16,orientation:'any'}]}},C.catalogVariantId(4018),product.id,context);
  const asset={businessId:scope.businessId,assetVersionId:id(4),sha256:assetSha256,mimeType:'image/png',colorSpace:'srgb',widthPx:1800,heightPx:1800,designWidthIn:6,designHeightIn:6,
    printRequirement:{variantId:4018,placement:'front',technique:'dtg',minimumDpi:150,sourceUrl:'https://www.printful.com/creating-dtg-file',verifiedAt:observedAt,expiresAt},creativeApprovalId:id(5),creativeRunId:id(6)};
  const source={...scope,version:'1.0.0',id:id(7),evidenceMode:'fixture',goalId:id(8),workflowRunId:id(9),candidateId:id(10),decisionId:id(11),creativeApprovalId:id(5),creativeRunId:id(6),assetVersionId:id(4),assetSha256,
    assetStoragePath:`${scope.businessId}/${id(6)}/version-1.png`,plan:F.planPrintfulConfiguration({businessId:scope.businessId,product,variant,placement:'front',storeKind:'manual_api',asset}),fileTypeEvidence:{catalogProductId:71,catalogVariantId:4018,placement:'front',fileType:'default',responseHash:'f'.repeat(64),observedAt,expiresAt},name:'Synthetic product',retailPrice:'29.99',currency:'USD',printfulFileId:987,providerFactsHash:'b'.repeat(64),observedAt,expiresAt,
    fileBinding:{id:id(12),source:'authenticated_upload',assetSha256,printfulFileId:987,providerMd5:'c'.repeat(32),widthPx:1800,heightPx:1800,observedAt,expiresAt},
    placementEvidence:{id:id(13),source:'authenticated_placement',proofHash:'d'.repeat(64),assetSha256,catalogVariantId:4018,placement:'front',designWidthIn:6,designHeightIn:6,observedAt,expiresAt}};
  source.stockEvidence={variantId:4018,available:true,responseHash:'a'.repeat(64),observedAt,expiresAt};
  source.costEvidence={variantId:4018,currency:'USD',productionMinor:1000,responseHash:'b'.repeat(64),observedAt,expiresAt,pricing:{currency:'USD',itemPriceMinor:2999,shippingChargedMinor:0,discountBps:0,productionMinor:1000,fulfilmentShippingMinor:500,sellerTaxCostMinor:0,marketplaceFee:{fixedMinor:20,rateBps:650,basis:'item'},paymentFee:{fixedMinor:25,rateBps:300,basis:'item'},refundReserveBps:200,targetMarginBps:3000,assumptionLabel:'Synthetic explicit cost assumptions'}};
  source.providerFactsHash=P.productHash({productCatalogHash:source.plan.productCatalogHash,variantCatalogHash:source.plan.variantCatalogHash,stockEvidence:source.stockEvidence,costEvidence:source.costEvidence});
  const sourceHash=P.productHash(source),requestHash=P.productRequestHash(source,sourceHash),approval={id:id(14),sourceHash,requestHash,operation:'create_native_product',configuration:true,approvedAt:new Date(now).toISOString(),expiresAt};
  let state={...scope,id:id(15),sourceId:source.id,sourceHash,approvalHash:P.productHash(approval),requestHash,identity:P.productIdentity(source),actionIntentId:id(16),resourceId:id(17),receiptId:id(18),status:'ready',reason:null,stopRequested:false,dispatch:null,syncProductId:null,syncVariantId:null,receiptRecorded:false,observationHash:null};
  const file={id:987,type:'default',hash:'c'.repeat(32),mime_type:'image/png',width:1800,height:1800,dpi:300,status:'ok',is_temporary:false};
  const summary={id:222,external_id:P.productIdentity(source),name:source.name,variants:1,synced:1,is_ignored:false};
  const response={code:200,result:{sync_product:summary,sync_variants:[{id:333,external_id:`${P.productIdentity(source)}-v`,sync_product_id:222,synced:true,variant_id:4018,retail_price:'29.99',currency:'USD',is_ignored:false,product:{product_id:71,variant_id:4018},files:[file],availability_status:'active'}]}};
  let created=false,held=false,revision=0,localRevision=0,stale=false,access=true;const calls=[],receipts=[],resources=[],markers=[];
  const ctx={source,sourceHash,approval,approvalHash:P.productHash(approval),stopRequested:false};
  const repository={
    async acquire(){if(held)throw Error('product_in_progress');held=true;localRevision=revision;return structuredClone(state);},
    async save(next){if(!held||localRevision!==revision)throw Error('product_lease_lost');if(state.dispatch && P.productHash(state.dispatch)!==P.productHash(next.dispatch))throw Error('marker_immutable');
      if(next.receiptRecorded!==state.receiptRecorded)throw Error('finish_required');if(!state.dispatch&&next.dispatch)markers.push(structuredClone(next.dispatch));state=structuredClone({...next,stopRequested:ctx.stopRequested});Object.assign(next,state);revision++;localRevision=revision;},
    async guard(mode){if(localRevision!==revision)throw new P.PrintfulProductError('product_lease_lost');if(!held||!access)throw new P.PrintfulProductError('product_write_access_revoked');if(mode==='configure'&&(stale||ctx.stopRequested))throw new P.PrintfulProductError(stale?'product_source_stale':'product_cancelled');if(mode==='reconcile'&&!state.dispatch)throw Error('marker_required');return structuredClone({...ctx,stopRequested:ctx.stopRequested});},
    async assetBytes(){return bytes;},
    async finish(next,receipt,resource){if(!held||localRevision!==revision)throw Error('product_lease_lost');if(state.receiptRecorded)throw Error('already_recorded');receipts.push(structuredClone(receipt));resources.push(resource);state=structuredClone({...next,stopRequested:ctx.stopRequested});Object.assign(next,state);revision++;localRevision=revision;},
    async release(){held=false;},
  };
  const provider={
    async store(){calls.push('GET store');return{code:200,result:{id:123,type:'native'}};},
    async file(){calls.push('GET file');return{code:200,result:structuredClone(file)};},
    async findProduct(){calls.push('GET identity');return created?structuredClone(response):null;},
    async product(){calls.push('GET product');return structuredClone(response);},
    async create(){calls.push('POST product');created=true;return{code:200,result:structuredClone(summary)};},
  };
  return{now,source,ctx,approval,bytes,response,file,summary,repository,provider,calls,receipts,resources,markers,get state(){return state;},set state(value){state=value;},
    cancel(){ctx.stopRequested=true;state.stopRequested=true;if(!state.dispatch)state.status='cancelled';},drift(){stale=true;},revoke(){access=false;},appear(){created=true;},invalidateLease(){revision++;}};
}
