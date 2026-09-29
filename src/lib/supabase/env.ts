export type SupabasePublicConfig = {
  publishableKey: string;
  url: string;
};

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export function isWorkflowRuntimeConfigured(): boolean {
  return isSupabaseConfigured();
}

// Retained until the Stage 3 UI import is renamed. The runtime no longer uses
// a broad Supabase admin key; it uses a one-run capability instead.
export const isSupabaseAdminConfigured = isWorkflowRuntimeConfigured;

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
