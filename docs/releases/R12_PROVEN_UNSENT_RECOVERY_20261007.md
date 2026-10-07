# Proven-unsent recovery implementation evidence

## Release status

Candidate local verification complete; canonical hosted qualification pending. This record does not assert a live research pass,
new provider spend or enrollment. The former successor is permanently stopped;
its released reservation and earlier charges remain preserved.

The contract is [One proven-unsent recovery](../R12_PROVEN_UNSENT_RECOVERY.md).
The separate sidecar leaves existing successor and closed-plan uniqueness intact.
A fresh recovery has its own Goal, scope, proof, policy, quote, request and verifier
identities. It cannot become a predecessor for another recovery.

## Frozen definition and operator identities

- Recovery migration `20261007111110_r12_proven_unsent_recovery.sql`:
  `2fb5b66dbc8a9db4563f8ca55c265653272c1fd26454f4ac90f92c5295710bbd`
- Recovery operator `scripts/r12-focused-pilot-unsent-recovery-bootstrap.mjs`:
  `08f72718a6f02013136e61b9e48b954b0184edc7828f18076f599a0f33881b07`

## Independent boundary review

The review found and corrected a closeout transaction gap before release:
cleanup refusal must not undo successful verifier revocations. The recovery
wrapper preserves the original CLOSE recipe, then isolates cleanup in an inner
exception block. Ordinary refusal and SQLSTATE 57014 return explicit unverified
cleanup, while held liability remains. Original identity/owner checks are not
caught. Connection loss or uncertain commit still requires independent readback.

A second interrupted state is covered: the owner can Stop a confirmed recovery
policy before verifier activation, using the existing R05 revoke/read APIs. No
new public RPC or additional access grant is introduced.

Native PostgreSQL 17.11 catalog comparison:

- 376 existing functions checked; 369 definitions byte-identical
- Exactly seven intended existing definitions changed: source routing, controller
  gate, wire validation, failed-output diagnostics, proposal validation and two
  owner-read projections
- Eleven private helpers added with no API-role EXECUTE
- No existing owner, ACL, volatility, security mode or search-path changes
- The separate guarded scanner migration changes only the existing private
  scanner body and pins both released scanner definitions before replacement
- Original successor proof definitions, uniqueness constraints and frozen
  stage/activate/close recipe strings retained
- Authorization storage and TypeScript validation remain bounded to 16,384 bytes

## Focused verification

- Final focused contract/runtime/owner/static run: 63 test executions passed
- New recovery contract tests avoid importing a test module and registering its
  twelve unrelated tests again
- Five static SQL boundary tests passed
- Typecheck, targeted lint and diff checks passed
- Native original five and recovery five outcomes passed, including actual owner
  preparation, confirmation, activation, receipt handling, Stop and separately
  approved TEST adoption without creative execution
- Final optimized native run passed in 156.4 seconds: ten test nodes and the
  explicitly skipped unrelated legacy replay. It includes preactivation Stop,
  idempotent release, ambiguous-effect refusal and explicit SQLSTATE 57014 cleanup
  failure preserving both verifier revocations and held liability. Longest
  independent test group was 44.6 seconds under its unchanged 120-second deadline
- Representative full-history recovery passed in 67.6 seconds: actual anonymous
  controller first/warm dispatch 1,801/1,859 ms, seven outer scope checks, three
  gates, 35 profile validations and 14 guards, followed by two inert POSTs and
  four receipt GETs for a valid TEST
- Focused scanner/creative unit coverage: 29 tests passed
- Four new actual-HTTP control commands verified to reject unavailable fixture
  state rather than silently return success
- Local disposable Next build was SIGKILL before UI assertions. Actual Next and
  the complete legacy/creative SQL replay remain required in hosted CI; no local
  aggregate or UI pass is claimed
- Hosted aggregate/Next gate has not yet run

The full representative recovery controller must meet the unchanged anonymous
three-second statement limit. The prior Production historical-source benchmark
of 2,526.630 ms remains a subpath measurement, not a successful live dispatch.
Closed real authority cannot be reopened to manufacture a benchmark.

### Production preflight found insufficient timing margin

At 11:36 UTC, a READ ONLY transaction on the existing closed Production scope
measured seven materialized source reconstructions plus two additional historical
profile validations per row, retaining the three-second statement limit. It
failed with SQLSTATE 57014 during canonical hashing inside profile validation.
Both extra outputs were consumed by aggregate counts, so they were not pruned.

This is a five-profile cost proxy using the existing saved profile, not the new
recovery controller. It omits the new unsent-row joins and final controller work,
so its timeout already establishes inadequate margin for proceeding unchanged.
It made no database changes, provider call or enrollment. Local passing times
alone are therefore insufficient; additional measured optimization is required
before release/live activation consideration.

### Guarded scanner optimization

`20261007114310_r12_pilot_scanner_subtrees.sql`, SHA-256
`575e60916f3842261f6ce4147c9af041858ca54b6ae07a9cd2c1a644141e64cc`,
delegates bounded subtrees to the unchanged R04 credential scanner. The 19,997-byte
threshold preserves the original 20,000-byte null-key-wrapper checks. The 65,536-byte
root bound and all outer locks, profiles, clocks and controller checks remain.
There is no persistent cache, caller-supplied trusted context, timeout or grant change.

Independent review and the fully migrated native regression passed 354 parity
cases, including 267 matching rejections, escaped/control/multibyte near-boundary
keys, credential families, aggregate limits and depth probes 16–256. Both exact
body-drift guards and unexpected API grants fail closed. Catalog/ACL properties
and all definitions are restored after the qualification transaction.

Paired complete recovery controller on the same fixture/state:
- Before scanner optimization: first/warm 1,902/1,773 ms
- After: 1,675/1,560 ms, approximately 12% faster
- All fourteen guards, 35 profile validations, seven scope boundaries and three
  controller gates retained, followed by a complete two-call TEST lifecycle

These local savings are not a claim of Production margin. After deployment,
repeat bounded read-only real-host measurements before considering live activation.

## Approval boundary

The user authorized continued implementation on 2026-10-07 at 11:06 UTC. The
expired earlier test window does not carry forward. A new exact live packet,
current quote and required action-time verifier enrollment confirmation are still
needed before any provider call. The intended research remains bounded to two
calls and USD 0.277907, with no creative execution or Business-cap increase.
