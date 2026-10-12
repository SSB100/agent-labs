# Fresh-backend POD diagnostic

This branch is an isolated diagnostic, not a release or a research run. It has
no production migration, grant, key, cap, provider call or deployment. The
existing release qualification contract remains unchanged and intentionally
rejects a focused diagnostic as release evidence.

PR92 is live at `964c9001`, with reviewed migration `05bf90...` installed. The
approved retry still timed out before its first provider dispatch. Both failed
POD setups are stopped, their unmarked reservations released by the ordinary
owner reconciliation path, and their admission history retained. They executed
zero research passes and charged zero. The original USD10 is unused; the old
Steel USD0.025 remains reserved separately.

The prior native “cold” result did not prove fresh-backend latency: it ran the
candidate after both original trials on the same connection and only discarded
plans. It also omitted legacy research/creative history. The final database
error line is an interruption location, not proof of that line's cost.

This diagnostic prepares synthetic history, closes that setup connection,
opens a different native PostgreSQL backend, and makes the current candidate
R07 dispatch its first application call. No original implementation trial
warms it first. It checks the actual anon actor, unchanged three-second timer,
durable reservation, marker rollback, and a positive native timeout control.
Two independent fresh backends each receive one cold and one warm trial.

Aggregate legacy shape is synthetic, with inert IDs/text and tiny known costs;
no private Production rows or credentials are exported. It covers 26 research
reservations/settlements across ten experiments and 11 creative reservations
across four runs, including a receipt-null item with a known attestation.
The report records actual database version/settings. Shared/OS buffers are not
claimed cold, and a direct native RPC is not a PostgREST HTTP replay. This test
can diagnose a gap; it cannot authorize another live run or qualify a release.

## First diagnostic result and narrowed comparison

Head8ce24c17 / run38237463113 completed the focused test successfully.
The hash-verified artifact reports PostgreSQL17.11, two fresh dispatches669/670ms
and warm repeats625/630ms. Thus this did not reproduce live17.6's timeout.
The bounded-liability proof consumed about410ms across9calls in each first
dispatch. Live read-only profiling measured roughly109ms/call, and the exact
body's EXPLAIN showed96.62ms planning versus5.034ms execution. This identifies
a planning-cost hotspot, not a complete explanation of the live failure.

The next isolated comparison explicitly requires PostgreSQL17.6 and compares
the unchanged SQL function with identical RETURN EXISTS predicates in a
PL/pgSQL function, using automatic versus function-local generic plan selection.
Each variant is measured on two new backends. Identity, owner, ACL,
volatility, invoker/strict/leakproof/parallel flags, cost/rows and search path
are checked unchanged. The explicit generic variant's function-local plan
mode also applies to nested planning while the function executes; a gain
cannot be attributed solely to its outer query. Null/wrong-source/insufficient-hold and warmed-plan revocation
cases preserve full unknown exposure. Definitions are restored afterward.
No production migration is proposed or installed by this diagnostic.

## HTTP and controlled-resource comparison

Exact17.6 direct native results: currentSQL first dispatch869/874ms; automatic
PL/pgSQL690/690ms; function-local generic412/420ms. The latter reduced the
bounded proof from~519ms to~69ms across9calls. All variants passed equivalent
boolean guards and retained full unknown exposure. The live timeout is still
not reproduced by that unconstrained native result.

The final diagnostic uses pinned official PostgREST13.0.7, anon's ordinary3s
statement limit, a single-connection pool and a fresh process per pair. The
real RPC runs with mandatory transaction rollback so the same immutable
request can be compared. Every response checks the complete unchanged
financial/marker/attempt fingerprint. Only the isolated service container is
limited to1CPU then0.25CPU, with its original resource setting restored. This
is controlled headroom testing, not a replica of Production hardware.
A held Business-row lock must time out without a marker; a genuine committed
isolated ownerStop after warming must block further dispatch and retain holds.
No broad qualification run, Production change or provider dispatch is added.

The first HTTP harness run stopped after a successful670ms baseline because
a separate context RPC observed a different PID. Pool size does not establish
session affinity. The corrected harness identifies the actual dispatch via a
test-only pre-request response header and transaction-local correlation tag;
timeouts are observed through that exact tag. Repeats are labelled warm only
when their executing PID matches a prior dispatch. The application RPC body is
unchanged. A known native backend supplies the strict warmed-Stop assertion,
with a separate genuine HTTP Stop check. This correction does not count a
harness failure as an application failure or a successful performance proof.
