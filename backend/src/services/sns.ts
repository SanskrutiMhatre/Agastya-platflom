// =============================================================================
// Standard numbering system (SNS).
//
// TWO LEVELS OF OWNERSHIP
//   global presets   reusable starting points the Administrator maintains (sns_presets / sns_preset_nodes). The S1000D Issue 4.2
//                    "Maintained SNS" tables (Chap 8.2.1 - 8.2.8) ship as read-only presets; the Administrator may add custom ones.
//   project SNS      the hierarchy a PROJECT owns (project_sns). It starts empty or from a preset, and from then on is the project's
//                    own: changing a preset never changes a project.
//
// THE HIERARCHY
//   level 1  system                       2-3 characters   ->  DMC systemCode
//   level 2  subsystem (sub + sub-sub)    2 characters     ->  DMC subSystemCode (1st) + subSubSystemCode (2nd)
//   level 3  assembly                     2 or 4 chars     ->  DMC assyCode
//   This is how the S1000D tables print it ("-10" under system 21), and how the DMC splits it. A node's path is its codes joined by
//   "/" ("21", "21/10", "21/10/00"), so a node's parent is determined by its own path: a node cannot be its own ancestor and a cycle
//   cannot be expressed. The API still checks that every node's parent exists and that no path appears twice.
//
// SAFETY
//   - a node with children is not deleted unless the caller asks for the whole branch;
//   - a node that data modules already use cannot be deleted or have its code changed (the DMC would stop matching the SNS);
//   - nothing here edits a data module.
// =============================================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { nowIso } from '../config';
import { store, projectDirFor } from '../context';
import { bad, conflict, notFound } from './http';
import { csvRow } from './csv';
import { readProjectJson, csdbRel } from './projects';

const { newId } = require('../core/auth/crypto');
const dbh = () => store.db;

export const LEVELS = [
  { level: 1, name: 'System', pattern: /^[A-Z0-9]{2,3}$/, hint: '2 or 3 letters/digits' },
  { level: 2, name: 'Subsystem', pattern: /^[A-Z0-9]{2}$/, hint: '2 letters/digits (subsystem + sub-subsystem, e.g. 10)' },
  { level: 3, name: 'Assembly', pattern: /^(?:[A-Z0-9]{2}|[A-Z0-9]{4})$/, hint: '2 or 4 letters/digits' },
] as const;

export interface SnsNode { path: string; level: number; code: string; title: string; presetId?: string | null; children?: SnsNode[]; used?: number }

const cleanTitle = (raw: unknown): string => {
  const t = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (t.length > 300) throw bad('That title is too long.');
  return t;
};
export const parentPath = (p: string): string => p.split('/').slice(0, -1).join('/');
export const levelOfPath = (p: string): number => p.split('/').length;

/** Validate a code for its level and return it upper-cased. */
export function cleanCode(level: number, raw: unknown): string {
  const L = LEVELS[level - 1];
  if (!L) throw bad('An SNS has three levels: system, subsystem and assembly.', 'BAD_LEVEL');
  const code = String(raw ?? '').trim().toUpperCase();
  if (!L.pattern.test(code)) throw bad(`${L.name} code: ${L.hint}.`, 'BAD_CODE');
  return code;
}

// ── Presets (global) ─────────────────────────────────────────────────────────

let presetsSeeded = false;
export function seedPresets(): number {
  const file = path.join(__dirname, '..', '..', 'reference', 'sns-presets-4.2.json');
  const raw = fs.readFileSync(file);
  const j = JSON.parse(raw.toString('utf8'));
  const sha = crypto.createHash('sha256').update(raw).digest('hex');
  const db = dbh(); const now = nowIso(); let n = 0;
  db.exec('BEGIN');
  try {
    for (const p of j.presets) {
      const id = `spec42-${String(p.chapter).replace(/\./g, '-')}`;
      const source = `S1000D Issue 4.2, Chap ${p.chapter} Maintained SNS - ${p.name} (${j.provenance.file}, pages ${j.provenance.pages}, sha256 ${sha.slice(0, 12)}…)`;
      const have: any = db.prepare('SELECT source FROM sns_presets WHERE id = ?').get(id);
      if (have?.source === source && Number((db.prepare('SELECT COUNT(*) AS n FROM sns_preset_nodes WHERE preset_id = ?').get(id) as any).n) === p.nodes.length) { n += p.nodes.length; continue; }   // unchanged
      db.prepare(`INSERT INTO sns_presets (id, name, source, limitation, created_at) VALUES (?,?,?,?,?)
                  ON CONFLICT(id) DO UPDATE SET source = excluded.source, limitation = excluded.limitation`)
        .run(id, `S1000D 4.2 · ${p.name}`, source, j.limitation, now);
      db.prepare('DELETE FROM sns_preset_nodes WHERE preset_id = ?').run(id);       // read-only preset: the file is the source of truth
      for (const node of p.nodes) {
        db.prepare('INSERT INTO sns_preset_nodes (preset_id, path, level, code, title, definition) VALUES (?,?,?,?,?,?)')
          .run(id, node.path, node.level, node.code, node.title ?? '', JSON.stringify({
            definition: node.definition || '', ...(node.rangeEnd ? { rangeEnd: node.rangeEnd } : {}), ...(node.ambiguous ? { ambiguous: true, variant: node.variant } : {}),
            ...(node.category ? { category: true } : {}), ...(node.categoryCode ? { categoryCode: node.categoryCode } : {}),
            ...(node.captionTitle ? { captionTitle: node.captionTitle } : {}), ...(node.indexTitle ? { indexTitle: node.indexTitle } : {}),
          }));
        n++;
      }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  presetsSeeded = true;
  return n;
}
export function ensurePresets(): void { if (!presetsSeeded) seedPresets(); }

export interface PresetSummary { id: string; name: string; source: string; limitation: string | null; readOnly: boolean; systems: number; entries: number; /** The model code this SNS belongs to (a project with that model code is offered it), or null. */ model: string | null }

export function listPresets(): PresetSummary[] {
  ensurePresets();
  return dbh().prepare(`SELECT p.*, (SELECT COUNT(*) FROM sns_preset_nodes n WHERE n.preset_id = p.id AND n.level = 1) AS systems,
                               (SELECT COUNT(*) FROM sns_preset_nodes n WHERE n.preset_id = p.id) AS entries FROM sns_presets p ORDER BY p.id`).all()
    .map((r: any) => ({ id: r.id, name: r.name, source: r.source, limitation: r.limitation, readOnly: String(r.id).startsWith('spec42-'), systems: Number(r.systems), entries: Number(r.entries), model: r.model_code ?? null }));
}

export function getPreset(id: string): { preset: PresetSummary; nodes: Array<SnsNode & { definition: string; note?: Record<string, unknown> }> } {
  const preset = listPresets().find((p) => p.id === id);
  if (!preset) throw notFound('No such SNS preset.');
  const rows = dbh().prepare('SELECT * FROM sns_preset_nodes WHERE preset_id = ? ORDER BY rowid').all(id) as any[];
  return {
    preset,
    nodes: rows.map((r) => {
      let note: any = {};
      try { note = JSON.parse(r.definition || '{}'); } catch { note = { definition: r.definition }; }
      return { path: r.path, level: r.level, code: r.code, title: r.title, definition: note.definition ?? '', note };
    }),
  };
}

/** Create an empty custom preset (the Administrator's own). */
const MODEL_RE = /^[A-Za-z0-9]{2,14}$/;
const cleanModel = (raw: unknown): string | null => { const m = String(raw ?? '').trim().toUpperCase(); if (!m) return null; if (!MODEL_RE.test(m)) throw bad('A model code is 2 to 14 letters or digits.', 'BAD_MIC'); return m; };

export function createPreset(rawName: unknown, rawModel?: unknown): PresetSummary {
  ensurePresets();
  const name = String(rawName ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw bad('A preset name is required.', 'FIELD_REQUIRED');
  if (name.length > 100) throw bad('That name is too long.');
  if (dbh().prepare('SELECT 1 FROM sns_presets WHERE lower(name) = lower(?)').get(name)) throw conflict(`A preset named "${name}" already exists.`, 'DUPLICATE');
  const model = cleanModel(rawModel);
  const id = `custom-${newId()}`;
  dbh().prepare('INSERT INTO sns_presets (id, name, source, limitation, created_at, model_code) VALUES (?,?,?,?,?,?)').run(id, name, 'Created by an Administrator', null, nowIso(), model);
  return listPresets().find((p) => p.id === id)!;
}

/** Set (or clear) the model code of a custom preset. */
export function setPresetModel(id: string, rawModel: unknown): PresetSummary {
  assertCustom(id);
  dbh().prepare('UPDATE sns_presets SET model_code = ? WHERE id = ?').run(cleanModel(rawModel), id);
  return listPresets().find((p) => p.id === id)!;
}

function assertCustom(id: string): void {
  const p = dbh().prepare('SELECT id FROM sns_presets WHERE id = ?').get(id);
  if (!p) throw notFound('No such SNS preset.');
  if (String(id).startsWith('spec42-')) throw conflict('A preset taken from the S1000D specification is read-only: its source is the specification. Copy it into a custom preset to change it.', 'READ_ONLY');
}

export function deletePreset(id: string): void {
  assertCustom(id);
  dbh().prepare('DELETE FROM sns_preset_nodes WHERE preset_id = ?').run(id);
  dbh().prepare('DELETE FROM sns_presets WHERE id = ?').run(id);                      // projects keep the nodes they copied
}

/** Copy any preset into a new custom one. */
export function duplicatePreset(id: string, rawName: unknown): PresetSummary {
  const src = getPreset(id);
  const np = createPreset(rawName ?? `${src.preset.name} (copy)`);
  const ins = dbh().prepare('INSERT INTO sns_preset_nodes (preset_id, path, level, code, title, definition) VALUES (?,?,?,?,?,?)');
  for (const n of src.nodes) if (n.level >= 1 && !n.note?.category) ins.run(np.id, n.path, n.level, n.code, n.title, JSON.stringify({ definition: n.definition }));
  return listPresets().find((p) => p.id === np.id)!;
}

/** Add or retitle one node of a custom preset. Parent must exist. */
export function putPresetNode(id: string, rawPath: unknown, rawTitle: unknown): void {
  assertCustom(id);
  const { path: p, level } = normalisePath(rawPath);
  if (level > 1 && !dbh().prepare('SELECT 1 FROM sns_preset_nodes WHERE preset_id = ? AND path = ?').get(id, parentPath(p))) throw bad(`Add ${parentPath(p)} first: a ${LEVELS[level - 1].name.toLowerCase()} belongs to its parent.`, 'NO_PARENT');
  dbh().prepare(`INSERT INTO sns_preset_nodes (preset_id, path, level, code, title, definition) VALUES (?,?,?,?,?, '{}')
                 ON CONFLICT(preset_id, path) DO UPDATE SET title = excluded.title`).run(id, p, level, p.split('/').pop(), cleanTitle(rawTitle));
}
export function deletePresetNode(id: string, rawPath: unknown, cascade = false): number {
  assertCustom(id);
  const p = String(rawPath ?? '');
  const kids = dbh().prepare(`SELECT path FROM sns_preset_nodes WHERE preset_id = ? AND path LIKE ? ESCAPE '\\'`).all(id, p.replace(/[%_\\]/g, '\\$&') + '/%') as any[];
  if (kids.length && !cascade) throw conflict(`${p} has ${kids.length} entr${kids.length === 1 ? 'y' : 'ies'} below it. Delete the branch to remove them too.`, 'HAS_CHILDREN');
  const r = dbh().prepare(`DELETE FROM sns_preset_nodes WHERE preset_id = ? AND (path = ? OR path LIKE ? ESCAPE '\\')`).run(id, p, p.replace(/[%_\\]/g, '\\$&') + '/%');
  if (!Number(r.changes)) throw notFound('No such entry.');
  return Number(r.changes);
}

/** "21/10/00" (case-insensitive, "-" or "/" separated) -> a validated path and its level. */
export function normalisePath(raw: unknown): { path: string; level: number; codes: string[] } {
  const codes = String(raw ?? '').trim().toUpperCase().split(/[/]/).map((c) => c.trim());
  if (!codes.length || codes.length > 3 || codes.some((c) => !c)) throw bad('An SNS path is system, system/subsystem or system/subsystem/assembly, e.g. 21/10/00.', 'BAD_PATH');
  codes.forEach((c, i) => cleanCode(i + 1, c));
  return { path: codes.join('/'), level: codes.length, codes };
}

// ── Project SNS ──────────────────────────────────────────────────────────────

const rowToNode = (r: any): SnsNode => ({ path: r.path, level: r.level, code: r.code, title: r.title, presetId: r.preset_id ?? null });

export function listProjectSns(projectId: string): SnsNode[] {
  return (dbh().prepare('SELECT * FROM project_sns WHERE project_id = ? ORDER BY path').all(projectId) as any[]).map(rowToNode);
}

export function treeOf(nodes: SnsNode[]): SnsNode[] {
  const by = new Map<string, SnsNode>(nodes.map((n) => [n.path, { ...n, children: [] }]));
  const roots: SnsNode[] = [];
  for (const n of [...by.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    const parent = by.get(parentPath(n.path));
    if (parent) parent.children!.push(n); else if (n.level === 1) roots.push(n);
  }
  return roots;
}

/** Which SNS paths existing data modules use, from their file names (DMC-MIC-SDC-SYS-SUBSUB-ASSY-...). */
export function usageByPath(projectId: string): Map<string, number> {
  const use = new Map<string, number>();
  let dir = '';
  try { dir = path.join(projectDirFor(projectId), csdbRel(readProjectJson(projectId))); } catch { return use; }
  let files: string[] = [];
  try { files = fs.readdirSync(dir); } catch { return use; }
  for (const f of files) {
    const m = /^DMC-([^-_]+)-([^-_]+)-([^-_]+)-([^-_]+)-([^-_]+)-/i.exec(f);
    if (!m || !/\.xml$/i.test(f)) continue;
    const sys = m[3].toUpperCase(), sub = m[4].toUpperCase(), assy = m[5].toUpperCase();
    for (const p of [sys, `${sys}/${sub}`, `${sys}/${sub}/${assy}`]) use.set(p, (use.get(p) ?? 0) + 1);
  }
  return use;
}

export function projectSnsView(projectId: string, q = ''): { nodes: SnsNode[]; tree: SnsNode[]; total: number } {
  const use = usageByPath(projectId);
  let nodes = listProjectSns(projectId).map((n) => ({ ...n, used: use.get(n.path) ?? 0 }));
  const total = nodes.length;
  const needle = q.trim().toLowerCase();
  if (needle) {
    const hit = new Set<string>();
    for (const n of nodes) if (n.code.toLowerCase().includes(needle) || n.title.toLowerCase().includes(needle) || n.path.toLowerCase().includes(needle)) {
      let p = n.path; while (p) { hit.add(p); p = parentPath(p); }              // keep the ancestors so a hit is shown in place
    }
    nodes = nodes.filter((n) => hit.has(n.path));
  }
  return { nodes, tree: treeOf(nodes), total };
}

export function putProjectNode(projectId: string, rawPath: unknown, rawTitle: unknown, presetId: string | null = null): SnsNode {
  const { path: p, level } = normalisePath(rawPath);
  const title = cleanTitle(rawTitle);
  if (level > 1 && !dbh().prepare('SELECT 1 FROM project_sns WHERE project_id = ? AND path = ?').get(projectId, parentPath(p))) {
    throw bad(`Add ${parentPath(p)} first: a ${LEVELS[level - 1].name.toLowerCase()} belongs to its parent.`, 'NO_PARENT');
  }
  dbh().prepare(`INSERT INTO project_sns (project_id, path, level, code, title, preset_id) VALUES (?,?,?,?,?,?)
                 ON CONFLICT(project_id, path) DO UPDATE SET title = excluded.title`).run(projectId, p, level, p.split('/').pop(), title, presetId);
  return rowToNode(dbh().prepare('SELECT * FROM project_sns WHERE project_id = ? AND path = ?').get(projectId, p));
}

export function createProjectNode(projectId: string, rawPath: unknown, rawTitle: unknown): SnsNode {
  const { path: p } = normalisePath(rawPath);
  if (dbh().prepare('SELECT 1 FROM project_sns WHERE project_id = ? AND path = ?').get(projectId, p)) throw conflict(`${p} is already in this project's SNS.`, 'DUPLICATE');
  return putProjectNode(projectId, p, rawTitle);
}

/** Change a node's title and/or its own code. A code change moves the whole branch; it is refused when data modules use any part of it. */
export function updateProjectNode(projectId: string, rawPath: string, patch: { title?: unknown; code?: unknown }): SnsNode {
  const p = String(rawPath ?? '').toUpperCase();
  const cur: any = dbh().prepare('SELECT * FROM project_sns WHERE project_id = ? AND path = ?').get(projectId, p);
  if (!cur) throw notFound('No such SNS entry.');
  // validate EVERYTHING first, then write both changes in one transaction: a refused request changes nothing
  const title = patch.title !== undefined ? cleanTitle(patch.title) : null;
  let move: { np: string; branch: any[] } | null = null;
  if (patch.code !== undefined && String(patch.code).trim().toUpperCase() !== cur.code) {
    const code = cleanCode(cur.level, patch.code);
    const parent = parentPath(p);
    const np = parent ? `${parent}/${code}` : code;
    if (dbh().prepare('SELECT 1 FROM project_sns WHERE project_id = ? AND path = ?').get(projectId, np)) throw conflict(`${np} is already in this project's SNS.`, 'DUPLICATE');
    const use = usageByPath(projectId);
    const used = [...use.entries()].filter(([k]) => k === p || k.startsWith(p + '/')).reduce((a, [, n]) => a + n, 0);
    if (used) throw conflict(`${p} is used by ${used} data module${used === 1 ? '' : 's'}. Its code cannot change: the data modules' codes would no longer match the SNS.`, 'IN_USE');
    move = { np, branch: dbh().prepare(`SELECT * FROM project_sns WHERE project_id = ? AND (path = ? OR path LIKE ? ESCAPE '\\') ORDER BY path`).all(projectId, p, p.replace(/[%_\\]/g, '\\$&') + '/%') as any[] };
  }
  const db = dbh();
  db.exec('BEGIN');
  try {
    if (title !== null) db.prepare('UPDATE project_sns SET title = ? WHERE project_id = ? AND path = ?').run(title, projectId, p);
    if (move) {
      const { np, branch } = move;
      db.prepare(`DELETE FROM project_sns WHERE project_id = ? AND (path = ? OR path LIKE ? ESCAPE '\\')`).run(projectId, p, p.replace(/[%_\\]/g, '\\$&') + '/%');
      for (const b of branch) {
        const moved = np + b.path.slice(p.length);
        db.prepare('INSERT INTO project_sns (project_id, path, level, code, title, preset_id) VALUES (?,?,?,?,?,?)').run(projectId, moved, b.level, moved.split('/').pop(), b.path === p && title !== null ? title : b.title, b.preset_id);
      }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return rowToNode(dbh().prepare('SELECT * FROM project_sns WHERE project_id = ? AND path = ?').get(projectId, move ? move.np : p));
}

export function deleteProjectNode(projectId: string, rawPath: string, cascade = false): number {
  const p = String(rawPath ?? '').toUpperCase();
  if (!dbh().prepare('SELECT 1 FROM project_sns WHERE project_id = ? AND path = ?').get(projectId, p)) throw notFound('No such SNS entry.');
  const esc = p.replace(/[%_\\]/g, '\\$&') + '/%';
  const kids = (dbh().prepare(`SELECT path FROM project_sns WHERE project_id = ? AND path LIKE ? ESCAPE '\\'`).all(projectId, esc) as any[]).length;
  if (kids && !cascade) throw conflict(`${p} has ${kids} entr${kids === 1 ? 'y' : 'ies'} below it. Delete the branch to remove them too.`, 'HAS_CHILDREN');
  const use = usageByPath(projectId);
  const used = [...use.entries()].filter(([k]) => k === p || k.startsWith(p + '/')).reduce((a, [, n]) => a + n, 0);
  if (used) throw conflict(`${p} is used by ${used} data module${used === 1 ? '' : 's'}. Remove or recode those data modules first.`, 'IN_USE');
  const r = dbh().prepare(`DELETE FROM project_sns WHERE project_id = ? AND (path = ? OR path LIKE ? ESCAPE '\\')`).run(projectId, p, esc);
  return Number(r.changes);
}

// ── Apply a preset / import / export ────────────────────────────────────────

export interface ImportReport { added: number; unchanged: number; conflicts: Array<{ path: string; existing: string; incoming: string }>; skipped: Array<{ path: string; reason: string }>; errors: Array<{ line: number | string; message: string }> }

/** Insert nodes whose parent exists (or arrives earlier in the list). Existing nodes are never overwritten here; a different title is reported as a conflict. */
function mergeNodes(projectId: string, nodes: Array<{ path: string; title: string }>, presetId: string | null, dryRun: boolean, overwriteTitles = false): ImportReport {
  const rep: ImportReport = { added: 0, unchanged: 0, conflicts: [], skipped: [], errors: [] };
  const have = new Map<string, string>(listProjectSns(projectId).map((n) => [n.path, n.title]));
  const ordered = [...nodes].sort((a, b) => levelOfPath(a.path) - levelOfPath(b.path) || a.path.localeCompare(b.path));
  const db = dbh();
  if (!dryRun) db.exec('BEGIN');
  try {
    for (const n of ordered) {
      let norm: ReturnType<typeof normalisePath>;
      try { norm = normalisePath(n.path); } catch (e: any) { rep.errors.push({ line: n.path, message: e.message }); continue; }
      const p = norm.path;
      if (norm.level > 1 && !have.has(parentPath(p))) { rep.errors.push({ line: p, message: `its parent ${parentPath(p)} is missing` }); continue; }
      if (have.has(p)) {
        const ex = have.get(p)!;
        if (ex === n.title.trim() || !n.title.trim()) rep.unchanged++;
        else if (overwriteTitles) { if (!dryRun) putProjectNode(projectId, p, n.title, presetId); have.set(p, n.title.trim()); rep.added++; }
        else rep.conflicts.push({ path: p, existing: ex, incoming: n.title });
        continue;
      }
      if (!dryRun) putProjectNode(projectId, p, n.title, presetId);
      have.set(p, n.title.trim()); rep.added++;
    }
    if (!dryRun) db.exec('COMMIT');
  } catch (e) { if (!dryRun) db.exec('ROLLBACK'); throw e; }
  return rep;
}

/** Copy a preset's nodes into the project. Ambiguous systems, "available for projects" ranges, untitled rows and categories are skipped, and reported. */
export function applyPreset(projectId: string, presetId: string, opts: { systems?: string[]; dryRun?: boolean } = {}): ImportReport {
  const { nodes } = getPreset(presetId);
  const want = opts.systems?.length ? new Set(opts.systems.map((s) => String(s).toUpperCase())) : null;
  const skipped: ImportReport['skipped'] = [];
  const take: Array<{ path: string; title: string }> = [];
  for (const n of nodes) {
    const note = n.note ?? {};
    const root = n.path.split('/')[0];
    if (note.category) { skipped.push({ path: n.path, reason: 'a grouping category, not a system code' }); continue; }
    if (want && !want.has(root)) continue;
    if (note.ambiguous) { skipped.push({ path: n.path, reason: 'the specification defines this system more than once - choose one by hand' }); continue; }
    if ((note as any).rangeEnd) { skipped.push({ path: n.path, reason: `a range ${n.code} - ${(note as any).rangeEnd} the specification leaves "available for projects"` }); continue; }
    if (!n.title.trim()) { skipped.push({ path: n.path, reason: 'the specification gives no title for this entry' }); continue; }
    if (n.level > 2) continue;
    take.push({ path: n.path, title: n.title });
  }
  const rep = mergeNodes(projectId, take, presetId, !!opts.dryRun);
  rep.skipped.push(...skipped.filter((s) => !s.path.includes('/') || !skipped.some((o) => o.path !== s.path && s.path.startsWith(o.path + '/'))));
  return rep;
}

export function exportProject(projectId: string, format: 'json' | 'csv'): { body: string; type: string; name: string } {
  const nodes = listProjectSns(projectId);
  if (format === 'json') {
    const tree = (list: SnsNode[]): any[] => list.map((n) => ({ code: n.code, title: n.title, ...(n.children?.length ? { children: tree(n.children) } : {}) }));
    return { body: JSON.stringify({ format: 'agastya-sns', version: 1, tree: tree(treeOf(nodes)) }, null, 2), type: 'application/json', name: 'sns.json' };
  }
  const rows = ['system,subsystem,assembly,title', ...nodes.sort((a, b) => a.path.localeCompare(b.path)).map((n) => {
    const c = n.path.split('/');
    return csvRow([c[0] ?? '', c[1] ?? '', c[2] ?? '', n.title]);      // WP-07 (SEC-015): a title starting with = is text
  })];
  return { body: rows.join('\r\n') + '\r\n', type: 'text/csv', name: 'sns.csv' };
}

/** Parse an import (JSON from exportProject, or CSV with system,subsystem,assembly,title). Returns flat nodes + parse errors. */
export function parseImport(format: 'json' | 'csv', text: string): { nodes: Array<{ path: string; title: string }>; errors: ImportReport['errors'] } {
  const nodes: Array<{ path: string; title: string }> = []; const errors: ImportReport['errors'] = [];
  if (format === 'json') {
    let j: any;
    try { j = JSON.parse(text); } catch (e: any) { return { nodes, errors: [{ line: 'file', message: `Not valid JSON: ${e.message}` }] }; }
    // WP-09: the file the export route writes ({ format: 'agastya-sns-preset', nodes: [{ path, title }] }) imports back as it is.
    if (j && j.format === 'agastya-sns-preset' && Array.isArray(j.nodes)) {
      j.nodes.forEach((n: any, i: number) => {
        const p = typeof n?.path === 'string' ? n.path.trim() : '';
        if (!p) { errors.push({ line: `nodes[${i}]`, message: 'an entry has no path' }); return; }
        if (p.split('/').length > 3) { errors.push({ line: p, message: 'deeper than system / subsystem / assembly' }); return; }
        nodes.push({ path: p, title: String(n.title ?? '') });
      });
      return { nodes, errors };
    }
    const tree = Array.isArray(j) ? j : j?.tree;
    if (!Array.isArray(tree)) return { nodes, errors: [{ line: 'file', message: 'Expected {"tree":[{"code","title","children"}]}.' }] };
    const walk = (list: any[], prefix: string, depth: number) => {
      for (const n of list) {
        if (!n || typeof n.code !== 'string') { errors.push({ line: prefix || 'root', message: 'an entry has no code' }); continue; }
        if (depth > 3) { errors.push({ line: `${prefix}/${n.code}`, message: 'deeper than system / subsystem / assembly' }); continue; }
        const p = prefix ? `${prefix}/${n.code}` : n.code;
        nodes.push({ path: p, title: String(n.title ?? '') });
        if (Array.isArray(n.children)) walk(n.children, p.toUpperCase(), depth + 1);
      }
    };
    walk(tree, '', 1);
    return { nodes, errors };
  }
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const cells = (line: string): string[] => {
    const out: string[] = []; let cur = ''; let inq = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inq) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') inq = false; else cur += ch; }
      else if (ch === '"') inq = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur); return out.map((c) => c.trim());
  };
  if (!lines.length) return { nodes, errors: [{ line: 'file', message: 'The file is empty.' }] };
  const head = cells(lines[0]).map((c) => c.toLowerCase());
  if (head.join(',') !== 'system,subsystem,assembly,title') return { nodes, errors: [{ line: 1, message: 'The first line must be: system,subsystem,assembly,title' }] };
  lines.slice(1).forEach((line, i) => {
    const [sys, sub, assy, ...rest] = cells(line);
    const title = rest.join(',');
    if (!sys) { errors.push({ line: i + 2, message: 'the system column is empty' }); return; }
    if (!sub && assy) { errors.push({ line: i + 2, message: 'an assembly needs its subsystem' }); return; }
    nodes.push({ path: [sys, sub, assy].filter(Boolean).join('/'), title });
  });
  return { nodes, errors };
}

export function importProject(projectId: string, format: 'json' | 'csv', text: string, opts: { dryRun?: boolean; overwriteTitles?: boolean } = {}): ImportReport {
  const { nodes, errors } = parseImport(format, text);
  if (errors.length && !nodes.length) return { added: 0, unchanged: 0, conflicts: [], skipped: [], errors };
  const rep = mergeNodes(projectId, nodes, null, !!opts.dryRun, !!opts.overwriteTitles);
  rep.errors.unshift(...errors);
  return rep;
}

/** Everything an authoring screen needs to pick SNS codes: the flat nodes, sorted. */
export function snsForAuthoring(projectId: string): Array<{ path: string; level: number; code: string; title: string }> {
  return listProjectSns(projectId).map(({ path: p, level, code, title }) => ({ path: p, level, code, title }));
}
