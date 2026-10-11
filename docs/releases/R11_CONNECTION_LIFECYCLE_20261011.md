# R11 OAuth-first connection lifecycle

Status: released in PR89 at `76abe0c35fcbb403b1d5569c241690f27a4f26f4`,
unchanged qualified tree `63331c2cf81b97389412d2b5a234429c246e5274`.
Production migration installed as `20261011224821`; installed statement hash matches below.
Production deployment: `dpl_EPZeLj5Yuda7Xmx9A1mjBQ33fYbT`.
Baseline: `a4aa0e6166a04915cfe9079ad5d6cfbcc23c6d6e` (PR 88).

## Useful result and exact scope

Use the existing official, read-only Etsy OAuth path after evidence proves it is
suitable. R11 already keeps the account revision and bounded operation window
independent of deployment identity. This change adds owner-visible status and
recovery guidance, immutable executing-release provenance, and exact saved-attempt
reconciliation. It does not add a release registry or alter owner grants.

The new owner page distinguishes:
- verified historical shop result and current saved account eligibility;
- near-expired OAuth tokens that can refresh inside their approved window;
- exhausted reads/refreshes, refresh cooldown, and in-progress operations;
- earlier Agent Labs sign-in versus genuine local access cutoff;
- uncertain refresh custody, which requires a clean reconnect and fresh approval;
- stopped windows and retained immutable dispatch receipts.

A reconnect button leads to the existing scoped consent section. If no current
approved grant exists, the page explicitly says approval is not ready. No grant
producer, new token, renewed cutoff or self-service approval bypass is added.
This is not a promise that a fresh reconnect is already authorized.

## Fresh suitability evidence, not inherited authority

One ordinary supported operation was explicitly authorized for the rework and
performed on the qualified baseline on 11 October, not on this new code:

- Operation `09ae722b-caf3-49f2-9934-8dff831576b1` succeeded at
  `2026-10-11T21:46:44.475816Z`.
- Exact account: StudioKindredStore, Etsy shop `68351641`.
- One existing-grant refresh POST followed by one exact own-shop draft-status GET.
- Observed zero drafts. This is not Marketplace Insights or demand evidence.
- Existing encrypted connection `986e95ed-5a0c-497c-844a-65fcb6e1d74b`, revision
  `8a3aef5a-a392-440b-8a18-e44e3f7b8970`, scopes `shops_r` / `listings_r`.
- Existing app `1519534660126`; no duplicate application or key was created.
- Read and refresh counters were each 1 of 743, with 742 remaining.
- Local cutoff remained `2026-11-05T01:31:55.9399Z`. Token custody was ready;
  access-token expiry was `2026-10-11T22:46:13.727Z` at that observation.
- The 21:47:48 readback found no new recorded Agent Labs Steel setup, admission,
  dispatch, handoff, verification, browser/session/receipt, configuration-use or
  metadata-readback activity since the 21:46:42 action. Direct Steel telemetry
  was not queried.

This proof establishes suitability for that bounded own-shop action at that time.
It does not establish broad account access, an Insights API, marketplace analytics
permission, perpetual token validity, or a persistent browser connection.

## New mechanism

Migration `20261011220143_r11_connection_lifecycle_receipts.sql`
(SHA256 `b3754b10b5be662c94253a45d04f73e0cd2c5d0ab535e1d573225f37521b4af7`):

1. Private RLS-protected append-only execution receipts, one per operation/stage.
   The app captures Production commit/deployment from trusted server environment.
   The existing exact-tree release gate qualifies that code; the receipt alone
   does not claim qualification or authorize an operation.
2. A thin wrapper around the unchanged R11 owner RPC. It strips optional
   provenance, runs all original authority and marker checks, then writes a
   receipt atomically only for a winning first dispatch. Duplicate admission does
   not relabel prior receipts. Old callers remain supported during rollout.
3. Exact `reconcile` is metadata-only: current owned Business/session, exact saved
   attempt, normal lock ordering and a fresh post-lock session check. It closes
   only expired active attempts as failed, preserving original markers, custody,
   proof and operation/window IDs. It never decrypts, sends, retries, creates a
   new attempt, promotes a candidate, restores a predecessor or renews authority.
   Reconciliation remains usable after Stop, without provider/execution keys.
4. Owner-safe metadata explains the already-enforced current-session equality,
   refresh cooldown, expired-attempt reconciliation and execution provenance.
   It exposes no auth-session IDs or credentials.

Normal caught GET failures already called `fail` in R11. Newly added reconciliation
covers the separately persisted expired-active state left when a process disappears.
After a fresh-token interrupted GET, an owner may reconcile and explicitly request
a new bounded read if authority remains. After a refresh uncertainty/candidate,
reconciliation never makes that token usable: clean scoped reconnect is required.

## Acceptance evidence and limits

- 58 focused readiness, rendered-page and server tests passed in Node 22.20.0.
- 30 isolated PGlite SQL tests passed, including migration rollback, ACL closure,
  old-caller compatibility, immutable provenance, unchanged grants across two
  release identities, stale-session guards, expired-active reconciliation and Stop.
- The integrated actual encrypted-OAuth/server/adapter/SQL/readiness fixture proves
  connect, verify exact shop, authorize one bounded operation, refresh/read,
  compatible redeploy with unchanged grant/window, caught interrupted GET with no
  replay, and Stop/reconcile. Provider responses are inert; no real network call.
- Separate SQL cases prove expired-active reconciliation and unchanged candidate
  custody. The integrated caught-error case alone does not prove process recovery.
- [Exact source-head qualification](https://github.com/SSB100/agent-labs/actions/runs/38179726477)
  passed 92 jobs with one intended diagnostic skip. The downloaded release receipt
  matches commit `c6c1292c15c072acefed297024ba2847e2ae36ef` and the unchanged
  merged tree, with all 15 required release gates successful.
- The full quality job passed lint, typecheck, Next build and 4,882 tests with
  148 explicit test skips. Native R11 SQL passed all 37 cases, including the
  completion/reconciliation and session-expiry lock races.
- Actual Chromium/Next navigation, Stop and exact-attempt reconciliation passed.
  Eight downloaded acceptance reports contained 337 passing scenarios. Mobile
  reconciled/reconnect states and the desktop stopped state were visually reviewed.
- The [exact-merge run](https://github.com/SSB100/agent-labs/actions/runs/38181917059)
  retains the same full gate. See that run and PR89's release handoff for final
  post-merge qualification. No additional provider request is part of deployment
  verification.
- The Next UI fixture proves real actions/navigation/reload/Back behavior against
  an inert RPC boundary; it is not evidence of SQL/provider recovery by itself.

Two exact fake deployment identities in fixtures test grant independence and
receipt preservation, not whether arbitrary deployments are qualified. Only the
normal exact-commit CI and release gate can establish qualification. The live
baseline proof is pre-existing R11 behavior; the new receipts, messages and
reconcile RPC are newly changed behavior.

## Rollout and action boundary

- Draft branch is explicitly nondeploying in `vercel.json`; its exact CI push
  branch runs the normal aggregate gate. No checks are removed or weakened.
- Freeze and independently review the code tree and exact migration SHA256.
- Root must approve the exact production migration bundle before installation.
- Install the additive migration first. Baseline calls still work; the new app
  requires provenance on its own new dispatches and can use the richer metadata.
- Release only the qualified actual remote tree, then qualify the merge and
  Production mapping as usual. No new live refresh/read is needed to repeat the
  earlier connection proof unless separately authorized for a defined purpose.
- No OAuth grant, read window, key, provider binding or browser access is seeded.
  Any future persistent-access consent remains an exact action-time approval.

## Stopped browser work remains separate

The old stopped Steel operation/envelope is not adopted by this change. Its held
USD 0.025 unknown actual, USD 10 cap, eight remaining research units, lifetime 57,
original roots and `2026-10-12T02:06:00Z` expiry are neither reset nor transferred.
No successor or replacement is created. The prospective browser contracts in
ADR 004 remain inert. Durable browser lifecycle integration and its real handoff,
crash/cleanup tests are still separate work; no browser setup readiness is claimed.
