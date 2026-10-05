import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {loadSource} from './helpers/guided-ui.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,business=id(1),quest=id(2),episode=id(3),step=id(4),agent=id(5),artifact=id(6),original=id(7);
const query=loadSource('src/lib/core-ui/console-knowledge-query.ts'),navigation=loadSource('src/lib/core-ui/workspace-navigation.ts');
const evidence=loadSource('src/lib/core-ui/console-knowledge-evidence.ts',{'server-only':{},'./console-knowledge-query':query,'./workspace-navigation':navigation});
const source=new URLSearchParams({business,quest,episode,step,agent,sourceArtifact:original});
function fixture(rows=[{id:artifact,business_id:business,workflow_run_id:episode,quest_id:quest}],options={}){
 const calls=[],context={readSearch:`?${source}`,supabase:{from(table){const call={table,operations:[]};calls.push(call);const builder={};for(const method of ['select','eq','in','limit'])builder[method]=(...args)=>{call.operations.push([method,...args]);return builder;};builder.then=(resolve,reject)=>Promise.resolve({data:rows,count:Object.hasOwn(options,'count')?options.count:rows.length,error:options.error??null}).then(resolve,reject);return builder;}}};return{context,calls};
}
const params=link=>new URL(link.href,'https://fixture.invalid').searchParams;
test('R09 private evidence verifies owned exact metadata and keeps same Quest/episode provenance',async()=>{
 const f=fixture(),links=await evidence.loadKnowledgeEvidenceLinks(f.context,business,[artifact]);assert.equal(links[0].context,'same-quest');const q=params(links[0]);for(const[key,value]of source)assert.equal(q.get(key),value,key);assert.equal(q.get('selected'),artifact);assert.equal(q.get('view'),'library');
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),[{table:'r08_artifacts',operations:[['select','id,business_id,workflow_run_id,quest_id',{count:'exact'}],['eq','business_id',business],['in','id',[artifact]],['limit',12]]}]);
});
test('R09 different exact Quest and episode replace parents and clear incompatible descendants',async()=>{
 const otherQuest=id(20),otherEpisode=id(21),f=fixture([{id:artifact,business_id:business,workflow_run_id:otherEpisode,quest_id:otherQuest}]),links=await evidence.loadKnowledgeEvidenceLinks(f.context,business,[artifact]),q=params(links[0]);assert.equal(links[0].context,'changed-quest');assert.equal(q.get('quest'),otherQuest);assert.equal(q.get('episode'),otherEpisode);assert.equal(q.get('business'),business);for(const key of ['step','agent','sourceArtifact'])assert.equal(q.has(key),false,key);
 const changedEpisode=fixture([{id:artifact,business_id:business,workflow_run_id:otherEpisode,quest_id:quest}]),sameQuest=params((await evidence.loadKnowledgeEvidenceLinks(changedEpisode.context,business,[artifact]))[0]);assert.equal(sameQuest.get('quest'),quest);assert.equal(sameQuest.get('episode'),otherEpisode);for(const key of ['step','agent','sourceArtifact'])assert.equal(sameQuest.has(key),false,key);
});
test('R09 unlinked artifact deliberately leaves all Quest context while retaining exact Business and evidence',async()=>{
 for(const run of [null,episode]){const f=fixture([{id:artifact,business_id:business,workflow_run_id:run,quest_id:null}]),link=(await evidence.loadKnowledgeEvidenceLinks(f.context,business,[artifact]))[0],q=params(link);assert.equal(link.context,'unlinked');assert.equal(q.get('business'),business);assert.equal(q.get('selected'),artifact);for(const key of ['quest','episode','step','agent','sourceArtifact'])assert.equal(q.has(key),false,key);}
});
test('R09 unavailable, partial, substituted and foreign artifact metadata never produce a guessed destination',async()=>{
 const valid={id:artifact,business_id:business,workflow_run_id:episode,quest_id:quest};
 for(const [rows,options]of [[[valid],{error:{message:'unavailable'}}],[[],{}],[[valid],{count:2}],[[{...valid,business_id:id(90)}],{}],[[{...valid,id:id(91)}],{}],[[{...valid,quest_id:undefined}],{}],[[{...valid,workflow_run_id:null}],{}],[[valid,valid],{}]]){const f=fixture(rows,options),links=await evidence.loadKnowledgeEvidenceLinks(f.context,business,[artifact]);assert.equal(links[0].href,null);assert.equal(links[0].context,'unavailable');}
 const tooMany=fixture();assert.equal((await evidence.loadKnowledgeEvidenceLinks(tooMany.context,business,Array.from({length:13},(_,n)=>id(100+n)))).every(row=>row.href===null),true);assert.equal(tooMany.calls.length,0);
});
const noAction=()=>{throw Error('Read-only render cannot mutate');},Link=({children,...props})=>React.createElement('a',props,children);
// Real production JSX/runtime, with explicit read-only app boundaries.
function loadPackPage(context){
 const manifest={packKey:'knowledge.learned.navigation',version:'1.0.0',kind:'knowledge',name:'Reviewed continuity guidance',ui:{category:'Knowledge',summary:'A bounded reviewed lesson'},dependencies:[],evals:[],workflows:[]},pack={id:id(50),status:'qualified',manifest};
 const fixtureModule={exports:{}};const code=ts.transpileModule(readFileSync('src/app/dashboard/packs/page.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const dependencies={'@/lib/core-ui/workspace-navigation':navigation,'@/lib/core-ui/history-read':{safeTablePage:async(_c,table)=>({page:{available:true},items:table==='packs'?[pack]:[]}),historyRows:read=>read.items},'@/components/console/history-pager':{HistoryPager:()=>null},'@/lib/core-ui/console-retained-feedback':{retainedFeedbackMessage:()=>null},'@/components/console/console-retained-workspace':{ConsoleRetainedWorkspace:({header,panels})=>React.createElement('main',null,header,...panels.map(panel=>React.createElement('section',{key:panel.id},panel.content))),ConsoleRecentRows:({rows})=>React.createElement(React.Fragment,null,...rows)},'next/link':Link,'next/navigation':{notFound:()=>{throw Error('Not found');}},'@/components/stage7/app-shell':{AppShell:({children})=>children,PageHeader:()=>null,StatusPill:()=>null},'@/lib/core-ui/data':{requireOwnerUiContext:async()=>context},'./actions':{activatePack:noAction,launchInstalledPack:noAction,qualifyWebResearch:noAction,runEtsyDiscoverySimulation:noAction},'./packs.css':{}};
 new Function('require','module','exports',code)(name=>{if(name==='react/jsx-runtime')return jsxRuntime;assert.ok(Object.hasOwn(dependencies,name),name);return dependencies[name];},fixtureModule,fixtureModule.exports);return fixtureModule.exports.default;
}
const linkParams=(html,label)=>{const match=[...html.matchAll(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g)].find(row=>row[2]===label);assert.ok(match,label);return new URL(match[1].replaceAll('&amp;','&'),'https://fixture.invalid').searchParams;};
test('R09 Knowledge Pack tools and learned catalog return preserve the complete existing context',async()=>{
 const context={userId:id(80),businesses:[{id:business,name:'Owned Business'}],readSearch:`?${source}`};
 const details={id:id(40),business_id:business,title:'Installed pack',version:'1.0.0',status:'active',snapshot:{releases:[]}};
 const workspace=loadSource('src/components/console/console-knowledge-workspace.tsx',{'next/navigation':{notFound:noAction},'@/lib/core-ui/owner-business':{verifyOwnerBusiness:async()=>true},'@/lib/core-ui/console-knowledge-data':{loadKnowledgePage:async()=>({items:[details],detail:details,total:1,selection:'selected',available:true})},'@/lib/core-ui/console-knowledge-evidence':{loadKnowledgeEvidenceLinks:noAction},'@/lib/core-ui/console-knowledge-query':query,'./console-shell':{ConsoleShell:({children})=>children},'./console-knowledge-forms':{KnowledgeForm:()=>null},'./console-workspace.css':{},'./console-knowledge-workspace.css':{}});
 const html=renderToStaticMarkup(await workspace.ConsoleKnowledgeWorkspace({scope:{context,businessId:business,state:null,unavailable:false},query:{selected:details.id}}));const toTools=linkParams(html,'Pack tools and installation history');for(const[key,value]of source)assert.equal(toTools.get(key),value,key);
 const builder={};for(const method of ['select','in','eq','limit'])builder[method]=()=>builder;builder.then=(resolve,reject)=>Promise.resolve({data:[],error:null,count:0}).then(resolve,reject);context.supabase={from:()=>builder};
 const Page=loadPackPage(context),catalog=renderToStaticMarkup(await Page({searchParams:Promise.resolve({business})})),toKnowledge=linkParams(catalog,'Review and deliberately apply this Knowledge version');for(const[key,value]of source)assert.equal(toKnowledge.get(key),value,key);assert.equal(toKnowledge.get('view'),'knowledge');assert.equal(toKnowledge.get('type'),'releases');assert.equal(toKnowledge.get('selected'),id(50));
});
