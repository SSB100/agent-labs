import type { BrowserStructuredObservation } from "./types";

function baseObservation(
  url: string,
  title: string,
): Omit<BrowserStructuredObservation, "controls" | "links" | "forms"> {
  return {
    url,
    title,
    visibleText: title,
    observedAt: "2026-09-30T00:00:00.000Z",
  };
}

export const SYNTHETIC_LOGIN_OBSERVATION: BrowserStructuredObservation = {
  ...baseObservation("https://fixture.agentlabs.test/login", "Synthetic login"),
  visibleText: "Email Password Sign in",
  controls: [
    {
      id: "el_email01",
      kind: "input",
      tag: "input",
      role: null,
      type: "email",
      text: "",
      name: "email",
      placeholder: "Email",
      href: null,
      disabled: false,
      checked: null,
      selected: null,
    },
    {
      id: "el_pass001",
      kind: "input",
      tag: "input",
      role: null,
      type: "password",
      text: "",
      name: "password",
      placeholder: "Password",
      href: null,
      disabled: false,
      checked: null,
      selected: null,
    },
    {
      id: "el_sign001",
      kind: "button",
      tag: "button",
      role: null,
      type: "submit",
      text: "Sign in",
      name: null,
      placeholder: null,
      href: null,
      disabled: false,
      checked: null,
      selected: null,
    },
  ],
  links: [],
  forms: [
    {
      id: "form_login",
      action: "https://fixture.agentlabs.test/login",
      method: "post",
      elementIds: ["el_email01", "el_pass001", "el_sign001"],
    },
  ],
};

export const MOCK_COMMERCE_OBSERVATION: BrowserStructuredObservation = {
  ...baseObservation(
    "https://commerce.agentlabs.test/products/42",
    "Draft product",
  ),
  visibleText: "Draft product Title Save draft Publish",
  controls: [
    {
      id: "el_title01",
      kind: "input",
      tag: "input",
      role: null,
      type: "text",
      text: "",
      name: "title",
      placeholder: "Product title",
      href: null,
      disabled: false,
      checked: null,
      selected: null,
    },
    {
      id: "el_save001",
      kind: "button",
      tag: "button",
      role: null,
      type: "button",
      text: "Save draft",
      name: null,
      placeholder: null,
      href: null,
      disabled: false,
      checked: null,
      selected: null,
    },
    {
      id: "el_pub0001",
      kind: "button",
      tag: "button",
      role: null,
      type: "button",
      text: "Publish",
      name: null,
      placeholder: null,
      href: null,
      disabled: false,
      checked: null,
      selected: null,
    },
  ],
  links: [],
  forms: [],
};

export const READ_ONLY_SITE_OBSERVATION: BrowserStructuredObservation = {
  ...baseObservation("https://example.com/", "Example Domain"),
  visibleText:
    "Example Domain This domain is for use in illustrative examples in documents.",
  controls: [],
  links: [
    {
      id: "el_more001",
      kind: "link",
      tag: "a",
      role: null,
      type: null,
      text: "More information",
      name: null,
      placeholder: null,
      href: "https://iana.org/domains/example",
      disabled: false,
      checked: null,
      selected: null,
    },
  ],
  forms: [],
};
