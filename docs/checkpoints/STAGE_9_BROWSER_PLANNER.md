# Stage 9: Browser Planner Qualification

Date: 30 September 2026

Status: **Qualified, ready for production deployment after the final hosted gate**

Branch: `stage-9/browser-planner-qualification`

Pull request: https://github.com/SSB100/agent-labs/pull/13

## Result

The authenticated test owner launched live Workflow Run `99e75fd9-ac3a-4771-af95-712b967da77f` on Preview deployment `dpl_6zpvKs5bhfGcYxdnnpdGtbsCUweh`, source `ecce3afa4680ca052e84c524692e823c788c3b18`. Vercel Workflow run `wrun_01M3R1YAX7PXTV2S96YYH9CD19` completed successfully. All four required cases passed in this one run.

| Case | Successful actions | Recoveries | Reported model cost USD |
| --- | ---: | ---: | ---: |
| Synthetic stable-element action | 1 | 1 | 0.0008498 |
| Mock commerce draft | 2 | 0 | 0.0008010 |
| Real read-only Example Domain | 0 | 0 | 0.0002940 |
| Controlled draft price mutation | 2 | 0 | 0.0008752 |

The run used genuine `luna.standard` calls through the qualified `standard.default` route. Reported model cost totaled USD 0.00282; browser-provider cost is separate. The synthetic fixture verified exactly one successful Continue click after intentional stale-element recovery. The draft cases verified exact input values and saved statuses. The controlled mutation verified that Publish was never activated. The read-only case completed on https://example.com/ without mutation.

The Browser Planner definition, its WorkerDefinition, and its Worker Pack are qualified. `private.stage9_planner_is_currently_qualified()` returns true for the stored Worker Pack/model-route fingerprint.

## Implementation

- Structured observations expose URL, title, visible text, forms, controls, links, and stable element IDs. Password values remain excluded.
- Each invocation loads exactly one durable Task Contract and its referenced observation Artifact. It emits one bounded decision through Model Router.
- Core validates observed IDs and permitted capabilities, and executes actions through a separate Playwright adapter. The model receives no selectors, DOM handles, browser APIs, or provider credentials.
- Durable completion criteria record the current verifier result. Core rejects repeated mutation after verification and premature completion before verification. Successful actions clear resolved failures.
- Each objective has five planning steps and at most two recoveries. Explicit fail decisions are terminal.
- Eleven Stage 9 migrations are applied and tracked. Runtime access uses scoped capability hashes; owner launch uses the authenticated Business action.
- Qualification completion requires all four completed stages and passing evidence tied to the same Workflow Run. Current case evidence replaces prior failure summaries; failed-run history stays in its own stage and worker records.
- Fresh observations update the session URL/title shown in the workspace. Failed workflows close active Worker Runs and Task Contracts.

## Verification

Hosted CI `36659328987`, job `109710374817`, passed lint, TypeScript, all 90 tests, the optimized Next.js build, and Workflow compilation of 36 steps across five workflows on Node 22.23.2. The final evidence-integrity migration has no application runtime changes and passed a rolled-back database regression after application.

`supabase/tests/stage9_reservation.sql` verifies initial owner reservation, duplicate suppression, exactly seven stages, and foreign-Business denial. `supabase/tests/stage9_planner_context.sql` verifies the exact completion/scope round trip, incorrect runtime capability denial, prevention of inheriting another run's qualification, and fresh live workspace metadata.

The live run persisted 10 completed Worker Runs, 20 observation/action Artifacts, and 31 owner-readable activity events. No active child Worker Runs remain. The session was released successfully.

In the signed-in browser, planner actions and recovery appeared in the Workflow workspace and Activity Feed. A screenshot during mock commerce showed the actual remote browser embedded in the central workspace. The test owner cannot see the separate Etsy Business, and its direct workflow URL returns 404.

## Repairs discovered by live qualification

The owner launch initially exposed an ambiguous reservation SQL column. The first reserved run then exposed valid constant-only Artifact fields rejected by the JSON Schema validator. These are repaired, including nullable output types. The next live run exposed repeated successful clicks and stale failure context; verifier-aware contracts and the stopping guard repair this behavior without overriding the model's completion decision.

The GitHub billing blocker is resolved. The obsolete token-based Preview launcher and database helper were removed. Provider secrets remain server-only.

## Production deployment

PR #13 was merged. Following the Vercel upgrade, production deployment `dpl_2hMWGgdoRRh2TS8E4gaK8WoTFS3b` is ready from commit `3b76ef33d18f14055eceb9a92dd27a02e53a4de5` at https://agent-labs-two.vercel.app. The health endpoint reports all four configured services. The signed-in test owner sees the Browser Planner as Qualified with all four required cases passed and the successful browser session released. Stage 10 continues on its own branch.
