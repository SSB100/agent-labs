# Supabase workspace

Agent Labs V2 uses the existing hosted Supabase project:

- Project name: Agent Labs
- Project reference: `tfdareuwrshjuevuiwvn`
- Region: Sydney (`ap-southeast-2`)

The public schema was empty when the Stage 1 scaffold was created. Database migrations will be added here deliberately, beginning with `profiles`, `businesses` and `business_members`.

Never commit secret or service-role keys. Browser and SSR clients must use only the project URL and the publishable key through the two `NEXT_PUBLIC_SUPABASE_*` environment variables.
