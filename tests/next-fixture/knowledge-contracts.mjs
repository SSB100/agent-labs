// Pure contract smoke tests. No ports, Chromium, external calls or production writes.
import assert from 'node:assert/strict';
import {loadSource} from '../helpers/guided-ui.mjs';
import {fixtureData,id,time} from './data.mjs';
import {workspaceSeed,workspaceView} from './workspace.mjs';
import {knowledgeSeed,knowledgeId,knowledgePackKey,readKnowledgeFixture,saveKnowledgeFixture} from './knowledge.mjs';
const decoder=loadSource('src/lib/core-ui/console-knowledge-query.ts');
const state=fixtureData();state.knowledge=knowledgeSeed(state);
const read=(dataset,q={},business=id(1),mode='normal')=>readKnowledgeFixture(state,{p_business_id:business,p_dataset:dataset,p_query:{limit:25,offset:0,query:'',...q}},mode);
const before=JSON.stringify(state),effects=[];
for(const dataset of ['proposals','releases','applications','usage']){
 const ids=[],kind={proposals:'version',releases:'release',applications:'application',usage:'usage'}[dataset];
 for(let offset=0;offset<127;offset+=25){const r=read(dataset,{offset}).data;assert.equal(r.total,127);assert.equal(r.items.length,Math.min(25,127-offset));ids.push(...r.items.map(row=>row.id));}
 assert.equal(new Set(ids).size,127);
 const wire=read(dataset,{selectedId:knowledgeId(kind)}).data;assert.equal(decoder.decodeKnowledgePage(wire,id(1),decoder.knowledgeQuery({type:dataset,selected:knowledgeId(kind)})).available,true,`${dataset} fixture must satisfy exact production detail decoder`);assert.ok(wire.items.every(row=>!('lesson' in row)&&!('content' in row)&&!('knowledge' in row)),'Bounded lists carry metadata only');
 const selected=read(dataset,{selectedId:knowledgeId(kind),query:'unmatched filter',offset:75}).data;
 assert.equal(selected.total,0);assert.equal(selected.selection.status,'selected');assert.equal(selected.selection.item.id,knowledgeId(kind));
 if(dataset!=='releases')for(const b of [1,2])assert.equal(read(dataset,{selectedId:knowledgeId(kind,b)}).data.selection.status,'missing');
 assert.equal(read(dataset,{},id(1),'empty').data.total,0);assert.ok(read(dataset,{},id(1),'unavailable').error);
}
assert.ok(read('proposals',{},id(999999)).error);
assert.equal(JSON.stringify(state),before,'Knowledge reads may not mutate state');
for(const q of [{limit:26},{offset:-1},{offset:10001},{selectedId:'not-a-uuid'},{unsafe:true},{query:'x'.repeat(121)}])assert.throws(()=>read('releases',q),/Unreviewed Knowledge query/);
assert.throws(()=>read('unsafe'),/Unreviewed Knowledge dataset/);
const historical=JSON.stringify(state.knowledge.usage),foreign=JSON.stringify(state.knowledge.applications.filter(a=>a.businessId!==id(1)));
let submission=1;
const mutate=(operation,p_payload,extra={})=>saveKnowledgeFixture(state,{p_business_id:id(1),p_operation:operation,p_payload,p_submission_id:id(9700000+submission++),...extra},effects);
const draft={proposalId:null,expectedVersion:0,title:'One private inert lesson',lesson:'A synthetic private observation needs independent evidence before promotion.',scope:'Only this synthetic fixture',limitations:['No generalizability established'],artifactIds:[knowledgeId('artifact')]};
assert.ok(mutate('propose',{...draft,artifactIds:[knowledgeId('artifact',1)]}).error);assert.ok(mutate('propose',{...draft,artifactIds:[knowledgeId('artifact',2)]}).error);
const proposal=mutate('propose',draft,{p_submission_id:id(9777777)});assert.equal(proposal.data.status,'proposed');
assert.equal(mutate('propose',draft,{p_submission_id:id(9777777)}).data.id,proposal.data.id);assert.equal(effects.length,1);
assert.ok(mutate('propose',{...draft,title:'Changed request'}, {p_submission_id:id(9777777)}).error);
assert.ok(mutate('promote',draft).error);assert.ok(mutate('review',draft).error);
const revision=mutate('propose',{...draft,proposalId:proposal.data.proposalId,expectedVersion:1,title:'A second private version'});assert.equal(revision.data.version,2);assert.ok(mutate('propose',{...draft,proposalId:proposal.data.proposalId,expectedVersion:1}).error);
const reason='Use this exact reviewed version for this Business.';
for(const n of [2,3])assert.ok(mutate('apply',{releaseId:knowledgeId('release',0,n),expectedApplicationId:knowledgeId('application'),reason}).error);
const apply=mutate('apply',{releaseId:knowledgeId('release',0,1),expectedApplicationId:knowledgeId('application'),reason},{p_submission_id:id(9777778)});assert.equal(apply.data.version,'2.0.0');
assert.equal(mutate('apply',{releaseId:knowledgeId('release',0,1),expectedApplicationId:knowledgeId('application'),reason},{p_submission_id:id(9777778)}).data.id,apply.data.id);
assert.ok(mutate('apply',{releaseId:knowledgeId('release',0,1),expectedApplicationId:knowledgeId('application'),reason}).error,'Separate raced stale application must fail compare-and-swap');
assert.ok(mutate('rollback',{applicationId:knowledgeId('application',1),expectedApplicationId:apply.data.id,reason}).error);
const rollback=mutate('rollback',{applicationId:knowledgeId('application'),expectedApplicationId:apply.data.id,reason});assert.equal(rollback.data.version,'1.0.0');
const removed=mutate('remove',{packKey:knowledgePackKey,expectedApplicationId:rollback.data.id,reason});assert.equal(removed.data.status,'removed');assert.equal(state.knowledge.applications.find(a=>a.businessId===id(1)&&a.packKey===knowledgePackKey&&a.isCurrent).id,removed.data.id);assert.equal(removed.data.releaseId,null);
assert.equal(JSON.stringify(state.knowledge.usage),historical,'Historical plan snapshots must remain byte-exact');assert.equal(JSON.stringify(state.knowledge.applications.filter(a=>a.businessId!==id(1))),foreign,'Same-owner and foreign Business applications must not change');
assert.ok(mutate('apply',{releaseId:knowledgeId('release',0,1),expectedApplicationId:null,reason}).error,'A removal remains the current compare-and-swap head');const reapplied=mutate('apply',{releaseId:knowledgeId('release',0,1),expectedApplicationId:removed.data.id,reason});assert.equal(reapplied.data.previousApplicationId,removed.data.id);assert.equal(effects.length,6);assert.ok(effects.every(e=>e.kind==='in-memory-knowledge'&&e.business===id(1)));
assert.doesNotMatch(JSON.stringify(read('releases').data),/PRIVATE_BUSINESS_EVIDENCE_|FOREIGN_OWNER_EVIDENCE_/);
// Verify actual metadata-only evidence link derivation against the independent Quest fixture.
const navigation=loadSource('src/lib/core-ui/workspace-navigation.ts');
const evidence=loadSource('src/lib/core-ui/console-knowledge-evidence.ts',{'server-only':{},'./console-knowledge-query':decoder,'./workspace-navigation':navigation});
const scoped=fixtureData();scoped.knowledge=knowledgeSeed(scoped);scoped.workspace=workspaceSeed(scoped,id,time);
const source=`?business=${id(1)}&quest=${id(820000)}&episode=${id(1001)}&step=${id(4001)}&sourceArtifact=${knowledgeId('artifact')}`;
const context={readSearch:source,supabase:{from(table){assert.equal(table,'r08_artifacts');let rows=workspaceView(scoped,table),columns=[];const query={select(value,options){columns=value.split(',');assert.deepEqual(columns,['id','business_id','workflow_run_id','quest_id']);assert.equal(options.count,'exact');return query;},eq(key,value){rows=rows.filter(row=>row[key]===value);return query;},in(key,values){rows=rows.filter(row=>values.includes(row[key]));return query;},limit(max){assert.equal(max,12);return query;},then(resolve){return Promise.resolve({data:rows.map(row=>Object.fromEntries(columns.map(key=>[key,row[key]??null]))),count:rows.length,error:null}).then(resolve);}};return query;}}};
const evidenceLinks=await evidence.loadKnowledgeEvidenceLinks(context,id(1),[0,1,2].map(n=>knowledgeId('artifact',0,n)));
assert.deepEqual(Array.from(evidenceLinks,row=>row.context),['same-quest','changed-quest','unlinked']);
const same=new URL(evidenceLinks[0].href,'https://fixture.invalid').searchParams;assert.equal(same.get('quest'),id(820000));assert.equal(same.get('episode'),id(1001));assert.equal(same.get('step'),id(4001));
const changed=new URL(evidenceLinks[1].href,'https://fixture.invalid').searchParams;assert.equal(changed.get('quest'),id(820001));assert.equal(changed.get('episode'),id(710100));assert.equal(changed.has('step'),false);assert.equal(changed.has('sourceArtifact'),false);
const unlinked=new URL(evidenceLinks[2].href,'https://fixture.invalid').searchParams;for(const key of ['quest','episode','step','agent','sourceArtifact'])assert.equal(unlinked.has(key),false);assert.equal(unlinked.get('business'),id(1));
const foreignEvidence=await evidence.loadKnowledgeEvidenceLinks(context,id(1),[knowledgeId('artifact',1)]);assert.equal(foreignEvidence[0].href,null);assert.equal(foreignEvidence[0].context,'unavailable');
console.log('R09 pure fixture contracts passed: scope, pages, independent exact details, private proposals, CAS/idempotency, stale/withdrawn rejection, rollback/removal and immutable historical pins. Chromium remains a separate hosted gate.');
