import assert from "node:assert/strict";
import test from "node:test";

import serviceModule from "../.core-tests/service.js";
import validationModule from "../.core-tests/validation.js";

const { ValidatedCoreStateService } = serviceModule;
const { CoreContractValidationError, validateCoreContract } = validationModule;

const ids = {
  business: "00000000-0000-4000-8000-000000000101",
  goal: "00000000-0000-4000-8000-000000000102",
  task: "00000000-0000-4000-8000-000000000104",
};

const timestamp = "2026-09-29T00:00:00.000Z";

const validGoal = {
  id: ids.goal,
  businessId: ids.business,
  title: "Validate the universal contracts",
  description: null,
  status: "active",
  target: { records: 15 },
  successCriteria: { persisted: true },
  createdAt: timestamp,
  updatedAt: timestamp,
};

test("valid universal Core records are accepted", () => {
  const record = validateCoreContract("goal", validGoal);
  assert.equal(record.id, ids.goal);
  assert.equal(record.status, "active");
});

test("unknown pack-specific fields are rejected", () => {
  assert.throws(
    () =>
      validateCoreContract("goal", {
        ...validGoal,
        etsyListingId: "not-a-core-field",
      }),
    (error) =>
      error instanceof CoreContractValidationError &&
      error.issues.some((issue) => issue.field === "etsyListingId"),
  );
});

test("invalid enum values and identifiers are rejected", () => {
  assert.throws(
    () => validateCoreContract("goal", { ...validGoal, status: "thinking" }),
    CoreContractValidationError,
  );

  assert.throws(
    () => validateCoreContract("goal", { ...validGoal, businessId: "not-a-uuid" }),
    CoreContractValidationError,
  );
});

test("task-linked artifacts must also identify their workflow", () => {
  assert.throws(
    () =>
      validateCoreContract("artifact", {
        id: "00000000-0000-4000-8000-000000000105",
        businessId: ids.business,
        workflowRunId: null,
        taskContractId: ids.task,
        artifactType: "synthetic.result",
        name: "Synthetic result",
        mediaType: "application/json",
        storagePath: null,
        content: {},
        checksum: null,
        metadata: {},
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    CoreContractValidationError,
  );
});

test("the Core service validates before delegating persistence", async () => {
  let createCalls = 0;
  const repository = {
    async create(_kind, record) {
      createCalls += 1;
      return record;
    },
  };
  const service = new ValidatedCoreStateService(repository);

  const result = await service.create("goal", validGoal);
  assert.equal(result.title, validGoal.title);
  assert.equal(createCalls, 1);

  await assert.rejects(
    () => service.create("goal", { ...validGoal, status: "invalid" }),
    CoreContractValidationError,
  );
  assert.equal(createCalls, 1);
});
