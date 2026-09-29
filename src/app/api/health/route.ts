import { isDefaultBrowserProviderConfigured } from "@/browser/registry";
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
  browserProviderStatus: string,
  status = 503,
) =>
  Response.json(
    {
      checks: {
        supabase: supabaseStatus,
        workflowRuntime: workflowRuntimeStatus,
        modelRouter: modelRouterStatus,
        browserProvider: browserProviderStatus,
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
  const browserProviderStatus = isDefaultBrowserProviderConfigured()
    ? "configured"
    : "not_configured";

  if (!isSupabaseConfigured()) {
    return unavailableResponse(
      "not_configured",
      workflowRuntimeStatus,
      modelRouterStatus,
      browserProviderStatus,
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

  try {
    const response = await fetch(`${url}/auth/v1/settings`, {
      cache: "no-store",
      headers: { apikey: publishableKey },
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      return unavailableResponse(
        "unreachable",
        workflowRuntimeStatus,
        modelRouterStatus,
        browserProviderStatus,
      );
    }

    if (
      !isSupabaseAdminConfigured() ||
      !isOpenRouterConfigured() ||
      !isDefaultBrowserProviderConfigured()
    ) {
      return unavailableResponse(
        "connected",
        workflowRuntimeStatus,
        modelRouterStatus,
        browserProviderStatus,
      );
    }

    return Response.json({
      checks: {
        supabase: "connected",
        workflowRuntime: "configured",
        modelRouter: "configured",
        browserProvider: "configured",
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
      browserProviderStatus,
    );
  }
}
