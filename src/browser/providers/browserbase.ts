import type { BrowserProviderAdapter } from "../types";
import { BrowserProviderError } from "../types";

export function isBrowserbaseConfigured() {
  return Boolean(
    process.env.BROWSERBASE_API_KEY?.trim() &&
      process.env.BROWSERBASE_PROJECT_ID?.trim(),
  );
}

export class BrowserbaseCandidateAdapter implements BrowserProviderAdapter {
  readonly providerKey = "browserbase" as const;
  readonly configured = isBrowserbaseConfigured();

  private unavailable(): never {
    throw new BrowserProviderError(
      "configuration_required",
      "Browserbase remains an evaluated alternative. Select it in the provider registry and configure BROWSERBASE_API_KEY plus BROWSERBASE_PROJECT_ID before use.",
      false,
    );
  }

  async createSession(): Promise<never> {
    return this.unavailable();
  }

  async retrieveSession(): Promise<never> {
    return this.unavailable();
  }

  async releaseSession(): Promise<never> {
    return this.unavailable();
  }

  async fetchReplay(): Promise<never> {
    return this.unavailable();
  }
}
