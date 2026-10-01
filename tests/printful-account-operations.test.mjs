import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const A=require('../.core-tests/printful/account.js');
const O=require('../.core-tests/printful/operations.js');
const {printfulHash}=require('../.core-tests/printful/contracts.js');
const businessId='11111111-1111-4111-8111-111111111111',connectionResourceId='22222222-2222-4222-8222-222222222222';
const binding=()=>({businessId,connectionResourceId,storeId:12,storeKind:'manual_api',status:'connected',expiresAt:new Date(Date.now()+60000).toISOString()});
test('account resolver checks owner and exact live binding before resolving a server-only credential',async()=>{
 const calls=[];const authorize=A.printfulReadAuthorization({requireBusinessOwner:async id=>{assert.equal(id,businessId);calls.push('owner')},loadBinding:async()=>{calls.push('binding');return binding()},resolveServerCredential:async id=>{assert.equal(id,connectionResourceId);calls.push('credential');return 'synthetic-token'}});
 const result=await authorize(businessId);assert.deepEqual(calls,['owner','binding','credential']);assert.deepEqual(result.permittedOperations,['catalog.read']);assert.equal(result.storeId,12);
 for(const changed of [{...binding(),businessId:connectionResourceId},{...binding(),status:'revoked'},{...binding(),expiresAt:'broken'},{...binding(),expiresAt:new Date(0).toISOString()}]){
 let credentials=0;const denied=A.printfulReadAuthorization({requireBusinessOwner:async()=>{},loadBinding:async()=>changed,resolveServerCredential:async()=>{credentials++;return 'synthetic-token'}});await assert.rejects(()=>denied(businessId),/active same-Business/);assert.equal(credentials,0);
 }
});
test('store inspection binds provider identity and native/ecommerce semantics without creating a connection',()=>{
 const body={code:200,result:{id:12,type:'native',name:'Synthetic API store'}};
 const result=A.inspectPrintfulStore(body,{storeId:12,storeKind:'manual_api'});assert.equal(result.connectionAuthorized,false);assert.equal(result.productExecutionAuthorized,false);
 assert.throws(()=>A.inspectPrintfulStore(body,{storeId:13,storeKind:'manual_api'}),/different/);
 assert.throws(()=>A.inspectPrintfulStore(body,{storeId:12,storeKind:'ecommerce_linked'}),/integration/);
 assert.deepEqual(A.printfulConnectionSummary(null,businessId),{status:'not_connected',liveQualified:false,productExecutionAuthorized:false});
});
function proposal(storeKind='manual_api'){
 const selection={businessId,productId:71,variantId:4018,placement:'front',technique:'dtg',storeKind,operation:storeKind==='manual_api'?'create_native_sync_product':'map_existing_ecommerce_variant',assetVersionId:connectionResourceId,assetSha256:'a'.repeat(64),sourceWidthPx:1024,sourceHeightPx:1024,designWidthIn:6.4,designHeightIn:6.4,effectiveDpi:160,productCatalogHash:'b'.repeat(64),variantCatalogHash:'c'.repeat(64),printRequirementHash:'d'.repeat(64)};
 const plan={...selection,version:'1.0.0',requestHash:printfulHash(selection),state:'proposal',executionAuthorized:false,publicationAuthorized:false,orderSubmissionAuthorized:false,requires:['verified_store_connection','current_persisted_creative_production_approval','current_stock_and_cost_quote','owner_configuration_approval',...(storeKind==='ecommerce_linked'?['existing_imported_ecommerce_variant']:[])]};
 return {plan,storeId:12,name:'Synthetic design',externalIdentity:'synthetic-product',existingSyncVariantId:storeKind==='manual_api'?null:678,printfulFileId:99,fileAssetSha256:plan.assetSha256,fileTypeEvidence:{catalogProductId:71,catalogVariantId:4018,placement:'front',fileType:'default',observedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),responseHash:'e'.repeat(64)},retailPrice:'25.00',currency:'USD'};
}
test('native proposal uses v1 file type, existing file ID, stable identities and no upload/publish/order permission',()=>{
 const result=O.proposePrintfulProductOperation(proposal());assert.equal(result.method,'POST');assert.equal(result.url,'https://api.printful.com/store/products');assert.equal(result.body.sync_variants[0].files[0].type,'default');assert.equal(result.body.sync_variants[0].files[0].id,99);assert.equal(result.executionAuthorized,false);assert.equal(result.publicationAuthorized,false);assert.equal(result.orderSubmissionAuthorized,false);assert.ok(result.requires.includes('v1_file_position_verified'));assert.ok(!JSON.stringify(result).includes('credential'));
});
test('ecommerce proposal only maps an already imported sync variant and never creates a listing or price update',()=>{
 const input=proposal('ecommerce_linked'),result=O.proposePrintfulProductOperation(input);assert.equal(result.method,'PUT');assert.equal(result.url,'https://api.printful.com/sync/variant/678');assert.deepEqual(Object.keys(result.body).sort(),['files','variant_id']);
 assert.throws(()=>O.proposePrintfulProductOperation({...input,existingSyncVariantId:null}),/existing imported/);
});
test('changed plan, asset, stale rule, v2 file type and mismatched provider identity fail closed',()=>{
 const input=proposal();
 for(const change of [{plan:{...input.plan,designWidthIn:12}},{fileAssetSha256:'f'.repeat(64)},{fileTypeEvidence:{...input.fileTypeEvidence,expiresAt:new Date(0).toISOString()}},{fileTypeEvidence:{...input.fileTypeEvidence,fileType:'front'}},{fileTypeEvidence:{...input.fileTypeEvidence,catalogVariantId:1}}])assert.throws(()=>O.proposePrintfulProductOperation({...input,...change}));
});
