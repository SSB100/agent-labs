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
 runInNewContext(`(function(require,module,exports){${code}\n})`,{URL,JSON,Date:FixtureDate})(name=>{if(name==='react'&&deps.react)return deps.react;if(['react/jsx-runtime','react','react-dom','node:crypto'].includes(name))return require(name);assert.ok(name in deps,`Unexpected UI dependency: ${name}`);return deps[name];},m,m.exports);return m.exports;
}
const presentation=load('src/app/dashboard/research-qualification/presentation.ts',{'../../../research/qualification-owner-contract':load('src/research/qualification-owner-contract.ts')});
const policy={query:'What do public adult surveys say about gift uniqueness?',allowedDomains:['example.org'],excludedDomains:['etsy.com','etsy.me','etsystatic.com'],modelId:'openai/gpt-5.6-luna',providerEndpoint:'azure/us',maximumMicrousd:250000,validFrom:'2026-10-05T00:00:00Z',validUntil:'2026-10-05T23:59:00Z',quoteValidUntil:'2026-10-05T23:59:00Z'};
const proof=()=>({policyId,workflowRunId,goalId:policyId,operatingPolicyId:policyId,policy,policyHash:hash,status:'ready',revoked:false,expired:false,phases:[{phase:'search',marked:false,settled:false,actualMicrounits:null,requestId:null,providerRequestId:null},{phase:'select',marked:false,settled:false,actualMicrounits:null,requestId:null,providerRequestId:null}],result:null});
const result=()=>({resultId:grantId,evidencePackHash:hash,collectionId:workflowRunId,providerRequestId:'inert-provider-id',createdAt:'2026-10-05T00:05:00Z',evidencePack:{evidence:[{id:'e1',sourceId:'s1',quote:'A bounded exact attributed public factual quote.'}],sources:[{id:'s1',title:'Public factual source',url:'https://example.org/source',retrievedAt:'2026-10-05T00:04:00Z',publishedAt:null}],limitations:['no_sales_metrics','not_profitability_proof']}});
const workspace=()=>({businessId:business,unavailable:false,configured:true,exposure:{currency:'USD',heldMicrounits:'0',hasUnknown:false},policyTotal:1,grantTotal:1,policies:[proof()],grants:[{grantId,grantHash:hash,grant:{researchPolicy:policy,businessContent:{brandContext:'Exact existing Business',operatingRules:'One public evidence proof',allowedActivity:'Research planning',restrictions:'No store writes'},goalContent:{title:'One public evidence proof',parsed:{scope:'Research planning',deadline:{date:'2026-10-05',time:'23:59:00',timezone:'UTC'},stopConstraints:['Stop after one search and one selector']}},operatingPolicy:{currency:'USD',expectedExposureMicrounits:'598063',policyLimitMicrounits:'250000',businessLifetimeLimitMicrounits:'848063',maximumDispatches:2}},used:false,expired:false,revoked:false}]});
function pageFixture({verified=true,unavailableOwnership=false,view=workspace()}={}){
 const reads=[],owned={userId:'owner',businesses:[{id:business,name:'Exact Business'},{id:other,name:'MUST NOT FALL BACK'}],businessesUnavailable:unavailableOwnership};
 const deps={'next/link':({children,...props})=>React.createElement('a',props,children),'next/navigation':{notFound:()=>{throw Error('NOT_FOUND');}},
 '@/components/stage7/app-shell':{AppShell:({children,navigationBusinessId})=>React.createElement('main',{'data-business':navigationBusinessId},children),PageHeader:({title,description,actions})=>React.createElement('header',null,React.createElement('h1',null,title),React.createElement('p',null,description),actions)},
 '@/components/console/console-retained-workspace':{ConsoleRetainedWorkspace:({header,notice,panels})=>React.createElement('div',null,header,notice,...panels.map(p=>p.content))},
 '@/lib/core-ui/data':{requireOwnerUiContext:async()=>owned},'@/lib/core-ui/owner-business':{verifyOwnerBusiness:async()=>verified},
 '@/research/qualification-server':{readResearchQualification:async(...args)=>{reads.push(args);return view;}},
 './actions':{activateResearchProof:noop,runResearchProofAction:noop,continueResearchProofAction:noop,stopResearchProofAction:noop,reconcileResearchProofAction:noop},
 './prepare-form':load('src/app/dashboard/research-qualification/prepare-form.tsx',{'./actions':{prepareResearchSetup:noop},'./presentation':presentation}),
 './verify-route-form':load('src/app/dashboard/research-qualification/verify-route-form.tsx',{'./actions':{verifySavedInferenceRoute:noop}}),
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
 const view=workspace();view.configured=false;view.policies[0].result=result();view.policies[0].expired=true;view.policies[0].status='expired';const html=await render(pageFixture({view}));for(const label of ['Activate reviewed proof','Run public evidence proof'])assert.match(button(html,label),/\sdisabled=/);assert.doesNotMatch(button(html,'Stop this proof'),/\sdisabled=/);assert.match(html,/Saved validated evidence/);assert.match(html,/A bounded exact attributed/);assert.match(html,/Expired: no new dispatch/);assert.match(html,/R05 admission key securely/);assert.match(html,/Existing Accounts keys cannot substitute/);
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

const continuation=()=>({predecessorPolicyId:policyId,predecessorWorkflowRunId:workflowRunId,currentOperatingPolicyId:policyId,goalId:policyId,goalRevision:2,businessRevision:2,capRevision:1,lifetimeCapMicrounits:'848063',exposureMicrounits:'608131',remainingMicrounits:'239932',eligible:true,reason:'eligible'});
const outcome=(overrides={})=>({outcomeId:'11000000-0000-4000-8000-000000000006',kind:'failure',phase:'search',requestId:workflowRunId,reason:'response_model_unqualified',observation:{modelIdentity:'other',observedModelId:null,providerIdentity:'exact',observedProvider:'Azure',finishReason:'stop',searchRequests:1,annotationCount:4,approvedDomainCounts:[{domain:'example.org',count:3}],rejectedDomainCount:1,malformedAnnotationCount:0,providerError:null},createdAt:'2026-10-05T00:05:00Z',...overrides});
test('saved failure and owner Stop remain independently visible with known historical charges and no selector',async()=>{
 const view=workspace(),p=view.policies[0];p.revoked=true;p.expired=true;p.status='revoked';p.phases[0]={...p.phases[0],marked:true,settled:true,actualMicrounits:'10068'};
 p.outcomeEvents=[outcome(),outcome({outcomeId:'11000000-0000-4000-8000-000000000007',kind:'owner_stopped',phase:'none',reason:'owner_stopped',observation:null})];
 view.configured=false;const html=await render(pageFixture({view}));assert.match(html,/Saved proof failure/);assert.match(html,/returned model identity was not qualified/);assert.match(html,/Saved owner Stop/);assert.match(html,/Stopped · saved revocation/);assert.match(html,/Search: Dispatched; reported \$0.010068 USD/);assert.match(html,/Evidence selection: Pending, not dispatched/);assert.match(html,/Model identity: unqualified identity/);assert.match(html,/Raw response-provider observation: Azure label observed/);assert.match(html,/Search requests: 1; citation annotations: 4/);assert.match(html,/Approved source example.org: 3/);assert.doesNotMatch(html,/>Saved validated evidence</);assert.match(button(html,'Run public evidence proof'),/\sdisabled=/);
});
test('legacy marked proof never invents a cause and exposes key-free explicit Stop reconciliation',async()=>{
 const view=workspace(),p=view.policies[0];view.configured=false;p.revoked=true;p.expired=true;p.terminalReconciliationRequired=true;p.phases[0].marked=true;
 let html=await render(pageFixture({view}));assert.match(html,/Dispatch markers and charges do not establish its result or failure cause/);assert.doesNotMatch(button(html,'Reconcile saved Stop'),/\sdisabled=/);assert.match(html,/does not recover an unknown failure reason or start research/);
 p.outcomeEvents=[outcome({reason:'legacy_failure_undetermined',observation:null})];p.terminalReconciliationRequired=false;html=await render(pageFixture({view}));assert.match(html,/original stop cause remains undetermined/);assert.equal(button(html,'Reconcile saved Stop'),'');
});
test('safe diagnostic display withholds raw response text, unapproved domains and unknown enum values',()=>{
 const secret='private-provider-secret';const disclosure=presentation.researchOutcomeDisclosure(outcome({reason:secret,observation:{modelIdentity:secret,observedModelId:secret,providerIdentity:secret,observedProvider:secret,finishReason:secret,searchRequests:-1,annotationCount:secret,approvedDomainCounts:[{domain:secret,count:1},{domain:'example.org',count:2}],rejectedDomainCount:0,malformedAnnotationCount:0,providerError:secret,rawError:secret}}),['example.org']);
 assert.ok(disclosure);assert.doesNotMatch(JSON.stringify(disclosure),/private-provider-secret/);assert.match(JSON.stringify(disclosure),/unavailable/);assert.match(JSON.stringify(disclosure),/Approved source example.org: 2/);
 assert.equal(presentation.researchOutcomeDisclosure(outcome({kind:secret}),['example.org']),null);
});
test('existing history only offers an exact read-only continuation within the unchanged lifetime cap',async()=>{
 const view=workspace();view.continuation=continuation();view.exposure.heldMicrounits='608131';view.policies[0].revoked=true;const html=await render(pageFixture({view}));
 assert.match(html,/Prepare reviewed continuation/);assert.match(html,/Remaining allowance: \$0.239932 USD/);assert.match(html,/Unchanged Business lifetime cap: \$0.848063 USD/);assert.match(html,/Preparation is not approval for a retry/);assert.match(html,/name="mode" value="continuation"/);assert.match(html,new RegExp(`name="predecessorPolicyId" value="${policyId}"`));assert.doesNotMatch(button(html,'Prepare continuation quote and setup'),/\sdisabled=/);assert.equal(button(html,'Prepare public quote and setup'),'');
});
test('unavailable or ineligible continuation cannot fall back to a replacement Goal bootstrap',async()=>{
 const view=workspace();let html=await render(pageFixture({view}));assert.match(html,/Continuation preparation unavailable/);assert.equal(button(html,'Prepare public quote and setup'),'');
 view.continuation={...continuation(),eligible:false,reason:'terminal_reconciliation_required'};html=await render(pageFixture({view}));assert.match(button(html,'Prepare continuation quote and setup'),/\sdisabled=/);assert.match(html,/Reconcile the saved Stop below/);
 view.continuation.reason='private-secret-reason';html=await render(pageFixture({view}));assert.doesNotMatch(html,/private-secret-reason/);
});
test('initial preparation remains explicit and inert when configuration is absent',async()=>{
 const view=workspace();view.policies=[];view.policyTotal=0;view.configured=false;const html=await render(pageFixture({view}));assert.match(html,/name="mode" value="initial"/);assert.match(button(html,'Prepare public quote and setup'),/\sdisabled=/);assert.doesNotMatch(html,/name="predecessorPolicyId"/);
});
test('continuation activation states exact dynamic consent, original Goal and unchanged lifetime cap',async()=>{
 const view=workspace(),g=view.grants[0];g.kind='continuation';g.grant.continuation=continuation();g.grant.researchPolicy={...policy,maximumMicrousd:239932};g.grant.operatingPolicy={...g.grant.operatingPolicy,expectedExposureMicrounits:'608131',policyLimitMicrounits:'239932'};view.exposure.heldMicrounits='608131';
 const html=await render(pageFixture({view}));assert.match(html,/up to \$0.239932 USD and two paid calls/);assert.doesNotMatch(html,/up to \$0.25 USD/);assert.match(html,/same Business and Goal/);assert.match(html,/Unchanged Business lifetime cap: \$0.848063 USD/);assert.match(html,new RegExp(`Same Goal ${policyId}`));assert.match(html,/Original attempts and charges remain saved/);assert.doesNotMatch(button(html,'Activate reviewed proof'),/\sdisabled=/);
 delete g.grant.continuation;const held=await render(pageFixture({view}));assert.match(button(held,'Activate reviewed proof'),/\sdisabled=/);assert.match(held,/full reviewed scope and limits can be shown/);
});
test('a typed failure or unreconciled legacy terminal record never enables a replay',()=>{
 for(const extra of [{outcomeEvents:[outcome()]},{terminalReconciliationRequired:true}])assert.equal(presentation.canRunResearchProof({...proof(),...extra},true,false),false);
});
test('inconsistent financial consent and inherited enum names stay fail closed',async()=>{
 for(const change of [{policyLimitMicrounits:'250001'},{maximumDispatches:3}]){const view=workspace();Object.assign(view.grants[0].grant.operatingPolicy,change);const html=await render(pageFixture({view}));assert.match(button(html,'Activate reviewed proof'),/\sdisabled=/);}
 for(const inherited of ['constructor','toString','__proto__']){const disclosure=presentation.researchOutcomeDisclosure(outcome({reason:inherited,observation:{...outcome().observation,modelIdentity:inherited,providerIdentity:inherited,finishReason:inherited}}),['example.org']);assert.equal(typeof disclosure.reason,'string');assert.match(disclosure.reason,/classification is unavailable/);assert.doesNotMatch(JSON.stringify(disclosure),/function|\[object Object\]/);assert.match(presentation.researchContinuationReason(inherited),/preparation is held/);}
});
test('missing configuration retains exact predecessor without enabling continuation preparation',async()=>{
 const view=workspace();view.continuation=continuation();view.configured=false;const html=await render(pageFixture({view}));assert.match(button(html,'Prepare continuation quote and setup'),/\sdisabled=/);assert.match(html,new RegExp(`name="predecessorPolicyId" value="${policyId}"`));assert.equal(button(html,'Prepare public quote and setup'),'');
});
test('missing exact phase records stay explicit without inventing zero cost or unexecuted history',async()=>{
 const view=workspace(),p=view.policies[0];p.revoked=true;p.phases=[{...p.phases[0],marked:true,settled:true,actualMicrounits:'10068'}];
 let html=await render(pageFixture({view}));assert.match(html,/Search: Dispatched; reported \$0.010068 USD/);assert.match(html,/Evidence selection: no dispatch recorded/);assert.doesNotMatch(html,/Evidence selection: (?:Pending|.*\$0\.00|never)/);
 p.phases=[];html=await render(pageFixture({view}));assert.match(html,/Search: no dispatch recorded/);assert.match(html,/Evidence selection: no dispatch recorded/);
});

test('unsaved diagnostic feedback names the persistence gap without inventing a saved failure or result',async()=>{
 const f=pageFixture(),html=renderToStaticMarkup(await f.default({searchParams:Promise.resolve({business,notice:'diagnostic-unavailable'})}));
 assert.match(html,/failure diagnostic could not be saved/);assert.match(html,/Inspect this exact proof’s phase and accounting records/);assert.match(html,/No automatic retry was made; unresolved charges remain held/);assert.match(html,/No saved failure or owner Stop outcome is recorded/);assert.doesNotMatch(html,/>Saved proof failure<|>Saved validated evidence</);assert.equal(f.reads.length,1);
});
test('owner Stop alone cannot hide missing failure diagnostics after a marked phase',async()=>{
 const view=workspace(),p=view.policies[0];p.revoked=true;p.phases=[{...p.phases[0],marked:true,settled:true,actualMicrounits:'10068'}];p.outcomeEvents=[outcome({kind:'owner_stopped',reason:'owner_stopped',phase:'none',observation:null})];
 let html=await render(pageFixture({view}));assert.match(html,/Saved owner Stop/);assert.match(html,/No typed validation outcome is saved for this attempt/);assert.match(html,/Dispatch markers and charges do not establish its result or failure cause/);assert.match(html,/Search: Dispatched; reported \$0.010068 USD/);assert.doesNotMatch(html,/>Saved proof failure</);
 p.result=result();html=await render(pageFixture({view}));assert.match(html,/Saved validated evidence/);assert.doesNotMatch(html,/No typed validation outcome is saved for this attempt/);
});

test('settled saved inference-route reads stay available after expiry, Stop and missing execution configuration',async()=>{
 const view=workspace(),p=view.policies[0];view.configured=false;p.revoked=true;p.expired=true;p.phases=[{phase:'search',requestId:workflowRunId,marked:true,settled:true,actualMicrounits:'9378',providerRequestId:'gen-saved-existing'}];p.outcomeEvents=[outcome({reason:'response_provider_unqualified'})];
 const html=await render(pageFixture({view}));assert.match(html,/Verify saved inference route/);assert.doesNotMatch(button(html,'Verify saved inference route'),/\sdisabled=/);assert.match(html,/does not change the proof or its prior failures/);assert.match(html,/Saved proof failure/);assert.doesNotMatch(html,/data-r11-route-evidence/);assert.match(html,/name="requestId" value="11000000-0000-4000-8000-000000000005"/);assert.doesNotMatch(html,/name="(?:generationId|providerRequestId|url)"/);
});
test('unmarked, unsettled or unknown receipt IDs never expose an inference-route read form',async()=>{
 for(const edit of [{marked:false},{settled:false},{providerRequestId:null},{providerRequestId:'unknown'}]){const view=workspace();view.policies[0].phases=[{phase:'search',requestId:workflowRunId,marked:true,settled:true,actualMicrounits:'9378',providerRequestId:'gen-saved-existing',...edit}];assert.doesNotMatch(await render(pageFixture({view})),/Verify saved inference route/);}
});
test('diagnostics distinguish raw provider observation from independently verified generation-route evidence',()=>{
 const observed={...outcome().observation,responseProviderHash:'b'.repeat(64),inferenceRouteStatus:'verified',inferenceRouteProofHash:'c'.repeat(64)};const d=presentation.researchOutcomeDisclosure(outcome({observation:observed}),['example.org']);assert.match(d.observations.join('\n'),/Raw response-provider observation: Azure label observed/);assert.match(d.observations.join('\n'),/Raw response-provider fingerprint: b{64}/);assert.match(d.observations.join('\n'),/Generation-route evidence: verified generation-record provider\/model/);assert.match(d.observations.join('\n'),/Generation-route proof fingerprint: c{64}/);
 const historical=presentation.researchOutcomeDisclosure(outcome(),['example.org']);assert.match(historical.observations.join('\n'),/not recorded for this historical observation/);
 const unsafe=presentation.researchOutcomeDisclosure(outcome({observation:{...observed,responseProviderHash:'secret',inferenceRouteStatus:'secret',inferenceRouteProofHash:'secret'}}),['example.org']);assert.doesNotMatch(JSON.stringify(unsafe),/secret/);
});

test('inline verified route disclosure reports only normalized route evidence without rehabilitating prior output',()=>{
 const state={status:'verified',message:'Read-only route evidence received. This does not qualify prior output or authorize another run.',verification:{businessId:business,policyId,requestId:workflowRunId,phase:'search',proof:{generationId:'gen-existing-paid',providerName:'Azure',modelId:'openai/gpt-5.6-luna-20260709',requestedEndpoint:'azure/us',providerResponses:[{providerName:'Azure',modelId:'openai/gpt-5.6-luna-20260709',status:200}],proofHash:'d'.repeat(64)}}};
 const component=load('src/app/dashboard/research-qualification/verify-route-form.tsx',{'./actions':{verifySavedInferenceRoute:noop},react:{...React,useActionState:()=>[state,noop,false]}}).VerifySavedRouteForm;
 const html=renderToStaticMarkup(React.createElement(component,{businessId:business,policyId,requestId:workflowRunId}));assert.match(html,/Documented inference provider: Azure/);assert.match(html,/Model: openai\/gpt-5.6-luna-20260709/);assert.match(html,/Proof fingerprint: d{64}/);assert.match(html,/does not independently establish the regional endpoint or enumerate every inner call/);assert.match(html,/does not qualify prior output or authorize another run/);assert.match(html,/Historical failures and charges are preserved/);assert.doesNotMatch(html,/failure fixed|output qualified|name="generationId"/);
});

test('saved receipt diagnostics distinguish HTTP 404 and 401, transport, timeout, JSON and schema failures',()=>{
 for(const [inferenceRouteFailureCode,inferenceRouteHttpStatus,inferenceRouteAttempts] of [['api_failure',404,3],['api_failure',401,1],['transport_failure',null,3],['timeout',null,3],['json_invalid',200,1],['response_invalid',200,1]]){
  const o={...outcome().observation,inferenceRouteStatus:'unavailable',inferenceRouteFailureCode,inferenceRouteHttpStatus,inferenceRouteAttempts,body:'PRIVATE_BODY',header:'PRIVATE_HEADER'};
  const d=presentation.researchOutcomeDisclosure(outcome({observation:o}),['example.org']).observations.join('\n');
  assert.match(d,new RegExp(`Generation receipt failure: ${inferenceRouteFailureCode}`));assert.match(d,new RegExp(`Generation receipt HTTP status: ${inferenceRouteHttpStatus??'not recorded'}`));assert.match(d,new RegExp(`Generation receipt attempts: ${inferenceRouteAttempts}`));assert.doesNotMatch(d,/PRIVATE_BODY|PRIVATE_HEADER/);
 }
 for(const inferenceRouteFailureCode of ['PRIVATE_BODY','constructor','toString','__proto__']){
  const d=presentation.researchOutcomeDisclosure(outcome({observation:{...outcome().observation,inferenceRouteStatus:'unavailable',inferenceRouteFailureCode,inferenceRouteHttpStatus:404,inferenceRouteAttempts:3}}),['example.org']);assert.doesNotMatch(d.observations.join('\n'),/Generation receipt|PRIVATE_BODY/);
 }
 const malformed=presentation.researchOutcomeDisclosure(outcome({observation:{...outcome().observation,inferenceRouteStatus:'unavailable',inferenceRouteFailureCode:'api_failure',inferenceRouteHttpStatus:'PRIVATE_STATUS',inferenceRouteAttempts:99}}),['example.org']);
 assert.doesNotMatch(malformed.observations.join('\n'),/PRIVATE_STATUS|99/);assert.match(malformed.observations.join('\n'),/HTTP status: not recorded/);assert.match(malformed.observations.join('\n'),/attempts: not recorded/);
 const verified=presentation.researchOutcomeDisclosure(outcome({observation:{...outcome().observation,inferenceRouteStatus:'verified',inferenceRouteFailureCode:'api_failure',inferenceRouteHttpStatus:404,inferenceRouteAttempts:3}}),['example.org']);assert.doesNotMatch(verified.observations.join('\n'),/Generation receipt/);
});

function pendingReceipt({phase='search',status='awaiting_receipt',nextCheckAt='2026-10-05T00:59:00Z',attempts=1}={}){
 return {phase,requestId:workflowRunId,candidateHash:hash,status,attempts,nextCheckAt,receiptExpiresAt:'2026-10-06T00:29:00Z',diagnostic:status==='verified'?null:{code:'api_failure',httpStatus:404},proofHash:status==='verified'?'b'.repeat(64):null};
}
test('durable receipt waiting is visibly separate from validated output and cannot repeat generation',async()=>{
 const view=workspace(),p=view.policies[0];p.status='search_recording_pending';p.phases=[{phase:'search',marked:true,settled:true,actualMicrounits:'7000',requestId:workflowRunId,providerRequestId:'gen-inert-search'}];p.receiptChecks=[pendingReceipt()];
 const html=await render(pageFixture({view}));assert.match(html,/Awaiting receipt · public response saved/);assert.match(html,/Unverified output is not usable research evidence/);assert.match(html,/at most three receipt reads per phase, six in total/);assert.match(html,/at least two minutes/);assert.match(html,/not an automatic deletion deadline/);assert.match(button(html,'Run public evidence proof'),/\sdisabled=/);assert.doesNotMatch(button(html,'Continue saved proof'),/\sdisabled=/);assert.match(html,/Last receipt diagnostic: api_failure; HTTP 404/);assert.doesNotMatch(html,/Complete · saved validated evidence|data-r11-result=/);
});
test('receipt cooldown, terminal states, Stop and missing configuration keep Continue inert',async()=>{
 for(const mode of ['cooldown','terminal','exhausted','expired','stopped','revoked','unknown','missing-key']){
  const view=workspace(),p=view.policies[0];p.status='search_recording_pending';p.receiptChecks=[pendingReceipt()];
  if(mode==='cooldown')p.receiptChecks[0].nextCheckAt='2026-10-05T01:02:00Z';
  if(['terminal','exhausted','expired','stopped'].includes(mode))p.receiptChecks[0].status=mode;
  if(mode==='exhausted')p.receiptChecks[0].attempts=3;
  if(mode==='revoked')p.revoked=true;
  if(mode==='unknown')view.exposure.hasUnknown=true;
  if(mode==='missing-key')view.configured=false;
  const html=await render(pageFixture({view}));assert.match(button(html,'Continue saved proof'),/\sdisabled=/,mode);assert.match(button(html,'Run public evidence proof'),/\sdisabled=/,mode);
 }
});
test('already-dispatched selector receipt can finish during grace but never after its fixed cutoff',()=>{
 const p=proof();p.status='selection_recording_pending';p.expired=true;p.policy={...policy,validUntil:'2026-10-05T00:59:00Z',quoteValidUntil:'2026-10-05T00:59:00Z'};p.receiptChecks=[pendingReceipt({phase:'select',status:'verified'})];
 assert.equal(presentation.canContinueResearchProof(p,true,false,FixtureDate.now()),true);assert.equal(presentation.canRunResearchProof(p,true,false,FixtureDate.now()),false);
 p.receiptChecks[0].receiptExpiresAt='2026-10-05T00:59:00Z';assert.equal(presentation.canContinueResearchProof(p,true,false,FixtureDate.now()),false);
 p.receiptChecks=[pendingReceipt({status:'verified'})];assert.equal(presentation.canContinueResearchProof(p,true,false,FixtureDate.now()),false,'verified expired search cannot admit a new selector');
});

test('staged policies and active pre-stage windows never expose the independent historical receipt reader',async()=>{
 for(const staged of [false,true]){const view=workspace(),p=view.policies[0];p.status='search_recording_pending';p.phases=[{phase:'search',requestId:workflowRunId,marked:true,settled:true,actualMicrounits:'7000',providerRequestId:'gen-staged'}];if(staged){p.receiptChecks=[pendingReceipt()];p.revoked=true;p.expired=true;}const html=await render(pageFixture({view}));assert.doesNotMatch(html,/Verify saved inference route/);}
});
