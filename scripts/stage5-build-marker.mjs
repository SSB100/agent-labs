import { createClient } from "@supabase/supabase-js";

const DIAGNOSTIC_TOKEN =
  "qlSKzzDN1aMbQkhH2IPkfbzEhhZ7iQvVcd9OMeCxKtaDy4U-Hey98ir6PZZoknEG";

if (process.env.VERCEL_ENV !== "preview") {
  process.exit(0);
}

const stage = process.argv[2];
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!stage || !supabaseUrl || !publishableKey) {
  throw new Error("Stage 5 build marker is missing its stage or Supabase configuration.");
}

const supabase = createClient(supabaseUrl, publishableKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { error } = await supabase.rpc("record_stage5_build_diagnostic", {
  p_details: {
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    environment: process.env.VERCEL_ENV ?? null,
  },
  p_diagnostic_token: DIAGNOSTIC_TOKEN,
  p_stage: stage,
});

if (error) {
  throw new Error(`Unable to record Stage 5 build marker ${stage}: ${error.message}`);
}
