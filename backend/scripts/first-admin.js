#!/usr/bin/env node
'use strict';
// Unattended first administrator (audit WP-25, G-DEP-2): what a silent installation runs so the product needs nobody at the first screen.
//
//   node scripts/first-admin.js <username> --workspace <data folder>      the password is ONE line on standard input
//   AgastyaCtl.exe --first-admin <username> --password-file <file>        the installed form (Setup: /ADMINUSER=... /ADMINPASSWORDFILE=...)
//
// The password is never taken from the command line (it would stay in the shell history and in the process list, audit SEC-005).
// It is a TEMPORARY credential: the account is created behind the forced-password-change gate (the same rule as INITIAL_ADMIN_*), so the
// administrator chooses their own password at the first sign-in. Idempotent: once any administrator exists nothing is changed (exit 0, said so).
// The database is opened through the server's own start sequence (WP-12: integrity check, newer-database refusal, the copy before a pending
// migration, the additive migrations), and the data folder's server lock is taken, so this never runs beside a live server.
//
// Exit code: 0 = created or an administrator already exists; 1 = refused (the reason is printed); 2 = wrong arguments.

const path = require('path');
const fs = require('fs');

const DIST = path.resolve(__dirname, '..', 'dist');
if (!fs.existsSync(path.join(DIST, 'appContext.js'))) { console.error('Build the backend first: npm run build (in backend/).'); process.exit(2); }

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const usage = (why) => {
  if (why) console.error(why);
  console.error('Usage: node scripts/first-admin.js <username> --workspace <data folder>   (the password: one line on standard input)');
  process.exit(2);
};

function readStdinLine() {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) { reject(new Error('Give the password on standard input (a pipe or a file), not interactively.')); return; }
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { buf += d; });
    process.stdin.on('end', () => resolve(buf.replace(/^﻿/, '').split(/\r?\n/)[0]));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const [username, extra] = positional;
  if (!username) usage();
  if (extra !== undefined) usage('The password is not taken from the command line (it would stay in the shell history and the process list).');
  const ws = opt('workspace') || process.env.AGASTYA_WORKSPACE_DIR;
  if (!ws) usage('Name the data folder with --workspace.');
  const password = await readStdinLine();
  if (!password) { console.error('No password on standard input; nothing was changed.'); process.exit(1); }

  // config.ts reads the environment once, at its first import: the data folder goes there before anything of the server is loaded
  process.env.AGASTYA_WORKSPACE_DIR = path.resolve(ws);
  const { config } = require(path.join(DIST, 'config'));
  const { createAppContext } = require(path.join(DIST, 'appContext'));
  const { acquireWorkspaceLock, releaseWorkspaceLock } = require(path.join(DIST, 'services', 'workspaceLock'));
  const { ensureBootstrapAdmin } = require(path.join(DIST, 'core', 'auth', 'bootstrap'));

  acquireWorkspaceLock(config.workspaceDir);       // refuses while a server owns this data folder
  let ctx = null;
  try {
    ctx = createAppContext(config);
    ctx.start();
    const lines = [];
    const r = await ensureBootstrapAdmin({ store: ctx.store, audit: ctx.audit, env: { INITIAL_ADMIN_USERNAME: username, INITIAL_ADMIN_PASSWORD: password }, log: (m) => lines.push(m) });
    for (const l of lines) console.log(l.replace(/^\[bootstrap\] /, ''));
    if (r.created) return 0;
    return r.reason === 'admin-exists' ? 0 : 1;
  } finally {
    try { if (ctx) ctx.close(); } catch { /* closing is best effort */ }
    releaseWorkspaceLock();
  }
}

main().then((code) => process.exit(code)).catch((e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
