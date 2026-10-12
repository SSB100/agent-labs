# POD first-run dispatch timeout

## Observed Production outcome

Release `aa704b900d9b0f78e035d42726f9381b43871d3b`, deployment
`dpl_HgyTg9fvqcfS9C2Ydt3HxQvAdqja`, received the approved public POD run at
2026-10-12 08:25:41 UTC. The planner was reserved and its immutable wire bound.
At 08:26:03.387 PostgreSQL cancelled the final dispatch transaction with SQLSTATE
`57014`, `canceling statement due to statement timeout`. The stack ended in the
discarded finance projection returned by `r12_pod_scope_resolve`, through the
canonical R05 marker and R07 dispatch path. The anonymous runtime role has a
three-second statement limit. No provider request or send marker committed.

The one supported continuation occurred after the wire's 08:29:32 quote expiry
and also failed before sending. The expired immutable wire was not replaced.

The existing owner Stop and exact-attempt reconciliation completed at
08:41:36.953389: policy revoked, planner `cancelled_unsent`, reservation released,
zero R05/R07 markers and transport claims, one historical pass retained. The
reloaded owner page showed zero known and held cost for this run. The earlier
USD 0.025 bounded unknown remains untouched and reserved separately.

The retained row records admission, not an executed research pass: no provider
dispatch, search or phase completed. The approved retry therefore retains five
executed research passes within the original unspent USD 10, with no parallel
active predecessor or extra funding root.

## Narrow repair

The migration removes only the unused `finance` field from the internal scope
resolver's JSON return. Every current caller uses `PERFORM`, discarding that
return. Every scope, owner, ancestry, template, expiry, Stop and atomic financial
admission/marker check remains. No role timeout, grant, key, table row, ledger,
scope, expiry, quote, request or allowance changes.

The controller now exposes only an allowlisted timeout category, never raw
database details. Workflow still makes zero automatic retries. The owner UI
labels saved controller progress explicitly rather than presenting it as a
verified live background-worker status.

## Evidence and limits

- Exact-shape isolated dispatch: 30 requests, 28 markers, 44 settlements and one
  synthetic historical browser operation; 27,731-byte template pins and
  919-byte source policy. Finance calls fall from 18 to 2, preserving all 16
  scope checks and the identical dispatch result.
- Read-only Production profiling, with no marker or effect: 18 finance
  projections reproduce the three-second `57014`; two projections complete in
  495.187ms with zero dirtied/written blocks. This profiles the costly component,
  not a successful full Production dispatch.
- Local owner/action/diagnostic regression: 31 tests passed. Native full-path
  timing, exact-head CI and final browser qualification remain required.

The first repair-head CI passed the actual owner/Workflow browser journey. Its
new native profile was rejected before dispatch because the synthetic domain
list had different JS/C and native collation order. The corrected fixture uses
reserved `.invalid` hosts of identical lengths, checks the native canonical
order, and retains the six-domain/919-byte shape and every real guard. This is
synthetic shape evidence, not an exact replay of production source domains.
The unrelated Chromium POST assertion now waits for its fixture fetch to settle
before checking the unchanged admission and zero-request assertions.

The repair is not installed by this record. A new run requires fresh appropriate
owner authority; the cancelled run, its wire and counters are not reset.
