'use strict';
// A data module whose DOCTYPE declares many graphics as entities (every real handbook does: one <!ENTITY ... NDATA> per ICN) has its <dmCode> far
// beyond the first 8 KiB. The engine's reference resolver read only 8 KiB per file, so such a module was never indexed, its publication entry counted as
// "a data module this project does not have", and its whole content was SILENTLY missing from the PDF (only a log line). Found on a 216-module real
// handbook (22 modules affected), Phase 18. A module must be published wherever its identification sits.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { boot, DM21 } = require('./helpers');
const { pdfText } = require('./pdftools');

const PW = 'Correct-Horse-9!';
const FIX = path.join(DM21, '5-0');
const MARK = 'LONGDOCTYPEMARKERWORD';
const text = async (buf) => { return (await pdfText(buf, { mode: 'plain' })).replace(/\s+/g, '').toUpperCase(); };
let h; let w;

test.before(async () => {
  h = await boot(); const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'dora', fullName: 'Dora Doc', role: 'author' });
  w = new h.Client('dora'); await w.post('/api/auth/login', { username: 'dora', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'dora', password: PW });
});
test.after(async () => { await h.close(); });

test('a data module with a very long DOCTYPE (identification beyond 8 KiB) is resolved and published', async () => {
  const pr = await w.post('/api/projects', { name: 'Long doctype', pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } });
  const U = `/api/projects/${pr.json.project.id}`; const dir = path.join(h.ws, 'projects', pr.json.project.id);
  const f1 = fs.readdirSync(FIX).find((f) => /-040A-D_/.test(f)); const x1 = fs.readFileSync(path.join(FIX, f1), 'utf8');
  // module 2: the same descriptive module under another code, a marker paragraph, and a DOCTYPE declaring 400 graphics (~40 KB before <dmCode>)
  const ents = Array.from({ length: 400 }, (_, i) => `<!ENTITY ICN-EXAMPLE-A-000000-A-${String(i).padStart(5, '0')}-00001-A-001-01 SYSTEM "ICN-EXAMPLE-A-000000-A-${String(i).padStart(5, '0')}-00001-A-001-01.png" NDATA png>`).join('\n');
  const doctype = `<!DOCTYPE dmodule [<!NOTATION png PUBLIC "-//W3C//NOTATION Portable Network Graphics//EN">\n${ents}\n]>\n`;
  let x2 = x1.replace(/assyCode="\d+"/, 'assyCode="77"').replace('</description>', `<levelledPara><title>Long doctype</title><para>${MARK}</para></levelledPara></description>`);
  // add the declarations to the module's own DOCTYPE internal subset when it has one (only one DOCTYPE is allowed), else give it one
  const subset = `<!NOTATION png PUBLIC "-//W3C//NOTATION Portable Network Graphics//EN">\n${ents}\n`;
  if (/<!DOCTYPE[^>[]*\[/.test(x2)) x2 = x2.replace(/(<!DOCTYPE[^>[]*\[)/, `$1\n${subset}`);
  else x2 = /^<\?xml[^>]*\?>/.test(x2) ? x2.replace(/^(<\?xml[^>]*\?>)\s*/, `$1\n${doctype}`) : doctype + x2;
  const f2 = f1.replace(/-00-00-\d+-00A-/, '-00-00-77-00A-');
  assert.ok(x2.indexOf('<dmCode') > 20000, `the module's own <dmCode> must sit beyond 8 KiB (at ${x2.indexOf('<dmCode')})`);
  for (const [f, x] of [[f1, x1], [f2, x2]]) { const r = await w.post(`${U}/dms`, { file: f, xml: x }); assert.equal(r.status, 201, `${f}: ${JSON.stringify(r.json).slice(0, 300)}`); }
  const ref = (xml) => `<dmRef><dmRefIdent>${/<dmIdent>[\s\S]*?(<dmCode\s[^>]*\/>)/.exec(xml)[1]}</dmRefIdent></dmRef>`;
  const pmFile = path.join(dir, 'publication.xml');
  fs.writeFileSync(pmFile, fs.readFileSync(pmFile, 'utf8').replace(/<content[\s\S]*<\/content>|<content\s*\/>/, `<content><pmEntry><pmEntryTitle>Plain</pmEntryTitle>${ref(x1)}</pmEntry><pmEntry><pmEntryTitle>Long</pmEntryTitle>${ref(x2)}</pmEntry></content>`));
  const built = await w.post(`${U}/publish`, {});
  assert.equal(built.status, 200, JSON.stringify(built.json).slice(0, 400));
  assert.ok((await text((await w.get(`${U}/publish/pdf`)).buf)).includes(MARK), 'the content of the module with the long DOCTYPE is in the PDF');
});
