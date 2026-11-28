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
import { cleanRects, foldCompact, reanchor, type Quote, type Rect, type StoredAnchor } from '../../shared/pdfAnchor';
import type { PdfAnnotationRow, PdfAnnotationStatus, PdfAnnotationKind, PdfAnchorState, PdfReplyRow } from '../../repositories/pdfAnnotationRepository';
import { identityOf, listReviewFiles, resolveReviewFile, type ReviewFile } from './files';
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
