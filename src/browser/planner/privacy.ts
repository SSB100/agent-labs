import type { BrowserObservedElement, BrowserPlannerAction, BrowserStructuredObservation } from "./types";
import { BrowserPlannerError } from "./types";

// Normalize separators, camelCase, Unicode presentation forms and invisible separators.
// These hints are intentionally conservative: uncertain secure inputs belong to the owner.
export const SENSITIVE_FIELD_PATTERN = /password|passwd|passphrase|passcode|passkey|identity|cardholder|card\s*(?:expir|exp)|payment|verification|authentication|bank\s*name|(?:^|\s)pwd(?:\s|$)|secret|credential|token|api\s*key|private\s*key|authorization|(?:^|\s)(?:code|otp|totp|hotp|mfa|2fa|pin|cvv|cvc|iban|bic|swift|ssn|ein|tin|vat|bank|tax)(?:\s|$)|one\s*time|(?:auth(?:entication)?|verification|security|backup|recovery)\s*(?:code|key|answer)|seed\s*phrase|(?:credit|debit|payment|bank)\s*(?:card|account|details|number)|(?:card|account|routing)\s*(?:number|no)|(?:^|\s)cc\s|tax(?:payer)?\s*(?:id|identification|number)|vat\s*(?:id|number)|social\s*security|national\s*(?:id|identity)|passport|driver.?s?\s*licen[cs]e|identity\s*(?:document|number|verification)|date\s*of\s*birth|birth\s*(?:date|day)|(?:^|\s)bday(?:\s|$)/i;

export function sensitiveHint(value: unknown) {
  if (typeof value !== "string") return false;
  const normalized = value.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ");
  return SENSITIVE_FIELD_PATTERN.test(normalized) ||
    SENSITIVE_FIELD_PATTERN.test(normalized.replace(/([a-z])([A-Z])/g, "$1 $2"));
}

export function isSensitiveBrowserField(element: Partial<BrowserObservedElement> & Record<string, unknown>) {
  return element.sensitive === true || [element.type, element.id, element.name,
    element.text, element.placeholder, element.autocomplete, element.domId, element.label]
    .some(sensitiveHint);
}

// URLs are metadata, not an auth transport. Never retain query/hash/userinfo in observations.
export function redactBrowserUrl(value: string, base?: string): string | null {
  try {
    const url = new URL(value, base);
    if (!["http:", "https:", "about:"].includes(url.protocol) ||
        (url.protocol === "about:" && url.href !== "about:blank")) return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch { return null; }
}
/** Benign search/tracking parameters should not erase the entire page model.
 * Unknown parameters and authentication contexts remain conservative. */
export function sensitiveBrowserUrl(value: string, base?: string) {
  try {
    const url = new URL(value, base);
    if (url.username || url.password) return true;
    if (url.search && /(?:login|sign.?in|sign.?up|oauth|auth|account|verif|recover|reset|payment|billing|identity)/i.test(url.pathname)) return true;
    for (const [key, entry] of url.searchParams) {
      if (sensitiveHint(key) || sensitiveHint(entry) || !/^(?:q|query|search|page|sort|order|filter|category|ref|utm_[a-z]+)$/i.test(key)) return true;
    }
    return !!url.hash && (sensitiveHint(decodeURIComponent(url.hash)) || /[=&]/.test(url.hash) || url.hash.length > 32);
  } catch { return true; }
}

export function ownerOnlyBrowserEntry(): never {
  throw new BrowserPlannerError({
    category: "invalid_action",
    message: "Sensitive account entry requires an owner-only secure handoff with capture disabled.",
    retryable: false,
    details: { ownerOnlySecureEntry: true, captureAllowed: false },
  });
}

export function assertPlannerActionPrivacy(
  observation: BrowserStructuredObservation,
  action: BrowserPlannerAction,
) {
  if ((action.type !== "type" && action.text !== null) ||
      (action.type !== "navigate" && action.url !== null)) {
    throw new BrowserPlannerError({ category: "invalid_action", message: "Browser action includes unrelated input data.", retryable: false, details: {} });
  }
  if (action.type === "type" || action.type === "click") {
    const target = [...observation.controls, ...observation.links]
      .find((element) => element.id === action.elementId);
    if (target && isSensitiveBrowserField(target)) ownerOnlyBrowserEntry();
    // The owner must submit secure forms too, even if values were entered earlier.
    if (action.type === "click" && target && observation.forms.some((form) =>
      form.elementIds.includes(target.id) && (form.sensitive === true || observation.controls.some((element) =>
        form.elementIds.includes(element.id) && isSensitiveBrowserField(element))))) {
      ownerOnlyBrowserEntry();
    }
  }
  if (action.type === "navigate" && action.url) {
    try {
      const url = new URL(action.url, observation.url);
      if (url.username || url.password || url.hash || [...url.searchParams.keys()].some(sensitiveHint) ||
          (url.search && /(?:login|sign.?in|sign.?up|oauth|auth|account|verif|recover|reset|payment|billing|identity)/i.test(url.pathname))) {
        ownerOnlyBrowserEntry();
      }
    } catch (error) {
      if (error instanceof BrowserPlannerError) throw error;
      throw new BrowserPlannerError({ category: "invalid_action", message: "Browser navigation URL is invalid.", retryable: false, details: {} });
    }
  }
}

export function plannerActionReceipt(action: BrowserPlannerAction): BrowserPlannerAction {
  return { type: action.type, elementId: action.elementId, text: action.text, url: action.url,
    reason: sensitiveHint(action.reason) || /https?:\/\/\S*[?#]/i.test(action.reason)
      ? "A bounded browser decision was made; sensitive details were withheld." : action.reason,
    failureCategory: action.failureCategory !== null && !/^[a-z][a-z0-9_]{0,60}$/.test(action.failureCategory)
      ? "planner_declined" : action.failureCategory };
}
