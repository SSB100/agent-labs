import type {
  BrowserProviderDefinition,
  BrowserProviderKey,
} from "./types";

export const BROWSER_PROVIDER_REGISTRY: Readonly<
  Record<BrowserProviderKey, BrowserProviderDefinition>
> = {
  steel: {
    key: "steel",
    displayName: "Steel",
    status: "selected",
    baseUrl: "https://api.steel.dev/v1",
    documentationUrl: "https://docs.steel.dev",
    capabilities: {
      liveEmbed: true,
      persistentSessions: true,
      humanTakeover: true,
      replay: true,
      playwright: true,
      uploads: true,
      isolatedSessions: true,
      selfHostable: true,
    },
    pricing: {
      plan: "Launch",
      monthlyUsd: 0,
      browserHourUsd: 0.1,
      includedBrowserHours: 300,
      maxSessionMinutes: 15,
      retentionDays: 7,
      notes: [
        "$30 one-time usage credit",
        "10 concurrent sessions",
        "usage-based without a monthly platform fee",
      ],
    },
  },
  browserbase: {
    key: "browserbase",
    displayName: "Browserbase",
    status: "alternative",
    baseUrl: "https://api.browserbase.com/v1",
    documentationUrl: "https://docs.browserbase.com",
    capabilities: {
      liveEmbed: true,
      persistentSessions: true,
      humanTakeover: true,
      replay: true,
      playwright: true,
      uploads: true,
      isolatedSessions: true,
      selfHostable: false,
    },
    pricing: {
      plan: "Developer",
      monthlyUsd: 20,
      browserHourUsd: 0.12,
      includedBrowserHours: 100,
      maxSessionMinutes: 15,
      retentionDays: 7,
      notes: [
        "Free qualification tier available",
        "live debugger and session replay",
        "managed persistent contexts",
      ],
    },
  },
};

export const DEFAULT_BROWSER_PROVIDER: BrowserProviderKey = "steel";

export function isBrowserProviderKey(value: string): value is BrowserProviderKey {
  return value === "steel" || value === "browserbase";
}

export function getDefaultBrowserProviderKey(): BrowserProviderKey {
  const configured = process.env.BROWSER_PROVIDER_DEFAULT?.trim().toLowerCase();
  return configured && isBrowserProviderKey(configured)
    ? configured
    : DEFAULT_BROWSER_PROVIDER;
}

export function getBrowserProviderDefinition(key: BrowserProviderKey) {
  return BROWSER_PROVIDER_REGISTRY[key];
}

export function browserProviderCatalog() {
  return Object.values(BROWSER_PROVIDER_REGISTRY);
}
