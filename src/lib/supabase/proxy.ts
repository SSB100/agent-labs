import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabasePublicConfig, isSupabaseConfigured } from "./env";

export async function updateSupabaseSession(request: NextRequest, requestHeaders: Headers) {
  if (!isSupabaseConfigured()) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const { publishableKey, url } = getSupabasePublicConfig();

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, cacheHeaders) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        requestHeaders.set("cookie", request.headers.get("cookie") ?? "");
        response = NextResponse.next({ request: { headers: requestHeaders } });

        cookiesToSet.forEach(({ name, options, value }) => {
          response.cookies.set(name, value, options);
        });

        Object.entries(cacheHeaders).forEach(([name, value]) => {
          response.headers.set(name, value);
        });
      },
    },
  });

  // getClaims validates the access token before server-side authorization is added.
  await supabase.auth.getClaims();

  return response;
}
