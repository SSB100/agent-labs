import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url), ts = require('typescript'), React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const businessId = '10000000-1111-4111-8111-111111111111';
const sourceId = '20000000-1111-4111-8111-111111111111';
const runId = '30000000-1111-4111-8111-111111111111';
const foreignBusiness = '40000000-1111-4111-8111-111111111111';
const sourceHash = 'a'.repeat(64), assetSha256 = 'b'.repeat(64);
const actionNames = ['configureReviewedPrintfulProduct', 'reconcilePrintfulProduct', 'stopPrintfulProduct'];
const noop = async () => {};
function load(path, dependencies, globals = {}) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const m = { exports: {} };
  runInNewContext(`(function(require,module,exports){${code}\n})`, globals)(name => { assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; }, m, m.exports);
  return m.exports;
}
const { ProductConfigurationWorkspace, ProductActionFeedback } = load('src/app/dashboard/printful/product-workspace.tsx', {
  'react/jsx-runtime': require('react/jsx-runtime'),
  './product-actions': Object.fromEntries(actionNames.map(name => [name, noop])),
});
const source = { id: sourceId, name: 'Exact approved tee', sourceHash, storeId: 123, catalogProductId: 71, catalogVariantId: 4012,
  placement: 'front', designWidthIn: 10, designHeightIn: 12, retailPrice: '35.00', currency: 'NZD', assetSha256, expiresAt: '2027-10-01T12:00:00Z' };
const base = { businessId, configured: true, unavailable: false, executionAvailable: false, reasons: ['product_write_authority_unavailable', 'product_uploaded_asset_producer_required', 'product_placement_producer_required'], sources: [], runs: [] };
const attempt = { id: runId, name: 'Exact approved tee', status: 'needs_owner', reason: null, stopRequested: false, dispatchSent: false, receiptRecorded: false, syncProductId: null, syncVariantId: null };
const render = data => renderToStaticMarkup(React.createElement(ProductConfigurationWorkspace, { data }));
const plain = value => JSON.parse(JSON.stringify(value));
function actionHarness(overrides = {}) {
  const calls = [], logs = [], invalidated = [], events = [];
  const context = { businesses: [{ id: businessId }] };
  const api = Object.fromEntries(['beginPrintfulProduct', 'runPrintfulProduct', 'productRpc'].map(name => [name, async (...args) => {
    events.push(name); calls.push({ name, args });
    return overrides[name] ? overrides[name](...args) : name === 'beginPrintfulProduct' ? { runId } : { status: 'needs_owner', receiptRecorded: true };
  }]));
  const result = load('src/app/dashboard/printful/product-actions.ts', {
    'next/navigation': { redirect: url => { const error = new Error(url); error.redirect = url; throw error; } },
    'next/cache': { revalidatePath: path => invalidated.push(path) },
    '@/lib/core-ui/data': { requireOwnerUiContext: async () => { events.push('auth'); if (overrides.auth) return overrides.auth(); return context; } },
    '@/printful/server': api,
  }, { console: { log: (...args) => logs.push(args), error: (...args) => logs.push(args), warn: (...args) => logs.push(args) } });
  return { ...result, calls, logs, invalidated, events, context };
}
function form(extra = {}) {
  const result = new FormData();
  for (const [key, value] of Object.entries({ businessId, sourceId, sourceHash, runId, configurationConsent: 'on', ...extra })) result.set(key, value);
  return result;
}
async function redirectFrom(promise) {
  try { await promise; assert.fail('Expected redirect'); } catch (error) { assert.ok(error.redirect, `Expected controlled redirect, received ${error.message}`); return error.redirect; }
}

test('owner product workspace states the bounded path and absent authority and producers honestly', () => {
  const html = render(base);
  for (const text of ['one catalog variant', 'front or back DTG', 'Manual/API store', 'current reviewed TEST', 'exact production-asset approval', 'catalog.read',
    'cannot confer product-write permission', 'authenticated uploaded-file binding producer', 'physical-placement evidence producer', 'Native GET',
    'product/file association evidence only', 'listing-ready mockup', 'Execution remains unavailable', 'No authenticated, current product source']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /name="(?:credential|password|token|source|sourceJson|fileId|printfulFileId|placementEvidence)"/);
});

test('native-only execution and separate unverified supplier prerequisites are explicit without claiming a provider check', () => {
  for (const data of [base, { ...base, unavailable: true }, { ...base, sources: [source], runs: [{ ...attempt, receiptRecorded: true }] }]) {
    const html = render(data);
    for (const text of ['durable configuration path is native-product only', 'Ecommerce-linked variant mapping is not implemented',
      'Changing the connection or selecting a different store type does not unlock execution', 'Supplier variant link · Unverified.',
      'Supplier manual confirmation · Unverified.', 'does not verify the exact Etsy variant-to-Printful product link',
      'does not verify whether Printful requires manual order confirmation', 'Do not assume incoming orders will wait for approval',
      'missing application checks, not a read of your provider settings', 'No automatic order sync or fulfilment path is implemented',
      'later Stage 22 work', 'physical-placement evidence producer', 'Execution remains unavailable']) assert.ok(html.includes(text), text);
    assert.doesNotMatch(html, /name="(?:supplierVariantLink|manualConfirmation|supplierReady|storeKind)"/);
  }
});

test('exact source review shows hash-bound immutable details and disables start and consent', () => {
  const html = render({ ...base, sources: [source] });
  for (const text of [source.name, sourceHash, assetSha256, '123', '71 / 4012', 'front / DTG', '10 × 12 in', '35.00 NZD', source.expiresAt]) assert.ok(html.includes(text), text);
  assert.match(html, /<input(?=[^>]*name="sourceId")(?=[^>]*value="20000000-1111-4111-8111-111111111111")/);
  assert.match(html, /<input(?=[^>]*name="sourceHash")(?=[^>]*value="a{64}")/);
  assert.match(html, /<input(?=[^>]*name="configurationConsent")(?=[^>]*required="")(?=[^>]*disabled="")/);
  assert.match(html, /<button(?=[^>]*disabled="")[^>]*>Approve exact configuration and start/);
  assert.doesNotMatch(html, /<input(?=[^>]*name="(?:name|storeId|catalogVariantId|retailPrice|designWidthIn|designHeightIn|assetSha256)")/);
});

test('unavailable state does not pretend there is no history or source', () => {
  const html = render({ ...base, unavailable: true, runs: [attempt], sources: [source] });
  assert.match(html, /role="alert"/); assert.match(html, /Existing attempts may still exist/);
  assert.doesNotMatch(html, /No product configuration attempts|No authenticated, current product source/);
  assert.match(html, /<button(?=[^>]*disabled="")[^>]*>Stop further work/);
});

test('history only offers reconciliation for an existing dispatch marker and never a second start', () => {
  const unsent = render({ ...base, runs: [attempt] });
  assert.doesNotMatch(unsent, /Check existing product|Approve exact configuration and start/);
  assert.match(unsent, /No POST recorded/);
  const sent = render({ ...base, runs: [{ ...attempt, dispatchSent: true, syncProductId: 501, syncVariantId: 601 }] });
  for (const text of ['Present · reconciliation only', 'Check existing product', 'Never creates again', 'Stop cannot undo a POST already sent', '501', '601']) assert.ok(sent.includes(text), text);
  assert.doesNotMatch(sent, /Approve exact configuration and start/);
});

test('a partial receipt stays needs_owner, including after Stop; it cannot render success', () => {
  const html = render({ ...base, runs: [{ ...attempt, status: 'verified', dispatchSent: true, receiptRecorded: true, stopRequested: true, reason: 'product_placement_not_observable' }] });
  for (const text of ['Needs owner review · partial association receipt', 'Partial observation · needs_owner', 'The run remains needs_owner', 'not configuration success', 'Check existing product']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /Stop further work|>verified<|configuration complete|Product configured successfully/);
});

test('Stop stays available without a server execution key and remains independent from execution availability', () => {
  const html = render({ ...base, configured: false, runs: [{ ...attempt, dispatchSent: true }] });
  assert.match(html, /Owner history and Stop remain available independently/);
  assert.match(html, /<button class="coreButton">Stop further work/);
  assert.match(html, /<button(?=[^>]*disabled="")[^>]*>Check existing product/);
  const stopped = render({ ...base, runs: [{ ...attempt, status: 'cancelled', stopRequested: true }] });
  assert.match(stopped, /Stopped before dispatch/); assert.doesNotMatch(stopped, /Stop further work|Check existing product/);
});

test('query feedback and reason text are allowlisted, including prototype keys and arbitrary provider errors', () => {
  const renderFeedback = message => renderToStaticMarkup(React.createElement(ProductActionFeedback, { message }));
  for (const message of ['<script>secret</script>', 'constructor', 'toString', '__proto__', ['product-blocked'], undefined]) assert.equal(renderFeedback(message), '');
  assert.match(renderFeedback('product-needs-review'), /needs owner review/);
  assert.match(renderFeedback('product-stop-requested'), /Stop cannot undo a POST/);
  const html = render({ ...base, reasons: ['private response secret', 'constructor'], runs: [{ ...attempt, reason: 'token-unique-secret', status: 'succeeded' }] });
  assert.doesNotMatch(html, /private response secret|constructor|token-unique-secret|succeeded/);
  assert.match(html, /current prerequisite or exact provider outcome/);
});

test('every action authenticates before parsing form data or invoking any server operation', async () => {
  for (const name of actionNames) {
    const h = actionHarness({ auth: () => { throw new Error('owner_required'); } });
    const hostileForm = { getAll: () => { throw new Error('parsed_before_auth'); } };
    await assert.rejects(h[name](hostileForm), /owner_required/);
    assert.deepEqual(h.calls, []); assert.deepEqual(h.events, ['auth']);
  }
});

test('start requires explicit consent and a same-owner Business, source UUID and exact hash', async () => {
  for (const extra of [{ configurationConsent: '' }, { configurationConsent: 'true' }, { businessId: foreignBusiness }, { businessId: 'bad' }, { sourceId: 'bad' }, { sourceHash: 'bad' }]) {
    const h = actionHarness();
    assert.match(await redirectFrom(h.configureReviewedPrintfulProduct(form(extra))), /productMessage=product-(?:blocked|consent-required)/);
    assert.deepEqual(h.calls, []);
  }
  for (const key of ['businessId', 'sourceId', 'sourceHash', 'configurationConsent']) {
    const h = actionHarness(), duplicate = form(); duplicate.append(key, duplicate.get(key));
    await redirectFrom(h.configureReviewedPrintfulProduct(duplicate)); assert.deepEqual(h.calls, []);
    const file = form(); file.set(key, new Blob(['untrusted']), 'source.json');
    await redirectFrom(h.configureReviewedPrintfulProduct(file)); assert.deepEqual(h.calls, []);
  }
});

test('start only forwards exact references and consent, then uses the server-issued run ID', async () => {
  const h = actionHarness();
  const url = await redirectFrom(h.configureReviewedPrintfulProduct(form({ source: '{"evidenceMode":"live"}', storeId: '999', writeAuthority: 'true', printfulFileId: '999', runId: foreignBusiness })));
  assert.deepEqual(h.events, ['auth', 'beginPrintfulProduct', 'runPrintfulProduct']);
  assert.deepEqual(h.calls[0].args.slice(1), [businessId, sourceId, sourceHash, true]);
  assert.deepEqual(h.calls[1].args.slice(1), [businessId, runId]);
  assert.match(url, /productMessage=product-needs-review/); assert.doesNotMatch(url, /success|verified|999|evidenceMode/);
  assert.deepEqual(h.invalidated, ['/dashboard/printful', '/dashboard/needs-you']);
});

test('invalid server run references do not dispatch', async () => {
  for (const runId of [null, 'bad', { sourceId }]) {
    const h = actionHarness({ beginPrintfulProduct: () => ({ runId }) });
    assert.match(await redirectFrom(h.configureReviewedPrintfulProduct(form())), /product-blocked/);
    assert.equal(h.calls.length, 1);
  }
});

test('failed preparation never starts; raw provider errors are neither reflected nor logged', async () => {
  for (const name of ['beginPrintfulProduct', 'runPrintfulProduct', 'productRpc']) {
    const h = actionHarness({ [name]: () => { throw new Error('unique-secret-token private-provider-body'); } });
    const action = name === 'productRpc' ? h.stopPrintfulProduct : h.configureReviewedPrintfulProduct;
    const url = await redirectFrom(action(form()));
    assert.doesNotMatch(url, /unique-secret|private-provider-body/); assert.deepEqual(h.logs, []);
    if (name === 'beginPrintfulProduct') assert.equal(h.calls.length, 1);
  }
});

test('reconciliation is a fixed read-only path; Stop is a fixed keyless cancel payload', async () => {
  const h = actionHarness();
  const reconcileUrl = await redirectFrom(h.reconcilePrintfulProduct(form({ operation: 'create', reconcileOnly: 'false' })));
  assert.deepEqual(h.calls[0].args.slice(1), [businessId, runId, true]); assert.match(reconcileUrl, /product-needs-review/);
  const stopUrl = await redirectFrom(h.stopPrintfulProduct(form({ operation: 'approve', serverKey: 'secret', source: '{}' })));
  assert.deepEqual(plain(h.calls[1].args.slice(1)), [businessId, 'cancel', { runId }]); assert.match(stopUrl, /product-stop-requested/);
  assert.equal(h.calls.filter(call => call.name === 'beginPrintfulProduct').length, 0);
  for (const name of ['reconcilePrintfulProduct', 'stopPrintfulProduct']) {
    const denied = actionHarness();
    await redirectFrom(denied[name](form({ businessId: foreignBusiness }))); await redirectFrom(denied[name](form({ runId: 'bad' })));
    assert.deepEqual(denied.calls, []);
  }
});

test('page loads owner-scoped durable controls without replacing synthetic catalog or pricing', () => {
  const page = readFileSync('src/app/dashboard/printful/page.tsx', 'utf8');
  const actions = readFileSync('src/app/dashboard/printful/product-actions.ts', 'utf8');
  assert.match(page, /await requireOwnerUiContext\(\)/);
  assert.match(page, /await loadPrintfulProductWorkspace\(context, business.id, interventionId\)/);
  assert.match(page, /<ProductActionFeedback message=\{query.productMessage\}/);
  assert.match(page, /<ProductConfigurationWorkspace data=\{productWorkspace\}/);
  assert.match(page, /<CatalogConfigurationPreview fixture=\{fixture\}/); assert.match(page, /<PricingCalculator \/>/);
  assert.doesNotMatch(actions, /JSON\.parse|Object\.fromEntries|fetch\(|process\.env|\.rpc\(|\.insert\(|\.update\(|\.delete\(/);
  assert.doesNotMatch(actions, /form\.(?:get|getAll)\("(?:source|sourceJson|credential|password|token|serverKey|writeAuthority|printfulFileId)"\)/);
});

const interventionId = '50000000-1111-4111-8111-111111111111';
const intervention = { id: interventionId, business_id: businessId, workflow_run_id: null, intervention_type: 'printful.product.reconcile', status: 'open',
  title: 'Review existing Printful product', description: 'The create outcome needs read-only reconciliation.', requested_at: '2026-10-01T12:00:00Z' };
const link = ({ href, children, ...props }) => React.createElement('a', { href, ...props }, children);
const wrapper = ({ children, title }) => React.createElement('section', {}, title, children);
const workflowHelpers = { ...require('../.core-tests/lib/core-ui/workflows.js'), formatDateTime: value => value, formatRelativeTime: () => 'Just now', humanize: value => value };
const { NeedsYouCard } = load('src/components/stage7/workflow-visuals.tsx', {
  'react/jsx-runtime': require('react/jsx-runtime'), 'next/link': link,
  '@/app/dashboard/actions': { resumeSyntheticReview: noop }, '@/app/dashboard/packs/actions': { acknowledgeEtsySimulation: noop },
  '@/app/dashboard/browser-actions': { resumeBrowserControl: noop }, '@/lib/core-ui/workflows': workflowHelpers,
  './icons': { CoreIcon: () => null }, './app-shell': { StatusPill: () => null },
});

test('Printful Needs You card links the exact Business and intervention without synthetic completion actions', () => {
  const html = renderToStaticMarkup(React.createElement(NeedsYouCard, { intervention, returnTo: '/dashboard/needs-you', businessName: 'Owner Business' }));
  assert.match(html, /Printful product verification/);
  assert.ok(html.includes(`/dashboard/printful?business=${businessId}&amp;intervention=${interventionId}#product-configuration-history`));
  assert.match(html, /Review existing product/); assert.match(html, /Partial product\/file association receipts still need owner review/);
  assert.match(html, /do not establish physical placement, complete qualification or a listing-ready mockup/);
  assert.doesNotMatch(html, /Approve and complete|Fail workflow|<form|name="decision"/);
  assert.match(render({ ...base, runs: [{ ...attempt, dispatchSent: true }] }), /id="product-configuration-history"/);
});

async function needsYouPage({ printful = { records: [], unavailable: false }, existing = [], publication = { records: [], unavailable: false }, accountSetup = { records: [], unavailable: false } } = {}) {
  const { rendered, fixtureTables, time } = await import('./helpers/console-decisions.mjs');
  const tables = fixtureTables({ count: 0 });
  tables.owner_interventions = [...new Map([...printful.records, ...existing, ...publication.records].map(row => [row.id, { action_intent_id: null, description: '', options: {}, resolution: {}, requested_at: time, resolved_at: null, created_at: time, updated_at: time, ...row }])).values()];
  const result = await rendered('/dashboard?view=decisions', { tables, businesses: [{ id: businessId, name: 'Owner Business' }], counts: printful.unavailable || publication.unavailable ? { owner_interventions: null } : undefined,
    props: { connectionRequests: { count: accountSetup.unavailable ? null : accountSetup.records.length, ...accountSetup } } });
  return result.html.replaceAll('<!-- -->', '');
}
test('compact Decisions includes workflow-null Printful requests once and keeps them inspect-only', async () => {
  const html = await needsYouPage({ printful: { records: [intervention], unavailable: false }, existing: [intervention] });
  assert.match(html, /1 open notice/); assert.equal((html.match(/class="compactDecisionRow"/g) ?? []).length, 1);
  assert.ok(html.includes(`decision=${interventionId}`));
  assert.doesNotMatch(html, /Nothing needs your attention|Approve and complete|Fail workflow/);
});
test('compact Decisions retains known rows while authoritative queue completeness is unknown', async () => {
  const empty = await needsYouPage({ printful: { records: [], unavailable: true } });
  assert.match(empty, /Decision page completeness could not be checked/); assert.match(empty, /Count unavailable/);
  assert.doesNotMatch(empty, /No matching notices are recorded|Nothing needs your attention|No intervention required/);
  const partial = await needsYouPage({ printful: { records: [intervention], unavailable: true } });
  assert.match(partial, /Count unavailable/); assert.ok(partial.includes(`decision=${interventionId}`));
});
test('compact queue preserves account setup and separate Etsy/Printful request identities', async () => {
  const html = await needsYouPage({ printful: { records: [intervention], unavailable: false },
    publication: { records: [{ ...intervention, id: sourceId, intervention_type: 'etsy.publication.reconcile', title: 'Review existing listing' }], unavailable: false },
    accountSetup: { records: [{ runId, businessId, provider: 'printful', status: 'owner_handoff' }], unavailable: false } });
  assert.match(html, /2 open notices/); assert.ok(html.includes(`decision=${interventionId}`)); assert.ok(html.includes(`decision=${sourceId}`));
  assert.ok(html.includes(`/dashboard?view=connections&amp;business=${businessId}&amp;connectionRun=${runId}`));
});

async function printfulPage(query, businesses = [{ id: businessId, name: 'Owner Business' }, { id: foreignBusiness, name: 'Second Business' }]) {
  const calls = [], context = { businesses };
  const { default: Page } = load('src/app/dashboard/printful/page.tsx', {
    'react/jsx-runtime': require('react/jsx-runtime'), 'next/link': link,
    '@/accounts/server': { loadAccountWorkspace: async () => ({ accounts: [], unavailable: false }) },
    '@/components/stage7/app-shell': { AppShell: wrapper, PageHeader: wrapper, StatusPill: () => null },
    '@/lib/core-ui/data': { requireOwnerUiContext: async () => context },
    '@/printful/contracts': { PRINTFUL_DOCS: { catalog: 'https://developers.printful.com/docs', products: 'https://developers.printful.com/docs', ecommerceSync: 'https://developers.printful.com/docs' } },
    '@/printful/server': { loadPrintfulProductWorkspace: async (...args) => { calls.push(args); return { ...base, businessId: args[1] }; } },
    './product-workspace': { ProductActionFeedback, ProductConfigurationWorkspace },
    './preview': { buildSyntheticPrintfulPreview: () => ({}) }, './workspace': { CatalogConfigurationPreview: () => null, PricingCalculator: () => null }, './printful.css': {},
  });
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(query) }));
  return { html, calls, context };
}

test('Printful deep links pass only a UUID intervention alongside the selected owned Business', async () => {
  const valid = await printfulPage({ business: foreignBusiness, intervention: interventionId });
  assert.deepEqual(valid.calls[0], [valid.context, foreignBusiness, interventionId]);
  assert.match(valid.html, /id="product-configuration-history"/);
  for (const value of [undefined, '', 'not-a-uuid', ['50000000-1111-4111-8111-111111111111'], '{"source":1}', '50000000-1111-4111-8111-111111111111&business=foreign']) {
    const invalid = await printfulPage({ business: businessId, intervention: value });
    assert.deepEqual(invalid.calls[0], [invalid.context, businessId, undefined]);
  }
  const noBusiness = await printfulPage({ business: businessId, intervention: interventionId }, []);
  assert.equal(noBusiness.calls.length, 0);
});
