"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ConsoleBrowserWorkspace } from "@/browser/console-view";
import { CONSOLE_WATCH_FRAME_MAX_AGE_MS, consumeConsoleWatchStream, type ConsoleWatchStatus } from "@/browser/console-watch-client";
import "./console-browser-watch.css";

type Viewer = NonNullable<ConsoleBrowserWorkspace["viewer"]>;
type ViewStatus = ConsoleWatchStatus | "ready" | "disconnected";
const labels: Record<ViewStatus, string> = {
  ready: "Ready for approved qualification", starting: "Starting watch", watching: "Watching · read-only",
  revocation_pending: "Stopping · server confirmation pending", revoked: "Stopped · server confirmed",
  ended: "Watch ended", expired: "Watch expired", unavailable: "Live viewing unavailable for this session",
  disconnected: "Watch disconnected · pixels cleared",
};
const active = (status: ViewStatus) => ["starting", "watching", "revocation_pending"].includes(status);

/** This client receives only an exact metadata descriptor. The same-origin server
 * independently authorizes every frame; these UI checks are not a privacy gate. */
export function ConsoleBrowserWatch({ viewer }: { viewer: Viewer }) {
  const { sessionId, businessId, questId, workflowRunId, expiresAt } = viewer;
  const [status, setStatus] = useState<ViewStatus>(viewer.status === "available" ? "ready" : viewer.status);
  const [frameTime, setFrameTime] = useState<string | null>(null);
  const [issue, setIssue] = useState("");
  const [expanded, setExpanded] = useState(false);
  const panel = useRef<HTMLDialogElement>(null), sizeButton = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null), mounted = useRef(true), started = useRef(false), revoking = useRef(false), generation = useRef(0);
  const expiry = useRef(Date.parse(expiresAt));
  const stream = useRef<AbortController | null>(null), frameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endpoint = `/api/browser/sessions/${encodeURIComponent(sessionId)}/watch`;
  const body = JSON.stringify({ businessId, questId, workflowRunId });

  const clearPixels = useCallback(() => {
    generation.current += 1;
    stream.current?.abort(); stream.current = null;
    if (frameTimer.current) clearTimeout(frameTimer.current);
    frameTimer.current = null;
    if (canvas.current) {
      canvas.current.width = 0; canvas.current.height = 0; canvas.current.hidden = true;
      delete canvas.current.dataset.frameSequence;
      delete canvas.current.dataset.frameEpoch;
    }
    if (mounted.current) setFrameTime(null);
  }, []);

  const revoke = useCallback(async () => {
    clearPixels();
    if (revoking.current) return;
    revoking.current = true;
    if (mounted.current) setStatus("revocation_pending");
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`${endpoint}/revoke`, { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", keepalive: true,
        headers: { "Content-Type": "application/json" }, body, signal: controller.signal });
      const result: unknown = await response.json();
      const acknowledged = response.ok && result !== null && typeof result === "object" && "status" in result && result.status === "revoked";
      if (mounted.current) {
        setStatus(acknowledged ? "revoked" : "revocation_pending");
        if (!acknowledged) setIssue("Pixels are cleared. Server stop is not yet confirmed.");
      }
    } catch {
      if (mounted.current) setIssue("Pixels are cleared. Server stop is not yet confirmed.");
    } finally { clearTimeout(timeout); }
  }, [body, clearPixels, endpoint]);

  useEffect(() => {
    mounted.current = true;
    const hidden = () => {
      if (document.visibilityState === "hidden" && started.current) void revoke();
    };
    document.addEventListener("visibilitychange", hidden);
    const pagehide = () => { if (started.current) void revoke(); };
    window.addEventListener("pagehide", pagehide);
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", pagehide);
      clearPixels();
      if (started.current) void revoke();
    };
  }, [clearPixels, revoke]);

  useEffect(() => {
    const updated = Date.parse(expiresAt);
    // Refresh may narrow a grant after claim; it must neither recreate the
    // stream nor silently extend this mount's original maximum lifetime.
    expiry.current = Number.isFinite(updated) && Number.isFinite(expiry.current) ? Math.min(expiry.current, updated) : 0;
    const timer = setTimeout(() => {
      clearPixels(); setStatus("expired");
      if (started.current) void revoke();
    }, Math.max(0, Math.min(expiry.current - Date.now(), 2_147_483_647)));
    return () => clearTimeout(timer);
  }, [clearPixels, expiresAt, revoke]);

  function resize(enlarge: boolean) {
    const element = panel.current;
    if (!element || enlarge === expanded) return;
    // Promote the same open nonmodal panel to the browser top layer. Neither
    // its canvas nor its stream is replaced when changing presentation size.
    element.close();
    if (enlarge) element.showModal(); else element.show();
    setExpanded(enlarge);
    sizeButton.current?.focus({ preventScroll: true });
  }

  async function start() {
    if (started.current || status !== "ready" || document.visibilityState === "hidden" || !Number.isFinite(expiry.current) || expiry.current <= Date.now()) return;
    started.current = true; setStatus("starting"); setIssue("");
    const controller = new AbortController(); stream.current = controller;
    const current = generation.current;
    const stillCurrent = () => mounted.current && !controller.signal.aborted && current === generation.current;
    const fail = (message: string) => {
      if (!stillCurrent()) return;
      clearPixels(); setStatus("disconnected"); setIssue(message); void revoke();
    };
    // A stalled producer cannot leave either a stale image or an eternal start UI.
    frameTimer.current = setTimeout(() => fail("No verified frame arrived before the start deadline. Pixels are cleared."), 45_000);
    try {
      const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" }, body, signal: controller.signal });
      const outcome = await consumeConsoleWatchStream(response, {
        signal: controller.signal,
        async onFrame(frame) {
          if (!stillCurrent()) return;
          const bytes = Uint8Array.from(atob(frame.data), character => character.charCodeAt(0));
          const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
          try {
            if (!stillCurrent()) return;
            if (!bitmap.width || !bitmap.height || bitmap.width > 1920 || bitmap.height > 1080 || Date.now() - Date.parse(frame.capturedAt) > CONSOLE_WATCH_FRAME_MAX_AGE_MS) throw new Error("invalid_watch_image");
            const target = canvas.current, context = target?.getContext("2d", { alpha: false });
            if (!target || !context) throw new Error("canvas_unavailable");
            target.width = bitmap.width; target.height = bitmap.height;
            context.drawImage(bitmap, 0, 0); target.hidden = false;
            target.dataset.frameEpoch = String(frame.epoch); target.dataset.frameSequence = String(frame.sequence);
            setFrameTime(frame.capturedAt); setStatus("watching");
            if (frameTimer.current) clearTimeout(frameTimer.current);
            frameTimer.current = setTimeout(() => fail("The last frame became stale. Pixels are cleared."), Math.max(0, Date.parse(frame.capturedAt) + CONSOLE_WATCH_FRAME_MAX_AGE_MS - Date.now()));
          } finally { bitmap.close(); }
        },
        onStatus(next) {
          if (!stillCurrent()) return;
          if (["starting", "watching"].includes(next)) {
            // Do not claim that pixels are visible until a frame was decoded.
            if (next === "starting") setStatus("starting");
          } else { clearPixels(); setStatus(next); }
        },
      });
      if (outcome === "disconnected") fail("The stream disconnected. Pixels are cleared.");
    } catch {
      fail("The frame stream could not be verified. Pixels are cleared.");
    }
  }

  return <dialog ref={panel} open className="consoleBrowserWatch" aria-label="Controlled public qualification viewer" aria-modal={expanded ? true : undefined} data-watch-status={status} data-watch-expires-at={expiresAt} data-expanded={expanded} onCancel={event => { event.preventDefault(); resize(false); }}>
    <h2 className="consoleBrowserWatchTitle" hidden={!expanded}>Controlled public qualification</h2>
    <div className="consoleBrowserWatchControls">
      <p role="status" aria-live="polite">{labels[status]}</p>
      <div className="consoleBrowserWatchActions"><button ref={sizeButton} type="button" onClick={() => resize(!expanded)} aria-label={expanded ? "Compact viewer" : "Enlarge viewer"}>{expanded ? "Compact" : "Enlarge"}</button>
      {status === "ready" ? <button type="button" onClick={() => void start()}>Watch</button>
        : active(status) && status !== "revocation_pending" ? <button type="button" onClick={() => { started.current = true; void revoke(); }}>Stop watching</button> : null}</div>
    </div>
    <div className="consoleBrowserWatchStage">
      <canvas ref={canvas} width={0} height={0} hidden={!frameTime} role="img" aria-label={frameTime ? `Read-only public qualification frame captured ${frameTime}` : "No frame displayed"}/>
      {!frameTime ? <p>{issue || (status === "ready" ? "Watch starts the separately approved, bounded public qualification session. One watch only." : "No browser pixels are displayed.")}</p> : null}
    </div>
    <p className="consoleBrowserWatchCaption">{frameTime ? <>Captured <time dateTime={frameTime}>{frameTime.replace("T", " ").replace(".000Z", " UTC")}</time></> : "No input, clipboard or upload controls"}</p>
  </dialog>;
}
