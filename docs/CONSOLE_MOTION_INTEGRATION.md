# Console motion integration

Integrated after the verified compact-console release. Dashboard derives the motion snapshot from owned saved records; shared stage/decision and exact output nodes carry matching record identities. Hosted exact-head visual and interaction verification is required before publication.

## Integration contract

1. Derive a snapshot server-side with `deriveConsoleMotionSnapshot(collection, {
   businessIds: context.businesses.map(b => b.id), observedAt, unavailable })`.
   Use the existing `loadConsoleObservationTime()` server observation timestamp.
   Combine Business/decision source failures into `unavailable`; collection read
   errors are already checked. Never pass subscription/account connection status.
2. Wrap the stable console content in `ConsoleMotionBoundary` with `ownerId`,
   `scopeKey`, `snapshot`, and the existing server-rendered children. A suitable
   scope key describes the actual selected Business/collection, not the tab name.
   Keep the boundary outside the Overview/Browser centre switch. It uses
   `display: contents`, so it adds no sizing, scroll area or visual box.
3. Opt existing elements into presentation using:
   - `data-console-motion-target="core"` on the centre's small orb target
   - `data-console-motion-target="run" data-console-motion-id={run.id}`
   - `data-console-motion-target="stage" data-console-motion-id={stage.id}`
   - `data-console-motion-target="worker" data-console-motion-id={worker.id}`
   - `data-console-motion-target="output" data-console-motion-id={artifact.id}`
   - `data-console-motion-target="decision" data-console-motion-id={intervention.id}`
4. Mark a direct child icon/dot/check with `data-console-motion-mark`. Only this
   small child pulses or settles. Preserve the existing labels and completion
   check; motion adds no status text and must never replace it. Do not mark the
   whole card, iframe or all console text as a moving mark.
5. The current console already exposes worker, artifact and intervention IDs.
   Timeline view models expose stage keys rather than row IDs: resolve the exact
   latest attempt through `latestStageByKey(collection.stages.filter(stage =>
   stage.workflow_run_id === currentRun.id))`. Planned/unrecorded stages have no
   persisted stage ID and must remain unmarked. A retry's own row ID is distinct.

The DOM adapter owns only `data-console-motion-state`, `-epoch`, `-event`, `-cue`
and its two CSS variables. React continues to own all structure, labels, links,
forms and backend state. No provider/action/auth module is imported.

## Behavior and truth boundaries

- Accepted start: one 640 ms settle on observed persisted `running` + valid
  `started_at`, never a pending form, queued reservation, page opening or
  subscribed update channel. A known run that resumes does not start over.
- Processing: one slow 3.2-second small-mark opacity pulse. Stage motion needs a
  current, non-ended run plus its exact latest running stage. Worker/core motion
  additionally requires the existing exact run/task/stage/worker matching check.
- Completion: 480 ms settle only after the corresponding persisted completed
  record and completion timestamp. Keep the existing static check afterward.
- Saved output: 1.4-second inset highlight on a new artifact ID and its immutable
  creation timestamp. Updating a known artifact does not pretend to save it again.
- Owner decision: 1.2-second restrained amber inset cue. The amber icon and text
  continue to show attention afterward; there is no endless warning pulse.
- Idle, queued, waiting, stopped, failed, ended and unavailable records do not
  pulse as working. Newer parent failure/completion wins over stale child receipts.
- No percentage, simulated progress, audio, auto-scroll, reflow or layout animation.
- Reduced motion removes all animation/transition/transform from these targets
  while preserving labels, checks, colors and current state.

## Lifecycle

First load is quiet. In-tab history, keyed by owner + scope, retains only record
IDs/states/timestamps and at most eight scope ledgers. Identical polling keeps the
same event key and animation instance. Remount does not replay an existing cue;
an actual new persisted start since the previous page observation can still cue.
The running phase is anchored to its persisted start time. Full reload and an
unseen scope establish a quiet baseline. No local/session storage is written.

Unavailable source reads stop motion immediately; recovery establishes a quiet
baseline. Hidden-tab one-shot cues are discarded rather than replayed on focus.
Scope changes clean timers/data attributes, and nested boundaries are isolated.

## Files

- `src/lib/core-ui/console-motion.ts`: pure receipt derivation/transition logic
- `src/lib/core-ui/console-motion-dom.ts`: scoped DOM adapter and in-tab ledger
- `src/components/console/console-motion.tsx`: small client boundary
- `src/components/console/console-motion.css`: opt-in motion/reduced-motion styles
- `tests/console-motion.test.mjs`: deterministic state and DOM lifecycle checks
- `tests/helpers/console-motion-browser.mjs`: real-component hydration fixture
- `tests/console-motion-browser.test.mjs`: optional browser behavior and screenshot

## Verification

Local deterministic/state/DOM tests, SSR fixture generation, focused ESLint and
full TypeScript are available without starting providers or a dev server:

```sh
node --test tests/console-motion*.test.mjs
npx eslint src/lib/core-ui/console-motion*.ts src/components/console/console-motion.tsx tests/console-motion*.test.mjs tests/helpers/console-motion-browser.mjs --max-warnings=0
npx tsc --noEmit --incremental false
```

The browser tests use the repository's existing opt-in `GUIDED_UI_BROWSER=1` gate
and installed pinned Playwright Chromium in hosted CI. All non-fixture requests
are blocked. They check polling Animation identity, remounts, failure/stopped/
unavailable state, scope/owner changes, completed checks, static amber attention,
reduced motion, hydration errors and a 390 px screenshot without horizontal spill.

Local Chromium is policy-blocked by `socket() Operation not permitted`; browser
assertions have **not passed locally**. Do not retry or use an alternative route
to bypass this restriction. Run the optional browser suite on the exact follow-on
PR head in the established CI. Integration into the real console and its final
full-suite/layout gate remain the next release's work.
