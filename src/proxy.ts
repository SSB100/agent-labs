import type { NextRequest } from "next/server";

import { ownerReturnPath } from "@/core/owner-entry";
import { updateSupabaseSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  // Overwrite any incoming hint with the actual local request destination.
  requestHeaders.set("x-agent-labs-return-path", ownerReturnPath(request.nextUrl.pathname + request.nextUrl.search));
  return updateSupabaseSession(request, requestHeaders);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/health|.well-known/workflow/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
