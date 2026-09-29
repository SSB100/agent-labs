import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdminConfig } from "./env";

export function createAdminClient() {
  const { secretKey, url } = getSupabaseAdminConfig();

  return createSupabaseClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
