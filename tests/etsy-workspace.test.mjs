import { ownerBusiness, historyRead, historyPager } from './helpers/history-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { packageFixture } from './etsy-fixtures.mjs';
const require=createRequire(import.meta.url),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
function load(path,deps,globals={}){const source=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const fixtureModule={exports:{}};runInNewContext(`(function(require,module,exports){${source}\n})`,globals)(name=>{if(name.endsWith('/owner-business'))return ownerBusiness;if(name==='../lib/core-ui/history-read')return historyRead;if(name==='@/components/console/history-pager')return historyPager;assert.ok(name in deps,`Unexpected dependency: ${name}`);return deps[name];},fixtureModule,fixtureModule.exports);return fixtureModule.exports;}
const noop=async()=>{};
const {EtsyWorkspace}=load('src/app/dashboard/etsy/workspace.tsx',{'@/etsy/contracts':require('../.core-tests/etsy/contracts.js'),'react/jsx-runtime':require('react/jsx-runtime'),'next/link':({children,href})=>React.createElement('a',{href},children),'./actions':{connectEtsy:noop,disconnectEtsy:noop,createEtsyDraft:noop,reconcileEtsyDraft:noop,stopEtsyDraft:noop}});
const base={businessId:'fixture-business',businessName:'Fixture Business',configured:false,unavailable:false,connection:null,packages:[],runs:[]};
const render=data=>renderToStaticMarkup(React.createElement(EtsyWorkspace,{data}));
test('unconfigured UI explains upstream blockers and cannot connect or create',()=>{
  const html=render(base);assert.match(html,/No verified Product Package is shown on this page/);assert.match(html,/raw artwork is not a product mockup/);assert.match(html,/Synthetic examples and technical image tests do not satisfy/);assert.match(html,/disabled="">Connect Etsy securely/);assert.doesNotMatch(html,/>Create draft</);
});
test('draft preparation does not imply supplier mapping, confirmed settings or automatic fulfilment',()=>{
 const {package:p}=packageFixture();
 for(const data of [base,{...base,configured:true,connection:{shopName:'Fixture shop',status:'connected',currency:'NZD'},packages:[p]}]){
  const html=render(data);
  for(const text of ['Creating an Etsy draft does not create or verify a Printful variant mapping',
   'An ecommerce-linked store alone does not establish the exact supplier link or manual order-confirmation setting',
   'no automatic order sync or fulfilment path yet','later Stage 22 work'])assert.ok(html.includes(text),text);
 }
});
test('qualified fixture has separate draft and asset-sharing approvals without implementation inputs',()=>{
  const {package:p}=packageFixture();const html=render({...base,configured:true,connection:{shopName:'Fixture shop',status:'connected',currency:'NZD'},packages:[p]});
  assert.match(html,/name="draftConsent"/);assert.match(html,/name="assetConsent"/);assert.match(html,/type="hidden" name="packageId"/);assert.match(html,/>Create draft</);assert.doesNotMatch(html,/type="text"|accessToken|vaultKey|serverKey/);
});
test('uncertain image exposes reconciliation and stop, never a repeat-upload or publish control',()=>{
  const html=render({...base,configured:true,connection:{shopName:'Fixture shop',status:'connected',currency:'NZD'},runs:[{id:'fixture-run',title:'Fixture product',status:'needs_owner',reason:'uncertain_image_identity',listingId:500,stopped:false}]});
  assert.match(html,/It will not be uploaded again/);assert.match(html,/>Check draft and continue</);assert.match(html,/>Stop</);assert.doesNotMatch(html,/>Publish<|>Upload again</);
});
test('records unavailable disables actions and does not imply a disconnected account',()=>{
  const html=render({...base,unavailable:true});assert.match(html,/Existing connections and drafts may still exist/);assert.match(html,/disabled="">Connect Etsy securely/);
});
test('draft server action requires both consents before preparing or executing',async()=>{
  const calls=[];const deps={'next/headers':{},'next/navigation':{redirect:url=>{throw new Error(url);}},'next/cache':{revalidatePath:()=>{}},'@/lib/core-ui/data':{requireOwnerUiContext:async()=>({userId:'owner'})},'@/etsy/server':{prepareEtsyDraft:async(...args)=>{calls.push(['prepare',...args]);return{runId:'run'};},runEtsyDraft:async()=>{calls.push(['run']);return{status:'verified'};}},'@/etsy/oauth':{},'@/etsy/vault':{}};
  const {createEtsyDraft}=load('src/app/dashboard/etsy/actions.ts',deps);
  const form=new FormData();form.set('businessId','business');form.set('packageId','package');form.set('draftConsent','on');
  await assert.rejects(createEtsyDraft(form),/draft-consent-required/);assert.equal(calls.length,0);
  form.set('assetConsent','on');await assert.rejects(createEtsyDraft(form),/business=business&message=draft-verified/);assert.equal(calls.length,2);
});
test('disconnect, resume and stop retain the selected Business on success and failure',async()=>{
  let fail=false;
  const {disconnectEtsy,reconcileEtsyDraft,stopEtsyDraft}=load('src/app/dashboard/etsy/actions.ts',{'next/headers':{},'next/navigation':{redirect:url=>{throw new Error(url);}},'next/cache':{revalidatePath:()=>{}},'@/lib/core-ui/data':{requireOwnerUiContext:async()=>({userId:'owner'})},'@/etsy/server':{etsyRpc:async()=>{if(fail)throw new Error('fixture');return{};},runEtsyDraft:async()=>{if(fail)throw new Error('fixture');return{status:'verified'};}},'@/etsy/oauth':{},'@/etsy/vault':{}});
  const form=new FormData();form.set('businessId','second-business');form.set('runId','run');
  for(const action of [disconnectEtsy,reconcileEtsyDraft,stopEtsyDraft]){await assert.rejects(action(form),/business=second-business&message=/);}
  fail=true;for(const action of [disconnectEtsy,reconcileEtsyDraft,stopEtsyDraft]){await assert.rejects(action(form),/business=second-business&message=/);}
});

const chrome='/usr/bin/google-chrome';
test('declined OAuth retains its authorized Business and rejects a mismatched state before provider access',async()=>{
  const calls=[];
  const {GET}=load('src/app/api/etsy/callback/route.ts',{'next/headers':{cookies:async()=>({get:()=>({value:'fixture-cookie'}),delete:()=>{}})},'next/server':{NextResponse:{redirect:url=>({url:String(url),headers:new Headers()})}},'@/lib/core-ui/data':{requireOwnerUiContext:async()=>({userId:'fixture-owner',businesses:[{id:'16000002-1111-4111-8111-111111111111'}]})},'@/etsy/server':{etsyConfig:()=>({vaultKey:'fixture-key'}),ownerBusiness:()=>{},etsyRpc:async()=>{calls.push('rpc');throw new Error('Unexpected provider path');}},'@/etsy/vault':{unseal:()=>({ownerId:'fixture-owner',businessId:'16000002-1111-4111-8111-111111111111',state:'fixture-state'})},'@/etsy/oauth':{},'@/etsy/contracts':require('../.core-tests/etsy/contracts.js'),'node:crypto':require('node:crypto')},{URL});
  const declined=await GET({url:'https://example.com/api/etsy/callback?state=fixture-state&error=access_denied'});
  assert.equal(new URL(declined.url).searchParams.get('business'),'16000002-1111-4111-8111-111111111111');assert.equal(new URL(declined.url).searchParams.get('message'),'connection-unavailable');assert.equal(calls.length,0);
  const invalid=await GET({url:'https://example.com/api/etsy/callback?state=wrong&code=fixture-code'});
  assert.equal(new URL(invalid.url).searchParams.has('business'),false);assert.equal(calls.length,0);
});
test('server preparation rejects a package changed since the owner reviewed the form',async()=>{
  const {package:p}=packageFixture(),calls=[];
  const account={businessId:p.businessId,connectionId:'16000002-1111-4111-8111-111111111111',revision:'16000003-1111-4111-8111-111111111111',shopId:100,userId:101,currency:'NZD',expiresAt:p.expiresAt,accessToken:'fixture-token'};
  const context={businesses:[{id:p.businessId}],supabase:{from(){return{select(){return this;},eq(){return this;},async maybeSingle(){return{data:{content:{etsyDraftEnvelope:'fixture-package'}}};}};},async rpc(name,args){calls.push(args.p_operation);return{data:args.p_operation==='connection'?{id:account.connectionId,revision:account.revision,shopId:100,currency:'NZD',envelope:'fixture-account'}:{}};}}};
  const {prepareEtsyDraft}=load('src/etsy/server.ts',{'server-only':{},'node:crypto':require('node:crypto'),'./adapter':{},'./contracts':require('../.core-tests/etsy/contracts.js'),'./oauth':{},'./vault':{unseal:(_,context)=>context.startsWith('account:')?account:p},'./engine':{},'../listing/intake':{authenticateListingReview:()=>{}}},{process:{env:{ETSY_KEYSTRING:'fixture',ETSY_SHARED_SECRET:'fixture',ETSY_REDIRECT_URI:'https://example.com/api/etsy/callback',ETSY_VAULT_KEY:'1'.repeat(64),ETSY_SERVER_KEY:'fixture-only'.repeat(4)}}});
  await assert.rejects(prepareEtsyDraft(context,p.businessId,p.id,'old-package-hash'),/stale_package_or_approval/);
  assert.ok(!calls.includes('prepare'));
});

test('Stage16 authoritative intake stops before connection or draft preparation without authenticated review',async()=>{
 const {package:p}=packageFixture(),calls=[];
 const context={businesses:[{id:p.businessId}],supabase:{from(){return{select(){return this;},eq(){return this;},async maybeSingle(){return{data:{content:{etsyDraftEnvelope:'fixture-package',listingReviewEnvelope:{verdict:'APPROVE',mode:'live'}}}};}};},async rpc(name,args){calls.push(args.p_operation);return{data:{}};}}};
 const {loadEtsyPackage}=load('src/etsy/server.ts',{'server-only':{},'node:crypto':require('node:crypto'),'./adapter':{},'./contracts':require('../.core-tests/etsy/contracts.js'),'./oauth':{},'./vault':{unseal:()=>p},'./engine':{},'../listing/intake':require('../.core-tests/listing/intake.js')},{process:{env:{ETSY_KEYSTRING:'fixture',ETSY_SHARED_SECRET:'fixture',ETSY_REDIRECT_URI:'https://example.com/api/etsy/callback',ETSY_VAULT_KEY:'1'.repeat(64),ETSY_SERVER_KEY:'fixture-only'.repeat(4)}}});
 await assert.rejects(loadEtsyPackage(context,p.businessId,p.id),/authenticated_listing_review_required/);assert.deepEqual(calls,['validate_package']);
});
test('browser renders owner controls and enforces both native consent fields at desktop and mobile widths', {skip:!process.env.CI || !existsSync(chrome)},async()=>{
  const {chromium}=require('playwright-core');
  const browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage();
    await page.setContent(`<style>${readFileSync('src/app/dashboard/etsy/etsy.css','utf8')}</style>${render(base)}`);
    assert.equal(await page.getByRole('button',{name:'Connect Etsy securely'}).isDisabled(),true);
    assert.equal(await page.getByRole('heading',{name:'No verified Product Package is shown on this page'}).isVisible(),true);
    const {package:p}=packageFixture();
    await page.setContent(`<style>${readFileSync('src/app/dashboard/etsy/etsy.css','utf8')}</style>${render({...base,configured:true,connection:{shopName:'Fixture shop',status:'connected',currency:'NZD'},packages:[p]})}`);
    const form=page.locator('form').filter({has:page.getByRole('button',{name:'Create draft',exact:true})});
    assert.equal(await form.evaluate(el=>el.checkValidity()),false);
    await page.locator('[name=draftConsent]').check();assert.equal(await form.evaluate(el=>el.checkValidity()),false);
    await page.locator('[name=assetConsent]').check();assert.equal(await form.evaluate(el=>el.checkValidity()),true);
    for(const width of [1280,390]){await page.setViewportSize({width,height:900});assert.equal(await page.getByRole('button',{name:'Create draft',exact:true}).isVisible(),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
    assert.equal(await page.getByRole('button',{name:'Publish',exact:true}).count(),0);
  }finally{await browser.close();}
});

test('out-of-range draft and package pages describe only this page while retaining independent totals', () => {
 const page={page:7,pageSize:25,total:127,hasNext:false,available:true},html=render({...base,runsPage:page,packagesPage:page});
 assert.match(html,/No verified Product Package is shown on this page/);assert.match(html,/No draft runs are shown on this server page/);
 assert.doesNotMatch(html,/No qualified Product Package available|No draft runs are recorded for this Business/);
});

test('R11 configured-but-unqualified access stays disabled while an existing connection remains visible',()=>{
 const unconnected=render({...base,configured:true});assert.match(unconnected,/legacy write-scope connection flow/);assert.match(unconnected,/Own-shop operations and marketplace research have separate eligibility checks/);assert.match(unconnected,/disabled="">Connect Etsy securely/);
 const connected=render({...base,configured:true,connection:{id:'inert',shopName:'Preserved exact shop',status:'connected',currency:'NZD'}});assert.match(connected,/Preserved exact shop/);assert.match(connected,/>Disconnect and stop draft work</);assert.doesNotMatch(connected,/>Connect Etsy securely</);
});
test('R11 repeated crafted Connect submissions produce a scoped hold with zero cookie/RPC writes or external redirects',async()=>{
 const effects=[];const {connectEtsy}=load('src/app/dashboard/etsy/actions.ts',{
  'next/headers':{cookies:async()=>({set:()=>effects.push('cookie')})},'next/navigation':{redirect:url=>{effects.push(['redirect',url]);throw Error(url);}},'next/cache':{revalidatePath:()=>{}},
  '@/lib/core-ui/data':{requireOwnerUiContext:async()=>({userId:'owner',businesses:[{id:'11000000-0000-4000-8000-000000000002'}]})},'@/etsy/server':{ownerBusiness:()=>{},etsyConfig:()=>({keystring:'inert',sharedSecret:'inert',redirectUri:'https://example.com/api/etsy/callback'}),etsyRpc:async()=>effects.push('rpc')},
  '@/etsy/oauth':require('../.core-tests/etsy/oauth.js'),'@/etsy/vault':require('../.core-tests/etsy/vault.js')
 });
 const form=new FormData();form.set('businessId','11000000-0000-4000-8000-000000000002');form.set('accountConsent','on');
 for(let i=0;i<2;i++)await assert.rejects(connectEtsy(form),/business=11000000-0000-4000-8000-000000000002&message=connection-purpose-review-required/);
 assert.equal(effects.length,2);assert.ok(effects.every(([kind,url])=>kind==='redirect'&&url.startsWith('/dashboard/etsy?')));
});
