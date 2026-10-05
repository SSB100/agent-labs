# R09: reviewed reusable Knowledge

## Scope and release boundary

This implements only R09 in `AGENT_LABS_V2_IMPLEMENTATION_PLAN.md`, on the accepted R08 tree `3a2b63b9fea318d960a5a25a7f0a28c4c4645961`. It does not activate a provider, model, commerce path, scheduler, account connection, capture viewer or R10. A schema migration and a production deployment need their separate release approval and exact-tree gate. No learned release, reviewer credential or production fixture is seeded.

The preceding maintenance commit renames the R08 source migration to its actual applied version `20261003224010`, preserving the SQL SHA-256 `3e4e7b8f91b5429dfd3c264e0ee02ca917996738ff65f679d972b16ac1b174cb`. Production migration history is not edited or replayed.

## Four kinds of information

1. **Business-private operational evidence.** Original artifacts and exact proposal versions belong to their Business. Their immutable database-derived snapshots and fingerprints establish what the proposer actually supplied. They are never copied into a globally readable pack or another Business's read.
2. **Provisional findings.** A private proposal is an unqualified hypothesis. A successful local experiment, owner assertion, model judgment, schema-valid JSON or review checkbox is not generalizability evidence.
3. **Reviewed reusable guidance.** Only the restricted platform review/promotion path can turn a bounded, independently checked, safely redacted lesson into an immutable information-only knowledge release. An ordinary owner or service-role request cannot impersonate that path.
4. **Dated external sources.** Public source content hashes, verification dates, expiry and support/contradiction status remain explicit. Guidance is not a continuously updated policy feed or evidence that a specific operation is currently permitted. Existing policy packs retain their own exact pins and freshness gates.

## Lifecycle and authority

### Private proposal

An authenticated Business owner submits a bounded title, lesson, scope, limitations and exact artifact IDs. The server establishes ownership and derives evidence from those exact artifacts. It rejects foreign-Business evidence even when the same user owns both Businesses. Credential-like content is rejected before retention. A revision appends a new immutable version and requires the previous version number; original versions and evidence remain available. Submission IDs make identical retries idempotent and conflicting retries fail closed.

### Independent evidence review and redaction

The platform-only review operation records a reviewer identity and fingerprint distinct from the proposer, verdict, redaction result, preservation of necessary proof, generalizability reasoning, limitations, conflicts, public sources, expiry and private notes. There is no newly provisioned review key or broad client grant.

The operation's caller is a trusted database/platform operator. The function validates the shape, bindings, freshness and explicit attestations; it cannot independently infer semantic privacy or truth from prose. The operator must actually inspect source evidence and the exact candidate shared text. Claiming the checks passed without doing that review is prohibited.

Approved promotion requires all of the following:

- Evidence that the lesson generalizes beyond one local outcome, with at least two separately reviewed supporting public sources on distinct hosts
- An independent semantic check of those sources, their relationship to the proposed lesson, provenance and dates. Distinct hostnames alone do not prove independence or generalizability
- No unresolved contradictory evidence. Contradictions remain in the private review history, and the lesson must be revised or stay unqualified
- Redaction accepted, all private customer/account/Business content removed, and the necessary proof preserved. If safe redaction destroys the proof, the lesson remains private or unqualified
- A bounded scope, limitations and expiry no later than any supporting source's expiry, and no more than 90 days from review

Shared fields are closed informational structures. Raw artifacts, private proposal text, Business IDs, account data, credentials, access, budgets, operating envelopes, qualification evidence and reviewer private notes are not shared pack fields. Content scanning and shape validation are additional safeguards, not substitutes for semantic redaction review. Any live promotion that would disclose personal data requires its applicable explicit data-sharing authorization; R09 release itself promotes nothing.

### Immutable promotion

Promotion uses the existing immutable pack registry and knowledge definitions. One learned release contains one information-only knowledge module. Dependencies, capabilities, workers and workflows are empty. Manifest and content fingerprints, exact version, reviewer identity/fingerprint and original source verification/expiry are retained. A newer version records its predecessor and reason; it never overwrites an original. Withdrawal is an appended fact with a reason, not deletion or a rewrite of a previously used release.

Generic pack activation must not bypass R09, either with a learned root or a dependency closure containing a learned release. Review acceptance is guidance eligibility only. It grants no provider execution qualification or authority.

### Deliberate Business application, removal and rollback

The owner selects an exact reviewed release for an exact Business, gives an applicability reason and submits the expected current application identity. Apply, rollback and removal append an immutable application history under the Business lock. Rollback means a new application of a previously applied, still-eligible exact release; it never reverses or changes historical pins. Another Business needs its own deliberate application and reason.

Application rechecks current review status, hashes, expiry, withdrawal and source windows. A changed current application is a conflict requiring reload, not a silent overwrite. A stale, withdrawn or unavailable release is shown as such and is not silently replaced with a newer version. Reusing the lesson transfers only its redacted information and public provenance.

## Exact future use and historical explanation

New R07 plans atomically snapshot the Business's current reviewed applications. The snapshot includes application, release and installation IDs; exact pack/knowledge versions; database-owned manifest/content hashes; scope, guidance, limitations and generalizability; reviewer provenance; and dated public sources. It is bounded and immutable. Legacy plans receive an explicit empty learned-knowledge snapshot, never retroactive application.

Subsequent workflow runs and tasks receive the plan's frozen snapshot, rather than rereading the latest Business selection. Successful work can be reused only when its knowledge pins are equivalent as well as its existing R07 input/dependency identities. Application changes cannot make old results look as though new guidance influenced them.

All adapter contexts (`prepare`, `dispatch` and `reconcile`) receive a deeply immutable copy of the exact snapshot. The deployed runtime requires the R09 projection; a missing, malformed or cross-Business/plan projection is an unavailable read, not an empty set of lessons. Database `jsonb` fingerprints remain distinguishable from JavaScript canonical-JSON fingerprints.

Freshness and withdrawal are checked before new scheduling, reservation and dispatch, including after lock waits. An undispatched operation may stop for stale guidance, but an already dispatched operation is never resent to get a newer lesson. Reconciliation and receipt persistence retain the original expired/withdrawn pins so known results and costs can still be recorded. R09 does not change R05 authority, money or reconciliation rules.

Two existing R07 functions receive explicitly reviewed extensions: the pure `r07_snapshot` projection adds frozen knowledge, and `r07_controller` performs a final Knowledge freshness/withdrawal check after its last existing R05 admissibility check and all Core-row writes. The migration asserts exactly one known final-check anchor before inserting that guard; the SQL test removes that single added statement and compares the remaining body and ACL with the original. Merely checking before the dispatch marker is insufficient: a later Core-row lock wait could otherwise cross the source expiry. Other existing function definitions and grants are preserved.

The owner can inspect why a version was applied, which exact version was pinned to a plan/task, and its current eligibility. The UI describes a saved pin as **applied/pinned**. It does not claim that an actual decision was influenced, a model used the lesson, or an outcome improved unless a real request/decision receipt demonstrates that further link. Existing empty production execution registries remain empty.

## Refresh and review bound

There is no background crawl or automatic refresh. Before expiry or after a source conflict/withdrawal, create a new private proposal version, retrieve and independently review the relevant current public sources, repeat redaction and generalizability checks, then promote a new immutable version if it qualifies. A failed review remains recorded. The Business must deliberately apply that reviewed version to future work. Old receipts and in-flight definitions remain unchanged. No model-retry loop, new allowance or paid run is authorized by this process.

## Owner interface

The canonical compact Knowledge workspace retains installed-pack deep links and offers independently bounded views for private proposals, reviewed guidance, application history and exact usage. List pages and exact selected records are separate reads. Business/Quest context is preserved, and missing, empty, stale, withdrawn, rejected and unavailable states remain distinct. Ordinary owners can propose and apply/rollback/remove, but cannot self-approve or promote reusable guidance.

The desktop workspace uses the existing single-screen console and internal scroll regions. Mobile/reflow layouts retain readable labels, controls and evidence. Tests cover real Next navigation, exact selection, browser history and server-action feedback rather than only static fixture rendering.

## Required acceptance evidence

- Pure domain tests: closed fields, credential rejection, source conflict/staleness, unsafe URLs, redaction/proof/generalizability failures, information-only manifests and immutable adapter context
- Isolated database replay and rollback: owner/Business isolation, ACL/RLS, immutable originals, approved/rejected reviews, exact version transitions, generic activation bypass rejection, complete bounded reads and historical pins
- Real independent PostgreSQL sessions: application versus plan snapshot, withdrawal versus new dispatch, duplicate/retry operations and expiry while blocked on a lock
- Actual Next/Chromium: populated reviewed lifecycle, truthful empty/unavailable/failed states, independent exact selection and Back/Forward, application feedback, desktop/mobile/reflow/zoom layouts, isolated in-memory effects only
- Complete exact-tree CI, followed separately by approved migration verification, exact-SHA production deployment, signed-in affected reads, public health and deployment-scoped error scan

Simulated fixtures establish contract behavior. They do not establish a real external source review, live model/provider execution, improved outcomes or autonomous qualification. Production without learned proposals or Quests must honestly remain empty in those views.

## Source map

- Private lifecycle, exact pins, owner RPCs and read projection: `supabase/migrations/20261004021754_r09_reviewed_knowledge.sql`
- Pure review and snapshot contract: `src/core/reviewed-knowledge.ts`
- Worker delivery of frozen knowledge: `src/core/quest-controller.ts`, `src/lib/quest-controller-runtime.ts`
- Canonical compact workspace, forms and authenticated actions: `src/components/console/console-knowledge-*`, `src/app/dashboard/knowledge/actions.ts`, `src/lib/core-ui/console-knowledge-*`
- Domain, UI/action and database verification: `tests/r09-knowledge-*.test.mjs`, `tests/helpers/r09-sql-fixture.mjs`, `supabase/tests/r09_reviewed_knowledge.sql`
- Inert actual Next transport/journeys: `tests/next-fixture/knowledge.mjs`, `knowledge-contracts.mjs`, `r09-http.mjs`, `r09-journeys.mjs`; default `scripts/verify-r03-next.mjs` includes R09 and supports a focused `--knowledge-only` diagnostic

The R08 SQL test captures R08's additive-only fingerprint at its own migration boundary, then continues to replay all later migrations for its behavior/isolation checks. R09 independently verifies the two declared R07 extensions and preservation of every other old function, grant and dataset.
