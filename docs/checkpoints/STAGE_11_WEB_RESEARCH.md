# Stage 11: reusable Web Research

Agent Labs V2 now has a provider adapter, scoped source artifacts, and a Market Researcher Worker Pack. Pack release 1.0.0 belongs to the current V2 application.

The provider uses one bounded OpenRouter web search per attempt, with the existing standard model route and fallback. HTTPS sources must match the Task Contract's allowed domains. Source URLs, retrieval timestamps, content hashes, extractive evidence, and one-day retrieval expiry are persisted. Publication dates remain unknown unless supplied by a future provider.

The Researcher selects existing evidence IDs. Core assembles exact source quotes into an EvidencePack and rejects fabricated IDs, unsupported claims, stale evidence, and out-of-scope URLs. The workflow displays inspectable source links and excerpts. Durable provider/model steps are separate from persistence steps so database retries do not repeat completed calls.

Four exact-version packs are registered: capability.web-research, knowledge.research-evidence, worker.market-researcher, and workflow.web-research. They remain experimental until the owner-scoped fixed Etsy qualification flow completes with live source and model receipts.

## Verification

- Local lint, TypeScript, 106 tests, optimized Next.js build, and Workflow compilation passed.
- Stage 11 SQL regression passed with all synthetic mutations rolled back.
- Stage 10 SQL regression passed after extending the catalog.
- Migrations 20260930042900, 20260930043140, and 20260930070451 are applied.
- Preview, hosted CI, live qualification, and production checks are pending.

## Next stage

Stage 12 builds five versioned Knowledge Packs covering Etsy selling, current Etsy policy, print-on-demand, product research, and baseline social marketing. It adds domain configurations for Market Researcher, Product Strategist, and Reviewer, then proves Etsy Product Discovery in simulation before publication.
