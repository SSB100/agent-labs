# Stage 10: Pack framework

Branch: `stage-10/pack-framework`

Pull request: https://github.com/SSB100/agent-labs/pull/14

## Result

Capability, Knowledge, Worker, and Workflow Packs are registered as immutable releases. Business activation resolves exact dependency versions and snapshots their manifests. Every Workflow Run copies its starting snapshot. One generic Vercel Workflow interpreter executes registered stage definitions without adding a Core workflow for each new pack.

The synthetic qualification pack has worker and workflow releases `1.0.0` and `2.0.0`. These are Pack release numbers inside the current Agent Labs V2 project.

The signed-in test owner activated and launched both releases on Preview deployment `dpl_2duqTCjHAmLFsg4AWy1WvjDZ6NbL`, source `9d0b2df0f25433c3329f0c64c5ecf086d4fd64a0`.

| Pack release | Core Workflow Run | Vercel Workflow Run | Result |
| --- | --- | --- | --- |
| 1.0.0 | `d5d4a221-49d0-4e05-b9cb-5fab30f462cf` | `wrun_01M3R6ZQT4CSV0VE3P378SRXF9` | Completed, output and receipt pinned to 1.0.0 |
| 2.0.0 | `be610776-3314-41b5-8c16-949cf8dd4e59` | `wrun_01M3R75FA1JA9AGSWAPVSZD59K` | Completed, output and receipt pinned to 2.0.0 |

Each run has one completed Worker Run, three Artifacts (input, scoped knowledge, validated output), and four durable activity events. The Business now has the workflow's `2.0.0` installation active; the earlier run retains its original snapshot and output. Live passing evidence is attached to all six participating Pack releases.

## Implementation

- Manifest validation rejects unknown fields, arbitrary executors, unsafe JSON keys, floating versions, excessive dependency graphs, duplicate definitions, and forward stage references.
- Exact dependency resolution rejects missing, retired, unqualified, cyclic, and conflicting releases. Stages must stay within Worker capability and knowledge declarations.
- The private registrar installs WorkerDefinitions, WorkflowDefinitions, knowledge definitions, and capability definitions. Owners can read the catalog and activate qualified packs for their own Businesses; they cannot register or qualify packs.
- Installations and run snapshots are immutable. Activating another version supersedes the prior installation for future launches.
- Owner launch reserves a durable run idempotently. Runtime transitions require the correct Business, Workflow Run, and capability hash. Deterministic IDs and persisted receipts suppress duplicate execution records.
- The generic interpreter supports bounded sequential stages, structured mapping, and the qualified standard Model Router. It validates scoped context, freshness, Worker output, and terminal Workflow output. Failures close active child records.
- The Packs page displays release metadata, qualification status, exact dependency pins, Business activation, and workflow launch input. Existing Workflow UI displays live activity, task scope, output Artifacts, and the workflow version.
- `scripts/register-pack.mjs` emits a reviewed platform migration from validated manifests. `docs/PACK_FRAMEWORK.md` documents registration without Core code changes.

## Verification

Local lint, TypeScript, all 97 tests, and the optimized Next.js build passed. Workflow compilation includes 40 steps across six workflows. Hosted CI `36665802061` passed the complete gate. The signed-in preview qualification above used the production-configured Supabase and Vercel Workflow services; it performed no browser or marketplace mutations.

`supabase/tests/stage10_packs.sql` passed with all changes rolled back. It verifies installed definitions, incomplete qualification denial, owner isolation, activation idempotency, launch duplication, upgrade behavior, immutable run pins, owner qualification denial, incorrect runtime capability denial, scoped context, wrong receipt version rejection, and successful execution of a reserved old-version run after a new release is activated.

Four tracked Stage 10 migrations are applied. Registration qualification initially caught Core's capability-array shape requirement; the subsequent registration migration aligns it before sample releases are created. Runtime error logs for the live preview show no errors.

The Supabase advisor reports the existing scoped SECURITY DEFINER RPC pattern, including the new owner-checked activation/launch functions and capability-checked runtime function. No new table lacks RLS. Leaked-password protection remains a pre-existing Auth setting.

## Production

Preview and hosted gates passed. Merge and production verification follow this checkpoint; Stage 11 adds reusable Web Research evidence collection.
