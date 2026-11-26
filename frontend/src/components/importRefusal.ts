// Why a package import was refused, as the new-project dialog shows it.
//
// The server answers a refused import with 422 IMPORT_REFUSED and the whole per-file report in the body. The dialog used to show only the
// generic sentence ("The report says why") - and nowhere to read the report - so an author whose package named an enterprise the Administrator
// had not registered saw 21 refused modules as one unexplained red box. The reasons are grouped here: 21 files refused for the same reason
// are one line with a count and a few file names, not 21 lines.
import { ApiError } from '../api/client';

export interface RefusalReason { message: string; count: number; files: string[] }

interface ReportLike { items?: Array<{ path?: string; status?: string; message?: string }>; notes?: string[]; manifest?: { mismatches?: string[] } }

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

/** The package importer's own refusal ("Nothing was imported."): its problems are lines of "<file>: <reason>", grouped here by reason like the per-file report is. */
function problemReasons(problems: unknown, maxFiles: number): RefusalReason[] {
  if (!Array.isArray(problems)) return [];
  const groups = new Map<string, RefusalReason>();
  for (const raw of problems) {
    const text = String(raw); const m = /^(.+?\.xml): ([\s\S]+)$/i.exec(text);
    const message = m ? m[2] : text; const g = groups.get(message) ?? { message, count: 0, files: [] };
    g.count++; if (m && g.files.length < maxFiles) g.files.push(baseName(m[1]));
    groups.set(message, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/** The grouped reasons of a refused import; empty when the error is anything else (a network failure, an expired upload...). Most files first. */
export function refusalReasons(e: unknown, maxFiles = 3): RefusalReason[] {
  if (!(e instanceof ApiError) || e.code !== 'IMPORT_REFUSED') return [];
  const rep = (e.body?.report ?? null) as ReportLike | null;
  if (!rep) return problemReasons(e.body?.problems, maxFiles);
  const groups = new Map<string, RefusalReason>();
  for (const it of rep.items ?? []) {
    if (it.status !== 'rejected' || !it.message) continue;
    const g = groups.get(it.message) ?? { message: it.message, count: 0, files: [] };
    g.count++; if (g.files.length < maxFiles && it.path) g.files.push(baseName(it.path));
    groups.set(it.message, g);
  }
  const out = [...groups.values()].sort((a, b) => b.count - a.count);
  // what the package itself got wrong, when no single file was rejected (a manifest that does not match its files, for example)
  for (const m of rep.manifest?.mismatches ?? []) out.push({ message: `The package's manifest does not match its files: ${m}`, count: 1, files: [] });
  if (!out.length) for (const n of rep.notes ?? []) out.push({ message: n, count: 1, files: [] });
  return out;
}

/** A hint for the reasons the author can act on without leaving the dialog; null when there is nothing specific to say. */
export function refusalHint(reasons: RefusalReason[]): string | null {
  if (reasons.some((r) => /enterprise (code|name)/i.test(r.message))) {
    return "The Administrator's enterprise lists (Administrator > RPC CAGE codes and Originator CAGE codes) do not include the enterprise these data modules name. "
      + 'Ask an Administrator to register it, or import a package whose data modules name a registered enterprise.';
  }
  return null;
}
