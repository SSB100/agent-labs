import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { query, api, id, business, other, foreign, seed, addAttempts, together, fixture, digest } from './helpers/console-research-data-fixtures.mjs';
const oldFetch = globalThis.fetch;
test.before(() => { globalThis.fetch = () => { throw Error('External networking denied'); }; });
test.after(() => { globalThis.fetch = oldFetch; });

test('strict raw-record query normalization rejects unsupported filters, ambiguous aliases and malformed IDs', () => {
  for (const options of [{ page: 0 }, { page: 1.5 }, { page: Number.MAX_SAFE_INTEGER }, { page: null }, { pageSize: 50 }, { pageSize: '25' }, { query: 2 }, { query: '*' }, { query: 'a\nb' }, { query: 'x'.repeat(121) }, { query: 'objective without explicit field' }, { searchField: 'all' }, { sort: 'updated' }, { sort: null }, { status: 'completed' }, { selectedId: 'bad' }, { rootId: 'bad' }, { businessId: 'bad' }, { attemptPage: 2 }, { selectedId: id(1), attemptPage: 0 }, { selectedId: id(1), attemptSort: 'latest-status' }]) assert.throws(() => query.consoleResearchQuery('roots', options));
  for (const params of [{ selected: [id(1), id(1)] }, { root: [id(1), id(2)] }, { selected: id(1), experiment: id(2) }, { view: 'library' }, { type: 'quests' }, { status: 'active' }, { run: id(1) }, { artifact: id(1) }, { q: 'test', searchField: 'any' }, { q: 'test' }, { searchField: ['objective', 'hypothesis'] }, { page: '' }]) assert.throws(() => query.consoleResearchOptionsFromSearch(params));
  const upper = 'ABCDEFAB-ABCD-4BCD-ABCD-ABCDEFABCDEF';
  assert.equal(query.consoleResearchOptionsFromSearch({ selected: upper, experiment: upper.toLowerCase(), root: upper, business: upper }).selectedId, upper.toLowerCase());
  assert.equal(query.consoleResearchQuery('roots', { query: '  saved  ', searchField: 'hypothesis' }).query, 'saved');
  assert.equal(query.consoleResearchSearchPattern('50%_\\saved'), '%50\\%\\_\\\\saved%');
});

test('navigation preserves aggregate scope, page and explicit search while removing conflicting aliases', () => {
  const current = new URLSearchParams({ view: 'research', type: 'records', page: '3', q: 'saved', searchField: 'hypothesis', experiment: id(2), attemptPage: '2' });
  const selected = new URL(query.consoleResearchHref(current, { selected: id(3) }), 'https://fixture').searchParams;
  assert.equal(selected.get('business'), null); assert.equal(selected.get('page'), '3'); assert.equal(selected.get('q'), 'saved'); assert.equal(selected.get('experiment'), null); assert.equal(selected.get('attemptPage'), null);
  assert.equal(new URL(query.consoleResearchHref(selected, { selected: null }), 'https://fixture').searchParams.get('page'), '3');
  assert.equal(new URL(query.consoleResearchHref(selected, { business: other }), 'https://fixture').searchParams.get('page'), null);
  assert.throws(() => query.consoleResearchHref(current, { status: 'active' }));
});

test('0/1/25/26/49/50/51/126 roots per Business have exact 25+sentinel pages and stable tied ordering', async () => {
  for (const size of [0, 1, 25, 26, 49, 50, 51, 126]) {
    const h = fixture(together(seed(size), seed(size + 1, other, 10000)));
    for (const [scope, count] of [[business, size], [other, size + 1], [undefined, size * 2 + 1]]) for (const sort of ['newest', 'oldest']) {
      const seen = [];
      for (let page = 1; page <= Math.max(1, Math.ceil(count / 25)); page++) {
        const result = await api.loadConsoleResearchPage(h.context, { businessId: scope, page, sort });
        assert.equal(result.page.total, count); assert.equal(result.page.complete, true); assert.equal(result.page.items.length, Math.min(25, Math.max(0, count - (page - 1) * 25)));
        assert.equal(result.page.hasNext, page * 25 < count); assert.equal(result.countLabel, 'Raw persisted root records'); assert.equal(result.attempts, null);
        assert.ok(result.page.items.every(row => row.linkage.status === 'unverified')); seen.push(...result.page.items.map(row => row.id));
      }
      assert.equal(seen.length, count); assert.equal(new Set(seen).size, count);
    }
    assert.ok(h.calls.every(call => call.table === 'product_experiments' && call.range && call.range[1] - call.range[0] === 25 && call.orders.length === 2 && call.orders[0][0] === 'created_at' && call.orders[1][0] === 'id'));
    assert.deepEqual(h.forbidden, []);
  }
});

test('Roots retain missing-authority and malformed optional lineage; All records retain legacy/candidate/follow-up/orphan history', async () => {
  const db = seed(130);
  delete db.product_experiments[0].variables.budgetAuthorityRootId;
  db.product_experiments[1].variables.budgetAuthorityRootId = 'malformed authority';
  db.product_experiments[2].variables.ownerKickoff.followUpBasis = { reason: 'Malformed missing rootId' };
  db.product_experiments[3].variables.semanticGoalHash = { malformed: true };
  db.product_experiments[4].discovery_version = 'pod-discovery-1.0'; db.product_experiments[4].variables = {};
  db.product_experiments[5].candidate_id = id(88000); db.product_experiments[5].parent_discovery_id = db.product_experiments[0].id;
  db.product_experiments[6].variables.ownerKickoff.followUpBasis = { rootId: db.product_experiments[0].id };
  db.product_experiments[7].variables.ownerKickoff.followUpBasis = { rootId: id(99999) };
  const h = fixture(db), roots = await api.loadConsoleResearchPage(h.context, { sort: 'oldest' });
  assert.equal(roots.page.total, 126); assert.equal(roots.page.complete, true); assert.ok(roots.page.items.some(row => row.id === db.product_experiments[0].id && row.authority_root_id === null));
  assert.ok(roots.page.items.some(row => row.authority_root_id === 'malformed authority')); assert.ok(roots.page.items.every(row => row.linkage.status === 'unverified'));
  const all = await api.loadConsoleResearchRecordsPage(h.context, { sort: 'oldest' });
  assert.equal(all.page.total, 130); assert.ok(all.page.items.some(row => row.recordKind === 'legacy_record')); assert.ok(all.page.items.some(row => row.recordKind === 'candidate_record')); assert.ok(all.page.items.some(row => row.prior_root_id === id(99999)));
  const recordCall = h.calls.at(-1); assert.deepEqual(recordCall.filters.map(f => f[1]), ['business_id']);
  for (const n of [0, 1, 2, 3, 4, 5, 7]) {
    const result = await api.loadConsoleResearchRecordsPage(fixture(db).context, { selectedId: db.product_experiments[n].id });
    assert.equal(result.selection.status, 'found'); assert.equal(result.selection.item.historicalBinding, 'unverified');
  }
});

test('selected off-page historical root ignores page/search; expired saved intent remains inspectable', async () => {
  const db = together(seed(130), seed(130, other, 10000)), selected = db.product_experiments[0]; selected.variables.intent.objective = 'Not the list search'; selected.variables.policyHash = digest(selected.variables.intent);
  const h = fixture(db), result = await api.loadConsoleResearchPage(h.context, { selectedId: selected.id, page: 2, query: 'geographic', searchField: 'objective' });
  assert.equal(result.page.total, 259); assert.equal(result.selection.status, 'found'); assert.equal(result.selection.item.id, selected.id); assert.equal(result.selection.item.historicalBinding, 'verified'); assert.equal(result.selection.item.originalBinding, 'verified');
  assert.equal(result.selection.item.savedIntent.expiresAt, '2025-01-01T00:00:00Z'); assert.equal(result.selection.item.workIdentity.workflowRunId, selected.workflow_run_id);
  assert.equal(result.attempts.page.total, 1); assert.equal(result.attempts.newest.item.id, selected.id); assert.equal(result.attempts.newestContext.status, 'found');
  const exact = h.calls.filter(call => call.table === 'product_experiments' && call.columns.includes('intent:variables->intent'));
  assert.ok(exact.every(call => call.limit === 2 && !call.range && call.filters.some(f => f[0] === 'eq' && f[1] === 'id' && f[2] === selected.id)));
  assert.ok(!Object.hasOwn(result.selection.item, 'remainingMicrousd')); assert.ok(result.limits.some(limit => limit.includes('R06')));
});

test('explicit objective and hypothesis search use escaped leaf/scalar filters before paging', async () => {
  const db = seed(130); for (const row of db.product_experiments) row.hypothesis = 'Saved 50%_\\legacy';
  let h = fixture(db), result = await api.loadConsoleResearchRecordsPage(h.context, { query: '50%_\\', searchField: 'hypothesis', page: 3 });
  assert.equal(result.page.total, 130); assert.equal(result.page.items.length, 25); assert.deepEqual(h.calls[0].filters.find(f => f[0] === 'ilike'), ['ilike', 'hypothesis', '%50\\%\\_\\\\%']);
  h = fixture(db); result = await api.loadConsoleResearchPage(h.context, { query: 'geographic', searchField: 'objective' });
  assert.equal(result.page.total, 130); assert.equal(h.calls[0].filters.find(f => f[0] === 'ilike')[1], api.CONSOLE_RESEARCH_OBJECTIVE_PATH);
});

test('independent original-root attempts cover 130 records, include original and query newest outside the visible page/filter', async () => {
  const db = together(seed(1), seed(126, other, 10000)), root = db.product_experiments[0]; addAttempts(db, root, 130);
  const h = fixture(db); const seen = [];
  for (let attemptPage = 1; attemptPage <= 6; attemptPage++) {
    const result = await api.loadConsoleResearchPage(h.context, { businessId: business, rootId: root.id, attemptPage, attemptSort: 'oldest', query: 'absent', searchField: 'objective' });
    assert.equal(result.page.total, 0); assert.equal(result.attempts.page.total, 130); assert.equal(result.attempts.page.complete, true); assert.equal(result.attempts.newestPredicateTotal, 130);
    assert.equal(result.attempts.newest.item.id, db.product_experiments.at(-1).id); assert.equal(result.attempts.newestContext.status, 'found');
    assert.match(result.attempts.countLabel, /including the original/); seen.push(...result.attempts.page.items.map(row => row.id));
  }
  assert.equal(seen.length, 130); assert.equal(new Set(seen).size, 130); assert.ok(seen.includes(root.id));
  const newest = h.calls.filter(call => call.table === 'product_experiments' && call.limit === 2 && call.orders.length);
  assert.equal(newest.length, 6); assert.ok(newest.every(call => call.orders.every(order => order[1] === false) && !call.filters.some(f => f[0] === 'ilike') && call.filters.some(f => f[1] === api.CONSOLE_RESEARCH_AUTHORITY_PATH && f[2] === root.id)));
});

test('off-page exact follow-up selection binds only direct authority/predecessor without recursively walking the chain', async () => {
  const db = seed(1), root = db.product_experiments[0]; addAttempts(db, root, 130); const selected = db.product_experiments[80];
  const h = fixture(db), result = await api.loadConsoleResearchRecordsPage(h.context, { selectedId: selected.id, rootId: root.id, attemptPage: 1 });
  assert.equal(result.selection.status, 'found'); assert.equal(result.selection.item.directLinks, 'verified'); assert.equal(result.selection.item.transitiveLineage, 'unverified');
  assert.equal(result.selection.item.authority.item.id, root.id); assert.equal(result.selection.item.predecessor.item.id, db.product_experiments[79].id); assert.equal(result.attempts.page.total, 130);
  const ids = new Set(h.calls.filter(call => call.table === 'product_experiments' && call.columns.includes('intent:variables->intent')).flatMap(call => call.filters.filter(f => f[1] === 'id').map(f => f[2])));
  assert.deepEqual([...ids].sort(), [selected.id, root.id, db.product_experiments[79].id, db.product_experiments.at(-1).id].sort());
  assert.ok(h.calls.length <= 15, `Unexpected query fanout: ${h.calls.length}`);
});

test('malformed matching associated records remain in raw counts; invalid newest never falls back', async () => {
  for (const mutate of [row => { row.variables.semanticGoalHash = 'bad'; }, row => { row.variables.ownerKickoff.followUpBasis = {}; }, row => { row.variables.policyHash = 'bad'; }, row => { row.variables.intent.businessId = other; }]) {
    const db = seed(1), root = db.product_experiments[0]; addAttempts(db, root, 30); mutate(db.product_experiments.at(-1));
    const h = fixture(db), result = await api.loadConsoleResearchPage(h.context, { rootId: root.id, attemptPage: 2 });
    assert.equal(result.attempts.page.total, 30); assert.equal(result.attempts.newest.item.id, db.product_experiments.at(-1).id); assert.equal(result.attempts.newestContext.status, 'unavailable');
    assert.ok(result.errors.some(error => error.includes('no older record')));
    assert.ok(!h.calls.some(call => call.table === 'product_experiments' && call.columns.includes('intent:variables->intent') && call.filters.some(f => f[1] === 'id' && f[2] === db.product_experiments.at(-2).id)));
  }
});

test('wrong Business/root selections, missing records and conflicts cannot become empty or substituted groups', async () => {
  const db = together(seed(2), seed(2, other, 10000)), selectedId = db.product_experiments[0].id;
  await assert.rejects(api.loadConsoleResearchPage(fixture(db).context, { businessId: foreign }), /Business selection/);
  let result = await api.loadConsoleResearchPage(fixture(db).context, { businessId: other, selectedId });
  assert.equal(result.selection.status, 'missing'); assert.equal(result.attempts, null); assert.ok(result.errors.some(error => error.includes('not an empty')));
  result = await api.loadConsoleResearchPage(fixture(db).context, { rootId: id(99999) }); assert.equal(result.root.status, 'missing'); assert.equal(result.attempts, null);
  result = await api.loadConsoleResearchPage(fixture(db).context, { selectedId, rootId: db.product_experiments[1].id });
  assert.equal(result.selection.status, 'found'); assert.equal(result.root.status, 'unavailable'); assert.equal(result.attempts, null); assert.match(result.errors.join(' '), /conflicts/);
  const h = fixture(db); h.context.businessesUnavailable = true; await assert.rejects(api.loadConsoleResearchPage(h.context), /Business records/);
});

test('unknown counts, response caps, failures, duplicates and ignored required predicates fail closed', async () => {
  for (const reader of [api.loadConsoleResearchPage, api.loadConsoleResearchRecordsPage]) {
    for (const count of [null, undefined, -1, NaN, Infinity, 1.5, '130', Number.MAX_SAFE_INTEGER + 1]) {
      const result = await reader(fixture(seed(130), { counts: { product_experiments: count } }).context);
      assert.equal(result.page.complete, false); assert.equal(result.page.total, null);
    }
    for (const opts of [{ cap: { product_experiments: 3 } }, { failTable: 'product_experiments' }, { throwTable: 'product_experiments' }, { duplicate: 'product_experiments' }]) {
      const result = await reader(fixture(seed(130), opts).context); assert.equal(result.page.complete, false); assert.equal(result.page.total, null);
    }
    const scoped = await reader(fixture(together(seed(1), seed(1, other, 10000)), { ignore: ['product_experiments'] }).context, { businessId: business }); assert.equal(scoped.page.items.length, 0); assert.equal(scoped.page.total, null);
    const searched = await reader(fixture(seed(1), { ignore: ['product_experiments'] }).context, { query: 'not present', searchField: 'objective' }); assert.equal(searched.page.items.length, 0);
  }
  for (const [field, mutate] of [['discovery_version', row => { row.discovery_version = 'pod-discovery-1.0'; }], ['candidate_id', row => { row.candidate_id = id(9); }], ['parent_discovery_id', row => { row.parent_discovery_id = id(9); }], [api.CONSOLE_RESEARCH_PRIOR_ROOT_PATH, row => { row.variables.ownerKickoff.followUpBasis = { rootId: id(9) }; }]]) {
    const db = seed(1); mutate(db.product_experiments[0]); const result = await api.loadConsoleResearchPage(fixture(db, { ignoreFilter: (_, key) => key === field }).context); assert.equal(result.page.items.length, 0); assert.equal(result.page.complete, false);
  }
});

test('malformed required fields fail the page while optional lineage stays inspectable', async () => {
  for (const [field, value] of [['id', 'bad'], ['business_id', null], ['status', ''], ['discovery_version', undefined], ['candidate_id', undefined], ['workflow_run_id', 'wrong'], ['created_at', '2026-02-30T00:00:00Z'], ['created_at', '2026-10-02'], ['started_at', undefined], ['completed_at', 0], ['hypothesis', null]]) {
    const db = seed(1), selectedId = db.product_experiments[0].id; db.product_experiments[0][field] = value;
    const result = await api.loadConsoleResearchRecordsPage(fixture(db).context, { selectedId }); assert.equal(result.page.items.length, 0); assert.notEqual(result.selection.status, 'found');
  }
  const db = seed(1); db.product_experiments[0].status = 'future_status'; const result = await api.loadConsoleResearchPage(fixture(db).context, { selectedId: db.product_experiments[0].id }); assert.equal(result.selection.status, 'found'); assert.equal(result.selection.item.status, 'future_status');
});

test('exact record counts/identity reject missing, duplicate, foreign and malformed transport rows', async () => {
  for (const mutate of [result => ({ ...result, count: null }), result => ({ ...result, count: 2 }), result => ({ ...result, data: [result.data[0], result.data[0]], count: 2 }), result => ({ ...result, data: [{ ...result.data[0], id: id(9999) }] }), result => ({ ...result, data: [{ ...result.data[0], business_id: other }] }), result => ({ ...result, data: [null] })]) {
    const db = seed(1), h = fixture(db, { transport: (table, result, call) => table === 'product_experiments' && call.columns.includes('intent:variables->intent') ? mutate(result) : result });
    const result = await api.loadConsoleResearchPage(h.context, { businessId: business, selectedId: db.product_experiments[0].id }); assert.equal(result.selection.status, 'unavailable'); assert.equal(result.attempts, null);
  }
});

test('same-Business workflow, intent input and exact registered definition qualify historical Work links', async () => {
  for (const [collections, lane] of [[0, 'analysis'], [1, 'one'], [2, 'two']]) {
    const db = seed(1), row = db.product_experiments[0]; row.variables.intent.limits.maximumNewCollections = collections; row.variables.policyHash = digest(row.variables.intent); db.workflow_definitions[0].workflow_key = `product.discovery-v2.${lane}`;
    const result = await api.loadConsoleResearchPage(fixture(db).context, { selectedId: row.id }); assert.equal(result.selection.item.historicalBinding, 'verified'); assert.ok(result.selection.item.workIdentity);
  }
  for (const mutate of [db => { db.workflow_runs[0].input.intentId = id(9999); }, db => { db.workflow_runs[0].business_id = other; }, db => { db.workflow_runs[0].status = ''; }, db => { db.workflow_definitions[0].version = '2.0.0'; }, db => { db.workflow_definitions[0].workflow_key = 'product.discovery-v2.spoof'; }, db => { db.workflow_definitions[0].workflow_key = 'product.discovery-v2.two'; }, db => { db.workflow_definitions = []; }]) {
    const db = seed(1); mutate(db); const result = await api.loadConsoleResearchPage(fixture(db).context, { selectedId: db.product_experiments[0].id });
    assert.equal(result.selection.status, 'found'); assert.equal(result.selection.item.historicalBinding, 'unverified'); assert.equal(result.selection.item.workIdentity, null); assert.equal(result.attempts, null);
  }
  for (const table of ['workflow_runs', 'workflow_definitions']) for (const opts of [{ counts: { [table]: null } }, { cap: { [table]: 0 } }, { failTable: table }, { throwTable: table }, { duplicate: table }]) {
    const db = seed(1), result = await api.loadConsoleResearchPage(fixture(db, opts).context, { selectedId: db.product_experiments[0].id }); assert.equal(result.selection.item.workIdentity, null); assert.equal(result.attempts, null);
  }
});

test('authority and predecessor checks are direct and same-Business, without certifying transitive ancestry', async () => {
  for (const mutate of [db => { db.product_experiments[0].business_id = other; }, db => { db.product_experiments[0].variables.budgetAuthorityRootId = id(999); }, db => { db.product_experiments[0].variables.ownerKickoff.followUpBasis = { rootId: id(999) }; }, db => { db.product_experiments[1].variables.semanticGoalHash = 'b'.repeat(64); }, db => { db.product_experiments[2].variables.ownerKickoff.followUpBasis = { rootId: db.product_experiments[2].id }; }]) {
    const db = seed(1), root = db.product_experiments[0]; addAttempts(db, root, 3); mutate(db);
    const result = await api.loadConsoleResearchRecordsPage(fixture(db).context, { selectedId: db.product_experiments[2].id }); assert.equal(result.selection.status, 'found'); assert.equal(result.selection.item.directLinks, 'unverified'); assert.equal(result.selection.item.transitiveLineage, 'unverified');
  }
});

test('attempt/newest transport counts and predicate checks reject caps, omissions and foreign rows', async () => {
  for (const mutate of [result => ({ ...result, count: null }), result => ({ ...result, data: result.data.slice(0, 1) }), result => ({ ...result, data: [] }), result => ({ ...result, data: result.data.map(row => ({ ...row, authority_root_id: id(9999) })) }), result => ({ ...result, data: result.data.map(row => ({ ...row, business_id: other })) }), result => ({ ...result, data: [null], count: 1 })]) {
    const db = seed(1), root = db.product_experiments[0]; addAttempts(db, root, 30);
    const h = fixture(db, { transport: (table, result, call) => table === 'product_experiments' && call.orders.length && call.limit === 2 ? mutate(result) : result });
    const result = await api.loadConsoleResearchPage(h.context, { rootId: root.id }); assert.equal(result.attempts.newest.status, 'unavailable'); assert.equal(result.attempts.newestPredicateTotal, null);
  }
});

test('attempt page count failures and an impossible empty self-associated group remain unknown', async () => {
  for (const mutate of [result => ({ ...result, count: null }), result => ({ ...result, data: result.data.slice(0, 4) }), () => ({ data: [], count: 0, error: null }), result => ({ ...result, data: result.data.map(row => ({ ...row, candidate_id: id(7777) })) })]) {
    const db = seed(1), root = db.product_experiments[0]; addAttempts(db, root, 30);
    const h = fixture(db, { transport: (table, result, call) => table === 'product_experiments' && call.range && call.filters.some(f => f[1] === api.CONSOLE_RESEARCH_AUTHORITY_PATH) ? mutate(result) : result });
    const result = await api.loadConsoleResearchPage(h.context, { rootId: root.id });
    assert.equal(result.attempts.page.complete, false); assert.equal(result.attempts.page.total, null); assert.equal(result.attempts.newestPredicateTotal, 30);
  }
});

test('newest required-field failures and ignored association predicates cannot substitute older valid rows', async () => {
  const db = together(seed(1), seed(1, other, 10000)), root = db.product_experiments[0]; addAttempts(db, root, 3);
  for (const field of ['status', 'id', 'created_at']) {
    const h = fixture(db, { transport: (table, result, call) => table === 'product_experiments' && call.orders.length && call.limit === 2 ? { ...result, data: [{ ...result.data[0], [field]: 'invalid' }, ...result.data.slice(1)] } : result });
    const result = await api.loadConsoleResearchPage(h.context, { rootId: root.id });
    // An unknown future status is valid metadata; malformed identity/timestamp is not.
    assert.equal(result.attempts.newest.status, field === 'status' ? 'found' : 'unavailable');
    assert.equal(result.attempts.newestContext.status, 'unavailable');
  }
  const h = fixture(db, { ignoreFilter: (_, key, call) => call.orders.length && call.limit === 2 && [api.CONSOLE_RESEARCH_AUTHORITY_PATH, 'business_id'].includes(key) });
  const result = await api.loadConsoleResearchPage(h.context, { rootId: root.id });
  assert.equal(result.attempts.newest.status, 'unavailable'); assert.equal(result.attempts.newestPredicateTotal, null);
  assert.equal(result.attempts.page.complete, false); assert.match(result.errors.join(' '), /counts disagree/);
});

test('sub-millisecond ordering does not manufacture UUID ties and wrong order is rejected', async () => {
  const db = seed(2); db.product_experiments[0].created_at = '2024-01-01T00:00:00.000002Z'; db.product_experiments[1].created_at = '2024-01-01T00:00:00.000001Z';
  const result = await api.loadConsoleResearchPage(fixture(db).context); assert.equal(result.page.complete, true); assert.equal(result.page.items[0].id, db.product_experiments[0].id);
  const reversed = await api.loadConsoleResearchPage(fixture(db, { reverse: ['product_experiments'] }).context); assert.equal(reversed.page.complete, false); assert.equal(reversed.page.items.length, 0);
});

test('list projections omit all whole JSON; exact saved intent alone is bounded after transfer and never quotes', async () => {
  const db = seed(130), huge = 'x'.repeat(250000); db.product_experiments[0].variables.extra = huge; db.product_experiments[0].evidence_pack = { huge }; db.product_experiments[0].measurement_plan = { huge }; db.product_experiments[0].variables.budgetQuote = { huge };
  const h = fixture(db), result = await api.loadConsoleResearchPage(h.context, { selectedId: db.product_experiments[0].id });
  assert.equal(result.selection.item.historicalBinding, 'verified');
  for (const call of h.calls) {
    assert.ok(!call.columns.split(',').some(field => ['variables', 'evidence_pack', 'measurement_plan', 'input', 'state', 'content', 'metadata', 'receipt', 'pack_snapshot'].includes(field)));
    assert.ok(!/budgetQuote|budget_quote/.test(call.columns));
    if (call.columns.includes('intent:variables->intent')) assert.ok(call.filters.some(f => f[0] === 'eq' && f[1] === 'id'));
    if (call.range) assert.ok(call.result.data.every(row => !Object.hasOwn(row, 'intent') && !Object.hasOwn(row, 'follow_up_basis')));
  }
  db.product_experiments[0].variables.intent.objective = huge; db.product_experiments[0].variables.policyHash = digest(db.product_experiments[0].variables.intent);
  const oversized = await api.loadConsoleResearchPage(fixture(db).context, { selectedId: db.product_experiments[0].id }); assert.equal(oversized.selection.status, 'found'); assert.equal(oversized.selection.item.savedIntent, null); assert.equal(oversized.selection.item.historicalBinding, 'unverified');
});

test('unexpected heavy transport payloads and conflicting selected metadata never qualify links/groups', async () => {
  const db = seed(1), selectedId = db.product_experiments[0].id;
  let h = fixture(db, { transport: (table, result, call) => table === 'product_experiments' && call.range ? { ...result, data: result.data.map(row => ({ ...row, variables: { huge: 'unexpected' } })) } : result });
  let result = await api.loadConsoleResearchPage(h.context); assert.equal(result.page.items.length, 0);
  h = fixture(db, { transport: (table, result, call) => table === 'product_experiments' && call.range ? { ...result, data: result.data.map(row => ({ ...row, hypothesis: 'conflicting saved value' })) } : result });
  result = await api.loadConsoleResearchPage(h.context, { selectedId }); assert.equal(result.selection.status, 'unavailable'); assert.equal(result.attempts, null);
});

test('actual transitive runtime dependencies deny networking, credentials, mutations, RPC, signing and providers', async () => {
  const db = seed(1); addAttempts(db, db.product_experiments[0], 30); const h = fixture(db);
  await api.loadConsoleResearchPage(h.context, { rootId: db.product_experiments[0].id }); await api.loadConsoleResearchRecordsPage(h.context, { selectedId: db.product_experiments[20].id });
  assert.deepEqual(h.forbidden, []);
  const source = readFileSync('src/lib/core-ui/console-research-data.ts', 'utf8');
  assert.ok(!/\.rpc\(|\.auth\.|service_role|process\.env|fetch\(|\.insert\(|\.upload\(|\.delete\(|\.schema\(|\.storage\.|validateDiscoveryIntentV2|loadDiscoveryChainBalance|quoteDiscovery/.test(source));
  assert.equal((source.match(/\.update\(/g) ?? []).length, 1); assert.ok(source.includes('createHash("sha256").update('));
  assert.ok(!h.calls.some(call => /cost|reservation|settlement|artifact|candidate|decision/.test(call.table)));
  assert.ok(h.calls.every(call => call.range ? call.range[1] - call.range[0] === 25 : call.limit === 2));
});
