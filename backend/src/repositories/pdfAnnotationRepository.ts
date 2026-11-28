// =============================================================================
// PDF review annotations (Phase 3, P3-4; migration 028-pdf-annotations). Behind an interface like every repository (WP-10, PRD-002).
// Threads anchored on a page of a project PDF, their replies, the versions of each reviewed PDF, and the per-project release setting.
// Named "pdf annotations" on purpose: the editors' live comments (collaboration) are a different model in the document itself.
// =============================================================================

import { SqliteRepository } from './sqliteBase';

export type PdfAnnotationKind = 'comment' | 'suggestion' | 'remark';
export type PdfAnnotationStatus = 'open' | 'resolved' | 'accepted' | 'rejected';
export type PdfAnchorState = 'placed' | 'moved' | 'unverified' | 'orphaned';

export interface PdfAnnotationRow {
  id: string; project_id: string; file_key: string; kind: PdfAnnotationKind; status: PdfAnnotationStatus; required: number;
  body: string; replacement: string | null; page: number; anchor: string; file_hash: string; anchor_state: PdfAnchorState;
  orig_page: number; orig_hash: string; orig_quote: string | null; source: string | null;
  created_by: string; created_at: string; updated_at: string; status_by: string | null; status_at: string | null;
  // joined
  author_username?: string | null; author_name?: string | null; status_username?: string | null; status_name?: string | null;
}
export interface PdfReplyRow { id: string; annotation_id: string; body: string; created_by: string; created_at: string; author_username?: string | null; author_name?: string | null }
export interface PdfVersionRow { project_id: string; file_key: string; hash: string; pages: number | null; seen_at: string }

export interface PdfAnnotationRepository {
  insert(a: Omit<PdfAnnotationRow, 'author_username' | 'author_name' | 'status_username' | 'status_name'>): void;
  get(id: string): PdfAnnotationRow | null;
  /** A project's annotations (of one file when `fileKey` is given), oldest first. */
  list(projectId: string, fileKey?: string | null): PdfAnnotationRow[];
  replies(annotationIds: string[]): PdfReplyRow[];
  addReply(r: { id: string; annotationId: string; body: string; createdBy: string; createdAt: string }): void;
  getReply(id: string): PdfReplyRow | null;
  setStatus(id: string, status: PdfAnnotationStatus, by: string, at: string): void;
  /** Body, replacement and the required flag; only when `expectedUpdatedAt` is still the row's updated_at (true when the row changed). */
  edit(id: string, f: { body: string; replacement: string | null; required: number }, at: string, expectedUpdatedAt: string | null): boolean;
  /** A new placement: page, anchor JSON, the file version it belongs to and its state (re-anchoring, or placed again by hand). */
  place(id: string, p: { page: number; anchor: string; fileHash: string; state: PdfAnchorState; source?: string | null }, at: string): void;
  remove(id: string): void;
  counts(projectId: string): { open: number; openRequired: number; total: number };
  noteVersion(v: PdfVersionRow): void;
  versions(projectId: string, fileKey: string): PdfVersionRow[];
  getBlockRelease(projectId: string): boolean;
  setBlockRelease(projectId: string, on: boolean, by: string, at: string): void;
}

const ROW = `SELECT a.*, u.username AS author_username, u.full_name AS author_name, su.username AS status_username, su.full_name AS status_name
             FROM pdf_annotations a LEFT JOIN users u ON u.id = a.created_by LEFT JOIN users su ON su.id = a.status_by`;

export class SqlitePdfAnnotationRepository extends SqliteRepository implements PdfAnnotationRepository {
  insert(a: Omit<PdfAnnotationRow, 'author_username' | 'author_name' | 'status_username' | 'status_name'>): void {
    this.q(`INSERT INTO pdf_annotations (id, project_id, file_key, kind, status, required, body, replacement, page, anchor, file_hash, anchor_state,
              orig_page, orig_hash, orig_quote, source, created_by, created_at, updated_at, status_by, status_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(a.id, a.project_id, a.file_key, a.kind, a.status, a.required, a.body, a.replacement, a.page, a.anchor, a.file_hash, a.anchor_state,
        a.orig_page, a.orig_hash, a.orig_quote, a.source, a.created_by, a.created_at, a.updated_at, a.status_by, a.status_at);
  }
  get(id: string): PdfAnnotationRow | null { return (this.q(`${ROW} WHERE a.id = ?`).get(id) as PdfAnnotationRow | undefined) ?? null; }
  list(projectId: string, fileKey?: string | null): PdfAnnotationRow[] {
    if (fileKey) return this.q(`${ROW} WHERE a.project_id = ? AND a.file_key = ? ORDER BY a.created_at, a.id`).all(projectId, fileKey) as unknown as PdfAnnotationRow[];
    return this.q(`${ROW} WHERE a.project_id = ? ORDER BY a.created_at, a.id`).all(projectId) as unknown as PdfAnnotationRow[];
  }
  replies(annotationIds: string[]): PdfReplyRow[] {
    if (!annotationIds.length) return [];
    const out: PdfReplyRow[] = [];
    // one statement per id keeps the statement cache bounded (fixed SQL text only)
    for (const id of annotationIds) {
      out.push(...(this.q(`SELECT r.*, u.username AS author_username, u.full_name AS author_name FROM pdf_annotation_replies r LEFT JOIN users u ON u.id = r.created_by
                            WHERE r.annotation_id = ? ORDER BY r.created_at, r.id`).all(id) as unknown as PdfReplyRow[]));
    }
    return out;
  }
  addReply(r: { id: string; annotationId: string; body: string; createdBy: string; createdAt: string }): void {
    this.q('INSERT INTO pdf_annotation_replies (id, annotation_id, body, created_by, created_at) VALUES (?,?,?,?,?)').run(r.id, r.annotationId, r.body, r.createdBy, r.createdAt);
    this.q('UPDATE pdf_annotations SET updated_at = ? WHERE id = ?').run(r.createdAt, r.annotationId);
  }
  getReply(id: string): PdfReplyRow | null { return (this.q('SELECT * FROM pdf_annotation_replies WHERE id = ?').get(id) as PdfReplyRow | undefined) ?? null; }
  setStatus(id: string, status: PdfAnnotationStatus, by: string, at: string): void {
    this.q('UPDATE pdf_annotations SET status = ?, status_by = ?, status_at = ?, updated_at = ? WHERE id = ?').run(status, by, at, at, id);
  }
  edit(id: string, f: { body: string; replacement: string | null; required: number }, at: string, expectedUpdatedAt: string | null): boolean {
    const r = expectedUpdatedAt
      ? this.q('UPDATE pdf_annotations SET body = ?, replacement = ?, required = ?, updated_at = ? WHERE id = ? AND updated_at = ?').run(f.body, f.replacement, f.required, at, id, expectedUpdatedAt)
      : this.q('UPDATE pdf_annotations SET body = ?, replacement = ?, required = ?, updated_at = ? WHERE id = ?').run(f.body, f.replacement, f.required, at, id);
    return Number(r.changes) === 1;
  }
  place(id: string, p: { page: number; anchor: string; fileHash: string; state: PdfAnchorState; source?: string | null }, at: string): void {
    if (p.source === undefined) this.q('UPDATE pdf_annotations SET page = ?, anchor = ?, file_hash = ?, anchor_state = ?, updated_at = ? WHERE id = ?').run(p.page, p.anchor, p.fileHash, p.state, at, id);
    else this.q('UPDATE pdf_annotations SET page = ?, anchor = ?, file_hash = ?, anchor_state = ?, source = ?, updated_at = ? WHERE id = ?').run(p.page, p.anchor, p.fileHash, p.state, p.source, at, id);
  }
  remove(id: string): void { this.q('DELETE FROM pdf_annotations WHERE id = ?').run(id); }
  counts(projectId: string): { open: number; openRequired: number; total: number } {
    const r = this.q(`SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open,
                             SUM(CASE WHEN status = 'open' AND required = 1 THEN 1 ELSE 0 END) AS req
                      FROM pdf_annotations WHERE project_id = ?`).get(projectId) as { total: number; open: number | null; req: number | null };
    return { total: Number(r.total) || 0, open: Number(r.open) || 0, openRequired: Number(r.req) || 0 };
  }
  noteVersion(v: PdfVersionRow): void {
    this.q('INSERT OR IGNORE INTO pdf_review_versions (project_id, file_key, hash, pages, seen_at) VALUES (?,?,?,?,?)').run(v.project_id, v.file_key, v.hash, v.pages, v.seen_at);
  }
  versions(projectId: string, fileKey: string): PdfVersionRow[] {
    return this.q('SELECT * FROM pdf_review_versions WHERE project_id = ? AND file_key = ? ORDER BY seen_at, hash').all(projectId, fileKey) as unknown as PdfVersionRow[];
  }
  getBlockRelease(projectId: string): boolean {
    const r = this.q('SELECT block_release FROM pdf_review_settings WHERE project_id = ?').get(projectId) as { block_release: number } | undefined;
    return !!r && Number(r.block_release) === 1;
  }
  setBlockRelease(projectId: string, on: boolean, by: string, at: string): void {
    this.q(`INSERT INTO pdf_review_settings (project_id, block_release, updated_by, updated_at) VALUES (?,?,?,?)
            ON CONFLICT(project_id) DO UPDATE SET block_release = excluded.block_release, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .run(projectId, on ? 1 : 0, by, at);
  }
}
