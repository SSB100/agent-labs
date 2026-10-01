# Stage 16: Etsy Capability Pack

Status: Stage 16 code release is tracked in [PR 23](https://github.com/SSB100/agent-labs/pull/23), including the exact final CI and production identifiers. Full live exit OPEN. Stage 17 has not started.

## Scope and starting point

Based only on remote main `dee7943e3bada6c8db1a15b437a8a9ede1bc4d6b`, including merged PR 22's calculator form-reset correction. No historical local branch was pushed. Stage 15 foundation arrived through PR 21 (`1ea69bd2fef4a074cb3dfc9414589596dc1f8e0d`).

## Implemented

- Experimental `capability.etsy@1.0.0` registry manifest and dedicated server adapter. No generic worker mutation authority or listing-specialist worker.
- Owner-authorized OAuth authorization code flow with PKCE, single-use database state, encrypted HttpOnly browser binding and exact shop ownership. Server-side AES-GCM account envelopes bind credentials to Business and connection. Refresh reserves its attempt before dispatch; uncertainty requires reconnecting. Disconnect deletes stored access and stops unfinished work.
- API-first shop and paginated draft reads, draft creation, approved PNG uploads, product properties, integer minor-unit prices, taxonomy, shipping/processing profiles and production partners. Fixed operation surface contains no activation, orders, purchases or arbitrary URL execution.
- Durable SQL lease and revision checks; stable Business/shop/product identity; initial description reference for uncertain-creation reconciliation. Creation, uploads and property updates are recorded before dispatch. Unknown outcomes never trigger blind resends. Lost image IDs remain blocked even if rank/alt text match.
- Independent listing/image/property GET verification; pending external mappings and uncertain ActionReceipts for partial work; final verified mappings and receipts in the existing Core tables. A receipt verifies provider identities/metadata and the submitted asset hash, not Etsy's transformed binary bytes.
- Business-specific Accounts entry and `/dashboard/etsy`: connect, review eligible products, approve draft and asset sharing separately, check progress, stop and view the saved draft. Internal IDs are hidden form bindings, never owner-entered implementation fields.
- Revalidation before each mutation and completion: owner, account revision, active Goal/source workflow, exact immutable package, package expiry, one-hour maximum action approval, Stage 14 production-purpose approval and reviewed asset provenance, current verified Printful mapping and configuration receipt.

## Qualification and deliberate boundaries

There is no real Etsy draft evidence yet. No Etsy API write, publication, order or paid test was performed during this implementation. Fixtures are synthetic and never qualify upstream work.

Stage 14 still needs real research, a current reviewed TEST candidate and candidate-production asset approval. Its technical PNG result is insufficient. Stage 15 still needs live account activation, exact placement, actual product configuration, current product facts and persisted provider mappings/readback receipts. Those stages were not rewritten.

The existing generic artifact JSON is owner-editable and cannot establish package authenticity. The intake therefore requires a server-authenticated `product.package.v1` handoff (`content.etsyDraftEnvelope`) bound to Business/artifact with the Etsy vault key, plus authoritative database checks. The Stage 15 foundation does not emit this handoff. Its future qualified product executor must produce it from actual verified records; the owner must not assemble JSON or enter artifact IDs. No endpoint mints an envelope from untrusted owner fields.

Application setup is also open: registered Etsy app, exact HTTPS callback `/api/etsy/callback`, server-only `ETSY_KEYSTRING`, `ETSY_SHARED_SECRET`, `ETSY_REDIRECT_URI`, `ETSY_VAULT_KEY` and `ETSY_SERVER_KEY`, and matching SHA-256 authority in the private database table. No values belong in source, browser props, logs or handoffs. Setup must use a secure secret-management channel. Account access still requires the owner's Etsy consent; each draft requires explicit action and asset-sharing consent. A listing-write OAuth scope is broader than this application's draft-only operation surface.

An active request runs within the bounded server action. Its durable operation journal survives interruption; the owner can use “Check draft and continue” after the ten-minute lease expires. No automatic background retry is claimed. Uncertain upload identity, expired approval, revoked access or changed package remain stopped. An in-flight provider request cannot be withdrawn; cancellation preserves any resulting identity and prevents later dispatches. External manual publication is detected by readback and stops subsequent writes.

## Verification

- Initial Stage 16 production release: `1f1d339a601dd8e273f38ea2d9ecb1c562007190`, deployment `dpl_6AQBGmET4YxX9y6xfbFMmrSeAnHd` READY. Final acceptance identified and corrected a return-navigation issue for owners with multiple Businesses. Account callbacks and success/failure returns now retain the selected Business; authorization and external write scopes are unchanged. Final correction checks and deployment identifiers are linked from PR 23.
- 27 focused native-source tests passed locally: complete synthetic draft execution, duplicate replay/concurrency, invalid/stale/cross-Business packages, access revision changes, uncertain creation, partial/lost uploads, property reconciliation, cancellation, final receipt mismatch, draft-only transport, OAuth PKCE/scopes and encryption context isolation.
- `supabase/tests/stage16_etsy.sql` passed on the hosted database and rolled back all fixtures. Covers owner and secret boundaries, OAuth replay, refresh uncertainty, stale/invented packages, private-table denial, forged Core mappings, revoked access, duplicate leases, revision/history/identity guards, partial mappings, uncertainty receipts, cancellation and rejected completion.
- Migration `20261001023310_stage16_etsy_drafts.sql` applied successfully. Authority table remains empty; no account activated.
- Preview deployment `dpl_CjiDBU2vZbh53BrUJe6mFewRrcaF` is READY for code commit `7e942b0ed2670ad986725dca449b174c59c3c5ba`, including lint, TypeScript, tests and optimized build. Hosted Chromium verified desktop/mobile controls and separate native consent requirements. Server-action tests cover missing consent and a package changed after the form was displayed. The required final `npm run check` result and exact release commit are retained in PR 23. Earlier lint/compiler issues and the historical database-secret-name assertion were corrected. Local dependency installation was blocked by environment network access, not recorded as a pass.
- Draft processing profiles omitted by the listing response are independently read from inventory offerings. Missing production-partner or other required metadata fails verification; it is never filled from the requested package. Live readback compatibility remains unqualified.
- Preview HTTP checks passed: unauthenticated `/dashboard/etsy` redirects to sign-in; unconfigured `/api/etsy/callback` returns safely to sign-in without a server error. An authenticated production browser session is not available in this execution environment. The real owner/provider workflow remains unqualified; source-rendered Chromium checks are not a substitute. Database readback confirmed zero authority keys, connections, runs or remaining synthetic test users.

## API references checked

- [Etsy authentication and scopes](https://developers.etsy.com/documentation/essentials/authentication/)
- [Etsy API reference](https://developers.etsy.com/documentation/reference/)
- [Etsy listing tutorial](https://developers.etsy.com/documentation/tutorials/listings/)

## Next-stage handoff

Do not claim Stage 16 complete or begin Stage 17 until the real draft exit is evidenced. First complete the narrowly identified Stage 14/15 qualification and secure Etsy activation, approve one exact package and its data sharing, create one draft, read it back and exercise duplicate prevention. Retain all approval, cancellation and no-spend protections. Then Stage 17 can add the listing specialist under the implementation plan; public activation remains separately gated.
