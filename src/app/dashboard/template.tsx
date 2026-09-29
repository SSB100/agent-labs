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

function DashboardLinks() {
  return (
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
      <Link className="compactButton" href="/dashboard/worker-evaluations">
        Worker evaluations
      </Link>
    </div>
  );
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

  const supportsProofNavigation = [
    "/dashboard",
    "/dashboard/worker-proof",
    "/dashboard/model-router",
    "/dashboard/worker-evaluations",
  ].includes(pathname);

  return (
    <>
      {supportsProofNavigation ? <DashboardLinks /> : null}
      {children}
    </>
  );
}
