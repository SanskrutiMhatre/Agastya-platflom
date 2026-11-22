// =============================================================================
// Xignal JSS front-matter data modules, both directions.
//
//   POST /api/projects/:id/jssdm/import-frontmatter   read the project's front-matter modules into settings (preview; apply:true saves)
//   POST /api/projects/:id/jssdm/generate             write the settings out as flagged, generated modules in the CSDB
//   GET  /api/projects/:id/jssdm/status               which modules were generated / consumed, and which are still candidates
//
// Editor-level, like the Settings and data-module routes they feed. Software administrators are owner-equivalent.
// =============================================================================

import type { Express } from 'express';
import { requireProject, audit } from '../context';
import { wrap, bad } from '../services/http';
import { applyImport, generateForProject, importFromProject, statusOf, type GenerateRequest } from '../services/jssdm/service';
import { PAGE_DEFS, type PageId } from '../services/jssdm/reserved';
import type { GenIds } from '../services/jssdm/toDms';

const flag = (v: unknown): boolean => v === true || v === 'true' || v === '1' || v === 1;
const isObject = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The identity a generated module may carry. Every value is checked against the S1000D pattern it ends up in, so a bad one is refused here, not written. */
const ID_RULES: Record<string, { re: RegExp; text: string }> = {
  modelIdentCode: { re: /^[A-Z0-9]{2,14}$/, text: '2 to 14 capital letters or digits' },
  systemDiffCode: { re: /^[A-Z0-9]{1,4}$/, text: '1 to 4 capital letters or digits' },
  languageIsoCode: { re: /^[a-z]{2,3}$/, text: 'a lower-case ISO 639 language code' },
  countryIsoCode: { re: /^[A-Z]{2}$/, text: 'an upper-case ISO 3166 country code' },
  issueNumber: { re: /^\d{1,3}$/, text: '1 to 3 digits' },
  inWork: { re: /^\d{1,2}$/, text: '1 or 2 digits' },
  security: { re: /^\d{2}$/, text: 'two digits' },
  disassyCodeVariant: { re: /^[A-Z0-9]{1,3}$/, text: '1 to 3 capital letters or digits' },
  infoCodeVariant: { re: /^[A-Z0-9]$/, text: 'one capital letter or digit' },
  itemLocationCode: { re: /^[ABCDT]$/, text: 'A, B, C, D or T' },
  techName: { re: /^[^<>&]{1,80}$/, text: 'up to 80 characters, without < > &' },
};
const ENTERPRISE = { code: /^[A-Z0-9]{5}$/, name: /^[^<>&]{1,100}$/ };

function cleanIds(v: unknown): GenIds | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isObject(v)) throw bad('ids must be an object.', 'BAD_IDS');
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) {
    if (k === 'rpc' || k === 'originator') {
      if (!isObject(val) || !ENTERPRISE.code.test(String(val.enterpriseCode)) || !ENTERPRISE.name.test(String(val.enterpriseName))) throw bad(`ids.${k} needs enterpriseCode (5 capital letters or digits) and enterpriseName.`, 'BAD_IDS');
      out[k] = { enterpriseCode: String(val.enterpriseCode), enterpriseName: String(val.enterpriseName) };
    } else if (k === 'brex') {
      if (!isObject(val) || !/^[A-Z0-9]{2,14}$/.test(String(val.modelIdentCode))) throw bad('ids.brex is the dmCode attributes of the BREX data module.', 'BAD_IDS');
      out.brex = Object.fromEntries(Object.entries(val).filter(([, x]) => typeof x === 'string'));
    } else if (k === 'issueDate') {
      if (!isObject(val) || !/^\d{4}$/.test(String(val.year)) || !/^\d{2}$/.test(String(val.month)) || !/^\d{2}$/.test(String(val.day))) throw bad('ids.issueDate needs year (4 digits), month and day (2 digits).', 'BAD_IDS');
      out.issueDate = { year: String(val.year), month: String(val.month), day: String(val.day) };
    } else if (k in ID_RULES) {
      if (typeof val !== 'string' || !ID_RULES[k].re.test(val)) throw bad(`ids.${k} must be ${ID_RULES[k].text}.`, 'BAD_IDS');
      out[k] = val;
    } else throw bad(`ids.${k} is not a setting this accepts.`, 'BAD_IDS');
  }
  return out as GenIds;
}

export function registerJssdmRoutes(app: Express): void {
  const base = '/api/projects/:id/jssdm';
  const log = (req: any, action: string, meta?: unknown) => audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action, projectId: req.project.id, targetType: 'project', targetId: req.project.id, meta });
  const actor = (req: any) => ({ id: req.auth.user.id, username: req.auth.user.username, role: req.auth.user.role });

  app.post(`${base}/import-frontmatter`, requireProject('editor', { from: 'param', cap: 'settings.write' }), wrap((req, res) => {
    const apply = flag(req.body?.apply);
    const run = importFromProject(req.project.id);
    if (apply && !run.result.consumed.length) throw bad('This project has no Xignal front-matter data modules to read (information codes 001, 021, 023, 00T, 00V, 012, 005, 009, 00A, 00Z, 007, X01-X04 at SNS code 00-0-0-00).', 'NO_FRONT_MATTER');
    const applied = apply ? applyImport(req.project.id, run) : null;
    if (applied) log(req, 'jssdm.imported', { pages: run.result.summary.pages, consumed: applied.consumedCount });
    res.json({
      applied: !!applied, ...(applied ?? {}), scanned: run.scanned, publicationRead: run.publicationRead,
      frontMatter: run.result.frontMatter, publication: run.result.publication, branding: run.result.branding, ids: run.result.ids,
      consumed: run.result.consumed, notConsumed: run.result.notConsumed, report: run.result.report, summary: run.result.summary,
      ...(run.scanned === 0 ? { hint: 'No front-matter data modules were found in this project\'s CSDB.' } : {}),
    });
  }));

  app.post(`${base}/generate`, requireProject('editor', { from: 'param', cap: 'dm.write' }), wrap(async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const gr: GenerateRequest = { overwrite: flag(b.overwrite), dryRun: flag(b.dryRun), pm: b.pm === 'merge' ? 'merge' : 'none' };
    if (b.pm !== undefined && b.pm !== 'merge' && b.pm !== 'none') throw bad('pm is "none" or "merge".', 'BAD_PM');
    if (b.frontMatter !== undefined) { if (!isObject(b.frontMatter)) throw bad('frontMatter must be an object.', 'BAD_FRONT_MATTER'); gr.frontMatter = b.frontMatter; }
    if (b.publication !== undefined) { if (!isObject(b.publication)) throw bad('publication must be an object.', 'BAD_PUBLICATION'); gr.publication = b.publication; }
    if (b.pages !== undefined) {
      const known = new Set<string>(PAGE_DEFS.map((d) => d.page));
      if (!Array.isArray(b.pages) || b.pages.some((p) => !known.has(String(p)))) throw bad(`pages is a list of: ${[...known].join(', ')}.`, 'BAD_PAGES');
      gr.pages = b.pages.map(String) as PageId[];
    }
    gr.ids = cleanIds(b.ids);
    const out = await generateForProject(req.project.id, gr, actor(req), req.project.role);
    if (!gr.dryRun) log(req, 'jssdm.generated', { written: out.written.filter((w) => w.action !== 'unchanged').length, skipped: out.skipped.length });
    res.status(gr.dryRun ? 200 : out.written.some((w) => w.action === 'created') ? 201 : 200).json({ dryRun: !!gr.dryRun, ...out });
  }));

  app.get(`${base}/status`, requireProject('viewer', { from: 'param', cap: 'project.read' }), wrap((req, res) => { res.json(statusOf(req.project.id)); }));
}
