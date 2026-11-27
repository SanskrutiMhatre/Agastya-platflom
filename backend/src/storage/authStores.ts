// =============================================================================
// Session and sign-in-throttle stores (audit WP-10: PLT-031, PLT-023; 03 section 6).
//
// The session service (core/auth/sessions.js) and the sign-in throttle (core/auth/rateLimit.js) were already written against a store
// object; these interfaces name exactly what they use, so a server build can hand them another implementation. Defaults: the AuthStore's
// tables (sessions survive a restart; the per-account throttle too, WP-03). `MemoryLimiterStore` is the in-process alternative, used by
// the contract suite and by a tool that must not write to the database.
// =============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface SessionStore {
  /** Insert a session; with a policy of one session per person, end that person's others. */
  insertSessionDisplacing(args: Record<string, unknown>): { displaced: number };
  /** The session row joined with its account, or null when the token is unknown, expired or revoked. */
  resolveSession(tokenHash: string, nowIso: string): Record<string, unknown> | null;
  revokeSessionById(sessionId: string, reason: string, now: string): unknown;
  sessionEndReason(tokenHash: string, nowIso: string): string | null;
}

export interface LimiterStore {
  /** Attempt times (ms) of the current window for a key; [] when none. */
  throttleGet(key: string): number[];
  /** Replace a key's attempts; an empty list removes the key. */
  throttlePut(key: string, attempts: number[], nowIso: string): void;
  /** Forget keys not touched since `olderThanIso`. */
  throttlePrune(olderThanIso: string): void;
}

export class MemoryLimiterStore implements LimiterStore {
  private readonly rows = new Map<string, { attempts: number[]; updatedAt: string }>();
  throttleGet(key: string): number[] { return [...(this.rows.get(key)?.attempts ?? [])]; }
  throttlePut(key: string, attempts: number[], nowIso: string): void {
    if (!attempts.length) { this.rows.delete(key); return; }
    this.rows.set(key, { attempts: [...attempts], updatedAt: nowIso });
  }
  throttlePrune(olderThanIso: string): void { for (const [k, v] of this.rows) if (v.updatedAt < olderThanIso) this.rows.delete(k); }
}
