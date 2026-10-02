"use client";

import { unstable_rethrow } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

export function AccountNotice({ message, children }: { message?: string; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (message) { ref.current?.focus({ preventScroll: true }); ref.current?.scrollIntoView({ block: "nearest" }); } }, [message]);
  return <div className="connectionNotice" id="connection-notice" ref={ref} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true">
    {message ? <strong>{message}</strong> : null}{children}
  </div>;
}

/** No field values enter state, notices, logs, storage or error output. */
export function AccountForm({ action, children, className, pendingLabel = "Saving…", returnTo, id }: {
  action: (form: FormData) => void | Promise<void>; children: ReactNode; className?: string;
  pendingLabel?: string; returnTo?: string; id?: string;
}) {
  const lock = useRef(false), formRef = useRef<HTMLFormElement>(null), notice = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false), [issues, setIssues] = useState<string[]>([]), [uncertain, setUncertain] = useState(false);
  function revealNotice() {
    requestAnimationFrame(() => { notice.current?.focus({ preventScroll: true }); notice.current?.scrollIntoView({ block: "nearest" }); });
  }
  function validate(event: FormEvent<HTMLFormElement>) {
    if (lock.current || uncertain) { event.preventDefault(); return; }
    const invalid = Array.from(event.currentTarget.elements).filter((el): el is HTMLInputElement | HTMLSelectElement =>
      (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) && !el.validity.valid);
    if (invalid.length) {
      event.preventDefault();
      setIssues([...new Set(invalid.map(el => el.dataset.fieldLabel ?? el.getAttribute("aria-label") ?? "Required field"))]);
      setUncertain(false);
      revealNotice();
      return;
    }
    lock.current = true; setIssues([]); setUncertain(false); setPending(true); revealNotice();
  }
  async function submit(form: FormData) {
    try { await action(form); }
    catch (error) {
      unstable_rethrow(error);
      // A lost server response may follow a successful commit. Never auto-retry.
      setUncertain(true); setPending(false);
      // Keep the lock until a fresh saved outcome replaces this form.
      revealNotice();
    }
  }
  return <form ref={formRef} id={id} action={submit} onSubmit={validate} noValidate className={className} autoComplete="off" aria-busy={pending}>
    {returnTo ? <input type="hidden" name="returnTo" value={returnTo}/> : null}
    <div className="connectionFormNotice" ref={notice} tabIndex={-1} role={issues.length || uncertain ? "alert" : "status"} aria-live="polite" aria-atomic="true">
      {pending ? <strong>{pendingLabel} Keep this page open; do not submit again.</strong> : issues.length ? <><strong>Check the required fields:</strong><ul>{issues.map(label => <li key={label}>{label}</li>)}</ul></> : uncertain ? <><strong>Verification could not complete. A save may have succeeded.</strong>{returnTo ? <a href={`${returnTo.split("#")[0]}&accountMessage=verification-unavailable#connection-notice`}>Check current saved registry before trying again</a> : <span>Refresh to check the current saved state before trying again.</span>}</> : null}
    </div>
    <fieldset disabled={pending || uncertain} className="connectionFieldset">{children}</fieldset>
  </form>;
}
