import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const page = readFileSync('src/app/dashboard/artifacts/page.tsx', 'utf8');
const actions = readFileSync('src/app/dashboard/artifacts/actions.ts', 'utf8');
const data = readFileSync('src/creative/data.ts', 'utf8');
test('Artifacts UI keeps private owner input, technical status, actual pixels and provenance visible', () => {
  for (const text of ['name="concept"', 'name="designInstructions"', 'name="confirmTechnicalOnly"', 'name="confirmBudget"', 'Design gallery', 'Independent visual review', 'Asset SHA-256', 'Source brief SHA-256', 'Provider receipts', 'Close expired run for review']) assert.ok(page.includes(text), text);
  assert.match(page, /Technical PASS is a reviewable design artifact/);
  assert.match(page, /UTC/);
  assert.doesNotMatch(page, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  assert.match(data, /createSignedUrls/); assert.doesNotMatch(data, /getPublicUrl/);
});
test('Creative actions are owner-scoped and approval does not launch a provider run', () => {
  const approve = actions.split('export async function approveCreativeCandidate')[1].split('export async function startCreativeRun')[0];
  assert.match(approve, /requireOwnerUiContext/); assert.match(approve, /maximumEstimateMicrousd/);
  assert.doesNotMatch(approve, /await start\(/);
  assert.match(actions, /if \(!launch.data\?\.shouldStart\)/);
  assert.match(actions, /close_expired_creative_run/);
});
test('Production approval UI keeps the evidence gate and separately confirmed scope', () => {
  for (const text of ['No current evidence-backed TEST candidates are eligible', 'name="decisionId"', 'name="rightsStatement"', 'name="confirmProductionScope"', 'name="confirmPolicyScreen"', 'Save candidate creative approval']) assert.ok(page.includes(text), text);
  const approve = actions.split('export async function approveProductionCreativeCandidate')[1].split('export async function closeExpiredCreativeRun')[0];
  for (const text of ['requireOwnerUiContext', 'currentProductionCandidate', 'productionCreativeApproval', 'candidate.business_id', 'selected.id !== decisions[0]?.id', 'approve_creative_candidate']) assert.ok(approve.includes(text), text);
  assert.doesNotMatch(approve, /await start\(|create_product_candidate|record_product_assessment|service.role/);
});
test('Artifacts loads reservations and receipts without dropping expired runs or hiding uncertainty', () => {
  assert.match(data, /from\("creative_cost_reservations"\)/);
  assert.match(data, /from\("creative_cost_settlements"\)/);
  assert.match(data, /mergeCreativeCosts/);
  assert.match(data, /reservations\.error/);
  assert.doesNotMatch(data, /\.gt\("capability_expires_at"|\.eq\("status", "running"\)/);
  assert.match(page, /summarizeCreativeCosts\(costs\)/);
  assert.match(page, /creativeCostStatus\(c, run\?\.capabilityExpired/);
  assert.match(page, /Missing receipts do not prove zero spend or permit another attempt/);
  assert.match(page, /CREATIVE_COST_COMMITMENT_EXPLANATION/);
  assert.match(readFileSync("src/creative/cost-display.ts", "utf8"), /larger of each reservation or saved amount, not both/);
  assert.match(data, /costsAvailable: !runs\.error && !reservations\.error && !costs\.error/);
  assert.match(page, /!data\.costsAvailable \? "Unavailable"/);
  assert.match(page, /The cost ledger could not be fully loaded/);
});


test('owner explicitly selects the image bound and history keeps each saved bound visible', () => {
  assert.equal((page.match(/name="maximumGenerations"/g) ?? []).length, 2);
  assert.equal((page.match(/name="maximumGenerations" required defaultValue="1"/g) ?? []).length, 2);
  assert.match(page, /One image, no repair \(up to 4 provider calls\)/);
  assert.match(page, /Image limit: \{a.snapshot.maximumGenerations\}/);
  assert.match(page, /No repair; a failed review stops for owner review/);
  assert.equal((actions.match(/currentCreativeQuote\(maximumGenerations, generatorModel, true\)/g) ?? []).length, 2);
  assert.match(actions, /technicalCreativeApproval\(businessId, candidate.data.candidateId, maximumMicrousd, design, approvalId, maximumGenerations, generatorModel\)/);
  assert.match(actions, /limit !== "1" && limit !== "2"/);
});


test('new approvals require an explicit BFL model selection, terms and honest data-use acknowledgement', () => {
  assert.equal((page.match(/name="generatorModel" required defaultValue=""/g) ?? []).length, 2);
  assert.equal((page.match(/name="confirmDataUse" required/g) ?? []).length, 2);
  for (const text of ['OpenRouter lists Black Forest Labs as not training on requests and retaining data for 30 days', 'zero-data-retention route', 'API terms include a training license', 'not a privacy guarantee', 'BFL developer terms', 'BFL FLUX API terms', 'at least 975 × 975', 'original PNG bytes and any provider marking retained', 'Saved image model:', 'a.quote?.generatorModel']) assert.ok(page.includes(text), text);
  assert.match(actions, /value\(form, "generatorModel"\) !== FLUX_KLEIN_PNG_POLICY.modelId/);
  assert.match(actions, /value\(form, "confirmDataUse"\) !== "on"/);
  for (const name of ['approveCreativeCandidate', 'approveProductionCreativeCandidate']) {
    const approve = actions.split(`export async function ${name}`)[1].split('export async function')[0];
    assert.ok(approve.indexOf('selectedProvider(form)') < approve.indexOf('currentCreativeQuote('));
    assert.ok(approve.indexOf('selectedProvider(form)') < approve.indexOf('approve_creative_candidate'));
  }
});


test('new provider-bound forms cannot infer repair authority from an omitted image limit', () => {
  const parser = actions.split('function generationLimit')[1].split('function selectedProvider')[0];
  assert.match(parser, /if \(!limit\) (?:return )?error\(/);
  assert.doesNotMatch(parser, /if \(!limit\) return 2/);
  assert.match(parser, /limit !== "1" && limit !== "2"/);
});
