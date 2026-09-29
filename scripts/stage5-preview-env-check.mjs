import { createClient } from "@supabase/supabase-js";

const QUALIFICATION_TOKEN =
  "dun0JHSqlfGDFmXUe_5rsK0Ld-Dq4tXYeUH0QytL6gkXxp09TVnbYVbm5_u2aCTK";

if (process.env.VERCEL_ENV !== "preview") {
  console.log("Stage 5 Preview environment check skipped outside Preview.");
  process.exit(0);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !publishableKey) {
  throw new Error("The Stage 5 Preview is missing its Supabase environment variables.");
}

if (!process.env.OPENROUTER_API_KEY?.trim()) {
  const supabase = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await supabase.rpc(
    "record_stage5_live_model_qualification",
    {
      p_evidence: {
        passed: false,
        category: "configuration_required",
        message: "OPENROUTER_API_KEY is unavailable in the Vercel Preview build environment.",
        source: "vercel_preview_environment_check",
      },
      p_model_key: "luna.standard",
      p_qualification_token: QUALIFICATION_TOKEN,
      p_qualification_type: "structured_output",
    },
  );

  if (error) {
    throw new Error(
      `OPENROUTER_API_KEY is unavailable and the diagnostic could not be recorded: ${error.message}`,
    );
  }

  throw new Error("OPENROUTER_API_KEY is unavailable in the Vercel Preview build environment.");
}

console.log("Stage 5 Preview environment check passed.");
