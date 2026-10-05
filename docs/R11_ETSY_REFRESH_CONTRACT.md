# R11 operation-bound Etsy token refresh

Status: independently reviewed inactive implementation candidate. Focused protocol/orchestrator/server/page checks passed 67/67, local SQL replay/lifecycle checks passed 24/24, and the real Next production build plus four HTTP checks passed. Hosted PostgreSQL races, complete quality/actual-browser acceptance and Production qualification are still pending. No refresh grant, Production migration or live refresh call is authorized by the completed one-attempt setup approval. R11 remains partial; R12 has not started.

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

The proposed additive storage separates immutable read windows/revocations, durable operation attempts with write-once dispatch/result fields, and clearable current token custody. Existing setup grants, attempts, financial ledgers and earlier RPC bodies/ACLs remain unchanged. An additive binding-change trigger cancels new read attempts when the canonical connection is revoked or replaced.

## Protocol and truthful UI

[Etsy refresh authentication](https://developers.etsy.com/documentation/essentials/authentication/#requesting-a-refresh-oauth-token) uses the existing token endpoint with `grant_type=refresh_token` and unchanged scopes. Both returned token subjects must match the qualified user, and explicit scopes must match exactly `shops_r listings_r`. Access expiry is conservatively calculated from request start plus returned lifetime minus clock margin.

The extended metadata projection may replace an old token-expired status only for the matching ready generation. Revoked, locally expired, credential-changed and different-revision states always win. Unknown refresh and unverified rotated candidates are explicit, and metadata reads make zero provider calls. The owner sees each bounded read window, its remaining dispatch budget, saved attempt outcome and observed draft count/time. No token or encrypted envelope reaches UI, model context, generic artifacts, errors or logs.

## Required qualification

Focused adapter/orchestrator tests cover actual request bytes, exact identity/scopes, expiry, pre-dispatch denial and no retries. Isolated SQL and actual PostgreSQL tests cover concurrent operations across windows, duplicate submissions, budget/rate accounting, lease expiry after POST, crashes before/after candidate persistence, failed GET with retained candidate, disconnect/revocation/session expiry at every boundary, stale CAS, credential rotation and cutoff preservation. Add actual Next populated, interrupted/repeated UI acceptance and independent review before the exact-head full gate.

Production installation and activation need a new exact reviewed packet. The proposed live proof is one refresh POST followed by one protected GET for the same shop under its existing read scopes. Ongoing automatic refresh requires its own explicit bounded read/refresh window and rate through, never beyond, the original local cutoff. No paid model/browser calls or commerce operations are part of this work.
