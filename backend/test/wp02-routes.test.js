'use strict';
// WP-02 (audit PUB-002, PUB-014, PUB-024, PUB-025, S1K-005): the XML guard on the JSS, JSG and ancillary-page writers, the
// compose-time re-check of front-matter pages, the "$" patterns in book metadata, and values that hold both quote kinds.
// Through the real server, xsltproc and FOP.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const XI = 'http://www.w3.org/2001/XInclude';
const CANARY_TEXT = 'WP02-CANARY-7f3a91';
const canaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp02-canary-'));
const canary = path.join(canaryDir, 'secret.txt'); fs.writeFileSync(canary, CANARY_TEXT);
const canaryUrl = `file:///${canary.replace(/\\/g, '/')}`;
const pdfText = (buf) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wp02-')), 'x.pdf'); fs.writeFileSync(f, buf); return spawnSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }).stdout; };

let h; let w;
test.before(async () => {
  h = await boot(); const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'wanda', fullName: 'Wanda', role: 'author' });
  w = new h.Client('wanda'); await w.post('/api/auth/login', { username: 'wanda', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'wanda', password: PW });
});
test.after(async () => { if (h) await h.close(); });
const create = async (format, name) => {
  const r = await w.post('/api/projects', { name, format, domain: 'land', manualType: 'uhb' });
  assert.equal(r.status, 201, JSON.stringify(r.json).slice(0, 300));
  return { id: r.json.project.id, U: `/api/projects/${r.json.project.id}`, dir: path.join(h.ws, 'projects', r.json.project.id) };
};
/** Put `inner` inside the first <para> of the body. */
const intoPara = (xml, inner) => {
  const i = xml.indexOf('<para', xml.indexOf('<body'));
  if (i < 0) { const e = xml.lastIndexOf('</body>'); assert.ok(e > 0, 'a body'); return `${xml.slice(0, e)}<para>${inner}</para>${xml.slice(e)}`; }
  const j = xml.indexOf('>', i) + 1; return xml.slice(0, j) + inner + xml.slice(j);
};

const PAYLOADS = (root) => ({
  'XXE': (xml) => xml.replace(/^(<\?xml[^>]*\?>\s*)?/, (d) => `${d}<!DOCTYPE ${root} [ <!ENTITY x SYSTEM "${canaryUrl}"> ]>`).replace(/(<para[^>]*>)/, '$1&x;'),
  'decoy DOCTYPE in a comment': (xml) => xml.replace(/^(<\?xml[^>]*\?>\s*)?/, (d) => `${d}<!-- <!DOCTYPE z> --><!DOCTYPE ${root} [ <!ENTITY x SYSTEM "${canaryUrl}"> ]>`),
  'xi:include of a local file': (xml) => intoPara(xml, `<xi:include xmlns:xi="${XI}" href="${canaryUrl}" parse="text"/>`),
  'a harmless DOCTYPE': (xml) => xml.replace(/^(<\?xml[^>]*\?>\s*)?/, (d) => `${d}<!DOCTYPE ${root}>`),
});

for (const [format, root] of [['jss', 'jssbook'], ['jsg', 'jsgdoc']]) {
  test(`${format.toUpperCase()}: every hostile payload is refused by the save route and nothing is written (PUB-014)`, async () => {
    const p = await create(format, `WP02 ${format}`);
    const g = (await w.get(`${p.U}/${format}`)).json; assert.ok(g.xml.includes(`<${root}`), g.xml.slice(0, 200));
    for (const [name, make] of Object.entries(PAYLOADS(root))) {
      const bad = make(g.xml); assert.notEqual(bad, g.xml, `${name} changed the document`);
      const r = await w.put(`${p.U}/${format}`, { xml: bad, baseHash: g.hash });
      assert.equal(r.status, 400, `${name}: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
      assert.ok(['UNSAFE_XML', 'DOCTYPE_REFUSED'].includes(r.json.code), `${name}: ${r.json.code}`);
    }
    const after = (await w.get(`${p.U}/${format}`)).json; assert.equal(after.hash, g.hash, 'the document is unchanged');
    const ok = await w.put(`${p.U}/${format}`, { xml: g.xml, baseHash: g.hash }); assert.equal(ok.status, 200, 'the document itself still saves');
  });
}

test('JSS: an xi:include in an ancillary page is refused when saved, and a page poisoned on disk is left out of the build (PUB-002)', async () => {
  const p = await create('jss', 'WP02 ancillary');
  const pages = (await w.get(`${p.U}/ancillary`)).json.pages.filter((x) => x.file && x.enabled);
  assert.ok(pages.length > 0, 'the document has editable pages');
  // the audit's reproduction: the include inside a paragraph of the Foreword, which the page prints as written
  const pg = pages.find((x) => /foreword/i.test(x.id)) ?? pages[0]; const cur = (await w.get(`${p.U}/ancillary/${pg.id}`)).json.xml;
  assert.match(cur, /<para\b[^>]*>/, `${pg.id} has a paragraph`);
  const hostile = cur.replace(/(<para\b[^>]*>)/, `$1PROBE-START <xi:include xmlns:xi="${XI}" href="${canaryUrl}" parse="text"/> PROBE-END `);
  const r = await w.put(`${p.U}/ancillary/${pg.id}`, { xml: hostile });
  assert.equal(r.status, 400, JSON.stringify(r.json).slice(0, 300)); assert.equal(r.json.code, 'UNSAFE_XML');
  // planted on disk, as an edit outside the program or an old archive could leave it
  const file = path.join(p.dir, 'jss', 'frontmatter', pg.file.replace(/^.*[\\/]/, ''));
  assert.ok(fs.existsSync(file), file);
  fs.writeFileSync(file, hostile);
  const b = await w.post(`${p.U}/publish`, {}); assert.equal(b.status, 200, JSON.stringify(b.json).slice(0, 400));
  const text = pdfText((await w.get(`${p.U}/publish/pdf`)).buf);
  assert.ok(text.length > 200, 'the book still printed');
  assert.ok(!text.includes('PROBE-START'), 'the poisoned page was left out (its default prints instead)');
  assert.ok(!text.includes(CANARY_TEXT), 'the local file did not reach the PDF');
});

test('JSS: book metadata with "$" replacement patterns and with both quote kinds prints exactly as written (PUB-024, PUB-025)', async () => {
  const p = await create('jss', 'WP02 metadata');
  const g = (await w.get(`${p.U}/jss`)).json;
  const name = `Pump $& Valve $$5 $' O'Brien "Mk 2"`;
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const xml = /<bookName>[^<]*<\/bookName>/.test(g.xml) ? g.xml.replace(/<bookName>[^<]*<\/bookName>/, () => `<bookName>${esc(name)}</bookName>`) : g.xml.replace('<bookmeta>', () => `<bookmeta><bookName>${esc(name)}</bookName>`);
  const s = await w.put(`${p.U}/jss`, { xml, baseHash: g.hash }); assert.equal(s.status, 200, JSON.stringify(s.json).slice(0, 300));
  const b = await w.post(`${p.U}/publish`, {}); assert.equal(b.status, 200, JSON.stringify(b.json).slice(0, 400));
  const text = pdfText((await w.get(`${p.U}/publish/pdf`)).buf).replace(/\s+/g, ' ');
  assert.ok(text.includes(`Pump $& Valve $$5 $'`), `the name is printed unchanged: ${text.slice(0, 600)}`);
  assert.ok(!text.includes('<bookName>'), 'no markup leaked into the page');
});

test('xsltproc receives a value with both quote kinds unchanged (PUB-025, the bundled xsltproc)', () => {
  const paths = require('../vendor/engine/paths');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp02-q-'));
  fs.writeFileSync(path.join(dir, 'p.xsl'), '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:output method="text" encoding="UTF-8"/><xsl:param name="v"/><xsl:template match="/">[<xsl:value-of select="$v"/>]</xsl:template></xsl:stylesheet>');
  fs.writeFileSync(path.join(dir, 'd.xml'), '<d/>');
  for (const v of [`O'Brien "Mk 2"`, `a'b'c"d"`, `'"`, `"only double"`, `only 'single'`, 'plain', `x'`]) {
    const out = execFileSync(paths.XSLTPROC, paths.quoteSafeXsltArgs(['--stringparam', 'v', v, 'p.xsl', 'd.xml']), { cwd: dir, encoding: 'utf8', env: paths.childEnv() });
    assert.equal(out, `[${v}]`, v);
  }
  const raw = spawnSync(paths.XSLTPROC, ['--stringparam', 'v', `O'Brien "Mk 2"`, 'p.xsl', 'd.xml'], { cwd: dir, encoding: 'utf8' });
  assert.notEqual(raw.status, 0, 'without the conversion the bundled xsltproc refuses it (the defect is real)');
});

test('entity text and expansion are bounded, not only the number of declarations (S1K-005)', () => {
  const { checkXmlSafety, MAX_ENTITY_TEXT, MAX_ENTITY_EXPANSION } = require('../src/core/auth/xmlGuard');
  const big = 'x'.repeat(MAX_ENTITY_TEXT + 1);
  assert.equal(checkXmlSafety(`<!DOCTYPE d [ <!ENTITY a "${big}"> ]><d/>`).ok, false, 'too much entity text');
  const v = 'y'.repeat(4000); const refs = Math.ceil(MAX_ENTITY_EXPANSION / 4000) + 1;
  assert.equal(checkXmlSafety(`<!DOCTYPE d [ <!ENTITY a "${v}"> ]><d>${'&a;'.repeat(refs)}</d>`).ok, false, 'too much expansion');
  assert.equal(checkXmlSafety(`<!DOCTYPE d [ <!ENTITY a "${v}"> ]><d>${'&a;'.repeat(100)}</d>`).ok, true, 'ordinary use passes');
});
