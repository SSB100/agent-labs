# Stage 14 creative SQL contract

Status: migration 20260930113942 is approved and applied. Independent security review conditionally passed under the documented trusted-owner model. Full local checks and hosted Stage 10–14 rollback regressions passed before and after apply. Actual zero-paid Storage HTTP upload/download, byte-hash, missing/wrong/foreign capability, immutable-path, terminal and expired-capability denial tests passed. Owner expiry recovery was verified. Hosted application UI and the single approved real technical image run remain pending; no paid provider call or full Stage 14 exit is claimed.

## Files and scope

- Migration: `supabase/migrations/20260930113942_stage14_creative_pipeline.sql`, named by `supabase migration new stage14_creative_pipeline`
- Rollback regression: `supabase/tests/stage14_creative.sql`
- Global catalog definitions: generated from `src/creative/packs.ts`; all experimental
- No old qualification, installed-pack or Stage 13 research constraints are relaxed
- The actual product candidate remains `NEEDS_MORE_EVIDENCE`; this migration makes no research decisions

## Public RPC operations

Owner-only, `authenticated`:

1. `approve_creative_candidate(p_candidate_id uuid, p_approval jsonb, p_quote jsonb)`
   - Full `CreativeApprovalSnapshot`, including the 50–1500 character exact owner `designInstructions`, plus the app's verified quote
   - Owner, Business and candidate identity are checked; server records owner/time and the persisted production assessment rather than trusting caller-supplied assessment
   - Returns `{approvalId, approvalHash, snapshot}`
   - Same approval UUID replay returns its original immutable snapshot; changed substantive content is rejected
   - A canonical scope fingerprint also prevents refreshed UUIDs, approval/expiry timestamps, Printful verification timestamps or quote timestamps from resetting identical intent into another two-image allowance. Fingerprint includes the candidate/purpose/design/rights/screens/physical specification/budget and model identities. Candidate-row locking serializes concurrent form submissions
2. `begin_creative_run(p_approval_id uuid, p_launch_nonce uuid, p_runtime_capability text)`
   - Revalidates rights, sources, production evidence when applicable, and approval expiry
   - Returns `{creativeRunId, workflowRunId, shouldStart, snapshot, approvalHash, quote}`
   - Exactly one run per immutable approval; repeat launch never replaces the capability or creates another run
   - The secret must be 32–512 characters; the app must generate it cryptographically, never send it to models or expose it in client UI
3. `fail_creative_launch(p_creative_run_id uuid, p_launch_nonce uuid)`
   - Nonce-bound, unclaimed launch only; closes the run into Needs You
   - Returns `{status, interventionId?}`

4. `close_expired_creative_run(p_creative_run_id uuid)`
   - Owner-bound recovery for an expired nonterminal run only; preserves all artifacts and reservations and closes to Needs You
   - Returns `{status, interventionId?}`; cannot renew, restart or spend

Runtime-only, `anon` publishable client with exact run secret:

`creative_runtime_transition(p_creative_run_id uuid, p_business_id uuid, p_runtime_capability text, p_operation text, p_payload jsonb default '{}')`

| Operation | Payload | Return / effect |
|---|---|---|
| `load` | `{runtimeRunId}` for initial claim; `{}` thereafter | Binds durable runtime identity once; returns status, phaseKey, approval, approvalHash, quote, brief, briefHash, screen, assets, reviews, committedMicrousd, productionReady |
| `prepare` | `{callKey}` | For model phases: `{worker: PackWorker, context: WorkerInvocationContext}` with exact Task Contract and only its same-run artifacts; generation returns `{}` |
| `reserve_call` | `{callKey,reservedMicrousd,requestHash,model,provider,estimate}` | `{allowed,shouldExecute,committedMicrousd}` plus prepared context on first model admission. Replay returns `shouldExecute:false`; a changed replay is rejected. Budget exhaustion becomes Needs You |
| `record_call` | `{callKey,reportedMicrousd,providerRequestId,receipt}` | Immutable settlement and receipt; nullable unknown charge/opaque ID accepted honestly. Output validation may be false. Returns `{recorded,committedMicrousd}` |
| `persist_phase` | `{callKey,output}` | Requires outputValidated=true receipt and all deterministic phase gates; returns `{status,phaseKey,artifactId,productionReady,interventionId}` |
| `fail` | `{reason}` | Retains every reservation/receipt/asset; makes Needs You; terminal completion is never overwritten |

There are only six call keys, each reservable once:

`brief:1 → screen:1 → generate:1 → review:1 → completed`, or a failed review permits exactly `generate:2 → review:2 → completed / needs_owner`.

A model PASS with deterministic image/print failure goes to Needs You. The first review FAIL may authorize a single exact repair. Every repeated failure stops. A non-clear screen stops before generation.

## Payload details

- Brief: `DesignBrief`
- Screen: `BriefScreen`, hash-bound to canonical final brief and immutable owner approval
- Generation: `{inspection,storagePath,prompt,model,provider,generatedAt}`
- Review: `DesignReview`, hash-bound to the exact persisted asset and brief
- `load.assets`: generation payload plus `version: 1|2`
- `load.reviews`: `{version: 1|2, output: DesignReview}`
- First prompt is exactly `brief.imagePrompt`
- Repair prompt is exactly `brief.imagePrompt + "\n\nRepair instruction: " + firstReview.repairInstruction`
- Receipt minimum: `{model,provider:'openrouter',providerRequestId:string|null,outputValidated:boolean,executionMode:'creative.model'|'image.generate'|'simulation',mockProvider:boolean}`. Provider usage/latency/other receipt fields are preserved
- A missing opaque provider request ID does not invent an ID or discard an asset. A missing reported charge preserves validated output, retains the reservation and stops in Needs You
- Successfully received, valid images are preserved even if their actual cost exceeds the approved budget; no later paid phase is admitted

The reviewer Task Contract uses the exact pinned manifest union schema; app requests and SQL checks narrow it by phase. Context artifact fields follow `WorkerInputArtifact`: `{id,artifactType,name,mediaType,content,metadata}`. Metadata includes checksum and private storagePath. Types are `creative.approval`, `creative.brief`, `creative.brief-screen`, `creative.image`, `creative.review`, and `pack.knowledge`. Scoped knowledge is copied from the pinned release closure and rechecked for freshness.

Image generation is a trusted capability, not a falsely labeled Creative Director Worker Run. It has Core Workflow Stage, Action Intent, Action Receipt and Artifact. The Director/reviewer phases have Task Contracts and Worker Runs. All phases have Events and immutable output records.

## Budget and quote boundaries

- Absolute owner budget ceiling: 2,000,000 micro-USD (US$2); approval can be lower
- Current approved total and per-phase bounds come from the app quote, not a hardcoded price-consent assumption
- Approved fixed models: Luna `openai/gpt-5.6-luna`, independent reviewer `anthropic/claude-haiku-4.5`, image model `recraft/recraft-v4.1-pro`
- Generator can never review its own image
- The current app quote uses conservative six-call estimate 825,056 micro-USD, with phase ceilings 33,992 / 107,304 / 210,000 / 131,880; SQL checks supplied arithmetic and ceiling rather than treating that quote as an invoice guarantee
- Every call's fresh quote must match its approved model and exact official OpenRouter catalog URL, within five minutes
- Text estimates preserve byte count, formatting/image allowance, bounded output token limit, and current token/cache-write rates. SQL recomputes the reservation and limits serialized text to 24,576 bytes
- Image estimates bind exact request hash, prompt hash, quoted charge, pricing fingerprint and quote ID
- `committed = Σ max(reserved, reported ?? 0)`; a low reported charge never releases budget for another attempt
- Simulation permits zero spending only and must label receipts explicitly; it cannot become production-ready
- No automatic paid retries, implicit fallbacks, third generation, publication or marketplace authority

## Production gate and immutable provenance

`candidate_production` requires a same-Business, current, persisted Stage 13 owner-assessed `TEST` decision and fresh, validated research artifact lineage. SQL reconstructs the Stage 13 assessment and requires exact equality, including the persisted `ownerRightsConfirmed` override without rewriting original candidate rights history. Missing market evidence cannot be waived by a creative release. Technical qualifications and simulations must have null decision/assessment and always remain `productionReady:false` even after PASS.

Approvals, creative runs, phase outputs, asset versions, reviews, reservations and settlements are append-only. Composite foreign keys bind Business/candidate/decision/approval/run/asset identities; hashes bind exact immutable content. Core CRUD guards prevent owners from fabricating receipts, completed runs, reviews, artifacts or events through generic table writes. Dedicated runs have neither `pack_snapshot` nor a generic runtime capability hash on `workflow_runs`; generic installed-pack runtimes cannot execute them. Their pinned catalog is stored in `creative_runs`.

## Storage boundary requiring approval

Private bucket `creative-assets`, PNG only, 7 MB maximum. Exact immutable paths:

`<BusinessUUID>/<CreativeRunUUID>/version-1.png`

`<BusinessUUID>/<CreativeRunUUID>/version-2.png`

- Business owner can SELECT their private assets after completion
- Runtime reads/inserts use `x-creative-capability`; helper compares its SHA-256 to a private table, binds Business/run/path, checks active status and hard expiry ≤2 hours
- INSERT is only the currently reserved generation version, after independent final-brief screen PASS, before that version is persisted
- No UPDATE, DELETE, upsert or public bucket; restrictive companion policies prevent other permissive policies widening access
- Runtime uses only publishable credentials and a short-lived run capability; no service-role secret is used or distributed
- Supabase service-role administration inherently bypasses Storage RLS; this is not claimed to defend against database administrators. App and runtime are forbidden that credential
- Storage upload API, custom-header forwarding, PNG bytes, storage download hash equality and full image inspection need end-to-end verification after approved deployment. SQL-only rollback checks cannot verify those network/service behaviors

## Verification status and rollback suite

Both files pass PostgreSQL parsing using pglast 7.7. PL/pgSQL bodies parse after substituting unresolved catalog `%rowtype` declarations with generic records for syntax-only parsing. This is not a substitute for execution against the real Supabase schema.

The rollback suite covers owner isolation, wrong/cross-Business secrets, generic runtime bypass, counterfeit owner TEST, rights and print-source freshness, approval/run idempotency including new form UUIDs, scoped context, fake review/brief hash, immutable provenance, replayed/uncertain/over-budget cost, exact Storage path and terminal capability restrictions, one-repair exhaustion, technical PASS remaining non-production, binary PASS override denial, IP-screen escalation, launch failure and capability expiry. All provider receipts, research candidates and Storage metadata in this suite are synthetic rollback fixtures. The suite does not call a provider or upload PNG bytes and must never be treated as live qualification.

The suite includes a positive production-approval fixture with initially unclear rights and later persisted owner confirmation. Hosted rollback execution (including that fixture), actual ACL/advisor checks and zero-paid HTTP Storage verification passed. Live Recraft output remains unverified. No stage exit or production readiness is claimed.

References consulted: Supabase changelog (`https://supabase.com/changelog.md`, including 2026-09-25 Postgres minor security update) and [Storage Access Control](https://supabase.com/docs/guides/storage/security/access-control). The RLS design deliberately denies upsert because Storage upsert additionally requires UPDATE.

## Patched review findings

- Repair output uses an identical TypeScript/SQL exact template allowlist; free-form review rationales are evidence only and never appended to a generation prompt. Original screened intent cannot be widened by a repair
- PNG acceptance is consistently 7,000,000 bytes to fit the visual model's encoded request limit
- `close_expired_creative_run(uuid)` is a fourth authenticated owner-only action. It can only close an expired, nonterminal run to Needs You; it cannot renew capability, spend, restart a workflow, delete artifacts or clear uncertain reservations
- New provider reservations require at least five minutes of capability lifetime. Runtime and Storage access still expire after two hours
- Provenance is application-recorded provider metadata verified by the normal runtime, not cryptographic attestation against a malicious owner. An owner can choose a run secret and author internally consistent records for their own Business through its guarded API. This inherited trusted-owner limitation grants no cross-Business access, global qualification promotion or publication authority. Future autonomy may require separate server attestation

Image catalog requests use at most 10 seconds, paid image requests at most 120 seconds, and each Storage HTTP operation at most 60 seconds. The five-minute admission margin covers this bounded request chain with settlement/inspection headroom. An expired secret never regains active authority; owner-only expiry recovery remains available. Returned model and explicitly reported unexpected upstream identities are rejected while their known charges and reported identity are preserved.
