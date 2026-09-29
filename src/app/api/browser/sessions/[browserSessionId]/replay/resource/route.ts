import {
  fetchBrowserReplay,
  rewriteReplayManifest,
  verifyReplayResource,
} from "@/browser/server";

export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{ browserSessionId: string }>;
};

const FORWARDED_RESPONSE_HEADERS = [
  "accept-ranges",
  "content-length",
  "content-range",
  "etag",
  "last-modified",
] as const;

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

  const requestHeaders = new Headers();
  const range = request.headers.get("range");
  if (range && !resourceUrl.toLowerCase().includes(".m3u8")) {
    requestHeaders.set("range", range);
  }

  const result = await fetchBrowserReplay(
    browserSessionId,
    resourceUrl,
    requestHeaders,
  );
  if (!result) return Response.json({ error: "Not found" }, { status: 404 });

  const contentType = result.response.headers.get("content-type") ?? "";
  if (
    contentType.includes("mpegurl") ||
    resourceUrl.toLowerCase().includes(".m3u8")
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

  const responseHeaders = new Headers({
    "Cache-Control": "private, max-age=300",
    "Content-Type": contentType || "application/octet-stream",
    "Vary": "Range",
  });
  for (const header of FORWARDED_RESPONSE_HEADERS) {
    const value = result.response.headers.get(header);
    if (value) responseHeaders.set(header, value);
  }

  return new Response(result.response.body, {
    status: result.response.status,
    statusText: result.response.statusText,
    headers: responseHeaders,
  });
}
