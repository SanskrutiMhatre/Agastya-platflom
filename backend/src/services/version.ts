// =============================================================================
// Version identity (WP-13: DEP-004).
//
// One source of truth for "which build is running":
//   - the product version is the "version" of the root package.json. scripts/package-windows.mjs refuses to package when backend/package.json
//     differs from it, and it writes version.json (version, commit, build time, bundled runtimes) at the root of the installed program folder.
//     A packaged server reads that file; a source checkout reads backend/package.json (equal to the root one by the same check).
//   - API_VERSION is the level of the HTTP API. Raise it when a route a client depends on changes shape or is removed; MIN_CLIENT_VERSION is
//     the oldest client (installer, Mode B client) that still talks to this server correctly.
//   - the schema level is the list of database migrations this code knows (MIGRATIONS in core/auth/store.js) against what the database has
//     applied. A database with migrations this code does not know is from a NEWER build (a downgrade), which the host and the installer can refuse.
// =============================================================================

import fs from 'fs';
import path from 'path';

/** The HTTP API level. 2 = WP-13: the routes of the removed screens are gone (see docs/audit/IMPLEMENTATION-LOG.md, WP-13). */
export const API_VERSION = 2;
/** The oldest client version that works against this server. */
export const MIN_CLIENT_VERSION = '2.0.0';

export interface BuildInfo { version: string; commit: string | null; builtAt: string | null; dirty: boolean | null; packaged: boolean }

function readJson(file: string): any | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

let cached: BuildInfo | null = null;
/** The product version and, in a packaged build, the commit and build time it was made from. */
export function buildInfo(): BuildInfo {
  if (cached) return cached;
  // dist/services/version.js -> backend/ ; a packaged install has <program>/app/backend/dist, and version.json at <program>/version.json
  const backendDir = path.resolve(__dirname, '..', '..');
  const installed = path.basename(path.dirname(backendDir)).toLowerCase() === 'app';
  const stamped = installed ? readJson(path.resolve(backendDir, '..', '..', 'version.json')) : null;
  if (stamped && typeof stamped.version === 'string') {
    cached = { version: stamped.version, commit: stamped.commit ?? null, builtAt: stamped.builtAt ?? null, dirty: typeof stamped.dirty === 'boolean' ? stamped.dirty : null, packaged: true };
  } else {
    const pkg = readJson(path.join(backendDir, 'package.json'));
    cached = { version: String(pkg?.version ?? '0.0.0'), commit: null, builtAt: null, dirty: null, packaged: false };
  }
  return cached;
}

export interface SchemaLevel { level: number; latest: string | null; applied: number; unknown: string[] }

/** What the code knows (MIGRATIONS) against what the database has applied. `unknown` lists migrations from a newer build. */
export function schemaLevel(db: { prepare(sql: string): { all(): any[] } }, migrations: Array<{ name: string }>): SchemaLevel {
  const known = new Set(migrations.map((m) => m.name));
  let applied: string[] = [];
  try { applied = db.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map((r: any) => String(r.name)); } catch { applied = []; }
  return { level: migrations.length, latest: migrations.length ? migrations[migrations.length - 1].name : null, applied: applied.length, unknown: applied.filter((n) => !known.has(n)) };
}
