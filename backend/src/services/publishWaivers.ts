// Recorded waivers for the publication gate.
//
// The gate is strict: a module that names a BREX the project does not have is not published. That is right for a release, but a package imported
// from another tool often does not ship the organisation's own BREX, and the author cannot make one appear. A waiver is the author's recorded,
// attributed decision to build DRAFT copies without it: who, when and why are stored with the project and every build that relies on it says so
// in its log. A waiver never applies to a release request or an approval, and never to a build of released content, so a released issue still
// needs the real thing.
//
// One small file per project (publish-waivers.json), written atomically. Nothing here is ever created implicitly.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { projectDirFor, repos } from '../context';
import { bad } from './http';
import type { WaiverEvent } from '../repositories/auditRepository';

export type WaiverKind = 'brex-missing';
export interface Waiver { id: string; kind: WaiverKind; subject: string; reason: string; by: string; at: string; expiresAt?: string; expired?: boolean }

export const WAIVER_KINDS: readonly WaiverKind[] = ['brex-missing'];
const SUBJECT = /^[A-Za-z0-9][A-Za-z0-9._-]{2,119}$/;
const FILE = 'publish-waivers.json';

const fileOf = (projectId: string): string => path.join(projectDirFor(projectId), FILE);

/**
 * WP-16 (S1K-002): the subject as the gate names it. The gate names a missing BREX by its bare data module code
 * (`DMC-S1KSTUDIO-A-00-00-00-00A-022A-D`); an author or a script may send the module's file name instead
 * (`DMC-..._001-00_EN-US.XML`). Both mean the same BREX, so the issue/language suffix and the extension are taken off and the case is
 * folded. Formerly a subject that one of the two strings merely ended with matched (a waiver for `022A-D` covered every BREX), and a
 * file-name subject matched nothing: it was accepted (201) and silently never applied.
 */
export function waiverSubject(subject: string): string {
  return String(subject ?? '').trim().replace(/\.xml$/i, '').replace(/_\d{3}-\d{2}(_[A-Za-z]{2}-[A-Za-z]{2})?$/, '').toUpperCase();
}
/** The comparison key: the normalised subject without a leading `DMC-` (a subject sent without the prefix names the same module). */
const subjectKey = (subject: string): string => waiverSubject(subject).replace(/^DMC-/, '');

/** Every waiver recorded for the project, expired ones included (marked `expired`). */
export function listWaivers(projectId: string, now = new Date().toISOString()): Waiver[] {
  try {
    const raw = JSON.parse(fs.readFileSync(fileOf(projectId), 'utf8'));
    return Array.isArray(raw)
      ? raw.filter((w) => w && typeof w.id === 'string' && typeof w.subject === 'string' && WAIVER_KINDS.includes(w.kind))
        .map((w: Waiver) => (w.expiresAt ? { ...w, expired: w.expiresAt <= now } : w))
      : [];
  } catch { return []; }
}

/*
  WP-29 (ENT-017): the file holds the waivers in force; their HISTORY is append-only rows in the database (publish_waiver_events): who
  added, replaced or removed which waiver, when and why - so a reason survives the waiver's removal. The audit rows of add/remove carry the
  reason as well. A waiver may carry an expiry date; past it, it no longer applies (the gate treats it as absent).
*/
function record(projectId: string, w: Waiver, event: WaiverEvent['event'], reason: string | null, actor: string | null): void {
  repos.audit.insertWaiverEvent({ project_id: projectId, waiver_id: w.id, event, kind: w.kind, subject: w.subject, reason, expires_at: w.expiresAt ?? null, actor, at: new Date().toISOString() });
}

export function waiverHistory(projectId: string, limit = 500): Array<{ id: number; waiverId: string; event: string; kind: string; subject: string; reason: string | null; expiresAt: string | null; by: string | null; at: string }> {
  return repos.audit.waiverEvents(projectId, limit).map((e) => ({ id: Number(e.id), waiverId: e.waiver_id, event: e.event, kind: e.kind, subject: e.subject, reason: e.reason, expiresAt: e.expires_at, by: e.actor, at: e.at }));
}

function parseExpiry(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const t = Date.parse(String(raw));
  if (!Number.isFinite(t)) throw bad('expiresAt must be a date (for example 2027-03-31).', 'BAD_WAIVER_EXPIRY');
  if (t <= Date.now()) throw bad('expiresAt must be in the future.', 'BAD_WAIVER_EXPIRY');
  if (t > Date.now() + 3 * 366 * 86400_000) throw bad('A waiver can be set for at most three years.', 'BAD_WAIVER_EXPIRY');
  return new Date(t).toISOString();
}

function save(projectId: string, list: Waiver[]): void {
  const file = fileOf(projectId);
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

/** Records a waiver. The reason is required (it is what a reviewer reads later). One waiver per kind and subject: asking again replaces it. */
export function addWaiver(projectId: string, input: { kind?: unknown; subject?: unknown; reason?: unknown; expiresAt?: unknown }, by: string): Waiver {
  const kind = String(input.kind ?? '');
  if (!WAIVER_KINDS.includes(kind as WaiverKind)) throw bad(`kind must be one of: ${WAIVER_KINDS.join(', ')}.`, 'BAD_WAIVER_KIND');
  const raw = String(input.subject ?? '').trim();
  const subject = waiverSubject(raw);
  if (!SUBJECT.test(raw) || !SUBJECT.test(subject)) throw bad('subject must be the data module code or file name the gate named (letters, digits, . _ -).', 'BAD_WAIVER_SUBJECT');
  const reason = String(input.reason ?? '').trim();
  if (reason.length < 10) throw bad('Say why in at least a sentence (10 characters): the reason is recorded with the waiver.', 'WAIVER_REASON_REQUIRED');
  if (reason.length > 500) throw bad('The reason is limited to 500 characters.', 'WAIVER_REASON_TOO_LONG');
  const expiresAt = parseExpiry(input.expiresAt);
  const w: Waiver = { id: crypto.randomBytes(6).toString('hex'), kind: kind as WaiverKind, subject, reason, by, at: new Date().toISOString(), ...(expiresAt ? { expiresAt } : {}) };
  const strip = (x: Waiver): Waiver => { const { expired: _e, ...keep } = x; return keep; };
  const all = listWaivers(projectId).map(strip);
  const replaced = all.filter((x) => x.kind === w.kind && subjectKey(x.subject) === subjectKey(subject));
  const rest = all.filter((x) => !replaced.includes(x));
  save(projectId, [...rest, w]);
  for (const old of replaced) record(projectId, old, 'replaced', old.reason, by);
  record(projectId, w, 'added', reason, by);
  return w;
}

/** Removes a waiver; the removal (with its own reason, when given) is kept in the history. Returns the removed waiver or null. */
export function removeWaiver(projectId: string, id: string, by: string | null = null, why: string | null = null): Waiver | null {
  const all = listWaivers(projectId);
  const gone = all.find((w) => w.id === id);
  if (!gone) return null;
  save(projectId, all.filter((w) => w.id !== id).map((x) => { const { expired: _e, ...keep } = x; return keep; }));
  record(projectId, gone, 'removed', why && why.trim() ? why.trim().slice(0, 500) : null, by);
  return gone;
}

/** The waiver in force for a kind and subject; an expired one no longer applies. */
export function waiverFor(projectId: string, kind: WaiverKind, subject: string): Waiver | undefined {
  const s = subjectKey(subject);
  return listWaivers(projectId).find((w) => w.kind === kind && subjectKey(w.subject) === s && !w.expired);
}
