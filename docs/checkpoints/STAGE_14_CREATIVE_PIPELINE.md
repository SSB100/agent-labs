# Stage 14 — Creative pipeline

Status: implementation and guarded database deployment complete; hosted UI/Storage/live technical qualification is in progress. **The full Stage 14 approved-candidate production exit is not complete.** Do not advance Stage 15 on a technical-only PASS.

## Scope

- Versioned global Creative Director, Creative Reviewer, image.generate capability and dedicated creative workflow definitions; all remain experimental
- Business-private, append-only owner approvals, Design Briefs, asset versions, actual binary inspection, review reports and cost records
- Exact approved concept, audience, art instructions, rights declaration and print-spec snapshot are pinned to the run. Owner-entered designs and generated images are not global knowledge
- Independent final-brief IP/policy screen precedes generation. Reviewer receives the actual stored PNG pixels plus scoped brief/knowledge
- One initial image and at most one repair; repair text is chosen from an exact, shared SQL/TypeScript safe-template allowlist. It cannot introduce new subjects, names or references
- Private PNG originals retain their provider provenance. Inspection verifies decoded dimensions, sRGB interpretation, physical DPI, alpha when required and SHA-256. No silent upscaling or metadata stripping
- Artifacts workspace shows private previews, exact prompts/hashes, UTC dates, version/review state and provider receipts
- Existing NEEDS_MORE_EVIDENCE decisions remain unchanged. Production approval separately requires the current persisted evidence-backed TEST; technical or simulation PASS always keeps productionReady=false and publicationAllowed=false

## Provider and cost boundary

The image adapter uses the existing OpenRouter connection with Recraft V4.1 Pro, pinned to Recraft, one square raster image per call, without reference images or fallback. Its current fixed catalog price is US$0.21 per image. Recraft's API terms address commercial output use and retention of provenance; they do not guarantee unique or non-infringing output. Original intent and ambiguous content still need review.

Creative Director uses the fixed Luna route; final-brief screen and visual review use the fixed independent Claude Haiku route. Provider/model identity and observed cost are retained even for malformed paid responses. No automatic retry or fallback is permitted. A timeout or uncertain response consumes its durable reservation. Replaying a call or identical approval cannot reset the allowance.

One bounded technical qualification has a US$1 total allowance. At verified 2026-09-30 prices, the declared maximum six-call estimate is US$0.825056: one brief, one screen, two images and two visual reviews. Each text request is limited to 24,576 serialized text bytes plus 8,192 formatting-token allowance; a visual request adds 8,192 image tokens. Brief output is capped at 2,500 tokens; screen/review output at 1,800. Current prices are checked before every call. This is a conservative estimate, not a provider-enforced invoice guarantee. It does not authorize another experiment.

Public image-price checks time out after 10 seconds, image requests after 120 seconds and Storage operations after 60 seconds. A new call requires at least five minutes of remaining capability lifetime. Accepted PNG files are limited to 7,000,000 bytes to fit the visual request envelope.

## Security boundary

Applied migration: `20260930113942_stage14_creative_pipeline`.

The specifically approved scope is seven owner-readable tables, one non-client-readable private capability table, four owner actions, one anonymous exact-secret runtime RPC and one limited boolean Storage helper. Anonymous private-schema USAGE is required for that helper. All other new function execution and direct table mutations are revoked. Private Storage allows only the active run's exact two version paths; overwrite/delete are denied. Active runtime/Storage authority expires after two hours. Owner-only recovery can close an expired run without restarting or restoring budget.

The application is owner-operated. Provider provenance is application-recorded metadata verified on the normal runtime, not cryptographic attestation against an owner who deliberately chooses a capability and fabricates their own internally consistent records. This inherited limitation permits neither cross-Business access, global worker promotion nor publication. Later autonomy may require separate server attestation.

Full interface and grants: [SQL contract](STAGE_14_SQL_CONTRACT.md).

## Verification record

- Full local check: 213 tests, lint, TypeScript, Next.js build and Workflow compilation passed
- Independent static review found no remaining authorization-boundary blocker under the stated trusted-owner model
- Review fixes covered exact repair scope, billed malformed-text receipts, returned model identity, encoded image-size compatibility and expired-run recovery
- Mocked worker tests exercise complete scoped knowledge, actual image payloads, independent reviewer route and no fallback; fixtures are not live provider proof
- Stage 14 migration and regression passed in a hosted BEGIN/ROLLBACK rehearsal
- Combined Stage 10, 11, 12 knowledge, 12 simulation, 13 and 14 rollback suites passed before and after apply
- Rehearsal corrected one PL/pgSQL block-label reference and Storage test assumptions about deletion protection and current partial/versioned unique indexes. No production records were deleted
- Actual function ACLs match four authenticated owner actions, one anonymous runtime endpoint, and one private Storage helper; remaining new functions have no client execution grant
- Security advisors: expected public definer notices increased from 17/16 to 18/20 (anonymous/authenticated). Existing leaked-password warning remains. One INFO marks the deliberately policy-less private capability table, which has no client grants
- Actual HTTP Storage upload/download and SHA-256 proof passed, including missing/wrong/foreign capability denials, no overwrite/delete and reserved-version enforcement. Terminal and naturally expired capability denial and owner-only expiry recovery also passed. Preview UI and the approved real technical image run remain pending. No full Stage 14 exit or production readiness is claimed

## Primary references

- [OpenRouter Image API](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)
- [Pinned Recraft endpoint and pricing](https://openrouter.ai/api/v1/images/models/recraft/recraft-v4.1-pro/endpoints)
- [Recraft API Developer Terms](https://www.recraft.ai/legal/developer-terms)
- [OpenRouter model pricing catalog](https://openrouter.ai/api/v1/models)
- [Claude vision limits](https://platform.claude.com/docs/en/build-with-claude/vision)
- [Printful DTG file guidance](https://www.printful.com/creating-dtg-file)
- [Printful product-specific large-front placement](https://help.printful.com/hc/en-us/articles/50263171283217-What-should-I-know-about-the-standard-15-18-print-placement-for-DTG-products)

Detailed candidate designs, account identifiers, actual provider invoices and generated files remain Business-private, not in repository closeout notes.
