// =============================================================================
// Directory offboarding sync of one application context (audit WP-27: ENT-005 "disabled when removed from the groups ... by a daily job").
//
// runDirectorySync      one run now (the administrator's "Sync now", and the schedule); remembers the last result for the status page
// startDirectorySync    the schedule: first run 15 minutes after start, then every config.directory.syncHours (0 = on demand only).
//                       Timers never keep the process alive. Without a directory (Mode A, or Mode B with local accounts) it does nothing.
// =============================================================================

import type { AppContext } from '../appContext';
import { syncDirectory } from '../core/auth/directory';

export interface SyncResult { at: string; checked: number; offboarded: number; updated: number; failed?: string; by: string | null }

const last = new WeakMap<AppContext, SyncResult>();
const running = new WeakMap<AppContext, Promise<SyncResult>>();

export function lastDirectorySync(ctx: AppContext): SyncResult | null { return last.get(ctx) ?? null; }

/** One sync run; a second request while one runs joins it. Throws when the context has no directory. */
export function runDirectorySync(ctx: AppContext, by: { id: string; username: string } | null = null): Promise<SyncResult> {
  const provider = ctx.authProvider as unknown as { kind: string };
  if (!ctx.config.directory || provider.kind !== 'directory') return Promise.reject(Object.assign(new Error('Directory sign-on is not configured on this server.'), { status: 409 }));
  const busy = running.get(ctx);
  if (busy) return busy;
  const p = (async (): Promise<SyncResult> => {
    try {
      const r = await syncDirectory({ store: ctx.store, access: ctx.repos.access, provider: ctx.authProvider, audit: ctx.audit, by });
      const out: SyncResult = { at: new Date().toISOString(), ...r, by: by ? by.username : null };
      last.set(ctx, out);
      return out;
    } finally { running.delete(ctx); }
  })();
  running.set(ctx, p);
  return p;
}

export function startDirectorySync(ctx: AppContext, firstDelayMs = 15 * 60_000): { stop(): void } {
  const hours = ctx.config.directory?.syncHours ?? 0;
  if (!ctx.config.directory || hours <= 0) return { stop: () => undefined };
  const timers: NodeJS.Timeout[] = [];
  const run = (): void => { void runDirectorySync(ctx).catch((e) => console.error('[directory] sync:', (e as Error).message)); };
  const first = setTimeout(() => { run(); const every = setInterval(run, hours * 3600_000); every.unref(); timers.push(every); }, firstDelayMs);
  first.unref(); timers.push(first);
  return { stop: () => { for (const t of timers) clearTimeout(t); } };
}
