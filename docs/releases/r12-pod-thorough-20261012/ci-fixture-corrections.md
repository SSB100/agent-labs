# First exact-head CI: fixture corrections

Initial remote head: `dce6c1f493c68ad043f655705c5be1a4010179a3`, tree `e82a4dcf0e1e4cb577e3e791f07958af4e85d2d0`.
Full qualification run: https://github.com/SSB100/agent-labs/actions/runs/38321718866
This head did not qualify. No Production installation or paid operation followed.

Three independent fixture issues were corrected together, without production source, migrations, permissions, or release-gate changes:

1. Five strict legacy server loaders omitted the newly imported real POD profile. They now bind the actual compiled module. A deterministic regression scans all strict test/script maps and verifies every server import and real profile identity. Focused dependency/deadline, owner-initial native/legacy PGlite, bootstrap and Business-rebind checks passed 9/9.
2. The R11 zero-latency GET fixture could finish in the same millisecond as a PostgreSQL microsecond dispatch marker. It now waits for the saved marker's next representable JavaScript millisecond, without fabricating observation time. Persisted chronology is asserted; a new negative case proves even one microsecond before dispatch remains rejected. R11 PGlite passed 31/31 and focused Etsy transport/read/refresh passed 64/64. Production adapter and SQL are unchanged.
3. Actual CI Chromium passed goal preparation and the background weak/empty-first-pass to independent-review to different-query useful-second-pass sequence. The next test timed out locating a source link inside the new collapsed evidence disclosure. The journey now opens the four actual summary controls and checks concise summaries, full findings, exact source URL/quotation, independent review, submitted query and all five release/request receipts. It covers the ordinary result/reload and both recovery results. Focused tests passed 62 with one SQL-host-dependent skip; final actual Chromium qualification remains required.

Changed-file ESLint, syntax and diff checks passed. The earlier final full TypeScript/ESLint process was subsequently recovered with explicit `FINAL_STATIC_EXIT=0`. Source-review and migration hashes are unchanged. New exact-head CI must pass before any code release; these focused corrections do not qualify the release by themselves.
