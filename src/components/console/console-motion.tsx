"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { mountConsoleMotion } from "@/lib/core-ui/console-motion-dom";
import type { ConsoleMotionSnapshot } from "@/lib/core-ui/console-motion";
import "./console-motion.css";

/** Wrap the stable console scope, including its server-rendered children.
 * Mark an existing element with data-console-motion-target and its persisted
 * data-console-motion-id. Only a child data-console-motion-mark may pulse.
 * There are no network calls, timer-driven progress or action handlers here.
 */
export function ConsoleMotionBoundary({ ownerId, scopeKey, snapshot, children }: {
  ownerId: string; scopeKey: string; snapshot: ConsoleMotionSnapshot; children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const controller = useRef<ReturnType<typeof mountConsoleMotion> | null>(null);
  useEffect(() => {
    if (!root.current) return;
    const mounted = mountConsoleMotion(root.current, { identity: JSON.stringify([ownerId, scopeKey]) });
    controller.current = mounted;
    return () => { mounted.dispose(); controller.current = null; };
  }, [ownerId, scopeKey]);
  useEffect(() => { controller.current?.observe(snapshot); }, [snapshot, ownerId, scopeKey, children]);
  return <div ref={root} className="consoleMotionBoundary" data-console-motion-boundary="true">{children}</div>;
}
