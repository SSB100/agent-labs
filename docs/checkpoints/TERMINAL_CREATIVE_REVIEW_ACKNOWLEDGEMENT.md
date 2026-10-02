# Terminal creative-review acknowledgement

This additive change lets the current Business owner mark one saved, stopped Stage 14 creative-review notice as reviewed. It records acknowledgement only. It does not resume execution, authorize new spending or publication, change approvals or assets, reconcile costs, retry work, or call a provider.

## Frozen migration

- File: `supabase/migrations/20261002095637_terminal_creative_review_acknowledgement.sql`
- SHA-256: `c99ff5f0a1d92be379eab6a026bb3b1e825616c6952c60db7f356de706e35b49`

## Production application

The approved, independently reviewed SQL was applied on 2026-10-02 through the official migration tool, which assigned migration version `20261002095637`. The source filename was reconciled to that observed history without changing any SQL bytes or the frozen SHA-256.

Post-application checks confirmed function owner `postgres`, `SECURITY DEFINER`, empty `search_path`, and body MD5 `1f3cdcab3ab8ed6133c027a54b0229e3` matching the reviewed source. Only `authenticated` has application-role execution permission; `PUBLIC`, `anon` and `service_role` do not, and neither denied role inherits authenticated access.

All three qualification notices remain open with unchanged metadata and resolution hashes. Workflow and cost hashes, existing function/ACL/policy hashes remain unchanged, and the acknowledgement event count is zero. Installing this boundary did not acknowledge any notice; that still requires the owner to choose the action.

## Database boundary

- New RPC: `public.acknowledge_terminal_creative_review(uuid, timestamptz)`
- `SECURITY DEFINER`, empty `search_path`; derive every Business/run identity from saved records and recheck current `auth.uid()` ownership
- Lock current Business ownership `FOR SHARE`, then creative run, workflow run and selected notice `FOR UPDATE`, matching the creative runtime's lock order
- Require the exact deterministic Stage 14 notice, `creative_review`, `etsy.creative-pipeline` version `1.0.0`, consistent saved inputs/links, `needs_owner` with completion timestamp, both production/publication flags false and complete terminal child state
- Require the original `updated_at` concurrency token, empty open resolution and no action-intent link
- Change only that notice and atomically insert its deterministic immutable `owner_intervention.resolved` event
- Exact same-owner/same-token replay returns `already_acknowledged` without changing the notice, timestamps or event; different resolutions and stale tokens fail closed
- Capability/approval expiry is not required for an already-stopped run, and no capability is changed

The new function and its ACL are installed in one atomic `DO` statement. An error in function creation or permissions rolls the entire installation back, including its default function privileges. `CREATE FUNCTION` deliberately refuses a preexisting signature. Revoke all privileges on only this new signature from `PUBLIC`, `anon`, `authenticated` and `service_role`, then grant only `EXECUTE` to `authenticated`. Existing functions, table ACL/RLS, triggers and guards are untouched.

The versioned resolution is `terminal-creative-review-acknowledgement-v1`, with `decision=acknowledge`, exact actor/Business/workflow/creative/notice identities, original expected timestamp and server acknowledgement timestamp, encoded canonically in UTC with six-digit microseconds so replay is independent of session timezone. `executionResumed`, `newSpendAuthorized` and `costsReconciled` are all false. Generic resolved records never acquire the Reviewed presentation.

## Application boundary

The action uses the signed-in owner's Supabase client and calls only the new RPC. The original timestamp string is sent unchanged, preserving all PostgreSQL microseconds. Errors use fixed safe codes. Return navigation is rebuilt as scoped root Decisions navigation; successful scope comes from the RPC. The reader checks complete child state before showing the action. The UI conservatively exposes it for technical-qualification notices only.

## Verification

Run the focused app tests after normal test compilation:

```sh
npm run pretest
node --test tests/terminal-review.test.mjs tests/console-decisions.test.mjs
```

Run real PostgreSQL regression with the previously installed isolated PGlite package host:

```sh
TERMINAL_REVIEW_SQL_TEST_HOST=/tmp/account-sql-runner node --test tests/terminal-review-sql.test.mjs
```

The isolated test replays all migrations using real PostgreSQL 18.3/PGlite 0.5.8, packaged pgcrypto and synthetic Auth/Storage scaffolding. It does not connect to hosted databases or providers. It checks function ACL/security configuration, owner/foreign/anon/service-role cases, existing direct-update denial, stale/version/type/link/ID/state failures, exact repeated-call idempotence, event failure and event-ID collision rollback, unchanged unselected notices and prior events, and unchanged workflow/stage/worker/task/action/asset/approval/cost/receipt/capability tables. An unknown settled cost remains unknown. Original Stage 14 creative and decision-dispatch SQL suites are replayed unchanged. Migration success, injected later failure and injected final-GRANT failure all roll back cleanly.

Independent snapshot audit preserved all 171 preexisting functions, 86 relation metadata records and 127 seeded catalog rows. Application verification covers exact microsecond transport, scoped navigation, safe errors and strict acknowledgement presentation.

Limits: PGlite runs a single backend. Repeated calls are real RPC/idempotence proof but are not independent, overlapping transaction contention tests. Lock order and deterministic unique-event atomicity were reviewed in source. Hosted PostgreSQL is version 17. The independently reviewed migration application and preservation checks are recorded above. No owner acknowledgement was performed, and the existing notices remain unchanged until the owner acts.

## Compact Decisions application release

Prepared as a bounded application diff from `fe349c955049dab5ec504dc279422cdf0a350ca1`, preserving the released Connections slice. The actual root Dashboard now reads Decisions directly from owner-scoped interventions with exact counts, deterministic 25-row paging and an independent exact selection. Old requests are not limited by the recent 80-run Overview window. The legacy Needs You route redirects into the same validated root context and preserves only fixed known response codes.

Selected notices show their saved Business, concept, workflow, failed stage, safe reason, retained evidence and complete-or-explicitly-unknown charge state. Acknowledgement requires the existing typed source checks and the original microsecond timestamp. The strict persisted versioned receipt is the only source of `Stopped · reviewed`; a generic resolved record or a success query code cannot create that claim. Work and Overview treat `completed_at` as execution-ended even when the saved status remains `needs_owner`.

Existing synthetic-review, browser-control and Etsy-simulation actions remain routed through their original typed server handlers. This slice changes only their allowlisted return navigation and fixed response-code presentation. Return state is limited to root Decisions, exact notice and Business, page and status. Unknown request types remain inspect-only. Work links back to the exact compact notice and retains technical evidence in its contained panel.

Offline tests exercise the real DashboardPage, real readers and actual action handlers with an isolated owner-session/RPC/hook harness. They cover old/off-page selections, mixed types, two Businesses, foreign/malformed selections, stale and repeated submissions, uncertain transport, exact count changes, preserved stopped-run/failed history/unknown costs, fixed feedback and legacy navigation. Provider/action networking is denied in fixtures.

Hosted-only Chromium verification is enabled in CI and early screenshot capture. It covers 1280×720 and 1440×900 desktop document height, long populated lists, contained details, keyboard/focus, pending/double-click behavior, reload/history and mobile/zoom-equivalent reflow. These browser checks and screenshot inspection must pass before merge; no local Chromium execution is authorized or claimed by the implementation task.

### Hosted diagnostic correction and verification scope

The `28c4d288` diagnostic was not accepted: hosted pixels exposed intrinsic-width overflow from long Business options, and the selected pane hid the failure and receipt summary below long identity text. The bounded repair constrains each native select within its grid track, puts saved failed stage/reason and known/unknown charge state first, and retains complete safe concept, workflow, Business and exact identifiers in a keyboard-accessible disclosure. Tests check filter-control containment and overlap, primary summary visibility, settled native keyboard scrolling, and capture initial/failure pixels before later assertions can stop the journey.

The retained React/Suspense fixture exercises the production component and actual DashboardPage/action test seams, but does not run Next's router or Server Action transport. Its navigation revision guard models the installed Next 16.3.8 action queue's priority for a newer navigation and discard of an older action's router state. An unresolved action cannot steal a later selected notice in this fixture; explicitly revisiting the original notice reads its authoritative saved outcome. This is retained component coverage, not proof of the real Next transport race. A hosted isolated Next navigation/action fixture remains an explicit acceptance task. The normal root browser journey separately covers full-document refresh and actual root shell/count projections.
