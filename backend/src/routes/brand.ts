// Brand packs (templates/brand/<id>/brand.json + logo), read-only, for the Settings picker.
//
//   GET /api/brand-packs              the packs installed in this workspace: { packs: [{ id, name, company, hasLogo }] }
//   GET /api/brand-packs/:id/logo     the pack's logo image (404 when it has none)
//
// Any signed-in user may read them: the list is what a project's Settings offers. Installing a pack is a file copy into the workspace's
// templates/brand folder (see templates-optional/README.md); nothing here writes. The id is checked by the engine before it touches a path.

import type { Express } from 'express';
import path from 'path';
import { requireAuth, workspaceDir } from '../context';
import { vendor } from '../config';
import { wrap, param, notFound } from '../services/http';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const brandEngine: any = vendor('engine/brand');

const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

export function registerBrandRoutes(app: Express): void {
  const templates = (): string => path.join(workspaceDir, 'templates');

  app.get('/api/brand-packs', requireAuth(), wrap((_req, res) => {
    res.json({ packs: brandEngine.listBrandPacks(templates()) });
  }));

  app.get('/api/brand-packs/:id/logo', requireAuth(), wrap((req, res) => {
    const pack = brandEngine.loadBrandPack(templates(), param(req, 'id'));
    if (!pack || !pack.logoAbs) throw notFound('That brand pack has no logo.');
    const type = TYPES[path.extname(pack.logoAbs).toLowerCase()];
    if (!type) throw notFound('That brand pack has no logo.');
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(pack.logoAbs);
  }));
}
