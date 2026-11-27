'use strict';
// Document identity: every source file gets a stable UUID; its path is DATA,
// not identity. The index is strictly ADDITIVE — a file that disappears from
// disk is marked missing_at, never deleted, so its revision history survives
// renames, re-uploads and accidents.
//
// Contract with the routes: EVERY route that changes which source files
// exist (upload, delete, import, project create) synchronises the affected
// project and AWAITS it before responding, so a client can resolve the
// document id of a file it just created. Read-side consumers run the same
// sync as a cheap safety net, and startup reconciliation heals a cold index.

const fs = require('fs');
const path = require('path');
const { newId } = require('../auth/crypto');
const { safeRelPath } = require('../auth/xmlGuard');

// Source text files that carry document identity. Generated build artefacts
// (driver stylesheet, FO output) are excluded — they are derived, not source.
const DOC_EXT = /\.(xml|xsl|xslt|txt|json|ent|dtd)$/i;
const EXCLUDE_FILE = /^(jss-run\.xsl|jss-output\.fo)$/i;
const EXCLUDE_DIR = new Set(['node_modules', '.git']);

function classifyKind(rel, pmName) {
  const base = rel.split('/').pop();
  if (pmName && rel === pmName) return 'pm';
  if (/^csdb\//i.test(rel) && /^DMC-/i.test(base)) return 'dmc';
  if (/frontmatter\//i.test(rel)) return 'frontmatter';
  if (base === 'project.json') return 'config';
  return 'other';
}

function walkSourceFiles(dir, base, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) {
      if (EXCLUDE_DIR.has(e.name)) continue;
      walkSourceFiles(path.join(dir, e.name), base ? base + '/' + e.name : e.name, out);
    } else if (DOC_EXT.test(e.name) && !EXCLUDE_FILE.test(e.name)) {
      out.push(base ? base + '/' + e.name : e.name);
    }
  }
  return out;
}

class DocIndex {
  constructor(store) {
    this.store = store;
  }

  resolve(projectId, rel) {
    return this.store.stmt('SELECT * FROM documents WHERE project_id = ? AND rel_path = ?')
      .get(projectId, String(rel).replace(/\\/g, '/')) || null;
  }

  getDocument(docId) {
    return this.store.stmt('SELECT * FROM documents WHERE id = ?').get(docId) || null;
  }

  listForProject(projectId) {
    return this.store.stmt('SELECT * FROM documents WHERE project_id = ? ORDER BY rel_path').all(projectId);
  }

  /*
    Additive sync of one project. New files gain identity; files gone from
    disk are MARKED (missing_at), never removed; a marked file that
    reappears is unmarked and keeps its original UUID — path is data.
  */
  async syncProject(projectId, projectDir, nowIso) {
    let pmName = 'publication.xml';
    try {
      const pj = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf8'));
      pmName = (pj.input && typeof pj.input.pm === 'string' && safeRelPath(pj.input.pm)) || pmName;   // only a relative path inside the project (WP-01)
    } catch { /* defaults are fine */ }

    const onDisk = new Set(walkSourceFiles(projectDir, '', []));
    const rows = this.listForProject(projectId);
    const byRel = new Map(rows.map((r) => [r.rel_path, r]));

    this.store.tx(() => {
      for (const rel of onDisk) {
        const existing = byRel.get(rel);
        if (!existing) {
          this.store.stmt(`INSERT INTO documents (id, project_id, rel_path, kind, created_at, updated_at)
                           VALUES (?,?,?,?,?,?)`)
            .run(newId(), projectId, rel, classifyKind(rel, pmName), nowIso, nowIso);
        } else if (existing.missing_at) {
          this.store.stmt('UPDATE documents SET missing_at = NULL, updated_at = ? WHERE id = ?')
            .run(nowIso, existing.id);
        }
      }
      for (const r of rows) {
        if (!onDisk.has(r.rel_path) && !r.missing_at) {
          this.store.stmt('UPDATE documents SET missing_at = ?, updated_at = ? WHERE id = ?')
            .run(nowIso, nowIso, r.id);
        }
      }
    });
    return { indexed: onDisk.size };
  }

  // Startup reconciliation: heal a cold or stale index for every project on
  // disk, so identity exists before the first client asks.
  async reconcileAll(workspaceDir, projectIds, projectDirFor, nowIso) {
    for (const id of projectIds) {
      try { await this.syncProject(id, projectDirFor(id), nowIso); }
      catch (e) { console.error(`[docindex] reconcile failed for ${id}: ${e.message}`); }
    }
  }
}

module.exports = { DocIndex, DOC_EXT, classifyKind, walkSourceFiles };
