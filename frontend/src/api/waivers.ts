// Publish waivers (backend/src/routes/waivers.ts): a recorded decision to build DRAFT copies without a BREX the project does not have.
// An editor or above records and withdraws them; anyone who can see the project reads them. They never apply to a release.
// WP-29 (ENT-017): a waiver may expire; every addition, replacement and removal is kept in the history with its reason.

import { del, get, post } from './client';

export type WaiverKind = 'brex-missing';
export interface Waiver { id: string; kind: WaiverKind; subject: string; reason: string; by: string; at: string; expiresAt?: string; expired?: boolean }
export interface WaiverEvent { id: number; waiverId: string; event: string; kind: string; subject: string; reason: string | null; expiresAt: string | null; by: string | null; at: string }

const P = (id: string) => `/api/projects/${id}/publish-waivers`;

export const waiverApi = {
  list: (id: string) => get<{ waivers: Waiver[]; kinds: WaiverKind[]; note: string; history?: WaiverEvent[] }>(P(id)),
  add: (id: string, b: { kind: WaiverKind; subject: string; reason: string; expiresAt?: string }) => post<{ waiver: Waiver }>(P(id), b).then((r) => r.waiver),
  /** `reason` (optional) is kept in the waiver history and the audit log. */
  remove: (id: string, waiverId: string, reason?: string) =>
    del<{ ok: true }>(`${P(id)}/${encodeURIComponent(waiverId)}${reason && reason.trim() ? `?reason=${encodeURIComponent(reason.trim())}` : ''}`),
};

/** The expiry offered when a waiver is recorded: none (0), or this many days from now (the server allows up to 3 years). */
export const WAIVER_EXPIRY_DAYS = [0, 30, 90, 180] as const;
export const expiryFromDays = (days: number, now = Date.now()): string | undefined => (days > 0 ? new Date(now + days * 86400_000).toISOString() : undefined);
