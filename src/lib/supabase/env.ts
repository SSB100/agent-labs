export type SupabasePublicConfig = {
  publishableKey: string;
  url: string;
};

export type SupabaseAdminConfig = SupabasePublicConfig & {
  secretKey: string;
};

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export function isSupabaseAdminConfigured(): boolean {
  return Boolean(
    isSupabaseConfigured() &&
      (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
  );
}

export function getSupabasePublicConfig(): SupabasePublicConfig {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  return { publishableKey, url };
}

export function getSupabaseAdminConfig(): SupabaseAdminConfig {
  const publicConfig = getSupabasePublicConfig();
  const secretKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secretKey) {
    throw new Error(
      "The Stage 3 workflow runtime requires SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return { ...publicConfig, secretKey };
}
