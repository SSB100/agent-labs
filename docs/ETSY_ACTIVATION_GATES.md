# Etsy access and application-purpose qualification

Reviewed 2026-10-04 against the [Etsy developer overview](https://developers.etsy.com/documentation/) and [API Terms of Use](https://www.etsy.com/legal/api/) (last updated 2026-08-18). This is a conservative engineering qualification record, not a legal conclusion that all automation is forbidden.

## Current official scope distinctions

The developer overview expressly describes Seller Apps for own-shop tools, automations, reporting and workflows. It describes Personal Apps as reviewed limited-scale uses beyond one's own shop, and Commercial Access as broader multi-seller access. Commercial Access is not automatically required merely because the owner sells products. Do not infer the exact accepted purpose, shops or limits from an access-tier label, or repeat an older numeric shop limit without current evidence.

API Terms section 3 requires approval of the application purpose and updates. Sections 5(24) and 5(25) address automated access/analysis and API-content collection for analytics, machine learning or AI training, with written authorization requirements. Their relationship to ordinary runtime model inference over seller data is not resolved by an access-tier label. Compare the exact application description and matching Etsy approval before deciding whether additional targeted clarification is needed. The overview separately prohibits bypassing the API through screen scraping; a Steel browser is not a substitute permission route.

[OAuth authentication](https://developers.etsy.com/documentation/essentials/authentication/) separately establishes the consenting user and actual granted scopes. It does not establish every downstream purpose or data use. [Creativity Standards](https://www.etsy.com/legal/creativity/) separately address qualifying seller-prompted AI-created products and disclosure; they do not authorize using Etsy content in a research/model pipeline.

## Current evidence status

On 2026-10-04 at 23:41 UTC, a signed-in read-only Developer Portal inspection verified **Personal Access** and the submitted description for the existing private own-shop application. The description permits own-shop shop/listing reads and preparation/update, requires owner review before publication, and excludes other sellers. Its exact description SHA-256 is `de2f364872b136a615667bffef7c521d7eab5418da0c27f268e7d6edc56d6258`. Private account details and keys are not published here.

This is sufficient purpose evidence to prepare a bounded deterministic own-shop read qualification, subject to the actual scoped credential, server enforcement and live checks. A second blanket Etsy inquiry is not required for that narrow lane. It is not written authorization for marketplace-wide collection, Etsy-content model ingestion or publication without actual owner review.

The owner chose to leave the application description unchanged. A fixed, fully specified batch reviewed by the owner before publication may fit the current review promise; that is an implementation interpretation, not a legal determination or permission to treat a blanket allowance as review of unknown future listings. The long-term autonomous operating goal remains in the canonical plan; any material later purpose mismatch must be resolved before enabling it.

## Independent qualification lanes

- Own-shop operational reads: exact app purpose, consenting account, shop, fields, scopes, revision, expiry and retention. These may be supported without broader marketplace/AI rights; they remain unqualified here until evidence and enforcement are checked
- Marketplace research: exact sources, collection method, requested content and allowed analysis. Public visibility or a search-provider result does not establish downstream rights
- Model processing: distinguish inference, third-party model transmission, retained analysis, derived analytics, embeddings and training. Preserve exact source lineage through creative/listing derivatives
- Mutation: draft creation, upload, publication, fees, renewal, orders and fulfilment retain separate technical, envelope and commercial gates

## Current implementation boundary

The [R11 inactive contract](R11_EXTERNAL_ELIGIBILITY_CONTRACT.md) adds a pre-OAuth and lowest-transport denial boundary plus request-bound source-provenance checks. The source includes an additive, empty-by-default own-shop connection grant/custody contract. Production application and activation require separate reviewed approval. Research/model provenance remains closed with no enabling evidence producer. Source-free fixture assertions and pure evidence checks are not operational grants. Existing saved connections and financial receipts are preserved.

Safe synthetic tests and public documentation review continue. No automated Etsy research, scraping, source-model ingestion, OAuth grant, credential setup or provider write is activated. General R05/R07 source/model eligibility and separately authorized live read-only qualification remain open. A later approved own-shop lane must not inherit broader research/AI permission, or vice versa.

Product/source evidence, exact asset review, print placement, Etsy-linked variants, shop-specific fees/taxes/currency, supported fulfilment and each later operation remain separate gates. R10's fixed controlled-public browser proof does not qualify arbitrary sites or secure account registration.
