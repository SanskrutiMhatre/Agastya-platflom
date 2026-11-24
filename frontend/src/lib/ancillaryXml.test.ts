import { describe, expect, it } from 'vitest';
import { parsePage } from './ancillaryXml';

const FOREWORD = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generated. -->
<foreword>
    <para>Every care has been taken &amp; checked.</para>
    <deflist>
        <defitem><term>E-mail Address</term><def>a@b.example</def></defitem>
        <defitem><term>Postal Address</term><def><line>Head, Documentation,</line><line>Mumbai - 400 072.</line></def></defitem>
    </deflist>
</foreword>`;

describe('the words of an ancillary page', () => {
  it('lists each piece of text in reading order, named by what it is', () => {
    const p = parsePage(FOREWORD)!;
    expect(p.fields.map((f) => f.label)).toEqual(['Paragraph 1', 'Label', 'E-mail Address', 'Label', 'Postal Address', 'Postal Address']);
    expect(p.fields[0].value).toBe('Every care has been taken & checked.');
    expect(p.fields[5].where).toBe('def > line');
  });

  it('puts edited text back in the same place and leaves the tags, comments and untouched text exactly as they were', () => {
    const p = parsePage(FOREWORD)!;
    const out = p.withValues({ 2: 'new@b.example', 0: 'Taken <care> & more.' });
    expect(out).toContain('<!-- Generated. -->');
    expect(out).toContain('<def>new@b.example</def>');
    expect(out).toContain('<para>Taken &lt;care&gt; &amp; more.</para>');
    expect(out).toContain('<line>Head, Documentation,</line><line>Mumbai - 400 072.</line>');
    expect(parsePage(out)!.fields.map((f) => f.value)).toEqual(['Taken <care> & more.', 'E-mail Address', 'new@b.example', 'Postal Address', 'Head, Documentation,', 'Mumbai - 400 072.']);
  });

  it('with nothing changed, the page is written back as it was parsed', () => {
    const p = parsePage(FOREWORD)!; const out = p.withValues({});
    expect(parsePage(out)!.fields.map((f) => f.value)).toEqual(p.fields.map((f) => f.value));
  });

  it('refuses text that is not XML', () => { expect(parsePage('<foreword><para>x</foreword>')).toBeNull(); });

  it('a page with no text (a form filled in by hand) has no fields', () => { expect(parsePage('<recordOfChanges><table><row><cell/></row></table></recordOfChanges>')!.fields).toEqual([]); });
});
