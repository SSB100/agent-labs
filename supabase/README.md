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

## Security boundary

Every exposed table has RLS enabled. Business-scoped records are available only to the authenticated Business owner. Pack, WorkflowDefinition and WorkerDefinition records are read-only to application clients. Evidence, Event and ActionReceipt records are append-only to application clients.

Workflow runtimes use the project publishable key plus an unguessable capability scoped to one Workflow Run. They do not expose or depend on a Supabase secret key or service-role key.

Stage 4 workers receive only a Task Contract and explicitly referenced Artifacts. Worker receipts record the pinned pack and worker versions, context policy, validation outcome and stop reason.

Never commit secret or service-role keys. Browser, SSR and workflow clients use only the project URL and publishable key through the two `NEXT_PUBLIC_SUPABASE_*` environment variables.
