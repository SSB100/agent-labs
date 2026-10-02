# Core account setup and Stage 15 connection completion

Status: implementation independently reviewed, hosted checks passed, and reviewed database installation approved/applied; provider activation remains separately gated. This fills the account setup/storage gap in implementation-plan §§4.4, 7.10, 13.2 and 15.6. It does not promote Stage 19, qualify the product/mockup pipeline, install credentials, create a real external account or authorize a paid browser session.

## Owner experience

The Accounts page now selects a Business and exposes a real owner-scoped reusable profile, exact setup review, durable requests, connected-account registry, safe history and revocation. Needs You links pending account decisions to their exact Business. Missing database records are reported as unavailable, never as an empty queue or absent account.

The profile contains only dedicated email, given/family name, country code and locale. It does not create an email mailbox or collect health, children, banking, tax or identity-document information. Saving a profile revokes old setup approvals; the server attempts to close their live owner browser sessions and reports uncertain closure separately from a successful save.

A setup request binds provider, create/connect mode, profile revision, exact shared fields and values, official destination, Terms and Privacy links, fixed scopes, zero new provider spending authority, secure owner steps and a 30-minute approval lifetime. Creation separately discloses Browserbase processing and requires explicit browser consent. API connections share no reusable profile fields.

Pending → exact approval → one-time routine preparation, where available → secure owner step → independent provider connection verification. A prepared form, checked terms box or owner statement never proves that an account exists. Repeated clicks, stale revisions, changed profiles, cross-Business requests and uncertain dispatch cannot silently create duplicate accounts. Cancelling does not undo a request already sent to a provider; authority is rechecked immediately before each subsequent external step.

## Credential boundaries

Store selection clarification (2026-10-02): [Etsy selling topology](ETSY_PRINTFUL_TOPOLOGY.md) requires deliberate selection of the intended Etsy-linked Printful store, rather than a temporary Manual/API store. The secure form has no selected store type by default. Existing SQL binds one store per Business and denies replacing that store ID even after disconnect; this release does not change that restriction. Neither supported connection type enables product execution or establishes supplier order confirmation.

- Etsy OAuth/access/refresh tokens remain in the existing private Etsy envelope and use the existing key, PKCE, owner/browser binding and scope rules. This feature does not migrate or rewrite old Etsy secrets
- Printful receives an owner-entered store token through a dedicated secure app form outside the managed browser. The server makes bounded read-only `/oauth/scopes`, `/stores`, and `/stores/{id}` requests, rejects broad/unknown/write scopes or multi-store inventory, verifies the exact store ID/type, then encrypts the token
- Printful's application permission is only `catalog.read`. Provider scopes are separately recorded; no-scope catalog access does not prove absence of all provider capabilities. The provider does not report token client type or actual expiry here, so those facts remain unverified. The local cutoff is at most 31 days
- Optional website passwords are separate owner-entered, unique per-service encrypted entries. They are not a reusable master password and are not scraped from browser sessions. Saving does not change or verify the password at the website. No plaintext read/autofill API is exposed to models, workers or this first-release owner UI; the owner should keep their password-manager copy
- Website-password removal is a separate exact-revision, explicitly confirmed action. API disconnect retains this saved copy and says so. Neither action changes the provider's website password
- AES-256-GCM uses random nonces and a separate `account-v1` namespace, binding Business, credential class/provider, connection and revision. Encryption keys and server authority remain server-only configuration. RPC payloads contain only envelopes for credentials; no secrets enter receipts, ordinary UI, model arguments or application logs

Printful disconnect removes Agent Labs' stored API token and invalidates local access. Etsy disconnect executes the existing procedure atomically after an exact-revision check. Provider-side grants/tokens may require separate revocation at the official provider portal. The UI does not claim local disconnect revoked a remote grant.

## Supported signup preparation

The deterministic registration runner was based on read-only inspection of the current public Etsy and Printful forms. After the precise approval, it can navigate the official provider, match visible controls/labels/field types, fill only the disclosed ordinary fields, and check the specifically approved Printful Terms/Privacy checkbox only when both displayed links match. It never types passwords, clicks final account submission, handles identity/bank fields, accepts unexpected costs, grants new access, or solves an unapproved CAPTCHA.

Current Steel sessions automatically record and have no verified recording-off option, so this runner never transmits profile data through Steel. It does not fill a disposable browser and pretend those fields transferred into the owner's separate browser.

The narrow Browserbase adapter explicitly requests `recordSession:false` and `logSession:false`, no persisted context, no proxy or automatic CAPTCHA solving, and an expiry capped at 15 minutes and the approval lifetime. It keeps the signup origin bounded, disconnects the agent's CDP channel before secure owner entry, checks that the provider session remains live, and encrypts the owner viewer URL/session identifier behind an authenticated Business/run-bound lookup. Raw browser endpoints do not enter ordinary setup records, artifacts or receipts. The owner page does not reconnect automation after secrets are entered.

The chosen disconnect/resume design uses existing paid `keepAlive` entitlement. That is an implementation-specific requirement, not a universal claim that secure signup requires a paid plan. A trusted long-lived exclusive owner broker could avoid it, but such authenticated broker infrastructure is not present in this request-scoped application. No official documentation was found establishing that an owner Live View connection alone preserves a non-keep-alive session after agent disconnect. Free-plan pricing is not evidence of the user's entitlement. Self-hosting a broker is outside this small batch.

Activation requires the separately approved provider key/project, enabled flag, browser budget approval and verified keep-alive entitlement. No account, subscription, key, grant or paid session is provisioned by the code or migration. Flags disabling session recording/logging are not a promise of zero provider operational retention. Provider processing and retention must be reviewed before activation. This short-lived browser is isolated per setup attempt; persistent reusable browser-authentication contexts remain outside this release.

Owner close, cancellation, profile changes, connection revocation and successful verification disable the local handoff and attempt remote release. A successful release request is insufficient: terminal provider status readback is required before claiming the browser closed. Uncertain closure is reported; the bounded session deadline remains the final limit. Cleanup can retry without re-opening registration.

## General browser protections

Planner observation and action boundaries classify secrets using type, name, ID, labels, autocomplete and sensitive page context, including hidden fields and echoed page text. Sensitive pages are withheld, URL authentication material is removed, and sensitive typing or secure-form submission is refused. Ordinary search/tracking URLs keep useful control semantics. Fresh observation and exact target-binding checks prevent an old positional identifier from clicking a different control after DOM reordering. Provider errors are reduced to safe codes.

## Database and verification

See [the exact SQL authority contract](ACCOUNT_SETUP_SQL_CONTRACT.md) for the eight new private RLS tables, the sole new authenticated owner-plus-server RPC, unchanged old tables/functions/grants, isolated migration and rollback evidence, and remaining provider/security activation gates.

Focused tests exercise actual encryption, provider parsing, one-store/scope verification, exact profile consent, cancellation between steps, stale DOM mutation, safe error reporting, independent Etsy readback, password/token separation, browser termination readback and safe owner UI states. Hosted Chromium source-rendered layout checks use fixtures and block external networking. They are UI verification, not real provider qualification. Local Chromium cannot start under this execution sandbox's socket restriction; those checks must run in hosted CI.

No live browser session, account signup, provider token submission, mailbox creation, product configuration, paid order, model call, Etsy publication or live qualification is part of offline testing. The separate product/mockup and account-specific fee-authority gaps remain open.

Hosted Node 22 validation passed all **947 tests with zero failures or skips**, including all six Chromium checks, and the optimized build. A secure-form accessible-label issue found in the first hosted run was corrected and the exact gate rerun. The final local `npm run check` passed: ESLint, application TypeScript, all **941 executable Node tests** (zero failures; six browser checks reserved for hosted CI), Workflow generation and the Next.js 16.3.8 optimized production build. Local Node was 24.19; hosted CI must verify the repository's Node 22 target. Independent review found six issues that were corrected and rechecked, including exact node identity across identical-control reordering, cancellation before further disclosure, atomic Etsy revision-safe disconnect and terminal browser-release readback. The final focused independent review passed 127 tests with zero failures and three local browser skips.

## Official references checked 2026-10-01

- [Printful API](https://developers.printful.com/docs/) and [scope documentation](https://developers.printful.com/docs/edm/)
- [Printful token management](https://developers.printful.com/tokens), [signup](https://www.printful.com/auth/register), [terms](https://www.printful.com/policies/terms-of-service), [privacy](https://www.printful.com/policies/privacy)
- [Etsy signup](https://www.etsy.com/join), [terms](https://www.etsy.com/legal/terms-of-use), [privacy](https://www.etsy.com/legal/privacy)
- [Steel session recording](https://docs.steel.dev/overview/sessions-api/embed-sessions/past-sessions)
- [Browserbase recording/log opt-out](https://docs.browserbase.com/account/enterprise/zero-data-retention), [session replay](https://docs.browserbase.com/platform/browser/observability/session-replay), [owner Live View](https://docs.browserbase.com/platform/browser/observability/session-live-view), [keep-alive](https://docs.browserbase.com/platform/browser/long-sessions/keep-alive)
