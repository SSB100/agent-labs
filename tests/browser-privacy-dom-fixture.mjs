// In-process DOM fixture: exercises the exact serialized observation callback without
// opening network sockets. This complements (does not replace) opt-in Chromium tests.
import { runInNewContext } from "node:vm";

export function domFixturePage(specs, options = {}) {
  class FixtureElement {
    constructor(tag, attrs = {}, text = "") {
      this.tagName = tag.toUpperCase(); this.attrs = attrs; this.text = text;
      this.children = []; this.parentElement = null; this.disabled = false;
      this.checked = false; this.selected = false; this.value = attrs.value ?? ""; this.labels = [];
    }
    getAttribute(name) { return this.attrs[name] ?? null; }
    setAttribute(name, value) { this.attrs[name] = value; }
    append(child) { child.parentElement = this; this.children.push(child); }
    get type() { return String(this.attrs.type ?? "text").toLowerCase(); }
    get textContent() { return this.text + this.children.map(c => c.textContent).join(" "); }
    get innerText() { return this.textContent; }
    get href() { return new URL(this.attrs.href, options.url ?? "https://fixture.test/").href; }
    get action() { return this.attrs.action ?? "https://fixture.test/"; }
    get method() { return this.attrs.method ?? "get"; }
    getBoundingClientRect() { return { width: this.type === "hidden" ? 0 : 100, height: 20 }; }
    querySelectorAll(selector) {
      const descendants = this.children.flatMap(c => [c, ...c.querySelectorAll("*")]);
      return descendants.filter(e => selector.split(",").some(s => {
        if (s === "*") return true;
        const match = /^([a-z]*)?(?:\[([^=\]]+)(?:=['"]?([^'"\]]+)['"]?)?\])?$/.exec(s);
        return match && (!match[1] || e.tagName.toLowerCase() === match[1]) &&
          (!match[2] || (match[3] === undefined ? e.getAttribute(match[2]) !== null : e.getAttribute(match[2]) === match[3]));
      }));
    }
  }
  class HTMLInputElement extends FixtureElement {}
  class HTMLTextAreaElement extends FixtureElement {}
  class HTMLSelectElement extends FixtureElement {}
  class HTMLAnchorElement extends FixtureElement {}
  class HTMLOptionElement extends FixtureElement {}
  const constructors = { input: HTMLInputElement, textarea: HTMLTextAreaElement,
    select: HTMLSelectElement, a: HTMLAnchorElement, option: HTMLOptionElement };
  const root = new FixtureElement("html"); const body = new FixtureElement("body"); root.append(body);
  const form = new FixtureElement("form", { action: options.action ?? "https://fixture.test/" }); body.append(form);
  const elements = specs.map(s => new (constructors[s.tag] ?? FixtureElement)(s.tag, s.attrs ?? {}, s.text ?? ""));
  elements.forEach((element, i) => {
    element.labels = (specs[i].labels ?? []).map(text => new FixtureElement("label", {}, text)); form.append(element);
  });
  const document = { documentElement: root, body, forms: [form], title: options.title ?? "Fixture page",
    querySelectorAll: selector => root.querySelectorAll(selector),
    getElementById: id => root.querySelectorAll("*").find(e => e.getAttribute("id") === id) ?? null };
  const evaluate = (fn, argument) => runInNewContext(`(${fn.toString()})(argument)`, { argument, document,
    location: new URL(options.url ?? "https://fixture.test/"), URL,
    HTMLInputElement, HTMLTextAreaElement, HTMLSelectElement, HTMLAnchorElement, HTMLOptionElement,
    getComputedStyle: () => ({ visibility: "visible", display: "block" }) });
  return { elements,
    async evaluateHandle(fn, argument) { const fixtureValue = evaluate(fn, argument); return { fixtureValue, evaluate: async callback => evaluate(callback, fixtureValue), dispose: async () => {} }; },
    async evaluate(fn, argument) {
      if (argument?.identityRegistry?.fixtureValue) argument = {...argument, identityRegistry: argument.identityRegistry.fixtureValue};
      return evaluate(fn, argument);
    }
  };
}
