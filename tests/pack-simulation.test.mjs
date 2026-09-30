import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import simulation from "../.core-tests/packs/simulation.js";
import sample from "../.core-tests/packs/sample.js";
import dependencies from "../.core-tests/packs/dependencies.js";

const { simulatePackWorkflow, packSimulationArtifactId } = simulation;
const root = { packKey: "workflow.synthetic-summary", version: "1.0.0" };
const workflowKey = "synthetic.installed-summary";
const now = "2026-09-30T12:00:00Z";
const id = (kind, key) => packSimulationArtifactId(root, workflowKey, kind, key);
const outputSchema = {
  type: "object", additionalProperties: false, required: ["decision", "value", "stopReason"],
  properties: {
    decision: { type: "string" }, value: { type: "string", minLength: 1 }, stopReason: { type: "string" },
    usedArtifactIds: { type: "array", uniqueItems: true, items: { type: "string", format: "uuid" } },
    findings: { type: "array", items: { type: "object", required: ["evidenceArtifactId"], properties: { evidenceArtifactId: { type: "string", format: "uuid" } } } },
  },
};
const output = value => ({ decision: "complete", value, stopReason: "objective_complete" });

function scenario() {
  const releases = sample.syntheticPackReleases();
  const workerRelease = releases.find(release => release.manifest.kind === "worker" && release.manifest.version === "1.0.0");
  const workflowRelease = releases.find(release => release.manifest.packKey === root.packKey && release.manifest.version === root.version);
  const knowledge = releases.find(release => release.manifest.kind === "knowledge").manifest.knowledge;
  knowledge.push({ ...structuredClone(knowledge[0]), key: "synthetic.unrelated", name: "Unrelated private guide", content: { unrelated: "Do not expose this" } });
  const baseWorker = workerRelease.manifest.workers[0];
  const baseStage = workflowRelease.manifest.workflows[0].stages[0];
  workerRelease.manifest.workers = ["draft", "review", "handoff"].map((key, index) => {
    const worker = structuredClone(baseWorker);
    worker.manifest.worker.workerKey = `synthetic.${key}`;
    worker.manifest.knowledgeRequirements = index === 0 ? ["synthetic.guide"] : [];
    worker.manifest.outputSchema = structuredClone(outputSchema);
    worker.manifest.modelRequirements = { executionMode: "model_router" };
    worker.execution = { kind: "model_router", routeKey: "standard.default" };
    return worker;
  });
  workflowRelease.manifest.workflows[0].outputSchema = structuredClone(outputSchema);
  workflowRelease.manifest.workflows[0].stages = ["draft", "review", "handoff"].map((key, index, keys) => ({
    ...structuredClone(baseStage), key, workerKey: `synthetic.${key}`,
    inputFrom: index === 0 ? "workflow" : keys[index - 1], knowledgeKeys: index === 0 ? ["synthetic.guide"] : [],
  }));
  const fixtures = {
    draft: { ...output("Draft fixture"), usedArtifactIds: [id("stage-input", "draft"), id("knowledge", "synthetic.guide")] },
    review: { ...output("Review fixture"), usedArtifactIds: [id("stage-input", "review")] },
    handoff: { ...output("Handoff fixture"), usedArtifactIds: [id("stage-input", "handoff")] },
  };
  return { mode: "simulation", releases, root: { ...root }, workflowKey, input: { message: "Only this scoped input" }, fixtures, now };
}

const workflow = options => options.releases.find(release => release.manifest.packKey === root.packKey && release.manifest.version === root.version).manifest.workflows[0];
const workers = options => options.releases.find(release => release.manifest.kind === "worker" && release.manifest.version === "1.0.0").manifest.workers;
const guide = options => options.releases.find(release => release.manifest.kind === "knowledge").manifest.knowledge[0];

test("generic three-stage simulation executes each declared stage once with only its own input and knowledge", () => {
  const options = scenario();
  const result = simulatePackWorkflow(options);
  assert.deepEqual(result.stages.map(stage => stage.stageKey), ["draft", "review", "handoff"]);
  assert.deepEqual(result.stages.map(stage => stage.context.inputArtifacts.length), [2, 1, 1]);
  assert.deepEqual(result.stages[0].context.inputArtifacts[0].content, options.input);
  assert.deepEqual(result.stages[1].context.inputArtifacts[0].content, options.fixtures.draft);
  assert.deepEqual(result.stages[2].context.inputArtifacts[0].content, options.fixtures.review);
  assert.deepEqual(result.output, options.fixtures.handoff);
  assert.equal(result.outputArtifact, result.stages[2].outputArtifact);
  assert.equal(result.snapshot.releases.some(release => release.manifest.version === "2.0.0"), false);
  assert.equal(result.snapshot.workflow.version, "1.0.0");
  for (const stage of result.stages) {
    assert.deepEqual(Object.keys(stage.context).sort(), ["inputArtifacts", "taskContract"]);
    assert.deepEqual(stage.context.taskContract.inputArtifactIds, stage.context.inputArtifacts.map(artifact => artifact.id));
    assert.equal(stage.context.inputArtifacts.some(artifact => artifact.metadata.knowledgeKey === "synthetic.unrelated"), false);
    assert.equal(stage.receipt.executionMode, "simulation.fixture");
    assert.equal(stage.receipt.configuredExecutionMode, "model_router");
    assert.deepEqual(stage.receipt.configuredExecutor, { kind: "model_router", routeKey: "standard.default" });
    assert.equal(stage.receipt.outputValidated, true);
    assert.equal(stage.receipt.providerExecuted, false);
    assert.equal(stage.receipt.qualificationEvaluated, false);
    assert.deepEqual(stage.receipt.executedCapabilities, []);
    assert.equal(stage.receipt.mode, "simulation");
    assert.equal(stage.receipt.workerVersion, "1.0.0");
    assert.equal(stage.outputArtifact.metadata.mode, "simulation");
    assert.equal(stage.outputArtifact.artifactType, "pack.simulation-output");
  }
  assert.equal(result.providerExecuted, false);
  assert.equal(result.qualificationEvaluated, false);
});

test("inputFrom can select an earlier stage without exposing intervening stages or workflow input", () => {
  const options = scenario();
  workflow(options).stages[2].inputFrom = "draft";
  const result = simulatePackWorkflow(options);
  const handoff = result.stages[2].context.inputArtifacts;
  assert.equal(handoff.length, 1);
  assert.deepEqual(handoff[0].content, options.fixtures.draft);
  assert.equal(handoff[0].metadata.sourceArtifactId, result.stages[0].outputArtifact.id);
});

test("explicit fixtures also simulate structured mappings without executing or fabricating their output", () => {
  const options = scenario();
  workers(options)[0].manifest.modelRequirements.executionMode = "structured.mapping";
  workers(options)[0].execution = { kind: "structured.mapping", fields: { value: { source: "input", key: "absent" } } };
  const result = simulatePackWorkflow(options);
  assert.equal(result.stages[0].outputArtifact.content.value, "Draft fixture");
  assert.equal(result.stages[0].receipt.configuredExecutionMode, "structured.mapping");
  assert.equal(result.stages[0].receipt.executionMode, "simulation.fixture");
});

test("experimental pins are simulation-only and releases never gain live qualification", () => {
  const options = scenario();
  for (const release of options.releases) release.status = "experimental";
  assert.throws(() => dependencies.resolvePackDependencies(options.releases, root), /not qualified/);
  const result = simulatePackWorkflow(options);
  assert.equal(result.snapshot.releases.every(release => release.status === "experimental"), true);
  assert.equal(options.releases.every(release => release.status === "experimental"), true);
  options.releases[0].status = "retired";
  assert.throws(() => simulatePackWorkflow(options), /not qualified/);
  options.releases[0].status = "invented";
  assert.throws(() => simulatePackWorkflow(options), /invalid status/);
});

test("mode and exact per-stage fixture coverage are mandatory, and fixture callbacks never run", () => {
  const implicit = scenario(); delete implicit.mode;
  assert.throws(() => simulatePackWorkflow(implicit), /explicit simulation/);
  const live = scenario(); live.mode = "live";
  assert.throws(() => simulatePackWorkflow(live), /explicit simulation/);
  const missing = scenario(); delete missing.fixtures.review;
  assert.throws(() => simulatePackWorkflow(missing), /exactly one fixture/);
  const extra = scenario(); extra.fixtures.extra = output("Not a stage");
  assert.throws(() => simulatePackWorkflow(extra), /exactly one fixture/);
  const callback = scenario(); callback.fixtures.review = () => { assert.fail("A fixture callback must never execute"); };
  assert.throws(() => simulatePackWorkflow(callback), /plain JSON/);
  const array = scenario(); array.fixtures.review = [];
  assert.throws(() => simulatePackWorkflow(array), /must be a JSON object/);
});

test("workflow schemas, pinned worker input/output schemas and completion criteria all run", () => {
  const input = scenario(); input.input = { unrelated: "value" };
  assert.throws(() => simulatePackWorkflow(input), /workflow input did not match/);
  const workerInput = scenario(); workers(workerInput)[1].manifest.inputSchema = { type: "object", required: ["neverSupplied"] };
  assert.throws(() => simulatePackWorkflow(workerInput), /Worker input context did not match/);
  const workerOutput = scenario(); workerOutput.fixtures.review.value = 42;
  assert.throws(() => simulatePackWorkflow(workerOutput), /Worker output did not match/);
  const finalOutput = scenario(); workflow(finalOutput).outputSchema = { type: "object", required: ["neverSupplied"] };
  assert.throws(() => simulatePackWorkflow(finalOutput), /workflow output did not match/);
  const decision = scenario(); decision.fixtures.review.decision = "incomplete";
  assert.throws(() => simulatePackWorkflow(decision), /required completion decision/);
  const stop = scenario(); stop.fixtures.review.stopReason = "keep_working";
  assert.throws(() => simulatePackWorkflow(stop), /required completion reason/);
  const evidence = scenario(); workflow(evidence).stages[0].completionCriteria.minimumEvidenceCount = 1;
  assert.throws(() => simulatePackWorkflow(evidence), /minimum evidence count/);
});

test("the real context validator rejects unrestricted context even with permissive input schemas", () => {
  const options = scenario();
  workflow(options).inputSchema = { type: "object" };
  options.input = { nested: { fullWorkflowHistory: ["Unauthorized context"] } };
  assert.throws(() => simulatePackWorkflow(options), /unrestricted conversation or secret/);
});

test("unscoped, fabricated and malformed usedArtifactIds and evidence citations fail closed", () => {
  for (const artifactId of [
    "00000000-0000-4000-8000-000000000999", id("knowledge", "synthetic.unrelated"),
    id("knowledge", "synthetic.guide"), id("stage-output", "draft"), id("stage-input", "draft"),
  ]) {
    const options = scenario(); options.fixtures.review.usedArtifactIds = [artifactId];
    assert.throws(() => simulatePackWorkflow(options), /outside the Task Contract/);
  }
  const malformed = scenario(); malformed.fixtures.review.usedArtifactIds = "fake";
  workers(malformed)[1].manifest.outputSchema = { type: "object" };
  assert.throws(() => simulatePackWorkflow(malformed), /usedArtifactIds must be an array/);
  const findings = scenario(); findings.fixtures.review.findings = [{ evidenceArtifactId: id("knowledge", "synthetic.guide") }];
  assert.throws(() => simulatePackWorkflow(findings), /evidence outside the Task Contract/);
});

test("knowledge artifacts preserve provenance, version and explicit freshness metadata", () => {
  const options = scenario();
  guide(options).verifiedAt = "2026-09-30T10:00:00+10:00";
  guide(options).freshnessDays = 1;
  const result = simulatePackWorkflow(options);
  assert.deepEqual(result.stages[0].context.inputArtifacts[1].metadata, {
    mode: "simulation", knowledgeKey: "synthetic.guide", version: "1.0.0",
    source: "fixture://agent-labs/stage10", verifiedAt: "2026-09-30T10:00:00+10:00", freshnessDays: 1,
    freshness: "fresh", freshnessCheckedAt: "2026-09-30T12:00:00.000Z", expiresAt: "2026-10-01T00:00:00.000Z",
  });
});

test("future verification, impossible dates and expired knowledge including the exact boundary are rejected", () => {
  const future = scenario(); guide(future).verifiedAt = "2026-09-30T12:00:00.001Z";
  assert.throws(() => simulatePackWorkflow(future), /verification is in the future/);
  const impossible = scenario(); guide(impossible).verifiedAt = "2026-02-30T00:00:00Z";
  assert.throws(() => simulatePackWorkflow(impossible), /invalid date/);
  const invalid = scenario(); guide(invalid).verifiedAt = "not-a-date";
  assert.throws(() => simulatePackWorkflow(invalid), /provenance and freshness|invalid date/);
  const boundary = scenario(); guide(boundary).freshnessDays = 1;
  boundary.now = "2026-09-30T23:59:59.999Z";
  assert.doesNotThrow(() => simulatePackWorkflow(boundary));
  boundary.now = "2026-10-01T00:00:00Z";
  assert.throws(() => simulatePackWorkflow(boundary), /is expired/);
  boundary.now = "2026-10-02T00:00:00Z";
  assert.throws(() => simulatePackWorkflow(boundary), /is expired/);
  const time = scenario(); time.now = "2026-02-30T00:00:00Z";
  assert.throws(() => simulatePackWorkflow(time), /Simulation time is an invalid date/);
  time.now = new Date("invalid");
  assert.throws(() => simulatePackWorkflow(time), /Simulation time is an invalid date/);
});

test("freshness and external capabilities are preflighted across every stage", () => {
  const options = scenario();
  const external = structuredClone(options.releases[0]);
  external.id = "00000000-0000-4000-8000-000000009999";
  external.manifest.packKey = "capability.external";
  external.manifest.capabilities = [{ key: "web.research", adapter: "web.research", description: "External research" }];
  options.releases.push(external);
  const workerRelease = options.releases.find(release => release.manifest.kind === "worker" && release.manifest.version === "1.0.0");
  workerRelease.manifest.dependencies.push({ packKey: external.manifest.packKey, version: "1.0.0" });
  workers(options)[2].manifest.capabilityPolicy.allowed.push("web.research");
  workflow(options).stages[2].permittedCapabilities.push("web.research");
  options.fixtures.draft.value = 42; // An earlier output would fail if execution started before preflight.
  assert.throws(() => simulatePackWorkflow(options), /external capability/);
  workers(options)[2].execution = { kind: "web.research", routeKey: "standard.default" };
  workers(options)[2].manifest.modelRequirements.executionMode = "web.research";
  assert.throws(() => simulatePackWorkflow(options), /external executor/);
});

test("missing exact pins, repeated stages, forward inputs and knowledge scope violations are rejected", () => {
  const pin = scenario(); workflow(pin).stages[1].workerVersion = "9.9.9";
  assert.throws(() => simulatePackWorkflow(pin), /exact version is unavailable/);
  const duplicate = scenario(); workflow(duplicate).stages[1].key = "draft";
  assert.throws(() => simulatePackWorkflow(duplicate), /Invalid stage contract/);
  const forward = scenario(); workflow(forward).stages[0].inputFrom = "review";
  assert.throws(() => simulatePackWorkflow(forward), /earlier stage/);
  const scope = scenario(); workflow(scope).stages[1].knowledgeKeys = ["synthetic.guide"];
  assert.throws(() => simulatePackWorkflow(scope), /exceeds worker scope/);
  const omitted = scenario(); workflow(omitted).stages[0].knowledgeKeys = [];
  assert.throws(() => simulatePackWorkflow(omitted), /omitted required worker knowledge/);
  const wrongWorkflow = scenario(); wrongWorkflow.workflowKey = "synthetic.missing";
  assert.throws(() => simulatePackWorkflow(wrongWorkflow), /defined by the pinned root/);
});

test("run snapshots, stage inputs, receipts and fixture outputs are copied and deeply frozen", () => {
  const options = scenario();
  options.now = new Date(now);
  const result = simulatePackWorkflow(options);
  const before = structuredClone(result);
  options.input.message = "Mutated after simulation";
  options.fixtures.draft.value = "Changed fixture";
  guide(options).content.guidance = "Changed catalog";
  workflow(options).stages[0].knowledgeKeys.length = 0;
  options.now.setUTCFullYear(2030);
  assert.deepEqual(result, before);
  for (const value of [result, result.snapshot, result.snapshot.releases[0].manifest, result.snapshot.workflow.stages,
    result.stages[0].context, result.stages[0].context.inputArtifacts[0].content,
    result.stages[0].receipt, result.output, result.outputArtifact.metadata]) assert.equal(Object.isFrozen(value), true);
  assert.throws(() => { result.output.value = "Mutation"; }, TypeError);
  assert.throws(() => { result.stages[0].receipt.inputArtifactIds.push("Mutation"); }, TypeError);
  assert.equal(Object.isFrozen(options.input), false);
  assert.equal(Object.isFrozen(options.fixtures), false);
});

test("fixture validation rejects non-JSON values, cycles and accessors without executing them", () => {
  for (const value of [NaN, undefined, new Date(), new Map(), Symbol("not-json")]) {
    const options = scenario(); options.fixtures.draft.value = value;
    assert.throws(() => simulatePackWorkflow(options), /plain JSON|finite JSON/);
  }
  const cyclic = scenario(); cyclic.fixtures.draft.circular = cyclic.fixtures.draft;
  assert.throws(() => simulatePackWorkflow(cyclic), /cycles/);
  const accessor = scenario(); Object.defineProperty(accessor.fixtures.draft, "accessor", { enumerable: true, get() { assert.fail("Do not execute fixture getters"); } });
  assert.throws(() => simulatePackWorkflow(accessor), /accessor/);
  const unsafe = scenario(); unsafe.fixtures.draft = JSON.parse('{"__proto__":{}}');
  assert.throws(() => simulatePackWorkflow(unsafe), /unsafe key/);
});

test("fixture simulation performs no network calls and imports no provider implementation", () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => { assert.fail("No network call is allowed during fixture simulation"); };
  try { assert.equal(simulatePackWorkflow(scenario()).stages.length, 3); }
  finally { globalThis.fetch = previousFetch; }
  const source = readFileSync(new URL("../src/packs/simulation.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from ["'][^"']*(?:providers|models|supabase|workflows\/installed)/);
  assert.equal(id("stage-input", "draft"), packSimulationArtifactId({ version: root.version, packKey: root.packKey }, workflowKey, "stage-input", "draft"));
});
