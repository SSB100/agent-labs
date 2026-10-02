# Stage 15 saved-designer qualification contract

Scope clarification, 2026-10-02: this checker remains a native Manual/API-store qualification contract. It does not qualify the [intended Etsy-linked selling topology](ETSY_PRINTFUL_TOPOLOGY.md), link an Etsy purchasable variant or authorize an owner to bind a temporary store to the selling Business. Reuse of evidence contracts for the proposed linked-store route requires explicit verification of that route, not relabeling native results.

Status: schema-free offline candidate checker. No account-specific Printful route is qualified, no provider execution is enabled, and no security/Storage migration is included. PR36's disabled execution and immutable pending observations are unchanged.

## Why this is the next bounded step

Printful documents an ordinary Manual/API-store route, numeric Design Maker transforms, reopening a saved product's individual variant, and downloading that product's mockups. This route does not require assuming enterprise Embedded Design Maker access. It still needs account-specific qualification before implementing a larger durable producer.

The important missing facts are the units and coordinate origin of the numeric controls; whether they describe artwork or a transparent canvas; exact saved variant/file/DTG identity; and whether save/reopen introduces rounding, cropping or resampling. A screenshot-estimated position is insufficient. Templates and store products do not stay synchronized, so a reopened template is insufficient too.

Ordinary mockup-generator requests contain requested geometry, but their task results do not independently establish that a saved native product uses it. A real downloaded product mockup can be evidence of digital configuration and finished-product imagery; it cannot prove the accuracy of a physically printed item.

## Executable local checker

`src/printful/designer-qualification.ts` checks a candidate evidence bundle against one exact expected Business/connection revision/store, current-production lineage references, approved original PNG hash/pixels, catalog variant, DTG front/back and numeric layout. It structurally validates and fully decodes bounded static sRGB PNG artwork and PNG mockups, computes separate SHA-256 and MD5 hashes, and checks independent upload/product/reopened-design/mockup capture bindings and chronological order. Select a PNG standard mockup for this first probe; other formats are explicitly unsupported rather than silently converted.

Numeric physical distances are decimal strings, normalized with integer nanometres. Inches, centimetres and millimetres are supported without tolerance-based acceptance. Unknown units, percentages, screenshot estimates, missing origins, canvas-only bounds, rotations, multiple layers and altered/rounded geometry fail closed. This initial contract accepts original artwork only; it does not compile or silently substitute a derived full-area canvas.

```sh
npm run pretest
node scripts/check-printful-designer-probe.mjs --help
node scripts/check-printful-designer-probe.mjs candidate.json approved-artwork.png downloaded-mockup.png
```

The bounded JSON file contains exactly `expectation` and `candidate`; their TypeScript contracts are exported beside the checker. Tests include clearly synthetic complete and incomplete examples. The CLI reads only those three local files and makes no network requests. Exit 0 means **candidate contract satisfied**, not live qualification. Exit 1 means a required check failed; exit 2 means the local inputs or compiled checker were unavailable.

Every report retains `liveQualified:false`, `capturesAuthenticated:false`, `configurationVerified:false`, `physicalPrintVerified:false`, `sourceIssuanceAllowed:false`, `listingReady:false` and `executionAuthorized:false`. Capture hashes, timestamps, lineage IDs and visual-review statements supplied in JSON are not authenticated by this tool. It does not inspect database freshness, attest a browser session, semantically validate a review statement, issue a product source, or mint a receipt. A complete synthetic bundle never becomes production evidence.

## Account-specific probe acceptance

A future trusted runner/reviewer must establish these facts from actual authorized execution, then use the checker as one part of its verification:

1. Revalidate the same Business's current reviewed TEST, candidate-production approval, latest PASS creative asset and rights/sharing authority. Download the approved original privately and verify its SHA-256/pixels; technical qualification artwork is ineligible
2. Independently verify the exact Manual/API store, connection revision and narrowly approved operations. Reload them before every external step
3. Upload only those approved bytes once. Independently GET the provider file and match MD5, dimensions, PNG type, successful processing and persistent identity. A returned file ID alone is insufficient
4. Create one native product containing one exact variant with one DTG front/back placement. Record the external IDs and exact file association. Do not add an ecommerce listing, order, premium asset or extra variant
5. Save the approved layout once, leave the designer, then independently reopen that actual saved store product and variant. Capture visible numeric size/offset/print-area units, origin, artwork bounds, technique, file and variant identity. Reject unknown fields, inferred units, estimated coordinates or discrepancies
6. Download one standard mockup from that saved product after readback. Verify its original downloaded bytes and exact product/variant/design provenance. An independent reviewer must inspect the actual image and substantiate that it depicts the selected finished product, color/design/placement and artwork, rather than a raw design or generic placeholder
7. On uncertain upload/create/save/download, retain the evidence and reconcile the saved identity. Do not retry a mutation blindly. A missing required field ends the probe with its exact blocker

This confirms at most a digital configuration route. Physical print accuracy requires a separately approved produced sample and is never asserted by this checker or a mockup.

## Approval bundle to complete after the account exists

Before asking for execution, replace every unresolved item with actual values and show the owner:

- Exact Business, verified Printful account/Manual/API store, connection revision, product/catalog variant and front/back DTG placement
- Current reviewed candidate/production approval, artwork name/version, exact SHA-256, file byte size/pixels, intended physical width/height/offset, units and print-area bounds
- Data shared with Printful: that one artwork file and the specified product name/variant/layout. Data processed by a browser provider: the explicitly disclosed designer session and visible product configuration; no automated credential entry
- Maximum actions: one file upload, one native product creation, one design save, one standard mockup download; one variant/store; no automatic retries. No orders, marketplace publication, premium graphics, subscription changes or paid samples
- At most one 15-minute browser session. Present the actual provider, current entitlement, recording/logging behavior and a fresh all-in monetary ceiling/currency before any paid session. No browser amount is preapproved by this document
- How sign-in will be handled securely, which approved account-bound session will be used, and what happens if login, CAPTCHA, fresh consent or unknown charges appear. Stop rather than broadening scope
- Exact stop conditions and the fact that an already sent mutation may remain in Printful; Stop is not deletion or rollback. Do not delete uncertain artifacts to hide a partial outcome

Persistent credentials, scopes and authenticated browser access require their separate action-time approval. The existing `catalog.read` token cannot authorize these writes.

## Browser provider boundary

The general runtime selects Steel; `/api/health` reporting `browserProvider:configured` only checks that configuration. The historical Stage8 qualification does not qualify authenticated Printful design operations. Recorded Steel sessions must not handle credentials or OAuth secrets.

The Accounts-only Browserbase transport is a separate recording/logging-disabled signup-preparation and owner-handoff path. It creates no reusable authenticated context and never reconnects after secret entry. The general Browserbase adapter remains a stub. Neither adding Browserbase configuration nor reusing signup state supplies a safe authenticated designer route. Qualify the precise session boundary before the probe; no provider needs to be activated merely to run this local checker.

## Later schema decision, only after route qualification

If the probe proves the required saved fields, the durable producer will need a narrowly reviewed additive run/operation/evidence lane, separate asset-operation authority, immutable private media storage and versioned trusted source/finalization. Derived production files must retain original-to-derived lineage. Finished-product mockups need their own Stage16/17 provenance path; they must never impersonate `creative-assets/.../version-[12].png` or rewrite old product receipts. No such migration is included here.

## Offline verification

The focused suite passes 188 tests with zero skips. It covers both placements, fixture/candidate modes, immutable no-authority results, exact file/variant scope, PNG integrity/APNG/truncation, SHA-256 versus MD5, exact in/cm/mm geometry, missing numeric controls, capture independence/order, raw-art substitution, review bindings, full candidate fingerprints, bounded JSON and CLI exit/error/FIFO behavior. Full TypeScript and lint pass. Independent review reproduced and verified fixes for case-variant UUID reuse, blocking FIFO opens and array-to-string coercion. These are offline tests; the account-specific acceptance and external-action approvals above remain open.

## Official sources checked 2026-10-02

- [Manual/API-store behavior](https://help.printful.com/hc/en-us/articles/50262225690257-How-do-I-create-and-use-a-manual-order-API-store)
- [Saved product and per-variant editing; mockup downloads](https://help.printful.com/hc/en-us/articles/50263347540113-How-do-I-edit-products-published-to-my-store)
- [Numeric Design Maker transforms](https://help.printful.com/hc/en-us/articles/50264129164305-How-can-I-transform-a-design-in-the-Design-Maker)
- [Templates do not stay synchronized with store products](https://help.printful.com/hc/en-us/articles/50263591495185-What-s-a-product-template-and-how-does-it-work)
- [Mockup limitations](https://help.printful.com/hc/en-us/articles/50264186389393-What-are-mockup-images)
- [V1 mockup API](https://developers.printful.com/docs/#tag/Mockup-Generator-API)
- [Enterprise EDM bridge](https://developers.printful.com/docs/edm/#tag/Example-flow/Create-sync-product)
