'use strict';
// Brand packs and the margin-mark / header-logo resolution (vendor/engine/brand.js).
// Pure functions plus the two loaders: no server, no FOP.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const brand = require('../vendor/engine/brand');
const TEMPLATES = path.join(__dirname, '..', 'templates');                  // seeded into every workspace
const OPTIONAL = path.join(__dirname, '..', 'templates-optional');          // installed on purpose (third-party logo)
const NOW = new Date(2026, 10, 20, 9, 5, 7);   // 2026-11-20 09:05:07 local

const pm = (issue, inWork, extra = '') =>
  `<pm><identAndStatusSection><pmAddress><pmIdent><pmCode modelIdentCode="RDR"/>` +
  `<issueInfo issueNumber="${issue}" inWork="${inWork}"/></pmIdent></pmAddress></identAndStatusSection>${extra}</pm>`;

test('brand packs: the shipped packs load, a pack with a logo exposes it, the neutral pack has none, and the L&T pack is NOT in the seed', () => {
  assert.equal(brand.loadBrandPack(TEMPLATES, 'lnt-xignal'), null, 'a third-party logo is not seeded into every workspace');
  const lnt = brand.loadBrandPack(OPTIONAL, 'lnt-xignal');
  assert.ok(lnt, 'lnt-xignal pack exists');
  assert.equal(lnt.company, 'L&T Precision Engineering and Systems');
  assert.ok(lnt.logoAbs && fs.existsSync(lnt.logoAbs), 'the logo file is bundled with the pack');
  assert.equal(lnt.logoMissing, false);

  const neutral = brand.loadBrandPack(TEMPLATES, 'neutral');
  assert.ok(neutral);
  assert.equal(neutral.company, '');
  assert.equal(neutral.logoAbs, null);
  assert.equal(neutral.logoMissing, false, 'a pack that names no logo is not "missing" one');

  const listed = brand.listBrandPacks(TEMPLATES).map((b) => b.id).sort();
  assert.deepEqual(listed, ['neutral']);
  assert.deepEqual(brand.listBrandPacks(OPTIONAL).map((b) => b.id), ['lnt-xignal']);
});

test('brand packs: unknown ids and path-escaping ids are refused, a pack naming an absent logo is flagged', () => {
  assert.equal(brand.loadBrandPack(TEMPLATES, 'no-such-pack'), null);
  for (const bad of ['..', '../templates', 'a/b', 'a\\b', '', null, undefined, '.hidden']) {
    assert.equal(brand.loadBrandPack(TEMPLATES, bad), null, `refused: ${String(bad)}`);
    assert.equal(brand.brandDir(TEMPLATES, bad), null);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brandtest-'));
  try {
    fs.mkdirSync(path.join(tmp, 'brand', 'ghost'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'brand', 'ghost', 'brand.json'),
      JSON.stringify({ id: 'ghost', name: 'Ghost', company: ' Acme ', logo: 'missing.png' }));
    const g = brand.loadBrandPack(tmp, 'ghost');
    assert.equal(g.company, 'Acme', 'company is trimmed');
    assert.equal(g.logoAbs, null);
    assert.equal(g.logoMissing, true);
    // a logo name that tries to leave the pack directory is treated as not found
    fs.writeFileSync(path.join(tmp, 'brand', 'ghost', 'brand.json'), JSON.stringify({ id: 'ghost', logo: '../ghost/brand.json' }));
    assert.equal(brand.loadBrandPack(tmp, 'ghost').logoAbs, null);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('publication directives: processing instruction, comment and remarks forms; keys are case-insensitive; later wins', () => {
  const text = `<pm><?agastya company="Acme &amp; Sons" Draft='off'?>
    <!-- agastya: logo = off ; printed=Printed {printed} -->
    <remarks>agastya.company: Last Word Ltd</remarks></pm>`;
  const d = brand.pmDirectives(text);
  assert.equal(d.company, 'Last Word Ltd', 'the later directive wins');
  assert.equal(d.draft, 'off');
  assert.equal(d.logo, 'off');
  assert.equal(d.printed, 'Printed {printed}');
  assert.deepEqual(brand.pmDirectives(''), {});
  assert.deepEqual(brand.pmDirectives(null), {});
  assert.equal(brand.pmDirectives('<?agastya company="A &amp; B"?>').company, 'A & B', 'XML entities are decoded');
});

test('issue and in-work numbers come from the publication module identity; a non-zero in-work number is a draft', () => {
  assert.deepEqual(brand.issueOf(pm('001', '00')), { number: '001', inWork: '00', issue: '001-00', draft: false });
  assert.deepEqual(brand.issueOf(pm('002', '03')), { number: '002', inWork: '03', issue: '002-03', draft: true });
  assert.deepEqual(brand.issueOf('<nothing/>'), { number: '', inWork: '', issue: '', draft: false });
});

test('stamp and token filling: local time tokens, unknown tokens are left as written', () => {
  assert.equal(brand.formatStamp(NOW, 'YYYY-MM-DD HH:mm'), '2026-11-20 09:05');
  assert.equal(brand.formatStamp(NOW, 'DD/MM/YYYY HH:mm:ss'), '20/11/2026 09:05:07');
  assert.equal(brand.formatStamp(NOW), '2026-11-20 09:05', 'default format');
  assert.equal(brand.fill('Issue {issue} {nope}', { issue: '001-00' }), 'Issue 001-00 {nope}');
  assert.equal(brand.fill(null, {}), '');
});

const params = (r) => Object.fromEntries(r.params);
const house = (marks = {}, header = {}) => ({ layout: { marks, header } });

test('markings: the company line is Settings (when filled in), then the publication comment, then the brand pack; blank means no mark and a note', () => {
  const lnt = brand.loadBrandPack(OPTIONAL, 'lnt-xignal');
  const base = { pmText: pm('001', '00'), now: NOW };
  const directive = (v) => pm('001', '00', '<?agastya company="' + v + '"?>');

  const fromPack = brand.resolveMarkings({ ...base, layout: house().layout, brand: lnt });
  assert.equal(params(fromPack)['xs.mark.company'], 'L&T Precision Engineering and Systems');

  const fromSettings = brand.resolveMarkings({ ...base, layout: house({ company: { text: 'Settings Co {issue}' } }).layout, brand: lnt });
  assert.equal(params(fromSettings)['xs.mark.company'], 'Settings Co 001-00', 'settings beat the pack and tokens are filled');
  assert.ok(!fromSettings.notes.some((n) => /publication comment/.test(n)), 'nothing was overridden, so nothing is said');

  // the directive fills what Settings leave blank, and beats the pack
  const blank = brand.resolveMarkings({ ...base, pmText: directive('Directive Co'), layout: house({ company: { text: '   ' } }).layout, brand: lnt });
  assert.equal(params(blank)['xs.mark.company'], 'Directive Co', 'blank Settings fall through to the publication comment');
  const noSettings = brand.resolveMarkings({ ...base, pmText: directive('Directive Co'), layout: house().layout, brand: lnt });
  assert.equal(params(noSettings)['xs.mark.company'], 'Directive Co');

  // Settings that are filled in WIN over a directive, and the build log says it happened
  const winning = brand.resolveMarkings({ ...base, pmText: directive('Directive Co'), layout: house({ company: { text: 'Settings Co' } }).layout, brand: lnt });
  assert.equal(params(winning)['xs.mark.company'], 'Settings Co', 'an imported file does not silently change what Settings say');
  assert.ok(winning.notes.some((n) => n === 'Settings set the company line ("Settings Co"), so the publication comment ("Directive Co") is not used'), winning.notes.join(' | '));
  const sameValue = brand.resolveMarkings({ ...base, pmText: directive('Settings Co'), layout: house({ company: { text: 'Settings Co' } }).layout, brand: lnt });
  assert.ok(!sameValue.notes.some((n) => /publication comment/.test(n)), 'agreeing values need no note');

  // "off": honoured when Settings leave the line blank, overridden (with a note) when Settings fill it in
  const off = brand.resolveMarkings({ ...base, pmText: directive('off'), layout: house().layout, brand: lnt });
  assert.equal(params(off)['xs.mark.company'], '');
  assert.ok(!off.notes.some((n) => /company line/i.test(n)), 'switched off on purpose: no warning');
  const offButSet = brand.resolveMarkings({ ...base, pmText: directive('off'), layout: house({ company: { text: 'Settings Co' } }).layout, brand: lnt });
  assert.equal(params(offButSet)['xs.mark.company'], 'Settings Co');
  assert.ok(offButSet.notes.some((n) => /publication comment \(off\) is not used/.test(n)));

  const none = brand.resolveMarkings({ ...base, layout: house().layout, brand: brand.loadBrandPack(TEMPLATES, 'neutral') });
  assert.equal(params(none)['xs.mark.company'], '');
  assert.ok(none.notes.some((n) => /company line/i.test(n)), 'the build log says why the mark is missing');

  const disabled = brand.resolveMarkings({ ...base, layout: house({ company: { enabled: false } }).layout, brand: lnt });
  assert.ok(!('xs.mark.company' in params(disabled)) || params(disabled)['xs.mark.company'] === '');
  assert.ok(!disabled.notes.some((n) => /company line/i.test(n)), 'switched off on purpose: no warning');
});

test('markings: a build that is not released is a draft copy whatever its in-work number says; a released one is not', () => {
  const layout = house({ draft: { text: 'Draft of Issue {issue}', showWhen: 'inWork' } }).layout;
  const at = (released) => params(brand.resolveMarkings({ layout, pmText: pm('001', '00'), brand: null, now: NOW, released }))['xs.mark.draft'];
  assert.equal(at(false), 'Draft of Issue 001-00', 'NOT RELEASED build of issue 001-00');
  assert.equal(at(true), '', 'released build of issue 001-00');
  assert.equal(at(undefined), '', 'a caller that does not state the release keeps the in-work rule');
  const never = brand.resolveMarkings({ layout: house({ draft: { text: 'D {issue}', showWhen: 'never' } }).layout, pmText: pm('001', '00'), brand: null, now: NOW, released: false });
  assert.equal(params(never)['xs.mark.draft'], '', 'any other showWhen is not widened');
});

test('markings: the draft line shows for in-work issues only (by default), always, or never; the printed stamp uses the build clock', () => {
  const layout = house({ draft: { text: 'Draft of Issue {issue}', showWhen: 'inWork' }, printed: { text: 'Printed {printed}', format: 'YYYY-MM-DD HH:mm' } }).layout;
  const released = brand.resolveMarkings({ layout, pmText: pm('001', '00'), brand: null, now: NOW });
  assert.equal(params(released)['xs.mark.draft'], '', 'released issue: no draft line');
  const inWork = brand.resolveMarkings({ layout, pmText: pm('001', '02'), brand: null, now: NOW });
  assert.equal(params(inWork)['xs.mark.draft'], 'Draft of Issue 001-02');
  assert.equal(params(inWork)['xs.mark.printed'], 'Printed 2026-11-20 09:05');

  const always = brand.resolveMarkings({ layout: house({ draft: { text: 'D {issue}', showWhen: 'always' } }).layout, pmText: pm('001', '00'), brand: null, now: NOW });
  assert.equal(params(always)['xs.mark.draft'], 'D 001-00');

  // Settings fill in the wording, so a publication comment that says "off" does not override them - and the log says so
  const kept = brand.resolveMarkings({ layout, pmText: pm('001', '02', '<?agastya draft=off printed=off?>'), brand: null, now: NOW });
  assert.equal(params(kept)['xs.mark.draft'], 'Draft of Issue 001-02');
  assert.equal(params(kept)['xs.mark.printed'], 'Printed 2026-11-20 09:05');
  assert.ok(kept.notes.some((n) => /draft line/.test(n) && /publication comment \(off\)/.test(n)));
  assert.ok(kept.notes.some((n) => /printed line/.test(n)));

  // ... but where Settings leave the wording blank, the comment decides: off switches it off, text replaces the default
  const blankLayout = house({ draft: { text: '' }, printed: { text: '' } }).layout;
  const off = brand.resolveMarkings({ layout: blankLayout, pmText: pm('001', '02', '<?agastya draft=off printed=off?>'), brand: null, now: NOW });
  assert.equal(params(off)['xs.mark.draft'], '');
  assert.equal(params(off)['xs.mark.printed'], '');
  const custom = brand.resolveMarkings({ layout: blankLayout, pmText: pm('001', '00', '<?agastya draft="Review copy {issue}"?>'), brand: null, now: NOW });
  assert.equal(params(custom)['xs.mark.draft'], 'Review copy 001-00', 'a comment can show the line even for a released issue');
  const dflt = brand.resolveMarkings({ layout: blankLayout, pmText: pm('001', '02'), brand: null, now: NOW });
  assert.equal(params(dflt)['xs.mark.draft'], 'This is a draft copy of Issue 001-02', 'nothing anywhere: the built-in wording');
  assert.equal(params(dflt)['xs.mark.printed'], 'Printed 2026-11-20 09:05');
});

test('markings: the header logo is the Settings path, then the publication comment (off), then the pack, else left out with a note; nothing here ever throws', () => {
  const lnt = brand.loadBrandPack(OPTIONAL, 'lnt-xignal');
  const withPack = brand.resolveMarkings({ layout: house().layout, pmText: pm('001', '00'), brand: lnt, now: NOW });
  assert.ok(withPack.logo && withPack.logo.from === lnt.logoAbs);
  assert.equal(params(withPack)['header.logo.uri'], `_brand/${path.basename(lnt.logoAbs)}`);

  const withPath = brand.resolveMarkings({ layout: house({}, { logoPath: 'assets\\logo.png' }).layout, pmText: pm('001', '00'), brand: null, now: NOW });
  assert.equal(params(withPath)['header.logo.uri'], 'assets/logo.png');
  assert.equal(withPath.logo.from, null, 'a project file is used where it is');

  const nothing = brand.resolveMarkings({ layout: house().layout, pmText: pm('001', '00'), brand: null, now: NOW });
  assert.equal(nothing.logo, null);
  assert.ok(!('header.logo.uri' in params(nothing)));
  assert.ok(nothing.notes.some((n) => /logo/i.test(n)));

  const off = brand.resolveMarkings({ layout: house().layout, pmText: pm('001', '00', '<?agastya logo=off?>'), brand: lnt, now: NOW });
  assert.equal(off.logo, null, 'the publication can switch the pack logo off');

  // a logo file named in Settings beats both the pack and a comment that says off
  const settingsWin = brand.resolveMarkings({ layout: house({}, { logoPath: 'assets/logo.png' }).layout, pmText: pm('001', '00', '<?agastya logo=off?>'), brand: lnt, now: NOW });
  assert.equal(params(settingsWin)['header.logo.uri'], 'assets/logo.png');
  assert.ok(settingsWin.notes.some((n) => /switches the logo off is not used/.test(n)));
  const settingsOverPack = brand.resolveMarkings({ layout: house({}, { logoPath: 'assets/logo.png' }).layout, pmText: pm('001', '00'), brand: lnt, now: NOW });
  assert.equal(params(settingsOverPack)['header.logo.uri'], 'assets/logo.png', 'Settings beat the pack logo');

  // missing inputs altogether
  assert.doesNotThrow(() => brand.resolveMarkings({}));
  assert.doesNotThrow(() => brand.resolveMarkings({ layout: null, pmText: null, brand: null }));
});

test('the Xignal house template ships no company text of its own and uses the neutral pack, so nothing third-party is printed by default', () => {
  const h = require('../templates/xignal-s1000d.house.json');
  assert.equal(h.layout.profile, 'xignal');
  assert.equal(String((h.layout.marks.company || {}).text || ''), '');
  assert.equal(h.brandPack, 'neutral');
});
