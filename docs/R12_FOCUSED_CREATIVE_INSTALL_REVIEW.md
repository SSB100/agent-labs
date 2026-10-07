# R12 focused creative installation amendment

Status: implementation and isolated verification only. Live execution remains conditional on the applicable confirmation policy and exact-tree release gates. This setup-only record adds no permission grant or dispatch authority; the existing approved six-call scope remains in force. No live installation, authority, provider request or expenditure was made by this amendment. The five frozen definitions/operator identities in `R12_FOCUSED_PILOT_ACTIVATION.md` remain unchanged.

## Why this separate step is necessary

The approved focused bridge requires an exact installed creative snapshot. The original creative enrollment module only accepts an already prepared run; it cannot create that installation. Ordinary Activate correctly rejects this experimental release. Promoting the release globally would violate the existing creative runtime's explicit experimental-catalog guard. Earlier offline fixtures inserted the installation directly and therefore did not prove a legitimate setup path.

The new import-side-effect-free module is `scripts/r12-focused-creative-install.mjs`, SHA-256 `298d00d5ba99a2423fb0ccf79c2e4d8fb20d3aa35d17ad18726678c5fb67d2d3`.

## Exact destination and catalog

Read-only catalog observation on October 7, 2026 at approximately 03:58 UTC:

- Business: `91ff7c87-60e4-4dbb-8e84-be63b53c2c79`
- Current owner: `1b9642c5-3e08-478a-b215-4c095d2f4e58`
- Root: `workflow.etsy-creative-pipeline@1.0.0`, `a236d30d-b453-4e94-8d34-4615d21b300a`
- Installed snapshot hash: `c70ab401742dc8491da8d5dcfb25d783cabdc8f24eae3b8c71d4d04cd7ea6f61`
- Complete catalog hash: `8f62a79e34297742b4cb5fbc64c3a64f20d28bcf4aa2c1dad633b64427d7d9ef`
- All six resolved releases remain experimental

The installed snapshot is precisely `{rootPackId,releases}`, with the existing resolver's canonical release order. The complete catalog hash uses `private.stage14_hash` over five ordered arrays: full pack, workflow-definition, worker-definition, knowledge-definition and capability-definition rows for those releases. Arrays are sorted by row ID and empty arrays remain arrays. This deliberately includes row timestamps and statuses; even a metadata-only change requires review rather than silently refreshing the pin. `CATALOG_PINS_SQL` is an exported read-only observation query.

## Reviewed execution input and order

After the two focused research phases finish with a real accepted TEST, use the genuine owner adoption action. NME or REJECT cannot satisfy the existing adoption/currentness validation. Inspect the exact saved adoption and prepare an operator input with:

- Version `r12.focused-creative-install.1`
- The fixed Business and owner IDs above
- Exact `adoptionId`, `adoptionProofHash` and `resultHash` from that genuine adoption
- `installationId` derived by the existing SQL helper `private.stage4_deterministic_uuid('r12:focused-creative-installation:' || adoptionId)`
- The fixed `snapshotHash` and `catalogHash` above
- Actual `approvalHash` and `independentReviewHash` for the reviewed installation amendment/input; synthetic test labels are never live evidence
- An explicitly reviewed `installBy` setup cutoff no later than the adopted proof's expiry or one day away, with at least sixty minutes still available at execution
- `installForFocusedPrivateLearning: true` and `dispatchAuthorized: false`

Pass that input explicitly to `runOperatorRecipe(dedicatedApprovedClient, 'install', input)`. The module never creates its own connection, reads environment variables or secrets, changes roles, impersonates a session, derives a credential, fetches a provider, retries or upserts. Uncertain completion requires readback of the actual privileged `installed_packs` row, its deterministic identity, exact snapshot/catalog and current adoption pins, together with the review event. Ordinary events can also be inserted by authenticated owners, so an event alone is never evidence that this operator ran or that installation succeeded. Never substitute another installation ID to retry.

The SQL locks the exact Business owner, revalidates the accepted adoption against its original stored research/receipt evidence, checks current candidate/experiment/decision identity and supersession, verifies one generation with the existing USD 0.370494 creative proposal ceiling, and rejects paused, stale, changed or already installed scope. It share-locks the catalog rows, resolves again and checks both frozen digests before inserting.

## Exact security and retention delta

Only two persistent rows are written in one transaction:

1. One active `public.installed_packs` row with the fixed root and exact resolved snapshot
2. One deterministic `public.events` row, `r12.focused.creative.installation_reviewed`, retaining the bounded nonsecret reviewed input and receipt, including its exact adopted TEST/proof hashes

No migration, table, function, grant, RLS policy, catalog release status or catalog definition changes. No existing row is overwritten or superseded. The review event is an audit record, not an execution capability. `installBy` gates the installation action; it does not expire or delete the persistent installation row. That exact same-Business installation may later be referenced by another fresh adoption only through its separate current TEST, explicit production approval, Prepare and financial/scoped enrollment gates. This amendment does not make installation a one-use execution capability. Existing retention applies; no automatic deletion is introduced.

The receipt declares `authorityCreated: false`, `shouldDispatch: false` and `providerCalls: 0`. Installation itself creates no creative approval, workflow, capability, policy, cap amendment, server verifier, provider request, settlement or scoped enrollment. Subsequent use still requires the distinct explicit production-purpose approval, current physical/rights/policy checks, normal Prepare, exact four-call R05 confirmation, just-in-time scoped enrollment and once-only Start. Ordinary Activate and generic installed-pack workflow launch continue to reject the experimental catalog.

Six calls maximum and USD 0.648401 total new liability remain unchanged. The research and creative subtotals, existing funding history, fresh endpoint qualification, retention disclosure, source cutoffs, 30+30 windows, image limit and all stop conditions remain those of the original packet.

## Isolated verification

- `tests/r12-focused-creative-install.test.mjs`: 3/3 passed, covering fixed read-only pins/write set, parameterized transport, rejected recipe kinds, SQL failure, ambiguous result and uncertain commit without retry
- Full isolated `tests/r12-discovery-scope-sql.test.mjs`: 2/2 passed using PGlite, including the complete accepted TEST → actual adoption → this installation → production approval → Prepare → R05 confirmation/enrollment → four inert creative phases
- Installation matrix rejects 15 changed/missing input cases, anon/authenticated/service-role operator access, owner transfer, definition drift, catalog promotion, Business/Goal/installation pauses, a no-longer-completed source plan, an unrelated mismatched existing installation and duplicate installation
- Injected result-transport failure after both persistent inserts proves the recipe rolls back the installation and audit event before outer fixture cleanup
- Full catalog and all financial/authority/creative run rows remain identical across installation; the exact audit event and snapshot are checked
- Ordinary Activate fails before and after installation; generic installed-pack launch remains blocked
- Hydrated/HTTP fixture setup now starts with no creative installation and runs this recipe only after genuine adoption; the fixture-only adoption grant was removed
- Targeted ESLint passed without warnings

Hosted hydrated verification and the exact-tree release gate remain the parent's release checks. No live outcome is implied by offline fixture evidence.
