# R08 owner-facing Business and Quest workspace

Canonical scope: R08 in `AGENT_LABS_V2_IMPLEMENTATION_PLAN.md`. Baseline is released R07 commit `51e349dcbb7c843b8587ad2d0894de57e5ee182a`, tree `0b20abe4f77a74440d26abaa339f938fe547156c`. This slice projects reviewed contracts; it does not implement R09 learning or qualify commerce, providers, workers or execution adapters.

## Identity and navigation

- Resolve the authenticated Business and explicit/current/most-recent R04 Quest before reading a Quest workspace. Missing, ambiguous, conflicting and unavailable identities never select another record.
- Overview resolves an active episode independently of every recent-history page, or the most recent episode when none is active, then loads that exact run. Explicit selection never falls back. With no Quest it projects no Quest work. The existing console core, timeline, worker receipts, saved outputs, motion and browser-metadata fallback remain in the single-screen layout.
- The native URL carries Business, Quest, episode, Step, Agent and source-artifact provenance. Changing a parent clears incompatible descendant context. Exact selection is independent of paging and search. Quest/Business selection remains distinct from execution authority and preference.
- Canonical navigation: Overview; Events (`view=work`, with old Work URLs retained); Library; Research; Products with linked Listings; existing-pack Knowledge; searchable Decisions; Needs owner (`view=decisions`, preserving historical notice URLs); Connections; underlying Audit events; Tools.
- Business-level account setup/history stays Business-scoped; the Quest is retained as return provenance but is not sent as an unsupported account-data filter.

## Read boundaries

Migration `20261003194244_r08_owner_workspace.sql` is additive:

1. `public.r08_workflow_quest(uuid,uuid)` is an authenticated, owner-checked pure read of Core workflow identity plus exact R04 legacy Research links. It resolves only one unambiguous canonical R04 Quest. A legacy Core Goal is not silently promoted into a Quest.
2. Seven SELECT-only, `security_invoker`/`security_barrier` views expose the same existing public RLS records with this derived Quest ID: workflow runs, Research experiments, artifacts, creative runs, creative assets, owner interventions and raw events. There are no direct private table grants. New-object PUBLIC/anon/service-role privileges are revoked.
3. `public.r08_owner_read(uuid,uuid,text,jsonb)` provides bounded metadata/count/exact-selection reads for decision audit, product packages and linked listing drafts. It enforces authenticated Business ownership and optional exact canonical Quest scope. Text search is literal and parameterized. Limit is 25, offset bounded, ordering timestamp/identity stable, and the response has a server-side 256 KiB cap. Wide decision evidence and nested provider associations are exact-selection only.
4. One index supports the private legacy Research workflow/Quest join. No existing function, table grant, RLS policy, data or execution registry is modified.

`workspace-context.ts` validates response shape and all explicit relationships. Existing collection readers apply Quest filtering before count/page/exact queries through the invoker views. The transport wrapper checks each returned Quest ID before removing its transport-only field. Empty, missing, partial and unavailable remain distinct.

## Owner-visible truth

- Events are actual workflow runs. Ordered Steps are stage runs. Participating Agents require actual Worker Runs and their exact task/definition chain. Independent exact child selection works outside child pages. Receipts, outputs, retries and stopped/queued/waiting states are retained. Raw audit events remain a separate destination.
- R07 completed plan steps/pinned reuse are not target achievement. The current controller exception remains inspectable even when it has no owner-intervention row. Acknowledging a historical notice does not resume stopped execution or settle charges.
- Overview episode costs retain their existing receipt provenance. R05 exposure is explicitly Business-wide model liability, including other Quests, not Quest spend or realised profit. An unavailable read never becomes zero.
- Research and Library retain the reviewed evidence/preview/detail readers and their uncertainty/readiness distinctions. Canonical Quest scoping includes exact legacy Research association and does not invent missing versions or images.
- Product Packages, candidates, assets and provider product IDs remain distinct. The catalog reads exact package→draft identity and, where present, exact saved supplier resource/receipt references. It does not infer a cross-provider purchasable variant from names, SKUs, display order or a mockup. Recorded `verified` draft state is historical, not a fresh provider observation. Product identity, fee readiness, fulfilment and public-selling readiness remain unqualified until R13–R15.
- Knowledge displays only existing installed pack snapshots with versions, sources, declared freshness and Business installation state. Installation does not imply review acceptance or live qualification. Learned reusable Knowledge/application is explicitly unavailable until R09.

## Source map

- Shared resolution/URL state: `src/lib/core-ui/workspace-context.ts`, `workspace-navigation.ts`
- Owner entry and retained navigation: `src/app/dashboard/page.tsx`, console shell, account/decision return helpers and Research aliases
- Overview: `console-workspace-overview.tsx`, existing `console-overview.tsx`, `loadCurrentQuestEpisode` and exact collection loader
- Events: existing collection/detail readers, ordered stage pages and `console-episode-evidence.tsx`
- Products/Listings, Decisions audit, Knowledge: `console-owner-records.tsx`
- SQL: additive R08 migration; `tests/r08-workspace-sql.test.mjs`
- Source/URL regressions: `tests/r08-workspace-context.test.mjs` and affected existing reader/presentation suites
- Real Next transport: `tests/next-fixture/workspace.mjs`, `r08-http.mjs`, `r08-journeys.mjs`; existing `verify-r03-next.mjs` full gate also executes R08

## Qualification and release

The required final gate is exact-tree CI: existing quality, real production Next/Chromium and R04–R07 SQL/concurrency jobs remain intact; R08 adds a PostgreSQL 17 pure-read/isolation job. Fixture transport is not a substitute for SQL/RLS, and SQL replay is not a substitute for actual browser interaction.

Focused development browser evidence at `d24da38be71810e2fbb4b69a72ba5667b316d573` passed 25 checks, including positive populated cross-route journeys, exact off-page selection, wrong-Business rejection, both desktop sizes, 320/390 reflow and real 200% browser zoom, with no mutable effects. That evidence was inspected and does not replace the final matching-tree gate after later guard fixes.

All 23 existing page routes remain; R08 adds root query surfaces rather than duplicate page workspaces. The whole-application real Next route matrix remains required. Long lists/details use labelled contained scrolling; desktop document overflow is not accepted. Mobile/zoom prioritize readable reflow and reachable controls.

A separate maintenance commit aligns the R07 migration filename to actual production version `20261003184640`; its SQL bytes and SHA-256 remain `9ad3e35fd2bf6d2bfda25bbc8d1002bc8b8adfa42394cbfbda5c9a6a68cf2632`. Production history is not rewritten. R08 sorts after that actual version.

Vercel automatic deployment is disabled for `feat/r08-owner-workspace`. Full CI qualification, explicit production-migration approval, exact-tree release coordination, and signed-in post-deploy read verification are separate requirements. No live provider call, credential, adapter, scheduler, model spend, product mutation or public selling is enabled here. The two inherited optional Printful finish-wire and terminal-review SQL harnesses remain separately unqualified unless later evidence explicitly closes them.

Final reviewed R08 SQL SHA-256: `3e4e7b8f91b5429dfd3c264e0ee02ca917996738ff65f679d972b16ac1b174cb`. Production application requires approval of these exact bytes.
