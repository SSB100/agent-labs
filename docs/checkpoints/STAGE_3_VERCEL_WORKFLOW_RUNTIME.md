# Stage 3 checkpoint: Vercel Workflow runtime

## Source of truth

This checkpoint completes **Stage 3: Vercel Workflow runtime** from `AGENT_LABS_V2_IMPLEMENTATION_PLAN.md`.

It does not start the Worker Pack runtime, invoke a real model, operate a browser, connect a provider or add commerce-specific behaviour.

## Durable runtime

Stage 3 integrates Workflow DevKit with the Next.js application and registers the synthetic workflow:

```text
synthetic.core.runtime-proof
```

The proof flow is:

```text
Start
→ Worker Task
→ Wait
→ Review
→ Complete
```

The workflow function performs orchestration only. Database transitions run in retryable step functions with normal Node.js access.

The runtime supports:

- a versioned workflow registry
- durable Workflow DevKit execution
- persisted stage transitions
- a deterministic transient failure and retry
- a durable five-second wait
- an owner-intervention hook
- approve and fail review paths
- completion and bounded failure
- business-readable event emission
- workflow and stage history in Supabase
- current state, history and Needs You actions in the private control centre

## Launch and authority model

An authenticated owner reserves a Workflow Run through `begin_synthetic_workflow_run` using a Business-scoped idempotency key.

Each new run receives a random runtime capability. Only its SHA-256 hash is stored. Workflow steps use the original capability to invoke `stage3_runtime_transition` for that run and Business. The workflow runtime therefore does not receive a broad Supabase secret or service-role key.

The transition RPC is executable only by the anonymous Workflow client. Its `SECURITY DEFINER` privileges are bounded by the required high-entropy capability, exact Workflow Run ID and exact Business ID. Signed-in application users do not receive execute permission.

Duplicate launches are prevented by the unique Business and idempotency-key constraint. The database remains authoritative if a client submits the same launch again.

## Live qualification

Two final production runs qualified the success and failure paths.

### Approved path

```text
Core Workflow Run: 6c957777-b877-4fd7-9e92-28846d029527
Workflow runtime:  wrun_01M3NNB0KBB8BQ6GYQPRE1JPXG
Result:            completed
Worker attempts:   2
Final stage:       complete
```

The run was reserved at `2026-09-29 04:02:28 UTC`. A new production deployment was created after reservation and before the first durable step executed at `2026-09-29 04:04:10 UTC`. The run then continued through retry, wait, review and completion, proving survival across a deployment boundary.

### Rejected path

```text
Core Workflow Run: f0e3163a-7f45-47bb-b512-49f45a751e97
Workflow runtime:  wrun_01M3NND5Q1WC4PMJ71F5SXHBCG
Result:            failed
Worker attempts:   2
Failure category:  owner_rejected
Final stage:       review
```

Both final idempotency keys produced exactly one Core Workflow Run.

The durable database history recorded:

- `workflow.queued`
- `workflow.started`
- first worker attempt failure
- `workflow.retry.scheduled`
- second worker attempt completion
- `workflow.wait.started`
- `workflow.wait.completed`
- `workflow.owner_intervention.requested`
- owner approval or rejection
- `workflow.completed` or bounded `workflow.failed`

## Hosted migrations

```text
20260929030033_stage3_vercel_workflow_runtime
20260929033834_stage3_scoped_runtime_capability
20260929034351_stage3_capability_helper_permission
20260929043635_stage3_qualification_cleanup
20260929044045_stage3_runtime_grant_tightening
```

The repository filenames match the hosted migration versions.

## Qualification cleanup

After the evidence above was captured:

- the temporary token-gated qualification route was removed
- temporary qualification-only functions were dropped
- the private qualification-claim table was dropped
- six temporary qualification Businesses and their cascading history were deleted
- signed-in-user execution of the runtime transition RPC was revoked
- the permanent workflow definition and capability-gated runtime functions were retained
- no runtime capability or qualification token was preserved in source or documentation

## Verification

Stage 3 passed:

- Workflow DevKit production build integration
- workflow registry lookup
- Start → Worker Task → Wait → Review → Complete execution
- deterministic retry from attempt one to attempt two
- durable wait
- owner hook pause and resume
- approved completion path
- owner-rejected failure path
- event and stage-history persistence
- idempotent launch reservation
- one-run scoped runtime authority
- deployment-boundary survival
- current state and history rendering in the control centre
- removal of temporary qualification access and data
- production health check with Supabase and workflow runtime configured

Supabase Security Advisor intentionally reports that the anonymous role can execute `stage3_runtime_transition`. That is the required Workflow client entry point and it performs no action without the matching one-run capability, Workflow Run ID and Business ID. The separate leaked-password-protection warning is an Auth project setting rather than a Stage 3 schema finding.

The separate GitHub Actions job is still not receiving a hosted runner and records zero executed steps. The complete repository gate runs successfully inside each Vercel build before deployment.

## Stop point

Stage 3 is complete. Stage 4 must not begin until this checkpoint and the private control-centre behaviour are reviewed.
