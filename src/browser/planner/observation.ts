import type { Page } from "playwright-core";

import type {
  BrowserObservedElement,
  BrowserObservedForm,
  BrowserStructuredObservation,
} from "./types";

const STABLE_ID_ATTRIBUTE = "data-agent-labs-element-id";

type RawObservation = {
  url: string;
  title: string;
  visibleText: string;
  forms: BrowserObservedForm[];
  controls: BrowserObservedElement[];
  links: BrowserObservedElement[];
};

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

    const forms = Array.from(document.forms).map((form, index) => ({
      id:
        form.getAttribute(stableIdAttribute) ??
        `form_${fnv(`${location.pathname}:form:${index + 1}`)}`,
      action: form.action || null,
      method: (form.method || "get").toLowerCase(),
      elementIds: Array.from(form.querySelectorAll(interactiveSelector))
        .map((element) => byElement.get(element)?.id)
        .filter((id): id is string => Boolean(id)),
    }));

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

  return {
    ...(raw as RawObservation),
    observedAt: new Date().toISOString(),
  };
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
