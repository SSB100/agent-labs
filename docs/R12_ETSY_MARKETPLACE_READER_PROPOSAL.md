# Etsy active-listing research: inert reader and integration proposal

Date: 2026-10-12. Base: `374788383d1dfad7e1199dbcb6e5840ebe5dc5ba`.

## Delivered scope

`src/etsy/marketplace-research.ts` is an **unwired integration seam**, with synthetic tests. There is no server action, route, worker registration, credential lookup, migration, grant, paid call or live Etsy request in this change. The isolated branch has Vercel deployment disabled. The paused larger-prose, automatic-continuation and expired-Goal changes remain separate; this branch does not claim to fix those outstanding runtime issues.

The reader reuses `etsyJson`, retaining its 15-second deadline, 2,000,000-byte response ceiling, fixed first-party origin, redirect rejection, redacted errors and no automatic retry. It additionally:

- Builds exactly one `GET /v3/application/listings/active` with agent-chosen keywords, an explicit limit from 1 to 100, offset 0 and relevance sorting. No hidden pagination, arbitrary host, query parameters or write operation.
- Requires an injected transport and a new `marketplace.active-listings.read` admission callback before sending anything. There is no default global fetch. Existing own-shop grants do not authorize this new operation.
- Snapshots the request, tenant/Goal/operation identity and executing release across asynchronous admission. The injected trusted admission must check ownership, approved purpose, data/query policy, release qualification, atomically counted operation, Stop, expiry and rate/call allowance. These database checks are **not implemented by this isolated reader**.
- Uses application-key authentication only. It neither requests OAuth scopes nor refreshes tokens. Secrets are absent from the admission descriptor and result.
- Retains only listing ID, title, tags, taxonomy ID and advertised price in exact integer amount/divisor/currency form. No descriptions, designs/images, user/shop identity fields, shipping/contact data, quantity, favorites or views are projected. The API may return extra fields transiently; the reader discards them rather than persisting or transmitting them to a model.
- Preserves whole selected fields. Malformed/duplicate listings, a result page larger than requested or transport overflow fail explicitly; nothing is silently truncated or presented as an empty result.
- Returns the exact query/endpoint, request hash, retrieval timestamp, executing release and canonical projection hash. That hash covers the minimal projection, **not** the raw response bytes. It is provenance, not authority or independent verification of seller claims.

Listing titles/tags are untrusted seller-authored text, including possible instructions. The reader does not follow embedded links or execute text. A future model integration must preserve the existing untrusted-evidence boundary and must not treat projected text as system instructions.

The API's matching-listing count, returned-listing count, model-generated candidate count, search-call count and research-pass count are different quantities. One search returns **up to** 100 listing records, not 100 candidates or guaranteed independent sellers. Active listings describe a supply/competition sample. Neither their existence nor Etsy's matching count proves demand, sales, profit, POD suitability or representative coverage. Advertised price is not a landed-price or margin calculation. This minimal projection cannot establish seller independence because it omits shop identities.

## Verified endpoint and current app scope

Official sources inspected 2026-10-12:

- [Etsy endpoint reference](https://developers.etsy.com/documentation/reference/#operation/findAllListingsActive): application-key authentication; keywords; limit 1–100; offset and relevance sorting.
- [Etsy request standards](https://developer.etsy.com/documentation/essentials/requests/): `api.etsy.com` and `openapi.etsy.com` are equivalent, and the keystring/shared-secret header is required.
- [Etsy money definition](https://developers.etsy.com/documentation/essentials/definitions/): retain the integer amount, divisor and currency instead of assuming every currency divides by 100.
- [Etsy API terms](https://www.etsy.com/legal/api/): section 3 governs approved purpose/updates; section 5(24–25) addresses automated analysis and analytics authorization. The listing-display freshness requirement is six hours; storage is limited to what is reasonably necessary for the service. A six-hour display rule is not blanket permission for indefinite source retention.

Read-only inspection of the signed-in developer portal confirmed **Kindred Studio Manager**, Personal Access, 5 QPS / 5K QPD, for the owner/colleagues, not commercially offered. The owner states that Etsy approval exists. The visible registered description covers management of StudioKindredStore, listing preparation/updates and owner review before publication. “Not offered to other sellers” describes the app's audience; it does not itself prohibit reading other sellers' public listings. Personal Access alone is not the blocker. The concrete unverified extension is automated marketplace comparison and forwarding minimal listing content to model services, beyond the visible description. No purpose change or external inquiry has been submitted.

The existing `shops_r`/`listings_r` connection and its own-shop purpose cannot be reused as evidence approving this separate marketplace-analysis purpose. A new app, duplicate key, browser scraper or broader OAuth scope is not proposed. Confirming this purpose on the existing app is the smallest external resolution if it is not already covered by Etsy's approval.

## Proposed app-purpose wording, for owner review only

> Private application for managing my own Etsy shop, StudioKindredStore, and researching print-on-demand product opportunities for that shop. It uses agent-selected keywords to retrieve up to 100 public active listings per API request. Minimal public product fields, including titles, tags, categories and advertised prices, are processed through OpenRouter using Azure/Amazon Bedrock model routes for comparison and review. Listings are treated as competition evidence, not proof of sales or demand. It does not request customer or private seller data, is not offered to other sellers, and requires my review before publication.

This is a proposal for review, not a claim that the expanded purpose or recipients are already approved. No external draft or submission has been made.

**Retention must be finalized honestly before submission/activation.** The run needs source snapshots throughout research/refinement and receipt reconciliation. The existing product retains full model outputs and source-bearing history for audit; blindly reusing those immutable full-content records for Etsy content would not establish compliant retention. The reader itself stores nothing. The next integration must provide expiring listing-content artifacts, prevent stale listing display, and retain non-content operation/cost/hash audit records separately. It must account for listing text quoted or paraphrased into model output and for the actual retention/training terms of each model recipient. A precise deletion interval, purge mechanism and later-report behavior have not yet been implemented or approved; do not promise deletion after a made-up interval. Existing historical records must not be rewritten to pretend this control existed earlier.

## Smallest integration into the existing runtime

No new research engine or general permission framework is required. Extend the existing five-phase POD pipeline and R05/R07 admission, with a new immutable source contract/template rather than changing old grants:

1. **Plan:** the existing planner receives the general POD-on-Etsy goal and bounded prior critique. It chooses keyword queries/candidate directions itself. There is no fixed product shortlist. Its output chooses keywords and result count within the approved category; routine query changes do not require owner enrollment again.
2. **Search:** replace the Exa-backed `search1` dispatch with this one Etsy active-listing GET. One GET consumes one search slot and one external-call slot, including a dispatched failed read under the reviewed counting policy. It does not also issue an Exa request or hidden model call. API-key custody remains server-only. Check actual Etsy billing/rate conditions rather than inventing a paid fee or assuming unlimited free reads.
3. **Select evidence:** reuse `select1` to select exact listing/field references from the permitted projection. Source IDs must remain distinct across passes. Store the complete permitted snapshot only for the approved retention interval. Model context uses whole records that fit the actual context/output reservation, with selected and omitted IDs/counts disclosed; never silently truncate quotes or claim that all 100 listings were reviewed if only a subset was supplied. Source text remains untrusted.
4. **Assess:** reuse `strategy`, allowing the expanded prose capacities once consistently qualified. Assess competition, differentiation, POD feasibility and missing demand/economics evidence separately. Available listing data must not be upgraded into proven sales, search volume or viability.
5. **Independent review and continuation:** reuse `review`. A valid insufficient-evidence review supplies critique and a changed query for the next pass automatically within the same allowance. Relevant new keyword/taxonomy coverage is useful; repeated listings must be identified, and domain diversity cannot be falsely claimed when every source is Etsy. Invalid-format output remains rejected and counted; the pending receipt-bound failure-continuation path must permit a fresh pass without accepting or rewriting the failed review. Stop must win over continuation, and already-sent operations remain reconcilable.

The existing `discovery-r12-pod-goal`, `-analysis`, `-runtime`, `-packs`, `-owner-contract`, quote builder and reviewed SQL admission/template are the concrete integration sites. They currently pin a general-web source policy and model-search response contract; importing this reader alone cannot satisfy those pins. The web-policy Etsy exclusion remains unchanged on this branch. There must be no browser or general-web fallback disguised as Etsy marketplace results.

Carry forward the same goal/authority history: original USD10 total; USD0.028912 already spent, one executed pass, five calls and one search. The maximum remainder is **USD9.971088, four passes, 20 external calls and four searches**, not a new USD10 allocation. Four model calls plus one Etsy GET can preserve the five-call-per-pass ceiling. Fresh quotes must use actual model routes, bounded serialized inputs/output allowances and atomic maximum-cost reservations. Four maximum-capacity passes are not promised to fit; useful work may stop earlier. The old USD0.025 Steel liability stays fully reserved separately. No grant cutoff is extended automatically.

The expired-Goal correction must be consolidated atomically with the final contract: a new owner-approved current Goal revision, preserving the historical deadline/policies and unchanged cumulative budget. It is not included here.

## Acceptance and remaining gates

Focused synthetic qualification for this branch covers 100 whole records, query encoding/Unicode, projection/provenance, no OAuth header, tenant/Stop/expiry/duplicate callback denials, admission-time mutation, empty/malformed/oversized results, 401/403/404/429/500/redirect errors and one timeout with no hidden retry. Callback tests prove the reader respects admission; they do **not** prove a durable SQL gate that has not been integrated. Existing Etsy transport/OAuth regression tests are retained.

Before live use, one coherent end-to-end acceptance must exercise the actual updated owner/Workflow/SQL path: expired current Goal, fresh bounded remaining-only approval, weak first-pass evidence, independent reviewer confirming the gap, autonomously revised Etsy query, different admitted listing evidence in the next pass, reasonable long prose, invalid-format recovery without accepting invalid output, Stop, duplicate prevention and cumulative call/cost limits. Synthetic fixtures are test inputs, never the user's research result.

Publication of this isolated branch is a code checkpoint only. Full release CI, a reviewed migration/template/retention bundle, current recipient/rate evidence, exact activation approval and an actual app-generated result remain separate gates. There is no live-research readiness claim.

### Local checkpoint qualification

Runtime: Node `v22.23.3`, repository TypeScript/ESLint dependencies; no installs or provider calls.

- `tsc -p tsconfig.core-tests.json`: passed.
- `node --test tests/etsy-marketplace-research.test.mjs tests/etsy-boundaries.test.mjs`: **27 passed, zero failed/skipped** (14 new reader tests and 13 retained Etsy boundary regressions).
- `tsc --noEmit`: passed.
- Focused ESLint for the new source/test, zero-warning threshold: passed.
- `git diff --check`: passed.
- Independent review identified a malformed-header secret-echo edge case and a weak inertness assertion. Both were corrected with regression coverage before publication.
- Full repository test suite/CI, browser UI, native SQL, live API and deployment checks: **not run for this inert checkpoint**. No readiness claim follows from the focused checks.
