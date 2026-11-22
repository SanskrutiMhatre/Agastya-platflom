'use strict';
// Generates schema-valid Comment / Update / ICN-metadata documents (the platform's own templates, validated by the server against the
// bundled XSD) as fixtures for the Studio's structured-editing tests:
//   node scripts/gen-object-fixtures.js
// -> frontend/src/studio/__tests__/rich/objects/<issue>/{comment,update,imf}.xml  (issue 7 has no comment/update schema: not invented)
const fs = require('fs'); const path = require('path');
const { boot } = require('../test/helpers');
const PW = 'Correct-Horse-9!';
const ROOT = path.resolve(__dirname, '..', '..', 'frontend', 'e2e', 'fixtures', 'dm21');
const OUT = path.resolve(__dirname, '..', '..', 'frontend', 'src', 'studio', '__tests__', 'rich', 'objects');
const ISSUES = [['4-2', '4.2'], ['5-0', '5.0'], ['6', '6.0'], ['7', '7.0']];
(async () => {
  const h = await boot(); const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'olga', fullName: 'Olga', role: 'author' });
  const w = new h.Client('olga'); await w.post('/api/auth/login', { username: 'olga', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'olga', password: PW });
  for (const [key, label] of ISSUES) {
    const mk = await w.post('/api/projects', { name: `Fx ${label}`, pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: label, responsiblePartner: { code: '00000', name: 'Example Company' } } });
    const U = `/api/projects/${mk.json.project.id}`; const dir = path.join(ROOT, key);
    const files = fs.readdirSync(dir).filter((f) => /^DMC-/.test(f)).filter((f) => /-(040|520|421)A-D_/.test(f));
    for (const f of files) await w.post(`${U}/dms`, { file: f, xml: fs.readFileSync(path.join(dir, f), 'utf8') });
    const out = path.join(OUT, key); fs.mkdirSync(out, { recursive: true });
    for (const [kind, params] of [['comment', { refDm: files[0], text: 'The torque value looks wrong', title: 'Torque query' }], ['update', { refDm: files[0], partNumber: 'PN-AB-12' }], ['imf', { icn: 'ICN-EXAMPLE-A-000000-A-00001-00001-A-001-01', icnTitle: 'Rear hub exploded view' }]]) {
      const r = await w.post(`${U}/objects/new`, { kind, params });
      if (r.status !== 200) { console.log(`${label} ${kind}: ${r.status} ${r.json?.code}`); continue; }
      fs.writeFileSync(path.join(out, `${kind}.xml`), r.json.xml); console.log(`${label} ${kind}: ${r.json.file}`);
    }
  }
  await h.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
