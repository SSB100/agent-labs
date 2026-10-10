# R12 closed legacy origin compatibility

## Scope

`20261010215020_r12_legacy_terminal_origin.sql` is a definition-only forward migration, named by the official pinned Supabase 2.120.0 CLI. It adds no receipts, candidates, accepted outputs, settlements, authorities, plans, scopes, projection records, or budget changes.

The original seven-plan legacy history exposed three archival assumptions:

1. The direct-origin financial reader required a modern candidate plus metadata receipt even for an old malformed reviewer response. The original adapter saved its known provider cost before candidate admission. An actual review successor or owner-episode closure already authenticated its terminal financial disposition.
2. The original source, review-continuation, and evidence-continuation scopes did not store `amendment.intent`. Their published contract derives the amended intent ID from the original source scope ID. Review/evidence continuations retain that ID.
3. The addendum archive passed a reused generic record to a function requiring the discovery-scope composite type.

## Financial proof

Only candidate-free, proof-free first reviewer attempts in explicitly recognized old review/episode formats enter the additional verifier. They must retain their exact plan, request, wire, reservation, dispatch/transport markers, known USD settlement, provider identity/receipt claim, and fully settled exposure. Policy, controller, and admission authority must all be explicitly revoked. Neither expiry nor an unqualified observation substitutes for revocation.

The failed-review successor path invokes the original historical verifier and requires its exact saved review-history settlement pin. The owner-episode path requires the actual immediate successor activation, immutable owner setup, unchanged closure, and correctly bound received/rejected response-schema observations.

The resulting disposition is financial-only `qualified_terminal_failure`. It cannot create an accepted research receipt, candidate, route proof, or outcome. All ordinary qualified-receipt predicates and proof validation remain unchanged.

Production read-only classification on 2026-10-10 confirmed that both legacy failed reviews had explicit policy, controller, and admission revocations. No authority rows were changed.

## Exact historical shape

The published pre-adaptive attempt row had 13 fields. Current rows have exactly 16. The archival helper requires the exact current fieldset and all three additions (`adaptive_action_ordinal`, `adaptive_action_hash`, `direct_cycle_ordinal`) to be NULL before removing them. It then hashes the complete ordered prefix of plans, attempts, and settlements and requires equality with the original closure consumed by the actual successor.

Unknown fields, non-NULL additions, changed older attempts/settlements, and missing successor anchors fail closed. The existing `20760` records remain `non_reconstructible`; setup runtime eligibility is unchanged. No projection is rewritten or repinned.

## Source intent and artifacts

The origin-only intent resolver recognizes explicit source/review/evidence version pairs, invokes the existing historical source verifier where applicable, and checks original business, Goal, prior experiment, funding root, intent hash, semantic hash, and canonical scope/plan pins. It returns the original source scope ID prescribed by the original contract. It does not construct or persist an intent.

Origin-specific clones retain the qualified dependency and exact-span archive logic. The shared adaptive dependency and evidence readers remain byte-identical. The addendum loop receives its actual composite type; all validation and provenance fields are retained. Every new helper has an empty search path and no API-role execution grant.

## Qualification

The standalone `tests/r12-legacy-terminal-origin-upgrade-sql.test.mjs` starts before the adaptive schema, runs the genuine four-plan history, creates the actual failed fifth reviewer through inert runtime transport, closes it through a real sixth owner episode, stops the sixth before reservation, and completes/closes the seventh. It then applies later migrations and this forward migration.

The released stopped-before-reservation helper is installed while the attempt schema still has 13 fields; it has no dependency on the later adaptive columns. Deferred old-schema checks finish before the upgrade. Original histories are neither constructed by rewriting modern rows nor given fabricated candidates.

Expected result: 17 dispatches, 19 children, 17 financial proofs, exactly two financial-only terminal failures, five accepted research receipts, and identical replay/freeze checks. Original snapshots, attempts, closures, immutable projection classifications, original funding root, and shared adaptive definitions remain unchanged. Mutation negatives cover identity, original intent/root pins, unsupported versions/fields, all nullable additions, amount/currency/provider binding, receipt and transport claims, all three revocations, diagnostics, predecessor activation/history, and missing ordinary route proof.

The dedicated entry in `.github/workflows/direct-etsy-qualification.yml` uses required native PostgreSQL with a fresh loopback database and no PGlite fallback. Local PGlite is a focused check, not a substitute for that release gate. The fixture's fourth plan is a rejected evidence continuation; it verifies retention of the authenticated addendum but does not claim an accepted fourth-plan phase.
