import type { WatchDiagnostic } from "./contracts";
const phases = new Set(["hosting", "claim", "dispatch", "provider_create", "provider_record", "capture_setup", "attest",
  "capture_permit", "capture", "capture_lease", "delivery_permit", "delivery", "authority_read", "stop", "setup_settle",
  "dispose", "capture_settle", "release", "close", "cleanup"]);
const reasons = new Set(["started", "completed", "failed", "denied", "expired", "aborted", "source_invalidated", "timeout",
  "unconfirmed", "frame_invalid", "frame_limit"]);
/** Reconstruct the exact allowlist even at the logging boundary. No spread,
 * exception/string conversion, identifiers, URLs, or arbitrary extra fields. */
export function watchDiagnosticRecord(event: WatchDiagnostic): WatchDiagnostic | null {
  if (!event || !phases.has(event.phase) || !reasons.has(event.reason)) return null;
  const { durationMs, remainingMs, capturedFrames, deliveredFrames } = event;
  if (![durationMs, remainingMs].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 180_000) ||
      ![capturedFrames, deliveredFrames].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 120) ||
      deliveredFrames > capturedFrames) return null;
  return { phase: event.phase, reason: event.reason, durationMs, remainingMs, capturedFrames, deliveredFrames };
}
