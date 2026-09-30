# Stage 14 — Creative pipeline

Status: implementation and guarded database deployment, including final owner-approval and terminal-eligibility hardening, are complete. Hosted UI/live technical qualification is pending; zero-paid Storage verification passed. **The full Stage 14 approved-candidate production exit is not complete.** Do not advance Stage 15 on a technical-only PASS.

## Scope

- Versioned global Creative Director, Creative Reviewer, image.generate capability and dedicated creative workflow definitions; all remain experimental
- Business-private, append-only owner approvals, Design Briefs, asset versions, actual binary inspection, review reports and cost records
- Exact approved concept, audience, art instructions, rights declaration and print-spec snapshot are pinned to the run. Owner-entered designs and generated images are not global knowledge
- Independent final-brief IP/policy screen precedes generation. Reviewer receives the actual stored PNG pixels plus scoped brief/knowledge
- One initial image and at most one repair; repair text is chosen from an exact, shared SQL/TypeScript safe-template allowlist. It cannot introduce new subjects, names or references
- Private PNG originals retain their provider provenance. Inspection verifies decoded dimensions, sRGB interpretation, physical DPI, alpha when required and SHA-256. No silent upscaling or metadata stripping
- Artifacts workspace shows private previews, exact prompts/hashes, UTC dates, version/review state and provider receipts
- The visible cost ledger joins durable reservations with settlements. Missing receipts and unknown charges remain visible after run expiry; settled charges are not added to their reservations twice. Failed ledger reads are explicitly unavailable rather than presented as zero spend
- A separate owner production-approval form accepts only current, fresh evidence-backed TEST candidates. Candidate identity and assessment are fetched server-side; explicit rights, eight source-linked policy/IP screens, print specification and a separate creative allowance are required
- Existing NEEDS_MORE_EVIDENCE decisions remain unchanged. Production approval separately requires the current persisted evidence-backed TEST; technical or simulation PASS always keeps productionReady=false and publicationAllowed=false

## Provider and cost boundary

The image adapter uses the existing OpenRouter connection with Recraft V4.1 Pro, pinned to Recraft, one square raster image per call, without reference images or fallback. Its current fixed catalog price is US$0.21 per image. Recraft's API terms address commercial output use and retention of provenance; they do not guarantee unique or non-infringing output. Original intent and ambiguous content still need review.

Creative Director uses the fixed Luna route; final-brief screen and visual review use the fixed independent Claude Haiku route. Provider/model identity and observed cost are retained even for malformed paid responses. No automatic retry or fallback is permitted. A timeout or uncertain response consumes its durable reservation. Replaying a call or identical approval cannot reset the allowance.

The pending bounded technical qualification uses the shared US$1 total allowance for all future tests. That pool is reserved for this test until its known and uncertain charges are reconciled; it is not an additional per-test allowance. At verified 2026-09-30 prices, the declared maximum six-call estimate is US$0.825056: one brief, one screen, two images and two visual reviews. Each text request is limited to 24,576 serialized text bytes plus 8,192 formatting-token allowance; a visual request adds 8,192 image tokens. Brief output is capped at 2,500 tokens; screen/review output at 1,800. Current prices are checked before every call. This is a conservative estimate, not a provider-enforced invoice guarantee. It does not authorize another experiment.

Public image-price checks time out after 10 seconds, image requests after 120 seconds and Storage operations after 60 seconds. A new call requires at least five minutes of remaining capability lifetime. Accepted PNG files are limited to 7,000,000 bytes to fit the visual request envelope.

## Security boundary

Applied migrations: `20260930113942_stage14_creative_pipeline` and `20260930130626_stage14_terminal_eligibility_guard`.

The specifically approved scope is seven owner-readable tables, one non-client-readable private capability table, four owner actions, one anonymous exact-secret runtime RPC and one limited boolean Storage helper. Anonymous private-schema USAGE is required for that helper. All other new function execution and direct table mutations are revoked. Private Storage allows only the active run's exact two version paths; overwrite/delete are denied. Active runtime/Storage authority expires after two hours. Owner-only recovery can close an expired run without restarting or restoring budget.

The application is owner-operated. Provider provenance is application-recorded metadata verified on the normal runtime, not cryptographic attestation against an owner who deliberately chooses a capability and fabricates their own internally consistent records. This inherited limitation permits neither cross-Business access, global worker promotion nor publication. Later autonomy may require separate server attestation.

Full interface and grants: [SQL contract](STAGE_14_SQL_CONTRACT.md).

## Verification record

- Full local check after owner-approval UI hardening: 217 tests, lint, TypeScript, Next.js build and Workflow compilation passed. Hosted terminal-race checks passed before and after the narrowing migration
- Cost-display regression coverage includes pending reservations, known and unknown receipts, expired runs, composite run/call matching, late read snapshots and conservative max(reservation, reported charge) accounting. Offline tests execute the actual loader and server-rendered page with mocked queries, including each failed ledger read, both failures, run-read failure and a genuinely empty ledger. This changes only owner-readable display logic, without schema, grants or provider execution changes
- Full local check after cost-display hardening: 232 tests, lint, TypeScript, Next.js build and Workflow compilation passed. Hosted browser verification remains blocked; offline server-render tests are not a substitute for that live check
- Independent static review found no remaining authorization-boundary blocker under the stated trusted-owner model, including the final owner-production UI and terminal revalidation patch
- Review fixes covered exact repair scope, billed malformed-text receipts, returned model identity, encoded image-size compatibility and expired-run recovery
- Mocked worker tests exercise complete scoped knowledge, actual image payloads, independent reviewer route and no fallback; fixtures are not live provider proof
- Stage 14 migration and regression passed in a hosted BEGIN/ROLLBACK rehearsal
- Combined Stage 10, 11, 12 knowledge, 12 simulation, 13 and 14 rollback suites passed before and after both applied migrations
- Terminal tests cover newer REJECT/NEEDS_MORE_EVIDENCE, approval/print-source expiry, repair-review eligibility changes and capability expiry during persistence. Paid receipts/assets are retained when eligibility changes; hard capability expiry rolls back late writes. One rehearsal corrected a transaction-stable-clock fixture assumption without changing production recovery semantics
- Runtime function owner, SECURITY DEFINER setting, empty search path and exact ACL remained unchanged after the terminal guard
- Rehearsal corrected one PL/pgSQL block-label reference and Storage test assumptions about deletion protection and current partial/versioned unique indexes. No production records were deleted
- Actual function ACLs match four authenticated owner actions, one anonymous runtime endpoint, and one private Storage helper; remaining new functions have no client execution grant
- Security advisors: expected public definer notices increased from 17/16 to 18/20 (anonymous/authenticated). Existing leaked-password warning remains. One INFO marks the deliberately policy-less private capability table, which has no client grants
- Actual HTTP Storage upload/download and SHA-256 proof passed, including missing/wrong/foreign capability denials, no overwrite/delete and reserved-version enforcement. Terminal and naturally expired capability denial and owner-only expiry recovery also passed. Preview UI and the approved real technical image run remain pending. No full Stage 14 exit or production readiness is claimed

## Remaining stage exit

The original technical test can verify generation, storage, traceability and independent pixel review. Full Stage 14 additionally requires a genuinely eligible current owner TEST, a separate candidate-production approval and a successful production-purpose run. Unknown demand, margin or other required evidence cannot be waived, and a technical PASS does not advance Stage 15. Hosted UI verification is currently blocked by blank/loading cloud Chromium pages, CDP focus-emulation timeouts and an unavailable native AT-SPI input provider. Authentication or an application defect has not been established as the cause. No live creative run has started.

## Primary references

- [OpenRouter Image API](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)
- [Pinned Recraft endpoint and pricing](https://openrouter.ai/api/v1/images/models/recraft/recraft-v4.1-pro/endpoints)
- [Recraft API Developer Terms](https://www.recraft.ai/legal/developer-terms)
- [OpenRouter model pricing catalog](https://openrouter.ai/api/v1/models)
- [Claude vision limits](https://platform.claude.com/docs/en/build-with-claude/vision)
- [Printful DTG file guidance](https://www.printful.com/creating-dtg-file)
- [Printful product-specific large-front placement](https://help.printful.com/hc/en-us/articles/50263171283217-What-should-I-know-about-the-standard-15-18-print-placement-for-DTG-products)

Detailed candidate designs, account identifiers, actual provider invoices and generated files remain Business-private, not in repository closeout notes.
