# Agent Labs V2

Agent Labs V2 is a clean, cloud-first rebuild of Agent Labs. The permanent Core hosts durable workflows, bounded specialist workers, model routing, connected accounts, evidence, business state and human intervention. Specialised expertise is installed through versioned packs.

The repository has completed:

- **Stage 1: Cloud application scaffold**
- **Stage 2: Universal Core data contracts**
- **Stage 3: Vercel Workflow runtime**
- **Stage 4: Worker Pack runtime**
- **Stage 5: Model Router**

The next planned stage is **Stage 6: Worker evaluation framework**. It has not been started.

## Private application model

Agent Labs is an owner-operated control centre, not a public product website.

- `/` routes to the login screen when signed out
- `/` routes to the control centre when signed in
- there is no public registration or marketing home page
- the application is marked `noindex` and `nofollow`
- owner accounts are provisioned administratively through Supabase Auth

## Current foundation

Implemented:

- Next.js App Router with TypeScript
- Supabase browser, server and session-refresh clients
- private email/password authentication
- authenticated control-centre dashboard
- owner-scoped Business creation and reading
- Row Level Security for all exposed tables
- runtime health endpoint at `/api/health`
- Sydney Vercel functions and Sydney Supabase database
- lint, typecheck, test and build gates on every deployment
- universal Core contracts for Goals, packs, workflows, stages, Task Contracts, workers, artifacts, evidence, events, external resources, action intents, receipts and owner interventions
- generic repository and service interfaces
- runtime contract validation
- Workflow DevKit integration and a versioned workflow registry
- durable stage transitions, retry, wait, failure, completion and owner-intervention handling
- one-run scoped runtime capabilities rather than a broad database secret
- idempotent workflow launch reservation and duplicate prevention
- durable workflow state, stage history and business-readable events in Supabase
- workflow history and Needs You controls in the private control centre
- a complete versioned Generic Researcher Worker Pack fixture
- Task Contract-only worker context enforcement
- capability, knowledge, input, output and evidence validation
- durable Worker Runs, classified failures, output Artifacts and worker receipts
- an owner-visible Worker Proof page
- provider-neutral model definitions and logical routes
- OpenRouter structured-output and required tool-call support
- Luna-class default routing
- independent Claude reviewer routing
- Sol-class high-power escalation routing
- Gemini-class large-context and independent fallback routing
- bounded retry and fallback with a maximum of two attempts
- provider-safe schema projection followed by complete local validation
- durable provider, model, token, cost and latency telemetry
- an owner-visible Model Router page
- live qualification of five models for structured output and tool use

Not implemented yet:

- the Stage 6 Worker Pack evaluation and promotion framework
- browser operation
- commerce provider connections
- production capability, knowledge, worker or workflow packs
- Etsy or other commerce execution

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Replace the placeholders with the Agent Labs Supabase publishable key and an OpenRouter key.
3. Install dependencies with `npm install`.
4. Run `npm run dev`.
5. Open `http://localhost:3000`.

Run the complete local gate with:

```powershell
npm run check
```

## Vercel environment

Create these variables in Development, Preview and Production:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `OPENROUTER_API_KEY`

Optional OpenRouter attribution variables are:

- `OPENROUTER_API_BASE_URL`
- `OPENROUTER_APP_URL`
- `OPENROUTER_APP_NAME`

The Supabase publishable key is designed for browser use. `OPENROUTER_API_KEY` is server-only and must never use a `NEXT_PUBLIC_` prefix. Do not add a Supabase secret key or service-role key to the client application. Durable runtime transitions use a random capability scoped to one Workflow Run.

## Owner account provisioning

Create owner accounts through Supabase Dashboard under Authentication and Users. The application intentionally provides sign-in only.

The hosted Supabase project should use this Site URL:

```text
https://agent-labs-two.vercel.app
```

Allow these redirect URLs for administratively provisioned accounts and recovery flows:

```text
http://localhost:3000/auth/confirm
https://agent-labs-two.vercel.app/auth/confirm
```

## Migrations

Stage 1:

```text
20260929003530_initial_identity_business.sql
```

Stage 2:

```text
20260929011830_universal_core_contracts.sql
20260929011903_core_contract_optional_fk_delete_semantics.sql
20260929021058_core_contract_relationship_integrity.sql
```

Stage 3:

```text
20260929030033_stage3_vercel_workflow_runtime.sql
20260929033834_stage3_scoped_runtime_capability.sql
20260929034351_stage3_capability_helper_permission.sql
20260929043635_stage3_qualification_cleanup.sql
20260929044045_stage3_runtime_grant_tightening.sql
```

Stage 4:

```text
20260929060408_stage4_worker_pack_foundation.sql
20260929060533_stage4_worker_runtime_transition.sql
20260929063538_stage4_worker_runtime_consolidation.sql
20260929063554_stage4_qualification_cleanup.sql
```

Stage 5:

```text
20260929074449_stage5_model_router_foundation.sql
20260929074737_stage5_model_router_runtime.sql
20260929081542_stage5_model_schema_consolidation.sql
20260929081624_stage5_model_catalog.sql
20260929081703_stage5_worker_route_contract.sql
20260929081753_stage5_runtime_start_task.sql
20260929081833_stage5_runtime_route_worker.sql
20260929081929_stage5_runtime_invocations.sql
20260929101714_stage5_openrouter_catalog_correction.sql
20260929101810_stage5_live_qualification_recorder.sql
20260929102028_stage5_live_qualification_outcomes.sql
20260929103127_stage5_build_diagnostics.sql
20260929104732_stage5_terminal_transition_fix.sql
20260929105127_stage5_qualification_cleanup.sql
```

Stage checkpoints are stored under `docs/checkpoints/`.
