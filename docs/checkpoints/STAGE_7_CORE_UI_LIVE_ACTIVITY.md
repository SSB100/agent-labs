# Stage 7 checkpoint: Core UI and live activity

## Source of truth

This checkpoint implements **Stage 7: Core UI and live activity** from `AGENT_LABS_V2_IMPLEMENTATION_PLAN.md`.

Stage 7 turns the private Agent Labs application into an operational control centre. It presents durable workflow state in owner-readable form, surfaces exceptional decisions prominently, streams Core activity through authenticated Supabase Realtime subscriptions and provides a reusable workflow Workspace without beginning Stage 8 browser-provider work.

Stage 8 has not been started. There is no Browserbase, Steel, remote browser session, takeover, replay or browser-provider implementation in this stage.

## Private application shell

The signed-in application now has six permanent Core sections:

```text
Dashboard
Workflows
Needs You
History
Accounts
Settings
```

The application remains private:

- signed-out requests return to the Agent Labs login screen
- there is no public registration
- there is no marketing homepage
- search indexing remains disabled
- owner identity and sign-out controls remain inside the private shell

The Stage 4, Stage 5 and Stage 6 qualification surfaces remain available as secondary tools:

```text
Worker proof
Model router
Worker evaluations
```

Desktop navigation uses the private sidebar. Mobile navigation uses a fixed, horizontally scrollable Core menu so every Stage 7 surface remains reachable on smaller screens.

## Dashboard

The Dashboard explains the current system state without requiring access to raw logs.

It displays:

- active workflow count
- open Needs You count
- completed workflow count
- Artifact count
- current Core-runtime readiness
- visually summarised active or recent workflows
- latest business-readable activity
- Business workspaces
- durable workflow launch control
- recent terminal outcomes

When an owner intervention is open, the Needs You section appears ahead of routine workflow activity.

## Workflows

The Workflows index provides:

- all-run and active-run views
- Business and WorkflowDefinition identity
- durable status
- current stage
- visual stage timeline
- retry attempt visibility
- current action
- current worker or runtime
- Task Contract identity
- Artifact count
- direct navigation into one Workflow Run

The detailed Workflow screen provides:

- visual stage timeline
- current worker
- current task
- current action
- next step
- owner intervention controls
- live Activity Feed
- durable Task Contract context
- runtime identity and timestamps
- reusable Workspace tabs

## Reusable Workspace

The Stage 7 Workspace begins with four tabs:

```text
Live Browser
Products
Metrics
Artifacts
```

`Live Browser`, `Products` and `Metrics` are intentional placeholders for later qualified capability and pack stages.

`Artifacts` is live and displays the durable Artifact records created by the selected Workflow Run, including type, media type, structured content, metadata, identifier and creation time.

The placeholder tabs do not pretend that Stage 8 or commerce capabilities exist.

## Needs You

The Needs You queue contains only open `OwnerIntervention` records visible through the signed-in owner session.

Each decision card shows:

- intervention title
- plain-language description
- Business
- workflow name
- time requested
- approve-and-complete action
- fail-workflow action

The action returns to the page from which the owner made the decision. The server validates the requested return route against a fixed safe route list or an exact Workflow Run route.

A transaction-scoped qualification reopened an existing synthetic intervention and proved that the owner-visible query resolved:

```text
Open interventions: 1
Title:              Review synthetic workflow
Workflow Run:       70ad2316-5992-4e63-863a-e6530cacb625
```

The transaction was rolled back, so the hosted intervention state was not changed.

## History

History presents terminal Workflow Runs with:

- completed, failed and cancelled totals
- status filters
- Business identity
- workflow name
- final stage
- durable completion or update time
- link back to the full Workflow screen

Classified failures remain inspectable rather than disappearing from the main interface.

## Accounts

Accounts distinguishes current Core infrastructure from future external Business accounts.

Current system cards show:

```text
Supabase
Vercel Workflow
OpenRouter
```

Future account placeholders include browser, marketplace, fulfilment and social providers. No provider credentials or unsupported connection buttons are exposed.

## Settings

Settings presents:

- owner display identity
- owner email
- administrative account provisioning model
- disabled public registration
- Business workspaces
- private-application principles
- server-only credential boundary
- owner-scoped data boundary

## Live activity architecture

Stage 7 removes the previous two-second page polling loop.

The browser now subscribes through the authenticated Supabase client to `postgres_changes` for:

```text
artifacts
businesses
events
owner_interventions
task_contracts
worker_runs
workflow_runs
workflow_stage_runs
```

The browser debounces matching changes and asks Next.js to refresh server-rendered owner-scoped state.

Network activity pauses naturally with the Realtime channel. A 30-second fallback refresh remains only for visible tabs in case the live channel is unavailable. Returning focus also refreshes current state.

## Hosted Realtime publication

Migration:

```text
20260929125855_stage7_core_ui_realtime_publication
```

The migration adds the eight Core tables to `supabase_realtime` only when they are not already present.

Hosted verification returned exactly:

```text
artifacts
businesses
events
owner_interventions
task_contracts
worker_runs
workflow_runs
workflow_stage_runs
```

Every published table retains RLS.

## RLS isolation

The primary owner session could read the durable Stage 7 sources:

```text
Businesses:       1
Workflow Runs:    2
Stage Runs:      12
Events:          28
Interventions:    2
Artifacts:        0
```

The separate authenticated test owner could read:

```text
Businesses:       0
Workflow Runs:    0
Stage Runs:       0
Events:           0
Interventions:    0
Artifacts:        0
```

Publishing a table to Realtime did not weaken its data-access policy.

## Owner-readable workflow model

The UI view-model converts durable records into owner-facing concepts:

- WorkflowDefinition stage order becomes the visual timeline
- the latest attempt for each stage is authoritative
- open OwnerIntervention becomes Needs You
- Task Contract objective becomes Current task
- WorkerDefinition becomes Current worker
- latest durable Event becomes Current action
- the next WorkflowDefinition stage becomes Next step
- raw event types receive business-readable labels and details

Executable Core UI tests cover:

- ordered stage blueprints
- latest retry attempt selection
- Needs You resolution
- current action derivation
- next-step derivation
- workflow status tone
- model-event translation
- durable waiting explanation

## Responsive design

The Stage 7 visual system is responsive across desktop and mobile layouts.

Desktop uses:

- fixed sidebar
- broad dashboard panels
- side-by-side Workflow Workspace and Activity Feed
- multi-column execution summary

Mobile uses:

- fixed private header
- horizontally scrollable Core navigation
- single-column panels
- full-width decision controls
- single-column stage timeline
- two-column Workspace tab buttons where space allows

## Preserved runtime boundaries

Stage 7 does not change:

- Workflow DevKit orchestration
- scoped runtime capabilities
- Worker Pack validation
- Model Router policy
- Worker qualification enforcement
- provider credentials
- Business RLS rules

The interface reads the existing durable Core records and invokes the existing guarded owner actions.

## Verification evidence

Before the Vercel project reached its temporary build-rate limit, the Stage 7 diagnostic Preview confirmed:

```text
ESLint:                    clean
TypeScript:                clean
Stage 7 repository tests:  passed
Next.js Preview:           READY
Health endpoint:           HTTP 200
Supabase:                  connected
Workflow runtime:          configured
Model Router:              configured
```

The remaining diagnostic test failures were preserved-stage assertions that referenced the removed two-second polling component and temporary diagnostic build command. Those assertions were migrated to the authenticated Realtime implementation and shared Stage 7 shell before final cleanup.

The final branch restores:

```text
npm run quality && next build
```

and removes all temporary diagnostic routes and build overrides.

Vercel then reported its project-level build-rate limit for new deployments. This is a hosting quota condition rather than a source, TypeScript, database or runtime failure.

## Stop point

Stage 7 implementation is complete in the Stage 7 branch and database migration. **Stage 8 has not been started.**
