# Recovery request deadline qualification

The proven-unsent recovery release exposed insufficient margin under the default anonymous three-second SQL deadline: a Production read-only provenance proxy took 2871.318ms before all remaining controller work. This batch adds the separately owner-approved recovery-only eight-second dispatch RPC, retaining a three-second per-lock timeout. It does not increase a role/global timeout, provider allowance, call count, lease, quote lifetime, or any other RPC deadline.

## Boundary

`public.r12_recovery_dispatch` accepts an explicit Business, Goal and recovery scope, exact dispatch payload and existing scoped verifier keys. It cheaply rejects invalid scope/key/owner/policy/window/plan/attempt/binding/lease combinations before canonical Business locks. It then delegates to the unchanged R07 dispatch controller, which repeats all locked financial, scope, registry and authority checks. There is no generic operation argument and no fallback after denial. Only anon has the new API EXECUTE grant; API table/helper privileges stay unchanged.

The owner runtime selects this endpoint only from a validated saved proven-unsent recovery authorization. Other controller operations and the separate transport send RPC retain their existing paths. A recovery-only final send fence rechecks advancing lease, authority, scope, plan and quote deadlines after the one-shot transport claim write; failure rolls back that claim before permission returns. Existing admission/controller markers and held liability remain, so a failed send is never relabelled as an untouched unsent reservation.

The recovery request stops starting new transitions at 150 seconds, retaining the 300-second route bound. Ordinary workflow latest-start behavior remains 200 seconds. Model 45-second and receipt 20-second bounds, live 30-minute window, 30-minute receipt grace and original receipt limits remain unchanged.

## Qualification

Release qualification must exercise actual PostgREST HTTP timeout hoisting, unchanged generic 3-second behavior, 8-second total cancellation, 3-second lock acquisition, rollback and bad-key/scope denial. The representative complete recovery sequence must also measure the separate 3-second send RPC and other admission operations with inert provider transport. A partial provenance benchmark or direct SQL function SET alone is not proof of the actual HTTP deadline.

No live Goal, verifier registration or paid provider call is included in this code release. Fresh scoped live authority and current evidence/pricing remain separate prerequisites.

## Local evidence

Pinned official PostgREST 13.0.7 against disposable PostgreSQL 17 passed the complete HTTP gate in 84.6 seconds (fixture preparation 43.93 seconds). Strategy/reviewer dispatch took 1563/1617ms; their separate send RPCs took 857/893ms. Exactly two inert provider POSTs and two inert receipt GETs completed, followed by owner Stop and verifier closeout. No external provider was contacted.

The ordinary nested four-second probe cancelled at 3005ms; the scoped four-second probe succeeded, and the nine-second probe cancelled at 8006ms. An actual controller-write timeout rolled back admission/controller markers; the lock cap, rejection before locks and lease expiry during a wait passed. Five final-send expiry probes retained exact financial exposure and existing markers while rolling back claims. The send migration catalog roundtrip preserved every existing owner, ACL and security setting.

Production was read-only checked for the timestamp assumption used by immutable proof reconstruction: server/reset TimeZone UTC from its configuration file, with no database or API-role timezone override. Anonymous/authenticated/authenticator statement deadlines remain 3s/8s/8s. No Production setting changed during qualification.

Independent security source review approved this batch. Canonical exact-tree hosted gates and deployment verification remain required; local timings do not guarantee identical Production latency.
