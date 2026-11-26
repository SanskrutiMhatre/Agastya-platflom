// Keeps the S1000D-side writers away from a JSS document project.
//
// A JSS document project's `publication.xml` is the JSS document (<jssbook>). The S1000D importer, the publication-module routes and the package / data-module imports all write
// `publication.xml` as an S1000D publication module or a package contents list. They are untouched (the S1000D importer and engine are not modified); this guard is registered
// BEFORE them and answers 409 for a JSS document project, so the file can never be replaced. Documents come into a JSS project through its own import (routes/jss-rwi.ts).

import type { Express } from 'express';
import { requireProject } from '../context';
import { isJssAuthored } from '../services/jss/service';

/** [method, path below /api/projects/:id] of every S1000D-side route that writes the publication module, the data modules or the package state. */
export const S1000D_WRITERS: Array<[string, string]> = [
  ['post', 'import/apply'], ['post', 'import/assign'], ['put', 'pmc'], ['post', 'pmc/import'], ['post', 'packages/import'], ['post', 'dms-import'],
];

export function registerJssGuard(app: Express): void {
  for (const [method, sub] of S1000D_WRITERS) {
    (app as any)[method](`/api/projects/:id/${sub}`, requireProject('viewer', { from: 'param', cap: 'project.read' }), (req: any, res: any, next: () => void) => {
      if (!isJssAuthored(req.project.id)) return next();
      res.status(409).json({ error: 'This is a JSS document project: its publication.xml is the JSS document and is not replaced by an S1000D import. Use "Import project" in the JSS document to bring in an RWI package.', code: 'JSS_PROJECT_PROTECTED' });
    });
  }
}
