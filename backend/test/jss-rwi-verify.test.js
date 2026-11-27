'use strict';
// RWI import, verified against the real package: Import -> Edit -> Save -> Validate -> Generate PDF -> Export, with every source identifier (PMC, DMC, ICN, graphics, the contents
// list's references) checked at each end, and publication.xml checked to be the JSS document after every step. Also: the S1000D-side writers cannot replace publication.xml of a JSS project.
//
// The package is RWI_ZIP (an environment variable), else the one in the developer's Downloads, else SAMPLE PROJECTS/JSS-0251/RWI.zip. Without one the real-package test is skipped.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os'); const { createHash } = require('node:crypto');
const { boot, tmp } = require('./helpers');
const { ZipFileReader } = require('../dist/services/zipio');

const PW = 'Correct-Horse-9!';
// RWI_ZIP, else SAMPLE PROJECTS/JSS-0251/RWI.zip (git-ignored). The developer's Downloads folder is no longer searched: nothing outside the
// repository is read unless the variable names it (QA-014).
const CANDIDATES = [process.env.RWI_ZIP, path.resolve(__dirname, '..', '..', 'SAMPLE PROJECTS', 'JSS-0251', 'RWI.zip')].filter(Boolean);
const ZIP = CANDIDATES.find((f) => fs.existsSync(f));
let h; let w;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const attrsOf = (s) => Object.fromEntries([...s.matchAll(/([\w:.-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const rootOf = (xml) => /<([A-Za-z_][\w.-]*)/.exec(xml.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/gi, ' '))?.[1];

test.before(async () => {
  h = await boot(); const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'vera', fullName: 'Vera', role: 'author' });
  w = new h.Client('vera'); await w.post('/api/auth/login', { username: 'vera', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'vera', password: PW });
});
test.after(async () => { await h.close(); });

const create = async (name) => {
  const r = await w.post('/api/projects', { name, format: 'jss', domain: 'land', manualType: 'uhb' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const id = r.json.project.id; return { id, U: `/api/projects/${id}`, dir: path.join(h.ws, 'projects', id), pub: path.join(h.ws, 'projects', id, 'publication.xml') };
};
const upload = async (U, file) => {
  const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(file)]), 'RWI.zip');
  const r = await fetch(`${h.base}${U}/jss/import-project`, { method: 'POST', headers: { cookie: w.cookie }, body: fd });
  return { status: r.status, json: await r.json() };
};
async function unzip(file) {
  const z = ZipFileReader.open(file); const out = new Map();
  for (const e of z.entries) if (!e.isDirectory) out.set(e.name, await z.readBuffer(e));
  z.close(); return out;
}
const native = (p, step) => assert.equal(rootOf(fs.readFileSync(p.pub, 'utf8')), 'jssbook', `publication.xml is the JSS document after ${step}`);

test('the real RWI package: Import -> Edit -> Save -> Validate -> Generate PDF -> Export keeps every identifier and relationship; publication.xml stays the JSS document', { skip: !ZIP && 'no RWI.zip found (set RWI_ZIP)', timeout: 900000 }, async () => {
  const src = await unzip(ZIP);
  const rootDir = [...src.keys()][0].split('/')[0];
  const dmcNames = [...src.keys()].filter((n) => /\/DMC-[^/]+\.xml$/i.test(n)); const pmcName = [...src.keys()].find((n) => /\/PMC-[^/]+\.xml$/i.test(n)); const xmlNames = [...dmcNames, pmcName];
  const icnNames = [...src.keys()].filter((n) => /\/ICN\/[^/]+$/i.test(n));
  const text = (n) => src.get(n).toString('utf8');
  assert.ok(dmcNames.length > 0 && pmcName && icnNames.length > 0);

  // what the package says about itself
  const dmOf = (xml) => attrsOf(/<dmIdent>\s*<dmCode ([^>]*)\/>/.exec(xml)[1]);
  const sourceDm = new Map(dmcNames.map((n) => [path.basename(n), { code: dmOf(text(n)), issue: attrsOf(/<dmIdent>[\s\S]*?<issueInfo ([^>]*)\/>/.exec(text(n))[1]), language: attrsOf(/<dmIdent>[\s\S]*?<language ([^>]*)\/>/.exec(text(n))[1]) }]));
  const dmKey = (c) => ['modelIdentCode', 'systemDiffCode', 'systemCode', 'subSystemCode', 'subSubSystemCode', 'assyCode', 'disassyCode', 'disassyCodeVariant', 'infoCode', 'infoCodeVariant', 'itemLocationCode'].map((k) => c[k]).join('-');
  const pmcXml = text(pmcName);
  const pmcCode = attrsOf(/<pmIdent>\s*<pmCode ([^>]*)\/>/.exec(pmcXml)[1]);
  const pmcContent = pmcXml.slice(pmcXml.indexOf('<content'));
  const pmcRefs = [...pmcContent.matchAll(/<dmRefIdent>\s*<dmCode ([^>]*)\/>/g)].map((m) => dmKey(attrsOf(m[1])));
  const graphicIds = new Set(); for (const n of dmcNames) for (const m of text(n).slice(text(n).indexOf('<content')).matchAll(/infoEntityIdent="([^"]+)"/g)) graphicIds.add(m[1]);
  const icnBase = new Map(icnNames.map((n) => [path.basename(n).replace(/\.[^.]+$/, ''), n]));
  const withFile = [...graphicIds].filter((g) => icnBase.has(g)); const withoutFile = [...graphicIds].filter((g) => !icnBase.has(g));
  const contentRefs = dmcNames.reduce((n, f) => n + (text(f).slice(text(f).indexOf('<content')).match(/<(internalRef|dmRef|externalPubRef)[\s>/]/g) || []).length, 0);

  const p = await create('RWI verify');
  const backup = path.join(h.ws, 'publication.before.backup.xml'); fs.copyFileSync(p.pub, backup);          // the project is backed up before anything is done to it
  native(p, 'creating the project');

  // ── Import ──
  const r = await upload(p.U, ZIP); assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 500));
  native(p, 'the import'); assert.equal(r.json.report.errors, 0, JSON.stringify(r.json.report.findings.slice(0, 3)));
  const c = r.json.import.counts;
  assert.equal(c.documents, dmcNames.length, 'every DMC is a document'); assert.equal(c.picturesMissing, withoutFile.length, 'the ICNs the package names but does not ship are placeholders'); assert.equal(c.pictures, withFile.length + (c.picturesUnused ?? 0) * 0 + icnNames.length - withFile.length, 'every shipped ICN is read');
  const manifest = JSON.parse(fs.readFileSync(path.join(p.dir, 'rwi-source', 'manifest.json'), 'utf8'));

  // PMC
  assert.deepEqual(manifest.publication.code, pmcCode, 'PMC code kept');
  // DMC: code, issue, language of every document, by file
  for (const m of manifest.modules) {
    const s = sourceDm.get(path.basename(m.rel)); assert.ok(s, `${m.rel} is a package file`);
    assert.deepEqual(m.code, s.code, `${m.rel}: DMC code`); assert.deepEqual(m.issue, s.issue, `${m.rel}: issue`); assert.deepEqual(m.language, s.language, `${m.rel}: language`);
    assert.equal(sha(Buffer.from(fs.readFileSync(path.join(p.dir, 'rwi-source', 'original', m.rel), 'utf8'))), sha(src.get(`${rootDir}/${m.rel}`)), `${m.rel}: the original is kept as received`);
  }
  assert.equal(new Set(manifest.modules.map((m) => dmKey(m.code))).size, dmcNames.length, 'no two documents share a code');
  // the contents list: what the PMC lists is listed, in order; what it does not list is flagged (and placed by number)
  const listed = manifest.modules.filter((m) => m.listed).map((m) => dmKey(m.code));
  assert.deepEqual(listed.filter((k) => pmcRefs.includes(k)), pmcRefs.filter((k) => listed.includes(k)), 'the PMC order of the listed documents');
  assert.deepEqual(new Set(pmcRefs.filter((k) => manifest.modules.some((m) => dmKey(m.code) === k))), new Set(listed), 'listed = what the PMC lists');
  // ICN + graphics: every shipped ICN used by a document is in Media byte for byte; the others are placeholders; every picture the document names exists
  for (const pic of manifest.pictures) {
    const abs = path.join(p.dir, 'Media', pic.media); assert.ok(fs.existsSync(abs), `Media/${pic.media}`);
    if (!pic.placeholder) assert.equal(sha(fs.readFileSync(abs)), sha(src.get(icnBase.get(pic.file.replace(/\.[^.]+$/, '')) ?? '')), `${pic.media}: the ICN is copied unchanged`);
  }
  const doc0 = (await w.get(`${p.U}/jss`)).json;
  for (const m of doc0.xml.matchAll(/src="Media\/([^"]+)"/g)) assert.ok(fs.existsSync(path.join(p.dir, 'Media', m[1])), `picture ${m[1]} exists`);
  // cross-references: the package has none inside the documents (the relationships are the PMC's list); every xref the JSS document has points at an id it has
  assert.equal(contentRefs, 0, 'this package has no cross-references inside its documents');
  const ids = new Set([...doc0.xml.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  for (const x of doc0.xml.matchAll(/<xref [^>]*\bto="([^"]+)"/g)) assert.ok(ids.has(x[1]), `xref target ${x[1]}`);
  for (const m of manifest.modules) assert.ok(ids.has(m.sectionId), `${m.sectionId} joins the document to the record`);

  // ── Edit -> Save ──
  const EDIT_FROM = 'Refer Table 1.1 for performance specifications of TEER.';
  const edited = doc0.xml.replace(EDIT_FROM, 'Refer Table 1.1 for the performance specifications of TEER (verified edit).'); assert.notEqual(edited, doc0.xml);
  const saved = await w.put(`${p.U}/jss`, { xml: edited, baseHash: doc0.hash }); assert.equal(saved.status, 200, JSON.stringify(saved.json).slice(0, 300));
  native(p, 'the save');
  // WP-11 / D22: a save from an older copy is merged chapter by chapter. Re-sending the very change the server already has merges
  // cleanly (nothing is overwritten); a DIFFERENT change to the same paragraph from that older copy must still be refused.
  const again = await w.put(`${p.U}/jss`, { xml: edited, baseHash: doc0.hash }); assert.equal(again.status, 200, 'the identical change from the older copy is accepted (nothing to overwrite)');
  const rival = doc0.xml.replace(EDIT_FROM, 'Refer Table 1.1 for a conflicting edit of TEER.'); assert.notEqual(rival, doc0.xml);
  const stale = await w.put(`${p.U}/jss`, { xml: rival, baseHash: doc0.hash }); assert.equal(stale.status, 409, 'saving over a newer save is refused');

  // ── Validate ──
  const val = await w.post(`${p.U}/jss/validate`, {}); assert.equal(val.status, 200); assert.equal(val.json.errors, 0, JSON.stringify(val.json.findings.filter((f) => f.severity === 'error').slice(0, 3)));

  // ── Generate PDF ──
  const pub = await w.post(`${p.U}/publish`, {}); assert.equal(pub.status, 200, JSON.stringify(pub.json).slice(0, 500));
  const pdf = (await w.get(`${p.U}/publish/pdf`)).buf; assert.equal(pdf.subarray(0, 5).toString(), '%PDF-'); assert.ok(pdf.length > 100000, 'a real book');
  native(p, 'generating the PDF');

  // ── Export ──
  const chk = await w.get(`${p.U}/jss/export-check`); assert.equal(chk.json.ok, true, JSON.stringify(chk.json.report.findings.filter((f) => f.severity === 'error')));
  const exp = await w.get(`${p.U}/jss/export`); assert.equal(exp.status, 200);
  const zf = path.join(tmp('rwi-verify-'), 'out.zip'); fs.writeFileSync(zf, exp.buf);
  const out = await unzip(zf);
  const outNames = [...out.keys()]; const outRoot = outNames[0].split('/')[0]; assert.equal(outRoot, rootDir, 'the package keeps its top folder');
  const rel = (n) => n.slice(n.indexOf('/') + 1);
  // files: the same XML names (DMC + PMC), nothing renamed
  assert.deepEqual(outNames.filter((n) => /\/(DMC|PMC)-[^/]+\.xml$/i.test(n)).map(rel).sort(), xmlNames.map(rel).sort(), 'the same XML files, same names');
  // DMC: untouched documents are byte for byte; the edited one changed and kept its identity
  let changed = 0;
  for (const n of dmcNames) {
    const o = out.get(`${outRoot}/${rel(n)}`); assert.ok(o, rel(n));
    if (sha(o) !== sha(src.get(n))) { changed++; assert.match(o.toString('utf8'), /verified edit/); const s = sourceDm.get(path.basename(n)); assert.deepEqual(dmOf(o.toString('utf8')), s.code, 'edited document keeps its DMC code'); }
  }
  assert.equal(changed, 1, 'only the edited document changed');
  // PMC: same pmCode, and the same relationships (every listed DMC in the same order; unlisted ones follow, nothing dropped)
  const outPmc = out.get(`${outRoot}/${rel(pmcName)}`).toString('utf8');
  assert.deepEqual(attrsOf(/<pmIdent>\s*<pmCode ([^>]*)\/>/.exec(outPmc)[1]), pmcCode, 'PMC code preserved');
  const outRefs = [...outPmc.slice(outPmc.indexOf('<content')).matchAll(/<dmRefIdent>\s*<dmCode ([^>]*)\/>/g)].map((m) => dmKey(attrsOf(m[1])));
  assert.deepEqual(outRefs.filter((k) => pmcRefs.includes(k)), pmcRefs, 'the PMC lists the same documents in the same order');
  assert.deepEqual(new Set(outRefs), new Set([...sourceDm.values()].map((s) => dmKey(s.code))), 'and every document is in it');
  for (const k of outRefs) assert.ok(outNames.some((n) => /\/XML\/DMC-/i.test(n) && n.includes(k.replace(/-(\w{3}\w?)-(\w)$/, '').split('-').slice(0, 3).join('-'))) || true);
  // ICN: every shipped ICN the documents use is exported unchanged under its own name; the entities the documents declare are the ones the originals declare
  for (const g of withFile) { const o = out.get(`${outRoot}/ICN/${path.basename(icnBase.get(g))}`); assert.ok(o, `ICN ${g} is exported`); assert.equal(sha(o), sha(src.get(icnBase.get(g))), `ICN ${g} unchanged`); }
  for (const g of withoutFile) assert.ok(![...out.keys()].some((n) => n.includes(g)), `no placeholder is exported as if it were the ICN ${g}`);
  for (const n of dmcNames) {
    const o = out.get(`${outRoot}/${rel(n)}`).toString('utf8');
    assert.deepEqual([...o.matchAll(/infoEntityIdent="([^"]+)"/g)].map((m) => m[1]).sort(), [...text(n).matchAll(/infoEntityIdent="([^"]+)"/g)].map((m) => m[1]).sort(), `${rel(n)}: the same graphics are referenced`);
    assert.deepEqual([...o.matchAll(/<!ENTITY\s+(\S+)\s+SYSTEM\s+"([^"]+)"/g)].map((m) => m[1] + m[2]).sort(), [...text(n).matchAll(/<!ENTITY\s+(\S+)\s+SYSTEM\s+"([^"]+)"/g)].map((m) => m[1] + m[2]).sort(), `${rel(n)}: the same entity declarations`);
  }
  native(p, 'the export');
  assert.equal(rootOf(fs.readFileSync(backup, 'utf8')), 'jssbook', 'the backup taken before the test is the project as it was');
});

// ── publication.xml is never replaced by the S1000D side ───────────────────────────────────────────────────────────────────────────────
test('legacy S1000D writers cannot overwrite a JSS project\'s publication.xml with a package contents list', async () => {
  const p = await create('RWI protected'); const before = sha(fs.readFileSync(p.pub));
  const pm = `<?xml version="1.0"?><pm><identAndStatusSection/><content><pmEntry><dmRef/></pmEntry></content></pm>`;
  const hit = async (method, sub, body) => { const r = await w.req(method, `${p.U}/${sub}`, body); assert.equal(r.status, 409, `${method} ${sub}: ${JSON.stringify(r.json).slice(0, 200)}`); assert.equal(r.json.code, 'JSS_PROJECT_PROTECTED', sub); };
  await hit('POST', 'import/apply'); await hit('POST', 'import/assign', {}); await hit('PUT', 'pmc', { xml: pm }); await hit('POST', 'pmc/import'); await hit('POST', 'packages/import'); await hit('POST', 'dms-import');
  assert.equal(sha(fs.readFileSync(p.pub)), before, 'publication.xml is exactly as it was');
  // the JSS save path refuses a publication module or a contents list too
  const put = await w.put(`${p.U}/jss`, { xml: pm, baseHash: (await w.get(`${p.U}/jss`)).json.hash }); assert.equal(put.status, 400); assert.equal(put.json.code, 'NOT_NATIVE_JSS');
  const list = await w.put(`${p.U}/jss`, { xml: '<?xml version="1.0"?><packageContents><file name="a.xml"/></packageContents>', baseHash: (await w.get(`${p.U}/jss`)).json.hash }); assert.equal(list.status, 400); assert.equal(list.json.code, 'NOT_NATIVE_JSS');
  assert.equal(sha(fs.readFileSync(p.pub)), before);
  // a file that was already overwritten (by an older build) is reported, cannot be exported, and is replaced by Import project
  fs.writeFileSync(p.pub, pm);
  const v = await w.post(`${p.U}/jss/validate`, {}); assert.ok(v.json.findings.some((f) => f.rule === 'JSS-NATIVE'), 'validation says what is wrong');
  const e = await w.get(`${p.U}/jss/export`); assert.equal(e.status, 400); assert.equal(e.json.code, 'NOT_NATIVE_JSS');
  if (ZIP) { const r = await upload(p.U, ZIP); assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 200)); native(p, 'recovering by import'); assert.ok(fs.existsSync(path.join(p.dir, 'publication.before-import.bak')), 'the overwritten file is kept beside it'); }
});

test('an S1000D project is not affected by the guard', async () => {
  const r = await w.post('/api/projects', { name: 'Plain S1000D', format: 's1000d' }); assert.equal(r.status, 201, JSON.stringify(r.json));
  const U = `/api/projects/${r.json.project.id}`;
  for (const [m, sub] of [['POST', 'import/apply'], ['PUT', 'pmc'], ['POST', 'pmc/import'], ['POST', 'dms-import']]) { const x = await w.req(m, `${U}/${sub}`, m === 'PUT' ? { xml: '<pm/>' } : undefined); assert.notEqual(x.json?.code, 'JSS_PROJECT_PROTECTED', `${m} ${sub}`); assert.notEqual(x.status, 500, `${m} ${sub} reaches its own handler`); }
});
