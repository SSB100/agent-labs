import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import {runInNewContext} from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),C=require('../.core-tests/connections/contracts.js');
const business='11000000-0000-4000-8000-000000000001',other='11000000-0000-4000-8000-000000000002';
function load(context,verified,view){let reads=0;const deps={
 'node:crypto':require('node:crypto'),
 'react/jsx-runtime':require('react/jsx-runtime'),'next/link':{default:({children,href,...p})=>React.createElement('a',{href,...p},children)},'next/navigation':{notFound:()=>{throw Error('NOT_FOUND');}},
 '@/components/stage7/app-shell':{AppShell:({children})=>React.createElement('main',null,children),PageHeader:({title,description})=>React.createElement('header',null,React.createElement('h1',null,title),React.createElement('p',null,description))},
 '@/components/console/console-retained-workspace':{ConsoleRetainedWorkspace:({header,notice,panels})=>React.createElement('div',null,header,notice,...panels.map(p=>p.content))},
 '@/lib/core-ui/data':{requireOwnerUiContext:async()=>context},'@/lib/core-ui/owner-business':{verifyOwnerBusiness:async()=>verified},'@/connections/server':{readConnectionQualification:async()=>{reads++;return view;}},'@/connections/contracts':C,'./connections.css':{},'./actions':{qualifyConnection:async()=>{},disconnectConnection:async()=>{},readOwnShopDraftStatus:async()=>{},stopOwnShopReads:async()=>{}}};
 const source=ts.transpileModule(readFileSync('src/app/dashboard/connections/page.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,m={exports:{}};
 runInNewContext(`(function(require,module,exports){${source}\n})`,{})(n=>{assert.ok(n in deps,n);return deps[n];},m,m.exports);return{Page:m.exports.default,reads:()=>reads};}
test('R11 unavailable ownership lookup renders inert recovery frame without a fallback Business or credential read',async()=>{
 const h=load({userId:'inert-owner',businesses:[{id:other,name:'MUST NOT SELECT OTHER BUSINESS'}],businessesUnavailable:true},false);
 const html=renderToStaticMarkup(await h.Page({searchParams:Promise.resolve({business})}));assert.match(html,/<main>/);assert.match(html,/Qualification records are unavailable/);assert.match(html,/role="alert"/);assert.doesNotMatch(html,/MUST NOT SELECT OTHER BUSINESS|<form|credential fingerprints/);assert.equal(h.reads(),0);
});
test('R11 invalid/unowned explicit Business remains unavailable rather than falling back',async()=>{
 const h=load({userId:'inert-owner',businesses:[{id:other,name:'Other'}],businessesUnavailable:false},false);await assert.rejects(h.Page({searchParams:Promise.resolve({business})}),/NOT_FOUND/);await assert.rejects(h.Page({searchParams:Promise.resolve({business:'bad'})}),/NOT_FOUND/);assert.equal(h.reads(),0);
});
test('R11 authorized read failure stays a recoverable frame with no connection claims',async()=>{
 const h=load({userId:'inert-owner',businesses:[{id:business,name:'Exact business'}]},true,{businessId:business,unavailable:true,configured:false,grants:[],connections:[],attempts:[]});const html=renderToStaticMarkup(await h.Page({searchParams:Promise.resolve({business})}));assert.match(html,/Qualification records are unavailable/);assert.doesNotMatch(html,/<form|No verified store binding/);assert.equal(h.reads(),1);
});
