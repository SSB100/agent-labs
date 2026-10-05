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

test('Research directory paging and search survive collection, selection, attempt and sheet href changes', () => {
  const params = new URLSearchParams({ view: 'research', type: 'records', businessPage: '3', businessQuery: 'Outside directory & saved', page: '2', selected: id(22), root: id(23), attemptPage: '4', attemptSort: 'oldest' });
  const changes = [{ page: 3 }, { type: 'roots' }, { selected: id(24) }, { attemptPage: 5 }, { sheet: 'research' }, { selected: null, root: null }, { q: 'saved', searchField: 'hypothesis' }];
  for (const change of changes) {
    const href = query.consoleResearchHref(params, change), output = new URL(href, 'https://fixture').searchParams;
    assert.equal(output.get('businessPage'), '3'); assert.equal(output.get('businessQuery'), 'Outside directory & saved');
    assert.doesNotThrow(() => query.consoleResearchOptionsFromSearch(Object.fromEntries(output)));
  }
  const open = new URL(query.consoleResearchHref(params, { sheet: 'research' }), 'https://fixture').searchParams;
  const closed = new URL(query.consoleResearchHref(open, { sheet: null }), 'https://fixture').searchParams;
  assert.deepEqual(Object.fromEntries(closed), Object.fromEntries(params));
});

test('actual Research preserves Business directory context through collection links, exact close and sheet return without 404', async () => {
  const f = rootResearchFixture(), route = `/dashboard?view=research&type=records&selected=${id(1000)}&page=2&businessPage=3&businessQuery=Saved%20%26%20outside`;
  f.context.ownerDirectoryPaged = true;
  const page = await f.render(route);
  const assertDirectory = href => {
    const params = new URL(href.replaceAll('&amp;', '&'), 'https://fixture').searchParams;
    assert.equal(params.get('businessPage'), '3'); assert.equal(params.get('businessQuery'), 'Saved & outside'); assert.equal(params.has('business'), false);
    return params;
  };
  assertDirectory(page.command.returnTo); assertDirectory(page.pane.props.scopeHref); assertDirectory(page.pane.props.researchHref);
  assert.equal(page.pane.props.searchParams.get('businessPage'), '3'); assert.equal(page.pane.props.searchParams.get('businessQuery'), 'Saved & outside');
  for (const text of ['Starting rounds', 'All records', 'Plan research', 'Close detail', 'Previous', 'Next']) {
    const href = page.markup.match(new RegExp(`href="([^"]+)"[^>]*>${text}</a>`))?.[1];
    assert.ok(href, `Expected ${text} link`); assertDirectory(href);
  }
  assert.match(page.markup, /name="businessPage" value="3"/); assert.match(page.markup, /name="businessQuery" value="Saved &amp; outside"/);
  const sheet = await f.render(`${route}&sheet=research`);
  const closed = assertDirectory(sheet.sheet.props.returnTo); assert.equal(closed.has('sheet'), false); assert.equal(closed.get('selected'), id(1000)); assert.equal(closed.get('page'), '2');
  const afterClose = await f.render(sheet.sheet.props.returnTo); assert.equal(afterClose.data.query.page, 2); assert.equal(afterClose.data.query.selectedId, id(1000));
  assert.deepEqual(f.denied, []);
});
