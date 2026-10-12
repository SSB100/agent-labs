# Same-Goal recovery deadline correction

Status: focused implementation and review; production installation not yet approved.

## Observed failure

The owner-approved recovery capability installed successfully on 2026-10-12.
The first normal recovery review failed before creating a proposal or grant.
Production PostgreSQL recorded `r05_intent_deadline_exceeded` at 20:03:00 UTC:
the fresh recovery policy extended beyond the original Goal's saved deadline.
The proposal transaction rolled back. The original stopped setup, five calls,
one pass/search and USD0.028912 cost were unchanged. No new provider request ran.
The saved proof, historical phase inputs and length-failure classification all
passed independently against current TypeScript; this was not a provider error.

The earlier fixture used a Goal deadline tomorrow and recovered immediately,
so it did not establish behavior after the actual Goal deadline had expired.

## Narrow correction

The existing owner R04 save/ready transitions append a deadline-only version of
the same Goal inside the recovery proposal's Business-locked transaction. The
original current revision and hash must match the predecessor plan. All content
except `parsed.deadline` is copied unchanged. One second-rounded cutoff governs
the new intent, operation definitions and policy proposal, preventing fractional
timestamp mismatch with R04's second-resolution date/time format.

The saved proposal and confirmation bind the new ready Goal revision. Lost-reply
replay returns the existing proposal without appending more revisions. A stale
or concurrent Goal edit fails closed. If any proposal step fails, both new Goal
versions and all proposed records roll back together.

The owner page discloses this intent change before its recovery-review button.
The existing 35-minute proposal cutoff permits at most about five minutes for
confirmation followed by the 30-minute dispatch window. Same-submission replay
recovers a lost reply; this patch does not add an expired-proposal renewal path.
The server and SQL require explicit `approveGoalDeadlineRevision: true` on that
prepare action; older app requests fail closed. Spending still needs the separate
normal confirmation. No R05 validation is relaxed and no existing grant or Goal
version is edited. No template, provider, source-policy, budget or funding-root
change is part of this patch.

## Production boundary

Migration: `20261012200939_r12_pod_recovery_goal_deadline.sql`.
It replaces only the recovery owner entry point and does not perform a Goal edit
at installation. Existing ordinary research and saved reads remain compatible.
Affected calls may briefly block during definition replacement; a failed
transactional migration rolls back. The new app and migration must both be
present before another normal recovery review is attempted.

The same original USD10 / five-pass allowance applies: USD9.971088, four passes,
20 calls and four searches remain. The separate old USD0.025 stays fully held.
The new dispatch window starts at actual confirmation, with 30 minutes for sends
and a further 30 minutes for exact existing receipts. Original deadlines and
the rejected review remain recorded and unaccepted.
