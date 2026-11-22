// =============================================================================
// Project settings inside a round-trip package.
//
// A project package (services/packages.ts) carries the files of a project: data modules, graphics, the publication module. What the project CHOSE - who the
// responsible partner is, which information codes and data module types it offers, whether its SNS is enforced, the SNS itself - lives outside those files
// (project_config, project_codes, project_dm_types, project_sns, <project>/.sns.json). Without it a project that is exported and imported again comes back
// with its content but with defaults derived from that content. This file puts the choices into the package manifest (`project.settings`, an additive key:
// readers that do not know it ignore it) and puts them back when a package STARTS a project (the Import way of the new-project wizard).
//
// RULES
//   * The two SNS systems are carried side by side and restored side by side. Neither is converted into the other (docs/SNS_SYSTEMS.md):
//       sns      system 1, the project's presets-and-database SNS (project_sns)
//       snsRows  system 2, the row model (<project>/.sns.json: rows and ordering)
//   * The package is untrusted input. Every value goes through the validator the screens use (applyPatch, setSelectedCodes, setDmTypes, putProjectNode,
//     mergeRows, checkedOrder); a value that does not validate is left out and REPORTED - the import itself never fails because of settings.
//   * What the data modules themselves say wins: model code, S1000D issue and language are derived from the contents (projectConfig.adoptFromContents) and are
//     never taken from the manifest; a manifest that disagrees is reported.
//   * Restoring only ever happens into a project that the import has just created. A package imported into an existing project does not touch its settings.
// =============================================================================

import { listItems } from './adminConfig';
import { listDms } from './csdb';
import {
  getConfig, getConfigRow, selectedCodes, setDmTypes, setSelectedCodes, disabledTypes, updateConfig, updateConfigRaw, type ProjectConfig,
} from './projectConfig';
import { listPresets, listProjectSns, putProjectNode } from './sns';
import { checkedOrder, mergeRows, projectRepo, readProjectOrder, writeProjectOrder } from './sns/store';
import type { OrderConfig } from './sns/codes';

export const SETTINGS_VERSION = 1;
const MAX_ENTRIES = 50_000;                       // a generous bound: the biggest SNS in the standard is a few thousand rows

export interface PackageSettings {
  version: 1;
  /** The project configuration (never its origin notes). */
  config: Pick<ProjectConfig, 'mic' | 'issue' | 'language' | 'country' | 'security' | 'responsiblePartner' | 'originator' | 'brex' | 'codeMode' | 'snsEnforced' | 'pmTemplate' | 'applicability'>;
  /** The information codes the project offers when its code mode is "selected". */
  infoCodes: string[];
  /** The data module types (schema names) the project does NOT offer. */
  disabledDmTypes: string[];
  /** System 1: the project's SNS nodes. */
  sns: Array<{ path: string; title: string; presetId: string | null }>;
  /** System 2: the project's SNS rows and ordering overrides, exactly as `.sns.json` holds them (without ids). */
  snsRows: { rows: Array<Record<string, string>>; order?: OrderConfig } | null;
}

export function settingsOf(projectId: string): PackageSettings {
  const c = getConfig(projectId);
  const rows = projectRepo(projectId).list();
  const order = readProjectOrder(projectId);
  return {
    version: SETTINGS_VERSION,
    config: {
      mic: c.mic, issue: c.issue, language: c.language, country: c.country, security: c.security, responsiblePartner: c.responsiblePartner, originator: c.originator,
      brex: c.brex, codeMode: c.codeMode, snsEnforced: c.snsEnforced, pmTemplate: c.pmTemplate, applicability: c.applicability,
    },
    infoCodes: c.codeMode === 'selected' ? selectedCodes(projectId, 'infoCode') : [],
    disabledDmTypes: [...disabledTypes(projectId)].sort(),
    sns: listProjectSns(projectId).map((n) => ({ path: n.path, title: n.title, presetId: n.presetId ?? null })),
    snsRows: rows.length || order ? { rows: rows.map(({ id: _id, ...r }) => ({ ...r })), ...(order ? { order } : {}) } : null,
  };
}

export interface RestoreReport { restored: string[]; notes: string[] }

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Put a manifest's settings into a project the import has just created. Never throws for a bad value; says what it did and did not do. */
export function restoreSettings(projectId: string, actorId: string | null, raw: unknown): RestoreReport {
  const rep: RestoreReport = { restored: [], notes: [] };
  if (raw === undefined || raw === null) { rep.notes.push('The package carries no project settings (it was not made by this platform, or by an older version); the configuration was derived from the data modules.'); return rep; }
  if (!isObj(raw) || raw.version !== SETTINGS_VERSION) { rep.notes.push('The package settings are in a format this version does not read; the configuration was derived from the data modules.'); return rep; }
  const skip = (what: string, why: string) => rep.notes.push(`${what} was not restored: ${why}`);
  const msg = (e: unknown) => (e as Error).message.split('\n')[0];

  // 1. configuration: field by field, so one bad value does not cost the others
  const cur = getConfig(projectId);
  const cfg = isObj(raw.config) ? raw.config : {};
  for (const f of ['mic', 'issue', 'language'] as const) {
    if (cfg[f] !== undefined && cfg[f] !== null && String(cfg[f]).toLowerCase() !== String(cur[f] ?? '').toLowerCase()) rep.notes.push(`The package says ${f} = ${cfg[f]}; the data modules say ${cur[f] ?? 'nothing'}. The data modules win.`);
  }
  const existingDm = new Set(listDms(projectId).map((d) => d.file.toLowerCase()));
  const infoCodes: unknown[] = Array.isArray(raw.infoCodes) ? raw.infoCodes.slice(0, MAX_ENTRIES) : [];
  let codeMode: 'all' | 'selected' = cfg.codeMode === 'selected' ? 'selected' : 'all';
  if (codeMode === 'selected') {
    // the selection first: a code mode of "selected" with nothing selected would refuse every new data module
    try { if (!infoCodes.length) throw new Error('no information codes were listed'); setSelectedCodes(projectId, 'infoCode', infoCodes.map(String)); rep.restored.push(`information codes (${infoCodes.length})`); }
    catch (e) { skip('The information code selection', `${msg(e)} The project offers every code of its issue.`); codeMode = 'all'; }
  }
  const fields: Array<[string, unknown]> = [
    ['country', cfg.country], ['security', cfg.security], ['responsiblePartner', cfg.responsiblePartner], ['originator', cfg.originator],
    ['brex', cfg.brex], ['codeMode', codeMode], ['pmTemplate', cfg.pmTemplate],
  ];
  if (isObj(cfg.applicability)) {
    const a: Record<string, string | null> = {};
    for (const k of ['act', 'cct', 'pct']) {
      const v = cfg.applicability[k];
      if (typeof v === 'string' && v) { if (existingDm.has(v.toLowerCase())) a[k] = v; else skip(`The ${k.toUpperCase()} reference ${v}`, 'that data module is not in the package.'); }
    }
    if (Object.keys(a).length) fields.push(['applicability', a]);
  }
  for (const [field, value] of fields) {
    if (value === undefined) continue;
    try { const before = JSON.stringify((getConfig(projectId) as any)[field]); updateConfig(projectId, { [field]: value }, actorId); if (JSON.stringify((getConfig(projectId) as any)[field]) !== before) rep.restored.push(field); }
    catch (e) { skip(`The ${field} setting`, msg(e)); }
  }

  // 2. the data module types the project offers
  const off = Array.isArray(raw.disabledDmTypes) ? raw.disabledDmTypes.map(String).slice(0, 200) : [];
  if (off.length) {
    try { setDmTypes(projectId, (listItems('dm-types') as any[]).map((t) => String(t.schema)).filter((s) => !off.includes(s))); rep.restored.push(`data module types (${off.length} not offered)`); }
    catch (e) { skip('The data module type selection', msg(e)); }
  }

  // 3. SNS system 1 (presets and the project table): parents before children, each through the validator the SNS screen uses
  if (Array.isArray(raw.sns) && raw.sns.length) {
    const known = new Set(listPresets().map((p) => p.id));
    let ok = 0; const bad: string[] = [];
    const nodes = raw.sns.slice(0, MAX_ENTRIES).filter(isObj).sort((a, b) => String(a.path).split('/').length - String(b.path).split('/').length || String(a.path).localeCompare(String(b.path)));
    for (const n of nodes) {
      try { putProjectNode(projectId, n.path, n.title, typeof n.presetId === 'string' && known.has(n.presetId) ? n.presetId : null); ok++; }
      catch (e) { if (bad.length < 5) bad.push(`${String(n.path)} (${msg(e)})`); else if (bad.length === 5) bad.push('…'); }
    }
    if (ok) rep.restored.push(`SNS, presets system (${ok} node${ok === 1 ? '' : 's'})`);
    if (ok < nodes.length) skip(`${nodes.length - ok} SNS node(s) of the presets system`, bad.join('; '));
  }

  // 4. SNS system 2 (the row model): rows and ordering, into .sns.json
  if (isObj(raw.snsRows)) {
    const rows = Array.isArray(raw.snsRows.rows) ? raw.snsRows.rows.slice(0, MAX_ENTRIES) : [];
    if (rows.length) {
      const r = mergeRows(projectRepo(projectId), rows);
      if (r.added.length) rep.restored.push(`SNS, row model (${r.added.length} row${r.added.length === 1 ? '' : 's'})`);
      if (r.rejected.length) skip(`${r.rejected.length} SNS row(s) of the row model`, r.rejected.slice(0, 3).map((x) => `${x.code || '?'}: ${x.errors[0]}`).join('; '));
    }
    if (raw.snsRows.order !== undefined) {
      try { const order = checkedOrder(raw.snsRows.order); if (order) { writeProjectOrder(projectId, order); rep.restored.push('SNS ordering'); } }
      catch (e) { skip('The SNS ordering', msg(e)); }
    }
  }

  // 5. leave a trace in the configuration's own notes
  try {
    const row = getConfigRow(projectId);
    if (row) {
      const next: ProjectConfig = JSON.parse(JSON.stringify(row.config));
      next.origin.notes = [...next.origin.notes, `Settings restored from the package: ${rep.restored.length ? rep.restored.join(', ') : 'none'}.`, ...rep.notes.map((n) => `Package settings: ${n}`)].slice(-40);
      updateConfigRaw(projectId, next, actorId);
    }
  } catch { /* the notes are a convenience; the report below carries them as well */ }
  return rep;
}
