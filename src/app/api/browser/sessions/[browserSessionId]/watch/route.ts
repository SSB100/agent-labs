import { after } from "next/server";
import { createWatchLifetime, withinWatchLifetime } from "@/browser/watch/lifetime";
import { openOwnedBrowserWatch, readWatchRequest } from "@/browser/watch-server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Paired with the registered 150s work + 15s cleanup lifetime; the remaining
// headroom is not capture/permit authority and cannot renew the one-shot grant.
export const maxDuration = 180;
export async function POST(request: Request, { params }: { params: Promise<{ browserSessionId: string }> }) {
  // Include params/body parsing in the hosting budget: a slow request body
  // must not leave a fresh 150s clock after the invocation was already spent.
  const lifetime = createWatchLifetime(completion => after(completion));
  let handedOff = false;
  try {
    const scope = await withinWatchLifetime(lifetime, async () => readWatchRequest(request, (await params).browserSessionId), request.signal);
    if (!scope) return Response.json({ status: "unavailable" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    handedOff = true;
    return await openOwnedBrowserWatch(request, scope, lifetime);
  } catch { return Response.json({ status: "unavailable" }, { status: 409, headers: { "Cache-Control": "no-store" } }); }
  finally { if (!handedOff) lifetime.finish(); }
}
