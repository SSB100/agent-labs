# Stage 4 checkpoint: Worker Pack runtime

## Source of truth

This checkpoint completes **Stage 4: Worker Pack runtime** from `AGENT_LABS_V2_IMPLEMENTATION_PLAN.md`.

Stage 4 proves that Agent Labs can execute one bounded specialist worker against a durable Task Contract. It does not connect OpenRouter or another model provider, operate a browser, install a production commerce pack or begin Stage 5 model routing.

## Two-slice implementation

Stage 4 was implemented in two controlled slices:

1. Worker Pack contracts, validation and durable runtime boundaries.
2. Live Workflow qualification for successful output, malformed output, duplicate prevention and isolation.

## Worker Pack

The installed experimental fixture is:

```text
Pack:    worker.generic-researcher-fixture@1.0.0
Worker:  generic.researcher.fixture@1.0.0
Role:    Generic Researcher
```

Its versioned manifest includes:

- worker charter
- input schema
- output schema
- capability policy
- knowledge requirements
- model requirements
- instructions
- positive examples
- negative examples
- escalation policy

The fixture intentionally has no external capabilities and no model route. It uses deterministic supplied evidence so the worker boundary can be qualified independently of Stage 5.

## Context boundary

The worker receives exactly two top-level context fields:

```text
taskContract
inputArtifacts
```

The runtime rejects unknown context fields and recursively rejects unrestricted chat, conversation history, messages, credentials and secret fields. The supplied artifacts must exactly match the Task Contract identifiers. Required knowledge and permitted capabilities must remain inside the pinned Worker Pack declaration.

The qualified Worker Run persisted:

```text
input keys:                   inputArtifacts, taskContract
conversation history:         false
context policy:               task_contract_and_referenced_artifacts_only
permitted capabilities:       none
model route:                  not_used_stage4_fixture
```

## Runtime flow

The durable proof workflow is:

```text
Start
→ Task Contract
→ Worker
→ Validate
→ Complete
```

An authenticated owner reserves a run with a Business-scoped idempotency key. The durable Workflow receives one random capability, while Supabase stores only its SHA-256 hash. Each transition validates the capability, Workflow Run and Business before writing state.

The runtime creates and persists:

- input Artifact
- Task Contract
- Worker Run
- classified worker status
- validated output Artifact on success
- execution receipt
- workflow stages
- business-readable events

## Output validation and stopping

Worker output is checked against the pinned Worker Pack JSON Schema and Task Contract completion criteria. Evidence references may identify only artifacts named by the Task Contract.

The qualified output contained:

- decision `complete`
- three evidence findings
- evidence and inference in separate fields
- one referenced input Artifact
- scope boundary `task_contract_only`
- stop reason `completion_criteria_satisfied`

The Worker Run completed after one attempt and recorded an `outputValidated: true` receipt. No additional worker or planning iteration was created after completion.

## Failure classification

The malformed-output fixture deliberately returned an incomplete object. The runtime rejected it and persisted:

```text
category: validation_failed
workflow stage: validate
worker attempts: 1
output artifact: none
```

The stored validation details identify the missing fields and invalid `findings` type. The workflow stopped after classification. It did not retry malformed deterministic output and did not invoke free-form replanning.

Supported Stage 4 categories are:

- `contract_invalid`
- `context_invalid`
- `validation_failed`
- `worker_execution_failed`

## Live qualification

### Successful path

```text
Core Workflow Run: 00000000-0000-4000-8000-000000004411
Workflow runtime:  wrun_01M3NXRYXWZ6XQRCRBD6DQ9PCX
Worker Run:        bc12ad03-e782-5dbe-a699-aa460a42c4ee
Result:            completed
Final stage:       complete
Evidence count:    3
Worker attempts:   1
```

### Malformed-output path

```text
Core Workflow Run: 00000000-0000-4000-8000-000000004412
Workflow runtime:  wrun_01M3NXX8E3Q2ERYFMK57NGKET2
Worker Run:        25d07a3e-943d-50fd-a7d8-1a224a3cd7a2
Result:            failed
Final stage:       validate
Failure category:  validation_failed
Worker attempts:   1
```

### Duplicate prevention

A second insert using the successful Business and idempotency key inserted zero rows. The authoritative Workflow Run count remained one. Each qualification path created exactly one Worker Run.

### RLS isolation

A second authenticated identity could see zero qualification Businesses, Workflow Runs and Worker Runs owned by the fixture identity.

## Hosted migrations

```text
20260929060408_stage4_worker_pack_foundation
20260929060533_stage4_worker_runtime_transition
20260929063538_stage4_worker_runtime_consolidation
20260929063554_stage4_qualification_cleanup
```

The consolidation migration preserves a replayable final Stage 4 transition definition and the exact Task Contract context helper. The cleanup migration deletes the two temporary qualification Businesses and all cascading test history after evidence was recorded.

## Qualification cleanup

After qualification:

- the temporary Preview qualification route was removed
- the temporary redeployment marker was removed
- both qualification Businesses were deleted
- both qualification Workflow Runs and Worker Runs were deleted by cascading relationships
- temporary capability values were not retained in source or documentation
- the permanent Worker Pack, WorkerDefinition, WorkflowDefinition and runtime functions were retained

## Verification

Stage 4 passed:

- complete versioned Worker Pack manifest validation
- Task Contract-only context enforcement
- unrestricted conversation-history rejection
- capability and knowledge boundary validation
- structured input and output validation
- evidence provenance validation
- completion criteria and stop behaviour
- durable Task Contract creation
- durable Worker Run creation
- validated output Artifact creation
- durable worker receipt persistence
- malformed-output classification
- no failure loop or free-form replanning
- duplicate launch prevention
- cross-owner RLS isolation
- Workflow DevKit compilation
- full lint, TypeScript, test and Next.js production build gate

Supabase Security Advisor intentionally reports that the anonymous Workflow client can execute the capability-gated Stage 3 and Stage 4 transition functions. Neither function can mutate state without the matching one-run capability, Workflow Run ID and Business ID. The separate leaked-password-protection warning is an Auth project setting.

## Stop point

Stage 4 is complete. Stage 5 must not begin until this checkpoint and the owner-visible Worker Proof page are reviewed.
