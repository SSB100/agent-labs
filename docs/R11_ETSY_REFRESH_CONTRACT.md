# R11 operation-bound Etsy token refresh

Status: independently reviewed implementation released in Production, with the separately approved one-refresh/one-read live qualification passed. Exact-head hosted CI passed all ten jobs. The separately approved ongoing window is installed and verified available after an explicitly authorized retry of its initially cancelled activation. The separate [public-source qualification](R11_RESEARCH_QUALIFICATION_RECEIPT.md) now completes R11’s scoped external-prerequisite exit. R12 planning precedes implementation; this refresh authority does not expand to research or commerce.

## Minimal useful operation

The owner can request the latest draft status for the exact qualified shop. The server constructs one fixed protected listing GET (`state=draft`, `limit=1`, `offset=0`) and returns only counts, observation time and normalized identity/hash evidence. There is no arbitrary URL, listing identifier, pagination, customer data, model processing or provider write.

A separately installed read window binds the current owner/session, Business, canonical connection revision, app-credential fingerprint, original setup grant, exact read scope, hard local cutoff and finite read/refresh dispatch limits. Metadata pages never refresh. The operation's mandatory UUID is its durable idempotency identity; repeated submissions return saved state without dispatch.

Lazy refresh occurs only when this admitted operation needs a near-expired access token. An independently approved qualification window may force one refresh before expiry, with at most one POST and one fixed GET. Neither mode extends the original local connection cutoff or inherits authority from an expired setup window. The original setup grant's revocation still applies.

## Durable custody and concurrency

- Keep canonical owner/store/scope binding revision separate from OAuth token generation. Bind every encrypted generation to Business, connection, generation UUID and the original binding revision.
- Atomically import the original sidecar envelope into current token custody and clear its old executable location. No predecessor fallback resolver remains.
- A database-enforced active slot allows one in-flight operation per connection across all read windows. Lock Business, server authority, session, window, setup grant and exact canonical binding consistently, then recheck freshness after waits.
- Count a refresh POST or listing GET at its immutable dispatch marker, including failures and unknown results. Measure refresh rate limits from dispatch, not success. No transaction spans a provider call.
- Once a refresh POST is marked, that predecessor generation is consumed or uncertain. Timeout, malformed response, crash, a new operation UUID, expired lease or a new window cannot authorize reuse. Minimum ambiguous-outcome recovery is explicit reauthorization.
- Persist a validated rotated envelope before the protected GET. A later GET failure retains the candidate as unverified; it cannot fall back to or refresh the predecessor. Candidate recovery is explicit in this slice, without automatic retries.
- Promote the candidate only after exact readback and generation/binding CAS, rechecking owner/session, key, both grant revocations, credential fingerprint and cutoff. Disconnect or binding revision changes cancel pending operations and clear current/candidate custody. Late responses cannot revive them.
- Expired reservations may be released only before a refresh marker. Immutable attempt/marker history remains.

The additive storage separates immutable read windows/revocations, durable operation attempts with write-once dispatch/result fields, and clearable current token custody. Existing setup grants, attempts, financial ledgers and earlier RPC bodies/ACLs remain unchanged. An additive binding-change trigger cancels new read attempts when the canonical connection is revoked or replaced.

## Protocol and truthful UI

[Etsy refresh authentication](https://developers.etsy.com/documentation/essentials/authentication/#requesting-a-refresh-oauth-token) uses the existing token endpoint with `grant_type=refresh_token` and unchanged scopes. Both returned token subjects must match the qualified user, and explicit scopes must match exactly `shops_r listings_r`. Access expiry is conservatively calculated from request start plus returned lifetime minus clock margin.

The extended metadata projection may replace an old token-expired status only for the matching ready generation. Revoked, locally expired, credential-changed and different-revision states always win. Unknown refresh and unverified rotated candidates are explicit, and metadata reads make zero provider calls. The owner sees each bounded read window, its remaining dispatch budget, saved attempt outcome and observed draft count/time. No token or encrypted envelope reaches UI, model context, generic artifacts, errors or logs.

## Required qualification

Focused adapter/orchestrator tests cover actual request bytes, exact identity/scopes, expiry, pre-dispatch denial and no retries. Isolated SQL and actual PostgreSQL tests cover concurrent operations across windows, duplicate submissions, budget/rate accounting, lease expiry after POST, crashes before/after candidate persistence, failed GET with retained candidate, disconnect/revocation/session expiry at every boundary, stale CAS, credential rotation and cutoff preservation. Add actual Next populated, interrupted/repeated UI acceptance and independent review before the exact-head full gate.

Production installation and activation require an exact reviewed packet distinct from the original setup grant. The live proof is one refresh POST followed by one protected GET for the same shop under its existing read scopes. Ongoing lazy refresh requires its own explicit bounded read/refresh window and rate through, never beyond, the original local cutoff. No paid model/browser calls or commerce operations are part of this work.


## Scoped release and live proof — 2026-10-05

Application commit `54c8db85f91740cda0139403e8227d218ec3f492`, tree `dac1a5571eb6aaaf3712a3ff807a4c3523c6e49a`, passed [CI 37256807232](https://github.com/SSB100/agent-labs/actions/runs/37256807232): all ten jobs, 2,785 quality checks passed with zero failures and fourteen explicit skips, 225 actual Next/browser checks, and 29 R11 PostgreSQL checks with zero skips, including five observed lock races across the setup/refresh suites. Focused protocol/orchestrator/server/page checks passed 67/67 and local SQL replay/lifecycle checks passed 24/24. All eighteen retained UI captures were inspected, with the inherited compact/200%-capture limits disclosed; the 200% capture alone does not prove below-fold form layout.

The refresh migration is already installed as history `20261005030813`. Its repository filename is aligned to `20261005030813_r11_etsy_lazy_refresh.sql`, preserving all 26,982 SQL bytes and SHA-256 `47b331fe5388a2735cd957bb468d845cb60826d838ad066c831423d19a0092bc`. Production history was not reapplied or rewritten. Post-install checks confirmed four private RLS tables without direct app-role reads, two intended authenticated owner RPCs, two private functions, four indexes and the additive binding-change cleanup trigger. Definitions seeded no authority or credentials.

Following the owner's exact Production-build approval, deployment `dpl_HEvPTgRTPp6rr8EQeYtGs14tiMYM` reached READY at `2026-10-05T03:28:27.346Z` with the canonical `https://agent-labs-two.vercel.app` alias and the exact tested source. This was a new Production-environment build from the tested Preview, not a reassignment of a Preview-built credential environment. Anonymous health returned HTTP 200 and production/ok. Signed-in exact-Business metadata rendered the new read controls and matching approved configuration. Scoped error/fatal and 5xx scans were empty after readiness and live proof.

The independently reviewed qualification activation pinned the existing owner/session, Business, app, connection/revision, shop, scopes, fingerprint, original setup grant and cutoff. It installed one one-hour window with maximum one refresh and one read. The owner-authorized UI action succeeded at `2026-10-05T03:31:08.444Z`: exactly one refresh POST and one fixed draft-status GET for `StudioKindredStore`, shop `68351641`, observed zero drafts. The immutable attempt recorded both dispatches once. Rotated encrypted custody is `ready`, with conservative access-token expiry `2026-10-05T04:30:37.722Z`. No token, secret, session identifier or live credential fingerprint is published here.

The ongoing approval permits at most 743 further operation-bound reads and refreshes, minimum 3,000 seconds between refresh dispatches across windows, through the unchanged `2026-11-05T01:31:55.9399Z` cutoff. Its first activation tool call was cancelled; read-only verification then confirmed no lazy window was installed. The owner explicitly authorized retrying the unchanged activation. That retry succeeded at `2026-10-05T03:47:48.850339Z`; database and signed-in Production UI checks showed the lazy window available, not revoked, with the visible Stop control and both dispatch counters still zero. No second qualification or repeated provider read was performed.
