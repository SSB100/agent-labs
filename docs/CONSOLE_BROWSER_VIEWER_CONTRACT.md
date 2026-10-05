# Centre Browser: metadata fallback and scoped R10 viewer

R10 implements a separately enrolled, one-shot controlled-public qualification viewer. Its exact source, privacy boundary, live qualification limits and approval gates are in [R10 privacy-safe viewer](R10_PRIVATE_BROWSER_VIEWER_CONTRACT.md). Existing Stage 8/9 and secure handoff sessions retain the metadata fallback described below; they are not upgraded by this implementation.

The following is the preserved **pre-R10 source audit and fallback contract**. Its “future” and “not implemented” language records the earlier baseline, not the new R10 implementation status. Current fallback copy is “Live viewing unavailable for this session.”

## Shipping boundary

The Overview/Browser toggle is URL-backed. Browser shows only the selected owner's saved session status, update timestamp, fixed workflow-type label, Business and exact run. It always says:

> Live viewing unavailable: a privacy-safe viewer contract is not yet implemented

The saved `live` status is displayed as **Recorded session state: live**. It does not establish present connectivity, expiry, or that safe pixels are available. Unknown, disconnected and expired values are not inferred from elapsed time. Query failures remain distinct from a successfully read empty result.

There is no iframe, screenshot, replay, observation text, native-view endpoint, viewer lease, private live-view RPC or provider call in this feature. Forged `state: "viewable"` props cannot enable anything. There is no approval/retry loop. This is a useful saved-metadata fallback; it does **not** fulfill the requested actual in-centre browser watching.

The Record link opens `/dashboard?view=work&run=<exact UUID>&business=<exact UUID>`. Dashboard authenticates the owner and rejects a Business/run mismatch; `ConsoleWorkPane` renders saved records without `WorkflowWorkspace`. Do not substitute `/dashboard/workflows/<id>`: `src/components/stage7/workflow-workspace.tsx:217–218` defaults that legacy detail to Browser whenever a session exists, even without `workspace=browser`.

## Integration contract

1. Obtain the existing authenticated `OwnerUiContext` from `requireOwnerUiContext`; never pass a service-role client or an unverified Business list. `loadConsoleBrowserWorkspace(context, { businessId, workflowRunId })` also validates selected IDs against that owner's Business list and reads both tables with exact Business scope. A selected older run is read independently of the newest-40 selector. Missing/foreign runs never select another run.
2. Parse `centre` with `consoleCentreMode`. Only a scalar `browser` opts in. The exact run query is `browserRun`, separate from the root Work pane's `run`. Reject duplicate/invalid Business/run selection rather than silently choosing another. Keep the current Business context when valid; no automatic session/run choice is required.
3. Place `ConsoleCentreTabs({ mode, data })` in the existing core top line in place of “Owner control”. Place `ConsoleBrowserCentre({ mode, data, children })` immediately after that line, with the original orb visual **and** next-action element as its children. Overview returns the exact children without a wrapper. Do not wrap the original core visual in an extra flex item.
4. Browser metadata is one compact toolbar and one body. Context is an optional disclosure overlay; a single already-selected Business does not get a redundant selector. Changing Business clears `browserRun`. Targets are at least 24px desktop / 44px through 900px, with new text at least 12px.
5. Existing owner-scoped refresh/navigation may update saved records. The component performs no viewer fetches or polling. It cannot start a session.

Fixture sizes use the actual `ConsoleOverview` centre elements and CSS: 432×240 at 1200×700, 548×318 at 1440×900, and a 390×844 mobile viewport with a 400px centre. The opt-in hosted test checks body containment, visible blocker, text/targets, no horizontal overflow, original orb geometry after repeated toggles, keyboard navigation, Back/Forward/reload, exact Business/run switching, all lifecycle values and forged viewer props. Local Chromium must not be launched in the policy-blocked environment. The hosted test is synthetic and starts no provider session.

## Why no existing public-only viewing case is proved

The source audit found only Stage 8 and Stage 9 reservations writing `browser_sessions` (`20260929194440_stage8_browser_workflow_runtime.sql:357`, `20260929230953_stage9_browser_planner_runtime.sql:238`, and its corrected reservation in `20260930015653_stage9_browser_planner_reservation_aliases.sql:103`). Secure account handoffs are a separate flow and remain excluded.

- **Stage 8 is takeover-capable.** `src/workflows/browser-provider-runtime.ts:79–91` creates takeover/return hooks. The Stage 8 transition validates workflow definition `…0801` and runtime capability (`20260929194440…:449–458`) before setting human control (`:638–640`). Stage 9 creates neither hook and has no `control_taken` operation. This limits the ordinary app flow; it is not a continuous pixel privacy guarantee.
- **Stage 9 intended fixtures are bounded, but its whole stream is not.** `src/workflows/browser-planner-runtime-steps.ts:537`, `:581`, `:654` prepare synthetic pages. `:623–638` navigates to Example Domain and grants only `browser.observe` for that individual case. The executor rejects navigation without `browser.interact` (`src/browser/planner/executor.ts:16–20,64–75`). This is a real action boundary during that task, not an invented capability.
- **Mutable phases permit other navigation.** Synthetic/mock-commerce/controlled-draft tasks grant `browser.interact` (`browser-planner-runtime-steps.ts:560,603,682`). `executor.ts:131–139` permits HTTP(S) navigation without an origin allowlist. `planner/privacy.ts:77–82` rejects certain secret-bearing URLs, but does not establish an exhaustive public-only origin/path policy.
- **Saved phase is not capture-ready evidence.** `browser-planner-runtime-steps.ts:466` records `case_started` before page preparation/navigation. `browser-planner-runtime.ts:62–75` uses one session across synthetic → mock-commerce → real-read-only → controlled-draft. A stream admitted in the read-only case could survive into a mutable case. A UI timer does not retract bytes or revoke its already-issued native URL.
- **Persistent authenticated state is possible, not observed.** `src/browser/providers/steel.ts:175–188` accepts a profile ID and sets `persistProfile: true`; `browser-planner-runtime-steps.ts:506–509` supplies that profile. `20260930015653…:84–95` reuses the Business's Stage 9 identity, and `20260929230953…:344–348` saves the profile ID. `src/browser/automation.ts:61,150–154` reuses the default context and first page without a profile reset. No actual profile contents were inspected, and no claim is made that any existing profile is authenticated.
- **Observations are snapshots.** `20260930021737_stage9_verified_objective_contract.sql:94–149` stores task capabilities/non-goals and an observation artifact tied to session, case and step; conflict updates can replace it. `src/browser/planner/observation.ts:181–213` sanitizes structured observations. Those controls protect structured data at that boundary, not native pixels before/after the observation. This fallback does not display those observations.
- **No saved live privacy boundary exists.** `browser_sessions` (`20260929194317_stage8_browser_provider_foundation.sql:53–81`) has lifecycle/control/view status and timestamps, but no authoritative capture epoch, current capture-safe attestation, origin confinement, fresh-profile guarantee, stream-revocation acknowledgement, expiry or heartbeat. Stage 9 launch (`20260929230953…:334–342`) does not even populate `current_url`/`page_title`. A null URL is not proof of a safe page.
- **The existing live resolver is admission only.** `20260929194718_stage8_browser_runtime_access_and_replay.sql:145–188` checks the owner and saved session status, then returns the native URL with viewer query flags. `interactive=false`/hidden controls are UI configuration, not a revocable security capability or redaction guarantee. This feature neither calls that resolver nor exposes such a URL.

Conclusion: no current persisted task/fixture/public-origin scope proves a continuously non-sensitive native stream. None is admitted by this feature.

## Minimal future trusted viewer contract (design only)

Actual centre watching needs an enforceable backend/capture contract, not a consent checkbox or a faster UI poll:

1. **Scoped authenticated delivery.** Authenticate the owner and exact Business/run/session on connection and delivery. Keep native provider credentials/endpoints server-side. Use an authenticated read-only relay or a provider-supported scoped, revocable viewer capability; do not redirect to an unrestricted bearer debug URL. The viewing channel must have no input/CDP/clipboard/upload privileges, enforced by the backend.
2. **Authoritative capture eligibility.** The trusted runtime/capture producer must bind a versioned eligibility epoch to the exact session and page/context. Record the policy version, source task/case, permitted origins, capture-ready time, expiry/freshness, and whether a clean, nonpersistent context is enforced. Free-form metadata or owner-editable `viewable` flags cannot constitute this attestation.
3. **A privacy boundary before pixels exist.** The producer must withhold frames by default. Before navigation, human control, secure entry, unknown page/profile state, or any policy transition, atomically suspend capture/delivery and discard buffered frames. Resume only after a fresh trusted eligibility check. For a public-fixture-only case, enforce fresh isolated storage plus network/navigation confinement and prohibit later reuse for secure entry; otherwise exclude it.
4. **Real revocation/freshness.** A privacy/ownership/session transition must invalidate the prior epoch and end existing streams at the trusted delivery boundary, not just prevent new connections. Fail closed on stale evidence, unavailable policy checks and revocation failure. UI hide/lease behavior may improve experience but is not the security guarantee.
5. **Verified framing and semantics.** Demonstrate the authenticated viewer can be embedded under the current security headers without broad global policy relaxation. Expose source timestamps and factual unavailable/ended/disconnected/expired states only when the backend actually establishes them. Do not re-label saved `live` as current connectivity.
6. **Adversarial verification before enabling.** Cover cross-owner/Business/run access, forged eligibility, stale/buffered frames, copied capability reuse, takeover between authorization and first frame, secure transition while connected, profile reuse, redirects/navigation, concurrent sessions and revocation failure. Use synthetic frames; no secure entry needs to be captured for the test.

This document proposes no schema, grants, credentials, provider session, security-header change or native-stream publication. Those are separate work requiring an approved, implementable trust boundary.

## Exact ship list and exclusions

Ship these nine new files after integration review:

- `src/browser/console-view.ts`
- `src/browser/console-server.ts`
- `src/components/console/console-browser-centre.tsx`
- `src/components/console/console-browser-centre.css`
- `tests/console-browser-centre.test.mjs`
- `tests/console-browser-hydration.test.mjs`
- `tests/helpers/console-browser-fixtures.mjs`
- `tests/helpers/console-browser-hydration.mjs`
- `docs/CONSOLE_BROWSER_VIEWER_CONTRACT.md`

Excluded/removed: `src/app/api/browser/sessions/[browserSessionId]/watch/route.ts`, all prior lease/watch/eligibility/URL-resolver exports, and the briefly considered new saved-record route. No executable native-view prototype is retained in the repository. Existing legacy live/replay routes and security headers are unchanged by this work.
