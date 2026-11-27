// A small keyed request layer for GETs (audit WP-18: FE-020, FE-029). No dependency.
//
//  * De-duplication: identical GETs that are in flight at the same time share one request and one answer (the editor's list and the Studio
//    both ask for /dms after a save: one request goes out).
//  * A short reuse window: an answer is reused for `ttl` ms (default REUSE_MS, a few hundred ms, so that one render pass that asks twice asks
//    once). A caller can ask for longer (the identity and badge refresh on navigation) or for none (`fresh`, a timer that must reach the server).
//  * Invalidation: every write (any method but GET/HEAD) through the client drops every entry and every request in flight, so nothing read
//    before a change is served after it; `invalidate(prefix)` does the same by hand (an upload that goes through XMLHttpRequest).
//  * Cancellation: a caller passes an AbortSignal; the shared request is aborted only when every caller that waits on it has gone.
export const REUSE_MS = 300;

interface Entry { at: number; value: unknown }
interface Flight { promise: Promise<unknown>; ctrl: AbortController; waiting: number; generation: number }

const done = new Map<string, Entry>();
const flying = new Map<string, Flight>();
let generation = 0;
let sent = 0;

/** Requests the layer actually sent (tests and the performance probe read it). */
export const requestsSent = (): number => sent;

export function invalidate(prefix?: string): void {
  generation++;
  for (const k of [...done.keys()]) if (!prefix || k.startsWith(prefix)) done.delete(k);
  for (const k of [...flying.keys()]) if (!prefix || k.startsWith(prefix)) flying.delete(k);   // a later caller starts a new request; the old one still answers its own callers
}

export interface QueryOptions { ttl?: number; fresh?: boolean; signal?: AbortSignal }

/**
 * Run `load` for `key` once for everyone who asks at the same time, and reuse its answer for `ttl` ms.
 * `load` receives the signal of the shared request.
 */
export function shared<T>(key: string, load: (signal: AbortSignal) => Promise<T>, opts: QueryOptions = {}): Promise<T> {
  const ttl = opts.fresh ? 0 : opts.ttl ?? REUSE_MS;
  const now = Date.now();
  const hit = done.get(key);
  if (hit && ttl > 0 && now - hit.at < ttl) return Promise.resolve(own(hit.value) as T);
  if (opts.signal?.aborted) return Promise.reject(abortError());

  let f = opts.fresh ? undefined : flying.get(key);
  if (!f) {
    const ctrl = new AbortController();
    const gen = generation;
    sent++;
    const promise = load(ctrl.signal).then((value) => {
      if (gen === generation) done.set(key, { at: Date.now(), value });     // an answer that began before a write is not kept
      return value;
    }).finally(() => { if (flying.get(key)?.promise === promise) flying.delete(key); });
    f = { promise, ctrl, waiting: 0, generation: gen };
    if (!opts.fresh) flying.set(key, f);
  }
  const flight = f;
  flight.waiting++;
  if (!opts.signal) return flight.promise.then(own).finally(() => { flight.waiting--; }) as Promise<T>;
  const signal = opts.signal;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const leave = () => { if (settled) return; settled = true; flight.waiting--; };
    const onAbort = () => {
      leave();
      if (flight.waiting <= 0) { flight.ctrl.abort(); if (flying.get(key) === flight) flying.delete(key); }
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    flight.promise.then(
      (v) => { signal.removeEventListener('abort', onAbort); leave(); resolve(own(v) as T); },
      (e) => { signal.removeEventListener('abort', onAbort); leave(); reject(e); },
    );
  });
}

/** Every caller gets its own copy: a page that sorts or edits what it was given cannot change what another page (or the cache) holds. */
const own = (v: unknown): unknown => (v !== null && typeof v === 'object' ? structuredClone(v) : v);

const abortError = () => new DOMException('Aborted', 'AbortError');

/** For tests. */
export function resetQueries(): void { done.clear(); flying.clear(); generation++; sent = 0; }
