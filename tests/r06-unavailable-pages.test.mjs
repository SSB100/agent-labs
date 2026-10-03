import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url), ts = require('typescript');
const selected = '96060000-0000-4000-8000-000000000001';
const other = '96060000-0000-4000-8000-000000000002';
const owner = '96060000-0000-4000-8000-000000000090';

/** Actual route functions with an already authenticated, explicitly unavailable
 * directory. Every stateful read/action is denied; only inert view containers and
 * the existing synthetic Printful preview are available to render the route. */
function fixture(route, businessesUnavailable) {
  const reads = [], actions = [], shellScopes = [], views = [], auth = [];
  const context = {
    userId: owner, businessesUnavailable, ownerDirectoryPaged: true,
    businesses: [{ id: other, name: 'Unrelated cached Business' }],
    supabase: {
      from: (...args) => { reads.push(['from', ...args]); throw Error('Unexpected database read during unavailable route'); },
      rpc: (...args) => { reads.push(['rpc', ...args]); throw Error('Unexpected RPC during unavailable route'); },
    },
  };
  const denyRead = name => (...args) => { reads.push([name, ...args]); throw Error(`Unexpected ${name} read during unavailable route`); };
  const denyAction = name => () => { actions.push(name); throw Error(`Unexpected ${name} action during unavailable route`); };
  const denyView = name => () => { views.push(name); throw Error(`Unexpected scoped ${name} workspace during unavailable route`); };
  const dependencies = {
    'react/jsx-runtime': require('react/jsx-runtime'),
    'next/navigation': { notFound() { const error = Error('Exact Business selection not found'); error.code = 'FIXTURE_NOT_FOUND'; throw error; } },
    'next/link': ({ href, children }) => React.createElement('a', { href }, children),
    '@/lib/core-ui/data': { requireOwnerUiContext: async () => { auth.push('owner'); return context; } },
    '@/components/stage7/app-shell': {
      AppShell: ({ children, navigationBusinessId }) => { shellScopes.push(navigationBusinessId); return React.createElement('main', null, children); },
      PageHeader: ({ title, description, actions }) => React.createElement('header', null, React.createElement('h1', null, title), React.createElement('p', null, description), actions),
      StatusPill: ({ status }) => React.createElement('span', { 'data-status': status }, status),
    },
    '@/components/console/console-retained-workspace': {
      ConsoleRetainedWorkspace: ({ header, notice, panels }) => { views.push('retained'); return React.createElement('div', null, header, notice, panels.map(panel => React.createElement('section', { key: panel.id }, panel.content))); },
      ConsoleRecentRows: denyView('pack rows'),
    },
    '@/components/console/history-pager': { HistoryPager: ({ page }) => { assert.equal(page, undefined); return null; } },
    '@/lib/core-ui/history-read': Object.fromEntries(['readState', 'readHistory', 'historyRows', 'safeTablePage'].map(name => [name, denyRead(name)])),
    '@/lib/core-ui/console-retained-feedback': { retainedFeedbackMessage: denyView('pack feedback') },
    '@/accounts/server': { loadAccountWorkspace: denyRead('account workspace') },
    '@/etsy/server': { etsyConfigured: denyRead('Etsy configuration'), eligibleEtsyPackages: denyRead('Etsy packages') },
    '@/listing/server': { loadListingWorkspace: denyRead('listing workspace') },
    '@/etsy-publication/server': { loadPublicationWorkspace: denyRead('publication workspace') },
    '@/printful/server': { loadPrintfulProductWorkspace: denyRead('Printful products') },
    '@/printful/contracts': require('../.core-tests/printful/contracts.js'),
    './listing-workspace': { ListingWorkspace: denyView('listing') },
    './publication-workspace': { PublicationWorkspace: denyView('publication') },
    './product-workspace': { ProductConfigurationWorkspace: denyView('Printful products'), ProductActionFeedback: () => null },
    './preview': require('../.core-tests/app/dashboard/printful/preview.js'),
    './workspace': route === 'etsy' ? { EtsyWorkspace: denyView('Etsy') } : {
      CatalogConfigurationPreview: () => React.createElement('p', null, 'Static synthetic catalog'),
      PricingCalculator: () => React.createElement('p', null, 'Static pricing documentation'),
    },
    './actions': Object.fromEntries(['activatePack', 'launchInstalledPack', 'qualifyWebResearch', 'runEtsyDiscoverySimulation'].map(name => [name, denyAction(name)])),
    [`./${route}.css`]: {},
  };
  const file = `src/app/dashboard/${route}/page.tsx`;
  const output = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const loaded = { exports: {} };
  runInNewContext(`(function(require,module,exports){${output}\n})`, { URL, URLSearchParams, Date, crypto: { randomUUID: denyAction('random execution identity') } })(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected route dependency ${name}`); return dependencies[name];
  }, loaded, loaded.exports);
  return {
    context, reads, actions, shellScopes, views, auth,
    async render(business) { return renderToStaticMarkup(await loaded.exports.default({ searchParams: Promise.resolve({ business }) })); },
  };
}

for (const route of ['etsy', 'printful', 'packs']) {
  test(`${route} actual page renders unavailable for exact off-directory selection without substituting a cached Business`, async () => {
    const f = fixture(route, true), html = await f.render(selected);
    assert.match(html, /role="alert">Business records are unavailable\. No alternate Business was selected/);
    assert.deepEqual(f.auth, ['owner']); assert.deepEqual(f.shellScopes, [undefined]);
    assert.deepEqual(f.reads, []); assert.deepEqual(f.actions, []);
    assert.deepEqual(f.context.businesses.map(row => row.id), [other]);
    assert.doesNotMatch(html, /Unrelated cached Business|96060000-0000-4000-8000-000000000002/);
    if (route === 'etsy') {
      assert.match(html, /Draft preparation is unavailable until this exact selection can be checked/);
      assert.doesNotMatch(html, /Create a Business to prepare Etsy drafts/);
    } else if (route === 'printful') {
      assert.match(html, /Unable to check/); assert.match(html, /data-status="unavailable"/);
      assert.doesNotMatch(html, />Not connected</); assert.match(html, /Synthetic preview/);
    } else {
      assert.match(html, /installation and execution are unavailable/);
      assert.deepEqual(f.views, []); assert.doesNotMatch(html, /<form|<button|Pack catalog|Activate a qualified release/);
    }
  });

  test(`${route} actual page rejects malformed selections even while Business records are unavailable`, async () => {
    for (const business of ['not-a-uuid', [selected], selected + '&business=' + other]) {
      const f = fixture(route, true);
      await assert.rejects(f.render(business), error => error.code === 'FIXTURE_NOT_FOUND');
      assert.deepEqual(f.reads, []); assert.deepEqual(f.actions, []); assert.deepEqual(f.shellScopes, []);
    }
  });

  test(`${route} actual page rejects a definitively missing Business when directory lookup is available`, async () => {
    const f = fixture(route, false);
    await assert.rejects(f.render(selected), error => error.code === 'FIXTURE_NOT_FOUND');
    assert.deepEqual(f.reads, []); assert.deepEqual(f.actions, []); assert.deepEqual(f.shellScopes, []);
    assert.deepEqual(f.context.businesses.map(row => row.id), [other]);
  });
}
