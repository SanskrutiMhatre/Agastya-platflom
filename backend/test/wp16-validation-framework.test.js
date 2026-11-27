'use strict';
// WP-16: one validation framework and shared helpers.
//   - lib/xml and lib/hash: the helpers every service used to copy (PUB-028, S1K-007), with their behaviour pinned
//   - one definition each: no copied escaper, hash or attribute reader is left (the ARC-007 / PUB-028 duplicate scan), and the XSD-pattern
//     translator and the BREX value forms have ONE source the backend compiles and the Studio imports (S1K-003, ARC-008)
//   - the validation framework: finding model, rule sets per standard, runner (each rule set a turn of its own)
//   - publish checks are registered per format; the gate has no JSS branch (S1K-006)
//   - a waiver recorded with the BREX's file name is honoured; a mere suffix no longer matches (S1K-002)
//   - every route that can write publication.xml refuses a JSS document project with 409 and leaves the file unchanged, and the writers refuse
//     by themselves, not only through the route guard (PUB-022, ARC-018)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(__dirname, '..', 'src');
let h; let w;

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '__tests__') walk(f, out); } else if (/\.tsx?$/.test(e.name)) out.push(f);
  }
  return out;
};
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');

test.before(async () => {
  h = await boot();
  const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' });
  const m = await admin.post('/api/team/users', { username: 'wes', fullName: 'Wes', role: 'author' });
  w = new h.Client('wes');
  await w.post('/api/auth/login', { username: 'wes', password: m.json.tempPassword });
  await w.post('/api/auth/onboarding', { username: 'wes', password: PW });
});
test.after(async () => { await h.close(); });

test('lib/xml and lib/hash: text and attribute escapes differ only by the quote; attributes and hashes as before', () => {
  const { escText, escAttr, readAttrs } = require('../dist/lib/xml');
  const { sha256, sha256File, sha256FileOr } = require('../dist/lib/hash');
  assert.equal(escText('a & b < c > "d" \'e\''), 'a &amp; b &lt; c &gt; "d" \'e\'');
  assert.equal(escAttr('a & b < c > "d" \'e\''), 'a &amp; b &lt; c &gt; &quot;d&quot; \'e\'');
  assert.equal(escText(undefined), ''); assert.equal(escAttr(null), ''); assert.equal(escText(42), '42');
  assert.equal(escText('&amp;'), '&amp;amp;', 'escaping is not idempotent: text is escaped once, by the writer');
  assert.deepEqual(readAttrs(' modelIdentCode="S1000D" xlink:href="a.xml" item-x.y = "1" single=\'no\''), { modelIdentCode: 'S1000D', 'xlink:href': 'a.xml', 'item-x.y': '1' });
  assert.deepEqual(readAttrs(''), {});
  const crypto = require('crypto');
  const want = crypto.createHash('sha256').update('héllo').digest('hex');
  assert.equal(sha256('héllo'), want); assert.equal(sha256(Buffer.from('héllo', 'utf8')), want);
  const f = path.join(h.ws, 'hash-probe.bin');
  const big = Buffer.alloc((1 << 20) * 2 + 17, 7);                      // crosses the 1 MB read blocks
  fs.writeFileSync(f, big);
  assert.equal(sha256File(f), crypto.createHash('sha256').update(big).digest('hex'));
  assert.equal(sha256FileOr(path.join(h.ws, 'nope.bin')), 'MISSING');
  assert.throws(() => sha256File(path.join(h.ws, 'nope.bin')));
  // the services that used to carry their own copies now hand out the shared ones
  assert.equal(require('../dist/services/csdbIndex').sha, sha256);
  assert.equal(require('../dist/services/jss/service').sha, sha256);
  assert.equal(require('../dist/services/jsg/service').sha, sha256);
  assert.equal(require('../dist/services/jss/service').esc, escText);
  assert.equal(require('../dist/services/importer/xmlScan').escapeAttr, escAttr);
  assert.equal(require('../dist/services/xmlHead').readAttrs, readAttrs);
});

test('duplicate scan: one definition each of the escaper, the hash helper, the attribute reader, the XSD translator and the BREX value forms', () => {
  const backend = walk(SRC).filter((f) => !/[\\/]lib[\\/]/.test(f));
  const frontend = walk(path.join(ROOT, 'frontend', 'src'));
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const hits = (files, re) => files.filter((f) => re.test(strip(fs.readFileSync(f, 'utf8')))).map(rel);
  // a definition that escapes & < > (the two serialisers that escape attributes without `>` are deliberately byte-preserving: see the log)
  assert.deepEqual(hits(backend, /=\s*\([^)]*\)[^=]*=>\s*(String\([^)]*\)|\w+)\.replace\(\/&\/g, '&amp;'\)\.replace\(\/<\/g, '&lt;'\)\.replace\(\/>\/g/), [], 'an XML escaper outside lib/xml.ts');
  assert.deepEqual(hits(backend, /function escape(Text|Attr)\b/), []);
  assert.deepEqual(hits(backend, /const (sha|sha256File) = \(/), [], 'a hash helper outside lib/hash.ts');
  assert.deepEqual(hits(backend, /\(\[\\w:\.-\]\+\)\\s\*=\\s\*"\(\[\^"\]\*\)"/), [], 'an attribute reader outside lib/xml.ts');
  const shared = path.join(SRC, 'shared');
  const outside = (files) => files.filter((f) => !f.startsWith(shared));
  assert.deepEqual(hits(outside([...walk(SRC), ...frontend]), /function translate\(p: string\)|export function xsdRegex\(/), [], 'the XSD-pattern translator outside backend/src/shared');
  assert.deepEqual(hits(outside([...walk(SRC), ...frontend]), /function (valueMatches|splitNum|contextApplies|isXPath2)\(/), [], 'a BREX value-form function outside backend/src/shared');
  assert.ok(!fs.existsSync(path.join(ROOT, 'frontend', 'src', 'studio', 'core', 'xsdRegex.ts')), 'the Studio copy is gone');
  // both runtimes import the one source
  const studioBrex = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'studio', 'validation', 'brex.ts'), 'utf8');
  assert.match(studioBrex, /from '\.\.\/\.\.\/\.\.\/\.\.\/backend\/src\/shared\/brexValues'/);
  assert.match(studioBrex, /from '\.\.\/\.\.\/\.\.\/\.\.\/backend\/src\/shared\/xsdRegex'/);
  const brex = require('../dist/services/brex');
  assert.equal(brex.valueMatches, require('../dist/shared/brexValues').valueMatches);
  assert.equal(brex.isXPath2, require('../dist/shared/brexValues').isXPath2);
  // the shared folder is plain TypeScript for both runtimes: no Node built-ins, no DOM, no imports from outside it
  for (const f of walk(shared)) {
    const t = fs.readFileSync(f, 'utf8');
    for (const m of t.matchAll(/from\s+'([^']+)'/g)) assert.match(m[1], /^\.\/[\w-]+$/, `${rel(f)} imports ${m[1]}`);
    assert.doesNotMatch(strip(t), /\b(require\(|process\.|document\.|window\.)/, `${rel(f)} uses a runtime-specific global`);
  }
});

test('validation framework: issues are normalised, rule sets run in order and in turns of their own, the S1000D rule sets are listed', async () => {
  const fw = require('../dist/services/validationFramework');
  const i = fw.issueOf('xsd', { sev: 'fatal', rel: 'csdb/DMC-A.xml', line: '0', message: 'bad' }, 'error');
  assert.equal(i.sev, 'error'); assert.equal(i.file, 'DMC-A.xml'); assert.equal(i.line, 1); assert.equal(i.detail, 'bad'); assert.equal(i.title, 'Problem'); assert.match(i.id, /^xsd-\d+$/);
  const order = []; let immediates = 0;
  const probe = setInterval(() => {}, 1000);
  const input = { projectId: 'p', dir: '.', csdb: 'csdb', media: 'Media', pm: 'publication.xml', issueUsed: 'auto', s1000d: true, brex: false };
  const mk = (id, applies) => ({ id, standard: 's1000d', applies, run: async () => { setImmediate(() => immediates++); const before = immediates; order.push([id, before]); return { issues: [fw.issueOf('pm', { sev: 'warn', title: id })], notes: [`${id} note`], checked: 1 }; } });
  const out = await fw.runRuleSets([mk('a'), mk('b', () => false), mk('c')], input);
  clearInterval(probe);
  assert.deepEqual(out.issues.map((x) => x.title), ['a', 'c']); assert.deepEqual(out.notes, ['a note', 'c note']); assert.deepEqual(out.checked, { a: 1, c: 1 });
  assert.ok(order[1][1] >= 1, 'the event loop had a turn between two rule sets');
  assert.deepEqual(fw.summarise([...out.issues, fw.issueOf('xml', { sev: 'error' })]), { error: 1, warn: 2, info: 0 });
  const v = require('../dist/services/validation');
  assert.deepEqual(v.S1000D_RULE_SETS.map((s) => s.id), ['applic', 'graphics', 'ids', 'icn', 'pm', 'brex']);
  const brexSet = v.S1000D_RULE_SETS.find((s) => s.id === 'brex');
  assert.equal(brexSet.applies({ ...input, brex: true }), true); assert.equal(brexSet.applies({ ...input, brex: false }), false); assert.equal(brexSet.applies({ ...input, brex: true, s1000d: false }), false);
});

test('publish checks: registered per format, the S1000D check is the default, publishGate.ts has no JSS branch', async () => {
  const checks = require('../dist/services/publishChecks');
  assert.deepEqual(checks.publishCheckFormats(), ['jsg', 'jss', 's1000d']);   // WP-15 (PUB-011): JSG is released through the same gate
  const gateSrc = fs.readFileSync(path.join(SRC, 'services', 'publishGate.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');   // code, not comments
  assert.doesNotMatch(gateSrc, /isJssAuthored|assertJssPublishable|jss\/service/);
  const s = (await w.post('/api/projects', { name: 'S1000D gate', pipeline: 's1000dtofo' })).json.project.id;
  const j = (await w.post('/api/projects', { name: 'JSS gate', format: 'jss', domain: 'land', manualType: 'uhb' })).json.project.id;
  assert.equal(checks.publishCheckFor(s).format, 's1000d');
  assert.equal(checks.publishCheckFor(j).format, 'jss');
  const gate = require('../dist/services/publishGate');
  const one = await gate.assertPublishable(j, { file: 'DMC-X.xml' }).catch((e) => e);
  assert.equal(one.status, 409); assert.equal(one.code, 'NOT_S1000D');
  // a new format plugs in without touching the gate
  checks.registerPublishCheck({ format: 'probe', owns: (id) => id === 'probe-project', check: async () => ({ validatedAt: 'now', files: ['x'], warnings: ['probe'], ruleBreaks: [], verifyUnchanged: () => {} }) });
  try { assert.deepEqual((await gate.assertPublishable('probe-project', 'publication')).warnings, ['probe']); }
  finally { checks.registerPublishCheck({ format: 'probe', owns: () => false, check: async () => { throw new Error('unused'); } }); }
});

test('waivers: the subject is normalised, so the BREX file name and the bare code are the same waiver; a suffix is not', async () => {
  const waivers = require('../dist/services/publishWaivers');
  assert.equal(waivers.waiverSubject('DMC-S1KSTUDIO-A-00-00-00-00A-022A-D_001-00_EN-US.XML'), 'DMC-S1KSTUDIO-A-00-00-00-00A-022A-D');
  assert.equal(waivers.waiverSubject(' dmc-s1kstudio-a-00-00-00-00a-022a-d.xml '), 'DMC-S1KSTUDIO-A-00-00-00-00A-022A-D');
  assert.equal(waivers.waiverSubject('DMC-S1KSTUDIO-A-00-00-00-00A-022A-D_001-00'), 'DMC-S1KSTUDIO-A-00-00-00-00A-022A-D');
  const id = (await w.post('/api/projects', { name: 'Waiver subjects', pipeline: 's1000dtofo' })).json.project.id;
  const U = `/api/projects/${id}/publish-waivers`;
  const made = await w.post(U, { kind: 'brex-missing', subject: 'DMC-S1KSTUDIO-A-00-00-00-00A-022A-D_001-00_EN-US.XML', reason: 'The customer BREX arrives with the next delivery.' });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.equal(made.json.waiver.subject, 'DMC-S1KSTUDIO-A-00-00-00-00A-022A-D', 'stored as the gate names it');
  assert.equal(waivers.waiverFor(id, 'brex-missing', 'DMC-S1KSTUDIO-A-00-00-00-00A-022A-D')?.id, made.json.waiver.id, 'the gate finds it by the bare code');
  assert.equal(waivers.waiverFor(id, 'brex-missing', 'S1KSTUDIO-A-00-00-00-00A-022A-D')?.id, made.json.waiver.id, 'and without the DMC- prefix');
  assert.equal(waivers.waiverFor(id, 'brex-missing', 'DMC-OTHER-A-00-00-00-00A-022A-D'), undefined, 'a different BREX is not covered');
  const suffix = await w.post(U, { kind: 'brex-missing', subject: '022A-D', reason: 'a suffix that used to match every BREX' });
  assert.equal(suffix.status, 201);
  assert.equal(waivers.waiverFor(id, 'brex-missing', 'DMC-OTHER-A-00-00-00-00A-022A-D'), undefined, 'a suffix no longer covers every BREX ending with it');
  // the same module named the other way replaces the waiver instead of adding a second one
  await w.post(U, { kind: 'brex-missing', subject: 'DMC-S1KSTUDIO-A-00-00-00-00A-022A-D', reason: 'Second reason, long enough to keep.' });
  const listed = (await w.get(U)).json.waivers.filter((x) => /S1KSTUDIO/.test(x.subject));
  assert.equal(listed.length, 1); assert.equal(listed[0].reason, 'Second reason, long enough to keep.');
  assert.equal((await w.post(U, { kind: 'brex-missing', subject: '../etc', reason: 'a perfectly good reason' })).status, 400);
});

test('JSS document project: every route that can write publication.xml answers 409 and the file is unchanged; the writers refuse by themselves', async () => {
  const card = (await w.post('/api/projects', { name: 'JSS protected', format: 'jss', domain: 'land', manualType: 'uhb' })).json.project;
  const id = card.id; const U = `/api/projects/${id}`;
  const pmAbs = path.join(h.ws, 'projects', id, 'publication.xml');
  const before = fs.readFileSync(pmAbs);
  assert.match(before.toString('utf8'), /<jssbook\b/);
  const PM = '<?xml version="1.0" encoding="UTF-8"?><pm><identAndStatusSection/><content><pmEntry><pmEntryTitle>X</pmEntryTitle></pmEntry></content></pm>';
  const upload = (name, text) => { const fd = new FormData(); fd.append('file', new Blob([text]), name); fd.append('files', new Blob([text]), name); return fd; };
  const routes = [
    ['PUT pmc', () => w.put(`${U}/pmc`, { meta: {}, entries: [{ type: 'folder', title: 'X', children: [] }] })],
    ['POST pmc/import', () => w.req('POST', `${U}/pmc/import`, upload('publication.xml', PM))],
    ['POST import/apply', () => w.req('POST', `${U}/import/apply`, upload('publication.xml', PM))],
    ['POST import/assign', () => w.post(`${U}/import/assign`, { files: [] })],
    ['POST packages/import', () => w.req('POST', `${U}/packages/import`, upload('pkg.zip', 'PK'))],
    ['POST dms-import', () => w.req('POST', `${U}/dms-import`, upload('DMC-X-A-00-00-00-00A-040A-D_001-00_EN-US.xml', '<dmodule/>'))],
    ['POST sns-rows/derive (apply)', () => w.post(`${U}/sns-rows/derive`, { apply: true, placement: 'replace' })],
    ['POST jssdm/generate (merge)', () => w.post(`${U}/jssdm/generate`, { pm: 'merge' })],
  ];
  for (const [name, call] of routes) {
    const r = await call();
    assert.equal(r.status, 409, `${name}: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
    assert.equal(r.json.code, 'JSS_PROJECT_PROTECTED', name);
    assert.ok(fs.readFileSync(pmAbs).equals(before), `${name}: publication.xml unchanged`);
  }
  // the writers themselves, below any route guard
  const writers = [
    ['pm.writePm', () => require('../dist/services/pm').writePm(id, { meta: {}, entries: [{ type: 'folder', title: 'X', children: [] }] }, true)],
    ['importer.applyImport', () => require('../dist/services/importer/apply').applyImport(id, [{ name: 'publication.xml', bytes: new TextEncoder().encode(PM) }], { publication: 'replace' }, { id: 'u', username: 'wes', role: 'author' }, 'owner')],
    ['sns.applyDerived', () => require('../dist/services/sns/service').applyDerived(id, { structure: { roots: [] }, absPm: pmAbs, pm: { placement: 'unplaced', xml: PM } })],
    ['projectRecord.assertS1000dPublication', () => require('../dist/services/projectRecord').assertS1000dPublication(id)],
  ];
  for (const [name, call] of writers) {
    const e = await Promise.resolve().then(call).then(() => null, (x) => x);
    assert.ok(e, `${name} refused`); assert.equal(e.status, 409, `${name}: ${e && e.message}`); assert.equal(e.code, 'JSS_PROJECT_PROTECTED', name);
    assert.ok(fs.readFileSync(pmAbs).equals(before), `${name}: publication.xml unchanged`);
  }
  // an S1000D project is not affected
  const s = (await w.post('/api/projects', { name: 'S1000D writer', pipeline: 's1000dtofo' })).json.project.id;
  assert.doesNotThrow(() => require('../dist/services/projectRecord').assertS1000dPublication(s));
});
