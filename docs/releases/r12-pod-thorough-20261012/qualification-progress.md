# Qualification progress, before publication

Source base:374788383d1dfad7e1199dbcb6e5840ebe5dc5ba. Current implementation is a new isolated branch; this file is not a Production release receipt.

Verified locally with Node22.23.3:
- Full TypeScript and ESLint passed (subsequent test-only changes are rechecked by final CI).
- Capacity/profile composition plus unchanged legacy runtime:42/42 focused checks.
- Current regional catalog/quote/context/exact binding:10/10.
- Model response body/timeout/serializer:6/6.
- Owner recovery, status, read-only verifier and separate full findings:focused tests passed; one old exact verifier-key assertion was updated for the additive nonsecret thorough hashes and rechecked.
- Scoped capacity/pack-upgrade SQL:11/11; legacy goal SQL:14/14. Covers ordinary/recovery mode split, exact old-to-new pack transition, active/unknown/conflicting authority refusal, rollback, immutable history and expired receipt lookup recovery.
- Counted failure SQL:12/12, with1 expected native-only skip. Includes original28,912µUSD failed-review shape, new independent pass, source rejection, exact123µUSD, shared third-receipt waiting, temporary funding wait and Stop.
- Next fixture contracts with PGlite host:11/11, no skips.
- Atomic expired Goal recovery:1/1, including same-Goal revision, rollback and replay.
- Inert Etsy adapter:24/24, including100 minimal records, encoded URL guard, deadline after headers, strict UTF-8, whole oversized-page rejection.

The local actual Next server/action/Workflow fixture passed the ordinary empty-evidence → independent insufficient review with long Unicode → different-source next pass → useful result, saved reload/Stop, and counted malformed-review continuation. All8 actual Next/action/Workflow HTTP stages passed, including stopped legacy failed review → .4 recovery, exact carry-forward and Goal revision. The HTTP run predates only the final expired-abandoned-receipt upgrade predicate; the final SQL suite independently covers that cutoff. The final run recorded30 synthetic POSTs,29 receipt GETs and28 fenced releases, with no RPC errors or external calls. First saved receipt wake measured1,651ms; a1,200ms held receipt interval remained quiet.

Limitations:
- Native PostgreSQL observed lock races and fresh-backend3-second .3 dispatch/send are wired into normal CI, not claimed locally.
- Chromium failed before navigation because executor OS socket creation is restricted, including on the permitted escalation. Browser acceptance remains for normal CI.
- Local shared dependencies have Next16.3.0; the repository requires16.3.8. Local builds are useful integration evidence; clean exact-dependency CI is the release gate.
- No live provider, Production database, new access/grant or paid research operation was performed.

The local full unit run attempted5,026 tests:4,787 passed,220 environment-gated skips,19 initial failures. Fourteen were unchanged CLI stderr assertions seeing the executor-injected UNDICI-EHPA warning; the complete affected188-test CLI file passed with only local Node warning display suppressed, without changing code or transport enforcement. The other5 failures were strict fixture imports/branch allowlist assertions, updated for the exact new profile module and nondeploying branch; their full14-test files passed. No broad repeat was started; clean complete CI remains required.

Independent review pins production source. The final added native timing test changes only test bytes: SHA2568935e2f4fca4f3d195d5afc55bb40d1f4e946551ab2b559e9d9358308d7c1008 at22:08UTC. The migration remained unchanged.
