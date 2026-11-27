// WP-24 release engineering: manifest, SBOM, signing configuration, detached signatures and the two offline verifiers.
//   node --test scripts/release/release.test.mjs
// The signing tests make a throwaway self-signed code-signing certificate in a temporary folder (scripts/signing/New-SigningCertificate.ps1,
// which touches no certificate store), sign copies of a small executable with it (signtool /f, or Set-AuthenticodeSignature when the Windows
// SDK is absent) and delete everything afterwards. No network: nothing is time-stamped here.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildManifest, writeManifest, parseManifest, verifyTree, verifySignature, formatSums, MANIFEST_NAME, authenticode } from './lib.mjs';
import { buildSbom, checkSbom } from './sbom.mjs';
import { signingConfig, releaseSigningRefusals, signtoolArgs, signFiles, signDetached, describeSigning } from './signing.mjs';
import { verifyRelease } from './verify-release.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-wp24-'));
after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
const mk = (name) => { const d = path.join(tmpRoot, name); fs.mkdirSync(d, { recursive: true }); return d; };
const put = (dir, rel, content) => { const p = path.join(dir, ...rel.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); return p; };
const XSLTPROC = path.join(ROOT, 'backend', 'vendor', 'tools', 'libxslt-1.1.28-win32-x86', 'bin', 'xsltproc.exe');

describe('file manifest', () => {
  test('lists every shipped file with size and SHA-256, sorted, and leaves out what the installation owns', () => {
    const t = mk('m1');
    put(t, 'b.txt', 'bee'); put(t, 'a dir/x y.js', 'x'); put(t, 'config/agastya.ini', 'Port=1'); put(t, 'data/publisher.db', 'db'); put(t, 'portable.flag', 'p');
    put(t, 'unins000.exe', 'u'); put(t, 'logs/agastya-host.log', 'l');
    const text = buildManifest(t, { product: 'P', version: '1.2.3', commit: 'abc' });
    const { header, entries } = parseManifest(text);
    assert.deepEqual(entries.map((e) => e.path), ['a dir/x y.js', 'b.txt']);
    assert.equal(header.version, '1.2.3'); assert.equal(header.files, '2');
    assert.equal(entries[1].sha256, crypto.createHash('sha256').update('bee').digest('hex'));
    assert.equal(entries[1].size, 3);
  });
  test('verifyTree finds a missing, a changed (same size too) and an unlisted file', () => {
    const t = mk('m2');
    put(t, 'keep.txt', 'k'); put(t, 'gone.txt', 'g'); put(t, 'same-size.txt', 'aaaa'); put(t, 'app/x.js', 'x');
    writeManifest(t, { version: '1' });
    assert.equal(verifyTree(t).ok, true);
    fs.rmSync(path.join(t, 'gone.txt')); put(t, 'same-size.txt', 'aaab'); put(t, 'app/planted.dll', 'evil'); put(t, 'config/agastya.ini', 'fine');
    const r = verifyTree(t);
    assert.equal(r.ok, false);
    assert.deepEqual(r.missing, ['gone.txt']); assert.deepEqual(r.changed, ['same-size.txt']); assert.deepEqual(r.extra, ['app/planted.dll']);
    // the quick (size-only) check misses a same-size change unless the path is one it always hashes
    assert.deepEqual(verifyTree(t, { deep: false }).changed, []);
    assert.deepEqual(verifyTree(t, { deep: false, alwaysHash: [/^same-size/] }).changed, ['same-size.txt']);
  });
});

describe('SBOM', () => {
  test('describes the repository: every backend production package, the bundled runtimes, FOP jars, xsltproc DLLs and schema sets', () => {
    const { bom, problems } = buildSbom({ commit: 'test', builtAt: '2026-11-27T00:00:00.000Z' });
    assert.deepEqual(problems, []);
    const f = path.join(mk('s1'), 'sbom.cdx.json'); fs.writeFileSync(f, JSON.stringify(bom));
    assert.deepEqual(checkSbom(f), []);
    const refs = bom.components.map((c) => c['bom-ref']);
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'backend', 'package-lock.json'), 'utf8'));
    const prod = Object.entries(lock.packages).filter(([k, v]) => k.startsWith('node_modules/') && !v.dev).length;
    assert.equal(refs.filter((r) => r.startsWith('npm:backend:')).length, prod);
    for (const r of ['nodejs', 'temurin-jre', 'libxslt', 'libxml2', 'zlib', 'schemas:5.0']) assert.ok(refs.includes(r), r);
    assert.ok(refs.some((r) => r.startsWith('apache-fop:fop-')) && refs.some((r) => r.startsWith('fop-lib:batik-')));
    const express = bom.components.find((c) => c.name === 'express' && c['bom-ref'].startsWith('npm:backend:'));
    assert.match(express.purl, /^pkg:npm\/express@/); assert.equal(express.hashes[0].alg, 'SHA-512');
    const xslt = bom.components.find((c) => c['bom-ref'] === 'libxslt');
    assert.equal(xslt.components.length, 2); assert.match(xslt.components[0].hashes[0].content, /^[0-9a-f]{64}$/);
    // same inputs, same serial number (reproducible record)
    assert.equal(buildSbom({ commit: 'test', builtAt: '2026-11-27T00:00:00.000Z' }).bom.serialNumber, bom.serialNumber);
  });
  test('the check fails when a shipped package is left out or a hash is malformed', () => {
    const { bom } = buildSbom({ commit: 'test' });
    const i = bom.components.findIndex((c) => c.name === 'ws' && c['bom-ref'].startsWith('npm:backend:'));
    bom.components.splice(i, 1);
    bom.components.find((c) => c['bom-ref'] === 'zlib').hashes[0].content = 'nothex';
    const f = path.join(mk('s2'), 'sbom.cdx.json'); fs.writeFileSync(f, JSON.stringify(bom));
    const p = checkSbom(f).join('\n');
    assert.match(p, /missing from the SBOM: ws@/); assert.match(p, /zlib: malformed SHA-256/);
  });
});

describe('signing configuration', () => {
  test('one set of variables picks the mode; problems and release refusals are explicit', () => {
    assert.equal(signingConfig({}).mode, 'none');
    assert.match(releaseSigningRefusals(signingConfig({})).join(), /a release must be signed/);
    const store = signingConfig({ AGASTYA_SIGN_THUMBPRINT: 'ab cd'.padEnd(41, '0').replace(/ /, ''), AGASTYA_SIGN_TIMESTAMP_URL: 'http://tsa.corp.local/tsr' });
    assert.equal(store.mode, 'store'); assert.deepEqual(store.problems, []); assert.deepEqual(releaseSigningRefusals(store), []);
    assert.match(releaseSigningRefusals(signingConfig({ AGASTYA_SIGN_THUMBPRINT: 'A'.repeat(40) })).join(), /time-stamped/);
    assert.deepEqual(releaseSigningRefusals(signingConfig({ AGASTYA_SIGN_THUMBPRINT: 'A'.repeat(40), AGASTYA_SIGN_ALLOW_NO_TIMESTAMP: '1' })), []);
    assert.match(signingConfig({ AGASTYA_SIGN_PFX: path.join(tmpRoot, 'nope.pfx') }).problems.join(), /does not exist.*AGASTYA_SIGN_PASSWORD|AGASTYA_SIGN_PASSWORD|does not exist/);
    assert.match(signingConfig({ AGASTYA_SIGN_THUMBPRINT: 'xyz' }).problems.join(), /40-hex/);
    assert.match(releaseSigningRefusals(signingConfig({ AGASTYA_SIGN_CMD: 'sign $f', AGASTYA_SIGN_TIMESTAMP_URL: 'http://t/' })).join(), /AGASTYA_SIGN_THUMBPRINT or AGASTYA_SIGN_PFX/);
    assert.match(signingConfig({ AGASTYA_SIGN_CMD: 'sign it' }).problems.join(), /\$f/);
  });
  test('the signtool command line carries a time stamp when configured and never the password', () => {
    const c = { mode: 'pfx', pfx: 'C:\\k.pfx', password: 's3cret', timestampUrl: 'http://tsa/', store: 'CurrentUser' };
    const a = signtoolArgs(c, ['a.exe']);
    assert.deepEqual(a.slice(0, 3), ['sign', '/fd', 'SHA256']);
    assert.ok(a.includes('/tr') && a.includes('/td')); assert.ok(!a.includes('s3cret'));
    const s = signtoolArgs({ mode: 'store', thumbprint: 'A'.repeat(40), store: 'LocalMachine' }, ['b.dll']);
    assert.deepEqual(s.slice(3, 8), ['/sha1', 'A'.repeat(40), '/s', 'My', '/sm']);
    assert.ok(!JSON.stringify(describeSigning(signingConfig({ AGASTYA_SIGN_PFX: 'C:\\x.pfx', AGASTYA_SIGN_PASSWORD: 'pw' }))).includes('pw"'));
  });
});

describe('signing and offline verification with a throwaway certificate', { skip: process.platform !== 'win32' && 'Authenticode is Windows only' }, () => {
  let certDir; let password; let cfg; let thumb;
  before(() => {
    certDir = mk('cert');
    password = crypto.randomBytes(18).toString('base64url');
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'scripts', 'signing', 'New-SigningCertificate.ps1'),
      '-OutDir', certDir, '-Subject', 'CN=Agastya WP-24 Test Only, O=Test, C=IN', '-Mode', 'SelfSigned', '-Years', '1'], { encoding: 'utf8', env: { ...process.env, AGASTYA_PFX_PASSWORD: password } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    cfg = signingConfig({ ...process.env, AGASTYA_SIGN_PFX: path.join(certDir, 'agastya-codesign.pfx'), AGASTYA_SIGN_PASSWORD: password, AGASTYA_SIGN_THUMBPRINT: '', AGASTYA_SIGN_CMD: '', AGASTYA_SIGN_TIMESTAMP_URL: '' });
    assert.deepEqual(cfg.problems, []);
    thumb = new crypto.X509Certificate(fs.readFileSync(path.join(certDir, 'agastya-codesign.cer'))).fingerprint.replace(/:/g, '');
  });

  /** A small product tree and release folder, signed the way the packager does it. */
  function buildSignedRelease(name) {
    const rel = mk(name);
    const stage = path.join(rel, 'Agastya-Platform-9.9.9-win-x64');
    fs.mkdirSync(path.join(stage, 'app', 'tools'), { recursive: true });
    fs.copyFileSync(XSLTPROC, path.join(stage, 'AgastyaCtl.exe'));
    fs.copyFileSync(XSLTPROC, path.join(stage, 'app', 'tools', 'xsltproc.exe'));
    put(stage, 'app/backend/dist/index.js', 'console.log(1)\n');
    signFiles(cfg, [path.join(stage, 'AgastyaCtl.exe'), path.join(stage, 'app', 'tools', 'xsltproc.exe')]);
    writeManifest(stage, { product: 'Agastya Platform', version: '9.9.9', commit: 'test' });
    signDetached(cfg, [path.join(stage, MANIFEST_NAME)]);
    fs.copyFileSync(path.join(stage, 'AgastyaCtl.exe'), path.join(rel, 'Agastya-Platform-9.9.9-win-x64-Setup.exe'));
    fs.writeFileSync(path.join(rel, 'SBOM.cdx.json'), JSON.stringify(buildSbom({ commit: 'test' }).bom));
    fs.writeFileSync(path.join(rel, 'SHA256SUMS.txt'), formatSums(rel, ['Agastya-Platform-9.9.9-win-x64-Setup.exe', 'SBOM.cdx.json']));
    signDetached(cfg, [path.join(rel, 'SHA256SUMS.txt')]);
    return { rel, stage };
  }
  const ps = (args) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'scripts', 'signing', 'Verify-Release.ps1'), ...args], { encoding: 'utf8' });

  test('executables get an Authenticode signature by the certificate; the manifest and the checksums a detached one', async () => {
    const { rel, stage } = buildSignedRelease('r1');
    const [a] = await authenticode([path.join(stage, 'AgastyaCtl.exe')]);
    assert.equal(a.thumbprint, thumb); assert.notEqual(a.status, 'NotSigned'); assert.equal(a.timestamped, false);
    const v = verifySignature(path.join(stage, MANIFEST_NAME), { thumbprint: thumb });
    assert.equal(v.ok, true, v.reason); assert.equal(v.selfIssued, true);
    assert.equal(verifySignature(path.join(rel, 'SHA256SUMS.txt')).ok, true);
    assert.equal(verifySignature(path.join(rel, 'SHA256SUMS.txt'), { thumbprint: 'B'.repeat(40) }).ok, false);
  });

  test('both offline verifiers pass a good release and name each kind of tampering', async () => {
    const { rel, stage } = buildSignedRelease('r2');
    const good = await verifyRelease({ release: rel, requireSigned: true, thumbprint: thumb });
    assert.equal(good.ok, true, JSON.stringify(good.rows, null, 1));
    assert.ok(good.rows.some((r) => r.status === 'WARN' && /time stamp/.test(r.detail)), 'an untimestamped signature is reported');
    const g = ps(['-Release', rel, '-Tree', stage, '-RequireSigned', '-Thumbprint', thumb]);
    assert.equal(g.status, 0, g.stdout + g.stderr);
    assert.match(g.stdout, /PASS  manifest: \d+ files match/); assert.match(g.stdout, /PASS  SHA256SUMS\.txt signature/);
    assert.equal(ps(['-Release', rel, '-RequireSigned', '-RequireTimestamp']).status, 1, 'no time stamp fails when one is required');

    // 1. one byte of a shipped file
    const js = path.join(stage, 'app', 'backend', 'dist', 'index.js');
    fs.writeFileSync(js, 'console.log(2)\n');
    let r = await verifyRelease({ release: rel, requireSigned: true });
    assert.equal(r.ok, false); assert.match(r.rows.find((x) => x.status === 'FAIL').detail, /changed: app\/backend\/dist\/index\.js/);
    assert.match(ps(['-Tree', stage]).stdout, /FAIL  manifest: changed: app\\backend\\dist\\index\.js/);
    fs.writeFileSync(js, 'console.log(1)\n');
    // 2. a file planted next to the program
    put(stage, 'app/tools/version.dll', 'planted');
    r = await verifyRelease({ tree: stage });
    assert.match(r.rows.find((x) => x.status === 'FAIL').detail, /not in the manifest: app\/tools\/version\.dll/);
    fs.rmSync(path.join(stage, 'app', 'tools', 'version.dll'));
    // 3. the manifest edited to match a changed file: its signature no longer holds
    const mf = path.join(stage, MANIFEST_NAME);
    const orig = fs.readFileSync(mf, 'utf8');
    fs.writeFileSync(mf, orig.replace(/^# commit: test$/m, '# commit: evil'));
    r = await verifyRelease({ tree: stage, requireSigned: true });
    assert.match(r.rows.filter((x) => x.status === 'FAIL').map((x) => x.detail).join(), /changed after it was signed/);
    assert.equal(ps(['-Tree', stage, '-RequireSigned']).status, 1);
    fs.writeFileSync(mf, orig);
    // 4. one byte of the installer: checksums and Authenticode both object
    const setup = path.join(rel, 'Agastya-Platform-9.9.9-win-x64-Setup.exe');
    const b = fs.readFileSync(setup); b[b.length - 200] ^= 0xff; fs.writeFileSync(setup, b);
    r = await verifyRelease({ release: rel, requireSigned: true });
    const fails = r.rows.filter((x) => x.status === 'FAIL').map((x) => `${x.check}: ${x.detail}`).join('\n');
    assert.match(fails, /release checksums: Agastya-Platform-9\.9\.9-win-x64-Setup\.exe does not match/);
    const p = ps(['-Release', rel]);
    assert.equal(p.status, 1); assert.match(p.stdout, /FAIL  release checksums/);
    // 5. an unsigned build is a warning in development and a failure with -RequireSigned
    fs.rmSync(path.join(rel, 'SHA256SUMS.txt.sig'));
    assert.equal((await verifyRelease({ tree: stage })).ok, true);
    const u = await verifyRelease({ release: rel, requireSigned: true });
    assert.match(u.rows.find((x) => x.check === 'SHA256SUMS.txt signature').status, /FAIL/);
  });
});
