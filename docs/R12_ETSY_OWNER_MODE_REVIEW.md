# R12 Etsy owner-observation mode release review

Status: implementation and technical qualification in progress, 10 October 2026. This record does not authorize a production migration, profile/grant enrollment, a paid call, or commerce. R12 remains open.

## Recovered baseline

The complete published main at `83d9e7f192cb711249c485c60d2a65b2424c24ca` was restored and all 1,178 baseline blobs verified before applying recovered changes. The recovery supplied 54 new substantive files and 24 substantive modifications. Omitted root configuration, packs and CI were retained; newline-only differences, private screenshots, test-result dumps and CLI temporary markers were excluded.

The recovered five-phase adaptive work was unqualified. Its archived tests and prior production releases are historical evidence, not verification of this new tree.

## Explicit Etsy-only execution

- A separately reviewed `r12.owner-research-profile.3` selects the `.2` adaptive scope, preview, plan, quote, action, preflight and wire contracts.
- The actual paid roles are planner → strategist → independent reviewer. Owner-capture validation is deterministic input validation. It creates no paid search or selection receipt, Exa request, collection artifact, or Etsy API/scraping permission.
- Five-phase `.1` records retain their original meaning. Their immutable predecessor hashes, original Goal, material negative history and costs remain lineage. They do not become new `.2` source evidence.
- The `.2` quote contains exactly three phase ceilings, with the existing independently qualified inference routes and explicit retention/disclosure. A fresh quote and exact owner approval remain prerequisites for future activation.
- A pivot may reconsider hypotheses within the original limits. Reasoning and repair use genuine retained dependencies and actual calls. Missing channel evidence pauses for a genuine owner source operation; repeated inference cannot create evidence or replenish money.

## Normal owner evidence flow

Authenticated same-Business owners can save and review private immutable aggregate captures without enrolling a spending grant. The form records exact Etsy source/interface, UTC capture/reporting dates, account locale, text and content hashes, a witnessed excerpt, limitations, and an explicit privacy attestation. It does not access Etsy on the owner's behalf.

Two or three candidate observations plus a distinct negative/reference can form a retrospective baseline. Exploratory or incomplete evidence remains available without asserting a comparable baseline. Unknown buyer geography and costs stay unknown. Displayed qualitative or percentage text is preserved as text; unwitnessed conversion denominators are rejected. Currency interpretations require an unambiguous displayed witness.

The saved selection, content hashes and disclosure are bound into preparation, preflight, approval and citable execution. Confirmation stays unavailable until exact selected evidence is read back. Unselected comparison terms and declarations do not enter model requests. Source text remains untrusted data, including at the independent reviewer boundary.

## Open continuation limitation

This first `.2` release does **not yet provide end-to-end autonomous evidence-driven continuation**. After missing-evidence pause or Stop, the owner can save a new private capture, but cannot yet prepare a capture-revision successor from an adaptive `.2` predecessor. The old predecessor closure/import proof accepts only its historical five-phase lineage; it cannot truthfully certify a three-role adaptive action history. Existing frozen authority cannot be edited to add captures.

The next coherent increment requires a separately versioned capture-revision closure/import proof, pinned historical negative provenance distinct from newly selected evidence, and fresh disclosure, quote and approval. It must retain the original Goal, funding roots, consumed costs, lifetime counters, Stop/revocation semantics and cumulative grant allocation. No reset, fake receipt or relaxation of existing authority is an acceptable substitute. Until that path passes integration and exact-commit CI, this release is a bounded Etsy-owner-evidence execution lane, not completed autonomous research.

## Financial and safety invariants

The original cumulative Business/research funding roots, lifetime dispatch/child counters, finite run/action limits, idempotency and unknown-liability guards remain. The documented USD 10 run ceiling is a maximum contract bound, not new spending permission. Stop cannot cancel already incurred costs; it blocks new sends while existing qualified receipts can still settle. No listings, artwork, advertising, purchases, orders, sales or profit are established by these technical fixtures.

## Qualification and release gate

Technical checks include pure contracts, actual three-role request/receipt projection, selected/withheld evidence wires, owner action/UI behavior, SQL activation/financial/security tests, native PostgreSQL races, and the real production Next owner journey. These checks use inert transport and synthetic captures. PGlite is not native PostgreSQL race evidence.

The draft recovery branch requests the complete existing CI release gate instead of treating a draft's focused diagnostic as release qualification. Added adaptive/Etsy SQL checks remain alongside legacy gates. Exact-commit CI, independent complete-diff review and actual owner browser evidence are required before readiness. Production deployment and a real research cycle remain separately gated.

### Local review checkpoint

On 10 October 2026, lint, whole-app TypeScript, core compilation and the seven release-gate tests passed. The fresh-core focused Etsy SQL gate reported three passed, zero failed and one explicitly skipped native PostgreSQL race test. It exercised initial three-role completion, two-role reasoning with a genuine reused planner, missing-source pause, Stop before reservation, and Stop after dispatch with late settlement. The ledger regression proves duplicate qualified receipt rows count once per request while distinct requests remain additive and unknown liability remains held.

Qualification repaired recovered integration defects rather than relaxing their guards: duplicate receipt aggregation in action/setup snapshots, a PL/pgSQL local-variable ambiguity when resolving reused dependencies, and a receipt-recovery comparison that incorrectly equated SQL JSONB and JavaScript canonical plan hashes. Recovery now pins the authenticated activation plan ID/hash, separately validates the complete plan/scope/wire/receipt, and waits for the existing lease without creating authority. Original immutable receipts were not rewritten.

The local browser process was blocked by its process-singleton socket permission; the separate supported cloud browser could not reach the local fixture. Browser qualification remains required in CI. Native PostgreSQL is unavailable locally; PGlite results above do not substitute for the required observed-lock race job. All tested transport and capture data are inert/synthetic.

The final production Next HTTP gate passed all six existing owner-run stages and five new Etsy-mode stages, including ordinary private save/list/disclosure, preparation/confirmation, exactly three inert sends, repeated missing-source pause, Stop and repeated receipt-only recovery. This is HTTP/server-action evidence, not a browser interaction or screenshot pass. Receipt-recovery/adapter regressions passed all sixteen focused tests.

Final local unit aggregate: 3,757 tests, 3,637 passed, zero failed, 120 explicitly skipped; executed with concurrency two against freshly compiled core sources. Skips include environment-dependent SQL/browser checks and are not counted as passes. Final whole-app lint and TypeScript checks passed. Required exact-commit remote CI remains pending at this checkpoint.

### First remote CI checkpoint

Draft PR #83 published commit `282e9070512b9ebff3e62ea5c33854481a80b989`, tree `771aaea6fbf8ad4a8eecdaac5a77b2b566ba339e`. The CI merge commit was verified to have that same tree. The quality job passed 3,874 tests with zero failures and 59 environment skips, including lint, typecheck and build. All existing SQL release jobs passed. The mixed-engine R12 SQL job passed adaptive/Etsy admission on PGlite and its separate native PostgreSQL stages for unchanged three-second dispatch, real PostgREST recovery, cold terminal artifacts and original funding/Stop lock races. The dedicated adaptive/Etsy native race job is the required native proof for the new lane.

Two remaining CI failures were diagnosed rather than waived. The adaptive counter-tamper race correctly returned `r12_episode_lifetime_bound`; its assertion expected an obsolete diagnostic family. The actual owner browser completed twenty stages and exactly three Etsy inference sends, but its pause assertion exposed a catalog-refresh remount clearing the transient missing-source message. A small read-only catalog projection now derives a durable pause from the exact completed independent-review followup recommendation, with no open attempts or revocation. It does not infer a pause from NME alone. Legacy, active/open, stopped and receipt-pending states project no source pause. The UI binds the notice to its exact saved setup and scope.

The follow-up tree must rerun the required native adaptive race and real browser gates, along with the complete release suite. First-run successes do not qualify a different commit, and no merge, deployment or paid activation follows from this checkpoint.

The durable-pause follow-up passed the actual local production Next HTTP fixture, 11/11 stages, including repeated fresh-page readback, three-role execution, Stop, the existing receipt cooldown and repeated settlement with no resend. Focused UI/read regressions passed 28/28. PGlite projection tests passed for `.1` null, exact `.2` followup pause, open action, action-limit precedence, explicit Stop and pending receipt states. This local evidence does not replace the pending corrected real-browser/native-race CI run.


### Deferred-validator native finding

The second exact-commit native race run passed the earlier diagnostic assertion and then exposed a real authenticated autocommit failure: the deferred activation constraint called its private validator after the owner RPC's definer frame returned. The additive `20261010094100` migration gives only that fixed row-trigger function definer execution, retains its existing owner and deferred behavior, fixes an empty search path, and preserves all caller EXECUTE/table revocations. An exact source-body and owner precondition rejects migration drift. It does not grant callers access to private validators or create authority.

The local PGlite activation and metadata/privilege regression passed, including known-charge failure and bounded repair. The native harness now asserts the definer/search-path/ownership/ACL boundary and exercises ordinary authenticated autocommit confirmation. Native success remains pending; PGlite's result is not a substitute.

### Second browser checkpoint

On commit `e293906b15cdbbb995089ef58fb88ab348823dda`, real-browser stage 21 passed the durable owner-source pause and repeated Run without a fourth send. Stage 22 then failed its Stop focus-visible assertion after mouse-triggered Run and programmatic focus. Preserved browser evidence showed the enabled Stop control, disabled Run control, no overflow and no browser errors; the old artifact did not record activeElement. The corrected fixture uses actual keyboard traversal to Stop before asserting enabled state, active element, visible outline and Enter activation. The corrected exact-commit browser run remains required.

The corrected five-file local tree passed lint/typecheck and focused activation/privilege and owner UI checks. A broad local aggregate encountered unrelated console test-process `SIGKILL` failures; a bounded-concurrency attempt reproduced process termination and was stopped rather than counted as passing. Preserved local diagnostics and isolated reruns do not replace required complete CI on the published fix commit.

### Native historical-claim assertion correction

Commit `9e87e17abc01e173d8dbb4f10d4230ae78949c66` passed the deferred-validator native boundary and reached the marker-before-Stop race. The current send was correctly denied, but the fixture counted all Business transport claims and expected zero despite twenty historical requests. Both related assertions now bind the exact current request; a separate before/after total preserves proof that history is unchanged after denied send and exactly one claim is added after admitted send. This is a fixture correction, with native exact-commit rerun still required. The earlier four locally terminated console files passed isolated sequential checks:86 passed,4 explicit browser skips.

The same exact-commit browser run passed keyboard Stop and receipt-only settlement with three sends and no resend, then failed its immediate Choose/Back navigation race with an empty about:blank document. The fixture now waits for the exact chooser URL and visible objective heading before Back, then verifies the exact stopped setup and saved history after reload. Focused owner UI checks passed26/26; actual browser rerun remains required. Its exact-commit quality job passed3,878 tests, zero failures,59 explicit skips, plus lint/typecheck and production build.

### Legacy funding proof correction

Commit `06241038bd8c048e6ecfdd39e21a160d36353a06` passed remote lint, typecheck, production build and the unit aggregate (3,878 passed, zero failed, 59 skipped). The native adaptive race gate then exposed a real legacy-funding integration defect: the TypeScript scope validator assumed every funding revision used the compact native-cap hash. Persisted positive legacy revisions instead hash their complete chained approval body.

The correction projects an authenticated, read-only funding-proof sidecar from the original persisted revision rows and setup. TypeScript independently recomputes both immutable funding hashes and verifies the exact previous hash, allowance, committed cost, owner and policy for an increase. Native caps and legacy revision zero retain compact semantics. No saved scope, preview, approval, input snapshot, allowance or historical receipt is rewritten. Missing or substituted legacy proofs fail closed through activation, dispatch and receipt recovery.

Focused verification: 90 contract/runtime checks and seven release-gate checks passed with zero skips; whole-app lint and typecheck passed. The genuine legacy lifecycle passed on PGlite (one test, zero skips): both the .1 planner/reserve/marker path that failed native CI and .2 unchanged/increased positive revisions, all three inert roles, Stop with late receipt, unchanged immutable hashes, denied proof injection and zero external HTTP. The dedicated lifecycle gate now runs against actual native PostgreSQL before the existing adaptive/Etsy races in CI. Native qualification and final exact-commit CI remain pending; PGlite does not establish lock-race correctness.

The same remote browser run exposed a fixture timing race after a successful adaptive save: the local receipt and review heading rendered before Next committed its URL replacement. The full journey was then audited for this class of race. Every successful Prepare and history transition now waits for its exact saved URL and positive destination UI; Back/Forward exercises real committed history, and reload absence checks first establish the saved state. Identity, consent, cost and no-resend assertions were preserved. The frozen fixture passed syntax, lint and 26 UI source checks and independent review. Actual browser qualification remains required on the next exact commit.
