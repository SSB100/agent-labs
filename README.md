# Agent Labs V2

Agent Labs V2 is a clean, cloud-first rebuild of Agent Labs. The permanent Core hosts durable workflows, bounded specialist workers, connected accounts, evidence, business state and human intervention. Specialised expertise is installed through versioned packs.

The repository has completed:

- **Stage 1: Cloud application scaffold**
- **Stage 2: Universal Core data contracts**
- **Stage 3: Vercel Workflow runtime**
- **Stage 4: Worker Pack runtime**

The next planned stage is **Stage 5: Model Router**. It has not been started.

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

Not implemented yet:

- live model invocation
- model routing, fallback, escalation or provider telemetry
- browser operation
- provider connections
- production capability, knowledge, worker or workflow packs
- commerce execution

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Replace the placeholder with the Agent Labs Supabase publishable key.
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

The publishable key is designed for browser use. Do not add a Supabase secret key or service-role key to the client application. Durable runtime transitions use a random capability scoped to one Workflow Run.

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

Stage checkpoints are stored under `docs/checkpoints/`.
