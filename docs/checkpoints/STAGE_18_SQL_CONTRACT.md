# Stage 18 Assisted Etsy publication: SQL contract

Status: additive implementation prepared for review. Applying this migration requires separate approval of its exact authority delta. No live publication, account setup, billing authority or qualification is established.

## Exact authority delta

The additive migration creates three private, RLS-enabled tables with no grants to `PUBLIC`, `anon`, `authenticated` or `service_role`:

- `etsy_publication_runs`: immutable source, account, shop, listing, preflight, disclosure, approval and fee-exposure bindings; mutable lease, revision, stop and execution state
- `etsy_publication_operations`: one append-only activation marker per run, persisted before dispatch
- `etsy_publication_mutation_admissions`: transaction-scoped admission used only inside the dedicated owner RPC

The sole new public entry point is `etsy_publication_owner_transition(uuid,text,jsonb,text)`. Only `authenticated` may execute it, and every operation checks current Business ownership. `workspace` and `cancel` need no server key. All other operations additionally require an enabled existing Etsy server authority. No new key, account scope, credential, model route, Worker capability, workflow or catalog row is installed. Eight private helpers have no application-role execute grants.

Additive provenance triggers protect publication intents, receipts, published-resource mappings, events and owner interventions, including calls through older generic security-definer procedures. Adopted Stage 16 draft identities, states, receipts and resource mappings cannot be rewritten; their operational acquire/release lease fields retain their previous behavior. The new successful mapping is a distinct `published_listing` row, leaving the historical `draft_listing` row untouched.

Exactly five existing public tables gain these narrow guards: `action_intents`, `action_receipts`, `external_resources`, `events` and `owner_interventions`. The existing private `etsy_draft_runs` table gains the adopted-history guard.

No preexisting migration, function body, function ACL, owner, table ACL, catalog row or RLS policy is changed. Exact `prosrc` checks fail before DDL if the prerequisite Stage 16 package validator or Stage 17 source, catalog or provenance guards differ from the reviewed frozen parent. These checks are independent of PostgreSQL's function-definition rendering.

## Trusted source boundary

`source` resolves an actual owner-scoped verified Stage 16 private draft run. It requires exact package/hash, account revision, shop, listing, marker, succeeded independent-GET receipt, completed draft intent and original active draft resource. Every image maps to the original receipt-backed provider image ID and the verified draft operation; image counts, asset IDs and hashes must agree.

That exact package must be the immutable output of a completed Stage 17 listing run, with the final artifact, persisted specialist and reviewer outputs/executions, APPROVE verdict, package hash and both signed envelopes bound to the same Business and artifact. The server independently authenticates both envelopes. Publication never accepts owner-authored package or review JSON as provenance.

Before admission or activation, existing Stage 16 product-readiness and Stage 17 source/catalog/qualification validators are called again. Missing authentic finished-product evidence, verified current configuration, live worker qualification or signed upstream source remains a hard block. Source freshness is not manufactured by this migration.

## Owner consent, fee evidence and temporary scope

The request fingerprint binds the exact Business, connection and revision, shop, existing listing, product/review/draft-receipt hashes, preflight/disclosure hashes and the sole intended request: `PATCH /shops/{shop}/listings/{listing}` with `state=active`.

The immutable approval binds that fingerprint and the complete quote, total limit, billing currency, single approved quantity, payment-account charge, public data sharing and manual-renewal commitment. Fee components use exact nonnegative integer minor units and must sum to the stated total. Quote/approval timestamps, expiry and hashes are validated; expiry is at most one hour after approval and no later than source expiry.

This temporary qualification lane supports only an already single-unit physical draft with manual renewal, manual shipping and an explicit positive return-policy identity. The server and engine validate the actual shipping, return and processing readbacks. They never rewrite a draft to satisfy the restriction. Calculated shipping is blocked because the existing package lacks the required weight/dimension bindings.

Crucially, a structurally valid financial object is not spending authority. `stage18_assert_fee_authority` unconditionally raises `publication_all_in_fee_authority_unavailable`. Current integration evidence cannot establish a trusted account-specific all-in fee bound including mandatory charges, tax and currency conversion. There is no quote-issuing RPC/table, owner-entered fee JSON or synthetic production fee issuer. Enabling that boundary requires a separately reviewed authenticated source implementation.

The approved exposure remains immutable. A sent activation has unknown actual charge; even a verified active listing retains `feeStatus=unreconciled`, `feeAmountMinor=null` and `feeCurrency=null`. Neither an HTTP response nor successful publication is fabricated into a known invoice amount.

## Execution and failure semantics

- `prepare`: exact-source consent admission; permanent uniqueness on draft and Business/shop/listing; identical replay returns the original run without resetting approval or exposure
- `acquire` / `release`: exclusive bounded lease; `save` / `finish`: compare-and-set revisions
- `guard(publish)`: current connection, current source/qualification, approval lifetime, stop and fee authority
- `save`: immutable request identity, one durable sent marker, no removed/replaced attempt or response hash, monotonic observed-active history
- `guard(reconcile)`: current authorized connection plus original immutable source; read-only same-listing inspection remains possible after source/approval expiry or stop
- `finish`: one succeeded receipt and new published mapping only after a sent marker and exact independently verified active result; no old draft rows are rewritten
- Core intent status: definite failure becomes `failed`; pre-dispatch cancellation becomes `expired`; dispatched uncertainty remains `executing` until independently verified
- Core Needs You: uncertainty or a stop after dispatch creates at most one open `etsy.publication.reconcile` intervention per action, with fixed read-only guidance and empty options. Generic writes cannot forge or resolve it. Only verified active readback or cancellation before dispatch resolves it; verified resolution preserves unknown fee status
- `workspace`: already-admitted drafts appear only in publication history, preventing an active or attempted listing from reappearing as a new candidate. An optional `interventionId` must resolve through the exact owned Business/type/action/run join; its run is prioritized within the existing 50-row bound. Resolved interventions remain valid history links. Missing, foreign, ordinary or mismatched IDs fail closed
- `cancel`: stops later activation. An already-dispatched request remains uncertain and may settle active after stop. An observed active result cannot become an unpublished claim

No hidden retry, listing creation, renew, order, inventory or multi-listing authority is added. A lost response never clears the activation marker. A verified terminal replay does not call the provider again.

## Offline verification

The isolated PostgreSQL rehearsal uses PGlite with real role, ACL, RLS, constraints, triggers and `pgcrypto` enforcement. Auth/Storage and provider data are synthetic. It performs no hosted SQL, real account, provider or paid operation.

`stage18_etsy_publication.sql` covers owner isolation, public/private grants, unavailable fee authority despite correct-shaped input, source/receipt/image bindings, missing consent, immutable hashes, launch replay, lease/CAS, sent-before-dispatch state, active-state retention, rejected history mutation, cancellation, late active completion, honest unknown fee, no duplicate receipt, exact old draft preservation, expiry, disabled authority, connection revocation, deduplicated Core Needs You visibility/resolution, immutable intervention provenance, Core terminal status and exclusion of already-admitted drafts, and target-link ownership/type/action validation. A 50-newer-run fixture proves an older resolved intervention still selects its exact run within the history bound. Source-provenance checks run the real new helper; state-machine fixtures isolate only upstream live freshness and the explicitly unavailable fee prerequisite inside the rollback transaction.

The separate compiled-engine-to-PostgreSQL wire rehearsal exercises the actual five-case Stage 17 qualification engine and two-call signed-package issuer, the actual Stage 16 draft engine/RPC, and the actual Stage 18 publication engine/RPC. Provider-shaped responses are injected. All Stage 17 and Stage 18 source/provenance validators remain real. Only upstream Stage 16 live-product readiness and the unavailable all-in fee authority are transactionally isolated. It proves the real fee gate rejects first, the marker exists before the sole injected PATCH, independent exact readback completes once, terminal replay adds no requests, old draft/receipt/resource rows remain byte-identical, and fees remain unknown. A second real-engine wire scenario stops during the injected activation call, verifies the single Core Needs You intervention opens, then reconciles the active result and resolves that intervention while preserving the stop and unknown fee. The entire rehearsal rolls back exactly.

These are implementation proofs, not live product evidence, real publication qualification, an invoice, or approval to apply the migration. Stage 18's repeated real-publication exit remains open.

### Frozen offline audit (2026-10-01)

- Migration SHA-256: `9de3c599438b36e5e755ec4849531915da5a683ae4eb94c45f13aa5390e8a00f`
- SQL suite SHA-256: `69668b04d9aa2e0f6fc11dacc5019c25c6cb1720e0051ac48e542322559275df`
- Twenty self-contained SQL suites passed, with 715 lexical ASSERT statements; the new publication suite contains 69, plus expected-error probes. Every suite restored exact schema/data hashes after rollback
- All 127 preexisting rows and all 184 preexisting function bodies/signatures/owners/ACLs/configuration remained unchanged. All preexisting relation ACLs were unchanged. No existing-table catalog rows were added
- Successful-apply rollback, injected-failure rollback and unexpected-prerequisite-drift rejection/rollback restored exact state
- Final compiled-engine wire proof passed after the last SQL changes, with exact whole-transaction rollback
- Hosted migration, database advisors, real credentials/accounts, provider execution, spending and live qualification were not performed

The five previously documented historical fixture-dependent SQL suites remain outside the self-contained pass count; their absent live-tenant fixtures are not supplied or fabricated here.
