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
import { projectDirFor } from '../context';
import { bad } from './http';

export type WaiverKind = 'brex-missing';
export interface Waiver { id: string; kind: WaiverKind; subject: string; reason: string; by: string; at: string }

export const WAIVER_KINDS: readonly WaiverKind[] = ['brex-missing'];
const SUBJECT = /^[A-Za-z0-9][A-Za-z0-9._-]{2,119}$/;
const FILE = 'publish-waivers.json';

const fileOf = (projectId: string): string => path.join(projectDirFor(projectId), FILE);

export function listWaivers(projectId: string): Waiver[] {
  try {
    const raw = JSON.parse(fs.readFileSync(fileOf(projectId), 'utf8'));
    return Array.isArray(raw) ? raw.filter((w) => w && typeof w.id === 'string' && typeof w.subject === 'string' && WAIVER_KINDS.includes(w.kind)) : [];
  } catch { return []; }
}

function save(projectId: string, list: Waiver[]): void {
  const file = fileOf(projectId);
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

/** Records a waiver. The reason is required (it is what a reviewer reads later). One waiver per kind and subject: asking again replaces it. */
export function addWaiver(projectId: string, input: { kind?: unknown; subject?: unknown; reason?: unknown }, by: string): Waiver {
  const kind = String(input.kind ?? '');
  if (!WAIVER_KINDS.includes(kind as WaiverKind)) throw bad(`kind must be one of: ${WAIVER_KINDS.join(', ')}.`, 'BAD_WAIVER_KIND');
  const subject = String(input.subject ?? '').trim();
  if (!SUBJECT.test(subject)) throw bad('subject must be the data module code or file name the gate named (letters, digits, . _ -).', 'BAD_WAIVER_SUBJECT');
  const reason = String(input.reason ?? '').trim();
  if (reason.length < 10) throw bad('Say why in at least a sentence (10 characters): the reason is recorded with the waiver.', 'WAIVER_REASON_REQUIRED');
  if (reason.length > 500) throw bad('The reason is limited to 500 characters.', 'WAIVER_REASON_TOO_LONG');
  const w: Waiver = { id: crypto.randomBytes(6).toString('hex'), kind: kind as WaiverKind, subject, reason, by, at: new Date().toISOString() };
  const rest = listWaivers(projectId).filter((x) => !(x.kind === w.kind && x.subject.toLowerCase() === subject.toLowerCase()));
  save(projectId, [...rest, w]);
  return w;
}

export function removeWaiver(projectId: string, id: string): boolean {
  const all = listWaivers(projectId);
  const rest = all.filter((w) => w.id !== id);
  if (rest.length === all.length) return false;
  save(projectId, rest);
  return true;
}

export function waiverFor(projectId: string, kind: WaiverKind, subject: string): Waiver | undefined {
  const s = String(subject).toLowerCase();
  return listWaivers(projectId).find((w) => w.kind === kind && (w.subject.toLowerCase() === s || s.endsWith(w.subject.toLowerCase()) || w.subject.toLowerCase().endsWith(s)));
}
