'use strict';
// A data module printed more than once in one publication (the same module reused under two chapters or sub-publications).
//
// Every print carries the same authored ids and the same dmCode. FOP treats a repeated id as fatal, so the stylesheets must give
// each print its own ids - and a cross-reference must land in the print it is written in, not in the first one in the book.
// Stylesheet level (xsltproc on a hand-written publication): no server, no FOP.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const paths = require('../vendor/engine/paths');

const XSL = path.join(__dirname, '..', 'vendor', 'pipeline', 's1000dtofo', 's1000dtofo.xsl');
const SKIP = fs.existsSync(paths.XSLTPROC) ? false : `xsltproc is not installed at ${paths.XSLTPROC}`;

const dm = (dis, tech, body) => `
<dmodule xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <identAndStatusSection><dmAddress>
    <dmIdent>
      <dmCode modelIdentCode="TST" systemDiffCode="A" systemCode="A00" subSystemCode="0" subSubSystemCode="0" assyCode="00" disassyCode="${dis}" disassyCodeVariant="A" infoCode="040" infoCodeVariant="A" itemLocationCode="D"/>
      <language languageIsoCode="en" countryIsoCode="IN"/><issueInfo issueNumber="001" inWork="00"/>
    </dmIdent>
    <dmAddressItems><issueDate year="2026" month="04" day="17"/><dmTitle><techName>${tech}</techName><infoName>Description</infoName></dmTitle></dmAddressItems>
  </dmAddress>
  <dmStatus issueType="new"><security securityClassification="01"/>
    <responsiblePartnerCompany enterpriseCode="1234Y"><enterpriseName>Acme</enterpriseName></responsiblePartnerCompany>
    <originator enterpriseCode="1234Y"><enterpriseName>Acme</enterpriseName></originator>
    <applic><displayText/></applic><qualityAssurance><firstVerification verificationType="tabtop"/></qualityAssurance></dmStatus>
  </identAndStatusSection>
  <content>${body}</content>
</dmodule>`;

// every kind of id the stylesheets emit: a paragraph and a table (dmCode-scoped), a figure (first-in-book keeps its id), a warning
const BODY = (n) => `<description><levelledPara id="lp-1"><title>Section ${n}</title>
 <para id="p-1">See <internalRef internalRefId="fig-1" internalRefTargetType="irtt01"/> and <internalRef internalRefId="tbl-1" internalRefTargetType="irtt02"/>.</para>
 <figure id="fig-1"><title>A figure ${n}</title><graphic infoEntityIdent="ICN-TST-PIC" id="gr-1"/></figure>
 <table id="tbl-1"><title>A table ${n}</title><tgroup cols="2"><colspec colname="c1" colwidth="1*"/><colspec colname="c2" colwidth="1*"/><tbody><row><entry><para>a</para></entry><entry><para>b</para></entry></row></tbody></tgroup></table>
 </levelledPara></description>`;

const A = dm('10', 'Repeated module', BODY('A'));
const B = dm('20', 'Single module', BODY('B'));
const PM = (entries) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE pm [ <!NOTATION png PUBLIC "-//W3C//NOTATION Portable Network Graphics//EN"> <!ENTITY ICN-TST-PIC SYSTEM "pic.png" NDATA png> ]>
<pm xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><identAndStatusSection><pmAddress><pmIdent>
 <pmCode modelIdentCode="TST" pmIssuer="1234Y" pmNumber="00001" pmVolume="00"/><language languageIsoCode="en" countryIsoCode="IN"/><issueInfo issueNumber="001" inWork="01"/></pmIdent>
 <pmAddressItems><issueDate year="2026" month="08" day="17"/><pmTitle>Pub</pmTitle></pmAddressItems></pmAddress>
 <pmStatus><security securityClassification="01"/><responsiblePartnerCompany enterpriseCode="1234Y"><enterpriseName>Acme</enterpriseName></responsiblePartnerCompany></pmStatus></identAndStatusSection>
 <content>${entries.map((e, i) => `<pmEntry><pmEntryTitle>Chapter ${i + 1}</pmEntryTitle>${e}</pmEntry>`).join('')}</content></pm>`;

function render(pmXml, params = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-dupid-'));
  fs.writeFileSync(path.join(dir, 'pm.xml'), pmXml);
  fs.writeFileSync(path.join(dir, '_image-dims.xml'), '<imageDims><img name="pic.png" stem="icn-tst-pic" src="pic.png" w="600" h="400"/></imageDims>');
  const sp = Object.entries(params).flatMap(([k, v]) => ['--stringparam', k, String(v)]);
  const r = spawnSync(paths.XSLTPROC, [...sp, pathToFileURL(XSL).href, path.join(dir, 'pm.xml')], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: dir });
  assert.equal(r.status, 0, `xsltproc failed: ${(r.stderr || '').slice(0, 600)}`);
  fs.rmSync(dir, { recursive: true, force: true });
  return r.stdout;
}
const ids = (fo) => [...fo.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
const dups = (fo) => { const seen = new Map(); for (const i of ids(fo)) seen.set(i, (seen.get(i) || 0) + 1); return [...seen].filter(([, n]) => n > 1).map(([i]) => i); };
const dangling = (fo) => { const set = new Set(ids(fo)); return [...new Set([...fo.matchAll(/(?:internal-destination|ref-id)="([^"]+)"/g)].map((m) => m[1]).filter((r) => !set.has(r)))]; };
// the destinations of the cross-references (and list entries) that point at figures and tables, in document order
const refsInOrder = (fo) => [...fo.matchAll(/internal-destination="([^"]+)"/g)].map((m) => m[1]).filter((d) => /^ID_TST|^fig-/.test(d));

test('a module printed twice: every id is unique and nothing dangles', { skip: SKIP }, () => {
  const fo = render(PM([A + B, A]));
  assert.deepEqual(dups(fo), [], 'no id repeats (FOP would abort)');
  assert.deepEqual(dangling(fo), [], 'every link and page citation has a destination');
  // the second print is marked, the first print and the single module are not
  assert.ok(ids(fo).some((i) => /^ID_TST-A-A00-00-00-10A-040A-D_x2-/.test(i)), 'the second print has its own scope');
  assert.ok(!ids(fo).some((i) => /^ID_TST-A-A00-00-00-10A-040A-D_x1|_x3/.test(i)), 'only a second print is marked');
  assert.ok(!ids(fo).some((i) => /^ID_TST-A-A00-00-00-20A-040A-D_x/.test(i)), 'a module printed once is untouched');
});

test('a cross-reference lands in the print it is written in', { skip: SKIP }, () => {
  const fo = render(PM([A + B, A]));
  const fig = ids(fo).filter((i) => /^fig-/.test(i));                  // figure ids in document order: A first print, B, A second print
  assert.equal(fig.length, 3);
  assert.equal(new Set(fig).size, 3, 'three different figure ids');
  const dest = refsInOrder(fo);                                         // [fig, tbl, para] x 3 prints, in document order
  const figRefs = dest.filter((d) => /^fig-/.test(d)).filter((d, i, a) => d !== a[i - 1]);   // each figure is linked from its reference and from the list of figures
  assert.deepEqual(figRefs, fig, 'the 1st, 2nd and 3rd reference go to the 1st, 2nd and 3rd figure - not all to the first one in the book');
  const tbl = dest.filter((d) => /-tbl-1$/.test(d));
  assert.equal(new Set(tbl).size, 3, 'each print refers to its own table');
  assert.ok(tbl.every((d) => ids(fo).includes(d)), 'and each of those tables exists');
});

test('a publication that prints each module once gets the same ids as before', { skip: SKIP }, () => {
  const fo = render(PM([A + B]));
  assert.deepEqual(dups(fo), []);
  assert.ok(!ids(fo).some((i) => /_x\d/.test(i)), 'no print marker anywhere');
  assert.ok(ids(fo).includes('fig-1'), 'the first figure keeps its authored id (a link written by hand to it still works)');
});

// A reference to a levelled paragraph (irtt08) - with or without a title, in its own module or in a module printed twice - must land on that paragraph.
const LP = (n) => `<description><levelledPara id="lp-top"><title>Top ${n}</title>
 <para>See <internalRef internalRefId="lp-titled" internalRefTargetType="irtt08"/> and <internalRef internalRefId="lp-bare" internalRefTargetType="irtt08"/>.</para>
 <levelledPara id="lp-titled"><title>Titled ${n}</title><para>Text</para></levelledPara>
 <levelledPara id="lp-bare"><para>Untitled paragraph ${n}</para></levelledPara></levelledPara></description>`;

test('a reference to a levelled paragraph - titled or not - has a destination', { skip: SKIP }, () => {
  const fo = render(PM([dm('30', 'Paragraph targets', LP('A'))]));
  assert.deepEqual(dangling(fo), [], 'every link has a destination');
  assert.ok(ids(fo).includes('ID_TST-A-A00-00-00-30A-040A-D-lp-titled'), 'the titled paragraph carries the id a reference to it is written against');
  assert.ok(ids(fo).includes('ID_TST-A-A00-00-00-30A-040A-D-lp-bare'), 'so does the untitled one');
});

test('levelled-paragraph targets in a module printed twice: unique ids, each reference in its own print', { skip: SKIP }, () => {
  const fo = render(PM([dm('30', 'Paragraph targets', LP('A')) + dm('31', 'Other', LP('B')), dm('30', 'Paragraph targets', LP('A'))]));
  assert.deepEqual(dups(fo), [], 'no id repeats');
  assert.deepEqual(dangling(fo), [], 'every link has a destination');
});

// The publication-level List of illustrations links every titled figure by the id the standard figure template gives it. A parts-catalogue
// figure is drawn by its own template, which only carried an ipd-fig- id - so its row linked to nothing and a click fell back to page 1.
test('a parts-catalogue figure has the id the List of illustrations links to', { skip: SKIP }, () => {
  const ipd = dm('30', 'Parts', `<illustratedPartsCatalog><figure id="fig-9"><title>Unit assembly</title><graphic infoEntityIdent="ICN-TST-PIC"/></figure>
    <catalogSeqNumber figureNumber="01" item="001" indenture="1"><itemSeqNumber itemSeqNumberValue="00A"><quantityPerNextHigherAssy>1</quantityPerNextHigherAssy><partRef manufacturerCodeValue="00000" partNumberValue="PN-1"/></itemSeqNumber></catalogSeqNumber>
  </illustratedPartsCatalog>`).replace('infoCode="040"', 'infoCode="941"');
  for (const profile of ['xignal', '']) {
    const fo = render(PM([A + ipd]), { 'frontmatter.style': 's1000d', 'layout.profile': profile });
    assert.deepEqual(dangling(fo), [], `every link has a destination (profile "${profile}")`);
    assert.deepEqual(dups(fo), [], 'and no id repeats');
    assert.ok(ids(fo).includes('fig-9'), 'the parts-catalogue figure carries the figure id');
    assert.ok(ids(fo).some((i) => /^ipd-fig-/.test(i)), 'and still its own ipd-fig- id, which the module list of figures uses');
  }
});
