import assert from 'node:assert/strict';

export const r12FocusedAdoptionMigration = '20261007020049_r12_focused_test_adoption.sql';
const approvalSignature = 'private.stage14_assert_approval(uuid,jsonb)';
const signature = row => row.signature ?? row.id;
const contract = row => {
  const result = { ...row };
  delete result.body;
  delete result.definition;
  return result;
};

export function assertLegacyFunctionContract(actual, prior, adoptionReviewed = false) {
  assert.ok(actual, `Legacy function still exists: ${signature(prior)}`);
  const expected = contract(prior);
  // Only the exact reviewed migration boundary below can enable this exception.
  // Its lock-taking adoption check needs VOLATILE's fresh statement snapshots.
  if (adoptionReviewed && signature(prior) === approvalSignature) {
    assert.equal(prior.volatility, 's', 'Stage14 approval was originally STABLE');
    expected.volatility = 'v';
  }
  assert.deepEqual(contract(actual), expected, `Legacy function contract: ${signature(prior)}`);
}

export function assertR12FocusedAdoptionTransition(before, after) {
  const approvals = before.filter(row => signature(row) === approvalSignature);
  assert.equal(approvals.length, 1, 'One exact legacy Stage14 approval signature');
  const installed = new Map(after.map(row => [row.id, row]));
  for (const prior of before) assertLegacyFunctionContract(installed.get(prior.id), prior, true);

  const prior = approvals[0], actual = installed.get(prior.id);
  const definition = prior.definition ?? prior.body;
  const marker = 'begin\n  select * into strict c from public.product_candidates where id=p_candidate_id;';
  const replacement = "begin\n  if p_snapshot ? 'focusedPilotBinding' then\n    perform private.stage14_assert_focused_adoption(p_candidate_id,p_snapshot);return;\n  end if;\n  select * into strict c from public.product_candidates where id=p_candidate_id;";
  assert.equal(definition.split('\n STABLE\n').length, 2, 'One prior STABLE declaration');
  assert.equal(definition.split(marker).length, 2, 'One exact Stage14 adoption insertion point');
  // Check the body at this boundary too: neither arbitrary body changes nor a
  // blanket volatility exclusion can pass as the reviewed R12 transition.
  // pg_get_functiondef omits VOLATILE, PostgreSQL's default volatility.
  assert.equal(actual.definition ?? actual.body,
    definition.replace('\n STABLE\n', '\n').replace(marker, replacement),
    'R12 makes only the pinned Stage14 adoption branch and STABLE-to-VOLATILE change');
  return true;
}
