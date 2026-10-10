/** Actual ordinary owner page and server-action wiring with real React rendering.
 * Hosting, owner context and all server leaves are explicitly inert. These tests
 * do not qualify SQL authority, provider IO or a deployed Next action boundary. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
const require=createRequire(import.meta.url),id=n=>`94000000-0000-4000-8000-${String(n).padStart(12,'0')}`,H='a'.repeat(64);
const PAGE='src/app/dashboard/products/etsy-research/page.tsx',ACTIONS='src/app/dashboard/products/etsy-research/actions.ts';
class Redirect extends Error{constructor(url){super('Inert Next redirect');this.url=url;}}
function load(file,deps){const unit={exports:{}};const code=ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017,jsx:ts.JsxEmit.ReactJSX}}).outputText;new Function('require','module','exports',code)(name=>{assert.ok(Object.hasOwn(deps,name),`Unexpected actual owner import ${name}`);return deps[name];},unit,unit.exports);return unit.exports;}
function nodes(value,predicate){const all=[];function visit(v){if(Array.isArray(v)){v.forEach(visit);return;}if(!React.isValidElement(v))return;if(predicate(v))all.push(v);if(typeof v.type==='function'){visit(v.type(v.props));return;}visit(v.props.children);}visit(value);return all;}
const text=value=>Array.isArray(value)?value.map(text).join(''):React.isValidElement(value)?text(value.props.children):value===null||value===undefined||typeof value==='boolean'?'':String(value);
function fixture(options={}){
 const businessId=id(1),goalId=id(2),envelopeId=id(3),proposalId=id(4),ownerId=id(5),context={userId:ownerId},calls=[],invalidations=[];
 const status={version:'r12.owner-steel-config-readback.1',businessId,targetHash:H,status:options.status??'ready',observedAt:options.status==='verified'?'2026-10-10T17:00:00.000Z':null,proofHash:options.status==='verified'?'b'.repeat(64):null};
 const readback={readSteelConfigReadback:async(...args)=>{calls.push({kind:'read',args});if(options.readError)throw Error('PRIVATE read failure');return options.noTarget?{...status,targetHash:null,status:'review_required'}:status;},runSteelConfigReadback:async(...args)=>{calls.push({kind:'run',args});if(options.runError)throw Error('PRIVATE provider/session/key details');const outcome=options.runStatus??'verified';return{...status,status:outcome,observedAt:outcome==='verified'?'2026-10-10T17:00:00.000Z':null,proofHash:outcome==='verified'?'b'.repeat(64):null};},cancelSteelConfigReadback:async(...args)=>{calls.push({kind:'cancel',args});if(options.cancelError)throw Error('PRIVATE cancellation detail');return{...status,status:'cancelled'};}};
 const data={requireOwnerUiContext:async()=>{calls.push({kind:'owner'});if(options.ownerError)throw Error('owner context unavailable');return context;}};
 const unexpected=async()=>{throw Error('Unrelated research action must not run');};
 const research=Object.fromEntries(['prepareDirectResearchTest','confirmDirectResearchTest','stopDirectResearchTest','prepareDirectEtsyAccess','prepareDirectResearchCycle','confirmAndStartDirectResearch','resumeDirectResearch'].map(k=>[k,unexpected]));
 research.readDirectResearchCatalog=async(...args)=>{calls.push({kind:'catalog',args});return null;};
 const enrollment={prepareDirectEnrollment:unexpected,confirmDirectEnrollment:unexpected,readDirectEnrollmentCatalog:async(...args)=>{calls.push({kind:'enrollment',args});return{eligible:false,reason:'reviewed_package_required',offers:[],current:null};}};
 const shared={'@/lib/core-ui/data':data,'@/products/discovery-r12-public-owner-server':research,'@/products/discovery-r12-direct-enrollment-server':enrollment,'@/accounts/etsy-steel-readback-owner-server':readback};
 const actions=load(ACTIONS,{...shared,'node:crypto':require('node:crypto'),'next/navigation':{redirect:url=>{throw new Redirect(url);}},'next/cache':{revalidatePath:path=>invalidations.push(path)},'@/products/discovery-r12-public-contracts':{publicResearchCriteriaHash:unexpected,publicResearchQuestionHash:unexpected}});
 const page=load(PAGE,{...shared,'react/jsx-runtime':require('react/jsx-runtime'),'next/navigation':{notFound:()=>{throw Error('Inert Next not found');}},'next/link':{default:({children,...props})=>React.createElement('a',props,children)},'@/components/stage7/app-shell':{AppShell:({children})=>React.createElement('main',null,children),PageHeader:({title})=>React.createElement('h1',null,title)},'@/components/console/console-retained-workspace':{ConsoleRetainedWorkspace:({header,panels})=>React.createElement(React.Fragment,null,header,...panels.map(p=>p.content))},'@/products/discovery-r12-public-preparation':{validatePublicResearchOwnerTestReceipt:unexpected},'@/products/discovery-r12-public-utils':{publicUuid:x=>typeof x==='string'&&/^94000000-0000-4000-8000-\d{12}$/.test(x)},'./actions':actions}).default;
 const query={business:businessId,goal:goalId,envelope:envelopeId,proposal:proposalId};
 return{businessId,goalId,envelopeId,proposalId,context,status,calls,actions,invalidations,async render(changes={}){const tree=await page({searchParams:Promise.resolve({...query,...changes})});return{tree,html:renderToStaticMarkup(tree)};}};
}
function fields(form){return Object.fromEntries(nodes(form,n=>n.type==='input'&&n.props.type==='hidden').map(n=>[n.props.name,String(n.props.value)]));}
function formData(values){const f=new FormData();for(const[k,v]of Object.entries(values))f.set(k,v);return f;}
async function redirected(work){try{await work();assert.fail('Actual action must redirect');}catch(error){assert.ok(error instanceof Redirect);return new URL(error.url,'http://inert.local');}}
const originalFetch=globalThis.fetch;let externalCalls=0;
test.before(()=>{globalThis.fetch=async()=>{externalCalls++;throw Error('No external IO in page wiring tests');};});
test.after(()=>{globalThis.fetch=originalFetch;assert.equal(externalCalls,0);});
const readbackForms=(tree,actions)=>nodes(tree,n=>n.type==='form'&&[actions.verifyEtsySteelConfiguration,actions.cancelEtsySteelConfiguration].includes(n.props.action));
const navigation=f=>({businessId:f.businessId,goalId:f.goalId,envelopeId:f.envelopeId,proposalId:f.proposalId,targetHash:H});
function assertNavigation(url,f,result){assert.equal(url.pathname,'/dashboard/products/etsy-research');assert.deepEqual(Object.fromEntries(url.searchParams),{business:f.businessId,goal:f.goalId,envelope:f.envelopeId,proposal:f.proposalId,result});}

test('ordinary page reads saved status only and pins ready form to the server-selected target',async()=>{
 const f=fixture(),{tree,html}=await f.render({targetHash:'https://untrusted.invalid/private-session',sessionId:id(99)}),forms=readbackForms(tree,f.actions);
 assert.deepEqual(f.calls.map(c=>c.kind),['owner','catalog','enrollment','read']);assert.deepEqual(f.calls.at(-1).args,[f.context,f.businessId]);assert.equal(forms.length,1);assert.equal(forms[0].props.action,f.actions.verifyEtsySteelConfiguration);assert.deepEqual(fields(forms[0]),navigation(f));assert.equal(text(nodes(forms[0],n=>n.type==='button')[0]),'Verify configured Steel project');assert.match(html,/one independently reviewed, existing Steel session/);assert.match(html,/does not create a browser session, sign in to Etsy, or approve research access/);assert.doesNotMatch(html,/untrusted\.invalid|private-session|knownSessionId|credentialBindingHash|configurationHash/);
});
test('actual ready form delegates only owner context, Business and exact target while preserving navigation',async()=>{
 const f=fixture(),{tree}=await f.render(),form=readbackForms(tree,f.actions)[0];f.calls.length=0;
 const values={...fields(form),endpoint:'https://untrusted.invalid',sessionId:id(99),providerProjectId:id(98),serverKey:'PRIVATE untrusted field'};
 const url=await redirected(()=>form.props.action(formData(values)));assert.deepEqual(f.calls,[{kind:'owner'},{kind:'run',args:[f.context,f.businessId,H]}]);assertNavigation(url,f,'steel-readback-recorded');assert.deepEqual(f.invalidations,['/dashboard/products/etsy-research']);assert.doesNotMatch(url.href,/PRIVATE|endpoint|sessionId|providerProjectId/);
});
test('pending status offers cancellation only and does not repeat the provider check on render',async()=>{
 const f=fixture({status:'pending'}),{tree,html}=await f.render(),forms=readbackForms(tree,f.actions);
 assert.equal(forms.length,1);assert.equal(forms[0].props.action,f.actions.cancelEtsySteelConfiguration);assert.deepEqual(fields(forms[0]),navigation(f));assert.match(html,/starting a duplicate request is not permitted/);assert.match(html,/Cancellation prevents new claims and acceptance of late proof, but an in-flight metadata read may still finish/);assert.doesNotMatch(html,/Verify configured Steel project/);assert.equal(f.calls.filter(c=>['run','cancel'].includes(c.kind)).length,0);
 f.calls.length=0;const url=await redirected(()=>forms[0].props.action(formData(fields(forms[0]))));assert.deepEqual(f.calls,[{kind:'owner'},{kind:'cancel',args:[f.context,f.businessId,H]}]);assertNavigation(url,f,'steel-readback-cancellation-recorded');
});
for(const status of ['failed','cancelled','expired','review_required'])test(`${status} metadata state cannot start or repeat a readback`,async()=>{const f=fixture({status}),{tree,html}=await f.render();assert.equal(readbackForms(tree,f.actions).length,0);assert.equal(f.calls.some(c=>c.kind==='run'),false);assert.match(html,status==='review_required'?/independently reviewed configuration target is required/:new RegExp(`Configuration check: ${status}`));});
test('verified metadata shows only time and proof and does not imply Etsy access or release readiness',async()=>{
 const f=fixture({status:'verified'}),{tree,html}=await f.render();assert.equal(readbackForms(tree,f.actions).length,0);assert.match(html,/2026-10-10T17:00:00\.000Z/);assert.match(html,new RegExp('b'.repeat(64)));assert.match(html,/Etsy sign-in, research access and release qualification still require their separate checks/);assert.doesNotMatch(html,/knownSessionId|providerProjectId|credentialBindingHash|configurationHash|debugUrl|websocketUrl|PRIVATE/);assert.equal(f.calls.some(c=>c.kind==='run'),false);
});
for(const options of [{readError:true},{noTarget:true}])test('unavailable or missing reviewed target has no runnable form',async()=>{const f=fixture(options),{tree,html}=await f.render();assert.equal(readbackForms(tree,f.actions).length,0);assert.doesNotMatch(html,/PRIVATE|Verify configured Steel project/);assert.equal(f.calls.some(c=>c.kind==='run'),false);});
for(const operation of ['verify','cancel'])test(`${operation} action preserves exact navigation and renders generic errors without provider details`,async()=>{
 const f=fixture(operation==='verify'?{runError:true}:{cancelError:true}),fn=operation==='verify'?f.actions.verifyEtsySteelConfiguration:f.actions.cancelEtsySteelConfiguration;
 const url=await redirected(()=>fn(formData(navigation(f))));assertNavigation(url,f,'steel-readback-unavailable');assert.doesNotMatch(url.href,/PRIVATE|key|session/);const{html}=await f.render({result:url.searchParams.get('result')});assert.match(html,/requested change was not confirmed/);assert.doesNotMatch(html,/PRIVATE|provider\/session\/key/);
});
test('lost or pending helper outcome stays visible as saved pending state rather than verified wording',async()=>{
 const f=fixture({status:'pending',runStatus:'pending'}),url=await redirected(()=>f.actions.verifyEtsySteelConfiguration(formData(navigation(f))));assertNavigation(url,f,'steel-readback-recorded');const{html}=await f.render({result:'steel-readback-recorded'});assert.match(html,/saved configuration check is pending/);assert.doesNotMatch(html,/configured Steel project matched the reviewed target/);assert.equal(f.calls.filter(c=>c.kind==='run').length,1);
});
test('omitted envelope and proposal remain omitted rather than invented on action redirect',async()=>{const f=fixture(),url=await redirected(()=>f.actions.verifyEtsySteelConfiguration(formData({businessId:f.businessId,goalId:f.goalId,targetHash:H})));assert.deepEqual(Object.fromEntries(url.searchParams),{business:f.businessId,goal:f.goalId,result:'steel-readback-recorded'});});
test('missing owner context cannot invoke readback server leaves',async()=>{const f=fixture({ownerError:true});await assert.rejects(f.actions.verifyEtsySteelConfiguration(formData(navigation(f))),/owner context unavailable/);assert.deepEqual(f.calls,[{kind:'owner'}]);});
test('invalid selected Business or Goal is rejected before status or owner reads',async()=>{const f=fixture();await assert.rejects(f.render({business:'invalid'}),/not found/);assert.deepEqual(f.calls,[]);await assert.rejects(f.render({goal:['ambiguous','values']}),/not found/);assert.deepEqual(f.calls,[]);});
