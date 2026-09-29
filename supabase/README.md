# Supabase workspace

Agent Labs V2 uses the existing hosted Supabase project:

- Project name: Agent Labs
- Project reference: `tfdareuwrshjuevuiwvn`
- Region: Sydney (`ap-southeast-2`)

## Migration history

`20260929003530_initial_identity_business.sql` establishes the Stage 1 identity and Business foundation:

- `profiles`
- `businesses`
- `business_members`
- automatic profile creation after Supabase Auth signup
- automatic owner membership after Business creation
- owner-scoped Row Level Security
- least-privilege grants for the `authenticated` role

The matching hosted migration was applied to the Agent Labs project and verified with a transactional two-user isolation fixture. Security advisors returned no findings after the migration.

Never commit secret or service-role keys. Browser and SSR clients must use only the project URL and publishable key through the two `NEXT_PUBLIC_SUPABASE_*` environment variables.
