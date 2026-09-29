import {
  fetchBrowserReplay,
  rewriteReplayManifest,
  verifyReplayResource,
} from "@/browser/server";

export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{ browserSessionId: string }>;
};

function decodeResource(value: string) {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

export async function GET(request: Request, { params }: RouteProps) {
  const { browserSessionId } = await params;
  const requestUrl = new URL(request.url);
  const resourceUrl = decodeResource(requestUrl.searchParams.get("url") ?? "");
  const signature = requestUrl.searchParams.get("signature") ?? "";

  if (
    !resourceUrl.startsWith("https://") ||
    !verifyReplayResource(browserSessionId, resourceUrl, signature)
  ) {
    return Response.json({ error: "Invalid replay resource" }, { status: 403 });
  }

  const result = await fetchBrowserReplay(browserSessionId, resourceUrl);
  if (!result) return Response.json({ error: "Not found" }, { status: 404 });

  const contentType = result.response.headers.get("content-type") ?? "";
  if (
    contentType.includes("mpegurl") ||
    resourceUrl.endsWith(".m3u8")
  ) {
    const manifest = await result.response.text();
    return new Response(
      rewriteReplayManifest(
        manifest,
        resourceUrl,
        requestUrl.origin,
        browserSessionId,
      ),
      {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Type": "application/vnd.apple.mpegurl",
        },
      },
    );
  }

  return new Response(result.response.body, {
    headers: {
      "Cache-Control": "private, max-age=300",
      "Content-Type": contentType || "application/octet-stream",
    },
  });
}
