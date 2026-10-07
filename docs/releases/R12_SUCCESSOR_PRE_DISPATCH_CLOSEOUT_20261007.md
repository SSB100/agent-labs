# R12 successor release and pre-dispatch closeout

## Qualified software release

- PR: https://github.com/SSB100/agent-labs/pull/70
- Candidate: `f0d1607b74b79b45269fabcd639616613d18cea4`
- Qualified tree: `9a5280dde632327fa3232c0b453191a1cb430a46`
- All twelve canonical jobs passed: https://github.com/SSB100/agent-labs/actions/runs/37592437179
- Merge: `1bfb09fa81523dc0d8eb0a4980b9efe0fecd8feb`, identical tree.
- Production deployment: `dpl_T6PzNQKZc13JH5DLEahJmdw3NwAg`, READY, canonical alias, health 200 and affected signed-in preparation verified.
- The duplicate same-tree main CI run `37594884537` was cancelled after qualification.
- Definition migration `r12_focused_pilot_successor` was applied as `20261007083532`; exact SHA-256 `383f925630aa0f8018d4c299658e141a54181cf5b5c4c9c913921cde4e970cdb`, RLS, unchanged existing RPC ACLs, no API-role table access and zero seeded authority were verified.

The prior batch's SQL aggregate deadline was corrected by separating independent successor and legacy lifecycles under unchanged 120-second bounds. Both passed (75.9 and 68.0 seconds); the complete SQL job passed seven tests with zero skips. Actual Next retained its complete successor owner journey. Duplicate successor replay was removed only from snapshot preparation, reducing measured setup from 223.8 to 109.8 seconds.

## Live research did not qualify

One genuinely new research-only Goal was prepared and financially confirmed. The finite authority started at 08:57:28.834 UTC, with a 09:27:28.834 dispatch deadline and 09:57:28.834 receipt deadline, before the fixed noon setup cutoff.

The first strategy was reserved, but both continuation attempts failed before any dispatch marker. PostgreSQL logs show SQLSTATE `57014` at 08:58:31 and 09:00:38: the anonymous controller RPC exceeded its existing three-second statement timeout during repeated provenance validation. No model call, candidate, output or receipt was produced. There is no new TEST, NEEDS_MORE_EVIDENCE or REJECT result.

The application Stop and exact verifier closeout revoked the policy, controller and admission authority. The never-dispatched 66,671-microusd hold was then released through a separately reviewed, narrowly locked append-only R05 reconciliation. It rechecked exact identities, all revocations and absence of markers, transport claims, invocations, outputs, receipts, settlements and legacy effects before appending the canonical unsent release and decision. It did not invent a zero-cost settlement or rewrite historical statuses.

- Release committed: 09:24:12.382 UTC
- Independent readback: 09:24:36.638 UTC
- New provider calls and charges: **zero**
- Research pending and unknown liability: **zero**
- Preserved cumulative research cost: **190,502 microusd**
- Preserved Business exposure: **727,873 microusd**
- Cleanup SQL SHA-256: `06386e12be163b202c198f90c107f921d65034ea677c54a44ffbebd740bccf42`
- Exact absence-evidence hash: `ce01d06d9493188d767ef821e74c87b9ea43c4578c0e5c1cdc89cb9a957abc74`

The historical attempt remains recorded as reserved; its policy and verifiers are revoked and its financial hold is released. The signed-in stopped view shows zero known and held cost for this attempt. Earlier charged failures and accepted results remain unchanged.

## Performance follow-up boundary

Measured live successor-source reconstruction took approximately 400–583 milliseconds per call. Partial native profiling confirmed seven complete source validations across one dispatch's R07/R05 checkpoints, including three controller gate checks. The credential scanner alone was not the dominant measured cost. Exact nested successor dispatch profiling was interrupted by an executor reset; no completed result is claimed for that interrupted run.

The follow-up must remove redundant reconstruction only within one validation invocation, retain every outer lock and freshness checkpoint, preserve both current-time and caller-effective-time validation, and test representative full-shape history under the unchanged three-second anonymous RPC budget. No timeout, role, persistent cache, spending limit or retry permission is expanded.

The expired immutable request and revoked authority are not reusable. This record authorizes no new successor, reactivation, model call or creative phase. A future live test needs its own valid bounded setup and explicit approval.
