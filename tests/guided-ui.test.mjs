import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import {
  components, definition, fixtureDocument, fixtureRenderers, intervention, renderCreative, renderDashboard, renderDecisions, renderTimelines, renderWorkflows, renderWorkContext, researchGoal, renderProducts, renderUnknownNavigation, run,
} from "./helpers/guided-ui.mjs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// These always run, including on machines where organization browser policy
// prevents Chromium startup. Visual checks below run explicitly on hosted CI.
test("guided owner fixtures render the real shell and pages without production dependencies", async () => {
  for (const [name, render] of Object.entries(fixtureRenderers)) {
    const markup = await render();
    assert.match(markup, /class="guidedShell"/, name);
    assert.match(markup, /<main\b/, name);
    assert.match(markup, /aria-current="page"/, name);
    assert.match(markup, /owner@example\.invalid/, name);
    assert.doesNotMatch(markup, /https:\/\/[^"\s]*(?:supabase\.co|openrouter\.ai)/, name);
    assert.equal(await render(), markup, `${name} must have deterministic timestamps and identifiers`);
  }
});

test("dashboard distinguishes known decision activity, empty data and unavailable data", async () => {
  const known = await renderDashboard();
  assert.match(known, /Review the saved research result/);
  assert.match(known, /North Star Design Studio/);
  const unavailable = await renderDashboard({ unavailable: true });
  assert.match(unavailable, /role="alert"/);
  assert.match(unavailable, /could not be loaded|unavailable|could not be checked/i);
  assert.match(unavailable, /Decision count unavailable/);
  assert.doesNotMatch(unavailable, /Nothing needs your attention|Agent Labs is ready|Create your workspace/);
  assert.doesNotMatch(unavailable, /class="coreMetricGrid"/, "Unavailable records must not produce reassuring zero metrics");
  assert.match(unavailable, /Work status could not be confirmed/);
  const empty = await renderDashboard({ empty: true });
  assert.doesNotMatch(empty, /role="alert"/);
  assert.doesNotMatch(empty, /Review the saved research result/);
});

test("guided navigation exposes five primary destinations and makes unknown counts explicit", () => {
  const markup = renderUnknownNavigation();
  for (const className of ["guidedPrimaryNavigation", "guidedBottomNavigation"]) {
    const nav = markup.match(new RegExp(`<nav class="${className}"[^>]*>(.*?)</nav>`, "s"))?.[1];
    assert.ok(nav, className);
    assert.equal((nav.match(/class="guidedNavLink"/g) ?? []).length, 5);
    assert.match(nav, /Decision count unavailable/);
    assert.doesNotMatch(nav, /0 open decisions/);
  }
  assert.match(markup, /Business records unavailable/);
  assert.doesNotMatch(markup, /No business yet/);
  assert.equal((markup.match(/class="liveConnection /g) ?? []).length, 1, "Only one live subscription presentation is mounted");
});

test("real WorkContext uses the matching saved intent rather than an unrelated goal", () => {
  const markup = renderWorkContext();
  assert.ok(markup.includes(researchGoal));
  assert.match(markup, /business=fixture-business/);
  for (const boundary of ["Separate approval required", "Implementation incomplete", "Qualified product required", "Fee evidence required"]) assert.ok(markup.includes(boundary));
  const mismatch = renderWorkContext({ mismatched: true });
  assert.ok(!mismatch.includes(researchGoal));
  assert.match(mismatch, /Review the saved research goal/);
});

test("Products page renders the real bounded quest without starting research", async () => {
  const markup = await renderProducts();
  assert.match(markup, /class="questKickoff"/);
  assert.match(markup, /Find a market worth exploring/);
  assert.match(markup, /Saved research and recovery/);
  assert.match(markup, /Experimental · live qualification incomplete/);
  assert.doesNotMatch(markup, /Current provider prices are unavailable|name="confirmResearch"/);
});

test("Workflows index shows an active worker only when run, task, stage and worker match", async () => {
  const working = await renderWorkflows();
  assert.match(working, /title="Working on the current stage"/);
  assert.match(working, /Evidence research specialist<\/span>/);
  assert.doesNotMatch(working, />No current worker<|>Last worker:/);
  for (const options of [{ ended: true }, { mismatchedTask: true }]) {
    const inactive = await renderWorkflows(options);
    assert.match(inactive, /No current worker/);
    assert.doesNotMatch(inactive, /title="Working on the current stage"/);
  }
});

test("decision fixtures preserve read-only reconciliation and bounded simulation actions", () => {
  const { visuals } = components();
  for (const [type, destination, label] of [
    ["etsy.publication.reconcile", "/dashboard/etsy?business=", "Check existing listing"],
    ["printful.product.reconcile", "/dashboard/printful?business=", "Review existing product"],
  ]) {
    const markup = renderToStaticMarkup(React.createElement(visuals.NeedsYouCard, {
      intervention: { ...intervention, workflow_run_id: null, intervention_type: type }, returnTo: "/dashboard/needs-you",
    }));
    assert.ok(markup.includes(destination));
    assert.ok(markup.includes(label));
    assert.doesNotMatch(markup, /<form|Approve and complete|Fail workflow/);
  }
  const all = renderDecisions();
  assert.match(all, /Acknowledge simulated result/);
  assert.match(all, /Stop simulation/);
});

test("timeline fixture includes evidence gaps, failed attempts and completed records", () => {
  const markup = renderTimelines();
  for (const label of ["Waiting for a decision", "Missing stage records", "Stopped after a failed worker", "All stages recorded complete", "attempt 2"]) assert.ok(markup.includes(label), label);
  const { visuals } = components();
  const empty = renderToStaticMarkup(React.createElement(visuals.WorkflowTimeline, { definition, run: { ...run, current_stage_key: null }, stages: [] }));
  assert.doesNotMatch(empty, /visualStage-success/);
  const missingEarlier = renderToStaticMarkup(React.createElement(visuals.WorkflowTimeline, { definition, run, stages: [] }));
  assert.doesNotMatch(missingEarlier, /visualStage-success|✓|>Completed</);
  assert.match(missingEarlier, /Not recorded/);
  const stopped = renderToStaticMarkup(React.createElement(visuals.WorkflowTimeline, { definition, run: { ...run, completed_at: "2026-10-02T03:00:00.000Z" }, stages: [] }));
  assert.doesNotMatch(stopped, /aria-current="step"|visualStage-current|Upcoming/);
  assert.match(markup, /No current worker/);
  assert.match(markup, /Review creative evidence/);
});

test("unknown and stopped creative reviews cannot expose synthetic completion controls", () => {
  const { visuals } = components();
  for (const type of ["creative_review", "future_review", "review"]) {
    const markup = renderToStaticMarkup(React.createElement(visuals.NeedsYouCard, {
      intervention: { ...intervention, intervention_type: type }, run, definition, returnTo: "/dashboard/needs-you",
    }));
    assert.match(markup, /View details/);
    assert.doesNotMatch(markup, /<form|Approve and complete|Fail workflow|name="decision"/);
  }
});

test("creative fixture keeps evidence gate, explicit terms and bounded image controls", async () => {
  const markup = await renderCreative();
  for (const text of ["No current evidence-backed TEST candidates are eligible", "Every image keeps its source and verdict", "No generation until you start the saved approval", "No validated images", "name=\"confirmTerms\"", "name=\"confirmDataUse\"", "name=\"maximumGenerations\"", "Save specific approval"]) assert.ok(markup.includes(text), text);
  assert.doesNotMatch(markup, /name="confirmProductionScope"/);
});

async function assertContained(page, label) {
  const overflow = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth,
    offenders: [...document.querySelectorAll("main *")].filter(element => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && (box.right > innerWidth + 1 || box.left < -1);
    }).slice(0, 12).map(element => ({ tag: element.tagName, className: element.className, text: element.textContent?.trim().slice(0, 60) })),
  }));
  assert.ok(overflow.document <= overflow.viewport + 1 && overflow.body <= overflow.viewport + 1, `${label} horizontal overflow: ${JSON.stringify(overflow)}`);
  assert.deepEqual(overflow.offenders, [], `${label} content extends outside the viewport`);
}

async function assertControlTargets(page, label) {
  const undersized = await page.locator(".coreButton:not(:disabled), .coreNavLink, .coreMobileNavLink, .guidedNavLink, .guidedDisclosureSummary, .guidedMoreSummary, .guidedAdvancedLink, .guidedSignOut, .guidedDisclosure > summary, .guidedJourney a, .questKickoffButton:not(:disabled)").evaluateAll(elements => elements.filter(element => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && (box.width < 43.5 || box.height < 43.5);
  }).map(element => ({ text: element.textContent.trim(), width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })));
  assert.deepEqual(undersized, [], `${label} primary controls must have a 44px target`);
}

async function assertTextContrast(page, label) {
  const failures = await page.locator(".corePageDescription, .coreNavLink, .coreMobileNavLink, .coreEyebrow, .liveConnection, .needsYouCopy p, .needsYouCopy small, .visualStage strong, .visualStage small, .creativeIntro h2, .creativeIntro p, .creativeIntro a, .creativeMuted, .guidedNavLink, .guidedDisclosureSummary, .guidedMoreSummary, .guidedAdvancedLink, .guidedSignOut, .guidedWorkspaceContext strong, .guidedWorkspaceContext small, .guidedDecisionCount, .guidedWorkGoal p, .guidedJourney span, .guidedJourney small, .guidedJourneyBoundary, .questKickoffLocal, .questKickoffEyebrow").evaluateAll(elements => {
    const parse = value => (value.match(/[\d.]+/g) ?? []).map(Number);
    const over = (front, back) => { const alpha = front[3] ?? 1; return [0, 1, 2].map(index => front[index] * alpha + back[index] * (1 - alpha)); };
    const luminance = color => color.slice(0, 3).map(value => { const n = value / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((sum, n, index) => sum + n * [.2126, .7152, .0722][index], 0);
    const failures = [];
    for (const element of elements) {
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      const style = getComputedStyle(element);
      const chain = [];
      for (let current = element; current; current = current.parentElement) chain.push(parse(getComputedStyle(current).backgroundColor));
      const background = chain.reverse().reduce((back, front) => over(front, back), [255, 255, 255]);
      const foreground = over(parse(style.color), background);
      const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
      const ratio = (values[1] + .05) / (values[0] + .05);
      const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && parseInt(style.fontWeight) >= 700);
      const minimum = large ? 3 : 4.5;
      if (ratio + .02 < minimum) failures.push({ text: element.textContent.trim().slice(0, 70), ratio: Number(ratio.toFixed(2)), minimum, color: style.color });
    }
    return failures;
  });
  assert.deepEqual(failures, [], `${label} sampled text must meet WCAG AA against its computed solid background`);
}

async function assertKeyboardFocus(page, label) {
  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => {
    const active = document.activeElement;
    const style = getComputedStyle(active);
    return { tag: active.tagName, visible: active.matches(":focus-visible"), width: parseFloat(style.outlineWidth), outlineStyle: style.outlineStyle };
  });
  assert.notEqual(focus.tag, "BODY", `${label} keyboard must reach a control`);
  assert.ok(focus.visible && focus.width >= 2 && focus.outlineStyle !== "none", `${label} keyboard focus must have a visible outline: ${JSON.stringify(focus)}`);
  // Do not navigate or submit an owner action while testing the fixture.
  await page.evaluate(() => document.activeElement.blur());
}

async function assertFocusedControlVisible(page, label) {
  const focus = await page.evaluate(() => {
    const active = document.activeElement;
    const box = active.getBoundingClientRect();
    const style = getComputedStyle(active);
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { name: active.textContent.trim(), visible: active.matches(":focus-visible"), outline: parseFloat(style.outlineWidth),
      contained: box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth,
      unobscured: Boolean(hit && (hit === active || active.contains(hit))) };
  });
  assert.ok(focus.visible && focus.outline >= 2 && focus.contained && focus.unobscured, `${label} focused control is visible and unobscured: ${JSON.stringify(focus)}`);
}

async function assertGuidedDisclosures(page, width) {
  const mobile = width <= 920;
  const region = page.locator(mobile ? ".guidedMorePanel" : ".guidedSidebar");
  if (mobile) {
    await page.locator(".guidedMoreSummary").focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.locator(".guidedMore").getAttribute("open"), "");
    await assertFocusedControlVisible(page, `More/${width}`);
    await page.keyboard.press("Tab");
    await assertFocusedControlVisible(page, `More Activity/${width}`);
    await page.keyboard.press("Tab");
  } else {
    await region.locator(".guidedDisclosureSummary").focus();
  }
  await page.keyboard.press("Enter");
  assert.equal(await region.locator(".guidedAdvanced").getAttribute("open"), "");
  await assertFocusedControlVisible(page, `Advanced/${width}`);
  for (let index = 0; index < 5; index++) {
    await page.keyboard.press("Tab");
    await assertFocusedControlVisible(page, `Advanced link ${index + 1}/${width}`);
  }
  await page.keyboard.press("Tab");
  assert.equal(await region.locator(".guidedSignOut").evaluate(element => document.activeElement === element), true);
  await assertFocusedControlVisible(page, `Sign out/${width}`);
  await page.screenshot({ path: path.join(screenshotDirectory, `navigation-expanded-${width}.png`), fullPage: true, animations: "disabled" });
  await assertContained(page, `expanded navigation/${width}`);
  await assertControlTargets(page, `expanded navigation/${width}`);
  await assertTextContrast(page, `expanded navigation/${width}`);
  // Native disclosures can close and reopen without losing the underlying page.
  await region.locator(".guidedDisclosureSummary").focus();
  await page.keyboard.press("Enter");
  assert.equal(await region.locator(".guidedAdvanced").getAttribute("open"), null);
  if (mobile) {
    await page.locator(".guidedMoreSummary").focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.locator(".guidedMore").getAttribute("open"), null);
    await assertFocusedControlVisible(page, `Closed More/${width}`);
  }
}

const browserEnabled = process.env.GUIDED_UI_BROWSER === "1" || Boolean(process.env.GUIDED_UI_CHROMIUM_PATH);
const screenshotDirectory = path.resolve("test-results/guided-ui");
test("hosted Chromium captures guided owner UI at desktop, mobile and 320px reflow", { skip: !browserEnabled, timeout: 180_000 }, async t => {
  mkdirSync(screenshotDirectory, { recursive: true });
  // The default is Playwright's pinned bundled Chromium installed by CI. Local
  // execution is opt-in only, and a policy-denied launch remains a real failure.
  const browser = await chromium.launch({ headless: true, ...(process.env.GUIDED_UI_CHROMIUM_PATH ? { executablePath: process.env.GUIDED_UI_CHROMIUM_PATH } : {}) });
  try {
    for (const [name, render] of Object.entries(fixtureRenderers)) {
      const document = fixtureDocument(await render(), { creative: name === "creative", products: name === "products" });
      for (const width of [1440, 390, 320]) {
        await t.test(`${name} at ${width}px`, async () => {
          const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: "en-NZ", timezoneId: "UTC", colorScheme: "dark", reducedMotion: "reduce", serviceWorkers: "block" });
          // No production navigation, auth state, external fonts, images, or APIs.
          await context.route("**/*", route => route.abort());
          const page = await context.newPage();
          try {
            await page.setContent(document, { waitUntil: "load" });
            await page.screenshot({ path: path.join(screenshotDirectory, `${name}-${width}.png`), fullPage: true, animations: "disabled" });
            const label = `${name}/${width}`;
            assert.equal(await page.locator("main").count(), 1, label);
            await assertContained(page, label);
            await assertControlTargets(page, label);
            await assertTextContrast(page, label);
            await assertKeyboardFocus(page, label);
            if (name === "navigation-unavailable") await assertGuidedDisclosures(page, width);
            if (name === "dashboard") {
              assert.equal(await page.locator(".coreMetricGrid").count(), 0);
              const management = page.locator(".guidedDisclosure").filter({ hasText: "Manage workspaces" });
              assert.equal(await management.count(), 1);
              assert.equal(await management.getAttribute("open"), null);
            }
            if (name === "creative") {
              assert.equal(await page.getByRole("combobox", { name: "Image generation limit" }).inputValue(), "1");
              assert.equal(await page.getByRole("checkbox", { name: /I accept the/ }).isChecked(), false);
            }
          } finally { await context.close(); }
        });
      }
    }
  } finally { await browser.close(); }
});
