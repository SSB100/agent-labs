# Focused direct Etsy owner journey

These are synthetic engineering tests. They create no live grant or provider session.

## Local composition

Compile the core modules first with `npm run pretest`, then run:

```
R12_SQL_TEST_HOST=/path/to/isolated-sql-tooling node --test tests/r12-direct-owner-journey-sql.test.mjs
node --test tests/r12-direct-workflow-hook.test.mjs
node scripts/verify-r12-direct-owner-next.mjs --compile-only
```

The first test renders the real page bodies and submits their real FormData actions through an in-process Request/Response adapter. Its server modules, authorization roles, scoped HMAC derivation, migrated SQL, encrypted handoff, no-query verification and accounting are genuine. Only the shell/Next hosting, workflow service, Steel and Playwright IO are inert. It does not qualify Next's server-action serialization or a browser.

The hook tests run the actual wrapper and step code against a deterministic hook host. They establish registration ordering, conflict/no-work behavior, retained identity across pauses, owner-triggered retry, and zero implicit step retries. They do not qualify the hosted Workflow service.

## Real Next/browser CI

In an isolated runner that permits listening sockets and Chromium, with the same core compile and SQL tooling:

```
R12_SQL_TEST_HOST=/path/to/isolated-sql-tooling \
GUIDED_UI_CHROMIUM_PATH=/path/to/chromium \
node scripts/verify-r12-direct-owner-next.mjs
```

The runner builds only the three production owner pages and their unchanged actions in a disposable app. A narrow server facade forwards the owner calls to the actual-source SQL composition; there are no fake authority responses. Minimal shell and authenticated fixture context replace unrelated dashboard infrastructure. The reviewed source packet is complete and unchanged. The fixture starts with the real stopped historical origin and an explicitly inert reviewed grant, before any new test draft or owner approval exists.

The browser scenario uses visible labels to prepare and confirm the USD 10 envelope, approve the persistent-access disclosure, open an inert owner viewer, return for real no-query verification, review the saved query/data-sharing packet, confirm research, and Stop. Node networking and browser requests are restricted to loopback, apart from an intercepted synthetic viewer document. No credentials are entered. No model or research source execution is fabricated.

Results go to `test-results/r12-direct-owner-next/qualification.json`. Compile-only results explicitly report `realBrowser:false` and `actualNextActions:false`. A true browser result is written only after the complete scenario and durable readbacks pass. A failed or unavailable browser is not converted into a success or an HTTP substitute.
