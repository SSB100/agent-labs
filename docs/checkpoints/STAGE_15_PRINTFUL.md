# Stage 15 — Printful Capability Pack

Status: the safe capability foundation is implemented and deployed through [PR 21](https://github.com/SSB100/agent-labs/pull/21) and [PR 22](https://github.com/SSB100/agent-labs/pull/22). This is not a connected or live-qualified capability. The full planned Stage15 exit remains open. Stage14's approved-candidate/product-ready exit and geographic-research live qualification remain open. Stage16 draft-only code is now deployed separately, but its real-draft exit remains blocked on this stage.

## Durable producer continuation, 2026-10-01

The bounded single-product execution, owner review/history/stop and independent association-readback implementation is documented in [STAGE_15_PRODUCT_PRODUCER.md](STAGE_15_PRODUCT_PRODUCER.md). Its software/persistence implementation is distinct from live qualification. Dispatch remains disabled until authenticated uploaded-file/physical-placement producers and separate owner-approved product-write activation exist. The existing `catalog.read` account verifier is unchanged. Native v1 readback produces only partial association evidence, never a completed configuration or listing-ready package. Historical gaps below should be read with this implementation update; the required Stage15 exit remains open.

## Current reconciliation, 2026-10-01

Remote main `ab2d2031bbcd534271abe667189ba1eeafdc4f7a` and its READY production deployment include the calculator form-reset correction. PR21/22 closeouts retain the passing exact-commit hosted gates and authenticated production pricing acceptance. Their completed release evidence supersedes the historical pending verification entry below, without closing any live implementation gate.

Authenticated Accounts inspection confirms Printful is displayed as an experimental, unconnected foundation. The live connection/vault, exact physical placement, durable authorized product execution, verified mappings/receipts and authenticated Product Package creation remain implementation gaps. No technical-test image or synthetic configuration has been promoted into a real product, and no Printful write or paid fulfilment has been made in this continuation.

## Plan-item tracking

- Account connection: a server-only owner check, same-Business store-binding resolver and existing-credential lookup interface are implemented and mock-tested. Store-response inspection distinguishes native/API stores from ecommerce integrations. The UI explains secure setup without accepting credentials or creating access grants. No credential has been configured, connection created or grant requested. The production credential vault/connection activation path remains to implement and authorize
- Catalogue and variants: explicit v2 product/variant response contracts and a bounded GET-only adapter are implemented. Product IDs cannot substitute for variant IDs. Fixture coverage is not live provider verification
- Print constraints: variant-specific dimensions, placement/technique, source hash, dated print requirement and actual pixel density are checked. Planning performs no resizing or upscaling and grants no execution authority
- Pricing/cost inputs: decimal strings become integer minor units. A single ordinary DTG front/back placement is included once; discounts are not assumed. Shipping, seller tax cost, marketplace/payment fees and refund assumptions remain explicit inputs. Missing values produce no profit or margin claim
- Product creation and mapping: proposal contracts construct native v1 POST or existing ecommerce sync-variant PUT descriptors without transport. Existing provider file IDs are hash-bound; private artwork URLs are never embedded. Native front uses independently verified v1 file type default, not the v2 placement name. Real v1 creation/synchronization is not connected. Exact physical sizing is not implied by a v1 sync file: final printfile/template positioning must be proven before execution. Mock receipts use Core's shape with provider `mock.printful`, no external resource and `liveVerified=false`. Mapping converters verify exact Business/connection/store/catalog/sync lineage against an independently read GET and produce Core resource/receipt objects only for matching live read evidence. These pure converters do not authenticate their caller, persist records, prove artwork binding or claim a product write occurred
- Order/fulfilment foundation: uncertain results require reconciliation against the saved external identity before any retry. A deterministic fulfilment identity preflight preserves the current-asset, stock/cost, approval and paid-order gates; it never authorizes a paid order or fulfilment submission

## Bounded implementation choices

The read adapter accepts only fixed Printful GET descriptors and a trusted server account resolver. It has no default credential, caller-supplied host, write method, redirect, automatic retry or secret-return path. Its 2 MB response envelope and explicit freshness duration are application safety limits, not provider guarantees. Fixture mode requires an injected mock transport.

The current pricing contract supports the four compared two-decimal currencies (USD, GBP, AUD, NZD). It performs no foreign-exchange conversion or automatic tax/fee lookup. A calculated scenario is not a final supplier invoice, tax determination or authorization to publish a price.

Catalog/API data may be reused as appropriately scoped provider facts; account credentials, Business artwork, approvals and commercial records do not become application-wide knowledge. The later live execution boundary must revalidate the persisted Stage14 production approval, current asset hash, connected store and separate owner action authority. Pure planning or a successful mock cannot waive those gates.

## Required stage exit remains open

1. Authorize and verify the intended Printful account/store connection with minimum necessary access
2. Retrieve current catalogue, variants, exact print constraints and scoped cost data
3. Configure the approved product through the appropriate Printful operation and verify its resulting external state
4. Persist same-Business external resource mappings and actual action receipts; retain uncertainty rather than blindly repeating a write

Only then can Stage15 be called complete. Focused contract tests support development; the final aggregate release gate is recorded below. Real acceptance remains blocked until connection, positioning and persisted approved-product execution are implemented and specifically authorized.

## Verified primary contract references

Verified 2026-10-01:

- [Printful API v2 documentation](https://developers.printful.com/docs/v2-beta/): v2 remains labelled beta; catalog, placement and price responses are documented. Sync-product and product-template management are not currently included in v2
- [Printful v1 Products and Ecommerce Sync APIs](https://developers.printful.com/docs/): native Manual/API-store creation differs from mapping variants imported from an ecommerce platform. External IDs support later reconciliation
- [Printful price guidance](https://developers.printful.com/docs/v2-beta/#tag/Catalog-v2): currency and production region affect quotes, and one ordinary placement is generally included. Special placements/options require separate treatment

Provider examples used in tests are explicitly synthetic. No account, provider, paid-model, product or order call was made for this foundation.

## Visible workspace and registry

The owner-authenticated `/dashboard/printful` workspace is linked from Accounts. It shows explicit synthetic catalog/variant selections, immutable configuration previews, and an interactive deterministic pricing calculator. Missing shipping, fees, tax or reserve inputs remain unknown. The calculator performs no provider call or persistence.

The pinned `capability.printful@1.0.0` registry definition uses `printful.foundation`, stays Experimental, and installs no worker or workflow. Migration `20261001013600_stage15_printful_foundation` changes only the existing adapter constraint and registers the definition. No tables, RPCs, grants, credentials or account records are added. The hosted registry and client-registration denial were verified after application.

## Review and release evidence

- Independent official-API review confirmed the v2 variant-price envelope and ordinary DTG single-placement inclusion
- Regressions fix physical-layout hash collisions, implicit aspect-ratio distortion, modified simulation plans, mutable normalized price IDs and uncategorized provider schema errors
- Focused Stage15 contract, account, operation, mapping, pack and UI parser tests are recorded with the release
- Isolated Stage15 SQL migration/registry assertions completed, but the local PGlite process exited 137 during shutdown; this is not reported as a clean local process pass. The same registry/permission assertions then passed on the hosted database inside a rollback transaction
- The single local aggregate `npm run quality` attempt was killed with exit 137 during ESLint, without a code diagnostic. Focused changed-file lint/type/tests passed; no broad local repeat is used. Exact-commit hosted CI and optimized preview build are the release gate
- Exact clean-history PR, hosted CI, preview and production verification: pending

## Deliberate implementation blockers

Remaining work is not just clicking a qualification button: implement and authorize the production connection/vault activation flow; fetch and persist current live provider/printfile facts; realize exact approved physical sizing; add durable single-claim product mutation orchestration with authoritative Stage14/current TEST checks and scoped owner approval; persist verified resource/receipt state; then qualify one real configuration without publication or paid fulfilment. The released helpers do not replace those server boundaries. Do not begin Stage16 while these Stage15 exits remain unresolved.
