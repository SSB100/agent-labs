import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import { loadSource } from './helpers/guided-ui.mjs';
import { creativeCostTruthFixture } from './helpers/creative-cost-truth-fixtures.mjs';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const costs = loadSource('src/creative/cost-display.ts');
const { CreativeLibrary, CreativeRunCostSummary, creativeRunHistoryId } = loadSource('src/components/guided/creative-library.tsx', {
  '@/creative/cost-display': costs,
  './creative-library.css': {},
});
const now = Date.parse('2026-10-02T04:00:00.000Z');
const businesses = [{ id: 'business-1', name: 'Original Design Studio' }];
const hash = 'a'.repeat(64), briefHash = 'b'.repeat(64);
const approval = {
  id: 'approval-1', business_id: 'business-1', candidate_id: 'candidate-1', purpose: 'technical_qualification',
  maximum_microusd: 550000, approved_at: '2026-10-01T02:30:00.000Z', expires_at: '2026-10-03T02:30:00.000Z',
  snapshot: {
    concept: 'Original mountain geometry', audience: 'Adult outdoor enthusiasts', maximumGenerations: 1, decisionId: null,
    printSpecification: { garment: 'Bella + Canvas 3001, size L', placement: 'large front', designWidthInches: 6.5, designHeightInches: 6.5, background: 'opaque' },
  },
};
const run = { id: 'creative-run-1', business_id: 'business-1', approval_id: 'approval-1', workflow_run_id: 'workflow-1', status: 'completed', productionReady: false, capabilityExpired: true };
const asset = {
  id: 'asset-1', creative_run_id: run.id, business_id: 'business-1', candidate_id: 'candidate-1', version: 2,
  model: 'provider/original-model', provider: 'OpenRouter', generated_at: '2026-10-01T02:40:01.125Z',
  signedUrl: 'https://private.example.invalid/image.png?token=temporary', sourceSignedUrl: null,
  asset_hash: hash, brief_hash: briefHash, prompt: 'An original angular mountain in an opaque square.',
  inspection: { sha256: hash, width: 1024, height: 1024, bytes: 300000, effectiveDpi: 157.53, colorSpace: 'srgb', mediaType: 'image/png', failedCriteria: [] },
};
const review = {
  id: 'review-1', asset_id: asset.id, creative_run_id: run.id, reviewer_model: 'independent/reviewer', created_at: '2026-10-01T02:42:00.000Z',
  review: { outcome: 'PASS', assetHash: hash, briefHash, repairInstruction: null, checks: [{ criterion: 'print_constraints', outcome: 'PASS', rationale: 'The saved pixels fit the exact approved print dimensions.' }] },
};
const receipt = {
  creative_run_id: run.id, call_key: 'generate:1', reported_microusd: 17000, reserved_microusd: 30000,
  provider_request_id: 'provider-request-1', created_at: '2026-10-01T02:39:00.000Z', settled_at: '2026-10-01T02:40:00.000Z',
};
const workspace = changes => ({ approvals: [approval], runs: [run], assets: [asset], reviews: [review], costs: [receipt], costsAvailable: true, errors: [], retainedSources: [], ...changes });
const render = changes => renderToStaticMarkup(React.createElement(CreativeLibrary, { data: workspace(changes), businesses, now }));
const renderCosts = (changes = {}, changedRun = run) => renderToStaticMarkup(React.createElement(CreativeRunCostSummary, { data: workspace(changes), approval, run: changedRun }));

test('gallery leads with actual private artwork and exact version, Business, workflow and source', () => {
  const html = render();
  assert.ok(html.indexOf('<figure') < html.indexOf('Independent visual review'));
  assert.match(html, /<img src="https:\/\/private\.example\.invalid\/image\.png\?token=temporary"/);
  assert.match(html, /Original artwork · not a product mockup/);
  for (const text of ['Version 2', 'Original mountain geometry', 'provider/original-model via OpenRouter', '2026-10-01 02:40:01.125 UTC', 'Original Design Studio']) assert.ok(html.includes(text), text);
  assert.match(html, /href="\/dashboard\/artifacts\?business=business-1"/);
  assert.match(html, /href="\/dashboard\/workflows\/workflow-1"/);
  assert.match(html, /href="\/dashboard\/artifacts\?business=business-1#creative-run-creative-run-1"/);
  assert.match(html, /href="\/dashboard\/artifacts\?business=business-1#creative-approvals"/);
  const inline = renderToStaticMarkup(React.createElement(CreativeLibrary, { data: workspace(), businesses, now, historyInPage: true }));
  assert.match(inline, /href="#creative-approvals"/);
  assert.match(inline, /href="#creative-run-creative-run-1"/);
  assert.equal(creativeRunHistoryId('real-id'), 'creative-run-real-id');
  assert.doesNotMatch(html, /_next\/image|<form|type="submit"/);
});

test('technical PASS never implies production, product validation or listing approval', () => {
  const html = render();
  for (const text of ['Technical PASS', 'Technical-only approval', 'Saved file checks passed', 'Product validation', 'Not established by this artwork', 'Listing approval', 'Separate authority required', 'does not clear market evidence or authorize selling']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /Ready to publish|Production ready|Saved candidate approval/);
});

test('stale candidate approval remains expired even after a historical productionReady result', () => {
  const html = render({ approvals: [{ ...approval, purpose: 'candidate_production', expires_at: '2026-10-01T03:00:00.000Z' }], runs: [{ ...run, productionReady: true }] });
  for (const text of ['Visual review PASS', 'Candidate approval expired', 'Passed the saved production approval at completion', 'Recheck current eligibility before use', 'This saved approval has expired', 'they do not renew the approval']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, />Saved candidate approval</);
});

test('current candidate scope and completed production check remain independent', () => {
  const html = render({ approvals: [{ ...approval, purpose: 'candidate_production' }], runs: [{ ...run, productionReady: false }] });
  assert.match(html, /Saved candidate approval/);
  assert.match(html, /not a completed production check/);
  assert.match(html, /Separate authority required/);
});

test('private preview failure preserves record, provenance and honest access message', () => {
  const html = render({ assets: [{ ...asset, signedUrl: null }] });
  assert.match(html, /Private preview unavailable/);
  assert.match(html, /Reload to refresh private image access/);
  assert.match(html, /Version 2/);
  assert.match(html, new RegExp(hash));
  assert.doesNotMatch(html, /<img|Open full image|No saved designs yet/);
});

test('empty Library and read failure are distinct and neither claims free failed generation', () => {
  const empty = render({ assets: [] });
  assert.match(empty, /No saved designs yet/);
  assert.match(empty, /failed validation may still incur a charge/);
  const unavailable = render({ assets: [], errors: ['Asset read unavailable'] });
  assert.match(unavailable, /role="alert"/);
  assert.match(unavailable, /Saved designs unavailable/);
  assert.match(unavailable, /could not confirm whether any designs exist/);
  assert.doesNotMatch(unavailable, /No saved designs yet/);
});

test('partial records preserve previews without treating absent review as pending or PASS', () => {
  const html = render({ reviews: [], errors: ['Review read unavailable'] });
  assert.match(html, /Some Library records could not be loaded/);
  assert.match(html, /Review unavailable/);
  assert.match(html, /visual review could not be confirmed/);
  assert.match(html, /<img/);
  assert.doesNotMatch(html, /data-tone="review"|Awaiting visual review/);
});

test('missing, unknown and cross-Business context cannot supply production authority', () => {
  const missing = render({ approvals: [], reviews: [], runs: [] });
  assert.match(missing, /Purpose unavailable/);
  assert.match(missing, /Run record unavailable/);
  assert.match(missing, /No visual review recorded/);
  assert.doesNotMatch(missing, /Open exact workflow|Technical PASS|Saved candidate approval/);
  const foreign = render({ approvals: [{ ...approval, business_id: 'foreign-business', purpose: 'candidate_production' }] });
  assert.match(foreign, /Purpose unavailable/);
  assert.doesNotMatch(foreign, /Original mountain geometry|Saved candidate approval/);
  const unknown = render({ approvals: [{ ...approval, purpose: 'unrecognized-purpose' }], runs: [{ ...run, status: 'unknown' }] });
  assert.match(unknown, /Purpose unavailable/);
  assert.match(unknown, /Do not infer production or publication authority/);
});

test('review must belong to the exact run and pixel hashes, not just the asset name', () => {
  const mismatch = render({ reviews: [{ ...review, review: { ...review.review, assetHash: 'c'.repeat(64) } }] });
  assert.match(mismatch, /Review does not match this version/);
  assert.match(mismatch, /verdict cannot validate this version/);
  assert.doesNotMatch(mismatch, /data-tone="review"|Technical PASS/);
  const foreign = render({ reviews: [{ ...review, creative_run_id: 'foreign-run' }] });
  assert.match(foreign, /No visual review recorded/);
  assert.doesNotMatch(foreign, /Technical PASS/);
});

test('file validation failure and disallowed repair are visible without an executable action', () => {
  const html = render({ assets: [{ ...asset, inspection: { ...asset.inspection, failedCriteria: ['minimum_effective_dpi'] } }], reviews: [{ ...review, review: { ...review.review, outcome: 'FAIL', repairInstruction: 'Improve edges.' } }] });
  assert.match(html, /Technical FAIL/);
  assert.match(html, /Saved file checks failed/);
  assert.match(html, /Binary gate: minimum_effective_dpi/);
  assert.match(html, /not authorized by this one-image approval/);
  assert.match(html, /No new attempt is authorized here/);
  assert.doesNotMatch(html, /<form|type="submit"/);
});

test('prompt, immutable hashes, original source and review details stay in disclosures', () => {
  const html = render({ assets: [{ ...asset, sourceSignedUrl: 'https://private.example.invalid/original.webp', provenance: { conversion: 'lossless_webp_to_png', detectedMediaType: 'image/webp', originalSha256: 'd'.repeat(64), version: 'normalization-1.0', verification: 'pixel-equality', decoder: 'original-decoder', encoder: 'png-encoder' } }] });
  assert.equal((html.match(/<details class="guidedLibraryDisclosure"/g) ?? []).length, 3);
  for (const text of ['Asset SHA-256', 'Source brief SHA-256', 'Original SHA-256', 'identical decoded pixels and alpha', 'no resizing or upscaling', 'Open original provider file', 'does not claim that the derived PNG retains embedded provenance']) assert.ok(html.includes(text), text);
  assert.match(html, /<summary>Prompt &amp; immutable provenance<\/summary><p class="guidedLibraryPrompt">/);
  assert.doesNotMatch(html, /<details[^>]* open/);
});

test('invalid expiry and generated date render unavailable without throwing or renewing permission', () => {
  const html = render({ approvals: [{ ...approval, purpose: 'candidate_production', expires_at: 'invalid' }], assets: [{ ...asset, generated_at: 'invalid' }] });
  assert.match(html, /Approval expiry unavailable/);
  assert.match(html, /Date unavailable/);
  assert.doesNotMatch(html, /Invalid Date|Saved candidate approval/);
});

test('failed run preserves provider-reported charge separately from allowance and reservation', () => {
  const html = renderCosts({}, { ...run, status: 'failed' });
  for (const text of ['Approved allowance', 'US$0.550000', 'Provider-reported charges', 'US$0.017000', 'Conservative budget committed', 'US$0.030000', 'larger of each reservation or saved amount, not both', 'not an additional charge', 'Reported provider charge']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /US\$0\.047000|US\$0\.597000|<form/);
});

test('missing receipt and absent reported amount remain unknown after expiry', () => {
  const html = renderCosts({ costs: [{ ...receipt, reported_microusd: null, settled_at: null }] });
  for (const text of ['No charge reported', '1 charge(s) remain unknown', 'US$0.030000 reserved', 'Receipt missing after run expiry; charge unknown', 'Missing receipts do not prove zero spend or permit another attempt']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /US\$0\.000000/);
  const settled = renderCosts({ costs: [{ ...receipt, reported_microusd: null }] });
  assert.match(settled, /Receipt has no reported cost; charge unknown/);
});

test('partial cost ledger labels loaded amounts as partial rather than a spend total', () => {
  const html = renderCosts({ costsAvailable: false });
  for (const text of ['Known charges in partial receipts', 'US$0.017000', 'cost ledger could not be fully loaded', 'receipts below are incomplete', 'Known conservative budget commitment']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /<dt>Provider-reported charges<\/dt>|No provider calls are recorded/);
  assert.match(renderCosts({ costs: [], costsAvailable: false }), /Unavailable/);
});

test('missing reservation stays unavailable and a confirmed zero receipt stays known', () => {
  const html = renderCosts({ costs: [{ ...receipt, reserved_microusd: null }] });
  assert.match(html, /Reserved: Detail unavailable/);
  assert.match(html, /Some reservation details are unavailable/);
  assert.match(html, /Known conservative budget commitment: US\$0\.017000/);
  const zero = renderCosts({ costs: [{ ...receipt, reported_microusd: 0 }] });
  assert.match(zero, /Provider-reported charges<\/dt><dd>US\$0\.000000/);
  assert.doesNotMatch(zero, /charge\(s\) remain unknown/);
});

test('server-rendered component has no provider, data-loading, image-optimizer or action imports', () => {
  const source = readFileSync('src/components/guided/creative-library.tsx', 'utf8');
  assert.match(source, /import type .*CreativeWorkspaceData.*from "@\/creative\/data"/);
  assert.doesNotMatch(source, /["']use client["']|from ["']next\/image|loadCreativeWorkspace\(|from .*actions|createClient|fetch\(/);
  assert.match(source, /<img src=\{asset.signedUrl\}/);
});

test('unknown review outcomes and unverifiable file metadata do not become a positive status', () => {
  const html = render({ reviews: [{ ...review, review: { ...review.review, outcome: 'UNRECOGNIZED' } }], assets: [{ ...asset, inspection: { ...asset.inspection, sha256: 'mismatched-hash' } }] });
  assert.match(html, /Review outcome unavailable/);
  assert.match(html, /File validation unavailable/);
  assert.doesNotMatch(html, /data-tone="review"|Technical PASS|Saved file checks passed/);
});


export function creativeLibraryFixtureDocument() {
  const css = readFileSync('src/components/guided/creative-library.css', 'utf8');
  const preview = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#dfcba5"/><path d="M70 800 420 200 640 500 780 290 980 800Z" fill="#213c45"/><path d="M310 390 420 200 530 390Z" fill="#f5ecd6"/></svg>')}`;
  const fixtureData = workspace({ assets: [{ ...asset, signedUrl: preview }, { ...asset, id: 'asset-2', version: 1, signedUrl: null }, { ...asset, id: 'asset-3', version: 1, signedUrl: preview }] });
  const markup = renderToStaticMarkup(React.createElement(CreativeLibrary, { data: fixtureData, businesses, now }));
  return `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#101820;color:#f3f6fa;font-family:Arial,sans-serif;font-size:16px}main{max-width:1060px;margin:0 auto;padding:12px}${css}</style></head><body><main>${markup}</main></body></html>`;
}

const browserEnabled = process.env.GUIDED_UI_BROWSER === '1' || Boolean(process.env.GUIDED_UI_CHROMIUM_PATH);
test('compact preview list keeps source context, keyboard disclosures and mobile targets readable', { skip: !browserEnabled, timeout: 90_000 }, async t => {
  const browser = await chromium.launch({ headless: true, ...(process.env.GUIDED_UI_CHROMIUM_PATH ? { executablePath: process.env.GUIDED_UI_CHROMIUM_PATH } : {}) });
  const screenshots = path.resolve('test-results/guided-ui');
  mkdirSync(screenshots, { recursive: true });
  const html = creativeLibraryFixtureDocument();
  try {
    for (const width of [1440, 900, 390, 320]) await t.test(`${width}px preview pane`, async () => {
      const context = await browser.newContext({ viewport: { width, height: 800 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
      const requests = [];
      await context.route('**/*', route => {
        requests.push(route.request().url());
        if (route.request().url() === asset.signedUrl) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#dfcba5"/><path d="M70 800 420 200 640 500 780 290 980 800Z" fill="#213c45"/><path d="M310 390 420 200 530 390Z" fill="#f5ecd6"/></svg>' });
        return route.abort();
      });
      const page = await context.newPage();
      try {
        await page.setContent(html, { waitUntil: 'load' });
        const inspect = () => page.evaluate(() => {
          const visible = selector => [...document.querySelectorAll(selector)].filter(element => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; });
          return {
            width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
            tinyTargets: visible('.guidedCreativeLibrary a, .guidedCreativeLibrary summary').filter(element => element.getBoundingClientRect().height < 44).map(element => element.textContent),
            tinyText: visible('.guidedCreativeLibrary p, .guidedCreativeLibrary dt, .guidedCreativeLibrary dd, .guidedCreativeLibrary summary, .guidedCreativeLibrary a').filter(element => parseFloat(getComputedStyle(element).fontSize) < 14).map(element => element.textContent),
            headingSize: parseFloat(getComputedStyle(document.querySelector('.guidedLibraryAsset h3')).fontSize),
            paneHeight: document.querySelector('.guidedLibraryGrid').getBoundingClientRect().height,
            paneScrollHeight: document.querySelector('.guidedLibraryGrid').scrollHeight,
            firstCardHeight: document.querySelector('.guidedLibraryAsset').getBoundingClientRect().height,
          };
        });
        const before = await inspect();
        assert.ok(before.scrollWidth <= before.width + 1, JSON.stringify(before));
        assert.deepEqual(before.tinyText, []);
        assert.ok(before.headingSize >= 16);
        if (width <= 700) assert.deepEqual(before.tinyTargets, []);
        else { assert.ok(before.paneHeight <= 601); assert.ok(before.paneScrollHeight > before.paneHeight); assert.ok(before.firstCardHeight < 380, JSON.stringify(before)); }
        await page.screenshot({ path: path.join(screenshots, `library-${width}.png`), fullPage: true });
        const inspector = page.locator('.guidedLibraryInspector').first();
        assert.equal(await inspector.getAttribute('open'), null);
        await inspector.locator(':scope > summary').focus();
        await page.keyboard.press('Enter');
        assert.equal(await inspector.getAttribute('open'), '');
        const provenance = inspector.getByText('Prompt & immutable provenance', { exact: true });
        await provenance.click();
        assert.equal(await inspector.getByText('Asset SHA-256', { exact: true }).isVisible(), true);
        const after = await inspect();
        assert.ok(after.scrollWidth <= after.width + 1, JSON.stringify(after));
        assert.deepEqual(after.tinyText, []);
        if (width <= 700) assert.deepEqual(after.tinyTargets, []);
        await inspector.locator(':scope > summary').focus();
        await page.keyboard.press('Enter');
        assert.equal(await inspector.getAttribute('open'), null);
        assert.equal(await inspector.getByText('Asset SHA-256', { exact: true }).isVisible(), false);
        assert.ok(requests.every(url => url === asset.signedUrl));
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});


test('guided legacy summary matches exact qualified charges and separates unverified saved amounts', () => {
  const analogue = creativeCostTruthFixture({ creativeRunId: run.id }), before = structuredClone(analogue.costs);
  const html = renderCosts({ costs: analogue.costs }, { ...run, status: 'failed' });
  assert.match(html, /Provider-reported charges<\/dt><dd>US\$0\.010280/);
  assert.match(html, /1 charge\(s\) remain unknown · US\$0\.210000 reserved/);
  assert.match(html, /Conservative budget committed: US\$0\.339552/);
  assert.match(html, /Unverified saved amount: US\$0\.210000 · excluded from reported charges/);
  assert.match(html, /reservation or saved amount, not both; unverified saved amounts are retained conservatively/);
  assert.doesNotMatch(html, /US\$0\.220280|Reported provider charge · US\$0\.210000/);
  assert.deepEqual(analogue.costs, before);
  const partial = renderCosts({ costs: analogue.costs, costsAvailable: false });
  assert.match(partial, /Known charges in partial receipts<\/dt><dd>US\$0\.010280/);
  assert.match(partial, /1 charge\(s\) remain unknown/);
  assert.match(partial, /Known conservative budget commitment: US\$0\.339552/);
});

test('guided direct-record summary leaves unlinked saved zero and positive amounts unknown', () => {
  for (const provider_request_id of [null, '', '   ']) for (const reported_microusd of [0, 210000]) {
    const html = renderCosts({ costs: [{ ...receipt, provider_request_id, reported_microusd }] });
    assert.match(html, /No charge reported/);
    assert.match(html, /1 charge\(s\) remain unknown/);
    assert.match(html, /Unverified saved amount: US\$/);
    assert.doesNotMatch(html, /Reported provider charge/);
  }
});
