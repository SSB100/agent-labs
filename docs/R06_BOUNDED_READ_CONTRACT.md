# R06 bounded historical reads

## Scope and baseline

R06 builds on released R05 `fa658d7fba1a30d572ee53067c35bcd17fff96df`, tree `bfe53e7c4c677d0e4c9a65fefd9bd793c319a824`. The accepted merge `ad66b403c034450bc4f7df834a8b4d417051b35f` has the identical tree. The canonical queue remains `AGENT_LABS_V2_IMPLEMENTATION_PLAN.md`; R07 is not included.

This change prepares read APIs and their retained-route consumers. It does not authorize migration installation, deployment, provider activation, credentials, purchases or production-data cleanup. Existing mutation authority and immutable financial/evidence history are retained.

## Private read endpoint

`public.r06_read(p_business_id uuid, p_dataset text, p_query jsonb)` is an authenticated-only, STABLE, SECURITY DEFINER function with an empty search path. It checks current owner identity and Business ownership. It never calls an owner transition wrapper, acquires an explicit row lock, writes a mutation-admission record, starts a provider or returns vault/server credentials. Existing private-table and helper grants remain unchanged.

Dataset SQL comes from a fixed internal allowlist. Values are passed only as SQL parameters. The caller cannot supply an identifier, SQL expression, projection, sort column or SQL fragment.

- Account state, request history, health history and owner-wide unresolved setup requests
- Etsy connection metadata, draft history, reviewed package candidates
- Listing preparation, qualification history and not-already-consumed source candidates
- Verified unpublished draft candidates and publication history
- Printful source candidates and configuration history
- Product candidates, latest decision/evidence context, experiment history, selected-candidate decisions and production-evidence candidates

All page responses contain independent `total`, `limit`, `offset`, `hasNext`, `observedAt`, `items` and a separate exact `selection`. Account unresolved responses additionally contain an independent owner-wide total for the navigation badge. Exact selection ignores search/status/page while retaining owner, Business, supported Quest and parent/intervention constraints. Resolved historical intervention links remain valid. An explicit malformed or contradictory selection is rejected.

Page size is 1–25; the application requests 25. Offset is bounded to 249,999, search to 120 characters and query JSON to 2 KiB. Page JSON is capped at 8 MiB and exact detail at 2 MiB; exceeding a bound returns unavailable rather than truncated authoritative content. Stable order is descending saved timestamp and UUID. The server computes count before pagination; an empty out-of-range page preserves its total.

Private package/source counts describe structurally matching candidates, not a registry-wide qualification result. Required envelope structure and full-relation “already used” predicates run before paging. At most 25 page candidates plus one independently selected candidate are authenticated through existing eligibility checks. A transient lookup/configuration/quote failure is unavailable, and older candidate pages remain navigable. Nothing here replaces current dispatch-time authority checks.

## Owner directory and public relations

The Business directory is independently counted, searched and paged (25 rows). A selected Business outside that page is fetched by exact ID and owner ID. Owner-wide collection queries use the authenticated client's existing RLS scope rather than the directory IDs. The paged directory is not a complete authority cache or a substitute for ownership. Action targets, OAuth cookie targets and internally selected records outside the page receive an exact owner-scoped Business lookup before existing domain authority checks. Pack activation resolves only the exact root and its bounded pinned dependency closure (at most 50 releases), rather than downloading the catalog.

Public retained histories use server ranges, independent counts, stable tie-breaks and separately scoped exact reads. Public registries such as model and pack definitions retain their existing registry visibility. Caller-side filtering/pagination of an unbounded registry is not used.

Current account state is independently projected per provider. Canonical experiment Quest membership combines the exact same-Business workflow Goal and R04 research link, with conflicts left ambiguous. A candidate may belong to multiple Quests through distinct experiments; its latest experiment cannot reassign its history. Scoped previews retain separately projected global latest-decision/tie and competing-completed-v2 flags, so a Quest filter cannot revive globally superseded production evidence. Latest product decisions are resolved before outcome filtering, including equal-time ambiguity and superseding completed v2 research hidden behind newer failed/reserved attempts. Latest evaluation score and running-evaluation state are independent of the displayed history page. Current open work is not inferred solely from recent terminal history.

Related records remain explicitly bounded. Workflow child pages contain metadata only; selected child content is fetched by exact parent/Business identity. Creative approvals and assets page independently, then resolve their exact linked runs/approvals and bounded cost/review/output relations. Missing counts, cap hits, mismatched references or failed related reads remain partial/unavailable and cannot establish “not started,” no review, no eligible work or zero cost.

## Route/query map

| Surface | Independent query prefixes |
| --- | --- |
| Owner directory | business |
| Account setup / health / open queue | account, accountHealth, accountOpen |
| Etsy drafts / packages | etsy, etsyPackage |
| Listing / qualification / sources | listing, listingQualification, listingSource |
| Publication / verified drafts | publication, publicationDraft |
| Printful runs / sources | printful, printfulSource |
| Products | candidate, experiment, decision, productionCandidate |
| Creative approvals / assets | approval, asset |
| Workflow children | stage, task, worker, intervention, artifact |
| Pack catalog / installations | pack, installation |
| Model tools | proof, model, route, invocation |
| Worker evaluations | evaluation, evaluationCase, evaluationResult, promotion |
| Browser diagnostics | browserProvider, browserSession, browserCase |

A prefix uses `Page`, `Query`, `Status`, and `Id` where that collection supports the field. Existing `business`, `run`, `connectionRun`, `candidate`, selected artifact/child and intervention deep links are preserved. History navigation changes read state only. Bounded source pages may show one separately fetched exact selection in addition to the 25 page rows.

## Verification and release gates

The new isolated SQL harness replays the complete migration chain, checks unchanged legacy function definitions/owners/ACLs and table RLS/owners/ACLs, and runs the new reads in actual READ ONLY transactions. Fixtures include 125+ rows, two owned Businesses and a foreign tenant, equal timestamps, old open requests, off-page details, canonical evidence joins, structural eligibility before pages, and exact intervention joins. PGlite proves SQL semantics; it is not a PostgreSQL concurrency or deployed-PostgREST proof.

The real production Next fixture uses unchanged application components/loaders and an action/provider/network-denying transport. Focused local production compilation and HTTP checks are recorded separately from browser journeys. The current cloud host rejects Chromium process-singleton sockets even outside the command sandbox; local browser journeys are therefore unrun. Hosted PostgreSQL, Chromium, full quality and final screenshot review remain required on the frozen candidate.

Existing optional test-host skips remain explicitly unqualified unless a named separate gate executes them. Existing query-driven legacy success notices are not expanded into a new authority claim by R06. No live or commercial qualification is claimed.
