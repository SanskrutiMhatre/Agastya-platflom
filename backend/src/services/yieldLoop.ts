// Stop-gap for audit PERF-001 (WP-32): long per-module loops on the request thread give the event loop a turn every `budgetMs` (25 ms), so a
// validation of hundreds of modules no longer freezes the server for everyone (health checks, sign-ins, other authors' saves). The work
// itself is not faster; moving it off the request thread is the job service (WP-14).

import { performance } from 'perf_hooks';

/** A function to await inside a loop: it returns at once while the budget lasts, and yields to the event loop when it is spent. */
export function yielder(budgetMs = 25): () => Promise<void> {
  let last = performance.now();
  return async () => {
    if (performance.now() - last < budgetMs) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
    last = performance.now();
  };
}
