// =============================================================================
// Standard Numbering System (SNS) routes.
//
//   /api/projects/:id/sns-rows ...   one project's SNS: rows, validation, structure derivation, BREX import, learning from modules
//   /api/sns/defaults ...       the organisation's default SNS (any signed-in user reads; an administrator writes)
//
// Same ladder as the other project routes: viewer reads; editor changes. Software administrators are owner-equivalent.
// Nothing here replaces an existing title on its own: imports and learning add what is new and REPORT what differs.
// =============================================================================

import type { Express, RequestHandler } from 'express';
import { requireProject, requireAdmin, requireAuth, audit } from '../context';
import { wrap, param, bad, notFound } from '../services/http';
import { INFO_CODE_GROUPS, SNS_CODE_RULES, SNS_LEVELS, parseDmCode, type OrderConfig, type SnsLevel } from '../services/sns/codes';
import { SnsTree, normalizeRow, snsTitle, validateRowSet } from '../services/sns/model';
import { orgRepo, projectRepo, createRow, updateRow, deleteRow, mergeRows, mergeLegacyIntoDefaults, memoryRepo, writeProjectOrder, readProjectOrder, checkedOrder as orderOf } from '../services/sns/store';
import { structureDms } from '../services/sns/derive';
import { applyDerived, brexRowsForProject, deriveForProject, importDefaultsInto, learnForProject, orderingInfo, type DeriveRequest } from '../services/sns/service';

const view = (min: string, cap = 'project.read'): RequestHandler => requireProject(min, { from: 'param', cap });
const flag = (v: unknown): boolean => v === true || v === 'true' || v === '1' || v === 1;

const rulesView = () => ({
  levels: SNS_LEVELS,
  codes: Object.fromEntries(Object.entries(SNS_CODE_RULES).map(([k, v]) => [k, v.text])),
  note: 'systemDiffCode is optional: a row without one applies to every variant, a row with one overrides it for that variant.',
});


export function registerSnsRoutes(app: Express): void {
  const base = '/api/projects/:id/sns-rows';
  const log = (req: any, action: string, meta?: unknown) => audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action, projectId: req.project.id, targetType: 'project', targetId: req.project.id, meta });

  // ── the project's SNS ───────────────────────────────────────────────────
  app.get(base, view('viewer'), wrap((req, res) => {
    const rows = projectRepo(req.project.id).list();
    res.json({ rows, tree: SnsTree.from(rows).nested(), problems: validateRowSet(rows), rules: rulesView() });
  }));

  app.post(base, view('editor', 'pm.write'), wrap((req, res) => {
    const out = createRow(projectRepo(req.project.id), req.body);
    log(req, 'sns.created', { code: out.row.systemCode + out.row.subSystemCode + out.row.subSubSystemCode + out.row.assyCode });
    res.status(201).json(out);
  }));

  // Static paths first: ":rowId" would otherwise swallow them.
  app.get(`${base}/ordering`, view('viewer'), wrap((req, res) => { res.json(orderingInfo(req.project.id)); }));

  app.put(`${base}/ordering`, view('editor', 'pm.write'), wrap((req, res) => {
    const order = orderOf(req.body?.order);
    writeProjectOrder(req.project.id, order);
    log(req, 'sns.ordering', { set: !!order });
    res.json(orderingInfo(req.project.id));
  }));

  // The title of an SNS code at a level: ?code=DMC-... | A05-40-00 | ?systemCode=&subSystemCode=...  &level=system|subsystem|subsubsystem|assy (default: the deepest defined)
  app.get(`${base}/title`, view('viewer'), wrap((req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const code = q.code ?? { systemDiffCode: q.systemDiffCode, systemCode: q.systemCode, subSystemCode: q.subSystemCode, subSubSystemCode: q.subSubSystemCode, assyCode: q.assyCode };
    if (!parseDmCode(typeof code === 'string' ? code : { ...code, modelIdentCode: 'XX' })) throw bad('Give code (a data module code or SNS code) or systemCode, subSystemCode, subSubSystemCode and assyCode.', 'BAD_CODE');
    const level = (q.level ?? 'auto') as SnsLevel | 'auto';
    if (level !== 'auto' && !SNS_LEVELS.includes(level)) throw bad(`level is one of ${SNS_LEVELS.join(', ')}.`, 'BAD_LEVEL');
    const tree = SnsTree.from(projectRepo(req.project.id).list());
    res.json({ title: snsTitle(code, tree, level), level, lookup: tree.lookup(code) });
  }));

  app.post(`${base}/derive`, view('editor', 'pm.write'), wrap((req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const apply = flag(b.apply);
    const dreq: DeriveRequest = {
      sns: (['project', 'defaults', 'merged'].includes(String(b.sns)) ? b.sns : 'project') as DeriveRequest['sns'],
      order: orderOf(b.order),
      collapseZero: b.collapseZero === undefined ? undefined : flag(b.collapseZero),
      unmatched: b.unmatched === 'unclassified' ? 'unclassified' : b.unmatched === 'deepest' ? 'deepest' : undefined,
      unclassifiedTitle: typeof b.unclassifiedTitle === 'string' ? b.unclassifiedTitle : undefined,
      titleFormat: b.titleFormat === 'code-title' ? 'code-title' : undefined,
      excludeFrontMatter: b.excludeFrontMatter === undefined ? undefined : flag(b.excludeFrontMatter),
      placement: b.placement === 'unplaced' ? 'unplaced' : 'replace',
      pmTitle: typeof b.pmTitle === 'string' ? b.pmTitle : undefined,
    };
    const out = deriveForProject(req.project.id, dreq);
    let applied: ReturnType<typeof applyDerived> | undefined;
    if (apply) {
      applied = applyDerived(req.project.id, out);
      log(req, 'sns.derived', { modules: structureDms(out.structure).length, entries: out.pm.entries, placement: out.pm.placement });
    }
    res.json({
      applied: !!applied, ...(applied ?? {}), snsRows: out.snsRows, structure: out.structure,
      pm: { entries: out.pm.entries, headerFrom: out.pm.headerFrom, placement: out.pm.placement, ...(flag(b.includeXml) ? { xml: out.pm.xml } : {}) },
      hints: out.hints,
    });
  }));

  // BREX: preview what the project's BREX data modules (snsRules) define; `apply` adds the new rows (titles that differ are reported, kept).
  app.post(`${base}/import-brex`, view('editor', 'pm.write'), wrap((req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const found = brexRowsForProject(req.project.id);
    const repo = projectRepo(req.project.id);
    const apply = flag(b.apply);
    const merge = mergeRows(apply ? repo : memoryRepo(repo.list()), found.rows, { overwrite: flag(b.overwrite) });
    if (apply) log(req, 'sns.imported', { from: 'brex', added: merge.added.length });
    res.json({ applied: apply, sources: found.sources, notes: found.notes, unreadable: found.rejected, ...summary(merge) });
  }));

  // Organisation defaults -> this project. Same rule: add what is missing, report differences.
  app.post(`${base}/import-defaults`, view('editor', 'pm.write'), wrap((req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const apply = flag(b.apply);
    const rows = orgRepo.list().map(({ id: _id, ...r }) => r);
    const repo = projectRepo(req.project.id);
    const merge = apply ? importDefaultsInto(req.project.id, flag(b.overwrite)) : mergeRows(memoryRepo(repo.list()), rows, { overwrite: flag(b.overwrite) });
    if (apply) log(req, 'sns.imported', { from: 'defaults', added: merge.added.length });
    res.json({ applied: apply, ...summary(merge) });
  }));

  // Learn from the modules: proposals with a confidence and the reason. Nothing is written until the caller names what to accept.
  app.post(`${base}/learn`, view('editor', 'pm.write'), wrap((req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const out = learnForProject(req.project.id);
    let applied: ReturnType<typeof mergeRows> | undefined;
    if (flag(b.apply)) {
      const accept = Array.isArray(b.accept) ? new Set(b.accept.map(String)) : null;
      const min = typeof b.minConfidence === 'number' ? b.minConfidence : 0;
      if (!accept && !flag(b.acceptAll)) throw bad('Say which proposals to accept: accept: [keys] from this response, or acceptAll: true.', 'ACCEPT_REQUIRED');
      const chosen = out.proposals.filter((p) => p.status === 'new' && p.confidence >= min && (accept ? accept.has(p.key) : true));
      applied = mergeRows(projectRepo(req.project.id), chosen.map((p) => p.row));
      log(req, 'sns.learned', { added: applied.added.length });
    }
    res.json({ ...out, applied: applied ? summary(applied) : null });
  }));

  app.put(`${base}/:rowId`, view('editor', 'pm.write'), wrap((req, res) => {
    const out = updateRow(projectRepo(req.project.id), param(req, 'rowId'), req.body, flag(req.query.cascade ?? req.body?.cascade));
    log(req, 'sns.updated', { id: out.row.id });
    res.json(out);
  }));

  app.delete(`${base}/:rowId`, view('editor', 'pm.write'), wrap((req, res) => {
    const out = deleteRow(projectRepo(req.project.id), param(req, 'rowId'), flag(req.query.cascade));
    log(req, 'sns.deleted', { id: param(req, 'rowId'), removed: out.removed });
    res.json(out);
  }));

  // ── organisation defaults ───────────────────────────────────────────────
  app.get('/api/sns/defaults', requireAuth(), wrap((_req, res) => {
    const rows = orgRepo.list();
    res.json({ rows, problems: validateRowSet(rows), rules: rulesView(), infoCodeGroups: INFO_CODE_GROUPS });
  }));

  // The Administrator's older two-column SNS table -> the defaults, on request (it can gain rows after the one-off seeding). Same rule as every import:
  // add what is missing, report what differs, replace nothing unless asked. {apply:false} writes nothing.
  app.post('/api/sns/defaults/merge-legacy', requireAdmin(), wrap((req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const apply = flag(b.apply);
    const merge = mergeLegacyIntoDefaults({ apply, overwrite: flag(b.overwrite) });
    if (apply) audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'sns.defaults.merged-legacy', targetType: 'sns-defaults', meta: { added: merge.added.length, overwritten: merge.conflicts.filter((c) => c.overwritten).length } });
    res.json({ applied: apply, legacy: merge.legacy, ...summary(merge) });
  }));

  app.post('/api/sns/defaults', requireAdmin(), wrap((req, res) => {
    const out = createRow(orgRepo, req.body);
    audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'sns.defaults.created', targetType: 'sns-defaults', targetId: out.row.id });
    res.status(201).json(out);
  }));

  app.put('/api/sns/defaults/:rowId', requireAdmin(), wrap((req, res) => {
    const out = updateRow(orgRepo, param(req, 'rowId'), req.body, flag(req.query.cascade ?? req.body?.cascade));
    audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'sns.defaults.updated', targetType: 'sns-defaults', targetId: out.row.id });
    res.json(out);
  }));

  app.delete('/api/sns/defaults/:rowId', requireAdmin(), wrap((req, res) => {
    const out = deleteRow(orgRepo, param(req, 'rowId'), flag(req.query.cascade));
    audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'sns.defaults.deleted', targetType: 'sns-defaults', targetId: param(req, 'rowId') });
    res.json(out);
  }));

  void notFound; void normalizeRow; void readProjectOrder;
}

function summary(m: ReturnType<typeof mergeRows>) {
  return { added: m.added, same: m.same, present: m.present, conflicts: m.conflicts, rejected: m.rejected, counts: { added: m.added.length, same: m.same, conflicts: m.conflicts.length, rejected: m.rejected.length } };
}
