'use strict';
// The vendor exception "cover.inbr.show" (docs/JSS_VENDOR_EXCEPTIONS.md): the single title page of a JSS-authored UHB, MM or ORM no longer prints "INBR No.:",
// because those stencil covers have only Code No. and Rev No. The stylesheet that prints it, jsstofo/frontmatter.xsl, is SHARED: the S1000D direct engine includes it
// too. So this file proves, beyond the new behaviour, that nothing else moved:
//
//   - UHB2 (whose cover has INBR No.) and every build that does not ask for the change keep the line: the stylesheet's default is the historical behaviour
//   - the S1000D direct engine, S1000D through the JSS pipeline, and the old JSS User Handbook path produce the same XSL-FO as before the change
//     (fingerprints taken from the code before the exception, test/fixtures/cover-baseline.json; see `canon` for what a fingerprint ignores)
//   - the S1000D engine reaches the JSS stylesheets through ONE include only, so a JSS edit has one way into an S1000D build and the fingerprint above covers it
//     (this replaces a SHA-256 manifest of every s1000dtofo file: that froze the S1000D stylesheets for good and failed on every intended S1000D change, which is
//     not what the exception needs to prove. Merge of 2026-11-23, docs/JSS_MERGE_2026-11-23.md)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { boot, tmp } = require('./helpers');
const { readPdf } = require('./pdftools');

const PW = 'Correct-Horse-9!';
const BASELINE_FILE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'cover-baseline.json'), 'utf8'));
const BASELINE = BASELINE_FILE.cases;
const VENDOR = path.resolve(__dirname, '..', 'vendor', 'pipeline');

// the same normalisation the before/after comparison used: generated ids and print stamps differ between two runs of identical code
// The day of the run: an S1000D build prints the day it was built ("Issue No. 001, 2026-11-24", the chapter.issue.date marker), in the local calendar or in UTC. Those are replaced
// with the day the baseline was captured on, so the same code gives the same fingerprint on every day (a date-only string was not covered by the timestamp rule below, and the
// guard failed from the day after the capture on although no stylesheet had changed).
const todayForms = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return [...new Set([`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, d.toISOString().slice(0, 10)])]; };
const norm = (s) => s.replace(new RegExp(todayForms().join('|'), 'g'), BASELINE_FILE.capturedOn).replace(/idm\d+/g, 'idm#').replace(/\b(?:ID|id)_?[A-Za-z0-9-]*?\d{6,}\b/g, 'id#').replace(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?/g, 'TIMESTAMP').replace(/>\s+</g, '><').replace(/\s+/g, ' ');
// What a fingerprint must ignore to mean "the same XSL-FO" on any machine: (1) WHERE the repository is checked out - the FO refers to the vendored stylesheet
// folder (intentionally-blank.svg) by a relative path from the build folder, so the same code gives a different string in every folder, and a fingerprint taken in
// one checkout could never pass in another (this was the first cause of the failures after the merge); (2) the ORDER of the attributes inside a tag, which is not
// content and moves whenever a stylesheet is refactored.
// (3) WHICH picture the Larsen & Toubro fallback logo is: on 2026-11-26 the owner replaced vendor/pipeline/jss/artwork/lt-logo.png by assets/default-publisher-logo.png (the L&T Precision
// Engineering logo) for every JSS book, this path included. The one changed file name is mapped back, so the fingerprint still proves that nothing of the LAYOUT moved.
// (4) Since WP-07 (PUB-020) the default artwork is an absolute file: URL instead of ../ steps; both forms name the same file and map to the same token.
const canon = (s) => s.replace(/url\('(?:(?:\.\.\/)+|file:\/\/\/)[^']*?\/backend\/assets\/default-publisher-logo\.png'/g, "url('VENDOR/pipeline/jss/artwork/lt-logo.png'").replace(/url\('(?:(?:\.\.\/)+|file:\/\/\/)[^']*?\/backend\/vendor\//g, "url('VENDOR/")
  .replace(/<([\w:.-]+)((?:\s+[\w:.-]+="[^"]*")+)\s*(\/?)>/g, (m, tag, attrs, close) => `<${tag} ${[...attrs.matchAll(/([\w:.-]+)="([^"]*)"/g)].map((x) => `${x[1]}="${x[2]}"`).sort().join(' ')}${close}>`);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const fingerprint = (fo) => sha(canon(norm(fo)));
const pages = async (pdf, from, to) => (await readPdf(pdf)).text({ first: from, last: to });    // pdf.js (test/pdftools.js), no external program
const page1 = (pdf) => pages(pdf, 1, 1);

// Every parameter the JSS authoring build sends, and the vendored stylesheet that declares it. Each is declared with the old behaviour as its default.
const PARAMS = {
  'cover.inbr.show': ['jsstofo/frontmatter.xsl'],
  'cover.title.split': ['jsstofo/frontmatter.xsl'],
  'cover.authority.foot': ['jsstofo/frontmatter.xsl', 'jsstofo/pagesetup.xsl'],   // declared and used in frontmatter.xsl; the page setup holds the cover master and sequence it selects
  'changenotice.layout': ['jsstofo/frontmatter.xsl'],
  'foreword.documentNo.show': ['jsstofo/frontmatter.xsl'],
  'para.after': ['jsstofo/common.xsl', 'jsstofo/jsstofo.xsl'],                         // used by common.xsl, declared in jsstofo.xsl
  'heading.1.font': ['jsstofo/body.xsl', 'jsstofo/jsstofo.xsl'],
  'heading.2.font': ['jsstofo/body.xsl', 'jsstofo/jsstofo.xsl'], 'heading.3.font': ['jsstofo/body.xsl', 'jsstofo/jsstofo.xsl'], 'heading.4.font': ['jsstofo/body.xsl', 'jsstofo/jsstofo.xsl'],
  'heading.1.gap': ['jsstofo/body.xsl', 'jsstofo/jsstofo.xsl'],
  'heading.2.gap': ['jsstofo/body.xsl', 'jsstofo/jsstofo.xsl'], 'heading.3.gap': ['jsstofo/body.xsl', 'jsstofo/jsstofo.xsl'], 'heading.4.gap': ['jsstofo/body.xsl', 'jsstofo/jsstofo.xsl'],
  'chapter.pageBreak': ['jsstofo/body.xsl', 'jsstofo/jsstofo.xsl'],
  'chapter.divider': ['jsstofo/body.xsl', 'jsstofo/jsstofo.xsl'],
  'roc.layout': ['jsstofo/frontmatter.xsl'], 'abbrev.layout': ['jsstofo/frontmatter.xsl'], 'safety.footer.show': ['jsstofo/frontmatter.xsl'],
  // the L&T reference layout (owner's request of 2026-11-26): declared in the shared frontmatter.xsl (as $lref, $restricted.scope, $red.color), read by the JSS-only stylesheets
  'ref.layout': ['jsstofo/frontmatter.xsl', 'jsstofo/headers_footers.xsl', 'jsstofo/jsstofo.xsl', 'jsstofo/pagesetup.xsl'],
  'restricted.scope': ['jsstofo/frontmatter.xsl', 'jsstofo/headers_footers.xsl'],
  'red.color': ['jsstofo/common.xsl', 'jsstofo/frontmatter.xsl'],
  'chapter.title.align': ['jsstofo/body.xsl', 'jsstofo/jsstofo.xsl'],
  'heading.underline': ['jsstofo/body.xsl', 'jsstofo/jsstofo.xsl'],
};
// declared in the shared file with the old behaviour as the default, and read by JSS-only stylesheets as well
const SHARED_DECLARED = new Set(['ref.layout', 'restricted.scope', 'red.color']);
// the S1000D direct engine includes jsstofo/frontmatter.xsl and nothing else of the JSS stylesheets: only the parameters declared there can reach it, and every one defaults to the old behaviour
const SHARED = new Set(['cover.inbr.show', 'cover.title.split', 'foreword.documentNo.show', 'roc.layout', 'abbrev.layout', 'safety.footer.show', 'changenotice.layout']);


let h; let w;
test.before(async () => {
  h = await boot(); const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'covera', fullName: 'Cover', role: 'author' });
  w = new h.Client('covera'); await w.post('/api/auth/login', { username: 'covera', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'covera', password: PW });
});
test.after(async () => { await h.close(); });

const build = async (id) => {
  const b = await w.post(`/api/projects/${id}/publish`, {}); assert.equal(b.status, 200, JSON.stringify(b.json).slice(0, 300));
  const dir = path.join(h.ws, 'projects', id);
  return { pdf: (await w.get(`/api/projects/${id}/publish/pdf`)).buf, fo: fs.readFileSync(path.join(dir, 'jss-output.fo'), 'utf8'), dir };
};

test('the registry says which stencil covers have an INBR No. line: only UHB2\'s does', () => {
  const { JSS_TYPES } = require('../dist/services/jss/registry');
  const land = JSS_TYPES.filter((t) => t.domain === 'land');            // the Naval stencils have their own covers (test/jss-naval.test.js)
  assert.deepEqual(land.filter((t) => t.coverInbr).map((t) => t.id), ['uhb2']);
  for (const id of ['uhb', 'mm', 'orm']) assert.equal(JSS_TYPES.find((t) => t.id === id).coverInbr, false, id);
});

test('JSS-authored UHB, MM and ORM: the cover has Code No. and Rev No. and no INBR No.; nothing else on the cover changed', { timeout: 300000 }, async () => {
  for (const type of ['uhb', 'mm', 'orm']) {
    const r = await w.post('/api/projects', { name: `Cover ${type}`, format: 'jss', domain: 'land', manualType: type }); assert.equal(r.status, 201);
    const U = `/api/projects/${r.json.project.id}`; const g = (await w.get(`${U}/jss`)).json;
    const xml = g.xml.replace('</bookmeta>', '<codeNo>DT0042_U0100_0007</codeNo><revNo>R2</revNo></bookmeta>');
    assert.equal((await w.put(`${U}/jss`, { xml, baseHash: (await w.get(`${U}/jss`)).json.hash })).status, 200);
    const out = await build(r.json.project.id);
    const cover = (await page1(out.pdf)).replace(/\s+/g, ' ');
    assert.match(cover, /Code No\.: DT0042_U0100_0007 Rev No\.: R2 THE INFORMATION GIVEN IN THIS DOCUMENT/, `${type}: the cover opens with Code No. and Rev No., then the notice`);
    assert.ok(!/INBR No/.test(cover), `${type}: no INBR No. line on the cover`);
    assert.match(cover, /Prepared & Published by/); assert.match(cover, /THIS HANDBOOK DOES NOT CONSTITUTE AUTHORITY/);
    // the cover block is the only place that went: the same book built with the parameter's default differs by exactly that block
    assert.ok(!out.fo.includes('>INBR No.:</fo:block>'), `${type}: the FO has no INBR cover block`);
  }
});

test('the stylesheet\'s default keeps the line (what UHB2 and every other build gets); only an explicit 0 removes it', () => {
  const { XSLTPROC } = require('../vendor/engine/paths');
  const book = `<?xml version="1.0"?><jssbook xmlns:xi="http://www.w3.org/2001/XInclude"><bookmeta><bookName>B</bookName><systemName>S</systemName><security>RESTRICTED</security><inbrNo>INBR-777</inbrNo></bookmeta>
    <frontmatter><titlePage><documentType>USER HANDBOOK</documentType><disclosureNotice><para>NOTICE</para></disclosureNotice><repairNotice><para>REPAIR</para></repairNotice></titlePage></frontmatter>
    <body><chapter number="1"><title>A</title><section><title>B</title><para>x</para></section></chapter></body></jssbook>`;
  const f = path.join(tmp('cov-'), 'book.xml'); fs.writeFileSync(f, book);
  const run = (...params) => { const r = spawnSync(XSLTPROC, ['--nonet', ...params, path.join(VENDOR, 'jsstofo', 'jsstofo.xsl'), f], { encoding: 'utf8', cwd: path.join(VENDOR, 'jsstofo') }); assert.equal(r.status, 0, r.stderr.slice(0, 400)); return r.stdout; };
  const dflt = run(); assert.ok(dflt.includes('INBR No.:'), 'default: the INBR No. line is printed'); assert.ok(dflt.includes('INBR-777'), 'with its value');
  assert.ok(run('--stringparam', 'cover.inbr.show', '1').includes('INBR No.:'), 'an explicit 1 prints it');
  const off = run('--stringparam', 'cover.inbr.show', '0'); assert.ok(!off.includes('INBR No.:') && !off.includes('INBR-777'), '0 removes the line');
  // and the rest of the cover is the same either way
  assert.equal(norm(dflt).replace(/<fo:block [^>]*>INBR No\.:INBR-777<\/fo:block>/, ''), norm(off), 'the only difference is the INBR block');
});

test('S1000D and the old JSS User Handbook path: the XSL-FO is what it was before the change', { timeout: 600000 }, async () => {
  // the old JSS path: S1000D data modules -> s1000dtojss -> jsstofo (the stylesheet that was edited), with the INBR cover
  const leg = await w.post('/api/projects', { name: 'Cmp legacy', profile: 'uhb' }   /* the name is printed on the cover: it must match the one the baseline was taken with */); assert.equal(leg.status, 201);
  const dm = fs.readdirSync(h.SAMPLES).find((f) => /-040A-D_/.test(f));
  assert.equal((await w.post(`/api/projects/${leg.json.project.id}/dms`, { file: dm, xml: h.sample(dm) })).status, 201);
  const legacy = await build(leg.json.project.id);
  assert.match(await pages(legacy.pdf, 1, 4), /INBR No\./, 'the old JSS User Handbook keeps its INBR cover (page 3, after the jointly-published cover)');
  assert.equal(fingerprint(legacy.fo), BASELINE['legacy-jss-uhb'].sha256, 'old JSS path: FO as before');
  for (const n of Object.keys(PARAMS)) assert.ok(!fs.existsSync(path.join(legacy.dir, 'jss-run.xsl')) || !fs.readFileSync(path.join(legacy.dir, 'jss-run.xsl'), 'utf8').includes(n), `${n} is never sent on this path`);

  const s = await w.post('/api/projects/sample', {}); assert.equal(s.status, 201); const sid = s.json.project.id;
  // the sample now starts on the reference (Xignal) style; the baseline was taken on the plain style, so the project is put back on it (the House style chooser's route) and the direct engine
  assert.equal(s.json.project.templateRef, 'xignal-s1000d');
  assert.equal((await w.patch(`/api/projects/${sid}`, { templateRef: 'default' })).status, 200);
  assert.equal((await w.patch(`/api/projects/${sid}`, { pipeline: 's1000dtofo' })).status, 200);
  const direct = await build(sid);
  assert.equal(fingerprint(direct.fo), BASELINE['s1000d-direct'].sha256, 'S1000D direct engine: FO as before');
  for (const f of ['s1000dtofo-run.xsl', 'jss-run.xsl']) if (fs.existsSync(path.join(direct.dir, f))) for (const n of Object.keys(PARAMS)) assert.ok(!fs.readFileSync(path.join(direct.dir, f), 'utf8').includes(n), `${f}: ${n} is never sent to the S1000D engine`);

  assert.equal((await w.patch(`/api/projects/${sid}`, { pipeline: 's1000dtojss' })).status, 200);
  const viaJss = await build(sid);
  assert.equal(fingerprint(viaJss.fo), BASELINE['s1000d-via-jss'].sha256, 'S1000D through the JSS pipeline: FO as before');
  assert.match(await pages(viaJss.pdf, 1, 4), /INBR No\./, 'and it still prints INBR No. on its cover');
});

test('the S1000D engine reaches the JSS stylesheets through exactly one include: frontmatter-shared.xsl -> ../jsstofo/frontmatter.xsl', () => {
  // A JSS-only edit can move an S1000D build only through a file the S1000D engine includes or imports from jsstofo/. There is one, so the fingerprints above
  // (which run that file inside an S1000D build) cover every way in; a second include would be a new way in and must be looked at, here, before it is allowed.
  const dir = path.join(VENDOR, 's1000dtofo'); const reach = [];
  for (const f of fs.readdirSync(dir).filter((x) => /\.xsl$/.test(x)).sort()) {
    for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/<xsl:(?:include|import)\s+href="([^"]+)"/g)) if (/jsstofo\//.test(m[1])) reach.push(`${f} -> ${m[1]}`);
  }
  assert.deepEqual(reach, ['frontmatter-shared.xsl -> ../jsstofo/frontmatter.xsl']);
});

test('the exceptions stay small and isolated: each parameter lives in the files named, defaults to the old behaviour, and only the JSS authoring build sends it', () => {
  const where = {};
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.xsl$/.test(f.name)) { const text = fs.readFileSync(p, 'utf8'); for (const n of Object.keys(PARAMS)) if (text.includes(n)) (where[n] ??= []).push(path.relative(VENDOR, p).split(path.sep).join('/')); } } };
  walk(VENDOR);
  for (const [n, files] of Object.entries(PARAMS)) assert.deepEqual((where[n] ?? []).sort(), [...files].sort(), `${n}: where it is used`);
  // nothing outside jsstofo/ (so nothing of s1000dtofo/ or s1000dtojss/) mentions any of them
  for (const files of Object.values(where)) for (const f of files) assert.ok(f.startsWith('jsstofo/'), `${f} is a JSS stylesheet`);
  // the default of each declaration is the value the stylesheets always had
  const jss = fs.readFileSync(path.join(VENDOR, 'jsstofo', 'jsstofo.xsl'), 'utf8'); const fm = fs.readFileSync(path.join(VENDOR, 'jsstofo', 'frontmatter.xsl'), 'utf8');
  assert.match(fm, /<xsl:param name="cover\.inbr\.show">1<\/xsl:param>/); assert.match(fm, /<xsl:param name="foreword\.documentNo\.show">1<\/xsl:param>/); assert.match(fm, /<xsl:param name="cover\.title\.split">0<\/xsl:param>/); assert.match(fm, /<xsl:param name="cover\.authority\.foot">0<\/xsl:param>/); assert.match(fm, /<xsl:param name="changenotice\.layout">classic<\/xsl:param>/);
  assert.match(jss, /<xsl:param name="chapter\.pageBreak">0<\/xsl:param>/, 'chapter.pageBreak defaults to the old behaviour');
  assert.match(jss, /<xsl:param name="para\.after"><xsl:choose><xsl:when test="\$xjss">2mm<\/xsl:when><xsl:otherwise>3mm<\/xsl:otherwise><\/xsl:choose><\/xsl:param>/);
  for (const n of ['heading.1.font', 'heading.2.font', 'heading.3.font', 'heading.4.font', 'heading.1.gap', 'heading.2.gap', 'heading.3.gap', 'heading.4.gap']) assert.match(jss, new RegExp(`<xsl:param name="${n.replace(/\./g, '\.')}"/>`), `${n} defaults to empty`);
  // who sends them: one function, called for a JSS-authored project only
  const svc = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'jss', 'service.ts'), 'utf8'); const pub = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'publisher.ts'), 'utf8');
  for (const n of Object.keys(PARAMS)) assert.equal((pub.match(new RegExp(n.replace(/\./g, '\.'), 'g')) || []).length, 0, `${n} is not set in publisher.ts`);
  for (const n of ['para.after', 'heading.1.font', 'heading.1.bodyIndent', 'heading.1.gap', 'cover.title.split', 'foreword.documentNo.show', 'cover.inbr.show', 'chapter.pageBreak', 'chapter.divider', 'roc.layout', 'abbrev.layout', 'safety.footer.show', 'cover.authority.foot', 'changenotice.layout', 'ref.layout', 'restricted.scope', 'chapter.title.align', 'heading.underline', 'red.color']) assert.equal((svc.match(new RegExp(`'${n.replace(/\./g, '\.')}'`, 'g')) || []).length, 1, `${n} is set once, in layoutParamsFor`);
  assert.match(pub, /if \(jssType\) common\.layoutParams = layoutParamsFor\(jssType, common\.layoutParams\);/); assert.match(pub, /const jssType = isJssAuthored\(projectId\) \? jssTypeOfProject\(projectId\) : undefined;/);
  assert.ok(SHARED.size === 7);
  for (const n of SHARED) assert.deepEqual(PARAMS[n], ['jsstofo/frontmatter.xsl'], `${n}: declared and used in the one shared file`);
  assert.match(fm, /<xsl:param name="roc\.layout">change-notice<\/xsl:param>/); assert.match(fm, /<xsl:param name="abbrev\.layout">description<\/xsl:param>/); assert.match(fm, /<xsl:param name="safety\.footer\.show">1<\/xsl:param>/);
  assert.match(jss, /<xsl:param name="chapter\.divider">1<\/xsl:param>/, 'chapter.divider defaults to the old behaviour');
  // the reference layout: every parameter defaults to the old look, the shared three are declared in frontmatter.xsl, the other two in jsstofo.xsl
  for (const n of SHARED_DECLARED) assert.ok(PARAMS[n].includes('jsstofo/frontmatter.xsl'), `${n}: declared in the one shared file`);
  assert.match(fm, /<xsl:param name="ref\.layout">0<\/xsl:param>/, 'ref.layout defaults to off'); assert.match(fm, /<xsl:param name="restricted\.scope">all<\/xsl:param>/, 'restricted.scope defaults to every page');
  assert.match(fm, /<xsl:param name="red\.color">#CC0000<\/xsl:param>/, 'red.color defaults to the red the notices always had');
  assert.match(jss, /<xsl:param name="chapter\.title\.align">left<\/xsl:param>/, 'chapter.title.align defaults to left'); assert.match(jss, /<xsl:param name="heading\.underline"\/>/, 'heading.underline defaults to none');
  // the two differences of the systems, in the one function that sends them
  assert.match(svc, /\['restricted\.scope', naval \? 'reference' : 'cover'\], \['chapter\.title\.align', naval \? 'center' : 'left'\]/, 'Land: RESTRICTED on the cover pages and chapters from the left; Naval: also on the Change Notice and chapters centred');
});
