import assert from 'node:assert/strict';
import test from 'node:test';
import { businessId, secondBusinessId, selectedId, rootResearchFixture, researchTables, queryFromRoute, id } from './helpers/console-research-root.mjs';
import { addAttempts } from './helpers/console-research-data-fixtures.mjs';
import { make as makeEvidence, transport as evidenceTransport, id as evidenceId } from './helpers/console-research-evidence-fixtures.mjs';
const plain = value => JSON.parse(JSON.stringify(value));
const metadata = f => f.calls.filter(call => /loadConsoleResearch(?:Page|RecordsPage)$/.test(call.name));
const evidence = f => f.calls.filter(call => call.name === 'loadConsoleResearchEvidence');

for (const kind of ['roots','records']) test(`actual Research ${kind} root pages metadata across two Businesses without deep evidence/quote/legacy reads`, async () => {
  const f = rootResearchFixture(), page = await f.render(`/dashboard?view=research&type=${kind}`);
  assert.equal(page.data.page.items.length,25); assert.equal(page.data.page.total,255); assert.equal(page.data.page.complete,true);
  assert.equal(new Set(page.data.page.items.map(row=>row.business_id)).size,2);
  const next = await f.render(`/dashboard?view=research&type=${kind}&page=2`);
  assert.ok(next.data.page.items.every(row=>!page.data.page.items.some(first=>first.id===row.id)));
  assert.deepEqual(f.reads.map(read=>read.range),[[0,25],[25,50]]); assert.equal(evidence(f).length,0); assert.equal(f.ancillaryCalls.length,0); assert.deepEqual(f.denied,[]);
  assert.deepEqual(metadata(f).map(call=>call.name),[kind==='roots'?'loadConsoleResearchPage':'loadConsoleResearchRecordsPage',kind==='roots'?'loadConsoleResearchPage':'loadConsoleResearchRecordsPage']);
  assert.match(page.markup,/All owned Businesses/); assert.match(page.markup,/view=research/); assert.match(page.markup,/name="searchField"/);
  assert.ok(f.reads.every(read=>!read.columns.split(',').some(field=>['content','metadata','variables','input','state','evidence_pack'].includes(field))));
});

test('actual off-page selected record scopes commands/onward navigation while main aggregate filters and metadata finish before exact evidence',async()=>{
  const f=rootResearchFixture(),route=`/dashboard?view=research&type=records&selected=${selectedId}&page=3&q=unmatched&searchField=hypothesis&sort=oldest`;
  const pending=await f.render(route); assert.equal(pending.data.page.items.length,0); assert.equal(pending.data.selection.status,'found'); assert.equal(pending.data.selection.item.id,selectedId);
  assert.equal(pending.data.query.businessId,null); assert.equal(pending.command.businessId,businessId); assert.equal(pending.tree.props.navigationBusinessId,businessId); assert.equal(pending.tree.props.aggregateContext,true);
  const returned = new URL(pending.command.returnTo,'https://fixture'); assert.equal(returned.searchParams.get('page'),'3'); assert.equal(returned.searchParams.get('searchField'),'hypothesis'); assert.equal(returned.searchParams.get('q'),'unmatched'); assert.equal(returned.searchParams.has('business'),false);
  assert.equal(evidence(f).length,0); assert.match(pending.markup,/Loading exact saved evidence/); assert.match(pending.markup,/Historical evidence is not ready/); assert.doesNotMatch(pending.markup,/Completed historical review/);
  assert.match(pending.markup,/Full saved objective &amp; identity/); assert.match(pending.markup,/Associated saved attempts/);
  const resolved=await f.render(route,{evidence:true}); assert.equal(evidence(f).length,1); const call=evidence(f)[0]; assert.deepEqual(plain(call.arguments[0]),{experimentId:selectedId,businessId,observedAt:'2026-10-02T03:00:00.000Z'});
  assert.equal(call.result.integrity,'verified'); assert.match(resolved.markup,/Completed historical review/); assert.match(resolved.markup,/data-console-research-evidence-ready="true"/); assert.doesNotMatch(resolved.markup,/Loading exact saved evidence/);
  assert.equal(resolved.command.returnTo,pending.command.returnTo); assert.equal(f.ancillaryCalls.length,0); assert.deepEqual(f.denied,[]);
  const payloads=f.reads.filter(read=>read.columns.split(',').includes('content')); assert.ok(payloads.length>0); assert.ok(payloads.every(read=>read.limit===2&&read.filters.some(([op,key])=>op==='eq'&&key==='id')));
});

for(const mode of ['missing','foreign','unavailable'])test(`actual Research exact ${mode} retains filter and never selects another evidence record`,async()=>{
  const f=rootResearchFixture(mode==='unavailable'?{readOptions:{transport(_table,result,read){return read.filters.some(([op,key,value])=>op==='eq'&&key==='id'&&value===selectedId)?{data:null,count:null,error:true}:result;}}}:{});
  const page=await f.render(`/dashboard?view=research&business=${mode==='foreign'?secondBusinessId:businessId}&selected=${mode==='missing'?id(999999):selectedId}`,{evidence:true});
  assert.equal(page.data.selection.status,mode==='unavailable'?'unavailable':'missing'); assert.equal(evidence(f).length,0); assert.match(page.markup,/No replacement|no replacement|Your Business filter has been kept/i); assert.equal(page.data.query.businessId,mode==='foreign'?secondBusinessId:businessId); assert.deepEqual(f.denied,[]);
});

test('Business unavailable remains explicit unknown, disables command, preserves exact sheet return and performs no Research/catalogue/quote read',async()=>{
  const f=rootResearchFixture({businessesUnavailable:true}),route=`/dashboard?view=research&business=${businessId}&selected=${selectedId}&page=2&sheet=research`,page=await f.render(route,{evidence:true});
  assert.equal(page.data.page.total,null); assert.equal(page.data.selection.status,'unavailable'); assert.equal(f.reads.length,0); assert.equal(f.ancillaryCalls.length,0); assert.equal(evidence(f).length,0); assert.equal(page.command.unavailable,true);
  assert.match(page.markup,/Business records are unavailable/); assert.doesNotMatch(page.markup,/Create workspace/); assert.equal(page.sheet.props.returnTo,page.command.returnTo); assert.equal(new URL(page.sheet.props.returnTo,'https://fixture').searchParams.get('selected'),selectedId); assert.deepEqual(f.denied,[]);
});

test('explicit research sheet uses only verified selected Business and returns exact aggregate scope and independent attempt cursor on Close/Escape',async()=>{
  const f=rootResearchFixture(),route=`/dashboard?view=research&type=records&selected=${selectedId}&root=${selectedId}&page=3&q=unmatched&searchField=objective&attemptPage=2&attemptSort=oldest&sheet=research`,page=await f.render(route);
  assert.deepEqual(plain(f.ancillaryCalls),[], 'Opening the ordinary chooser cannot fetch a legacy catalogue or quote');
  const returned=new URL(page.sheet.props.returnTo,'https://fixture'); for(const [key,value]of Object.entries({selected:selectedId,root:selectedId,page:'3',q:'unmatched',searchField:'objective',attemptPage:'2',attemptSort:'oldest'}))assert.equal(returned.searchParams.get(key),value);
  assert.equal(returned.searchParams.has('business'),false);assert.equal(returned.searchParams.has('sheet'),false);assert.equal(page.command.returnTo,page.sheet.props.returnTo);
  const kickoff=page.sheet.props.children;assert.deepEqual(kickoff.props.businesses.map(row=>row.id),[businessId]);assert.equal(kickoff.props.selectedBusinessId,businessId);assert.equal(kickoff.type.name,'OwnerResearchEntry');assert.equal(evidence(f).length,0);assert.deepEqual(f.denied,[]);
});

for(const suffix of ['view=research&view=research','type=unexpected','type=roots&type=records','business='+id(989898),'selected=nope','selected='+selectedId+'&experiment='+id(99),'page=0','page=2&page=3','pageSize=500','q=*','q=text','searchField=any','attemptPage=2','attemptSort=oldest','sheet=anything','sheet=research&sheet=research','artifact='+id(42),'message=success','error=old-action'])test(`actual Research rejects malformed/conflicting ${suffix} before record/catalogue/quote reads`,async()=>{
  const f=rootResearchFixture();await assert.rejects(f.render('/dashboard?view=research&'+suffix),error=>error.code==='FIXTURE_NOT_FOUND');assert.equal(f.reads.length,0);assert.equal(f.ancillaryCalls.length,0);assert.equal(evidence(f).length,0);
});

test('former Library type=research alias preserves precise Business/experiment identity and never reaches old loaders',async()=>{
  const f=rootResearchFixture(),page=await f.render(`/dashboard?view=library&type=research&business=${businessId}&experiment=${selectedId}&page=2`);
  assert.equal(page.redirectedFrom,`/dashboard?view=library&type=research&business=${businessId}&experiment=${selectedId}&page=2`);assert.equal(new URL(page.canonicalRoute,'https://fixture').searchParams.get('view'),'research');assert.equal(page.canonicalRoute,page.command.returnTo);
  assert.equal(page.data.query.kind,'roots');assert.equal(page.data.query.selectedId,selectedId);assert.equal(page.data.query.page,2);assert.equal(page.command.businessId,businessId);assert.match(page.command.returnTo,/view=research/);assert.doesNotMatch(page.command.returnTo,/experiment=|type=research/);assert.deepEqual(f.denied,[]);assert.equal(f.ancillaryCalls.length,0);
});

test('exact root-only request derives command Business independently without narrowing aggregate results',async()=>{
  const f=rootResearchFixture(),page=await f.render(`/dashboard?view=research&root=${selectedId}`);
  assert.equal(page.data.root.status,'found');assert.equal(page.command.businessId,businessId);assert.equal(page.data.query.businessId,null);assert.equal(page.data.page.total,255);assert.equal(page.pane.props.evidenceContent.props.children.props.record.id,selectedId);assert.deepEqual(f.denied,[]);
});

test('Products safe read-only results redirects under owner guard before old data and quote loaders; real feedback/candidate flows retain legacy handler',async()=>{
  const f=rootResearchFixture(),products=f.load('src/app/dashboard/products/page.tsx').default;
  for(const route of [`/dashboard/products?view=results&business=${businessId}`,`/dashboard/products?view=results&experiment=${selectedId}&root=${selectedId}&page=2`])await assert.rejects(products({searchParams:Promise.resolve(queryFromRoute(route))}),error=>error.code==='FIXTURE_REDIRECT'&&new URL(error.href,'https://fixture').searchParams.get('view')==='research');
  assert.deepEqual(f.calls.map(call=>call.name),['ownerGuard','ownerGuard']);assert.equal(f.reads.length,0);assert.equal(f.ancillaryCalls.length,0);assert.deepEqual(f.denied,[]);
  for(const suffix of ['view=results&message=Funding+recorded','view=results&error=Preserved+failure','view=results&candidate='+id(22),'view=create','message=Funding+recorded'])await assert.rejects(products({searchParams:Promise.resolve(queryFromRoute('/dashboard/products?'+suffix))}),/Read-only Research fixture denies external effects/);
});


test('actual Research root independently pages130 associated attempts while preserving an off-search main page and newest exact context',async()=>{
  const tables=researchTables(),root=tables.product_experiments.find(row=>row.id===selectedId);addAttempts(tables,root,130);const f=rootResearchFixture({tables});
  const page=await f.render(`/dashboard?view=research&type=records&selected=${selectedId}&root=${selectedId}&page=3&q=unmatched&searchField=hypothesis&attemptPage=2&attemptSort=oldest`);
  assert.equal(page.data.page.items.length,0);assert.equal(page.data.page.page,3);assert.equal(page.data.query.businessId,null);assert.equal(page.data.attempts.page.total,130);assert.equal(page.data.attempts.page.items.length,25);assert.equal(page.data.attempts.page.page,2);assert.equal(page.data.attempts.page.complete,true);
  assert.equal(page.data.attempts.newest.status,'found');assert.equal(page.data.attempts.newestContext.status,'found');assert.ok(!page.data.attempts.page.items.some(row=>row.id===page.data.attempts.newest.item.id));assert.equal(page.command.businessId,businessId);assert.equal(evidence(f).length,0);
  const attemptRead=f.reads.find(read=>read.range&&read.filters.some(([,key,value])=>key==='variables->>budgetAuthorityRootId'&&value===selectedId));assert.deepEqual(attemptRead.range,[25,50]);assert.equal(attemptRead.result.data.length,26);assert.ok(attemptRead.filters.some(([op,key,value])=>op==='eq'&&key==='business_id'&&value===businessId));assert.ok(!attemptRead.filters.some(([op])=>op==='ilike'));
  assert.match(page.markup,new RegExp(`#console-research-attempts-${selectedId}`));assert.deepEqual(f.denied,[]);assert.equal(f.ancillaryCalls.length,0);
});


test('Library Research alias redirects its real address before metadata and rejects foreign Business under the owner guard',async()=>{
 const f=rootResearchFixture(),Page=f.load('src/app/dashboard/page.tsx').default;
 await assert.rejects(Page({searchParams:Promise.resolve({view:'library',type:'research',business:businessId,experiment:selectedId})}),error=>error.code==='FIXTURE_REDIRECT'&&new URL(error.href,'https://fixture').searchParams.get('selected')===selectedId);
 assert.equal(f.reads.length,0);assert.equal(f.ancillaryCalls.length,0);assert.deepEqual(f.calls.map(call=>call.name),['ownerGuard']);
 await assert.rejects(Page({searchParams:Promise.resolve({view:'library',type:'research',business:id(777777)})}),error=>error.code==='FIXTURE_NOT_FOUND');assert.equal(f.reads.length,0);
});

test('aggregate Research exact evidence verifies an owned Business outside its paged directory', async () => {
  const f = rootResearchFixture({ ownedBusinesses: [{ id: secondBusinessId, name: 'Visible directory Business' }], readOptions: {
    businessRows: [{ id: businessId, owner_user_id: id(10), name: 'Owned outside directory', created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' }],
  } });
  f.context.ownerDirectoryPaged = true;
  assert.deepEqual(f.context.businesses.map(row => row.id), [secondBusinessId]);
  const route = `/dashboard?view=research&type=records&selected=${selectedId}&page=3&q=unmatched&searchField=hypothesis`, page = await f.render(route, { evidence: true });
  assert.equal(page.data.query.businessId, null); assert.equal(page.data.page.items.length, 0); assert.equal(page.data.selection.status, 'found');
  assert.equal(page.command.businessId, businessId); assert.equal(page.tree.props.navigationBusinessId, businessId); assert.equal(page.tree.props.aggregateContext, true);
  assert.equal(evidence(f).length, 1); assert.equal(evidence(f)[0].result.integrity, 'verified');
  assert.match(page.markup, /Completed historical review/); assert.match(page.markup, /data-console-research-evidence-ready="true"/);
  const ownership = f.reads.filter(read => read.table === 'businesses'); assert.equal(ownership.length, 1); assert.equal(ownership[0].single, true);
  assert.deepEqual(plain(ownership[0].filters), [['eq', 'id', businessId], ['eq', 'owner_user_id', f.context.userId]]);
  assert.equal(ownership[0].columns, 'id,name,created_at,updated_at'); assert.equal(ownership[0].range, undefined); assert.equal(ownership[0].limit, undefined);
  assert.equal(f.context.businesses.find(row => row.id === businessId).name, 'Owned outside directory');
  assert.ok(f.reads.find(read => read.range).filters.every(([, key]) => key !== 'business_id'));
  const contentReads = f.reads.filter(read => read.columns.split(',').includes('content')); assert.ok(contentReads.length > 0);
  assert.ok(contentReads.every(read => f.reads.indexOf(read) > f.reads.indexOf(ownership[0])));
  const returned = new URL(page.command.returnTo, 'https://fixture'); assert.equal(returned.searchParams.has('business'), false); assert.equal(returned.searchParams.get('page'), '3');
  await f.render(route, { evidence: true }); assert.equal(f.reads.filter(read => read.table === 'businesses').length, 1);
  assert.equal(f.ancillaryCalls.length, 0); assert.deepEqual(f.denied, []);
});

for (const mode of ['foreign', 'unavailable', 'missing']) test(`aggregate off-directory Research ${mode} Business cannot disclose exact evidence`, async () => {
  const f = rootResearchFixture({ ownedBusinesses: [{ id: secondBusinessId, name: 'Visible directory Business' }], readOptions: {
    businessRows: mode === 'missing' ? [] : [{ id: businessId, owner_user_id: mode === 'foreign' ? id(999) : id(10), name: 'PRIVATE_FOREIGN_BUSINESS', created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' }],
    ...(mode === 'unavailable' ? { failTable: 'businesses' } : {}),
  } });
  f.context.ownerDirectoryPaged = true;
  const page = await f.render(`/dashboard?view=research&selected=${selectedId}&q=unmatched&searchField=hypothesis`, { evidence: true });
  assert.equal(evidence(f).length, 0); assert.equal(page.command.businessId, undefined); assert.equal(page.tree.props.navigationBusinessId, undefined);
  assert.ok(!f.reads.some(read => read.columns.split(',').includes('content'))); assert.doesNotMatch(page.markup, /PRIVATE_FOREIGN_BUSINESS|Completed historical review|data-console-research-evidence-ready/);
  const ownership = f.reads.filter(read => read.table === 'businesses'); assert.equal(ownership.length, 1); assert.equal(ownership[0].single, true);
  assert.deepEqual(plain(ownership[0].filters), [['eq', 'id', businessId], ['eq', 'owner_user_id', f.context.userId]]);
  assert.deepEqual(f.context.businesses.map(row => row.id), [secondBusinessId]); assert.equal(f.ancillaryCalls.length, 0); assert.deepEqual(f.denied, []);
});


test('exact Research evidence reader uses the real independent Business ownership lookup outside the directory', async () => {
  const prepared = makeEvidence(), business = prepared.f.scope.businessId, wire = evidenceTransport(prepared.db, { businessRows: [{ id: business, owner_user_id: evidenceId(9), name: 'Owned exact evidence Business' }] });
  wire.context.ownerDirectoryPaged = true; wire.context.businesses = [{ id: evidenceId(2), name: 'Visible directory Business' }];
  const result = await wire.api.loadConsoleResearchEvidence(wire.context, { experimentId: prepared.f.experiment.id, businessId: business, observedAt: '2026-10-02T03:00:00.000Z' });
  assert.equal(result.integrity, 'verified'); assert.equal(result.selection.status, 'found');
  assert.equal(wire.calls[0].table, 'businesses'); assert.equal(wire.calls[0].single, true);
  assert.deepEqual(plain(wire.calls[0].filters), [['eq', 'id', business], ['eq', 'owner_user_id', wire.context.userId]]);
  assert.equal(wire.context.businesses.find(row => row.id === business).name, 'Owned exact evidence Business'); assert.deepEqual(wire.forbidden, []);
});

for (const mode of ['foreign', 'unavailable', 'missing']) test(`exact Research evidence ${mode} ownership stops before reading experiment or artifact payload`, async () => {
  const prepared = makeEvidence(), business = prepared.f.scope.businessId;
  const wire = evidenceTransport(prepared.db, {
    businessRows: mode === 'missing' ? [] : [{ id: business, owner_user_id: mode === 'foreign' ? evidenceId(999) : evidenceId(9), name: 'PRIVATE_FOREIGN_BUSINESS' }],
    ...(mode === 'unavailable' ? { change: (call, result) => call.table === 'businesses' ? { data: null, count: null, error: { message: 'PRIVATE_DATABASE_ERROR' } } : result } : {}),
  });
  wire.context.ownerDirectoryPaged = true; wire.context.businesses = [{ id: evidenceId(2), name: 'Visible directory Business' }];
  await assert.rejects(wire.api.loadConsoleResearchEvidence(wire.context, { experimentId: prepared.f.experiment.id, businessId: business, observedAt: '2026-10-02T03:00:00.000Z' }), error => /Business selection is not available/.test(error.message) && !/PRIVATE_/.test(error.message));
  assert.deepEqual(wire.calls.map(read => read.table), ['businesses']); assert.equal(wire.calls[0].single, true);
  assert.deepEqual(wire.context.businesses.map(row => row.id), [evidenceId(2)]); assert.deepEqual(wire.forbidden, []);
});
