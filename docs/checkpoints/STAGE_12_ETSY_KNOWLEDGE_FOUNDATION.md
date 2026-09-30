# Stage 12: Etsy and POD knowledge foundation

## Scope and current status

Implementation is based on main `0ff6a599cc068ec2155faa44cc5f698476fc7fd5` and reviewed in [PR 16](https://github.com/SSB100/agent-labs/pull/16).
The authoritative implementation plan is unchanged. Stage 13 candidate research, persistent experiments, scoring, UI and all marketplace operations remain out of scope.

Local and hosted simulations exercise real routing against mocked providers and durable state. This is **not live model competence**, live research or production qualification. All nine new releases register as **experimental**. Normal activation remains blocked. No live provider was called and no external product, listing, campaign or order was created.

## Implementation

- Five versioned Knowledge Packs: `etsy-selling`, `etsy-current-policy`, `print-on-demand`, `product-research`, and baseline `social-marketing`
- Each knowledge definition records its source, exact version, verification timestamp and freshness window; every substantive guideline has its own source URL and a platform-rule, guidance or implementation-inference classification
- Etsy-specific Market Researcher, Product Strategist and Reviewer manifests have bounded charters, explicit forbidden actions, scoped knowledge requirements, positive fixtures, negative examples and output schemas
- The Reviewer uses the already qualified `reviewer.independent` route; the generic pack runtime now honors that declared allowlisted route instead of hardcoding the standard route. No new provider or model is introduced
- A three-stage `etsy.product-discovery-simulation` workflow references exact worker versions and runs through the reusable local simulation harness
- The harness executes real Task Contract, knowledge scope, schema, evidence-artifact and completion checks using explicit fixture outputs. It rejects missing/extra fixtures, non-JSON executable inputs, external capabilities, stale/future-dated knowledge and invalid references
- Simulation snapshots and artifacts are copied and frozen. Receipts say `simulation.fixture`, retain the configured executor and explicitly record that no provider or qualification evaluation ran
- Domain checks preserve upstream artifacts, require every stage's scoped knowledge to be cited, verify exact guideline/source/classification linkage and prevent policy/evidence prerequisites from being bypassed
- The sample ends `needs_evidence`, with publication and live qualification both false. Ineligible original-design, rights-uncertain or undisclosed-partner inputs end `blocked`. There are no observed demand metrics in these fixtures
- The integrated mock adapter computes each output from its actual scoped prompt and runs through the existing standard/independent Model Router, including bounded fallback. Shared domain validation runs before persistence
- Local file-backed simulation checkpoints persist Task Contracts, model attempts, state transitions, artifacts, events and receipts. Completed runs are idempotent; failures require explicit bounded retry. Pause/resume across a process restart and concurrent-run exclusion are covered
- The hosted path reuses the installed-pack persistence engine and adds a fixed owner-scoped experimental simulation launch. Its final Needs You state records acknowledgment or stop before delivering the durable hook. Acknowledgment closes the simulation only; it grants no publishing or financial authority

## Source provenance and limitations

Primary Etsy and Printful pages were retrieved and reviewed on 2026-09-30. Knowledge content is in `src/packs/etsy-knowledge.ts`; `packs/etsy-catalog.json` is generated from those definitions and the worker/workflow manifests.

Etsy's broad Seller Policy and Fees Policy pages returned an October 5, 2026 update date, later than this snapshot. Their current text is excluded as evidence of the rules in force on September 30. The anomaly and the need to reverify before live selling are recorded. Original-design POD, production-partner disclosure, AI disclosure, IP and image constraints rely on independently attributed Creativity Standards and Help Center pages.

Freshness limits are application choices: 30 days for selling, policy, POD and research; 90 days for durable social-planning principles. They do not guarantee that a source stays unchanged. Actual SKU constraints, costs, availability and applicable policy must be rechecked before consequential use.

## Reproduce local verification

```sh
npm ci
npm run check
node scripts/simulate-etsy-discovery.mjs /tmp/etsy-discovery-simulation.json
```

The complete local gate runs lint, TypeScript, all tests, optimized Next.js build and Workflow compilation. The simulation command writes a local report and checkpoints under the temporary directory, calls only a mock provider, and uses the current clock. Stale knowledge correctly requires a newly reviewed pack version. An optional third argument is a stable run key; repeating that key reuses its completed output without another model invocation.

## Verification record

- Baseline main: full local `npm run check` passed before changes
- Final local gate: lint, full TypeScript, all 156 tests, optimized Next.js build and Workflow compilation passed. Hosted CI `36690712670` passed the same complete gate on the repository's Node 22 pin for code commit `042a56415fccb839dd4610b96beb488755e7ab08`
- Coverage includes source linkage, semantic prerequisite enforcement, canonical artifact equality, maximum-size inputs, routing/fallback, process-restart persistence, intervention/retry bounds, concurrent-run exclusion and hosted wiring
- Integrated sample completed all three stages with three mock calls, three receipts and 15 events, returning `needs_evidence`. Repeating its run key made zero additional calls or events
- Catalog migration created with Supabase CLI and generated using `scripts/register-pack.mjs`; all nine manifests and exact dependency closure validated
- Catalog registration plus `supabase/tests/stage12_knowledge.sql` passed in a hosted transaction with all changes rolled back
- Catalog registration is now applied as migration `20260930082656_stage12_etsy_knowledge_catalog`. Its nine releases remain experimental
- Runtime migration `20260930083253_stage12_etsy_simulation_runtime` applied after specific approval of the reviewed security-boundary change
- Hosted Stage 12 knowledge/runtime regressions and existing Stage 10/11 regressions all passed, with regression changes rolled back
- Preview deployment `dpl_3GCZJ2JgVqq1r4d42yVxwmegkMeD` is READY for code commit `042a56415fccb839dd4610b96beb488755e7ab08`
- Signed-in preview run `67ef45ec-0761-4ce1-bdbf-1aa9db9487b2`, runtime `wrun_01M3RQJJY1W663TV3J03GZ3048`, completed all three stages, reached Needs You and completed after acknowledgment
- Separate preview run `6eae0909-9d48-4ab2-9ddc-19ad228a49bf`, runtime `wrun_01M3RQSGD3E0T19Q7ZKHKRX1CY`, reached Needs You and became cancelled after Stop from the Needs You screen
- Each hosted run has three completed worker receipts, 16 artifacts and 11 final events, zero external action intents and zero live model cost. Both standard workers retain `standard.default`; the Reviewer retains `reviewer.independent`. All receipts explicitly identify mock simulation
- Workflow timeline, source-backed knowledge artifacts, decision text, completion/cancellation, and cleared Needs You controls were verified in the cloud browser. The preview error/fatal log scan returned no errors
- Security advisors retain 14 established run-capability-guarded anonymous SECURITY DEFINER notices and add two owner-checked authenticated RPC notices; owner isolation/forged decisions are covered by SQL regressions. Existing leaked-password protection warning is unchanged. No table/RLS warning was introduced
- Production verification follows merge; PR 16 closeout will record the exact deployed commit and production smoke result. Live model competence remains deliberately unqualified

## Remaining gate

Verify final CI after this evidence update, merge PR 16, and verify its exact production deployment and signed-in smoke result. Record closeout evidence on the PR before advancing. Do not promote these mocked workers to live-qualified on the strength of these tests.

Stage 13 must collect actual source-backed candidate evidence and implement persistent candidate/experiment decisions. Stage 25 still requires a complete real business workflow to verified realised profit and repeated success before additional packs become a priority.
