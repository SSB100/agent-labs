import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import durable from "../.core-tests/packs/durable-simulation.js";
import sample from "../.core-tests/packs/sample.js";
import modelTypes from "../.core-tests/models/types.js";

const { runDurablePackSimulation, interveneInDurableSimulation, FileSimulationRepository, MemorySimulationRepository, SimulationRunBusyError } = durable;
const { ModelProviderError } = modelTypes;
const root = { packKey: "workflow.synthetic-summary", version: "1.0.0" };
const workflowKey = "synthetic.installed-summary";
const now = "2026-09-30T12:00:00Z";
const schema = { type: "object", additionalProperties: false, required: ["decision", "value", "stopReason", "usedArtifactIds"], properties: {
  decision: { const: "complete" }, value: { type: "string" }, stopReason: { const: "objective_complete" },
  usedArtifactIds: { type: "array", uniqueItems: true, items: { type: "string", format: "uuid" } },
} };

function scenario(repository = new MemorySimulationRepository(), adapter = mockAdapter()) {
  const releases = sample.syntheticPackReleases();
  const workerRelease = releases.find(release => release.manifest.kind === "worker" && release.manifest.version === "1.0.0");
  const workflowRelease = releases.find(release => release.manifest.packKey === root.packKey && release.manifest.version === root.version);
  const guide = releases.find(release => release.manifest.kind === "knowledge").manifest.knowledge;
  guide.push({ ...structuredClone(guide[0]), key: "synthetic.unrelated", name: "Unrelated guide", content: { unrelated: "Must not reach model" } });
  const baseWorker = workerRelease.manifest.workers[0];
  const baseStage = workflowRelease.manifest.workflows[0].stages[0];
  workerRelease.manifest.workers = ["draft", "review", "handoff"].map((key, index) => {
    const worker = structuredClone(baseWorker);
    worker.manifest.worker.workerKey = `synthetic.${key}`;
    worker.manifest.knowledgeRequirements = index === 0 ? ["synthetic.guide"] : [];
    worker.manifest.outputSchema = structuredClone(schema);
    const routeKey = index === 1 ? "reviewer.independent" : "standard.default";
    worker.manifest.modelRequirements = { executionMode: "model_router", routeKey };
    worker.execution = { kind: "model_router", routeKey };
    return worker;
  });
  workflowRelease.manifest.workflows[0].outputSchema = structuredClone(schema);
  workflowRelease.manifest.workflows[0].stages = ["draft", "review", "handoff"].map((key, index, keys) => ({
    ...structuredClone(baseStage), key, workerKey: `synthetic.${key}`, inputFrom: index === 0 ? "workflow" : keys[index - 1],
    knowledgeKeys: index === 0 ? ["synthetic.guide"] : [],
  }));
  releases.forEach(release => { release.status = "experimental"; });
  return { mode: "simulation", providerType: "mock", releases, root, workflowKey, runKey: "durable-local-proof", input: { message: "Scoped input" }, repository, adapter, now };
}
function response(request, output) {
  return { output, provider: "mock-provider", providerModelId: request.model.providerModelId,
    providerRequestId: `mock:${request.requestMetadata.stageKey}:${request.requestMetadata.invocation}:${request.requestMetadata.attempt}`,
    latencyMs: 0, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, reportedCostUsd: 0, estimatedCostUsd: 0 }, metadata: { providerType: "mock" } };
}
function outputFor(request) {
  const context = JSON.parse(request.messages.find(message => message.role === "user").content);
  const input = context.inputArtifacts[0].content;
  return { decision: "complete", value: `${input.message ?? input.value}/${request.requestMetadata.stageKey}`, stopReason: "objective_complete", usedArtifactIds: context.taskContract.inputArtifactIds };
}
function mockAdapter(handler = request => response(request, outputFor(request))) {
  const calls = [];
  return { calls, async invokeStructured(request) { calls.push(structuredClone(request)); return handler(request, calls); }, async qualifyToolUse() { assert.fail("Simulation cannot qualify models"); } };
}
const workflow = options => options.releases.find(release => release.manifest.packKey === root.packKey && release.manifest.version === root.version).manifest.workflows[0];
const workers = options => options.releases.find(release => release.manifest.kind === "worker" && release.manifest.version === "1.0.0").manifest.workers;
const guide = options => options.releases.find(release => release.manifest.kind === "knowledge").manifest.knowledge[0];
const intervene = (options, action) => interveneInDurableSimulation({ repository: options.repository, runKey: options.runKey, action, now });

function temporaryRepository(t) {
  const directory = mkdtempSync(join(tmpdir(), "agent-labs-simulation-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, repository: new FileSimulationRepository(directory) };
}

test("durable simulation invokes configured routes with scoped contracts and persists validated artifacts, events and receipts", async () => {
  const options = scenario();
  const checked = [];
  options.validateStageOutput = (stageKey, output, context) => { checked.push(stageKey); assert.deepEqual(output.usedArtifactIds, context.taskContract.inputArtifactIds); };
  const run = await runDurablePackSimulation(options);
  assert.equal(run.status, "completed");
  assert.equal(run.output.value, "Scoped input/draft/review/handoff");
  assert.deepEqual(checked, ["draft", "review", "handoff"]);
  assert.deepEqual(options.adapter.calls.map(call => call.requestMetadata.routeKey), ["standard.default", "reviewer.independent", "standard.default"]);
  assert.deepEqual(run.stages.map(stage => stage.context.inputArtifacts.length), [2, 1, 1]);
  assert.deepEqual(run.stages[1].context.inputArtifacts[0].content, run.stages[0].outputArtifact.content);
  assert.equal(run.stages[1].context.inputArtifacts[0].metadata.sourceArtifactId, run.stages[0].outputArtifact.id);
  assert.equal(run.artifacts.length, 3);
  assert.equal(run.receipts.length, 3);
  assert.equal(run.outputArtifact.id, run.stages[2].outputArtifact.id);
  assert.equal(run.events.at(-1).type, "run.completed");
  assert.deepEqual(run.events.map(event => event.sequence), run.events.map((_, index) => index + 1));
  for (const call of options.adapter.calls) {
    const context = JSON.parse(call.messages.find(message => message.role === "user").content);
    assert.deepEqual(Object.keys(context).sort(), ["inputArtifacts", "taskContract"]);
    assert.equal(context.inputArtifacts.some(artifact => artifact.metadata.knowledgeKey === "synthetic.unrelated"), false);
  }
  for (const receipt of run.receipts) {
    assert.equal(receipt.outputValidated, true);
    assert.equal(receipt.providerType, "mock");
    assert.equal(receipt.qualificationEvaluated, false);
    assert.equal(receipt.workerReceipt.executionMode, "model_router");
    assert.equal(receipt.configuredExecutionMode, "model_router");
    assert.equal(receipt.attempts[0].provider, "mock-provider");
    assert.equal(receipt.attempts[0].metadata.providerType, "mock");
    assert.equal(receipt.domainValidationApplied, true);
    assert.deepEqual(receipt.executedCapabilities, []);
  }
  assert.ok(run.events.every(event => event.providerType === "mock" && event.mode === "simulation" && event.qualificationEvaluated === false));
  assert.ok(run.snapshot.releases.every(release => release.status === "experimental"));
  assert.ok(options.releases.every(release => release.status === "experimental"));
  assert.ok(run.snapshot.releases.every(release => release.manifest.version === "1.0.0"));
  assert.ok(Object.isFrozen(run) && Object.isFrozen(run.stages[0].context));
  assert.deepEqual(options.repository.read(options.runKey), run);
});

test("same runKey reuses completed stages across new file repository instances and rejects changed input or pin contents", async t => {
  const { directory, repository } = temporaryRepository(t);
  const options = scenario(repository);
  const run = await runDurablePackSimulation(options);
  const original = JSON.stringify(run);
  const next = { ...options, repository: new FileSimulationRepository(directory), adapter: mockAdapter(() => assert.fail("Completed stages cannot execute twice")) };
  assert.deepEqual(await runDurablePackSimulation(next), run);
  assert.equal(next.adapter.calls.length, 0);
  await assert.rejects(runDurablePackSimulation({ ...next, input: { message: "Changed" } }), /changed input, pins/);
  const changed = structuredClone(next.releases);
  changed.find(release => release.manifest.kind === "knowledge").manifest.knowledge[0].content.guidance = "Changed under same version";
  await assert.rejects(runDurablePackSimulation({ ...next, releases: changed }), /changed input, pins/);
  await assert.rejects(runDurablePackSimulation({ ...next, providerType: "real" }), /provider type/);
  assert.equal(JSON.stringify(repository.read(options.runKey)), original);
});

test("real router records a bounded independent fallback without fabricated model execution", async () => {
  const adapter = mockAdapter(request => {
    if (request.requestMetadata.stageKey === "draft" && request.requestMetadata.attempt === 1) throw new ModelProviderError("provider_unavailable", "Primary failed", true);
    return response(request, outputFor(request));
  });
  const run = await runDurablePackSimulation(scenario(undefined, adapter));
  assert.equal(run.status, "completed");
  const receipt = run.receipts[0];
  assert.deepEqual(receipt.attempts.map(attempt => attempt.outcome), ["failed", "completed"]);
  assert.notEqual(receipt.attempts[0].modelKey, receipt.attempts[1].modelKey);
  assert.notEqual(receipt.attempts[0].providerFamily, receipt.attempts[1].providerFamily);
  assert.equal(receipt.selectedModelKey, receipt.attempts[1].modelKey);
  assert.equal(adapter.calls.length, 4);
});

test("model failures enter Needs You, do not silently retry, and explicit retry has a persisted invocation budget", async t => {
  const { directory, repository } = temporaryRepository(t);
  const adapter = mockAdapter(() => { throw new ModelProviderError("provider_unavailable", "Both providers unavailable", true); });
  const options = scenario(repository, adapter);
  let run = await runDurablePackSimulation(options);
  assert.equal(run.status, "needs_you");
  assert.equal(run.failure.reason, "Both providers unavailable");
  assert.equal(run.stages[0].invocations.length, 1);
  assert.equal(run.receipts[0].attempts.length, 2);
  assert.equal(run.receipts[0].domainValidationApplied, false);
  assert.equal(run.artifacts.length, 0);
  assert.equal(adapter.calls.length, 2);
  options.repository = new FileSimulationRepository(directory);
  assert.equal((await runDurablePackSimulation(options)).status, "needs_you");
  assert.equal(adapter.calls.length, 2);
  await assert.rejects(intervene(options, "resume"), /Needs You requires explicit retry/);
  assert.equal((await intervene(options, "retry")).status, "queued");
  run = await runDurablePackSimulation(options);
  assert.equal(run.status, "needs_you");
  assert.equal(run.stages[0].invocations.length, 2);
  assert.equal(adapter.calls.length, 4);
  await assert.rejects(intervene(options, "retry"), /budget is exhausted/);
  assert.equal((await runDurablePackSimulation(options)).status, "needs_you");
  assert.equal(adapter.calls.length, 4);
});

test("non-retryable provider failures never invoke fallback", async () => {
  const adapter = mockAdapter(() => { throw new ModelProviderError("authentication_required", "Sign-in required", false); });
  const run = await runDurablePackSimulation(scenario(undefined, adapter));
  assert.equal(run.status, "needs_you");
  assert.equal(run.failure.category, "authentication_required");
  assert.equal(adapter.calls.length, 1);
  assert.equal(run.receipts[0].attempts.length, 1);
});

test("invalid schema, completion or unscoped citations never become output artifacts", async () => {
  for (const mutate of [output => { output.value = 42; }, output => { output.stopReason = "keep_going"; }, output => { output.usedArtifactIds = ["00000000-0000-4000-8000-000000000999"]; }]) {
    const options = scenario(undefined, mockAdapter(request => {
      const output = outputFor(request); mutate(output); return response(request, output);
    }));
    const run = await runDurablePackSimulation(options);
    assert.equal(run.status, "needs_you");
    assert.equal(run.artifacts.length, 0);
    assert.equal(run.stages[0].outputArtifact, null);
    assert.equal(run.receipts[0].outputValidated, false);
    assert.equal(run.receipts[0].attempts[0].outcome, "completed");
    assert.equal(options.adapter.calls.length, 1);
  }
});

test("trusted domain validation runs before output persistence and rejects asynchronous validators", async () => {
  const options = scenario();
  options.validateStageOutput = () => { throw new Error("Citation source does not match scoped knowledge"); };
  let run = await runDurablePackSimulation(options);
  assert.equal(run.status, "needs_you");
  assert.match(run.failure.reason, /Citation source/);
  assert.equal(run.artifacts.length, 0);
  assert.equal(run.receipts[0].domainValidationApplied, true);
  assert.equal(options.adapter.calls.length, 1);
  const asyncOptions = scenario();
  asyncOptions.validateStageOutput = async () => {};
  run = await runDurablePackSimulation(asyncOptions);
  assert.equal(run.status, "needs_you");
  assert.match(run.failure.reason, /must be synchronous/);
  assert.equal(run.artifacts.length, 0);
});

test("retry reuses earlier completed stages and propagates their original output exactly", async () => {
  let invalid = true;
  const adapter = mockAdapter(request => {
    const output = outputFor(request);
    if (request.requestMetadata.stageKey === "review" && invalid) output.value = 0;
    return response(request, output);
  });
  const options = scenario(undefined, adapter);
  const first = await runDurablePackSimulation(options);
  assert.equal(first.status, "needs_you");
  assert.equal(first.stages[0].status, "completed");
  invalid = false;
  await intervene(options, "retry");
  const final = await runDurablePackSimulation(options);
  assert.equal(final.status, "completed");
  assert.deepEqual(final.stages[0], first.stages[0]);
  assert.deepEqual(adapter.calls.map(call => call.requestMetadata.stageKey), ["draft", "review", "review", "handoff"]);
  assert.deepEqual(final.stages[1].context.inputArtifacts[0].content, first.stages[0].outputArtifact.content);
});

test("in-flight pause persists at a stage boundary and resume continues after process restart", async t => {
  const { directory } = temporaryRepository(t);
  const options = scenario();
  const { repository: _repository, adapter: _adapter, ...payload } = options;
  void _repository; void _adapter;
  const modulePath = new URL("../.core-tests/packs/durable-simulation.js", import.meta.url).pathname;
  const child = `
    import { readFileSync } from "node:fs";
    const api = (await import(${JSON.stringify(modulePath)})).default;
    const options = JSON.parse(readFileSync(0, "utf8"));
    options.repository = new api.FileSimulationRepository(${JSON.stringify(directory)});
    options.adapter = { async invokeStructured(request) {
      const context = JSON.parse(request.messages.find(message => message.role === "user").content);
      await api.interveneInDurableSimulation({repository: options.repository, runKey: options.runKey, action: "pause", now: options.now});
      return {output: {decision:"complete",value:"Child process/draft",stopReason:"objective_complete",usedArtifactIds:context.taskContract.inputArtifactIds},
        provider:"mock-provider",providerModelId:request.model.providerModelId,providerRequestId:"child",latencyMs:0,
        usage:{inputTokens:0,outputTokens:0,totalTokens:0,cachedInputTokens:0,reasoningTokens:0,reportedCostUsd:0,estimatedCostUsd:0},metadata:{}};
    }, async qualifyToolUse(){throw new Error("Forbidden");} };
    const run = await api.runDurablePackSimulation(options);
    process.stdout.write(JSON.stringify({status:run.status,stages:run.stages.map(stage=>stage.status)}));
  `;
  const childResult = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", child], { input: JSON.stringify(payload), encoding: "utf8" }));
  assert.deepEqual(childResult, { status: "paused", stages: ["completed", "pending", "pending"] });
  options.repository = new FileSimulationRepository(directory);
  assert.equal((await runDurablePackSimulation(options)).status, "paused");
  assert.equal(options.adapter.calls.length, 0);
  await intervene(options, "resume");
  const result = await runDurablePackSimulation(options);
  assert.equal(result.status, "completed");
  assert.equal(result.output.value, "Child process/draft/review/handoff");
  assert.deepEqual(options.adapter.calls.map(call => call.requestMetadata.stageKey), ["review", "handoff"]);
  assert.ok(result.events.some(event => event.type === "run.paused"));
  assert.ok(result.events.some(event => event.type === "run.resumed"));
});

test("cancel while in flight is durable and terminal, with no subsequent stage calls", async t => {
  const { directory, repository } = temporaryRepository(t);
  const options = scenario(repository);
  options.adapter = mockAdapter(async request => {
    await intervene(options, "cancel");
    return response(request, outputFor(request));
  });
  const run = await runDurablePackSimulation(options);
  assert.equal(run.status, "cancelled");
  assert.equal(options.adapter.calls.length, 1);
  assert.deepEqual(run.stages.map(stage => stage.status), ["completed", "cancelled", "cancelled"]);
  options.repository = new FileSimulationRepository(directory);
  assert.equal((await runDurablePackSimulation(options)).status, "cancelled");
  await assert.rejects(intervene(options, "resume"), /Only a paused/);
  await assert.rejects(intervene(options, "retry"), /Only a Needs You/);
  assert.equal(options.adapter.calls.length, 1);
});

test("filesystem lock rejects concurrent same-run execution across repository instances", async t => {
  const { directory, repository } = temporaryRepository(t);
  let unblock, started;
  const blocked = new Promise(resolve => { unblock = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  const options = scenario(repository, mockAdapter(async request => { started(); await blocked; return response(request, outputFor(request)); }));
  const first = runDurablePackSimulation(options);
  await entered;
  const other = { ...options, repository: new FileSimulationRepository(directory), adapter: mockAdapter() };
  await assert.rejects(runDurablePackSimulation(other), SimulationRunBusyError);
  assert.equal(other.adapter.calls.length, 0);
  unblock();
  assert.equal((await first).status, "completed");
  assert.equal(options.adapter.calls.length, 3);
  assert.equal((await runDurablePackSimulation(other)).status, "completed");
  assert.equal(other.adapter.calls.length, 0);
});

test("a leftover lock is never stolen and interrupted checkpoints require explicit bounded retry", async t => {
  const { directory, repository } = temporaryRepository(t);
  const options = scenario(repository);
  options.adapter = mockAdapter(() => { throw new ModelProviderError("authentication_required", "Pause checkpoint", false); });
  await runDurablePackSimulation(options);
  await repository.withRunLock(options.runKey, async () => {
    const run = repository.read(options.runKey);
    run.status = "running"; run.failure = null;
    run.stages[0].status = "running"; run.stages[0].failure = null; run.stages[0].receipt = null;
    run.stages[0].invocations[0].status = "running"; run.stages[0].invocations[0].receipt = null;
    run.receipts = [];
    repository.save(run);
  });
  const checkpoint = readdirSync(directory).find(name => name.endsWith(".json") && !name.includes(".control."));
  const lock = join(directory, checkpoint.replace(/\.json$/, ".lock"));
  writeFileSync(lock, JSON.stringify({ pid: 99999999, token: "orphan" }));
  await assert.rejects(runDurablePackSimulation(options), /never automatically stolen/);
  rmSync(lock); // Test emulates explicit local operator recovery after inspection.
  const recovered = await runDurablePackSimulation({ ...options, repository: new FileSimulationRepository(directory) });
  assert.equal(recovered.status, "needs_you");
  assert.equal(recovered.failure.category, "execution_interrupted");
  assert.equal(recovered.receipts[0].outcome, "interrupted");
  assert.equal(options.adapter.calls.length, 1);
  await intervene(options, "retry");
  options.adapter = mockAdapter();
  assert.equal((await runDurablePackSimulation(options)).status, "completed");
  assert.equal(options.adapter.calls.length, 3);
});

test("freshness, exact scope and WorkerInput checks fail before provider execution", async () => {
  for (const mutate of [
    options => { guide(options).verifiedAt = "2026-10-01T00:00:00Z"; },
    options => { guide(options).verifiedAt = "2026-02-30T00:00:00Z"; },
    options => { guide(options).freshnessDays = 1; options.now = "2026-10-01T00:00:00Z"; },
    options => { workers(options)[0].manifest.inputSchema = { type: "object", required: ["missing"] }; },
    options => { workflow(options).inputSchema = { type: "object" }; options.input = { conversationHistory: ["Unscoped"] }; },
  ]) {
    const options = scenario(); mutate(options);
    const run = await runDurablePackSimulation(options);
    assert.equal(run.status, "needs_you");
    assert.equal(options.adapter.calls.length, 0);
    assert.equal(run.artifacts.length, 0);
  }
  const wrong = scenario(); workflow(wrong).stages[1].workerVersion = "9.9.9";
  await assert.rejects(runDurablePackSimulation(wrong), /exact version is unavailable/);
  assert.equal(wrong.adapter.calls.length, 0);
  const scope = scenario(); workflow(scope).stages[0].knowledgeKeys = [];
  await assert.rejects(runDurablePackSimulation(scope), /omitted required worker knowledge/);
});

test("explicit mode/provider classification and JSON-only manifests reject code without invoking it", async () => {
  for (const mutate of [options => { delete options.mode; }, options => { options.mode = "live"; }, options => { delete options.providerType; }]) {
    const options = scenario(); mutate(options);
    await assert.rejects(runDurablePackSimulation(options), /explicit/);
    assert.equal(options.adapter.calls.length, 0);
  }
  const options = scenario();
  Object.defineProperty(guide(options).content, "callback", { enumerable: true, get() { assert.fail("Manifest code executed"); } });
  await assert.rejects(runDurablePackSimulation(options), /unsafe key or accessor/);
  const callback = scenario(); guide(callback).content.callback = () => assert.fail("Manifest callback executed");
  await assert.rejects(runDurablePackSimulation(callback), /plain JSON/);
});

test("persistence failure during model telemetry never triggers another provider request", async () => {
  class FailingRepository extends MemorySimulationRepository {
    save(run) {
      if (run.events.some(event => event.type === "model.attempt_finished")) throw new Error("Disk checkpoint failed");
      super.save(run);
    }
  }
  const options = scenario(new FailingRepository(), mockAdapter(() => { throw new ModelProviderError("provider_unavailable", "Fallback would be possible", true); }));
  await assert.rejects(runDurablePackSimulation(options), /Disk checkpoint failed/);
  assert.equal(options.adapter.calls.length, 1);
  const persisted = options.repository.read(options.runKey);
  assert.equal(persisted.stages[0].status, "running");
  assert.equal(persisted.artifacts.length, 0);
});

test("filesystem checkpoints detect corruption and simulation itself imports no live adapter or hosted service", async t => {
  const { directory, repository } = temporaryRepository(t);
  const options = scenario(repository);
  await runDurablePackSimulation(options);
  const file = join(directory, readdirSync(directory).find(name => name.endsWith(".json")));
  const envelope = JSON.parse(readFileSync(file, "utf8"));
  envelope.payload = envelope.payload.replace('"status":"completed"', '"status":"running"');
  writeFileSync(file, JSON.stringify(envelope));
  assert.throws(() => repository.read(options.runKey), /integrity check failed/);
  const source = readFileSync(new URL("../src/packs/durable-simulation.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from ["'][^"']*(?:openrouter|supabase|workflows\/installed)/);
});
