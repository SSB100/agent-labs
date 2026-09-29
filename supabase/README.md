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

Every exposed table has RLS enabled. Business-scoped records are available only to the authenticated Business owner. Pack, WorkflowDefinition and WorkerDefinition records are read-only to application clients. Evidence, Event and ActionReceipt records are append-only to application clients.

The hosted Stage 2 schema was verified with a transactional synthetic workflow and two authenticated-user identities. The fixture created all business-scoped Core record types, confirmed owner access, confirmed cross-owner isolation and rolled back without leaving production fixture data.

Never commit secret or service-role keys. Browser and SSR clients must use only the project URL and publishable key through the two `NEXT_PUBLIC_SUPABASE_*` environment variables.
