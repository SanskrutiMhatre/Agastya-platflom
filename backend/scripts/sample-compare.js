'use strict';
// Real-project round trip and comparison (Phase 18).
//   node scripts/sample-compare.js <name> <package.zip | folder> <reference.pdf> <outDir> [--allow-standin-brex] [--skip-refused] [--scale-build]
// 1. COPIES the package (the original is never opened for writing; a folder is zipped into a copy first).
// 2. Imports it through the real validating importer into a throwaway workspace (no skipChecks), validates XSD + BREX + PM + graphics,
//    runs the findings, builds the PDF (with the publication gate) and the static HTML.
// 3. Compares our PDF with the reference PDF: content, data module order, table of contents, graphics, pagination, blank pages, layout.
// Everything measured is written to <outDir>/report.json and <outDir>/report.md (a readable rendering of the same data); nothing is claimed that is not in them.
// Needs poppler (pdftotext, pdfinfo, pdfimages, pdffonts, pdftoppm). Run on Linux (the Windows build has no xmllint for the BREX/XSD checks).
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const [name, src, refPdf, outDir] = process.argv.slice(2); const STANDIN = process.argv.includes('--allow-standin-brex'); const SKIP_REFUSED = process.argv.includes('--skip-refused'); const SCALE = process.argv.includes('--scale-build');
if (!name || !src || !refPdf || !outDir) { console.error('usage: node scripts/sample-compare.js <name> <package.zip|folder> <reference.pdf> <outDir> [--allow-standin-brex] [--skip-refused]'); process.exit(2); }
const { boot } = require('../test/helpers'); const Z = require('../dist/services/zipio');
const PW = 'Correct-Horse-9!';
const FIX42 = path.resolve(__dirname, '..', '..', 'frontend', 'e2e', 'fixtures', 'dm21', '4-2');
let standInFile = null;
const T0 = Date.now(); const stage = (m) => console.log(`[stage +${Math.round((Date.now() - T0) / 1000)}s] ${m}`);
const retry = async (fn) => { try { return await fn(); } catch (e) { if (/fetch failed/.test(String(e && e.message))) return fn(); throw e; } };
const R = { name, startedAt: new Date().toISOString(), deviations: [], notes: [] };
const sh = (cmd, args, opt = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 30, ...opt });
const flat = (s) => s.toLowerCase().replace(/[\s­-]+/g, '');
const pagesOf = (pdf) => sh('pdftotext', ['-raw', pdf, '-']).stdout.split('\f').slice(0, -1);
// fonts and page sizes are surveyed on the first pages only (reading every page of a 215 MB PDF takes tens of minutes); the report says so
const SURVEY_PAGES = 120;
const words = (s) => (s.toLowerCase().match(/[a-z][a-z0-9]{4,}/g) ?? []);

(async () => {
  fs.mkdirSync(outDir, { recursive: true }); const work = fs.mkdtempSync(path.join(process.env.SAMPLE_WORK ?? os.tmpdir(), 'sample-'));
  // ── 1. a COPY of the package ────────────────────────────────────────────────
  const zip = path.join(work, 'package-copy.zip');
  if (fs.statSync(src).isDirectory()) {
    const w = new Z.ZipStreamWriter(fs.createWriteStream(zip));
    for (const f of fs.readdirSync(src)) { const p = path.join(src, f); if (fs.statSync(p).isFile()) await w.addFile(f, p, { store: /\.(png|jpe?g)$/i.test(f) }); }
    await w.finish(); R.notes.push('The folder was zipped into a copy first; the original folder was only read.');
  } else fs.copyFileSync(src, zip);
  R.package = { source: path.basename(src), bytes: fs.statSync(zip).size };
  const refStat = fs.statSync(refPdf); R.reference = { file: path.basename(refPdf), bytes: refStat.size };

  // ── 2. import, validate, build ──────────────────────────────────────────────
  const h = await boot(); const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' });
  const made = await admin.post('/api/team/users', { username: 'ref', fullName: 'Ref Author', role: 'author' });
  const w = new h.Client('ref'); await w.post('/api/auth/login', { username: 'ref', password: made.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'ref', password: PW });
  const pid = (await w.post('/api/projects', { name: `${name} (temporary copy)`, pipeline: 's1000dtofo' })).json.project.id; const U = `/api/projects/${pid}`;
  const upload = async (extra) => { const fd = new FormData(); fd.append('file', await fs.openAsBlob(zip), 'package.zip'); for (const [k, v] of Object.entries(extra)) fd.append(k, v); return w.req('POST', `${U}/packages/import`, fd); };
  let t = Date.now(); let imp = await upload({ replacePm: '1' });   // a new project already holds an empty default publication module; the package's own PM must replace it
  R.import = { strict: { status: imp.status, ms: Date.now() - t, counts: imp.json?.counts, applied: imp.json?.applied } };
  if (!imp.json?.applied) {
    R.import.strictRejected = (imp.json?.items ?? []).filter((i) => i.status !== 'accepted' && i.status !== 'unchanged').slice(0, 40).map((i) => `${i.path}: ${i.status} - ${String(i.message).slice(0, 220)}`);
    R.deviations.push('The strict import (everything must pass the per-file checks) did not apply; it was repeated with partial=1 so the accepted files could be examined. Rejected files are listed under import.strictRejected.');
    t = Date.now(); imp = await upload({ partial: '1', replacePm: '1' });
    R.import.partial = { status: imp.status, ms: Date.now() - t, counts: imp.json?.counts, applied: imp.json?.applied };
  }
  R.import.rejectedFinal = (imp.json?.items ?? []).filter((i) => i.status === 'rejected' || i.status === 'skipped').slice(0, 40).map((i) => `${i.path}: ${i.status} - ${String(i.message).slice(0, 220)}`);

  stage('imported');
  const dmList = (await w.get(`${U}/dms`)).json.dms ?? []; R.project = { dataModules: dmList.length };
  stage('validating');
  t = Date.now(); const val = (await w.post(`${U}/validation`, { brex: true })).json.run;
  const tally = (arr, f) => arr.reduce((a, x) => { const k = f(x); a[k] = (a[k] ?? 0) + 1; return a; }, {});
  R.validation = { ms: Date.now() - t, summary: val.summary, schemaChecked: val.schemaChecked, brexChecked: val.brexChecked, unchecked: val.unchecked.length, bySourceSeverity: tally(val.issues, (i) => `${i.source}/${i.sev}`), errorKinds: tally(val.issues.filter((i) => i.sev === 'error' || i.sev === 'crit'), (i) => `${i.source}: ${String(i.title ?? '').slice(0, 90)}`), firstErrors: val.issues.filter((i) => i.sev === 'error' || i.sev === 'crit').slice(0, 15).map((i) => `${i.rel}: ${String(i.title ?? '').slice(0, 160)}`), notes: (val.notes ?? []).slice(0, 10) };
  const fnd = (await w.get(`${U}/findings?run=1`)).json; R.findings = { counts: fnd.counts, byRule: tally(fnd.findings ?? [], (f) => `${f.severity}:${f.rule}`) };
  const as = (await w.get(`${U}/assets`)).json; R.graphics = { assets: (as.assets ?? []).length, findings: tally(as.findings ?? [], (f) => `${f.severity}:${f.code}`) };

  stage('validated; building');
  const ours = path.join(outDir, 'ours.pdf');
  const build = async () => { t = Date.now(); const b = await retry(() => w.post(`${U}/publish`, {})); return { status: b.status, ms: Date.now() - t, body: b.status === 200 ? undefined : JSON.stringify(b.json).slice(0, 700), code: b.json?.code, refused: (b.json?.findings ?? []).map((f) => ({ file: f.file, kind: f.kind, title: f.title, detail: String(f.detail ?? '').slice(0, 200) })) }; };
  let b = await build();
  if (b.status !== 200 && STANDIN && /BREX/i.test(`${b.body}`)) {
    const fixBrex = fs.readdirSync(FIX42).find((f) => /-022A-D_/.test(f));
    // the BREX the DATA MODULES name (most often) that the package does not contain
    const dir = path.join(h.ws, 'projects', pid, 'csdb'); const have = new Set(fs.readdirSync(dir).map((f) => f.toUpperCase()));
    const count = new Map();
    for (const f of fs.readdirSync(dir).filter((x) => /^DMC-.*\.xml$/i.test(x))) { const m = /<brexDmRef>[\s\S]*?<dmCode ([^>]*?)\/>/.exec(fs.readFileSync(path.join(dir, f), 'utf8').slice(0, 6000)); if (m) count.set(m[1], (count.get(m[1]) ?? 0) + 1); }
    const named = [...count.entries()].sort((x, y) => y[1] - x[1]).map(([attrs]) => ({ attrs, a: Object.fromEntries([...attrs.matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], x[2]])) }))
      .map((x) => ({ ...x, file: `DMC-${[x.a.modelIdentCode, x.a.systemDiffCode, x.a.systemCode, x.a.subSystemCode + x.a.subSubSystemCode, x.a.assyCode, x.a.disassyCode + x.a.disassyCodeVariant, x.a.infoCode + x.a.infoCodeVariant, x.a.itemLocationCode].join('-')}_001-00_EN-IN.xml` }))
      .find((x) => ![...have].some((h2) => h2.startsWith(x.file.split('_')[0].toUpperCase())));
    if (named) {
      const bx = fs.readFileSync(path.join(FIX42, fixBrex), 'utf8').replace(/<dmCode [^>]*infoCode="022"[^>]*\/>/, `<dmCode ${named.attrs}/>`).replace('countryIsoCode="US"', 'countryIsoCode="IN"');
      const put = await w.post(`${U}/dms`, { file: named.file, xml: bx }); standInFile = named.file;
      R.deviations.push(`The data modules name a project BREX (${named.file}) that is not in the package; the gate refused the build (${String(b.body).slice(0, 200)}). A stand-in BREX with that code (the platform's 4.2 test BREX, no project rules of its own) was added to the COPY (HTTP ${put.status}) so the build could run. The original package is unchanged.`);
      b = await build();
    }
  }
  // The gate may refuse data modules that really break the schema or the BREX. They are never "fixed": with --skip-refused each is LEFT OUT of this
  // temporary copy (the precedent of Phase 16), listed in full with the rule it broke, and the build is repeated. The original package is untouched.
  R.refusedByGate = [];
  for (let round = 0; SKIP_REFUSED && b.status === 422 && b.refused?.length && round < 6; round++) {
    const files = [...new Set(b.refused.map((f) => f.file).filter((f) => /^DMC-/i.test(f)))];
    if (!files.length) break;
    for (const f of files) { const d = await w.del(`${U}/dms/${encodeURIComponent(f)}`); R.refusedByGate.push({ file: f, round: round + 1, removed: d.status, why: b.refused.filter((x) => x.file === f).map((x) => `${x.kind}: ${x.title}${x.detail ? ' - ' + x.detail : ''}`).slice(0, 3) }); }
    b = await build();
  }
  if (R.refusedByGate.length) R.deviations.push(`${R.refusedByGate.length} data module(s) that the publication gate refused (schema or BREX breaches, listed under refusedByGate) were removed from the COPY so that the rest could be built and compared. Their publication entries were left as they are.`);
  if (standInFile) { const v2 = (await w.post(`${U}/validation`, { brex: true })).json.run; R.validationAfterStandIn = { summary: v2.summary, bySourceSeverity: tally(v2.issues, (i) => `${i.source}/${i.sev}`), errorKinds: tally(v2.issues.filter((i) => i.sev === 'error' || i.sev === 'crit'), (i) => `${i.source}: ${String(i.title ?? '').slice(0, 90)}`), unchecked: v2.unchecked.length }; }
  R.pdfBuild = b;
  if (b.status === 200) fs.writeFileSync(ours, (await retry(() => w.get(`${U}/publish/pdf`))).buf);
  stage('PDF done; building HTML');
  t = Date.now(); const hb = await w.post(`${U}/publish/html`, {});
  R.htmlBuild = { status: hb.status, ms: Date.now() - t, pages: hb.json?.pages, assets: hb.json?.assets, missing: hb.json?.missing, error: hb.status === 201 ? undefined : JSON.stringify(hb.json).slice(0, 400) };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const htmlTextOfZip = async (buf) => {
    const zf = path.join(work, `html-${Date.now()}.zip`); fs.writeFileSync(zf, buf); const zr = Z.ZipFileReader.open(zf); let text = '';
    for (const e of zr.entries) if (/\.html?$/i.test(e.name)) text += ' ' + (await zr.readBuffer(e)).toString('utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ');
    const files = zr.entries.filter((e) => /\.html?$/i.test(e.name)).length; zr.close(); fs.rmSync(zf, { force: true }); return { text, files };
  };
  let htmlText = '';
  if (hb.status === 201) {
    const zb = (await w.get(hb.json.zip)).buf; R.htmlBuild.zipBytes = zb?.length;
    const ht = await htmlTextOfZip(zb); htmlText = ht.text; R.htmlBuild.htmlFiles = ht.files;
  }

  // ── 3. the comparison ───────────────────────────────────────────────────────
  if (b.status === 200) {
    const pmXml = fs.readFileSync(path.join(h.ws, 'projects', pid, 'publication.xml'), 'utf8');
    stage('comparing: reading both PDFs');
    const refPages = pagesOf(refPdf); const ourPages = pagesOf(ours);
    const dmDir = path.join(h.ws, 'projects', pid, 'csdb');
    const allMods = fs.readdirSync(dmDir).filter((f) => /^DMC-.*\.xml$/i.test(f) && f !== standInFile).map((f) => {
      const xml = fs.readFileSync(path.join(dmDir, f), 'utf8'); const g = (re) => (re.exec(xml) || [])[1]?.replace(/\s+/g, ' ').trim() ?? '';
      const icns = [...new Set([...xml.matchAll(/infoEntityIdent="([^"]+)"/g)].map((x) => x[1]))];
      return { f, code: f.replace(/^DMC-/i, '').replace(/_.*$/, ''), tech: g(/<techName>([\s\S]*?)<\/techName>/), info: g(/<infoName>([\s\S]*?)<\/infoName>/), date: (/<issueDate year="(\d+)" month="(\d+)" day="(\d+)"/.exec(xml) || []).slice(1).join('-'), icns, words: [...new Set(words((xml.split('<content')[1] ?? '').replace(/<[^>]*>/g, ' ')))] };
    });
    const pmOrder = [...pmXml.matchAll(/<dmCode ([^>]*?)\/>/g)].map((m) => { const a = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], x[2]])); return [a.modelIdentCode, a.systemDiffCode, a.systemCode, a.subSystemCode + a.subSubSystemCode, a.assyCode, a.disassyCode + a.disassyCodeVariant, a.infoCode + a.infoCodeVariant, a.itemLocationCode].join('-'); }).filter((c) => allMods.some((m) => m.code === c));
    const uniqOrder = [...new Set(pmOrder)];
    // Everything below compares what the SUPPLIED publication module publishes. A package can hold data modules that no supplied PM references
    // (here the PM points to other publication modules with pmRef that are not in the package); those are reported, not compared.
    const inPm = new Set(uniqOrder);
    const mods = allMods.filter((m) => inPm.has(m.code));
    R.pmCoverage = {
      dataModulesInPackage: allMods.length, referencedBySuppliedPm: mods.length, notReferencedBySuppliedPm: allMods.length - mods.length,
      pmRefEntries: (pmXml.match(/<pmRef[ >]/g) ?? []).length,
      referencedPublicationModules: [...new Set([...pmXml.matchAll(/<pmCode ([^>]*?)\/>/g)].map((m) => { const a = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], x[2]])); return `${a.modelIdentCode}-${a.pmIssuer}-${a.pmNumber}-${a.pmVolume}`; }))].slice(0, 20),
    };

    stage('PDF text read; content/TOC/order');
    // content: every word of every data module
    const ourText = flat(ourPages.join(' ')); const refText = flat(refPages.join(' '));
    const miss = mods.flatMap((m) => m.words.filter((x) => !ourText.includes(x)).map((x) => `${m.code}: ${x}`));
    R.content = { dataModules: mods.length, words: mods.reduce((a, m) => a + m.words.length, 0), wordsMissingInOurs: miss.length, firstMissing: miss.slice(0, 15), wordsMissingInReference: mods.reduce((a, m) => a + m.words.filter((x) => !refText.includes(x)).length, 0) };

    if (htmlText) { const ht = flat(htmlText); const hm = mods.flatMap((m) => m.words.filter((x) => !ht.includes(x)).map((x) => `${m.code}: ${x}`)); R.htmlBuild.wordsMissing = hm.length; R.htmlBuild.firstMissing = hm.slice(0, 10); R.htmlBuild.titlesMissing = mods.filter((m) => m.tech && !ht.includes(flat(m.tech))).map((m) => m.code); }

    // table of contents: the leading pages that carry many data module codes
    for (const m of mods) { m.codeFlat = flat(m.code); m.techFlat = flat(m.tech); }
    const refFlat = refPages.map(flat); const ourFlat = ourPages.map(flat);        // one flattening per page, not one per module and page
    const codeHits = (fp) => mods.filter((m) => fp.includes(m.codeFlat)).length;
    const tocRange = (fps) => { let last = -1; for (let i = 0; i < Math.min(fps.length, Math.ceil(fps.length * 0.15) + 5); i++) if (codeHits(fps[i]) >= 5) last = i; return last; };
    const tocEnd = { ref: tocRange(refFlat), ours: tocRange(ourFlat) };
    const tocCodes = (fps, end) => new Set(mods.filter((m) => fps.slice(0, end + 1).some((p) => p.includes(m.codeFlat))).map((m) => m.code));
    const tc = { ref: tocCodes(refFlat, tocEnd.ref), ours: tocCodes(ourFlat, tocEnd.ours) };
    R.toc = { tocPagesReference: tocEnd.ref + 1, tocPagesOurs: tocEnd.ours + 1, codesInReferenceToc: tc.ref.size, codesInOurToc: tc.ours.size, inReferenceNotOurs: [...tc.ref].filter((c) => !tc.ours.has(c)).slice(0, 20), inOursNotReference: [...tc.ours].filter((c) => !tc.ref.has(c)).slice(0, 20) };

    // data module order: first body page (after the TOC) on which each module's title appears
    const bodyPage = (fps, end, m) => { if (!m.techFlat) return -1; for (let i = end + 1; i < fps.length; i++) if (fps[i].includes(m.techFlat)) return i; return -1; };
    const byCode = new Map(mods.map((m) => [m.code, m]));
    const order = (fps, end) => uniqOrder.map((c) => byCode.get(c)).map((m) => ({ code: m.code, page: bodyPage(fps, end, m) }));
    const invCount = (p) => { let n = 0; for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) if (p[i] > p[j]) n++; return n; };
    const inv = (seq) => invCount(seq.filter((x) => x.page >= 0).map((x) => x.page));
    const oo = order(ourFlat, tocEnd.ours); const ro = order(refFlat, tocEnd.ref);
    R.order = { publicationModules: uniqOrder.length, locatedInOurs: oo.filter((x) => x.page >= 0).length, locatedInReference: ro.filter((x) => x.page >= 0).length, inversionsVsPublicationOrderOurs: inv(oo), inversionsVsPublicationOrderReference: inv(ro), note: 'Title text may repeat (running headers), so a located page is the first body page carrying the title; inversions count pairs found in a different order than the publication module lists them.' };
    const common = uniqOrder.filter((c) => oo.find((x) => x.code === c)?.page >= 0 && ro.find((x) => x.code === c)?.page >= 0);
    const sameRel = common.map((c) => ({ c, o: oo.find((x) => x.code === c).page, r: ro.find((x) => x.code === c).page })).sort((a, b) => a.r - b.r).map((x) => x.o);
    const invBoth = invCount(sameRel);
    R.order.commonModules = common.length; R.order.pairsOrderedDifferentlyBetweenOursAndReference = invBoth;

    stage('order done; graphics');
    // graphics
    const imgs = (pdf) => { const r = sh('pdfimages', ['-list', pdf]).stdout.split('\n').slice(2).filter(Boolean); return { placed: r.length, distinct: new Set(r.map((l) => l.trim().split(/\s+/)[10])).size }; };
    const allIcns = new Set(mods.flatMap((m) => m.icns));
    R.graphics.referencedIcns = allIcns.size; R.graphics.imagesInOurPdf = imgs(ours); R.graphics.imagesInReferencePdf = imgs(refPdf);
    R.graphics.figureCaptions = { ours: (ourPages.join(' ').match(/\bFig(?:ure)?\.?\s*\d+/gi) ?? []).length, reference: (refPages.join(' ').match(/\bFig(?:ure)?\.?\s*\d+/gi) ?? []).length };

    stage('graphics done; pagination');
    // pagination and blank pages
    const blankish = (ps) => ps.map((p, i) => ({ i, w: p.trim().split(/\s+/).filter(Boolean).length, note: /intentionally left blank/i.test(p) }));
    const bl = (ps) => { const x = blankish(ps); return { intentionallyBlankNotice: x.filter((y) => y.note).length, emptyPages: x.filter((y) => y.w === 0).length, nearEmptyPages: x.filter((y) => y.w > 0 && y.w <= 6 && !y.note).length }; };
    R.pagination = { pages: { reference: refPages.length, ours: ourPages.length, ratio: Number((ourPages.length / refPages.length).toFixed(2)) }, blank: { reference: bl(refPages), ours: bl(ourPages) } };
    const foot = (pdf, n) => { const out = []; const total = Number((/Pages:\s+(\d+)/.exec(sh('pdfinfo', [pdf]).stdout) || [])[1] ?? 0); for (let k = 0; k < n; k++) { const p = Math.max(1, Math.floor((k + 0.5) * total / n)); const x = sh('pdftotext', ['-f', String(p), '-l', String(p), '-bbox', pdf, '-']).stdout; const ws = [...x.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map((m) => ({ x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], t: m[5] })); const ph = (/<page width="([\d.]+)" height="([\d.]+)"/.exec(x) || []); out.push({ p, W: +ph[1], H: +ph[2], words: ws }); } return out; };
    const lay = (pdf) => { const s = foot(pdf, 16).filter((q) => q.words.length > 10); const med = (a) => { const b = [...a].sort((p, q) => p - q); return b.length ? Math.round(b[Math.floor(b.length / 2)] * 10) / 10 : null; }; const font = sh('pdffonts', ['-f', '1', '-l', String(SURVEY_PAGES), pdf]).stdout.split('\n').slice(2).filter(Boolean).map((l) => l.trim().split(/\s+/)[0].replace(/^[A-Z]{6}\+/, '')); const sizes = sh('pdfinfo', ['-f', '1', '-l', String(SURVEY_PAGES), pdf]).stdout.match(/size:\s+[\d.]+ x [\d.]+ pts[^\n]*/g) ?? []; const pat = (q) => { const f = q.words.filter((x) => x.y0 > q.H - 60).map((x) => x.t).join(' ').replace(/\d+/g, '#'); const hd = q.words.filter((x) => x.y1 < 60).map((x) => x.t).join(' ').replace(/\d+/g, '#'); return { footer: f.slice(0, 90), header: hd.slice(0, 90) }; }; return { surveyedPagesForFontsAndSizes: SURVEY_PAGES, sampledPages: s.length, pageSizesPts: [...new Set(sizes.map((x) => x.replace(/^size:\s+/, '')))].slice(0, 6), landscapePages: sizes.filter((x) => { const m = /([\d.]+) x ([\d.]+)/.exec(x); return m && +m[1] > +m[2]; }).length, fonts: [...new Set(font)].slice(0, 14), medianMarginPts: { left: med(s.map((q) => Math.min(...q.words.map((x) => x.x0)))), right: med(s.map((q) => q.W - Math.max(...q.words.map((x) => x.x1)))), top: med(s.map((q) => Math.min(...q.words.map((x) => x.y0)))), bottom: med(s.map((q) => q.H - Math.max(...q.words.map((x) => x.y1)))) }, headerFooterPatterns: [...new Set(s.map(pat).map((x) => `H:${x.header} | F:${x.footer}`))].slice(0, 6) }; };
    stage('layout');
    R.layout = { reference: lay(refPdf), ours: lay(ours) };
    stage('layout done; pictures');

    // ── SCALE BUILD (synthetic, --scale-build) ───────────────────────────────────────────────────────
    // The supplied PM may publish only part of the package. To exercise the engines on EVERY data module (and to check that none of their content is lost),
    // a flat publication module listing all data modules in alphabetical order of their code is written into the COPY and built. It is NOT the original
    // publication structure (unknown: the sub-publications are not in the package), so order, TOC and page numbering are not compared for it.
    if (SCALE) {
      stage('scale build: synthetic PM listing every data module');
      const removed = new Set();                                            // data modules the gate refused in THIS build (left out of the COPY, listed)
      const writePm = () => {
        const items = allMods.filter((m) => !removed.has(m.f)).map((m) => { const code = (/<dmIdent>[\s\S]*?(<dmCode\s[^>]*\/>)/.exec(fs.readFileSync(path.join(dmDir, m.f), 'utf8')) || [])[1]; return code ? `<pmEntry><pmEntryTitle>${esc(m.tech || m.code)}</pmEntryTitle><dmRef><dmRefIdent>${code}</dmRefIdent></dmRef></pmEntry>` : ''; }).join('');
        const pmFile = path.join(h.ws, 'projects', pid, 'publication.xml');
        fs.writeFileSync(pmFile, fs.readFileSync(pmFile, 'utf8').replace(/<content[\s\S]*<\/content>/, `<content>${items}</content>`));
      };
      writePm();
      const sb = { note: 'SYNTHETIC publication module: every data module the gate accepts, alphabetical by code. Not the original structure.', modulesInPackage: allMods.length, refusedByGate: [] };
      let b2 = await build();
      for (let round = 0; SKIP_REFUSED && b2.status === 422 && b2.refused?.length && round < 8; round++) {
        const files = [...new Set(b2.refused.map((f) => f.file).filter((f) => /^DMC-/i.test(f) && !removed.has(f)))];
        if (!files.length) break;
        for (const f of files) { await w.del(`${U}/dms/${encodeURIComponent(f)}`); removed.add(f); sb.refusedByGate.push({ file: f, round: round + 1, why: [...new Set(b2.refused.filter((x) => x.file === f).map((x) => `${x.kind}: ${x.title}`))].slice(0, 3) }); }
        writePm(); b2 = await build();
      }
      const scaleMods = allMods.filter((m) => !removed.has(m.f)); sb.modulesPublished = scaleMods.length;
      sb.pdf = { status: b2.status, ms: b2.ms, code: b2.code };
      if (b2.status === 200) {
        const f2 = path.join(outDir, 'ours-all-modules.pdf'); fs.writeFileSync(f2, (await retry(() => w.get(`${U}/publish/pdf`))).buf);
        const p2 = pagesOf(f2); const t2 = flat(p2.join(' '));
        sb.pdf.pages = p2.length; sb.pdf.bytes = fs.statSync(f2).size; sb.pdf.referencePages = refPages.length; sb.pdf.ratioToReference = Number((p2.length / refPages.length).toFixed(2));
        const lost = scaleMods.flatMap((m) => m.words.filter((x) => !t2.includes(x)).map((x) => `${m.code}: ${x}`));
        sb.pdf.contentWords = scaleMods.reduce((a, m) => a + m.words.length, 0); sb.pdf.wordsMissing = lost.length; sb.pdf.firstMissing = lost.slice(0, 12);
        sb.pdf.titlesMissing = scaleMods.filter((m) => m.tech && !t2.includes(flat(m.tech))).map((m) => m.code).slice(0, 20);
        sb.pdf.blank = bl(p2); sb.pdf.imagesPlaced = imgs(f2); sb.pdf.referencedIcns = new Set(scaleMods.flatMap((m) => m.icns)).size;
        fs.rmSync(f2, { force: true });
      } else sb.pdf.refused = (b2.refused ?? []).slice(0, 10);
      const h2 = await retry(() => w.post(`${U}/publish/html`, {}));
      sb.html = { status: h2.status, pages: h2.json?.pages, assets: h2.json?.assets, missing: h2.json?.missing };
      if (h2.status === 201) {
        const hz = await htmlTextOfZip((await retry(() => w.get(h2.json.zip))).buf); const ht2 = flat(hz.text);
        const lost = scaleMods.flatMap((m) => m.words.filter((x) => !ht2.includes(x)).map((x) => `${m.code}: ${x}`));
        sb.html.htmlFiles = hz.files; sb.html.wordsMissing = lost.length; sb.html.firstMissing = lost.slice(0, 12);
        sb.html.titlesMissing = scaleMods.filter((m) => m.tech && !ht2.includes(flat(m.tech))).map((m) => m.code).slice(0, 20);
      }
      R.scaleBuild = sb;
    }
    // pictures for a human look (low resolution; first page, a front-matter page, middle, last)
    const pics = path.join(outDir, 'pages'); fs.mkdirSync(pics, { recursive: true });
    for (const [tag, pdf, n] of [['reference', refPdf, refPages.length], ['ours', ours, ourPages.length]]) for (const p of [1, 3, Math.ceil(n / 2), n]) sh('pdftoppm', ['-f', String(p), '-l', String(p), '-r', '45', '-png', pdf, path.join(pics, `${tag}-p${p}`)]);
    R.pictures = fs.readdirSync(pics).sort();
  }
  R.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(R, null, 1));
  fs.writeFileSync(path.join(outDir, 'report.md'), toMarkdown(R));
  console.log(`report written: ${path.join(outDir, 'report.json')} and report.md`);
  await h.close(); try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });


/** A readable rendering of the measured data (nothing is added that is not in `r`). */
function toMarkdown(r) {
  const fence = (v) => '```json\n' + JSON.stringify(v, null, 1) + '\n```\n';
  const sections = ['package', 'pmCoverage', 'reference', 'import', 'project', 'validation', 'validationAfterStandIn', 'refusedByGate', 'findings', 'graphics', 'pdfBuild', 'htmlBuild', 'content', 'toc', 'order', 'pagination', 'layout', 'scaleBuild', 'pictures'];
  const dev = r.deviations.length ? r.deviations.map((d) => `- ${d}`).join('\n') : '- none';
  return `# ${r.name}: round trip and comparison\n\nStarted ${r.startedAt}, finished ${r.finishedAt}.\n\n## Deviations from the package as supplied\n\n${dev}\n\n${(r.notes ?? []).map((n) => `- ${n}`).join('\n')}\n\n`
    + sections.filter((s) => r[s] !== undefined).map((s) => `## ${s}\n\n${fence(r[s])}`).join('\n');
}
