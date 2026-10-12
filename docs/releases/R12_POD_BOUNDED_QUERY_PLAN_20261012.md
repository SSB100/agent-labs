# POD bounded-liability query-plan repair

## Exact production change

- File: `supabase/migrations/20261012110903_r12_pod_bounded_query_plan.sql`
- SHA-256: `a671ab1e99cd2643e0ec181e3041a7c8a7df36f8180d3185f0c55e8933db8388`
- One function: `private.r12_pod_bounded_source(uuid,text,bigint)`.
- Preserve its exact SELECT predicates, identity, owner, ACL, signature, STABLE,
  SECURITY INVOKER, non-STRICT, leakproof/parallel flags and all other pg_proc
  attributes. Replace the SQL-language wrapper with PL/pgSQL and a function-local
  generic query plan. Cache the plan, never qualification results.
- Drift/repeat installation fails closed. Any failure rolls back the entire
  replacement. Existing application code remains compatible during install.
- No table/data write, permission expansion, credential, provider session,
  allowance reset, expiry change or SQL-timeout increase.

This requires exact migration approval before Production installation. The
normal qualified release remains required. This record grants no live retry.

## Evidence and limits

PR93 retained the isolated experiments; it is not a release qualification.
Exact PostgreSQL17.6, pinned official PostgREST13.0.7, genuine anon3s RPC and
synthetic historical aggregate shape were used. No private rows were exported.

The first native PG17.11 diagnostic did not reproduce the timeout. Exact17.6
then measured current first dispatch869/874ms versus generic-plan412/420ms.
The bounded proof itself fell from roughly519ms across9calls to69ms. All16
scope checks,7outer scope checks,3gates,2financial guards and9liability checks
remained present. Null/wrong-source/insufficient-hold cases and warmed route
revocation retained conservative exposure.

The final real HTTP experiment was run38240402449, head
e811138eeb6592acdbea922670ac0a7e2c4eb545, job114781298419. Artifact11742303444
was downloaded and verified as SHA-256
`02bfe01d8ae922fbc853a2ce92174767eb75b0f87ee59a445390b6c811d551a3`.

- At1CPU: current first855ms, candidate410ms.
- At controlled0.25CPU: current3048/3005ms, both SQLSTATE57014; candidate
  first1656ms and same-backend repeat1207ms, both allowed within3s.
- The actual request's PID, actor and deadline were observed. A preliminary
  harness run had incorrectly inferred affinity from a separate context RPC;
  that failed assertion was corrected, not counted as application evidence.
- An observed real Business-row lock wait still timed out at3003ms without
  markers. Genuine owner Stop blocked both warmed native and HTTP dispatch.
- All before/after dispatch requests rolled back to the same financial,
  reservation, marker and attempt fingerprint. The old unknown hold stayed full.

Controlled CPU pressure reproduces this failure mode; it does not prove that
Production has identical hardware or that no other latency contributor exists.
Shared/OS buffers were warm from fixture preparation. Function-local generic
mode also applies to nested planning while this proof executes, and different
future data distributions may produce different performance.

## Qualification and fallback

The reviewed migration passes isolated drift, rollback, repeated-install,
identity/ACL and NULL-behaviour tests. Existing bounded-liability qualification
passes with the migration: absent evidence blocks, exact terminated usage may
remain fully reserved, route revocation blocks, and above-bound anomalies block.
The final exact-head release runs the unchanged required gates, plus this HTTP
regression within the existing native R12 job on pinned17.6. Its CI job deadline
allows35minutes of test administration; the application SQL deadline remains3s.

On installation failure the database rolls back automatically. On an unexpected
runtime issue, Stop remains available. The prior exact function definition can
be restored in a separately reviewed rollback without changing any ledger row;
no rollback is automatically performed by this change.

## Preserved live state

Production PR92 remains964c9001 until the qualified new release is approved.
Its postmerge checks finished92passed and1intended diagnostic skip. Both failed
POD setups are stopped and their proved-unmarked reservations were released
through the ordinary owner reconciliation path. Their history is retained.
They executed zero provider calls, searches or research passes and chargedUSD0.
The original USD10 total / five executed research passes remains unused. The
old Steel USD0.025 remains separately reserved and its expired access stays off.
A subsequent live run needs the appropriate fresh activation window and exact
approval; these tests create no live authority.
