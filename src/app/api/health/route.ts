import { isSupabaseConfigured } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

const unavailableResponse = (supabaseStatus: string, status = 503) =>
  Response.json(
    {
      checks: {
        supabase: supabaseStatus,
      },
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
      service: "agent-labs",
      status: "degraded",
    },
    { status },
  );

export async function GET() {
  if (!isSupabaseConfigured()) {
    return unavailableResponse("not_configured");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

  try {
    const response = await fetch(`${url}/auth/v1/settings`, {
      cache: "no-store",
      headers: {
        apikey: publishableKey,
      },
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      return unavailableResponse("unreachable");
    }

    return Response.json({
      checks: {
        supabase: "connected",
      },
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
      service: "agent-labs",
      status: "ok",
    });
  } catch {
    return unavailableResponse("unreachable");
  }
}
