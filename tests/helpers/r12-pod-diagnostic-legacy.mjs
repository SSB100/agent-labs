/** Synthetic isolated exposure fixture only. No copied Production rows.
 * Shape comes from aggregate counts: research [1,1,1,1,2,3,4,4,4,5],
 * creative [1,3,3,4]; one creative settlement has an absent receipt and
 * a separate known attestation. Every synthetic liability/actual is 1.
 * Call before this Business's FIRST R05 cap/owner confirmation. Historical
 * settlements without attestations cannot be inserted after a cap exists.
 * Does not change a funding binding, cap, policy, grant, or existing row.
 */
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0];
const researchShape = [1, 1, 1, 1, 2, 3, 4, 4, 4, 5];
const creativeShape = [1, 3, 3, 4];
const researchKeys = ['plan:1', 'search:1', 'select:1', 'strategy:1', 'review:1'];
const creativeKeys = ['brief:1', 'screen:1', 'generate:1', 'review:1'];

export async function seedLegacyShape(db, a) {
  const require = createRequire(path.resolve(process.cwd(), 'package.json'));
  const {buildDiscoveryIntentFromGoal} = require('./.core-tests/products/discovery-v2-goal.js');
  const environment = await one(db, 'select current_database() database, current_user actor, version() engine');
  assert.ok((environment.database === 'r12_test' && environment.actor === 'r12_test') ||
    /PGlite/.test(environment.engine), 'Refuse non-isolated database');
  const business = a.f.businessId, owner = a.f.ownerId;
  const identity = await one(db, 'select name, owner_user_id from public.businesses where id=$1', [business]);
  assert.equal(identity?.name, 'Inert owner-goal research', 'Existing synthetic fixture Business required');
  assert.equal(identity.owner_user_id, owner);
  assert.equal((await one(db, 'select count(*)::int n from private.r05_cap_versions where business_id=$1', [business])).n,
    0, 'Seed historical legacy composition before the first R05 cap; never bypass trusted-settlement guards');
  const before = await one(db, `select
    (select count(*)::int from public.product_research_cost_reservations where business_id=$1) research,
    (select count(*)::int from public.creative_cost_reservations where business_id=$1) creative,
    (select count(*)::int from private.r05_legacy_attestations where business_id=$1) attestations`, [business]);
  assert.deepEqual(before, {research: 0, creative: 0, attestations: 0}, 'Never duplicate or replace existing legacy history');
  const snapshot = async () => one(db, `select
    (select jsonb_agg(to_jsonb(x) order by id) from private.r12_owner_funding_bindings x where business_id=$1) funding,
    (select count(*)::int from private.r05_requests where business_id=$1) requests,
    (select count(*)::int from private.r05_markers where business_id=$1) markers,
    (select count(*)::int from private.r05_settlements where business_id=$1) settlements`, [business]);
  const protectedBefore = await snapshot();
  const researchDefinition = a.plan.steps[0].workflowDefinitionId;
  const creativeDefinition = await one(db, "select id from public.workflow_definitions where workflow_key='etsy.creative-pipeline' and version='1.0.0'");
  assert.ok(creativeDefinition?.id, 'Existing migrated creative fixture definition required');

  let fundingRoot;
  for (const calls of researchShape) {
    const workflow = randomUUID(), experiment = randomUUID();
    const intent = buildDiscoveryIntentFromGoal({id: experiment, businessId: business,
      goal: 'Research synthetic original shirt opportunities for an isolated cost-ledger diagnostic.',
      audienceHint: 'Synthetic adult fixture audience', maximumMicrousd: 1000000, maximumCollections: 1});
    const policyHash = (await one(db, 'select private.stage14_hash($1::jsonb) hash', [intent])).hash;
    const variables = {intent, policyHash, semanticGoalHash: hash({syntheticGoal: business}),
      budgetAuthorityRootId: experiment, ownerKickoff: {followUpBasis: null}};
    fundingRoot ??= {rootId:experiment,semanticHash:variables.semanticGoalHash,intent,committedMicrounits:calls};
    await db.query(`insert into public.workflow_runs(id,business_id,workflow_definition_id,idempotency_key,status,input)
      values($1,$2,$3,$4,'failed',$5)`, [workflow, business, researchDefinition,
      'inert-legacy-shape-research:' + experiment, {intentId: experiment, syntheticDiagnosticHistory: true}]);
    await db.query(`insert into public.product_experiments
      (id,business_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan,discovery_version,failure,completed_at)
      values($1,$2,$3,$4,'Synthetic retained research exposure',$5,'Synthetic adult fixture audience','failed',
      '{"version":"pod-discovery-2.0","testPlan":null}','pod-discovery-2.0','Inert diagnostic history',clock_timestamp())`,
      [experiment, business, workflow, hash({experiment}), variables]);
    for (let call = 0; call < calls; call++) {
      const reservation = randomUUID(), receipt = 'gen-inert-legacy-research-' + reservation;
      await db.query(`insert into public.product_research_cost_reservations
        (id,business_id,experiment_id,workflow_run_id,attempt_key,reserved_microusd,request_hash,estimate)
        values($1,$2,$3,$4,$5,1,$6,'{"version":"discovery-estimate-2.0","syntheticDiagnosticHistory":true}')`,
        [reservation, business, experiment, workflow, researchKeys[call], hash({reservation})]);
      await db.query(`insert into public.product_research_cost_settlements
        (business_id,reservation_id,reported_microusd,provider_request_id,fingerprint) values($1,$2,1,$3,$4)`,
        [business, reservation, receipt, hash({receipt})]);
    }
  }

  for (const [index, calls] of creativeShape.entries()) {
    const workflow = randomUUID(), candidate = randomUUID(), approval = randomUUID(), run = randomUUID();
    await db.query(`insert into public.product_candidates
      (id,business_id,fingerprint,concept,audience,hypothesis,original_design,rights_status,source_domains)
      values($1,$2,$3,'Synthetic original fixture','Synthetic adult fixture audience',
      'Synthetic exposure fixture only; no demand claim.',true,'confirmed',array['fixture.invalid'])`,
      [candidate, business, hash({candidate})]);
    await db.query(`insert into public.creative_approvals
      (id,business_id,candidate_id,purpose,snapshot,scope_hash,approval_hash,quote,maximum_microusd,owner_user_id,approved_at,expires_at)
      values($1,$2,$3,'technical_qualification','{"publicationAllowed":false,"syntheticDiagnosticHistory":true}',
      $4,$5,'{}',4,$6,now(),now()+interval '1 day')`,
      [approval, business, candidate, hash({scope: approval}), hash({approval}), owner]);
    await db.query(`insert into public.workflow_runs(id,business_id,workflow_definition_id,status,idempotency_key,input,state,completed_at)
      values($1,$2,$3,'failed',$4,$5,'{"productionReady":false,"publicationAllowed":false}',now())`,
      [workflow, business, creativeDefinition.id, 'inert-legacy-shape-creative:' + run,
        {creativeRunId: run, approvalId: approval, syntheticDiagnosticHistory: true}]);
    await db.query(`insert into public.creative_runs
      (id,business_id,candidate_id,approval_id,workflow_run_id,catalog_snapshot,capability_expires_at)
      values($1,$2,$3,$4,$5,'{"syntheticDiagnosticHistory":true}',now()-interval '1 hour')`,
      [run, business, candidate, approval, workflow]);
    for (let call = 0; call < calls; call++) {
      const callKey = creativeKeys[call], receipt = 'gen-inert-legacy-creative-' + run + '-' + call;
      const attested = index === 0 && call === 0;
      await db.query(`insert into public.creative_cost_reservations
        (creative_run_id,business_id,call_key,reserved_microusd,request_hash,model,provider,estimate)
        values($1,$2,$3,1,$4,'synthetic-no-provider','openrouter','{"syntheticDiagnosticHistory":true}')`,
        [run, business, callKey, hash({run, callKey})]);
      await db.query(`insert into public.creative_cost_settlements
        (creative_run_id,business_id,call_key,reported_microusd,provider_request_id,receipt)
        values($1,$2,$3,1,$4,'{"syntheticDiagnosticHistory":true}')`,
        [run, business, callKey, attested ? null : receipt]);
      if (attested) await db.query(`insert into private.r05_legacy_attestations
        (business_id,workflow_run_id,source_key,reported_microusd,provider_request_id,receipt_hash)
        values($1,$2,$3,1,$4,$5)`,
        [business, workflow, 'creative:' + run + ':' + callKey, receipt, hash({attestation: receipt})]);
    }
  }
  assert.deepEqual(await snapshot(), protectedBefore, 'Legacy seeding cannot alter funding bindings or R05 history');
  const result = await one(db, `select
    (select count(*)::int from public.product_research_cost_reservations where business_id=$1) researchReservations,
    (select count(*)::int from public.product_research_cost_settlements where business_id=$1) researchSettlements,
    (select count(*)::int from public.creative_cost_reservations where business_id=$1) creativeReservations,
    (select count(*)::int from public.creative_cost_settlements where business_id=$1) creativeSettlements,
    (select count(*)::int from public.creative_cost_settlements where business_id=$1 and provider_request_id is null) receiptAbsent,
    (select count(*)::int from private.r05_legacy_attestations where business_id=$1) attestations,
    (select count(*)::int from private.r05_legacy_exposure($1) where unknown) rawUnknown,
    (select count(*)::int from private.r05_exposure($1) where unknown and (source_key like 'research:%' or source_key like 'creative:%')) effectiveUnknown,
    (select sum(held)::int from private.r05_exposure($1) where source_key like 'research:%' or source_key like 'creative:%') held`, [business]);
  assert.deepEqual(result, {researchreservations: 26, researchsettlements: 26,
    creativereservations: 11, creativesettlements: 11, receiptabsent: 1,
    attestations: 1, rawunknown: 1, effectiveunknown: 0, held: 37});
  return {version: 'r12.synthetic-legacy-shape.1', ...result, fundingRoot,
    researchExperimentSizes: researchShape, creativeRunSizes: creativeShape,
    syntheticHistory: true, providerCalls: 0, copiedProductionRows: 0};
}
