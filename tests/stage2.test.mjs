import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readProjectFile = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const contractTables = [
  "packs",
  "workflow_definitions",
  "worker_definitions",
  "goals",
  "workflow_runs",
  "workflow_stage_runs",
  "task_contracts",
  "worker_runs",
  "artifacts",
  "evidence",
  "events",
  "external_resources",
  "action_intents",
  "action_receipts",
  "owner_interventions",
];

test("Stage 2 migration creates every universal Core contract with RLS", async () => {
  const migration = await readProjectFile(
    "supabase/migrations/20260929011830_universal_core_contracts.sql",
  );

  for (const table of contractTables) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table} enable row level security`),
    );
  }

  assert.match(migration, /create function private\.is_business_owner/);
  assert.match(migration, /security definer\s+set search_path = ''/);
  assert.match(migration, /grant select on table public\.packs to authenticated/);
  assert.match(migration, /create policy workflow_runs_owner_all/);
  assert.match(migration, /private\.is_business_owner\(business_id\)/);
});

test("append-only Core records cannot be updated or deleted by application clients", async () => {
  const migration = await readProjectFile(
    "supabase/migrations/20260929011830_universal_core_contracts.sql",
  );

  for (const table of ["evidence", "events", "action_receipts"]) {
    assert.match(
      migration,
      new RegExp(`grant select, insert on table public\\.${table} to authenticated`),
    );
    assert.doesNotMatch(
      migration,
      new RegExp(`grant[^;]*(?:update|delete)[^;]*public\\.${table}[^;]*authenticated`, "i"),
    );
  }
});

test("contract relationships cannot cross workflow, task, worker or Business boundaries", async () => {
  const migration = await readProjectFile(
    "supabase/migrations/20260929021058_core_contract_relationship_integrity.sql",
  );

  assert.match(
    migration,
    /foreign key \(workflow_stage_run_id, workflow_run_id, business_id\)/,
  );
  assert.match(
    migration,
    /task_contract_id,\s*workflow_run_id,\s*business_id,\s*worker_definition_id/s,
  );
  assert.match(migration, /artifacts_task_contract_requires_workflow/);
  assert.match(migration, /action_intents_task_contract_requires_workflow/);
  assert.match(migration, /owner_interventions_action_workflow_fk/);
});

test("Stage 2 includes generic synthetic definitions and no commerce-specific Core fields", async () => {
  const migration = await readProjectFile(
    "supabase/migrations/20260929011830_universal_core_contracts.sql",
  );
  const contracts = await readProjectFile("src/core/contracts.ts");
  const combined = `${migration}\n${contracts}`;

  assert.match(migration, /core\.synthetic/);
  assert.match(migration, /synthetic\.core\.validation/);
  assert.match(migration, /generic\.synthetic\.worker/);
  assert.doesNotMatch(combined, /etsy|printful|shopify|listing_id|product_candidate/i);
});

test("repository and service boundaries validate records before persistence", async () => {
  const repository = await readProjectFile("src/core/repository.ts");
  const service = await readProjectFile("src/core/service.ts");
  const validation = await readProjectFile("src/core/validation.ts");

  assert.match(repository, /export interface CoreRepository/);
  assert.match(repository, /transaction<T>/);
  assert.match(service, /export interface CoreStateService/);
  assert.match(service, /validateCoreContract\(kind, value\)/);
  assert.match(validation, /is not part of the universal Core contract/);
});

test("the normal test command compiles and executes the Core validation fixtures", async () => {
  const packageJson = JSON.parse(await readProjectFile("package.json"));

  assert.equal(packageJson.scripts.pretest, "tsc -p tsconfig.core-tests.json");
  assert.equal(packageJson.scripts.test, "node --test tests/*.test.mjs");
});
