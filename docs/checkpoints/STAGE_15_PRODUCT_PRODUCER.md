# Stage 15 single-product configuration producer

Status: implementation reviewed and database installed; production activation and the full Stage 15 exit remain open. This checkpoint does not assert a provider request, configured product, physical print verification or listing-ready Product Package. Database installation and software release evidence are recorded separately below.

## Bounded implementation

One native Manual/API store, one catalog variant, one ordinary DTG front or back placement. Ecommerce mapping, file uploads, new credentials/scopes, orders, fulfilment and marketplace publication are outside this release.

- A private immutable source snapshot binds the Business, goal/workflow, current reviewed TEST, creative production approval/run, latest PASS asset version and SHA-256, original bytes, Printful connection revision/store, catalog identities, v1 file type, stock and complete explicit cost scenario, trusted provider-file lineage and placement evidence
- There is no source-registration form/RPC or owner-JSON fallback. The authenticated upload/placement producers remain absent. An enabled application server key cannot manufacture their records
- Source review/start/stop and history live in `/dashboard/printful`. Start remains disabled in both UI and server; current `catalog.read` connections are not expanded. A separate product-write authority resolver is deliberately unavailable and has no environment-switch bypass
- The durable engine claims a CAS lease, verifies source/approval and current file/asset bytes, checks the deterministic product identity is absent, then saves exactly one pre-dispatch marker. Crash, timeout, malformed response or storage uncertainty after the marker permits only GET reconciliation. Repeated starts cannot create another product
- Stop is owner-scoped and works without the application server key. Stop does not undo a sent POST. A late provider observation remains durable; source expiry/stop cannot erase it. Connection revocation prevents further provider reads
- The real bounded adapter sends only documented native-product POST fields and fixed GET endpoints. It reauthorizes every call, prohibits redirects and automatic retries, bounds deadlines/response sizes, rejects overbroad scopes, and redacts provider bodies/credentials
- Independent store, product and file GETs can establish identity/association and trusted uploaded-byte lineage. They do not prove physical position or technique. This implementation can persist an `uncertain` receipt and a `pending` `product_configuration_observation` resource only; the action never becomes completed
- New association `providerFactsHash` is distinct from the upstream catalog/stock/cost snapshot hash and Stage 17's complete `productFactsHash`. No listing facts/package are minted and no old receipt is rewritten

Fixture execution uses `mock.printful`, creates no external resource and cannot pass SQL live-source gates. Synthetic rendering/contract tests are not provider qualification.

## Why physical qualification remains gated

The documented v1 SyncVariantFile accepts an existing provider file ID and catalog-supported file type. Its product/file GET readback exposes file identity, MD5, processing status and pixel metadata, but does not expose numeric physical layout or a technique field. `File.hash` is MD5, not the approved asset SHA-256. A synced variant or a successful POST is insufficient evidence.

A concrete future compatible producer should:

1. Resolve the exact catalog variant and DTG placement to its current printfile geometry with `GET /mockup-generator/printfiles/{productId}?technique=DTG`, retaining dimensions, DPI, fill mode, rotation policy and provenance
2. Compile a full-area transparent PNG while preserving explicit original-to-derived SHA-256/MD5 lineage, canvas geometry and the approved artwork rectangle. A no-resampling first version must require integral canvas pixels/offsets at the source-derived DPI, with no silent rounding, stretch or upscale
3. Retain authenticated upload/generation evidence for the derived bytes and the resulting provider file. A caller-supplied file ID/hash cannot replace that producer
4. Establish a documented provider path that preserves the geometry, then independently bind that path's result to the actual store product and variant

The ordinary native-file path does not document a guarantee that transparent borders are preserved without trimming/repositioning. Compiled canvas geometry and a visually correct mockup therefore cannot by themselves assert final physical configuration.

Printful's Embedded Design Maker flow explicitly uses generated production printfiles for native sync products with `sync_product.source="edm"`. It is a genuine production-file route, but requires enterprise access, and v1 template detail still lacks numeric layer layout. Do not assume access or relabel arbitrary uploaded artwork as an EDM production file.

A possible future independent readback is v2-preview My Products: resolve the v1 sync product through `store_product_ids` and `published_to_stores`, then read its variants' placements/layers/position. The published preview schema is `2.0.0-alpha.2`; v2-beta still lists product management as unavailable. Availability and exact ID correspondence need a separately authorized capability probe. Never guess that v2 product IDs equal v1 sync IDs.

Truthful finished-product mockups/provenance and the authenticated Stage 17 full-factual-basis handoff are later work. Technical artwork is not a product mockup.

## Primary references reviewed 2026-10-01

- [Products API](https://developers.printful.com/docs/#tag/Products-API)
- [File Library API](https://developers.printful.com/docs/#tag/File-Library-API)
- [Printfile geometry](https://developers.printful.com/docs/#operation/getPrintfiles)
- [Mockup task results: mockups versus production printfiles](https://developers.printful.com/docs/#operation/getTask)
- [V1 product template readback](https://developers.printful.com/docs/#operation/getProductTemplateById)
- [EDM access and sync-product flow](https://developers.printful.com/docs/edm/#tag/Example-flow/Create-sync-product)
- [V2-preview My Products](https://developers.printful.com/docs/v2-preview/#tag/My-Products-v2)
- [V2-beta retired-resource limitations](https://developers.printful.com/docs/v2-beta/#tag/Retired-Resources)

## Verification and release

Focused transport, engine, server and UI tests cover exact scope/source hashes, key-order persistence, missing stock/cost/placement provenance, pre-dispatch markers, concurrent starts, cancellation, expiry/revocation, uncertain responses, delayed observations, atomic receipt failure and safe unavailable states. The final test counts, independent review, SQL preservation and exact hosted release gate are recorded when complete.

Hosted SQL installation is verified below. No provider request, upload, key configuration, scope expansion, paid call, order or Etsy publication was performed to implement this slice.

### Reviewed release candidate and hosted installation

- Clean remote ancestry: `d752486f85d58906ff4dbf26b506b7d08e02e8ea`
- Full final local test run: 1,044 tests, 1,038 passed, zero failed, six existing browser-only checks skipped in this executor. The new isolated SQL test was explicitly enabled and passed
- Full lint and TypeScript checks passed. Hosted optimized build is the final software release gate
- Independent execution/security review resolved four findings: upstream/readback fact-hash domain mismatch; incomplete source-review projection; unrelated invoker Core-write regression; late Stop/approval/lease/TEST change while credential authorization awaited. The final request fence now runs after authorization and before each provider dispatch; the independent cancellation reproduction produced zero POSTs
- Needs You loads exact owner-scoped, workflow-independent Printful reconciliation requests and links the saved attempt. Missing/partial reads remain unavailable rather than reporting a falsely empty queue
- The cloud browser could not open the local synthetic UI fixture (`ERR_BLOCKED_BY_CLIENT`). Static React render and action/queue tests passed; authenticated/browser visual acceptance is not claimed
- Migration was applied with explicit owner approval and native confirmation at 2026-10-02 00:42:56 UTC, recorded as `20261002004256_stage15_product_configuration`. All existing function/table/trigger metadata and row counts were preserved; six new private tables are empty and deny application-role access. SQL bytes are unchanged. SHA-256: `46088d3246608419c861a6e88979f6d3aec467d6b93a6b31599102d21cfba62f`. See [exact database contract](STAGE_15_PRODUCT_SQL_CONTRACT.md)
- [PR36](https://github.com/SSB100/agent-labs/pull/36) initial exact-head CI passed: 1,044 tests, 1,043 passed, zero failed, one explicitly skipped opt-in SQL test; the same SQL suite separately passed 7/7 locally. Optimized build passed in [run 36940355933](https://github.com/SSB100/agent-labs/actions/runs/36940355933)
- Preview deployment was READY and its unauthenticated Printful route correctly required owner sign-in
- The post-install commit changes only the migration filename and this installation evidence. Final exact-head hosted gate, merge and production verification remain the release steps; database installation does not qualify live provider behavior
