'use strict';
// Child process of test/standalone-accounts.test.js (Phase 3, P3-6): one "start" of the platform on a data folder, in its own process,
// because config.ts reads AGASTYA_WORKSPACE_DIR / AGASTYA_DEPLOYMENT once per process. It opens the database through the server's own
// start sequence (migrations included), runs the account step of a first start (services/firstRun.ts, what index.ts start() runs), and
// prints what the data folder then holds as one JSON line.
//
//   node test/support/first-run-child.js <action>        AGASTYA_WORKSPACE_DIR and AGASTYA_DEPLOYMENT come from the environment
//   action: start             the first-start account step
//           seed-admin        an existing installation: one administrator made directly in the store (then the first-start step)
//           delete-defaults   remove every default account (as an administrator could, by hand), then the first-start step
const path = require('path');

const DIST = path.resolve(__dirname, '..', '..', 'dist');

async function main() {
  const action = process.argv[2] || 'start';
  const { config } = require(path.join(DIST, 'config'));
  const { createAppContext } = require(path.join(DIST, 'appContext'));
  const { initialiseAccounts } = require(path.join(DIST, 'services', 'firstRun'));
  const { hashPassword, newId } = require(path.join(DIST, 'core', 'auth', 'crypto'));
  const ctx = createAppContext(config);
  ctx.start();
  try {
    const db = ctx.store.db;
    if (action === 'seed-admin') {
      ctx.store.createUser({ id: newId(), username: 'siteadmin', fullName: 'Site Admin', role: 'admin', passwordHash: await hashPassword('an existing long password 1'), now: new Date().toISOString() });
    } else if (action === 'delete-defaults') {
      db.exec('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE default_account = 1)');
      db.exec('DELETE FROM users WHERE default_account = 1');
    }
    const lines = [];
    const result = await initialiseAccounts({ store: ctx.store, audit: (f) => ctx.audit(f), deployment: config.deployment, log: (l) => lines.push(l) });
    const users = db.prepare('SELECT username, role, auditor, must_change_password, onboarding_pending, default_account, default_password FROM users ORDER BY username').all().map((u) => ({ ...u }));
    const init = db.prepare('SELECT key, value FROM platform_init ORDER BY key').all().map((r) => ({ ...r }));
    const audit = db.prepare("SELECT action, target_id, meta FROM audit_log WHERE action LIKE 'user.%' ORDER BY id").all().map((r) => ({ action: r.action, meta: r.meta ? JSON.parse(r.meta) : null }));
    process.stdout.write(`${JSON.stringify({ deployment: config.deployment, result, users, init, audit, lines })}\n`);
  } finally {
    ctx.close();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e && e.stack ? e.stack : String(e)); process.exit(1); });
