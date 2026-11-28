#!/usr/bin/env node
'use strict';
// The standalone installation's default accounts (Phase 3, P3-6; docs/phase3/standalone.md), created by Setup BEFORE the first start so its
// finish page can show the credentials that really exist:
//
//   node scripts/default-accounts.js --workspace <data folder>
//   AgastyaCtl.exe --default-accounts                         the installed form (Setup runs it on a standalone installation)
//
// It takes exactly the server's first-start step (services/firstRun.ts -> core/auth/defaultAccounts.js) with AGASTYA_DEPLOYMENT=standalone:
// a FRESH data folder gets one account per role with the fixed credentials, each behind the forced-password-change gate; a data folder that
// already has any account (an upgrade) or that was initialised before gets nothing, now or later. The database is opened through the server's
// own start sequence (integrity check, newer-database refusal, the copy before a pending migration, the migrations) under the data folder's
// server lock, so this never runs beside a live server.
//
// Prints the usernames it created, never a password (the installer shows the published defaults itself; nothing is written to a file).
// Exit code: 0 = the default accounts were created now; 3 = nothing was created (already initialised, or the data folder has accounts);
//            1 = refused or failed (the reason is printed); 2 = wrong arguments.

const path = require('path');
const fs = require('fs');

const DIST = path.resolve(__dirname, '..', 'dist');
if (!fs.existsSync(path.join(DIST, 'appContext.js'))) { console.error('Build the backend first: npm run build (in backend/).'); process.exit(2); }

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };

async function main() {
  const ws = opt('workspace') || process.env.AGASTYA_WORKSPACE_DIR;
  if (!ws) { console.error('Usage: node scripts/default-accounts.js --workspace <data folder>'); return 2; }
  // config.ts reads the environment once, at its first import: the data folder and the deployment go there before anything else is loaded
  process.env.AGASTYA_WORKSPACE_DIR = path.resolve(ws);
  process.env.AGASTYA_DEPLOYMENT = 'standalone';
  delete process.env.AGASTYA_MODE; delete process.env.AGASTYA_HOST;     // standalone = Mode A; nothing listens here
  const { config } = require(path.join(DIST, 'config'));
  const { createAppContext } = require(path.join(DIST, 'appContext'));
  const { acquireWorkspaceLock, releaseWorkspaceLock } = require(path.join(DIST, 'services', 'workspaceLock'));
  const { initialiseAccounts } = require(path.join(DIST, 'services', 'firstRun'));

  acquireWorkspaceLock(config.workspaceDir);       // refuses while a server owns this data folder
  let ctx = null;
  try {
    ctx = createAppContext(config);
    ctx.start();
    const lines = [];
    const r = await initialiseAccounts({ store: ctx.store, audit: ctx.audit, deployment: 'standalone', log: (m) => lines.push(m) });
    for (const l of lines) console.log(l.replace(/^\[[a-z-]+\] /, ''));
    if (r.defaultAccounts.created.length) { console.log(`created: ${r.defaultAccounts.created.join(',')}`); return 0; }
    console.log(`nothing created (${r.defaultAccounts.reason})`);
    return 3;
  } finally {
    try { if (ctx) ctx.close(); } catch { /* closing is best effort */ }
    releaseWorkspaceLock();
  }
}

main().then((code) => process.exit(code)).catch((e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
