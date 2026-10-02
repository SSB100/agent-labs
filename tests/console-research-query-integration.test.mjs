import assert from 'node:assert/strict';
import test from 'node:test';
import { query, id, business } from './helpers/console-research-data-fixtures.mjs';
import { rootResearchFixture } from './helpers/console-research-root.mjs';
const plain = value => JSON.parse(JSON.stringify(value));
test('Research canonical search retains both pagers, exact identities and explicit search field, omitting only defaults',()=>{
  const q=query.consoleResearchQuery('records',{businessId:business.toUpperCase(),selectedId:id(22).toUpperCase(),rootId:id(23),page:3,query:' saved ',searchField:'hypothesis',sort:'oldest',attemptPage:2,attemptSort:'oldest'});
  const params=query.consoleResearchSearch(q,true);assert.deepEqual(Object.fromEntries(params),{view:'research',type:'records',business,selected:id(22),root:id(23),page:'3',q:'saved',searchField:'hypothesis',sort:'oldest',attemptPage:'2',attemptSort:'oldest',sheet:'research'});
  assert.deepEqual(plain(query.consoleResearchOptionsFromSearch(Object.fromEntries(params),'records')),{businessId:business,selectedId:id(22),rootId:id(23),page:3,query:'saved',searchField:'hypothesis',sort:'oldest',attemptPage:2,attemptSort:'oldest'});
  assert.deepEqual(Object.fromEntries(query.consoleResearchSearch(query.consoleResearchQuery('roots'))),{view:'research',type:'roots'});
});
test('explicit sheet href preserves collection, root and attempt cursors; sheet dismissal never clears them',()=>{
  const params=new URLSearchParams({view:'research',type:'records',page:'3',q:'saved',searchField:'hypothesis',selected:id(22),root:id(23),attemptPage:'4',attemptSort:'oldest'});
  const open=query.consoleResearchHref(params,{sheet:'research'}),closed=query.consoleResearchHref(new URL(open,'https://fixture').searchParams,{sheet:null});
  assert.equal(closed,'/dashboard?'+params);assert.equal(new URL(open,'https://fixture').searchParams.get('attemptPage'),'4');
  for(const sheet of ['other',['research'],['research','research']])assert.throws(()=>query.consoleResearchOptionsFromSearch({view:'research',sheet}));
});
test('scope changes reset the main cursor and exact selection changes reset only attempts; unsupported aliases/notice keys cannot widen route',()=>{
  const params=new URLSearchParams({view:'research',type:'records',page:'3',q:'saved',searchField:'hypothesis',selected:id(22),root:id(23),attemptPage:'4',attemptSort:'oldest'});
  const attempt=new URL(query.consoleResearchHref(params,{attemptPage:5}),'https://fixture');assert.equal(attempt.searchParams.get('page'),'3');assert.equal(attempt.searchParams.get('q'),'saved');
  const changed=new URL(query.consoleResearchHref(params,{selected:id(25)}),'https://fixture');assert.equal(changed.searchParams.get('page'),'3');assert.equal(changed.searchParams.has('attemptPage'),false);
  assert.equal(new URL(query.consoleResearchHref(params,{searchField:'objective'}),'https://fixture').searchParams.has('page'),false);
  for(const changes of [{artifact:id(42)},{message:'done'},{error:'failure'},{sheet:'anything'}])assert.throws(()=>query.consoleResearchHref(params,changes));
});
test('legacy browse alias permits only precise Research identities and never guesses artifact/candidate/workflow IDs',()=>{
  const f=rootResearchFixture(),alias=f.load('src/lib/core-ui/console-research-alias.ts').consoleResearchAlias;
  assert.deepEqual(plain(alias('products',{view:'results',business,experiment:id(22)})),{view:'research',type:'roots',business,selected:id(22)});
  for(const extra of [{artifact:id(42)},{candidate:id(42)},{run:id(42)},{message:'funded'},{error:'retry'}, {type:'create'}])assert.equal(alias('products',{view:'results',...extra}),null);
  assert.throws(()=>alias('library',{view:'library',type:'research',artifact:id(42)}));
});
