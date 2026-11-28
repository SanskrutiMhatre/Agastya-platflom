// =============================================================================
// PDF review (Phase 3, P3-4): reviewers annotate a project PDF - a generated build, a quick preview, or a PDF kept in the project - with a
// comment, a suggested change (with the replacement text) or a review remark, anchored to text they selected or an area they drew.
// Everyone who can read the project sees the threads; changes are pushed over the project WebSocket (services/broadcast.ts, type
// 'pdf-annotations'); a new version of the PDF re-anchors the threads by their text quote (shared/pdfAnchor.ts), and a thread that cannot
// be placed stays, marked "needs re-anchoring" with its last page and quote. Decisions and their reasons: docs/phase3/pdf-review.md.
//
// Who may do what (the project role ladder, services/../core/auth/authz.js; an administrator is owner-equivalent):
//   viewer     reads threads and exports
//   reviewer   creates threads and replies; resolves and reopens; edits / deletes their own threads; places a thread again
//   editor     (an Author) all of the above, and accepts or rejects suggestions (the content is theirs to change)
//   manager    (Project Manager) and owner: all of the above, edit or delete anyone's thread, the "block release" setting
// =============================================================================

import crypto from 'crypto';
import { repos } from '../../context';
import { nowIso } from '../../config';
import { bad, conflict, forbidden, notFound, HttpError } from '../http';
import { broadcast } from '../broadcast';
import { csvText } from '../csv';
import { notify } from '../notifications';
import { cleanRects, contextOf, foldCompact, reanchor, rectsFor, textInRect, unionRect, type Quote, type Rect, type StoredAnchor } from '../../shared/pdfAnchor';
import { DOMParser } from '@xmldom/xmldom';
import { checkXmlSafetyOf } from '../csdbGuard';
import type { PdfAnnotationRow, PdfAnnotationStatus, PdfAnnotationKind, PdfAnchorState, PdfReplyRow } from '../../repositories/pdfAnnotationRepository';
import { cleanKey, identityOf, listReviewFiles, resolveReviewFile, type ReviewFile } from './files';
import { withPdfText } from './pdfText';
import { traceSource, type SourceRef } from './source';

export const KINDS: PdfAnnotationKind[] = ['comment', 'suggestion', 'remark'];
export const STATUSES: PdfAnnotationStatus[] = ['open', 'resolved', 'accepted', 'rejected'];
const RANK: Record<string, number> = { viewer: 1, reviewer: 2, editor: 3, manager: 4, owner: 5 };

export interface Actor { id: string; username: string; fullName?: string; role?: string }
/** What a person may do, from their role on the project (the client shows the same; the server decides). */
export function abilities(projectRole: string): { create: boolean; reply: boolean; resolve: boolean; decide: boolean; moderate: boolean; settings: boolean } {
  const r = RANK[projectRole] ?? 0;
  return { create: r >= 2, reply: r >= 2, resolve: r >= 2, decide: r >= 3, moderate: r >= 4, settings: r >= 4 };
}

const clean = (s: unknown, max: number): string => String(s ?? '').replace(/\r/g, '').trim().slice(0, max);

export interface AnnotationView {
  id: string; fileKey: string; kind: PdfAnnotationKind; status: PdfAnnotationStatus; required: boolean; body: string; replacement: string | null;
  page: number; anchor: StoredAnchor; anchorState: PdfAnchorState; fileHash: string;
  orig: { page: number; hash: string; quote: string | null }; source: SourceRef | null;
  author: { id: string; username: string | null; name: string | null }; createdAt: string; updatedAt: string;
  statusBy: string | null; statusAt: string | null;
  replies: Array<{ id: string; body: string; author: { id: string; username: string | null; name: string | null }; createdAt: string }>;
}

function parseJson<T>(s: string | null, fallback: T): T { try { return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; } }

export function viewOf(r: PdfAnnotationRow, replies: PdfReplyRow[]): AnnotationView {
  return {
    id: r.id, fileKey: r.file_key, kind: r.kind, status: r.status, required: !!r.required, body: r.body, replacement: r.replacement,
    page: r.page, anchor: parseJson<StoredAnchor>(r.anchor, { page: r.page, rects: [], quote: null }), anchorState: r.anchor_state, fileHash: r.file_hash,
    orig: { page: r.orig_page, hash: r.orig_hash, quote: r.orig_quote }, source: parseJson<SourceRef | null>(r.source, null),
    author: { id: r.created_by, username: r.author_username ?? null, name: r.author_name ?? null }, createdAt: r.created_at, updatedAt: r.updated_at,
    statusBy: r.status_name ?? r.status_username ?? null, statusAt: r.status_at,
    replies: replies.filter((x) => x.annotation_id === r.id).map((x) => ({ id: x.id, body: x.body, author: { id: x.created_by, username: x.author_username ?? null, name: x.author_name ?? null }, createdAt: x.created_at })),
  };
}

function one(projectId: string, id: string): PdfAnnotationRow {
  const r = repos.pdfAnnotations.get(String(id));
  if (!r || r.project_id !== projectId) throw notFound('No such PDF comment.');
  return r;
}
const fresh = (id: string): AnnotationView => { const r = repos.pdfAnnotations.get(id)!; return viewOf(r, repos.pdfAnnotations.replies([id])); };

/** Tell everyone reading the project (the pages showing that PDF pick it up). */
function push(projectId: string, fileKey: string, change: 'created' | 'updated' | 'deleted' | 'reanchored', id?: string): void {
  try {
    const annotation = id && change !== 'deleted' ? fresh(id) : undefined;
    broadcast(projectId, { type: 'pdf-annotations', fileKey, change, ...(id ? { id } : {}), ...(annotation ? { annotation: annotation as unknown as Record<string, unknown> } : {}) });
  } catch { /* a failed push never undoes the change; readers get it on their next load */ }
}

// ── Anchors from a request ──────────────────────────────────────────────────────────────────────────────────────────────────────

function cleanQuote(raw: unknown): Quote | null {
  if (!raw || typeof raw !== 'object') return null;
  const q = raw as Record<string, unknown>;
  const exact = clean(q.exact, 2000).replace(/\s+/g, ' ');
  if (!exact) return null;
  return { exact, prefix: clean(q.prefix, 200).replace(/\s+/g, ' '), suffix: clean(q.suffix, 200).replace(/\s+/g, ' ') };
}

export function cleanAnchor(raw: unknown): StoredAnchor {
  if (!raw || typeof raw !== 'object') throw bad('Say where on the page the comment is.', 'ANCHOR_REQUIRED');
  const a = raw as Record<string, unknown>;
  const page = Number(a.page);
  if (!Number.isInteger(page) || page < 1 || page > 100000) throw bad('That is not a page of the PDF.', 'BAD_ANCHOR');
  const area = a.area === true;
  const rects = cleanRects(a.rects, area ? 1 : 64);
  if (!rects) throw bad('That is not a place on the page.', 'BAD_ANCHOR');
  const quote = cleanQuote(a.quote);
  if (!area && !quote) throw bad('A comment on text needs the text it is on.', 'BAD_ANCHOR');
  const qb = a.quoteBox ? cleanRects([a.quoteBox], 1) : null;
  return { page, rects, quote, ...(area ? { area: true, quoteBox: qb ? qb[0] : null } : {}) };
}

// ── Files and versions ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface FileState { key: string; hash: string; version: number; versions: number; size: number; modified: string }

function fileState(projectId: string, rawKey: unknown): FileState & { abs: string } {
  const f = resolveReviewFile(projectId, rawKey);
  const hash = identityOf(f);
  repos.pdfAnnotations.noteVersion({ project_id: projectId, file_key: f.key, hash, pages: null, seen_at: nowIso() });
  const vs = repos.pdfAnnotations.versions(projectId, f.key);
  return { key: f.key, abs: f.abs, hash, version: Math.max(1, vs.findIndex((v) => v.hash === hash) + 1), versions: vs.length, size: f.size, modified: new Date(f.mtimeMs).toISOString() };
}

/** The reviewable PDFs with their open and total thread counts. */
export function files(projectId: string): Array<ReviewFile & { open: number; total: number }> {
  const all = repos.pdfAnnotations.list(projectId);
  const list = listReviewFiles(projectId);
  const known = new Set(list.map((f) => f.key));
  // a PDF that is gone but still has threads stays listed (its threads are never lost)
  for (const k of new Set(all.map((a) => a.file_key))) if (!known.has(k)) list.push({ key: k, label: `${k} (no longer in the project)`, kind: 'project', size: 0, modified: '' });
  return list.map((f) => ({ ...f, open: all.filter((a) => a.file_key === f.key && a.status === 'open').length, total: all.filter((a) => a.file_key === f.key).length }));
}

// ── Re-anchoring ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const inFlight = new Map<string, Promise<number>>();

/**
 * Place every thread of `key` that was anchored on another version of the PDF on the version now on disk. Returns how many moved.
 * One run per (project, file, version) at a time; a second reader waits for the first run instead of repeating it.
 */
export function reanchorFile(projectId: string, key: string, abs: string, hash: string): Promise<number> {
  const k = `${projectId}\u0000${key}\u0000${hash}`;
  const running = inFlight.get(k); if (running) return running;
  const job = (async (): Promise<number> => {
    const stale = repos.pdfAnnotations.list(projectId, key).filter((r) => r.file_hash !== hash);
    if (!stale.length) return 0;
    let changed = 0;
    await withPdfText(abs, hash, async (pdf) => {
      repos.pdfAnnotations.noteVersion({ project_id: projectId, file_key: key, hash, pages: pdf.pages, seen_at: nowIso() });
      for (const r of stale) {
        const a = parseJson<StoredAnchor>(r.anchor, { page: r.page, rects: [], quote: null });
        let state: PdfAnchorState; let next: StoredAnchor = a;
        const at = await reanchor(a, pdf.pages, (n) => pdf.page(n), { wholeDocument: true });
        if (at) {
          next = { ...a, page: at.page, rects: at.rects, ...(a.area ? { quoteBox: at.quoteBox ?? a.quoteBox ?? null } : {}), ...(at.quote ? { quote: at.quote } : {}) };
          state = at.exact && at.page === a.page ? 'placed' : 'moved';
          if (!at.exact) (next as StoredAnchor & { fuzzy?: boolean }).fuzzy = true;
        } else if (a.area && !(a.quote && foldCompact(a.quote.exact)) && a.page <= pdf.pages) {
          state = 'unverified';                 // an area on a picture has no words to find it by: kept where it was, flagged
        } else {
          state = 'orphaned';                   // kept with its last page and quote: "needs re-anchoring"
        }
        repos.pdfAnnotations.place(r.id, { page: next.page, anchor: JSON.stringify(next), fileHash: hash, state }, nowIso());
        changed++;
      }
    });
    if (changed) push(projectId, key, 'reanchored');
    return changed;
  })();
  inFlight.set(k, job);
  const done = (): void => { inFlight.delete(k); };
  job.then(done, done);
  return job;
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The threads of one PDF (re-anchored first when the PDF changed), or of the whole project when no key is given. */
export async function listAnnotations(projectId: string, rawKey?: unknown): Promise<{ file: FileState | null; annotations: AnnotationView[] }> {
  let file: (FileState & { abs: string }) | null = null;
  let key: string | null = null;
  if (rawKey !== undefined && rawKey !== null && rawKey !== '') {
    try { file = fileState(projectId, rawKey); key = file.key; }
    catch (e) { if (e instanceof HttpError && e.status === 404) key = String(rawKey).replace(/\\/g, '/'); else throw e; }
  }
  if (file) {
    try { await reanchorFile(projectId, file.key, file.abs, file.hash); }
    catch (e) { console.warn('[pdf-review] re-anchoring failed (threads keep their last place):', (e as Error).message); }
  }
  const rows = repos.pdfAnnotations.list(projectId, key);
  const replies = repos.pdfAnnotations.replies(rows.map((r) => r.id));
  const { abs: _abs, ...pub } = file ?? ({} as FileState & { abs: string });
  void _abs;
  return { file: file ? pub as FileState : null, annotations: rows.map((r) => viewOf(r, replies)) };
}

export const counts = (projectId: string): { open: number; openRequired: number; total: number; blockRelease: boolean } =>
  ({ ...repos.pdfAnnotations.counts(projectId), blockRelease: repos.pdfAnnotations.getBlockRelease(projectId) });

// ── Writing ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function createAnnotation(projectId: string, actor: Actor, body: Record<string, unknown>): AnnotationView {
  const kind = String(body.kind ?? 'comment') as PdfAnnotationKind;
  if (!KINDS.includes(kind)) throw bad('A PDF comment is a comment, a suggestion or a remark.', 'BAD_KIND');
  const text = clean(body.body, 4000);
  const replacement = kind === 'suggestion' ? clean(body.replacement, 4000) : null;
  if (!text && !(kind === 'suggestion' && body.replacement !== undefined)) throw bad('A comment cannot be empty.', 'COMMENT_EMPTY');
  if (kind === 'suggestion' && body.replacement === undefined) throw bad('A suggestion needs the replacement text (empty to suggest deleting the words).', 'REPLACEMENT_REQUIRED');
  const anchor = cleanAnchor(body.anchor);
  const file = fileState(projectId, body.fileKey);
  // the reviewer looked at one version; if the PDF was rebuilt since, their rectangles belong to the old one
  if (body.fileHash !== undefined && String(body.fileHash) !== file.hash) throw conflict('The PDF was rebuilt while you were reviewing it. Reload it and make the comment again.', 'PDF_CHANGED', { hash: file.hash });
  const id = crypto.randomUUID(); const now = nowIso();
  const source = traceSource(projectId, anchor.quote?.exact ?? null);
  repos.pdfAnnotations.insert({
    id, project_id: projectId, file_key: file.key, kind, status: 'open', required: body.required === true ? 1 : 0, body: text || (kind === 'suggestion' ? '' : text),
    replacement, page: anchor.page, anchor: JSON.stringify(anchor), file_hash: file.hash, anchor_state: 'placed', orig_page: anchor.page, orig_hash: file.hash,
    orig_quote: anchor.quote?.exact ?? null, source: source ? JSON.stringify(source) : null, created_by: actor.id, created_at: now, updated_at: now, status_by: null, status_at: null,
  });
  push(projectId, file.key, 'created', id);
  return fresh(id);
}

export function addReply(projectId: string, actor: Actor, annotationId: string, body: unknown): AnnotationView {
  const r = one(projectId, annotationId);
  const text = clean(body, 4000);
  if (!text) throw bad('A reply cannot be empty.', 'COMMENT_EMPTY');
  repos.pdfAnnotations.addReply({ id: crypto.randomUUID(), annotationId: r.id, body: text, createdBy: actor.id, createdAt: nowIso() });
  // the people in the thread hear about it
  const people = [r.created_by, ...repos.pdfAnnotations.replies([r.id]).map((x) => x.created_by)];
  notify(people, { kind: 'review.comment', title: 'New reply on a PDF comment', body: `${actor.fullName ?? actor.username} replied: “${text.slice(0, 140)}”`, projectId, actorId: actor.id });
  push(projectId, r.file_key, 'updated', r.id);
  return fresh(r.id);
}

export function setStatus(projectId: string, actor: Actor, projectRole: string, annotationId: string, raw: unknown): { view: AnnotationView; from: PdfAnnotationStatus } {
  const r = one(projectId, annotationId);
  const status = String(raw ?? '') as PdfAnnotationStatus;
  if (!STATUSES.includes(status)) throw bad('The status is open, resolved, accepted or rejected.', 'BAD_STATUS');
  const can = abilities(projectRole);
  if (status === 'accepted' || status === 'rejected') {
    if (r.kind !== 'suggestion') throw bad('Only a suggestion is accepted or rejected; resolve a comment or a remark.', 'NOT_A_SUGGESTION');
    if (!can.decide) throw forbidden('Authors, Project Managers and owners accept or reject suggestions.', 'PDF_REVIEW_ROLE');
  } else if (!can.resolve) throw forbidden('You cannot change this comment.', 'PDF_REVIEW_ROLE');
  if (r.status === status) return { view: fresh(r.id), from: r.status };
  repos.pdfAnnotations.setStatus(r.id, status, actor.id, nowIso());
  if (r.created_by !== actor.id) notify([r.created_by], { kind: 'review.comment', title: `PDF comment ${status}`, body: `${actor.fullName ?? actor.username} marked your ${r.kind} on page ${r.page} ${status}.`, projectId, actorId: actor.id });
  push(projectId, r.file_key, 'updated', r.id);
  return { view: fresh(r.id), from: r.status };
}

export function editAnnotation(projectId: string, actor: Actor, projectRole: string, annotationId: string, body: Record<string, unknown>): AnnotationView {
  const r = one(projectId, annotationId);
  if (r.created_by !== actor.id && !abilities(projectRole).moderate) throw forbidden('Only the person who wrote it, a Project Manager or the owner can change this comment.', 'NOT_YOURS');
  const text = body.body === undefined ? r.body : clean(body.body, 4000);
  const replacement = r.kind === 'suggestion' ? (body.replacement === undefined ? r.replacement : clean(body.replacement, 4000)) : null;
  if (!text && r.kind !== 'suggestion') throw bad('A comment cannot be empty.', 'COMMENT_EMPTY');
  const required = body.required === undefined ? r.required : body.required === true ? 1 : 0;
  const ok = repos.pdfAnnotations.edit(r.id, { body: text, replacement, required }, nowIso(), body.updatedAt === undefined ? null : String(body.updatedAt));
  if (!ok) throw conflict('Someone changed this comment since you opened it. Reload to see their change.', 'EDIT_CONFLICT', { updatedAt: repos.pdfAnnotations.get(r.id)?.updated_at });
  push(projectId, r.file_key, 'updated', r.id);
  return fresh(r.id);
}

export function deleteAnnotation(projectId: string, actor: Actor, projectRole: string, annotationId: string): { fileKey: string; kind: string; page: number } {
  const r = one(projectId, annotationId);
  const moderator = abilities(projectRole).moderate;
  if (r.created_by !== actor.id && !moderator) throw forbidden('Only the person who wrote it, a Project Manager or the owner can delete this comment.', 'NOT_YOURS');
  if (!moderator && repos.pdfAnnotations.replies([r.id]).some((x) => x.created_by !== actor.id)) throw conflict('Others have replied to this comment; resolve it instead (a Project Manager can delete it).', 'HAS_REPLIES');
  repos.pdfAnnotations.remove(r.id);
  push(projectId, r.file_key, 'deleted', r.id);
  return { fileKey: r.file_key, kind: r.kind, page: r.page };
}

/** A thread that needs re-anchoring (or is in the wrong place) is placed again by hand on the version now on disk. */
export function placeAgain(projectId: string, annotationId: string, body: Record<string, unknown>): AnnotationView {
  const r = one(projectId, annotationId);
  const anchor = cleanAnchor(body.anchor);
  const file = fileState(projectId, r.file_key);
  if (body.fileHash !== undefined && String(body.fileHash) !== file.hash) throw conflict('The PDF was rebuilt while you were reviewing it. Reload it and place the comment again.', 'PDF_CHANGED', { hash: file.hash });
  const source = traceSource(projectId, anchor.quote?.exact ?? null);
  repos.pdfAnnotations.place(r.id, { page: anchor.page, anchor: JSON.stringify(anchor), fileHash: file.hash, state: 'placed', source: source ? JSON.stringify(source) : r.source }, nowIso());
  push(projectId, r.file_key, 'updated', r.id);
  return fresh(r.id);
}

export function setBlockRelease(projectId: string, actor: Actor, on: boolean): void { repos.pdfAnnotations.setBlockRelease(projectId, on, actor.id, nowIso()); }

/** Release gate: with the project setting on, a release is refused while required PDF comments are open. */
export function assertReleasable(projectId: string): void {
  const c = counts(projectId);
  if (c.blockRelease && c.openRequired > 0) {
    throw new HttpError(409, `${c.openRequired} required PDF review comment${c.openRequired === 1 ? ' is' : 's are'} still open. Resolve ${c.openRequired === 1 ? 'it' : 'them'} on the Review and release page first (the project blocks a release while required comments are open).`, 'PDF_REVIEW_OPEN', { openRequired: c.openRequired });
  }
}

// ── Export ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const STATE_TEXT: Record<PdfAnchorState, string> = { placed: 'placed', moved: 'moved by a rebuild', unverified: 'kept (no text to check)', orphaned: 'needs re-anchoring' };

export function exportCsv(projectId: string, list: AnnotationView[]): string {
  void projectId;
  const rows: unknown[][] = [];
  for (const a of list) {
    rows.push([a.id, a.fileKey, a.page, a.kind, a.status, a.required ? 'yes' : 'no', a.author.name ?? a.author.username ?? '', a.createdAt, a.anchor.quote?.exact ?? (a.anchor.area ? '(area)' : ''), a.body, a.replacement ?? '',
      a.source ? (a.source.file ?? a.source.key ?? '') : '', a.source?.title ?? '', STATE_TEXT[a.anchorState]]);
    for (const rp of a.replies) rows.push([a.id, a.fileKey, a.page, 'reply', '', '', rp.author.name ?? rp.author.username ?? '', rp.createdAt, '', rp.body, '', '', '', '']);
  }
  return csvText(['Thread', 'PDF', 'Page', 'Type', 'Status', 'Required', 'Author', 'Created', 'On text', 'Comment', 'Replacement', 'Source', 'Source title', 'Placement'], rows);
}

const xmlEsc = (s: string): string => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c] as string))
  // characters XML 1.0 does not allow
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
/** PDF date (D:YYYYMMDDHHmmSS+00'00') of an ISO time. */
const pdfDate = (iso: string): string => `D:${iso.replace(/[-:T]/g, '').slice(0, 14)}+00'00'`;
const COLOUR: Record<PdfAnnotationKind, string> = { comment: '#FFD400', suggestion: '#2EA043', remark: '#3B82F6' };
const XSTATE: Record<PdfAnnotationStatus, string> = { open: 'None', resolved: 'Completed', accepted: 'Accepted', rejected: 'Rejected' };
const fmt = (n: number): string => String(Math.round(n * 100) / 100);

/** XFDF (ISO 19444-1): highlights for text, squares for areas, replies and the review state as <text inreplyto>, so a PDF reader can import them. */
export function exportXfdf(fileKey: string, list: AnnotationView[]): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve">', '<annots>'];
  for (const a of list) {
    const rects: Rect[] = a.anchor.rects.length ? a.anchor.rects : [[0, 0, 0, 0]];
    const box = rects.reduce<Rect>((u, r) => [Math.min(u[0], r[0]), Math.min(u[1], r[1]), Math.max(u[2], r[2]), Math.max(u[3], r[3])], [...rects[0]] as Rect);
    const who = xmlEsc(a.author.name ?? a.author.username ?? '');
    const subject = a.kind === 'suggestion' ? 'Suggested change' : a.kind === 'remark' ? 'Review remark' : 'Comment';
    const text = a.kind === 'suggestion' ? `${a.body ? `${a.body}\n` : ''}Replace${a.anchor.quote ? ` “${a.anchor.quote.exact}”` : ''} with: “${a.replacement ?? ''}”` : a.body;
    const common = `page="${a.page - 1}" rect="${box.map(fmt).join(',')}" name="${xmlEsc(a.id)}" title="${who}" subject="${subject}" date="${pdfDate(a.updatedAt)}" creationdate="${pdfDate(a.createdAt)}" color="${COLOUR[a.kind]}" flags="print"`;
    if (a.anchor.area) out.push(`<square ${common}><contents>${xmlEsc(text)}</contents></square>`);
    else {
      // QuadPoints per line: upper left, upper right, lower left, lower right
      const coords = rects.map((r) => [r[0], r[3], r[2], r[3], r[0], r[1], r[2], r[1]].map(fmt).join(',')).join(',');
      out.push(`<highlight ${common} coords="${coords}"><contents>${xmlEsc(text)}</contents></highlight>`);
    }
    for (const rp of a.replies) {
      out.push(`<text page="${a.page - 1}" rect="${box.map(fmt).join(',')}" name="${xmlEsc(rp.id)}" inreplyto="${xmlEsc(a.id)}" title="${xmlEsc(rp.author.name ?? rp.author.username ?? '')}" date="${pdfDate(rp.createdAt)}" creationdate="${pdfDate(rp.createdAt)}" flags="print,nozoom,norotate" icon="Comment"><contents>${xmlEsc(rp.body)}</contents></text>`);
    }
    if (a.status !== 'open') {
      out.push(`<text page="${a.page - 1}" rect="${box.map(fmt).join(',')}" name="${xmlEsc(`${a.id}-state`)}" inreplyto="${xmlEsc(a.id)}" title="${xmlEsc(a.statusBy ?? '')}" date="${pdfDate(a.statusAt ?? a.updatedAt)}" state="${XSTATE[a.status]}" statemodel="Review" flags="hidden,print,nozoom,norotate" icon="Comment"><contents>${XSTATE[a.status]}</contents></text>`);
    }
  }
  out.push('</annots>', `<f href="${xmlEsc(fileKey.split('/').pop() ?? fileKey)}"/>`, '</xfdf>', '');
  return out.join('\n');
}

// ── Project archive (Phase 8, docs/phase3/cleanup-backend.md item 8) ─────────────────────────────────────────────────────────────

/** What the project archive carries (`pdf-review.json`): every thread with its replies, the versions seen of each reviewed PDF, the setting. */
export interface ReviewArchive {
  version: 1;
  blockRelease: boolean;
  versions: Array<{ fileKey: string; hash: string; pages: number | null; seenAt: string }>;
  annotations: Array<{
    id: string; fileKey: string; kind: PdfAnnotationKind; status: PdfAnnotationStatus; required: boolean; body: string; replacement: string | null;
    page: number; anchor: StoredAnchor; fileHash: string; anchorState: PdfAnchorState; orig: { page: number; hash: string; quote: string | null };
    source: SourceRef | null; author: string | null; createdAt: string; updatedAt: string; statusBy: string | null; statusAt: string | null;
    replies: Array<{ body: string; author: string | null; createdAt: string }>;
  }>;
}

/** The project's PDF review for its archive, or null when it has none (no thread, no version seen, the setting off). */
export function exportReview(projectId: string): ReviewArchive | null {
  const rows = repos.pdfAnnotations.list(projectId);
  const replies = repos.pdfAnnotations.replies(rows.map((r) => r.id));
  const versions = repos.pdfAnnotations.allVersions(projectId).map((v) => ({ fileKey: v.file_key, hash: v.hash, pages: v.pages, seenAt: v.seen_at }));
  const blockRelease = repos.pdfAnnotations.getBlockRelease(projectId);
  if (!rows.length && !versions.length && !blockRelease) return null;
  const who = (name: string | null | undefined, username: string | null | undefined): string | null => name || username || null;
  return {
    version: 1, blockRelease, versions,
    annotations: rows.map((r) => {
      const v = viewOf(r, replies);
      return {
        id: v.id, fileKey: v.fileKey, kind: v.kind, status: v.status, required: v.required, body: v.body, replacement: v.replacement, page: v.page,
        anchor: v.anchor, fileHash: v.fileHash, anchorState: v.anchorState, orig: v.orig, source: v.source, author: who(r.author_name, r.author_username),
        createdAt: v.createdAt, updatedAt: v.updatedAt, statusBy: r.status_name ?? r.status_username ?? null, statusAt: v.statusAt,
        replies: v.replies.map((x) => ({ body: x.body, author: who(x.author.name, x.author.username), createdAt: x.createdAt })),
      };
    }),
  };
}

/**
 * An anchor from an archive, checked as a request's (cleanAnchor) but kept as it was stored: re-anchoring stores the quote's context exactly
 * as read from the PDF (spaces at its ends included) and may mark the match approximate (`fuzzy`); trimming either would change the anchor.
 */
function archivedAnchor(raw: unknown): StoredAnchor {
  const checked = cleanAnchor(raw) as StoredAnchor & { fuzzy?: boolean };
  const r = raw as { quote?: Record<string, unknown>; fuzzy?: unknown };
  const str = (s: unknown, max: number): string | null => (typeof s === 'string' && s.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s) ? s : null);
  if (checked.quote && r.quote) {
    const exact = str(r.quote.exact, 2000); const prefix = str(r.quote.prefix ?? '', 200); const suffix = str(r.quote.suffix ?? '', 200);
    if (exact !== null && exact.trim() && prefix !== null && suffix !== null) checked.quote = { exact, prefix, suffix };
  }
  if (r.fuzzy === true) checked.fuzzy = true;
  return checked;
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const SHA256_HEX = /^[0-9a-f]{64}$/i;
const ANCHOR_STATES: PdfAnchorState[] = ['placed', 'moved', 'unverified', 'orphaned'];

/**
 * Bring an archive's PDF review into a NEW project (the archive import). Every thread gets a new id and its replies new ids under it; the
 * anchors, the PDF version each was placed on and where it was first made are kept, so the first listing of the PDF re-anchors them exactly
 * as after a rebuild (a build's PDF is not in the archive: the first build of the imported project is a new version). The people are this
 * installation's: as for the review comments, the importer becomes the author and each text starts with its first author's name and date.
 * The archive is untrusted: every field is checked as a request's would be (kind, status, page, anchor, file key, hash, time, sizes); a
 * thread that fails is left out and named in `notes`.
 */
export function importReview(projectId: string, importer: { id: string }, raw: unknown): { annotations: number; replies: number; notes: string[] } {
  const notes: string[] = []; let annotations = 0; let replies = 0;
  const data = (raw && typeof raw === 'object' ? raw : {}) as Partial<ReviewArchive>;
  const now = nowIso();
  const at = (s: unknown): string => (typeof s === 'string' && ISO_TIME.test(s) ? s : now);
  const by = (name: unknown, when: unknown): string => (name ? `[${clean(name, 60)}${typeof when === 'string' && ISO_TIME.test(when) ? `, ${when.slice(0, 10)}` : ''}] ` : '');
  const hashOr = (s: unknown, d: string): string => (SHA256_HEX.test(String(s ?? '')) ? String(s).toLowerCase() : d);
  for (const v of Array.isArray(data.versions) ? data.versions.slice(0, 10000) : []) {
    try {
      const hash = hashOr(v?.hash, ''); if (!hash) continue;
      const pages = Number.isInteger(v?.pages) && Number(v.pages) > 0 ? Number(v.pages) : null;
      repos.pdfAnnotations.noteVersion({ project_id: projectId, file_key: cleanKey(v?.fileKey), hash, pages, seen_at: at(v?.seenAt) });
    } catch { /* a bad version row is left out */ }
  }
  for (const a of Array.isArray(data.annotations) ? data.annotations.slice(0, 20000) : []) {
    try {
      const kind = String(a?.kind) as PdfAnnotationKind;
      if (!KINDS.includes(kind)) throw bad(`unknown kind ${JSON.stringify(String(a?.kind)).slice(0, 40)}`, 'BAD_KIND');
      const status = (STATUSES.includes(String(a?.status) as PdfAnnotationStatus) ? String(a.status) : 'open') as PdfAnnotationStatus;
      const fileKey = cleanKey(a?.fileKey);
      const anchor = archivedAnchor(a?.anchor);
      const fileHash = hashOr(a?.fileHash, '');
      const origPage = Number.isInteger(a?.orig?.page) && Number(a.orig.page) >= 1 && Number(a.orig.page) <= 100000 ? Number(a.orig.page) : anchor.page;
      const state = ANCHOR_STATES.includes(String(a?.anchorState) as PdfAnchorState) ? String(a.anchorState) as PdfAnchorState : 'unverified';
      const src = a?.source && typeof a.source === 'object' ? JSON.stringify(a.source) : null;
      const id = crypto.randomUUID(); const updated = at(a?.updatedAt);
      repos.pdfAnnotations.insert({
        id, project_id: projectId, file_key: fileKey, kind, status, required: a?.required === true ? 1 : 0,
        body: `${by(a?.author, a?.createdAt)}${clean(a?.body, 4000)}`, replacement: kind === 'suggestion' ? clean(a?.replacement, 4000) : null,
        page: anchor.page, anchor: JSON.stringify(anchor), file_hash: fileHash, anchor_state: state, orig_page: origPage, orig_hash: hashOr(a?.orig?.hash, fileHash),
        orig_quote: a?.orig?.quote ? clean(a.orig.quote, 2000) : null, source: src && src.length <= 4000 ? src : null,
        created_by: importer.id, created_at: at(a?.createdAt), updated_at: updated,
        status_by: status === 'open' ? null : importer.id, status_at: status === 'open' ? null : at(a?.statusAt),
      });
      annotations++;
      for (const rp of Array.isArray(a?.replies) ? a.replies.slice(0, 1000) : []) {
        const text = clean(rp?.body, 4000); if (!text) continue;
        repos.pdfAnnotations.addReply({ id: crypto.randomUUID(), annotationId: id, body: `${by(rp?.author, rp?.createdAt)}${text}`, createdBy: importer.id, createdAt: at(rp?.createdAt) });
        replies++;
      }
      repos.pdfAnnotations.touch(id, updated);                          // addReply moved the thread's time to its reply's; it keeps its own
    } catch (e) { notes.push(`A PDF comment was not restored: ${(e as Error).message}`); }
  }
  if (data.blockRelease === true) repos.pdfAnnotations.setBlockRelease(projectId, true, importer.id, now);
  return { annotations, replies, notes };
}

// ── XFDF import (Phase 8, docs/phase3/cleanup-backend.md item 8) ─────────────────────────────────────────────────────────────────

export const XFDF_MAX_BYTES = 8 * 1024 * 1024;
const XFDF_MAX_ANNOTS = 5000;
const TEXT_MARKUP = new Set(['highlight', 'underline', 'strikeout', 'squiggly']);
const AREA_MARKUP = new Set(['square', 'circle', 'polygon', 'polyline', 'ink', 'freetext', 'line', 'stamp', 'text']);
const XSTATE_IN: Record<string, PdfAnnotationStatus> = { completed: 'resolved', accepted: 'resolved', rejected: 'resolved', cancelled: 'resolved', none: 'open' };
const nums = (s: string | null): number[] => String(s ?? '').split(/[\s,]+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n));
/** `D:20261128103000+05'30'` (or an ISO time) -> ISO, or null */
function xfdfDate(s: string | null): string | null {
  const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(String(s ?? ''));
  if (!m) return null;
  const iso = `${m[1]}-${m[2] ?? '01'}-${m[3] ?? '01'}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}Z`;
  return Number.isNaN(Date.parse(iso)) ? null : new Date(iso).toISOString();
}
function contentsOf(el: Element): string {
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 && (n as Element).localName === 'contents') return clean(n.textContent, 4000);
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 && (n as Element).localName === 'contents-richtext') return clean((n.textContent ?? '').replace(/\s+/g, ' '), 4000);
  return '';
}

/**
 * Comments made in a PDF reader (Acrobat and others export XFDF, ISO 19444-1) become threads on the version of the PDF now in the project.
 *   * text markup (highlight, underline, strikeout, squiggly): its QuadPoints (`coords`, 8 numbers per line) are the rectangles; the words
 *     under them, read from this PDF version as for a selection in the viewer, are the quote (with 40 characters of context), so the thread
 *     follows its words through rebuilds like any other; markup over no text becomes an area;
 *   * a shape, note, stamp or free text: an area (`rect`), with the text inside it as its quote when there is any;
 *   * `<text inreplyto>` without a state: a reply; with a Review state (Completed, Accepted, Rejected, Cancelled): the thread's status
 *     (resolved; an imported thread is a comment, so accepted / rejected, which belong to suggestions, become resolved too);
 *   * the reader's author (`title`) and date start the text; the person importing is the author in this installation.
 * The XFDF names no version of the PDF: the importer says which PDF (`key`) it belongs to and the anchors are made against the bytes on disk.
 * Untrusted input: XML safety as for an upload, size and count limits, every anchor through the same checks as a request's.
 */
export async function importXfdf(projectId: string, actor: Actor, rawKey: unknown, xfdf: unknown): Promise<{ created: AnnotationView[]; replies: number; skipped: string[] }> {
  const text = String(xfdf ?? '');
  if (!text.trim()) throw bad('Choose an XFDF file.', 'XFDF_EMPTY');
  if (Buffer.byteLength(text, 'utf8') > XFDF_MAX_BYTES) throw new HttpError(413, 'The XFDF file is larger than 8 MB.', 'XFDF_TOO_LARGE');
  checkXmlSafetyOf(text);                                               // refused with 400 UNSAFE_XML, as an upload
  let doc: Document;
  try { doc = new DOMParser({ onError: () => undefined }).parseFromString(text, 'text/xml') as unknown as Document; } catch { throw bad('That is not an XFDF file.', 'NOT_XFDF'); }
  if (!doc?.documentElement || doc.documentElement.localName !== 'xfdf') throw bad('That is not an XFDF file (no <xfdf> root).', 'NOT_XFDF');
  const file = fileState(projectId, rawKey);
  const annots = Array.from(doc.getElementsByTagName('*') as unknown as ArrayLike<Element>).filter((e) => e.parentNode && (e.parentNode as Element).localName === 'annots');
  if (annots.length > XFDF_MAX_ANNOTS) throw bad(`The XFDF file holds more than ${XFDF_MAX_ANNOTS} annotations.`, 'XFDF_TOO_MANY');
  const roots = annots.filter((a) => !a.getAttribute('inreplyto') && (TEXT_MARKUP.has(a.localName) || AREA_MARKUP.has(a.localName)));
  const answers = annots.filter((a) => a.getAttribute('inreplyto'));
  const skipped: string[] = [];
  for (const a of annots) if (!a.getAttribute('inreplyto') && !TEXT_MARKUP.has(a.localName) && !AREA_MARKUP.has(a.localName)) skipped.push(`<${a.localName}> is not a kind of comment this review keeps.`);
  const made = new Map<string, string>();                               // XFDF name -> new thread id
  const created: string[] = []; let replies = 0;
  await withPdfText(file.abs, file.hash, async (pdf) => {
    for (const a of roots) {
      const label = `<${a.localName}${a.getAttribute('name') ? ` name="${clean(a.getAttribute('name'), 60)}"` : ''}>`;
      try {
        const page = Math.trunc(Number(a.getAttribute('page'))) + 1;
        if (!Number.isInteger(page) || page < 1 || page > pdf.pages) throw new Error(`page ${a.getAttribute('page')} is not a page of this PDF`);
        const ix = await pdf.page(page);
        let rects: Rect[] = [];
        if (TEXT_MARKUP.has(a.localName)) {
          const c = nums(a.getAttribute('coords'));
          for (let i = 0; i + 7 < c.length; i += 8) { const xs = [c[i], c[i + 2], c[i + 4], c[i + 6]]; const ys = [c[i + 1], c[i + 3], c[i + 5], c[i + 7]]; rects.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]); }
        }
        const r = nums(a.getAttribute('rect'));
        const box: Rect | null = r.length === 4 ? [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])] : null;
        if (!rects.length && box) rects = [box];
        if (!rects.length) throw new Error('it has no place on the page (rect / coords)');
        // the words under it, from this version of the PDF
        let quote: Quote | null = null; let quoteBox: Rect | null = null;
        if (ix) {
          const hits = rects.map((x) => textInRect(ix, x)).filter((x): x is NonNullable<typeof x> => !!x);
          if (hits.length) {
            const start = Math.min(...hits.map((x) => x.start)); const end = Math.max(...hits.map((x) => x.end));
            const exact = clean(ix.text.slice(start, end), 2000).replace(/\s+/g, ' ');
            if (exact) { quote = { exact, ...contextOf(ix, start, end) }; quoteBox = unionRect(hits.flatMap((x) => rectsFor(ix, x.start, x.end))); }
          }
        }
        const area = !TEXT_MARKUP.has(a.localName) || !quote;
        const anchor = cleanAnchor(area ? { page, area: true, rects: [box ?? unionRect(rects)!], quote, quoteBox } : { page, rects, quote });
        const who = clean(a.getAttribute('title'), 60); const when = xfdfDate(a.getAttribute('creationdate') ?? a.getAttribute('date'));
        const body = `${who ? `[${who}${when ? `, ${when.slice(0, 10)}` : ''}] ` : ''}${contentsOf(a) || clean(a.getAttribute('subject'), 200) || '(no text)'}`;
        const kind: PdfAnnotationKind = /remark/i.test(String(a.getAttribute('subject') ?? '')) ? 'remark' : 'comment';
        const id = crypto.randomUUID(); const now = nowIso();
        const source = traceSource(projectId, anchor.quote?.exact ?? null);
        repos.pdfAnnotations.insert({
          id, project_id: projectId, file_key: file.key, kind, status: 'open', required: 0, body, replacement: null, page: anchor.page,
          anchor: JSON.stringify(anchor), file_hash: file.hash, anchor_state: anchor.quote || !anchor.area ? 'placed' : 'unverified', orig_page: anchor.page,
          orig_hash: file.hash, orig_quote: anchor.quote?.exact ?? null, source: source ? JSON.stringify(source) : null, created_by: actor.id,
          created_at: now, updated_at: now, status_by: null, status_at: null,
        });
        if (a.getAttribute('name')) made.set(String(a.getAttribute('name')), id);
        created.push(id);
      } catch (e) { skipped.push(`${label} was not imported: ${(e as Error).message}`); }
    }
  });
  // replies and review states, in document order, under the thread they answer (a reply to a reply goes to the same thread)
  const threadOf = new Map(made);
  for (const r of answers) {
    const parent = threadOf.get(String(r.getAttribute('inreplyto')));
    if (!parent) { skipped.push(`A reply to "${clean(r.getAttribute('inreplyto'), 60)}" names no imported comment.`); continue; }
    if (r.getAttribute('name')) threadOf.set(String(r.getAttribute('name')), parent);
    const state = String(r.getAttribute('state') ?? '').toLowerCase();
    const model = String(r.getAttribute('statemodel') ?? 'Review').toLowerCase();
    if (state && model === 'review' && XSTATE_IN[state]) { repos.pdfAnnotations.setStatus(parent, XSTATE_IN[state], actor.id, nowIso()); continue; }
    if (state) continue;                                                  // a Marked / Unmarked state is the reader's own bookkeeping
    const body = contentsOf(r); if (!body) continue;
    const who = clean(r.getAttribute('title'), 60); const when = xfdfDate(r.getAttribute('creationdate') ?? r.getAttribute('date'));
    repos.pdfAnnotations.addReply({ id: crypto.randomUUID(), annotationId: parent, body: `${who ? `[${who}${when ? `, ${when.slice(0, 10)}` : ''}] ` : ''}${body}`, createdBy: actor.id, createdAt: nowIso() });
    replies++;
  }
  if (created.length) push(projectId, file.key, 'created');
  return { created: created.map(fresh), replies, skipped };
}
