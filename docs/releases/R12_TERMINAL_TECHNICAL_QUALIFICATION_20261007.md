# Bounded technical qualification after a marked, unsent request

The previous recovery reached the immutable Core dispatch marker, but the separate send RPC exceeded its three-second database deadline before recording a transport claim. The application awaits that claim before invoking provider HTTP. The run was stopped and all temporary permissions revoked; its 66,671-microusd reservation remains held until the reviewed reconciliation proves the absence of transport and all other effects. No successful provider result or zero-cost settlement is inferred from a missing response.

## Approved change

The dedicated recovery RPC now covers only inputs, bind and send, with an eight-second statement limit and three-second lock limit. Existing guarded dispatch retains its eight-second limit. Other RPC deadlines and API-role permissions remain unchanged. Current owner, scope, policy, exact request/wire, funding, freshness, permission and call-count checks remain binding. Only the explicit recovery and terminal-qualification versions can enter this route.

The caller has a 270-second absolute request budget below the 300-second platform limit. It composes cancellation across reads, SQL and transport. One same-token lease renewal is allowed after preparation and before the dispatch marker; dispatch requires the renewed epoch to remain unchanged, and the caller rejects an expired-lease takeover. Renewal cannot repeat or occur after dispatch. Saved progress and an existing lease expiry are shown to the owner so a later Continue cannot silently repeat generation.

A private, locked reconciliation validates the exact failed request, both preserved dispatch markers, all revocations and the absence of transport claims, provider effects, observations, receipts and settlements. Only that proof permits releasing the internal reservation. The event and release are immutable and uniquely linked. Known charges, the failed request, markers and consumed recovery slot remain intact. Replay must prove the same closure and cannot release funds twice. A transport claim, including one whose successful response was lost, blocks reconciliation.

One terminal qualification may follow this exact reconciliation. Permanent uniqueness constraints bind its funding root, failed recovery and reconciliation event. It preserves the reviewed observations, candidate, question, evidence identities and Business cap. Fresh owner, semantic, execution and eligibility review bindings are required. It cannot create another successor or recovery. The maximum remains two research calls and 277,907 microusd, with a 30-minute execution window plus 30 minutes for at most six receipt checks. Negative, inconsistent or invalid results stop the run. A valid TEST does not itself authorize creative execution.

## Qualification evidence and limitations

The final local cold HTTP and actual Next setup sequence passed in 83.0 seconds. It used real controller, SQL and PostgREST paths with inert provider transport. Both research phases and authority closeout completed; maximum-boundary response handling and wire limits were exercised. Separate functional tests retained generic three-second deadlines, three-second lock waits, eight-second rollback, final-send freshness failures and exact API grants. Real concurrent send/reconciliation tests established both orderings: a committed send claim prevents release, while a committed reconciliation prevents a queued send from acquiring a claim.

The local workload follows the saved history and full validation chain. Cold backend plans do not imply cold database pages, and the inert provider/catalog boundary does not establish Production latency. Local timings are evidence of exercised paths and margin, not a guarantee that production requests will complete. Hard deadlines and conservative liability handling remain necessary.

The new negative tests caught reuse of an actual execution review that a semantic-review-only comparison did not reject. The operator and closure checks now bind the distinct execution and eligibility review fields. The regression is retained. A cancellation regression also verifies that an already-started rejecting Promise is observed when synchronous work consumes the deadline, without starting a lazy RPC after expiry.

Final canonical hosted qualification, exact-tree deployment and proof-conditional live reconciliation are required before the approved terminal test. No new live authority or provider call is created by this release record.

Focused owner, terminal contract and Next routing checks passed 39 tests. Full local lint was terminated by the constrained executor before reporting a finding; changed-file lint and the required hosted quality gate are recorded separately. No full local aggregate pass is claimed.

The final targeted native PostgreSQL matrix passed in 78.0 seconds: exact reconciliation and replay, substituted and rehashed proof rejection, stale actual execution/eligibility reviews, unchanged-cap checks, all five terminal final-send expiry faults, successful two-phase TEST, and Stop before activation. The prior full outcome matrix also preserved valid NEEDS_MORE_EVIDENCE and REJECT stops, and invalid/inconsistent strategy stops without a reviewer call.

Final changed-file ESLint (39 source/test files), the normal full TypeScript typecheck, and whitespace/diff checks passed. The release migrations are `20261007231948_r12_terminal_technical_qualification.sql` (SHA-256 `35a51a697504a1cb7cd56242b24f3da3e205360db2bb031a728c93320cbcb7de`) and `20261007232026_r12_recovery_runtime_deadlines.sql` (`0f48557360e5bf8f001679bdaf45dcabfd28cba0cfa2502905aefaeb8594d389`). The terminal operator SHA-256 is `eedad997685a475877ac2cf65b3eefba1af2c56d966493813e4a4b9556adeec2`.
