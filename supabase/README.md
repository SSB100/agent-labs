# Supabase workspace

Agent Labs V2 uses the existing hosted Supabase project:

- Project name: Agent Labs
- Project reference: `tfdareuwrshjuevuiwvn`
- Region: Sydney (`ap-southeast-2`)

## Migration history

### Stage 1

`20260929003530_initial_identity_business.sql` establishes profiles, Businesses, membership triggers and owner-scoped Row Level Security.

### Stage 2

`20260929011830_universal_core_contracts.sql` establishes the generic durable Core contracts for packs, definitions, goals, workflows, stages, Task Contracts, workers, artifacts, evidence, events, external resources, action intents, receipts and owner interventions.

`20260929011903_core_contract_optional_fk_delete_semantics.sql` preserves Business identity when optional references are cleared.

`20260929021058_core_contract_relationship_integrity.sql` prevents cross-workflow and cross-worker relationship mismatches.

### Stage 3

`20260929030033_stage3_vercel_workflow_runtime.sql` adds runtime identity, launch reservation and duplicate prevention.

`20260929033834_stage3_scoped_runtime_capability.sql` adds a one-run SHA-256 capability and bounded durable transitions.

`20260929034351_stage3_capability_helper_permission.sql` grants the minimum helper permission required by the scoped path.

`20260929043635_stage3_qualification_cleanup.sql` removes temporary qualification support and data.

`20260929044045_stage3_runtime_grant_tightening.sql` limits transition execution to the capability-gated Workflow client.

### Stage 4

`20260929060408_stage4_worker_pack_foundation.sql` installs the experimental Generic Researcher Worker Pack, WorkerDefinition, proof WorkflowDefinition, launch reservation and Stage 4 capability boundary.

`20260929060533_stage4_worker_runtime_transition.sql` installs the durable Task Contract, Worker Run, output, receipt and failure transitions used for live qualification.

`20260929063538_stage4_worker_runtime_consolidation.sql` preserves a replayable final transition definition and exact Task Contract context helper.

`20260929063554_stage4_qualification_cleanup.sql` deletes the temporary success and malformed-output qualification Businesses after evidence was recorded.

### Stage 5

`20260929074449_stage5_model_router_foundation.sql` adds the provider-neutral model registry, capability and qualification records, logical route policies, model invocation telemetry and initial Model Router workflow records.

`20260929074737_stage5_model_router_runtime.sql` adds the first capability-gated durable Model Router transition.

`20260929081542_stage5_model_schema_consolidation.sql` preserves a replayable Stage 5 schema and RLS definition.

`20260929081624_stage5_model_catalog.sql` installs the initial model and route catalog.

`20260929081703_stage5_worker_route_contract.sql` installs the model-backed Generic Researcher and its logical route requirements.

`20260929081753_stage5_runtime_start_task.sql` installs the start, Task Contract and exact-context helpers.

`20260929081833_stage5_runtime_route_worker.sql` installs route resolution and Worker Run helpers.

`20260929081929_stage5_runtime_invocations.sql` installs durable model attempt, token, cost and failure telemetry.

`20260929101714_stage5_openrouter_catalog_correction.sql` aligns the hosted catalog with the live OpenRouter model IDs and current pricing metadata used for qualification.

`20260929101810_stage5_live_qualification_recorder.sql` and `20260929102028_stage5_live_qualification_outcomes.sql` provide temporary capability-gated live qualification evidence recording.

`20260929103127_stage5_build_diagnostics.sql` provides a temporary private build-stage diagnostic used to isolate qualification failures.

`20260929104732_stage5_terminal_transition_fix.sql` hides the prior terminal implementation and routes Worker completion and failure through corrected private helpers.

`20260929105127_stage5_qualification_cleanup.sql` normalises the successful live evidence, marks all five model definitions live-qualified, removes the temporary fixture Businesses and drops the temporary qualification and diagnostic objects.

### Stage 6

`20260929115518_stage6_worker_evaluation_framework.sql` preserves the first hosted Stage 6 migration position. The final replayable definitions are consolidated by the migrations below.

`20260929120153_stage6_qualification_helper_security.sql` restricts the authenticated qualification-status helper and removes anonymous execution.

`20260929120901_stage6_evaluation_schema_consolidation.sql` creates the versioned evaluation-suite, case, run, result and Worker-promotion tables with read-only application access and RLS.

`20260929120943_stage6_evaluation_runtime_consolidation.sql` installs the exact Worker and model-route fingerprint, owner evaluation reservation, capability-gated case recording, scoring and promotion runtime.

`20260929121005_stage6_evaluation_invalidation_and_gate.sql` invalidates stale qualifications after relevant Worker Pack, route, model or model-qualification changes and blocks new Task Contracts for evaluated workers without a current passed evaluation.

`20260929121027_stage6_generic_researcher_evaluation_catalog.sql` installs the 11 required Generic Researcher schema, role-boundary, mocked-capability, positive-example and negative-example cases.

### Stage 7

`20260929125855_stage7_core_ui_realtime_publication.sql` publishes the owner-scoped Core activity tables required by the private live interface through the existing `supabase_realtime` publication:

- `artifacts`
- `businesses`
- `events`
- `owner_interventions`
- `task_contracts`
- `worker_runs`
- `workflow_runs`
- `workflow_stage_runs`

The Stage 7 browser client subscribes with the signed-in owner session. PostgreSQL RLS therefore remains the source of truth for which live rows can be delivered.

## Security boundary

Every exposed table has RLS enabled. Business-scoped records are available only to the authenticated Business owner. Pack, WorkflowDefinition, WorkerDefinition, model definition, qualification, route and Worker-evaluation catalog records are read-only to application clients. Evidence, Event and ActionReceipt records are append-only to application clients.

Workflow runtimes use the project publishable key plus an unguessable capability scoped to one Workflow Run. They do not expose or depend on a Supabase secret key or service-role key.

Stage 4 and Stage 5 workers receive only a Task Contract and explicitly referenced Artifacts. Worker receipts record the pinned pack and worker versions, logical model route, selected provider model, context policy, validation outcome, tokens, cost and stop reason.

The Stage 5 runtime's legacy implementation is not executable by API roles. The permanent public transition exposes only the capability-gated entry point required by the durable Workflow client.

Stage 6 application users can read evaluation history but cannot directly create results or promotions. Case recording and completion require the high-entropy capability for one exact evaluation. Qualification is tied to a SHA-256 fingerprint of the Worker definition, Worker Pack, route, primary model, fallback model and current model-qualification evidence.

A relevant Worker Pack or model change invalidates the passed result and conservatively returns the Worker to Experimental until the current suite passes again. PostgreSQL enforces this at Task Contract creation, so an evaluated Worker cannot execute merely because a UI still shows an old status.

Stage 7 Realtime does not add public read access. The published tables retain their existing RLS policies, and the second authenticated test owner sees zero of the primary owner's Businesses, workflow runs, stages, events, interventions and Artifacts.

`OPENROUTER_API_KEY` remains a server-only Vercel environment variable and is not stored in Supabase application tables.

Never commit secret or service-role keys. Browser, SSR, workflow and evaluation clients use only the project URL and publishable key through the two `NEXT_PUBLIC_SUPABASE_*` environment variables.
