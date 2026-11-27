// =============================================================================
// Presence: who is working in which project, on which document, right now (audit WP-28 with PRD-003; addendum 17 section 3).
//
// A signed-in page sends `{ type: 'presence', projectId, doc?, mode? }` over its /ws connection when it opens a project or a document and
// then every 25 seconds (services/broadcast.ts accepts it only for a project the user can read). An entry lives as long as its connection
// and at most PRESENCE_TTL_MS after its last heartbeat: a closed tab, a sign-out, a revoked session (the socket is closed with 4401) or a
// sleeping laptop all drop it. When the set of people in a project changes, the project's readers get `{ type: 'presence' }` and ask
// GET /api/projects/:id/presence for the list.
//
// PRD-003 risk: presence is personal data in some jurisdictions. It is kept in memory only, never written to the database, the audit log
// or a file; a server restart forgets it. The check-out leases (services/leases.ts) are the only durable record of who holds what.
// =============================================================================

export const PRESENCE_TTL_MS = 75_000;
export const PRESENCE_HEARTBEAT_MS = 25_000;

export type PresenceKind = 'dm' | 'jss' | 'jsg' | 'page';
export interface PresenceDoc { kind: PresenceKind; path: string; title?: string; part?: string }
export interface PresenceUser { id: string; username: string; full_name?: string | null; fullName?: string | null }

interface Entry { connId: number; userId: string; username: string; name: string; projectId: string; doc: PresenceDoc | null; mode: 'viewing' | 'editing'; since: number; at: number }

export interface PresenceView { userId: string; username: string; name: string; doc: PresenceDoc | null; mode: 'viewing' | 'editing'; since: string; lastSeen: string; mine: boolean }

const entries = new Map<number, Entry>();

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');
const KINDS = new Set<PresenceKind>(['dm', 'jss', 'jsg', 'page']);

/** A client's `doc` field, cleaned: unknown kinds and empty paths are dropped (an entry without a document is "in the project"). */
export function cleanDoc(raw: unknown): PresenceDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kind = text(r.kind, 8) as PresenceKind;
  const p = text(r.path, 300);
  if (!KINDS.has(kind) || !p) return null;
  const out: PresenceDoc = { kind, path: p };
  const title = text(r.title, 160); if (title) out.title = title;
  const part = text(r.part, 200); if (part) out.part = part;
  return out;
}

const sameDoc = (a: PresenceDoc | null, b: PresenceDoc | null): boolean =>
  (a === null && b === null) || (!!a && !!b && a.kind === b.kind && a.path === b.path && (a.part ?? '') === (b.part ?? ''));

/**
 * Record a heartbeat. Returns the project ids whose set of people changed (the new one, and the old one when the connection moved), so
 * the caller can tell their readers; an unchanged heartbeat returns [] (no traffic for the 25-second refresh).
 */
export function setPresence(connId: number, user: PresenceUser, projectId: string | null, doc: PresenceDoc | null, mode: 'viewing' | 'editing', now = Date.now()): string[] {
  const prev = entries.get(connId);
  if (!projectId) { if (!prev) return []; entries.delete(connId); return [prev.projectId]; }
  if (prev && prev.projectId === projectId && sameDoc(prev.doc, doc) && prev.mode === mode) { prev.at = now; return []; }
  entries.set(connId, {
    connId, userId: user.id, username: user.username, name: String(user.full_name ?? user.fullName ?? user.username),
    projectId, doc, mode, since: prev && prev.projectId === projectId && sameDoc(prev.doc, doc) ? prev.since : now, at: now,
  });
  return prev && prev.projectId !== projectId ? [prev.projectId, projectId] : [projectId];
}

/** The connection closed (or its session ended): its entry goes. Returns the project it was in, if any. */
export function dropConnection(connId: number): string | null {
  const e = entries.get(connId);
  if (!e) return null;
  entries.delete(connId);
  return e.projectId;
}

/** The project a connection is present in, if any. */
export const projectOf = (connId: number): string | null => entries.get(connId)?.projectId ?? null;

/** Forget entries whose last heartbeat is older than the time limit. Returns the projects that changed. */
export function expire(now = Date.now()): string[] {
  const changed = new Set<string>();
  for (const [id, e] of entries) if (now - e.at > PRESENCE_TTL_MS) { entries.delete(id); changed.add(e.projectId); }
  return [...changed];
}

/** The people in a project: one row per person and document (several tabs on one document count once), the newest heartbeat kept. */
export function listProject(projectId: string, me: string | null, now = Date.now()): PresenceView[] {
  const rows = new Map<string, Entry>();
  for (const e of entries.values()) {
    if (e.projectId !== projectId || now - e.at > PRESENCE_TTL_MS) continue;
    const k = `${e.userId}\u0000${e.doc ? `${e.doc.kind}:${e.doc.path}:${e.doc.part ?? ''}` : ''}`;
    const had = rows.get(k);
    if (!had) rows.set(k, { ...e });
    else { had.at = Math.max(had.at, e.at); had.since = Math.min(had.since, e.since); if (e.mode === 'editing') had.mode = 'editing'; }
  }
  return [...rows.values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.since - b.since)
    .map((e) => ({ userId: e.userId, username: e.username, name: e.name, doc: e.doc, mode: e.mode, since: new Date(e.since).toISOString(), lastSeen: new Date(e.at).toISOString(), mine: e.userId === me }));
}

/** How many entries are held (the metrics gauge). */
export const size = (): number => entries.size;

/** Tests: forget everything. */
export function clear(): void { entries.clear(); }
