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
  const scope = `${ownerId}:${pathname}:${query.get("business") ?? "owned"}:${query.get("run") ?? query.get("account") ?? ""}:${selected}`;
  useEffect(() => {
    const node = root.current?.querySelector<HTMLElement>("[data-retained-active=true]");
    if (!node || secure) return;
    const key = `agent-labs:retained:${scope}`;
    const fields = () => [...node.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input[name],textarea[name],select[name]")].filter(field =>
      !field.closest("[data-private],[data-agent-labs-secure]") && !/password|token|secret|consent|approval|authority|revision|nonce|hash|idempotency/i.test(field.name) &&
      !(field instanceof HTMLInputElement && ["hidden", "password", "checkbox", "radio", "file", "submit"].includes(field.type)));
    const fieldKey = (field:HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement) => {
      const form=field.closest("form");
      const ids=form ? [...form.querySelectorAll<HTMLInputElement>('input[type=hidden]')].filter(input=>/^(candidateId|experimentId|creativeRunId|installationId|workflowRunId|qualificationRunId|runId|sourceId)$/.test(input.name)).map(input=>`${input.name}:${input.value}`).join(":") : "";
      return `${ids || `form:${[...node.querySelectorAll("form")].indexOf(form!)}`}:${field.name}`;
    };
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? "null");
      if (saved?.version === 2) {
        node.scrollTop = saved.scroll ?? 0;
        for (const field of fields()) {
          const value = saved.drafts?.[fieldKey(field)];
          if (typeof value === "string" && value.length <= 50000) {
            const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")?.set;
            setter?.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); field.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      }
    } catch { /* Storage is optional; credential/consent fields are never retained. */ }
    const save = () => {
      const drafts: Record<string, string> = {};
      for (const field of fields()) if (field.value !== (field instanceof HTMLSelectElement ? [...field.options].find(option => option.defaultSelected)?.value ?? field.options[0]?.value : field.defaultValue) && field.value.length <= 50000) drafts[fieldKey(field)] = field.value;
      try { sessionStorage.setItem(key, JSON.stringify({ version: 2, scroll: node.scrollTop, drafts })); } catch { /* Optional tab-local continuity. */ }
    };
    node.addEventListener("scroll", save, { passive: true }); node.addEventListener("input", save); window.addEventListener("pagehide", save);
    return () => { save(); node.removeEventListener("scroll", save); node.removeEventListener("input", save); window.removeEventListener("pagehide", save); };
  }, [scope, secure]);
  const href = (id: string) => { const params = new URLSearchParams(query); params.set("panel", id); params.delete("message"); params.delete("error"); params.delete("toolPage"); return `${pathname}?${params}`; };
  return <div className="consoleRetained" ref={root}>
    <div className="consoleRetainedHeader">{header}{notice}</div>
    {panels.length > 1 ? <nav className="consoleRetainedTabs" aria-label="Tool sections">{panels.map(panel => <Link key={panel.id} href={href(panel.id)} scroll={false} aria-current={selected === panel.id ? "page" : undefined}>{panel.label}</Link>)}</nav> : null}
    {panels.map(panel => <section key={panel.id} hidden={selected !== panel.id} data-retained-active={selected === panel.id} className="consoleRetainedBody" tabIndex={0} aria-label={`${panel.label} details`}>{panel.content}</section>)}
  </div>;
}

/** Paginates only the explicitly loaded window, never claims server/history completeness. */
export function ConsoleRecentRows({ rows: children, label }: { rows: ReactNode[]; label: string }) {
  const query = useSearchParams(), pathname = usePathname();
  const page = Math.max(1, Math.min(Math.ceil(children.length / 10) || 1, (/^\d{1,4}$/.test(query.get("toolPage") ?? "") ? Number(query.get("toolPage")) : 1)));
  const href = (next: number) => { const params = new URLSearchParams(query); params.set("toolPage", String(next)); return `${pathname}?${params}`; };
  return <div className="consoleRecentRows"><div className="consoleRecentPager"><span>{label}: {children.length} loaded · page {page} of {Math.ceil(children.length / 10) || 1}</span>{page > 1 ? <Link href={href(page - 1)} scroll={false}>Previous loaded rows</Link> : null}{page * 10 < children.length ? <Link href={href(page + 1)} scroll={false}>Next loaded rows</Link> : null}</div>{children.slice((page - 1) * 10, page * 10)}</div>;
}
