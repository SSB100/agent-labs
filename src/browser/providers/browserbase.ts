import type {
  BrowserProviderAdapter,
  BrowserSessionCreateRequest,
} from "../types";
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

  async createSession(_request: BrowserSessionCreateRequest): Promise<never> {
    return this.unavailable();
  }

  async retrieveSession(_providerSessionId: string): Promise<never> {
    return this.unavailable();
  }

  async releaseSession(_providerSessionId: string): Promise<never> {
    return this.unavailable();
  }

  async fetchReplay(
    _providerSessionId: string,
    _resourceUrl?: string,
  ): Promise<never> {
    return this.unavailable();
  }
}
