// WP-21 (UX-017): the JSS find bar's search and replace over editable text.
import { describe, expect, it } from 'vitest';
import { findRanges, replaceRanges } from './FindBar';

const sheet = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; document.body.appendChild(d); return d; };

describe('find and replace in the sheet', () => {
  it('finds matches in editable text only, with and without case', () => {
    const d = sheet('<div contenteditable="true">Alpha alpha ALPHA</div><button>alpha</button><div>alpha</div>');
    expect(findRanges(d, 'alpha', false)).toHaveLength(3);
    expect(findRanges(d, 'alpha', true)).toHaveLength(1);
    expect(findRanges(d, '', false)).toHaveLength(0);
  });

  it('replaces every match of one text node (live ranges do not move the others) as one edit', () => {
    const d = sheet('<p contenteditable="true">ALPHA one ALPHA two ALPHA</p><p contenteditable="true">and ALPHA</p>');
    const events: string[] = [];
    d.addEventListener('beforeinput', () => events.push('beforeinput')); d.addEventListener('input', () => events.push('input'));
    expect(replaceRanges(findRanges(d, 'ALPHA', true), 'OMEGA')).toBe(4);
    expect(d.textContent).toBe('OMEGA one OMEGA two OMEGAand OMEGA');
    expect(events).toEqual(['beforeinput', 'input', 'input']);           // one undo step, each touched block told once
    expect(findRanges(d, 'ALPHA', true)).toHaveLength(0);
  });

  it('a replacement longer or shorter than the match keeps the other matches right', () => {
    const d = sheet('<p contenteditable="true">ab ab ab</p>');
    replaceRanges(findRanges(d, 'ab', true), 'xyz'); expect(d.textContent).toBe('xyz xyz xyz');
    replaceRanges(findRanges(d, 'xyz', true), ''); expect(d.textContent).toBe('  ');
  });
});
