#!/usr/bin/env node
'use strict';
// The audit trail from the command line (audit WP-29). Uses the compiled server code (run "npm run build" in backend/ first).
//
//   node scripts/agastya-audit.js verify --workspace <data folder> [--key <key file>] [--checkpoints <file.jsonl>]... [--json]
//        Walks the audit chain of the data folder's database (opened read-only) and compares it with the signed checkpoints in the
//        database, in the backup folder and in any --checkpoints file kept elsewhere. Names every changed, removed or inserted row and
//        a cut at the end. Works while the server runs. The key is AGASTYA_AUDIT_KEY_FILE, else <data folder>\audit-key\audit-hmac.key.
//   node scripts/agastya-audit.js events [--json]
//        The security events and their stable Windows Application-log ids (source "Agastya Platform").
//
// Exit code 0 = intact, 1 = problems found (listed), 2 = wrong arguments or the check could not run (missing key, no database).

const path = require('path');
const fs = require('fs');

const DIST = path.resolve(__dirname, '..', 'dist');
if (!fs.existsSync(path.join(DIST, 'storage', 'auditOffline.js'))) { console.error('Build the backend first: npm run build (in backend/).'); process.exit(2); }

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const opts = (name) => argv.flatMap((a, i) => (a === `--${name}` && argv[i + 1] ? [argv[i + 1]] : []));
const usage = () => { console.error(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 14).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(2); };

if (cmd === 'verify') {
  const ws = opt('workspace') || process.env.AGASTYA_WORKSPACE_DIR;
  if (!ws) usage();
  const { verifyWorkspaceAudit } = require(path.join(DIST, 'storage', 'auditOffline'));
  let rep;
  try {
    rep = verifyWorkspaceAudit({ workspaceDir: ws, env: process.env, keyFile: opt('key'), checkpointFiles: opts('checkpoints') });
  } catch (e) {
    console.error(`CANNOT VERIFY: ${e.message}`);
    process.exit(2);
  }
  if (argv.includes('--json')) console.log(JSON.stringify(rep, null, 2));
  else {
    console.log(`${rep.ok ? 'OK' : 'BROKEN'}: ${rep.summary}`);
    console.log(`  key ${rep.keyId}; chain head ${rep.head.seq}${rep.anchor ? `; rows up to ${rep.anchor.seq} archived (${rep.anchor.archive})` : ''}; ${rep.checkpoints.checked} checkpoint(s) checked`);
    for (const p of rep.problems) console.log(`  - [${p.kind}] ${p.message}`);
    if (rep.problemCount > rep.problems.length) console.log(`  ... and ${rep.problemCount - rep.problems.length} more`);
  }
  process.exit(rep.ok ? 0 : 1);
} else if (cmd === 'events') {
  const { securityEventCatalogue } = require(path.join(DIST, 'services', 'securityEvents'));
  const list = securityEventCatalogue();
  if (argv.includes('--json')) console.log(JSON.stringify(list, null, 2));
  else for (const e of list) console.log(`${e.id}  ${e.level.padEnd(11)} ${e.name.padEnd(28)} ${e.description}`);
  process.exit(0);
} else usage();
