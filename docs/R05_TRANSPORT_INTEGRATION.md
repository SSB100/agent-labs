# R05 transport integration — acceptance pending

The final model transport requires a trusted `admitDispatch` callback. It snapshots the exact wire bytes before authorization, denies missing/rejected admission before fetch, and never treats an injected fetch function as authority. Runtime admission sends immutable hashes and bounded identifiers to the narrow R05 RPC; it does not send prompts or images. Its server key comes only from `R05_ADMISSION_SERVER_KEY`, not workflow input. No key, eligible registry row, or production authority is installed by this change.

| Lane | Integration | Qualification boundary |
| --- | --- | --- |
| Research v1/v2 | Per-reservation final-wire callback; exact original research ledger source and workflow binding | Requires separately confirmed policy and current exact operation evidence |
| Creative text | Per-call final-wire callback, original creative ledger | Image review also binds its private-image data class |
| Listing and listing qualification | Per-call callback at final model transport, original exact run/call ledger | Existing exact approvals and qualifications remain required |
| Generic model router, evaluations, browser planner | Common model adapter denies absent admission | No implicit conversion from legacy model configuration into financial authority |
| Image generation | Final POST requires separate transport admission | Unsupported operations remain disabled; public pricing GET carries no prompt or credential |
| Printful catalog/product/account reads and product creation | Actual provider transport requires admission in addition to existing account/approval checks | No live callback or commerce authority is provisioned |
| Etsy OAuth, shop discovery, draft reads/writes and listing activation | Purpose admission required before provider calls | Existing Etsy application-purpose hold is not lifted |
| Steel browser operations and CDP attachment | Admission required before provider calls/attachment | No new browser entitlement or automation authority |
| Browserbase account session creation | Admission required before creation despite old budget/entitlement flags | Exact existing-session release/readback remains available to stop a lease |

Synthetic tests explicitly inject inert admission callbacks and mock provider transports. Those callbacks do not qualify real providers or bypass the default production denial. Existing-session release is a cleanup operation, not permission to create, renew, navigate or start a replacement session.

Owner policy review/confirmation/revocation and scoped pause/resume are implemented at `/dashboard/quests/controls`. CI409 passed the actual Next route/action/viewport/200% zoom checks and both SQL jobs, including observed PostgreSQL lock races, for checkpoint `c92de28d0e1b6b0b0b4831e87656d551ff74ca4c`. Its quality job failed 28 server-fixture imports introduced by the readback guard. Both fixture suites now pass all 28 tests after adding explicit inert dependencies; subsequent review fixes require a new exact-head gate.

Trusted runtime settlement now uses one server-key-attested database transaction to write the original legacy ledger. A definitely denied guard response may request server-proven no-marker release; lost responses, ambiguous replays and possible dispatch never release liability. Independent review found no further blocker after owner-transfer consent, global provider receipt ownership, read-only bounded projection, and extreme-overage fixes. All 30 SQL suites and focused security tests passed locally. Twelve observed PostgreSQL race checks and the full exact-head CI gate remain required before release. Unknown outcomes remain liabilities. Later live/provider/commerce qualification stays in R10–R18.
