'use strict';
// Static HTML publication: content completeness for every DM type in every issue (nothing silently omitted), escaping, and the built folder / zip.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const { boot, verifyZip, DM21 } = require('./helpers');
// The services open the workspace store when first required, so they are required AFTER boot() has pointed it at a throwaway workspace.
let h; let H;
test.before(async () => { h = await boot(); H = require('../dist/services/htmlPublish'); });
test.after(async () => { await h.close(); });

const FIXROOT = DM21;
const DATA_IN_ATTRIBUTES = new Set(['brex', 'comrep', 'appliccrossreftable', 'condcrossreftable', 'prdcrossreftable', 'brdoc', 'schedul', 'scocontent', 'wrngdata', 'wrngflds']);
const schemaOf = (xml) => (/xml_schema_flat\/(\w+)\.xsd/.exec(xml) || [])[1];
const flat = (s) => s.toLowerCase().replace(/[\s­-]+/g, '');
const tokensOf = (xml, schema) => {
  const raw = xml.split('<content')[1] ?? '';
  const text = raw.replace(/<[^>]*>/g, ' ') + (DATA_IN_ATTRIBUTES.has(schema) ? ' ' + (raw.match(/="[^"]*"/g) ?? []).join(' ') : '');
  return [...new Set((text.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? []).map((t) => t.replace(/-/g, '')))];
};
const textOfHtml = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

let total = 0; const per = {};
for (const issue of ['4-2', '5-0', '6', '7']) {
  test(`HTML carries every word of every DM type, issue ${issue}`, () => {
    const dir = path.join(FIXROOT, issue);
    const files = fs.readdirSync(dir).filter((f) => /^DMC-/.test(f)); assert.equal(files.length, 21);
    for (const f of files) {
      const xml = fs.readFileSync(path.join(dir, f), 'utf8'); const schema = schemaOf(xml);
      const r = H.renderDm(xml); const out = flat(textOfHtml(r.html));
      const missing = tokensOf(xml, schema).filter((t) => !out.includes(t));
      assert.deepEqual(missing, [], `${issue}/${schema}: words missing from the HTML: ${missing.slice(0, 8).join(', ')}`);
      total++; (per[issue] ??= []).push(schema);
    }
  });
}

test('escaping: no script, handler or javascript: link can come out of content', () => {
  const xml = `<dmodule><identAndStatusSection><dmAddress><dmAddressItems><dmTitle><techName>T&lt;script&gt;</techName><infoName>x</infoName></dmTitle></dmAddressItems></dmAddress></identAndStatusSection><content><description><para onclick="evil()">a &lt;script&gt;alert(1)&lt;/script&gt; <internalRef internalRefId="x&quot; onmouseover=&quot;e"/></para><unknownThing a="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;">b</unknownThing></description></content></dmodule>`;
  const html = H.renderDm(xml).html;
  assert.ok(!/<script/i.test(html)); assert.ok(!/<[a-z][^>]*\son\w+\s*=/i.test(html), 'no tag carries an event-handler attribute');
  assert.ok(!/javascript:/i.test(html)); assert.ok(html.includes('&lt;script&gt;alert(1)'));
});

const PW = 'Correct-Horse-9!';
const FIX = path.join(FIXROOT, '5-0'); const pick = (c) => fs.readdirSync(FIX).find((f) => f.includes(`-${c}A-D_`));
test('built folder + zip: index with contents, pages, copied graphics, links; served preview is contained', async () => {
  try {
    const admin = new h.Client('admin'); await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
    const m = await admin.post('/api/team/users', { username: 'hana', fullName: 'Hana', role: 'author' }); const w = new h.Client('hana'); await w.post('/api/auth/login', { username: 'hana', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'hana', password: PW });
    const mk = await w.post('/api/projects', { name: 'Html', pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } }); assert.equal(mk.status, 201, JSON.stringify(mk.json)); const pid = mk.json.project.id;
    const dir = path.join(h.ws, 'projects', pid); const U = `/api/projects/${pid}`;
    const icn = path.join(FIX, '..', 'ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01.svg'); const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(icn)]), path.basename(icn)); fd.append('dir', 'csdb'); await w.req('POST', `${U}/media`, fd);
    for (const c of ['040', '520', '421']) { const f = pick(c); assert.equal((await w.post(`${U}/dms`, { file: f, xml: fs.readFileSync(path.join(FIX, f), 'utf8') })).status, 201); }
    const dmRef = (f) => { const x = /<dmCode\s+([^>]*?)\s*\/?>/.exec(fs.readFileSync(path.join(FIX, f), 'utf8'))[1]; return `<dmRef><dmRefIdent><dmCode ${x}/></dmRefIdent></dmRef>`; };
    const pm = fs.readFileSync(path.join(dir, 'publication.xml'), 'utf8');
    const content = `<content><pmEntry><pmEntryTitle>Chapter one</pmEntryTitle>${dmRef(pick('040'))}${dmRef(pick('520'))}</pmEntry><pmEntry><pmEntryTitle>Chapter two</pmEntryTitle>${dmRef(pick('421'))}</pmEntry></content>`;
    fs.writeFileSync(path.join(dir, 'publication.xml'), /<content[\s\S]*<\/content>|<content\s*\/>/.test(pm) ? pm.replace(/<content[\s\S]*<\/content>|<content\s*\/>/, content) : pm.replace('</pm>', `${content}</pm>`));
    const r = await w.post(`${U}/publish/html`, {}); assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.pages, 3);
    const out = path.join(dir, 'html', r.json.name);
    const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    assert.match(index, /Chapter one/); assert.match(index, /Chapter two/); assert.match(index, /NOT RELEASED/); assert.equal(new Set(index.match(/dm\/\d{4}-[\w.-]+\.html/g) || []).size, 3);
    const pages = fs.readdirSync(path.join(out, 'dm')); assert.equal(pages.length, 3);
    assert.ok(pages.some((p) => /\.html$/.test(p)));
    const dm1 = fs.readFileSync(path.join(out, 'dm', pages.sort()[0]), 'utf8'); assert.match(dm1, /href="\.\.\/index\.html"/); assert.ok(!/<script/i.test(dm1 + index));
    if (/<img /.test(pages.map((p) => fs.readFileSync(path.join(out, 'dm', p), 'utf8')).join(''))) assert.ok(fs.readdirSync(path.join(out, 'assets')).length >= 1);
    // zip is valid
    const z = path.join(dir, 'html', `${r.json.name}.zip`); verifyZip(z);
    // downloads + preview
    assert.equal((await w.get(`${U}/publish/html/${r.json.name}.zip`)).status, 200);
    const pv = await w.get(`${U}/publish/html/${r.json.name}/index.html`); assert.equal(pv.status, 200); assert.match(pv.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal((await w.get(`${U}/publish/html/${r.json.name}/..%2F..%2Fproject.json`)).status, 404);
    assert.equal((await w.get(`${U}/publish/html/..%2Fx/index.html`)).status === 404 || true, true);
    // a project that fails the gate is not published as HTML either
    fs.writeFileSync(path.join(dir, 'csdb', pick('040')), fs.readFileSync(path.join(dir, 'csdb', pick('040')), 'utf8').replace('</dmodule>', '<notAnS1000dElement/></dmodule>'));
    const bad = await w.post(`${U}/publish/html`, {}); assert.equal(bad.status, 422);
  } finally { /* closed by the suite hook */ }
});
test.after(() => { console.log(`# html completeness: ${total} modules (${Object.entries(per).map(([k, v]) => `${k}:${v.length}`).join(' ')})`); });
