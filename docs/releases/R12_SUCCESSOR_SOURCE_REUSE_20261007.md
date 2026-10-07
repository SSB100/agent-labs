# R12 successor provenance reuse: local verification

## Scope and limitation

This definition-only change removes duplicate predecessor reconstruction inside
one invocation. It creates no execution authority, Goal, policy, provider call,
retry path or persistent cache. It does not change the three-second production
statement timeout, roles, payload bounds, credential scanning, hashes, locks or
any outer dispatch validation boundary.

The local regression passes. The local baseline also fits three seconds, so
local timing alone does **not** establish production dispatch qualification.
The existing production seven-source historical baseline took **2930.057 ms**,
leaving about 70 ms before other dispatch work. A paired read-only comparison
after deployment is still required. That comparison uses `p_current=false` on
closed history; it is not a paid dispatch or authorization to start another run.

## Implementation

Migration: `20261007093053_r12_successor_source_reuse.sql`.

The original closure already validates and reconstructs predecessor provenance.
Two private context-returning helpers carry that result to the enclosing source
function. Existing closure and authorization wrappers return the same canonical
JSON as before. No caller can submit a prevalidated context.

Both time checks remain: the closure validates the predecessor at the current
wall-clock time, and the source function separately validates the predecessor
profile at the caller's effective time. All seven outer source checks and all
three controller gates remain. PostgreSQL's [STABLE snapshot semantics](https://www.postgresql.org/docs/17/xfunc-volatility.html)
permit reuse only inside the same call; this change does not reuse validation
across statements, locks, writes or later dispatch boundaries.

Independent native PostgreSQL catalog comparison verified:

- Exactly three of 374 existing function definitions changed; 371 were unchanged
- Two private helpers were added
- Existing owners, ACLs, volatility, security mode, search paths and relation/RLS
  catalog were unchanged
- Helper guard bodies match the released definitions apart from the intended
  private return-value changes
- New helpers are STABLE, SECURITY INVOKER, have empty search paths, and deny
  EXECUTE to PUBLIC, anon, authenticated and service_role

## Representative synthetic chain

The test uses invented content only. No operator scope, provider text, private
wire, account identity or production identifier is loaded into the fixture.
Read-only production aggregates establish the comparison below.

| Component | Actual aggregate | Synthetic regression |
| --- | ---: | ---: |
| Scope JSONB bytes | 32,038 | 33,864 |
| Scope nodes / keys | 613 / 468 | 621 / 471 |
| Scope objects / arrays | 100 / 62 | 100 / 62 |
| Scope strings / scalar values | 372 / 451 | 379 / 459 |
| Accepted review JSONB bytes | 208,130 | 206,546 |
| Complete successor source JSONB bytes | 212,462 | 210,870 |
| Complete source nodes / keys | 4,753 / 3,635 | 4,708 / 3,616 |
| Complete source objects / arrays | 903 / 405 | 896 / 405 |
| Complete source strings / scalar values | 2,661 / 3,445 | 2,627 / 3,407 |
| Complete source string bytes | 144,634 | 143,532 |

Complete-source bytes are 0.75% smaller and node count is 0.95% smaller in the
synthetic case. The accepted review and complete successor source are different
components and are not compared interchangeably. Residual metadata/text
variation is disclosed rather than filled with irrelevant padding.

Structural assertions require the affected production-chain fan-out: two
approved domains and two source reviews; three historical sources; three
candidates with 27 total dimensions and 27 classified uncertainties; nine cited
facts; nine review uncertainties; and five focused observations. Every stored
historical request retains its three-key provider price-limit object. That
price-limit object was already present in the fixture and was not duplicated.

The 200–230 KB complete-source and 30–38 KB scope regression bounds prevent a
return to tiny fixtures. They are QA guards around the measured representative
case, not changes to production payload limits or a claim of byte-identical
synthetic content. Exact chain, authority, call-count and three-second checks
are asserted independently.

## Paired native PostgreSQL dispatch measurements

PostgreSQL 17.11; original and candidate definitions; the same reserved synthetic
attempt; actual `anon` `r07_controller('dispatch', ...)`; unchanged
`statement_timeout='3s'`. Each trial rolls back to the same state and verifies
unchanged markers, claims, attempts, head, settlements and cumulative funding.
No transport/provider call is made by these measured dispatch trials.

| Trial | Released implementation | Candidate |
| --- | ---: | ---: |
| First dispatch after function-plan invalidation | 1,599 ms | 1,296 ms |
| Warm dispatch | 1,502 ms | 1,261 ms |

“First” refers to function/query-plan invalidation, not a flushed server or OS
cache. The measured reduction is about 19% first-call and 16% warm. Hardware and
database-load differences prevent treating these absolute local times as
production proof.

Per-dispatch function counts:

| Function/check | Released | Candidate |
| --- | ---: | ---: |
| Outer scope validation | 7 | 7 |
| Controller gate | 3 | 3 |
| Profile validation | 21 | 21 |
| Released r04 credential scanner | 33,814 | 33,814 |
| Pilot source reconstruction | 21 | 14 |
| Canonical recursive traversal | 129,837 | 97,133 |
| Canonical hash | 621 | 446 |
| r04 hash | 327 | 194 |

## Verification

- Representative native PostgreSQL regression: passed in 33.9 seconds
- Exact full source and canonical closure equality: passed
- Current wall-clock and caller-effective-time window guards: passed
- Current expiry, historical timestamp retention and before-creation rejection:
  passed
- Credential rejection and immutable profile-hash binding: passed
- Private helper ACL/security/volatility properties: passed
- Changed owner after a source read and missing predecessor settlement: rejected
- Every measured dispatch rolled back without changing financial exposure or
  transport claims
- Existing five-outcome successor lifecycle: passed in 62.0 seconds, covering
  NEEDS_MORE_EVIDENCE, REJECT, inconsistent output, invalid output and TEST
- Focused unit tests: 56 passed; lint, typecheck and diff checks passed

Canonical CI retains the existing SQL suite and adds the bounded representative
regression. A separate guarded step resets only the explicitly identified
disposable GitHub Actions `r12_test` service database. It checks the exact inert
loopback connection target, CI flags, inspected service address, user, database,
port and owner, and does not force-drop or terminate unexpected sessions.

### Sequential CI reset verification

The first hosted combined sequence exposed a fixture lifecycle error: dropping
the database does not remove the cluster-wide `anon`, `authenticated` and
`service_role` roles created by the shared bootstrap. The next bootstrap
correctly rejected the existing roles. Production SQL was unaffected.

The reset now first checks the exact three nonlogin bootstrap roles, including
their privilege flags, password absence, memberships, role settings and absence
of dependencies outside the disposable database. After dropping that database,
it drops only those three validated roles and recreates the database. Unexpected
state fails closed; there is no IF EXISTS masking, CASCADE, DROP OWNED, forced
session termination or deletion of unrelated cluster objects.

Verification used one native PostgreSQL 17.11 cluster for the actual sequence:
standard bootstrap and all migrations, guarded database-and-role reset, then the
complete representative full-shape suite. The latter passed in 34.0 seconds.
Unrelated roles, role settings and tablespaces matched their initial snapshots;
the fresh database had only its default extension before bootstrap, and pgcrypto
and the realtime publication were recreated by the next bootstrap. The
production migration and its SHA-256 remain unchanged.

Standalone invocation against a fresh isolated native PostgreSQL fixture:

```sh
R12_REQUIRE_POSTGRES=1 R12_SQL_SUCCESSOR_ONLY=1 R12_SQL_FULL_SHAPE=1 \
  node --test tests/r12-discovery-scope-sql.test.mjs
```

`R12_SQL_TEST_HOST` and `R12_POSTGRES_URL` must point to the separately installed
synthetic fixture runtime and approved loopback `r12_test` database.
