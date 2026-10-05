import { WATCH_CLEANUP_BUDGET_MS, type WatchLifetime } from "./contracts";

// The route keeps maxDuration=180s. Stop work at 150s, leaving 15s for bounded
// cleanup and another 15s of hosting headroom, including authentication/setup.
const HOST_WORK_MS = 150_000;
export function createWatchLifetime(register: (completion: Promise<void>) => void): WatchLifetime {
  const controller = new AbortController();
  const workDeadline = performance.now() + HOST_WORK_MS;
  let resolve!: () => void, settled = false;
  const completion = new Promise<void>(done => { resolve = done; });
  const finish = () => {
    if (settled) return;
    settled = true; clearTimeout(workTimer); clearTimeout(finalTimer); resolve();
  };
  const workTimer = setTimeout(() => controller.abort(), HOST_WORK_MS);
  const finalTimer = setTimeout(finish, HOST_WORK_MS + WATCH_CLEANUP_BUDGET_MS);
  // Registration itself happens synchronously, before authentication, claim,
  // stream construction or an abort can start asynchronous resource cleanup.
  try { register(completion); } catch { finish(); throw new Error("viewer_hosting_unavailable"); }
  return { completion, signal: controller.signal, workDeadline, finish };
}

/** Only waits for admission while hosting work is permitted. A late auth result
 * cannot launch a provider after the caller has already failed closed. */
export async function withinWatchLifetime<T>(lifetime: WatchLifetime, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (lifetime.signal.aborted || signal?.aborted) throw new Error("viewer_hosting_unavailable");
  let onAbort!: () => void;
  const expired = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error("viewer_hosting_unavailable"));
    lifetime.signal.addEventListener("abort", onAbort, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([operation(), expired]); }
  finally { lifetime.signal.removeEventListener("abort", onAbort); signal?.removeEventListener("abort", onAbort); }
}
