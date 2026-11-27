// =============================================================================
// Administrator routes: reference data, platform settings, maintenance.
//
//   /api/admin/config[/:collection[/:id]]   reference tables (administrators only)
//   /api/admin/roles                        the platform's roles, as the code enforces them
//   /api/admin/maintenance/...              maintenance actions
//   /api/admin/app-settings                 platform settings (administrators write)
//   /api/app-settings                       the same, read by every signed-in user (look and name)
//
// Users, sessions, approvals and the audit log are served by the auth routes (core/auth/routes.js)
// and used by the Administrator screen as they are.
// =============================================================================

import type { Express } from 'express';
import { audit, requireAdmin, requireAuth, requireGlobal, store, defaultContext } from '../context';
import { exportAudit } from '../services/auditTrail';
import { capabilityTable, readableCapabilities } from '../services/permissions';
import { wrap, param } from '../services/http';
import { COLLECTIONS, createItem, deleteItem, listItems, specOf, updateItem } from '../services/adminConfig';
import * as platform from '../services/platform';
import * as publisher from '../services/publisher';
import { readProjectJson, pmRel } from '../services/projects';
import { projectDirFor } from '../context';
import fs from 'fs';
import path from 'path';

type Row = Record<string, any>;

import { riskyAllowed, setRiskyAllowed } from '../services/assets';
import { FORMATS } from '../services/mediaFormats';

export function registerAdminRoutes(app: Express): void {
  const log = (req: any, action: string, meta?: unknown) =>
    audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action, targetType: 'admin', meta });

  // ── Asset policy: the multimedia formats, and the opt-in for active-content types ────
  app.get('/api/admin/asset-policy', requireAdmin(), wrap((_req, res) => { res.json({ allowRisky: riskyAllowed(), formats: FORMATS.map((f) => ({ ext: f.ext, class: f.cls, source: f.source, risky: f.risky })) }); }));
  app.put('/api/admin/asset-policy', requireAdmin(), wrap((req, res) => { setRiskyAllowed(req.body?.allowRisky === true); log(req, 'asset-policy.changed', { allowRisky: req.body?.allowRisky === true }); res.json({ allowRisky: riskyAllowed() }); }));

  // ── Reference data ──────────────────────────────────────────────────────
  app.get('/api/admin/config', requireAdmin(), wrap((_req, res) => {
    res.json({ collections: COLLECTIONS.map((c) => ({ id: c.id, title: c.title, noun: c.noun, description: c.description, fields: c.fields, count: listItems(c.id).length })) });
  }));
  app.get('/api/admin/config/:collection', requireAdmin(), wrap((req, res) => {
    const spec = specOf(param(req, 'collection'));
    res.json({ spec: { id: spec.id, title: spec.title, noun: spec.noun, description: spec.description, fields: spec.fields }, items: listItems(spec.id) });
  }));
  app.post('/api/admin/config/:collection', requireAdmin(), wrap((req, res) => {
    const item = createItem(param(req, 'collection'), req.body ?? {});
    log(req, 'config.created', { collection: param(req, 'collection'), id: item.id });
    res.status(201).json({ item });
  }));
  app.put('/api/admin/config/:collection/:id', requireAdmin(), wrap((req, res) => {
    const item = updateItem(param(req, 'collection'), param(req, 'id'), req.body ?? {});
    log(req, 'config.updated', { collection: param(req, 'collection'), id: param(req, 'id') });
    res.json({ item });
  }));
  app.delete('/api/admin/config/:collection/:id', requireAdmin(), wrap((req, res) => {
    deleteItem(param(req, 'collection'), param(req, 'id'));
    log(req, 'config.deleted', { collection: param(req, 'collection'), id: param(req, 'id') });
    res.json({ ok: true });
  }));

  // The roles are fixed by the platform (they decide what the server permits), so they are shown, not edited.
  app.get('/api/admin/roles', requireAdmin(), wrap((_req, res) => {
    res.json({
      roles: [
        { name: 'Administrator', description: 'Oversees the platform: creates Project Managers and Authors, manages reference data, sees every project. Does not create projects.', system: true },
        { name: 'Project Manager', description: 'Creates Authors and projects, reviews manuals, comments, sends them back and approves releases for the projects they manage.', system: true },
        { name: 'Author', description: 'Creates and edits data modules and manuals, shares projects, submits manuals for review.', system: true },
        // WP-27 (PLT-016, ENT-023): a flag on an account rather than a fourth role
        { name: 'Auditor (read-only)', description: 'Reads every project, the audit log and the access lists; changes nothing. Set on an account under Users, or by a directory group mapped to "auditor".', system: true },
      ],
      projectRoles: [
        { name: 'Owner', description: 'Everything in the project, including the shared house template and locking.' },
        { name: 'Manager', description: 'Manages members and decides releases (Project Manager accounts only).' },
        { name: 'Editor', description: 'Edits content and settings, submits for review.' },
        { name: 'Reviewer', description: 'Builds previews and comments on a manual in review.' },
        { name: 'Viewer', description: 'Reads.' },
      ],
      // WP-27: the permission catalogue - every capability a project route declares and the lowest project role that holds it. A project's
      // managers can allow one capability to a person or group below that role, or deny it to anyone below owner (project > Access).
      capabilities: Object.entries(capabilityTable()).sort(([a], [b]) => a.localeCompare(b))
        .map(([capability, minRole]) => ({ capability, minRole, readable: readableCapabilities().has(capability) })),
    });
  }));

  // ── Reference data for creating data modules ────────────────────────────
  // What the Administrator maintains and the new data module wizard offers as dropdowns. Readable by every
  // signed-in user (the wizard runs for authors); only administrators change it.
  app.get('/api/reference', requireAuth(), wrap((_req, res) => {
    res.json({
      languages: listItems('language-codes'), countries: listItems('country-codes'), dmTypes: listItems('dm-types'),
      security: listItems('security-classes'),
      rpc: listItems('rpc-cages'), originators: listItems('originator-cages'),
    });
  }));

  // ── Platform settings ───────────────────────────────────────────────────
  app.get('/api/app-settings', requireAuth(), wrap((_req, res) => { res.json({ settings: platform.readSettings() }); }));
  app.get('/api/admin/app-settings', requireAdmin(), wrap((_req, res) => { res.json({ settings: platform.readSettings() }); }));
  app.put('/api/admin/app-settings', requireAdmin(), wrap((req, res) => {
    const settings = platform.writeSettings(req.body ?? {});
    log(req, 'settings.platform', settings);
    res.json({ settings });
  }));

  // ── Maintenance ─────────────────────────────────────────────────────────
  app.post('/api/admin/maintenance/reindex', requireAdmin(), wrap(async (req, res) => {
    const out = await platform.reindex();
    log(req, 'maintenance.reindex', out);
    res.json(out);
  }));
  app.post('/api/admin/maintenance/check-schemas', requireAdmin(), wrap((req, res) => {
    const out = platform.checkSchemas();
    log(req, 'maintenance.check-schemas', out);
    res.json(out);
  }));
  app.post('/api/admin/maintenance/clear-previews', requireAdmin(), wrap((req, res) => {
    const out = platform.clearPreviewFiles();
    log(req, 'maintenance.clear-previews', out);
    res.json(out);
  }));
  // Rebuilding every PDF takes minutes: answer at once with how many are queued; the audit log records the outcome.
  app.post('/api/admin/maintenance/rebuild-pdfs', requireAdmin(), wrap((req, res) => {
    const ids: string[] = store.listAllProjects().map((p: Row) => p.id).filter((id: string) => {
      try { return fs.existsSync(path.join(projectDirFor(id), pmRel(readProjectJson(id)))); } catch { return false; }
    });
    log(req, 'maintenance.rebuild-pdfs.started', { projects: ids.length });
    void (async () => {
      let ok = 0; const failed: string[] = [];
      for (const id of ids) {
        try { await publisher.buildPublication(id); ok++; } catch { failed.push(id); }
      }
      audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'maintenance.rebuild-pdfs.finished', targetType: 'admin', meta: { rebuilt: ok, failed } });
    })();
    res.status(202).json({ queued: ids.length });
  }));
  // WP-29 (ENT-003): the whole log, streamed oldest first in pages - formerly the newest 5 000 rows only
  app.get('/api/admin/maintenance/audit.csv', requireGlobal('audit.read'), wrap(async (req, res) => {   // WP-27: auditors export it too (the export is audited)
    log(req, 'maintenance.audit-export');
    res.type('text/csv').attachment('agastya-audit-log.csv');
    try { await exportAudit(defaultContext(), {}, 'csv', res); } catch (e) { if (!res.headersSent) throw e; res.destroy(); return; }
    res.end();
  }));
}
