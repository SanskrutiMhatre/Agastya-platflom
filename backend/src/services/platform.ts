// =============================================================================
// Platform settings and maintenance - the Administrator's "Settings", "Visual settings" and
// "Maintenance" sections.
//
// V1 drew these three as forms and buttons with nothing behind them. Here each control does one
// thing the platform really does, and a setting is offered only if something reads it:
//
//   application name, organisation       shown in the sidebar and on the sign-in screen
//   accent colour, compact layout        applied to every user's screen when the app loads
//   default theme                        used until a person picks their own with the theme button
//
//   maintenance: re-index documents, check the installed schemas, clear temporary preview files,
//   rebuild every project's PDF, export the audit log. (Database backup is the platform backup.)
// =============================================================================

import fs from 'fs';
import path from 'path';
import { nowIso } from '../config';
import { store, docIndex, projectDirFor } from '../context';
import { bad } from './http';
import { installedSchemaIssues } from './validation';
import { deriveAccent } from './accent';

type Row = Record<string, any>;

export interface AppSettings { appName: string; organisation: string; accent: string; compact: boolean; theme: 'light' | 'dark' }
export const DEFAULTS: AppSettings = { appName: 'Agastya', organisation: '', accent: '', compact: false, theme: 'light' };

export function readSettings(): AppSettings {
  const row = store.configGet('app-settings', 'main') ?? {};
  return {
    appName: typeof row.appName === 'string' && row.appName.trim() ? row.appName : DEFAULTS.appName,
    organisation: typeof row.organisation === 'string' ? row.organisation : '',
    accent: /^#[0-9a-f]{6}$/i.test(row.accent ?? '') ? row.accent : '',
    compact: row.compact === true,
    // two themes only (owner rule 2026-11-28): a stored "system" (or nothing) reads as light
    theme: row.theme === 'dark' ? 'dark' : 'light',
  };
}

export function writeSettings(body: Partial<AppSettings>): AppSettings {
  const cur = readSettings();
  const next: AppSettings = {
    appName: body.appName !== undefined ? String(body.appName).trim().slice(0, 60) : cur.appName,
    organisation: body.organisation !== undefined ? String(body.organisation).trim().slice(0, 100) : cur.organisation,
    accent: body.accent !== undefined ? String(body.accent).trim() : cur.accent,
    compact: body.compact !== undefined ? !!body.compact : cur.compact,
    theme: body.theme === 'light' || body.theme === 'dark' ? body.theme : body.theme === 'system' ? 'light' : cur.theme,
  };
  if (!next.appName) throw bad('The application needs a name.', 'NAME_REQUIRED');
  if (next.accent && !/^#[0-9a-f]{6}$/i.test(next.accent)) throw bad('The accent colour must look like #1a73e8.', 'BAD_COLOUR');
  // WP-19 (TH-003): the same check the Administrator page previews; a colour with no readable light and dark shade is refused.
  if (next.accent) { const d = deriveAccent(next.accent); if (!d.ok) throw bad(d.reason ?? 'This accent colour cannot be made readable.', 'BAD_COLOUR'); }
  store.configPut('app-settings', 'main', next, nowIso());
  return next;
}

const allProjectIds = (): string[] => store.listAllProjects().map((p: Row) => p.id);

/** Rebuild the document index of every project (after files were copied in by hand, say). */
export async function reindex(): Promise<{ projects: number }> {
  const ids = allProjectIds();
  for (const id of ids) await docIndex.syncProject(id, projectDirFor(id), nowIso());
  return { projects: ids.length };
}

/** Which S1000D schema sets are installed on the server, and which the editor can offer. */
export function checkSchemas(): { installed: string[]; wizard: string[]; missing: string[] } {
  const installed = installedSchemaIssues();
  const wizard = ['4.2', '5.0', '6', '7'];
  return { installed, wizard, missing: wizard.filter((w) => !installed.some((i) => String(i).startsWith(w))) };
}

/** Delete the temporary single-module preview files every project accumulates. */
export function clearPreviewFiles(): { removed: number } {
  let removed = 0;
  for (const id of allProjectIds()) {
    const dir = projectDirFor(id);
    for (const f of ['jss-preview.pdf', 'jss-preview.fo', '_preview-pm.xml', '_preview-order.xml', '_preview-book.xml']) {
      try { fs.unlinkSync(path.join(dir, f)); removed++; } catch { /* not there */ }
    }
  }
  return { removed };
}

// The audit log export moved to services/auditTrail.ts exportAudit (WP-29): streamed, unlimited, same first eight columns.
