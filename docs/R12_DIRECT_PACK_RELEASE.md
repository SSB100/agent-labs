# Direct Etsy Insights release declarations

Status: engineering declarations; production registration, release qualification,
Business installation and live account/source readiness are separate pending gates.
Nothing in this file or the catalog certifies that those gates have passed.

## Immutable release graph

`directInsightsPackManifests()` in
`src/products/discovery-r12-direct-packs.ts` produces the exact JSON in
`packs/etsy-insights-direct-catalog.json`, in dependency order. All ten releases
use version `1.0.0`:

1. `knowledge.etsy-current-policy.direct-insights`
2. `knowledge.print-on-demand.direct-insights`
3. `knowledge.product-research.direct-insights`
4. `knowledge.social-marketing.direct-insights`
5. `capability.browser-etsy-insights`
6. `worker.etsy-insights-source`
7. `worker.etsy-insights-plan`
8. `worker.etsy-insights-strategy`
9. `worker.etsy-insights-review`
10. `workflow.etsy-insights-direct`

The four knowledge releases preserve the original knowledge payloads, source
URLs, caveats and `verifiedAt` timestamps exactly. New release identities are not
fresh source observations. Knowledge freshness must still be checked against the
actual original timestamps. They do not silently refresh an expired policy.

All model and workflow definitions have new identities. No existing release,
definition, qualification status, installed snapshot or historical raw row hash
is rewritten. This matters even for an old experimental dependency: promoting its
status could change the historical resolver snapshot.

The workflow key is `product.discovery-v2.direct`. Its stages are plan, source,
strategy and independent review. The source worker key is
`product.discovery-v2.etsy-insights`; model worker keys are
`product.discovery-direct.plan`, `.strategy` and `.review`.

## Fixed execution boundary

The capability and source declaration use the exact trusted kind
`browser.etsy.insights.read_only`. The new model declarations use
`r12.direct-model` and name their phase. Both require
`authority: r12.direct-controller`. These are data declarations, with no arbitrary
module, endpoint, URL, browser handle or credential field. Generic mapping,
simulation and installed-workflow model execution reject them before a provider
call. Only the separately guarded direct controller may dispatch them.

Plan and strategy pin `luna.standard`, alias `openai/gpt-5.6-luna`, canonical
`openai/gpt-5.6-luna-20260709`, endpoint `azure/us`. The direct reviewer pins
`claude.sonnet.high-power`, alias `anthropic/claude-sonnet-4.6`, canonical
`anthropic/claude-4.6-sonnet-20260217`, endpoint `amazon-bedrock/us`.
Each declaration is primary-only with one attempt. Actual dispatch also requires
the separately validated current direct inference quote. Historical global
routes and old Haiku worker definitions are unchanged.

The source phase submits one already-counted, approved visible query. Source
scope, account/shop, renderer, screenshot storage, release, observer disposal and
accounting proofs remain required. Registration supplies none of those proofs.
The manifest grants no commerce action or generic browser/source fallback.

## Supported release and owner flow

Use the existing pack framework described in `docs/PACK_FRAMEWORK.md`:

1. Validate every exact manifest with `validatePackManifest` and resolve the full
   closure. Review the separate Core/SQL support for the two trusted executor
   kinds and the exact capability adapter before registration.
2. Register each manifest through `private.stage10_register_pack` in a reviewed
   release migration. Registration creates experimental definitions and generated
   IDs. Never copy synthetic fixture IDs, qualification records or grants.
3. Run the declared evaluations on the exact release/code snapshot. Persist real
   release evidence through `private.stage10_qualify_pack`. A synthetic test can
   test that mechanism but cannot provide production CI, provider tariff,
   security or live renderer qualification.
4. Let the authenticated Business owner install the qualified root through
   `activate_business_pack`. Its immutable snapshot must contain only these new
   releases, with exact worker/workflow hashes resolved by the registry.
5. A separately reviewed enrollment package may then refer to that actual
   installation and its generated definitions. The existing Goal, funding/root,
   costs, history and cumulative counters stay pinned. Grant enrollment, combined
   test cash approval, persistent Etsy access and final research confirmation are
   distinct owner actions.

The test allowance is configuration, not a manifest limit or live approval.
The current requested ten counted cycle/repair units and USD 10 combined cap must
come from the separately approved envelope and original cumulative limits.

## Qualification evidence and limits

`tests/r12-direct-packs.test.mjs` checks exact declarations, catalog parity,
qualified dependency closure, arbitrary executor/model-route rejection,
zero-provider generic execution and unchanged historical experimental snapshots.
It also checks original knowledge provenance byte-for-byte.

The enrollment SQL fixture must additionally register and qualify these actual
manifests through Stage 10, activate the new root as its owner, and compare the
old resolver snapshot plus raw definition rows before and after. Inert fixture
evidence must stay explicitly labelled as such. Native SQL concurrency,
Chromium confinement, release CI and actual restricted no-query/account/source
readiness retain their own qualification status; a unit test is not a substitute.
