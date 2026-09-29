# Agent Labs V2

Agent Labs V2 is a clean, cloud-first rebuild of Agent Labs. The permanent Core hosts durable workflows, bounded specialist workers, connected accounts, evidence, business state and human intervention. Specialised expertise is installed through versioned packs.

The repository has completed:

- **Stage 1: Cloud application scaffold**
- **Stage 2: Universal Core data contracts**

The next planned stage is the Vercel Workflow runtime. It has not been started.

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
- generic synthetic definitions for deterministic Stage 2 verification

Not implemented yet:

- durable workflow execution
- worker or model invocation
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

The publishable key is designed for browser use. Do not add a Supabase secret key or service-role key to the client application.

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

The Stage 2 checkpoint is documented at `docs/checkpoints/STAGE_2_UNIVERSAL_CORE_CONTRACTS.md`.
