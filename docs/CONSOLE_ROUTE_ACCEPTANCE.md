# Whole application console acceptance checklist

R03 draft review: [PR52](https://github.com/SSB100/agent-labs/pull/52), [21-route completion and actual Next evidence](R03_COMPLETION_REPORT.md). This candidate does not replace the accepted PR50/PR51 release baseline or close R06/R08 historical/product obligations. Final matching-head gates are required; no deployed acceptance is claimed.

Current implementation baseline: `49be7f61d99d1d89b052e55917cf021010f5826d` (PR50 R02 read-only acceptance), 2026-10-02. Passed exact merged-tree CI and deployed live proof are recorded in the [crosswalk](AGENT_LABS_V2_EVIDENCE_CROSSWALK.md); the separate identical-tree main-push repeat remains in progress. This checklist is not a separate release plan. The sole remaining-work order is [R03–R19 in the canonical plan](AGENT_LABS_V2_IMPLEMENTATION_PLAN.md). Do not restart already accepted work.

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
| `/dashboard` | Accepted compact shell/Overview, Decisions, Work, Library and raw Activity baseline; Research read-only root baseline accepted | Query-surface checklist, exact1280×720 regression, truthful partial reads; Preserve accepted root collections; R03 transport/retained frames, canonical workspace R08 |
| `/dashboard/accounts` | PR43 Connections adapter accepted for ordinary entry | Preserve Business/request/typed outcome; no lost notice or legacy jump. `diagnostics=platform` remains a retained diagnostic conversion; R03 |
| `/dashboard/accounts/secure` | PR43 compact framing accepted; active credential submission tested only in hosted fixtures | Exact request beyond recent history, expiry/consent/store/revision, validation/pending/uncertain result and scoped return; R03/R06 regression; no fixture secrets |
| `/dashboard/accounts/registration` | Existing isolated owner handoff; compact framing remaining | Exact request/expiry, bounded view and safe close/return; no automatic browser launch or captured secure pixels; R03 |
| `/dashboard/accounts/password` | Existing isolated vault entry; compact framing remaining | Exact connection/revision/consent, visible outcomes and scoped return, no password in URL/storage/logs/fixtures; R03 |
| `/dashboard/needs-you` | Validated redirect to the accepted compact root Decisions | Preserve exact deep links/outcomes into Decisions/Needs owner, open count/history truth; R03/R06/R08 |
| `/dashboard/workflows` | Legacy index; adaptation remaining | Canonical Work/Events mapping with exact Business, filter, selection and totals; R03/R08 |
| `/dashboard/workflows/[workflowRunId]` | Exact protected technical detail; compact/data conversion remaining | All tabs/stage/task/worker/artifact/receipt/browser actions reachable; exact run, typed outcomes, bounded children and selected detail; R03/R06/R08 |
| `/dashboard/artifacts` | Legacy creative approvals/receipts; compact conversion remaining. PR49 cost correction live retested; exact creative-run recovery is accepted in Library | Preserve exact Library recovery and receipt anchors, unknown/provenance cost truth; do not infer absent work from unrelated recent windows. Remaining retained frame R03; private history R06 |
| `/dashboard/products` | Existing candidate research tools; not a finished product catalog. Safe results-to-Research adapter passed exact-tree and live checks | Preserve the accepted read-only alias; preserve candidate/action/outcome handlers and old links. Compact retained tools R03; sampled “latest/none” and bounded history R06; catalog/readiness R08/R13 |
| `/dashboard/history` | Legacy sampled event/history page; adaptation remaining | Preserve exact history into raw audit/Work/Events, no window-derived “Total”; R03/R06/R08 |
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
| `sheet=research` | Accepted native modal lifecycle correction | Retained dismissal, focus, draft/consent isolation, all originating panes and exact return; prior shared-modal live plus current hosted proof, no new PR50 live sheet test or price request. R03 regression; new prompt/envelope intake R04/R05 |
| `?view=connections` | PR43 compact provider/status/request/secure journey accepted | Long Business names, exact old request, saved-registry truth, safe typed outcomes, no query-spoofed success; R03/R06 |
| `?view=decisions` | R01 accepted through PR44/PR46 exact-head and deployed read-only evidence | Preserve compact desktop/reflow, typed acknowledgment, immutable failed-run/unknown-charge truth, exact queue/detail and native filter Back/Forward. Agents did not change the original notices; a later count alone cannot establish cause. Broad Next transport regression remains R03; audit-log/exception product model R08 |
| `?view=work`, exact `run`/`selected` and `artifact` | PR47 bounded collection/detail accepted, including exact deployed read-only checks | Preserve 25-row pages/counts, field-specific search, off-page artifact, stopped/unknown-charge truth, compact rows and native filter/reading history; 100-row child windows stay explicitly incomplete; R03 regression/R06 |
| `?view=library` designs, exact `selected` or `creativeRun` | PR48 bounded Designs/exact creative history accepted after PR49 provenance fix; live one-design preview/recovery checked | Preserve 25-row pages, at most 26 private preview paths, exact selection/history, separate readiness and known/unknown/unverified costs. Six-width/two-Business hosted coverage; real Next regression R03, directory/private limits R06, general versions/readiness R08 |
| `?view=library&type=research` | Former subtype; accepted exact-tree/live alias to canonical Research roots under owner guard | Qualify exact Business/`experiment`→`selected` canonicalization, page/search/root/attempt state and safe research-sheet return. Never infer an ID from an aggregate fragment; R03 regression. Canonical Quest grouping R04/R08 |
| `?view=library&type=records`, exact `artifact` | PR48 bounded saved Records accepted; live 141 records, 25/page and off-page selection/history checked | Preserve long contained JSON/evidence, exact ID/Business/content, keyboard focus, independent selected lookup and compatible return/reading position. Actual Next regression R03; owner-directory/private read limits R06 |
| `?view=research&type=roots` or `type=records`, exact `selected`/`experiment`/`root` and independent `attemptPage` | PR50 exact merged-tree/source/hosted/pixel and deployed read-only acceptance passed; identical-tree main-push repeat still in progress | [Research contract](CONSOLE_RESEARCH_CONTRACT.md): 25-row raw predicate pages/counts, stable timestamp/ID sort, explicit objective/hypothesis search, off-page exact metadata, direct-link scope, no older-newest substitution, separately bounded evidence/loading, failed-state/freshness/TEST uncertainty and read-only browse. Preserve live one-root/nine-attempt/ten-row exact scope and failed/unavailable truth; larger pages/mobile/two Businesses/successful TEST are hosted only. Actual Next/retained regression R03; canonical Quest R04/R08; owner-directory/private/index/wire limits R06 |
| `?view=activity` | PR47 independently paged raw audit accepted; live 104-event pagination/filter/history checked | Preserve exact event/run-filter selection and independently counted pages; remains underlying audit data when Events is added; R03 regression/R06/R08 |
| `?view=advanced` | Accepted compact directory; child routes not all accepted | Every retained tool reachable with stable URL/active navigation and return; no duplicate primary labels; R03/R08 |
| `/dashboard/accounts?diagnostics=platform` | Existing diagnostic tools; compact conversion remaining | Contained config/provider/history with truthful known outcomes and read limits; R03/R06 |
| Workflow `[workflowRunId]/error.tsx` | Existing recovery boundary; visual/interaction acceptance remaining | Visible scoped failure/recovery, no stale success, unsafe replay or lost selection; R03/R08 |

## New destination acceptance obligations

The canonical Quest, Events, Knowledge and product obligations below are target contracts; do not label them deployed. Accepted Library and Research read projections have the narrower boundaries above. R08 must complete canonical identity/grouping, old-link adapters, exact scoped return and mobile behavior for its new product contracts before acceptance.

- Business and Quest selection/history: persistent owner-scoped identity, explicit current/last rule, typed prompt proposal, rules/envelope versions and exact confirmation; R04/R05/R08
- Events: actual workflow-backed episodes with ordered Steps, results and actual Agents; immutable raw audit events remain separately inspectable; R07/R08
- Research: preserve the accepted bounded raw saved-record destination, progressive evidence and safe aliases; exact canonical Quest/attempt grouping, provenance/uncertainty and saved decisions remain R04/R08
- Library: preserve the accepted bounded Designs/Records/exact creative-run destination and PR49 charge-provenance truth; generalized artifact versions/approval/readiness remain R08
- Knowledge: existing pack-only/unavailable state is acceptable before R09; real reviewed learning, freshness, versions and per-Business application must close in R09/R18
- Products and linked Listings: provider-neutral product/variant identity, exact packages/assets/provider mapping and separately truthful draft/fee/fulfilment/selling readiness; R08/R13–R15. UI fixtures must show missing/unqualified data until those contracts qualify
- Decisions and Needs owner: audit log plus distinct exception workflow, no routine redundant approvals inside a qualified envelope, no false retry/completion/settlement; R05/R08
- Profile/Business rules and lower Tools navigation: preserve existing settings/Packs/router/proof/evaluation functions. A Costs view requires truthful bounded receipts/currency data; no placeholder lifetime-profit claim; R03/R04/R06/R08

## Closing a checklist row

Record the frozen commit/tree, fixture/query cases, actual screenshots at both desktop sizes and mobile/zoom, accessibility/history/client-transport results, provider-action-denial result and remaining limitations. An empty render or source review alone cannot close a populated route. Read-only deployed acceptance is separate from synthetic hosted checks. Software/UI acceptance never qualifies a provider action.

Historical private account/Etsy/Printful RPCs retain fixed windows or unbounded eligibility arrays identified in [the populated audit](POPULATED_ROUTE_AUDIT.md). Complete historical paging/count/exact lookup requires R06's separate backend review. Do not widen ACLs, fetch every row or present client filtering of those windows as a completed checklist item.

## R08 owner workspace delta

See [R08 owner workspace contract](R08_OWNER_WORKSPACE_CONTRACT.md). The actual page inventory is now 23 (the R04 Quest and operating-control pages extend the historical R03 count); R08 adds no duplicate page routes. New root query destinations are `view=products-catalog` (Products and `type=listings`), `view=knowledge` (existing packs only), and `view=decision-log` (searchable automated/human audit). `view=work` is canonically labelled Events; `view=decisions` remains the exact actionable/historical Needs owner queue; `view=activity` remains underlying audit events.

R08 acceptance requires the populated same-Business/Quest journey through all these surfaces, exact off-page Step/Agent/artifact and package/draft selection, empty/current Quest truth, wrong-scope rejection, status/receipt preservation, both desktop sizes, 320/390px and actual 200% zoom. Existing retained-route and action/recovery tests remain required. Focused development evidence is not final release acceptance; record the final source/tree and complete CI before deployment.


## R11 additive destination

`/dashboard/connections?business=<exact-id>` is the new owner-scoped read-only connection qualification workspace. This extends the original 21-page inventory. It reuses the compact shell/contained workspace and exact Business navigation, and exposes no raw secret. Acceptance requires populated/empty/unavailable states, two Businesses, token-expired/revoked/credential-changed states, read-only grant disclosures, local-disconnect action and repeated/navigation/reload behavior at the universal widths. Hosted exact-head evidence is recorded separately; this row does not claim live provider qualification.
