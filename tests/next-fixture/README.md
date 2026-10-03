# R03 production Next isolation boundary

Run `node scripts/verify-r03-next.mjs` after installing the repository-pinned Chromium. `--http-only` checks the real redirect and streamed Suspense response and explicitly leaves browser journeys unrun.

This preparation was created on the R03 branch from the accepted PR51 main tree. No unpublished harness was presumed present or qualified. It is reviewed and tested separately from the existing supplemental component/browser fixtures.

The runner copies production source into a disposable directory and performs a production Next webpack build/start. Four substitutions replace only Supabase transport and its auth/realtime plumbing: `server.ts`, `client.ts`, `proxy.ts` and `inert-transport.mjs`. The real pages, ownership readers, layouts, client components, Link/router, RSC/Suspense, server actions, redirects and revalidation execute unchanged. The normal repository build remains a separate required gate.

Only loopback URLs are allowed in the isolated Node processes. The environment is constructed from system runtime paths, inert loopback public identifiers and the fixture boundary address; production secrets are not copied. Browser contexts abort external HTTP(S) requests. Storage URLs are absent. Unknown RPCs, writes and unsupported query operations fail closed and are logged. No providers, production database, notices, uploads, publishing or fulfilment are used.

The only mutable doubles are an in-memory candidate save with exact Business and deduplication identity, and acknowledgment of a synthetic terminal notice with saved revision and idempotent outcome. Failure/uncertain outcomes do not claim success. These doubles qualify transport and UI continuity, not database/provider operation admission. Query emulation is not a substitute for production RLS, private history/index or provider qualification.

The fixture includes two owned Businesses with duplicate long names, 127-row collection/library/research seeds per Business, 133 workflow children, 51 proof runs per Business, retained failures and independent reported/unverified/unknown charges. The browser gate exercises real delayed/interrupted navigation, native history, unsaved edits/reload, duplicate actions, exact redirect outcomes, revalidation, error recovery, retained sections and independent old-record reads.

`browser-zoom.mjs` uses a fresh disposable Chromium profile and a local MV3 extension with only `tabs` permission to call the real per-tab `chrome.tabs.setZoom(2)` API. It has no host permissions or credentials. The gate verifies the browser zoom and resulting CSS viewport; this is separate from the additional 640×360 reflow-equivalent captures.

All reports, screenshots, build/server logs, denied requests and inert effects are preserved under `test-results/r03-next`, including failures. Secure surfaces contain only expired/unavailable identifiers; private pixels are masked. CI uploads the diagnostics separately from screenshot groups so failed evidence remains inspectable. A passed geometry check alone is not visual acceptance: the R03 completion report records actual screenshot inspection and corrections.
