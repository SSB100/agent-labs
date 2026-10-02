import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { artifactContent, artifactHash, businessId, businesses, exactArtifactId, fixtureTables, id, oldActiveRunId, oldEventId, oldRunId, rootCollectionFixture, secondBusinessId, selectedActivityRoute, selectedArtifactRoute, selectedWorkRoute } from './helpers/console-collection-root.mjs';
const plain = value => JSON.parse(JSON.stringify(value));
const exact = (read, id) => read.filters.some(([operator, column, value]) => operator === 'eq' && column === 'id' && value === id);
const table = (fixture, name) => fixture.reads.filter(read => read.table === name);

for (const kind of ['work','activity']) test(`actual DashboardPage ${kind} reads bounded 25+sentinel pages across 127 records in each of two Businesses`, async () => {
  const fixture = rootCollectionFixture(), first = await fixture.render(`/dashboard?view=${kind}`);
  assert.equal(first.data.page.total, 254); assert.equal(first.data.page.items.length, 25); assert.equal(first.data.page.complete, true);
  assert.equal(new Set(first.data.page.items.map(row => row.business_id)).size, 2);
  const firstIds = first.data.page.items.map(row => row.id), next = await fixture.render(`/dashboard?view=${kind}&page=2`);
  assert.equal(next.data.page.items.length, 25); assert.equal(next.data.page.total, 254); assert.ok(next.data.page.items.every(row => !firstIds.includes(row.id)));
  const pages = fixture.reads.filter(read => read.range);
  assert.equal(pages.length, 2); assert.deepEqual(pages.map(read => read.range), [[0,25],[25,50]]);
  for (const read of pages) { assert.deepEqual(read.order.map(item => item[0]), [kind === 'work' ? 'created_at' : 'occurred_at','id']); assert.equal(read.options.count, 'exact'); assert.equal(read.returned, 26); }
  assert.deepEqual(fixture.loaderCalls.map(call => call.name), [kind === 'work' ? 'loadConsoleWorkPage' : 'loadConsoleActivityPage', kind === 'work' ? 'loadConsoleWorkPage' : 'loadConsoleActivityPage']);
  assert.deepEqual(fixture.denied, []); assert.equal(table(fixture, 'artifacts').length, 0); assert.equal(table(fixture,'model_invocations').length,0);
});

test('actual Work root keeps an old active run and excludes completed_at-ended active statuses server-side', async () => {
  const fixture = rootCollectionFixture(), page = await fixture.render(`/dashboard?view=work&business=${businessId}&status=active&sort=oldest`);
  assert.equal(page.data.page.items[0].id, oldActiveRunId); assert.ok(page.data.page.items.every(row => !row.completed_at));
  assert.ok(!page.data.page.items.some(row => row.id === oldRunId));
  const read = fixture.reads.find(read => read.range); assert.ok(read.filters.some(filter => filter[0] === 'is' && filter[1] === 'completed_at' && filter[2] === null));
});

test('actual Work root exact selection stays independent of page, status, search and legacy run spelling', async () => {
  const fixture = rootCollectionFixture(), page = await fixture.render(`${selectedWorkRoute}&page=3&status=completed&q=Literal&sort=oldest`);
  assert.equal(page.data.page.items.length, 0); assert.equal(page.data.selection.status, 'found'); assert.equal(page.detailData.run.id, oldRunId);
  assert.equal(page.props.searchParams.get('selected'), oldRunId); assert.equal(page.props.searchParams.has('run'), false);
  for (const [key,value] of [['page','3'],['q','Literal'],['status','completed'],['sort','oldest']]) assert.equal(page.props.searchParams.get(key),value);
  assert.match(page.markup,/execution ended/); assert.match(page.markup,/unknown charge/); assert.doesNotMatch(page.markup,/PRIVATE_[A-Z_]+/);
  assert.deepEqual(fixture.loaderCalls.map(call => call.name), ['loadConsoleWorkPage','loadConsoleWorkDetail','loadRunCostData']);
  assert.deepEqual(fixture.denied,[]);
});

test('actual detail caps every child metadata window and fetches only the selected old artifact payload', async () => {
  const fixture = rootCollectionFixture(), page = await fixture.render(selectedArtifactRoute), detail = page.detailData;
  for (const key of ['stages','tasks','workers','interventions','artifacts']) { assert.equal(detail.completeness[key].loaded,100); assert.equal(detail.completeness[key].total,133); assert.equal(detail.completeness[key].hasMore,true); assert.equal(detail.completeness[key].complete,false); }
  assert.equal(detail.artifacts.some(row=>row.id===exactArtifactId),false); assert.equal(detail.artifactSelection.status,'found'); assert.deepEqual(plain(detail.artifactSelection.item.content), artifactContent);
  assert.equal(createHash('sha256').update(JSON.stringify(detail.artifactSelection.item.content,null,2)).digest('hex'),artifactHash);
  const payloadReads = table(fixture,'artifacts').filter(read=>read.columns.split(',').includes('content'));
  assert.equal(payloadReads.length,1); assert.equal(payloadReads[0].limit,2); assert.ok(exact(payloadReads[0],exactArtifactId));
  assert.ok(payloadReads[0].filters.some(([,key,value])=>key==='workflow_run_id'&&value===oldRunId)); assert.ok(payloadReads[0].filters.some(([,key,value])=>key==='business_id'&&value.includes(businessId)));
  const metadata = table(fixture,'artifacts').find(read=>!read.columns.split(',').includes('content')); assert.equal(metadata.limit,101); assert.equal(metadata.returned,101);
  assert.ok(detail.artifacts.every(row=>!Object.hasOwn(row,'content'))); assert.match(page.markup,/Incomplete history/); assert.match(page.markup,/cannot establish the latest record/);
  assert.doesNotMatch(page.markup,/PRIVATE_ARTIFACT_PAYLOAD_|PRIVATE_STAGE_PAYLOAD|PRIVATE_TASK_PAYLOAD|PRIVATE_WORKER_PAYLOAD|PRIVATE_NOTICE_PAYLOAD/);
  assert.equal(table(fixture,'model_invocations')[0].limit,1001); assert.deepEqual(fixture.denied,[]);
});

test('actual Work root without artifact identity never preloads any artifact content', async () => {
  const fixture=rootCollectionFixture(); await fixture.render(selectedWorkRoute);
  assert.equal(table(fixture,'artifacts').length,1); assert.ok(table(fixture,'artifacts').every(read=>!read.columns.split(',').includes('content')));
});

for (const kind of ['work','activity']) test(`actual ${kind} root preserves literal wildcard characters and searches only the promised field`, async () => {
  const fixture=rootCollectionFixture(), query='100%_\\', page=await fixture.render(`/dashboard?view=${kind}&q=${encodeURIComponent(query)}`);
  assert.equal(page.data.page.total,2); assert.equal(page.data.page.items.length,2);
  const call=fixture.reads.find(read=>read.range); assert.deepEqual(call.filters.find(row=>row[0]==='ilike'), ['ilike',kind==='work'?'definition.name':'event_type','%100\\%\\_\\\\%']);
  const hidden=await fixture.render(`/dashboard?view=${kind}&q=payload-only-search-term`); assert.equal(hidden.data.page.total,0);
});

test('actual Activity independently selects an old event and verifies exact workflow filter and Business', async () => {
  const fixture=rootCollectionFixture(), page=await fixture.render(`${selectedActivityRoute}&q=unmatched&page=2`);
  assert.equal(page.data.selection.item.id,oldEventId); assert.equal(page.data.page.items.length,0); assert.match(page.markup,/Underlying audit events/);
  const scoped=await fixture.render(`${selectedActivityRoute}&runFilter=${oldRunId}`); assert.equal(scoped.data.page.total,1); assert.equal(scoped.data.workflowFilter.id,oldRunId);
  const conflict=await fixture.render(`${selectedActivityRoute}&runFilter=${id(1002)}`); assert.equal(conflict.data.selection.status,'missing');
  const foreign=await fixture.render(`/dashboard?view=activity&business=${secondBusinessId}&runFilter=${oldRunId}`); assert.equal(foreign.data.page.total,null); assert.equal(foreign.data.workflowFilter,null);
  assert.deepEqual(fixture.denied,[]);
});

for (const mode of ['null-count','cap','read-error','foreign-row']) test(`actual root ${mode} never certifies a partial or foreign page as complete`, async () => {
  const onlyPage=read=>Boolean(read.range), readOptions=mode==='null-count'?{nullCount:onlyPage}:mode==='cap'?{cap:read=>onlyPage(read)?7:undefined}:mode==='read-error'?{error:onlyPage}:{inject:(read,rows)=>onlyPage(read)?[{...rows[0],business_id:id(999)},...rows.slice(1)]:rows};
  const fixture=rootCollectionFixture({readOptions}), page=await fixture.render('/dashboard?view=work');
  assert.equal(page.data.page.complete,false); assert.equal(page.data.page.total,null); assert.match(page.markup,/could not be checked|completeness unverified/i);
  if(mode==='foreign-row'||mode==='read-error')assert.equal(page.data.page.items.length,0);
  assert.doesNotMatch(page.markup,/PRIVATE_DATABASE_ERROR|No matching records/); assert.deepEqual(fixture.denied,[]);
});

for (const mode of ['cost-null-count','cost-read-error','cost-cap','foreign-artifact']) test(`actual exact detail ${mode} retains honest unknown and exact-scope truth`, async () => {
  const tables=fixtureTables(); if(mode==='cost-cap') for(let index=3;index<1003;index++)tables.model_invocations.push({...tables.model_invocations[0],id:id(51000+index)});
  const readOptions=mode==='cost-null-count'?{nullCount:read=>read.table==='model_invocations'}:mode==='cost-read-error'?{error:read=>read.table==='model_invocations'}:mode==='foreign-artifact'?{inject:(read,rows)=>read.table==='artifacts'&&exact(read,exactArtifactId)?rows.map(row=>({...row,business_id:secondBusinessId})):rows}:{};
  const fixture=rootCollectionFixture({tables,readOptions}),page=await fixture.render(selectedArtifactRoute);
  if(mode==='foreign-artifact'){assert.equal(page.detailData.artifactSelection.status,'unavailable');assert.doesNotMatch(page.markup,/Old exact saved artifact, outside/);assert.match(page.markup,/No other output has been substituted/);}
  else {assert.equal(page.detailData.costs.calls.status,'unavailable');assert.match(page.markup,/unavailable|unknown/i);assert.doesNotMatch(page.markup,/No provider charges/);}
  assert.deepEqual(fixture.denied,[]);
});

test('actual root missing and foreign selected records never substitute a recent run or artifact', async () => {
  for(const route of [`/dashboard?view=work&business=${secondBusinessId}&selected=${oldRunId}`,`/dashboard?view=work&selected=${id(999999)}`]) {
    const fixture=rootCollectionFixture(),page=await fixture.render(route);assert.equal(page.data.selection.status,'missing');assert.equal(page.detailData.run,null);assert.match(page.markup,/not available in the selected Business scope/);assert.equal(table(fixture,'model_invocations').length,0);
  }
});

for(const suffix of ['selected=nope','page=0','page=2&page=3','pageSize=500','q=*','selected='+oldRunId+'&run='+id(1002),'decision='+id(10),'connectionRun='+id(10),'artifact='+exactArtifactId])test(`actual Work root rejects malformed/conflicting ${suffix}`,async()=>{
  const fixture=rootCollectionFixture();await assert.rejects(fixture.render('/dashboard?view=work&'+suffix),error=>error.code==='FIXTURE_NOT_FOUND');assert.equal(fixture.reads.length,0);
});

test('actual root unavailable Business metadata produces unknown collections without record reads',async()=>{
  const fixture=rootCollectionFixture({businessesUnavailable:true}),page=await fixture.render(selectedWorkRoute);
  assert.equal(page.data.page.total,null);assert.equal(page.data.selection.status,'unavailable');assert.equal(fixture.reads.length,0);assert.match(page.markup,/Business records are unavailable/);
});

test('aggregate to exact selected research setup preserves filter scope, correct Business and exact artifact return anchor',async()=>{
  const fixture=rootCollectionFixture(),aggregate=await fixture.render('/dashboard?view=work');
  assert.equal(aggregate.tree.props.commandBar.props.businessId,undefined);assert.equal(aggregate.tree.props.commandBar.props.businessSelectionAvailable,true);assert.match(aggregate.markup,/Choose Business/);assert.equal(fixture.ancillaryCalls.length,0);
  const page=await fixture.render(`/dashboard?view=work&selected=${oldRunId}&artifact=${exactArtifactId}&q=Literal&page=2&sheet=research`);
  assert.equal(page.props.searchParams.has('business'),false);assert.equal(page.tree.props.commandBar.props.businessId,businessId);
  assert.deepEqual(plain(page.sheet.props.children.props.businesses),[businesses[0]]);assert.ok(page.sheet.props.returnTo.endsWith('#artifact-'+exactArtifactId));
  assert.equal(new URL(page.sheet.props.returnTo,'https://test.invalid').searchParams.has('sheet'),false);
  assert.deepEqual(fixture.ancillaryCalls.map(call=>call.businesses),[[businessId],[businessId]]);assert.deepEqual(fixture.denied,[]);
});

test('actual collection and Activity context projections omit wide payloads until exact selection',async()=>{
  const fixture=rootCollectionFixture();const work=await fixture.render('/dashboard?view=work');
  assert.ok(work.data.page.items.every(row=>!Object.hasOwn(row,'input')&&!Object.hasOwn(row,'state')));
  assert.ok(work.data.definitions.every(row=>!Object.hasOwn(row,'stage_definition')));
  const activity=await fixture.render(selectedActivityRoute);
  assert.ok(activity.data.page.items.every(row=>!Object.hasOwn(row,'payload')));assert.ok(activity.data.runs.every(row=>!Object.hasOwn(row,'input')&&!Object.hasOwn(row,'state')));
  assert.equal(activity.data.selection.item.payload.exact,1);
  for(const read of fixture.reads.filter(read=>read.range))assert.ok(!read.columns.split(',').some(column=>['input','state','payload','stage_definition'].includes(column)));
});

test('aggregate selected Business continues Library and Connections while global Decisions and list scope remain aggregate',async()=>{
  const fixture=rootCollectionFixture(),selected=await fixture.render(`/dashboard?view=work&selected=${id(2001)}&page=2`);
  assert.equal(selected.props.searchParams.has('business'),false);assert.equal(selected.data.page.total,254);assert.equal(selected.tree.props.navigationBusinessId,secondBusinessId);assert.equal(selected.tree.props.aggregateContext,true);
  assert.equal(selected.tree.props.commandBar.props.businessId,secondBusinessId);assert.match(selected.markup,/All owned Businesses/);
  for(const view of ['library','connections'])assert.ok(selected.markup.includes(`view=${view}&amp;business=${secondBusinessId}`));
  assert.match(selected.markup,/href="\/dashboard\?view=decisions"/);
  const closed=await fixture.render('/dashboard?view=work&page=2');assert.equal(closed.tree.props.navigationBusinessId,undefined);assert.equal(closed.tree.props.commandBar.props.businessId,undefined);
});

test('actual stopped filter includes completed_at-ended needs_owner records and excludes unended current work',async()=>{
  const fixture=rootCollectionFixture(),page=await fixture.render(`/dashboard?view=work&business=${businessId}&status=stopped`);
  assert.equal(page.data.page.total,1);assert.equal(page.data.page.items[0].id,oldRunId);assert.ok(fixture.reads.find(read=>read.range).filters.some(([operator,key,value])=>operator==='not'&&key==='completed_at'&&value===null));
});

test('runFilter-only Activity B scopes onward navigation and research without narrowing the Business filter', async () => {
  const fixture = rootCollectionFixture(), route = `/dashboard?view=activity&runFilter=${id(2001)}&page=2`;
  const page = await fixture.render(route);
  assert.equal(page.data.workflowFilter.business_id, secondBusinessId); assert.equal(page.data.selection.status, 'none');
  assert.equal(page.props.searchParams.has('business'), false); assert.equal(page.props.searchParams.get('runFilter'), id(2001));
  assert.equal(page.tree.props.aggregateContext, true); assert.equal(page.tree.props.navigationBusinessId, secondBusinessId);
  assert.equal(page.tree.props.commandBar.props.businessId, secondBusinessId);
  for (const view of ['library', 'connections']) assert.ok(page.markup.includes(`view=${view}&amp;business=${secondBusinessId}`));
  assert.match(page.markup, /All owned Businesses/);
  const sheet = await fixture.render(route + '&sheet=research');
  assert.deepEqual(plain(sheet.sheet.props.children.props.businesses), [businesses[1]]);
  const back = new URL(sheet.sheet.props.returnTo, 'https://test.invalid').searchParams;
  assert.equal(back.get('business'), null); assert.equal(back.get('runFilter'), id(2001)); assert.equal(back.get('page'), '2');
  assert.deepEqual(fixture.denied, []);
});

test('malformed execution fields become unavailable rather than current work or a render failure', async () => {
  for (const value of [undefined, '', 'invalid-timestamp']) {
    const tables = fixtureTables();
    for (const row of tables.workflow_runs) { if (value === undefined) delete row.completed_at; else row.completed_at = value; }
    const fixture = rootCollectionFixture({ tables }), page = await fixture.render('/dashboard?view=work');
    assert.equal(page.data.page.complete, false); assert.equal(page.data.page.total, null); assert.equal(page.data.page.items.length, 0);
    assert.match(page.markup, /unavailable|could not be verified/i); assert.equal(page.boundary.props.snapshot.available, false);
    assert.deepEqual(fixture.denied, []);
  }
  for (const table of ['workflow_stage_runs', 'worker_runs', 'task_contracts']) {
    const tables = fixtureTables(); for (const row of tables[table]) delete row.status;
    const fixture = rootCollectionFixture({ tables }), page = await fixture.render(selectedWorkRoute);
    const section = { workflow_stage_runs: 'stages', worker_runs: 'workers', task_contracts: 'tasks' }[table];
    assert.equal(page.detailData.completeness[section].complete, false); assert.equal(page.detailData[table === 'workflow_stage_runs' ? 'stages' : table === 'worker_runs' ? 'workerRuns' : 'tasks'].length, 0);
    assert.equal(page.boundary.props.snapshot.available, false); assert.match(page.markup, /unavailable|could not be verified/i);
    assert.deepEqual(fixture.denied, []);
  }
});
