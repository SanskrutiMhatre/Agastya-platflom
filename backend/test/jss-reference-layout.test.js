'use strict';
// The L&T reference layout (owner's request of 2026-11-26, "JSS Styling Standardization"): every JSS-authored book of both systems is set as Stencil_Naval_system_NTG Mumbai is,
// through the vendor exception ref.layout (docs/JSS_VENDOR_EXCEPTIONS.md), with exactly two differences between the systems:
//   - RESTRICTED: the Land system prints it on the cover and the title page only; the Naval system also on the Change Notice page; neither prints it in the running head and foot
//   - chapters: the Land system starts a chapter's title at the left, the Naval system centres it
// The old layouts are untouched: test/jss-cover-isolation.test.js holds the fingerprints that prove it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { boot, tmp } = require('./helpers');

const PW = 'Correct-Horse-9!';
let h; let w; let G; let seq = 0;
test.before(async () => {
  h = await boot(); const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'reflay', fullName: 'Ref', role: 'author' });
  w = new h.Client('reflay'); await w.post('/api/auth/login', { username: 'reflay', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'reflay', password: PW });
  G = require('./helpers-golden');
});
test.after(async () => { await h.close(); });

const build = async (domain, manualType) => {
  const r = await w.post('/api/projects', { name: `Ref ${domain} ${++seq}`, format: 'jss', domain, manualType }); assert.equal(r.status, 201, JSON.stringify(r.json));
  const id = r.json.project.id; const U = `/api/projects/${id}`;
  const b = await w.post(`${U}/publish`, {}); assert.equal(b.status, 200, JSON.stringify(b.json).slice(0, 400));
  const f = path.join(tmp('reflay-'), 'x.pdf'); fs.writeFileSync(f, (await w.get(`${U}/publish/pdf`)).buf);
  const { doc } = await G.openPdf(f);
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pg = await doc.getPage(n); const items = (await pg.getTextContent()).items.filter((i) => i.str.trim());
    pages.push({ n, items: items.map((i) => ({ s: i.str.trim(), x: i.transform[4], y: 841.89 - i.transform[5], size: Math.round(Math.hypot(i.transform[2], i.transform[3]) * 10) / 10 })) });
  }
  return { id, pages, fo: fs.readFileSync(path.join(h.ws, 'projects', id, 'jss-output.fo'), 'utf8') };
};
const textOf = (p) => p.items.map((i) => i.s).join(' ');

test('both systems: the cover, its blank back, the title page and its back, the running head and foot, and 18 pt chapters, as the reference sets them', { timeout: 900000 }, async () => {
  for (const [domain, type] of [['land', 'uhb'], ['naval', 'naval-uhb']]) {
    const b = await build(domain, type); const P = b.pages;
    // pages 1-4: cover / nothing / the same page again / only the legend; the contents page of the prelims is the first page with a running head
    assert.ok(/USER HANDBOOK/.test(textOf(P[0])) && /Code No\./.test(textOf(P[0])) && /Rev No\./.test(textOf(P[0])), `${domain}: page 1 is the cover`);
    assert.equal(P[1].items.length, 0, `${domain}: the cover's back carries nothing at all`);
    assert.equal(textOf(P[2]), textOf(P[0]), `${domain}: the title page is the cover again`);
    assert.equal(textOf(P[3]), 'This page is intentionally left blank.', `${domain}: the title page's back carries only the legend`);
    // the cover: classification 12 pt at the top and the foot, the title 16 pt, the date and authority in the foot, the owner's logo
    const cover = P[0].items; const rest = cover.filter((i) => i.s === 'RESTRICTED');
    assert.equal(rest.length, 2, `${domain}: RESTRICTED at the top and at the foot of the cover`); assert.ok(rest.every((i) => i.size === 12), 'at 12 pt');
    assert.ok(rest[0].y < 45 && rest[1].y > 800, `${domain}: baselines at the reference's 39 and 827 pt (saw ${rest.map((i) => Math.round(i.y))})`);
    assert.ok(cover.some((i) => i.s === 'USER HANDBOOK' && i.size === 16), `${domain}: the title is 16 pt`);
    assert.ok(cover.some((i) => /Under the Authority of/.test(i.s) && i.y > 740), `${domain}: the authority block is in the foot`);
    assert.ok((b.fo.match(/publisher-logo\.png/g) || []).length >= 3, `${domain}: the owner's logo on the cover, the title page and the Change Notice`);
    // running head and foot of the prelim and body pages: 10 pt, the book name over the system name, no classification
    const prelim = P[4]; const heads = prelim.items.filter((i) => i.y < 60);
    assert.deepEqual(heads.map((i) => i.size), [10, 10], `${domain}: the running head is two lines of 10 pt`);
    assert.ok(heads[0].y > 38 && heads[0].y < 42, `${domain}: first line at the reference's 40 pt (saw ${heads[0].y.toFixed(1)})`);
    for (const p of P.slice(4)) assert.ok(!p.items.some((i) => i.s === 'RESTRICTED' && (i.y < 60 || i.y > 800)), `${domain}: page ${p.n} has no classification in its running head or foot`);
    // chapter title: 18 pt, underlined
    const ch = P.find((p) => p.items.some((i) => /^Chapter 1$/.test(i.s))); assert.ok(ch, `${domain}: a chapter 1 divider`);
    assert.equal(ch.items.find((i) => /^Chapter 1$/.test(i.s)).size, 18, `${domain}: chapter titles are 18 pt`);
  }
});

test('the two differences: RESTRICTED on the Change Notice (Naval only) and where a chapter starts (Land at the left, Naval centred)', { timeout: 900000 }, async () => {
  const land = await build('land', 'uhb'); const naval = await build('naval', 'naval-uhb');
  const restricted = (b) => b.pages.filter((p) => p.items.some((i) => i.s === 'RESTRICTED')).map((p) => p.n);
  const noticeOf = (b) => b.pages.find((p) => /CHANGE NOTICE/.test(textOf(p)) && /CODES FOR INCORPORATION/.test(textOf(p))).n;
  assert.deepEqual(restricted(land), [1, 3], 'Land: RESTRICTED on the cover and the title page, and on no other page');
  assert.deepEqual(restricted(naval), [1, 3, noticeOf(naval)], 'Naval: RESTRICTED on the cover, the title page and the Change Notice page');
  // the chapter: "Chapter 1" starts at the text area's left edge on Land, and is centred on the text area on Naval (right-hand page: 25 mm inner, 15 mm outer margin)
  const chapter = (b) => { const p = b.pages.find((x) => x.items.some((i) => /^Chapter 1$/.test(i.s))); return p.items.filter((i) => /^Chapter 1$/.test(i.s) || i.y < 140).find((i) => /^Chapter 1$/.test(i.s)); };
  const l = chapter(land); const n = chapter(naval);
  assert.ok(Math.abs(l.x - 25 / 25.4 * 72) < 4, `Land: the chapter starts at the left margin (x = ${l.x.toFixed(1)} pt)`);
  assert.ok(n.x > 240 && n.x < 330, `Naval: the chapter is centred (x = ${n.x.toFixed(1)} pt)`);
  // everything else is identical in the two systems: the same positions and sizes (the frames themselves differ by what each stencil prints)
  const geo = (b, n) => JSON.stringify(b.pages[n - 1].items.filter((i) => i.y < 60 || i.y > 800).map((i) => [Math.round(i.y), i.size]));
  assert.equal(geo(land, 1), geo(naval, 1), 'the cover: the classification at the top and at the foot sits at the same places');
  assert.equal(geo(land, 5), geo(naval, 5), 'the running head and foot of a prelim page sit at the same places');
});
