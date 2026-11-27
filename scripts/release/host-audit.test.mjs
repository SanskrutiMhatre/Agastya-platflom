// WP-29 (ENT-003, RES-004): the Windows host's side of the audit trail.
//   node --test scripts/release/host-audit.test.mjs        (needs backend/dist: npm run build in backend/)
// AgastyaCtl.exe is compiled from packaging/host/*.cs (as scripts/package-windows.mjs does) into a temporary tree whose app\backend is a
// junction to this checkout's backend. The tests never write to this machine's Application log (AGASTYA_HOST_EVENTLOG=off) and never
// register an event source (that needs administrator rights and is an install-time step).
//   - the "##agastya-event|id|level|text" line the server prints is parsed; malformed lines and ids outside 4100-4199 are refused
//   - AgastyaCtl --verify-audit: 0 for an intact chain (key in <state>\keys), 1 after a row is edited, 2 without the key
//   - --doctor shows the row "Audit chain intact" / "Audit chain BROKEN"
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CSC = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const DIST = path.join(ROOT, 'backend', 'dist', 'appContext.js');
const skip = process.platform !== 'win32' ? 'Windows only' : !fs.existsSync(CSC) ? `no C# compiler at ${CSC}` : !fs.existsSync(DIST) ? 'backend/dist is not built' : false;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-wp29-host-'));
after(() => { try { fs.rmSync(path.join(tmp, 'tree', 'app', 'backend')); } catch { /* the junction */ } fs.rmSync(tmp, { recursive: true, force: true }); });

let tree;
function build() {
  if (tree) return tree;
  tree = path.join(tmp, 'tree');
  fs.mkdirSync(path.join(tree, 'runtime'), { recursive: true });
  const srcs = fs.readdirSync(path.join(ROOT, 'packaging', 'host')).filter((f) => f.endsWith('.cs')).map((f) => path.join(ROOT, 'packaging', 'host', f));
  const r = spawnSync(CSC, ['-nologo', '-platform:x64', '-target:exe', '-r:System.ServiceProcess.dll', '-r:System.IO.Compression.dll', '-r:System.Security.dll', `-out:${path.join(tree, 'AgastyaCtl.exe')}`, ...srcs], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /warning CS/, 'the host compiles without warnings');
  try { fs.linkSync(process.execPath, path.join(tree, 'runtime', 'node.exe')); } catch { fs.copyFileSync(process.execPath, path.join(tree, 'runtime', 'node.exe')); }
  fs.mkdirSync(path.join(tree, 'app'));
  fs.symlinkSync(path.join(ROOT, 'backend'), path.join(tree, 'app', 'backend'), 'junction');
  return tree;
}
const ENV = { ...process.env, AGASTYA_HOST_EVENTLOG: 'off', AGASTYA_HOME: '', AGASTYA_AUDIT_KEY_FILE: '' };
const ctl = (args) => spawnSync(path.join(build(), 'AgastyaCtl.exe'), args, { encoding: 'utf8', timeout: 300000, env: ENV });
const node = (code, env) => spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', env: { ...process.env, ...env } });

describe('the event line the server writes for the host', { skip }, () => {
  test('a well-formed line gives id, level and text; anything else is not an event', () => {
    const p = (line) => ctl(['--parse-event-line', line]);
    let r = p('##agastya-event|4120|warning|user.updated by admin from 127.0.0.1. {"role":"admin"}');
    assert.equal(r.status, 0); assert.equal(r.stdout.trim(), '4120|Warning|user.updated by admin from 127.0.0.1. {"role":"admin"}');
    r = p('##agastya-event|4100|error|text with | a bar kept');
    assert.equal(r.stdout.trim(), '4100|Error|text with | a bar kept', 'only the first two bars separate fields');
    assert.equal(p('##agastya-event|4103|information|ok').stdout.trim(), '4103|Information|ok');
    for (const bad of ['[auth] login ok', '##agastya-event|1000|error|outside the block', '##agastya-event|4120|critical|x',
      '##agastya-event|41x0|error|x', '##agastya-event|4120|warning|', '##agastya-event|4120|warning', ' ##agastya-event|4120|warning|x']) {
      const b = p(bad);
      assert.equal(b.status, 1, bad); assert.equal(b.stdout.trim(), 'not an event line');
    }
  });
});

describe('AgastyaCtl --verify-audit and the doctor row', { skip }, () => {
  test('intact = 0, an edited row = 1 (doctor FAIL), no key = 2', () => {
    const home = path.join(tmp, 'state');
    const ws = path.join(home, 'workspace'); const key = path.join(home, 'keys', 'audit-hmac.key');
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'agastya.ini'), '[server]\nPort=4991\nBind=loopback\n');
    const made = node(`const { buildConfig } = require(${JSON.stringify(path.join(ROOT, 'backend', 'dist', 'config.js'))});
      const { createAppContext } = require(${JSON.stringify(DIST)});
      const c = createAppContext(buildConfig(process.env)); c.start();
      for (let i = 0; i < 25; i++) c.audit({ actorUsername: 'alice', action: 'test.row', meta: { i } });
      c.close();`, { AGASTYA_WORKSPACE_DIR: ws, AGASTYA_AUDIT_KEY_FILE: key, AGASTYA_LOG_DIR: 'off' });
    assert.equal(made.status, 0, made.stderr);
    assert.ok(fs.existsSync(key), 'the server made the key where the host points it');

    let r = ctl(['--verify-audit', '--home', home]);
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /^OK: audit chain intact: 25 row\(s\) verified/);
    let d = ctl(['--doctor', '--home', home]);
    assert.match(d.stdout, /\[ OK \] Audit chain intact: 25 row\(s\) verified/);

    const t = node(`const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(process.argv[1]);
      db.prepare("UPDATE audit_log SET actor_username = 'mallory' WHERE seq = 7").run(); db.close();`.replace('process.argv[1]', JSON.stringify(path.join(ws, 'publisher.db'))));
    assert.equal(t.status, 0, t.stderr);
    r = ctl(['--verify-audit', '--home', home]);
    assert.equal(r.status, 1, r.stdout); assert.match(r.stdout, /^BROKEN/); assert.match(r.stdout, /sequence 7/);
    d = ctl(['--doctor', '--home', home]);
    assert.match(d.stdout, /\[FAIL\] Audit chain BROKEN: /); assert.equal(d.status, 1);

    fs.renameSync(key, `${key}.moved`);
    r = ctl(['--verify-audit', '--home', home]);
    assert.equal(r.status, 2, r.stdout); assert.match(r.stdout, /CANNOT VERIFY: .*key/);
    assert.equal(fs.existsSync(key), false, 'no new key was made');
    d = ctl(['--doctor', '--home', home]);
    assert.match(d.stdout, /\[WARN\] Audit chain not checked: /);
  });
});
