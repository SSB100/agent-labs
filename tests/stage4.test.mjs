import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readProjectFile = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Stage 4 defines a complete versioned Generic Researcher Worker Pack", async () => {
  const manifest = await readProjectFile("src/workers/generic-researcher.ts");
  const types = await readProjectFile("src/workers/types.ts");

  assert.match(manifest, /worker\.generic-researcher-fixture/);
  assert.match(manifest, /generic\.researcher\.fixture/);
  assert.match(manifest, /charter:/);
  assert.match(manifest, /inputSchema:/);
  assert.match(manifest, /outputSchema:/);
  assert.match(manifest, /capabilityPolicy:/);
  assert.match(manifest, /knowledgeRequirements:/);
  assert.match(manifest, /modelRequirements:/);
  assert.match(manifest, /negativeExamples:/);
  assert.match(manifest, /escalationPolicy:/);
  assert.match(types, /WorkerExecutionReceipt/);
  assert.match(types, /validation_failed/);
});

test("the worker runtime exposes only Task Contract context and validates output", async () => {
  const runtime = await readProjectFile("src/workers/runtime.ts");
  const types = await readProjectFile("src/workers/types.ts");

  assert.match(types, /taskContract: WorkerTaskContractView/);
  assert.match(types, /inputArtifacts: WorkerInputArtifact\[\]/);
  assert.match(runtime, /Worker context must contain only taskContract and inputArtifacts/);
  assert.match(runtime, /FORBIDDEN_CONTEXT_KEYS/);
  assert.match(runtime, /conversationHistory/);
  assert.match(runtime, /assertJsonSchemaValue\(manifest\.outputSchema/);
  assert.match(runtime, /validateCompletionCriteria/);
  assert.match(runtime, /outputValidated: true/);
});

test("Stage 4 runs the Worker Pack durably and records classified terminal state", async () => {
  const workflow = await readProjectFile("src/workflows/worker-pack-runtime.ts");
  const steps = await readProjectFile("src/workflows/worker-pack-runtime-steps.ts");
  const registry = await readProjectFile("src/workflows/registry.ts");
  const foundationMigration = await readProjectFile(
    "supabase/migrations/20260929060408_stage4_worker_pack_foundation.sql",
  );
  const hostedMarker = await readProjectFile(
    "supabase/migrations/20260929060533_stage4_worker_runtime_transition.sql",
  );
  const runtimeMigration = await readProjectFile(
    "supabase/migrations/20260929062000_stage4_worker_runtime_consolidation.sql",
  );
  const migration = `${foundationMigration}\n${hostedMarker}\n${runtimeMigration}`;

  assert.match(hostedMarker, /Historical hosted migration marker/);
  assert.match(workflow, /"use workflow"/);
  assert.match(steps, /"use step"/);
  assert.match(steps, /executeWorkerPack/);
  assert.match(steps, /stage4_worker_runtime_transition/);
  assert.match(steps, /worker_completed/);
  assert.match(steps, /worker_failed/);
  assert.match(registry, /WORKER_PACK_RUNTIME_WORKFLOW_KEY/);
  assert.match(migration, /begin_worker_pack_workflow_run/);
  assert.match(migration, /stage4_worker_runtime_transition/);
  assert.match(migration, /stage4_worker_context/);
  assert.match(migration, /task_contracts/);
  assert.match(migration, /worker_runs/);
  assert.match(migration, /execution_metadata/);
  assert.match(migration, /failureCategory/);
  assert.match(migration, /grant execute[^;]+to anon/s);
  assert.match(migration, /from public,authenticated,service_role/s);
});

test("Stage 4 includes an owner-visible proof UI and remains model-provider neutral", async () => {
  const actions = await readProjectFile("src/app/dashboard/worker-proof/actions.ts");
  const page = await readProjectFile("src/app/dashboard/worker-proof/page.tsx");
  const workerFiles = [
    await readProjectFile("src/workers/generic-researcher.ts"),
    await readProjectFile("src/workers/runtime.ts"),
    await readProjectFile("src/workflows/worker-pack-runtime.ts"),
    await readProjectFile("src/workflows/worker-pack-runtime-steps.ts"),
  ].join("\n");

  assert.match(actions, /begin_worker_pack_workflow_run/);
  assert.match(actions, /start\(registered\.workflow/);
  assert.match(page, /Task Contract context only/);
  assert.match(page, /Validated worker output/);
  assert.match(page, /Classified worker failure/);
  assert.doesNotMatch(
    workerFiles,
    /openrouter|openai|anthropic|gemini|generateText|streamText|browserbase|steel/i,
  );
});
