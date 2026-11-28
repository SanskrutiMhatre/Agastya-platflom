'use strict';
// WP-29 (G-SEC-5, AU-2): audit coverage, in the style of routes-guarded. Every state-changing route (POST/PUT/PATCH/DELETE) registered in
// src/routes/*.ts and src/core/auth/routes.js must either write an audit row in its handler (audit(), auditStrict(), auditedTx(), a
// local xLog(req, ...) helper, ctx.audit()) or be listed below with the reason it needs none or where it audits instead. A new route
// without either fails this test; an allow-list entry that no longer matches a route fails it too (the list cannot rot).
// Static source reading only: no server is started.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.resolve(__dirname, '..', 'src');
const REG = /\bapp\.(get|post|put|patch|delete)\(\s*(`[^`]*`|'[^']*'|"[^"]*"|[A-Za-z_$][\w$.]*)/g;
// critical(req, ...) is access.ts's auditedTx wrapper (WP-27 changes that fail closed)
const AUDITS = /\baudit(Strict|edTx)?\(|[A-Za-z]*[lL]og\(req|\.audit\(|\bcritical\(req/;

// "<file> <METHOD> <path as written>": reason
const ALLOWED = {
  // audited by the service the handler calls
  "access.ts POST '/api/admin/directory/sync'": 'core/auth/directory.js runDirectorySync audits directory.sync / directory.sync.failed (every outcome)',
  "backups.ts POST '/api/admin/backups'": 'services/dataProtection.ts backupNow audits backup.created / backup.failed',
  "backups.ts POST '/api/admin/backups/:name/verify'": 'services/dataProtection.ts restoreTest audits backup.restore_tested',
  'project-content.ts POST `${base}/release/:relId/approve`': 'decide() above the registration writes release.approved with auditedTx',
  'project-content.ts POST `${base}/release/:relId/reject`': 'decide() above the registration writes release.rejected with auditedTx',
  "workspace.ts POST '/api/folders'": 'services/projects.ts createFolder audits folder.created',
  "workspace.ts PATCH '/api/folders/:key'": 'services/projects.ts renameFolder audits folder.renamed',
  "workspace.ts DELETE '/api/folders/:key'": 'services/projects.ts deleteFolder audits folder.deleted',
  "workspace.ts PUT '/api/folders/:key/access'": 'services/projects.ts setFolderAccess audits folder.access_changed',
  "workspace.ts POST '/api/projects'": 'services/projects.ts createProject audits project.created',
  "workspace.ts POST '/api/projects/sample'": 'creates through services/projects.ts createProject (project.created)',
  "workspace.ts POST '/api/projects/sample-jsg'": 'creates through services/projects.ts createProject (project.created)',
  "workspace.ts POST '/api/projects/sample-jss'": 'creates through services/projects.ts createProject (project.created)',
  "workspace.ts PATCH '/api/projects/:id'": 'services/projects.ts updateProject audits project.updated',
  "workspace.ts DELETE '/api/projects/:id'": 'services/projects.ts deleteProject audits project.deleted',
  "workspace.ts POST '/api/projects/:id/copy'": 'services/projects.ts createProject audits project.created with meta.from',
  "routes.js POST '/api/admin/users/:id/reset'": 'issueAdminReset() in the same file audits user.reset',
  // no lasting state change (checks, previews, renders on demand, personal bookkeeping)
  'jsg.ts POST `${base}/validate`': 'validation of the posted document; nothing is stored',
  'jss.ts POST `${base}/validate`': 'validation of the posted document; nothing is stored',
  "packages.ts POST '/api/projects/import/detect'": 'reads an uploaded package to say what it is; nothing is imported',
  'packages.ts POST `${base}/objects/:file/pdf`': 'renders a PDF of an existing object on demand; no project content changes',
  'project-content.ts POST `${base}/publish/preview/:file`': 'a draft preview of one module; nothing is published',
  "s1000d.ts POST '/api/s1000d/validate-config'": 'checks a configuration; nothing is stored',
  "s1000d.ts POST '/api/admin/s1000d/codes/impact'": 'says what a code change would affect; nothing is changed',
  's1000d.ts POST `${base}/publish/configured/plan`': 'the plan of a configured build; nothing is built',
  "team.ts POST '/api/notifications/read'": "marks the caller's own notifications read (personal inbox state)",
  "workspace.ts POST '/api/projects/:id/open'": "remembers the caller's last opened project (personal state)",
  "routes.js POST '/api/auth/activity'": 'keeps the caller\'s session from idling out; no data changes',
  "routes.js POST '/api/admin/users/import/preview'": 'parses a CSV to preview it; the commit route audits user.import.committed',
};

function routes() {
  const files = [...fs.readdirSync(path.join(SRC, 'routes')).filter((f) => /\.(ts|js)$/.test(f)).map((f) => path.join(SRC, 'routes', f)), path.join(SRC, 'core', 'auth', 'routes.js')];
  const out = [];
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    const regs = []; let m; REG.lastIndex = 0;
    while ((m = REG.exec(s))) regs.push({ at: m.index, method: m[1], path: m[2] });
    regs.forEach((r, i) => {
      if (r.method === 'get') return;
      const body = s.slice(r.at, i + 1 < regs.length ? regs[i + 1].at : s.length);
      out.push({ key: `${path.basename(f)} ${r.method.toUpperCase()} ${r.path}`, audits: AUDITS.test(body) });
    });
  }
  return out;
}

test('G-SEC-5: every state-changing route writes an audit row or is listed with a reason', () => {
  const all = routes();
  assert.ok(all.length > 100, `the scan finds the routes (${all.length})`);
  const unclassified = all.filter((r) => !r.audits && !ALLOWED[r.key]).map((r) => r.key);
  assert.deepEqual(unclassified, [], 'add an audit call to these handlers, or list them in ALLOWED with the reason');
  const keys = new Set(all.map((r) => r.key));
  const stale = Object.keys(ALLOWED).filter((k) => !keys.has(k));
  assert.deepEqual(stale, [], 'these allow-list entries match no route any more: remove them');
  const needless = all.filter((r) => r.audits && ALLOWED[r.key]).map((r) => r.key);
  assert.deepEqual(needless, [], 'these routes audit in their handler now: take them off the allow-list');
});

test('G-SEC-5: the scan is not vacuous (a handler without an audit call is found)', () => {
  const s = "app.post('/x', h(), (req, res) => { res.json({}); });\napp.post('/y', h(), (req, res) => { audit({ action: 'y' }); });";
  const regs = []; let m; REG.lastIndex = 0;
  while ((m = REG.exec(s))) regs.push(m.index);
  assert.equal(regs.length, 2);
  assert.equal(AUDITS.test(s.slice(regs[0], regs[1])), false);
  assert.equal(AUDITS.test(s.slice(regs[1])), true);
});
