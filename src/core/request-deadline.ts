/** Caller cancellation complements database statement limits. A timed-out write
 * remains ambiguous and must be reconciled; this helper never retries it. */
const absoluteDeadlines = new WeakMap<AbortSignal, number>();
export function requestDeadline(milliseconds: number): AbortSignal {
  const signal = AbortSignal.timeout(milliseconds);
  absoluteDeadlines.set(signal, performance.now() + milliseconds);
  return signal;
}
function current(signal: AbortSignal): void {
  signal.throwIfAborted();
  if (performance.now() >= (absoluteDeadlines.get(signal) ?? Infinity)) throw new Error("request_deadline_exceeded");
}
function combine(signals: AbortSignal[]): AbortSignal {
  const signal = AbortSignal.any(signals);
  absoluteDeadlines.set(signal, Math.min(...signals.map(item => absoluteDeadlines.get(item) ?? Infinity)));
  return signal;
}
function currentWork(work: PromiseLike<unknown>, signal: AbortSignal): void {
  try { current(signal); } catch (error) {
    // A native Promise may already be running when synchronous work exhausts
    // the budget. Observe its rejection, including cross-realm Promises, but
    // never subscribe to a lazy query/thenable merely to handle cancellation.
    try { void Promise.prototype.then.call(work, () => undefined, () => undefined); } catch { /* Not a started native Promise. */ }
    throw error;
  }
}
export function awaitRequestDeadline<T>(work: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  currentWork(work, signal);
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(new Error("request_deadline_exceeded"));
    signal.addEventListener("abort", aborted, { once: true });
    Promise.resolve(work).then(value => {
      // Timers cannot preempt synchronous JSON validation. A late successful
      // write is ambiguous, never permission to start the following effect.
      try { current(signal); resolve(value); } catch (error) { reject(error); }
    }, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}

export async function boundedRpc<T>(query: PromiseLike<T> & { abortSignal?(signal: AbortSignal): PromiseLike<T> }, signal: AbortSignal, timeoutMs: number): Promise<T> {
  currentWork(query, signal);
  const bounded = combine([signal, requestDeadline(timeoutMs)]);
  // Supabase/PostgREST builders support abortSignal. Inert test promises can
  // still prove caller ordering via the same bounded wait without network I/O.
  return awaitRequestDeadline(query.abortSignal ? query.abortSignal(bounded) : query, bounded);
}

export function deadlineFetch(signal: AbortSignal, fetcher: typeof fetch = fetch): typeof fetch {
  return (input, init) => {
    current(signal);
    const combined = init?.signal ? combine([signal, init.signal]) : signal;
    current(combined);
    return awaitRequestDeadline(fetcher(input, { ...init, signal: combined }), combined);
  };
}
