# R12 planner preflight and stopped-before-reservation closure

Status: implementation and qualification in progress. No new production migration, source enrollment or live episode is claimed here.

## Observed failure and preserved outcome

PR80 released the explicit grant-root extension at main `b0ce58784f811a1decee0379696350b480f1fb49`, tree `ae02cfec4dcf1bfa73de41367c980373d1bb4ff3`. Full PR qualification `37980624801` and post-merge qualification `37983048180` passed all twelve required jobs and the final qualifier. The grant extension migration is already installed as remote `20261009195144`; it must not be reapplied.

The separately approved follow-up was genuinely confirmed through the owner interface on the same geographic Goal. Its first planner attempt was scheduled, then rejected before reservation or transport: the routed request was 12,626 bytes against the unchanged 12,288-byte limit. The complete 1,059-byte objective appeared in both `intent.objective` and `focus`. Stop revoked the policy and both execution verifiers. There were no new provider calls or charges. The activation still consumed its episode and allocation; the scheduled historical attempt and all counters remain intact.

## Correction

The planner omits `focus` only when it exactly duplicates `intent.objective`. Distinct explicit focus and the complete intent remain. An offline replay of the actual saved inputs produces an 11,552-byte routed request and 10,158-byte serialized wire; this is inert sizing evidence, not a live result.

Before confirmation, the authenticated server reads the exact saved intent, cutoff and pinned installation snapshot. It uses the same concrete planner builder as dispatch, including the reviewed query and metadata, then runs the real serializer with deliberately denied admission and no transport. A prospective 64-character scope hash proves byte shape only; it is not a persisted scope hash or execution authority.

Confirmation requires the server-generated preflight receipt. SQL reconstructs its input fingerprint under the existing confirmation locks before R05 confirmation or activation, and locks/rechecks the current installation. The fingerprint covers the saved packet, intent, profile pins, installation and current quote. Existing checks still enforce current owner terms, predecessor closure, funding and cumulative limits. Historical activated replay remains available. Dispatch refreshes the provider quote and retains its independent size check; confirmation sizing cannot guarantee a later price representation is identical. Later data-dependent phases retain their runtime bounds; planner preflight does not claim to size unknown future evidence.

## Stopped unsent history

A separate canonical closure proof covers only an owner episode explicitly stopped before its first planner reservation. It must bind the immutable setup, scope, plan and scheduled attempt, prove all three revocations, and reject any request, reservation or execution evidence. It permits closure to account for that exact historical scheduled attempt without rewriting its status, fabricating a result or release, refunding an allocation, reducing counters, or restoring authority. Existing whole-lineage cost and lifetime checks remain in force. Historical closures without this proof retain their exact shape and hash.

This bookkeeping proof does not authorize a successor. A later episode still requires its own finite grant, exact closed predecessor, fresh profile/quote and genuine owner confirmation. Research may honestly return TEST, NEEDS_MORE_EVIDENCE or REJECT. Production-purpose creative qualification remains separate and requires a supported current TEST and its bounded approval. R12 remains open.
