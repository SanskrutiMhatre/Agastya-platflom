import { describe, expect, it } from 'vitest';
import { excerpt, tokenizeXmlLine } from './ValidationSource';

describe('validation source excerpt', () => {
  it('splits a line of XML into tag, attribute, value, bracket, comment and text tokens, losing nothing', () => {
    const line = '  <proceduralStep id="stp-0003"><para>Release</para><!-- note -->';
    const toks = tokenizeXmlLine(line);
    expect(toks.map((t) => t.s).join('')).toBe(line);
    expect(toks.filter((t) => t.k === 't').map((t) => t.s)).toEqual(['proceduralStep', 'para', 'para']);
    expect(toks.find((t) => t.k === 'a')?.s).toBe('id');
    expect(toks.find((t) => t.k === 'v')?.s).toBe('"stp-0003"');
    expect(toks.find((t) => t.k === 'c')?.s).toBe('<!-- note -->');
  });
  it('takes two lines before the reported line and one after (as the mockup draws it), kept inside the file', () => {
    const text = ['a', 'b', 'c', 'd', 'e', 'f'].join('\n');
    expect(excerpt(text, 3).map((l) => l.n)).toEqual([1, 2, 3, 4]);
    expect(excerpt(text, 1).map((l) => l.s)).toEqual(['a', 'b']);
    expect(excerpt(text, 99).map((l) => l.n)).toEqual([4, 5, 6]);
    expect(excerpt(text, 3, 2, 2).map((l) => l.n)).toEqual([1, 2, 3, 4, 5]);
  });
  it('takes off the indentation the lines share, keeping the relative indentation', () => {
    const text = ['        <a>', '          <b/>', '', '        </a>'].join('\n');
    expect(excerpt(text, 2, 1, 2).map((l) => l.s)).toEqual(['<a>', '  <b/>', '', '</a>']);
    expect(excerpt('\t<a/>\n\t\t<b/>', 2).map((l) => l.s)).toEqual(['<a/>', '  <b/>']);
  });
});
