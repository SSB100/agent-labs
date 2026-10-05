import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const business='11000000-0000-4000-8000-000000000001',other='11000000-0000-4000-8000-000000000002',policyId='11000000-0000-4000-8000-000000000003',grantId='11000000-0000-4000-8000-000000000004',workflowRunId='11000000-0000-4000-8000-000000000005';
class FixtureDate extends Date { constructor(...args){super(...(args.length?args:["2026-10-05T01:00:00Z"]));} static now(){return Date.parse("2026-10-05T01:00:00Z");} }
const hash='a'.repeat(64),noop=async()=>{};
function load(file,deps={}){
 const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,m={exports:{}};
 runInNewContext(`(function(require,module,exports){${code}\n})`,{URL,JSON,Date:FixtureDate})(name=>{if(['react/jsx-runtime','react','react-dom','node:crypto'].includes(name))return require(name);assert.ok(name in deps,`Unexpected UI dependency: ${name}`);return deps[name];},m,m.exports);return m.exports;
}
const presentation=load('src/app/dashboard/research-qualification/presentation.ts');
const policy={query:'What do public adult surveys say about gift uniqueness?',allowedDomains:['example.org'],excludedDomains:['etsy.com','etsy.me','etsystatic.com'],modelId:'openai/gpt-5.6-luna',providerEndpoint:'azure/us',maximumMicrousd:250000,validFrom:'2026-10-05T00:00:00Z',validUntil:'2026-10-05T23:59:00Z',quoteValidUntil:'2026-10-05T23:59:00Z'};
const proof=()=>({policyId,workflowRunId,policy,policyHash:hash,status:'ready',revoked:false,expired:false,phases:[{phase:'search',marked:false,settled:false,actualMicrounits:null,requestId:null,providerRequestId:null},{phase:'select',marked:false,settled:false,actualMicrounits:null,requestId:null,providerRequestId:null}],result:null});
const result=()=>({resultId:grantId,evidencePackHash:hash,collectionId:workflowRunId,providerRequestId:'inert-provider-id',createdAt:'2026-10-05T00:05:00Z',evidencePack:{evidence:[{id:'e1',sourceId:'s1',quote:'A bounded exact attributed public factual quote.'}],sources:[{id:'s1',title:'Public factual source',url:'https://example.org/source',retrievedAt:'2026-10-05T00:04:00Z',publishedAt:null}],limitations:['no_sales_metrics','not_profitability_proof']}});
const workspace=()=>({businessId:business,unavailable:false,configured:true,exposure:{currency:'USD',heldMicrounits:'0',hasUnknown:false},policyTotal:1,grantTotal:1,policies:[proof()],grants:[{grantId,grantHash:hash,grant:{researchPolicy:policy,businessContent:{brandContext:'Exact existing Business',operatingRules:'One public evidence proof',allowedActivity:'Research planning',restrictions:'No store writes'},goalContent:{title:'One public evidence proof',parsed:{scope:'Research planning',deadline:{date:'2026-10-05',time:'23:59:00',timezone:'UTC'},stopConstraints:['Stop after one search and one selector']}},operatingPolicy:{currency:'USD',expectedExposureMicrounits:'598063',policyLimitMicrounits:'250000',businessLifetimeLimitMicrounits:'848063',maximumDispatches:2}},used:false,expired:false,revoked:false}]});
function pageFixture({verified=true,unavailableOwnership=false,view=workspace()}={}){
 const reads=[],owned={userId:'owner',businesses:[{id:business,name:'Exact Business'},{id:other,name:'MUST NOT FALL BACK'}],businessesUnavailable:unavailableOwnership};
 const deps={'next/link':({children,...props})=>React.createElement('a',props,children),'next/navigation':{notFound:()=>{throw Error('NOT_FOUND');}},
 '@/components/stage7/app-shell':{AppShell:({children,navigationBusinessId})=>React.createElement('main',{'data-business':navigationBusinessId},children),PageHeader:({title,description,actions})=>React.createElement('header',null,React.createElement('h1',null,title),React.createElement('p',null,description),actions)},
 '@/components/console/console-retained-workspace':{ConsoleRetainedWorkspace:({header,notice,panels})=>React.createElement('div',null,header,notice,...panels.map(p=>p.content))},
 '@/lib/core-ui/data':{requireOwnerUiContext:async()=>owned},'@/lib/core-ui/owner-business':{verifyOwnerBusiness:async()=>verified},
 '@/research/qualification-server':{readResearchQualification:async(...args)=>{reads.push(args);return view;}},
 './actions':{activateResearchProof:noop,runResearchProofAction:noop,stopResearchProofAction:noop},
 './prepare-form':load('src/app/dashboard/research-qualification/prepare-form.tsx',{'./actions':{prepareResearchSetup:noop}}),
 './submit-button':load('src/app/dashboard/research-qualification/submit-button.tsx'),'./presentation':presentation,'./research-qualification.css':{}};
 return{...load('src/app/dashboard/research-qualification/page.tsx',deps),reads};
}
const render=async fixture=>renderToStaticMarkup(await fixture.default({searchParams:Promise.resolve({business})}));
function button(html,label){return html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0]??'';}

test('research GET reads exact saved workspace only and shows explicit public consent',async()=>{
 const f=pageFixture(),html=await render(f);assert.equal(f.reads.length,1);assert.equal(f.reads[0][1],business);assert.match(html,/Public research proof/);assert.match(html,/view=research&amp;business=11000000/);assert.match(html,/Exa may retain queries/);assert.match(html,/does not cover Exa/);assert.match(html,/two paid calls/);assert.match(html,/No fallback, extra research or automatic retry/);assert.match(html,/required="" name="readConsent"/);assert.match(html,/required="" name="retentionConsent"/);assert.doesNotMatch(html,/MUST NOT FALL BACK/);assert.doesNotMatch(button(html,'Run public evidence proof'),/\sdisabled=/);assert.match(html,/No saved validated evidence result/);
});
test('unavailable owner recovery is inert and does not read another Business',async()=>{
 const f=pageFixture({verified:false,unavailableOwnership:true}),html=await render(f);assert.equal(f.reads.length,0);assert.match(html,/Research records unavailable/);assert.match(html,/Reload this exact Business/);assert.doesNotMatch(html,/<form|MUST NOT FALL BACK|Prepare reviewed setup/);
});
test('missing, malformed, repeated and unowned explicit Business never fall back',async()=>{
 const f=pageFixture({verified:false});for(const query of [{},{business:'bad'},{business:[business,other]},{business}])await assert.rejects(f.default({searchParams:Promise.resolve(query)}),/NOT_FOUND/);assert.equal(f.reads.length,0);
});
test('saved-read unavailability renders recovery without forms or fabricated empty records',async()=>{
 const f=pageFixture({view:{businessId:business,unavailable:true,configured:false,policies:[],grants:[]}}),html=await render(f);assert.match(html,/Research records unavailable/);assert.doesNotMatch(html,/<form|No owner-activated/);
});
test('missing dedicated configuration disables spending while saved results and Stop remain available',async()=>{
 const view=workspace();view.configured=false;view.policies[0].result=result();view.policies[0].expired=true;view.policies[0].status='expired';const html=await render(pageFixture({view}));for(const label of ['Prepare public quote and setup','Activate reviewed proof','Run public evidence proof'])assert.match(button(html,label),/\sdisabled=/);assert.doesNotMatch(button(html,'Stop this proof'),/\sdisabled=/);assert.match(html,/Saved validated evidence/);assert.match(html,/A bounded exact attributed/);assert.match(html,/Expired: no new dispatch/);assert.match(html,/R05 admission key securely/);assert.match(html,/Existing Accounts keys cannot substitute/);
});
test('dispatch markers and known charges never display completed or validated evidence',async()=>{
 const view=workspace();view.policies[0].status='selection_recording_pending';view.policies[0].phases.forEach(p=>{p.marked=true;p.settled=true;p.actualMicrounits='1000';});const html=await render(pageFixture({view}));assert.match(html,/Held · dispatched outcome unverified/);assert.match(html,/reported \$0.001 USD/);assert.doesNotMatch(html,/>Saved validated evidence<|Complete ·/);assert.match(button(html,'Run public evidence proof'),/\sdisabled=/);
});
test('unknown charge and revoked policy fence run but retain exact proof accounting',async()=>{
 const view=workspace();view.exposure.hasUnknown=true;view.exposure.heldMicrounits='250000';view.policies[0].revoked=true;const html=await render(pageFixture({view}));assert.match(html,/\$0.25 USD · Unknown charge remains held/);assert.match(button(html,'Run public evidence proof'),/\sdisabled=/);assert.match(button(html,'Stop this proof'),/\sdisabled=/);assert.match(html,/Policy 11000000-0000-4000-8000-000000000003/);
});
test('expired, used and revoked grants are all inert',async()=>{
 for(const flag of ['expired','used','revoked']){const view=workspace();view.grants[0][flag]=true;const html=await render(pageFixture({view}));assert.match(button(html,'Activate reviewed proof'),/\sdisabled=/);assert.match(html,/required="" disabled="" name="readConsent"/);}
});
test('money formatting preserves microunit precision without converting large exposures to floats',()=>{
 assert.equal(presentation.formatResearchUsd('0'),'$0.00 USD');assert.equal(presentation.formatResearchUsd(250000),'$0.25 USD');assert.equal(presentation.formatResearchUsd('0000001'),'$0.000001 USD');assert.equal(presentation.formatResearchUsd('9007199254740993123456'),'$9007199254740993.123456 USD');assert.equal(presentation.formatResearchUsd('-1'),'Amount unavailable');
});
test('proof labels do not trust a completed marker without a saved result; run never replays a marked phase',()=>{
 const p=proof();p.status='completed';assert.equal(presentation.researchProofState(p),'Held · saved result unavailable');assert.equal(presentation.canRunResearchProof(p,true,false),false);p.status='ready';p.phases[0].marked=true;assert.equal(presentation.canRunResearchProof(p,true,false),false);p.status='collection_ready';assert.equal(presentation.canRunResearchProof(p,true,false),true);p.phases[1].marked=true;assert.equal(presentation.canRunResearchProof(p,true,false),false);p.result=result();p.expired=true;assert.equal(presentation.researchProofState(p),'Complete · saved validated evidence');
});
test('source links allow only exact approved HTTPS origins and safe subdomains',()=>{
 for(const url of ['javascript:alert(1)','http://example.org','https://example.org.evil.test','https://user:pass@example.org','https://example.org:444/'])assert.equal(presentation.safeResearchSourceUrl(url,['example.org']),null);
 assert.equal(presentation.safeResearchSourceUrl('https://public.example.org/fact',['example.org']),'https://public.example.org/fact');
});

test('future, expired, stale-quote and malformed windows cannot enable Run',()=>{
 const now=Date.parse('2026-10-05T01:00:00Z');
 for(const edit of [{validFrom:'2026-10-06T00:00:00Z'},{validUntil:'2026-10-04T00:00:00Z'},{quoteValidUntil:'2026-10-04T00:00:00Z'},{validFrom:'bad'}]){const p=proof();p.policy={...policy,...edit};assert.equal(presentation.canRunResearchProof(p,true,false,now),false);}
});

test('activation displays accounted historical charges and exact new scope and financial confirmation before consent',async()=>{
 const view=workspace();view.exposure.heldMicrounits='598063';const html=await render(pageFixture({view}));assert.match(html,/>Accounted exposure</);assert.match(html,/Known charges plus any unresolved reservations/);assert.doesNotMatch(html,/reserved exposure, not a confirmed provider charge/);assert.match(html,/Existing accounted exposure: \$0.598063 USD/);assert.match(html,/New one-time research cap: \$0.25 USD/);assert.match(html,/Resulting Business lifetime cap: \$0.848063 USD/);assert.match(html,/does not transfer or debit the historical \$2 research allowance/);assert.match(html,/Exact Business, Goal and financial confirmation/);assert.match(html,/Exact existing Business/);assert.match(html,/No store writes/);assert.match(html,/Stop after one search and one selector/);assert.match(html,/23:59:00/);assert.ok(html.indexOf('data-r11-activation-summary')<html.indexOf('name="readConsent"'));
});
test('missing exact financial or intent disclosure disables activation rather than implying confirmation',async()=>{
 for(const field of ['businessContent','goalContent','operatingPolicy']){const view=workspace();delete view.grants[0].grant[field];const html=await render(pageFixture({view}));assert.match(html,/Activation is held until the full reviewed scope and limits can be shown/);assert.match(button(html,'Activate reviewed proof'),/\sdisabled=/);}
});
