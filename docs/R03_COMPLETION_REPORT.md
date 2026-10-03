# R03 draft completion report

Draft PR: [SSB100/agent-labs#52](https://github.com/SSB100/agent-labs/pull/52). R03 only. This is a review candidate, not a release or deployed acceptance. R04 has not started. Both final matching-head CI jobs (`quality` and `r03-next`) must pass before the candidate is called review-ready; the PR checks and their preserved reports are authoritative.

## Starting point and scope

Before editing, remote main, PR50, PR51, open work and the working tree were inspected once. The clean branch `ui/r03-retained-console` started from current main `de35f8fb2d3e79cf165e60fe856490a186910487` (tree `7720a38f721bba92c0e3400ce764bf3838c1283c`), incorporating the accepted PR51 documentation closeout. PR50 application `49be7f61d99d1d89b052e55917cf021010f5826d` remains the accepted release baseline. No unpublished harness was presumed available; the separately documented isolation preparation was created and reviewed on this branch.

Changed scope: retained page frames and navigation; console retained workspace/continuity/paging; scoped product/creative/Pack action feedback; bounded exact workflow/proof reads; existing creative approval linkage and ended-work predicate; supplemental regression fixtures; disposable real-Next harness and CI evidence uploads; route/plan/evidence documentation. No migrations, permission changes, credential configuration, autonomous controller or Quest/domain changes. The branch explicitly disables its Vercel git deployment.

## Route-by-route R03 acceptance

All rows below are covered by the final isolated hosted gates. Their R03 compact-frame/navigation acceptance is distinct from production/provider acceptance. Backend historical completeness remains partial where stated.

| Existing page route | R03 status | Qualified scope / retained limitation |
| --- | --- | --- |
| `/` | Preserved; draft review | Real signed-out redirect; private records absent |
| `/login` | Converted / regressed; draft review | Compact private entry, safe error copy, keyboard/reflow |
| `/auth/error` | Converted; draft review | Safe recovery and generic error text; desktop containment |
| `/dashboard` | Preserved / regressed; draft review | Overview, Work, Library, Research, Decisions, Connections, Activity and Advanced; real RSC and modal history |
| `/dashboard/accounts` | Adapted / converted; draft review | Ordinary entry returns to Connections; platform diagnostics and operational tabs remain distinct |
| `/dashboard/accounts/secure` | Preserved / regressed; draft review | Unavailable/expired exact request; same-Business/request return; no credential input or submission in real Next QA |
| `/dashboard/accounts/registration` | Converted; draft review | Isolated expired/unavailable owner handoff; exact request return; existing release guard retained |
| `/dashboard/accounts/password` | Converted; draft review | Isolated unavailable vault entry; validated same-Business/provider return; no secret continuity |
| `/dashboard/needs-you` | Preserved / regressed; draft review | Canonical Decisions alias with scoped saved context |
| `/dashboard/workflows` | Adapted; draft review | Real redirect to bounded Work, preserving supported filters and exact selection |
| `/dashboard/workflows/[workflowRunId]` | Converted; draft review | Eight real-Link sections, bounded children, independent exact old stage/task/worker/artifact, scoped failure/reload |
| `/dashboard/artifacts` | Converted; draft review | Approvals/receipts, production and technical review, gallery and scope; exact linked run per approval; cost provenance retained |
| `/dashboard/products` | Converted; draft review | Accepted Research alias retained; research/recovery/candidates/manual entry/capabilities; exact candidate action outcome and draft recovery |
| `/dashboard/history` | Adapted; draft review | Ended workflow outcomes (including failed/stopped and ended unknown states), separate from raw Activity |
| `/dashboard/settings` | Converted; draft review | Owner profile and Business directory; explicit unavailable reads; persistent operating-rule editing remains R04 |
| `/dashboard/packs` | Converted; draft review | Bounded catalog and one verified Business installation window; invalid JSON action feedback preserves scope/draft |
| `/dashboard/model-router` | Converted; draft review | Paged loaded models/routes/proofs; independent old exact proof; reported/estimated/unknown costs separate; launch gates retained |
| `/dashboard/worker-proof` | Converted; draft review | Paged loaded proofs, exact old run, explicit event window; existing launch guards retained |
| `/dashboard/worker-evaluations` | Converted; draft review | Loaded evaluations/suite/promotions, compact expandable results and subset metrics; global suite ownership contract unchanged |
| `/dashboard/printful` | Converted; draft review | Configuration/calculator/synthetic catalog/connection/qualification; explicit invalid Business rejected; readiness remains blocked |
| `/dashboard/etsy` | Converted; draft review | Listing preparation/drafts/publication; exact Business context and failed/uncertain receipts; activation gates remain separate |

Additional boundaries: the workflow Suspense loading frame and actual server error boundary have distinct captures and recovery checks. All 34 retained nondefault sections are exercised through real Next Links and native Back. Browser panels remain saved metadata only; live streaming is unavailable and unqualified.

## Actual Next qualification

The runner builds and starts a disposable production Next application. Four reviewed substitutions replace Supabase transport/auth/realtime plumbing; production pages, owner readers, Link/router, layouts, RSC/Suspense, server actions, redirects and cache revalidation execute unchanged. See [isolation preparation](../tests/next-fixture/README.md). Component-only fixtures supplement this proof and do not replace it.

Real journeys cover History's 307 ended-work redirect; delayed streamed fallback/content; Link RSC responses; delayed exact record A→B with a late response and native Back/Forward; aborted RSC then a new destination; unsaved nonsecret edits through tabs/Back/reload and Business isolation; exact candidate success/reuse with duplicate submissions and refresh after revalidation; uncertain action preserving draft while consent resets; synthetic terminal acknowledgment duplicate/conflict/uncertain outcomes; modal close interrupted by newer native navigation; Pack JSON validation without runtime reservation; independent old model/worker proofs; independent old workflow child payloads and different-parent rejection; secure return links; actual server failure and same-exact-record reload; invalid explicit Business 404; empty/unavailable reads.

Only in-memory candidate save and synthetic terminal acknowledgment mutate inert fixture data. The real-Next gate verifies exactly these allowed effects and no route-read effects. Unknown RPCs/writes fail closed. Sanitized fixture environments contain inert loopback identifiers, no production credentials. Node and browser external networking is blocked. No production database/notices are read or changed, and no provider/model, credential submission, account signup, paid operation, publishing or fulfilment is exercised.

Fixtures include two owned Businesses with duplicate long names, 127 collection/research/library records per Business, 133 children on an old exact workflow, proof records beyond the loaded window, failures, uncertain receipts, empty and unavailable states. Secure real-Next coverage intentionally uses expired/unavailable IDs. Existing supplemental secure-form guard fixtures are regression-tested separately; active private/provider operation qualification is not claimed.

## Viewport, pixels and accessibility

Actual hosted Chromium captures cover all retained route targets and accepted root views at 1280×720 and 1440×900, 390×844 and 320×800, plus 640×360 reflow equivalents. Desktop checks require one document viewport and no horizontal overflow; long contents remain reachable in labelled scroll areas and exact disclosure viewers. Mobile scrolling is permitted with readable text and primary 44px controls. Nondefault sections are captured at 1280×720 and 390×844.

A fresh disposable Chromium profile and local extension with only `tabs` permission applies real `chrome.tabs.setZoom(2)`. The gate verifies actual zoom and the resulting CSS viewport for retained/root/auth routes, separately from reflow-equivalent captures. Keyboard navigation and visible focus are tested; browser contexts use reduced motion. Secret pixels are masked, with no active credentials supplied.

Actual pixel inspection prompted corrections to oversized proof metrics/panels, clipped configured badges, awkward mobile tool navigation, premature loading-state screenshots, auth-recovery overflow, narrowly wrapping Business actions and a blank Pack qualification section. Final screenshots and the exact capture/check manifest are downloadable from the final `r03-next` job. The completion attachment binds PNG hashes and test evidence to the final commit; earlier failed snapshots are diagnostic only.

## Verification and diagnostic ledger

Local Node24 preliminary full tests: 2,037 tests, 1,977 passed, zero failed/cancelled, 60 skipped (local Chromium unavailable plus optional SQL-host coverage). These skips do not count as browser acceptance. Local lint/types and optimized normal production build pass; hosted Node22 matching-head `npm run check` is the required final full-suite/build gate. Hosted browser fixtures must execute there. The separate `r03-next` job builds/runs production Next and saves acceptance, isolation, boundary, RSC and pixel evidence even on failure. Read final exact counts, skips and checkout identity in the matching-head job logs; do not reuse an older count as final proof.

Preserved failed diagnostics:

- Earlier CI preparation failed on an existing npm-ci lock mismatch (missing transitive chokidar/readdirp); the harness uses the repository's existing npm-install path. Missing fixture worker definitions, a source JSX error and screenshot-mask argument mismatch were corrected before browser qualification. Those runs did not pass.
- [Run 397](https://github.com/SSB100/agent-labs/actions/runs/37078860439) exposed action form-reset draft loss, a synthetic acknowledgment fixture pointing at an intentionally incomplete run, same-record error recovery and auth-error overflow. Tests/implementation were repaired without weakening the eligibility or action guards.
- [Run 398](https://github.com/SSB100/agent-labs/actions/runs/37080292746), application `02cce78907cb51e3c7bc2ecdb1fb1047b27630a6`, passed all 13 functional journeys, default geometry, 27 nonworkflow sections and actual protected-route 200% zoom. Seven workflow section checks read before streamed content committed; Profile lacked a global unavailable-directory message. Both were corrected. Its quality job passed 50 Research-first and 188 older-preview tests, then failed lint on an unused catch binding; full tests/build were not reached in that job. It is not a passed final gate.
- The combined Next artifact exceeded the 32MiB transfer limit. Separate desktop/mobile/reflow/diagnostic artifacts preserve inspectable evidence; failure to download the oversized archive is not a failed application assertion.

## Remaining gates and stopping point

R03 compact frames and actual Next transport are submitted for review. R06 still owns private history/index/owner-directory guarantees and complete backend paging/counts. Loaded windows remain explicit: product 100 candidates/100 experiments/300 decisions; creative 50 approvals/100 assets; Pack catalog/install 100 each; router 100 models/100 routes/30 runs; worker 30 runs/120 events per proof; evaluations 20 runs/10 promotions; workflow children 100 each; private operational histories retain their saved fixed windows. Client paging is paging of loaded rows, not a complete historical view. Exact independent reads added here do not widen permissions or remove those backend limits.

R04 persistent Business rules/Quest identity, R08 canonical product/workspace contracts, and all separate activation/qualification gates remain open. Etsy Personal Access is owner-reported; secure configuration, OAuth, authorized automation purpose and individual operations are separate unqualified gates. Known reported charges, reservations, unverified amounts and unknown liabilities remain separate.

Stop at the tested draft PR. No force push, merge, deployment or R04 work is authorized by this report. Production read-only release acceptance must be performed separately after review.
