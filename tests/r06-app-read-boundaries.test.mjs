import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { ownerBusiness, historyRead, historyResponse } from './helpers/history-fixtures.mjs';
import { wireFixture } from './helpers/listing-source-fixtures.mjs';
const require=createRequire(import.meta.url),ts=require('typescript');
const C=require('../.core-tests/etsy/contracts.js'),V=require('../.core-tests/etsy/vault.js');
const id=n=>`96060000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const business=id(1),owner=id(90),key='1'.repeat(64),plain=v=>JSON.parse(JSON.stringify(v));
const env={ETSY_KEYSTRING:'fixture',ETSY_SHARED_SECRET:'fixture',ETSY_REDIRECT_URI:'https://fixture.invalid/api/etsy/callback',ETSY_VAULT_KEY:key,ETSY_SERVER_KEY:'fixture-only'.repeat(4)};
function load(file,deps={}){
 const output=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const m={exports:{}};runInNewContext(`(function(require,module,exports){${output}\n})`,{Date,URL,URLSearchParams,Buffer,Uint8Array,process:{env},structuredClone})(name=>{
  if(name.endsWith('/owner-business'))return ownerBusiness;
  if(name.endsWith('/history-read'))return historyRead;
  assert.ok(Object.hasOwn(deps,name),`Unexpected R06 dependency ${name}`);return deps[name];
 },m,m.exports);return m.exports;
}
function exactOwnerContext({mode='owned',businessId=business}={}){
 const reads=[];const context={userId:owner,ownerDirectoryPaged:true,businesses:[{id:id(2),name:'Visible directory Business'}],businessesPage:{total:127,page:1},supabase:{from(table){
  assert.equal(table,'businesses');const call={table,filters:[]};reads.push(call);
  const q={select(columns){assert.equal(columns,'id,name,created_at,updated_at');call.columns=columns;return q;},eq(k,v){call.filters.push([k,v]);return q;},async maybeSingle(){
   assert.deepEqual(call.filters,[['id',businessId],['owner_user_id',owner]]);
   if(mode==='throw')throw Error('private owner lookup outage');
   return mode==='unavailable'?{data:null,error:{message:'private owner lookup outage'}}:mode==='foreign'?{data:null,error:null}:{data:{id:mode==='wrong-id'?id(9):businessId,name:'Exact owned Business',created_at:'2026-10-01T00:00:00Z',updated_at:'2026-10-01T00:00:00Z'},error:null};
  }};return q;
 }}};return{context,reads};
}
test('off-directory ownership uses exact owner filters, caches only verified row, and preserves directory total',async()=>{
 const f=exactOwnerContext();assert.equal(await ownerBusiness.verifyOwnerBusiness(f.context,business),true);
 assert.equal(await ownerBusiness.verifyOwnerBusiness(f.context,business),true);assert.equal(f.reads.length,1);
 assert.equal(f.context.businesses.at(-1).id,business);assert.equal(f.context.businessesPage.total,127);
 for(const mode of ['foreign','unavailable','throw','wrong-id']){const g=exactOwnerContext({mode});assert.equal(await ownerBusiness.verifyOwnerBusiness(g.context,business),false);assert.equal(g.context.businesses.length,1);}
 for(const bad of ['',null,'not-a-uuid']){const g=exactOwnerContext();assert.equal(await ownerBusiness.verifyOwnerBusiness(g.context,bad),false);assert.equal(g.reads.length,0);}
});
test('off-directory expired-run action rechecks exact Business before mutation; foreign and unavailable never dispatch',async()=>{
 for(const mode of ['owned','foreign','unavailable']){
  const f=exactOwnerContext({mode}),rpc=[],blocked=[];const from=f.context.supabase.from;
  f.context.supabase.from=table=>{if(table==='businesses')return from(table);assert.equal(table,'creative_runs');const q={select:()=>q,eq:(k,v)=>{assert.equal(k,'id');assert.equal(v,id(22));return q;},maybeSingle:async()=>({data:{business_id:business}})};return q;};
  f.context.supabase.rpc=async(name,args)=>{rpc.push({name,args});return{data:{},error:null};};
  const deny=()=>{blocked.push('provider');throw Error('provider forbidden');};
  const api=load('src/app/dashboard/artifacts/actions.ts',{
   'node:crypto':require('node:crypto'),'next/cache':{revalidatePath(){}},'next/navigation':{redirect:url=>{throw Error(url);}},
   '@/lib/core-ui/console-retained-feedback':load('src/lib/core-ui/console-retained-feedback.ts'),
   'workflow/api':{start:deny},'@/creative/contracts':{},'@/creative/proposal':{},'@/creative/production-approval':{},'@/creative/image-provider':{},'@/creative/types':{},
   '@/lib/core-ui/data':{requireOwnerUiContext:async()=>f.context},'@/workflows/creative-runtime':{creativeRuntimeWorkflow:deny},
  });
  const form=new FormData();form.set('creativeRunId',id(22));let destination;
  await assert.rejects(api.closeExpiredCreativeRun(form),error=>{destination=new URL(error.message,'https://fixture.invalid');return destination.pathname==='/dashboard/artifacts';});
  assert.equal(rpc.length,mode==='owned'?1:0);assert.equal(destination.searchParams.get('business'),mode==='owned'?business:null);assert.deepEqual(blocked,[]);
  if(mode==='owned'){assert.equal(rpc[0].name,'close_expired_creative_run');assert.deepEqual(plain(rpc[0].args),{p_creative_run_id:id(22)});}
 }
});
test('OAuth cookie Business is independently owner-verified before preserving scope or consuming state',async()=>{
 for(const mode of ['owned','foreign','unavailable']){
  const f=exactOwnerContext({mode}),effects=[];
  const api=load('src/app/api/etsy/callback/route.ts',{
   'next/headers':{cookies:async()=>({get:()=>({value:'inert-cookie'}),delete:()=>{}})},'next/server':{NextResponse:{redirect:url=>({url:String(url),headers:new Headers()})}},
   '@/lib/core-ui/data':{requireOwnerUiContext:async()=>f.context},'@/etsy/server':{etsyConfig:()=>({vaultKey:key}),ownerBusiness:(ctx,b)=>assert.ok(ctx.businesses.some(row=>row.id===b)),etsyRpc:async()=>{effects.push('rpc');throw Error('must not consume denied flow');}},
   '@/etsy/vault':{unseal:()=>({businessId:business,ownerId:owner,state:'bound-state'})},'@/etsy/oauth':{},'@/etsy/contracts':C,'node:crypto':require('node:crypto'),
  });
  const response=await api.GET({url:'https://fixture.invalid/api/etsy/callback?state=bound-state&error=access_denied'});
  assert.equal(new URL(response.url).searchParams.get('business'),mode==='owned'?business:null);assert.equal(f.reads.length,1);assert.deepEqual(effects,[]);
  assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
 }
});
// Trusted-envelope wire fixtures only: invented model receipts are never installed,
// persisted, submitted to a provider or represented as genuine qualification.
function etsyFixture({artifactError=null,rpcError=null,page=2,tamper=false}={}){
 const F=require('../.core-tests/listing/fixtures.js'),R=require('../.core-tests/listing/runtime.js'),L=require('../.core-tests/listing/contracts.js');
 const f=F.listingFixture(Date.now());f.input.evidenceMode='live';
 const specialist=f.execution('specialist',f.proposal),reviewer=f.execution('reviewer',f.review);specialist.mode=reviewer.mode='live_model';
 const review=R.reviewListing(f.input,f.proposal,f.review,specialist,reviewer,f.now),p=L.assembleListingProduct(f.input,f.proposal,f.now);
 const artifact={id:p.id,business_id:p.businessId,content:{etsyDraftEnvelope:V.seal(p,`product-package:${p.businessId}:${p.id}`,key),listingReviewEnvelope:V.seal(review,`listing-review:${p.businessId}:${p.id}`,key)}};
 if(tamper)artifact.content.listingReviewEnvelope=V.seal(review,`listing-review:${p.businessId}:${id(99)}`,key);
 const reads=[],calls=[],blocked=[];const context={businesses:[{id:p.businessId}],readSearch:`etsyPackagePage=${page}&etsyPackageId=${p.id}`,supabase:{
  from(table){assert.equal(table,'artifacts');const filters=[];const q={select:()=>q,eq:(k,v)=>{filters.push([k,v]);return q;},maybeSingle:async()=>{reads.push(filters);return{data:artifactError?null:artifact,error:artifactError};}};return q;},
  async rpc(name,args){calls.push({name,args});if(name==='r06_read')return historyResponse(args,[{id:p.id}]);assert.equal(name,'etsy_owner_transition');assert.equal(args.p_operation,'validate_package');return{data:{},error:rpcError};},
 }};
 const deny=()=>{blocked.push('provider');throw Error('provider forbidden');};
 const api=load('src/etsy/server.ts',{'server-only':{},'node:crypto':require('node:crypto'),'./contracts':C,'./vault':V,'../listing/intake':require('../.core-tests/listing/intake.js'),'./adapter':{EtsyDraftAdapter:class{constructor(){deny();}}},'./oauth':{exchangeOAuth:deny},'./engine':{executeEtsyDraft:deny}});
 return{api,context,p,reads,calls,blocked};
}
test('Etsy authenticates exact selected package beyond page and deduplicates an in-page selection',async()=>{
 for(const page of [1,2]){const f=etsyFixture({page}),result=await f.api.eligibleEtsyPackages(f.context,f.p.businessId);
  assert.equal(result.choices.length,1);assert.equal(result.choices[0].id,f.p.id);assert.equal(result.page.total,1);assert.equal(result.page.page,page);assert.equal(result.unavailable,false);assert.equal(result.rejected,0);
  assert.equal(f.reads.length,1);assert.deepEqual(f.reads[0],[['business_id',f.p.businessId],['id',f.p.id],['artifact_type','product.package.v1']]);assert.equal(f.calls.filter(c=>c.name==='etsy_owner_transition').length,1);assert.deepEqual(f.blocked,[]);
 }
 const denied=etsyFixture({tamper:true}),result=await denied.api.eligibleEtsyPackages(denied.context,denied.p.businessId);assert.equal(result.choices.length,0);assert.equal(result.rejected,1);assert.equal(result.unavailable,false);
});
test('Etsy transport outages remain unavailable; definitive qualification errors remain rejected',async()=>{
 for(const config of [{artifactError:{message:'private artifact outage'}},{rpcError:{code:'PGRST000',message:'private RPC outage'}},{rpcError:{code:'08006',message:'private disconnect'}}]){
  const f=etsyFixture(config),result=await f.api.eligibleEtsyPackages(f.context,f.p.businessId);assert.equal(result.unavailable,true);assert.equal(result.rejected,0);assert.equal(result.choices.length,0);assert.equal(result.page.total,1);assert.doesNotMatch(JSON.stringify(result),/private/);assert.deepEqual(f.blocked,[]);
 }
 const f=etsyFixture({rpcError:{code:'P0001',message:'private upstream rejection'}}),result=await f.api.eligibleEtsyPackages(f.context,f.p.businessId);assert.equal(result.unavailable,false);assert.equal(result.rejected,1);
});
test('Listing authenticates exact off-page source with real evidence reader and deduplicates selection',async()=>{
 for(const page of [1,2]){
  const f=wireFixture(Date.now()),p=f.input.product,reads=[],rpc=[],quotes=[];
  const context={businesses:[{id:p.businessId}],readSearch:`listingSourcePage=${page}&listingSourceId=${p.id}`,supabase:{
   from(table){const filters=[];const q={select:()=>q,eq:(k,v)=>{filters.push([k,v]);return q;},maybeSingle:async()=>{
    const row=table==='artifacts'?f.rows.get(filters.find(([k])=>k==='id')[1]):({action_receipts:f.receipt,creative_approvals:f.approval,creative_assets:f.asset})[table];
    assert.ok(row,table);assert.ok(filters.some(([k,v])=>k==='business_id'&&v===p.businessId));reads.push({table,id:row.id});return{data:row};
   }};return q;},
   storage:{from:bucket=>{assert.equal(bucket,'creative-assets');return{download:async path=>{assert.equal(path,f.asset.storage_path);return{data:new Blob([f.bytes])};}};}},
   async rpc(name,args){rpc.push({name,args});if(name==='r06_read')return args.p_dataset==='listing_state'?{data:{qualified:true,activeQualification:false}}:historyResponse(args,args.p_dataset==='listing_sources'?[{id:p.id}]:[]);assert.equal(name,'etsy_owner_transition');assert.equal(args.p_operation,'validate_package');return{data:{}};},
  }};
  const api=load('src/listing/server.ts',{'server-only':{},'node:crypto':require('node:crypto'),'../etsy/contracts':C,'../etsy/vault':V,'./sources':require('../.core-tests/listing/sources.js'),
   '../creative/budget':{fetchCreativeModelQuote:async()=>{throw Error('provider quote forbidden');}},'./budget':{LISTING_BUDGET:{maximumMicrousd:1000000},currentListingQuote:async inputHash=>{quotes.push(inputHash);return{maximumEstimateMicrousd:1000};}},'./knowledge':{},'./packs':{},'./runtime':{},'./contracts':{},'./qualification':{},
  });
  const result=await api.loadListingWorkspace(context,p.businessId);assert.equal(result.unavailable,false);assert.equal(result.sourceBlocker,false);assert.equal(result.sources.length,1);assert.equal(result.sources[0].id,p.id);assert.equal(result.sourcesPage.total,1);assert.equal(result.sourcesPage.page,page);
  assert.equal(reads.filter(row=>row.table==='artifacts'&&row.id===p.id).length,1);assert.equal(rpc.filter(call=>call.name==='etsy_owner_transition').length,1);assert.equal(quotes.length,1);
 }
});
