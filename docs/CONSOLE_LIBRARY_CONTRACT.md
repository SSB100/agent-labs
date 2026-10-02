# Bounded Library read contract

This is the Library continuation of R02 in the [remaining implementation plan](AGENT_LABS_V2_IMPLEMENTATION_PLAN.md). It covers Designs, saved Records and exact creative-run history. Research, the remaining protected operational workspaces, canonical Quest identity and learned Knowledge remain separate work. Source presence is not release acceptance.

## Reads and identity

- Designs and Records use fixed 25-row server pages plus one sentinel, exact counts and timestamp/ID ordering. Count failures, response caps, corrupt rows and failed reads stay incomplete or unavailable. Selection is independent of page and filters.
- Design search covers the saved prompt. Record search covers the saved name, with persisted MIME/type filters. Neither promises full-content search.
- Lists omit inspection, snapshots, phase JSON, review JSON, costs and artifact content/metadata. An exact selection reads that record's evidence separately. Artifact schema versions are not artifact revisions; the absent revision remains unknown.
- Creative history uses its own `creativeRun` query identity. It is designs-only and mutually exclusive with asset `selected` and the retained Records `artifact` alias. Work run IDs, creative run IDs, asset IDs, approval IDs and artifact IDs are never interchangeable.
- Exact creative history verifies the owned Business, creative run, approval, workflow backlinks and approval hash, plus the saved `etsy.creative-pipeline` definition at version `1.0.0`. It reads at most two assets/reviews and six admitted phase/cost keys with exact counts. A failed paid run with no asset remains inspectable with its charges.
- Definition visibility remains governed by existing RLS. Retired or otherwise unreadable definitions make exact creative context unavailable; this view does not grant historical-definition access or substitute another version.
- Missing context cannot invent zero spend, an absent receipt, a current worker or successful production. A saved terminal `needs_owner` execution is displayed as stopped using its validated completion timestamp.

## Private previews and saved files

- Existing owner-session storage signing is limited to at most 26 unique canonical normalized PNG paths per render: 25 visible designs plus an independently selected off-page design. The sentinel and original WebP are not signed in bulk.
- Returned preview URLs must match the configured storage endpoint, bucket and exact normalized object path. A response's echoed path is not enough to authorize an unrelated URL. Signed URLs stay in their intended private image/link; they are not logged or sent through a shared optimizer.
- Exact selected preview context fails closed on unavailable/foreign reads or contradictory provenance. A missing optional legacy artifact pointer does not itself erase an otherwise owned asset or run. It removes the exact Work artifact link; verified run navigation can remain.
- Provenance must agree with the immutable asset hash/path, saved inspection and PNG/WebP normalization contract. Unavailable provenance stays unknown. Preview access does not qualify a commerce file, supplier placement or listing.
- An image that expires or fails after rendering gets an explicit unavailable fallback. There is no automatic retry or provider work. Reload can obtain fresh owner-session access through the existing read contract.
- Saved MIME type and opaque storage references do not establish a download or PDF renderer. Records show exact selected saved content/metadata safely; no arbitrary path becomes a clickable download.

## Presentation and continuity

- Desktop 1280×720 and 1440×900 require one document viewport, compact paged rows, contained detail content and visible frequent controls. Narrow/zoom layouts use readable reflow and 44-pixel controls.
- Long names use short visual summaries with full keyboard-accessible identities. Design detail keeps original artwork, independent visual review, print-file checks, saved approval, ProductTEST and listing/publication readiness distinct.
- Exact run detail prioritizes stopped/failed state, missing-asset meaning and known/unknown charges before IDs and technical snapshots. No inspection, visual PASS or expired approval authorizes another attempt.
- Native GET filters, page, sort, selected identity, disclosures and compatible reading positions survive Back/reload. Exact selected Business scopes onward navigation and research setup without narrowing an aggregate collection silently.
- Library browse and inspection do not load a research quote, start work or submit an approval. The command bar opens the existing explicit research review flow only when requested.
- Accepted Decisions `decision` and Connections `connectionRun` action/return contracts stay separate.

## Verification and limits

Tests use real source readers and root components against inert synthetic owner transports with two Businesses, 125+ records, long/duplicate names, old/off-filter selection, paid failures without assets, unknown costs, malformed/capped/foreign reads and signed-response tampering. Provider, credential, mutation, runtime RPC and external network paths are denied. Hosted images are labelled synthetic and do not prove live provider qualification.

Retained component/native-history tests are not proof of real Next RSC, route-cache or server-action interruption behavior. That broader transport gate remains R03. Private commerce histories and any future schema, index, RLS or permission changes remain separately reviewed work. This slice introduces none of those changes.

The outer owner Business directory still uses the existing context loader. Two-Business qualification does not prove completeness above that directory's API response cap; its independently counted paging and exact-owner selection are explicitly assigned to R06. Collection counts here are exact within the supplied authorized Business scope.
