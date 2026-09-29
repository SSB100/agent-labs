import { BrowserbaseCandidateAdapter } from "./providers/browserbase";
import { SteelBrowserAdapter, isSteelConfigured } from "./providers/steel";
import type { BrowserProviderAdapter, BrowserProviderKey } from "./types";

export const DEFAULT_BROWSER_PROVIDER_KEY = "steel" as const;

export const BROWSER_PROVIDER_COMPARISON = {
  steel: {
    displayName: "Steel",
    selected: true,
    selfHostable: true,
    entryPrice: "$0 monthly plus $0.10 per browser hour",
    liveView: "WebRTC H.264 at 25 fps",
    replay: "HLS/MP4",
    persistentIdentity: true,
    playwright: true,
    uploads: true,
  },
  browserbase: {
    displayName: "Browserbase",
    selected: false,
    selfHostable: false,
    entryPrice: "Free 1 hour, then Developer $20 monthly",
    liveView: "Managed live debugger",
    replay: "Managed session recording",
    persistentIdentity: true,
    playwright: true,
    uploads: true,
  },
} as const;

export function isDefaultBrowserProviderConfigured() {
  return isSteelConfigured();
}

export function createBrowserProviderAdapter(
  providerKey: BrowserProviderKey = DEFAULT_BROWSER_PROVIDER_KEY,
): BrowserProviderAdapter {
  if (providerKey === "steel") return new SteelBrowserAdapter();
  return new BrowserbaseCandidateAdapter();
}
