import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { creativePromptApproval } = require('../.core-tests/creative/prompt-approval.js');
const { technicalCreativeApproval } = require('../.core-tests/creative/proposal.js');
const id = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
function fixture() { return technicalCreativeApproval(id(1), id(2), 1_000_000, { concept: 'Synthetic fixture', audience: 'Adult fixture audience',
  designInstructions: 'Synthetic original nature artwork, without references or protected elements, on an intentional opaque square.' }, id(3)); }

test('identical owner policy text is grouped losslessly without changing authority or the immutable approval', () => {
  const approval = fixture(), original = structuredClone(approval), prompt = creativePromptApproval(approval);
  assert.deepEqual(approval, original);
  assert.equal(prompt.policyScreen.length, 2);
  const { policyScreenEncoding, policyScreen, ...rest } = prompt;
  assert.match(policyScreenEncoding, /original ungrouped approval/);
  const expanded = policyScreen.flatMap(({ categories, ...screen }) => categories.map(category => ({ category, ...screen })));
  assert.deepEqual({ ...rest, policyScreen: expanded }, approval);
  assert.equal(prompt.publicationAllowed, false);
  assert.ok(JSON.stringify(prompt).length < JSON.stringify(approval).length - 1000);
});

test('checks with different status, rationale or exact source order are never grouped together', () => {
  for (const field of ['status', 'rationale', 'sourceUrls']) {
    const approval = fixture();
    approval.policyScreen.forEach((screen, i) => { screen[field] = field === 'sourceUrls' ? [`https://example.com/fixture-${i}`] : `${screen[field]}-${i}`; });
    assert.deepEqual(creativePromptApproval(approval), approval);
  }
});

test('additional owner restrictions prevent grouping and remain visible', () => {
  const approval = fixture(); approval.policyScreen[0].ownerRestriction = 'Do not introduce any new slogans';
  assert.deepEqual(creativePromptApproval(approval), approval);
});

test('grouping preserves original order even when identical checks are separated', () => {
  const approval = fixture(); approval.policyScreen[2].rationale = 'A distinct synthetic rationale for this category.';
  const prompt = creativePromptApproval(approval);
  const { policyScreenEncoding, policyScreen, ...rest } = prompt;
  assert.ok(policyScreenEncoding);
  const expanded = policyScreen.flatMap(({ categories, ...screen }) => categories.map(category => ({ category, ...screen })));
  assert.deepEqual({ ...rest, policyScreen: expanded }, approval);
});
