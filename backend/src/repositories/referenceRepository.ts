// The S1000D reference catalogues: sources, codes, "project available" ranges and DM-type advice (services/s1000dRef.ts holds the rules).

import { SqliteRepository } from './sqliteBase';
import type { SqlDatabase } from '../storage/sqlite';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface RefCodeRow { kind: string; issue: string; code: string; title: string; origin: 'brex' | 'custom'; source_id: string | null; rule_id: string | null; source_label?: string | null; created_at: string; updated_at: string }
export interface RefRangeRow { kind: string; issue: string; pattern: string; title: string; source_id: string | null; rule_id: string | null }
export interface RefSourceRow { id: string; kind: string; label: string; file: string | null; sha256: string | null; issue: string | null; limitation: string | null; loaded_at: string }

export interface ReferenceRepository {
  sourceSha(id: string): string | undefined;
  brexCodeCount(issue: string): number;
  /** Record a BREX source; a known one gets its new hash, file name and time. */
  upsertBrexSource(s: { id: string; label: string; file: string; sha256: string; issue: string; limitation: string; now: string }): void;
  /** Record an advice source; a known one gets its new hash and time. */
  upsertAdviceSource(s: { id: string; label: string; file: string; sha256: string; limitation: string | null; now: string }): void;
  upsertRange(r: { kind: string; issue: string; pattern: string; title: string; sourceId: string; ruleId: string }): void;
  /** Add or refresh a code read from a BREX; an administrator's own code of the same value is never overwritten. */
  upsertBrexCode(c: { kind: string; issue: string; code: string; title: string; sourceId: string; ruleId: string; now: string }): void;
  addDmTypeAdvice(schema: string, code: string, sourceId: string): void;
  listRanges(kind: string, issue: string): RefRangeRow[];
  listCodes(kind: string, issue: string): RefCodeRow[];
  getCode(kind: string, issue: string, code: string): RefCodeRow | undefined;
  listSources(): RefSourceRow[];
  countCodes(kind: string, issue: string): { n: number; custom: number };
  dmTypeAdvice(): Array<{ schema: string; code: string }>;
  insertCustomCode(c: { kind: string; issue: string; code: string; title: string; now: string }): void;
  /** Insert a custom code unless one with that key exists (the carry-over of the retired flat tables). */
  insertCustomCodeIfAbsent(c: { kind: string; issue: string; code: string; title: string; now: string }): void;
  setCodeTitle(kind: string, issue: string, code: string, title: string, now: string): void;
  /** Delete a code, and take it out of the selection of every project configured for that issue. */
  deleteCode(kind: string, issue: string, code: string): void;
}

export class SqliteReferenceRepository extends SqliteRepository implements ReferenceRepository {
  constructor(db: SqlDatabase) { super(db); }

  sourceSha(id: string): string | undefined { return (this.q('SELECT sha256 FROM ref_sources WHERE id = ?').get(id) as any)?.sha256; }
  brexCodeCount(issue: string): number { return Number((this.q("SELECT COUNT(*) AS n FROM ref_codes WHERE issue = ? AND origin = 'brex'").get(issue) as any).n); }
  upsertBrexSource(s: { id: string; label: string; file: string; sha256: string; issue: string; limitation: string; now: string }): void {
    this.q(`INSERT INTO ref_sources (id, kind, label, file, sha256, issue, limitation, loaded_at) VALUES (?,?,?,?,?,?,?,?)
                  ON CONFLICT(id) DO UPDATE SET sha256 = excluded.sha256, file = excluded.file, loaded_at = excluded.loaded_at`)
      .run(s.id, 'brex', s.label, s.file, s.sha256, s.issue, s.limitation, s.now);
  }
  upsertAdviceSource(s: { id: string; label: string; file: string; sha256: string; limitation: string | null; now: string }): void {
    this.q(`INSERT INTO ref_sources (id, kind, label, file, sha256, issue, limitation, loaded_at) VALUES (?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET sha256 = excluded.sha256, loaded_at = excluded.loaded_at`)
      .run(s.id, 'advice', s.label, s.file, s.sha256, null, s.limitation, s.now);
  }
  upsertRange(r: { kind: string; issue: string; pattern: string; title: string; sourceId: string; ruleId: string }): void {
    this.q(`INSERT INTO ref_code_ranges (kind, issue, pattern, title, source_id, rule_id) VALUES (?,?,?,?,?,?)
                        ON CONFLICT(kind, issue, pattern) DO UPDATE SET title = excluded.title, source_id = excluded.source_id, rule_id = excluded.rule_id`)
      .run(r.kind, r.issue, r.pattern, r.title, r.sourceId, r.ruleId);
  }
  upsertBrexCode(c: { kind: string; issue: string; code: string; title: string; sourceId: string; ruleId: string; now: string }): void {
    this.q(`INSERT INTO ref_codes (kind, issue, code, title, origin, source_id, rule_id, created_at, updated_at) VALUES (?,?,?,?, 'brex', ?,?,?,?)
                      ON CONFLICT(kind, issue, code) DO UPDATE SET title = excluded.title, source_id = excluded.source_id, rule_id = excluded.rule_id, updated_at = excluded.updated_at
                      WHERE ref_codes.origin = 'brex'`)
      .run(c.kind, c.issue, c.code, c.title, c.sourceId, c.ruleId, c.now, c.now);
  }
  addDmTypeAdvice(schema: string, code: string, sourceId: string): void {
    this.q('INSERT OR IGNORE INTO ref_dmtype_codes (schema, code, source_id) VALUES (?,?,?)').run(schema, code, sourceId);
  }
  listRanges(kind: string, issue: string): RefRangeRow[] { return this.q('SELECT * FROM ref_code_ranges WHERE kind = ? AND issue = ? ORDER BY pattern').all(kind, issue); }
  listCodes(kind: string, issue: string): RefCodeRow[] {
    return this.q(`SELECT c.*, s.label AS source_label FROM ref_codes c LEFT JOIN ref_sources s ON s.id = c.source_id
                        WHERE c.kind = ? AND c.issue = ? ORDER BY c.code`).all(kind, issue);
  }
  getCode(kind: string, issue: string, code: string): RefCodeRow | undefined {
    return this.q(`SELECT c.*, s.label AS source_label FROM ref_codes c LEFT JOIN ref_sources s ON s.id = c.source_id WHERE c.kind = ? AND c.issue = ? AND c.code = ?`)
      .get(kind, issue, code);
  }
  listSources(): RefSourceRow[] { return this.q('SELECT * FROM ref_sources ORDER BY id').all(); }
  countCodes(kind: string, issue: string): { n: number; custom: number } {
    const r: any = this.q(`SELECT COUNT(*) AS n, SUM(origin = 'custom') AS custom FROM ref_codes WHERE kind = ? AND issue = ?`).get(kind, issue);
    return { n: Number(r.n), custom: Number(r.custom ?? 0) };
  }
  dmTypeAdvice(): Array<{ schema: string; code: string }> { return this.q('SELECT schema, code FROM ref_dmtype_codes ORDER BY schema, code').all(); }
  insertCustomCode(c: { kind: string; issue: string; code: string; title: string; now: string }): void {
    this.q(`INSERT INTO ref_codes (kind, issue, code, title, origin, source_id, rule_id, created_at, updated_at) VALUES (?,?,?,?, 'custom', NULL, NULL, ?, ?)`).run(c.kind, c.issue, c.code, c.title, c.now, c.now);
  }
  insertCustomCodeIfAbsent(c: { kind: string; issue: string; code: string; title: string; now: string }): void {
    this.q(`INSERT OR IGNORE INTO ref_codes (kind, issue, code, title, origin, source_id, rule_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'custom', NULL, NULL, ?, ?)`)
      .run(c.kind, c.issue, c.code, c.title, c.now, c.now);
  }
  setCodeTitle(kind: string, issue: string, code: string, title: string, now: string): void {
    this.q('UPDATE ref_codes SET title = ?, updated_at = ? WHERE kind = ? AND issue = ? AND code = ?').run(title, now, kind, issue, code);
  }
  deleteCode(kind: string, issue: string, code: string): void {
    this.q('DELETE FROM ref_codes WHERE kind = ? AND issue = ? AND code = ?').run(kind, issue, code);
    // A project that had selected it no longer lists it; its data modules are untouched.
    this.q('DELETE FROM project_codes WHERE kind = ? AND code = ? AND project_id IN (SELECT project_id FROM project_config WHERE json_extract(data, \'$.issue\') = ?)').run(kind, code, issue);
  }
}
