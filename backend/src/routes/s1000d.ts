// =============================================================================
// S1000D reference configuration routes.
//
//   /api/s1000d/...                         read by every signed-in person (catalogues, SNS presets, config validation)
//   /api/admin/s1000d/...                   Administrator: master catalogues, provenance, SNS presets, impact-checked changes
//   /api/projects/:id/s1000d[...]           the project's own configuration (read: viewer; write: project owner / manager)
//   /api/projects/:id/sns[...]              the project's SNS hierarchy
// =============================================================================

import type { Express } from 'express';
import { audit, requireAdmin, requireAuth, requireProject } from '../context';
import { wrap, param, bad, conflict, notFound } from '../services/http';
import { csvRow } from '../services/csv';
import * as REF from '../services/s1000dRef';
import * as SNS from '../services/sns';
import * as PC from '../services/projectConfig';
import * as MC from '../services/modelCode';
import { listItems } from '../services/adminConfig';
import * as APP from '../services/applicability';
import * as EVAL from '../services/applicEval';
import * as publisher from '../services/publisher';
import * as jobs from '../services/jobs';
import { gateTargets } from '../services/publishGate';
import { projectDirFor } from '../context';
import { readProjectJson, pmRel } from '../services/projects';
import fs from 'fs';
import path from 'path';

const issueParam = (v: unknown): REF.IssueKey => {
  const k = REF.issueKeyOf(v);
  if (!k) throw bad(`S1000D issue: one of ${REF.ISSUE_KEYS.map((i) => REF.ISSUE_LABEL[i]).join(', ')}.`, 'BAD_ISSUE');
  return k;
};
const kindParam = (v: unknown): REF.CodeKind => {
  if (!REF.isKind(v)) throw bad(`Kind: one of ${REF.CODE_KINDS.join(', ')}.`, 'BAD_KIND');
  return v;
};

export function registerS1000dRoutes(app: Express): void {
  const projView = (min: string, cap: string) => requireProject(min, { from: 'param', cap });
  const aLog = (req: any, action: string, meta?: unknown) => audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action, targetType: 'admin', meta });
  const pLog = (req: any, action: string, meta?: unknown) => audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action, projectId: req.project.id, targetType: 'project', targetId: req.project.id, meta });

  // ── Read: catalogues and presets ────────────────────────────────────────
  app.get('/api/s1000d/catalogue', requireAuth(), wrap((req, res) => {
    const issue = issueParam(req.query.issue ?? '4-2');
    const kind = kindParam(req.query.kind ?? 'infoCode');
    res.json({
      issue, issueLabel: REF.ISSUE_LABEL[issue], kind, rule: REF.KIND_RULE[kind].rule, label: REF.KIND_RULE[kind].label,
      codes: REF.listCodes(kind, issue), ranges: REF.listRanges(kind, issue), sources: REF.listSources().filter((s) => s.issue === issue || s.issue === null),
      customNote: REF.CUSTOM_NOTE,
    });
  }));
  app.get('/api/s1000d/presets', requireAuth(), wrap((_req, res) => { res.json({ presets: SNS.listPresets() }); }));
  app.get('/api/s1000d/presets/:id', requireAuth(), wrap((req, res) => { res.json(SNS.getPreset(param(req, 'id'))); }));

  /** Check a project configuration (the wizard's review step) without creating anything. */
  app.post('/api/s1000d/validate-config', requireAuth(), wrap((req, res) => {
    const patch = (req.body?.s1000d ?? {}) as Record<string, any>;
    const next = PC.applyPatch(PC.defaultConfig(), patch);
    const notes: string[] = [];
    if (patch.snsPreset && !SNS.listPresets().some((p) => p.id === String(patch.snsPreset))) throw bad('No such SNS preset.', 'NO_PRESET');
    if (patch.snsPreset) {
      const dry = SNS.listPresets().find((p) => p.id === String(patch.snsPreset))!;
      notes.push(`SNS: ${dry.name} (${dry.systems} systems) will be copied into the project; it is the project's own from then on.`);
    }
    if (next.codeMode === 'selected' && !(patch.enabledCodes?.length)) throw bad('Choose at least one information code, or offer every code of the issue.', 'NO_CODES');
    if (Array.isArray(patch.enabledCodes) && next.issue) {
      const unknown = patch.enabledCodes.filter((c: string) => !REF.getCode('infoCode', next.issue!, c));
      if (unknown.length) throw bad(`Not in the Issue ${REF.ISSUE_LABEL[next.issue]} information-code catalogue: ${unknown.slice(0, 8).join(', ')}.`, 'UNKNOWN_CODE');
    }
    res.json({ ok: true, config: next, notes });
  }));

  // ── Administrator: master catalogues ────────────────────────────────────
  app.get('/api/admin/s1000d/overview', requireAdmin(), wrap((_req, res) => {
    const dmTypes = listItems('dm-types') as any[];
    res.json({
      summary: REF.catalogueSummary(), sources: REF.listSources(), unresolved: REF.UNRESOLVED_DEFAULTS, customNote: REF.CUSTOM_NOTE,
      evidence: { types: REF.SPEC_EVIDENCE, statuses: REF.EVIDENCE_STATUSES, ...REF.EVIDENCE_PROVENANCE },
      advice: Object.fromEntries(REF.ISSUE_KEYS.map((i) => [i, REF.typeAdvice(i, dmTypes)])),
      kinds: REF.CODE_KINDS.map((k) => ({ kind: k, rule: REF.KIND_RULE[k].rule, label: REF.KIND_RULE[k].label, hint: REF.KIND_RULE[k].hint })),
      issues: REF.ISSUE_KEYS.map((i) => ({ key: i, label: REF.ISSUE_LABEL[i] })),
    });
  }));

  app.post('/api/admin/s1000d/codes/impact', requireAdmin(), wrap((req, res) => {
    const kind = kindParam(req.body?.kind); const issue = issueParam(req.body?.issue);
    res.json({ impact: PC.codeImpact(kind, issue, String(req.body?.code ?? '')) });
  }));
  app.post('/api/admin/s1000d/codes', requireAdmin(), wrap((req, res) => {
    const kind = kindParam(req.body?.kind);
    const issues: REF.IssueKey[] = [...new Set<REF.IssueKey>((Array.isArray(req.body?.issues) && req.body.issues.length ? req.body.issues : [req.body?.issue]).map(issueParam))];
    // all or none: a code that clashes in ANY chosen issue is refused before anything is written
    const clash = issues.filter((i) => REF.getCode(kind, i, String(req.body?.code ?? '')));
    if (clash.length) throw conflict(`${String(req.body?.code).toUpperCase()} is already in the Issue ${clash.map((i) => REF.ISSUE_LABEL[i]).join(', ')} catalogue.`, 'DUPLICATE');
    const rows = REF.addCustomCodes(kind, issues, req.body?.code, req.body?.title);
    aLog(req, 'catalogue.code.added', { kind, code: rows[0].code, issues });
    const inRange = issues.every((i: REF.IssueKey) => REF.inProjectRange(kind, i, rows[0].code));
    res.status(201).json({ codes: rows, brexAccepts: inRange, note: inRange ? REF.RANGE_NOTE : REF.CUSTOM_NOTE });
  }));
  app.put('/api/admin/s1000d/codes', requireAdmin(), wrap((req, res) => {
    const kind = kindParam(req.body?.kind); const issue = issueParam(req.body?.issue); const code = String(req.body?.code ?? '');
    const impact = PC.codeImpact(kind, issue, code);
    if (impact.projects.length && req.body?.confirmImpact !== true) throw conflict('This change touches projects. Review them and confirm.', 'IMPACT_CONFIRMATION_REQUIRED', { impact });
    const row = REF.updateCustomCode(kind, issue, code, req.body?.title);
    if (impact.projects.length) PC.recordImpact(req.auth.user.id, `edit ${kind} ${code} (${issue})`, impact);
    aLog(req, 'catalogue.code.updated', { kind, issue, code, projects: impact.projects.length });
    res.json({ code: row, impact });
  }));
  app.delete('/api/admin/s1000d/codes', requireAdmin(), wrap((req, res) => {
    const kind = kindParam(req.query.kind); const issue = issueParam(req.query.issue); const code = String(req.query.code ?? '');
    const impact = PC.codeImpact(kind, issue, code);
    if (impact.projects.length && req.query.confirmImpact !== 'true') throw conflict('This change touches projects. Review them and confirm.', 'IMPACT_CONFIRMATION_REQUIRED', { impact });
    REF.deleteCustomCode(kind, issue, code);
    if (impact.projects.length) PC.recordImpact(req.auth.user.id, `delete ${kind} ${code} (${issue})`, impact);
    aLog(req, 'catalogue.code.deleted', { kind, issue, code, projects: impact.projects.length });
    res.json({ ok: true, impact });
  }));

  // ── Administrator: SNS presets ──────────────────────────────────────────
  app.post('/api/admin/s1000d/presets', requireAdmin(), wrap((req, res) => {
    const p = SNS.createPreset(req.body?.name, req.body?.model);
    aLog(req, 'sns.preset.created', { id: p.id, model: p.model });
    res.status(201).json({ preset: p });
  }));
  app.put('/api/admin/s1000d/presets/:id/model', requireAdmin(), wrap((req, res) => {
    const p = SNS.setPresetModel(param(req, 'id'), req.body?.model);
    aLog(req, 'sns.preset.model', { id: p.id, model: p.model });
    res.json({ preset: p });
  }));
  app.post('/api/admin/s1000d/presets/:id/duplicate', requireAdmin(), wrap((req, res) => {
    const p = SNS.duplicatePreset(param(req, 'id'), req.body?.name);
    aLog(req, 'sns.preset.duplicated', { from: param(req, 'id'), id: p.id });
    res.status(201).json({ preset: p });
  }));
  app.delete('/api/admin/s1000d/presets/:id', requireAdmin(), wrap((req, res) => {
    SNS.deletePreset(param(req, 'id'));
    aLog(req, 'sns.preset.deleted', { id: param(req, 'id') });
    res.json({ ok: true });
  }));
  app.put('/api/admin/s1000d/presets/:id/nodes', requireAdmin(), wrap((req, res) => {
    SNS.putPresetNode(param(req, 'id'), req.body?.path, req.body?.title);
    aLog(req, 'sns.preset.node', { id: param(req, 'id'), path: req.body?.path });
    res.json(SNS.getPreset(param(req, 'id')));
  }));
  app.delete('/api/admin/s1000d/presets/:id/nodes', requireAdmin(), wrap((req, res) => {
    const n = SNS.deletePresetNode(param(req, 'id'), req.query.path, req.query.cascade === 'true');
    aLog(req, 'sns.preset.node.deleted', { id: param(req, 'id'), path: req.query.path, removed: n });
    res.json({ removed: n });
  }));
  app.get('/api/admin/s1000d/presets/:id/export', requireAdmin(), wrap((req, res) => {
    const { nodes, preset } = SNS.getPreset(param(req, 'id'));
    const fmt = req.query.format === 'csv' ? 'csv' : 'json';
    const flat = nodes.filter((n) => !n.note?.category);
    if (fmt === 'csv') {
      const rows = ['system,subsystem,assembly,title', ...flat.map((n) => { const c = n.path.split('/'); return csvRow([c[0].replace(/#.*/, ''), c[1] ?? '', c[2] ?? '', n.title]); })];      // WP-07 (SEC-015)
      return res.type('text/csv').attachment(`${preset.id}.csv`).send(rows.join('\r\n') + '\r\n');
    }
    res.type('application/json').attachment(`${preset.id}.json`).send(JSON.stringify({ format: 'agastya-sns-preset', version: 1, preset: { id: preset.id, name: preset.name, source: preset.source, limitation: preset.limitation }, nodes: flat }, null, 2));
  }));
  app.post('/api/admin/s1000d/presets/:id/import', requireAdmin(), wrap((req, res) => {
    const id = param(req, 'id');
    const fmt = req.body?.format === 'csv' ? 'csv' : 'json';
    const { nodes, errors } = SNS.parseImport(fmt, String(req.body?.text ?? ''));
    if (errors.length) throw bad(errors.slice(0, 5).map((e) => `${e.line}: ${e.message}`).join('; '), 'BAD_IMPORT');
    let n = 0;
    for (const x of [...nodes].sort((a, b) => SNS.levelOfPath(a.path) - SNS.levelOfPath(b.path))) { SNS.putPresetNode(id, x.path, x.title); n++; }
    aLog(req, 'sns.preset.import', { id, nodes: n });
    res.json({ imported: n });
  }));

  // ── Project configuration ───────────────────────────────────────────────
  const base = '/api/projects/:id';
  app.get(`${base}/s1000d`, projView('viewer', 'project.read'), wrap((req, res) => {
    res.json(PC.authoringBundle(req.project.id));
  }));
  app.put(`${base}/s1000d`, projView('manager', 'config.write'), wrap((req, res) => {
    const patch = (req.body?.config ?? req.body ?? {}) as Record<string, any>;
    const cur = PC.getConfigRow(req.project.id);
    if (req.body?.expectedVersion !== undefined && cur && Number(req.body.expectedVersion) !== cur.version) throw conflict('The configuration was changed by someone else. Reload it and apply your change again.', 'CONFIG_VERSION');
    const row = PC.updateConfig(req.project.id, patch, req.auth.user.id);
    pLog(req, 'project.config.updated', { fields: Object.keys(patch), version: row.version });
    res.json(PC.authoringBundle(req.project.id));
  }));
  // Change the model identification code of a project that already has data modules: a preview (apply: false) and then the change (apply: true).
  app.post(`${base}/model-code`, projView('manager', 'config.write'), wrap(async (req, res) => {
    const plan = await MC.changeModelCode(req.project.id, req.body?.mic, req.auth.user.id, { apply: req.body?.apply === true });
    if (plan.applied) pLog(req, 'project.model-code.changed', { from: plan.from, to: plan.to, files: plan.filesChanged, backup: plan.backup });
    res.status(plan.problems.length ? 409 : 200).json(plan);
  }));
  app.put(`${base}/s1000d/codes`, projView('manager', 'config.write'), wrap((req, res) => {
    const kind = kindParam(req.body?.kind ?? 'infoCode');
    if (!Array.isArray(req.body?.codes)) throw bad('codes: a list of code values.', 'BAD_CODES');
    PC.setSelectedCodes(req.project.id, kind, req.body.codes);
    if (req.body?.codeMode) PC.updateConfig(req.project.id, { codeMode: req.body.codeMode }, req.auth.user.id);
    pLog(req, 'project.config.codes', { kind, count: req.body.codes.length, codeMode: req.body?.codeMode });
    res.json(PC.authoringBundle(req.project.id));
  }));
  app.put(`${base}/s1000d/dm-types`, projView('manager', 'config.write'), wrap((req, res) => {
    if (!Array.isArray(req.body?.enabled)) throw bad('enabled: a list of DM type schemas.', 'BAD_TYPES');
    PC.setDmTypes(req.project.id, req.body.enabled);
    pLog(req, 'project.config.dm-types', { enabled: req.body.enabled.length });
    res.json(PC.authoringBundle(req.project.id));
  }));

  // ── Project SNS ─────────────────────────────────────────────────────────
  app.get(`${base}/sns`, projView('viewer', 'project.read'), wrap((req, res) => {
    res.json({ ...SNS.projectSnsView(req.project.id, String(req.query.q ?? '')), levels: SNS.LEVELS.map((l) => ({ level: l.level, name: l.name, hint: l.hint })), enforced: PC.getConfig(req.project.id).snsEnforced });
  }));
  app.post(`${base}/sns`, projView('manager', 'config.write'), wrap((req, res) => {
    const node = SNS.createProjectNode(req.project.id, req.body?.path, req.body?.title);
    pLog(req, 'project.sns.added', { path: node.path });
    res.status(201).json({ node });
  }));
  app.patch(`${base}/sns`, projView('manager', 'config.write'), wrap((req, res) => {
    const node = SNS.updateProjectNode(req.project.id, String(req.body?.path ?? ''), { title: req.body?.title, code: req.body?.code });
    pLog(req, 'project.sns.updated', { path: req.body?.path, to: node.path });
    res.json({ node });
  }));
  app.delete(`${base}/sns`, projView('manager', 'config.write'), wrap((req, res) => {
    const removed = SNS.deleteProjectNode(req.project.id, String(req.query.path ?? ''), req.query.cascade === 'true');
    pLog(req, 'project.sns.deleted', { path: req.query.path, removed });
    res.json({ removed });
  }));
  app.post(`${base}/sns/preset`, projView('manager', 'config.write'), wrap((req, res) => {
    const id = String(req.body?.presetId ?? '');
    if (!SNS.listPresets().some((p) => p.id === id)) throw notFound('No such SNS preset.');
    const report = SNS.applyPreset(req.project.id, id, { systems: Array.isArray(req.body?.systems) ? req.body.systems : undefined, dryRun: req.body?.dryRun === true });
    if (!req.body?.dryRun) pLog(req, 'project.sns.preset', { preset: id, added: report.added });
    res.json({ report });
  }));
  app.get(`${base}/sns/export`, projView('viewer', 'project.read'), wrap((req, res) => {
    const out = SNS.exportProject(req.project.id, req.query.format === 'csv' ? 'csv' : 'json');
    res.type(out.type).attachment(out.name).send(out.body);
  }));
  app.post(`${base}/sns/import`, projView('manager', 'config.write'), wrap((req, res) => {
    const fmt = req.body?.format === 'csv' ? 'csv' : 'json';
    const report = SNS.importProject(req.project.id, fmt, String(req.body?.text ?? ''), { dryRun: req.body?.dryRun === true, overwriteTitles: req.body?.overwriteTitles === true });
    if (!req.body?.dryRun) pLog(req, 'project.sns.import', { format: fmt, added: report.added, conflicts: report.conflicts.length });
    res.json({ report });
  }));

  // ── Applicability (ACT / CCT / PCT) ─────────────────────────────────────
  app.get(`${base}/applicability`, projView('viewer', 'project.read'), wrap(async (req, res) => {
    const { model, files } = APP.readModel(req.project.id);
    res.json({ model, files, problems: await APP.validateProject(req.project.id), filtering: false,
      note: 'Applicability is authored and validated. Publication filtering by product configuration is not implemented: a publication contains every data module.' });
  }));
  app.put(`${base}/applicability`, projView('manager', 'config.write'), wrap(async (req, res) => {
    const m = req.body?.model;
    if (!m || typeof m !== 'object') throw bad('model: the applicability definitions.', 'BAD_APPLICABILITY');
    const model: APP.ApplicModel = { attributes: m.attributes ?? [], conditionTypes: m.conditionTypes ?? [], conditions: m.conditions ?? [], products: m.products ?? [] };
    const out = await APP.writeModel(req.project.id, model, { id: req.auth.user.id, username: req.auth.user.username, role: req.auth.user.role }, req.project.role);
    pLog(req, 'project.applicability.written', { files: out.written.map((w) => w.file) });
    res.json({ ...out, problems: await APP.validateProject(req.project.id) });
  }));
  app.get(`${base}/applicability/validate`, projView('viewer', 'project.read'), wrap(async (req, res) => { res.json({ problems: await APP.validateProject(req.project.id) }); }));

  // ── Configuration-specific publication ──────────────────────────────────
  // What a configuration can be made of, and the configuration PDFs already built.
  app.get(`${base}/publish/configurations`, projView('viewer', 'project.read'), wrap((req, res) => {
    const { model } = APP.readModel(req.project.id);
    res.json({
      products: model.products.map((p) => ({ id: p.id, assigns: p.assigns })),
      attributes: model.attributes.map((a) => ({ id: a.id, name: a.name, values: a.values.map((v) => v.value), type: a.valueDataType, pattern: a.valuePattern ?? null })),
      conditions: model.conditions.map((c) => { const t = model.conditionTypes.find((x) => x.id === c.condTypeId); return { id: c.id, name: c.name, values: t?.values.map((v) => v.value) ?? [], type: t?.valueDataType ?? 'string' }; }),
      builds: publisher.listConfiguredPdfs(req.project.id),
      note: 'A configuration-specific publication is a separate PDF; the unfiltered publication is unchanged.',
    });
  }));

  /** The same decisions a build would make, without building: what applies, what is left out, and anything unresolved. */
  const planFor = (projectId: string, body: any) => {
    const sel = EVAL.buildSelection(projectId, { productId: body?.productId || undefined, values: Array.isArray(body?.values) ? body.values : undefined });
    const dir = projectDirFor(projectId);
    const pj = readProjectJson(projectId);
    const pmFile = pmRel(pj);
    const pmAbs = path.join(dir, pmFile);
    if (!fs.existsSync(pmAbs)) throw bad('This project has no publication module yet.', 'NO_PM');
    const dms = gateTargets(projectId, 'publication').map((rel) => ({ file: rel.split('/').pop() ?? rel, xml: fs.readFileSync(path.join(dir, rel), 'utf8') }));
    return EVAL.planConfiguration(sel, pmFile, fs.readFileSync(pmAbs, 'utf8'), dms);
  };
  app.post(`${base}/publish/configured/plan`, projView('viewer', 'project.read'), wrap((req, res) => {
    const plan = planFor(req.project.id, req.body);
    res.json({
      label: plan.selection.label, values: plan.selection.summary, summary: plan.summary, excluded: plan.excluded,
      unresolved: plan.unresolved, properties: [...new Set(plan.unresolved.flatMap((u) => u.properties))], canBuild: !plan.unresolved.length && plan.summary.included > 0,
    });
  }));
  app.post(`${base}/publish/configured`, projView('reviewer', 'publish.build'), wrap(async (req, res) => {
    // WP-14: a configuration PDF is a build job in a worker process
    const out = await jobs.run<publisher.ConfiguredBuildResult>({ kind: 'configured', projectId: req.project.id, params: { productId: req.body?.productId || undefined, values: Array.isArray(req.body?.values) ? req.body.values : undefined }, actor: { id: req.auth.user.id, username: req.auth.user.username } });
    pLog(req, 'publish.configured', { name: out.name, label: out.plan.label });
    res.status(201).json({ name: out.name, file: out.file, plan: out.plan, releaseLabel: out.releaseLabel, totalMs: out.totalMs });
  }));
  app.get(`${base}/publish/configured/:name`, projView('viewer', 'project.read'), wrap((req, res) => {
    const name = path.basename(param(req, 'name'));
    const abs = path.join(projectDirFor(req.project.id), publisher.CONFIG_DIR, name);
    if (!/\.pdf$/i.test(name) || !fs.existsSync(abs)) throw notFound('No such configuration PDF.');
    res.type('application/pdf');
    if (req.query.download === '1') res.attachment(name);
    res.sendFile(abs);
  }));
}
