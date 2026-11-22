import { describe, expect, it } from 'vitest';
import { countOf, getAt, insertAt, moveTo, removeAt, shiftBy, type PmEntry } from './pmcTree';
import { toPublicationSettings } from './publicationSettings';
import { getPath, withPath } from './configPath';

const dm = (code: string): PmEntry => ({ type: 'dm', dmCode: { modelIdentCode: code }, techName: code });
const book = (): PmEntry[] => [
  { type: 'folder', title: 'One', children: [dm('A'), dm('B')] },
  { type: 'folder', title: 'Two', children: [] },
];

describe('publication tree (reused from Agastya V1)', () => {
  it('counts chapters and modules at every depth', () => {
    expect(countOf(book())).toMatchObject({ folders: 2, dms: 2 });
  });

  it('never mutates the entries it is given', () => {
    const before = JSON.stringify(book());
    const b = book();
    insertAt(b, [1], 0, dm('C'));
    removeAt(b, [0, 0]);
    moveTo(b, [0, 0], [1], 0);
    expect(JSON.stringify(b)).toBe(before);
  });

  it('moves a module into another chapter without losing or duplicating it', () => {
    const next = moveTo(book(), [0, 1], [1], 0);
    expect(countOf(next).dms).toBe(2);
    expect((getAt(next, [1, 0]) as { techName?: string }).techName).toBe('B');
    expect((getAt(next, [0]) as { children: PmEntry[] }).children).toHaveLength(1);
  });

  it('inserts at a position inside a chapter', () => {
    const next = insertAt(book(), [0], 1, dm('X'));
    expect((getAt(next, [0, 1]) as { techName?: string }).techName).toBe('X');
    expect(countOf(next).dms).toBe(3);
  });

  it('refuses to drop a chapter inside itself (it would vanish from the book)', () => {
    const b = book();
    const moved = moveTo(b, [0], [0], 0);
    expect(countOf(moved)).toEqual(countOf(b));
  });
});

describe('moving a module one place (the up/down buttons)', () => {
  const names = (list: PmEntry[]) => list.map((e) => (e as { techName?: string }).techName);
  const three = (): PmEntry[] => [{ type: 'folder', title: 'C', children: [dm('A'), dm('B'), dm('C')] }];

  it('moves down by exactly one place', () => {
    const next = shiftBy(three(), [0, 0], 1);
    expect(names((next[0] as { children: PmEntry[] }).children)).toEqual(['B', 'A', 'C']);
  });
  it('moves up by exactly one place', () => {
    const next = shiftBy(three(), [0, 2], -1);
    expect(names((next[0] as { children: PmEntry[] }).children)).toEqual(['A', 'C', 'B']);
  });
  it('does nothing at either end, and returns the same array', () => {
    const b = three();
    expect(shiftBy(b, [0, 0], -1)).toBe(b);
    expect(shiftBy(b, [0, 2], 1)).toBe(b);
  });
  it('moves whole chapters at the top level too, keeping their modules', () => {
    const next = shiftBy(book(), [0], 1);
    expect((next[0] as { title: string }).title).toBe('Two');
    expect(countOf(next).dms).toBe(2);
  });
});

describe('quick-preview settings come from the project, not from the editor', () => {
  it('uses the book name, publication number and classification text', () => {
    const s = toPublicationSettings({ name: 'Pump', publication: { bookName: 'User Handbook', systemName: 'Hydraulic Pump', publicationNo: 'PN-1', securityClassification: 'RESTRICTED' } }, {});
    expect(s).toMatchObject({ title: 'User Handbook', shortTitle: 'Hydraulic Pump', pmCode: 'PN-1', classification: 'RESTRICTED' });
  });

  it('leaves a numeric S1000D code to each data module (it is not display text)', () => {
    expect(toPublicationSettings({ publication: { securityClassification: '02' } }, {}).classification).toBe('');
  });

  it('prints the project watermark text only when one is enabled', () => {
    expect(toPublicationSettings({ watermark: { enabled: true, text: 'CONTROLLED COPY' } }, {}).watermarkText).toBe('CONTROLLED COPY');
    expect(toPublicationSettings({ watermark: { enabled: false, text: 'X' } }, {}).watermarkText).toBe('NOT RELEASED');
  });
});

describe('dotted config paths used by the settings screen', () => {
  it('reads and writes nested values without mutating the source', () => {
    const src = { layout: { page: { width: '210mm' } } };
    const next = withPath(src, 'layout.page.height', '297mm');
    expect(getPath(next, 'layout.page.height')).toBe('297mm');
    expect(getPath(src, 'layout.page.height')).toBeUndefined();
  });
});
