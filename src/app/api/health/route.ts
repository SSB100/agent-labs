import { isOpenRouterConfigured } from "@/models/openrouter";
import {
  isSupabaseAdminConfigured,
  isSupabaseConfigured,
} from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

const unavailableResponse = (
  supabaseStatus: string,
  workflowRuntimeStatus: string,
  modelRouterStatus: string,
  status = 503,
) =>
  Response.json(
    {
      checks: {
        supabase: supabaseStatus,
        workflowRuntime: workflowRuntimeStatus,
        modelRouter: modelRouterStatus,
      },
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
      service: "agent-labs",
      status: "degraded",
    },
    { status },
  );

export async function GET() {
  const workflowRuntimeStatus = isSupabaseAdminConfigured()
    ? "configured"
    : "not_configured";
  const modelRouterStatus = isOpenRouterConfigured()
    ? "configured"
    : "not_configured";

  if (!isSupabaseConfigured()) {
    return unavailableResponse(
      "not_configured",
      workflowRuntimeStatus,
      modelRouterStatus,
    );
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
      return unavailableResponse(
        "unreachable",
        workflowRuntimeStatus,
        modelRouterStatus,
      );
    }

    if (!isSupabaseAdminConfigured() || !isOpenRouterConfigured()) {
      return unavailableResponse(
        "connected",
        workflowRuntimeStatus,
        modelRouterStatus,
      );
    }

    return Response.json({
      checks: {
        supabase: "connected",
        workflowRuntime: "configured",
        modelRouter: "configured",
      },
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
      service: "agent-labs",
      status: "ok",
    });
  } catch {
    return unavailableResponse(
      "unreachable",
      workflowRuntimeStatus,
      modelRouterStatus,
    );
  }
}
