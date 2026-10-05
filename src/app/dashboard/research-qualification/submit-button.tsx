"use client";

import { useFormStatus } from "react-dom";

export function ResearchSubmitButton({ children, pendingLabel, disabled = false }: {
  children: string; pendingLabel: string; disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return <button type="submit" className="coreButton" disabled={disabled || pending} aria-disabled={disabled || pending}>
    {pending ? pendingLabel : children}
  </button>;
}
