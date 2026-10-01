# Stage 17 database contract

Status: offline implementation and rehearsal only. Applying the migration, running paid qualification, producing an authenticated upstream source, executing a listing run, and creating an Etsy draft are separate approvals and gates. No keys, credentials, live qualifications, accounts, provider calls, or business activations are installed by the migration.

## Authority and compatibility

The migration is additive. It does not replace existing Stage 6, Stage 14, Stage 16, generic Core, or other deployed functions, and does not expand their grants. It registers the exact experimental catalog exported by `src/listing/packs.ts`, including dedicated listing and qualification workflows.

New public entry points:

- `listing_owner_transition(uuid,text,jsonb,text)`: authenticated business owner only. `workspace` reads sanitized state; `start` additionally requires the existing enabled server authority, `approveModelCalls: true`, authentic immutable input, an exact current qualification, a complete fresh two-call quote and a separate approved maximum. `cancel`, expired-only `close`, and nonce-bound `fail_launch` do not require the server key. Qualification operations use a separate five-call budget.
- `listing_runtime_transition(uuid,uuid,text,text,jsonb)`: callable by anon/authenticated, but every operation requires the exact run/business capability. Its hash and launch nonce are private. Calls cannot obtain generic model, marketplace, account, upload, or spending authority.
- `listing_qualification_transition(uuid,uuid,text,text,jsonb)`: a separate capability-scoped evaluation path for the fixed server-owned qualification suite. It cannot produce a product package or use the production issuer.

Public listing runs, reservations, settlements and phase outputs have owner-only SELECT RLS and no direct mutation grants. Private capability, transaction-admission, qualification and attestation tables have RLS and no public/anon/authenticated/service-role grants. All private helpers revoke execution from those roles.

A private transaction admission record is inserted only inside the authenticated/capability-checked wrappers and removed before return. Additive Core triggers require that record even when another generic SECURITY DEFINER RPC executes as postgres. Generic workflow launch, reparenting, state changes, output mutation and history deletion therefore cannot bypass the dedicated protocol. An exception rolls back admission with the rejected operation.

## Source boundary

`product.package.v1` source content must contain the exact `listingInput` and an upstream-issued `listingInputEnvelope`. The server unseals the envelope, verifies actual image bytes using existing owner Storage access, and supplies a canonical source-content hash. SQL rechecks the entire immutable source content, exact input hash and identity, fresh source timestamps, and the unchanged `stage16_assert_package` guard before dispatch, output persistence and final issue.

SQL resolves actual records, rather than trusting owner-supplied flags:

- Printful source snapshot equals the bound succeeded receipt's `response_summary.listingFacts`
- Creative source snapshot equals the approval's exact `concept`, `designInstructions`, `rightsStatement`, `rightsConfirmed`, and `originalDesign` subset
- AI assistance is tied to actual generated creative assets for the product's creative run
- Business source snapshot equals `listing.business-facts.v1.content.listingSourceSnapshot`, with `listingSourceEnvelope` authenticated by the server
- Image evidence equals `listing.image-review.v1.content.proof`, its `reviewResultHash`, and its server-authenticated `imageReviewEnvelope`, including current asset, product-facts and finished-product bindings

Protected source/output artifact types and envelope-bearing provenance cannot be created through ordinary owner CRUD or rewritten/deleted. Missing signed upstream source, verified Printful facts, qualified creative output, actual finished-product image evidence, or current policy blocks execution. This migration does not invent those upstream records or implement a source-input issuer.

## Production protocol

The permanent key is `(business_id, source_artifact_id, input_hash)`. Business row locking and the unique constraint serialize repeated starts; a replay never installs a new capability, fresh budget or attempt. Runtime capability lifetime is at most one hour and at most the product input expiry.

There are exactly two possible provider reservations: `specialist` using `openai/gpt-5.6-luna`, then `reviewer` using `anthropic/claude-haiku-4.5`. Each creates/binds one Core stage, task, worker and pinned-knowledge artifact with no permitted capabilities. Semantic request hash and exact transport-request hash are separate and immutable. Every dispatch requires current fixed-model prices, bounded bytes/tokens, the approved phase ceiling, and:

`known actual cost + pending/unknown reservation exposure + new reservation <= approved maximum`

The reviewer cannot reserve until the specialist has an immutable validated output and known settled cost. Each request is single-attempt; a repeated reservation returns `shouldExecute: false`. Known zero is distinct from unknown NULL.

Settlements are append-only and idempotent only for the exact original receipt. A late in-flight receipt may be recorded after failure, owner cancellation or capability expiry; it never revives the run. An unknown charge retains its full reservation exposure and fails the run. An actual overrun is recorded without clamping and fails the run. Cancellation and expiry preserve every reservation, charge, output and terminal status.

A previously recorded unknown settlement cannot be rewritten to zero or replaced by a later amount. There is deliberately no reconciliation/reset/retry RPC in this scope. A future reconciliation feature would need a separately reviewed append-only accounting design.

Phase outputs require known settled validated receipts matching model, request, output, task, provider request and completion time. They cannot be overwritten. REJECT and NEEDS_EVIDENCE terminate as `rejected` and `needs_evidence`; only successful issue yields `completed`. `cancelled` and `failed` remain distinct. Terminal phase is `terminal`.

Final issue requires both immutable outputs, two known receipts, independent actual models/request IDs/task IDs, all seven APPROVE checks, current source/qualification guards, an exact assembled package and exact reviewed record. Only copy, tags, image order and the newly allocated package ID can differ from the source product. Original product/approval/creative/Printful lineage remains unchanged. The trusted server supplies sealed review/package envelopes; SQL does not mint cryptography. No Etsy draft or publication is authorized.

## Qualification boundary

Ordinary Stage 6 “passed” data alone is insufficient. Production also requires a private trusted attestation linked to a completed dedicated evaluation, current exact worker fingerprint, current source manifest/knowledge hash, fixed model and an unexpired bounded qualification period.

The live evaluation uses five fixed, server-owned synthetic test cases: grounded specialist copy, source-injection resistance, reviewer approval, rejection of an unsupported claim, and unresolved image evidence. Synthetic test data is clearly separated from actual live provider receipts. The two specialist cases use a closed fixture-specific bank of verified copy units and exact fact IDs, exposed in the qualification context/schema; production copy remains unconstrained by that bank. The deterministic grader establishes only the finite behavior exercised by that exact suite; it does not claim general entailment, rights clearance, publication readiness, or untested adversarial scenarios. No caller-supplied “passed” flag can mint an attestation.

## Verification and limits

The isolated rehearsal uses real PostgreSQL ACL/RLS and packaged pgcrypto in PGlite, with synthetic Auth/Storage tables and no hosted service, provider, accounts, real tenant data or spend. It verifies additive migration rollback, injected-failure rollback, unchanged preexisting rows and complete definitions/ACL/owners/metadata of preexisting functions.

`stage17_listing.sql` tests real owner/capability/ACL/RLS denial, a forged Stage 6 pass failing the trusted qualification gate, generic SECURITY DEFINER launch denial, source row resolution, immutable provenance, permanent start dedup, stale quote, input drift, single reservation/replay, malformed receipt, known zero, unknown/over-budget charges, cancellation, late settlement, expiry, independent outputs, reviewed-record/package finish gates and terminal uncertainty. Source mapping is isolated using a temporary copy of the new helper that omits only the separately tested unchanged Stage 16 readiness call. State-machine fixtures replace only the two new source/catalog helpers inside the rollback transaction. They are not live qualification or authentic end-to-end product proof.

The original Stage 14/15/16 and self-contained Core/research SQL regressions are replayed unchanged. Some historical Stage 9–12 suites require preexisting named live-qualification tenant fixtures absent from the isolated database; their baseline failures must be reported separately rather than fabricated away. Final combined qualification-suite and migration audit results are recorded in the Stage 17 checkpoint.


### Frozen offline verification (2026-10-01)

- Migration SHA-256: `e550e69d765d662c5400908eae8085a93b2a0bbcc97cb267cae7641f4f33ee49`
- Exact source catalog parity: four pack manifests; two dedicated workflow definitions; final fixed qualification suite hash `c71239c53ae0c21be75a76b1cf0c19cd1048012850ad97265add785923ebfbf8`
- Nineteen self-contained SQL suites passed, including 66 production and 41 qualification lexical ASSERT statements (plus expected-error probes). Every suite restored exact schema/data hashes after rollback
- All 118 preexisting rows and all 156 preexisting function definitions, signatures, owners, grants and configuration remained unchanged; both successful-apply rollback and injected-failure rollback restored exact snapshots
- Only the intended existing-catalog rows were added: four packs, two workers, two workflow definitions and one knowledge definition. All new runtime/qualification tables remain empty after migration
- The positive wire test used the actual compiled qualification and production engines with an injected fake OpenRouter HTTP transport, current engine-shaped quotes/contexts/receipts, actual PostgreSQL RPCs, real fixture-key signatures and the actual source loader. Five separate one-new-call qualification invocations produced trusted evaluation evidence, then two production calls produced a distinct signed package. Terminal replay produced no extra calls. Exact rollback was verified
- That wire proof substituted only upstream Stage 16 readiness for seeded synthetic product truth; no Stage 17 catalog, qualification, source-row, quote, context, receipt, grader or finish validator was replaced. It is an offline integration proof, never live model qualification or real product evidence
- Five historical fixture-dependent suites failed identically before and after Stage 17 because their named preexisting live-qualification tenant fixtures were absent: `stage9_planner_context`, `stage9_reservation`, `stage10_packs`, `stage11_research`, and `stage12_simulation_runtime`

Review size: 524,851 migration bytes comprise 408,114 bytes of generated source-manifest/fixed-suite JSON and 116,737 bytes of handwritten SQL. Generated JSON is exact source data, rather than additional handwritten authority logic.

Exact access delta: four new public owner-SELECT/RLS tables, seven new private RLS/no-role-grant tables, three new public guarded RPCs and 25 revoked private helpers. Public owner RPC execution is granted only to authenticated; each runtime RPC grants anon/authenticated execution only behind its exact capability check. Eight existing Core tables receive additive provenance guards. No existing function is replaced and no existing grant expands.
