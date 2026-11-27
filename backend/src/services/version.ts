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

/** The HTTP API level (1 = the route set of the 2.0 line; the API-only routes are listed in docs/API-ONLY-ROUTES.md). */
export const API_VERSION = 1;
/** The oldest client version that works against this server. */
export const MIN_CLIENT_VERSION = '2.0.0';

/**
 * WP-26: the header the client sends its own version in (frontend/src/api/client.ts), and the same value as the `client` query parameter of the
 * WebSocket (a browser cannot set headers there). A request without it (a script, curl, an older tool) is not refused.
 */
export const CLIENT_VERSION_HEADER = 'x-agastya-client';

/** "2.10.1" -> [2, 10, 1]; a pre-release ("2.1.0-rc.1") ranks below its release. null when it is not a version. */
function parseVersion(v: string): { nums: number[]; pre: boolean } | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.exec(v.trim());
  return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: !!m[4] } : null;
}

/** Compare two versions: <0, 0, >0. A malformed version ranks below every real one. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a); const y = parseVersion(b);
  if (!x || !y) return (x ? 1 : 0) - (y ? 1 : 0);
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
  return (x.pre ? 0 : 1) - (y.pre ? 0 : 1);
}

/** Whether a client that says it is `clientVersion` may talk to this server (undefined = it did not say). */
export function clientAccepted(clientVersion: string | undefined, min: string = MIN_CLIENT_VERSION): boolean {
  if (clientVersion === undefined || clientVersion === '') return true;
  return compareVersions(clientVersion, min) >= 0;
}

export interface BuildInfo { version: string; commit: string | null; builtAt: string | null; dirty: boolean | null; packaged: boolean }

/** The fields read from version.json (written by the packager) or package.json; each is checked before use. */
interface VersionStamp { version?: unknown; commit?: string | null; builtAt?: string | null; dirty?: unknown }

function readJson(file: string): VersionStamp | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as VersionStamp; } catch { return null; }
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

/** What the code knows (MIGRATIONS) against what the database has applied (`repos.appliedMigrations()`). `unknown` lists migrations from a newer build. */
export function schemaLevel(applied: string[], migrations: Array<{ name: string }>): SchemaLevel {
  const known = new Set(migrations.map((m) => m.name));
  return { level: migrations.length, latest: migrations.length ? migrations[migrations.length - 1].name : null, applied: applied.length, unknown: applied.filter((n) => !known.has(n)) };
}
