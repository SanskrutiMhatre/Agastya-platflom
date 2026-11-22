// Negative controls for the editor suggestion checks: a CORRUPTED grammar served to the real editor must be caught.
// Kept in a file of its own because the grammar loader caches per issue/type for the lifetime of a module: here each corrupted
// grammar is the first one loaded for its key (descript 5-0 and proced 5-0 respectively).
import { describe, it, expect, vi } from 'vitest';
import { gramJson, richDm } from './lib';
import { bootApp } from './harness';
import { suggestionFindings } from './editorChecks';

function serveCorrupted(file: string, bad: unknown) {
  const realFetch = globalThis.fetch as unknown as (u: string) => Promise<unknown>;
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (u: string) =>
    String(u).endsWith(file) ? { ok: true, status: 200, json: async () => bad, text: async () => JSON.stringify(bad) } : realFetch(u));
}

describe('negative control: a corrupted grammar served to the editor is caught', () => {
  it('<emphasis> wrongly allowed inside <description>: the editor then offers it, and the checks report it', async () => {
    const bad = JSON.parse(JSON.stringify(gramJson('5-0', 'descript')));
    const d = bad.types[bad.elements.description];
    d.c = { k: 's', a: [d.c, { k: 'e', n: 'emphasis', m: 0, x: -1 }] };
    const app = bootApp();
    serveCorrupted('grammar/5-0/descript.json', bad);
    const text = richDm('descript', '5-0');
    const ed = (await app.openText(text, 'dm.xml', null))!;
    const f = await suggestionFindings(ed, '5-0', 'descript', text, 40);
    expect(f.foreignOffered.some((x) => x.includes('<emphasis>') && x.includes('<description>')), 'the corruption must be reported').toBe(true);
  }, 180_000);

  it('a legal tag hidden by a corrupted grammar (<legend> after a <graphic>) is reported as a missing suggestion', async () => {
    const bad = JSON.parse(JSON.stringify(gramJson('5-0', 'proced')));
    const strip = (p: any): any => (p && p.a ? { ...p, a: p.a.filter((c: any) => !(c.k === 'e' && c.n === 'legend')).map(strip) } : p);
    const fg = bad.types[bad.elements.figure];
    bad.types[bad.elements.figure] = { ...fg, c: strip(fg.c) };
    const app = bootApp();
    serveCorrupted('grammar/5-0/proced.json', bad);
    // a procedural module carrying a figure with a graphic, so a legend is the XSD-legal next tag
    const base = richDm('proced', '5-0');
    const withFigure = base.replace('<para>Open the access panel.</para>', '<para>Open the access panel.</para>\n      <figure id="fig-0001"><title>Panel</title><graphic infoEntityIdent="ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01"/></figure>').replace('<dmodule ', '<!DOCTYPE dmodule [\n  <!NOTATION svg SYSTEM "svg">\n  <!ENTITY ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01 SYSTEM "x.svg" NDATA svg>\n]>\n<dmodule ');
    expect(withFigure).toContain('<figure');
    const ed = (await app.openText(withFigure, 'dm.xml', null))!;
    const f = await suggestionFindings(ed, '5-0', 'proced', withFigure, 60);
    expect(f.complete.some((x) => x.includes('<legend>')), 'the missing suggestion must be reported').toBe(true);
  }, 180_000);
});
