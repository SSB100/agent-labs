# Stage 18: Assisted Etsy publication

Status: offline implementation and reviewed verification prepared for release coordination. This checkpoint does not claim deployment, publication, fee authorization or live qualification. Stage 17 remains a separate release. The current production fee-authority gate is deliberately closed.

## Implemented boundary

The API-first operation is confined to one existing physical draft already verified by Stage 16 and bound to a current, authenticated Stage 17 independently reviewed Product Package:

    authentic reviewed package + verified existing draft
    → exact owner review and separate public-data/fee/renewal consent
    → durable one-time activation marker
    → PATCH existing listing state=active
    → independent listing, images, properties and policy readback
    → immutable publication receipt

It never creates another listing, uploads images, alters quantity, edits commercial terms, enables automatic renewal, renews a sold-out listing, places an order, or retries an uncertain activation. The existing `listings_w` OAuth scope is sufficient; no new credential or account scope is introduced by this code.

This initial qualification path deliberately requires a **single-unit draft, manual expiration renewal, manual shipping profile and an explicit verified return policy**. These are temporary application qualification conditions, not universal Etsy restrictions or a permanent prohibition of future approved recurring-fee support. The app does not rewrite a draft to satisfy them. Calculated shipping remains outside the initial lane because the current verified package does not bind item weight and dimensions.

## Exact evidence and consent

The source resolver requires the actual immutable Stage 16 draft run, successful Core receipt, external resource, image-operation mappings, and the exact completed Stage 17 output. The server authenticates both Product Package and independent-review envelopes again with Business/artifact-specific AAD. Owner-editable JSON and recomputed hashes cannot manufacture an eligible source.

The activation request binds the Business, connection and revision, shop, existing listing, original product marker, package/review/raw-draft-receipt hashes, disclosure and complete preflight hashes. Consent separately binds the exact fee evidence, billing currency, total ceiling, intended quantity, payment-account charge, public listing data and expiration time. Server actions reject missing reviewed digests rather than approving fresh, unseen terms after submission.

Preflight verifies the actual provider listing and exact approved fields, receipt-backed image IDs/rank/alt text, properties, shipping profile and destinations/upgrades, return policy, and processing profile. Shipping identity is bound to the shop-scoped request and profile owner user ID; the shipping response does not supply a shop ID. Draft processing IDs can legitimately be null at listing level, so the adapter resolves actual enabled inventory offerings and their processing profile. Missing relationships stop publication; no repair write is attempted.

## Unresolved commercial evidence

The [2026-10-02 topology audit](ETSY_PRINTFUL_TOPOLOGY.md) also identifies separate selling prerequisites: an independently verified Etsy purchasable-variant → Printful sync-variant association and current supplier manual-confirmation state. Existing publication source/preflight guards do not establish either. Both need authoritative enforcement before future activation is enabled; satisfying fee evidence alone must not be treated as complete selling readiness. The present clarity patch adds explicit UI explanations only and does not add a new SQL guard, inspect supplier settings or enable payment/fulfilment.

Official public Help describes a **US$0.20 base listing charge**, converted to the payment-account currency when posted and potentially subject to tax. The listing's price currency is not evidence of the billing currency. Manual expiration renewal also does not eliminate later multi-quantity/auto-renew-sold listing charges.

The current activation API supplies no all-in prepublication quote, maximum-charge parameter, tax calculation or locked billing-currency conversion. A local cap cannot constrain Etsy's debit. It must not be described as an enforced provider ceiling without a defensible, verified all-in bound.

Accordingly:

- `publicationFeeReadiness` remains unavailable
- The server has no quote issuer and never accepts owner-entered fee JSON
- The private SQL fee-authority guard rejects production preparation and dispatch
- Base pricing and dated policy links are informational, not spending authority
- A future authenticated provider checkout observation or verified account-specific rule calculation must establish the applicable total/bound, currency, tax/FX exposure, provenance and freshness before this gate can be implemented
- The real owner must be shown and approve those exact facts before activation

The native UI is a possible future fallback, not an assumed manual-only requirement. Public instructions document the listing editor and Publish controls, including two Publish selections in one specific flow, but do not establish that the first click is harmless or that an authoritative all-in quote is always shown. The actual authenticated flow must be observed before implementing executable browser controls. The editor's earnings calculator is an estimate and cannot substitute for a fee quote.

The retrieved Fees Policy has a future October 5 update footer relative to the October 1 snapshot; its current applicable version remains unresolved. The code does not silently declare that footer an effective date. Policy evidence is bounded to 30 days and cannot be used from the future.

## Durable state and uncertainty

One private run owns the selected draft and listing. An exclusive expiring lease and compare-and-swap revision serialize execution. A separate immutable operation row records the exact activation request **before** dispatch; an interrupted or uncertain response cannot clear it or permit a second PATCH.

Known explicit rejection and unknown transport outcomes remain distinguishable. Any accepted or independently observed active state is retained even if later factual checks fail. A stopped or expired run may inspect the same listing read-only; this never grants another mutation. Etsy does not document a conditional-update or idempotency precondition for activation. A concurrent external edit between the final preflight and activation therefore cannot be made atomic by this application. Subsequent drift is reported as an observed-active verification exception, never silently repaired or declared a successful exact publication. The real qualification must exercise and understand this provider limitation. Owner stop prevents later publication but cannot reverse an already sent request or an external charge. Uncertain outcomes and stop-after-dispatch create one bounded Core Needs You entry with read-only reconciliation guidance; verified readback resolves it without pretending the fee is known. The owner queue explicitly loads these workflow-independent requests and links to read-only Etsy verification, never generic workflow-approval controls.

Successful verification creates a separate `published_listing` Core resource and action receipt. The original draft resource/receipt/history remains unchanged. The receipt reports an observed active listing and the exact readback hash, not proof of which external actor caused activation. It does not infer a fee charge from listing state: actual fee amount/currency remain null and unreconciled, while the approved exposure remains recorded.

## Owner workspace

The existing Etsy page gains a narrow publication section with current setup/source/commercial blockers, exact-draft choices, separate consent controls, durable history, stop and read-only reconciliation. Unknown records are never presented as no history. An observed-active-but-unverified listing is not presented as successful publication. Identifiers are internal hidden bindings; there is no JSON, hash or raw-artifact-ID assembly task.

Current commercial evidence keeps publication controls disabled. No credential, account connection, passing evaluation, fee authority, live provider request or publication is installed by the migration.

## Database authority delta

The additive migration introduces three private RLS tables:

- `etsy_publication_runs`
- `etsy_publication_operations`
- `etsy_publication_mutation_admissions`

They have no grants to PUBLIC, anon, authenticated or service_role. One new public owner-scoped RPC, `etsy_publication_owner_transition(uuid,text,jsonb,text)`, grants EXECUTE only to authenticated. Mutating operations also require the existing enabled Etsy server authority; workspace and owner stop remain separately scoped. Private helpers revoke execution from all client/service roles.

Transaction admission and additive provenance triggers protect publication intents, receipts, resources, events, Needs You entries and referenced draft history even inside older generic SECURITY DEFINER paths. The migration does not replace old function bodies or expand old grants. It does not alter Storage policies, OAuth scopes, account setup or catalog capabilities.

Hosted application requires review and approval of this exact security delta. SQL preparation alone grants no commerce or spending permission.

## Verification state

- Contract/adapter/engine tests exercise full-shaped provider fixtures, source and account identity, strict content and image mappings, shipping/returns/processing, exact financial/approval bindings, cancellation, replay, lost responses, rejection, late active observations and unreconciled fees
- Server/action/workspace tests cover owner isolation, real envelope authenticity, stale/missing review digests, closed current fee authority, four independent consents, safe errors and read-only reconciliation
- A source-rendered Chromium check is reserved for the hosted CI environment; the local sandbox cannot create Chromium's required sockets. It is not an authenticated application or Etsy UI proof
- A focused combined Node run passed 314 tests with zero failures and three CI-only browser checks skipped; subsequent server-boundary regression tests also pass
- Local ESLint, application TypeScript, core compilation and whitespace checks passed. Workflow generation completed (51 steps, 10 workflows), but the optimized build was blocked by the offline node_modules symlink lying outside Turbopack’s filesystem root. No optimized-build pass is claimed; exact-commit hosted CI remains required
- Isolated PostgreSQL suites and actual compiled-engine RPC integration passed their initial combined audit; the final 20-suite / 715-assertion Needs You integration audit and both normal/late-cancellation engine wire proofs are recorded in the [SQL contract](STAGE_18_SQL_CONTRACT.md)
- No real provider or model call, account change, publication, order or charge is part of offline testing

Positive synthetic executor tests isolate the explicitly unavailable fee-authority prerequisite. That substitution is never live financial evidence. The integration test must retain real Stage 17 and Stage 16 producer/consumer checks except the documented upstream synthetic-product readiness isolation.

## Live exit still open

The implementation-plan exit requires repeated real publications, reliable independent verification, understood browser/API failures and duplicate prevention. That needs authentic upstream product/image/listing/draft evidence, a current account-specific financial bound and applicable policy evidence, explicit publication/data/fee approval, and verified actual receipts. An offline suite, deployment or local passed flag cannot close it. Stage 19 autonomous publication and new standing financial authority are outside this stage.

## Official references checked on 2026-10-01

- [Current OpenAPI](https://www.etsy.com/openapi/generated/oas/3.0.0.json): `PATCH /shops/{shop_id}/listings/{listing_id}` with form `state=active`; existing `listings_w`; dedicated inventory, shipping, return and processing reads
- [Listing tutorial](https://developers.etsy.com/documentation/tutorials/listings/): physical publication prerequisites; sold-out activation can reset stock and renew, so it is excluded
- [Inventory/shipping migration](https://developers.etsy.com/documentation/tutorials/inventory-shipping-migration/): dedicated current endpoint use rather than removed legacy/include parameters
- [Create a listing](https://help.etsy.com/hc/en-us/articles/115015628707-How-to-Create-a-Listing), [default language flow](https://help.etsy.com/hc/en-us/articles/360002035587-How-to-Change-Your-Default-Shop-Language): native editor/Publish path without an established all-in fee-review contract
- [Fees and taxes](https://help.etsy.com/hc/en-us/articles/115014483627-What-are-the-Fees-and-Taxes-for-Selling-on-Etsy), [multiple quantities](https://help.etsy.com/hc/en-us/articles/360000344908-Fees-and-Listing-Multiple-Quantities), [renewal](https://help.etsy.com/hc/en-us/articles/360000344368-How-to-Renew-or-Hide-Your-Listings): base fee, conversion/tax and later-fee caveats
- [Earnings calculator](https://help.etsy.com/hc/en-us/articles/31265828415639-How-to-Calculate-Order-Earnings): estimated earnings are not an authoritative publication quote
- [Fees Policy](https://www.etsy.com/legal/fees/): unresolved version-date evidence, not silently treated as currently effective
