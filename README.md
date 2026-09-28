# Agent Labs V2

Agent Labs V2 is a clean, cloud-first rebuild of Agent Labs. The permanent Core will host durable workflows, bounded specialist workers, connected accounts, evidence, business state and human intervention. Specialised expertise will be installed through versioned packs.

This repository currently contains the first Stage 1 foundation only:

- Next.js App Router with TypeScript
- Supabase browser, server and session-refresh clients
- a non-secret environment contract for the existing Agent Labs Supabase project
- a runtime health endpoint at `/api/health`
- Vercel configuration for the Sydney function region
- lint, typecheck, test and build commands

No workflow, worker, provider or commerce logic has been implemented yet.

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

## Supabase

The intended backend is the existing Agent Labs project in Sydney, project reference `tfdareuwrshjuevuiwvn`. The first database migrations will be added in the next Stage 1 slice after deployment connectivity is verified.
