# Bounded Research read contract

This is the remaining Research continuation of R02 in the [canonical implementation plan](AGENT_LABS_V2_IMPLEMENTATION_PLAN.md). Accepted main is `62324cbf2e4c33e9206fff53c40a9280ae455c2e` (PR49). The Research implementation described here is candidate source: it is not released or hosted-qualified, and R02 remains open. Historical accepted Library/Work/Activity evidence is in the [crosswalk](AGENT_LABS_V2_EVIDENCE_CROSSWALK.md); route obligations are in the [acceptance checklist](CONSOLE_ROUTE_ACCEPTANCE.md).

## Scope and evidence levels

- Research is a read-only destination over existing owner-authorized public-table projections, not a new execution API or persistent Quest contract. It adds no schema, migration, grant, RLS change, provider activation or credential access.
- Original `pod-discovery-2.0` discovery is a finite domain-specific workflow for original POD T-shirts, Etsy/Printful and bounded geographic comparison. Existing intake defaults to US/GB/AU/NZ and the declared source domains. A new destination label does not turn that workflow into general research, a general planner or an unrestricted Quest controller; see [ADR001](decisions/ADR_001_BOUNDED_DISCOVERY_V2.md).
- Raw saved-record metadata, direct historical binding, validated saved content, current authority/provider truth and product/commercial qualification are separate claims. Source presence and a local fixture result cannot establish deployment acceptance or a live provider result.
- A saved TEST is a historical research recommendation for a proposed bounded learning experiment. It does not qualify a product, settle charges, establish available money, renew an allowance or authorize generation, launch, publication or commerce.

## Canonical query and bounded metadata pages

The candidate root destination is `/dashboard?view=research`, defaulting to `type=roots`; `type=records` exposes All records. Both are raw persisted collections from `product_experiments` within the supplied authorized Business scope.

- **Starting rounds:** `discovery_version=pod-discovery-2.0`, null candidate and parent discovery IDs, and null saved `ownerKickoff.followUpBasis.rootId`. This is an original-looking raw predicate, not a certified original/Quest count; missing or malformed authority/hash context stays inspectable and unverified.
- **All records:** no certified-group or discovery-version predicate. Legacy, candidate, follow-up, orphan and unverified records remain individually inspectable. An unsupported historical content contract stays unavailable rather than being upgraded to a v2 result.
- Each server page reads at most 26 metadata rows: 25 visible rows plus one sentinel. Filtering precedes stable `created_at` then UUID ordering, with newest/oldest direction and saved timestamp precision preserved. Main `page` and selected-root `attemptPage` are independent cursors.
- Search is explicitly one of saved `objective` or `hypothesis`, not full evidence/content search. Nonempty search requires `searchField`; search is trimmed, at most 120 characters and rejects `*` and control characters. Page size is fixed at 25. No current/latest-state filter, global verified-group sort or client-side pager over a newest-N sample is promised.
- List projections omit full variables, intent/basis objects, evidence packs, measurement plans, workflow input/state/snapshots, artifact content/metadata, quotes, receipts and costs. Display bounds do not imply a pre-transfer byte cap on returned leaf text.
- Exact counts describe the raw persisted predicate within the supplied authorized Business IDs. Count failure, response caps, malformed/foreign/duplicate rows, inconsistent cardinality or failed reads make the page incomplete/unavailable and the total unknown. An empty read failure is never a successful empty result.
- Exact `selected` (with retained `experiment` alias) and optional `root` are independent of list filters/pages. Exact reads use identity, Business scope, exact count and a two-row duplicate sentinel. Missing, foreign, conflicting or malformed identities fail closed; no replacement record or first Business is selected.
- Unsupported query keys, ambiguous duplicates, conflicting aliases, invalid UUIDs, sort/field/page values and unrelated action notices are rejected before record, catalogue or quote reads. A supplied explicit Business must be in the owner context; directory completeness remains a separate R06 gap.

Implementation: `src/lib/core-ui/console-research-query.ts`, `console-research-data.ts` and the shared `console-collections.ts` read guards.

## Exact historical metadata and associated attempts

Exact selection can inspect a returned saved intent (20,000-byte inspection bound), follow-up basis (2,000-byte bound), the exact workflow's input intent-ID leaf and its existing RLS-visible definition. These are post-download inspection bounds.

- `historicalBinding=verified` checks the stored intent identity/Business/version/objective, canonical stored policy hash, bounded limit shape, direct pointer shape and a registered `product.discovery-v2.one`, `.two` or `.analysis` workflow at version `1.0.0`. The expected lane follows the saved collection limit. It is not a validation of the full original runtime, present expiry/prices/permission or source/provider truth.
- `originalBinding` additionally requires a self-authority starting round and no follow-up basis. Direct authority/predecessor checks compare exact same-Business binding, authority ID, semantic goal hash and saved maximum. Transitive lineage always remains unverified.
- The reader does not traverse ancestors, detect every cycle/orphan, reconstruct missing rounds or infer a canonical Core Goal/Quest. A malformed stored marker is not silently repaired or rewritten. R04/R08 supply canonical identity; R06 must separately review broader historical read contracts.
- A qualified original allows a separate raw associated-attempt page: same Business, v2 top-level records carrying that original's saved authority ID, including the original. It is 25 rows plus one sentinel with its own count/order/cursor, independent of the main search/page. Association does not certify a complete group or ancestry.
- The newest-associated query independently reads at most two raw rows and its count. Only the newest raw row receives exact context checking. Missing/unavailable/mismatched newest context stays explicit; an older row is never substituted. Disagreeing independent counts make completeness unavailable. Concurrent reads are not an atomic database snapshot.
- Work navigation from historical metadata requires the exact registered binding. Inaccessible/retired definitions, failed related reads or contradictory page/selected metadata remove the qualified link or selection instead of exposing broader definition access.

## Progressive exact saved evidence

Metadata browsing and historical content are separate read paths. Only a validated exact selected/root record schedules the server-rendered evidence leaf under Suspense. The loading state identifies the exact record and Business and establishes no recommendation or completion. A resolved ready marker is scoped to owner, canonical return URL, record and Business; it signals rendering readiness, not evidence validity.

`src/lib/core-ui/console-research-evidence.ts` resolves exact saved entities and feeds the pure `src/products/discovery-v2-history.ts` verifier:

- Exact persisted experiment/workflow/definition, producer-derived dossier/strategy/review IDs, Business/run/stage/type bindings, saved policy/content/output hashes and completed stage/output agreement are checked before dependent content is used.
- Dossier preflight admits only its bounded evidence references. At most six evidence outputs are inspected for normal discovery, four for analysis. Analysis may inspect one direct pinned source and that source's exact plan origin; it does not walk analysis or authority ancestry.
- Referenced research outputs must match admitted fixed workflow/stage lanes, persisted output/source/input/query IDs, source domains/questions, source content hashes, retained excerpts/spans and saved source/worker request metadata. Strategy/review checks preserve their recorded independent-model identity and non-commerce declarations. These checks validate retained records; they do not contact a provider or prove those external facts remain true.
- Each public read is an exact ID or stage tuple with exact count and a two-row duplicate sentinel. There is an enforced 100-read ceiling per invocation; the documented normal/analysis worst-case budgets are 89/74. Per-invocation caches avoid reloading a different copy of the same full entity. Independent source/phase branches run concurrently only after preflight, and started sibling reads are drained before returning failure.
- Returned plan content is inspected at 20,000 bytes; other artifact content/metadata and stage output at 65,536 bytes, with depth/node guards. These reject unsafe oversized rendering after download; they are not wire-byte or indexed-query guarantees.
- Missing, malformed, mismatched, partial and unavailable integrity are distinct from freshness (`within_saved_window`, stale or unknown). Observation time labels preserved windows without renewing them. Valid saved sections can remain inspectable while whole-result completion is unavailable. A retained review output cannot overwrite a saved failed job.
- Metadata-only Work/Library artifact links qualify exact navigation, not content, current providers or review completion. Saved phase receipt identity/hash metadata may be checked inside the artifact contract; authoritative cost ledgers, settlement, balances and authority-wide budget totals are not read or inferred.
- Saved text/excerpts are rendered as plain text, never executable HTML. Source links use the validated saved URL contract. Opening a source is an explicit user navigation; rendering the saved evidence does not fetch that source.

This reader performs no quote, catalogue, provider/model/browser call, runtime RPC, write, upload, file signing, hidden fetch-all or automatic retry. Multiple exact dependency waves remain necessary, and live latency has not been qualified. A bounded query count alone cannot establish a fast live page.

## Navigation, scope and explicit research setup

- Former `/dashboard?view=library&type=research` links canonicalize under the owner guard to Research roots. Retained `experiment` becomes `selected`, with exact compatible Business/page/search/root/attempt state retained and validated. The actual redirect changes the address; it does not invoke old Library/Products loaders first.
- Only safe read-only `/dashboard/products?view=results` queries use the adapter. Candidate/create/action/feedback routes stay with the original Products handler. Workflow/artifact IDs and arbitrary fragments are never reinterpreted as experiment IDs. The old aggregate `#discovery-goal-results` section is not a record identity and is not turned into a selected record.
- Exact detail can scope onward Work/Library/Connections navigation and the command bar to its verified Business while leaving an aggregate collection aggregate. Selecting a record must not silently narrow the list to that Business. Missing/unavailable selection cannot supply a guessed command Business.
- Native GET filters, main/attempt paging, sort, exact selection, disclosures and compatible contained reading positions retain canonical Back/Forward/reload context. A newer record or route must not receive an older evidence-ready signal or stale reading position.
- Ordinary browse makes no research catalogue or quote request and starts no paid/external provider work. Existing owner/session and shared-shell account/notice reads remain their existing read-only contracts; no broader backend access is added here.
- Only an explicit `sheet=research` opens the existing bounded research review flow and its catalogue/quote reads. Exact selected Business scope, aggregate return URL, independent cursors and saved draft/consent isolation must survive Close/Escape/history. Opening or closing the sheet does not itself authorize or start work. Decisions `decision` and Connections `connectionRun` keep their separate action/outcome contracts.

Implementation: `console-research-alias.ts`, `ConsoleResearchDashboard`, `ConsoleResearchPane`, `ConsoleResearchEvidenceReady`, the existing command/sheet/viewport components and owner-guarded root/Products adapters.

## Required qualification and remaining boundaries

The candidate includes source-reader, pure-history, actual-root integration and hosted-browser fixture tests. The current candidate source aggregate passed lint/types/pretest and 1,961 tests with zero failures and 60 explicit hosted/optional skips. This is local source evidence; hosted build/pixels and final exact-head qualification remain pending. Fixtures use inert owner transports and deny provider/network/action/credential/mutation effects; hosted images are synthetic, not live qualification.

Before R02 acceptance, freeze an exact commit/tree, run applicable lint/types/aggregate tests/build, independently review source and final pixel artifacts, and qualify populated two-Business cases, 125+ raw records, 130 associated attempts, duplicate/long labels, equal timestamps, old/off-filter selection, invalid/missing/capped/failed reads and newest-context failures. Check both desktop sizes, narrow single-column layouts, 320/390px, 200% zoom, keyboard/End/disclosures, loading and resolved evidence, stale/failed TEST truth, aliases, modal/draft isolation and retained history with no effects. Release authorization, exact deployment identity and read-only live acceptance are separate pending gates.

- **R03:** actual Next RSC/client navigation, route-cache and server-action interruption/transport acceptance. Retained React/native-history fixtures cannot substitute for that gate, even when they exercise production components.
- **R04/R08:** canonical persistent Quest identity, complete Quest/attempt product grouping, Events and general reusable research presentation. No candidate raw count is a Quest total.
- **R05/R11/R12:** operation/source-purpose admission, current authority, external/provider qualification and fresh relevant research/worker results. Historical evidence inspection grants none of these.
- **R06:** independently paged/counted owner Business directory and exact-owner selection beyond its existing API cap; private history paging/count/exact projections; efficient indexed access; pre-transfer wire/payload limits and separately reviewed completeness guarantees. Counts here are exact only within the supplied authorized Business scope. Row/query caps do not resolve those gaps or concurrent-read consistency.

Accepted PR48 Library navigation, live 141-record paging/preview and PR49 cost-provenance correction remain regression baselines. They do not close Research, whole-app transport, private history or a live product/provider capability. The immutable original plan and historical receipts remain unchanged.
