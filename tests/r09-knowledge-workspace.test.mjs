import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadSource} from './helpers/guided-ui.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,business=id(1),other=id(2),selected=id(20),submission=id(90);
const queries=loadSource('src/lib/core-ui/console-knowledge-query.ts');
const guard=await import('../.core-tests/core/quest-intake.js');
const query=(section='proposals',extra={})=>queries.knowledgeQuery({type:section,...extra});
const proposal={id:selected,businessId:business,proposalId:id(19),version:1,title:'Private observation',lesson:'An evidence-linked local finding remains provisional.',scope:'Synthetic original-design experiments',limitations:['A local sample is not generalizable'],artifactIds:[id(50)],evidenceHash:'a'.repeat(64),status:'rejected',reviewId:id(60),reviewReason:'Redaction removed necessary proof',createdAt:'2026-10-03T12:00:00Z'};
const release={id:selected,packKey:'knowledge.learned.testing',version:'1.0.0',title:'Reviewed test guidance',status:'current',content:{guidance:'Compare attributable evidence before acting.',scope:'Read-only evidence checks',limitations:['One bounded test only'],conflicts:['Some historical results disagree'],generalizability:'Independent tests support this bounded guidance'},sources:[{url:'https://example.invalid/source',title:'Synthetic primary source',verifiedAt:'2026-10-01T00:00:00Z',expiresAt:'2026-11-01T00:00:00Z',contentHash:'b'.repeat(64),stance:'supports'}],reviewerIdentity:'trusted-platform-reviewer',reviewerFingerprint:'c'.repeat(64),manifestHash:'d'.repeat(64),contentHash:'e'.repeat(64),reviewedAt:'2026-10-02T00:00:00Z',expiresAt:'2026-11-01T00:00:00Z',supersedesReleaseId:null,supersessionReason:null,application:null};
function envelope(q,items=[],item=null){return{businessId:business,dataset:q.section,readOnly:true,limit:25,offset:q.offset,total:items.length,items,selection:{status:q.selectedId?item?'selected':'missing':'none',item}};}

test('R09 bounded navigation preserves explicit empty/old selection and rejects ambiguous or oversized query',()=>{
 const q=query('usage',{page:'401',selected,q:'a historical version'});assert.equal(q.offset,10000);assert.equal(q.limit,25);assert.equal(q.selectedId,selected);
 for(const search of [{type:'promote'},{page:'402'},{page:'0'},{selected:'not-a-uuid'},{q:'x'.repeat(121)},{type:['usage','releases']},{q:'bad\nquery'}])assert.throws(()=>queries.knowledgeQuery(search));
});
test('R09 exact selection is independent of empty filtered page and never substituted',()=>{
 const q=query('proposals',{selected,page:'5',q:'no match'}),data=envelope(q,[],proposal);
 const result=queries.decodeKnowledgePage(data,business,q);assert.equal(result.available,true);assert.equal(result.total,0);assert.equal(result.detail.id,selected);assert.equal(result.items.length,0);
 for(const change of [{businessId:other},{dataset:'usage'},{readOnly:false},{limit:24},{offset:0},{total:101},{selection:{status:'selected',item:{...proposal,id:id(22)}}},{selection:{status:'selected',item:{...proposal,businessId:other}}},{selection:{status:'missing',item:proposal}},{selection:{status:'none',item:null}}])assert.equal(queries.decodeKnowledgePage({...data,...change},business,q).available,false,JSON.stringify(change));
});
test('R09 private pages reject incomplete counts, duplicate rows and same-owner cross-Business records',()=>{
 const q=query(),data=envelope(q,[proposal]);assert.equal(queries.decodeKnowledgePage(data,business,q).available,true);
 for(const change of [{items:[],total:1},{items:[proposal,proposal],total:2},{items:[{...proposal,businessId:other}]},{items:[{...proposal,id:'bad'}]}])assert.equal(queries.decodeKnowledgePage({...data,...change},business,q).available,false);
 const empty=queries.decodeKnowledgePage(envelope(q),business,q);assert.equal(empty.available,true);assert.equal(empty.total,0);assert.equal(queries.decodeKnowledgePage(null,business,q).total,null);
});
test('R09 only sanitized shared releases can omit Business while private projections cannot',()=>{
 const q=query('releases',{selected});assert.equal(queries.decodeKnowledgePage(envelope(q,[release],release),business,q).available,true);
 assert.equal(queries.decodeKnowledgePage(envelope(query('proposals'),[{id:selected}]),business,query('proposals')).available,false);
});
const propose={proposalId:null,expectedVersion:0,title:'Private lesson',lesson:'A bounded provisional learning with original evidence.',scope:'Original-design research',limitations:['Small private sample'],artifactIds:[id(50)]};
function actionFixture({signedIn=true,error=null,result,throwRpc=false}={}){
 const calls=[],revalidated=[];let clients=0;
 const api=loadSource('src/app/dashboard/knowledge/actions.ts',{'@/lib/core-ui/console-knowledge-query':queries,'@/core/quest-intake':guard,'next/cache':{revalidatePath:path=>revalidated.push(path)},'@/lib/supabase/server':{createClient:async()=>{clients++;return{auth:{getClaims:async()=>({data:{claims:signedIn?{sub:id(100)}:null},error:null})},rpc:async(name,args)=>{calls.push({name,args});if(throwRpc)throw new Error('inert private diagnostic');return{data:result===undefined?{id:selected,businessId:business,proposalId:id(19),version:1,status:'proposed'}:result,error};}};}}});
 return{...api,calls,revalidated,clients:()=>clients};
}
test('R09 owner action rejects review/promotion, extra authority fields, malformed IDs, secrets and invalid bounds before any client',async()=>{
 for(const [operation,payload,b=business]of [['promote',propose],['review',propose],['propose',{...propose,qualification:'qualified'}],['propose',{...propose,artifactIds:[id(50),id(50)]}],['propose',{...propose,limitations:[]}],['propose',{...propose,lesson:'password\nsecret-value-must-not-leak'}],['apply',{releaseId:selected,expectedApplicationId:null,reason:'short'}],['propose',propose,'bad']]){const f=actionFixture();const result=await f.saveKnowledge(b,operation,payload,submission);assert.equal(result.ok,false);assert.equal(f.clients(),0);assert.equal(f.calls.length,0);assert.ok(!JSON.stringify(result).includes('secret-value-must-not-leak'));}
 const large={...propose,lesson:'😀'.repeat(2000),scope:'😀'.repeat(500),limitations:Array(10).fill('😀'.repeat(400))};const f=actionFixture();assert.equal((await f.saveKnowledge(business,'propose',large,submission)).ok,false);assert.equal(f.clients(),0);
});
test('R09 exact action authenticates, forwards stable submission and revalidates only verified scoped response',async()=>{
 const out=actionFixture({signedIn:false});assert.equal((await out.saveKnowledge(business,'propose',propose,submission)).ok,false);assert.equal(out.calls.length,0);
 const f=actionFixture();for(let n=0;n<2;n++)assert.equal((await f.saveKnowledge(business,'propose',propose,submission)).ok,true);
 for(const call of f.calls){assert.equal(call.name,'r09_knowledge_owner');assert.equal(call.args.p_business_id,business);assert.equal(call.args.p_submission_id,submission);assert.equal(call.args.p_operation,'propose');assert.deepEqual(call.args.p_payload,propose);}assert.deepEqual(f.revalidated,['/dashboard','/dashboard/quests','/dashboard','/dashboard/quests']);
 for(const result of [null,{id:selected,businessId:other,version:1,status:'proposed'},{id:'bad',businessId:business,version:1,status:'proposed'}]){const bad=actionFixture({result});assert.equal((await bad.saveKnowledge(business,'propose',propose,submission)).ok,false);assert.equal(bad.revalidated.length,0);}
});
test('R09 apply/rollback/removal carry exact optimistic head and business without credentials, dispatch or self-qualification',async()=>{
 for(const [operation,payload]of [['apply',{releaseId:selected,expectedApplicationId:id(30),reason:'New reviewed scope fits this Business'}],['rollback',{applicationId:id(31),expectedApplicationId:id(30),reason:'Return to the previous validated lesson'}],['remove',{packKey:'knowledge.learned.testing',expectedApplicationId:id(30),reason:'Stop using this guidance for future work'}]]){const f=actionFixture({result:{id:id(32),businessId:business,operation,previousApplicationId:payload.expectedApplicationId,releaseId:operation==='remove'?null:selected,packKey:payload.packKey}});assert.equal((await f.saveKnowledge(business,operation,payload,submission)).ok,true);assert.equal(f.calls[0].args.p_payload.expectedApplicationId,id(30));assert.equal(f.calls[0].args.p_operation,operation);}
 const fail=actionFixture({error:{message:'private-database-detail'}});const result=await fail.saveKnowledge(business,'propose',propose,submission);assert.equal(result.ok,false);assert.ok(!result.message.includes('private-database-detail'));assert.equal(fail.revalidated.length,0);
});
function readerFixture(result){const calls=[];const reader=loadSource('src/lib/core-ui/console-knowledge-data.ts',{'server-only':{},'./console-knowledge-query':queries});const context={supabase:{rpc:async(name,args)=>{calls.push({name,args});return result;}}};return{...reader,context,calls};}
test('R09 reader uses one bounded scoped RPC with independent exact selection and handles unavailable transport',async()=>{
 const q=query('proposals',{page:'3',selected,q:'lesson'}),data={...envelope(q,[],proposal),total:0},f=readerFixture({data,error:null});const result=await f.loadKnowledgePage(f.context,business,q);assert.equal(result.available,true);assert.equal(result.detail.id,selected);assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0])),{name:'r09_knowledge_read',args:{p_business_id:business,p_dataset:'proposals',p_query:{limit:25,offset:50,query:'lesson',selectedId:selected}}});
 const failed=readerFixture({data:null,error:{message:'missing migration'}});const unavailable=await failed.loadKnowledgePage(failed.context,business,q);assert.equal(unavailable.available,false);assert.equal(unavailable.total,null);
});
const Link=({children,...props})=>React.createElement('a',props,children);
const forms=loadSource('src/components/console/console-knowledge-forms.tsx',{'next/navigation':{useRouter:()=>({refresh(){}})},'@/app/dashboard/knowledge/actions':{saveKnowledge:()=>{throw Error('No effect in rendering');}},'@/core/quest-intake':guard,'@/lib/core-ui/console-knowledge-query':queries});
async function render(section,record,{available=true,selectedId=record?.id??null,evidenceLinks}={}){
 const page={items:record?[record]:[],total:available?record?1:0:null,detail:record,selection:selectedId?record?'selected':'missing':'none',available};
 const component=loadSource('src/components/console/console-knowledge-workspace.tsx',{'next/navigation':{notFound:()=>{throw Error('not found');}},'next/link':Link,'@/lib/core-ui/owner-business':{verifyOwnerBusiness:async()=>true},'@/lib/core-ui/console-knowledge-data':{loadKnowledgePage:async()=>page},'@/lib/core-ui/console-knowledge-evidence':{loadKnowledgeEvidenceLinks:async(_context,_business,ids)=>evidenceLinks??ids.map(id=>({id,href:`/dashboard?view=library&type=records&business=${_business}&selected=${id}`,context:'unlinked'}))},'@/lib/core-ui/console-knowledge-query':queries,'./console-shell':{ConsoleShell:({children})=>React.createElement('main',null,children)},'./console-knowledge-forms':forms,'./console-workspace.css':{},'./console-knowledge-workspace.css':{}});
 const scope={businessId:business,state:null,unavailable:false,context:{userId:id(100),businesses:[{id:business,name:'Synthetic Business A'}],readSearch:`?business=${business}`}};
 return renderToStaticMarkup(await component.ConsoleKnowledgeWorkspace({scope,query:{type:section,...(selectedId?{selected:selectedId}:{})}}));
}
test('R09 rendered proposal exposes private evidence references and rejected redaction without owner qualification controls',async()=>{
 const html=await render('proposals',proposal);assert.match(html,/Redaction removed necessary proof/);assert.match(html,/This version cannot be reused/);assert.match(html,/Exact owned artifact/);assert.match(html,/Save new private version/);assert.match(html,/Review and promotion are unavailable to ordinary owners/);assert.doesNotMatch(html,/<button[^>]*>Promote|<button[^>]*>Approve review|Apply this version/);
});
test('R09 rendered reviewed guidance shows why, review fingerprint, conflicting sources and source expiry; stale/withdrawn cannot apply',async()=>{
 const active=await render('releases',release);assert.match(active,/Apply this version/);assert.match(active,/Why it applies/);assert.match(active,/Some historical results disagree/);assert.match(active,/trusted-platform-reviewer/);assert.match(active,/2026-11-01/);assert.match(active,/Information only/);
 for(const status of ['expired','withdrawn']){const html=await render('releases',{...release,status});assert.match(html,/blocked for new selection/);assert.doesNotMatch(html,/Apply this version/);}
});
test('R09 history explains frozen old version despite newer current release, and rollback uses exact historical application',async()=>{
 const pin={applicationId:id(30),applicationReason:'Original local rationale preserved',releaseId:selected,packKey:release.packKey,packVersion:'1.0.0',knowledgeVersion:'1.0.0',content:release.content,manifestHash:release.manifestHash,contentHash:release.contentHash,expiresAt:release.expiresAt,currentStatus:'withdrawn'};
 const html=await render('usage',{id:id(70),businessId:business,goalId:id(71),planId:id(70),planVersion:2,knowledge:[pin],createdAt:'2026-10-03T12:00:00Z'});assert.match(html,/pinned v1\.0\.0/);assert.match(html,/Original local rationale preserved/);assert.match(html,/Current source status: withdrawn/);assert.match(html,/Later application, rollback, removal or withdrawal does not change them/);assert.match(html,/Exact originating application/);
 const rollback=await render('applications',{id:id(30),businessId:business,packKey:release.packKey,releaseId:selected,version:'1.0.0',operation:'apply',status:'superseded',reason:'Original local rationale preserved',isCurrent:false,application:{id:id(31),releaseId:id(21)}});assert.match(rollback,/Roll back to this version/);assert.doesNotMatch(rollback,/Remove future selection/);
});
test('R09 empty and unavailable are truthful and cross-business exact selection has no substitute',async()=>{
 const empty=await render('proposals',null);assert.match(empty,/No saved private proposals/);assert.match(empty,/0–0 of 0/);
 const unavailable=await render('proposals',null,{available:false});assert.match(unavailable,/scoped read is unavailable or incomplete/);assert.match(unavailable,/Count unavailable/);assert.doesNotMatch(unavailable,/No saved private proposals/);
 const missing=await render('proposals',null,{selectedId:selected});assert.match(missing,/No substitute was selected/);assert.doesNotMatch(missing,/Private observation/);
});
test('R09 installed pack historical detail and source windows remain readable',async()=>{
 const html=await render('installed',{id:selected,business_id:business,title:'Public source research',version:'1.0.0',status:'active',activated_at:'2026-10-02T04:10:20Z',snapshot:{releases:[{id:id(21),status:'qualified',manifest:{name:'Public source research',version:'1.0.0',knowledge:[{key:'public-research',version:'1.0.0',verifiedAt:'2025-01-01T00:00:00Z',freshnessDays:30}]}}]}});assert.match(html,/Installed pack snapshot/);assert.match(html,/2026-10-02T04:10:20/);assert.match(html,/Stale saved source window/);assert.match(html,/Pack tools and installation history/);
});

test('R09 full exact usage requires explicit knowledge and execution-reference arrays; missing never becomes empty',()=>{
 const q=query('usage',{selected:id(70)}),usage={id:id(70),businessId:business,goalId:id(71),planId:id(70),planVersion:1,createdAt:'2026-10-03T12:00:00Z',knowledge:[],runs:[]};
 assert.equal(queries.decodeKnowledgePage(envelope(q,[],usage),business,q).available,true);
 for(const patch of [{knowledge:undefined},{runs:undefined},{knowledge:[{releaseId:selected}]},{runs:[{workflowRunId:'bad',taskContractId:null}]}])assert.equal(queries.decodeKnowledgePage(envelope(q,[],{...usage,...patch}),business,q).available,false);
 assert.equal(queries.decodeKnowledgePage({...envelope(q,[],usage),oversized:'x'.repeat(2000000)},business,q).available,false);
});
test('R09 transport exceptions and mismatched receipt revisions are unavailable without revalidation',async()=>{
 const interrupted=actionFixture({throwRpc:true});assert.equal((await interrupted.saveKnowledge(business,'propose',propose,submission)).ok,false);assert.equal(interrupted.revalidated.length,0);
 for(const result of [{id:selected,businessId:business,proposalId:id(19),version:2,status:'proposed'},{id:selected,businessId:business,proposalId:id(19),version:1,status:'approved'}]){const f=actionFixture({result});assert.equal((await f.saveKnowledge(business,'propose',propose,submission)).ok,false);assert.equal(f.revalidated.length,0);}
 const receipt=actionFixture({result:{id:selected,businessId:business,operation:'apply',releaseId:id(29),previousApplicationId:id(30)}});assert.equal((await receipt.saveKnowledge(business,'apply',{releaseId:id(28),expectedApplicationId:id(30),reason:'Exact reviewed version for this Business'},submission)).ok,false);
});
test('R09 expired or withdrawn historical application cannot offer rollback even when its selection is superseded',async()=>{
 for(const releaseStatus of ['expired','withdrawn']){const html=await render('applications',{id:id(30),businessId:business,packKey:release.packKey,releaseId:selected,version:'1.0.0',operation:'apply',status:'superseded',releaseStatus,reason:'Historical rationale',isCurrent:false,application:{id:id(31),releaseId:id(21)}});assert.doesNotMatch(html,/Roll back to this version/);assert.match(html,/now stale or withdrawn/);}
});

test('R09 private evidence explicitly labels context exit and does not link an unverified exact scope',async()=>{
 const unlinked=await render('proposals',proposal);assert.match(unlinked,/Business-wide, unlinked evidence/);assert.match(unlinked,/deliberately leaves the current Quest and episode context/);
 const unavailable=await render('proposals',proposal,{evidenceLinks:[{id:id(50),href:null,context:'unavailable'}]});assert.match(unavailable,/Exact evidence scope is unavailable or incomplete/);assert.doesNotMatch(unavailable,/Exact owned artifact/);assert.doesNotMatch(unavailable,/href="[^\"]*selected=00000000-0000-4000-8000-000000000050/);
 const changed=await render('proposals',proposal,{evidenceLinks:[{id:id(50),href:`/dashboard?view=library&business=${business}&quest=${id(88)}&episode=${id(89)}&selected=${id(50)}`,context:'changed-quest'}]});assert.match(changed,/recorded Quest and episode/);assert.match(changed,/incompatible earlier Step, Agent and artifact context is cleared/);
});
