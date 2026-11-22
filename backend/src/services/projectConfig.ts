// =============================================================================
// Project S1000D configuration.
//
// One row per project (project_config), one JSON document, versioned. It is the SINGLE place a project's S1000D choices live:
// model identification code, S1000D issue, language/country, responsible partner and originator, BREX choice, which information
// codes and DM types the project offers, whether its SNS is enforced, the PM starting point and where its ACT/CCT/PCT live.
// (The project's SNS hierarchy has its own table - services/sns.ts - because it is a tree, not a document.)
//
// OWNERSHIP
//   global catalogue (services/s1000dRef.ts, Administrator)  ->  project configuration (this file, owner/manager)  ->  data module
//   A project never reads another project's configuration, and a change to the global catalogue never rewrites a project.
//
// LOCK
//   MIC and S1000D issue are part of every data module code / schema reference. Once the project holds data modules they cannot be
//   changed here: changing them would mean rewriting every DMC and re-validating every module, which the platform never does silently.
//
// EXISTING PROJECTS
//   backfillProjects() gives every project that has no configuration one, derived from what it already contains (data-module codes,
//   declared issue, language, BREX reference). It never edits a data module, never assigns applicability, and takes a database
//   snapshot first (see snapshotBeforeMigration).
// =============================================================================

import fs from 'fs';
import path from 'path';
import { nowIso } from '../config';
import { store, projectDirFor } from '../context';
import { bad, conflict, HttpError } from './http';
import { listDms, DmSummary } from './csdb';
import { readProjectJson, csdbRel } from './projects';
import { listItems } from './adminConfig';
import { declaredIssue } from './brex';
import {
  CODE_KINDS, CodeKind, IssueKey, ISSUE_KEYS, ISSUE_LABEL, KIND_RULE, getCode, issueKeyOf, listCodes, typeAdvice,
} from './s1000dRef';
import { listProjectSns } from './sns';

const dbh = () => store.db;

export const DEFAULT_ISSUE: IssueKey = '5-0';          // the wizard's existing default (settings.defaultIssue)
export const DEFAULT_LANGUAGE = 'en';
export const DEFAULT_COUNTRY = 'IN';                    // EN-IN is the platform default (memory.md, phase 13)

export interface Enterprise { code: string; name: string }
export interface ProjectConfig {
  /** Model identification code. '' = not set yet (the first data module may set it). */
  mic: string;
  /** S1000D issue key ('4-2' | '5-0' | '6' | '7'), or null when it could not be derived (mixed issues in an existing project). */
  issue: IssueKey | null;
  language: string; country: string;
  responsiblePartner: Enterprise; originator: Enterprise;
  /** Default security classification code (a value of the security-classes table). */
  security: string;
  /** 'default': the official default BREX of the issue. 'project': a BREX data module this project holds (dmc). */
  brex: { mode: 'default' | 'project'; dmc: string | null };
  /** 'all': every code of the issue's catalogue is offered. 'selected': only the codes in project_codes. */
  codeMode: 'all' | 'selected';
  /** When true and the project has SNS entries, new data modules must use system / subsystem / assembly codes the SNS lists. */
  snsEnforced: boolean;
  /** The "Starts as" profile (the platform's only PM template mechanism) the project was created from, '' = blank. */
  pmTemplate: string;
  /** Data modules of the applicability cross-reference tables (file names in the project's csdb), when authored. */
  applicability: { act: string | null; cct: string | null; pct: string | null };
  /** How this configuration came to be. */
  origin: { by: 'wizard' | 'api' | 'migration'; notes: string[] };
}

export interface ConfigRow { config: ProjectConfig; version: number; createdAt: string; updatedAt: string; updatedBy: string | null }

const blankEnt = (): Enterprise => ({ code: '', name: '' });
export function defaultConfig(over: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    mic: '', issue: DEFAULT_ISSUE, language: DEFAULT_LANGUAGE, country: DEFAULT_COUNTRY,
    responsiblePartner: blankEnt(), originator: blankEnt(), security: '01',
    brex: { mode: 'default', dmc: null }, codeMode: 'all', snsEnforced: true, pmTemplate: '',
    applicability: { act: null, cct: null, pct: null }, origin: { by: 'api', notes: [] },
    ...over,
  };
}

// ── Reading ──────────────────────────────────────────────────────────────────

export function getConfigRow(projectId: string): ConfigRow | null {
  const r: any = dbh().prepare('SELECT * FROM project_config WHERE project_id = ?').get(projectId);
  if (!r) return null;
  return { config: { ...defaultConfig(), ...JSON.parse(r.data) }, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at, updatedBy: r.updated_by ?? null };
}

/** The project's configuration; a project that has none (created before this feature, not yet backfilled) gets one derived on first read. */
export function getConfig(projectId: string): ProjectConfig {
  if (isCir(projectId)) return cirConfig();
  return (getConfigRow(projectId) ?? deriveAndStore(projectId, 'migration', null)).config;
}

/** The Common Information Repository holds modules of every model code and issue: it has no configuration and is never constrained by one. */
const isCir = (projectId: string): boolean => store.getProjectRow(projectId)?.type === 'CIR';
const cirConfig = (): ProjectConfig => defaultConfig({ issue: null, snsEnforced: false, origin: { by: 'api', notes: ['The shared repository is not configured: it holds modules of every model identification code and issue.'] } });

function writeConfig(projectId: string, config: ProjectConfig, by: string | null, create = false): void {
  const now = nowIso();
  if (create) {
    dbh().prepare('INSERT INTO project_config (project_id, data, version, created_at, updated_at, updated_by) VALUES (?,?,1,?,?,?)').run(projectId, JSON.stringify(config), now, now, by);
  } else {
    dbh().prepare('UPDATE project_config SET data = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE project_id = ?').run(JSON.stringify(config), now, by, projectId);
  }
}

// ── Data modules in the project ──────────────────────────────────────────────

export interface DmStats { count: number; mics: string[]; issues: string[]; languages: string[]; brexRefs: string[]; infoCodes: Record<string, number>; summaries: DmSummary[] }

export function dmStats(projectId: string): DmStats {
  const dms = listDms(projectId);
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];
  const dir = path.join(projectDirFor(projectId), csdbRel(readProjectJson(projectId)));
  // The issue a module declares is read from its schema reference (the same reading the BREX gate uses), not from the file name.
  const issueOf = (d: DmSummary): string => {
    try {
      const fd = fs.openSync(path.join(dir, d.file), 'r');
      try { const b = Buffer.alloc(30000); const n = fs.readSync(fd, b, 0, b.length, 0); return issueKeyOf(declaredIssue(b.toString('utf8', 0, n)) ?? '') ?? ''; } finally { fs.closeSync(fd); }
    } catch { return ''; }
  };
  const infoCodes: Record<string, number> = {};
  for (const d of dms) { const c = d.dmCodeAttrs?.infoCode; if (c) infoCodes[c] = (infoCodes[c] ?? 0) + 1; }
  return {
    count: dms.length,
    mics: uniq(dms.map((d) => d.dmCodeAttrs?.modelIdentCode ?? '')),
    issues: uniq(dms.map(issueOf)),
    languages: uniq(dms.map((d) => d.language)),
    brexRefs: [], infoCodes, summaries: dms,
  };
}

export function dmCount(projectId: string): number {
  try {
    const dir = path.join(projectDirFor(projectId), csdbRel(readProjectJson(projectId)));
    return fs.readdirSync(dir).filter((f) => /^DMC-.*\.xml$/i.test(f)).length;
  } catch { return 0; }
}

export interface LockState { locked: boolean; fields: string[]; dmCount: number; explanation: string }
export function lockState(projectId: string, cfg: ProjectConfig = getConfig(projectId)): LockState {
  const n = dmCount(projectId);
  const fields = n ? [...(cfg.mic ? ['mic'] : []), ...(cfg.issue ? ['issue'] : [])] : [];
  return {
    locked: fields.length > 0, fields, dmCount: n,
    explanation: fields.length
      ? `The model identification code and S1000D issue are part of every data module's code and schema reference, and this project already has ${n} data module${n === 1 ? '' : 's'}. ` +
        'To change them, create a new project with the new values and bring the data modules across (re-coded and re-validated); the platform does not rewrite existing data module codes.'
      : '',
  };
}

// ── Deriving a configuration from an existing project ───────────────────────

function mostCommon(xs: string[]): string | null {
  const c = new Map<string, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

const DEFAULT_BREX_DMC = /^S1000D-[A-Z]-04-10-0301-00A-022A-D$/i;

export function deriveConfig(projectId: string, by: ProjectConfig['origin']['by']): ProjectConfig {
  const stats = dmStats(projectId);
  const notes: string[] = [];
  const cfg = defaultConfig({ origin: { by, notes }, snsEnforced: false });
  if (!stats.count) { notes.push('No data modules yet: platform defaults.'); cfg.snsEnforced = true; return cfg; }
  if (stats.mics.length === 1) cfg.mic = stats.mics[0];
  else { cfg.mic = ''; notes.push(`The data modules use ${stats.mics.length} different model identification codes (${stats.mics.join(', ')}); none was chosen. Set it in the project configuration.`); }
  if (stats.issues.length === 1) cfg.issue = stats.issues[0] as IssueKey;
  else { cfg.issue = null; notes.push(stats.issues.length ? `The data modules declare different S1000D issues (${stats.issues.map((i) => ISSUE_LABEL[i as IssueKey] ?? i).join(', ')}); none was chosen.` : 'The S1000D issue of the data modules could not be read.'); }
  const langs = stats.summaries.map((d) => d.language).filter(Boolean);
  const lang = mostCommon(langs);
  if (lang) { const [l, c] = lang.split('-'); if (l) cfg.language = l.toLowerCase(); if (c) cfg.country = c.toUpperCase(); }
  if (new Set(langs).size > 1) notes.push(`More than one language is in use (${[...new Set(langs)].join(', ')}); the most common is the default.`);
  // BREX: what do the modules refer to?
  const refs: string[] = [];
  const csdb = path.join(projectDirFor(projectId), csdbRel(readProjectJson(projectId)));
  for (const d of stats.summaries) {
    try {
      const head = fs.readFileSync(path.join(csdb, d.file), 'utf8').slice(0, 40000);
      const m = /<brexDmRef>[\s\S]*?<dmCode\b([^>]*)\/?>/.exec(head);
      if (m) {
        const a: Record<string, string> = {}; m[1].replace(/([\w:.-]+)\s*=\s*"([^"]*)"/g, (_s, k, v) => (a[k] = v, ''));
        refs.push([a.modelIdentCode, a.systemDiffCode, a.systemCode, `${a.subSystemCode}${a.subSubSystemCode}`, a.assyCode, `${a.disassyCode}${a.disassyCodeVariant}`, `${a.infoCode}${a.infoCodeVariant}`, a.itemLocationCode].join('-'));
      }
    } catch { /* unreadable file: ignored here, validation reports it */ }
  }
  const ref = mostCommon(refs);
  if (ref && !DEFAULT_BREX_DMC.test(ref)) { cfg.brex = { mode: 'project', dmc: ref }; notes.push(`The data modules refer to the BREX ${ref}; it is recorded as the project's BREX.`); }
  notes.push('Information codes: all codes of the issue stay available (nothing was narrowed). Applicability: nothing was assigned.');
  return cfg;
}

/** Derive + persist (and seed the SNS from the codes in use, untitled, so an enforced SNS never rejects existing structure). */
function deriveAndStore(projectId: string, by: ProjectConfig['origin']['by'], actor: string | null): ConfigRow {
  const existing = getConfigRow(projectId);
  if (existing) return existing;
  const cfg = deriveConfig(projectId, by);
  writeConfig(projectId, cfg, actor, true);
  return getConfigRow(projectId)!;
}

/**
 * A project that was created empty and then received a package (the "Import" way of starting a project): its configuration is replaced by one derived from the
 * package - model identification code, issue, language, BREX - so the identity can never disagree with the data modules. Nothing is narrowed or assigned.
 */
export function adoptFromContents(projectId: string, actorId: string | null): ProjectConfig {
  deleteProjectConfig(projectId);
  const cfg = deriveConfig(projectId, 'wizard');
  writeConfig(projectId, cfg, actorId, true);
  return cfg;
}

export interface BackfillReport { projects: number; created: number; mixed: Array<{ id: string; notes: string[] }> }

/** Give every project without a configuration one, derived from its contents. Idempotent. */
export function backfillProjects(): BackfillReport {
  const rows: any[] = store.listAllProjects();
  const missing = rows.filter((p) => p.type !== 'CIR' && !getConfigRow(p.id));
  const rep: BackfillReport = { projects: rows.length, created: 0, mixed: [] };
  for (const p of missing) {
    try {
      const row = deriveAndStore(p.id, 'migration', null);
      rep.created++;
      if (row.config.origin.notes.some((n) => /different|could not be read/.test(n))) rep.mixed.push({ id: p.id, notes: row.config.origin.notes });
    } catch (e) { console.error(`[migration] project ${p.id}: ${(e as Error).message}`); }
  }
  return rep;
}

// ── Writing ──────────────────────────────────────────────────────────────────

const cleanEnt = (e: any, what: string, required: boolean): Enterprise => {
  const code = String(e?.code ?? '').trim().toUpperCase(); const name = String(e?.name ?? '').trim();
  if (!code && !name && !required) return blankEnt();
  if (!/^[A-Z0-9]{5}$/.test(code)) throw bad(`${what}: the enterprise code is 5 letters or digits (CAGE / NCAGE).`, 'BAD_ENTERPRISE');
  if (!name) throw bad(`${what}: the enterprise name is required.`, 'BAD_ENTERPRISE');
  return { code, name: name.slice(0, 200) };
};

/** Validate a patch against the current configuration; returns the new configuration (not stored). */
export function applyPatch(cur: ProjectConfig, patch: Record<string, any>, opts: { locked?: LockState } = {}): ProjectConfig {
  const next: ProjectConfig = JSON.parse(JSON.stringify(cur));
  const lock = opts.locked;
  const refuse = (field: string, label: string) => {
    throw conflict(`${label} cannot be changed: ${lock!.explanation}`, 'CONFIG_LOCKED', { field });
  };
  if (patch.mic !== undefined) {
    const mic = String(patch.mic).trim().toUpperCase();
    if (mic !== cur.mic) {
      if (lock?.fields.includes('mic')) refuse('mic', 'The model identification code');
      if (mic && !/^[A-Z0-9]{2,14}$/.test(mic)) throw bad('Model identification code: 2 to 14 letters or digits.', 'BAD_MIC');
      next.mic = mic;
    }
  }
  if (patch.issue !== undefined) {
    const k = issueKeyOf(patch.issue);
    if (!k) throw bad(`S1000D issue: one of ${ISSUE_KEYS.map((i) => ISSUE_LABEL[i]).join(', ')}.`, 'BAD_ISSUE');
    if (k !== cur.issue) {
      if (lock?.fields.includes('issue')) refuse('issue', 'The S1000D issue');
      next.issue = k;
    }
  }
  if (patch.language !== undefined) { const v = String(patch.language).trim().toLowerCase(); if (!/^[a-z]{2,3}$/.test(v)) throw bad('Language: an ISO 639 code such as en.', 'BAD_LANGUAGE'); next.language = v; }
  if (patch.country !== undefined) { const v = String(patch.country).trim().toUpperCase(); if (!/^[A-Z]{2}$/.test(v)) throw bad('Country: an ISO 3166 code such as IN.', 'BAD_COUNTRY'); next.country = v; }
  if (patch.responsiblePartner !== undefined) next.responsiblePartner = cleanEnt(patch.responsiblePartner, 'Responsible partner company', false);
  if (patch.originator !== undefined) next.originator = cleanEnt(patch.originator, 'Originator', false);
  if (patch.security !== undefined) {
    const v = String(patch.security).trim();
    const known = listItems('security-classes') as any[];
    if (known.length && !known.some((s) => s.code === v)) throw bad(`Security classification ${v} is not in the Administrator's list.`, 'BAD_SECURITY');
    next.security = v;
  }
  if (patch.brex !== undefined) {
    const mode = patch.brex?.mode === 'project' ? 'project' : 'default';
    const dmc = mode === 'project' ? String(patch.brex?.dmc ?? '').trim().toUpperCase().replace(/^DMC-/, '') : null;
    if (mode === 'project' && !/^[A-Z0-9]{2,14}(-[A-Z0-9]+){7}$/.test(dmc!)) throw bad('A project BREX is given by its data module code, e.g. MYPROJ-A-00-00-00-00A-022A-D.', 'BAD_BREX');
    next.brex = { mode, dmc };
  }
  if (patch.codeMode !== undefined) next.codeMode = patch.codeMode === 'selected' ? 'selected' : 'all';
  if (patch.snsEnforced !== undefined) next.snsEnforced = !!patch.snsEnforced;
  if (patch.pmTemplate !== undefined) next.pmTemplate = String(patch.pmTemplate ?? '').slice(0, 60);
  if (patch.applicability !== undefined) {
    const a = patch.applicability ?? {};
    const ok = (v: any) => (v == null || v === '' ? null : /^DMC-[A-Za-z0-9._-]+\.xml$/i.test(String(v)) ? String(v) : (() => { throw bad('An applicability table is a data module file name (DMC-….xml).', 'BAD_APPLIC_REF'); })());
    // an explicit null / '' clears a reference; an omitted key keeps it
    next.applicability = { act: a.act !== undefined ? ok(a.act) : cur.applicability.act, cct: a.cct !== undefined ? ok(a.cct) : cur.applicability.cct, pct: a.pct !== undefined ? ok(a.pct) : cur.applicability.pct };
  }
  return next;
}

export function updateConfig(projectId: string, patch: Record<string, any>, actorId: string | null): ConfigRow {
  const row = getConfigRow(projectId) ?? deriveAndStore(projectId, 'migration', actorId);
  const lock = lockState(projectId, row.config);
  const next = applyPatch(row.config, patch, { locked: lock });
  if (JSON.stringify(next) === JSON.stringify(row.config)) return row;
  next.origin = { by: row.config.origin.by === 'migration' ? 'migration' : row.config.origin.by, notes: row.config.origin.notes };
  writeConfig(projectId, next, actorId);
  return getConfigRow(projectId)!;
}

/** Store a configuration exactly as given (internal: the caller has already validated it). */
export function updateConfigRaw(projectId: string, config: ProjectConfig, actorId: string | null): void { writeConfig(projectId, config, actorId); }

/** Create the configuration of a new project (the creation wizard). */
export function createConfig(projectId: string, patch: Record<string, any>, actorId: string | null, by: 'wizard' | 'api' = 'api'): ConfigRow {
  const base = defaultConfig({ origin: { by, notes: [] } });
  const next = applyPatch(base, patch);
  writeConfig(projectId, next, actorId, true);
  return getConfigRow(projectId)!;
}

/** Copy of another project's configuration for a project copy (its own row; the SNS and codes are copied too). */
export function copyConfig(fromId: string, toId: string, actorId: string | null): void {
  const src = getConfig(fromId);
  const cfg: ProjectConfig = JSON.parse(JSON.stringify(src));
  cfg.origin = { by: 'api', notes: [`Copied from project ${fromId}.`] };
  if (!getConfigRow(toId)) writeConfig(toId, cfg, actorId, true);
  const db = dbh();
  db.prepare('INSERT OR IGNORE INTO project_codes (project_id, kind, code) SELECT ?, kind, code FROM project_codes WHERE project_id = ?').run(toId, fromId);
  db.prepare('INSERT OR IGNORE INTO project_sns (project_id, path, level, code, title, preset_id) SELECT ?, path, level, code, title, preset_id FROM project_sns WHERE project_id = ?').run(toId, fromId);
  db.prepare('INSERT OR IGNORE INTO project_dm_types (project_id, schema, enabled) SELECT ?, schema, enabled FROM project_dm_types WHERE project_id = ?').run(toId, fromId);
}

export function deleteProjectConfig(projectId: string): void {
  for (const t of ['project_config', 'project_codes', 'project_sns', 'project_dm_types']) dbh().prepare(`DELETE FROM ${t} WHERE project_id = ?`).run(projectId);
}

// ── Enabled codes and DM types ───────────────────────────────────────────────

/** The codes of one kind a project offers for its issue (the whole catalogue, or the project's selection of it). */
export function enabledCodes(projectId: string, kind: CodeKind, cfg: ProjectConfig = getConfig(projectId)): Array<{ code: string; title: string; origin: string }> {
  const issue = cfg.issue ?? DEFAULT_ISSUE;
  const all = listCodes(kind, issue);
  // only information codes can be narrowed by a project; learn, learn-event and item-location codes are always the whole catalogue
  if (kind !== 'infoCode' || cfg.codeMode === 'all') return all;
  const sel = new Set((dbh().prepare('SELECT code FROM project_codes WHERE project_id = ? AND kind = ?').all(projectId, kind) as any[]).map((r) => r.code));
  return all.filter((c) => sel.has(c.code));
}

export function selectedCodes(projectId: string, kind: CodeKind): string[] {
  return (dbh().prepare('SELECT code FROM project_codes WHERE project_id = ? AND kind = ? ORDER BY code').all(projectId, kind) as any[]).map((r) => r.code);
}

/** Replace the project's selection of one kind. Codes must exist in the catalogue of the project's issue. */
export function setSelectedCodes(projectId: string, kind: CodeKind, codes: string[]): void {
  const cfg = getConfig(projectId);
  const issue = cfg.issue ?? DEFAULT_ISSUE;
  const wanted = [...new Set(codes.map((c) => String(c).trim().toUpperCase()).filter(Boolean))];
  const unknown = wanted.filter((c) => !getCode(kind, issue, c));
  if (unknown.length) throw bad(`Not in the Issue ${ISSUE_LABEL[issue]} ${KIND_RULE[kind].label.toLowerCase()} catalogue: ${unknown.slice(0, 8).join(', ')}${unknown.length > 8 ? '…' : ''}.`, 'UNKNOWN_CODE');
  const db = dbh();
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM project_codes WHERE project_id = ? AND kind = ?').run(projectId, kind);
    for (const c of wanted) db.prepare('INSERT INTO project_codes (project_id, kind, code) VALUES (?,?,?)').run(projectId, kind, c);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function disabledTypes(projectId: string): Set<string> {
  return new Set((dbh().prepare('SELECT schema FROM project_dm_types WHERE project_id = ? AND enabled = 0').all(projectId) as any[]).map((r) => r.schema));
}
export function setDmTypes(projectId: string, enabled: string[]): void {
  const types = (listItems('dm-types') as any[]).map((t) => t.schema);
  const unknown = enabled.filter((s) => !types.includes(s));
  if (unknown.length) throw bad(`Unknown DM type: ${unknown.join(', ')}.`, 'UNKNOWN_TYPE');
  if (!enabled.length) throw bad('A project must offer at least one data module type.', 'NO_TYPES');
  const db = dbh();
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM project_dm_types WHERE project_id = ?').run(projectId);
    for (const t of types) if (!enabled.includes(t)) db.prepare('INSERT INTO project_dm_types (project_id, schema, enabled) VALUES (?,?,0)').run(projectId, t);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// ── What the authoring screens need, in one call ─────────────────────────────

export function authoringBundle(projectId: string) {
  const row: ConfigRow = isCir(projectId)
    ? { config: cirConfig(), version: 0, createdAt: '', updatedAt: '', updatedBy: null }
    : (getConfigRow(projectId) ?? deriveAndStore(projectId, 'migration', null));
  const cfg = row.config;
  const issue = cfg.issue ?? DEFAULT_ISSUE;
  const off = disabledTypes(projectId);
  const dmTypes = (listItems('dm-types') as any[]).map((t) => ({ schema: t.schema, name: t.name, infoCode: t.infoCode, enabled: !off.has(t.schema) }));
  const advice = typeAdvice(issue, dmTypes);
  const stats = dmCount(projectId);
  return {
    config: cfg, version: row.version, lock: lockState(projectId, cfg),
    issue, issueLabel: ISSUE_LABEL[issue], issueAssumed: !cfg.issue,
    dmTypes: dmTypes.map((t) => ({ ...t, advice: advice.find((a) => a.schema === t.schema) })),
    codes: Object.fromEntries(CODE_KINDS.map((k) => [k, enabledCodes(projectId, k, cfg)])),
    selected: Object.fromEntries(CODE_KINDS.map((k) => [k, selectedCodes(projectId, k)])),
    sns: listProjectSns(projectId).map(({ path: p, level, code, title }) => ({ path: p, level, code, title })),
    dmCount: stats,
  };
}

// ── Server-side rules for a NEW data module ──────────────────────────────────
// (an existing module being edited is never held to these: only BREX / XSD judge its content)

export interface NewDmFacts { schema: string; issue: IssueKey | null; code: Record<string, string>; language?: string; country?: string }

export function factsOf(xml: string): NewDmFacts {
  const head = xml.slice(0, 60000);
  const attrs = (re: RegExp): Record<string, string> => {
    const m = re.exec(head); const out: Record<string, string> = {};
    if (m) m[1].replace(/([\w:.-]+)\s*=\s*"([^"]*)"/g, (_s, k, v) => (out[k] = v, ''));
    return out;
  };
  const loc = /noNamespaceSchemaLocation\s*=\s*"([^"]+)"/.exec(head);
  const schema = loc ? (loc[1].split('/').pop() ?? '').replace(/\.xsd$/i, '') : '';
  const issue = issueKeyOf(declaredIssue(head) ?? '');
  const lang = attrs(/<language\b([^>]*)\/?>/);
  return { schema, issue, code: attrs(/<dmCode\b([^>]*)\/?>/), language: lang.languageIsoCode, country: lang.countryIsoCode };
}

/** Why this NEW data module breaks the project's configuration (empty = it does not). Never changes anything. */
export function newDmProblems(projectId: string, xml: string): string[] {
  const row = getConfigRow(projectId);
  if (!row) return [];                                           // a project with no configuration is held to nothing (BREX/XSD still apply)
  const cfg = row.config; const f = factsOf(xml); const out: string[] = [];
  const c = f.code;
  if (cfg.mic && c.modelIdentCode && c.modelIdentCode !== cfg.mic) out.push(`The model identification code is ${c.modelIdentCode}, but this project's is ${cfg.mic}.`);
  if (cfg.issue && f.issue && f.issue !== cfg.issue) out.push(`The data module is S1000D Issue ${ISSUE_LABEL[f.issue]}, but this project is Issue ${ISSUE_LABEL[cfg.issue]}.`);
  if (f.schema && disabledTypes(projectId).has(f.schema)) out.push(`This project does not offer the "${f.schema}" data module type.`);
  const exempt = ['brex', 'appliccrossreftable', 'condcrossreftable', 'prdcrossreftable'].includes(f.schema);   // BREX and the applicability tables are not part of the product breakdown
  if (cfg.codeMode === 'selected' && c.infoCode && !exempt) {
    const on = new Set(selectedCodes(projectId, 'infoCode'));
    if (!on.has(c.infoCode)) out.push(`Information code ${c.infoCode} is not enabled for this project.`);
  }
  if (cfg.snsEnforced && !exempt && c.systemCode) {
    const sns = listProjectSns(projectId);
    if (sns.length) {
      const paths = new Set(sns.map((n) => n.path));
      const sys = c.systemCode; const sub = `${c.subSystemCode ?? ''}${c.subSubSystemCode ?? ''}`; const assy = c.assyCode ?? '';
      if (!paths.has(sys)) out.push(`System ${sys} is not in this project's SNS.`);
      else if (!paths.has(`${sys}/${sub}`)) out.push(`Subsystem ${sys}-${sub} is not in this project's SNS.`);
      else if (assy && !paths.has(`${sys}/${sub}/${assy}`) && sns.some((n) => n.level === 3 && n.path.startsWith(`${sys}/${sub}/`))) out.push(`Assembly ${sys}-${sub}-${assy} is not in this project's SNS.`);
    }
  }
  return out;
}

export function assertNewDmAllowed(projectId: string, xml: string): void {
  const problems = newDmProblems(projectId, xml);
  if (problems.length) throw new HttpError(400, `This data module does not fit the project's configuration:\n- ${problems.join('\n- ')}`, 'CONFIG_MISMATCH', { problems });
}

// ── Catalogue-change impact ──────────────────────────────────────────────────

export interface ImpactProject { id: string; name: string; selected: boolean; dmsUsing: number }
export interface Impact { kind: CodeKind; issue: IssueKey; code: string; projects: ImpactProject[]; dmsUsing: number; selectedIn: number }

/** Which projects a change to one catalogue code touches: those that selected it, and those whose data modules already use it. */
export function codeImpact(kind: CodeKind, issue: IssueKey, rawCode: string): Impact {
  const code = String(rawCode).toUpperCase();
  const projects: ImpactProject[] = []; let dms = 0; let sel = 0;
  for (const p of store.listAllProjects() as any[]) {
    if (p.type === 'CIR') continue;
    const row = getConfigRow(p.id);
    const projIssue = row?.config.issue ?? null;
    if (projIssue && projIssue !== issue) continue;
    const selected = !!row && row.config.codeMode === 'selected' && selectedCodes(p.id, kind).includes(code);
    let using = 0;
    try {
      const dir = path.join(projectDirFor(p.id), csdbRel(readProjectJson(p.id)));
      for (const f of fs.readdirSync(dir)) {
        const m = /^DMC-([^-_]+)-([^-_]+)-([^-_]+)-([^-_]+)-([^-_]+)-([^-_]+)-([^-_]+)-([^-_]+)(?:-([^-_]+))?/i.exec(f);
        if (!m || !/\.xml$/i.test(f)) continue;
        const v = kind === 'infoCode' ? m[7].slice(0, 3) : kind === 'itemLocationCode' ? m[8] : kind === 'learnCode' ? (m[9] ?? '').slice(0, 3) : (m[9] ?? '').slice(3);
        if (v.toUpperCase() === code) using++;
      }
    } catch { /* no csdb */ }
    if (selected || using) { projects.push({ id: p.id, name: readProjectJson(p.id)?.name || p.name || p.id, selected, dmsUsing: using }); dms += using; if (selected) sel++; }
  }
  return { kind, issue, code, projects, dmsUsing: dms, selectedIn: sel };
}

export function recordImpact(actorId: string | null, change: string, impact: Impact): void {
  dbh().prepare('INSERT INTO catalogue_impacts (at, actor_id, change, impact) VALUES (?,?,?,?)').run(nowIso(), actorId, change, JSON.stringify(impact));
}

