# Account setup: database contract and authority checkpoint

Status: **database installation approved and applied; account/provider activation remains gated**. The exact reviewed SQL body was applied through the native confirmation flow. No account, credential, key, Browserbase session, provider request, paid operation or new OAuth grant was created by this rollout.

Migration: `20261001215606_account_setup_workflow.sql`, created by `supabase migration new account_setup_workflow` using Supabase CLI 2.101.0. Parent baseline is `253d108f`. The filename was aligned to the hosted migration version after application; SQL bytes are unchanged (SHA-256 `5d122dbc876fa1e26a99d733e7d3bd8b1729abd4d6bcb7818a5003ab20ebcf05`).

## Exact additive authority delta

Eight new private-schema tables, each RLS-enabled and explicitly revoked from `PUBLIC`, `anon`, `authenticated` and `service_role`:

1. `account_profiles`: the five ordinary profile fields, Business/owner identity and optimistic revision
2. `connected_accounts`: canonical provider/store identities and connection status/revision
3. `provider_connections`: Printful store/type/scopes, bounded local validity and opaque authenticated-encryption envelope
4. `account_setup_runs`: immutable provider/mode/profile/disclosure/hash bindings, approval expiry, state/revision, one-use preparation reservation and redacted receipts
5. `account_health_events`: bounded, server-constructed redacted event summaries
6. `account_browser_handoffs`: owner/Business/run/preparation-bound encrypted Browserbase handoff, maximum 15-minute expiry and local release state
7. `account_password_credentials`: separately encrypted owner-entered website username/password backup with independent compare-and-set revision; no plaintext read operation
8. `account_server_authority`: high-entropy server-key hashes and explicit enable flag; default disabled and no rows installed

Exactly one new public entry point is executable, by `authenticated` only:

`account_owner_transition(p_business_id uuid, p_operation text, p_payload jsonb, p_server_key text)`

The entry point is SECURITY DEFINER with an empty search path. Every operation checks current Business ownership. `workspace` requires no server key; all other operations additionally require an enabled account server authority. Four private helpers have no application-role execute grants. Service-role and anonymous execution remain denied.

No preexisting function body, function owner/ACL/configuration, table ACL, RLS policy, trigger, index or row is replaced by this migration. No new public-table grants, Realtime publication, worker capability, provider scope, storage bucket, authority credential or enabled configuration is installed.

### Existing Etsy boundary

Existing Etsy encrypted tokens, OAuth state, envelope namespace, refresh behavior and functions remain authoritative and unchanged. The account workspace derives Etsy status/revision/shop identity directly from `private.etsy_connections`, including later revocation; it never reads a copied token or trusts generic Core metadata. A new canonical row references verified source facts without copying secrets.

Etsy `revoke` requires both the new account authority and the existing Etsy authority. Under the same Business and Etsy-row locks, it compares `expectedConnectionRevision`, calls the unchanged `etsy_owner_transition(..., 'disconnect', ...)`, and records the redacted new-registry state in one transaction. This prevents a stale server read followed by a separate disconnect from revoking a newly rotated OAuth connection. The additional key is never persisted or returned. No second public wrapper or grant is introduced.

## Profile and exact approval boundary

The reusable profile contains exactly `email`, `givenName`, `familyName`, `countryCode` and `locale`. It is ordinary data held privately; a current owner can view it through the workspace. Passwords, tokens, health, child, billing and financial data are not profile fields.

A preparation binds:

- Current Business, owner, provider (`etsy` or `printful`), mode (`create` or `connect`) and profile revision
- Exact selected field names **and values**, fixed official provider destination, terms and privacy URLs
- Exact provider scopes: existing Etsy `shops_r`, `listings_r`, `listings_w`, or application-level Printful `catalog.read`
- A **zero spending limit**, no subscription approval, and a fixed list of owner-only secure steps
- Create-only explicit Browserbase processing disclosure, per-session recording/logging disabled, at most 900 seconds, and a separate-activation requirement
- A database-generated SHA-256 disclosure fingerprint and TTL of 60–1800 seconds measured from preparation; replay never extends approval

Initial registration fields are exactly email/first name for Etsy, and email/first/family name for Printful. Connect mode transmits none of the reusable profile. Provider destinations, scopes and JSON keys are allowlisted; arbitrary website JSON is rejected. Create approval requires both exact disclosure-hash consent and explicit terms/browser-processing acknowledgements.

Zero is an authorization limit, not a claim that provider signup or shop activation is free. The implementation adds no fee, billing, account purchase or subscription authority. Browserbase integration remains configuration-gated and requires its own entitlement/budget/access review.

Profile changes invalidate active approvals. One active run per Business/provider plus Business row locking and revision compare-and-set prevent racing preparation, verification and cancellation. Permanent idempotency keys cannot be rebound to a different disclosure or profile.

## Durable state and RPC operations

State path: `pending_approval → approved → preparation_started (create only) → owner_handoff → verified`. `cancelled`, `invalidated` and `expired` are terminal. Workspace/resume reflects expired approval even before a subsequent write materializes expiry.

- `save_profile`: exact five-field object and expected profile revision; unchanged saves preserve the revision, changed saves invalidate active setup approvals
- `prepare`: exact disclosure, provider/mode, profile revision, unique request key and bounded TTL; reserves the canonical connection UUID for authenticated-encryption AAD
- `approve`: run/revision/hash with required terms/browser consents; no broad or transferable consent
- `registration_prepare`: creates the one-use durable preparation ID before provider work; only the first result has `dispatchAllowed: true`; replay cannot dispatch again
- `owner_handoff`: persists only an allowlisted result, performed-field subset, reason code and terms-checkbox state; it cannot assert account creation
- `resume`: returns persisted state without completing, resubmitting or extending approval
- `cancel`: invalidates future preparation/verification, preserves history and does not claim deletion of an external account
- `verify`: owner plus trusted server readback required; owner assertion alone cannot complete the run
- `connection`: trusted server-only Printful envelope retrieval; optional exact connection/revision guards; always current owner/status/local-expiry checked
- `revoke`: compare-and-set local Printful disconnect removes its token envelope, invalidates active runs and explicitly reports `remoteTokenRevoked: false`; Etsy uses the atomic legacy-disconnect wrapper described above
- `delete_password`: separately requested permanent removal of the saved local copy, same-owner/Business/connection and password-revision guarded, available after disconnect; provider password is unchanged
- `save_password`: requires a current verified connection, exact connection revision, independent expected password revision and fresh password revision; encrypted backup only, with no provider verification or transmission claim

Printful completion stores a verified store ID/type (`manual_api` or `ecommerce_linked`), exact read-only application scope, separately verified provider scopes, new connection revision, maximum 31-day local validity and an `account-v1` envelope. It does **not** claim Printful user identity or provider token expiry was verified. A store cannot be reassigned to another Business, including another Business of the same owner. Serialized millisecond UTC timestamps preserve exact vault/schema round trips.

Etsy completion verifies the unchanged authoritative connection and exact revision after the server's provider readback. An existing connected revision that changed during setup requires renewed setup rather than using stale approval. Terminal replay does not add another receipt or reissue work.

Website-password storage is separate from provider tokens and OAuth. It cannot change account scope/revision and has no decryption/read RPC. Local disconnect retains this explicitly requested encrypted backup; it does not silently delete it or make it usable by a worker. Workspace exposes only `passwordStored` and `passwordRevision` for an owner to manage subsequent saves or an explicitly confirmed removal. `delete_password` deletes the private row with an exact revision check and a redacted receipt, including while the account is disconnected; it does not change the provider's password.

## Browser handoff lifecycle

`browser_handoff_save` requires the current approved create run in `preparation_started`, exact revision/preparation ID, one immutable encrypted handoff UUID and expiry no later than both approval and 15 minutes. Identical replay does not replace or extend it.

`browser_handoff_get` returns an encrypted envelope only to the authenticated owner plus server while the run is `owner_handoff`, profile/approval are current, and the saved session is awaiting its owner and unexpired. Workspace/events never expose a raw viewer URL, session ID or envelope.

`browser_handoff_release` is allowed for that owner/server even after cancellation, invalidation or expiry. It atomically disables further local retrieval and returns the encrypted cleanup envelope so the server can close the provider session immediately. The retained envelope permits cleanup retry after an uncertain provider response. The RPC always reports `remoteReleaseVerified: false`; only actual server-side provider release verification can establish that result. Session deadline remains a final bound if remote cleanup is uncertain.

A cancelled/expired/invalidated create attempt that already reserved registration cannot silently begin another create attempt. The owner must reconcile the provider state, usually through the connect path. No duplicate signup or account-created claim is inferred from form filling or a checkbox.

## Verification performed

The isolated harness used **PostgreSQL 18.3 via official PGlite 0.5.8 with bundled real pgcrypto**. Synthetic Supabase Auth/Storage interfaces supplied roles, JWT-to-UID lookup, Auth columns and Storage uniqueness; they do not stand in for hosted authentication or Storage HTTP qualification.

- All 83 repository migrations replayed successfully, including the unchanged 82-migration baseline
- 21 self-contained SQL suites passed, including the new rollback-only `account_setup.sql` and existing Stage 1, 12 knowledge, 13/v2, 14, 15, 16, 17 and 18 suites
- Every successful or failed suite restored the exact baseline table data, function metadata and relation ACL/RLS metadata after rollback
- All **156 preexisting application/Auth function definitions and authorization metadata, 72 preexisting relation ACL/RLS records, and 127 preexisting rows** were unchanged by the additive migration
- Successful-apply rollback and injected-failure rollback restored the exact pre-migration snapshot
- Actual current TypeScript contracts/server/vault/Printful verification code was wired to the real PostgreSQL RPC: profile/disclosure consent, three fixed Printful GET response fixtures, encrypted token persistence and resolver, timestamp/secret equality, owner password storage, disabled-browser no-call gate, encrypted handoff get/stop/release, and post-revoke denial all passed
- Only provider HTTP responses and remote browser release were injected in that wire rehearsal; it made no external network call
- Atomic Etsy revoke regression rejects a stale revision or wrong existing Etsy authority without changing the connected source, then verifies successful exact-revision disconnect and setup invalidation

Five historical SQL suites require preexisting named live-qualification tenant fixtures not present in the isolated database: `stage9_planner_context`, `stage9_reservation`, `stage10_packs`, `stage11_research` and `stage12_simulation_runtime`. Their baseline missing-fixture failures remain reported separately, not fabricated into passes.

Each of those five suites was additionally rerun against the unchanged **82-migration baseline**, without this account migration. Every error and PostgreSQL failure location matched exactly, and every rollback preserved that baseline. They are confirmed existing fixture gaps rather than regressions introduced here.

The account suite exercises owner/cross-Business/role denial, no private direct reads, exact profile shape, revision CAS, missing/disabled server authority, official destination and scope allowlists, disclosed-value matching, immutable admission/idempotency, exact approval, no owner-asserted completion, untrusted/plaintext envelope rejection, same-store cross-Business denial, old Etsy row preservation, one-use registration dispatch, Browserbase disclosure/TTL/opaque storage/no workspace leaks, cancellation/replay/cleanup, profile invalidation, token/password separation, retained password backup and separate confirmed removal with stale/foreign revision denial, expiry and truthful local-only revocation.

## Remaining gates

1. Independent review and explicit database approval completed; hosted permissions verified
2. Separately approved server/vault/key configuration and narrowly enabled authority provisioning
3. Secure user-entered provider credentials/access grants and Browserbase entitlement/budget/activation approval when required
4. Hosted role/ACL/advisor verification and provider-specific live qualification

Offline fixtures and code-level provider wiring do not establish real provider account creation, live connection qualification, account ownership, session zero-retention, password validity or spending authority.

### Reviewed offline file fingerprints

- Migration SHA-256: `5d122dbc876fa1e26a99d733e7d3bd8b1729abd4d6bcb7818a5003ab20ebcf05`
- SQL regression SHA-256: `fcfe10d70375d4aa571bbcc878d341e98eff9c1ddc996bd952f4d8b2828d436e`

These fingerprints identify the code-only offline-tested files; they do not signify hosted approval or application.
