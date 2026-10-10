# R12 renderer verification checkpoint — incomplete WIP

This checkpoint extends the recovered foundation and remains unactivated. Foundation commit 967aa650 passed full CI but is not deployed; production security approval remains pending. No production migration, persistent browser grant, Steel session, or paid model call was performed for this checkpoint.

## Included

- Mode-aware HTTP fault injection for the original direct lane and the repair-enabled lane. Public anonymous RPC invocation, real three-second transaction timeout, rollback checks, and exact function owner/ACL/config/body restoration remain required.
- Additive historical-attempt projection migration 20760 preserves saved historical hashes and fences authenticated stale previews rather than rewriting them.
- Additive landing-control and candidate-verification migrations 20800/20900. Owner consent pins the reviewed renderer sidecar. Legacy setups retain their original behavior. Missing sidecar reads do not become implicit legacy approval.
- View-specific observed landing controls, explicit candidate renderer boundaries, and native Chromium DOM and redirect qualification cases. A successful no-query candidate verification does not authorize source research.
- Proof-bound research renderer contracts are preserved, but their SQL activation is outside this checkpoint. Candidate-only identity cannot prepare research.

## Evidence on this isolated tree

- Full application TypeScript and core TypeScript compilation passed. Focused owner Next production compilation passed; this is compile-only, not browser execution.
- Browser contract tests: 339 passed, 0 failed, 3 explicitly skipped native-only cases. Actual Chromium network/DOM proofs must pass CI.
- Release-gate tests: 7 passed. Owner-view contract tests: 5 passed.
- Exact-cohort owner SQL/form journey: 1 passed on PGlite, including verified legacy behavior and fail-closed renderer read errors.
- Exact-cohort direct HTTP dry tests: 4 passed and 2 native-only HTTP cases skipped; both original and repair-enabled mode fixtures executed.
- Focused SQL and HTTP fixture dry runs use PGlite; native PostgreSQL/PostgREST and real deadline qualification remain CI obligations. Earlier pre-reset outputs are labeled in the private test record and are not reconstructed logs.
- Prior exact commit 44a2 completed full CI with one failed direct HTTP fault-injection fixture; the aggregate correctly failed. This checkpoint addresses that fixture and adds actual repair-mode HTTP coverage.

## Remaining release and live-test gates

Exact-commit full CI, source acquisition proof/revocation completion, genuine registered and owner-installed direct packs, fresh-state reviewed enrollment, and separately versioned reviewer route qualification remain necessary. Enrollment is not manual database seeding. The first paid test has at most ten counted cycle/repair units and a combined USD10 ceiling; this is a finite test window, not a permanent Quest lifetime limit. Historical Goal, costs, allocations, Stop and authority history remain retained.

Live persistent Steel access and security changes still require the applicable owner confirmation. A research stage result does not complete the broader profit Goal. No live success is claimed here.
