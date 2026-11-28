// =============================================================================
// The project record: project.json and the fields of it that decide where a project's files are and what kind of project it is.
//
// A leaf module (audit WP-10, ARC-006): it imports no other service, so the services that only need to read a project's record (csdb, sns,
// projectConfig, the JSS and JSG engines, xengine) no longer import projects.ts, which closed an 8-module import cycle. projects.ts re-exports
// everything here, so existing imports keep working. project.json is read and written through the ContentStore.
// =============================================================================

import fs from 'fs';
import { content } from '../context';
import { HttpError } from './http';
import { FileMemo } from './fileMemo';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { safeRelPath, safeArtworkRef } = require('../core/auth/xmlGuard');

/* eslint-disable @typescript-eslint/no-explicit-any */
export function projectJsonPath(id: string): string {
  return content.pathOf(id, 'project.json');
}

// Phase 7: project.json is read many times per request (every csdbDir / pmPath / setting lookup). Its TEXT is kept per file version (size,
// times, file id: every write is an atomic rename, so a new version is a new file id), and parsed on each call, so every caller still gets
// its own object to change. One stat instead of open + read + close.
const projectJsonMemo = new FileMemo<string>(4096);
export function readProjectJson(id: string): any {
  try {
    const abs = content.pathOf(id, 'project.json');
    let st: fs.Stats | null = null; try { st = fs.statSync(abs); } catch { /* read through the store below */ }
    const text = st ? projectJsonMemo.get(abs, st, () => content.readText(id, 'project.json')) : content.readText(id, 'project.json');
    return JSON.parse(text) || {};
  } catch { return {}; }
}

/** Read-modify-write so every setting the caller does not touch survives. */
export function updateProjectJson(id: string, mutate: (pj: any) => void): any {
  const pj = readProjectJson(id);
  mutate(pj);
  content.writeText(id, 'project.json', JSON.stringify(pj, null, 2) + '\n');
  return pj;
}

// ── Path fields of project.json (WP-01, SEC-002 / S1K-001 / PUB-001) ──────
// `input.csdbDir`, `input.mediaDir` and `input.pm` are joined onto the project folder by every content route and by the
// publisher. They are only ever honoured when they are a plain relative path inside the project; anything else (an
// absolute or drive path, a UNC path, `..`, an empty segment, an alternate data stream, a reserved device name) is
// ignored and the default is used. This is the read-site defence; the write sites (settings route, archive import)
// refuse or drop such values too.
const RESERVED_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
export function safeProjectRel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const rel = safeRelPath(value.trim());
  if (!rel) return null;
  const segs = rel.split('/');
  if (segs.some((s: string) => s.includes(':') || RESERVED_NAME.test(s) || /[<>"|?*\x00-\x1f]/.test(s) || /[. ]$/.test(s))) return null;
  return rel;
}
const inputField = (pj: any, key: 'csdbDir' | 'mediaDir' | 'pm', def: string): string => safeProjectRel(pj?.input?.[key]) ?? def;
/**
 * Artwork references in a project.json (publisher logos, emblems, any key named like a logo or emblem) that a build
 * would hand to FOP and that are not a relative path inside the project or a data: image (WP-02, SEC-003). By path.
 */
export function unsafeArtwork(value: any, at = 'project', depth = 0, out: string[] = []): string[] {
  if (depth > 8 || value == null || typeof value !== 'object') return out;
  for (const [k, v] of Object.entries(value)) {
    const here = Array.isArray(value) ? `${at}[${k}]` : `${at}.${k}`;
    if (typeof v === 'string' && /(^|[a-z])(logo|emblem)$/i.test(k) && !safeArtworkRef(v)) out.push(here);
    else if (v && typeof v === 'object') unsafeArtwork(v, here, depth + 1, out);
  }
  return out;
}
/** The unsafe path values in a project.json (`input.*`), by key. Empty when the file is clean. */
export function unsafeInputFields(pj: any): string[] {
  const input = pj?.input;
  if (input == null) return [];
  if (typeof input !== 'object' || Array.isArray(input)) return ['input'];
  return (['csdbDir', 'mediaDir', 'pm'] as const).filter((k) => input[k] !== undefined && input[k] !== null && input[k] !== '' && !safeProjectRel(input[k]));
}
/** A copy of `input` with every unsafe path field removed (the defaults then apply). */
export function cleanInput(input: any): any {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const out: any = { ...input };
  for (const k of ['csdbDir', 'mediaDir', 'pm']) if (out[k] !== undefined && !safeProjectRel(out[k])) delete out[k];
  return out;
}

/**
 * project.json keys that only the platform itself sets (create, import, rename, move): the project settings route keeps
 * them as they are on disk. `format`, `authoring` and `type` decide which engine and which routes a project gets (kind
 * confusion, PUB-026); `input` decides where its files are (SEC-002); `name` and `group` have their own routes.
 */
export const PROTECTED_PROJECT_KEYS = ['id', 'format', 'authoring', 'jssDocType', 'domain', 'manualType', 'type', 'input', 'group', 'name'] as const;
/** Same value for the protected-key check: null and a missing key are the same thing. */
export const sameSetting = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export const csdbRel = (pj: any): string => inputField(pj, 'csdbDir', 'csdb');
/** Is this an S1000D project? Business rules (BREX), the S1000D configuration and the CSDB belong to S1000D only; JSS and JSG projects have none of them. */
export function isS1000dProject(projectId: string): boolean {
  const pj = readProjectJson(projectId);
  const format = pj.format ?? (pj.type === 'JSS' || pj.templateRef === 'uhb' ? 'jss' : 's1000d');
  return format === 's1000d';
}
/** WP-16 (PUB-022 / ARC-018): the message every S1000D writer gives for a JSS document project (routes/jss-guard.ts answers the same). */
export const JSS_PROTECTED_MESSAGE = 'This is a JSS document project: its publication.xml is the JSS document and is not replaced by an S1000D import. Use "Import project" in the JSS document to bring in an RWI package.';
/**
 * WP-16 (PUB-022 / ARC-018): a JSS document project's publication.xml IS the JSS document. Every S1000D writer of the publication module calls
 * this before it writes, so a new route that reaches one of them is refused (409) even when routes/jss-guard.ts (now defence in depth) does
 * not list it. The project's kind cannot be changed through settings (PROTECTED_PROJECT_KEYS, WP-01).
 */
export function assertS1000dPublication(projectId: string): void {
  if (readProjectJson(projectId).authoring === 'jss-xml') throw new HttpError(409, JSS_PROTECTED_MESSAGE, 'JSS_PROJECT_PROTECTED');
}
export const mediaRel = (pj: any): string => inputField(pj, 'mediaDir', 'Media');
export const pmRel = (pj: any): string => inputField(pj, 'pm', 'publication.xml');
