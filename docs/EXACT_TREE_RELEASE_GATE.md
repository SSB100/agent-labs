# Exact-tree release gate

The complete qualification gate is CI, including unchanged `quality`, R03 actual-Next acceptance and R04–R07 isolated SQL/concurrency jobs. `npm run build` and `npm run check` still perform the existing quality checks plus Next build.

Vercel uses `npm run deploy:build` (`next build`) to package an already-qualified source tree. It does not rerun the same lint/type/unit/browser/SQL suites. This script is not evidence that the release gate passed.

Before any release, the coordinator must verify:

1. The reviewed source tree exactly matches the green complete CI checkout. A PR merge ref may be reused only after comparing its tree with the candidate head.
2. All required jobs passed; an optional skipped harness remains explicitly unverified. Source changes after qualification invalidate affected evidence and require the appropriate new gate.
3. Any schema, credential, access, provider or financial change has its own required approval. A green software build is not production authority.
4. The exact qualified commit is deployed using the intended Production configuration. Prefer one production build or a supported promotion of the same qualified artifact when configuration is equivalent; do not silently substitute Preview configuration.
5. The resulting deployment source/tree, READY state, alias, health, affected signed-in reads and errors are verified separately.

Automatic deployment remains disabled for the working R03–R07 draft branches. This source change does not alter Vercel project permissions, security settings, merge policy or deployment credentials, and does not authorize a production deployment. Do not push an unqualified candidate into a branch with automatic production deployment enabled. CI qualification and explicit release coordination must happen first.
