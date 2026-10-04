# R10 isolated controlled-public viewer SQL boundary

## Shipping and activation boundary

`20261004024348_r10_private_browser_viewer.sql` adds an inert experimental pack, workflow definition and read-only capture-worker definition. It seeds no server key, enrollment, grant, account, browser session or execution authority. Existing R04–R09 function definitions, grants, private authority rows and legacy provider secrets are unchanged. New triggers protect only the dedicated R10 identities/projections and do not grant legacy Stage 8/9 viewing eligibility.

R10 is a separately approved, one-shot qualification of a real browser rendering one fixed public document. It is not a general worker-browser viewer, commerce capability, R05 allowance, authorization transfer, or permission to provision a key or spend money. Shipping inactive code does not close the R10 exit requirement. Live activation still requires independent review of current provider pricing and timeout/billing enforceability, exact financial approval and an independently authorized harmless session. Provider timeout is a runtime bound, not a claimed provider money cap.

The one admitted source is SHA-256 `9165948e0a968e0a00be7bc22d4ec89862b84733577ca4a4fb9622238c2c42cd`, policy `r10.controlled-public.v1`, workflow definition `a1100000-0000-4000-8000-000000000002`, version `1.0.0`. The static source is exported as `WATCH_HTML`; the trusted producer enforces clean storage, fixed locally fulfilled route, no remote requests, disabled JavaScript and synchronous suspension/buffer zeroing before any uncertainty or transition. SQL cannot itself prove browser confinement or drain transport bytes.

The trusted producer attaches CDP only to its newly created exact page. Setup may read `Page.getLayoutMetrics`; each permitted capture sends exactly one `Page.captureScreenshot` for the fixed 960×540 viewport, JPEG quality 65, without warm-up pixels, a cache or a high-level screenshot fallback. The absolute monotonic capture cutoff is passed unchanged from the permit check; the producer uses the earlier of that cutoff and 1,500 ms after entry, checking again immediately before dispatch and after the reply/decoding. CDP attach and commands have separately bounded waits and tracked raw settlement. Timeout or detach is not physical-close evidence. Late base64 is dropped before decoding; strings cannot be zeroed, while rejected allocated pixel buffers are zeroed. Raw commands must settle, and context close and transport disconnect must both positively succeed before producer disposal can support a close acknowledgement. No CDP authority is exposed to the viewer.

High-level SDK close-promise fulfillment alone is insufficient: an already closed/closing context can return without sending a close command, and browser close can swallow a target-closed error. Disposal therefore requires an open owned context and connected transport at entry, a successful context-close promise with its close event observed and no intervening disconnect, then a separately observed transport disconnect. Context creation is tracked with a 15-second setup allowance; rejection or a missing context cannot prove that no remote context was created. A genuinely observed close before any failed disposal preflight can support proof, including a same-turn late acquisition; later best-effort cleanup cannot repair an already failed proof. Raw-command settlement remains required. Exact-session provider release is still attempted immediately and independently; this guard prevents false acknowledgement but does not by itself establish reliable normal closure after a release/disposal race or lost hosting lifetime.

## Deliberate enrollment

Only an administrator may invoke `private.r10_enroll`. All private R10 tables have RLS enabled and no direct PUBLIC/anon/authenticated/service-role table privileges. All private helper function execution is revoked from those roles. `R10_VIEWER_SERVER_KEY` is an optional separately provisioned server environment value; only its SHA-256 hash and finite expiry are stored in the initially empty private authority table.

Enrollment takes:

- `p_owner_id`, `p_auth_session_id`, `p_business_id`, `p_quest_id`
- Fixed `p_source_hash` and bounded opaque `p_approval_reference`
- Required `p_cost` quote/approval object below
- `p_grant_seconds` and `p_max_runtime_seconds`, each integer 1–120
- Optional exact `p_workflow_run_id` and `p_session_id`, otherwise fresh UUIDs

It locks and verifies current Business ownership, a real current `auth.sessions` row, exact managed R04 ready Quest/setup Business revisions, and the immutable dedicated definition. It creates a new Core workflow, task contract and worker run, with the Quest association; it never adopts an existing workflow, legacy browser session, browser identity, saved profile or owner JSON attestation. Exact retries using the same IDs return the original enrollment without refreshing time. Changed purpose, identity, source, approval, quote or duration is a conflict. The Core task has only the fixed read-only capture objective and cannot be dispatched through a newly minted general capability.

The required cost object has exactly these keys:

- `provider: "steel"`, `purpose: "r10.controlled-public-viewer-qualification"`, `currency: "USD"`
- `maximumMicrounits`: decimal string 1–1,000,000
- `rateMicrounitsPerMinute`, `minimumChargeMicrounits`, `estimatedMaximumMicrounits`: nonnegative bounded integer strings
- `billingQuantumSeconds`: integer 1–120
- `quoteHash`: 64 lowercase hex characters
- `quoteValidFrom`, `quoteValidUntil`: zoned timestamps, currently valid, covering the full grant and ending within 24 hours

SQL requires the quoted maximum to equal max(minimum charge, ceil(ceil(max runtime / billing quantum) × billing quantum × per-minute rate / 60)), and not exceed the explicitly approved maximum. This validates the immutable quotation arithmetic, not the provider's actual billing behavior. The quote is rechecked at dispatch/permit time. Unknown provider liability remains unknown after timeout, cleanup, release or closure; none implies a zero charge. A later genuine cost observation must be separately reconciled rather than rewriting the original grant/audit or inventing an observed amount.

## Owner API

Only authenticated owners can execute:

- `r10_viewer_catalog(p_business_id,p_quest_id,p_workflow_run_id default null)` returns at most 40 exact-scope summaries, plus an independent exact selected run. There is no fallback run substitution
- `r10_viewer_owner(p_business_id,p_quest_id,p_workflow_run_id,p_session_id default null,p_operation default 'read')` is a pure status read or an exact-session `revoke` request

The enrollment's authenticated session must match the current owner's validated JWT session. Both APIs validate the exact Business/managed Quest. All public summaries contain only `sessionId`, `businessId`, `questId`, `workflowRunId`, `status`, `expiresAt`, `policyVersion`, `updatedAt`, `streamClosure`, and approved exposure/actual-cost truth. They never include a server key, native endpoint, provider session ID, auth session ID, writer ID, capture context, approval reference or credential.

Saved legacy sessions remain metadata-only. New private R10 session IDs cannot be resolved through the legacy native-view endpoint.

## Trusted server API

`r10_viewer_server(p_business_id,p_quest_id,p_workflow_run_id,p_session_id,p_owner_id,p_auth_session_id,p_operation,p_payload,p_server_key)` is callable through the ordinary runtime client, but every operation requires the empty-by-default private hash authority plus the complete exact enrollment identity. Service role has no execute bypass. Payloads are small, exact-key objects, with no caller-provided timestamp.

Operations:

| Operation | Exact payload | Result/constraint |
|---|---|---|
| `read` | `{}` | Fresh summary, `serverNow`, and server-only writer/provider cleanup identity, `createDispatched`/timestamp, receipt/release facts. Rechecks authority and identity after lock waits |
| `claim` | `writerId` | Consumes one immutable grant, marks Core workflow/task/worker running, returns epoch 1, fixed source/policy, actual remaining timeout, max 120 frames and quoted cost. No second writer or reconnect |
| `create_dispatched` | `writerId` | One-way marker before the sole provider POST. A timeout or lost reply can never make it unsent |
| `created` | `writerId`, `providerSessionId` | Once-only private provider identity, never an endpoint/profile or owner response. Late replies retain the cleanup ID while remaining denied |
| `attest` | `writerId`, `contextId`, `pageId`, `epoch`, `sourceHash` | Trusted producer attestation for exactly one context/page at fixed epoch 1; refresh requires the identical binding |
| `permit` | `writerId`, `contextId`, `pageId`, `epoch` | At most 240 permits (two per 120 frames), at most two seconds each, bounded by enrollment/claim deadline, with at most four-second-old attestation |
| `suspend` | `writerId`, `epoch` | Irreversible suspension of this one-shot writer; cannot reattest or resume |
| `revoke` | `writerId` | Immediately denies new capture/delivery permits; closure remains pending |
| `close` | `writerId`, `outcome`, `providerReceiptHash`, `releaseResult`, `capturedFrames`, `deliveredFrames` | Explicit drain/context-disposal acknowledgement; counts 0–120, delivered no greater than captured; immutable/idempotent close record |

`outcome` is `ended`, `failed` or `uncertain`; `releaseResult` is `released`, `failed`, `unknown` or `not_created`; receipt hash is SHA-256 or null. `not_created` is rejected after `create_dispatched`. Closure does not assert provider billing is settled. The trusted runtime must not send `close` until synchronous capture suspension, local buffer zeroing, transport termination, actual setup settlement, positively confirmed producer/context disposal and settlement of the in-flight capture have completed. Context-close or disconnect timeout/rejection leaves closure unconfirmed even if provider release succeeds. Cleanup/release/disposal work is installed before terminating transport. A response that has never enqueued a frame ends with empty EOF to avoid the hosting pre-header stream-error path; the client still treats this as a failed/disconnected watch, clears pixels and requests revoke. Once any frame may have been enqueued, transport is errored so queued bytes cannot drain. Neither empty EOF nor the hosting-completion diagnostic acknowledges physical closure. The registered hosting cleanup promise has a fifteen-second total budget; its completion is not itself a physical-closure acknowledgement. Exact-session release is attempted independently of producer disposal, with a ten-second wait and `unknown` on timeout. Late capture bytes remain zeroed; late cleanup results cannot rewrite an absent or immutable close record. No SQL or migration change is required for this runtime repair.

All admission/permit time is server-authoritative and rechecked after lock waits. The consumer computes a conservative monotonic deadline from a sample taken before the RPC plus `leaseUntil − serverNow − safety margin`; it must never extend a permit using response-arrival time or a browser wall clock. The server key is rechecked after any lock wait, including status reads. Current ownership/auth-session/Quest revision, workflow identity, quote/grant expiry, context/page epoch, suspension and revoke state deny every subsequent permit.

## Revocation, race fences and recovery

`revocation_pending` means exactly that. An expired lease, provider timeout, elapsed hard deadline or owner polling does not convert it to `revoked`. `expired` retains `streamClosure: "unconfirmed"` until a real acknowledgement. The only immediate owner-revoke acknowledgement is an enrollment that has never had a writer, which proves there was no stream to close and permanently prevents a later claim.

A single locked writer row and unique writer identity fence concurrent instances. Core Business ownership, workflow identity/status and enrolled R04 revision changes require separately committed revoke plus acknowledgement while an R10 writer remains unacknowledged. The guard raises without first writing a revoke that would roll back. Auth logout/session removal remains permitted and immediately denies subsequent permits. Existing issued permits remain subject to the producer's conservative two-second cutoff and its independent stop boundary.

The dedicated workflow cannot acquire a public browser session, product experiment or research link, preventing conflicting canonical Quest association. Direct owner/service writes cannot forge R10 workflow/task/worker/output projections. The dedicated pack/workflow/worker definitions and close audit artifacts are immutable.

A crashed writer may require administrator recovery. `private.r10_recover_close(session_id,provider_receipt_hash,closure_evidence_hash)` requires a known private provider session ID, prior revoke request, elapsed hard deadline plus two seconds, and positive independently verified provider-release and physical writer/transport-closure evidence. A timestamp alone is never sufficient evidence. Recovery is unavailable to owner/server RPC roles, does not provision a key, and cannot recover an ambiguous create whose provider identity is unknown. It records `uncertain`, leaves frame counts null (unknown), identifies administrator-verified recovery, preserves unknown liability, and creates the same immutable audit before releasing identity guards. Exact recovery retries preserve the original result.

## Core audit and validation

Enrollment creates a real exact-Quest workflow/task/worker lineage. Its Task Contract is run-level: `workflow_stage_run_id` is SQL `NULL`, which is valid and must not invalidate the saved task window. The UI labels this “Run-level task · No stage assigned”; omitted/malformed stage fields, wrong Business/run references and mismatched explicit Step/Agent selections remain rejected. No historical stage identity is invented. Claim moves those rows to running; explicit physical-close acknowledgement first closes the private writer, then projects completed/failed Core states. One immutable metadata-only artifact/event records the policy/source, task/worker IDs, captured/delivered counts, permit count, dispatch marker, closure authority, receipt hash, release result and unknown cost truth. No screenshot, page content, provider endpoint, credential or provider session ID is stored in that public audit.

`tests/r10-viewer-sql.test.mjs` supports an isolated PGlite pass and a mandatory fresh loopback PostgreSQL mode. The new dedicated `r10-sql` CI job runs PostgreSQL 17 and observed independent-connection lock races. The tests refuse non-loopback/non-`r10_test` destinations; they do not query or fingerprint production data. Coverage includes transactional migration rollback; preservation of prior functions/ACLs/authority; empty keys/grants; exact owner/session/Business/Quest/run bindings; immutable enrollment and definition; quote arithmetic; one-shot create and ambiguous liability; epoch/source/context fences; stale/expired permits; physical-ACK-only revoke; recovery evidence; Core audit lineage; bounded catalog with independent old selection; direct-role isolation; and claim/create/revoke/owner/key-expiry/late-projection lock races.

Local PGlite success is not proof of the PostgreSQL race gate, live provider qualification, financial approval, or embedded live viewing. Those claims require their separate evidence.
