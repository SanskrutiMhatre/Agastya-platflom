// The publication tree of a JSS / JSG project and the edits made on it: what the page shows after a move is what the document holds after the same move is saved.
import { describe, expect, it } from 'vitest';
import type { DocCodes } from '../api/xengine';
import { parseJss, serializeJss } from '../jss/xml';
import { parseJsg, serializeJsg } from '../jsg/xml';
import {
  applyEdits, applyToJsg, applyToJss, buildPublication, fingerprintOfJsg, fingerprintOfJss, fingerprintOfTree, landing, sameFingerprint, starterSections, subNumber,
  type Edit, type Publication,
} from './docPublication';

const mod = (key: string, chapter: number, title: string, kind: string, dmc: string) => ({ key, chapter, title, kind, dmc, file: `DMC-${dmc}.xml`, origin: 'generated' as const });
const base = { format: 'jss' as const, modelIdentCode: 'X', systemDiffCode: 'A', show: { dmc: false, pmc: false, icn: false, toc: false }, pmc: { code: 'PMC', file: 'f', title: 't', issue: '001-00', language: 'en-US', pmIssuer: 'X', pmNumber: '1', pmVolume: '00', origin: 'generated' as const }, counts: { modules: 4, pictures: 1, retired: 0, imported: 0 } };

// chapter 1 (no text of its own): Purpose (with a sub-heading), Features. chapter 2 has an introduction of its own and one section.
const JSS_CODES: DocCodes = {
  ...base,
  modules: [mod('id:s1', 1, 'Purpose', 'section', 'A1'), mod('id:s2', 1, 'Features', 'section', 'A2'), mod('id:c2', 2, 'Second', 'chapter-intro', 'B0'), mod('id:s3', 2, 'Third', 'section', 'B1')],
  pictures: [{ file: 'a.png', icn: 'ICN-1', packageFile: 'ICN-1.png', module: 'id:s2', origin: 'generated' }],
  toc: [
    { level: 1, number: '1', title: 'Leading', dmc: 'A1' }, { level: 2, number: '1.1', title: 'Purpose', dmc: 'A1' }, { level: 3, number: '1.1.1', title: 'Sub', dmc: 'A1' }, { level: 2, number: '1.2', title: 'Features', dmc: 'A2' },
    { level: 1, number: '2', title: 'Second', dmc: 'B0' }, { level: 2, number: '2.1', title: 'Third', dmc: 'B1' },
  ],
};
const JSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<jssbook docType="uhb" schemaVersion="1.0">
  <bookmeta><bookName>User Handbook</bookName></bookmeta>
  <body>
    <chapter number="1" id="c1"><title>Leading</title>
      <section id="s1"><title>Purpose</title><para>First</para><section id="s11"><title>Sub</title><para>Inner</para></section></section>
      <section id="s2"><title>Features</title><para>Second</para></section>
    </chapter>
    <chapter number="2" id="c2"><title>Second</title><para>Introduction</para>
      <section id="s3"><title>Third</title><para>x</para></section>
    </chapter>
  </body>
</jssbook>
`;

const shape = (p: Publication): string[] => p.chapters.map((c) => `${c.label} ${c.title}: ${c.modules.map((m) => `${m.label}=${m.title}`).join(', ')}`);

describe('the tree of a JSS project\'s codes', () => {
  const p = buildPublication(JSS_CODES);
  it('has the chapters, the numbering the document prints, the introduction first and the sub-headings under their module', () => {
    expect(shape(p)).toEqual(['1 Leading: 1.1=Purpose, 1.2=Features', '2 Second: 2=Second, 2.1=Third']);
    expect(p.chapters[1].modules.map((m) => m.kind)).toEqual(['chapter-intro', 'section']);
    const purpose = p.chapters[0].modules[0];
    expect(purpose.dmc).toBe('A1'); expect(purpose.subs).toEqual([{ level: 3, rel: '1', title: 'Sub' }]); expect(subNumber(purpose, purpose.subs[0])).toBe('1.1.1');
    expect(p.chapters[0].modules[1].pictures).toEqual(['a.png']);
  });
  it('has no appendices or plates for a JSS document', () => { expect(p.appendices).toEqual([]); expect(p.plates).toEqual([]); });
  it('keeps an empty chapter (no module, no code) in its place', () => {
    const q = buildPublication({ ...JSS_CODES, toc: [...JSS_CODES.toc, { level: 1, number: '3', title: 'Empty', dmc: null }] });
    expect(shape(q)[2]).toBe('3 Empty: ');
  });
});

describe('landing: where a dragged item ends up', () => {
  it('within a list, taking the item out first', () => {
    expect(landing(4, 0, 2, 'after')).toBe(2);   // A B C D, A dropped after C: B C A D
    expect(landing(4, 0, 2, 'before')).toBe(1);  // B A C D
    expect(landing(4, 3, 0, 'before')).toBe(0);
    expect(landing(4, 1, 2, 'before')).toBe(1);  // B dropped before C: where it already is
    expect(landing(4, 3, 3, 'after')).toBe(3);   // not past the end
  });
  it('from another list, the place it was dropped on', () => {
    expect(landing(3, null, 1, 'before')).toBe(1); expect(landing(3, null, 2, 'after')).toBe(3); expect(landing(0, null, 0, 'after')).toBe(0);
  });
});

describe('edits on the tree', () => {
  it('moves a section into another chapter after the introduction, and numbers again', () => {
    const p = applyEdits(buildPublication(JSS_CODES), [{ op: 'moveSection', from: { ch: 0, at: 0 }, to: { ch: 1, at: 0 } }]);
    expect(shape(p)).toEqual(['1 Leading: 1.1=Features', '2 Second: 2=Second, 2.1=Purpose, 2.2=Third']);
    expect(p.chapters[1].modules[1].dmc).toBe('A1');                       // the code travels with the module
  });
  it('moves a chapter and numbers the chapters and their sections again', () => {
    const p = applyEdits(buildPublication(JSS_CODES), [{ op: 'moveChapter', from: 1, to: 0 }]);
    expect(shape(p)).toEqual(['1 Second: 1=Second, 1.1=Third', '2 Leading: 2.1=Purpose, 2.2=Features']);
  });
  it('renames, and adds a chapter that has no code until it is saved', () => {
    const p = applyEdits(buildPublication(JSS_CODES), [{ op: 'renameSection', ch: 0, at: 1, title: 'Highlights' }, { op: 'renameChapter', ch: 1, title: 'Next' }, { op: 'addChapter', title: 'Annex', sections: ['One', 'Two'] }]);
    expect(shape(p)).toEqual(['1 Leading: 1.1=Purpose, 1.2=Highlights', '2 Next: 2=Second, 2.1=Third', '3 Annex: 3.1=One, 3.2=Two']);
    expect(p.chapters[2].fresh).toBe(true); expect(p.chapters[2].modules.every((m) => m.fresh && m.dmc === '')).toBe(true);
  });
  it('does not change what it was given', () => {
    const before = buildPublication(JSS_CODES); const copy = JSON.stringify(before);
    applyEdits(before, [{ op: 'moveChapter', from: 1, to: 0 }]); expect(JSON.stringify(before)).toBe(copy);
  });
  it('ignores an edit that points at nothing', () => {
    const p = applyEdits(buildPublication(JSS_CODES), [{ op: 'moveSection', from: { ch: 9, at: 0 }, to: { ch: 0, at: 0 } }, { op: 'moveSection', from: { ch: 0, at: 9 }, to: { ch: 0, at: 0 } }, { op: 'renameChapter', ch: 9, title: 'x' }]);
    expect(shape(p)).toEqual(shape(buildPublication(JSS_CODES)));
  });
});

describe('the same edits written into a JSS document give the tree that was shown', () => {
  const edits: Edit[] = [
    { op: 'moveSection', from: { ch: 0, at: 0 }, to: { ch: 1, at: 1 } },
    { op: 'renameChapter', ch: 1, title: 'Renamed' },
    { op: 'moveChapter', from: 1, to: 0 },
  ];
  const docShape = (xml: string): string[] => parseJss(xml).chapters.map((c) => `${c.number} ${c.title}: ${c.children.filter((x) => x.k === 'section').map((s) => (s as { title: string }).title).join(', ')}`);
  it('moves, renames and renumbers', () => {
    const doc = parseJss(JSS_XML); applyToJss(doc, edits);
    const xml = serializeJss(doc);
    const shown = applyEdits(buildPublication(JSS_CODES), edits);
    expect(docShape(xml)).toEqual(shown.chapters.map((c) => `${c.label} ${c.title}: ${c.modules.filter((m) => m.kind === 'section').map((m) => m.title).join(', ')}`));
    expect(docShape(xml)).toEqual(['1 Renamed: Third, Purpose', '2 Leading: Features']);
  });
  it('keeps the moved section whole, with its sub-heading, and the chapter introduction where it was', () => {
    const doc = parseJss(JSS_XML); applyToJss(doc, [{ op: 'moveSection', from: { ch: 0, at: 0 }, to: { ch: 1, at: 1 } }]);
    const back = parseJss(serializeJss(doc));
    const second = back.chapters[1];
    expect(second.children.map((c) => c.k)).toEqual(['para', 'section', 'section']);                      // the introduction paragraph stays first
    const moved = second.children[2] as { title: string; children: Array<{ k: string; title?: string }> };
    expect(moved.title).toBe('Purpose'); expect(moved.children.some((c) => c.k === 'section' && c.title === 'Sub')).toBe(true);
  });
  it('starts a new chapter from the stencil\'s first chapter when there is one, from a bare chapter when there is not', () => {
    const starter = { title: 'System', children: [{ title: 'Description' }, { title: 'Assembly-1', example: true }, { title: 'Data' }] };
    expect(starterSections(starter)).toEqual(['Description', 'Data']); expect(starterSections(null)).toEqual([]);
    const a = parseJss(JSS_XML); applyToJss(a, [{ op: 'addChapter', title: 'Annex', sections: starterSections(starter) }], starter);
    expect(a.chapters.map((c) => c.number)).toEqual([1, 2, 3]);
    expect(a.chapters[2].title).toBe('Annex'); expect(a.chapters[2].children.filter((x) => x.k === 'section').map((s) => (s as { title: string }).title)).toEqual(['Description', 'Data']);
    const b = parseJss(JSS_XML); applyToJss(b, [{ op: 'addChapter', title: 'Annex', sections: [] }]);
    expect(b.chapters[2].title).toBe('Annex');
  });
});

const JSG_XML = `<?xml version="1.0" encoding="UTF-8"?>
<jsgdoc version="1.0" type="uhb">
  <meta><title>USER HANDBOOK</title></meta>
  <front/>
  <chapter title="General"><section id="g1" title="Introduction"><para>Hello</para></section><section id="g2" title="Scope"><para>World</para></section></chapter>
  <chapter title="Operation"><section id="g3" title="Starting"><para>Go</para></section></chapter>
  <appendices><appendix id="a1" label="A1" title="Abbreviations"><para>List</para></appendix><appendix id="a2" label="A2" title="Index"><para>Idx</para></appendix></appendices>
</jsgdoc>`;
const JSG_CODES: DocCodes = {
  ...base, format: 'jsg',
  modules: [mod('id:g1', 1, 'Introduction', 'section', 'G1'), mod('id:g2', 1, 'Scope', 'section', 'G2'), mod('id:g3', 2, 'Starting', 'section', 'G3'), mod('id:a1', 3, 'A1 Abbreviations', 'appendix', 'GA1'), mod('id:a2', 4, 'A2 Index', 'appendix', 'GA2')],
  pictures: [],
  toc: [
    { level: 1, number: '1', title: 'General', dmc: 'G1' }, { level: 2, number: '1.1', title: 'Introduction', dmc: 'G1' }, { level: 2, number: '1.2', title: 'Scope', dmc: 'G2' },
    { level: 1, number: '2', title: 'Operation', dmc: 'G3' }, { level: 2, number: '2.1', title: 'Starting', dmc: 'G3' },
    { level: 1, number: 'A1', title: 'A1 Abbreviations', dmc: 'GA1' }, { level: 1, number: 'A2', title: 'A2 Index', dmc: 'GA2' },
  ],
};

describe('a JSG document', () => {
  const p = buildPublication(JSG_CODES);
  it('has its chapters of sections, and its appendices as modules of their own', () => {
    expect(shape(p)).toEqual(['1 General: 1.1=Introduction, 1.2=Scope', '2 Operation: 2.1=Starting']);
    expect(p.appendices.map((a) => `${a.label}=${a.title}`)).toEqual(['A1=A1 Abbreviations', 'A2=A2 Index']);
  });
  it('takes the same edits as the tree shows', () => {
    const edits: Edit[] = [{ op: 'moveSection', from: { ch: 0, at: 1 }, to: { ch: 1, at: 0 } }, { op: 'moveAppendix', from: 1, to: 0 }, { op: 'addChapter', title: 'Extra', sections: ['New section'] }, { op: 'renameSection', ch: 0, at: 0, title: 'Overview' }];
    const doc = parseJsg(JSG_XML); applyToJsg(doc, edits);
    const back = parseJsg(serializeJsg(doc)); const shown = applyEdits(p, edits);
    expect(back.chapters.map((c) => `${c.title}: ${c.sections.map((s) => s.title).join(', ')}`)).toEqual(shown.chapters.map((c) => `${c.title}: ${c.modules.map((m) => m.title).join(', ')}`));
    expect(back.appendices.map((a) => a.label)).toEqual(['A2', 'A1']); expect(shown.appendices.map((a) => a.label)).toEqual(['A2', 'A1']);
    expect(back.chapters[1].sections.map((s) => s.title)).toEqual(['Scope', 'Starting']);                    // the section's own text came with it
    expect((back.chapters[1].sections[0].children[0] as { inline: Array<{ text: string }> }).inline[0].text).toBe('World');
  });
});

describe('is the document still the one the page showed', () => {
  it('matches a JSS and a JSG document with the same chapters and sections, and notices a change', () => {
    expect(sameFingerprint(fingerprintOfTree(buildPublication(JSS_CODES)), fingerprintOfJss(parseJss(JSS_XML)))).toBe(true);
    expect(sameFingerprint(fingerprintOfTree(buildPublication(JSG_CODES)), fingerprintOfJsg(parseJsg(JSG_XML)))).toBe(true);
    const changed = parseJss(JSS_XML); changed.chapters[0].title = 'Other';
    expect(sameFingerprint(fingerprintOfTree(buildPublication(JSS_CODES)), fingerprintOfJss(changed))).toBe(false);
  });
  it('does not mind white space or the kind of apostrophe', () => {
    const a = buildPublication({ ...JSS_CODES, toc: JSS_CODES.toc.map((t) => (t.title === 'Purpose' ? { ...t, title: 'It’s  here' } : t)), modules: JSS_CODES.modules.map((m) => (m.title === 'Purpose' ? { ...m, title: 'It’s  here' } : m)) });
    const d = parseJss(JSS_XML); (d.chapters[0].children[0] as { title: string }).title = "It's here";
    expect(sameFingerprint(fingerprintOfTree(a), fingerprintOfJss(d))).toBe(true);
  });
});

describe('deleting', () => {
  const docShape = (xml: string): string[] => parseJss(xml).chapters.map((c) => `${c.number} ${c.title}: ${c.children.filter((x) => x.k === 'section').map((s) => (s as { title: string }).title).join(', ')}`);
  it('takes a section out of the tree and out of the document, in the same place', () => {
    const edits: Edit[] = [{ op: 'removeSection', ch: 0, at: 0 }];
    expect(shape(applyEdits(buildPublication(JSS_CODES), edits))).toEqual(['1 Leading: 1.1=Features', '2 Second: 2=Second, 2.1=Third']);
    const doc = parseJss(JSS_XML); applyToJss(doc, edits);
    expect(docShape(serializeJss(doc))).toEqual(['1 Leading: Features', '2 Second: Third']);
  });
  it('takes a chapter out with its sections and numbers the rest again; the introduction goes with its chapter', () => {
    const edits: Edit[] = [{ op: 'removeChapter', ch: 0 }];
    expect(shape(applyEdits(buildPublication(JSS_CODES), edits))).toEqual(['1 Second: 1=Second, 1.1=Third']);
    const doc = parseJss(JSS_XML); applyToJss(doc, edits);
    expect(docShape(serializeJss(doc))).toEqual(['1 Second: Third']);
  });
  it('never deletes the last chapter of a document', () => {
    const edits: Edit[] = [{ op: 'removeChapter', ch: 0 }, { op: 'removeChapter', ch: 0 }];
    expect(applyEdits(buildPublication(JSS_CODES), edits).chapters).toHaveLength(1);
    const doc = parseJss(JSS_XML); applyToJss(doc, edits); expect(doc.chapters).toHaveLength(1);
    const g = parseJsg(JSG_XML); applyToJsg(g, [{ op: 'removeChapter', ch: 0 }, { op: 'removeChapter', ch: 0 }]); expect(g.chapters).toHaveLength(1);
  });
  it('works the same for a JSG document, and the edits that follow a delete point at what is left', () => {
    const edits: Edit[] = [{ op: 'removeChapter', ch: 0 }, { op: 'renameSection', ch: 0, at: 0, title: 'Begin' }];
    const g = parseJsg(JSG_XML); applyToJsg(g, edits);
    const shown = applyEdits(buildPublication(JSG_CODES), edits);
    expect(g.chapters.map((c) => `${c.title}: ${c.sections.map((s) => s.title).join(', ')}`)).toEqual(shown.chapters.map((c) => `${c.title}: ${c.modules.map((m) => m.title).join(', ')}`));
    expect(shown.chapters[0].title).toBe('Operation'); expect(shown.chapters[0].modules[0].title).toBe('Begin');
  });
  it('ignores a delete that points at nothing', () => {
    expect(shape(applyEdits(buildPublication(JSS_CODES), [{ op: 'removeSection', ch: 0, at: 9 }, { op: 'removeChapter', ch: 9 }]))).toEqual(shape(buildPublication(JSS_CODES)));
  });
});
