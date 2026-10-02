import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const A = require('../.core-tests/printful/product-adapter.js');
const P = require('../.core-tests/printful/production.js');
const C = require('../.core-tests/printful/contracts.js');
const F = require('../.core-tests/printful/configuration.js');
const uuid = n => `${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const now = Date.now(), observedAt = new Date(now - 1000).toISOString(), expiresAt = new Date(now + 60000).toISOString();
const scope = {businessId:uuid(1),connectionId:uuid(2),connectionRevision:uuid(3),storeId:123,storeKind:'manual_api'};
const secret = 'synthetic-server-credential-never-in-output';
const connection = () => ({...scope,provider:'printful',status:'connected',permittedOperations:['product.configure'],
  providerScopes:['sync_products','file_library/read','stores_list/read'],expiresAt,credential:secret});
const json = (body,options={}) => new Response(JSON.stringify(body),{headers:{'content-type':'application/json'},...options});
function source(){
  const context={mode:'fixture',observedAt,expiresAt};
  const product=C.parseCatalogProduct({data:{id:71,name:'Synthetic shirt',type:'shirt',is_discontinued:false,
    placements:[{placement:'front',technique:'dtg',layers:[{type:'file'}],conflicting_placements:[]}]}},C.catalogProductId(71),context);
  const variant=C.parseCatalogVariant({data:{id:4018,catalog_product_id:71,name:'White L',size:'L',color:'white',
    placement_dimensions:[{placement:'front',width:12,height:16,orientation:'any'}]}},C.catalogVariantId(4018),product.id,context);
  const asset={businessId:scope.businessId,assetVersionId:uuid(4),sha256:'a'.repeat(64),mimeType:'image/png',colorSpace:'srgb',
    widthPx:1800,heightPx:1800,designWidthIn:6,designHeightIn:6,
    printRequirement:{variantId:4018,placement:'front',technique:'dtg',minimumDpi:150,
      sourceUrl:'https://www.printful.com/creating-dtg-file',verifiedAt:observedAt,expiresAt},creativeApprovalId:uuid(5),creativeRunId:uuid(6)};
  const value={...scope,version:'1.0.0',id:uuid(7),evidenceMode:'fixture',goalId:uuid(8),workflowRunId:uuid(9),candidateId:uuid(10),decisionId:uuid(11),
    creativeApprovalId:asset.creativeApprovalId,creativeRunId:asset.creativeRunId,assetVersionId:asset.assetVersionId,
    assetSha256:asset.sha256,assetStoragePath:`${scope.businessId}/${asset.creativeRunId}/version-1.png`,
    plan:F.planPrintfulConfiguration({businessId:scope.businessId,product,variant,placement:'front',storeKind:'manual_api',asset}),
    name:'Synthetic product',retailPrice:'29.99',currency:'USD',printfulFileId:987,providerFactsHash:'b'.repeat(64),observedAt,expiresAt,
    fileBinding:{id:uuid(12),source:'authenticated_upload',assetSha256:asset.sha256,printfulFileId:987,providerMd5:'c'.repeat(32),widthPx:1800,heightPx:1800,observedAt,expiresAt},
    fileTypeEvidence:{catalogProductId:71,catalogVariantId:4018,placement:'front',fileType:'default',responseHash:'e'.repeat(64),observedAt,expiresAt},placementEvidence:null};
  value.stockEvidence={variantId:4018,available:true,responseHash:'a'.repeat(64),observedAt,expiresAt};
  value.costEvidence={variantId:4018,currency:'USD',productionMinor:1000,responseHash:'b'.repeat(64),observedAt,expiresAt,pricing:{currency:'USD',itemPriceMinor:2999,shippingChargedMinor:0,discountBps:0,productionMinor:1000,fulfilmentShippingMinor:500,sellerTaxCostMinor:0,marketplaceFee:{fixedMinor:20,rateBps:650,basis:'item'},paymentFee:{fixedMinor:25,rateBps:300,basis:'item'},refundReserveBps:200,targetMarginBps:3000,assumptionLabel:'Synthetic explicit cost assumptions'}};
  value.providerFactsHash=P.productHash({productCatalogHash:value.plan.productCatalogHash,variantCatalogHash:value.plan.variantCatalogHash,stockEvidence:value.stockEvidence,costEvidence:value.costEvidence});
  return value;
}
function file(){return {id:987,type:'default',hash:'c'.repeat(32),mime_type:'image/png',width:1800,height:1800,dpi:300,status:'ok',is_temporary:false};}
function summary(s=source()){return {id:222,external_id:P.productIdentity(s),name:s.name,variants:1,synced:1,is_ignored:false};}
function product(s=source()) {return {code:200,result:{sync_product:summary(s),sync_variants:[{
  id:333,external_id:`${P.productIdentity(s)}-v`,sync_product_id:222,synced:true,variant_id:4018,retail_price:'29.99',currency:'USD',is_ignored:false,
  product:{product_id:71,variant_id:4018},files:[file()],availability_status:'active'}]}};}
const store = () => ({code:200,result:{id:123,type:'native',name:'Private store'}});
const fileBody = () => ({code:200,result:file()});
function adapter(fetcher, extra={}) {return new A.PrintfulProductAdapter({scope,authorize:async()=>connection(),mode:'fixture',fetcher,now:()=>now,...extra});}
const code = expected => error => error instanceof A.PrintfulProductError && error.code===expected && !error.message.includes(secret);

test('native adapter uses only exact store/file/product paths, independent GETs and scoped authorization each time', async()=>{
  const calls=[],auth=[],s=source(),identity=P.productIdentity(s);
  const a=adapter(async(url,init)=>{calls.push({url,init});return json(url.endsWith('/stores/123')?store():url.endsWith('/files/987')?fileBody():product(s));},
    {authorize:async expected=>{auth.push(expected);return connection();}});
  const values=[await a.store(),await a.file(987),await a.findProduct(identity),await a.product(222)];
  assert.equal(auth.length,4);assert.ok(auth.every(value=>JSON.stringify(value)===JSON.stringify(scope)));
  assert.deepEqual(calls.map(c=>c.url),['https://api.printful.com/stores/123','https://api.printful.com/files/987',`https://api.printful.com/store/products/@${identity}`,'https://api.printful.com/store/products/222']);
  assert.ok(calls.every(({init})=>init.method==='GET'&&init.redirect==='error'&&init.cache==='no-store'&&init.headers['X-PF-Store-Id']==='123'));
  assert.ok(values.every(value=>value._evidence.source==='fixture'&&value._evidence.liveQualified===false));
  assert.ok(!JSON.stringify(values).includes(secret));assert.equal(values[0].result.name,undefined);
});

test('one bounded create sends one variant and one trusted file ID, with no invented position/currency/technique', async()=>{
  const calls=[],s=source(),identity=P.productIdentity(s);
  const a=adapter(async(url,init)=>{calls.push({url,init});return json({code:200,result:summary(s)});});
  const response=await a.create(s,identity);
  assert.equal(response._evidence.method,'POST');assert.equal(response._evidence.liveQualified,false);
  assert.deepEqual(JSON.parse(calls[0].init.body),{sync_product:{external_id:identity,name:s.name},sync_variants:[{
    external_id:`${identity}-v`,variant_id:4018,retail_price:'29.99',files:[{id:987,type:'default'}]}]});
  assert.equal(calls[0].url,'https://api.printful.com/store/products');assert.equal(calls[0].init.redirect,'error');
  await assert.rejects(()=>a.create(s,identity),code('product_creation_uncertain'));assert.equal(calls.length,1);
});

test('concurrent and uncertain create attempts cannot dispatch another POST',async()=>{
  let calls=0,resolve;const pending=new Promise(r=>{resolve=r;});const s=source(),identity=P.productIdentity(s);
  const a=adapter(async()=>{calls++;await pending;throw Error(secret);});
  const first=a.create(s,identity);
  await assert.rejects(()=>a.create(s,identity),code('product_creation_uncertain'));resolve();
  await assert.rejects(()=>first,e=>code('product_provider_failure')(e)&&e.mutationMayHaveOccurred);
  await assert.rejects(()=>a.create(s,identity),code('product_creation_uncertain'));assert.equal(calls,1);
});

test('missing, catalog-only, expired or changed write authority never reaches transport',async()=>{
  const variants=[null,{...connection(),businessId:uuid(20)},{...connection(),connectionId:uuid(20)},
    {...connection(),connectionRevision:uuid(20)},{...connection(),storeId:124},{...connection(),storeKind:'ecommerce_linked'},
    {...connection(),provider:'other'},{...connection(),status:'revoked'},{...connection(),permittedOperations:['catalog.read']},
    {...connection(),expiresAt:new Date(now).toISOString()},{...connection(),providerScopes:['stores_list/read']},
    {...connection(),providerScopes:['sync_products/read','file_library/read','stores_list/read']},
    {...connection(),providerScopes:[...connection().providerScopes,'orders']},{...connection(),credential:'bad\ncredential'}];
  let calls=0;
  for(const bad of variants){const a=adapter(async()=>{calls++;return json(store());},{authorize:async()=>bad});
    await assert.rejects(()=>a.store(),code('product_write_authority_unavailable'));}
  await assert.rejects(()=>adapter(async()=>{calls++;},{authorize:undefined}).store(),code('product_write_authority_unavailable'));
  assert.equal(calls,0);
});

test('every transport revalidates connection revision and the documented read/write scope spellings',async()=>{
  let calls=0,auth=0;const a=adapter(async()=>{calls++;return json(store());},
    {authorize:async()=>({...connection(),connectionRevision:++auth===1?scope.connectionRevision:uuid(19),
      providerScopes:['sync_products/read','sync_products/write','file_library/read','stores_list/read']})});
  await a.store();await assert.rejects(()=>a.store(),code('product_write_authority_unavailable'));assert.equal(calls,1);
});

test('fixture mode needs injection, fixture sources cannot use provider mode, and input scope is copied',async()=>{
  assert.throws(()=>new A.PrintfulProductAdapter({scope,authorize:async()=>connection(),mode:'fixture'}),code('product_source_invalid'));
  const s=source();let calls=0;
  await assert.rejects(()=>adapter(async()=>{calls++;},{mode:'provider_response'}).create(s,P.productIdentity(s)),code('product_source_invalid'));
  const mutable={...scope};const a=adapter(async()=>json(store()),{scope:mutable});mutable.storeId=456;
  assert.equal((await a.store()).result.id,123);assert.equal(calls,0);
});

test('only exact identity lookup treats HTTP 404 as absence, and unsafe identifiers never reach fetch',async()=>{
  let calls=0;const a=adapter(async()=>{calls++;return new Response(secret,{status:404});});
  assert.equal(await a.findProduct(P.productIdentity(source())),null);
  await assert.rejects(()=>a.product(222),code('product_provider_rejected'));await assert.rejects(()=>a.file(987),code('product_provider_rejected'));
  for(const identity of ['@x','../orders','al-pf-'+ 'f'.repeat(32)+'?token=x','https://evil.example',P.productIdentity(source())+'/x'])
    await assert.rejects(()=>a.findProduct(identity),code('product_source_invalid'));
  for(const id of [0,-1,NaN,Infinity,'222','../orders',Number.MAX_SAFE_INTEGER+1]) await assert.rejects(()=>a.product(id),code('product_source_invalid'));
  assert.equal(calls,3);
});

test('HTTP and thrown provider failures are safely categorized without provider body, cause, or retry',async()=>{
  for(const [status,expected] of [[401,'product_write_access_revoked'],[403,'product_write_access_revoked'],[429,'product_provider_rate_limited'],[500,'product_provider_failure'],[302,'product_provider_failure']]){
    let calls=0;const a=adapter(async()=>{calls++;return new Response(secret,{status});});
    await assert.rejects(()=>a.store(),e=>code(expected)(e)&&e.cause===undefined&&!e.mutationMayHaveOccurred);assert.equal(calls,1);
  }
  const a=adapter(async()=>{throw Error(secret);});await assert.rejects(()=>a.store(),code('product_provider_failure'));
  const b=adapter(async()=>json(store()),{authorize:async()=>{throw Error(secret);}});await assert.rejects(()=>b.store(),code('product_write_authority_unavailable'));
});

test('authorization, uncooperative fetch and streaming bodies are all deadline bounded',async()=>{
  const a=adapter(()=>new Promise(()=>{}),{timeoutMs:10});await assert.rejects(()=>a.store(),code('product_provider_timeout'));
  let lateAuthorize,fetches=0;const pending=new Promise(r=>{lateAuthorize=r;});
  const b=adapter(async()=>{fetches++;return json(store());},{timeoutMs:10,authorize:()=>pending});
  await assert.rejects(()=>b.store(),code('product_provider_timeout'));lateAuthorize(connection());await new Promise(r=>setTimeout(r,10));assert.equal(fetches,0);
  const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));}});
  const c=adapter(async()=>new Response(stream,{headers:{'content-type':'application/json'}}),{timeoutMs:10});
  await assert.rejects(()=>c.store(),code('product_provider_timeout'));
});

test('malformed, oversized, wrong-content-type, redirected and mismatched responses fail closed',async()=>{
  const wrongURL=json(store());Object.defineProperty(wrongURL,'url',{value:'https://evil.example/'});
  const redirected=json(store());Object.defineProperty(redirected,'redirected',{value:true});
  const responses=[new Response('{',{headers:{'content-type':'application/json'}}),new Response('{}',{headers:{'content-type':'application/json','content-length':'262145'}}),
    new Response('{}',{headers:{'content-type':'application/json','content-length':'oops'}}),new Response(' '.repeat(262145),{headers:{'content-type':'application/json'}}),
    new Response('{}',{headers:{'content-type':'text/html'}}),json({code:200,result:null}),wrongURL,redirected];
  for(const response of responses)await assert.rejects(()=>adapter(async()=>response).store(),code('product_provider_response_invalid'));
  await assert.rejects(()=>adapter(async()=>json({code:200,result:{id:124,type:'native'}})).store(),code('product_readback_mismatch'));
  await assert.rejects(()=>adapter(async()=>json({code:200,result:{id:123,type:'shopify'}})).store(),code('product_readback_mismatch'));
});

test('output strips arbitrary URLs, filenames, provider messages and rejects credential echo in allowed names',async()=>{
  const body=product();body.extra=secret;body.result.sync_variants[0].files[0].url=`https://evil.example/${secret}`;
  body.result.sync_variants[0].files[0].filename=secret;body.result.sync_variants[0].options=[{id:'token',value:secret}];
  const normalized=await adapter(async()=>json(body)).product(222);assert.ok(!JSON.stringify(normalized).includes(secret));
  body.result.sync_product.name=secret;await assert.rejects(()=>adapter(async()=>json(body)).product(222),code('product_provider_response_invalid'));
});

test('source is snapshotted before asynchronous auth and rechecked for expiry immediately before POST',async()=>{
  const s=source(),identity=P.productIdentity(s);let sent;
  const a=adapter(async(url,init)=>{sent=JSON.parse(init.body);return json({code:200,result:summary(source())});},
    {authorize:async()=>{s.name='Changed';s.plan.variantId=999;s.printfulFileId=888;return connection();}});
  await a.create(s,identity);assert.equal(sent.sync_product.name,'Synthetic product');assert.equal(sent.sync_variants[0].variant_id,4018);assert.equal(sent.sync_variants[0].files[0].id,987);
  let clock=now,calls=0;const expired=adapter(async()=>{calls++;return json({});},{now:()=>clock,authorize:async()=>{clock=now+61000;return {...connection(),expiresAt:new Date(clock+1000).toISOString()};}});
  const fresh=source();await assert.rejects(()=>expired.create(fresh,P.productIdentity(fresh)),code('product_source_invalid'));assert.equal(calls,0);
});

test('independent readback verifies association and upload lineage but never physical position, technique or configuration',async()=>{
  const s=source(),identity=P.productIdentity(s),a=adapter(async(url)=>json(url.includes('/files/')?fileBody():url.includes('/stores/')?store():product(s)));
  const response=await a.product(222),fileResponse=await a.file(987),storeResponse=await a.store();
  const result=A.verifyPrintfulProductReadback({source:s,identity,response,fileResponse,storeResponse},now);
  assert.equal(result.syncProductId,222);assert.equal(result.syncVariantId,333);assert.equal(result.associationVerified,true);assert.equal(result.assetBindingVerified,true);
  assert.equal(result.physicalPlacementVerified,false);assert.equal(result.techniqueVerified,false);assert.equal(result.configurationVerified,false);
  assert.deepEqual(result.blockers,['physical_placement_not_observable','technique_not_observable']);
  assert.match(result.providerFactsHash,/^[a-f0-9]{64}$/);assert.notEqual(result.providerFactsHash,s.providerFactsHash);assert.equal(result.productFactsHash,undefined);
  response.result.sync_variants[0].files[0].position={width:6,height:6};response.result.sync_variants[0].technique='dtg';
  assert.deepEqual(A.verifyPrintfulProductReadback({source:s,identity,response,fileResponse,storeResponse},now),result);
  const reordered=Object.fromEntries(Object.entries(product(s)).reverse());
  assert.equal(A.verifyPrintfulProductReadback({source:s,identity,response:reordered,fileResponse,storeResponse},now).productReadHash,result.productReadHash);
});

test('independent file evidence rejects mismatched MD5, dimensions, identity, processing, type and upload provenance',()=>{
  const s=source();
  for(const change of [{id:988},{hash:'d'.repeat(32)},{width:1799},{height:1799},{status:'waiting'},{status:'failed'},{mime_type:'image/jpeg'},{is_temporary:true},{is_temporary:undefined}])
    assert.throws(()=>A.verifyPrintfulFileBinding(s,{code:200,result:{...file(),...change}},now),code('product_file_readback_mismatch'));
  for(const change of [{source:'owner_input'},{assetSha256:'b'.repeat(64)},{expiresAt:observedAt},{widthPx:1799}])
    assert.throws(()=>A.verifyPrintfulFileBinding({...s,fileBinding:{...s.fileBinding,...change}},fileBody(),now),code('product_source_invalid'));
  const f=fileBody();f.result.hash=s.assetSha256;
  assert.throws(()=>A.verifyPrintfulFileBinding(s,f,now),code('product_provider_response_invalid'));
});

test('readback rejects wrong product/variant/catalog/file/price/currency or additional print placement',()=>{
  const s=source(),identity=P.productIdentity(s);
  const check=response=>A.verifyPrintfulProductReadback({source:s,identity,response,fileResponse:fileBody(),storeResponse:store()},now);
  for(const change of [{external_id:'foreign'},{name:'Changed'},{is_ignored:true}]){
    const body=product(s);Object.assign(body.result.sync_product,change);assert.throws(()=>check(body),code('product_readback_mismatch'));
  }
  for(const change of [{external_id:'foreign-v'},{variant_id:4019},{retail_price:'30.00'},{currency:'GBP'},{is_ignored:true},{is_ignored:undefined},{availability_status:'out_of_stock'},{availability_status:undefined},{product:{variant_id:4018,product_id:72}}]){
    const body=product(s);Object.assign(body.result.sync_variants[0],change);assert.throws(()=>check(body),code('product_readback_mismatch'));
  }
  for(const files of [[{...file(),type:'back'}],[{...file(),type:'front'}],[file(),{...file(),type:'back'}],[{...file(),id:988}]]){
    const body=product(s);body.result.sync_variants[0].files=files;assert.throws(()=>check(body),code('product_file_readback_mismatch'));
  }
  assert.throws(()=>A.verifyPrintfulProductReadback({source:s,identity,response:product(s),fileResponse:fileBody(),storeResponse:{code:200,result:{id:124,type:'native'}}},now),code('product_readback_mismatch'));
  assert.throws(()=>check({code:200,result:summary(s)}),code('product_provider_response_invalid'));
});

test('historical sources reconcile from fresh independent reads but stale, forged or mutation observations cannot qualify',async()=>{
  const s=source();s.evidenceMode='live';const identity=P.productIdentity(s),later=now+120000;
  const a=adapter(async url=>json(url.includes('/files/')?fileBody():url.includes('/stores/')?store():product(s)),
    {mode:'provider_response',now:()=>later,authorize:async()=>({...connection(),expiresAt:new Date(later+60000).toISOString()})});
  a.bindExecutionGuard(async()=>{});
  const input={source:s,identity,response:await a.product(222),fileResponse:await a.file(987),storeResponse:await a.store()};
  assert.equal(A.verifyPrintfulProductReadback(input,later).associationVerified,true);
  for(const change of [{source:'mutation_response'},{method:'POST'},{connectionRevision:uuid(99)},
    {endpoint:'https://api.printful.com/orders/222'},{responseHash:'f'.repeat(64)},
    {observedAt:new Date(later-60001).toISOString()},{observedAt:new Date(later+1).toISOString()}]){
    const changed=structuredClone(input);Object.assign(changed.response._evidence,change);
    assert.throws(()=>A.verifyPrintfulProductReadback(changed,later),code('product_provider_response_invalid'));
  }
  for(const field of ['response','fileResponse','storeResponse']){
    const changed=structuredClone(input);delete changed[field]._evidence;
    assert.throws(()=>A.verifyPrintfulProductReadback(changed,later),code('product_provider_response_invalid'));
  }
});

test('file type is bound to exact v1 catalog evidence and cannot be inferred from the v2 placement name',async()=>{
  const s=source();let calls=0;const a=adapter(async()=>{calls++;return json({});});
  for(const change of [{fileType:'front'},{placement:'back'},{catalogProductId:72},{catalogVariantId:4019},{expiresAt:observedAt}]){
    const changed={...s,fileTypeEvidence:{...s.fileTypeEvidence,...change}};
    await assert.rejects(()=>a.create(changed,P.productIdentity(changed)),code('product_source_invalid'));
  }
  assert.equal(calls,0);
});

test('every dispatched POST failure reports uncertainty and permanently burns the local create latch',async()=>{
  const s=source(),identity=P.productIdentity(s);
  const scenarios=[
    ['product_provider_failure',async()=>{throw Error(secret);}],
    ['product_provider_failure',async()=>new Response(secret,{status:500})],
    ['product_provider_rate_limited',async()=>new Response(secret,{status:429})],
    ['product_provider_response_invalid',async()=>new Response('{',{headers:{'content-type':'application/json'}})],
    ['product_readback_mismatch',async()=>json({code:200,result:{...summary(s),external_id:'foreign'}})],
    ['product_provider_timeout',async()=>new Promise(()=>{})],
    ['product_provider_timeout',async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));}}),{headers:{'content-type':'application/json'}})],
  ];
  for(const [reason,fetcher] of scenarios){
    let calls=0;const a=adapter(async(...args)=>{calls++;return fetcher(...args);},{timeoutMs:10});
    await assert.rejects(()=>a.create(s,identity),e=>code(reason)(e)&&e.mutationMayHaveOccurred===true);
    await assert.rejects(()=>a.create(s,identity),code('product_creation_uncertain'));assert.equal(calls,1);
  }
  let calls=0;const denied=adapter(async()=>{calls++;return json({});},{authorize:async()=>{throw Error(secret);}});
  await assert.rejects(()=>denied.create(s,identity),e=>code('product_write_authority_unavailable')(e)&&e.mutationMayHaveOccurred===false);
  assert.equal(calls,0);
});
