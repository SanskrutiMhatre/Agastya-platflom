'use strict';
// Document-type support for DML, DDN, Comment, Update and IMF in every issue the bundled schemas allow: template creation (schema-valid),
// file naming, XSD validation of the saved file, HTML and PDF rendering, DML references - and the honest refusals where a schema is missing (7.0).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const { spawnSync } = require('node:child_process');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const ROOT = path.resolve(__dirname, '..', '..', 'frontend', 'e2e', 'fixtures', 'dm21');
const ISSUES = [['4-2', '4.2'], ['5-0', '5.0'], ['6', '6.0'], ['7', '7.0']];
let h; let w; let admin;
const pdfText = (buf) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'od-')), 'x.pdf'); fs.writeFileSync(f, buf); return spawnSync('pdftotext', [f, '-'], { encoding: 'utf8' }).stdout.replace(/[\s­-]+/g, '').toLowerCase(); };

test.before(async () => {
  h = await boot(); admin = new h.Client('admin'); await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'olga', fullName: 'Olga', role: 'author' }); w = new h.Client('olga'); await w.post('/api/auth/login', { username: 'olga', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'olga', password: PW });
});
test.after(async () => { await h.close(); });

for (const [key, label] of ISSUES) {
  test(`issue ${label}: Comment / Update / IMF / DML / DDN support`, async () => {
    const mk = await w.post('/api/projects', { name: `Docs ${label}`, pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: label, responsiblePartner: { code: '00000', name: 'Example Company' } } });
    assert.equal(mk.status, 201, JSON.stringify(mk.json)); const U = `/api/projects/${mk.json.project.id}`; const dir = path.join(ROOT, key);
    const files = fs.readdirSync(dir).filter((f) => /^DMC-/.test(f)).filter((f) => /-(040|520|421)A-D_/.test(f));
    for (const f of files) assert.equal((await w.post(`${U}/dms`, { file: f, xml: fs.readFileSync(path.join(dir, f), 'utf8') })).status, 201);
    const ref = files[0]; const saved = [];
    // DML: generated + saved + validated
    const dml = await w.post(`${U}/dml/generate`, { type: 'c', sender: '00000', save: '1' }); assert.equal(dml.status, 200, JSON.stringify(dml.json)); saved.push(dml.json.file);
    // DDN: only where a DDN schema is bundled
    const pkg = await w.post(`${U}/packages/delivery`, { files, sender: { code: '00000' }, receiver: { code: 'U8025', name: 'Receiver', city: 'X', country: 'Y' } });
    assert.equal(pkg.status, 200, pkg.buf?.toString().slice(0, 200));
    const names = (() => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'od-')), 'p.zip'); fs.writeFileSync(f, pkg.buf); const Z = require('../dist/services/zipio'); const r = Z.ZipFileReader.open(f); const n = r.entries.map((e) => e.name); r.close(); return n; })();
    assert.equal(names.some((n) => /^DDN-/.test(n)), key !== '7', `DDN present exactly where a DDN schema is bundled (${label})`);
    // Comment + Update: bundled for 4.2 / 5.0 / 6.0 only
    for (const [kind, params] of [['comment', { refDm: ref, text: 'The torque value looks wrong', title: 'Torque query' }], ['update', { refDm: ref, partNumber: 'PN-AB-12' }]]) {
      const r = await w.post(`${U}/objects/new`, { kind, params, save: '1' });
      if (key === '7') { assert.equal(r.status, 400, `${kind} must be refused for 7.0`); assert.equal(r.json.code, 'NO_SCHEMA'); continue; }
      assert.equal(r.status, 201, `${kind} ${label}: ${JSON.stringify(r.json)}`); saved.push(r.json.file);
    }
    const imf = await w.post(`${U}/objects/new`, { kind: 'imf', params: { icn: 'ICN-EXAMPLE-A-000000-A-00001-00001-A-001-01', icnTitle: 'Rear hub exploded view' }, save: '1' }); assert.equal(imf.status, 201, JSON.stringify(imf.json)); saved.push(imf.json.file);
    // every saved object: valid by the validation run (own schema), listed, rendered as HTML and PDF with its content
    const run = (await w.post(`${U}/validation`, { brex: false })).json.run;
    for (const f of saved) assert.deepEqual(run.issues.filter((i) => i.file === f && i.sev === 'error'), [], `${f} must be valid: ${JSON.stringify(run.issues.filter((i) => i.file === f))}`);
    const listed = (await w.get(`${U}/objects`)).json.objects.map((o) => o.file); for (const f of saved) assert.ok(listed.includes(f), f);
    for (const f of saved) {
      const html = await w.get(`${U}/objects/${f}/html`); assert.equal(html.status, 200); const t = html.buf.toString('utf8');
      assert.ok(/<h1>/.test(t) && !/<script/i.test(t));
      if (/^COM-/.test(f)) assert.match(t, /torque value looks wrong/);
      if (/^IMF-/.test(f)) assert.match(t, /Rear hub exploded view/);
      if (/^UPF-/.test(f)) assert.match(t, /PN-AB-12/);
    }
    const pdfF = saved.find((f) => /^COM-/.test(f) || /^IMF-/.test(f));
    const pdf = await w.post(`${U}/objects/${pdfF}/pdf`, {}); assert.equal(pdf.status, 200, pdf.buf?.toString().slice(0, 200));
    const text = pdfText(pdf.buf); assert.ok(text.includes(/^COM-/.test(pdfF) ? 'torquevaluelookswrong' : 'rearhubexplodedview'), 'PDF carries the content');
    // the DML lists the data modules (DML references)
    const dx = fs.readFileSync(path.join(h.ws, 'projects', mk.json.project.id, 'csdb', dml.json.file), 'utf8'); assert.equal((dx.match(/<dmlEntry /g) || []).length, files.length);
  });
}
