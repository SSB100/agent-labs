# Supabase workspace

Agent Labs V2 uses the existing hosted Supabase project:

- Project name: Agent Labs
- Project reference: `tfdareuwrshjuevuiwvn`
- Region: Sydney (`ap-southeast-2`)

## Migration history

### Stage 1

`20260929003530_initial_identity_business.sql` establishes:

- `profiles`
- `businesses`
- `business_members`
- automatic Auth profile creation
- automatic owner membership after Business creation
- owner-scoped Row Level Security

### Stage 2

`20260929011830_universal_core_contracts.sql` establishes the generic durable Core contracts:

- packs and versioned workflow/worker definitions
- goals, workflow runs and stage runs
- Task Contracts and worker runs
- artifacts, evidence and events
- external resources
- action intents and append-only action receipts
- owner interventions

`20260929011903_core_contract_optional_fk_delete_semantics.sql` preserves Business identity when optional artifact and external-resource references are cleared.

`20260929021058_core_contract_relationship_integrity.sql` prevents cross-workflow and cross-worker relationship mismatches in Task Contracts, worker runs, artifacts, action intents and owner interventions.

### Stage 3

`20260929030033_stage3_vercel_workflow_runtime.sql` adds the versioned synthetic runtime definition, runtime provider identity, launch reservation and duplicate prevention.

`20260929033834_stage3_scoped_runtime_capability.sql` adds a SHA-256 capability scoped to one Workflow Run and the bounded transition function that records start, retry, wait, review, completion and failure state.

`20260929034351_stage3_capability_helper_permission.sql` grants the minimum helper permission required by the scoped capability path.

`20260929043635_stage3_qualification_cleanup.sql` removes the temporary qualification endpoint support functions, claim table and test Businesses after live durability evidence was recorded.

`20260929044045_stage3_runtime_grant_tightening.sql` revokes the unnecessary signed-in-user grant from the runtime transition function. The unauthenticated Workflow client retains only the capability-gated RPC needed for its single run.

Every exposed table has RLS enabled. Business-scoped records are available only to the authenticated Business owner. Pack, WorkflowDefinition and WorkerDefinition records are read-only to application clients. Evidence, Event and ActionReceipt records are append-only to application clients.

The Stage 3 runtime uses the project publishable key plus an unguessable one-run capability. It does not expose or depend on a Supabase secret key or service-role key in the application runtime.

Never commit secret or service-role keys. Browser, SSR and workflow clients use only the project URL and publishable key through the two `NEXT_PUBLIC_SUPABASE_*` environment variables.
