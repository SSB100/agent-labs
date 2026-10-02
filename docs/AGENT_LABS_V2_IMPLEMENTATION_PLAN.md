# Agent Labs V2 remaining implementation plan

Repository: `SSB100/agent-labs`
Planning baseline: `82dc64dc77a4da91a7a83c6230e0867cea72f885`
Document status: reviewed remaining-work plan; authoritative on merge to main
Document scope: remaining work only; one dependency-ordered implementation queue

After merge to main, use this queue for every remaining UI, backend, qualification and product task. Use the [route acceptance checklist](CONSOLE_ROUTE_ACCEPTANCE.md) to verify coverage, not to choose a separate release order. Consult the [reuse and evidence crosswalk](AGENT_LABS_V2_EVIDENCE_CROSSWALK.md) for existing implementation, historical proofs, limits and the byte-preserved original plan. Keep historical checkpoints as evidence, not competing instructions to restart completed stages.

This document specifies the intended product and future engineering work. It grants no live operational authority, changes no existing approval, enables no provider and authorizes no schema, access, legal or financial action. Present each new persistence, security and external-activation boundary for its own review before implementation or activation.

## Requirements for every remaining task

- Build on the existing Core, finite workflows and versioned packs. Extend the minimum missing contract; do not rebuild the platform or introduce an unrestricted agent conversation loop.
- Keep each Business persistently isolated: rules, Goals, accounts, plans, outputs, products, experiments, cost exposure and history must resolve through exact owned identifiers. Reject invalid explicit context instead of selecting the first available Business.
- Use one owner-facing concept, **Quest**, over the Core Goal domain. Treat an objective as intent until an explicit initial operating envelope is confirmed. Do not infer permission from a prompt, account connection, review verdict, installed pack or UI label.
- Design the confirmed envelope to allow routine internal review, qualified launch, operation, measurement and bounded pivots without repeated routine owner approvals. Reserve Needs owner for exceptions, changed scope, missing authority, platform requirements and material risk. Decisions must remain an audit log of human and automated decisions, including their reasons and evidence.
- Classify missing implementation or unsupported capability as technical **Blocked**, with an engineering remediation path, not a repetitive owner approval request. Use Needs owner only for actionable authority, missing owner facts or provider-required exceptions. Human consent cannot supply missing placement/variant/fee proof or override uncertain charges; internal repair/reconciliation must remain bounded and auditable.
- Keep new persistent access, account setup that requires owner action, legal agreements, KYC/tax/payout/banking matters, materially new financial commitment categories and out-of-envelope actions at their appropriate human boundaries. A design goal of autonomy cannot override platform requirements or capability qualification.
- Reuse still-valid exact-version live qualification and immutable receipts. Revalidate only changed, expired or missing gates; a new plan task is not a reason to repeat a paid proof that already satisfies its contract.
- Keep source artifacts, receipts, decisions, experiment lineage and historical version pins immutable. Never delete old data to simplify migration or make an incomplete run appear successful.
- Distinguish software release, schema installation, configuration, operation authorization, live capability qualification and commercial outcome. A successful test, connected account or existing source file cannot stand in for the next evidence level.
- Apply the universal viewport, identity, bounded-query, accessibility, interruption and release gates below to each affected task. Never call the whole application complete from a subset of routes or an empty-state screenshot.

## The active queue

Tasks R01–R19 are the proposed sole active order on acceptance. Dependencies are acceptance gates, not permission to execute. A blocked external qualification must not cause unrelated safe UI or contract review to stop; retain its position and dependency explicitly. Backend and activation work must not be folded into an otherwise UI-only release.

### R01 Finish and accept PR44 Decisions

**Class:** immediate UI and existing read projections. **Dependency:** none. **Scope:** the current unmerged Decisions change, before broader console work.

- Reconcile the latest PR44 source with baseline and freeze one reviewable head. Close the outstanding exact-head release gates, including mobile/zoom selected-heading focus visibility and occlusion. Keep current and superseded source/test snapshots in the [evidence crosswalk](AGENT_LABS_V2_EVIDENCE_CROSSWALK.md), not a second task list.
- Preserve the corrected desktop Business controls and visible failure reason/actual-pending-unknown cost summary while closing remaining focus and retained-navigation failures. Recheck contained detail navigation, keyboard End reachability and unresolved-action transitions at the final head; important status must remain visible without hiding exact details.
- Preserve an independently counted/paged open queue, exact selected record, old open notices outside recent windows, terminal versus active truth, typed outcomes and immutable reviewed history. Acknowledgment must not imply retry, success, settlement or a changed operation approval.
- Treat migration `20261002095637` as already approved/applied for this narrowly defined acknowledgment contract. Check compatibility and deployed signature; do not reapply it or bundle a wider historical RPC change. Preserve the three existing notices; only their deliberate owner actions may change acknowledgment state.
- Re-run full hosted checks on the final head and merged tree when release is separately authorized. Obtain actual screenshots at both desktop sizes and readable mobile/zoom states, plus keyboard, Back/Forward/reload, repeated action and uncertain-response tests.
- Add or explicitly carry forward actual Next.js client-navigation coverage. A custom retained-state fixture that models inspected Next semantics does not establish real Next transport, route cache or server-action refresh behavior.

**Exit:** all corrected visual and interaction failures pass on the frozen source, independent review closes blocking findings, and any authorized release receives exact-commit deployment/read-only acceptance evidence. Until then R01 remains the first open task; do not maintain a separate Decisions queue.

### R02 Finish the remaining root collections and immediate read projections

**Class:** immediate UI and read-only changes using existing authorized public-table contracts. **Dependency:** R01.

- Reconcile held Work, Library, Research, Activity and exact creative-recovery source against the accepted head. Do not bulk-merge the frozen populated or profile candidates or treat their tests as acceptance.
- Complete bounded server page/count/filter/search/sort/exact-detail reads for Work, design and document Library, research results, saved records and raw activity. Define stable timestamp-plus-ID ordering, field-specific search and count semantics. Return a selected record independently of the current page/filter while preserving the filter context.
- Keep public-table read improvements separate from private RPC additions. No client-side pager over a newest-N window, hidden fetch-all loop or unbounded artifact preload may be presented as complete history.
- Recover exact old creative approval/run/artifact links with server-visible identity, preserve receipt anchors, and show unknown state/cost when an independently loaded window cannot establish absence. Do not enable a duplicate start because a related run was not loaded.
- Preserve real Business scope, URL query state, return destinations, exact artifact positioning and truthful settled/pending/unknown cost labels. Reject missing, foreign, conflicting and malformed selection rather than showing a substitute record.
- Complete the new root Research navigation/read projection using existing research lineage. Keep former Library research and Products research deep links working. Label legacy research identity accurately until R04/R08 supply canonical Quest linkage.
- Keep root Activity as the exact underlying audit view until R08 supplies work-episode Events. Do not rename raw rows and imply that they already represent coherent episodes.

**Exit:** each affected root collection passes the shared populated/query/interaction gates, with explicit remaining private-history limitations assigned to R06. Existing read-only scope must be demonstrable in the diff and test networking must remain denied.

### R03 Convert all remaining retained routes into the compact console

**Class:** immediate UI and existing read projections. **Dependency:** R02; complete historical-data acceptance also depends on R06.

- Cover every remaining row in the [route checklist](CONSOLE_ROUTE_ACCEPTANCE.md), including routes reachable only through Advanced. Preserve the accepted shell geometry, compact rows, frequent actions, contained long content and exact record links.
- Adapt legacy Workflows, Needs You and History routes into canonical scoped views without losing action outcomes, record identity or Back behavior. Keep technical workflow detail and its error boundary inside a consistent bounded workspace with all stage/task/worker/artifact/browser tabs accessible.
- Finish Products research/candidate tools, Artifacts approvals/receipts, Printful and Etsy operational workspaces; do not compress operational product/listing work into the Connections overview.
- Finish Profile/Business settings, Packs, Model Router, Worker Proof, Worker Evaluations, platform account diagnostics, password entry and registration handoff framing. Reconcile held profile source rather than assuming it is ready.
- Regression-test login, auth error, root redirects, research sheet, Overview, Connections and secure entry. Existing acceptance does not exempt them from changed navigation, long names or two-Business contexts.
- Preserve exact account request/revision/expiry/consent binding, secret isolation and safe return paths. UI navigation and fixtures must never start setup, submit a credential, reopen an expired handoff or launch a provider.
- Where existing private workspaces only return a recent window, make that limit and unavailable state visible. Mark the route's full historical acceptance pending R06 instead of inventing a total or widening permissions.

**Exit:** every current rendered route and query surface has a compact, readable, accessible frame and exact navigation contract. Record partial acceptance explicitly where backend pagination is still pending; whole-app completion remains blocked until R06/R08 close those rows.

### R04 Review and implement persistent Business and Quest identity

**Class:** new backend/domain contract requiring independent review. **Dependency:** R03's route/context inventory only, not R03 full data-dependent completion. This contract may be reviewed while an unrelated UI gate is blocked; the R03 → R04 → R06 relationship is not a completion cycle.

- Specify persistent Business setup with editable, versioned operating rules, brand/context, allowed activity, explicit restrictions, installed pack versions and safe connection references. Keep owner profile information separate from Business rules and operational authority.
- Reuse Core `Goal` and same-Business `workflow_runs.goal_id`. Define the canonical Quest lifecycle, selected/current/last Quest rule, exact version identity, pause/stop/completion states and associations to plans, workflow runs, experiments, products and evidence.
- Define persistent Business operational state separately from Quest execution state and target achievement. Meeting a Quest target must not automatically stop the Business: continued operation is permitted only for the duration, purposes, caps and stop rules explicitly confirmed in its envelope. Conversely, a paused Business cannot be made active by selecting or creating another Quest.
- Resolve research's existing `input.intentId` and `product_experiments` lineage into canonical Quest links. Preserve original root/round IDs, `budgetAuthorityRootId`, `semanticGoalHash`, every paid receipt and original intent. Use deterministic same-Business association evidence; ambiguous legacy rows must remain visibly unlinked for review.
- Start intake with side-effect-free draft extraction, or a separately explicit bounded intake allowance. Do not pay for an LLM to discover the budget before any authority exists. Detect and reject/redact credential-like content before model dispatch, logs or prompt persistence; direct credential entry to secure Connections handling.
- Implement one plain-language Quest entry that extracts objective, measurable target, figures, currency, budget, deadline/timezone, geography, scope and stop constraints. Show the parsed values and ask only for missing or ambiguous consequential facts. Do not invent a currency, silently treat revenue as realised profit or convert an aspirational target into a promised result.
- Keep project deadline, authorization expiry, provider lease and Knowledge freshness as distinct fields and checks; a parsed date or number is not an execution grant.
- Confirm the complete initial operating envelope once in understandable business terms. Bind confirmation to the exact Business, objective/rules version, accounts/purposes, limits and expiry. Stale edits invalidate confirmation. Persist intent and authorization as separate records.
- Resolve the account-binding design before promising saved-account reuse across Businesses. Preserve current immutable Business/store binding and unique provider-account identity. The minimal safe scope is same-Business reuse; a different owner-level connection/binding model needs a separately reviewed migration, revocation, isolation and credential-custody design. Do not copy vault envelopes or silently reassign a store even for the same owner.

**Exit:** reviewed schema/API/UI contracts, migration mapping and fixtures cover duplicate submission, old research, same-owner different-Business isolation, ambiguous parsing, exact confirmation, absent authorization and deleted/unavailable references. Creating a Quest alone must cause no model call, account operation, spending or historical rewrite.

### R05 Enforce the initial operating envelope and minimum money policy

**Class:** new backend/security/financial contract requiring review. **Dependency:** R04. **Must precede:** autonomous launch, paid commerce, supplier fulfilment and recurring spend.

- Implement the minimum former Stage24 money and authority capability now, rather than after former Stage19 autonomous publishing or Stage22 fulfilment. Derive exact operation grants server-side from the confirmed envelope and current evidence; never let workers expand their own allowance.
- Bind each envelope/version to Business, Quest, immutable authority root, allowed pack/workflow/operation/purpose, approved provider accounts and revisions, data-sharing classes, aggregate/category/per-operation caps, currencies, cadence/duration, loss/margin limits, expiry and revocation. Unsupported operations remain excluded.
- Add server-checked source/provider/application-purpose/operation/data-use eligibility before any affected search, browser or API dispatch. A documented operational hold, allowed domain, Knowledge pack or qualification flag is not that enforcement. Keep eligible public research independent of unrelated account setup, and fail closed for provider uses lacking their required authorization.
- Revalidate policy, qualification, account revision, source freshness, available budget and pause state immediately before dispatch. Use atomically reserved exposure, exact idempotency keys, dispatch markers and immutable settlement/readback records. Prevent concurrent workflows, successive rounds and small split operations from evading the total cap.
- Enforce Business-wide and immutable authority-root exposure across successive Quests, controller-created child objectives and experiments. A fresh Quest cannot reset an aggregate limit or inherit broader authority merely because it has a new identifier.
- Preserve existing shared research exposure across every round and continuation. Account for known actual charges plus pending/unknown liability. A failed, cancelled or expired run cannot reset its unknown charge to zero or acquire a fresh goal budget automatically.
- Separate model-cost ledgers from sales, marketplace fees, supplier costs, refunds and realised profit. Specify currency units, decimal precision, FX source/time, conversion bounds and rounding. Do not add unlike currencies or substitute a USD model-cost subtotal for business profit.
- Define Pause Business/Quest/pack/account, revocation and expiry across queued, reserved, in-flight and settling work. Stop new dispatch; retain already-sent operations and their possible charges for reconciliation. Require trusted readback before any permitted retry of an uncertain external effect.
- Retain existing exact operation approvals until reviewed admission supplies equivalent or stronger scope from an envelope. Do not broaden earlier consents retroactively. Remove routine prompts only for the newly qualified envelope-governed path.
- Produce contextual Needs owner exceptions for genuinely new access, purpose, budget, risk, platform-required action or an actionable decision about unresolved liability. A technical reconciliation failure remains Blocked until evidence or a supported remedy exists; repeating consent cannot clear it. Log routine autonomous admission/rejection in Decisions without asking for routine approval.

**Exit:** adversarial concurrency, budget exhaustion, currency, stale/revoked consent, dispatch-race, pause/restart, missing-charge and duplicate tests pass against the real reviewed database contract. Simulations prove inside-envelope work progresses and out-of-envelope work stops before effects. No live authority follows from this exit alone.

### R06 Complete bounded historical reads and read-model contracts

**Class:** reviewed backend read APIs and projections. **Dependency:** R04 for new identity; R02/R03 define callers. Keep independent of R05 execution admission.

- Define owner/Business/Quest-scoped page/count/filter/exact-detail contracts for private account setup, Etsy draft/listing/publication, Printful configuration, product experiments/decisions, workflow children/events, packs, model routing and evaluations where existing reads are insufficient.
- Preserve exact intervention joins and current authority checks. Do not expose private tables, vault data, server credentials or broad service-role queries to fix pagination. Review every function signature, grant, security-definer owner/search path and RLS effect independently.
- Bound the eligible publication-draft response, package eligibility selection and artifact source resolution. Search/filter before stable pagination according to the contract; do not let newer ineligible artifacts hide older eligible work or call a sample empty registry-wide.
- Supply independently correct counts, selected details beyond pages, latest-per-entity state and unresolved-queue completeness. A missing count or failed related read must be unavailable/partial, never zero, not-started or no-cost.
- Address account request selection beyond 50 without claiming that a locking owner/server `resume` operation is a general pure-read API. Prefer a reviewed explicit read projection where the existing authority or locking behavior is unsuitable.
- Complete R03's data-dependent route acceptance with 100+ records and two Businesses. Document query cardinality, maximum payload/preview count, stable tie-breaks and indexed access expectations.

**Exit:** bounded-query instrumentation and SQL/API isolation tests demonstrate no fetch-all/client-pagination substitute, no cross-Business fallback and truthful partial reads. Every route dependent on these contracts can now meet its historical-data acceptance gate.

### R07 Build the bounded Quest planner and lifecycle controller

**Class:** new backend orchestration contract requiring review. **Dependency:** R04–R06.

- Reuse existing finite workflow, stage, task, worker, artifact, evidence, action-intent/receipt and pack snapshot contracts. Add only the missing general Quest-to-subworkflow coordination and versioned-plan model.
- Store each plan version, objective/rule/envelope pins, required independent checks, stage dependencies, assigned qualified worker roles, expected result artifacts, budgets, deadline, measurement windows, repair bounds and explicit finish/stop conditions. Keep superseded plans inspectable.
- Start from research and an independently challenged plan. Dispatch known qualified subworkflows only when their prerequisites and R05 admission pass; persist each transition and durable progress delta. Never use a model turn merely as a timer or as repeated reconsideration of unchanged evidence.
- Define any controller-created child objective as a scoped descendant of its parent plan/envelope/authority root, with inherited or narrower purpose, expiry and caps, a bounded count and a recorded reason. It cannot mint a fresh grant. Use ready/admitted/scheduled states for routine eligible next work; do not make waiting for owner launch approval the normal lifecycle state.
- Implement finite bounded repair and pivot paths. A change inside the declared experiment/envelope may be autonomous; a new account, purpose, budget, risk or unsupported operation creates an exception. A worker's recommendation or positive self-review cannot itself grant authority or prove market performance.
- Exercise reserve → dispatch → response → persist crash boundaries and fence stale leases/controllers. Preserve exactly one verified effect or explicit uncertainty; reconcile before resending.
- Reconcile cancellation, partial completion, account expiry, stale knowledge, concurrent callbacks, worker failure and deployment interruption. Reuse persisted successful work; never reconstruct a rejected output as accepted or replay an uncertain mutation.

**Exit:** simulated multi-subworkflow Quest runs survive process/deployment boundaries, preserve version/authority lineage, pause correctly, reject duplicate dispatch and stop when no useful permitted work remains. Production execution remains separately gated by the applicable capability gates in R10–R18. Optional browser watching is not a prerequisite for API-only operation; the public-selling and fulfilment prerequisites remain mandatory where that scope is claimed.

### R08 Complete the owner-facing Business and Quest workspace

**Class:** UI/read projections over reviewed R04/R06/R07 contracts. **Dependency:** R04, R06, R07; R02/R03 layout foundations.

- Make Overview show only the selected Business and its selected/current or most recent Quest. Display explicit selection, objective, real progress, current episode/step/agent, next action, cost exposure, results and exceptions. Do not choose an unrelated decision/active/latest run from an owner-wide recent sample. When none exists, show that truth without invented work.
- Provide Quest history and exact selection outside the current page. Preserve Business/Quest/episode/step/artifact URL context, Back/Forward/reload and return from every action or secure handoff.
- Add **Events** as coherent work episodes backed by actual workflow runs. Expand an episode into ordered Steps, outputs, evidence, receipts and actual participating Agents from Worker Runs. Keep retries/failed/cancelled/queued/waiting states honest. Link underlying immutable audit events separately; never mutate or conflate the two domains.
- Make **Research** the evidence/results destination, grouped by exact Quest/attempt, with source provenance, conclusions, uncertainty and saved decisions. Make **Library** the image/document/artifact destination with exact versions, previews and approval/readiness labels.
- Add **Knowledge** for reviewed reusable lessons and packs, version/source/freshness/review details and Business application state using R09. Before that contract exists, show an explicit unavailable or existing-pack-only state, not a fabricated growing knowledge base.
- Make **Products** a product/package readiness catalog with linked **Listings**, supplier/store/variant association, evidence and blockers. Preserve candidate research tools through Research/deep links. A design, candidate TEST or listing review PASS must not appear sale-ready.
- Keep **Decisions** as the searchable audit log of automated and human decisions; give **Needs owner** a distinct exception filter/queue with exact required action, reason, consequence and resume conditions. Preserve historical acknowledgment semantics.
- Finalize canonical navigation and aliases without duplicating workspaces or adding empty placeholders. Keep Profile/Business rules, Connections, tools, costs when truthful, and operational views reachable. Apply the full route checklist to all added surfaces, not only the original 21 pages.

**Exit:** realistic end-to-end read-only fixtures show one Business/Quest across Overview → Events → Step/Agent/result → Research/Library/Product/Listing → Decision/exception and back, with every selection, count and status exact. Knowledge may remain existing-pack-only/unavailable until R09; its real learning/application journey closes in R09/R18. Product/Listing fixtures must show missing/unqualified readiness until R13–R15, without requiring live product data to accept this UI slice. Whole-app UI acceptance requires both desktop sizes, real Next navigation and all retained routes.

### R09 Implement reviewed reusable Knowledge growth and application

**Class:** new backend/domain and UI contract requiring review. **Dependency:** R04–R07; connect R08 after acceptance.

- Reuse immutable pack releases, Business installations, exact knowledge pins, manifest/content hashes, source verification dates and freshness checks. Implement the missing learned-knowledge proposal → evidence review → redaction → versioned promotion → deliberate Business application lifecycle.
- Distinguish Business-private operational evidence, provisional findings, reviewed reusable guidance and current external policy. Retain provenance, reviewer identity/fingerprint, scope, limitations, conflicting evidence, expiry and supersession reason. Preserve every original and the version actually used in prior work.
- Require evidence of generalizability before promoting a successful local experiment. Remove private customer/account/Business content and secrets; do not move raw tenant evidence or credentials to shared packs. Where redaction removes necessary proof, keep the lesson private or unqualified.
- Apply a reviewed version per Business and snapshot it into future plans/tasks. Flag stale or withdrawn knowledge for new work without silently changing historical receipts or in-flight pinned definitions. Define a bounded refresh/review process; do not call dated snapshots continuously updated.
- Make lesson reuse transfer information only. It must not transfer account access, Business rules, allowances, authorizations, qualification status or evidence belonging to another Business.

**Exit:** tests cover contradictory/stale sources, unsafe promotion, cross-Business leakage, rejected redaction, version rollback and exact historical usage. The UI can explain why a lesson applies and which version influenced a decision.

### R10 Implement and qualify privacy-safe in-centre browser watching

**Class:** reviewed backend/capture/privacy contract, then UI qualification. **Dependency:** R04/R06 identity and the existing [viewer requirements](CONSOLE_BROWSER_VIEWER_CONTRACT.md). Independent of commerce activation.

- Design authenticated owner/Business/Quest/run/session delivery with server-held native endpoints and a genuinely read-only, scoped, revocable viewing channel.
- Enforce trusted capture eligibility, safe origin/context constraints, freshness and versioned capture epochs before frames exist. Suspend capture and discard buffered frames before navigation, takeover, secure entry, uncertain page state or any privacy transition.
- Revoke existing streams at the delivery boundary; hiding the iframe or rejecting the next poll is insufficient. Never use saved `live`, null URL, fixture intent or owner-editable metadata as proof of safe pixels. Keep registration/credential handoffs excluded.
- Verify embedding without broad security-header relaxation, safe disconnect/expiry behavior and no input/CDP/clipboard/upload authority. Retain the saved-metadata fallback whenever safe viewing cannot be established.

**Exit:** adversarial frame, navigation, takeover, stale/copy/revocation and cross-Business tests pass; a separately authorized harmless session proves actual embedded viewing. Historical provider qualification is insufficient to close this current viewer requirement.

### R11 Qualify external access and platform purposes

**Class:** external prerequisites and separately authorized qualification. **Dependency:** R04/R05 scope; R07 for lifecycle integration.

- Resolve the Etsy application-purpose/automation/API-content hold and implement the R05 server eligibility gate with written scope covering the intended operations and data uses. Review current applicable terms and permitted research/AI uses. Keep [Etsy activation gates](ETSY_ACTIVATION_GATES.md) closed until that evidence and enforcement are reviewed. Key issuance, personal access and seller OAuth are separate facts.
- Verify exact account/shop/store identity, credential custody, requested capabilities, expiry, revision and revocation through secure owner paths. Present genuinely new persistent access and platform/legal/KYC steps to the owner where required. Do not use saved connection state as permission to publish or spend.
- Preserve Printful's current `catalog.read` boundary and exact immutable store binding. Review any product-write or fulfilment capability separately. Qualify the Etsy-linked Printful store topology; a Manual/API store does not establish the selling association.
- Close account-registration browser entitlement/budget/retention/release requirements if that path is needed. Do not promise a free or already configured secure browser, reusable auth context or verified connection from an expired request or owner-reported token entry.
- Resolve the approved external-data collection scope before live research; simulation and UI tests remain available while a provider is blocked.

**Exit:** record exact permitted operations/data/purposes, account bindings, revocation and live read-only qualification evidence without publishing secrets. Each later mutation still requires its envelope, capability and technical prerequisites.

### R12 Qualify evidence-led research and production-purpose creative work

**Class:** bounded runtime completion and external/model qualification. **Dependency:** R05/R07 and R11 eligibility for any affected provider/source. Reuse valid existing curated Knowledge pins/freshness; R09 is required only when applying newly learned modules, not to rebuild already-qualified pack knowledge.

- Finish a real bounded geographic discovery cycle through independently reviewed strategy, with attributable source evidence, an explicit TEST/REJECT/NEEDS_MORE_EVIDENCE outcome and a predeclared measurement plan. Preserve failed rounds and existing shared funding; do not start a fresh allowance by relabeling the Quest.
- Reuse preserved complete evidence through allowed continuation contracts where suitable. Freshness, latest-round selection, immutable candidate/geography scope, exact sources and known/unknown cost state must be checked before every new call.
- Qualify production-purpose creative generation from the eligible, evidence-backed candidate under the appropriate envelope or preserved legacy exact approval. Retain immutable original bytes and lineage through versions/derivatives, technical print checks, independent pixel/IP/policy review and bounded repairs.
- Separate technical image PASS, candidate TEST, product-production readiness, physical print validation and listing-image suitability. Name which evidence each result actually establishes.

**Exit:** actual paid/source receipts and independent results establish the research and production-purpose creative prerequisites without fabricated demand, reconstructed rejected strategy or unlimited repair loops. Commercial readiness remains gated by R13–R16.

### R13 Qualify products and the Etsy linked-draft bridge

**Class:** new trusted evidence producers, topology contracts and external qualification. **Dependency:** R05, R11, R12.

- Define durable provider-neutral Product and Variant identities, bounded catalog/page/count/exact-detail reads and explicit listing/provider associations. Keep candidate, creative asset, Product Package and provider product IDs as linked provenance, not interchangeable identities. Preserve per-Business isolation and versioned readiness evidence.
- Implement authenticated uploaded-byte/file binding and physical placement evidence tied to exact asset hash, derived geometry, catalog variant, store and connection revision. Establish a documented provider path and independent readback; a successful upload, MD5, SKU/name match or attractive mockup is insufficient.
- Produce truthful finished-product mockups and current stock, cost, product facts, delivery/disclosure evidence. Reuse the guarded product executor only inside its actually supported topology; do not change `manual_api` to an Etsy-linked store without designing the missing path.
- Qualify one Etsy-linked Printful product → the same existing Etsy draft → reviewed adoption/update as the preferred minimal selling bridge. Resolve the current creation/mapping sequencing gap explicitly. Do not create a second unrelated draft to satisfy an internal receipt requirement.
- Bind the exact Etsy purchasable listing/variant to Printful sync product/variant and catalog variant, both accounts/revisions, approved bytes/placement and independent provider observations. Matching names, SKUs, native imports and production-partner disclosures are not cross-provider proof.
- Finish actual Listing Specialist and independent Reviewer qualification and trusted package issuance from verified current product/image facts. Preserve exact seven-dimension review, separate response/model identity, fingerprints and budget receipts; an unauthenticated owner JSON package is not an eligible source.
- Qualify the same draft by independent listing/image/property/inventory readback, cancellation, duplicate suppression and uncertain-response reconciliation. Keep supplier confirmation manual during this bounded qualification and independently observe its actual setting; do not assert provider configuration from a checkbox.

**Exit:** one coherent qualified product/package/draft chain and its real receipts are inspectable through R08. Draft adoption/readback may finish before full fulfilment; it does not authorize public selling.

### R14 Close account-specific fees and commercial readiness gates

**Class:** reviewed financial/readback contract and external qualification. **Dependency:** R05, R11, R13.

- Establish current shop-specific all-in listing fee or defensible bound, payment-account currency, tax/FX exposure, freshness and provenance. Do not treat the public base fee, listing-price currency, local cap or estimated earnings as a provider-enforced debit ceiling.
- Define any renewal/sale-related recurring fee exposure and exact approved quantity, shipping, returns and processing terms. Reject changed or unknown facts; do not silently edit commercial settings to make a draft eligible.
- Add authoritative supplier variant-linkage and supplier-confirmation-state gates alongside product, independent review and fee checks. Keep unknown supplier settings visibly unknown. Do not activate automatic supplier confirmation/payment as a shortcut.
- Make Product/Listings readiness distinguish reviewed draft, fee-ready, fulfilment-ready and public-selling-ready. Preserve original draft/product receipts; no readiness label may substitute for the missing real observation.

**Exit:** fee authority and supplier/shop facts are reproducible, bounded and enforced server-side. Public launch remains blocked on R15; satisfying the former Stage18 fee gate alone is insufficient.

### R15 Implement and qualify order fulfilment and the commercial ledger

**Class:** new backend, provider and financial contracts requiring review. **Dependency:** R05, R11, R13/R14.

- Implement verified paid-order ingestion, authenticated webhook/poll reconciliation, exact purchasable-variant mapping, unique external order/line identities and one logical supplier order per approved obligation.
- Check paid state, quantity/address/product facts, supplier stock/cost/currency/tax/shipping, loss/margin boundaries and envelope immediately before dispatch. Reserve exposure, retain immutable dispatch markers and reconcile uncertain supplier outcomes before considering a retry.
- Implement supplier acceptance, cancellation limits, shipment/tracking, delivery, failed/lost/returned-order exceptions and reconciliation of duplicate or out-of-order messages. Preserve external identifiers and receipts across restarts.
- Implement sales, marketplace fees, supplier charges, refunds and other allowed costs as a deterministic ledger with pending versus settled status, currency/FX attribution and auditable realised profit. No model estimate may become a settled transaction or profit figure.
- Keep customer/order data purpose-bound and isolated. Add business-readable exceptions for price anomalies, payment ambiguity, loss limits and unsupported actions. Automatic refunds or broader customer service require separately defined scope and policy, not assumed fulfilment permission.
- Before public selling, qualify a supported fulfilment loop. If an initial real publication is instead needed to qualify that loop, specify a separately explicit bounded manual qualification procedure with exact unit/order/loss limits, accountable fulfilment steps and stop conditions. Manual supplier confirmation by itself only prevents automatic charging; it does not fulfil customer orders.

**Exit:** replay, duplicate, unknown payment, supplier anomaly, pause/revoke and settlement tests pass, and the authorized real qualification procedure demonstrates one supported order path. The resulting commercial proof must state whether it used autonomous or bounded manual fulfilment.

### R16 Qualify autonomous public launch and permitted promotion

**Class:** external release qualification and capability promotion. **Dependency:** R05/R07 and R11–R15. **No public selling before the R15 supported path or explicit bounded qualification procedure.**

- Exercise the assisted qualification path against exact independently reviewed product/draft/fee/supplier facts without duplicating publication or silently widening an older approval. Preserve observed-active but unverified and uncertain-charge exceptions.
- Define explicit evidence thresholds before promoting the operation to envelope-governed autonomous launch. Use independent state/receipt verification, qualification fingerprints, failure bounds, loss exposure and pause/revocation tests. Promotion is neither a UI switch nor a reviewer saying PASS.
- For the qualified path, let server admission derive routine operation authority from the initial confirmed envelope and current prerequisites. Do not ask for redundant routine step-by-step production/review/launch approvals; ask for genuine changed scope, platform requirements or exceptions.
- Add a reusable Campaign Package/Content Specialist and permitted Instagram scheduling/publication/metrics flow. Bind posts to the exact product/listing, Business, content version, account and budget; review claims/disclosures and reconcile uncertain publication.
- Add TikTok only through currently permitted posting/consent paths. Where platform rules require owner participation, show the real requirement. Do not promise autonomy or available metrics before qualification.
- Keep paid advertising disabled until R17's separate budget, loss and measurement contract is qualified. No social connection, organic post or product launch grants ad spend authority.

**Exit:** repeated bounded real launches and supported promotional operations meet predeclared thresholds, preserve receipts and respect envelope/pause/exception boundaries. Record per-provider capability status; one platform's qualification does not qualify another.

### R17 Implement measured operation and bounded improvement

**Class:** backend measurement/controller extension and bounded external experiments. **Dependency:** R05/R07/R09 and R15/R16.

- Persist predeclared experiments: hypothesis, intervention/version, eligible audience/channel/product, baseline/control where feasible, metrics, attribution window, minimum observations/duration, maximum spend/loss, success/stop rules and decision date. Preserve original plans when changes are versioned.
- Collect independently attributable source metrics and settled commercial outcomes. Record denominators, coverage, missing/late data, platform changes, seasonality, confounding/noise and confidence. Distinguish correlation, forecasts and model judgments from measured results and causal evidence.
- Permit CONTINUE_TEST/ITERATE/SCALE/RETIRE only when the required evidence and envelope allow it. A worker's self-review or independent critique can assess a proposal; neither is measured ground truth. Insufficient evidence must yield a bounded wait or stopped experiment rather than a repeated paid reasoning loop.
- Tie each pivot to its previous plan, evidence and shared liability; bound number, time, scope and total loss. Prevent renamed candidates, audiences or goals from resetting failed-test history, money or stop conditions.
- Extend money policy only for needed marketplace recurrence, ad campaigns, samples and refunds, with exact purposes/providers/caps/expiry. Treat new financial commitments and expanded access separately; do not enable every category by default.
- Promote useful lessons through R09 review/redaction/versioning and apply them deliberately to a Business. Preserve the chain from observed result to decision to subsequent plan and actual outcome.

**Exit:** controlled fixtures and bounded real measurement windows demonstrate truthful decision-making, no premature success claims, no budget reset and safe stop under loss/noise/unknown data. The system can explain both what changed and what evidence justified it.

### R18 Qualify the complete operating lifecycle

**Class:** end-to-end simulation, production qualification and whole-app acceptance. **Dependency:** R01–R17 for the capabilities claimed; explicitly exclude any still-blocked optional provider rather than silently declaring it passed.

- Run the coherent lifecycle: Business/rules → confirmed Quest/envelope → bounded plan/research/challenge → production assets/product → reviewed linked listing → permitted launch/promotion → paid order/fulfilment → measurement/settled profit → bounded improvement/reviewed learning.
- Exercise model fallback, stale policy, account expiry, browser interruption, supplier anomaly, unknown costs, owner exceptions, cancellation, pause/resume, delayed callbacks, deployment restart, independent review failure and duplicate prevention. Verify preserved queued work and no repeated external effects.
- Require at least one real complete loop with verified realised profit, then repeated success against declared reliability/cost/loss thresholds before calling the pack autonomously qualified. A forecast, technical image, source-only receipt or manually seeded fixture cannot satisfy this exit.
- Close every applicable route/surface row and the actual Next client-navigation gate using realistic populated source-rendered fixtures; obtain exact-head and authorized deployment evidence separately. Keep remaining provider restrictions visible in product readiness.
- Publish the acceptance record with source commit/tree, test scope, screenshots, SQL/security review, real receipt references, qualification limits and rollback/reconciliation rehearsal. Do not publish private customer data, credentials or raw sensitive evidence.

**Exit:** the supported Business can operate through the claimed lifecycle inside its confirmed envelope, with truthful UI, no duplicate external action, known recovery routes and independently verified outcomes. Any remaining gap stays an explicit open task in this queue.

### R19 Expand qualified packs in dependency order

**Class:** future scoped product/backend/external work. **Dependency:** R18's repeated first-pack success; each new capability must repeat its relevant review/qualification gates.

1. Expand Social Growth into an independent reusable workflow pack and prove a Business can use it without Etsy-specific state or authority.
2. Implement Shopify Dropshipping with its own supplier, policy, inventory/order/return, margin and fulfilment contracts; do not transplant Etsy's rules or assume account/financial permission.
3. Implement Website Builder using scoped GitHub, deployment and database capabilities, coding specialists, browser QA and deployment receipts. Prove a different profession can reuse Core Business/Quest/envelope/workflow/Knowledge contracts without rewriting Core.

**Exit:** each pack has a separately bounded plan, actual relevant qualification, Business isolation, truthful UI and independent deployment/access authority. Do not begin all packs in parallel merely because pack scaffolding exists.

## Universal acceptance and release gates

These gates constrain tasks above; they are not a second queue.

### Whole application UI and navigation

- At 1280×720 and 1440×900, each owner-facing desktop workspace must have document `scrollHeight <= clientHeight + 1px` and no horizontal document overflow. Keep frequent controls and concise status visible; give long evidence/history/JSON a labelled contained viewer. Hidden, clipped or unreachable content does not pass.
- At 320/390px and 200% zoom, prioritize readable reflow, labels, exact-value access and operable controls. Mobile page scrolling is allowed; shrinking the desktop grid until it is unreadable is not.
- Test two Businesses, long and duplicate names, 0/1/49/50/51/125+ records, equal timestamps, old open work behind newer terminal work, exact off-page selections, unknown cost, partial/missing counts and failed/stale reads. Include empty/loading/unavailable/success/failure states.
- Verify bounded server queries rather than only bounded rendered rows. Separate global/scoped count from loaded rows, current/latest truth from sampled history, and exact selected identity from pagination/filter state.
- Test keyboard focus, Home/End/tab/disclosure reachability, mobile navigation, retained-client transitions, actual Next client transport, Back/Forward/reload, repeated clicks, pending mutations, interrupted requests, stale action results and query-spoofed notices. Preserve anchors and return context beneath sticky bars.
- Use real source components/loaders and strict synthetic provider/action-denying fixtures. Page navigation must not mutate the database, start a model/provider/browser call, submit a credential, publish or spend.
- Track the 21 existing `page.tsx` routes as total inventory, plus the workflow error boundary and query surfaces. Never report them as 21 unfinished pages. New destinations extend the checklist.

### Backend compatibility and migration

- Review additive schema, function, grant, RLS, encryption, authority and read-model deltas before application. Present exact migration bytes and expected changes; do not use a UI release to smuggle in a new endpoint or grant.
- Rehearse forward migration and rollback against representative old data, in-flight/queued runs, pending settlements, existing account bindings and pinned pack versions. Compare unaffected definitions/grants/rows and preserve the applied-migration ledger.
- Use explicit adapters/versioned APIs and bounded backfills. Link old records only with reliable same-Business evidence; retain ambiguous/unlinked history. Do not delete records, rewrite approved artifacts, regenerate receipts or mint new authority to simplify compatibility.
- Keep queued work pinned to its original workflow/pack/plan/knowledge and authorization lineage. If a new safety rule blocks it, pause with an explicit reason and reconciliation path; do not auto-requeue or replay.
- Preserve legacy deep links and saved outcomes. Presentation aliases may change; execution identity, approved scope, source hashes and immutable records may not.

### Release and rollback

- Freeze an exact commit/tree per bounded change. Run lint, types, the full relevant test suite, optimized build, independent review and hosted browser/SQL gates; distinguish passed, failed, skipped and never-run checks. Inspect real screenshots after the final edit.
- A release requires separate authorization, exact-head CI and preview evidence, merged-tree CI when applicable, exact deployment identity and read-only live acceptance. Software release is not provider activation or commercial qualification.
- Roll back UI via a tested compatible presentation path/flag where available. For backend changes, retain readers for new durable states or apply a separately reviewed compatible forward fix; do not destroy history with a blind down migration.
- On rollback, stop new affected dispatch and reconcile in-flight/unknown external effects from immutable markers and readback. Preserve queues, allowances, connection revisions, knowledge pins, receipts and unsettled liability. Never use rollback, redeployment or a copied Business as permission to replay an external action.
