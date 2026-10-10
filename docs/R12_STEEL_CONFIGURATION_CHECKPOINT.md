# Steel pre-create configuration checkpoint

This inactive checkpoint adds a create-only configuration boundary. It does not authorize a production migration, persistent Etsy access, provider session or paid model request.

## Enforcement

The scoped Steel adapter captures its configured key, official base URL and region once. A domain-separated HMAC binds that configuration to the reviewed project and actual production deployment/release. Key bytes are used only for authentication to the fixed approved Steel endpoints; they are not returned to owners or models, logged, or included in public release records. Before a paid create, SQL validates an independently reviewed attestation and returns a short-lived permit for the exact operation, saved scope and serialized request body. Each of the three dispatch markers consumes its own permit once and rechecks current authority, release, Stop, reviews, funding and held liability. Missing or stale proof blocks creation. Release, status and qualified receipt recovery remain available.

A separate one-GET helper can verify an independently known terminal session using the actual configured key. It accepts no alternate origin, redirect, retry, scrape or new-session probe. Exact private provenance remains separate from the safe status/time/proof summary. A fingerprint alone does not prove project ownership or billing plan.

## Qualification boundaries

The assembled application and core compiler checks, scoped lint and 337 focused inert tests pass. An initial missing core-build include for the new standalone readback helper was corrected; the failing log is retained separately from the successful rerun.

The current-source setup, verification and source lifecycle has passed locally against migrated PGlite, including real stored permits, negative bindings, expiry, revocation and cleanup. The mapped fresh-enrollment/model/source dry case also passed. Native concurrency, the actual PostgREST three-second role deadline, and exact-head Chromium/Next checks remain separate CI obligations.

Historical fixtures that deliberately stop before migration 21300 declare an inert configuration-admission leaf. That leaf refuses any database containing the real 21300 RPC. Those fixtures preserve older authority and receipt checks; they cannot qualify current-chain create admission. Genuine 21300 fixtures use the actual SQL permits and dispatch triggers.

The prior 94c9539 CI run exposed two test-host defects: omitted optional arguments became null during JSON transport, and an explicit loader omitted the genuine reviewer-quote module. This checkpoint preserves omission semantics without accepting null, maps the real module, adds cheap loader regressions, and retains full negative authority assertions and failure artifacts.

## Remaining activation requirements

- The separately versioned 21400 protected deployed same-owner action and private target/proof recording path are excluded from this checkpoint and must be qualified before obtaining real configuration attestation. The pure helper alone is insufficient.
- Obtain genuine current project/tariff, release and model-route evidence; do not use synthetic fixtures or expired proposal quotes as authority.
- Complete exact-release native, HTTP and browser qualification and the required production security/access approvals.
- Disclose recovery limitations: the current read-only inventory has not verified a usable data backup or restore point. Schema/security fingerprints detect drift but are not a backup. Preserve all historical ledger/evidence records and distinguish app rollback from database rollback.

The approved finite test remains at most ten combined cycle/repair units and USD10 total across providers. No live test success, production deployment, secret read or session creation is claimed by this checkpoint.
