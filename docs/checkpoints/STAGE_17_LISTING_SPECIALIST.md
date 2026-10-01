# Stage 17: Listing Specialist and independent review

Status: implementation prepared for combined release verification. Hosted migration, release and live qualification are not claimed by this checkpoint. Stage 14–16 live prerequisites remain open. No Stage 18 publication authority is granted.

## Implemented feature

### Verified product → independently reviewed package

The dedicated `etsy.listing-review@1.0.0` workflow has a finite specialist → reviewer → trusted issuance path. It builds readable titles, description paragraphs and tags from resolved facts, preserves exact attributes, orders reviewed finished-product images and retains applicable disclosures. Its seven reviewer dimensions are title, description, tags, attributes, image order, disclosures and factual claims.

- New immutable knowledge, specialist and reviewer packs, 22 full-contract training examples and a dedicated workflow pack; old releases remain unchanged
- Scoped Task Contracts and Core workflow/stage/worker/artifact/event history
- Complete source snapshots, exact fact pointers and resolved image-review observations in each request
- One primary model attempt per role, no fallback or hidden retry; the actual specialist and reviewer models/tasks/requests must differ
- Seven substantive reviewer findings: a failure means REJECT; unresolved required evidence without a failed check means NEEDS_EVIDENCE; only seven passes permit APPROVE
- REJECT and NEEDS_EVIDENCE have distinct durable terminal states and never issue a Product Package
- Exact package hashing and separate authenticated Product Package/review envelopes issued only by the guarded server after current sources, qualifications, known costs and persisted responses pass
- A new output artifact identity preserves the immutable source artifact and original product/creative/Printful lineage
- Stage 16 intake reauthenticates the exact package and review, rechecks policy/expiry/bindings and retains its authoritative upstream database checks and separate draft/asset-sharing consents

The worker has no provider, account, upload, marketplace or spending capability. Model dispatch belongs to the approved, budgeted server runtime. This workflow does not create an Etsy draft; that remains the separate Stage 16 action. No publication, order or purchase path is present.

### Trusted live worker qualification

A separate `etsy.listing-qualification@1.0.0` workflow runs five fixed server-owned cases:

1. Grounded specialist copy
2. Specialist resistance to instructions embedded in source data
3. Review of an acceptable proposal
4. Rejection of unsupported factual claims
5. NEEDS_EVIDENCE for unresolved finished-product imagery

Each paid qualification case is a separate durable step with retries disabled, so the five-call sequence does not consume one long function window. The test products are explicitly synthetic. Qualifying evidence must come from actual server-dispatched model responses and immutable known-cost receipts, not simulated responses or caller-submitted pass labels. These test inputs cannot enter product execution or issue a Product Package.

The specialist qualification cases use one closed bank of semantically verified title/paragraph/tag units, each paired with its exact fact IDs. The same finite choices are exposed in the model context and qualification schema; the grader checks exact membership and required fact coverage. This tests grounded copy selection and source-instruction resistance, without pretending a word list can judge arbitrary English. Production listing copy remains independently generated and reviewed. Reviewer cases require the expected substantive verdict, relevant failed/uncertain checks and bounded meaningful explanations. This is a narrow competency test, not a general semantic truth oracle or proof that all possible listings are accurate.

Only the complete passing five-case set can produce trusted exact-fingerprint Stage 6 evaluation/promotion records plus the private Stage 17 qualification attestation. Existing owner-recordable Stage 6 pass results alone are insufficient. Worker/model/knowledge changes or expiry invalidate eligibility. The implementation does not seed passed evaluations, promote workers or run paid qualification during release preparation.

### Separate owner-approved budgets

Product preparation permits at most two model calls; qualification permits at most five. Each has its own explicit total allowance, bounded to US$1, and a complete fresh upper estimate before launch. Research/design funding is never reused or replenished.

Every call is reserved durably before dispatch, with fixed model/provider, semantic request fingerprint and a separate hash of the exact price-pinned transport request. Current price checks use exact decimal arithmetic shared in meaning with SQL numeric calculations. The full request allowance is 64,000 UTF-8 bytes, with an 8,192-token formatting allowance and a 6,000-token output limit per call. Oversized complete inputs stop; no source is truncated.

The ledger distinguishes known actual cost from pending/unknown reserved exposure. Known malformed responses retain actual charges and bounded diagnostics. Missing or unsafe charge data preserves liability and stops further calls. Settled actual cost replaces that call's estimate for committed-cost accounting. An unknown reservation cannot be reset to zero or blindly replayed. An uncertain launch, interrupted write or lost response does not authorize another provider request. A stable server-rendered qualification approval nonce also prevents the same submitted approval from launching again after its first run is terminal.

Cancellation prevents later calls. An in-flight response may still cost money and can settle after cancellation or expiry; history remains intact. The quote is a conservative bound and provider price constraint, not an invoice guarantee.

### Normal owner controls

The existing Etsy workspace now exposes:

- Setup, current-qualification and verified-input blockers
- A separate five-call worker-qualification quote, spending limit and consent
- A two-call listing-preparation quote, spending limit and consent for each eligible source
- Stop controls, expiry closure, durable cost history and workflow links
- Readable copy and all seven independent review findings
- Honest rejected/needs-evidence/cancelled/unknown-cost states

Implementation identifiers remain hidden form bindings. There is no owner JSON, source-hash or raw-artifact-ID entry task. No general UI redesign is included.

## Trusted upstream source contract

`loadVerifiedListingInput` resolves the actual source records before a product quote/start. It requires a `product.package.v1` artifact containing:

- `content.etsyDraftEnvelope`: the existing source Product Package, sealed with AAD `product-package:<businessId>:<sourceArtifactId>`
- `content.listingInputEnvelope`: the complete input, sealed with AAD `listing-input:<businessId>:<sourceArtifactId>`
- `content.listingInput`: the exact matching private plaintext input for authoritative database comparison

The input's product must exactly match the authenticated source package, including its source identity. Its mode must be live. Plain owner-editable JSON, recomputable hashes and synthetic flags cannot establish provenance.

Each fact cites a bounded JSON pointer in an included same-Business source snapshot. The source content is resolved against:

- Printful configuration receipt: exact receipt identity, successful provider outcome, verified configuration/asset bindings, current `productFactsHash`, and an exact `response_summary.listingFacts` snapshot
- Production creative approval: exact approval identity/purpose and the defined subset of concept, design instructions, rights statement, rights confirmation and original-design intent
- Approved business facts: `listing.business-facts.v1` artifact with matching `listingSourceSnapshot` and authenticated `listingSourceEnvelope`, sealed as `listing-business-facts:<businessId>:<artifactId>`

Every finished-product image needs a `listing.image-review.v1` artifact containing the exact proof, result hash and authenticated `imageReviewEnvelope`, sealed as `listing-image-review:<businessId>:<reviewArtifactId>`. Its substantive observations, product match, finished-product representation and image-rights result bind to the actual asset hash, product-facts hash, category, caption and review time. The owner-side loader also reads the actual PNG bytes and checks their hash/header/dimensions against the immutable stored inspection.

The existing Stage 14 Storage restrictions already prohibit owner/capability updates and deletes of those assets. This release adds no Storage policy or broad Storage permission. Runtime guards revalidate the immutable source records, artifact content hashes and current authoritative upstream package conditions before dispatch and issuance.

Source snapshots must contain only necessary factual fields, not credentials or unrelated provider bodies. Facts, descriptions and source text are untrusted instructions; workers inspect their meaning without following embedded requests.

### Upstream gaps stay blocked

The source Product Package/input, verified Printful `listingFacts` readback, business-fact and finished-product image-review issuers belong to the upstream product/creative workflows. Their absent live evidence is not manufactured here.

Stage 16's current image intake still accepts only its existing Stage 14 creative-asset provenance/storage model. A raw artwork PNG is not a product mockup. A future truthful finished-product image handoff must satisfy both visual evidence and those authoritative checks, or receive a separately reviewed narrow extension. The Listing Specialist cannot relabel a raw asset to bypass that gap.

## Trusted output and draft-only boundary

After two accepted actual responses and current guards, `assembleListingProduct` copies only the reviewed title/description/tags/image order into a new output artifact, retaining frozen physical/commercial terms and upstream lineage. Required disclosures are appended verbatim. The independent review binds the full final package hash, current knowledge hash and both actual executions.

Only the guarded durable engine calls the server-side envelope issuer. There is no owner-facing endpoint that signs arbitrary review JSON. The database finish transition independently checks persisted outputs, actual receipt/model/request/task/time/hash bindings, known costs, review verdict, rendered package and current upstream state before saving the output artifact.

`loadEtsyPackage` authenticates both final envelopes with Business/artifact-specific AAD, replays their validation and calls existing Stage 16 database checks. Every later draft mutation/completion guard reloads that intake. An APPROVE outcome grants no Etsy API action, publication, purchase or new spending permission.

## Policy knowledge

Official Etsy sources were read on **2026-10-01 at 09:54 UTC**. The snapshot distinguishes platform rules, advisory guidance and application safeguards. Future/stale knowledge fails; the maximum review interval is 30 days. Changed knowledge hashes invalidate old package and qualification bindings. This is dated verification, not continuous monitoring.

- [Create a Listing](https://help.etsy.com/hc/en-us/articles/115015628707-How-to-Create-a-Listing): 140-character title limit; the current Help page allows up to 20 photos. The application's inherited ten-image limit is its adapter bound, not the platform maximum
- [Tags Help](https://help.etsy.com/hc/en-us/articles/360000336307-How-to-Use-Tags-to-Get-Found-in-Search): at most 13 tags of 20 characters each
- [Title guidance](https://www.etsy.com/seller-handbook/article/1399426136697), [Keywords 101](https://www.etsy.com/seller-handbook/article/382774281517), and [Attributes Help](https://help.etsy.com/hc/en-us/articles/115014502508-How-to-Use-Attributes-When-Listing-an-Item): accurate natural copy and supported attributes; fewer than 15 title words is advice, not a hard requirement or ranking promise
- [Listing Image Requirements](https://www.etsy.com/legal/policy/listing-image-requirements/253962679005), [Creativity Standards](https://www.etsy.com/legal/creativity/), and [Production Partners Help](https://help.etsy.com/hc/en-us/articles/360000336547-Working-with-Production-Partners-on-Etsy): category-specific finished-product representation and applicable production/AI-item disclosure

The Seller Policy and Fees Policy pages displayed a future **2026-10-05** update date. Their retrieved text remains excluded as evidence of rules effective on the snapshot date. Resolve the anomaly before relying on those versions for consequential activity. No legal/IP clearance, sales outcome or physical product quality is inferred.

## Verification and release state

- Offline synthetic contract suite: 22/22 required cases, score 100, with explicit `liveCompetence: false`, `realDraftMatched: false` and `promotionAllowed: false`
- Focused TypeScript/Node tests cover provider-shaped requests, source and envelope authenticity, actual-byte checks, immutable terms, policy freshness, role independence, raw-artwork rejection, meaningful review explanations, accounting, unknown charges, interruption/replay, owner consents and workflow/RPC wiring
- Separate fake-wire tests exercise the real five-case qualification runner and its server-owned graders without making provider calls
- Isolated SQL tests exercise owner/RLS/capability/secret boundaries, generic-workflow admission fences, immutable provenance, source drift, budget concurrency/replay, late settlement, rejected reviews and exact issuance/qualification bindings
- Final local focused run: 142 passed, zero failed; two Chromium browser checks skipped outside the hosted CI environment. A subsequent five-test workflow-wiring run also passed, including safe Core failure recording when adapter setup fails before engine entry. Full local ESLint, application TypeScript, core-test compilation and whitespace checks passed
- Nineteen self-contained SQL suites passed with 646 lexical ASSERT statements, including 66 product-runtime and 41 qualification assertions. Every suite rolled back exactly; successful and injected-failure migration rollback restored exact state, with all 118 preexisting rows and all 156 old function bodies/ACLs/owners/config unchanged
- Final compiled-engine→real PostgreSQL RPC proof passed: five separate one-call qualification steps, two product calls, actual fixture source loader/PNG checks, distinct signed package, and terminal replay with zero additional calls. HTTP/model responses were injected. Only upstream Stage 16 readiness was isolated for the synthetic product; all Stage 17 validators were real
- Five historical SQL suites require absent named live tenant fixtures and fail identically before/after this migration. Their limits and the exact named authority delta are recorded in [the SQL contract](STAGE_17_SQL_CONTRACT.md)
- Frozen migration SHA-256: `e550e69d765d662c5400908eae8085a93b2a0bbcc97cb267cae7641f4f33ee49`. Qualification suite hash: `c71239c53ae0c21be75a76b1cf0c19cd1048012850ad97265add785923ebfbf8`
- The aggregate exact-commit release gate and hosted deployment evidence remain for the release closeout; neither is inferred from offline tests

The migration is pending explicit reviewed authority approval. No credentials, server authority key, account connection, passing qualification, provider call or commerce action is installed by its catalog/DDL.

## Live exit still required

- Real independently reviewed product decision and production-purpose creative approval
- Verified Printful configuration, current factual snapshots, mappings and receipts
- Truthful rights-cleared finished-product imagery with compatible authoritative provenance
- Secure server setup, separately approved bounded live qualification and both exact worker versions passing its actual five-case run
- Separately approved product listing-preparation run with accepted independent review
- Secure Etsy activation and one approved real draft whose independent readback matches that reviewed, verified package
- Current applicable policy knowledge and preserved duplicate/cancellation/uncertain-write protections

Only evidence of these outcomes can close Stage 17's live exit. Implementation and deployment alone do not qualify Stages 14–17 or authorize Stage 18 publication.
