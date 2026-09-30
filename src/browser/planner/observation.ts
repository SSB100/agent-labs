import type { Page } from "playwright-core";

import type {
  BrowserObservedElement,
  BrowserObservedForm,
  BrowserStructuredObservation,
} from "./types";
import { BrowserPlannerError } from "./types";

const STABLE_ID_ATTRIBUTE = "data-agent-labs-element-id";
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
    ELEMENT_ID_PATTERN.test(elementId) &&
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
    !(value.type === "password" && value.value !== null)
  );
}

function observedForm(value: unknown): value is BrowserObservedForm {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    ELEMENT_ID_PATTERN.test(value.id) &&
    nullableString(value.action) &&
    typeof value.method === "string" &&
    Array.isArray(value.elementIds) &&
    value.elementIds.every(
      (elementId) =>
        typeof elementId === "string" && ELEMENT_ID_PATTERN.test(elementId),
    )
  );
}

export function assertStructuredObservation(
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
      details: { url: url.slice(0, 300) },
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
      details: { elementId: unknownFormId },
    });
  }
}

export async function observeStructuredPage(
  page: Page,
): Promise<BrowserStructuredObservation> {
  const raw = await page.evaluate((stableIdAttribute) => {
    const interactiveSelector = [
      "a[href]",
      "button",
      "input",
      "select",
      "textarea",
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

    const domPath = (element: Element) => {
      const parts: string[] = [];
      let current: Element | null = element;
      while (current && current !== document.documentElement) {
        const parent: Element | null = current.parentElement;
        const index = parent
          ? Array.from(parent.children).indexOf(current) + 1
          : 1;
        parts.push(
          `${current.tagName.toLowerCase()}:${index}:${current.getAttribute("name") ?? ""}:${current.getAttribute("type") ?? ""}`,
        );
        current = parent;
      }
      return parts.reverse().join("/");
    };

    const ensureStableId = (element: Element) => {
      const existing = element.getAttribute(stableIdAttribute);
      if (existing) return existing;
      const id = `el_${fnv(domPath(element))}`;
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

      return {
        id: ensureStableId(element),
        kind: elementKind(element),
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role"),
        type: element.getAttribute("type"),
        text,
        value:
          input instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
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
        name: element.getAttribute("name"),
        placeholder: element.getAttribute("placeholder"),
        href,
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
        form.getAttribute(stableIdAttribute) ??
        `form_${fnv(`${location.pathname}:form:${index + 1}`)}`;
      form.setAttribute(stableIdAttribute, id);
      return {
        id,
        action: form.action || null,
        method: (form.method || "get").toLowerCase(),
        elementIds: Array.from(form.querySelectorAll(interactiveSelector))
          .map((element) => byElement.get(element)?.id)
          .filter((elementId): elementId is string => Boolean(elementId)),
      };
    });

    return {
      url: location.href,
      title: document.title,
      visibleText: (document.body?.innerText ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 8_000),
      forms,
      controls: observed.filter((entry) => entry.kind !== "link"),
      links: observed.filter((entry) => entry.kind === "link"),
    };
  }, STABLE_ID_ATTRIBUTE);

  const observation = {
    ...(raw as RawObservation),
    observedAt: new Date().toISOString(),
  };
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
