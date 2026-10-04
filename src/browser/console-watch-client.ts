/** Browser-only defensive decoding. Admission and revocation belong to the trusted
 * server; this parser never turns metadata, URLs or saved lifecycle into a grant. */
export const CONSOLE_WATCH_MAX_BASE64 = 200 * 1024;
export const CONSOLE_WATCH_MAX_LINE = CONSOLE_WATCH_MAX_BASE64 + 1024;
export const CONSOLE_WATCH_FRAME_MAX_AGE_MS = 5_000;
export const CONSOLE_WATCH_STATUSES = ["starting", "watching", "revocation_pending", "revoked", "ended", "expired", "unavailable"] as const;
export type ConsoleWatchStatus = typeof CONSOLE_WATCH_STATUSES[number];
export type ConsoleWatchFrame = { type: "frame"; epoch: number; sequence: number; capturedAt: string; mime: "image/jpeg"; data: string };
export type ConsoleWatchPacket = ConsoleWatchFrame | { type: "status"; status: ConsoleWatchStatus };
export type ConsoleWatchCursor = { epoch: number; sequence: number; capturedAt: number };
export const consoleWatchCursor = (): ConsoleWatchCursor => ({ epoch: 0, sequence: 0, capturedAt: 0 });
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export function parseConsoleWatchPacket(line: string, cursor: ConsoleWatchCursor, now = Date.now()): ConsoleWatchPacket {
  if (!line.length || line.length > CONSOLE_WATCH_MAX_LINE) throw new Error("invalid_watch_packet");
  const packet: unknown = JSON.parse(line);
  if (!record(packet)) throw new Error("invalid_watch_packet");
  if (packet.type === "status" && Object.keys(packet).every(key => ["type", "status", "reason"].includes(key)) &&
      typeof packet.status === "string" && (CONSOLE_WATCH_STATUSES as readonly string[]).includes(packet.status) &&
      (packet.reason === undefined || (typeof packet.reason === "string" && /^[a-z_]{1,80}$/.test(packet.reason)))) {
    // Reason strings are never displayed: only this fixed client status vocabulary.
    return { type: "status", status: packet.status as ConsoleWatchStatus };
  }
  if (packet.type !== "frame" || Object.keys(packet).sort().join(",") !== "capturedAt,data,epoch,mime,sequence,type" ||
      !Number.isSafeInteger(packet.epoch) || Number(packet.epoch) <= 0 || !Number.isSafeInteger(packet.sequence) || Number(packet.sequence) <= 0 ||
      packet.mime !== "image/jpeg" || typeof packet.data !== "string" || packet.data.length > CONSOLE_WATCH_MAX_BASE64 ||
      !/^\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(packet.data) || packet.data.length % 4 !== 0 ||
      typeof packet.capturedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(packet.capturedAt)) throw new Error("invalid_watch_frame");
  const capturedAt = Date.parse(packet.capturedAt), epoch = Number(packet.epoch), sequence = Number(packet.sequence);
  if (!Number.isFinite(capturedAt) || new Date(capturedAt).toISOString() !== packet.capturedAt || now - capturedAt > CONSOLE_WATCH_FRAME_MAX_AGE_MS || capturedAt - now > 1_000 ||
      epoch < cursor.epoch || (epoch === cursor.epoch && sequence <= cursor.sequence) || capturedAt < cursor.capturedAt) throw new Error("stale_watch_frame");
  Object.assign(cursor, { epoch, sequence, capturedAt });
  return packet as ConsoleWatchFrame;
}

/** One response only: no reconnect, polling, arbitrary endpoints or retained frames. */
export async function consumeConsoleWatchStream(response: Response, input: {
  signal: AbortSignal;
  onFrame: (frame: ConsoleWatchFrame) => Promise<void>;
  onStatus: (status: ConsoleWatchStatus) => void;
  now?: () => number;
}): Promise<"terminal" | "disconnected"> {
  if (response.status !== 200 || response.redirected || response.headers.get("content-type")?.split(";")[0].trim() !== "application/x-ndjson" || !response.body) throw new Error("watch_unavailable");
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }), cursor = consoleWatchCursor();
  let pending = "";
  const aborted = () => { void reader.cancel().catch(() => undefined); };
  input.signal.addEventListener("abort", aborted, { once: true });
  try {
    for (;;) {
      if (input.signal.aborted) return "disconnected";
      const chunk = await reader.read();
      if (input.signal.aborted) return "disconnected";
      if (chunk.done) {
        pending += decoder.decode();
        // A truncated packet is never treated as a successful terminal event.
        if (pending.trim()) throw new Error("truncated_watch_packet");
        return "disconnected";
      }
      pending += decoder.decode(chunk.value, { stream: true });
      let end: number;
      while ((end = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        const packet = parseConsoleWatchPacket(line, cursor, input.now?.() ?? Date.now());
        if (input.signal.aborted) return "disconnected";
        if (packet.type === "frame") await input.onFrame(packet);
        else {
          input.onStatus(packet.status);
          if (!["starting", "watching"].includes(packet.status)) return "terminal";
        }
        if (input.signal.aborted) return "disconnected";
      }
      if (pending.length > CONSOLE_WATCH_MAX_LINE) throw new Error("oversized_watch_packet");
    }
  } finally {
    input.signal.removeEventListener("abort", aborted);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
