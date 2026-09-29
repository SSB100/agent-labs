import { readFile } from "node:fs/promises";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    return;
  }

  const output = (await readFile("public/stage3-diagnostics.txt", "utf8")).slice(
    0,
    200_000,
  );
  const response = await fetch(`${url}/rest/v1/rpc/record_stage3_build_diagnostic`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_output: output }),
  });

  if (!response.ok) {
    console.error("Unable to capture Stage 3 diagnostics", response.status);
  }
}

main().catch((error) => {
  console.error("Unable to capture Stage 3 diagnostics", error);
});
