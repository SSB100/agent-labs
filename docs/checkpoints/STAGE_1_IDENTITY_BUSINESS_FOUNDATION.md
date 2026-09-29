# Stage 1 checkpoint: Private identity and Business foundation

## Source of truth

This checkpoint completes Stage 1 of `AGENT_LABS_V2_IMPLEMENTATION_PLAN.md`. It does not begin workflow, worker, model, browser, provider, pack or commerce implementation.

## Product boundary

Agent Labs is a private operator application for its owner, not a public product website.

Stage 1 therefore establishes these UI rules:

- `/` immediately routes an authenticated owner to `/dashboard`
- `/` routes an unauthenticated request to `/login`
- the login screen is the only unauthenticated application screen
- public self-service registration is not exposed
- there is no marketing home page, product pitch or public onboarding flow
- authenticated work happens inside the Agent Labs control centre
- search engines are instructed not to index or follow the application

The owner account is provisioned administratively through Supabase Auth. Additional users can be introduced deliberately in a later team-access stage without changing the Stage 1 data model.

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

- private email/password sign-in
- SSR session refresh through the Next.js proxy
- confirmation handling retained for administratively provisioned or recovered accounts
- signed-claim validation for protected routes and actions
- a private control-centre dashboard
- owner-scoped Business creation and reading
- sign out

## Verification

Completed against the hosted Agent Labs Supabase project:

- migration applied successfully
- the three Stage 1 tables exist with RLS enabled
- security advisors returned no findings at the original Stage 1 qualification point
- transactional two-user fixtures verified profile creation, owner membership, owner access and cross-owner isolation
- repository tests verify the private login-first product boundary
- lint, typecheck, tests and production build run before every Vercel deployment

## Stop point

Stage 1 is the review boundary. No additional Stage 2 application functionality should be merged until this private control-centre experience is reviewed and approved.
