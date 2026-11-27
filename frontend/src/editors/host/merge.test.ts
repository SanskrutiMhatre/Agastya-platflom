// WP-21 (PRD-004): the three-way comparison behind the conflict dialog.
import { describe, expect, it } from 'vitest';
import { buildMerged, defaultChoices, diffLines, merge3, splitLines } from './merge';
import { saveStateLabel } from './saveState';

const doc = (...lines: string[]) => lines.join('\n');

describe('diffLines', () => {
  it('finds nothing between equal texts and the exact region of a change', () => {
    expect(diffLines(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([]);
    expect(diffLines(['a', 'b', 'c'], ['a', 'X', 'c'])).toEqual([{ aStart: 1, aEnd: 2, bStart: 1, bEnd: 2 }]);
    expect(diffLines(['a', 'c'], ['a', 'b', 'c'])).toEqual([{ aStart: 1, aEnd: 1, bStart: 1, bEnd: 2 }]);
    expect(diffLines(['a', 'b', 'c'], ['a', 'c'])).toEqual([{ aStart: 1, aEnd: 2, bStart: 1, bEnd: 1 }]);
  });
  it('anchors on unique lines among repeated ones (closing tags) and keeps the changes apart', () => {
    const a = ['<s>', '<p>one</p>', '</s>', '<s>', '<p>two</p>', '</s>', '<s>', '<p>three</p>', '</s>'];
    const b = ['<s>', '<p>ONE</p>', '</s>', '<s>', '<p>two</p>', '</s>', '<s>', '<p>THREE</p>', '</s>'];
    expect(diffLines(a, b)).toEqual([{ aStart: 1, aEnd: 2, bStart: 1, bEnd: 2 }, { aStart: 7, aEnd: 8, bStart: 7, bEnd: 8 }]);
  });
  it('a large document with a change at each end stays two small hunks', () => {
    const a = Array.from({ length: 20000 }, (_, i) => `<para>line ${i}</para>`);
    const b = [...a]; b[0] = '<para>first changed</para>'; b[19999] = '<para>last changed</para>';
    expect(diffLines(a, b)).toEqual([{ aStart: 0, aEnd: 1, bStart: 0, bEnd: 1 }, { aStart: 19999, aEnd: 20000, bStart: 19999, bEnd: 20000 }]);
  });
});

describe('merge3', () => {
  const base = doc('<doc>', '<p>alpha</p>', '<p>beta</p>', '<p>gamma</p>', '<p>delta</p>', '</doc>');

  it('non-overlapping changes of both sides are separate choices; keeping all of them gives both edits', () => {
    const mine = base.replace('alpha', 'ALPHA mine');
    const theirs = base.replace('delta', 'DELTA theirs');
    const chunks = merge3(base, mine, theirs);
    const changes = chunks.filter((c) => c.kind === 'change');
    expect(changes.map((c) => c.kind === 'change' && c.side)).toEqual(['mine', 'theirs']);
    expect(chunks.some((c) => c.kind === 'conflict')).toBe(false);
    const merged = buildMerged(chunks, defaultChoices(chunks));
    expect(merged).toBe(base.replace('alpha', 'ALPHA mine').replace('delta', 'DELTA theirs'));
  });

  it('a change can be left out: the base text stays there', () => {
    const chunks = merge3(base, base.replace('alpha', 'A'), base.replace('delta', 'D'));
    const choices = defaultChoices(chunks);
    const theirsAt = chunks.findIndex((c) => c.kind === 'change' && c.side === 'theirs');
    choices[theirsAt] = false;
    expect(buildMerged(chunks, choices)).toBe(base.replace('alpha', 'A'));
  });

  it('overlapping changes are a conflict the author must decide; undecided gives no result', () => {
    const chunks = merge3(base, base.replace('beta', 'BETA mine'), base.replace('beta', 'BETA theirs'));
    const at = chunks.findIndex((c) => c.kind === 'conflict');
    expect(at).toBeGreaterThan(-1);
    const c = chunks[at]; if (c.kind !== 'conflict') throw new Error('expected a conflict');
    expect(c.base).toEqual(['<p>beta</p>']); expect(c.mine).toEqual(['<p>BETA mine</p>']); expect(c.theirs).toEqual(['<p>BETA theirs</p>']);
    const choices = defaultChoices(chunks);
    expect(buildMerged(chunks, choices)).toBeNull();
    choices[at] = 'theirs'; expect(buildMerged(chunks, choices)).toBe(base.replace('beta', 'BETA theirs'));
    choices[at] = 'mine'; expect(buildMerged(chunks, choices)).toBe(base.replace('beta', 'BETA mine'));
  });

  it('the same change on both sides is not a conflict', () => {
    const both = base.replace('gamma', 'GAMMA');
    const chunks = merge3(base, both, both);
    expect(chunks.filter((c) => c.kind !== 'same')).toEqual([{ kind: 'change', side: 'both', base: ['<p>gamma</p>'], lines: ['<p>GAMMA</p>'] }]);
    expect(buildMerged(chunks, defaultChoices(chunks))).toBe(both);
  });

  it('two insertions at the same place are left to the author (their order matters)', () => {
    const mine = base.replace('<p>beta</p>', '<p>beta</p>\n<p>new mine</p>');
    const theirs = base.replace('<p>beta</p>', '<p>beta</p>\n<p>new theirs</p>');
    expect(merge3(base, mine, theirs).some((c) => c.kind === 'conflict')).toBe(true);
  });

  it('unchanged texts merge to themselves', () => {
    const chunks = merge3(base, base, base);
    expect(chunks).toEqual([{ kind: 'same', lines: splitLines(base) }]);
    expect(buildMerged(chunks, [])).toBe(base);
  });
});

describe('saveStateLabel (one vocabulary for the three headers)', () => {
  it('says the same words in the same order of precedence', () => {
    const at = new Date(2026, 10, 27, 9, 5);
    expect(saveStateLabel({ saving: true, dirty: true, savedAt: null }).text).toBe('Saving…');
    expect(saveStateLabel({ saving: false, dirty: true, savedAt: at, failed: true })).toEqual({ text: 'Save failed: retry', tone: 'bad' });
    expect(saveStateLabel({ saving: false, dirty: true, savedAt: at })).toEqual({ text: 'Unsaved changes', tone: 'warn' });
    expect(saveStateLabel({ saving: false, dirty: true, savedAt: null, dirtyCount: 3 }).text).toBe('Unsaved changes (3 documents)');
    expect(saveStateLabel({ saving: false, dirty: false, savedAt: at })).toEqual({ text: 'Saved 09:05', tone: 'ok' });
    expect(saveStateLabel({ saving: false, dirty: false, savedAt: null })).toEqual({ text: 'All changes saved', tone: 'ok' });
    expect(saveStateLabel({ saving: false, dirty: false, savedAt: null, failed: true }).text).toBe('All changes saved');   // a failure that was later fixed is not shown
  });
});
