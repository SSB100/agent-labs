import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { chromium } from "playwright-core";
import { domFixturePage } from "./browser-privacy-dom-fixture.mjs";
import observationModule from "../.core-tests/browser/planner/observation.js";
import privacyModule from "../.core-tests/browser/planner/privacy.js";
import plannerModule from "../.core-tests/browser/planner/planner.js";
import executorModule from "../.core-tests/browser/planner/executor.js";
import fixturesModule from "../.core-tests/browser/planner/fixtures.js";
const { observeStructuredPage, sanitizeStructuredObservation, assertStructuredObservation } = observationModule;
const { sensitiveHint, redactBrowserUrl } = privacyModule;
const { validatePlannerAction, planBrowserAction } = plannerModule;
const { executePlannerAction } = executorModule;
const { MOCK_COMMERCE_OBSERVATION } = fixturesModule;
const SECRET = "FIXTURE_ONLY_DO_NOT_RETAIN_4ef782";
const contract = { id: "fixture", objective: "Inspect the next ordinary step.", inputArtifactIds: [],
  permittedCapabilities: ["browser.observe", "browser.interact"], requiredKnowledge: [], requiredOutputSchema: {},
  completionCriteria: {}, failureCriteria: {}, nonGoals: [], escalationRules: {} };
const action = (id, type = "type") => ({ type, elementId: id, text: type === "type" ? SECRET : null,
  url: null, reason: "Inspect the next bounded step.", failureCategory: null });
const fixture = (attributes = {}) => { const o = structuredClone(MOCK_COMMERCE_OBSERVATION);
  Object.assign(o.controls[0], attributes); return o; };
const ownerOnly = (error) => error.failure?.retryable === false && error.failure?.details.ownerOnlySecureEntry === true && !JSON.stringify(error.failure).includes(SECRET);

test("sensitive fields include Unicode, camelCase, labels, autocomplete and common account data", () => {
  for (const hint of ["PaSsWoRd", "ＰＡＳＳＷＯＲＤ", "pass\u200bword", "apiKey", "access_token", "one-time-code",
    "OTP", "Code", "Passcode", "bankName", "VAT", "mfa_code", "Recovery codes", "backup-code", "Security answer", "cc-number", "cc-exp", "CVV",
    "bankAccount", "routing_number", "IBAN", "taxpayerId", "tax_id", "social_security_number", "SSN", "EIN",
    "Passport number", "drivers_license", "nationalIdentity", "dateOfBirth", "bday-day", "private_key", "seed phrase"])
    assert.equal(sensitiveHint(hint), true, hint);
  for (const hint of ["Product title", "Price", "email", "Search", "shipping country", "description"])
    assert.equal(sensitiveHint(hint), false, hint);
});

test("sensitive observations are projected without metadata, textarea echoes, URLs or provider extras", () => {
  for (const attributes of [{ type: " PASSWORD " }, { name: "apiKey" }, { id: "el_token01" },
    { label: "Recovery code" }, { autocomplete: "one-time-code" }, { domId: "bankAccount" },
    { placeholder: "Taxpayer ID" }, { text: "Passport number" }]) {
    const raw = fixture({ ...attributes, value: SECRET, providerExtra: SECRET });
    raw.title = `Page ${SECRET}`; raw.visibleText = `Echo ${SECRET}`;
    raw.url = `https://user:${SECRET}@example.test/account?state=${SECRET}#${SECRET}`;
    raw.links = [{ ...raw.controls[1], id: "el_link001", kind: "link", href: `https://example.test/verify?code=${SECRET}#${SECRET}` }];
    raw.forms = [{ id: "form_fixture", action: `https://example.test/account?token=${SECRET}`, method: "post", elementIds: raw.controls.map(e => e.id) }];
    raw.providerExtra = SECRET;
    const clean = sanitizeStructuredObservation(raw);
    assert.equal(JSON.stringify(clean).includes(SECRET), false);
    assert.equal(clean.controls[0].sensitive, true);
    assert.equal(clean.controls[0].value, null);
    assert.equal(clean.url, "https://example.test/account");
    assert.equal(clean.links[0].href, "https://example.test/verify");
    assert.equal(clean.forms[0].action, "https://example.test/account");
    assert.doesNotThrow(() => assertStructuredObservation(clean));
    assert.throws(() => validatePlannerAction({ taskContract: contract, observation: clean }, action(clean.controls[0].id)), ownerOnly);
    assert.throws(() => validatePlannerAction({ taskContract: contract, observation: clean }, action(clean.controls[1].id, "click")), ownerOnly);
  }
});

test("malformed observation attributes and URLs fail without echoing their values", () => {
  for (const raw of [fixture({ name: { secret: SECRET } }), fixture({ autocomplete: { secret: SECRET } }),
    { ...fixture(), url: `javascript:${SECRET}` }]) {
    assert.throws(() => sanitizeStructuredObservation(raw), error => {
      assert.equal(JSON.stringify(error.failure).includes(SECRET), false); return true;
    });
  }
  assert.throws(() => assertStructuredObservation(fixture({ name: "apiToken", value: SECRET })), /unredacted/);
  assert.equal(redactBrowserUrl(`https://u:${SECRET}@example.test/a?code=${SECRET}#${SECRET}`), "https://example.test/a");
});

test("planner rejects secure entry, secure submission and credential-bearing navigation before returning receipts", () => {
  const observation = fixture({ name: "mfa_code", value: SECRET });
  for (const type of ["type", "click"])
    assert.throws(() => validatePlannerAction({ taskContract: contract, observation }, action(observation.controls[0].id, type)), ownerOnly);
  for (const url of [`https://example.test/?access_token=${SECRET}`, `https://example.test/account?state=${SECRET}`,
    `https://u:${SECRET}@example.test/`, `https://example.test/#${SECRET}`])
    assert.throws(() => validatePlannerAction({ taskContract: contract, observation },
      { ...action(null, "navigate"), url }), ownerOnly);
  assert.throws(() => validatePlannerAction({ taskContract: contract, observation },
    { ...action(null, "complete"), text: SECRET }), /unrelated input/);
});

function adapterWithInspect(inspect) { return { async invokeStructured(request) {
  inspect(request); return { output: { type: "complete", elementId: null, text: null, url: null, reason: "Inspection complete.", failureCategory: null },
    provider: "fixture", providerModelId: request.model.providerModelId, providerRequestId: "fixture",
    latencyMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0, reportedCostUsd: 0 }, metadata: {} };
}, async qualifyToolUse() { throw new Error("not used"); } }; }

test("model prompts and request metadata sanitize restored observations and previous failure echoes", async () => {
  const raw = fixture({ name: "recovery_code", value: SECRET, text: `Code ${SECRET}` });
  raw.url = `https://example.test/account?code=${SECRET}`;
  await planBrowserAction({ taskContract: contract, observation: raw,
    previousFailure: { category: "action_failed", message: SECRET, retryable: true, details: { url: SECRET } } },
    { adapter: adapterWithInspect(request => assert.equal(JSON.stringify(request).includes(SECRET), false)) });
  await assert.rejects(() => planBrowserAction({ taskContract: contract, observation: raw },
    { adapter: { async invokeStructured() { throw new Error(SECRET); } } }), error => !JSON.stringify(error.failure).includes(SECRET));
});

test("serialized DOM observation removes label, hidden-field and text-only secrets before returning", async () => {
  const specs = [
    { tag: "input", attrs: { name: "apiKey", type: "text", value: SECRET } },
    { tag: "input", attrs: { id: "access-token", type: "TEXT", value: SECRET } },
    { tag: "input", attrs: { value: SECRET }, labels: ["Recovery code"] },
    { tag: "input", attrs: { autocomplete: "section-checkout cc-number", value: SECRET } },
    { tag: "input", attrs: { autocomplete: "one-time-code", value: SECRET } },
    { tag: "input", attrs: { name: "taxpayerId", value: SECRET } },
    { tag: "textarea", text: SECRET, labels: ["Passport number"] },
    { tag: "div", attrs: { contenteditable: "true", role: "textbox", "aria-label": "Security code" }, text: SECRET },
    { tag: "input", attrs: { name: "token", type: "hidden", value: SECRET } },
    { tag: "pre", text: `Backup codes ${SECRET}` },
    { tag: "a", attrs: { href: `https://fixture.test/verify?challenge=${SECRET}#${SECRET}` }, text: SECRET },
  ];
  for (const spec of specs) {
    const page = domFixturePage([spec, { tag: "button", text: "Continue" }], { title: `Echo ${SECRET}` });
    const observation = await observeStructuredPage(page);
    assert.equal(JSON.stringify(observation).includes(SECRET), false, JSON.stringify(spec));
    assert.equal(observation.privacyRedacted, true);
    if (observation.forms[0].sensitive) {
      const button = observation.controls.find(e => e.kind === "button");
      assert.throws(() => validatePlannerAction({ taskContract: contract, observation }, action(button.id, "click")), ownerOnly);
    }
  }
  const labelled = domFixturePage([{ tag: "span", attrs: { id: "label" }, text: "Routing number" },
    { tag: "input", attrs: { "aria-labelledby": "label", value: SECRET } }]);
  assert.equal((await observeStructuredPage(labelled)).controls[0].sensitive, true);
  const query = domFixturePage([{ tag: "p", text: SECRET }], { url: `https://fixture.test/account?x=${SECRET}#${SECRET}` });
  assert.equal(JSON.stringify(await observeStructuredPage(query)).includes(SECRET), false);
  const untrustedId = domFixturePage([{ tag: "input", attrs: { name: "apiKey", value: SECRET,
    "data-agent-labs-element-id": `el_${SECRET}` } }]);
  assert.equal(JSON.stringify(await observeStructuredPage(untrustedId)).includes(SECRET), false);
  const ordinary = domFixturePage([{ tag: "input", attrs: { name: "title", value: "Stage 9 Product" } }, { tag: "button", text: "Save draft" }]);
  assert.equal((await observeStructuredPage(ordinary)).controls[0].value, "Stage 9 Product");
});

test("executor independently refuses changed credential fields and withholds provider error echoes", async () => {
  let fills = 0;
  const changedPage = { async evaluateHandle() { return {evaluate:async()=>true,dispose:async()=>{}}; }, async evaluate() { return fixture({ name: "recoveryCode", value: SECRET }); },
    locator() { return { async count() { return 1; }, async fill() { fills++; throw new Error("No control should be touched."); } }; } };
  await assert.rejects(() => executePlannerAction(changedPage, action("el_title01"), ["browser.interact"], MOCK_COMMERCE_OBSERVATION), ownerOnly);
  assert.equal(fills, 0);
  await assert.rejects(() => observeStructuredPage({ async evaluate() { throw new Error(SECRET); } }),
    error => !JSON.stringify(error.failure).includes(SECRET));
  const safePage = { async evaluateHandle() { return {evaluate:async()=>true,dispose:async()=>{}}; }, async evaluate() { return MOCK_COMMERCE_OBSERVATION; }, locator() { return {
    async count() { return 1; }, async fill() { throw new Error(SECRET); } }; } };
  await assert.rejects(() => executePlannerAction(safePage, action("el_title01"), ["browser.interact"], MOCK_COMMERCE_OBSERVATION),
    error => error.failure.category === "action_failed" && !JSON.stringify(error.failure).includes(SECRET));
  await assert.rejects(() => executePlannerAction(safePage, { ...action(null, "complete"), text: SECRET }, [], MOCK_COMMERCE_OBSERVATION), /unrelated input/);
});

const chromiumPath = process.env.BROWSER_PRIVACY_CHROMIUM_PATH || ["/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync) || "/usr/bin/chromium";
test("real DOM redacts plaintext credentials, codes, labels, hidden values and contenteditable before observation", {
  skip: (!process.env.CI && !process.env.BROWSER_PRIVACY_CHROMIUM_PATH) || !existsSync(chromiumPath),
}, async () => {
  const browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.abort());
    const cases = [
      `<input type="text" name="apiKey" value="${SECRET}">`,
      `<input type="TEXT" id="access-token" value="${SECRET}">`,
      `<label for="entry">Recovery code ${SECRET}</label><input id="entry" value="${SECRET}">`,
      `<label>Passport number <textarea>${SECRET}</textarea></label>`,
      `<span id="label">Routing number</span><input aria-labelledby="label" value="${SECRET}">`,
      `<input autocomplete="section-checkout cc-number" value="${SECRET}">`,
      `<input autocomplete="one-time-code" value="${SECRET}">`,
      `<input name="taxpayerId" value="${SECRET}">`,
      `<div contenteditable="true" role="textbox" aria-label="Security code">${SECRET}</div>`,
      `<input type="hidden" name="token" value="${SECRET}"><p>${SECRET}</p>`,
      `<h1>Backup codes</h1><pre>${SECRET}</pre>`,
      `<a href="https://example.test/account?challenge=${SECRET}#${SECRET}">Continue ${SECRET}</a>`,
    ];
    for (const content of cases) {
      await page.setContent(`<html><head><title>Echo ${SECRET}</title></head><body><form action="https://example.test/"><div>${content}</div><button>Continue</button></form></body></html>`);
      const observation = await observeStructuredPage(page);
      assert.equal(JSON.stringify(observation).includes(SECRET), false, content);
      assert.equal(observation.privacyRedacted, true, content);
      const target = observation.controls.find(e => e.sensitive);
      if (target) await assert.rejects(() => executePlannerAction(page, action(target.id), ["browser.interact"], observation), ownerOnly);
    }
    await page.close();
  } finally { await browser.close(); }
});

test("executor rechecks changed fields and preserves ordinary synthetic draft behavior", {
  skip: (!process.env.CI && !process.env.BROWSER_PRIVACY_CHROMIUM_PATH) || !existsSync(chromiumPath),
}, async () => {
  const browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.abort());
    await page.setContent('<title>Draft product</title><label>Title<input name="title"></label><button>Save draft</button>');
    const before = await observeStructuredPage(page);
    const input = before.controls.find(e => e.kind === "input");
    const ordinary = { ...action(input.id), text: "Stage 9 Product" };
    const result = await executePlannerAction(page, ordinary, ["browser.interact"], before);
    assert.equal(result.after.controls.find(e => e.id === input.id).value, "Stage 9 Product");
    await page.locator("input").evaluate(e => { e.name = "recoveryCode"; e.type = "text"; });
    await assert.rejects(() => executePlannerAction(page, action(input.id), ["browser.interact"], before), ownerOnly);
    assert.equal(await page.locator("input").inputValue(), "Stage 9 Product");
    // Never include locator/provider exceptions, which may echo attempted input, in persisted failures.
    const safePage = { async evaluateHandle() { return {evaluate:async()=>true,dispose:async()=>{}}; }, async evaluate() { return MOCK_COMMERCE_OBSERVATION; }, locator() { return { async count() { return 1; }, async fill() { throw new Error(SECRET); } }; } };
    await assert.rejects(() => executePlannerAction(safePage, action("el_title01"), ["browser.interact"], MOCK_COMMERCE_OBSERVATION),
      error => error.failure.category === "action_failed" && !JSON.stringify(error.failure).includes(SECRET));
    await page.close();
  } finally { await browser.close(); }
});

test('ordinary search and tracking URLs preserve page semantics while URL parameters are removed', async () => {
  const page = domFixturePage([{tag:'input',attrs:{name:'title',value:'T-shirt'}},{tag:'button',text:'Save draft'},{tag:'a',attrs:{href:'/help?ref=footer'},text:'Help'}], {url:'https://fixture.test/search?q=shirts'});
  const observed = await observeStructuredPage(page);
  assert.equal(observed.url,'https://fixture.test/search');
  assert.equal(observed.controls[0].value,'T-shirt');
  assert.equal(observed.controls[1].text,'Save draft');
  assert.equal(observed.links[0].text,'Help');
  assert.equal(observed.privacyRedacted,undefined);
  const restored = sanitizeStructuredObservation({...observed,url:'https://fixture.test/search?q=shirts',links:[{...observed.links[0],href:'/help?ref=footer'}]});
  assert.equal(restored.controls[1].text,'Save draft');
  assert.equal(restored.links[0].href,'https://fixture.test/help');
});
test('unknown query and authentication query echoes remain fully withheld', async () => {
  for (const url of [`https://fixture.test/account?state=${SECRET}`,`https://fixture.test/path?x=${SECRET}`]) {
    const page = domFixturePage([{tag:'p',text:SECRET},{tag:'button',text:'Continue'}],{url});
    assert.equal(JSON.stringify(await observeStructuredPage(page)).includes(SECRET),false);
  }
});
test('DOM reorder cannot redirect a saved Save-draft action to Delete-draft', async () => {
  const page = domFixturePage([{tag:'button',text:'Save draft'},{tag:'button',text:'Delete draft'}]);
  let clicked = null;
  page.locator = selector => {
    const id = /="([^"]+)"/.exec(selector)?.[1];
    const matches = () => page.elements.filter(e=>e.getAttribute('data-agent-labs-element-id')===id);
    return {count:async()=>matches().length,click:async()=>{clicked=matches()[0]?.text;}};
  };
  const before = await observeStructuredPage(page), planned = action(before.controls[0].id,'click');
  page.elements[0].parentElement.children.reverse();
  await executePlannerAction(page,planned,['browser.interact'],before);
  assert.equal(clicked,'Save draft');
});


test('identically labelled reordered nodes keep their own identity and cannot retarget a saved action', async () => {
  const page = domFixturePage([{tag:'button',text:'Delete'},{tag:'button',text:'Delete'}]);
  let clicked = null;
  page.locator = selector => {
    const id = /="([^"]+)"/.exec(selector)?.[1];
    const matches = () => page.elements.filter(e=>e.getAttribute('data-agent-labs-element-id')===id);
    return {count:async()=>matches().length,click:async()=>{clicked=page.elements.indexOf(matches()[0]);}};
  };
  const before = await observeStructuredPage(page), planned = action(before.controls[0].id,'click');
  page.elements[0].parentElement.children.reverse();
  await executePlannerAction(page,planned,['browser.interact'],before);
  assert.equal(clicked,0);
});
