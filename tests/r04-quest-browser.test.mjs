import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const origin = 'https://r04-quest-fixture.test/';
const screenshots = path.join(root, 'test-results/r04-quest');
const businessId = '00000000-0000-4000-8000-000000000101';
const questId = '00000000-0000-4000-8000-000000000102';
const proposalId = '00000000-0000-4000-8000-000000000103';
const accountId = '00000000-0000-4000-8000-000000000105';
const ownerId = 'r04-fixture-owner';
const originalIntent = 'Target 10 units; budget USD 0; deadline: 2027-12-31T23:59:00Z; geography: New Zealand; scope: shirts; stop if costs rise.';
const envelope = { purposes: ['Research shirts'], operations: ['Read public data'], accounts: [], packs: [], dataSharing: ['none'], limits: [{ category: 'research', currency: 'USD', maximum: '0' }], startsAt: '2026-10-04T00:00:00.000Z', expiresAt: '2026-10-05T00:00:00.000Z', stopRules: ['Stop at cap'] };
const proposal = { id: proposalId, goalId: questId, goalRevision: 2, businessRevision: 3, envelope, hash: 'exact-saved-hash', createdAt: '2026-10-03T00:00:00Z', confirmation: null, revoked: false, effective: false, status: 'proposed' };
const selected = { id: questId, businessId, revision: 2, title: 'Nature shirts', preference: 'ready', createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z', hash: 'exact-quest-hash', content: { title: 'Nature shirts', originalIntent, objective: originalIntent, parsed: { target: { amount: '10', currency: null, metric: 'units' }, budget: { amount: '0', currency: 'USD' }, deadline: { date: '2027-12-31', time: '23:59:00', timezone: 'UTC' }, geography: ['NZ'], scope: 'shirts', stopConstraints: ['stop if costs rise'] }, ambiguities: [] }, proposals: [proposal] };
const baseState = { executionAvailable: false, executionBlockedReason: 'r05_admission_required', businessId, business: { revision: 3, content: { brandContext: 'Nature', operatingRules: 'Review first', allowedActivity: 'Research', restrictions: 'No spend' }, preference: 'setup', currentGoalId: null }, quests: [selected], total: 45, limit: 20, offset: 20, selection: 'explicit', selected, proposalsComplete: true, references: { accounts: [{ id: accountId, revision: 'account-v4', label: 'Research account' }], packs: [], accountsComplete: true, packsComplete: true } };

let htmlPromise;
async function fixtureHtml() {
  htmlPromise ??= (async () => {
    const result = await build({ absWorkingDir: root, bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic', logLevel: 'silent',
      stdin: { sourcefile: 'r04-browser-fixture.tsx', resolveDir: root, loader: 'tsx', contents: `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { QuestWorkspace } from './src/components/quests/quest-workspace';
        window.__questCalls = [];
        window.__questNav = [];
        window.__questMode = 'ok';
        window.__fixtureReferences = ${JSON.stringify(baseState.references)};
        function Harness() {
          const [state, setState] = useState(${JSON.stringify(baseState)});
          window.__setQuestState = change => setState(prior => ({ ...prior, ...change }));
          return <QuestWorkspace state={state} ownerId=${JSON.stringify(ownerId)} />;
        }
        createRoot(document.getElementById('root')).render(<Harness/>);
      ` },
      plugins: [{ name: 'r04-deny-real-services', setup(builder) {
        builder.onResolve({ filter: /^next\/link$|^next\/navigation$|^@\/app\/dashboard\/quests\/actions$/ }, args => ({ path: args.path, namespace: 'r04-mock' }));
        builder.onLoad({ filter: /.*/, namespace: 'r04-mock' }, args => ({ loader: 'tsx', resolveDir: root, contents: args.path === 'next/link'
          ? `import React from 'react'; export default function Link({href, children, ...props}) { return <a href={href} {...props}>{children}</a> }`
          : args.path === 'next/navigation'
            ? `export function useRouter() { return { push: href => window.__questNav.push(href), refresh: () => window.__questNav.push('refresh') } }`
            : `export async function saveQuestIntent(...args) { window.__questCalls.push(args); if (window.__questMode === 'throw') throw Error('synthetic interruption'); if (window.__questMode === 'hold') await new Promise(resolve => { window.__resolveQuestAction = resolve }); return { ok: true, result: { id: '00000000-0000-4000-8000-000000000104' } }; }
               export async function previewResearchLink() { return window.__previewResult ?? { status: 'unavailable' }; }` }));
        builder.onResolve({ filter: /^@\// }, args => ({ path: path.join(root, 'src', args.path.slice(2) + '.ts') }));
      } }],
    });
    // Match the root layout's stylesheet order; the Quest page uses coreMain.
    const css = [
      'src/app/globals.css', 'src/app/stage1.css', 'src/app/stage3.css',
      'src/app/stage7.css', 'src/app/stage7-mobile.css', 'src/app/stage8.css',
      'src/components/guided/work-context.css',
    ].map(file => readFileSync(path.join(root, file), 'utf8')).join('\n');
    const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main class="coreMain" id="root"></main><script>${script}</script></body></html>`;
  })();
  return htmlPromise;
}

test('Quest browser fixture bundles production workspace with only navigation and actions mocked', async () => {
  const html = await fixtureHtml();
  assert.match(html, /QuestWorkspace|Create a Quest/);
  assert.doesNotMatch(html, /OPENROUTER_API_KEY|SUPABASE_SERVICE_ROLE_KEY/);
});

test('Quest workspace browser behavior is bounded and exact', { skip: process.env.GUIDED_UI_BROWSER !== '1' && !process.env.GUIDED_UI_CHROMIUM_PATH, timeout: 120_000 }, async t => {
  mkdirSync(screenshots, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.GUIDED_UI_CHROMIUM_PATH });
  try {
    const html = await fixtureHtml();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    const external = [];
    await context.route('**/*', route => route.request().url() === origin && route.request().isNavigationRequest()
      ? route.fulfill({ status: 200, contentType: 'text/html', body: html })
      : (external.push(route.request().url()), route.abort()));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.getByRole('heading', { name: 'Create a Quest' }).waitFor();

    await t.test('review required and credential text blocked before action', async () => {
      const save = page.getByRole('button', { name: 'Save Quest draft' });
      assert.equal(await save.isDisabled(), true);
      await page.getByRole('textbox', { name: 'Quest title' }).fill('New idea');
      await page.getByRole('textbox', { name: 'Your Quest in plain language' }).fill(originalIntent);
      assert.equal(await save.isDisabled(), true);
      const input = page.getByRole('textbox', { name: 'Your Quest in plain language' });
      await input.fill('password\ncorrect-horse');
      assert.equal(await input.inputValue(), originalIntent);
      assert.deepEqual(await page.evaluate(() => window.__questCalls), []);
      await page.getByRole('checkbox', { name: /I reviewed the extracted facts/ }).check();
      assert.equal(await save.isEnabled(), true);
    });

    await t.test('one action while busy, stable request UUID after interruption and reload', async () => {
      await page.evaluate(() => { window.__questMode = 'hold'; });
      await page.getByRole('button', { name: 'Save Quest draft' }).click();
      await page.waitForFunction(() => window.__questCalls.length === 1);
      assert.equal(await page.getByRole('button', { name: 'Save Quest draft' }).isDisabled(), true);
      await page.evaluate(() => { const button = [...document.querySelectorAll('button')].find(item => item.textContent === 'Save Quest draft'); button.click(); button.click(); });
      assert.equal(await page.evaluate(() => window.__questCalls.length), 1);
      await page.evaluate(() => window.__resolveQuestAction());
      await page.waitForFunction(() => window.__questNav.includes('refresh'));
      const firstId = await page.evaluate(() => window.__questCalls[0][3]);
      assert.match(firstId, /^[0-9a-f-]{36}$/i);
      const stored = await page.evaluate(() => Object.entries(sessionStorage));
      assert.ok(stored.length > 0);
      assert.ok(stored.every(([key, value]) => !key.includes(originalIntent) && !value.includes(originalIntent) && /^[0-9a-f-]{36}$/i.test(value)));
      await page.evaluate(() => { window.__questMode = 'throw'; });
      await page.getByRole('button', { name: 'Save Quest draft' }).click();
      await page.waitForFunction(() => window.__questCalls.length === 2);
      assert.equal(await page.evaluate(() => window.__questCalls[1][3]), firstId);
      await page.reload();
      await page.getByRole('textbox', { name: 'Quest title' }).fill('New idea');
      await page.getByRole('textbox', { name: 'Your Quest in plain language' }).fill(originalIntent);
      await page.getByRole('checkbox', { name: /I reviewed the extracted facts/ }).check();
      await page.getByRole('button', { name: 'Save Quest draft' }).click();
      await page.waitForFunction(() => window.__questCalls.length === 1);
      assert.equal(await page.evaluate(() => window.__questCalls[0][3]), firstId);
    });

    await t.test('explicit selected Quest survives paging and unavailable references block proposal', async () => {
      assert.match(await page.getByRole('link', { name: 'Next Quests' }).getAttribute('href'), new RegExp(`quest=${questId}.*offset=40`));
      await page.evaluate(() => window.__setQuestState({ references: { ...window.__fixtureReferences, accountsComplete: false, packsComplete: false } }));
      await page.getByText('Draft the complete operating envelope').click();
      await page.getByText(/All account and pack references must also be available/).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Save proposal for complete review' }).isDisabled(), true);
    });

    await t.test('ready Quest gates a complete proposal and raw multiline credentials stop before the action', async () => {
      await page.evaluate(({ references, selected }) => window.__setQuestState({ references, selected: { ...selected, preference: 'draft' } }), { references: baseState.references, selected });
      assert.equal(await page.getByRole('button', { name: 'Save proposal for complete review' }).isDisabled(), true);
      await page.evaluate(value => window.__setQuestState({ selected: value }), selected);
      assert.equal(await page.getByRole('button', { name: 'Save proposal for complete review' }).isEnabled(), true);
      const field = name => page.locator(`[name="${name}"]`);
      await field('purposes').fill('Research shirts');
      await field('operations').fill('Read public data');
      await field('dataSharing').fill('none');
      await field('category').fill('research');
      await field('currency').fill('USD');
      await field('maximum').fill('0');
      await field('startsAt').fill('2026-10-04T00:00:00Z');
      await field('expiresAt').fill('2026-10-05T00:00:00Z');
      await field('stopRules').fill('Stop at cap');
      await page.locator(`input[name="account"][value="${accountId}"]`).check();
      const before = await page.evaluate(() => window.__questCalls.length);
      await field('purposes').fill('password\ncorrect-horse');
      await page.getByRole('button', { name: 'Save proposal for complete review' }).click();
      await page.getByRole('alert').filter({ hasText: /Credential-like content was rejected/ }).waitFor();
      assert.equal(await page.evaluate(() => window.__questCalls.length), before);
      await field('purposes').fill('Research shirts');
      await page.getByRole('button', { name: 'Save proposal for complete review' }).click();
      await page.waitForFunction(() => window.__questCalls.some(call => call[1] === 'envelope.propose'));
      const call = await page.evaluate(() => window.__questCalls.find(call => call[1] === 'envelope.propose'));
      assert.equal(call[0], businessId);
      assert.deepEqual(call[2], { goalId: questId, expectedRevision: 2, businessRevision: 3, envelope: { ...envelope, accounts: [{ id: accountId, revision: 'account-v4' }] } });
      assert.equal(call[2].envelope.expiresAt, '2026-10-05T00:00:00.000Z');
      assert.match(call[3], /^[0-9a-f-]{36}$/i);
    });

    await t.test('current Quest selection waits for saved Business settings', async () => {
      await page.evaluate(business => window.__setQuestState({ business: { ...business, revision: 0 } }), baseState.business);
      // The fixture's React setter schedules a render; isDisabled itself does
      // not retry. Wait for the real control state rather than racing commit.
      await page.waitForFunction(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Make this the current Quest')?.disabled === true, null, { timeout: 10000 });
      assert.equal(await page.getByRole('button', { name: 'Make this the current Quest' }).isDisabled(), true);
      await page.evaluate(business => window.__setQuestState({ business }), baseState.business);
      await page.waitForFunction(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Make this the current Quest')?.disabled === false, null, { timeout: 10000 });
      assert.equal(await page.getByRole('button', { name: 'Make this the current Quest' }).isEnabled(), true);
    });

    await t.test('saved proposal confirms exact identity and content', async () => {
      await page.getByRole('button', { name: 'Confirm this complete envelope once' }).click();
      await page.waitForFunction(() => window.__questCalls.some(call => call[1] === 'envelope.confirm'));
      const call = await page.evaluate(() => window.__questCalls.find(call => call[1] === 'envelope.confirm'));
      assert.deepEqual(call[2], { proposalId, proposalHash: 'exact-saved-hash' });
      assert.equal(call[0], businessId);
    });

    await t.test('legacy-bound research preview shows preserved identity without an association action', async () => {
      await page.getByText('Associate existing research').click();
      await page.evaluate(() => { window.__previewResult = { status: 'legacy_bound', goalId: '00000000-0000-4000-8000-000000000999' }; });
      await page.getByRole('textbox', { name: 'Exact experiment ID' }).fill('00000000-0000-4000-8000-000000000888');
      await page.getByRole('button', { name: 'Preview association without changes' }).click();
      await page.getByRole('status').filter({ hasText: /Already associated with original Core Goal/ }).waitFor();
      assert.match(await page.getByRole('status').filter({ hasText: /Already associated/ }).textContent(), /00000000-0000-4000-8000-000000000999/);
      assert.equal(await page.getByRole('button', { name: 'Associate verified lineage with this exact Quest version' }).count(), 0);
      assert.equal((await page.evaluate(() => window.__questCalls)).some(call => call[1] === 'research.link'), false);
    });

    await t.test('linkable lineage with a different original intent cannot be associated', async () => {
      await page.evaluate(() => { window.__previewResult = { status: 'linkable', goalId: null, experimentIds: ['00000000-0000-4000-8000-000000000888'], evidence: { originalObjective: 'A different original objective' } }; });
      await page.getByRole('button', { name: 'Preview association without changes' }).click();
      await page.getByText(/does not match this lineage’s exact original intent/).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Associate verified lineage with this exact Quest version' }).isDisabled(), true);
      assert.equal((await page.evaluate(() => window.__questCalls)).some(call => call[1] === 'research.link'), false);
    });

    await t.test('desktop and mobile screenshots have no horizontal overflow', async () => {
      const mobileFindings = [];
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        const overflow = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
        assert.ok(overflow.content <= overflow.width + 1, `${width}: ${JSON.stringify(overflow)}`);
        await page.screenshot({ path: path.join(screenshots, `quest-${width}.png`), fullPage: true, animations: 'disabled' });
        if (width <= 390) mobileFindings.push(...await page.evaluate(() => [...document.querySelectorAll('button, input:not([type=checkbox]), textarea, summary')]
          .filter(element => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; })
          .map(element => ({ width: innerWidth, tag: element.tagName, text: element.textContent?.trim().slice(0, 35) || element.getAttribute('name') || '', height: element.getBoundingClientRect().height, font: parseFloat(getComputedStyle(element).fontSize) }))));
      }
      await page.setViewportSize({ width: 390, height: 900 });
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
      const scale = await page.evaluate(() => visualViewport.scale);
      assert.ok(scale >= 1.9, `Browser page scale did not reach 200%: ${scale}`);
      const zoomed = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
      assert.ok(zoomed.content <= zoomed.width + 1, `zoomed: ${JSON.stringify(zoomed)}`);
      await page.screenshot({ path: path.join(screenshots, 'quest-390-zoom200.png'), fullPage: true, animations: 'disabled' });
      await cdp.send('Emulation.resetPageScaleFactor');
      const undersized = mobileFindings.filter(control => control.height < 44 || control.font < 16);
      assert.equal(undersized.length, 0, `${undersized.length} mobile controls below 44px or 16px; examples: ${JSON.stringify(undersized.slice(0, 8))}`);
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    await context.close();
  } finally { await browser.close(); }
});
