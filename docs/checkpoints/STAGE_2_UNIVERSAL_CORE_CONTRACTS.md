# Stage 2 checkpoint: Universal Core data contracts

## Source of truth

This checkpoint implements **Stage 2: Universal Core data contracts** from `AGENT_LABS_V2_IMPLEMENTATION_PLAN.md`.

It does not start the Vercel Workflow runtime, invoke a worker, call a model, launch a browser, connect a provider, install a production pack or add Etsy-specific fields.

## Universal contracts

Stage 2 establishes the durable shared language used by future packs:

- Goal
- Pack
- WorkflowDefinition
- WorkflowRun
- WorkflowStageRun
- TaskContract
- WorkerDefinition
- WorkerRun
- Artifact
- Evidence
- Event
- ExternalResource
- ActionIntent
- ActionReceipt
- OwnerIntervention

The corresponding Postgres tables use generic Core fields only. Commerce, marketplace and provider-specific state must be added later through packs, external-resource metadata or versioned artifacts rather than leaking into Core.

## Hosted migrations

```text
20260929011830_universal_core_contracts
20260929011903_core_contract_optional_fk_delete_semantics
20260929021058_core_contract_relationship_integrity
```

The migrations:

- create all 15 Core tables
- enable RLS on every exposed table
- scope all Business state through the authenticated Business owner
- keep Pack, WorkflowDefinition and WorkerDefinition read-only to application clients
- make Evidence, Event and ActionReceipt append-only to application clients
- seed one generic synthetic Pack, WorkflowDefinition and WorkerDefinition
- enforce Business consistency through composite foreign keys
- prevent a Task Contract from pointing at a stage in another Workflow Run
- prevent a Worker Run from changing the Task Contract's workflow or worker
- prevent task-linked Artifacts and ActionIntents from omitting or changing their Workflow Run
- preserve the Business identifier when optional references are cleared

## Application contracts

`src/core` provides:

- strongly typed universal contract interfaces
- explicit status and role vocabularies
- contract-to-table mappings
- runtime validation for every durable contract
- rejection of unknown pack-specific fields
- repository interfaces that keep persistence replaceable
- a service boundary that validates records before persistence

No Supabase call is embedded in the Core contract service. A later adapter can implement `CoreRepository` against Supabase, self-hosted Postgres or another compatible persistence layer without changing worker and workflow contracts.

## Verification

Completed against the hosted Agent Labs Supabase project:

- all Stage 2 migrations applied successfully
- all 15 Core tables exist with RLS enabled
- synthetic Pack, WorkflowDefinition and WorkerDefinition records are present
- a transactional synthetic workflow created Goal, WorkflowRun, WorkflowStageRun, TaskContract, WorkerRun, Artifact, Evidence, Event, ExternalResource, ActionIntent, ActionReceipt and OwnerIntervention records
- the owning user could read the synthetic state
- a second authenticated user saw zero Business, WorkflowRun and Artifact rows from the fixture
- the transaction was rolled back and left no synthetic Business data behind
- security advisors reported no RLS or exposed-table findings
- the project currently retains one separate Auth warning because leaked-password protection is disabled

Repository verification includes:

- runtime contract validation fixtures
- static migration and RLS tests
- append-only grant tests
- relationship-integrity tests
- a guard against commerce-specific fields in Core
- repository and service boundary tests
- lint, typecheck, tests and production build through the normal Vercel gate

## Stop point

Stage 2 is complete when the branch passes the complete repository and Vercel gates and production is verified. Stage 3 must not begin until this checkpoint is reviewed.
