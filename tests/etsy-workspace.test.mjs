import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { packageFixture } from './etsy-fixtures.mjs';
const require=createRequire(import.meta.url),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
function load(path,deps){const source=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const module={exports:{}};runInNewContext(`(function(require,module,exports){${source}\n})`)(name=>{assert.ok(name in deps,`Unexpected dependency: ${name}`);return deps[name];},module,module.exports);return module.exports;}
const noop=async()=>{};
const {EtsyWorkspace}=load('src/app/dashboard/etsy/workspace.tsx',{'react/jsx-runtime':require('react/jsx-runtime'),'next/link':({children,href})=>React.createElement('a',{href},children),'./actions':{connectEtsy:noop,disconnectEtsy:noop,createEtsyDraft:noop,reconcileEtsyDraft:noop,stopEtsyDraft:noop}});
const base={businessId:'fixture-business',businessName:'Fixture Business',configured:false,unavailable:false,connection:null,packages:[],runs:[]};
const render=data=>renderToStaticMarkup(React.createElement(EtsyWorkspace,{data}));
test('unconfigured UI explains upstream blockers and cannot connect or create',()=>{
  const html=render(base);assert.match(html,/No qualified Product Package available/);assert.match(html,/Synthetic examples and technical image tests do not satisfy/);assert.match(html,/disabled="">Connect Etsy securely/);assert.doesNotMatch(html,/>Create draft</);
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
  form.set('assetConsent','on');await assert.rejects(createEtsyDraft(form),/draft-verified/);assert.equal(calls.length,2);
});
