'use strict';
// SQLite metadata registry for the workspace.
//
// The filesystem (workspace/projects/<id>/) remains the source of truth for
// actual content (PMC, DMs, ICNs, Media, settings JSON). This DB is a fast,
// queryable INDEX over it: the project registry (name, type, template, dates)
// plus, from Phase 2, a file index (path, kind, chapter).
//
// Uses node:sqlite (built into Node 24) — no native compile step, which keeps
// the app trivially distributable.

const path = require('path');
const { DatabaseSync } = require('node:sqlite');

let db = null;

function open(workspaceDir) {
  if (db) return db;
  const file = path.join(workspaceDir, 'publisher.db');
  db = new DatabaseSync(file);
  // A second process (the break-glass reset-admin script, a backup) waits up to 5 s for a write lock instead of failing at once with
  // "database is locked" while the server runs (audit PLT-012).
  db.exec('PRAGMA busy_timeout = 5000;');
  // WP-06 (PLT-010): enforced references, stated rather than left to the library default.
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL DEFAULT 'JSS',   -- 'S1000D' | 'JSS'
      template    TEXT DEFAULT 'default',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      last_opened TEXT
    );
    CREATE TABLE IF NOT EXISTS files (
      project_id  TEXT NOT NULL,
      rel_path    TEXT NOT NULL,
      kind        TEXT NOT NULL,                 -- 'pmc' | 'dmc' | 'media' | 'frontmatter' | 'other'
      chapter     TEXT,
      updated_at  TEXT NOT NULL,
      PRIMARY KEY (project_id, rel_path)
    );
  `);
  return db;
}

// Timestamps are passed in from the caller (server has real Date); the engine
// stays free of ambient clock reads so it's deterministic under test.
function upsertProject({ id, name, type, template, now }) {
  open.assert();
  const existing = db.prepare('SELECT id, created_at FROM projects WHERE id = ?').get(id);
  if (existing) {
    db.prepare('UPDATE projects SET name=?, type=?, template=?, updated_at=? WHERE id=?')
      .run(name, type || 'JSS', template || 'default', now, id);
  } else {
    db.prepare(
      'INSERT INTO projects (id,name,type,template,created_at,updated_at,last_opened) VALUES (?,?,?,?,?,?,?)'
    ).run(id, name, type || 'JSS', template || 'default', now, now, null);
  }
}

function touchOpened(id, now) {
  open.assert();
  db.prepare('UPDATE projects SET last_opened=?, updated_at=? WHERE id=?').run(now, now, id);
}

function getProject(id) {
  open.assert();
  return db.prepare('SELECT * FROM projects WHERE id=?').get(id) || null;
}

function listProjects() {
  open.assert();
  return db
    .prepare('SELECT * FROM projects ORDER BY COALESCE(last_opened, updated_at) DESC')
    .all();
}

function deleteProject(id) {
  open.assert();
  db.prepare('DELETE FROM files WHERE project_id=?').run(id);
  db.prepare('DELETE FROM projects WHERE id=?').run(id);
}

// --- file index (used from Phase 2) ---------------------------------------
function replaceFileIndex(projectId, rows, now) {
  open.assert();
  const del = db.prepare('DELETE FROM files WHERE project_id=?');
  const ins = db.prepare(
    'INSERT OR REPLACE INTO files (project_id,rel_path,kind,chapter,updated_at) VALUES (?,?,?,?,?)'
  );
  del.run(projectId);
  for (const r of rows) ins.run(projectId, r.rel_path, r.kind, r.chapter || null, now);
}

function listFiles(projectId) {
  open.assert();
  return db.prepare('SELECT * FROM files WHERE project_id=? ORDER BY rel_path').all(projectId);
}

// WP-06 (REL-003): a clean stop writes the write-ahead log back into the database file and closes it, so the next start (or a copy of
// the data folder taken after the stop) finds one complete file.
function close() {
  if (!db) return;
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch (e) { console.warn('[db] checkpoint at stop failed:', e.message); }
  try { db.close(); } catch { /* already closed */ }
  db = null;
}

// Guard so a missing open() fails loudly instead of on a null deref.
open.assert = function () {
  if (!db) throw new Error('db.open(workspaceDir) must be called first');
};

module.exports = {
  open,
  close,
  upsertProject,
  touchOpened,
  getProject,
  listProjects,
  deleteProject,
  replaceFileIndex,
  listFiles,
};
