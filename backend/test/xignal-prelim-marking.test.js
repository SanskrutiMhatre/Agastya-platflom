'use strict';
// The classification on the PRELIM pages (contents, list of illustrations, list of abbreviations), at the stylesheet level (xsltproc on a hand-written
// publication, no server and no FOP).
//
// The Xignal reference prints no classification on any of its 569 front-matter pages, while every data module page carries the class of its own
// module (measured on RDR-1671Y-00039-00, docs/SAMPLE_COMPARISON_REPORT.md section 5). The engine's own layout marks the prelims with the
// publication's class: an unmarked page in a classified book is the page a reader checks first. So:
//   - layout.profile "xignal": prelims unmarked; the title page (a data module: its own class) and the body keep theirs
//   - no profile: prelims marked, as always
//   - the parameter prelim.classification ("yes" / "no") decides either way, for a project that wants the other behaviour
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// the fixtures and the renderer of the cover test, which already builds a Xignal-shaped publication and runs xsltproc on it
const src = fs.readFileSync(path.join(__dirname, 'xignal-cover.test.js'), 'utf8');
const head = src.slice(0, src.indexOf("test('Xignal profile: the title-page module"));
assert.ok(head.includes('function render('), 'the cover test still defines its renderer');
const mod = { exports: {} };
new Function('require', 'module', '__dirname', `${head}\nmodule.exports = { PM, COVER, render, sequences, SKIP };`)(
  require('node:module').createRequire(path.join(__dirname, 'xignal-cover.test.js')), mod, __dirname);
const { PM, COVER, render, sequences, SKIP } = mod.exports;

const markers = (seq) => [...seq.matchAll(/<fo:marker marker-class-name="chapter\.classification">([\s\S]*?)<\/fo:marker>/g)]
  .map((x) => x[1].replace(/<[^>]+>/g, '').trim());
const printed = (fo) => sequences(fo).map((s) => markers(s).join('|'));

test('Xignal profile: contents and lists carry no classification; the title page and the body keep theirs', { skip: SKIP }, () => {
  const p = printed(render(PM(COVER), { 'layout.profile': 'xignal', 'frontmatter.style': 's1000d' }));
  assert.equal(p.length, 5, 'title page, contents, illustrations, abbreviations, chapter');
  assert.equal(p[0], 'Restricted', "the title page is a data module and prints its own module's class");
  assert.deepEqual(p.slice(1, 4), ['', '', ''], 'the three prelim sections print none (as the reference)');
  assert.equal(p[4], 'Restricted', 'the body prints the class of its module');
});

test('no profile: every prelim page is marked, as before', { skip: SKIP }, () => {
  const p = printed(render(PM(COVER), { 'frontmatter.style': 's1000d' }));
  assert.ok(p.length >= 5 && p.every((x) => x === 'Restricted'), JSON.stringify(p));
});

test('the parameter overrides either default', { skip: SKIP }, () => {
  const on = printed(render(PM(COVER), { 'layout.profile': 'xignal', 'frontmatter.style': 's1000d', 'prelim.classification': 'yes' }));
  assert.ok(on.every((x) => x === 'Restricted'), `Xignal with "yes": ${JSON.stringify(on)}`);
  const off = printed(render(PM(COVER), { 'frontmatter.style': 's1000d', 'prelim.classification': 'no' }));
  assert.deepEqual(off.slice(0, 4), ['', '', '', ''], 'default layout with "no": the prelims are unmarked');
  assert.deepEqual(off.slice(4), ['Restricted', 'Restricted'], 'body pages always keep their module class');
});

test('the title page the engine generates (no title-page module first) is marked like the title-page module would be', { skip: SKIP }, () => {
  const xig = { 'layout.profile': 'xignal', 'frontmatter.style': 's1000d' };
  const p = printed(render(PM(''), xig));
  assert.equal(p.length, 5, 'generated title page, contents, illustrations, abbreviations, chapter');
  assert.equal(p[0], 'Restricted', 'the publication\'s title page carries the publication\'s class');
  assert.deepEqual(p.slice(1, 4), ['', '', ''], 'the prelim lists still print none');
  assert.equal(printed(render(PM(''), { ...xig, 'prelim.classification': 'no' }))[0], '', 'unless the project turned prelim marking off');
  // and it names its information code, like every generated page (see xignal-cover.test.js)
  const foot = (fo) => (/marker-class-name="chapter\.data\.module\.code">([^<]*)</.exec(sequences(fo)[0]) || [])[1];
  assert.match(foot(render(PM(''), xig)), /^[A-Z0-9]+-A-00-00-00-00A-001A-D$/);
});

test('a class-to-marking table does not remove the marking the project itself states (Settings > Security classification)', { skip: SKIP }, () => {
  const MAP = '01=|02=RESTRICTED|03=RESTRICTED|04=RESTRICTED';
  const base = { 'layout.profile': 'xignal', 'frontmatter.style': 's1000d', 'classification.map': MAP };
  const unclassified = PM(COVER).split('securityClassification="02"').join('securityClassification="01"');
  // the project says RESTRICTED: a class-01 module is marked, on the title page and in the body; the prelim lists stay unmarked as in the reference
  const stated = printed(render(unclassified, { ...base, 'security.classification': 'RESTRICTED' }));
  assert.deepEqual(stated, ['RESTRICTED', '', '', '', 'RESTRICTED']);
  // the project states nothing, or Unclassified: the table decides and class 01 prints nothing
  assert.deepEqual(printed(render(unclassified, base)), ['', '', '', '', '']);
  assert.deepEqual(printed(render(unclassified, { ...base, 'security.classification': 'Unclassified' })), ['', '', '', '', '']);
  // an entry the table fills is that class's own marking, whatever the project states
  assert.deepEqual(printed(render(PM(COVER), { ...base, 'security.classification': 'SECRET' })), ['RESTRICTED', '', '', '', 'RESTRICTED']);
});
