// =============================================================================
// Release maintenance and watermark.
//
// Ported from JSS Publisher (server.js "RELEASE MAINTENANCE & WATERMARK"). The
// publication module IS the document that gets published, so its release is the
// one the built PDF reports and the one the NOT RELEASED watermark answers to.
//
// A project is RELEASED when it has an approved release whose moment has
// arrived AND whose content fingerprint still matches the publication as it
// stands. The second half is what makes an approval cover the content that was
// approved, not the project forever after.
// =============================================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { nowIso, vendor } from '../config';
import { store, docIndex, projectDirFor } from '../context';
import { bad, conflict, notFound } from './http';
import { readProjectJson, updateProjectJson, pmRel } from './projects';
import { csdbRel } from './projectRecord';
import { listedStat } from './csdbIndex';
import { publicationSources } from './pm';
import { FileMemo } from './fileMemo';
import { ownEngineFormatOf } from './ownEngines';
import type { DmSummary } from './csdb';

const watermarkEngine = vendor('engine/watermark');
const { newId } = require('../core/auth/crypto');

export const WATERMARK_STYLES: string[] = watermarkEngine.STYLES;

/** Settings that shape what the PDF says. Compression and other "how it is written" settings are excluded on purpose. */
const RELEASE_SETTING_KEYS = ['name', 'type', 'pipeline', 'input', 'publication', 'frontMatter', 's1000dFrontMatter', 'layout', 'pageSetup'];

/**
 * One definition of the fingerprint, with no caller-supplied input: JSS found
 * that two callers hashing different views of project.json made an approved
 * release unable to ever match its own content.
 */
// WP-18 (PERF-016): the dashboard summary asks for the release state on every visit and after every save. For that DISPLAY the digest of a source
// file whose size, mtime and ctime are unchanged is reused; the same function with `reuse` off (every decision: submit, approve, build) reads every file.
const digestMemo = new FileMemo<Buffer>();

export function publicationFingerprint(projectId: string, opts: { reuse?: boolean; known?: DmSummary[] } = {}): string {
  return fingerprintOf(projectId, opts).fingerprint;
}

function fingerprintOf(projectId: string, opts: { reuse?: boolean; known?: DmSummary[] }): { fingerprint: string; sourceCount: number } {
  const dir = projectDirFor(projectId);
  const project = readProjectJson(projectId);
  const h = crypto.createHash('sha256');
  const digest = (abs: string): Buffer => crypto.createHash('sha256').update(fs.readFileSync(abs)).digest();
  // WP-17 (PERF-005): with `reuse`, a module the caller listed in this request is not statted a second time (its listing's stat is used)
  const listed = new Map<string, fs.Stats>();
  if (opts.reuse && opts.known) {
    const csdb = csdbRel(project);
    for (const d of opts.known) { const st = listedStat(d); if (st) listed.set(`${csdb}/${d.file}`, st); }
  }
  const sources = releaseSources(projectId, opts.known);
  for (const rel of sources) {
    h.update(rel, 'utf8');
    h.update('\0');
    const abs = path.join(dir, rel);
    try { h.update(opts.reuse ? digestMemo.get(abs, listed.get(rel) ?? fs.statSync(abs), () => digest(abs)) : digest(abs)); }
    catch { h.update('MISSING'); }
    h.update('\n');
  }
  const settings: Record<string, unknown> = {};
  for (const k of RELEASE_SETTING_KEYS) if (project[k] !== undefined) settings[k] = project[k];
  h.update(JSON.stringify(settings));
  return { fingerprint: h.digest('hex'), sourceCount: sources.length };
}

export interface WatermarkSettings { enabled: boolean; text: string; style: string }

export function readWatermark(projectId: string): WatermarkSettings {
  const w = readProjectJson(projectId).watermark || {};
  return {
    enabled: !!w.enabled,
    text: typeof w.text === 'string' ? w.text : '',
    style: WATERMARK_STYLES.includes(w.style) ? w.style : 'diagonal',
  };
}

export function writeWatermark(projectId: string, body: Partial<WatermarkSettings>): WatermarkSettings {
  const next: WatermarkSettings = {
    enabled: !!body.enabled,
    text: String(body.text == null ? '' : body.text).slice(0, 120),
    style: WATERMARK_STYLES.includes(String(body.style)) ? String(body.style) : 'diagonal',
  };
  updateProjectJson(projectId, (pj) => { pj.watermark = next; });
  return next;
}

// Page geometry defaults, matching each pipeline's own xsl:param values.
const PAGE_DEFAULTS: Record<string, Record<string, number>> = {
  s1000dtofo: { width: 210, height: 297, marginTop: 11, marginBottom: 12, marginInner: 25, marginOuter: 15, bodyMarginTop: 25, bodyMarginBottom: 30, headerExtent: 15, footerExtent: 25 },
  s1000dtojss: { width: 210, height: 297, marginTop: 12, marginBottom: 12, marginInner: 25, marginOuter: 18, bodyMarginTop: 14, bodyMarginBottom: 14, headerExtent: 14, footerExtent: 14 },
};

/** The real printable box (mm) a watermark must fit inside, from the SAME geometry the stylesheets read. */
export function printableBoxMm(effective: any, pipeline: string): { w: number; h: number } {
  const d = PAGE_DEFAULTS[pipeline] || PAGE_DEFAULTS.s1000dtojss;
  const p = (effective && effective.layout && effective.layout.page) || {};
  const get = (k: string): number => { const n = parseFloat(p[k]); return Number.isFinite(n) ? n : d[k]; };
  const width = get('width') - get('marginInner') - get('marginOuter');
  const height = get('height') - get('marginTop') - get('marginBottom') - get('headerExtent') - get('footerExtent') - get('bodyMarginTop') - get('bodyMarginBottom');
  const fw = d.width - d.marginInner - d.marginOuter;
  const fh = d.height - d.marginTop - d.marginBottom - d.headerExtent - d.footerExtent - d.bodyMarginTop - d.bodyMarginBottom;
  return { w: width > 40 ? width : fw, h: height > 40 ? height : fh };
}

// WP-15 (PUB-011): a format with an engine of its own (ownEngines.ts) is released like the other two: it says which file the release is
// recorded against and which files its fingerprint covers. Every other project: the publication module and what it contains, as before.

/** The project file a release is recorded against. */
export function releaseDocumentRel(projectId: string): string {
  return ownEngineFormatOf(projectId)?.releaseDocument(projectId) ?? pmRel(readProjectJson(projectId));
}

/** The files a release fingerprint covers (project-relative, sorted). */
export function releaseSources(projectId: string, known?: DmSummary[]): string[] {
  const own = ownEngineFormatOf(projectId);
  return own ? own.releaseSources(projectId) : publicationSources(projectId, known);
}

function pmDocument(projectId: string): any {
  return docIndex.resolve(projectId, releaseDocumentRel(projectId));
}

export function releaseStateOf(projectId: string, opts: { reuse?: boolean; known?: DmSummary[] } = {}) {
  const now = nowIso();
  const { fingerprint, sourceCount } = fingerprintOf(projectId, opts);
  const approved = store.currentRelease(projectId, now);
  const matches = !!approved && approved.content_hash === fingerprint;
  return {
    fingerprint, sourceCount, approved, released: matches,
    staleRelease: !!approved && !matches,
    scheduled: store.scheduledRelease(projectId, now),
    pending: store.pendingRelease(projectId),
  };
}

const releaseView = (r: any) => ({
  id: r.id, releaseNumber: r.release_number, scheduledAt: r.scheduled_at, status: r.status, note: r.note,
  requestedAt: r.requested_at, requestedBy: r.requested_by_username || null, decidedAt: r.decided_at,
});

/** `opts.state` / `opts.known`: the release state and module list this request already holds (WP-17, PERF-005: computed once per page view). */
export function releaseOverview(projectId: string, canSubmit: boolean, opts: { state?: ReturnType<typeof releaseStateOf>; known?: DmSummary[] } = {}) {
  const st = opts.state ?? releaseStateOf(projectId);
  const view = (r: any) => (r ? { number: r.release_number, scheduledAt: r.scheduled_at, note: r.note } : null);
  return {
    release: st.released ? view(st.approved) : null,
    staleRelease: st.staleRelease ? view(st.approved) : null,
    scheduled: st.scheduled ? view(st.scheduled) : null,
    pending: st.pending ? releaseView(st.pending) : null,
    sources: st.sourceCount,
    publicationRel: releaseDocumentRel(projectId),
    history: store.listReleasesForProject(projectId).map(releaseView),
    watermark: readWatermark(projectId),
    watermarkStyles: WATERMARK_STYLES,
    canSubmit,
  };
}

export function requestRelease(projectId: string, userId: string, body: { scheduledAt?: string; note?: string }) {
  const pmDoc = pmDocument(projectId);
  if (!pmDoc) { const own = ownEngineFormatOf(projectId); throw bad(own ? `This project has no ${own.name} document to release.` : 'This project has no publication module to release.', 'NO_PUBLICATION'); }
  // Submitting for review takes effect on approval; a later date is optional.
  const when = body.scheduledAt ? new Date(String(body.scheduledAt)) : new Date();
  if (Number.isNaN(when.getTime())) throw bad('A valid release date and time is required.');
  // A release date is a claim about when the document became authoritative: never back-dated (a minute absorbs clock skew).
  if (when.getTime() < Date.now() - 60_000) throw bad('The release date and time cannot be in the past.', 'RELEASE_IN_PAST');

  const contentHash = publicationFingerprint(projectId);
  const r = store.createRelease({
    id: newId(), documentId: pmDoc.id, projectId, scheduledAt: when.toISOString(),
    note: String(body.note || '').slice(0, 500) || null, requestedBy: userId, contentHash, now: nowIso(),
  });
  if (!r.created) throw conflict('This publication already has a release awaiting approval.');
  return { scheduledAt: when.toISOString(), contentHash };
}

export function withdrawRelease(projectId: string, relId: string): void {
  const row = store.getRelease(relId);
  if (!row || row.project_id !== projectId) throw notFound();
  if (!store.withdrawRelease(row.id, row.document_id)) throw notFound();
}

export function decideRelease(projectId: string, relId: string, approve: boolean, adminId: string) {
  const row = store.getRelease(relId);
  if (!row || row.project_id !== projectId) throw notFound();
  const out = approve ? store.approveRelease(row.id, adminId, nowIso()) : store.rejectRelease(row.id, adminId, nowIso());
  if (!out) throw conflict('That release request has already been decided.');
  return out;
}
