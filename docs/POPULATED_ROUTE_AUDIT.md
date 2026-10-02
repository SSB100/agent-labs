# Populated retained-route audit

Date: 2026-10-02. Audit baseline: frozen phase41 source in `agent-labs-printful`. Narrow follow-on implementation: isolated `agent-labs-populated-integration` copy. This is a source/data-contract audit plus offline real-loader/server-render fixtures, not live production or browser qualification. No provider action, credential entry, database change, ACL expansion or spending was performed.

## Release truth and scope

The root Work/Decisions/Library/Research/Activity collections are being integrated separately. This report addresses retained specialized routes and their connected recovery paths. A recent fixed window is not a complete searchable registry. Client filtering or client pagination of that window cannot recover unseen rows.

Current server actions independently revalidate owner identity, exact saved approvals and execution prerequisites. Misleading display and hidden history are important user-facing defects, but this audit did **not** demonstrate an execution-authorization bypass or cross-owner data disclosure.

## High-priority findings

### Creative recovery and cost truth (addressed by this narrow patch)

Baseline `src/creative/data.ts:25–38` independently loaded newest 50 approvals, newest 50 runs and newest 100 assets; receipt reads were scoped only to loaded runs. `src/app/dashboard/artifacts/page.tsx:88–99` joined those windows in memory and interpreted an absent run as “Approved · not started,” “No calls recorded,” with Start enabled. An approval and its actual run can fall into different windows.

The audit reproduced this with the real loader and page, a strict 51-row offline fixture and a paid run outside the run window: approval present, run absent, `costsAvailable=true`, no read error, false not-started/no-calls labels and enabled Start. The existing server action remains idempotent and independently authoritative; that does not make the display correct.

`src/components/guided/creative-library.tsx:60,99` emitted `/dashboard/artifacts?business=…#creative-run-ID`. A fragment is not sent to the server, so it could not load an older receipt outside the newest-50 window. The original anchor ID itself must remain stable.

Narrow implementation:
- Exact owned `creativeRun` and/or `creativeApproval` query identities resolve independently of recent windows. Both, when supplied, must match; missing, foreign, malformed or conflicting selection cannot substitute a recent record
- Exact selected history loads at most one approval/run, two assets/reviews/image outputs and six reservations/settlements, using existing public-table ownership/RLS contracts
- Complete-count checks distinguish a complete empty ledger from unavailable/truncated reads
- Recent windows remain bounded and explicitly labeled; an unmatched approval in an incomplete run window shows unknown state/costs and a recovery link, with Start disabled
- New links preserve the existing `creative-run-ID` / `creative-approval-ID` anchors and carry server-visible query identity
- No automatic retry, provider call or new authority is added

Historical fragment-only bookmarks remain valid for rows already in the recent window. A bookmark for an older row needs the new exact query identity; this patch does not infer server identity from the URL fragment.

### Commerce wrong-Business fallback (addressed narrowly)

Baseline `src/app/dashboard/printful/page.tsx:19` and `src/app/dashboard/etsy/page.tsx:37–38` silently used the first owned Business when an explicit `?business=` was unknown or foreign. This was a wrong-context connected-flow problem, not an observed data leak. They now reject invalid explicit selection and render unavailable state without loading another Business when ownership context failed.

Connected links also addressed narrowly: `src/app/dashboard/etsy/workspace.tsx:22` now carries its existing owned `data.businessId` to Products/Artwork/Printful empty-state links. The compact Products exit (`src/components/stage13/products-workspace.tsx:276`) receives the RLS-read workflow's `detail.run.business_id` through `WorkflowWorkspace`, including when its product data is empty. Neither route derives this link scope from an unchecked query or a sampled product record. Exact Business B link regressions cover both paths and a conflicting workflow Business query.

### Products: misleading completeness and hidden prior work

- `src/products/data.ts:9–25`: independent 100-experiment, 100-candidate and 300-decision windows; no exact totals or cursor
- `src/app/dashboard/products/page.tsx:64,72–75`: window lengths become preserved-round, candidate, in-progress and experiment totals
- `src/components/stage13/products-workspace.tsx:217–232`: the first loaded experiment/decision is called latest; missing history can become “Unassessed,” no experiment and a Research candidate control
- `src/products/history.ts:59–61`: “only legacy history” is computed from the supplied subset, including vacuous truth on empty arrays
- `src/components/stage13/products-workspace.tsx:237–276`: client-only candidate selection and all-card rendering; no server search or page identity
- `src/products/discovery-v2-data.ts:11–33`: root/successor discovery is derived from the supplied experiment window; source artifact loading is not explicitly bounded

Consequences include hidden old active experiments, incomplete latest-state classification and false complete/no-record claims. Actions revalidate, but the UI must not encourage a duplicate based on absence in a sample. A later public-table slice can add bounded page/search/filter/detail reads without private RPC changes. Global latest-per-candidate totals require an honest defined read contract, not client aggregation of recent decisions.

## Private workspace contracts and limits

These must not be presented as fully navigable 100+ histories under the current backend contracts:

| Workspace | Existing returned window | Evidence | Safe UI-only response |
| --- | --- | --- | --- |
| Account setup | newest 50 requests; newest 100 health events | `20261001215606_account_setup_workflow.sql:134–138`; `accounts/server.ts:41–53` | Mark recent windows; do not assert no older open request; exact request lookup has the restricted existing option described below |
| Etsy draft | newest 50 runs | `20261001023310_stage16_etsy_drafts.sql:96–98` | Mark recent draft activity; no fake total or client-only “all history” |
| Listing preparation | newest 50 runs; newest 30 qualification runs | `20261001192632_stage17_listing_durable_runtime.sql:273–274,687` | Label loaded history and avoid deriving all-running/completeness from it |
| Printful configuration | newest 50 sources and runs | `20261002004256_stage15_product_configuration.sql:263–278` | Mark recent windows; preserve exact intervention recovery |
| Etsy publication | newest 50 runs; eligible verified-draft array has **no explicit limit** | `20261001195246_stage18_etsy_assisted_publication.sql:241–260` | Keep history honest; the unbounded drafts response needs a future backend retrieval contract for true server pagination |

None of those historical workspace RPCs returns a general cursor/page/count contract. Slicing returned arrays cannot fulfill 100+ server pagination. General pagination requires a separately reviewed backend contract change; no ACL expansion or bypass should be used.

Etsy package eligibility also scans only the newest 20 package artifacts *before* eligibility validation (`src/etsy/server.ts:68–77`; `src/listing/server.ts:75–86`). Twenty newer ineligible packages can hide an older eligible package. The current “No qualified Product Package available” wording is stronger than that query can establish.

### Existing exact intervention recovery is safe outside the latest window

- Printful SQL (`20261002004256_stage15_product_configuration.sql:263–276`) resolves the exact intervention of type `printful.product.reconcile` within the requested owned Business, then pins its run ahead of LIMIT 50
- Publication SQL (`20261001195246_stage18_etsy_assisted_publication.sql:241–259`) does the equivalent with exact intervention/action-intent/type/capability/owner checks. Resolved interventions remain usable historical links
- Valid foreign or wrong-type intervention IDs fail closed; arbitrary run IDs cannot widen either read. Preserve these joins and exact links
- Printful's route currently ignores malformed non-UUID intervention input (`printful/page.tsx`); only valid UUID intervention selections reach the exact loader. This is not an exact lookup for malformed input and is distinct from the valid-ID safety contract
- The reconciliation queue readers compare exact owner-scoped count against returned rows and mark incomplete at their 100-row ceiling (`printful/server.ts:69–78`; `etsy-publication/server.ts:38–45`)

### Secure account selection beyond 50: existing option, exact effects verified

`src/app/dashboard/accounts/secure/page.tsx:18` resolves `?run=` by searching only `workspace.runs`. A current exact request beyond that window can falsely become ineligible. The registration handoff already retrieves the exact run through `resumeAccountSetup` (`accounts/server.ts:72–75,139–145`).

The sole current SQL implementation was traced end to end:
- Public `account_owner_transition` is a SECURITY DEFINER SELECT wrapper calling `private.account_owner` (`20261001215606_account_setup_workflow.sql:399–400`)
- For operation `resume`, ownership/payload/server authority checks run, and Business/profile/exact-owned-run rows are locked with FOR UPDATE (`132–147,281–282`)
- All data-changing branches are gated to different operations. `resume` validates only `runId` and returns `private.account_run_view(r)` (`311–313`)
- No INSERT/UPDATE/DELETE, lease, claim, state transition or audit mutation runs for `resume`
- `account_run_view` is a stable JSON projection. It calculates expired display status without persisting it (`94–101`)

Therefore the existing server-side `resumeAccountSetup(context,businessId,runId)` can retrieve one exact owned request without a history window when server authority is already configured. It is not a pure read-only-transaction operation because it takes row locks, and it cannot work with workspace-only/keyless authority. A future secure-page change must preserve failure/unavailable handling, run/provider/Business binding, approval expiry and vault gates; it must not silently select another run. No account production file was changed here.

The account registry itself is naturally bounded to Etsy and Printful via unique Business/provider (`account_setup_workflow.sql:26–32`). Aggregate `loadAccountSetupInterventions` already flags a full 50-run window as incomplete (`accounts/server.ts:164–170`); the Accounts page should not lose that nuance.

## Retained workflow details and Advanced tools

- Exact workflow detail is independent of the recent collection window and remains RLS-protected (`src/lib/core-ui/data.ts:249–260`). The detail loads every stage/task/worker/artifact without explicit application bounds, newest 100 events, and newest 80 browser events without count/cursor (`data.ts:282–314`; `workflows/[workflowRunId]/page.tsx:96–109`)
- `WorkflowWorkspace` renders all artifact JSON, uses client-only tabs, and only honors `initialWorkspace='products'`; another explicitly requested tab may be displaced by candidate/browser presence (`src/components/stage7/workflow-workspace.tsx:217–219,272–294`)
- Model Router loads newest 30 runs, then reports active/fallback/cost aggregates of only those rows (`model-router/page.tsx:144–190,226–240,332–375`)
- Worker Proof loads newest 30 runs and newest 120 events across that set. An older loaded run can say “No worker events recorded yet” after newer runs consume that global event window (`worker-proof/page.tsx:142–180,327–336,439`)
- Worker Evaluations loads 20 evaluations and 10 promotions; “Recorded tokens/cost” sums those loaded evaluations (`worker-evaluations/page.tsx:173–179,202–209,242–249,310–316`)
- Pack catalog and installations have no explicit application page bounds; activation controls scale as packs × Businesses (`packs/page.tsx:14–15,41–50`). Settings maps all Businesses (`settings/page.tsx:43–49`)
- Legacy History ignores collection truncation/errors and calls window-derived counts “Total”; legacy Work and Needs You at least warn about incomplete recent windows, but cannot reach older records (`history/page.tsx:23–39,66–76`; `workflows/page.tsx:28–35`; `needs-you/page.tsx:43–59,76–90`)

Specialized technical interfaces may remain specialized. Their labels must say recent/loaded/unknown as appropriate, not imply complete history or lifetime spend. Broad redesign is unnecessary.

## Layout evidence and remaining acceptance obligations

Product and Printful styles already use `min-width:0`, wrapping and narrow-screen grid rules extensively (`products/products.css:23–43,149–162`; `printful/printful.css:13–16,78,85–91`). Etsy's compact stylesheet lacks equivalent long-title/select containment. That is a browser-test obligation, **not** a proven visual overflow from this read-only audit.

For each future route slice, use fixtures with 0, 1, 49, 50, 51 and 125+ records, long/duplicate names, equal timestamps and these critical cases:
1. Old active/open record behind newer terminal records; do not derive absence from a recent window
2. Exact selected row beyond the page and outside current search/filter; reload/back/forward keep the identity
3. Different approval/run creation order; paid failed no-asset attempt; expired run; unknown/missing settlements; corrupted count and partial reads
4. Deleted, foreign-Business and conflicting exact IDs; no fallback to the first owned Business or similarly named record
5. 320/390/1440px, keyboard focus and disclosure navigation; bounded record/card count and no horizontal page overflow
6. Strict provider/action-denying fixtures: no database mutation, model/provider execution, upload, account setup or spend during navigation
7. Actual query contracts: bounded server read, stable ordering/tie-break, count separate from loaded rows, honest unavailable state; never a fetch-all loop hidden behind a pager
8. Preserve exact artifact IDs, creative receipt anchors, workflow IDs, intervention action bindings and owner guards

This narrow patch has real offline loader/render coverage for 125-row Creative recovery and both commerce Business selection routes. Local browser checks were intentionally not run under the task constraint. Root-pane browser validation, broader legacy pagination and backend historical pagination remain separate acceptance obligations.
