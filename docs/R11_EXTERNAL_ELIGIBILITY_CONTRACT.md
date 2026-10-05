# R11 external eligibility and durable read-only connections

Status: implementation candidate; no R11 production migration, live grant or provider qualification is claimed. R11 remains active in the [sole canonical queue](AGENT_LABS_V2_IMPLEMENTATION_PLAN.md). R12 is not started. Accepted R10 controlled-public behavior is unchanged.

## Purpose evidence and boundaries

The [Etsy access review](ETSY_ACTIVATION_GATES.md) records the verified signed-in Personal Access status and own-shop application description. Deterministic own-shop shop/listing reads fit that recorded purpose. Marketplace research, Etsy-content model ingestion and publication without actual owner review are not established. The application description remains unchanged. The long-term autonomous operating goal has not been replaced with permanent manual orchestration.

Read-only Printful dashboard evidence separately identifies the target Etsy integration and its shop URL, distinct from the owner's native Manual/API store. API store ID/type verification will supplement that observation; it cannot establish product/listing/variant mappings or fulfilment readiness. Account/store identity, credential custody, provider purpose, financial authority and each mutation remain separate gates.

## Inactive source/model and legacy boundaries

`beginOAuth` now requires trusted admission before generating legacy write-scope OAuth state or a grant URL. The legacy UI explains its hold and links to the distinct read-only connection page. Saved legacy connection/disconnect controls remain intact.

`etsyJson` centrally requires admission of the actual method/endpoint, restricts the first-party origin, snapshots supported bodies/headers, and keeps no-redirect/no-retry/bounded-response behavior. Shop discovery admits the actual user-ID path. Draft/publication adapters recheck exact connection identity, revision, expiry and token after asynchronous admission. Existing-effect readback retains its separate gate.

Model dispatch requires an explicit request-bound provenance assertion. Unknown input lineage is denied, including derived creative/listing inputs previously labelled merely business context or private image. Source-free assertions cannot cover search, nonempty source scopes, public evidence or product evidence. Search requires finite canonical domains. External-source runtime eligibility remains closed: no production attestation producer or general R05/R07 source-evidence registry is qualified. No prompt scan, credential, domain or opaque eligibility hash establishes rights. Existing money markers/settlements are unchanged. A denial after a legacy reservation conservatively retains held/unknown liability; it does not prove an automatic unsent release.

## Additive SQL contract

`20261004235300_r11_scoped_connections.sql` adds seven private RLS-protected tables: grants, revocations, attempts, immutable dispatch markers, normalized facts, immutable credential-version metadata and current encrypted Etsy secrets. App roles have no direct table access. Four private helpers and two narrow authenticated RPCs are installed with fixed search paths and explicit grants. The migration seeds no key, grant, connection, credential, provider call or permission row. Earlier function bodies, ACLs, source artifacts and financial history remain unchanged.

- `r11_connection_read(business)` is an owner-only bounded projection. Grants and attempts are capped at 25, with independent totals; unused current grants sort first. At most two canonical provider connections exist in the current one-per-Business/provider schema. No credential envelope is returned. Server code strips internal fingerprints/aliases from connection display and exposes separately labelled nonsecret configuration fingerprints for approval binding.
- `r11_connection_owner(business, operation, payload, serverKey)` requires current ownership and a live authenticated session. Execution uses the existing enabled account server-key authority plus an independently installed exact R11 grant. Owner/key/session/grant/canonical locks precede authority decisions; freshness is rechecked after relevant waits. Direct owners/workers cannot mint grants.
- Grants pin provider/application, current owner/Business/auth session, expected store identity/type, purpose/approval hashes, an **approved credential fingerprint**, finite setup expiry, local connection cutoff and credential source. Changing the configured keypair/token before begin cannot inherit a grant. A fingerprint binds bytes; named-app approval and the owner's provider consent still establish provider application identity.
- Begin pins the canonical connection ID and expected revision/status, including explicit absence. One grant creates one attempt. Single-use consume and exact operation slots prevent replay. Late completion cannot overwrite a newer rotation or undo a disconnect.
- Completion writes only independently checked provider facts, the canonical `connected_accounts` identity, a new credential revision and appropriate secret custody. Existing legacy `etsy_connections`/`provider_connections` are not populated or reinterpreted. An existing legacy binding requires a separately reviewed bridge. This avoids leaking read-only credentials into old write-scope projections or vault handlers.
- Disconnect is owner/session authorized even when execution authority is disabled. It revokes local canonical status, clears current Etsy secret custody and cancels pending attempts; immutable proof/history remains. It does not claim provider-side revocation. Grant revocation, local disconnect, token expiry and local cutoff stay visible and prevent subsequent use.

R10's repository migration filename now matches applied history `20261004044247`. Its 44,192 bytes and SHA-256 `e208df7742e3f0c6e36153d84646c1d969dec4823cc616c077e78b82788786e9` are unchanged. Production history is never rewritten.

## Etsy: persistent read-only OAuth custody

The new route uses only `shops_r listings_r`, a fixed Production callback, fresh PKCE/state, secure HttpOnly SameSite=Lax cookie, exact owner/auth-session/nonce binding, and no Host-derived callback. It cannot use the legacy `listings_w` flow. Configuration is Production-only.

One admitted attempt allows one authorization-code token POST and two GETs: authenticated user's shop lookup, then the exact matched shop's first draft-listing page (`limit=1`, `offset=0`). There is no marketplace search, pagination, arbitrary listing ID, order/customer-data request, upload or write. The response must match the approved shop name, token user identity, exact shop and any returned listing identity/state. An empty draft page proves only endpoint access.

Require explicit returned scope evidence matching exactly the two read scopes. Missing scope stops as **granted scopes unverified**, not a claim of OAuth protocol invalidity. The official token guide documents scope, but its OpenAPI token response is not specified; a future introspection recovery requires separate review rather than an invented parser or extra request.

Access and refresh tokens are encrypted under the existing account vault key with distinct R11 access AAD, canonical Business/connection/revision binding and a local cutoff. PKCE/cookie namespaces are separate; consumed PKCE is removed from current custody. Raw access/refresh tokens never enter model inputs, generic artifacts, UI, errors or logs. Normalized identity/scope/hash facts are retained. This candidate saves refresh tokens for future separately authorized reuse; it does not yet qualify a refresh/resolver execution lane. The UI reports token expiry truthfully rather than implying current access for the entire local cutoff.

The callback is `https://agent-labs-two.vercel.app/api/etsy/r11/callback`. Registering it and granting OAuth are separate owner/access actions. Existing Etsy app key/secret environment variables can be reused after exact fingerprint approval; no key values need to pass through chat.

## Printful: environment custody and exact-store reads

A named server-only environment alias is bound to the exact approved store and credential revision. The token is never copied into the database. Only its nonsecret fingerprint and actual provider scope metadata are retained. A changed token cannot inherit the old grant/binding.

The narrow verifier performs only `GET /oauth/scopes` and `GET /stores/{approvedStoreId}`, with the selected store header on the latter. It never enumerates other stores. Provider type must equal the approved type, not merely be any non-native store.

Provider credential privilege is distinct from Agent Labs permission. An account-level or write-capable credential may be used only after its broader custody risk is explicitly approved; Agent Labs still receives only the fixed exact-store read path and application-level `catalog.read`. Grant policy is either exact provider-scope equality (set-wise), or an explicitly approved `inspect_and_record` mode for an existing credential whose actual scopes are initially unknown. Unexpected scope changes fail exact-mode verification. Actual scopes are shown after verification. Neither mode grants writes or access to other stores.

This does not prove the provider token is single-store, report provider-expiry introspection, or change the older conservative account verifier. The local access cutoff and current credential fingerprint remain independent checks. Removing the local binding does not delete an environment variable or revoke the token in Printful.

## Owner UI and acceptance

`/dashboard/connections?business=<exact-id>` shows independently scoped saved bindings, configured credential fingerprints, exact grants/consents, actual provider privilege versus application permission, recent attempts and local disconnect. Browsing only reads metadata. Missing configuration/grants and failed/expired attempts are explicit. No query-string notice can create a success claim. The old Etsy route links to this page.

Focused tests cover wrong app/key before begin, owner/session/state/nonce mismatches, duplicate callbacks, broadened/missing OAuth scopes, exact endpoint/identity checks, env-token changes, no secret persistence outside intended custody, source-provenance closure, stale rotations, disconnect races, immutable grants, additive rollback and unchanged old functions/ACLs. Hosted PostgreSQL observed-lock tests and real Next populated UI/action/navigation checks are required alongside the unchanged R05–R10 gates. Source and synthetic success do not qualify live credentials or commercial operations.

## Release and activation packet

Freeze exact migration bytes/hash and source tree, obtain independent security review, and pass the complete ten-job CI gate before release. Production schema installation and access activation require their own exact approval: target project/environment, affected objects, owner/Business/session, named app/store, current credential fingerprint, purpose evidence, scope policy, expiry, callback registration, custody and bounded call counts. The user enters/configures any secret through supported secure surfaces and completes OAuth consent. No paid model/browser test or commerce operation is included.

After qualified software release, verify the Production-environment build, exact commit/tree, alias, health, signed-in metadata/empty/error paths and scoped error logs. Then record separately authorized real read receipts and retained failure evidence. Rollback revokes new grants and stops new reads; do not erase history or drop production tables. R11's broader external-data/source eligibility remains explicit until its own evidence/enforcement is qualified.
