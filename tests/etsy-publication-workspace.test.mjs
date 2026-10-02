import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const policy=require('../.core-tests/etsy-publication/policy.js');
function load(path,deps){const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;const m={exports:{}};runInNewContext(`(function(require,module,exports){${code}\n})`)(name=>{assert.ok(name in deps,`Unexpected dependency ${name}`);return deps[name];},m,m.exports);return m.exports;}
const noop=async()=>{};
const {PublicationWorkspace}=load('src/app/dashboard/etsy/publication-workspace.tsx',{'react/jsx-runtime':require('react/jsx-runtime'),'@/etsy-publication/policy':policy,'./publication-actions':{publishReviewedEtsyDraft:noop,reconcileEtsyPublication:noop,stopEtsyPublication:noop}});
const base={businessId:'fixture-business',configured:false,unavailable:false,feeReadiness:policy.publicationFeeReadiness(Date.parse('2026-10-01T13:00:00Z')),drafts:[],runs:[]};
const render=value=>renderToStaticMarkup(React.createElement(PublicationWorkspace,{data:value}));
test('publication workspace exposes current fee and genuine product blockers without claiming manual-only',()=>{
 const html=render(base);assert.match(html,/Commercial evidence incomplete/);assert.match(html,/not a verified total/);assert.match(html,/No verified Etsy draft/);assert.match(html,/single-unit draft/);assert.doesNotMatch(html,/manual-only|publication forbidden|owner.*JSON|type="text"/);
});
test('supplier link and manual-confirmation checks remain separately unverified without changing fee controls',()=>{
 for(const data of [base,{...base,unavailable:true},{...base,configured:true,drafts:[{id:'draft',title:'Reviewed product',packageHash:'a'.repeat(64),quantity:1,priceMinor:2500,currency:'USD'}]}]){
  const html=render(data);
  for(const text of ['Supplier variant link · Unverified.','Supplier manual confirmation · Unverified.',
   'Creating or publishing an Etsy listing does not establish its variant-to-Printful product link','Agent Labs does not verify that supplier link',
   'does not verify whether Printful requires manual order confirmation','Do not assume incoming orders will wait for approval',
   'missing application checks, not a read of your provider settings','No automatic order sync or fulfilment path is implemented',
   'later Stage 22 work','A public listing alone is not proof of fulfilment readiness','Commercial evidence incomplete','not a verified total'])assert.ok(html.includes(text),text);
  assert.doesNotMatch(html,/name="(?:supplierVariantLink|manualConfirmation|supplierReady)"/);
 }
});
test('verified draft still cannot approve unknown fees and all four consents remain separate',()=>{
 const html=render({...base,configured:true,drafts:[{id:'draft',title:'Reviewed product',packageHash:'a'.repeat(64),quantity:1,priceMinor:2500,currency:'USD'}]});
 for(const name of ['publicationConsent','publicDataConsent','feeConsent','renewalConsent'])assert.match(html,new RegExp(`<input(?=[^>]*name="${name}")(?=[^>]*required="")(?=[^>]*disabled="")`));
 assert.match(html,/disabled="">Publish reviewed draft/);assert.match(html,/type="hidden" name="draftRunId"/);assert.doesNotMatch(html,/type="text"|accessToken|serverKey|vaultKey/);
});
test('larger stock is a visible initial qualification limit and is never silently rewritten',()=>{
 const html=render({...base,configured:true,drafts:[{id:'draft',title:'Reviewed product',packageHash:'a'.repeat(64),quantity:5,priceMinor:2500,currency:'USD'}]});assert.match(html,/5 units/);assert.match(html,/quantity has not been changed/);assert.doesNotMatch(html,/name="quantity"/);
});
test('unknown records are never presented as no attempts or no drafts',()=>{
 const html=render({...base,unavailable:true});assert.match(html,/Existing attempts may still exist/);assert.doesNotMatch(html,/No publication attempts|No verified Etsy draft/);
});
test('late active observation and owner stop remain visible without claiming success or reversal',()=>{
 const html=render({...base,configured:true,runs:[{id:'run',title:'Product',status:'needs_owner',providerState:'active',listingId:500,stopRequested:true,activationSent:true}]});
 assert.match(html,/observed active; full verification still needed/);assert.match(html,/may have incurred a charge/);assert.match(html,/Check existing listing/);assert.match(html,/Read-only verification/);assert.doesNotMatch(html,/Active listing independently verified|Stop further work|>Retry<|>Publish again</);
});
function actions({fail=false}={}){const calls=[];const exports=load('src/app/dashboard/etsy/publication-actions.ts',{'next/navigation':{redirect:url=>{throw new Error(url);}},'next/cache':{revalidatePath:()=>{}},'@/lib/core-ui/data':{requireOwnerUiContext:async()=>({})},'@/etsy-publication/server':{beginEtsyPublication:async(...args)=>{calls.push(['begin',...args]);if(fail)throw new Error('private provider detail');return{runId:'run'};},runEtsyPublication:async(...args)=>{calls.push(['run',...args]);if(fail)throw new Error('private provider detail');return{status:'verified'};},publicationRpc:async(...args)=>{calls.push(['rpc',...args]);return{};}}});return{...exports,calls};}
function form(){const f=new FormData();f.set('businessId','second-business');f.set('draftRunId','draft');f.set('runId','run');for(const k of ['packageHash','reviewHash','preflightHash','disclosureHash','feeQuoteHash'])f.set(k,'a'.repeat(64));return f;}
test('omitting any publication consent prevents preparation and provider execution',async()=>{
 for(const omitted of ['publicationConsent','publicDataConsent','feeConsent','renewalConsent']){const h=actions(),f=form();for(const key of ['publicationConsent','publicDataConsent','feeConsent','renewalConsent'])if(key!==omitted)f.set(key,'on');await assert.rejects(h.publishReviewedEtsyDraft(f),/business=second-business&message=publication-consent-required/);assert.equal(h.calls.length,0);}
});
test('submission binds every exact reviewed digest and invokes preparation only once',async()=>{
 const h=actions(),f=form();for(const key of ['publicationConsent','publicDataConsent','feeConsent','renewalConsent'])f.set(key,'on');await assert.rejects(h.publishReviewedEtsyDraft(f),/publication-verified/);assert.equal(h.calls.filter(c=>c[0]==='begin').length,1);assert.equal(h.calls.filter(c=>c[0]==='run').length,1);assert.deepEqual(Object.keys(h.calls[0][4]).sort(),['disclosureHash','feeQuoteHash','packageHash','preflightHash','reviewHash']);
});
test('blocked publication preserves Business and never retries or leaks provider details',async()=>{
 const h=actions({fail:true}),f=form();for(const key of ['publicationConsent','publicDataConsent','feeConsent','renewalConsent'])f.set(key,'on');await assert.rejects(h.publishReviewedEtsyDraft(f),/business=second-business&message=publication-blocked/);assert.equal(h.calls.length,1);
});
test('reconciliation is explicitly read-only and stop never calls the engine',async()=>{
 const h=actions(),f=form();await assert.rejects(h.reconcileEtsyPublication(f),/publication-verified/);assert.equal(h.calls[0].at(-1),true);h.calls.length=0;await assert.rejects(h.stopEtsyPublication(f),/publication-stopped/);assert.equal(h.calls.length,1);assert.equal(h.calls[0][0],'rpc');assert.equal(h.calls[0][3],'cancel');
});
test('dated informational pricing never becomes current all-in fee authority',()=>{
 const fresh=Date.parse('2026-10-01T13:00:00Z');assert.equal(policy.publicationFeeReadiness(fresh).available,false);assert.equal(policy.publicationPolicy.informationalBaseFee.allIn,false);assert.equal(policy.publicationPolicy.informationalBaseFee.amountMinor,20);for(const date of ['2026-10-01T12:00:00Z','2026-11-01T00:00:00Z'])assert.equal(policy.publicationFeeReadiness(Date.parse(date)).reason,'publication_policy_refresh_required');
});

const chrome=['/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync);
test('Chromium verifies mobile layout and disabled unknown-fee approval controls',{skip:!process.env.CI||!chrome},async()=>{
 const {chromium}=require('playwright-core'),browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});
 try{const page=await browser.newPage();const html=render({...base,configured:true,drafts:[{id:'draft',title:'Reviewed example product',packageHash:'a'.repeat(64),quantity:1,priceMinor:2500,currency:'USD'}]});
  for(const width of [375,1280]){await page.setViewportSize({width,height:950});await page.setContent(`<html><head><style>body{margin:16px;font-family:Arial,sans-serif}*{box-sizing:border-box} ${readFileSync('src/app/dashboard/etsy/etsy.css','utf8')}</style></head><body>${html}</body></html>`);assert.equal(await page.getByRole('heading',{name:'Publish a reviewed Etsy draft',exact:true}).isVisible(),true);assert.equal(await page.getByRole('button',{name:'Publish reviewed draft',exact:true}).isDisabled(),true);assert.equal(await page.locator('input[type=checkbox]:disabled').count(),4);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 }finally{await browser.close();}
});

test('publication Needs You card offers read-only inspection, never synthetic approval or workflow completion',()=>{
 const {NeedsYouCard}=load('src/components/stage7/workflow-visuals.tsx',{'react/jsx-runtime':require('react/jsx-runtime'),'next/link':({href,children,...props})=>React.createElement('a',{href,...props},children),'@/app/dashboard/actions':{resumeSyntheticReview:noop},'@/app/dashboard/packs/actions':{acknowledgeEtsySimulation:noop},'@/app/dashboard/browser-actions':{resumeBrowserControl:noop},'@/lib/core-ui/workflows':require('../.core-tests/lib/core-ui/workflows.js'),'./icons':{CoreIcon:()=>null},'./app-shell':{StatusPill:()=>null}});
 const html=renderToStaticMarkup(React.createElement(NeedsYouCard,{intervention:{id:'intervention',business_id:'second-business',workflow_run_id:null,intervention_type:'etsy.publication.reconcile',status:'open',title:'Verify existing listing',description:'Read-only reconciliation required.',requested_at:new Date().toISOString()},returnTo:'/dashboard/needs-you'}));
 assert.match(html,/Publication verification/);assert.match(html,/href="\/dashboard\/etsy\?business=second-business&amp;publicationRequest=intervention#publication-history"/);assert.match(html,/Check existing listing/);assert.doesNotMatch(html,/Approve and complete|Fail workflow|<form/);
});

test('Needs You page does not claim an empty queue when publication exceptions could not be read',async()=>{
 const wrapper=({children,title})=>React.createElement('section',{},title,children);const {default:Page}=load('src/app/dashboard/needs-you/page.tsx',{'react/jsx-runtime':require('react/jsx-runtime'),'next/link':({href,children,...props})=>React.createElement('a',{href,...props},children),'@/etsy-publication/server':{loadPublicationInterventions:async()=>({records:[],unavailable:true})},'@/accounts/server':{loadAccountSetupInterventions:async()=>({records:[],unavailable:false})},'@/printful/server':{loadPrintfulProductInterventions:async()=>({records:[],unavailable:false})},'@/components/stage8/browser-intervention':{BrowserInterventionCard:wrapper},'@/components/stage7/app-shell':{AppShell:wrapper,EmptyPanel:wrapper,PageHeader:wrapper},'@/components/stage7/workflow-visuals':{NeedsYouCard:wrapper},'@/lib/core-ui/data':{requireOwnerUiContext:async()=>({businesses:[]}),loadWorkflowCollection:async()=>({runs:[],definitions:[],interventions:[],errors:[]})},'@/lib/core-ui/workflows':require('../.core-tests/lib/core-ui/workflows.js')});
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}));assert.match(html,/Some requests could not be checked/);assert.match(html,/Publication checks unavailable/);assert.doesNotMatch(html,/No intervention required|Nothing needs your attention/);
});
