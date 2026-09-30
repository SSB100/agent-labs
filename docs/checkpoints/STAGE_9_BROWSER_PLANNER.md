# Stage 9: Browser Planner Qualification

Date: 30 September 2026

Status: **In progress, live qualification repairs underway**

Branch: `stage-9/browser-planner-qualification`

Pull request: https://github.com/SSB100/agent-labs/pull/13

## Implemented

- Structured browser observations contain URL, title, visible content, forms, controls, links, and stable element IDs.
- The Browser Planner receives the exact durable Task Contract and its referenced observation Artifact.
- Each planning step returns one bounded decision through the qualified `standard.default` model route.
- Core rejects invented element IDs and executes browser actions through a separate Playwright adapter.
- Planner steps, actions, failures, recovery, and model cost summaries are durable and visible in the Workflow workspace.
- Recovery has two retry opportunities and qualification objectives have a five-step limit.
- An explicit planner `fail` decision is terminal and cannot report success.
- Ten Stage 9 migrations are tracked and applied to the Agent Labs Supabase project.

## Recovery in this session

The last deployed Stage 9 candidate failed during tests. The latest branch had already restored the Browser Planner test file, but still contained an invalid regular expression in `tests/stage9.test.mjs`.

The recovery corrects that expression so it checks that the promotion helper does not recursively update planner status. It also updates the historical Stage 8 closeout test to allow subsequent Stage 9 implementation, corrects the assertion for the dynamic Qualify/Requalify label, excludes generated test output from lint, and adds a behavioral regression for terminal planner failure.

A dependency lockfile now records the installed versions. Next.js's local SWC cache is ignored. Git author configuration is scoped to this checkout and matches the established Agent Labs repository identity for Vercel deployment access.

## Local verification

`npm run check` passed:

- ESLint with zero warnings
- TypeScript checks
- 86 tests passed, zero failures and zero skips
- Optimized Next.js production build
- Workflow compilation: 36 steps across five workflows

The local gate used Node 24.21.0 and npm 11.19.0 with the CI placeholder public Supabase environment. The repository and hosted builds target Node 22. The hosted gate must still run; this local result does not establish live provider qualification.

## Resolved billing blocker

GitHub Actions job `109688097370`, for source commit `9cfb173775f2f0bb9afbb7d9f89476ab4d127fcd`, never started a runner. Its annotation states:

> The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings

The owner upgraded GitHub on 30 September. CI run `36655525072` was rerun and passed on Node 22.23.2 for commit `74e5143ae5ded48e7cef3171568b111eb4d1c173`: lint, TypeScript, all 86 tests, 36 steps across five workflows, and the production build.

## Live qualification recovery

The confirmed test owner can sign in through the normal application login. Its empty dashboard correctly excludes the separate Etsy owner's Business. A private `Stage 9 Live Qualification` Business was created under the test account.

The first owner launch exposed an ambiguous `workflow_run_id` lookup in the reservation RPC. The applied reservation migration qualifies that column with its table alias. `supabase/tests/stage9_reservation.sql` verifies first reservation, duplicate suppression, all seven stages, and denial outside owner scope in a rolled-back transaction.

Live run `54a2d31a-9f39-441b-ae49-9a0715451e2f` successfully launched Steel, then stopped during synthetic context validation. The bounded JSON Schema validator rejected valid constant-only Artifact fields. The validator now accepts constant-only fields and nullable type alternatives while still rejecting wrong constants, wrong types, and invalid constraints. Two Browser Planner behavioral regressions cover these inputs and outputs.

A private trigger closes active Worker Runs and Task Contracts when their Stage 9 Workflow Run fails. The failed live run's orphaned child records are now failed with completion timestamps. The obsolete token-based Preview route and its database helper have been removed; live qualification uses the authenticated owner action.

Local lint also excludes Workflow SDK generated routes, so checks can run again after a local build. Hosted CI run `36658286335` passed all 88 tests and the production build for `c2aff72bf77c227e722a5c32a2e8972aa9701dc6`.

The repaired Preview's live run `5b5b58fd-7152-4d0f-9fe8-878945455570` executed genuine routed model calls, fresh observations, and stale-element recovery. It exposed repeated clicks after the visible success state. Each durable Task Contract now includes the Core verifier result and case-specific non-goals. Core rejects further mutation after verification and premature completion before verification. Successful actions clear resolved failures. The model prompt explicitly compares current state against the objective, and the synthetic fixture counts clicks to prove exactly one successful click. Draft verifiers also check the exact field value and the controlled no-publication state.

Local lint, TypeScript, and all 90 tests pass. The rolled-back database context regression proves verifier evidence and case-specific scope survive the durable round trip, and wrong runtime capabilities are denied. The latest stopping repair awaits hosted CI, Preview, and successful live qualification.

## Live status and next steps

The first live Stage 9 run failed during synthetic input validation. The planner remains `candidate`; the synthetic case is `failed` and the other three required cases remain `candidate`:

1. Synthetic stable-element action and stale-element recovery.
2. Mock commerce draft flow.
3. Real read-only Example Domain observation.
4. Controlled draft price mutation with a no-publication check.

After the consolidated repair passes the hosted gate and Preview, rerun and inspect all four live cases, verify durable Worker/Artifact/action records and owner isolation, and complete the checkpoint before merging and deploying production.

Production remains on qualified Stage 8 commit `c968312aed962dcaf4bcb8d48ba9be6d57856035`. Stage 9 is not qualified and Stage 10 has not started.
