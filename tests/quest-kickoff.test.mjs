import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const read = path => readFileSync(path, 'utf8');
function load(path, overrides = {}) {
  const output = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const sourceModule = { exports: {} };
  new Function('require', 'module', 'exports', output)(name => Object.hasOwn(overrides, name) ? overrides[name] : require(name), sourceModule, sourceModule.exports);
  return sourceModule.exports;
}
const draft = load('src/lib/core-ui/quest-draft.ts');
const ownerId = 'owner-one';
const businesses = [{ id: 'business-one', name: 'Nature Works' }];
const quote = { one: 370395, two: 530914, verifiedAt: '2026-10-02T03:00:00Z' };
const baseProps = { ownerId, businesses, available: true, quote };
function stateAt(step) {
  return { ...draft.newQuestState(businesses[0].id), step, hydrated: true, storage: 'local', reviewedEstimate: step === 2 ? quote.one : null };
}
function loadView(state, { pending = false, dispatch = () => {} } = {}) {
  const refs = [];
  let refIndex = 0;
  const component = load('src/components/guided/quest-kickoff.tsx', {
    react: { ...React, useReducer: () => [state, dispatch], useId: () => 'fixture', useRef: value => refs[refIndex++] ??= { current: value }, useEffect: () => {}, useCallback: fn => fn },
    'react-dom': { useFormStatus: () => ({ pending }) },
    '@/app/dashboard/products/discovery-actions': { startGeographicDiscovery: () => {} },
    '@/lib/core-ui/quest-draft': draft,
    './quest-kickoff.css': {},
  });
  return { ...component, resetRefs: () => { refIndex = 0; } };
}
function markup(state, props = {}, options = {}) {
  return renderToStaticMarkup(React.createElement(loadView(state, options).QuestKickoff, { ...baseProps, ...props }));
}
function elements(element, predicate) {
  if (!element || typeof element !== 'object') return [];
  const found = predicate(element) ? [element] : [];
  return found.concat(React.Children.toArray(element.props?.children).flatMap(child => elements(child, predicate)));
}
function formAt(state, props = {}, options = {}) {
  const view = loadView(state, options);
  const wrapper = view.QuestKickoff({ ...baseProps, ...props });
  const tree = wrapper.type(wrapper.props);
  return elements(tree, element => element.type === 'form')[0];
}
function submit(form) {
  let prevented = false;
  form.props.onSubmit({ preventDefault() { prevented = true; } });
  return prevented;
}

test('browser presentation constants remain aligned with the original geographic research flow', () => {
  const server = read('src/products/discovery-v2-goal.ts');
  assert.ok(server.includes(JSON.stringify(draft.QUEST_DEFAULT_GOAL)));
  assert.ok(server.includes(JSON.stringify(draft.QUEST_MARKET_SCOPE)));
  assert.doesNotMatch(read('src/lib/core-ui/quest-draft.ts'), /\bimport\b|node:crypto/);
  assert.doesNotMatch(read('src/components/guided/quest-kickoff.tsx'), /from ["'].*(?:discovery-goal-workspace|discovery-v2-goal)["']/);
});

test('session draft is versioned, owner-scoped, input-only and never saves consent', () => {
  const state = { ...stateAt(2), consentKey: 'approved', confirmResearch: 'on', credential: 'do-not-save' };
  const saved = draft.serializeQuestDraft(ownerId, state);
  assert.notEqual(draft.questDraftStorageKey(ownerId), draft.questDraftStorageKey('owner-two'));
  assert.match(draft.questDraftStorageKey(ownerId), /:v1:/);
  assert.doesNotMatch(saved, /consent|confirmResearch|approved|credential|do-not-save/);
  const restored = draft.restoreQuestDraft(saved, ownerId, ['business-one']);
  assert.deepEqual(restored, { draft: state.draft, step: 2, reviewedEstimate: quote.one });
  const resumed = draft.questReducer(stateAt(0), { type: 'restore', saved: restored, storageAvailable: true });
  assert.equal(resumed.step, 2);
  assert.equal(resumed.consentKey, null);
  assert.equal(resumed.restored, true);
  assert.equal(resumed.hydrated, true);
});

test('session restore rejects malformed, foreign, obsolete or oversized drafts and strips extra fields', () => {
  const saved = JSON.parse(draft.serializeQuestDraft(ownerId, stateAt(2)));
  for (const raw of ['{', 'null', '{}', 'x'.repeat(12001), JSON.stringify({ ...saved, version: 0 }), JSON.stringify({ ...saved, ownerId: 'different-owner' }), JSON.stringify({ ...saved, draft: { ...saved.draft, maximumCollections: '3' } })]) {
    assert.equal(draft.restoreQuestDraft(raw, ownerId, ['business-one']), null);
  }
  const restored = draft.restoreQuestDraft(JSON.stringify({ ...saved, consentKey: 'persisted-approval', draft: { ...saved.draft, confirmResearch: 'on', token: 'untrusted' } }), ownerId, ['business-one']);
  assert.deepEqual(Object.keys(restored.draft).sort(), ['audienceHint', 'businessId', 'goal', 'maximumCollections', 'maximumUsd']);
  const removedBusiness = draft.restoreQuestDraft(JSON.stringify(saved), ownerId, ['business-two']);
  assert.equal(removedBusiness.draft.businessId, '');
  assert.equal(removedBusiness.step, 0);
  assert.equal(removedBusiness.draft.goal, saved.draft.goal);
});

test('Back, field edits, errors and reload invalidate consent without losing input', () => {
  const state = { ...stateAt(2), draft: { ...stateAt(2).draft, audienceHint: 'Adult hikers' }, consentKey: 'approved' };
  for (const event of [{ type: 'step', step: 1 }, { type: 'edit', field: 'goal', value: 'Research a starting market for original hiking T-shirts.' }, { type: 'issues', issues: [{ field: 'goal', message: 'Check goal' }] }]) {
    const next = draft.questReducer(state, event);
    assert.equal(next.consentKey, null);
    assert.equal(next.draft.audienceHint, 'Adult hikers');
  }
  const back = draft.questReducer(state, { type: 'step', step: 1 });
  const forward = draft.questReducer(back, { type: 'step', step: 2, reviewedEstimate: quote.one });
  assert.deepEqual(forward.draft, state.draft);
  assert.equal(forward.consentKey, null);
  assert.equal(draft.questReducer(state, { type: 'storage-unavailable' }).storage, 'unavailable');
});

test('every editable field, owner, quote check, price or availability change invalidates the review key', () => {
  const state = stateAt(2);
  const key = draft.questReviewKey(ownerId, state.draft, quote, true);
  for (const field of Object.keys(state.draft)) {
    const value = field === 'maximumCollections' ? '2' : `${state.draft[field]}x`;
    assert.notEqual(draft.questReviewKey(ownerId, { ...state.draft, [field]: value }, quote, true), key);
  }
  assert.notEqual(draft.questReviewKey('other-owner', state.draft, quote, true), key);
  assert.notEqual(draft.questReviewKey(ownerId, state.draft, { ...quote, one: quote.one + 1 }, true), key);
  assert.notEqual(draft.questReviewKey(ownerId, state.draft, { ...quote, verifiedAt: '2026-10-02T04:00:00Z' }, true), key);
  assert.notEqual(draft.questReviewKey(ownerId, state.draft, quote, false), key);
});

test('natural research requests remain usable while clear unrelated actions stop before the paid form', () => {
  for (const goal of [draft.QUEST_DEFAULT_GOAL, 'Research the best market to sell in and recommend three concepts.', 'Compare geographic markets for original hiking T-shirts.', 'Where should I sell my original nature T-shirts?', 'Help me choose a starting market for original nature T-shirts.', 'Compare T-shirt markets, not mugs or posters.', 'Compare original T-shirts rather than mugs and posters.', 'Where could original shirts do well, excluding mugs, posters and stickers?', 'I want a starting geographic market for original nature T-shirts.']) {
    assert.equal(draft.isSupportedQuestGoal(goal), true, goal);
  }
  for (const goal of ['Book me a flight to London next week.', 'Send an email to my whole team this afternoon.', 'Build an app to recommend products and markets.', 'Write a birthday poem for my friend today.', 'Compare Bitcoin and crypto investment markets.', 'Research the best markets for mugs and posters.', 'Research mugs and T-shirts in the best markets.', 'Compare T-shirt markets and mugs, not posters.', 'Generate images for original T-shirt designs.', 'Publish listings for my original nature T-shirts.']) {
    assert.equal(draft.isSupportedQuestGoal(goal), false, goal);
    assert.equal(draft.validateQuestDraft({ ...stateAt(0).draft, goal }, ['business-one'], 'goal')[0].field, 'goal');
  }
  assert.equal(draft.validateQuestDraft({ ...stateAt(0).draft, audienceHint: 'ab' }, ['business-one'], 'goal')[0].field, 'audienceHint');
  assert.equal(draft.validateQuestDraft({ ...stateAt(0).draft, businessId: 'foreign' }, ['business-one'])[0].field, 'businessId');
});

test('allowance format and fixed collection estimates preserve the existing initial US$1 ceiling', () => {
  assert.equal(draft.questAllowanceMicrousd('0.500000'), 500000);
  assert.equal(draft.questAllowanceMicrousd('0.000001'), 1);
  assert.equal(draft.questAllowanceMicrousd('1'), 1000000);
  for (const value of ['0', '-1', '2', '1.000001', '0.0000001', 'USD 1', 'Infinity', '1e-1', '']) assert.equal(draft.questAllowanceMicrousd(value), null, value);
  assert.equal(draft.questEstimate(stateAt(0).draft, quote), quote.one);
  assert.equal(draft.questEstimate({ ...stateAt(0).draft, maximumCollections: '2' }, quote), quote.two);
  for (const invalid of [null, { ...quote, one: NaN }, { ...quote, two: 0 }, { ...quote, one: 0.5 }, { ...quote, verifiedAt: 'invalid' }]) assert.equal(draft.questEstimate(stateAt(0).draft, invalid), null);
});

test('all steps preserve exact action fields, labels, local-only disclosure and experimental status', () => {
  for (const step of [0, 1, 2]) {
    const html = markup(stateAt(step));
    assert.match(html, /Experimental · live qualification incomplete/);
    assert.match(html, /has not yet passed live end-to-end qualification/);
    assert.match(html, /browser tab/);
    assert.match(html, /Step [123] of 3/);
    assert.match(html, /aria-current="step"/);
    for (const name of ['businessId', 'goal', 'audienceHint', 'maximumCollections', 'maximumUsd']) assert.equal((html.match(new RegExp(`name="${name}"`, 'g')) || []).length, 1, `${step}:${name}`);
    assert.doesNotMatch(html, /name="(?:sourceDomains|ownerId|score|provider|workflowId|approvalId)"/);
    if (step !== 2) assert.doesNotMatch(html, /name="confirmResearch"|Start bounded research/);
  }
  assert.match(markup(stateAt(0)), /United States, United Kingdom, Australia and New Zealand/);
  const review = markup(stateAt(2));
  assert.match(review, /name="confirmResearch"/);
  assert.match(review, /recommendation does not approve image generation, listings, advertising or purchases/);
  assert.match(review, /Repeated submissions reuse the saved goal/);
  assert.match(review, /0.370395/);
  assert.match(review, /fresh complete quote/);
  assert.match(review, /Calls stop on uncertain charges/);
});

test('only a reviewed, funded, available, freshly confirmed final step can submit the server action', () => {
  for (const step of [0, 1]) {
    const events = [];
    const form = formAt(stateAt(step), {}, { dispatch: event => events.push(event) });
    assert.equal(form.props.action, undefined);
    assert.equal(submit(form), true);
    assert.equal(events[0].type, 'step');
  }
  const reviewed = stateAt(2);
  assert.equal(submit(formAt(reviewed)), true);
  reviewed.consentKey = draft.questReviewKey(ownerId, reviewed.draft, quote, true);
  const approvedForm = formAt(reviewed);
  assert.equal(typeof approvedForm.props.action, 'function');
  assert.equal(submit(approvedForm), false);
  assert.equal(submit(approvedForm), true, 'same-tick double submission is blocked');
  for (const props of [{ quote: null }, { available: false }, { quote: { ...quote, one: 700000 } }, { quote: { ...quote, verifiedAt: '2026-10-02T04:00:00Z' } }, { businesses: [] }]) assert.equal(submit(formAt(reviewed, props)), true);
  assert.equal(submit(formAt({ ...reviewed, draft: { ...reviewed.draft, goal: 'Book me a flight to London next week.' } })), true);
});

test('blocked, pending, changed-quote and restored review states stay honest and cannot start accidentally', () => {
  const review = stateAt(2);
  review.consentKey = draft.questReviewKey(ownerId, review.draft, quote, true);
  assert.match(markup(review, { available: false }), /awaiting its registered workflow and safety checks/);
  assert.match(markup(review, { quote: null }), /complete quote is verified/);
  const changed = markup(review, { quote: { ...quote, one: 410000 } });
  assert.match(changed, /estimate changed/);
  assert.doesNotMatch(changed, /checked=""/);
  const pending = markup(review, {}, { pending: true });
  assert.match(pending, /Reserving the research workflow/);
  assert.match(pending, /Please keep this page open/);
  assert.match(pending, /type="submit" disabled=""/);
  assert.match(pending, /type="button" disabled=""/);
  assert.match(markup({ ...stateAt(2), restored: true }), /Approval is never saved/);
  assert.match(markup({ ...stateAt(0), storage: 'unavailable' }), /Local saving is unavailable/);
});

test('accessibility styles provide 44px targets, explicit focus, readable boundaries and mobile stacking', () => {
  const source = read('src/components/guided/quest-kickoff.tsx');
  const css = read('src/components/guided/quest-kickoff.css');
  assert.match(source, /role="alert"/);
  assert.match(source, /headingRef\.current\?\.focus\(\)/);
  assert.match(source, /errorRef\.current\?\.focus\(\)/);
  assert.match(source, /aria-describedby/);
  assert.match(source, /htmlFor/);
  assert.match(css, /min-height: 46px/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /max-width: 700px/);
  assert.match(css, /prefers-reduced-motion/);
  const remSizes = [...css.matchAll(/font-size:\s*([.\d]+)rem/g)].map(match => Number(match[1]));
  assert.ok(remSizes.every(size => size >= .875), "Utility typography must stay at least 14px at the default root size");
});


test('unreadable Business context preserves the local draft and never suggests creating a Business', () => {
  const html = markup(stateAt(0), { businesses: [], businessesUnavailable: true });
  assert.match(html, /Business context is unavailable/);
  assert.match(html, /Businesses could not be loaded/);
  assert.match(html, /saved local draft is left unchanged/);
  assert.doesNotMatch(html, /Create a Business|Choose a Business|<form|name="businessId"/);
  const knownEmpty = markup(stateAt(0), { businesses: [] });
  assert.match(knownEmpty, /Create a Business before starting research/);
});
