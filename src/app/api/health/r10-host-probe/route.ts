import { after } from "next/server";
import { hostProbeUnavailable, isHostProbeRequest, runHostProbe } from "@/browser/watch/host-probe";
import { hostProbePage } from "@/browser/watch/host-probe-page";

// TEMPORARY: only publish to a Preview whose Vercel SSO protection was verified.
// /api/health is already excluded by proxy. No auth/database/provider path here.
// Remove all probe code before a production release; this never qualifies R10.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;
export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") return hostProbeUnavailable();
  if (!isHostProbeRequest(request, false)) return hostProbeUnavailable(403);
  return hostProbePage();
}
export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") return hostProbeUnavailable();
  return runHostProbe(request, completion => after(completion));
}
