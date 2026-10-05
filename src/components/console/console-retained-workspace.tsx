"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import "./console-retained-workspace.css";

export type RetainedPanel = { id: string; label: string; content: ReactNode };

/** Presentation over existing owned reads. Every destination is a real Next Link. */
export function ConsoleRetainedWorkspace({ ownerId, header, panels, initialPanel, notice, secure = false }: {
  ownerId: string; header: ReactNode; panels: RetainedPanel[]; initialPanel?: string; notice?: ReactNode; secure?: boolean;
}) {
  const pathname = usePathname(), query = useSearchParams(), root = useRef<HTMLDivElement>(null);
  const requested = query.get("panel"), selected = panels.find(panel => panel.id === requested)?.id ?? initialPanel ?? panels[0]?.id;
  const position = ["toolPage","candidateView","candidate","stage","task","worker","artifact"].map(name=>`${name}:${query.get(name) ?? ""}`).join(":");
  const scope = `${ownerId}:${pathname}:${query.get("business") ?? "owned"}:${query.get("run") ?? query.get("account") ?? ""}:${selected}:${position}`;
  useEffect(() => {
    const node = root.current?.querySelector<HTMLElement>("[data-retained-active=true]");
    if (!node || secure) return;
    const key = `agent-labs:retained:${scope}`;
    const fields = () => [...node.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input[name],textarea[name],select[name]")].filter(field =>
      !field.closest("[data-private],[data-agent-labs-secure]") && !/password|token|secret|consent|approval|authority|revision|nonce|hash|idempotency/i.test(field.name) &&
      !(field instanceof HTMLInputElement && ["hidden", "password", "checkbox", "radio", "file", "submit"].includes(field.type)));
    const fieldKey = (field:HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement) => {
      const form=field.closest("form");
      const ids=form ? [...form.querySelectorAll<HTMLInputElement>('input[type=hidden]')].filter(input=>/^(candidateId|experimentId|creativeRunId|installationId|workflowRunId|qualificationRunId|runId|sourceId|businessId|workflowKey|workerDefinitionId|suiteId|caseId|packId)$/.test(input.name)).map(input=>`${input.name}:${input.value}`).join(":") : "";
      return `${ids || `form:${[...node.querySelectorAll("form")].indexOf(form!)}`}:${field.name}`;
    };
    const viewers=()=>[...node.querySelectorAll<HTMLDetailsElement>("details")].filter(viewer=>!viewer.closest("[data-private],[data-agent-labs-secure]"));
    const viewerKey=(viewer:HTMLDetailsElement)=>`${viewer.id || viewer.closest("[id]")?.id || "viewer"}:${viewer.querySelector(":scope > summary")?.textContent}`;
    const restore = () => { try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? "null");
      if (saved?.version === 2) {
        for(const viewer of viewers()){const open=saved.viewers?.[viewerKey(viewer)];if(typeof open==="boolean")viewer.open=open;}
        node.scrollTop = saved.scroll ?? 0;
        for (const field of fields()) {
          const value = saved.drafts?.[fieldKey(field)];
          if (typeof value === "string" && value.length <= 50000) {
            const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")?.set;
            setter?.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); field.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      }
    } catch { /* Storage is optional; credential/consent fields are never retained. */ } };
    restore();
    const save = () => {
      const drafts: Record<string, string> = {};
      for (const field of fields()) if (field.value !== (field instanceof HTMLSelectElement ? [...field.options].find(option => option.defaultSelected)?.value ?? field.options[0]?.value : field.defaultValue) && field.value.length <= 50000) drafts[fieldKey(field)] = field.value;
      try { sessionStorage.setItem(key, JSON.stringify({ version: 2, scroll: node.scrollTop, drafts, viewers:Object.fromEntries(viewers().map(viewer=>[viewerKey(viewer),viewer.open])) })); } catch { /* Optional tab-local continuity. */ }
    };
    // React performs its action form reset independently of the redirected RSC commit.
    // Restore nonsecret fields after the native reset; unchecked consent stays unchecked.
    const afterReset = () => queueMicrotask(() => { if(node.isConnected && node.dataset.retainedActive === "true")restore(); });
    node.addEventListener("reset", afterReset, true);
    node.addEventListener("scroll", save, { passive: true }); node.addEventListener("input", save); node.addEventListener("submit", save, true); node.addEventListener("toggle", save, true); window.addEventListener("pagehide", save);
    // Next actions may reset uncontrolled fields before the redirected RSC tree commits.
    // Input/submit listeners save before that reset; cleanup must not replace the draft
    // with reset values. Restore on every committed server panel tree, including errors.
    return () => { node.removeEventListener("reset", afterReset, true); node.removeEventListener("scroll", save); node.removeEventListener("input", save); node.removeEventListener("submit", save, true); node.removeEventListener("toggle", save, true); window.removeEventListener("pagehide", save); };
  }, [scope, secure, panels]);
  const href = (id: string) => { const params = new URLSearchParams(query); params.set("panel", id); params.delete("message"); params.delete("error"); params.delete("toolPage"); return `${pathname}?${params}`; };
  return <div className="consoleRetained" ref={root}>
    <div className="consoleRetainedHeader">{header}{notice}</div>
    {panels.length > 1 ? <nav className="consoleRetainedTabs" aria-label="Tool sections">{panels.map(panel => <Link key={panel.id} href={href(panel.id)} scroll={false} aria-current={selected === panel.id ? "page" : undefined}>{panel.label}</Link>)}</nav> : null}
    {panels.map(panel => <section key={panel.id} hidden={selected !== panel.id} data-retained-active={selected === panel.id} className="consoleRetainedBody" tabIndex={0} aria-label={`${panel.label} details`}>{panel.content}</section>)}
  </div>;
}

/** Render the server page as supplied. Historical navigation belongs to the server contract. */
export function ConsoleRecentRows({ rows: children, label }: { rows: ReactNode[]; label: string }) {
  return <div className="consoleRecentRows"><p className="consoleRecentPager">{label}: {children.length} loaded</p>{children}</div>;
}
