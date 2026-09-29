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
        <div
          style={{
            bottom: 24,
            display: "flex",
            gap: 10,
            position: "fixed",
            right: 24,
            zIndex: 50,
          }}
        >
          <Link className="compactButton" href="/dashboard/worker-proof">
            Worker proof
          </Link>
          <Link className="compactButton" href="/dashboard/model-router">
            Model router
          </Link>
        </div>
      ) : null}
      {pathname === "/dashboard/worker-proof" ? (
        <Link
          className="compactButton"
          href="/dashboard/model-router"
          style={{ bottom: 24, position: "fixed", right: 24, zIndex: 50 }}
        >
          Model router
        </Link>
      ) : null}
      {pathname === "/dashboard/model-router" ? (
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
