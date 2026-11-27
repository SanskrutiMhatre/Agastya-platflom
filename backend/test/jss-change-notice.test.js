'use strict';
// The vendor exception "changenotice.layout" (docs/JSS_VENDOR_EXCEPTIONS.md): the Change Notice page of a JSS-authored publication is the L&T pro-forma (a header row and 15 ruled
// rows at 12 pt, the Pages / Enclosures / Sheets lines, the codes box with its note). The default of the parameter keeps the classic page, so every other build (S1000D, the old JSS
// path) is unchanged: test/jss-cover-isolation.test.js holds the fingerprints that prove it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { boot, tmp } = require('./helpers');
const { readPdf } = require('./pdftools');

const PW = 'Correct-Horse-9!';
const VENDOR = path.resolve(__dirname, '..', 'vendor', 'pipeline');

const pageText = async (pdf, n) => (await readPdf(pdf)).text({ first: n, last: n });    // pdf.js (test/pdftools.js); the PDF is parsed once

test('the stylesheet: classic by default (3 rows), grid = the pro-forma (15 rows), the rest of the book is the same', () => {
  const { XSLTPROC } = require('../vendor/engine/paths');
  const book = `<?xml version="1.0"?><jssbook xmlns:xi="http://www.w3.org/2001/XInclude"><bookmeta><bookName>B</bookName><systemName>S</systemName><security>RESTRICTED</security><month>November</month><year>2026</year>
    <publishers><publisher><logo src="pub-logo.png"/><name>L&amp;T Defence,</name></publisher></publishers></bookmeta>
    <frontmatter><changeNotice rows="3"/></frontmatter>
    <body><chapter number="1"><title>A</title><section><title>B</title><para>x</para></section></chapter></body></jssbook>`;
  const f = path.join(tmp('chn-'), 'book.xml'); fs.writeFileSync(f, book);
  const run = (...params) => { const r = spawnSync(XSLTPROC, ['--nonet', ...params, path.join(VENDOR, 'jsstofo', 'jsstofo.xsl'), f], { encoding: 'utf8', cwd: path.join(VENDOR, 'jsstofo') }); assert.equal(r.status, 0, r.stderr.slice(0, 400)); return r.stdout.replace(/(internal-destination|id)="[^"]*"/g, '$1="#"'); };   // the generated ids differ from run to run
  const rows = (fo) => (fo.match(/<fo:table-row /g) || []).length;
  const dflt = run(); const off = run('--stringparam', 'changenotice.layout', 'classic'); const grid = run('--stringparam', 'changenotice.layout', 'grid');
  { let i = 0; while (i < off.length && off[i] === dflt[i]) i++; assert.equal(off, dflt, `an explicit classic is the default (first difference at ${i}: ${JSON.stringify(off.slice(i - 60, i + 60))} | ${JSON.stringify(dflt.slice(i - 60, i + 60))})`); }
  assert.ok(dflt.includes('CHANGE NOTICE') && dflt.includes('No. of Sheets'), 'default: the classic page, as before');
  assert.ok(!dflt.includes('Sheets:') && !dflt.includes('Enclosures:'), 'default: none of the pro-forma lines');
  for (const s of ['CHANGE NOTICE', 'TITLE OF PUBLICATION', 'CODE No. AND DATE', 'PREVIOUS CHANGE', 'CHANGE NOTICE No. AND DATE', 'No. of Pages:', 'Enclosures:', 'Sheets:', 'CODES FOR INCORPORATION OF CHANGES:', 'NOTE:', 'By Replacement/addition of sheet(s)', 'By Hand-correction', 'By pasting the enclosed matter', 'Additional information - only to be filed in the publication']) assert.ok(grid.includes(s), `grid: ${s}`);
  assert.ok(grid.includes('pub-logo.png'), 'grid: the letterhead is the publisher logo');
  assert.ok(!grid.includes('L&amp;T Defence'), 'grid: and no publisher name beside it');
  assert.ok(dflt.includes('L&amp;T Defence'), 'default: the classic page still prints the name');
  assert.equal(rows(grid) - rows(dflt), (1 + 15 + 2 + 1) - 4, 'grid: 19 rows (a header row, 15 ruled rows, the Pages and Enclosures lines, the codes box) against the 4 of the classic page');
  // the grid page is 12 pt, with a 1 pt rule on every line of the table
  assert.ok(/<fo:block break-before="page" font-size="12pt"><fo:block text-align="center"[^>]*>CHANGE NOTICE/.test(grid.replace(/\s+/g, ' ').replace(/> </g, '><')), 'grid: 12 pt page');
  // nothing but the Change Notice page differs: cut the page out of both and compare the rest
  const strip = (fo) => fo.replace(/<fo:block break-before="page"[^>]*>(?:(?!<fo:block break-before="page")[\s\S])*?CHANGE NOTICE[\s\S]*?(?=<fo:block break-before="page"|<\/fo:flow>)/, '[CN]');
  assert.equal(strip(grid), strip(dflt), 'the rest of the book is the same');
});

let h; let w;
test.before(async () => {
  h = await boot(); const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'notice', fullName: 'Notice', role: 'author' });
  w = new h.Client('notice'); await w.post('/api/auth/login', { username: 'notice', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'notice', password: PW });
});
test.after(async () => { await h.close(); });

test('a JSS-authored UHB prints the Change Notice as the pro-forma: fifteen ruled rows, no publisher name, the codes box and its note, on one page', { timeout: 300000 }, async () => {
  const r = await w.post('/api/projects', { name: 'Change notice', format: 'jss', domain: 'land', manualType: 'uhb' }); assert.equal(r.status, 201);
  const id = r.json.project.id;
  const b = await w.post(`/api/projects/${id}/publish`, {}); assert.equal(b.status, 200, JSON.stringify(b.json).slice(0, 300));
  const pdf = (await w.get(`/api/projects/${id}/publish/pdf`)).buf;
  const fo = fs.readFileSync(path.join(h.ws, 'projects', id, 'jss-output.fo'), 'utf8');
  assert.ok(fo.includes('CODES FOR INCORPORATION OF CHANGES:'), 'the build used the grid layout');
  // find its page: the one that has the codes box
  let page = 0; let text = '';
  for (let n = 1; n <= 40 && !page; n++) { const t = await pageText(pdf, n); if (/CODES FOR INCORPORATION OF CHANGES:/.test(t)) { page = n; text = t; } }
  assert.ok(page > 0, 'the Change Notice page is in the PDF');
  for (const s of ['CHANGE NOTICE', 'TITLE OF PUBLICATION', 'PREVIOUS', 'No. of Pages:', 'Enclosures:', 'Sheets:', 'NOTE:', 'By Hand-correction', 'By pasting the enclosed matter']) assert.ok(text.includes(s), `${s} is on the page`);
  assert.match(text, /\(R\)\s+By Replacement\/addition of sheet\(s\)/); assert.match(text, /\(A\)\s+Additional information/);
  assert.ok(/CONTENTS\s+Page/.test(text) && /Record\s+of/.test(text), 'the note is complete');
  assert.ok(!/L&T Defence/.test(text), 'the letterhead is the logo alone: no publisher name');
  assert.ok(!/Change Notice[\s\S]{0,40}No\. of Sheets/.test(text), 'and the classic arrangement is gone');
  assert.ok(!/CODES FOR INCORPORATION OF CHANGES:/.test(await pageText(pdf, page + 1)), 'the whole pro-forma is on one page');
});
