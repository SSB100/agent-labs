import { readWatchRequest, revokeOwnedBrowserWatch } from "@/browser/watch-server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;
export async function POST(request: Request, { params }: { params: Promise<{ browserSessionId: string }> }) {
  const scope = await readWatchRequest(request, (await params).browserSessionId);
  if (!scope) return Response.json({ status: "unavailable" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  return revokeOwnedBrowserWatch(request, scope);
}
