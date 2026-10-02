"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { newQuestState, questDraftStorageKey, serializeQuestDraft } from "@/lib/core-ui/quest-draft";
import "./console-command.css";

type CommandProps = { ownerId: string; businessId?: string; returnTo: string; unavailable?: boolean };
export function ConsoleCommandBar({ ownerId, businessId, returnTo, unavailable = false }: CommandProps) {
  const router = useRouter();
  const [goal, setGoal] = useState("");
  const [storageWarning, setStorageWarning] = useState(false);
  function openResearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (unavailable) return;
    if (!businessId) { router.push("/dashboard?view=advanced#workspace-setup"); return; }
    if (goal.trim()) {
      try { const state = newQuestState(businessId); state.draft.goal = goal.trim(); window.sessionStorage.setItem(questDraftStorageKey(ownerId), serializeQuestDraft(ownerId, state)); }
      catch { setStorageWarning(true); }
    }
    router.push(`${returnTo}${returnTo.includes("?") ? "&" : "?"}sheet=research`, { scroll: false });
  }
  return <form className="consoleCommand" onSubmit={openResearch}>
    <span className="consoleCommandScope"><span aria-hidden="true">⌘</span>Product research</span>
    <label className="consoleCommandInput"><span className="consoleSrOnly">Research goal</span><input id="console-command-input" value={goal} onChange={event => setGoal(event.target.value)} maxLength={1200} placeholder="What should we research?" disabled={unavailable} /></label>
    <button type="submit" disabled={unavailable}>{businessId ? "Review goal" : "Create workspace"}<span aria-hidden="true">↗</span></button>
    <span className="consoleCommandHint" role={storageWarning ? "status" : undefined}>{storageWarning ? "Draft storage unavailable; enter the goal in the sheet" : "Bounded workflow · approval before spend"}</span>
  </form>;
}

export function ConsoleResearchSheet({ children, returnTo }: { children: ReactNode; returnTo: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const [dismissing, startDismissal] = useTransition();
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (element && !element.open) element.showModal();
    return () => {
      if (element?.open) element.close();
      // Passive cleanup may run after React removes the dialog from the DOM,
      // too late for native close() to restore its previously focused opener.
      if (opener?.isConnected && !document.querySelector("dialog:modal")) opener.focus({ preventScroll: true });
    };
  }, []);
  // Keep the modal barrier until navigation commits and unmounts this sheet.
  // Closing it synchronously exposes the launch controls during a slow route
  // transition; a second launch can then retain this already-closed instance.
  function close() { if (dismissing) return; closeButton.current?.focus({ preventScroll: true }); startDismissal(() => router.push(returnTo, { scroll: false })); }
  return <dialog className="consoleResearchSheet" ref={dialog} aria-labelledby="console-research-title" aria-busy={dismissing} onCancel={event => { event.preventDefault(); close(); }}>
    <header><div><h2 id="console-research-title">Research setup</h2><p>Nothing starts until you review and approve</p></div><button ref={closeButton} type="button" onClick={close} aria-disabled={dismissing} aria-label="Close research setup">{dismissing ? "Closing…" : "Close"} <span aria-hidden="true">×</span></button></header>
    <div className="consoleResearchBody" inert={dismissing}>{children}</div>
  </dialog>;
}
