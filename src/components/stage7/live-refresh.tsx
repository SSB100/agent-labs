"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

const LIVE_TABLES = [
  "artifacts",
  "businesses",
  "events",
  "owner_interventions",
  "task_contracts",
  "worker_runs",
  "workflow_runs",
  "workflow_stage_runs",
] as const;

type LiveRefreshProps = {
  workflowRunId?: string;
};

type LiveState = "connecting" | "live" | "offline";

export function LiveRefresh({ workflowRunId }: LiveRefreshProps) {
  const router = useRouter();
  const [state, setState] = useState<LiveState>("connecting");
  const refreshTimer = useRef<number | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(
      `agent-labs-ui:${workflowRunId ?? "owner"}:${crypto.randomUUID()}`,
    );

    const scheduleRefresh = () => {
      if (document.visibilityState !== "visible") return;
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => {
        refreshTimer.current = null;
        router.refresh();
      }, 180);
    };

    for (const table of LIVE_TABLES) {
      const filter = workflowRunId
        ? table === "workflow_runs"
          ? `id=eq.${workflowRunId}`
          : table === "businesses"
            ? undefined
            : `workflow_run_id=eq.${workflowRunId}`
        : undefined;

      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          ...(filter ? { filter } : {}),
        },
        scheduleRefresh,
      );
    }

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") setState("live");
      if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        setState("offline");
      }
    });

    const fallbackId = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 30_000);
    const refreshOnFocus = () => router.refresh();
    window.addEventListener("focus", refreshOnFocus);

    return () => {
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
      window.clearInterval(fallbackId);
      window.removeEventListener("focus", refreshOnFocus);
      void supabase.removeChannel(channel);
    };
  }, [router, workflowRunId]);

  return (
    <span className={`liveConnection liveConnection-${state}`} title="Supabase live activity">
      <span aria-hidden="true" />
      {state === "live" ? "Live" : state === "connecting" ? "Connecting" : "Refresh fallback"}
    </span>
  );
}
