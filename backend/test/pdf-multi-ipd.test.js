'use strict';
// A publication with TWO OR MORE illustrated parts data modules must build as a PDF. ipd.xsl used the same fixed ids (ipd-toc, ipd-lof,
// ipd-parts-list) in every IPD module, so FOP refused the document ("Property ID ipd-toc previously used; ID values must be unique") and, even where
// it did not, the table-of-contents links of the second module pointed at the first (found on a 218-module real handbook, Phase 18).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { boot, DM21 } = require('./helpers');
const { pdfText } = require('./pdftools');

const PW = 'Correct-Horse-9!';
const FIX = path.join(DM21, '5-0');
const text = (buf) => pdfText(buf, { mode: 'plain' });                 // pdf.js (test/pdftools.js), no external program
let h; let w;

test.before(async () => {
  h = await boot(); const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'ida', fullName: 'Ida Parts', role: 'author' });
  w = new h.Client('ida'); await w.post('/api/auth/login', { username: 'ida', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'ida', password: PW });
});
test.after(async () => { await h.close(); });

for (const [pipeline, label] of [['s1000dtofo', 'direct S1000D engine']]) {
  test(`${label}: two illustrated parts data modules in one publication build, with their own contents`, async () => {
    const pr = await w.post('/api/projects', { name: 'Two IPD', pipeline, s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } });
    const U = `/api/projects/${pr.json.project.id}`; const dir = path.join(h.ws, 'projects', pr.json.project.id);
    const f1 = fs.readdirSync(FIX).find((f) => /-941A-D_/.test(f)); const x1 = fs.readFileSync(path.join(FIX, f1), 'utf8');
    // the second IPD module: the same content under another assembly code (so another data module code)
    const f2 = f1.replace('-00-00-05-00A-', '-00-00-06-00A-'); const x2 = x1.replace('assyCode="05"', 'assyCode="06"');
    assert.notEqual(x1, x2);
    for (const [f, x] of [[f1, x1], [f2, x2]]) { const r = await w.post(`${U}/dms`, { file: f, xml: x }); assert.equal(r.status, 201, `${f}: ${JSON.stringify(r.json)}`); }
    const ref = (xml) => `<dmRef><dmRefIdent>${/<dmCode [^>]*\/>/.exec(xml)[0]}</dmRefIdent></dmRef>`;
    const pmFile = path.join(dir, 'publication.xml'); const pm = fs.readFileSync(pmFile, 'utf8');
    fs.writeFileSync(pmFile, pm.replace(/<content[\s\S]*<\/content>|<content\s*\/>/, `<content><pmEntry><pmEntryTitle>Parts A</pmEntryTitle>${ref(x1)}</pmEntry><pmEntry><pmEntryTitle>Parts B</pmEntryTitle>${ref(x2)}</pmEntry></content>`));
    const built = await w.post(`${U}/publish`, {});
    assert.equal(built.status, 200, JSON.stringify(built.json).slice(0, 500));
    const pdf = await text((await w.get(`${U}/publish/pdf`)).buf);
    assert.equal((pdf.match(/Illustrated Parts List/g) ?? []).length >= 2, true, 'each IPD module prints its own parts list entry');
  });
}
