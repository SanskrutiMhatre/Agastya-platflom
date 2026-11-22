'use strict';
// A font file that fop.xconf lists but the installation does not have must not stop a build.
//
// FOP aborts the whole render when a listed font file is missing and a document asks for that family. For Arial (proprietary, and left
// out of a delivery whose publisher cannot show the licence) that would turn a licensing decision into "nothing builds". engine/fontconf.js
// hands FOP the real configuration when everything is installed, and otherwise a pruned copy, so the stack falls through to Liberation Sans.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, fork } = require('node:child_process');
const paths = require('../vendor/engine/paths');
const { fopConf, missingFonts } = require('../vendor/engine/fontconf');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-fontconf-'));
const XCONF = (extra = '') => `<?xml version="1.0"?>
<fop version="1.0">
  <renderers>
    <renderer mime="application/pdf">
      <fonts>
        <font embed-url="a.ttf">
          <font-triplet name="Alpha" style="normal" weight="normal"/>
        </font>
        <font embed-url="b.ttf">
          <font-triplet name="Beta" style="normal" weight="normal"/>
        </font>${extra}
      </fonts>
    </renderer>
  </renderers>
  <font-base>fonts/</font-base>
</fop>
`;
function fake(present) {
  const dir = tmp(); fs.mkdirSync(path.join(dir, 'fonts'));
  for (const f of present) fs.writeFileSync(path.join(dir, 'fonts', f), 'x');
  fs.writeFileSync(path.join(dir, 'fop.xconf'), XCONF());
  return dir;
}

test('everything installed: the real configuration is used, and nothing is written', () => {
  const dir = fake(['a.ttf', 'b.ttf']); const out = tmp(); const logs = [];
  assert.equal(fopConf({ xconf: path.join(dir, 'fop.xconf'), outDir: out, log: (m) => logs.push(m) }), path.join(dir, 'fop.xconf'));
  assert.deepEqual(fs.readdirSync(out), []);
  assert.deepEqual(logs, []);
  assert.deepEqual(missingFonts({ xconf: path.join(dir, 'fop.xconf') }), []);
});

test('the shipped installation is complete', () => {
  assert.deepEqual(missingFonts(), [], 'every font listed in vendor/tools/fop.xconf is present (or the entry was removed with the file)');
  assert.equal(fopConf({ outDir: tmp(), log: () => {} }), paths.FOP_XCONF);
});

test('a missing font file is left out of a copy; the original is untouched; the copy is written once', () => {
  const dir = fake(['a.ttf']); const out = tmp(); const logs = [];
  const xconf = path.join(dir, 'fop.xconf'); const before = fs.readFileSync(xconf, 'utf8');
  const one = fopConf({ xconf, outDir: out, log: (m) => logs.push(m) });
  assert.notEqual(one, xconf);
  assert.equal(path.dirname(one), out);
  const text = fs.readFileSync(one, 'utf8');
  assert.ok(text.includes('a.ttf') && text.includes('name="Alpha"'), 'the installed font stays');
  assert.ok(!text.includes('b.ttf') && !text.includes('name="Beta"'), 'the missing font is gone, triplet and all');
  assert.match(text, /<font-base>file:\/\/\/[^<]*fonts\/<\/font-base>/, 'font-base is absolute, because the copy lives elsewhere');
  assert.equal(fs.readFileSync(xconf, 'utf8'), before, 'the master configuration is never modified');
  assert.deepEqual(missingFonts({ xconf }), ['b.ttf']);

  const mtime = fs.statSync(one).mtimeMs;
  assert.equal(fopConf({ xconf, outDir: out, log: (m) => logs.push(m) }), one, 'the same content has the same name');
  assert.equal(fs.statSync(one).mtimeMs, mtime, 'and is not rewritten');
  assert.equal(logs.length, 1, 'one line, once');
  assert.match(logs[0], /b\.ttf/);
  assert.deepEqual(fs.readdirSync(out).filter((n) => n.endsWith('.tmp')), [], 'no temporary files left');
});

test('no configuration file at all: null, as before', () => {
  assert.equal(fopConf({ xconf: path.join(tmp(), 'nope.xconf'), outDir: tmp(), log: () => {} }), null);
});

test('several builds starting together all get the same complete copy', { timeout: 60000 }, async () => {
  const dir = fake(['a.ttf']); const out = tmp();
  const script = path.join(dir, 'w.js');
  fs.writeFileSync(script, `const {fopConf}=require(${JSON.stringify(path.resolve(__dirname, '..', 'vendor', 'engine', 'fontconf'))});
    const p=fopConf({xconf:${JSON.stringify(path.join(dir, 'fop.xconf'))},outDir:${JSON.stringify(out)},log:()=>{}});
    const h=require('crypto').createHash('sha256').update(require('fs').readFileSync(p)).digest('hex');
    process.send({p,h}); process.exit(0);`);
  const results = await Promise.all(Array.from({ length: 6 }, () => new Promise((resolve, reject) => {
    const c = fork(script, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    c.once('message', resolve); c.once('error', reject);
  })));
  assert.equal(new Set(results.map((r) => r.p)).size, 1, 'one name');
  assert.equal(new Set(results.map((r) => r.h)).size, 1, 'one content');
  assert.deepEqual(fs.readdirSync(out).filter((n) => n.endsWith('.tmp')), []);
});

// ---- the real FOP -------------------------------------------------------------------------------------------------
const FO = `<?xml version="1.0"?>
<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format">
 <fo:layout-master-set><fo:simple-page-master master-name="p" page-width="200pt" page-height="100pt"><fo:region-body/></fo:simple-page-master></fo:layout-master-set>
 <fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block font-family="Arial,Liberation Sans" font-size="12pt">Arial falls back</fo:block></fo:flow></fo:page-sequence>
</fo:root>
`;
const javaOk = () => { try { return spawnSync(paths.JAVA, ['-version'], { encoding: 'utf8' }).status === 0 && fs.existsSync(path.join(paths.FOP_HOME || '', '..')); } catch { return false; } };

test('real FOP: without the Arial files a document that asks for Arial still renders (Liberation Sans), where the raw configuration aborts', { skip: !javaOk() && 'no Java runtime', timeout: 120000 }, () => {
  // a copy of the real tools layout with the four Arial files removed
  const dir = tmp(); fs.mkdirSync(path.join(dir, 'fonts'));
  const realFonts = path.join(path.dirname(paths.FOP_XCONF), 'fonts');
  for (const f of fs.readdirSync(realFonts)) if (/\.ttf$/i.test(f) && !/^arial/i.test(f)) fs.copyFileSync(path.join(realFonts, f), path.join(dir, 'fonts', f));
  fs.copyFileSync(paths.FOP_XCONF, path.join(dir, 'fop.xconf'));
  fs.writeFileSync(path.join(dir, 't.fo'), FO);
  const run = (conf, out) => spawnSync(paths.JAVA, [...paths.FOP_ARGS, '-c', conf, '-fo', path.join(dir, 't.fo'), '-pdf', out], { encoding: 'utf8', cwd: dir });

  const raw = run(path.join(dir, 'fop.xconf'), path.join(dir, 'raw.pdf'));
  assert.notEqual(raw.status, 0, 'the unpruned configuration is the hazard: FOP aborts on a listed font that is not there');
  assert.ok(!fs.existsSync(path.join(dir, 'raw.pdf')));

  const conf = fopConf({ xconf: path.join(dir, 'fop.xconf'), outDir: tmp(), log: () => {} });
  assert.notEqual(conf, path.join(dir, 'fop.xconf'));
  const ok = run(conf, path.join(dir, 'ok.pdf'));
  assert.equal(ok.status, 0, `pruned configuration renders: ${(ok.stderr || '').slice(0, 400)}`);
  const pdf = fs.readFileSync(path.join(dir, 'ok.pdf'));
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  assert.match(pdf.toString('latin1'), /LiberationSans/, 'the text is set in the stand-in font');
  assert.ok(!/\+Arial/.test(pdf.toString('latin1')), 'and no Arial is embedded');
  void crypto;
});
