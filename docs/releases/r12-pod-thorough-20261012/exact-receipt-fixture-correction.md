# Exact receipt identity in the browser journey

Corrected-head run https://github.com/SSB100/agent-labs/actions/runs/38323881628 uses commit `5e83b0f013d2e5952fc26ff5cb7611d3f26e4c44`.

Actual Chromium passed ordinary goal preparation, weak/empty evidence to independent review to a different-query useful result, expanded full findings and exact provenance, reload and Stop. It also reached the useful result after a malformed review was kept rejected, reconciled and followed by a counted new independent pass. The subsequent Stop assertion failed because the test called its saved-receipt helper without an ID. The real catalog correctly returned both preserved ordinary setups.

The test-only correction requires and verifies an exact setup ID for every receipt read. It rejects omitted IDs, multiple rows and substituted receipt identities. Browser navigation waits verify the actual same-Business selected URL; lost-reply recovery retains the originally saved ID and hash. Stop completion is awaited before the next Business journey.

A migrated SQL regression creates/stops one setup, creates/replays a second, preserves both histories, and verifies only the exact selected second receipt satisfies its Stop assertion. Focused checks passed 65/65, including 14 fixture checks with PGlite enabled and no skips. ESLint, syntax and diff checks passed. Actual Chromium still requires the new exact-head run.

No production source, migration, permissions, budget, provider allowance or release-gate change is included. The same run passed native R11 and multiple repaired legacy native tests; separate jobs failed before tests on the PostgreSQL image registry's `toomanyrequests: Data limit exceeded`. Those infrastructure failures are not claimed as successful assertions.
