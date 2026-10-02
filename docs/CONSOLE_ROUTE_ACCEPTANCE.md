# Whole application console acceptance checklist

Current implementation baseline: `83cb5cda632e8a3cd09a4e921e5fd2f3ff468746`, 2026-10-02. This is an acceptance checklist, not a separate release plan. The sole remaining-work order is [R02–R19 in the canonical plan](AGENT_LABS_V2_IMPLEMENTATION_PLAN.md). Historical release evidence belongs in the [evidence crosswalk](AGENT_LABS_V2_EVIDENCE_CROSSWALK.md). Do not use this checklist to restart already accepted work.

## Shared acceptance contract

Every affected desktop workspace must fit 1280×720 and 1440×900: document `scrollHeight <= clientHeight + 1px`, no horizontal document overflow, frequent actions visible, and labelled contained scrolling for long content. Clipping or hiding an unreachable field does not pass. Preserve the reference-matched console geometry while making content legible.

At 320/390px and 200% zoom, readable reflow and operable controls take priority; mobile page scrolling is allowed. Test keyboard focus/End/disclosures, exact values for long names, sticky bars, empty/loading/unavailable/stale/success/failure states and truthful unknown costs/counts.

Use actual source components/loaders with 0/1/49/50/51/125+ rows, two Businesses, duplicate/long labels, equal timestamps, old open work and exact off-page selection. Verify bounded server queries, independent counts, stable ordering, exact details and no hidden fetch-all. Run actual Next.js client-navigation journeys alongside retained-state fixtures: Back/Forward/reload, interrupted pending actions, stale responses, URL/action scope and exact return context. Synthetic tests must deny provider networking, credentials, uploads, model calls, spending and state mutations except their explicit in-memory test doubles.

“Accepted baseline” below records existing bounded release evidence; it does not waive regression tests when that surface changes. “Remaining” is not a claim that all underlying source is missing. Private historical read limitations stay visibly recent/partial until R06 is accepted.

## All existing rendered page routes

There are **21 total `page.tsx` routes**, not 21 unfinished pages. The workflow error boundary and query surfaces are listed separately below. API routes, callbacks and server actions are not page routes, but their owner guards, return context and no-effect navigation boundaries are part of the connected journey.

| Existing route | Current acceptance boundary | Required coverage and task |
| --- | --- | --- |
| `/` | Existing authenticated dashboard/private-login redirect | Preserve private routing and exact requested return; R03 regression |
| `/login` | Existing private entry; whole-app regression remains | Compact validation/error/return states, long messages, keyboard/mobile; R03 |
| `/auth/error` | Existing auth recovery; whole-app regression remains | Clear safe next action, contained error text, no raw secrets/internal errors; R03 |
| `/dashboard` | Accepted compact shell/Overview baseline; new root collections incomplete | Query-surface checklist, exact1280×720 regression, truthful partial reads; R02/R08 |
| `/dashboard/accounts` | PR43 Connections adapter accepted for ordinary entry | Preserve Business/request/typed outcome; no lost notice or legacy jump. `diagnostics=platform` remains a retained diagnostic conversion; R03 |
| `/dashboard/accounts/secure` | PR43 compact framing accepted; active credential submission tested only in hosted fixtures | Exact request beyond recent history, expiry/consent/store/revision, validation/pending/uncertain result and scoped return; R03/R06 regression; no fixture secrets |
| `/dashboard/accounts/registration` | Existing isolated owner handoff; compact framing remaining | Exact request/expiry, bounded view and safe close/return; no automatic browser launch or captured secure pixels; R03 |
| `/dashboard/accounts/password` | Existing isolated vault entry; compact framing remaining | Exact connection/revision/consent, visible outcomes and scoped return, no password in URL/storage/logs/fixtures; R03 |
| `/dashboard/needs-you` | Validated redirect to the accepted compact root Decisions | Preserve exact deep links/outcomes into Decisions/Needs owner, open count/history truth; R03/R06/R08 |
| `/dashboard/workflows` | Legacy index; adaptation remaining | Canonical Work/Events mapping with exact Business, filter, selection and totals; R02/R03/R08 |
| `/dashboard/workflows/[workflowRunId]` | Exact protected technical detail; compact/data conversion remaining | All tabs/stage/task/worker/artifact/receipt/browser actions reachable; exact run, typed outcomes, bounded children and selected detail; R03/R06/R08 |
| `/dashboard/artifacts` | Legacy creative approvals/receipts; exact-recovery prototype unaccepted | Old approval/run links beyond independent recent windows, honest missing context/cost, preserved receipt anchors and compact contained detail; R02/R03/R06 |
| `/dashboard/products` | Existing candidate research tools; not a finished product catalog | Preserve manual candidate/evidence functions and old links; fix sampled “latest/none” truth. Research mapping R02/R03; bounded history R06; catalog/readiness R08/R13 |
| `/dashboard/history` | Legacy sampled event/history page; adaptation remaining | Preserve exact history into raw audit/Work/Events, no window-derived “Total”; R02/R03/R06/R08 |
| `/dashboard/settings` | Existing owner/Business page; compact conversion remaining | Profile and persistent Business controls, exact outcomes, long/multiple Business fixtures; R03/R04/R08 |
| `/dashboard/packs` | Existing catalog/install/qualification UI; compact conversion remaining | Bounded catalog and Business installations, exact version/action/outcome, no packs×Businesses unbounded grid; R03/R06 |
| `/dashboard/model-router` | Independent legacy frame; conversion remaining | Consistent console, bounded models/routes/runs, loaded-versus-global cost truth; no live proof launch during QA; R03/R06 |
| `/dashboard/worker-proof` | Independent legacy frame; conversion remaining | Consistent console, exact selected run and actual receipts, distinguish truncated events from no events; R03/R06 |
| `/dashboard/worker-evaluations` | Independent legacy frame; conversion remaining | Bounded evaluations/promotions, honest subset metrics and preserved qualification gates; R03/R06 |
| `/dashboard/printful` | Existing product/configuration workspace; compact conversion remaining | Exact Business/store/intervention, blocked readiness, bounded history/cost/source detail, invalid explicit context fails closed; R03/R06; actual product readiness R11–R15 |
| `/dashboard/etsy` | Existing draft/listing/publication workspace; compact conversion remaining | Exact Business/package/draft/intervention, bounded histories, public/fee/supplier blockers and safe return; R03/R06; no provider action while activation hold applies |

## Query surfaces and recovery boundaries

| Surface | Current acceptance boundary | Required coverage and task |
| --- | --- | --- |
| `?view=overview` | Accepted compact visual baseline | Selected persistent Business/current-or-last Quest only; never pick unrelated owner-wide recent run; R04/R08 |
| Overview `centre=browser` and exact `browserRun` | Accepted saved metadata, live stream unavailable | Preserve blocker/geometry/exact safe record navigation; R03/R08. Trusted actual watching is R10 |
| `sheet=research` | Accepted native modal lifecycle correction | Retained dismissal, focus, draft/consent isolation, all originating panes and exact return; R02/R03; new prompt/envelope intake R04/R05 |
| `?view=connections` | PR43 compact provider/status/request/secure journey accepted | Long Business names, exact old request, saved-registry truth, safe typed outcomes, no query-spoofed success; R03/R06 |
| `?view=decisions` | R01 accepted through PR44/PR46 exact-head and deployed read-only evidence | Preserve compact desktop/reflow, typed acknowledgment, immutable failed-run/unknown-charge truth, exact queue/detail and native filter Back/Forward. Original three notices remain unchanged by the agent. Broad Next transport regression remains R03; audit-log/exception product model R08 |
| `?view=work`, exact `run` and `artifact` | Existing pane and exact artifact focus; populated work unaccepted | True bounded pages/count/search/sort; exact off-page artifact, preserved anchors/Back/reload, source-only vs successful output truth; R02/R06 |
| `?view=library` designs | Existing gallery; populated prototype unaccepted | Bounded page/preview payloads, exact selection, distinct image/production/print/listing status; R02/R06 |
| `?view=library&type=research` | Existing research subtype; grouping/navigation remaining | Preserve Quest/intent/attempt links and exact evidence/action return; transition to Research destination in R02/R08 |
| `?view=library&type=records`, exact `artifact` | Existing saved-record view | Long JSON/evidence contained, exact ID/Business and off-page return/focus; R02/R06 |
| `?view=activity` | Existing recent raw audit view; paged prototype unaccepted | Independent count/page/filter, exact event/workflow and unknown state; remains underlying audit data when Events is added; R02/R06/R08 |
| `?view=advanced` | Accepted compact directory; child routes not all accepted | Every retained tool reachable with stable URL/active navigation and return; no duplicate primary labels; R03/R08 |
| `/dashboard/accounts?diagnostics=platform` | Existing diagnostic tools; compact conversion remaining | Contained config/provider/history with truthful known outcomes and read limits; R03/R06 |
| Workflow `[workflowRunId]/error.tsx` | Existing recovery boundary; visual/interaction acceptance remaining | Visible scoped failure/recovery, no stale success, unsafe replay or lost selection; R03/R08 |

## New destination acceptance obligations

These are target contracts; do not label them deployed. R08 must assign each a canonical URL, active-nav label, old-link adapter, exact scoped return and mobile behavior before acceptance.

- Business and Quest selection/history: persistent owner-scoped identity, explicit current/last rule, typed prompt proposal, rules/envelope versions and exact confirmation; R04/R05/R08
- Events: actual workflow-backed episodes with ordered Steps, results and actual Agents; immutable raw audit events remain separately inspectable; R07/R08
- Research: evidence and conclusions grouped by exact Quest/attempt, provenance/uncertainty and old Products/Library subtype links; R02/R08
- Library: image and document artifacts, versions/approval/readiness, exact selection and bounded previews; R02/R08
- Knowledge: existing pack-only/unavailable state is acceptable before R09; real reviewed learning, freshness, versions and per-Business application must close in R09/R18
- Products and linked Listings: provider-neutral product/variant identity, exact packages/assets/provider mapping and separately truthful draft/fee/fulfilment/selling readiness; R08/R13–R15. UI fixtures must show missing/unqualified data until those contracts qualify
- Decisions and Needs owner: audit log plus distinct exception workflow, no routine redundant approvals inside a qualified envelope, no false retry/completion/settlement; R05/R08
- Profile/Business rules and lower Tools navigation: preserve existing settings/Packs/router/proof/evaluation functions. A Costs view requires truthful bounded receipts/currency data; no placeholder lifetime-profit claim; R03/R04/R06/R08

## Closing a checklist row

Record the frozen commit/tree, fixture/query cases, actual screenshots at both desktop sizes and mobile/zoom, accessibility/history/client-transport results, provider-action-denial result and remaining limitations. An empty render or source review alone cannot close a populated route. Read-only deployed acceptance is separate from synthetic hosted checks. Software/UI acceptance never qualifies a provider action.

Historical private account/Etsy/Printful RPCs retain fixed windows or unbounded eligibility arrays identified in [the populated audit](POPULATED_ROUTE_AUDIT.md). Complete historical paging/count/exact lookup requires R06's separate backend review. Do not widen ACLs, fetch every row or present client filtering of those windows as a completed checklist item.
