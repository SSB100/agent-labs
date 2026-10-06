# R12 research-only production bootstrap review

**Historical approved first research packet; authority now closed.** Four phases completed for USD 0.019268; the independent reviewer never dispatched. The policy and both verifier enrollments are revoked. [Current closeout and separately proposed remaining review](R12_REVIEW_CONTINUATION.md) supersede the status below, while all original approval and migration bytes remain historical evidence.

**Earlier pre-activation checkpoint:** The owner approved this bounded research package on 2026-10-06 at 03:37:22 UTC. All eight reviewed migrations are now applied with identical bytes. PR62 released as main `a5807d8492cd773deaecf95c90f8c715467e6550`, tree `636868836647a5c93f94261d105da7c4095728b7`, after twelve passing hosted checks and independent review. No installation, scope, verifier enrollment, financial policy or provider call for R12 has been created. The complete visible owner preparation path must pass its gate before activation. Execute only the matching reviewed release and owner-approved packet. [Purpose, sources, query, data sharing and fees](R12_FIRST_RESEARCH_PACKET.md) are part of this packet.

## Verified pre-migration baseline

The pre-migration Production baseline ended at `20261005220220`. Business `91ff7c87-60e4-4dbb-8e84-be63b53c2c79` is revision 6 / setup, hash `97441d08503e1640763a6da50c191ae13aa4b23e86ffe0e2b25b3789005ead12`. Known exposure is 646851 microUSD, no unknown cost; R05 cap revision 6 is 848063.

Original research root `3ebba15b-eaac-457e-8828-1311070b89fa` retains its original 400000-microUSD intent and append-only later funding approvals. Its effective allowance is 2000000, known charges 109480, remaining 1890520. Latest prior round `065bc246-98eb-4f1b-90ba-aa76facb2727` already has a 2000000-microUSD intent. Its canonical intent hash is `f6be5c7bfde7b19fb4bb09a10f13b9d30d519785f7f9a8508a00b3cfe46d8170`; semantic goal hash is `6e174b6a90ce9515abe3d27043501b01329f65dc8f25e93ed814b00f917cfcd7`. Neither historical snapshot is rewritten.

There is no canonical Goal or R04 original-chain link for this intent and no discovery installation. The R11 gift-survey Goal is outside scope.

## Frozen migration bytes and security deltas

These exact files were applied in this order after approval and the final release gate; no migration bytes changed in the owner preparation correction:

| Migration | SHA-256 |
|---|---|
| 20261005232909_r12_discovery_source_scope_bridge.sql | 3f25fca582eeb3bf1b340c9016516211df0adb9f949e3c1817b8e284435926f0 |
| 20261005233632_r12_discovery_controller_topology.sql | 6858c466dca8797e2d20ce68a45879fbfce8f02264c53d305a707e8ef7c5f3e4 |
| 20261005234648_r12_discovery_shared_dispatch_guard.sql | 2e5510b6e24e32098d735415f530321fda11380b6a047395a964ee26c3d508e9 |
| 20261006001638_r12_research_lock_order.sql | 332055186ce9bc08a68f4c028367ea1ee132d87d743578381cf752fcf921ab35 |
| 20261006003319_r12_discovery_durable_receipts.sql | 5c30ea9987f816df7059c0aa4274fd2b5a452fb4bad73ecf0e5b4d6c75f1ef84 |
| 20261006010014_r12_discovery_phase_inputs.sql | f76d4273c2caa5552351c81a99f27b13f68aec50b15fafe6be82c3710a4100b1 |
| 20261006013535_r12_discovery_owner_runtime.sql | 15b0b9bf81ab2caa6d382813dc533c7274aaaa568818673cf93825a39a385636 |
| 20261006021233_r12_discovery_historical_result.sql | 7fe4b62db14098994771e63804f85548f0ad6ee9c2946cbe165d5d9e9f8d66ec |

Seven new private tables hold source scope, exact wires, bounded response candidates, receipt claims/observations, one-shot transport claims and scoped authority. All have RLS and no table grants to public/anon/authenticated/service-role. Private helper execution is revoked. Migrations seed no authority or provider access.

New public RPC grants:
- `r12_discovery_scope_read(uuid,uuid)`: authenticated, current-owner read
- `r12_discovery_owner_read(uuid,uuid,boolean)`: authenticated, current-owner metadata/activation read; never secret key values
- `r12_discovery_result_read(uuid,uuid)`: authenticated, current-owner bounded historical result
- `r12_discovery_server(uuid,uuid,text,jsonb,text)`: anon execute, guarded by the exact scoped controller key, Business/Goal/plan/attempt and expiry

Existing R05/R07/legacy signatures and ACLs remain. Implementations gain scoped-key rejection, same-root exposure, consistent Business→root lock order and exact source/wire/receipt constraints. Registered R12 keys cannot operate generic R05/R07 or R11 paths, be reused across roles, or read a transferred Business. Experimental eligibility applies only to the exact approved plan; no definition or pack is promoted globally.

The owner-only same-origin `/api/research/r12/prepare` route derives and returns two verifier hashes inside the existing server boundary. It does not enroll anything. Continue uses the existing finite controller; Stop uses the existing exact owner policy-revocation RPC. Historical result reconstruction creates no new storage or execution authority.

## Exact reusable installation

Root pack `workflow.product-discovery-v2` version 1.0.0: `7afd0fea-4faf-44ff-8362-846d116fece5`.

The reviewed snapshot is `jsonb_build_object('rootPackId','7afd0fea-4faf-44ff-8362-846d116fece5','releases',private.stage10_resolve('7afd0fea-4faf-44ff-8362-846d116fece5',true))`, R04 hash `6fe1a97c3667b5a9074a53a5156c2357c362871cd2ebd5735c19c39a9f344db0`. The closure has 11 releases and five fresh knowledge records; earliest reviewed Knowledge expiry is 2026-10-30 08:00 UTC. Recheck before insertion.

All definitions below remain experimental, version 1.0.0:
- Workflow `product.discovery-v2.one`: `231fd18c-49d0-426c-88d6-a95f44516721`
- Planner: `98b4ff1e-8791-4403-8cec-0b4fd7fdaa79`
- Researcher (search and selector): `c1551958-a0fd-47cc-bf86-fa0398a5261b`
- Strategist: `ebba060f-6f95-4a3f-93ff-c62b3809d7d2`
- Independent reviewer: `b4632bb9-28b0-4e42-baea-5e661dea2952`

Ordinary pack activation rejects this experimental closure. One operator-created active installation of this exact snapshot is therefore an explicit part of the approval. Do not weaken activation or call global qualification/promotion functions.

## Ordered setup and activation

Use a newly generated scope UUID `S`. Capture actual returned Goal `G`, installation `I`, policy `P`, revisions and hashes. No fabricated session, ID or approval/review evidence is accepted. Retain one submission UUID per owner mutation and reuse it for an exact idempotent retry; an uncertain response requires readback before another action.

1. **Real owner session, canonical intent.** From the selected original closed research round, open “Prepare original research,” retain its stable setup URL, review the exact intent and cutoff, then use “Save original Goal and prepare setup.” Its server action invokes existing `r04_quest_transition` with `quest.save`, `goalId:null`, `expectedRevision:0`. Keep objective and originalIntent exactly “Research the best-supported starting geographic market for original nature T-shirts, recommend up to three concepts, and prepare the strongest for review.” Geography is US/GB/AU/NZ; budget USD2 denotes the preserved cumulative allowance. Use target one research packet, finite approved UTC setup/deadline, exact five-call scope/stop constraints and no ambiguities. Set preference ready with the returned revision. Preview the latest prior round with `r04_research_link_preview`; require linkable, expected original root and no conflicting Goal. Link through owner `research.link`, retaining the original chain and funding.
2. **Nonsecret preparation.** Read the copyable setup receipt in the same visible preparation page. The owner server action derives the same scoped hashes as `/api/research/r12/prepare`; no browser request injection or session extraction is needed. The receipt includes the actual linked Goal and installation identity. Require distinct 64-hex controller/admission hashes and `authorityCreated:false`. Do not read or copy protected environment values.
3. **Approved operator staging transaction.** Lock Business, recheck ownership/revisions/lineage/exposure/unpaused state and exact snapshot/definition hashes. Insert one active installation `I`, one source amendment `S/G` for the latest prior round and original root, and exactly five operations/adapters below. Bind actual source-review, owner-approval, independent-review and purpose-review hashes. Hosts are ipsos.com/mdpi.com; retain restricted exclusions. The purpose hash covers the exact public query and `generic_nonpersonal_public_research`. Use a finite approved preparation envelope, at most the one-day source schema bound. Do not enroll server keys yet.
4. **Owner financial confirmation.** Follow “Review financial permission after staging.” Expand the existing proposal form, supply the exact staged dates/limits, select all five scoped operations, save the proposal, review its stored contents, and confirm its exact policy. These visible controls call R05 `propose` and `confirm` for exact policy `P`/hash. If baseline is unchanged: current Goal pins, Business revision6, expected cap revision6, expected exposure646851, lifetime cap1053587, this policy/category limit406736, USD/model, maximum five dispatches, exact scoped operations/installation and bounded preparation dates. R05 appends cap revision7 only if current exposure is known and unchanged. Never insert cap/confirmation rows directly.
5. **Just-in-time approved operator activation transaction.** Recheck all immutable/current facts, the owner-confirmed policy, cap revision7, exposure646851/no unknowns and fresh six-catalog price ceilings. Lock Business before the original funding root. Only now set `T0=clock_timestamp()`, `D=T0+30 minutes`, `R=D+30 minutes`; setup/scope/policy/adapter envelopes must remain valid through D. Build the exact five-step plan, insert the exact policy interpretation proof, controller verifier into R07 keys until R, admission verifier into R05 keys until R, and one R12 authority row. Its trigger validates the exact plan. A failure rolls back proof/keys/authority together. No opposite-role enrollment.
6. **Owner Continue.** Open `/dashboard?view=research&type=r12&business=B&selected=S&quest=G` and use the actual action. It creates its own R07 plan. Do not insert plans, attempts or provider receipts manually. The approved assistant may Continue within the same packet, without another owner response per phase.
7. **Close and read back.** On completion or terminal failure, preserve result/cost/receipt evidence, revoke the exact policy and close/revoke the two verifier enrollments as approved. Read back zero active authority and retained output. Expiry/Stop never permits another paid generation.

### Five exact scoped operation/adapters

| Phase | Maximum microUSD | Request-byte ceiling | Output tokens | Worker |
|---|---:|---:|---:|---|
| plan | 23246 | 12288 | 1500 | Planner |
| search1 | 149560 | 8192 | 4000 | Researcher |
| select1 | 26311 | 16384 | 1000 | Researcher |
| strategy | 50451 | 32768 | 5000 | Strategist |
| review | 157168 | 32768 | 4000 | Independent reviewer |

Keys are `research.r12.S.phase` and `r12.discovery.S.phase`; artifact type is `r12.discovery.phase`. Purpose is exactly `R12 original nature-shirt research: PHASE`. Search data classes are `["generic_public_query","public_evidence"]`; the other four phases use `["business_context","public_evidence"]`. Use the approved source domains, OpenRouter provider, USD/model, null account fields and the stated workflow/root pack. First four model routes are Luna/Azure; review is Haiku/Amazon Bedrock. Adapters are mode qualification, with actual database hashes and finite Knowledge/qualification validity.

Plan format is `r12.discovery.1`; maximum amount406736, children5, dispatches5, zero repairs/pivots, required check review. Each phase depends on all earlier phases. Reviewer worker identity differs from every dependency. Pins bind Goal/Business, policy, source scope, installation/snapshot, definitions, adapters and operations. Plan/step expiry is D. The plan's authorityRootId is Business; original research funding remains separately bound in the source amendment.

## Operational limits and remaining prerequisites

The 30-minute dispatch clock starts at final activation registration, after setup, not at the later Continue click. Continue may complete all five phases in one request. Each phase gates the next on saved valid output, known cost and correlated provider receipt; this is an automatic gate, not a required manual planner pause.

There are at most fifteen metadata GET claims in total, three per phase, with at least 120 seconds/Retry-After spacing and no paid regeneration. Receipt-only work ends at R. The owner action yields after a bounded transition interval, leaving room for the 45-second model transport, 20-second receipt and persistence under the 300-second dashboard limit.

Activation preflight can require the unchanged quoted ceilings. Runtime accepts fresh prices at or below each approved phase ceiling; it does not require equality to an old quote hash. Higher computed phase ceilings stop instead of increasing authority.

R04 hashes bind database Goal/Business/plan/installation/definitions; stage14 canonical hashes bind source amendments, intent, quote and output. They are distinct domains. Final release commit/tree, real PostgreSQL/browser gate, actual owner context, returned IDs, verifier hashes, approval/review hashes and absolute preparation cutoff remain to be recorded. No research outcome, creative qualification or external spending is claimed by this review.


## Reviewed parameterized recipes and isolated rehearsal

The non-executing recipe module is [scripts/r12-research-bootstrap.mjs](../scripts/r12-research-bootstrap.mjs), SHA-256 `03243e3ce22913ad25abe6048c3824bb12ebaa341cdf70510075492377221133`. It exports two parameterized transactions and actual owner API bodies; import performs no connection, credential lookup or action. Temporary input/result tables are transaction-local. No permanent helper, new grant, retry or upsert is created. Pass only genuine approved input and a separately authorized operator client.

Its positive isolated rehearsal passed all 26 checks: staging, actual authenticated owner server API proposal/confirmation, actual preparation-route verifier hashes and final exact activation, plus ownership, definition, cap-state, Goal/policy, quote and replay negatives. The fixture substitutes only 19 explicit ID/hash pins; all financial baselines, nine-root lineage, revisions, statuses, SQL predicates, limits and timings remain unchanged. Production recipe exports remain fixed to the target above. This is PGlite/in-process owner API evidence; the separate hosted R12 PostgreSQL and real Next gates remain required. No production or paid effect occurred.

The owner-path correction canonicalizes only policy operation ordering and UTC timestamp representation to match the existing financial form. Exact policy equality remains enforced. Preparation binds one opaque save identity to the original funding root; interrupted saves, ready transitions and links recover the same Goal. Configuration or owner failure writes nothing, changed cutoff is rejected, and expired setup receipts remain readable with new preparation disabled. No new migration, grant, credential or provider call is introduced.

## Exact Business-rule correction before activation

Independent final interpretation found that saved Business6 still expressed the older R11-only limits. Its initial R12 policy therefore remains unused and must be revoked. Use the [Business7 amendment and exact same-scope rebind](R12_BUSINESS_SCOPE_REBIND.md) before activation. That correction preserves the staged scope and amount, and pins a genuine owner-saved Business7/new hash plus replacement policy at cap8. The original Business6 activation recipe above is retained as history; it is not the current activation procedure.
