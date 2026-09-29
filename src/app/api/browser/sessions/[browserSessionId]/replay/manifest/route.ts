import {
  fetchBrowserReplay,
  rewriteReplayManifest,
} from "@/browser/server";

export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{ browserSessionId: string }>;
};

export async function GET(request: Request, { params }: RouteProps) {
  const { browserSessionId } = await params;
  const result = await fetchBrowserReplay(browserSessionId);
  if (!result) return Response.json({ error: "Not found" }, { status: 404 });

  const manifestUrl =
    result.response.url ||
    `https://api.steel.dev/v1/sessions/${encodeURIComponent(
      result.session.provider_session_id ?? "",
    )}/hls`;
  const manifest = await result.response.text();
  const rewritten = rewriteReplayManifest(
    manifest,
    manifestUrl,
    new URL(request.url).origin,
    browserSessionId,
  );

  return new Response(rewritten, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/vnd.apple.mpegurl",
    },
  });
}
