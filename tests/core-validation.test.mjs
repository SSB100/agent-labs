import assert from "node:assert/strict";
import test from "node:test";

import serviceModule from "../.core-tests/core/service.js";
import validationModule from "../.core-tests/core/validation.js";

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
  const value = validateCoreContract("goal", validGoal);
  assert.deepEqual(value, validGoal);
});

test("unknown pack-specific fields are rejected", () => {
  assert.throws(
    () =>
      validateCoreContract("goal", {
        ...validGoal,
        etsyListingId: "listing-123",
      }),
    (error) =>
      error instanceof CoreContractValidationError &&
      error.issues.some((issue) => issue.path === "$.etsyListingId"),
  );
});

test("invalid enum values and identifiers are rejected", () => {
  assert.throws(
    () =>
      validateCoreContract("goal", {
        ...validGoal,
        id: "not-a-uuid",
        status: "imaginary",
      }),
    CoreContractValidationError,
  );
});

test("task-linked artifacts must also identify their workflow", () => {
  assert.throws(
    () =>
      validateCoreContract("artifact", {
        id: "00000000-0000-4000-8000-000000000103",
        businessId: ids.business,
        workflowRunId: null,
        taskContractId: ids.task,
        artifactType: "generic.output",
        name: "Synthetic output",
        mediaType: "application/json",
        storagePath: null,
        content: {},
        metadata: {},
        checksum: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    CoreContractValidationError,
  );
});

test("the Core service validates before delegating persistence", async () => {
  const calls = [];
  const repository = {
    transaction: async (work) => work(repository),
    create: async (kind, value) => {
      calls.push({ kind, value });
      return value;
    },
    update: async () => {
      throw new Error("not used");
    },
    findById: async () => null,
  };
  const service = new ValidatedCoreStateService(repository);

  await service.create("goal", validGoal);
  assert.equal(calls.length, 1);

  await assert.rejects(
    service.create("goal", { ...validGoal, marketplaceField: true }),
    CoreContractValidationError,
  );
  assert.equal(calls.length, 1);
});
