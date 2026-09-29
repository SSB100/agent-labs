# Agent Labs V2

Agent Labs V2 is a clean, cloud-first rebuild of Agent Labs. The permanent Core will host durable workflows, bounded specialist workers, connected accounts, evidence, business state and human intervention. Specialised expertise will be installed through versioned packs.

The repository has completed **Stage 1: Cloud application scaffold** from `docs/AGENT_LABS_V2_IMPLEMENTATION_PLAN.md`.

## Private application model

Agent Labs is an owner-operated control centre, not a public product website.

- `/` routes to the login screen when signed out
- `/` routes to the control centre when signed in
- there is no public registration or marketing home page
- the application is marked `noindex` and `nofollow`
- owner accounts are provisioned administratively through Supabase Auth

## Stage 1 foundation

Implemented:

- Next.js App Router with TypeScript
- Supabase browser, server and session-refresh clients
- private email/password authentication shell
- authenticated control-centre dashboard and navigation skeleton
- owner-scoped Business creation and reading
- initial `profiles`, `businesses` and `business_members` migration
- Row Level Security for every exposed Stage 1 table
- runtime health endpoint at `/api/health`
- Vercel configuration for the Sydney function region
- lint, typecheck, test and build gates on every Vercel build
- GitHub Actions CI

No workflow, worker, provider, pack or commerce logic has been implemented in the Stage 1 application.

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

Create the owner account through Supabase Dashboard under Authentication and Users. The application itself intentionally provides sign-in only.

The hosted Supabase project should use the production application as its Site URL:

```text
https://agent-labs-two.vercel.app
```

Allow these redirect URLs for administratively provisioned accounts and recovery flows:

```text
http://localhost:3000/auth/confirm
https://agent-labs-two.vercel.app/auth/confirm
```

## Supabase migration

The Stage 1 hosted migration is:

```text
20260929003530_initial_identity_business.sql
```

It creates `profiles`, `businesses` and `business_members`, enables RLS, grants only the required authenticated access, creates profile and owner-membership triggers, and keeps privileged trigger functions in the unexposed `private` schema.
