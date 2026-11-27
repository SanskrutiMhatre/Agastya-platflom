// WP-28 (PRD-003): who else is working in this project, on what, and which documents are checked out.
//
// A page announces where it is over the shared /ws socket (lib/progress.ts) and repeats it every 25 seconds; the server keeps it in memory
// only and forgets it when the page closes, the session ends or the heartbeat stops. Readers of the project are told when the set of
// people or the check-outs change and ask GET /api/projects/:id/presence again (debounced), or every minute at the latest.

import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from '../api/client';
import { sendPresence, subscribe, type ProgressMsg } from './progress';

export type PresenceKind = 'dm' | 'jss' | 'jsg' | 'page';
export interface PresenceDoc { kind: PresenceKind; path: string; title?: string; part?: string }
export interface Person { userId: string; username: string; name: string; doc: PresenceDoc | null; mode: 'viewing' | 'editing'; since: string; lastSeen: string; mine: boolean }
export interface ProjectLease { part: string; holderId: string; holder: string | null; acquiredAt: string; expiresAt: string; mine: boolean; documentId: string; path: string | null }
export interface Team { people: Person[]; leases: ProjectLease[] }

export const HEARTBEAT_MS = 25_000;
const EMPTY: Team = { people: [], leases: [] };

/** The file name of a path in the project (a data module's path is `csdb/DMC-...XML`; a JSS/JSG source path may use either separator). */
export const baseName = (p: string | null | undefined): string => String(p ?? '').split(/[\\/]/).pop() ?? '';

/** Does a check-out notice (its `path` from the server) concern this open document? A JSS / JSG project has one source document. */
export function noticeIsFor(doc: PresenceDoc, noticePath: string | null | undefined): boolean {
  const b = baseName(noticePath);
  return doc.kind === 'dm' ? b.toLowerCase() === baseName(doc.path).toLowerCase() : b !== '' && !/^DMC-/i.test(b);
}

/** Announce that this page is in `projectId` (and on `doc`) while it is mounted. */
export function useAnnouncePresence(projectId: string | null, doc: PresenceDoc | null, mode: 'viewing' | 'editing' = 'viewing'): void {
  const key = JSON.stringify([projectId, doc, mode]);
  useEffect(() => {
    if (!projectId) return undefined;
    const off = subscribe(() => undefined);               // keeps the shared socket open while this page is here
    const send = (): void => sendPresence({ projectId, doc, mode });
    send();
    const t = window.setInterval(send, HEARTBEAT_MS);
    return () => { window.clearInterval(t); sendPresence({ projectId: null }); off(); };
    // the key holds every input
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** The people in the project and its live check-outs, kept current by the socket's notices. `onLease` hears each check-out notice. */
export function useTeam(projectId: string, onLease?: (m: ProgressMsg) => void): Team & { reload: () => void } {
  const [team, setTeam] = useState<Team>(EMPTY);
  const leaseRef = useRef(onLease); leaseRef.current = onLease;
  const load = useCallback(() => {
    get<Team>(`/api/projects/${projectId}/presence`, { background: true, fresh: true })
      .then((t) => setTeam({ people: t.people ?? [], leases: t.leases ?? [] }), () => undefined);
  }, [projectId]);
  useEffect(() => {
    load();
    let pending: number | null = null;
    const soon = (): void => { if (pending === null) pending = window.setTimeout(() => { pending = null; load(); }, 300); };
    const every = window.setInterval(load, 60_000);
    const off = subscribe((m) => {
      if (m.projectId !== projectId) return;
      if (m.type === 'presence') soon();
      if (m.type === 'leases') { soon(); leaseRef.current?.(m); }
    });
    return () => { off(); window.clearInterval(every); if (pending !== null) window.clearTimeout(pending); };
  }, [projectId, load]);
  return { ...team, reload: load };
}

/** "Ada Lovelace" -> "AL"; a user name without spaces -> its first two letters. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0] ?? '?').slice(0, 2).toUpperCase();
}

/** "until 14:05" in the reader's time. */
export const untilText = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `until ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

/** What a person is doing, in words: "editing DMC-…", "viewing JSS book", "in the project". */
export function activityText(p: Person): string {
  if (!p.doc) return 'in the project';
  const what = p.doc.title || baseName(p.doc.path) || p.doc.kind.toUpperCase();
  return `${p.mode === 'editing' ? 'editing' : 'viewing'} ${what}${p.doc.part ? ` (${p.doc.part})` : ''}`;
}
