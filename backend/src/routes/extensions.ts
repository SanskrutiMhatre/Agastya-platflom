// Extension profiles: Administrators register (namespace + XSD); projects explicitly enable.
import type { Express } from 'express';
import { audit, requireAdmin, requireProject, store } from '../context';
import { wrap, param, forbidden } from '../services/http';
import * as ext from '../services/extensions';
import { isCirProject } from '../services/projects';

export function registerExtensionRoutes(app: Express): void {
  const alog = (req: any, action: string, meta?: unknown) => audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action, targetType: 'admin', meta });
  app.get('/api/admin/extensions', requireAdmin(), wrap((_req, res) => {
    res.json({ profiles: ext.listProfiles().map((p) => ({ ...p, projects: store.stmt('SELECT COUNT(*) AS n FROM project_ext WHERE profile_id = ?').get(p.id).n })) });
  }));
  app.post('/api/admin/extensions', requireAdmin(), wrap(async (req, res) => {
    const p = await ext.registerProfile(req.auth.user.id, { name: req.body?.name, namespace: req.body?.namespace, description: req.body?.description, xsd: req.body?.xsd, xsdName: req.body?.xsdName });
    alog(req, 'extension.registered', { name: p.name, namespace: p.namespace, sha256: p.xsdSha256 }); res.status(201).json(p);
  }));
  app.delete('/api/admin/extensions/:id', requireAdmin(), wrap((req, res) => { ext.deleteProfile(param(req, 'id')); alog(req, 'extension.deleted', { id: param(req, 'id') }); res.json({ ok: true }); }));

  const base = '/api/projects/:id/extensions';
  app.get(base, requireProject('viewer', { from: 'param', cap: 'project.read' }), wrap((req, res) => {
    const on = ext.enabledFor(req.project.id); res.json({ profiles: ext.listProfiles().map((p) => ({ id: p.id, name: p.name, namespace: p.namespace, description: p.description, enabled: on.has(p.id) })) });
  }));
  app.put(`${base}/:profileId`, requireProject('manager', { from: 'param', cap: 'config.write' }), wrap((req, res) => {
    if (isCirProject(req.project.id)) throw forbidden('Extension profiles are not used in the shared repository.', 'CIR_NO_EXTENSIONS');      // WP-07 (PLT-024): a 403, not a 500
    ext.setEnabled(req.project.id, param(req, 'profileId'), req.body?.enabled !== false, req.auth.user.id);
    audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: req.body?.enabled === false ? 'extension.disabled' : 'extension.enabled', projectId: req.project.id, targetType: 'project', targetId: req.project.id, meta: { profile: param(req, 'profileId') } });
    res.json({ ok: true });
  }));
}
