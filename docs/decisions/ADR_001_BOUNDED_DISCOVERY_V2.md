# ADR 001: Evidence-led geographic discovery and bounded qualitative decisions

Status: approved implementation direction; implementation and live qualification pending.

## Context and correction

The authoritative plan (§20.3–20.8, Stage 13 and Stage 14) calls for a Researcher, Product Strategist and independent Reviewer to produce source-linked TEST, REJECT or NEEDS_MORE_EVIDENCE decisions. The owner should receive a researched recommendation, not routine homework to choose a market, find sources, enter scores or provide artifact identifiers.

The first Stage 13 increment qualified real source collection and an append-only registry, but its downstream strategy/review was deterministic and provisional. It implemented a universal nine-known-score/65-point gate and permanently reused the first research run. Those choices were not requirements of the implementation plan and do not constitute the complete intended research workflow. Its historical completion claim was too broad. The technical Stage 14 image pipeline is now independently verified; this does not close the missing product-research behavior or confer a production decision.

“Best market” here includes geographic selling markets. Comparing only shirt motifs in an assumed country would not answer the goal. The result can recommend the best-supported starting geography among a declared bounded comparison set; it cannot claim universal optimality.

## Decision

Implement one versioned, finite, domain-specific discovery workflow for original POD T-shirts, Etsy, Printful and initially organic acquisition:

1. App-defined discovery intent and a justified bounded geographic comparison universe, with candidate/niche alternatives
2. A fixed, quoted research batch, with at most two new collections and useful immutable prior evidence references
3. Live Product Strategist evaluation of all nine dimensions using qualitative facts, evidence strength, reasoning and uncertainty
4. Independent substantive Reviewer decision: TEST, REJECT or NEEDS_MORE_EVIDENCE, with exact reasons and missing questions
5. A clear recommendation, alternatives, limitations and the next bounded experiment or justified stop

This is not a generic planner or an automatic research loop. A further round needs explicit bounded intent, a fresh quote and a new durable round identity. Repeated clicks, reordered inputs or changed timestamps cannot manufacture another authority or new evidence. Persisted completed collections may be reused after a selector/assessment failure without pretending a failed provider call was successful.

### Evidence and candidate identity

Keep each source collection, Evidence Pack, quote, worker output and receipt immutable. A bounded dossier references them with Business, workflow, artifact, question, source-domain and content-hash lineage. New v2 contracts do not weaken v1 validators. Evidence selection may cite an exact relevant span inside a retained excerpt rather than always taking its first characters; the selector cannot create a quotation or unsupported claim.

The dossier records compared geographic markets, selection rationale, relevant cost/currency scenarios and limitations. Seller bank country is a business fact, not something inferred from residence or an email address. Missing bank-country fees remain an explicit scenario/unknown while research proceeds. Missing facts block only the specific consequential conclusion that depends on them.

Candidate identity remains distinct from research-round identity. Broad comparison must not silently repurpose an old candidate. New selected concept/audience identities are appended; old NEEDS_MORE_EVIDENCE decisions remain historical evidence. A new URL or retrieval date alone is not evidence novelty. Sparse marketplace counts, shop-level sales and general policy advice cannot be presented as item sales or candidate demand.

### Qualitative TEST meaning

Version 2 evaluates all nine dimensions, but does not require fabricated certainty or arbitrary universal numeric thresholds. A TEST is a justified bounded learning experiment, not a claim of proven demand or a commercially validated winner.

A TEST must identify its hypothesis, scope, deliverable, success and failure criteria, financial/generation limits and stop rule. Cited evidence must support why this experiment is worth conducting. Every material unknown is recorded with whether and why it blocks that exact test. A reviewer must reject unsupported superiority, source-type substitution, missing dimensions and vague sufficiency. An old NEEDS_MORE_EVIDENCE decision is not automatically transformed into a creative test.

Known originality/IP or production failures remain blocking. Explicit rights intent, current policy screening, valid print specification, current same-Business candidate decision, separate exact creative approval and actual pixel/asset validation remain hard boundaries. Commerce, listing publication, advertising, purchases and financial performance require their later-stage authority and evidence. No TEST or technical image PASS grants them.

### Model and financial boundaries

Use pinned actual models and truthful worker receipts. The independent reviewer must differ from the producing model; an implicit fallback to the Strategist is prohibited. New worker/version qualification must be distinguished from synthetic contract tests and old v1 qualifications.

Every paid phase, including research, selection, strategy and review, is quoted and durably reserved before invocation. Budget policy is resolved from persisted run/experiment/intent lineage, not an optional caller flag. Shared round allowances use an immutable initial goal authority with atomic, replay-safe accounting in addition to per-round ceilings. Known finalized actual cost plus pending/unknown reserved exposure consumes that authority; unused settled estimates remain historical estimates and are not billed usage. Explicit follow-up kickoff cannot replenish the initial allowance. Unknown charges keep their reservation and stop further calls; finalized known charges remain separately visible. No reset, erasure, implicit fallback or hidden retry is allowed. A bounded estimate is not a provider invoice guarantee.

The exact schema/RPC authority delta is reviewed before database application. Reusing a signature does not by itself prove that its expanded behavior is authorized or secure. New provenance types/workflow keys receive the same protection against generic owner CRUD forgery as existing research artifacts.

### Creative quality

A technically valid file is not a complete creative-quality standard. Production brief/review should evaluate audience-specific concept, composition, originality/differentiation of execution and visual clarity, while preserving the exact owner-approved scope and prohibitions on copied artwork. The simple pipeline-qualification image is not a claimed store-quality ceiling or a market recommendation. Historical reviews keep their original contract/version.

## Compatibility and verification

Deploy the separate backward-compatible legacy reader guard before creating v2 rows in the shared database. Existing Products/workflow readers must retain null-candidate discovery roots and render unknown/new decision versions truthfully without trying to read v1 numeric fields. The compatibility release grants no new research or creative authority and does not complete Stage14.


- Keep v1 manifests, decisions, evidence and numeric validation unchanged
- Version-dispatch the new decision and dossier contracts in TypeScript, SQL, Products UI and Stage 14 approval/final-transition validation
- Preserve current/latest-decision, tenant, freshness, rights/IP/print, asset-hash and separate-spend checks
- Test duplicate/concurrent rounds; omitted/spoofed budget metadata; cross-owner/lineage forgery; non-novel evidence; stale critical sources; unknown charges; model independence; unsupported geographic winner; unknown dimensions; exact evidence spans; and legacy/technical/simulation non-promotion
- Run independent code/security review, isolated migration and rollback rehearsal, affected and aggregate gates, exact-commit hosted CI, signed-in UI and bounded live qualification
- Do not claim Stage 13's full behavior or Stage 14's approved-candidate exit until their actual end-to-end evidence exists

## Goal-first jobs and reusable workflows

The intended user experience is to prepare and qualify reusable workflows, assign a suitable set to a job/project with its goal, context, connected accounts and budget, and let the defined process run until completion, a decision or a stop condition. Training means improving charters, examples, contracts and evaluations; it does not imply model fine-tuning.

“Job/project” is a user mental model, not a new backend entity introduced by this correction. Map it to the existing Business, Goal, installed packs, Workflow Runs and Core event coordination. A plain-English goal selects a built, eligible workflow and fills its bounded contract; unsupported goals are explained rather than handed to an unlimited planner. Subsequent outputs can feed the next workflow only through defined mappings, qualification and approval boundaries.

For this slice, the Products entry point should be goal-first with optional necessary constraints and an explicit research allowance. Do not ask users to provide raw domains, artifact identifiers, geographic answers or scorecards as routine inputs. Discovery remains the finite workflow described above; cross-workflow orchestration and future job presentation do not expand its authority.

## Implementation bounds and qualification status

The first qualification uses one source collection and five paid calls: planning, source retrieval, exact-span selection, strategy and independent review. A two-collection contract exists but is not an automatic fallback. Complete current quotes and all existing commitments must fit before any call. Planner inputs have a task-specific12KB ceiling; selector16KB and strategy/reviewer32KB. Full relevant knowledge rules and evidence remain present; an oversized complete context stops before reservation rather than silently truncating facts.

The v2 evidence guide has its own experimental release and exact-span selection contract. V1's evidence-ID-only instructions, charters and qualified records remain unchanged. Experimental live research can finish with an honest NEEDS_MORE_EVIDENCE outcome. Exact-version qualification and downstream Stage14 acceptance remain separate gates.
