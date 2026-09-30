# Stage 11: reusable Web Research

Agent Labs V2 now has a provider adapter, scoped source artifacts, and a Market Researcher Worker Pack. Pack release 1.0.0 belongs to the current V2 application.

The provider uses one bounded OpenRouter web search per attempt, with the existing standard model route and fallback. HTTPS sources must match the Task Contract's allowed domains. Source URLs, retrieval timestamps, content hashes, extractive evidence, and one-day retrieval expiry are persisted. Publication dates remain unknown unless supplied by a future provider.

The Researcher selects existing evidence IDs. Core assembles exact source quotes into an EvidencePack and rejects fabricated IDs, unsupported claims, stale evidence, and out-of-scope URLs. The workflow displays inspectable source links and excerpts. Durable provider/model steps are separate from persistence steps so database retries do not repeat completed calls.

Four exact-version packs are registered: capability.web-research, knowledge.research-evidence, worker.market-researcher, and workflow.web-research. They remain experimental until the owner-scoped fixed Etsy qualification flow completes with live source and model receipts.

## Verification

- Local lint, TypeScript, optimized Next.js build, and Workflow compilation passed. The research suite now has 11 passing tests; hosted CI passed the complete 108-test gate.
- Stage 11 SQL regression passed with all synthetic mutations rolled back.
- Stage 10 SQL regression passed after extending the catalog.
- Migrations 20260930042900, 20260930043140, and 20260930070451 are applied.
- Preview deployment dpl_7dZLc5nahnRUcPZkMT9i6sdanLaq is READY for code commit 88c3d8b5da53efae4bc797581cc843ea3f3faecf. Hosted CI 36683357171 passed.
- Live qualification ef133f33-717b-4fad-b92a-10fd4a70260d completed using runtime wrun_01M3RK97VPMNPH50MQ3YBERQPB. One search retrieved four Etsy sources; the Researcher selected three exact-quote claims. Four artifacts and five events were saved, and all four releases were atomically qualified.
- Search receipt gen-1790753162-8uJ3tSo73v7Sn3eodb5e reported US$0.008083. Researcher receipt gen-1790753181-Pb5cLLDmPNhww54z2Cu7 reported US$0.00114495. Total: US$0.00922795.
- Live regression identified Chat Completions usage under server_tool_use_details, unlike the guide's server_tool_use example. The adapter accepts the official schema plus the legacy format, requires one search, and rejects missing or extra searches. Earlier failed qualification runs remain visible and were not promoted.
- Signed-in preview source links and retrieval metadata were verified. Production deployment follows merge of PR 15.
- Security advisors report the established scoped SECURITY DEFINER RPC pattern and the existing Auth password-protection setting. Owner isolation and incorrect runtime capabilities are covered by the database regressions.

## Next stage

Stage 12 builds five versioned Knowledge Packs covering Etsy selling, current Etsy policy, print-on-demand, product research, and baseline social marketing. It adds domain configurations for Market Researcher, Product Strategist, and Reviewer, then proves Etsy Product Discovery in simulation before publication.
