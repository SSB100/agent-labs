import { BrowserbaseAdapter } from "./browserbase";
import { getBrowserProviderDefinition, getDefaultBrowserProviderKey } from "./registry";
import { SteelBrowserAdapter } from "./steel";
import type {
  BrowserProviderAdapter,
  BrowserProviderKey,
  BrowserReplay,
  BrowserSessionHandle,
  BrowserSessionLaunchOptions,
} from "./types";

export function isBrowserProviderConfigured(key = getDefaultBrowserProviderKey()) {
  if (key === "steel") return Boolean(process.env.STEEL_API_KEY?.trim());
  return Boolean(process.env.BROWSERBASE_API_KEY?.trim());
}

export function browserProviderStatus() {
  const selected = getDefaultBrowserProviderKey();
  return {
    selected,
    selectedConfigured: isBrowserProviderConfigured(selected),
    steelConfigured: isBrowserProviderConfigured("steel"),
    browserbaseConfigured: isBrowserProviderConfigured("browserbase"),
  };
}

export function createBrowserProviderAdapter(
  key = getDefaultBrowserProviderKey(),
): BrowserProviderAdapter {
  return key === "steel" ? new SteelBrowserAdapter() : new BrowserbaseAdapter();
}

export async function launchBrowserSession(
  options: BrowserSessionLaunchOptions,
  key: BrowserProviderKey = getDefaultBrowserProviderKey(),
): Promise<BrowserSessionHandle> {
  return createBrowserProviderAdapter(key).createSession(options);
}

export async function releaseBrowserSession(
  providerSessionId: string,
  key: BrowserProviderKey,
) {
  await createBrowserProviderAdapter(key).releaseSession(providerSessionId);
}

export async function browserSessionReplay(
  providerSessionId: string,
  key: BrowserProviderKey,
): Promise<BrowserReplay> {
  return createBrowserProviderAdapter(key).getReplay(providerSessionId);
}

export function estimateBrowserCostUsd(
  key: BrowserProviderKey,
  durationMilliseconds: number,
) {
  const definition = getBrowserProviderDefinition(key);
  const hours = Math.max(0, durationMilliseconds) / 3_600_000;
  return Number((hours * definition.pricing.browserHourUsd).toFixed(8));
}
