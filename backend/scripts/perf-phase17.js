'use strict';
// Performance measurements for Phase 17 (run on a quiet machine; numbers are recorded in docs/S1000D_COMPLIANCE_MATRIX.md, never estimated).
//   node scripts/perf-phase17.js [dms=500] [assets=1000] [pdf=1]
// Builds a throwaway workspace, a project of N data modules (clones of the 5.0 fixture with unique codes), M ICN assets and a publication that
// places every module; then times: package import, project export, validation run, findings, HTML publication, delivery package, and (optionally) the PDF.
const fs = require('fs'); const os = require('os'); const path = require('path');
const N = Number(process.argv[2] ?? 500); const M = Number(process.argv[3] ?? 1000); const PDF = (process.argv[4] ?? '1') === '1';
process.env.AGASTYA_WORKSPACE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-perf-'));
const { boot } = require('../test/helpers'); const Z = require('../dist/services/zipio');
const FIX = path.resolve(__dirname, '..', '..', 'frontend', 'e2e', 'fixtures', 'dm21', '5-0');
const t0 = () => process.hrtime.bigint(); const ms = (s) => Number((process.hrtime.bigint() - s) / 1000000n);
(async () => {
  const h = await boot(); const out = { dms: N, assets: M, node: process.version, cpus: os.cpus().length, steps: {} };
  const admin = new h.Client('admin'); await admin.post('/api/auth/setup', { username: 'admin', password: 'Correct-Horse-9!', fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'perf', fullName: 'Perf', role: 'author' }); const w = new h.Client('perf'); await w.post('/api/auth/login', { username: 'perf', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'perf', password: 'Correct-Horse-9!' });
  const mk = async (name) => (await w.post('/api/projects', { name, pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } })).json.project.id;
  const src = fs.readdirSync(FIX).find((f) => f.includes('-040A-D_')); const tpl = fs.readFileSync(path.join(FIX, src), 'utf8'); const icn = fs.readFileSync(path.join(FIX, '..', 'ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01.svg'));
  // the package (built with the project's own ZIP writer)
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-pkg-')); const zipPath = path.join(work, 'big.zip'); const zw = new Z.ZipStreamWriter(fs.createWriteStream(zipPath)); const refs = [];
  const brexLine = /<brexDmRef>[\s\S]*?<\/brexDmRef>/.exec(tpl)[0]; void brexLine;
  for (let i = 1; i <= N; i++) {
    const sub = String(Math.floor(i / 100)).padStart(1, '0'); const item = String(i % 100).padStart(2, '0'); const dis = String(Math.floor(i / 100) % 100).padStart(2, '0');
    const attrs = `systemDiffCode="A" systemCode="00" subSystemCode="${sub.slice(-1)}" subSubSystemCode="0" assyCode="${item}" disassyCode="${dis}" disassyCodeVariant="A"`;
    let xml = tpl.replace(/(<dmCode\s)[^>]*?(infoCode=)/, `$1modelIdentCode="EXAMPLE" ${attrs} $2`).replace(/<techName>[^<]*<\/techName>/, `<techName>Perf module ${i}</techName>`);
    const code = /<dmIdent>[\s\S]*?<dmCode\s+([^>]*?)\s*\/>/.exec(xml)[1]; const a = Object.fromEntries([...code.matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
    const dmc = `${a.modelIdentCode}-${a.systemDiffCode}-${a.systemCode}-${a.subSystemCode}${a.subSubSystemCode}-${a.assyCode}-${a.disassyCode}${a.disassyCodeVariant}-${a.infoCode}${a.infoCodeVariant}-${a.itemLocationCode}`;
    const file = `DMC-${dmc}_001-00_EN-US.XML`; refs.push(`<dmRef><dmRefIdent><dmCode ${code}/></dmRefIdent></dmRef>`); await zw.addBuffer(`csdb/${file}`, Buffer.from(xml));
  }
  for (let i = 1; i <= M; i++) await zw.addBuffer(`csdb/ICN-EXAMPLE-A-${String(i).padStart(6, '0')}-A-00001-00001-A-001-01.svg`, Buffer.concat([icn, Buffer.from(`<!-- ${i} -->`)]));
  await zw.addBuffer('publication.xml', Buffer.from(`<?xml version="1.0"?><pm><identAndStatusSection><pmAddress><pmIdent><pmCode modelIdentCode="EXAMPLE" pmIssuer="00000" pmNumber="00001" pmVolume="00"/><language languageIsoCode="en" countryIsoCode="GB"/><issueInfo issueNumber="001" inWork="00"/></pmIdent><pmAddressItems><issueDate year="2025" month="01" day="01"/><pmTitle>Perf</pmTitle><shortPmTitle>P</shortPmTitle></pmAddressItems></pmAddress><pmStatus><security securityClassification="01"/></pmStatus></identAndStatusSection><content>${refs.map((r, i) => `<pmEntry><pmEntryTitle>M${i + 1}</pmEntryTitle>${r}</pmEntry>`).join('')}</content></pm>`));
  await zw.finish(); out.packageBytes = fs.statSync(zipPath).size;
  const pid = await mk('Perf'); const U = `/api/projects/${pid}`;
  // import through the HTTP route (multipart to disk)
  let s = t0(); const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(zipPath)]), 'big.zip'); fd.append('replacePm', '1'); fd.append('skipChecks', '1'); const imp = await w.req('POST', `${U}/packages/import`, fd); out.steps.importMs = ms(s); out.import = { status: imp.status, counts: imp.json?.counts, applied: imp.json?.applied };
  s = t0(); const exp = await w.get(`${U}/packages/project`); out.steps.exportProjectMs = ms(s); out.exportBytes = exp.buf?.length;
  s = t0(); const val = await w.post(`${U}/validation`, { brex: false }); out.steps.validationMs = ms(s); out.validation = val.json?.run?.summary;
  s = t0(); const fnd = await w.get(`${U}/findings`); out.steps.findingsMs = ms(s); out.findings = fnd.json?.counts;
  s = t0(); const as = await w.get(`${U}/assets`); out.steps.assetsMs = ms(s); out.assetsListed = as.json?.assets?.length;
  s = t0(); const html = await w.post(`${U}/publish/html`, {}); out.steps.htmlMs = ms(s); out.html = { status: html.status, pages: html.json?.pages, assets: html.json?.assets, error: html.status === 201 ? undefined : html.json?.error?.slice(0, 200) };
  s = t0(); const del = await w.post(`${U}/packages/delivery`, { sender: { code: '00000' }, receiver: { code: 'U8025', name: 'R', city: '-', country: '-' }, includeDml: '1' }); out.steps.deliveryMs = ms(s); out.delivery = { status: del.status, bytes: del.buf?.length };
  if (PDF) { s = t0(); const pdf = await w.post(`${U}/publish`, {}); out.steps.pdfMs = ms(s); out.pdf = { status: pdf.status, bytes: pdf.json?.bytes, error: pdf.status === 200 ? undefined : pdf.json?.error?.slice(0, 200) }; }
  out.peakRssMB = Math.round(process.memoryUsage().rss / 1048576);
  console.log(JSON.stringify(out, null, 1)); await h.close(); fs.rmSync(work, { recursive: true, force: true }); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
