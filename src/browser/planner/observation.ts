import { randomUUID } from "node:crypto";
import type { JSHandle, Page } from "playwright-core";

import type {
  BrowserObservedElement,
  BrowserObservedForm,
  BrowserStructuredObservation,
} from "./types";
import { BrowserPlannerError } from "./types";
import { isSensitiveBrowserField, redactBrowserUrl, sensitiveBrowserUrl, sensitiveHint, SENSITIVE_FIELD_PATTERN } from "./privacy";

const STABLE_ID_ATTRIBUTE = "data-agent-labs-element-id";
type ElementIdentityRegistry = { document: Document; ids: WeakMap<Element, string>; sequence: number; prefix: string };
// The registry lives behind a Playwright JSHandle, never on window/DOM where
// page scripts could replace it. IDs follow the actual node across reordering.
const identityRegistries = new WeakMap<Page, JSHandle<ElementIdentityRegistry>>();
async function elementIdentityRegistry(page: Page) {
  let registry = identityRegistries.get(page);
  if (registry) {
    try { if (await registry.evaluate(value => value.document === document)) return registry; }
    catch { /* Navigation replaced the JS realm; create a fresh non-reusable identity namespace. */ }
    await registry.dispose().catch(() => undefined);
  }
  registry = await page.evaluateHandle(prefix => ({ document, ids: new WeakMap<Element, string>(), sequence: 0, prefix }), randomUUID().replaceAll("-", ""));
  identityRegistries.set(page, registry);
  return registry;
}
const ELEMENT_ID_PATTERN = /^[A-Za-z0-9:_-]{3,120}$/;
const ELEMENT_KINDS = new Set([
  "button",
  "checkbox",
  "input",
  "link",
  "option",
  "radio",
  "select",
  "textarea",
]);

type RawObservation = {
  url: string;
  title: string;
  visibleText: string;
  forms: BrowserObservedForm[];
  controls: BrowserObservedElement[];
  links: BrowserObservedElement[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nullableString(value: unknown) {
  return value === null || typeof value === "string";
}

function observedElement(value: unknown): value is BrowserObservedElement {
  if (!isRecord(value)) return false;
  const kind = value.kind;
  const elementId = value.id;
  return (
    typeof elementId === "string" &&
    /^(?:el_[a-z0-9]{7}|el_[a-f0-9]{32}_[1-9][0-9]{0,6})$/.test(elementId) &&
    typeof kind === "string" &&
    ELEMENT_KINDS.has(kind) &&
    typeof value.tag === "string" &&
    nullableString(value.role) &&
    nullableString(value.type) &&
    typeof value.text === "string" &&
    nullableString(value.value) &&
    nullableString(value.name) &&
    nullableString(value.placeholder) &&
    nullableString(value.href) &&
    typeof value.disabled === "boolean" &&
    (value.checked === null || typeof value.checked === "boolean") &&
    (value.selected === null || typeof value.selected === "boolean") &&
    (value.sensitive === undefined || typeof value.sensitive === "boolean") &&
    ["autocomplete", "label", "domId"].every((key) => value[key] === undefined || nullableString(value[key]))
  );
}

function observedForm(value: unknown): value is BrowserObservedForm {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    ELEMENT_ID_PATTERN.test(value.id) &&
    nullableString(value.action) &&
    typeof value.method === "string" &&
    (value.sensitive === undefined || typeof value.sensitive === "boolean") &&
    Array.isArray(value.elementIds) &&
    value.elementIds.every(
      (elementId) =>
        typeof elementId === "string" && ELEMENT_ID_PATTERN.test(elementId),
    )
  );
}

function assertObservationShape(
  value: unknown,
): asserts value is BrowserStructuredObservation {
  if (!isRecord(value)) {
    throw new BrowserPlannerError({
      category: "observation_failed",
      message: "Browser Service returned a non-object observation.",
      retryable: true,
      details: {},
    });
  }

  const controls = value.controls;
  const links = value.links;
  const forms = value.forms;
  const url = value.url;

  if (
    typeof url !== "string" ||
    typeof value.title !== "string" ||
    typeof value.visibleText !== "string" ||
    (value.privacyRedacted !== undefined && typeof value.privacyRedacted !== "boolean") ||
    typeof value.observedAt !== "string" ||
    !Number.isFinite(Date.parse(value.observedAt)) ||
    !Array.isArray(controls) ||
    !controls.every(observedElement) ||
    !Array.isArray(links) ||
    !links.every(observedElement) ||
    !Array.isArray(forms) ||
    !forms.every(observedForm)
  ) {
    throw new BrowserPlannerError({
      category: "observation_failed",
      message: "Browser Service returned an invalid structured observation.",
      retryable: true,
      details: {},
    });
  }

  try {
    const parsedUrl = new URL(url);
    if (
      !["http:", "https:", "about:"].includes(parsedUrl.protocol) ||
      (parsedUrl.protocol === "about:" && parsedUrl.href !== "about:blank")
    ) {
      throw new Error("unsupported observation URL");
    }
  } catch {
    throw new BrowserPlannerError({
      category: "observation_failed",
      message: "Browser observation URL is invalid or unsupported.",
      retryable: false,
      details: {},
    });
  }

  const elements = [...controls, ...links];
  const ids = elements.map((element) => element.id);
  if (new Set(ids).size !== ids.length) {
    throw new BrowserPlannerError({
      category: "observation_failed",
      message: "Browser observation contains duplicate stable element IDs.",
      retryable: true,
      details: {},
    });
  }

  const knownIds = new Set(ids);
  const unknownFormId = forms
    .flatMap((form) => form.elementIds)
    .find((elementId) => !knownIds.has(elementId));
  if (unknownFormId) {
    throw new BrowserPlannerError({
      category: "observation_failed",
      message: "Browser form references an element outside the observation.",
      retryable: true,
      details: {},
    });
  }
}

const WITHHELD_TEXT = "Sensitive account content withheld; owner-only secure entry required.";

/** Sanitize again at every model/receipt boundary, including restored durable observations. */
export function sanitizeStructuredObservation(value: unknown): BrowserStructuredObservation {
  assertObservationShape(value);
  const entries = [...value.controls, ...value.links];
  const sensitive = new Set(entries.filter(isSensitiveBrowserField).map((entry) => entry.id));
  const redactContent = sensitive.size > 0 || value.privacyRedacted === true ||
    sensitiveHint(value.title) || sensitiveHint(value.visibleText) ||
    sensitiveBrowserUrl(value.url) ||
    entries.some((entry) => entry.href && sensitiveBrowserUrl(entry.href, value.url)) ||
    value.forms.some((form) => form.action && sensitiveBrowserUrl(form.action, value.url));
  const element = (entry: BrowserObservedElement): BrowserObservedElement => ({
    id: entry.id, kind: entry.kind, tag: redactContent ? entry.kind : entry.tag,
    role: redactContent ? null : entry.role,
    type: sensitive.has(entry.id) ? "password" : redactContent ? null : entry.type,
    text: redactContent ? (sensitive.has(entry.id) ? "Owner-only secure entry" : entry.kind) : entry.text,
    value: redactContent ? null : entry.value,
    name: redactContent ? null : entry.name,
    placeholder: redactContent ? null : entry.placeholder,
    href: entry.href ? redactBrowserUrl(entry.href, value.url) : null,
    disabled: entry.disabled, checked: entry.checked, selected: entry.selected,
    ...(sensitive.has(entry.id) ? { sensitive: true } : {}),
  });
  return {
    url: redactBrowserUrl(value.url)!,
    title: redactContent ? WITHHELD_TEXT : value.title,
    visibleText: redactContent ? WITHHELD_TEXT : value.visibleText,
    forms: value.forms.map((form) => ({ id: form.id,
      action: form.action ? redactBrowserUrl(form.action, value.url) : null,
      method: form.method, elementIds: [...form.elementIds],
      ...(form.sensitive ? { sensitive: true } : {}) })),
    controls: value.controls.map(element), links: value.links.map(element),
    observedAt: value.observedAt,
    ...(redactContent ? { privacyRedacted: true } : {}),
  };
}

export function assertStructuredObservation(value: unknown): asserts value is BrowserStructuredObservation {
  assertObservationShape(value);
  if ([...value.controls, ...value.links].some((entry) =>
    isSensitiveBrowserField(entry) && entry.value !== null) ||
    redactBrowserUrl(value.url) !== value.url ||
    [...value.controls, ...value.links].some((entry) => entry.href !== null && redactBrowserUrl(entry.href, value.url) !== entry.href) ||
    value.forms.some((form) => form.action !== null && redactBrowserUrl(form.action, value.url) !== form.action)) {
    throw new BrowserPlannerError({ category: "observation_failed",
      message: "Browser observation contains unredacted sensitive metadata.", retryable: false, details: {} });
  }
}

export async function observeStructuredPage(
  page: Page,
): Promise<BrowserStructuredObservation> {
  const identityRegistry = await elementIdentityRegistry(page).catch(() => {
    throw new BrowserPlannerError({ category: "observation_failed", message: "Browser element identity could not be established.", retryable: true, details: {} });
  });
  const raw = await page.evaluate(({ stableIdAttribute, sensitivePattern, identityRegistry }) => {
    const sensitiveHint = (value: string | null | undefined) => {
      const pattern = new RegExp(sensitivePattern, "i");
      const normalized = (value ?? "").normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, " ");
      return pattern.test(normalized) || pattern.test(normalized.replace(/([a-z])([A-Z])/g, "$1 $2"));
    };
    const safeUrl = (value: string | null) => {
      if (!value) return null;
      try {
        const url = new URL(value, location.href);
        if (!["http:", "https:", "about:"].includes(url.protocol) ||
            (url.protocol === "about:" && url.href !== "about:blank")) return null;
        url.username = ""; url.password = ""; url.search = ""; url.hash = "";
        return url.href;
      } catch { return null; }
    };
    const sensitiveUrl = (value: string) => {
      try {
        const url = new URL(value, location.href);
        if (url.username || url.password) return true;
        if (url.search && /(?:login|sign.?in|sign.?up|oauth|auth|account|verif|recover|reset|payment|billing|identity)/i.test(url.pathname)) return true;
        for (const [key, entry] of url.searchParams) {
          if (sensitiveHint(key) || sensitiveHint(entry) || !/^(?:q|query|search|page|sort|order|filter|category|ref|utm_[a-z]+)$/i.test(key)) return true;
        }
        return !!url.hash && (sensitiveHint(decodeURIComponent(url.hash)) || /[=&]/.test(url.hash) || url.hash.length > 32);
      } catch { return true; }
    };
    const isSensitive = (element: Element) => {
      const input = element as HTMLInputElement;
      const labels = "labels" in input ? Array.from(input.labels ?? []).map((label) => label.textContent ?? "").join(" ") : "";
      const referencedLabels = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
      return (input instanceof HTMLInputElement && input.type === "password") ||
        ["type", "name", "id", "autocomplete", "aria-label", "placeholder"]
          .some((name) => sensitiveHint(element.getAttribute(name))) ||
        sensitiveHint(labels) || sensitiveHint(referencedLabels) || sensitiveHint(element.textContent);
    };
    // Do not send hidden input values, textarea contents, title echoes or recovery-code text
    // across the browser boundary. Arbitrary secure-page text cannot be safely classified by value.
    const redactContent = Array.from(document.querySelectorAll("input,textarea,select,[contenteditable],[role='textbox']"))
      .some(isSensitive) || sensitiveHint(document.title) || sensitiveHint(document.body?.innerText) ||
      sensitiveUrl(location.href) ||
      Array.from(document.querySelectorAll("a[href],form[action]")).some((element) => {
        const raw = element instanceof HTMLAnchorElement ? element.href : (element as HTMLFormElement).action;
        return sensitiveUrl(raw);
      });
    const withheldText = "Sensitive account content withheld; owner-only secure entry required.";
    const interactiveSelector = [
      "a[href]",
      "button",
      "input",
      "select",
      "textarea",
      "[contenteditable='true']",
      "[role='textbox']",
      "[role='button']",
      "[role='link']",
      "[role='checkbox']",
      "[role='radio']",
    ].join(",");

    const fnv = (value: string) => {
      let hash = 0x811c9dc5;
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
      }
      return (hash >>> 0).toString(36).padStart(7, "0").slice(0, 7);
    };

    const ensureStableId = (element: Element) => {
      // Ignore page-supplied attributes. Node identity persists even for identically
      // labelled controls, and new documents get a new unguessable namespace.
      let id = identityRegistry.ids.get(element);
      if (!id) {
        id = `el_${identityRegistry.prefix}_${++identityRegistry.sequence}`;
        identityRegistry.ids.set(element, id);
      }
      element.setAttribute(stableIdAttribute, id);
      return id;
    };

    const visible = (element: Element) => {
      const html = element as HTMLElement;
      const style = getComputedStyle(html);
      const rect = html.getBoundingClientRect();
      return (
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };

    const elementKind = (element: Element) => {
      const tag = element.tagName.toLowerCase();
      const role = element.getAttribute("role");
      const type = element.getAttribute("type")?.toLowerCase() ?? "";
      if (tag === "a" || role === "link") return "link";
      if (tag === "select") return "select";
      if (tag === "textarea") return "textarea";
      if (type === "checkbox" || role === "checkbox") return "checkbox";
      if (type === "radio" || role === "radio") return "radio";
      if (tag === "button" || role === "button" || type === "submit") {
        return "button";
      }
      return "input";
    };

    const toObserved = (element: Element) => {
      const input = element as HTMLInputElement;
      const option = element as HTMLOptionElement;
      const href =
        element instanceof HTMLAnchorElement ? element.href : null;
      const text = (
        element.getAttribute("aria-label") ??
        element.textContent ??
        input.value ??
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 240);

      const sensitive = isSensitive(element);
      return {
        id: ensureStableId(element),
        kind: elementKind(element),
        tag: element.tagName.toLowerCase(),
        role: redactContent ? null : element.getAttribute("role"),
        type: sensitive ? "password" : redactContent ? null : element.getAttribute("type"),
        text: redactContent ? (sensitive ? "Owner-only secure entry" : elementKind(element)) : text,
        ...(sensitive ? { sensitive: true } : {}),
        value:
          !redactContent && (input instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement)
            ? input instanceof HTMLInputElement && input.type === "password"
              ? null
              : String(
                  (
                    element as
                      | HTMLInputElement
                      | HTMLTextAreaElement
                      | HTMLSelectElement
                  ).value ?? "",
                ).slice(0, 240)
            : null,
        name: redactContent ? null : element.getAttribute("name"),
        placeholder: redactContent ? null : element.getAttribute("placeholder"),
        href: safeUrl(href),
        disabled:
          "disabled" in input ? Boolean(input.disabled) : false,
        checked:
          input instanceof HTMLInputElement &&
          ["checkbox", "radio"].includes(input.type)
            ? input.checked
            : null,
        selected:
          option instanceof HTMLOptionElement ? option.selected : null,
      };
    };

    const interactive = Array.from(
      document.querySelectorAll(interactiveSelector),
    ).filter(visible);
    const observed = interactive.map(toObserved);
    const byElement = new Map(
      interactive.map((element, index) => [element, observed[index]]),
    );

    const forms = Array.from(document.forms).map((form, index) => {
      const id =
        `form_${fnv(`${location.pathname}:form:${index + 1}`)}`;
      form.setAttribute(stableIdAttribute, id);
      return {
        id,
        action: safeUrl(form.action),
        method: (form.method || "get").toLowerCase(),
        sensitive: Array.from(form.querySelectorAll("input,textarea,select,[contenteditable],[role='textbox']")).some(isSensitive),
        elementIds: Array.from(form.querySelectorAll(interactiveSelector))
          .map((element) => byElement.get(element)?.id)
          .filter((elementId): elementId is string => Boolean(elementId)),
      };
    });

    return {
      url: safeUrl(location.href) ?? "about:blank",
      title: redactContent ? withheldText : document.title,
      privacyRedacted: redactContent,
      visibleText: redactContent ? withheldText : (document.body?.innerText ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 8_000),
      forms,
      controls: observed.filter((entry) => entry.kind !== "link"),
      links: observed.filter((entry) => entry.kind === "link"),
    };
  }, { stableIdAttribute: STABLE_ID_ATTRIBUTE, sensitivePattern: SENSITIVE_FIELD_PATTERN.source, identityRegistry }).catch(() => {
    throw new BrowserPlannerError({ category: "observation_failed",
      message: "Browser observation failed; provider details were withheld.", retryable: true, details: {} });
  });

  const observation = sanitizeStructuredObservation({
    ...(raw as RawObservation),
    observedAt: new Date().toISOString(),
  });
  assertStructuredObservation(observation);
  return observation;
}

export function observationElementIds(
  observation: BrowserStructuredObservation,
) {
  return new Set(
    [...observation.controls, ...observation.links].map((element) => element.id),
  );
}

export function observationElement(
  observation: BrowserStructuredObservation,
  elementId: string,
) {
  return [...observation.controls, ...observation.links].find(
    (element) => element.id === elementId,
  );
}
