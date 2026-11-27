'use strict';
// The vendor exception "cover.authority.foot" (docs/JSS_VENDOR_EXCEPTIONS.md): the date and the "Under the Authority of ..." block of a JSS cover are printed in the foot
// of the first page, above the classification banner, and no longer at the end of the cover's body. The default of the parameter keeps the old place, so every other build
// (S1000D, the old JSS path) is unchanged: test/jss-cover-isolation.test.js holds the fingerprints that prove it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { boot, tmp } = require('./helpers');
const { readPdf } = require('./pdftools');

const PW = 'Correct-Horse-9!';
const VENDOR = path.resolve(__dirname, '..', 'vendor', 'pipeline');

const pageText = async (pdf, n) => (await readPdf(pdf)).text({ first: n, last: n });    // pdf.js (test/pdftools.js); the PDF is parsed once

test('the stylesheet: off by default (the block stays in the body), on = the foot region of the cover master with the taller foot', () => {
  const { XSLTPROC } = require('../vendor/engine/paths');
  const book = `<?xml version="1.0"?><jssbook xmlns:xi="http://www.w3.org/2001/XInclude"><bookmeta><bookName>B</bookName><systemName>S</systemName><security>RESTRICTED</security><month>November</month><year>2026</year></bookmeta>
    <frontmatter><titlePage><documentType>USER HANDBOOK</documentType><disclosureNotice><para>NOTICE</para></disclosureNotice><repairNotice><para>REPAIR</para></repairNotice></titlePage></frontmatter>
    <body><chapter number="1"><title>A</title><section><title>B</title><para>x</para></section></chapter></body></jssbook>`;
  const f = path.join(tmp('cvf-'), 'book.xml'); fs.writeFileSync(f, book);
  const run = (...params) => { const r = spawnSync(XSLTPROC, ['--nonet', ...params, path.join(VENDOR, 'jsstofo', 'jsstofo.xsl'), f], { encoding: 'utf8', cwd: path.join(VENDOR, 'jsstofo') }); assert.equal(r.status, 0, r.stderr.slice(0, 400)); return r.stdout; };
  // the cover is the first page sequence; its foot region is what comes before its flow
  const cover = (fo) => { const i = fo.indexOf('<fo:page-sequence '); const j = fo.indexOf('</fo:page-sequence>', i); const seq = fo.slice(i, j); const k = seq.indexOf('<fo:flow'); return { foot: seq.slice(0, k), flow: seq.slice(k), head: seq.slice(0, 200) }; };
  const dflt = cover(run()); const on = cover(run('--stringparam', 'cover.authority.foot', '1')); const off = cover(run('--stringparam', 'cover.authority.foot', '0'));
  assert.match(dflt.head, /master-reference="cover"/, 'default: the plain cover master');
  assert.ok(dflt.flow.includes('Under the Authority of'), 'default: the block is in the body, as before');
  assert.equal(JSON.stringify(off), JSON.stringify(dflt), 'an explicit 0 is the default');
  assert.match(on.head, /master-reference="cover-foot"/, 'on: the cover master with the taller foot');
  assert.ok(!on.flow.includes('Under the Authority of'), 'on: the body no longer has the block');
  assert.ok(on.foot.includes('Under the Authority of') && on.foot.includes('Secretary, Ministry of Defence'), 'on: the foot region has the authority block');
  assert.ok(/November\s*,\s*2026/.test(on.foot.replace(/<[^>]+>/g, '')), 'on: and the date');
  assert.ok(on.foot.includes('cover-foot-after') && on.foot.includes('RESTRICTED'), 'on: above the classification banner');
  // the rest of the cover is the same: the default's body minus the block equals the foot variant's body
  const strip = (s) => s.replace(/\s+/g, '');
  const block = /<fo:table table-layout="fixed" width="100%" space-before="6mm">(?:(?!<\/fo:table>)[\s\S])*?Under the Authority of[\s\S]*?<\/fo:table>/;
  assert.equal(strip(on.flow), strip(dflt.flow.replace(block, '')), 'nothing else on the cover moved');
});

let h; let w;
test.before(async () => {
  h = await boot(); const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'footer', fullName: 'Foot', role: 'author' });
  w = new h.Client('footer'); await w.post('/api/auth/login', { username: 'footer', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'footer', password: PW });
});
test.after(async () => { await h.close(); });

test('a JSS-authored UHB: page 1 is one page, with the date and authority block in its foot just above the banner (as the L&T reference sets it), and page 2 is its blank back with nothing on it', { timeout: 300000 }, async () => {
  const r = await w.post('/api/projects', { name: 'Cover foot', format: 'jss', domain: 'land', manualType: 'uhb' }); assert.equal(r.status, 201);
  const id = r.json.project.id;
  const b = await w.post(`/api/projects/${id}/publish`, {}); assert.equal(b.status, 200, JSON.stringify(b.json).slice(0, 300));
  const pdf = (await w.get(`/api/projects/${id}/publish/pdf`)).buf;
  const fo = fs.readFileSync(path.join(h.ws, 'projects', id, 'jss-output.fo'), 'utf8');
  assert.match(fo, /master-reference="cover-lref"/, 'the build used the L&T reference cover master, whose foot region holds the block (cover-foot is the master of the old layout)');
  const p1 = await pageText(pdf, 1); const lines = p1.split('\n').map((l) => l.trim()).filter(Boolean);
  const authority = lines.findIndex((l) => /Under the Authority of/.test(l));
  assert.ok(authority > 0, 'page 1 has the authority block: ' + p1.slice(0, 600));
  const block = `${lines[authority]} ${lines[authority + 1]}`;
  assert.match(block, /[A-Z][a-z]+,\s*\d{4}/, 'the date is in the block\'s rows (the reference prints it on the baseline of the last line)');
  assert.match(lines[authority + 1], /Secretary, Ministry of Defence, Govt\. of India/, 'the authority is two lines, as the reference prints it');
  assert.equal(lines[lines.length - 1], 'RESTRICTED', 'the banner is the last thing on the page');
  assert.equal(authority + 2, lines.length - 1, 'and the block is the line pair just above it');
  // what the body ends with is the publisher, not the block: the block comes after the publisher and the gap between them is the cover's free space
  assert.ok(lines.findIndex((l) => /Prepared & Published by/.test(l)) < authority);
  assert.equal((await pageText(pdf, 2)).trim(), '', 'the cover is one page: page 2 is its blank back, with nothing on it (the reference)');
});
