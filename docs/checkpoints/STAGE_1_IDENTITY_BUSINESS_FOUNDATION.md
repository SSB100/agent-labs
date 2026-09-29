# Stage 1 checkpoint: Identity and Business foundation

## Source of truth

This slice implements the remaining identity and Business requirements in Stage 1 of `AGENT_LABS_V2_IMPLEMENTATION_PLAN.md`. It does not begin Stage 2 or introduce workflow, worker, model, browser, provider, pack or commerce logic.

## Database

Hosted migration:

```text
20260929003530_initial_identity_business
```

Tables:

- `profiles`
- `businesses`
- `business_members`

Security invariants:

- every public Stage 1 table has RLS enabled
- authenticated users can read and update only their own profile
- a Business can be inserted, read, updated or deleted only by its owner
- owner membership is inserted by a constrained trigger
- application clients cannot directly insert, update or delete memberships
- privileged trigger functions live in the unexposed `private` schema
- authorization never uses editable user metadata

## Application

The application provides:

- email/password signup and sign-in
- SSR session refresh through the Next.js proxy
- confirmation handling for token-hash and PKCE-code flows
- signed-claim validation for protected routes and actions
- an authenticated dashboard navigation skeleton
- owner-scoped Business creation and reading
- sign out

## Verification

Completed against the hosted Agent Labs Supabase project:

- migration applied successfully
- all three tables exist with RLS enabled
- security advisors returned no findings
- transactional two-user fixture verified profile creation, owner membership, owner access and cross-owner isolation
- performance advisor reported only expected unused-index notices for the newly created empty tables

Repository gates:

- static Stage 1 security tests
- lint
- TypeScript typecheck
- production Next.js build
- GitHub Actions CI
- the same quality gate runs automatically before each Vercel build
