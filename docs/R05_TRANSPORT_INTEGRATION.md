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

Unresolved acceptance: full R05 SQL/legacy reservation serialization and exposure reconciliation, definitely-unsent release proof, exact-head complete CI, owner policy/pause UI, and independent review. Unknown outcomes must remain liabilities; no completion claim follows from transport tests alone. Later live/provider/commerce qualification stays in R10–R18.
