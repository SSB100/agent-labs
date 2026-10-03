import { verifyOwnerBusiness } from "@/lib/core-ui/owner-business";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { etsyConfig, etsyRpc, ownerBusiness, newConnectionId } from "@/etsy/server";
import { unseal, seal, secretHash } from "@/etsy/vault";
import { exchangeOAuth, discoverShop } from "@/etsy/oauth";
import { requireEtsy } from "@/etsy/contracts";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const destination = new URL("/dashboard/etsy", request.url);
  const jar = await cookies(), cookie = jar.get("etsy-oauth")?.value;
  jar.delete({ name: "etsy-oauth", path: "/api/etsy/callback" });
  try {
    const config = etsyConfig();
    const context = await requireOwnerUiContext(), query = new URL(request.url).searchParams;
    requireEtsy(cookie, "oauth_not_completed");
    const browser = unseal<{ businessId: string; ownerId: string; state: string; browserNonce: string }>(cookie, "oauth-cookie", config.vaultKey);
    requireEtsy(browser.ownerId === context.userId && query.get("state") === browser.state, "oauth_state_mismatch");
    if(!(await verifyOwnerBusiness(context,browser.businessId)))throw new Error("Business unavailable");
    ownerBusiness(context, browser.businessId);
    destination.searchParams.set("business", browser.businessId);
    requireEtsy(!query.has("error") && (query.get("code")?.length ?? 0) >= 8 && (query.get("code")?.length ?? 0) <= 4096, "oauth_not_completed");
    const stateHash = secretHash(browser.state);
    const consumed = await etsyRpc(context, browser.businessId, "oauth_consume", { stateHash });
    const binding = unseal<{ businessId: string; ownerId: string; browserNonceHash: string; verifier: string }>(String(consumed.envelope), `oauth:${browser.businessId}:${stateHash}`, config.vaultKey);
    requireEtsy(binding.businessId === browser.businessId && binding.ownerId === context.userId && binding.browserNonceHash === secretHash(browser.browserNonce), "oauth_browser_mismatch");
    const tokens = await exchangeOAuth(config, { code: query.get("code")!, verifier: binding.verifier });
    const shop = await discoverShop(config, tokens);
    const workspace = await etsyRpc(context, browser.businessId, "workspace");
    const existing = workspace.connection as { id: string; shopId: number } | null;
    requireEtsy(!existing || existing.shopId === shop.shopId, "shop_reassignment_denied");
    const connectionId = existing?.id ?? newConnectionId(), revision = randomUUID();
    const account = { ...tokens, businessId: browser.businessId, connectionId, revision, shopId: shop.shopId, currency: shop.currency };
    await etsyRpc(context, browser.businessId, "connect", { id: connectionId, revision, stateHash, ...shop,
      envelope: seal(account, `account:${browser.businessId}:${connectionId}`, config.vaultKey) });
    destination.searchParams.set("message", "connected");
  } catch { destination.searchParams.set("message", "connection-unavailable"); }
  // No code, token, provider error, request URL or account envelope is logged.
  const response = NextResponse.redirect(destination, 303);
  response.headers.set("Cache-Control", "no-store"); response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
