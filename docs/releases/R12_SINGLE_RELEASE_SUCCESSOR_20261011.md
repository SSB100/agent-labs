# Single release transfer for the confirmed setup repair

Status: isolated implementation and focused qualification only. No production migration, release binding, provider request or paid operation has been performed by this change.

## Scope and invariants

- Preserve the original repair review, confirmed proposal, one-unit debit, recovery, package and envelope byte-for-byte.
- Permit at most one immutable successor per original repair review. The predecessor foreign key cannot reference another successor. Identical retries return the same review; conflicting retries fail.
- Publication, replacement setup and revocation share the existing Business row lock. Select current release and revocations only after acquiring that lock.
- Validate historical predecessor identity independently of its obsolete database fingerprint. Validate new release evidence with the unchanged normal validator, including all three exact-head CI artifacts and the post-migration definition fingerprint. Insert and normal current-test validation are atomic.
- Either predecessor revocation, successor revocation, successor expiry or stale definitions fails closed. No fallback to the predecessor is allowed.
- Publish only while the confirmed replacement has no setup, other browser operation, configuration admission/use, dispatch, handoff, verification or research setup.
- The v2 owner view adds a separately self-hashed effective-release projection. It retains the original proposal, identifies its debit and uses the effective exact deployment/commit for preparation. Reads take the Business lock but perform no DML; the function is deliberately VOLATILE.
- Quote revalidation uses the existing exact operation/scoped key before preparation. No new key, grant, debit, profile, deadline, browser/model operation or cap is added.

The production intent remains the already-confirmed replacement `a50643ca-4b0c-46b7-a0dc-2aee216cc544`, original review `21052e128dd850c2e0d81411c58dd1d498bf65fdac2a714a2a27812f5972ae80`, one held US$0.025 original reservation, eight remaining research units, US$10 combined cap, lifetime dispatch ceiling 57 and saved access/test expiry no later than 2026-10-12T02:06:00Z. The new integration fixture exercises these monetary/unit/ceiling bounds using synthetic identities and inert provider evidence.

## Migration and qualification

Migration: `20261011111003_r12_steel_single_release_successor.sql`, created with official Supabase CLI 2.120.0.

SHA-256: `7ce6b3653c4c2a7bf7ff9d2b2019a18ac466a663b9a94fe048c6c189236c2bff`.

Focused checks:

- `npm run pretest` and `npm run typecheck`.
- Scoped ESLint for changed source, helpers and tests.
- `etsy-steel-replacement`, `etsy-steel-recovery-owner` and `etsy-steel-recovery-page`: positive v2 projection, rehashed negative pins, missing projection, legacy confirmed-view rejection, stale effective expiry and wrong environment identity.
- `r12-steel-replacement-expired-quote`: real owner source and migrated SQL, naturally expired original quote, revoked genuine scoped-key failure, successful normal revalidation and preparation, replay, zero provider calls. The prior red/green quote correction remains inherited from commit `5df0b20e04946c069c6e298eee36ce20ecac3a3e`.
- `r12-steel-release-successor-sql`: old-definition history and confirmed debit, migration afterward, real publication, naturally expired historical proposal and successor, wrong evidence/lineage/configuration, original-row snapshots, fresh access/configuration, one-shot create and third-login denial.
- `release-gate`: unchanged full release dependencies, exact branch routing and no Vercel branch deployment.

Native PostgreSQL races are explicitly not claimed from PGlite. Five new named cases in the existing direct-qualification matrix require positive observed multi-backend lock waits: identical/conflicting publishers, publisher-before-setup plus successor revocation before paid create, setup-before-publisher, original revocation-before-publisher, and publisher-before-original revocation. Each receives its own fresh isolated CI database. The SQL transition and expired-quote tests are also explicit matrix entries.

The exact branch `codex/r12-single-release-successor-20261011` is added to normal CI push routing and the matching qualification event allowlist. All full-release jobs remain required. Vercel deployment is disabled for that exact branch. Main deployment configuration is unchanged. One normal full qualification is intended for the frozen reviewed source commit; no extra workflow, schedule or expanded branch pattern is introduced.

## Separate production authorization still required

Before production activation, obtain approval identifying this migration's exact SHA-256 and the exact one-time transfer from the original repair review/debit/proposal to the reviewed commit/tree/Production deployment. The final successor review must contain genuine exact CI and deployment evidence, fresh post-migration database fingerprint and separate security/release-transfer approval hashes. Apply all reviewed definitions before computing that fingerprint. Do not change functions afterward or exempt them from the fingerprint.

The old consumed metadata proof and attestation authenticate only original production `3cc75917e91c2922c84a1c4b12d5c2ed45277de9` / `dpl_95ZRehu5ddfz86yZpAhF3tjJobwk`; they cannot be reused or relabeled. A separately authorized fixed-known-session metadata GET and fresh independently bound configuration attestation are required for the successor deployment. Ordinary exact recorded-access approval, renderer qualification, configuration admission, financial and one-shot gates still apply before any start. No new access duration or credential authority follows from release publication.
