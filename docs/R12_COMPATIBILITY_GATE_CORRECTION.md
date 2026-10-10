# Direct Etsy compatibility and complete CI gate

This is an undeployed WIP correction after `6d7bdf0080338615fbccaaf9fde3cc6cc7104066`. The foundation at `967aa6500f2c0174bf135dbf63f3bac483990f83` is CI-qualified but production migration/security approval is still pending. Last verified production remains `83d9e7f192cb711249c485c60d2a65b2424c24ca`.

## Corrected boundaries

- The existing adaptive `.2` format remains valid for saved versions 5–9 when migration20600 is installed over existing data. No version range or budget is increased.
- Additive20750 restores the original budget function identity, named arguments, default and execution metadata while retaining direct-research liabilities. It invalidates warmed callers by reissuing their unchanged definitions.
- Additive20755 restores the existing owner-initial explicit cumulative grant rule while preserving all four lanes of usage, atomic root locking and stricter episode/revision limits. Its original failing security test and new genuine mixed-lane scope/cash-overrun regression pass.
- The HTTP fixture now actually reads authenticated `quote_context` and verifies its immutable provenance and unchanged ledger counts. `observe_quote` is not falsely reported as covering that separate read.
- The strict R10 dependency fixture explicitly loads the real request-deadline helper. Its existing authority, egress and privacy assertions remain unchanged.
- Full CI now requires both reusable direct-Etsy native/HTTP and browser-boundary workflows as well as every legacy check on the same commit. Independent duplicate triggers are removed; manual diagnostics remain. Focused diagnostic mode cannot qualify a release.
- The ordinary-owner SQL group preserves its combined output even on failure, with pipefail retaining the real test status.

## Evidence and limits

The focused R10 and release-gate suites passed 13 tests. The compatibility suite passed two PGlite tests, including an actual saved pre20600 Etsy setup/input/wire progressing through all three inert phases after upgrade, and warmed budget calls preserving held and settled exposure. Unchanged R06/R09/R10 tests passed seven cases; the existing legacy-funding lifecycle passed one. The corrected HTTP fixture passed its two local dry cases; actual PostgREST was explicitly skipped locally.

The prior head passed the actual Next owner journey, browser redirect boundary, and 29 direct native workflow jobs; its one direct HTTP coverage failure prompted this correction. The complete legacy Next browser job also passed. The prior full CI did not pass. These earlier results do not transfer to this correction's exact tree. Complete remote CI remains required. No live Etsy query, model call, Steel session, production migration, merge or deployment is claimed by these tests.

The prior ordinary-owner SQL failure was independently reproduced: thirteen of fourteen cases passed, with the existing explicit cumulative grant-renewal security case rejected by the direct cross-lane trigger. Additive20755 fixes that case; the unchanged security test and a new mixed-lane regression passed two priority tests. A broader local group rerun and exact-head native CI remain separate checks.

The newly identified historical whole-row stopped-proof/origin-snapshot compatibility edge is separately under repair. This checkpoint does not claim that edge resolved. The ordinary app also needs a supported reviewed enrollment action for fresh grant/tariff/source/renderer records before a live test; current database-owner fixture seeds are lower-layer evidence, not full starting-state user-path qualification. That implementation is separate.

Landing-control/candidate-renderer work is kept separate until its full SQL integration is qualified. Actual restricted Steel rendering still needs the approved bounded no-query account verification and then a counted research query with independent results witnesses.
