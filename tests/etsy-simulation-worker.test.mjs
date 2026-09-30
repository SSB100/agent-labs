import assert from "node:assert/strict";
import test from "node:test";
import discovery from "../.core-tests/packs/etsy-discovery.js";
import simulation from "../.core-tests/packs/etsy-simulation-worker.js";
import durable from "../.core-tests/packs/durable-simulation.js";

const now = "2026-09-30T08:00:00Z";
function setup() {
  const fixture = discovery.simulateEtsyProductDiscovery({ now });
  return { fixture, workers: fixture.snapshot.releases.flatMap(release => release.manifest.workers) };
}

test("Etsy workers exercise prompt assembly and actual model routes with scoped mock responses", async () => {
  const { fixture, workers } = setup();
  for (const stage of fixture.stages) {
    const worker = workers.find(entry => entry.manifest.worker.workerKey === stage.receipt.workerKey);
    const adapter = new simulation.EtsyDiscoverySimulationAdapter();
    const result = await simulation.executeEtsyDiscoverySimulationWorker(worker, stage.context, adapter);
    assert.deepEqual(result.output, stage.outputArtifact.content);
    assert.equal(result.receipt.modelRoutingExecuted, true);
    assert.equal(result.receipt.mockProvider, true);
    assert.equal(result.receipt.providerExecuted, false);
    assert.equal(result.receipt.qualificationEvaluated, false);
    assert.equal(result.receipt.totalReportedCostUsd, 0);
    assert.equal(result.receipt.modelRouteKey, worker.execution.routeKey);
    assert.equal(adapter.requests.length, 1);
    const sent = JSON.parse(adapter.requests[0].messages.find(message => message.role === "user").content);
    assert.deepEqual(sent, stage.context);
    assert.deepEqual(Object.keys(sent).sort(), ["inputArtifacts", "taskContract"]);
  }
});

test("simulated primary failure takes the bounded independent fallback and records truthful receipts", async () => {
  const { fixture, workers } = setup();
  for (const stage of fixture.stages) {
    const worker = workers.find(entry => entry.manifest.worker.workerKey === stage.receipt.workerKey);
    const adapter = new simulation.EtsyDiscoverySimulationAdapter({ failPrimary: true });
    const result = await simulation.executeEtsyDiscoverySimulationWorker(worker, stage.context, adapter);
    assert.equal(adapter.requests.length, 2);
    assert.notEqual(adapter.requests[0].model.providerFamily, adapter.requests[1].model.providerFamily);
    assert.deepEqual(result.receipt.modelAttempts.map(attempt => attempt.outcome), ["failed", "completed"]);
    assert.equal(result.receipt.providerType, "mock");
  }
});

test("model-produced unsupported claims are rejected before a caller can persist output", async () => {
  const { fixture, workers } = setup();
  const stage = fixture.stages[1];
  const worker = workers.find(entry => entry.manifest.worker.workerKey === stage.receipt.workerKey);
  class CorruptAdapter extends simulation.EtsyDiscoverySimulationAdapter {
    async invokeStructured(request) {
      const response = await super.invokeStructured(request);
      response.output.requiredChecks = ["verify_product_print_specs"];
      return response;
    }
  }
  await assert.rejects(() => simulation.executeEtsyDiscoverySimulationWorker(worker, stage.context, new CorruptAdapter()), /omitted policy/);
  const missing = structuredClone(stage.context);
  missing.inputArtifacts.find(artifact => artifact.metadata.knowledgeKey === "pod.production").content.guidelines = [];
  await assert.rejects(() => simulation.executeEtsyDiscoverySimulationWorker(worker, missing), /Scoped guideline missing|failed/);
});

test("durable Etsy simulation integrates real routing, domain gates, artifacts, events and duplicate prevention", async () => {
  const repository = new durable.MemorySimulationRepository();
  const adapter = new simulation.EtsyDiscoverySimulationAdapter();
  const options = { mode: "simulation", releases: discovery.etsyDiscoveryPackReleases(), root: discovery.ETSY_DISCOVERY_ROOT,
    workflowKey: discovery.ETSY_DISCOVERY_WORKFLOW_KEY, input: discovery.ETSY_DISCOVERY_SAMPLE_INPUT,
    runKey: "etsy-integration", repository, adapter, providerType: "mock", now,
    validateStageOutput: discovery.validateEtsyDiscoveryStageOutput };
  const first = await durable.runDurablePackSimulation(options);
  assert.equal(first.status, "completed");
  assert.equal(first.output.outcome, "needs_evidence");
  assert.equal(first.output.publicationAllowed, false);
  assert.equal(first.stages.length, 3);
  assert.equal(first.receipts.length, 3);
  assert.ok(first.events.length >= 6);
  assert.equal(adapter.requests.length, 3);
  const repeated = await durable.runDurablePackSimulation(options);
  assert.equal(repeated.status, "completed");
  assert.equal(adapter.requests.length, 3);
  assert.equal(repeated.events.length, first.events.length);
  assert.ok(first.receipts.every(receipt => receipt.domainValidationApplied && receipt.providerType === "mock"));
});
