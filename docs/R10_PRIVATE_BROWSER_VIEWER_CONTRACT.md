# R10 privacy-safe controlled-public viewer

## Current implementation and release boundary

R10 adds the real owner dashboard → authenticated same-origin route → trusted capture producer → streamed JPEG → canvas path. The only eligible source is a **dedicated controlled-public qualification workflow**. It does not make existing Stage 8/9 browser sessions watchable. Registration, credential entry, takeover, persistent profiles, arbitrary websites and ordinary mutable worker pages remain excluded with the saved-metadata fallback.

The qualification is a real browser rendering the exact reviewed static document in `src/browser/watch/contracts.ts`, under `r10.controlled-public.v1`, SHA-256 `9165948e0a968e0a00be7bc22d4ec89862b84733577ca4a4fb9622238c2c42cd`. The synthetic origin `https://r10-viewer.invalid/controlled-public` is fulfilled locally in the remote browser's interception layer. No request reaches that hostname or any external website. Actual frames prove capture and delivery of this source class, not generic safe-site browsing or productive marketplace work.

Software tests and UI fixtures do not close the plan's separately authorized live-session exit. Production server authority and qualification grants are absent by default. No secret, provider session, viewing grant, account access or usable execution permission is installed by the migration. Live activation requires reviewed exact key registration/configuration, one-shot enrollment, provider purpose/pricing evidence and explicit approval. The migration has its own approval boundary.

## Identity and trusted enrollment

The private enrollment binds owner, current authenticated session, Business rules revision, managed R04 Quest revision, dedicated workflow, private browser-session ID, reviewed source/policy hashes, expiry, finite runtime, approval reference and a quoted maximum exposure. The enrollment creates a distinct Core workflow/task/worker record; it never attaches to a legacy browser or claims its page is the qualification source. Its records and bounded metadata-only close evidence are inspectable through the existing owner workspace.

Enrollment is administrator-only. Owner metadata, a saved `live` flag, null URL, fixture labels or client JSON cannot create it. The empty server-key table is a second authority gate. Every server operation is exact-scope and checks the registered server key; every new permit verifies current ownership, active auth session, unchanged managed revisions, unambiguous Quest identity, purpose and hard deadlines after lock waits. Native provider URLs are never stored in public session metadata or `private.browser_session_secrets` and never returned to clients.

The quote is a separately approved qualification bound, not an R05 operating allowance or provider-enforced monetary cap. No grants or shared budgets transfer from another workflow. A create attempt is durably marked before its single POST. Ambiguous creation consumes the grant; no automatic second session is created. Liability remains unknown without actual independent cost evidence, including after a successful release.

## Capture before pixels

The producer creates a fresh nonpersistent BrowserContext and its own page. It does not inspect or reuse a default context, saved profile, account state or legacy page. Before page creation it installs HTTP and WebSocket confinement. It disables JavaScript, service workers, downloads and permissions; it imports no storage, cookies or extensions and enables no Playwright recording/tracing. Steel's public documentation states that provider sessions are automatically recorded; this implementation does not claim to disable provider recording or prove provider retention/deletion. The separately approved qualification exposes only the fixed public document to that recording. Only the first exact GET for the reviewed document is fulfilled, with restrictive CSP and no external resources. Every other request is aborted.

The actual created context/page objects are bound to a single capture epoch through unique server-generated identities. Eligibility is established only after the source loads, with exactly one page/frame and empty cookies. Popups, extra frames/pages, downloads, dialogs, navigation, crash, disconnect or unexpected traffic synchronously suspend capture. There is no resume within a consumed qualification session.

The producer captures only JPEG viewport frames, at most 150,000 bytes each, at most 120 frames, at most one per second and within a 120-second maximum provider/runtime grant. The Steel adapter rejects creation below its documented 15-second minimum. No frame database, replay, shared cache or queued screenshot source exists. The audit field `deliveredFrames` counts successful releases at the server enqueue boundary, not confirmed client receipt. Buffer bytes are zeroed when dropped. Provider endpoints and keys remain in server memory; the official fixed Steel CDP origin is bound to the exact returned session UUID and cannot create an implicit new session by omitting its ID.

## Active delivery and revocation

The viewer is one authenticated POST stream, with one durable, nonreplaceable writer. Copied identifiers, concurrent starts and reconnects cannot reuse its consumed grant. There is no GET-triggered launch, native iframe, user input channel, CDP passthrough, clipboard, upload or arbitrary URL parameter.

Every screenshot and delivery is fenced by a fresh, at-most-two-second server permit. The local deadline uses monotonic time sampled **before** the RPC, minus a safety margin, so a delayed reply cannot refresh old authority. The producer checks the fence before capture, after awaits and synchronously immediately before enqueue. A final synchronous abort/deadline fence also guards paid creation after asynchronous admission. Transport creation and release reject redirects. Creation explicitly disables proxy and CAPTCHA-solving add-ons. Release requires the documented semantic success flag, not HTTP success alone; it does not establish deletion of provider recordings or settle billing.

The independent server stop watcher runs even when the response is backpressured. Revocation prevents new permits immediately. On interruption, the runtime first synchronously suspends capture, drops buffers and errors the stream; then it disposes the producer and attempts provider release. Only after confirmed producer disposal does it acknowledge stream closure. Failed or partial construction cleanup cannot be acknowledged accidentally. A deadline alone never proves physical stream closure. The database retains `revocation_pending` when acknowledgement is unavailable.

Acknowledged closure fences future capture/enqueue; bytes already emitted to the network/client cannot be recalled. This source class never admits private source pixels in the first place. UI clearing is an additional usability safeguard, not the security boundary. The private recovery operation requires separate trusted closure/release evidence and does not infer closure from elapsed time or erase unknown financial liability.

## Owner UI and headers

The existing exact Business/Quest/run centre selector adds bounded R10 metadata through a pure authenticated catalog. An unavailable catalog does not reinterpret legacy metadata as safe. The panel labels the source “Controlled public qualification,” requires an explicit Watch click and preserves exact URL context. The client consumes strict bounded NDJSON, validates fresh monotonically ordered JPEG packets, renders a canvas and clears it on stop, stale data, invalid packets, page hide, navigation or disconnect. It does not reconnect automatically.

Stop reports success only with a physical close acknowledgement; abort-before-revoke ordering is idempotently treated as already stopped. Pending/failed revocation stays visibly unconfirmed. Existing global `X-Frame-Options: DENY` and other security headers remain unchanged. The response is same-origin, private/no-store, no-referrer and non-embeddable. No native endpoint appears in markup, logs, URLs or public records.

## Required evidence

- Inert unit and production-seam tests cover scoped authorization, false admission, one-shot creation, malformed endpoints, delayed dispatch, capture confinement, source transitions, stale permits/frames, backpressure, revocation, ambiguous creation, failed partial cleanup and exact close truth
- Dedicated isolated PostgreSQL tests cover full migration replay/rollback, old function/ACL/data preservation, current auth/owner/Quest binding, copied/concurrent writers, lock-wait expiry, revocation and immutable enrollment/evidence
- Hosted actual Chromium exercises the real capture constructor; actual production Next exercises auth/route/stream/client/navigation/layout and close behavior with only the provider/authority boundary substituted by inert dependencies
- Exact-head complete CI is mandatory before release, followed by migration approval and exact-SHA deployment verification
- A separately approved harmless remote-provider qualification must prove this exact production path, actual fresh-context support, embedded frames, cancellation/cleanup and factual records. Historical Stage 8/9 provider qualification is insufficient

The older two optional legacy SQL harnesses and the known incomplete 200% screenshot captures remain separately disclosed. Source/layout geometry tests do not silently replace missing image or live evidence.

## Official technical references

- [Playwright context isolation](https://playwright.dev/docs/browser-contexts)
- [Playwright network routing and service-worker boundary](https://playwright.dev/docs/network)
- [Playwright Route.fetch redirect controls](https://playwright.dev/docs/api/class-route#route-fetch)
- [Steel API/CDP authentication and explicit session identity](https://docs.steel.dev/overview/authentication)
- [Steel session lifetime and timeout units](https://docs.steel.dev/overview/sessions-api/session-lifecycle)
- [Supabase auth session identity](https://supabase.com/docs/guides/auth/sessions)
- [Vercel streaming](https://vercel.com/docs/functions/streaming-functions)
