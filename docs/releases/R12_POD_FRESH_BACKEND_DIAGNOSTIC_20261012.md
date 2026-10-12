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
