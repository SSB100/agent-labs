# Steel configuration readback: inactive qualification checkpoint

This checkpoint adds an authenticated owner action for one independently reviewed existing-session metadata read. It does not activate direct Etsy research or change the pending production/access approvals.

## Boundary

- A private, immutable reviewed target pins the owner, Business, known terminal session, project, deployment, configuration, observation time and review hashes. The owner supplies only its hash; no arbitrary URL or session identifier is accepted.
- The deployed action uses the existing eligible R05 root capability and current authenticated owner. No key or persistent grant is created. Delegated research keys are rejected.
- A durable claim admits at most one bounded GET to Steel's official session endpoint. It never lists or creates sessions, opens recordings, returns credentials, or signs in to Etsy.
- The response must match the independently known session/project and terminal state. Exact provider creation time must precede the independent observation; a rounded dashboard timestamp is never turned into a fabricated instant.
- The proof is private. The page receives only status, observation time, opaque target hash and proof hash. A verified result establishes the configuration match, not Etsy account access or complete release qualification.
- Cancellation and revocation block new claims and acceptance of late proofs. They cannot unsend an already claimed or in-flight read-only GET. Lost acknowledgments reconcile saved state rather than send another request.
- Publishing reviewed routes, tariff evidence or the pre-create attestation remains a separate trusted review operation. The ordinary owner action cannot manufacture these qualifications.

## Normal owner path and test boundaries

The existing Etsy research page displays saved metadata status without provider access during rendering. Explicit verification and cancellation actions preserve the selected Goal, envelope and enrollment review navigation. Missing or stale authority remains unavailable.

The current integration must demonstrate: reviewed target → actual owner action → inert bounded provider response → saved proof → explicitly operator-only qualification publication → normal owner enrollment/access/research actions → real configuration permits → independent reviewer. Synthetic provider responses qualify application behavior only. Native PostgreSQL concurrency, actual HTTP and Chromium checks must pass on the exact published head before release qualification.

## Production and recovery

No production migration, deployment, configuration readback, browser session or paid inference is claimed here. Foundation release 967aa650 is CI-qualified but remains undeployed pending its security approval; direct permissions require their own exact approval.

Before rollout, reconcile the current schema and security definitions against the reviewed baseline and preserve per-migration receipts. Each migration is individually transactional; the entire sequence is not automatically atomic. Application rollback does not reverse database history or provider liabilities. Preserve all evidence, ledger, Stop and cleanup records and keep a compatible cleanup/accounting executor available.

A restorable production data backup or PITR point has not been verified. Catalog hashes are drift checks, not a backup. Do not infer automatic backup availability, purchase a plan, invent migration history, or use destructive rollback to erase consumed authority or costs.
