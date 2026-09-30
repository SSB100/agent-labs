# Stage 13: Product discovery and experiment system

## Status and boundaries

Implements Stage 13 of the unchanged authoritative implementation plan, after Stage 12 production commit `018b4652d575ef8975421bd38d48dfd05bf0f67f` ([PR 16](https://github.com/SSB100/agent-labs/pull/16)). Initial scope is original print-on-demand T-shirts.

The code, applied database migration/regressions, and local build are verified. Hosted real-research qualification, preview UI proof, CI, merge and production verification are recorded below as they occur. Until those gates pass, this stage is not production-qualified.

No assets, listings, marketplace mutations, advertising, purchases or commerce operations are implemented. Stage 12's three domain workers remain experimental; this change does not promote them. Its source-policy date anomaly remains recorded in the Stage 12 checkpoint.

## Implementation

- Owner-scoped Product Candidates preserve concept, audience, hypothesis, original-design declaration, rights status and allowed source domains
- Candidate identity uses a deterministic normalized concept/audience/product-type fingerprint. Case, punctuation and repeated whitespace do not create another candidate; this is not a claim of semantic/paraphrase detection
- Experiment Registry preserves hypothesis, candidate, variables, audience, explicitly absent creative/price, research-only channel, start/end, measurement plan, outcome/decision and source Artifact references
- The first discovery reservation is atomic and reused even after failure. Repeated clicks cannot create a second paid research loop or replace the original runtime capability
- Candidate research reuses the live-qualified `research.public-evidence` pack and Market Researcher. The researcher collects sources and selects evidence IDs; it never chooses a product strategy
- Strategy and review are separately defined deterministic provisional contracts. The nine scoring dimensions are demand, competition, differentiation, estimated margin, creative opportunity, seasonality, production complexity, policy/IP risk and marketing potential
- Automatically collected sources leave every unassessed score null. Source count, policy pages and fixtures never become demand scores. Missing evidence names the specific observation, cost, production or policy/IP facts needed
- Owners may append explicitly labeled evidence-linked assessments. Scores are subjective owner judgments, not model competence or authoritative profit calculations. Higher values are favorable. The weighted total is normalized to 100; demand has weight 3, margin/policy each 2, all other dimensions 1
- TEST requires all nine scores, total at least 65/100, demand and margin at least 3/5, policy/IP at least 4/5, original design, confirmed rights and the bounded measurement plan. Known zero production or policy/IP suitability, or a non-original concept, yields REJECT. Other gaps yield NEEDS_MORE_EVIDENCE
- An explicit owner rights declaration may resolve initial uncertainty in a new assessment. It is preserved in that decision rather than rewriting the candidate or earlier decisions, and is not independent legal/IP clearance
- TEST proposes an unstarted research test only. Every decision permanently records `liveQualified=false`, `creativeProductionAllowed=false`, and `publicationAllowed=false`
- Measurement plan: at least seven days and 30 observations, five qualified interests, zero spend, research-only channel and an explicit stop rule. No measurement results or business profitability are fabricated
- Reconsideration reuses a completed same-business research Artifact matching the candidate question/domains and requires a never-before-seen source-content hash. New URLs, retrieval dates, changed hypothesis wording or repeated failed collected evidence are insufficient. Old experiments and decisions remain append-only
- Products workspace provides candidate cards, source excerpts/URLs/provenance, UTC timestamps, nine-dimension decisions and experiment history. Workflow-specific product views remain scoped to their own experiments. Owner assessment, persisted-output reconciliation and evidence-led reconsideration are available
- Recent workspace views are bounded to 100 candidates, 100 experiments and 300 decisions; limits are disclosed. Historical rows remain stored

## Evidence and security model

Five new tables use owner-scoped SELECT RLS and no direct authenticated/anonymous mutation grants. Six owner APIs verify the Business owner. Three runtime APIs require the exact Business, Workflow Run and high-entropy per-run capability. Private helpers have explicit execute revocations and empty search paths. New source/decision/registry records are append-only; cross-business/workflow references use composite foreign keys. Existing research rows cannot be directly overwritten by authenticated clients.

Source validation checks exact persisted source/output relationships, hashes, evidence/claim IDs and quotes, allowed HTTPS domains, source freshness, qualified pack pins and worker receipts. General policy/help/support pages cannot be relabeled as observed market demand. New assessments require fresh source evidence; old decisions remain historical records.

The inherited owner-selected capability model trusts an owner with authoring their own Business's internally consistent runtime records. These controls establish scope and citation linkage, not cryptographic attestation of provider execution or independent truth of each source. Hosted qualification additionally checks actual provider receipts and observed application execution. No new cross-owner or unauthenticated-without-capability access was found in independent review.

Applying the migration adds three persistent capability-guarded runtime write entry points. Specific owner approval was obtained separately before application. No credentials, account settings, public calendar/data access, financial-account permissions or destructive changes are involved.

## Application-owned knowledge versus Business history

Reusable packs, knowledge/capability definitions, worker/workflow definitions, models and qualification configuration are application-owned catalog records, independent of a test account or Business. Authenticated owners can read that reusable catalog and activate qualified packs in their own Businesses. Worker evaluation records preserve their results if the requesting account is removed; the requester reference is set null.

Installed-pack activations, workflow execution, raw research artifacts/evidence, and product candidates/experiments/decisions are Business-private operational history. They do not automatically transfer between accounts. Test-account deletion is deliberately not part of this stage: existing installation dependencies can block it, and deletion of business-private history would otherwise risk qualification source links. Retain test history and plan any future archival or ownership change explicitly.

A read-only RLS check confirmed the main owner account can access the shared application catalog without granting access to the test Business. No account transfer, membership change or deletion was performed. Useful, verified general learnings should be curated into reviewed, versioned application-wide Knowledge Packs; raw tenant-private research, business performance and connections stay private. This stage does not automatically promote raw experiment evidence into shared knowledge.

## Bounded paid qualification

The owner approved one research experiment with a US$1 total allowance and accepted small estimation uncertainty. This does not authorize additional qualification experiments.

The existing OpenRouter/Exa adapter remains in use. An alternate source-led adapter was investigated but removed before publication. No new provider or credential was introduced.

Each attempt verifies current prices from the public [OpenRouter model catalog](https://openrouter.ai/api/v1/models), then atomically reserves its conservative estimate. Search attempts are limited to the standard route's primary/fallback, one Exa fast search each, four results, 1,800 characters per result, 4,000 output tokens per model turn and two estimated model turns. The search input allowance is deliberately oversized at 64,000 tokens per turn. Selectors use at most 32,768 serialized request bytes plus an 8,192 formatting-token allowance and 1,000 output tokens. Provider price filters disable provider-internal fallback; a second route model is used only after a recoverable failure.

At prices verified on 2026-09-30, the maximum declared four-attempt estimate is US$0.349775, including long-context/cache-write allowances and Exa fees. It is **not a provider-enforced invoice guarantee**. Unknown fees, changed/unpriced models, stale price quotes, oversized selector inputs or an exhausted estimated allowance fail before the call. Observed charges are recorded separately; later reservations count the greater of the estimate and reported actual. An unknown/timeout attempt keeps its reservation. Step replay cannot make another call under the same attempt key.

Current runtime pricing metadata was corrected for Luna and Gemini and source/verification dates retained. The historical database model-definition snapshot remains unchanged because Stage 6 qualification fingerprints include price metadata; silently replacing it would invalidate unrelated prior worker evaluations. Candidate cost preflight always uses a fresh catalog response, not that historical snapshot.

Planned single qualification candidate:

- Concept: Original camping illustration T-shirt
- Audience: Adult camping enthusiasts
- Hypothesis: An original campsite illustration could appeal to adult camping enthusiasts
- Allowed domains: `etsy.com`, `printful.com`
- Query: Research this original print-on-demand T-shirt opportunity: Original camping illustration T-shirt. Audience: Adult camping enthusiasts. Find candidate-specific buyer-interest, comparable listings, dated trend signals, prices and production constraints. Separate observed facts from general policy guidance. Do not infer sales or demand from listing counts. Return inspectable sources only.
- Expected legitimate outcome: NEEDS_MORE_EVIDENCE; no assumed demand, margin or commercial approval
- Production smoke should inspect the same persisted experiment rather than spend on an additional live run

## Verification record

- Full local `npm run check`: lint, TypeScript, 180 tests, optimized Next.js build and Workflow compilation passed
- Independent read-only review covered authorization, owner isolation, source linkage, scoring, duplicate/reconsideration gates, budget replay/exhaustion, UI scope and Stage 12 compatibility
- Review fixes: current-relative test clocks; append-only owner rights confirmation; Researching transition bound to the expected experiment; workflow-specific decisions scoped to matching experiments
- Hosted transactional rehearsal of the migration plus Stage 13 rollback suite passed after correcting PostgreSQL CASE grouping and JSONB/text cast precedence
- Combined hosted Stage 10, 11, 12 knowledge, 12 simulation and 13 regression suites passed in one migration rehearsal, each isolated with a savepoint; all schema and test changes rolled back
- Verified after rehearsal: no Stage 13 table or regression Business remained
- Final patched-code independent re-review found no remaining blocking defect; focused tests also passed with a later clock
- Specific approval of the full grant scope received; migration applied as `20260930095221_stage13_product_discovery`
- Post-apply Stage 10/11/12/13 regression suites passed; synthetic changes rolled back and the production candidate registry remains empty
- Security advisor delta is exactly three new capability-guarded anonymous RPC notices and six owner-checked authenticated RPC notices. No new table/RLS warning; existing leaked-password protection warning is unchanged
- Live provider proof, preview UI, exact-commit CI, production merge/deployment and production advisor scan: pending

## Reproduce

```sh
npm ci
npm run check
```

Apply the reviewed CLI-created migration only after authorization, then run the rollback regression SQL suites in `supabase/tests`. Never present their administrator-inserted synthetic provider records as live qualification evidence.
