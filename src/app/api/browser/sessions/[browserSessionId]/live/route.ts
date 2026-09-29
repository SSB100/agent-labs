import { redirect } from "next/navigation";

import { loadOwnedBrowserSession } from "@/browser/server";

export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{ browserSessionId: string }>;
};

export async function GET(_request: Request, { params }: RouteProps) {
  const { browserSessionId } = await params;
  const owned = await loadOwnedBrowserSession(browserSessionId);
  if (!owned) return Response.json({ error: "Not found" }, { status: 404 });

  const { data, error } = await owned.supabase.rpc(
    "get_browser_session_live_view",
    {
      p_browser_session_id: browserSessionId,
      p_interactive:
        owned.session.status === "human_control" &&
        owned.session.control_mode === "human",
    },
  );

  if (error || typeof data !== "string" || !data.startsWith("https://")) {
    return Response.json({ error: "Live view unavailable" }, { status: 404 });
  }

  redirect(data);
}
