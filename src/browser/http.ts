import { BrowserProviderError } from "./types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function record(value: unknown) {
  return isRecord(value) ? value : {};
}

export function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function firstText(
  source: Record<string, unknown>,
  ...keys: string[]
) {
  for (const key of keys) {
    const value = text(source[key]);
    if (value) return value;
  }
  return null;
}

export function appendQuery(url: string, key: string, value: string) {
  const parsed = new URL(url);
  parsed.searchParams.set(key, value);
  return parsed.toString();
}

export function classifyHttpFailure(status: number, message: string) {
  if (status === 401 || status === 403) {
    return new BrowserProviderError(
      "authentication_required",
      message,
      false,
      { status },
    );
  }
  if (status === 408 || status === 429 || status >= 500) {
    return new BrowserProviderError(
      status === 408 ? "provider_timeout" : "provider_unavailable",
      message,
      true,
      { status },
    );
  }
  return new BrowserProviderError(
    "provider_rejected",
    message,
    false,
    { status },
  );
}

export async function responsePayload(response: Response) {
  const raw = await response.text();
  if (!raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return record(parsed);
  } catch {
    return { message: raw.slice(0, 1000) };
  }
}

export function providerMessage(
  payload: Record<string, unknown>,
  fallback: string,
) {
  return (
    firstText(payload, "message", "error", "detail", "title") ?? fallback
  );
}
