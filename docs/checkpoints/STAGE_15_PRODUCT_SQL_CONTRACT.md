# Stage15 product configuration persistence contract

Status: reviewed and installed on the Agent Labs hosted database at 2026-10-02 00:42:56 UTC, after explicit owner approval and native confirmation. Hosted migration version is `20261002004256_stage15_product_configuration`; the filename was aligned without changing the approved SQL bytes. The original migration was generated with the cached official Supabase CLI 2.101.0 using `supabase migration new stage15_product_configuration`. No source, account, credential, enabled authority, provider request, deployment, paid action, or live qualification is created by this migration.

## Scope and authority

The bounded lane is one native Manual/API-store product, one catalog variant, ordinary DTG front or back. Product configuration, file upload, physical placement, marketplace publication, and paid fulfilment remain distinct authorities.

The migration adds only six private tables, private helpers, a single owner transition RPC, and additive Core provenance triggers:

- `printful_product_server_authority`: hashed server keys, disabled by default and empty
- `printful_product_write_authorities`: exact Business/owner/connection/revision/store binding, application scope `product.configure`, bounded documented provider scopes, opaque credential envelope, disabled by default and empty
- `printful_product_sources`: immutable administrative trusted-source import seam, empty; there is no owner/server source-registration operation
- `printful_product_runs`: permanent one-run-per-source identity, source/approval snapshots, Core IDs, CAS revision, stop flag and exclusive lease
- `printful_product_operations`: one immutable pre-dispatch marker per run, including the database-generated lease acquisition epoch
- `printful_product_mutation_admissions`: transaction-local admission records, inaccessible to application roles and removed before RPC return

Every new table has RLS and explicit revocation from PUBLIC, anon, authenticated and service_role. No table permission or definition of an existing table/function is changed. The existing account `catalog.read` scope and its provider credential are not used or widened. Product provider scopes are separately constrained to sync-products read/write, file-library read and store-list read; orders and file upload are excluded.

The public RPC requires the current Business owner. Except for bounded workspace reads and Stop, it additionally requires the separately provisioned `PRINTFUL_PRODUCT_SERVER_KEY` whose hash is enabled in the new authority table. A service-role key alone cannot invoke the RPC. The release does not provision that key or provide a write-authority activation path. The TypeScript write resolver and readiness gate independently remain unavailable.

## RPC wire contract

`public.printful_product_owner_transition(p_business_id uuid, p_operation text, p_payload jsonb = '{}', p_server_key text = '')`

- `workspace`: bounded, owner-scoped `sources` and `runs`; supports an exact product intervention ID. Source choices include catalog/variant/placement/dimensions/price/hash/expiry fields required by the UI, never storage paths, credential envelopes or complete source bodies. Availability flags remain false
- `source`: `{sourceId}` returns `{source,sourceHash}` from private immutable trusted evidence, with full current-source validation
- `connection`: `{sourceId}` returns only an exact separately bound write authority and opaque credential envelope after current account/revision checks; the application does not decrypt or activate it in this slice
- `prepare`: `{sourceId,sourceHash,requestHash,approval,approvalHash}` validates immutable source and exact owner approval; returns `{runId,created}`. Replay cannot reset approval, stop state or identity
- `acquire`: `{runId,lease}` exclusively leases for two minutes; returns `{state,revision}`
- `guard`: `{runId,lease,mode:'configure'|'reconcile'}` returns `{source,sourceHash,approval,approvalHash,stopRequested}`
- `save`: `{runId,lease,revision,state}` applies CAS and monotonic state constraints
- `finish`: save fields plus exact Core-shaped `receipt` and `resource`, atomically records a partial independent observation
- `release`: `{runId,lease}` releases only the current live lease
- `cancel`: `{runId}`, owner-only without a configured server key; records Stop, keeps external observation/history and makes no deletion claim

Source and approval hashes use `private.stage14_hash` canonical JSON, matching TypeScript `productHash`. The foundation plan's existing insertion-ordered hash is unchanged; the immutable canonical source covers the plan in SQL, while the TypeScript foundation validator reconstructs the original fixed key order after a jsonb round trip.

External identity is `al-pf-` plus the source UUID without hyphens. The request hash is SHA-256 of `printful-product-configure:v1:<businessId>:<sourceId>:<sourceHash>:<connectionId>:<connectionRevision>:<storeId>`. The approval is exact, single-operation, and valid for at most five minutes and no longer than source expiry.

## Source and dispatch checks

Current-source validation requires:

- The current connected Printful owner/store/revision, native store kind and unexpired account evidence
- A current active Business goal and its owning non-stopped workflow
- The exact persisted Stage14 `candidate_production` approval, its canonical snapshot hash, owner, candidate and decision
- The unchanged Stage14 validator, including the exact latest persisted TEST and legacy/v2 evidence provenance
- The exact creative run's completed, production-ready workflow
- The current highest-version asset, storage path, SHA-256, passing inspection, independent passing review, source pixels and approved physical dimensions
- Immutable uploaded-file evidence matching the approved asset, provider file ID/MD5 and pixels
- Explicit independently sourced v1 file-type evidence, `default` for front or `back`
- Current variant stock evidence; complete, explicit cost/pricing inputs with no unknown shipping/tax/fee/reserve values; their canonical source fact hash
- Bounded timestamps and freshness for each source evidence object
- Separate authenticated physical-placement evidence before preparation or dispatch

The production creative workflow is validated independently of the goal-linked owning workflow, matching Stage16's established lineage model; current creative launch does not set a goal ID.

Source ingestion is deliberately absent. Caller JSON, foundation previews, mappings, product GETs and synthetic fixtures cannot mint authoritative rows. Authenticated upload and placement producers still need separate design, approval, implementation and qualification.

A single marker must be durably saved before any POST. Its request hash and sent time cannot be changed or cleared. A final pre-send configure guard is allowed only in the same database-generated lease acquisition epoch. Re-acquiring even with the identical lease token does not regain configure authority. After a marker, recovery is read-only reconciliation of the saved identity. Observed product/variant IDs are monotonic and cannot be reset or reassigned.

Stop does not increment CAS revision, allowing an in-flight authentic observation to settle. SQL normalizes a concurrently changed Stop flag and recomputes its observation hash. New reconciliation reads still require current account/write access. `finish` can retain already-obtained observations after stop, source/approval expiry or connection revocation; those conditions do not turn a real external observation into a claim that nothing happened.

## Truthful partial completion

The native product GET proves product/variant/file associations. It does not prove exact physical placement or printing technique. This slice therefore has no fully verified completion transition.

`finish` accepts only:

- Core receipt provider `printful`, outcome `uncertain`, attempt 1, exact run/Business/request/resource bindings
- Core resource type `product_configuration_observation`, status `pending`, exact store/product external identity
- Identical closed metadata/summary with independent product/file read hashes, exact asset/file associations and `verifiedBy: independent_get`
- `physicalPlacementVerified=false`, `techniqueVerified=false`, `configurationVerified=false`, `liveQualified=false`, `listingReady=false`, `publicationAuthorized=false`, and `orderSubmissionAuthorized=false`
- The two explicit missing-observation blockers, persisted `needs_owner` state, and immutable observation hash

The readback `providerFactsHash` is independently reconstructed from observed sync IDs and exact source selections. It is not the upstream catalog/stock/cost hash and never becomes Stage17's `productFactsHash`. The action intent stays `executing`, and a Core owner intervention records the unresolved verification requirement. No Product Package or listing artifact is minted. These pending/uncertain records fail Stage16's existing complete configuration gate.

Core triggers protect by semantic lane and persisted identities, including against older generic definer writers. They remain SECURITY INVOKER. A separate owner-scoped boolean identity lookup uses an empty-search-path SECURITY DEFINER and exposes no private row; only this narrow lookup is executable by authenticated/service_role, avoiding an unrelated Core-write regression while preserving invoker admission checks.

## Offline verification

The focused SQL file is a transaction with final rollback. It uses clearly synthetic administrator-inserted fixtures. It exercises owner/foreign/role denial, no private data reads, missing/disabled key, separate absent write authority, unchanged catalog scope, denied source ingress, stale exact TEST, technical-approval rejection, latest asset, stopped goal, file-type/stock/cost/freshness mismatch, UI projection, exact approval replay, lease/CAS, one marker, acquisition-epoch ABA prevention, monotonic IDs, pre/post-dispatch Stop, revocation, truthful partial finish, immutable receipts/resources, no listing artifact and ordinary unrelated authenticated writes through the new invoker trigger.

The real Stage14 helper is first exercised for synthetic-evidence rejection and a superseding persisted decision. Only then is that helper temporarily isolated for downstream state-machine fixtures. That replacement is rolled back. This is not positive end-to-end Stage13/14 evidence or live product qualification.

`tests/printful-product-sql.test.mjs` runs six static contracts in the normal unit command. Its seventh test is explicitly skipped unless `PRINTFUL_SQL_TEST_HOST` points to an already installed local PGlite host directory. A skip is not SQL verification. The opt-in test installs no software and makes no network/provider calls.

Verified with preinstalled PGlite 0.5.8:

1. Full 84-migration local baseline plus the new migration replayed successfully
2. Every pre-existing public/private function body, ACL, security mode and search path remained byte-equivalent in the local catalog
3. Every pre-existing table's ACL/RLS state and canonical row-count/content fingerprint remained unchanged
4. Rollback SQL regression passed
5. Real compiled TypeScript source validation, adapter normalization, engine and SQL repository exchange passed through an injected transport: five GETs, zero POSTs, uncertain receipt, pending resource, distinct upstream/readback fact hashes
6. Repeating the completed-observation engine run made zero provider calls
7. Final rollback and PGlite close both succeeded; all seven opt-in tests passed, with zero skipped

Reproduce after compiling the normal core-test output:

```sh
PRINTFUL_SQL_TEST_HOST=/path/to/preinstalled-pglite-host node --test tests/printful-product-sql.test.mjs
```

This isolated host must already provide `@electric-sql/pglite` and its `pgcrypto` extension. It must never be a hosted database URL. The normal default test command reports six pass, one explicitly skipped. No broad local full-suite repeat is required by this contract.

## Documentation and remaining gates

Supabase's current changelog and database function/RLS guidance were checked on 2026-10-01. The September PostgreSQL minor-version notice concerns legacy PGP ciphers, ltree/btree_gist indexes and custom operators; this migration introduces none of those. It uses SHA-256 digest and no decrypt operation.

- https://supabase.com/changelog
- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://developers.printful.com/docs/

Independent final code/security review, explicit migration approval, hosted application and target role/advisor review are complete. Still required: final exact-head software release verification, separately approved credential/write-scope provisioning, authenticated upload and physical-placement producers, then one specifically authorized real configuration and its independent qualification. None is implied by the database installation.

Hosted preservation checks found all 160 existing function definitions/security/ACLs, 77 existing table ACL/RLS definitions and 109 existing triggers unchanged. Every existing table count remained unchanged (1,219 total rows); no credential/session-secret columns were read for those checks. The six new tables are empty, have RLS, and deny direct access to anon/authenticated/service_role. The owner RPC denies anon and service_role execution and retains its owner check and separate server-key guard.

Security advisors report the expected six private deny-all RLS/no-policy INFOs and one authenticated SECURITY DEFINER warning for the deliberately owner-guarded RPC. No new anonymous definer exposure was introduced. Existing runtime-capability warnings and the prior Auth leaked-password-protection warning remain outside this migration. See the [function advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [deny-all RLS advisory](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), and [password-protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Reviewed offline file fingerprints

- Migration SHA-256: `46088d3246608419c861a6e88979f6d3aec467d6b93a6b31599102d21cfba62f`
- Rollback SQL regression SHA-256: `733cf7975c07d02e04afd8c02545a1ced2c672ec0c76d7b03ed01aacb1c3b858`
- Node static/wire test SHA-256: `19be2a82792ecd8d13c91c811713c79dac5824137e085fd036b878b87d1c6802`

These fingerprints identify the reviewed, offline-tested and installed migration bytes. They do not prove provider activation or live qualification.
