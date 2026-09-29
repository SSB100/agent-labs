"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

const ACTIVE_WORKFLOW_SELECTOR = [
  ".workflowStatus.status-needs_owner",
  ".workflowStatus.status-queued",
  ".workflowStatus.status-review",
  ".workflowStatus.status-running",
  ".workflowStatus.status-waiting",
].join(", ");

const REFRESH_INTERVAL_MS = 2_000;

type DashboardTemplateProps = {
  children: ReactNode;
};

function hasActiveWorkflow() {
  return document.querySelector(ACTIVE_WORKFLOW_SELECTOR) !== null;
}

export default function DashboardTemplate({ children }: DashboardTemplateProps) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const refreshIfActive = () => {
      if (document.visibilityState === "visible" && hasActiveWorkflow()) {
        router.refresh();
      }
    };

    const intervalId = window.setInterval(refreshIfActive, REFRESH_INTERVAL_MS);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        refreshIfActive();
      }
    };

    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshIfActive);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshIfActive);
    };
  }, [router]);

  return (
    <>
      {pathname === "/dashboard" ? (
        <Link
          className="compactButton"
          href="/dashboard/worker-proof"
          style={{ bottom: 24, position: "fixed", right: 24, zIndex: 50 }}
        >
          Worker proof
        </Link>
      ) : null}
      {children}
    </>
  );
}
