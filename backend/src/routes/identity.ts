// The S1000D metadata of a JSS or JSG project (document codes, publication code, picture names, contents list), kept in the backend.
//
//   GET /api/projects/:id/identity               the codes, made or brought up to date from the document                                    (viewer)
//   PUT /api/projects/:id/identity               change the model / publication identity (model code, issuer, number, volume, language)  (editor)
//   PUT /api/projects/:id/identity/visibility    whether the editor writes each section's code beside its heading (off at first)            (editor)
//
// The data is always kept and always returned; `show` only says whether the editor should write the section codes beside the headings. An S1000D project has its own, always visible, codes and is not served here.

import type { Express } from 'express';
import { requireProject, audit } from '../context';
import { wrap, bad } from '../services/http';
import { changeIdentity, changeVisibility, identityOf } from '../services/xengine/project';

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function registerIdentityRoutes(app: Express): void {
  const base = '/api/projects/:id/identity';
  const log = (req: any, action: string, meta?: unknown): void => audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action, projectId: req.project.id, targetType: 'project', targetId: req.project.id, meta });

  app.get(base, requireProject('viewer', { from: 'param', cap: 'project.read' }), wrap((req, res) => {
    const { view, result } = identityOf(req.project.id);
    res.json({ ok: true, identity: view, updated: result ? { added: result.added, retired: result.retired, picturesAdded: result.picturesAdded } : null });
  }));

  app.put(base, requireProject('editor', { from: 'param', cap: 'dm.write' }), wrap((req, res) => {
    if (!isObject(req.body)) throw bad('Send the identity as a JSON object.', 'BAD_BODY');
    const out = changeIdentity(req.project.id, req.body as any);
    log(req, 'identity.changed', { keys: Object.keys(req.body) });
    res.json({ ok: true, identity: out.view });
  }));

  app.put(`${base}/visibility`, requireProject('editor', { from: 'param', cap: 'dm.write' }), wrap((req, res) => {
    if (!isObject(req.body)) throw bad('Send { "dmc": true }.', 'BAD_BODY');
    const out = changeVisibility(req.project.id, req.body as any);
    log(req, 'identity.visibility', req.body);       // WP-29 (G-SEC-5): every state change is audited
    res.json({ ok: true, identity: out.view });
  }));
}
