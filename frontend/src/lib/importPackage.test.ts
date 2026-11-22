import { describe, expect, it } from 'vitest';
import type { ImportChange, ImportFinding, ImportReport, ImportRule, PoolModule, Unassigned } from '../api/importer';
import {
  PACKAGE_MAX_BYTES, PACKAGE_MAX_FILES, type ImportChoices, baseName, blockingFindings, bucketFindings, buildAssignBody, buildPackageForm, cap, countTiles, defaultRepairs, describeSelection,
  destinationOptions, filterBy, findingLabel, flavourLabel, groupChangeLog, groupFindings, groupPool, importOptions, makeSelection, parseDestination, plural, repairRows,
  selectionProblem, showMore, truncate,
} from './importPackage';

const file = (name: string, size = 10, rel = ''): File => {
  const f = new File([new Uint8Array(size)], name);
  if (rel) Object.defineProperty(f, 'webkitRelativePath', { value: rel });
  return f;
};
const finding = (o: Partial<ImportFinding> & { id: string }): ImportFinding => ({ severity: 'warning', rule: 'package', message: o.id, ...o });
const fmt = (n: number): string => `${n} B`;

describe('what the person picked', () => {
  it('keeps a folder pick\'s relative path and uses the file name for files and zips', () => {
    const folder = makeSelection([file('a.xml', 5, 'Pkg/XML/a.xml'), file('b.png', 7, 'Pkg/b.png')], 'folder');
    expect(folder.picks.map((p) => p.path)).toEqual(['Pkg/XML/a.xml', 'Pkg/b.png']);
    expect(folder.folderName).toBe('Pkg');
    expect(folder.bytes).toBe(12);
    const loose = makeSelection([file('a.xml'), file('b.png')], 'files');
    expect(loose.picks.map((p) => p.path)).toEqual(['a.xml', 'b.png']);
    expect(loose.folderName).toBe('');
    const zip = makeSelection([file('package.ZIP', 100)], 'zip');
    expect(zip.zips).toBe(1);
  });

  it('describes the selection in one plain line', () => {
    expect(describeSelection(makeSelection([file('a.xml', 5, 'Pkg/a.xml'), file('b.xml', 5, 'Pkg/b.xml')], 'folder'), fmt)).toBe('2 files in the folder Pkg, 10 B');
    expect(describeSelection(makeSelection([file('x.zip', 9)], 'zip'), fmt)).toBe('1 file (a zip), 9 B');
    expect(describeSelection(makeSelection([file('a.xml', 3)], 'files'), fmt)).toBe('1 file, 3 B');
  });

  it('refuses an empty selection and the server\'s limits before anything is uploaded', () => {
    expect(selectionProblem(null)).toMatch(/Choose the package/);
    expect(selectionProblem(makeSelection([], 'files'))).toMatch(/Choose the package/);
    expect(selectionProblem(makeSelection([file('a.xml')], 'files'))).toBeNull();
    const many = makeSelection(Array.from({ length: PACKAGE_MAX_FILES + 1 }, (_, i) => file(`f${i}.xml`, 1)), 'files');
    expect(selectionProblem(many)).toMatch(/at most 5000 files/);
    const big = makeSelection([file('huge.zip', 1)], 'zip');
    big.bytes = PACKAGE_MAX_BYTES + 1;
    expect(selectionProblem(big)).toMatch(/at most 1024 MB/);
  });

  it('builds the upload: files in order, paths only when a folder gave some, options only when set', () => {
    const plainForm = buildPackageForm(makeSelection([file('a.xml'), file('b.png')], 'files'));
    expect(plainForm.getAll('files')).toHaveLength(2);
    expect(plainForm.has('paths')).toBe(false);
    expect(plainForm.has('options')).toBe(false);
    const sel = makeSelection([file('a.xml', 1, 'Pkg/XML/a.xml'), file('b.png', 1, 'Pkg/b.png')], 'folder');
    const fd = buildPackageForm(sel, { repairs: ['table-cols'], overwrite: true });
    expect(JSON.parse(String(fd.get('paths')))).toEqual(['Pkg/XML/a.xml', 'Pkg/b.png']);
    expect(JSON.parse(String(fd.get('options')))).toEqual({ repairs: ['table-cols'], overwrite: true });
    expect((fd.getAll('files') as File[]).map((f) => f.name)).toEqual(['a.xml', 'b.png']);
  });
});

describe('the report', () => {
  const counts: ImportReport['counts'] = { files: 712, bytes: 4096, dms: 218, brex: 0, pmcs: 1, icns: 480, images: 0, other: 2, ignored: 0 };

  it('tiles show what is there; zero counts are left out but the modules stay', () => {
    expect(countTiles(counts).map((t) => t.key)).toEqual(['dms', 'pmcs', 'icns', 'other']);
    expect(countTiles({ ...counts, dms: 0, pmcs: 0, icns: 0, other: 0 }).map((t) => t.key)).toEqual(['dms']);
  });

  it('names the flavours and finding ids plainly, and falls back to the raw id', () => {
    expect(flavourLabel('vektra')).toBe('Vektra');
    expect(flavourLabel('something-new')).toBe('something-new');
    expect(findingLabel('table-cols-overflow')).toMatch(/Table rows wider/);
    expect(findingLabel('a-new-finding')).toBe('a-new-finding');
  });

  it('groups findings by id: the worst first, then the biggest, and counts the files in each', () => {
    const groups = groupFindings([
      finding({ id: 'icn-missing', file: 'a.xml' }), finding({ id: 'icn-missing', file: 'a.xml' }), finding({ id: 'icn-missing', file: 'b.xml' }),
      finding({ id: 'xml-malformed', severity: 'error', file: 'c.xml' }),
      finding({ id: 'pmc-unmodelled', severity: 'info' }),
      finding({ id: 'dm-name-mismatch', file: 'd.xml' }),
    ]);
    expect(groups.map((g) => g.id)).toEqual(['xml-malformed', 'icn-missing', 'dm-name-mismatch', 'pmc-unmodelled']);
    expect(groups[1].count).toBe(3);
    expect(groups[1].files).toEqual(['a.xml', 'b.xml']);
  });

  it('separates what the import repairs from what only a person can fix, and what is just information', () => {
    const b = bucketFindings([
      finding({ id: 'table-cols-overflow', severity: 'error', rule: 'table-cols', repairable: true }),
      finding({ id: 'pmc-dmref-issue', severity: 'info', rule: 'pmc-dmref-identity', repairable: true }),
      finding({ id: 'xml-malformed', severity: 'error' }),
      finding({ id: 'dm-name-mismatch' }),
      finding({ id: 'pmc-unmodelled', severity: 'info' }),
    ]);
    expect(b.repaired.map((g) => g.id).sort()).toEqual(['pmc-dmref-issue', 'table-cols-overflow']);
    expect(b.reportOnly.map((g) => g.id)).toEqual(['xml-malformed', 'dm-name-mismatch']);
    expect(b.info.map((g) => g.id)).toEqual(['pmc-unmodelled']);
  });

  it('blocking findings are errors nothing repairs', () => {
    const all = [finding({ id: 'a', severity: 'error', repairable: true }), finding({ id: 'b', severity: 'error' }), finding({ id: 'c' })];
    expect(blockingFindings(all).map((f) => f.id)).toEqual(['b']);
  });

  const rules: ImportRule[] = [
    { id: 'table-cols', title: 'Fix table column counts', defaultOn: true, description: '' },
    { id: 'brex-remap', title: 'Re-point the BREX reference', defaultOn: false, description: '' },
  ];
  it('joins each rule with what it would do and reads the defaults from the server', () => {
    expect(defaultRepairs(rules)).toEqual(['table-cols']);
    const rows = repairRows(rules, [{ rule: 'table-cols', title: 'x', defaultOn: true, items: 12, files: 3 }, { rule: 'orphans-pool', title: 'y', defaultOn: true, items: 4, files: 4 }]);
    expect(rows.map((r) => [r.id, r.items, r.files])).toEqual([['table-cols', 12, 3], ['brex-remap', 0, 0]]);
  });

  it('sends only what differs from the server\'s defaults, and keeps apply-only options out of a scan', () => {
    const base: ImportChoices = { repairs: ['table-cols'], defaults: ['table-cols'], overwrite: false, publication: 'auto', neutraliseMissingBrex: false };
    const s = (o: Partial<ImportChoices>): ImportChoices => ({ ...base, ...o });
    expect(importOptions(s({}), true)).toEqual({});
    expect(importOptions(s({ repairs: [] }), false)).toEqual({ repairs: [] });
    expect(importOptions(s({ overwrite: true, publication: 'keep', neutraliseMissingBrex: true }), false)).toEqual({ neutraliseMissingBrex: true });
    expect(importOptions(s({ overwrite: true, publication: 'keep', neutraliseMissingBrex: true }), true)).toEqual({ neutraliseMissingBrex: true, overwrite: true, publication: 'keep' });
  });
});

describe('the change log', () => {
  const rules: ImportRule[] = [{ id: 'table-cols', title: 'Fix table column counts', defaultOn: true, description: '' }, { id: 'icn-placeholder', title: 'Placeholder for missing graphics', defaultOn: true, description: '' }];
  const c = (o: Partial<ImportChange> & { seq: number; rule: ImportChange['rule']; file: string }): ImportChange => ({ kind: 'edit', before: '', after: '', ...o });

  it('groups by rule (in the order the repairs run) and then by file, with counts per kind', () => {
    const groups = groupChangeLog([
      c({ seq: 1, rule: 'icn-placeholder', file: 'b.xml' }), c({ seq: 2, rule: 'table-cols', file: 'z.xml' }), c({ seq: 3, rule: 'table-cols', file: 'a.xml' }), c({ seq: 4, rule: 'table-cols', file: 'a.xml' }),
      c({ seq: 5, rule: 'icn-placeholder', file: 'ICN-1.png', kind: 'add', synthetic: true }), c({ seq: 6, rule: 'pmc-reconstruct', file: 'PMC.xml', kind: 'note' }),
    ], rules);
    expect(groups.map((g) => g.rule)).toEqual(['table-cols', 'icn-placeholder', 'pmc-reconstruct']);
    expect(groups[0].title).toBe('Fix table column counts');
    expect(groups[0].files.map((f) => [f.file, f.entries.length])).toEqual([['a.xml', 2], ['z.xml', 1]]);
    expect(groups[1]).toMatchObject({ total: 2, edits: 1, adds: 1, synthetic: 1 });
    expect(groups[2]).toMatchObject({ title: 'pmc-reconstruct', notes: 1 });                  // an unknown rule keeps its id as its title
    expect(groupChangeLog([c({ seq: 1, rule: 'orphans-pool', file: 'x.xml', kind: 'note' })], rules)[0].title).toMatch(/unassigned list/);
  });

  it('an empty log has no groups', () => { expect(groupChangeLog([], rules)).toEqual([]); });

  it('cuts long before/after text on one line and marks the cut', () => {
    expect(truncate('a   b\n c')).toBe('a b c');
    expect(truncate('x'.repeat(50), 10)).toBe(`${'x'.repeat(9)}…`);
    expect(baseName('XML\\DMC-1.xml')).toBe('DMC-1.xml');
    expect(baseName('DMC-1.xml')).toBe('DMC-1.xml');
  });
});

describe('long lists are capped, never rendered whole unasked', () => {
  const items = Array.from({ length: 700 }, (_, i) => i);
  it('shows the first rows and says how many are held back', () => {
    const v = cap(items, 25);
    expect(v.items).toHaveLength(25);
    expect(v.hidden).toBe(675);
    expect(cap(items, 1000)).toEqual({ items, hidden: 0 });
    expect(cap(items, -3)).toEqual({ items: [], hidden: 700 });
  });
  it('"show more" goes a page at a time and never past the end', () => {
    expect(showMore(25, 700, 100)).toBe(125);
    expect(showMore(650, 700, 100)).toBe(700);
  });
  it('filters over the text parts, ignoring case, and returns everything for an empty filter', () => {
    const files = [{ p: 'XML/DMC-ABC.xml' }, { p: 'ICN/ICN-1.png' }];
    expect(filterBy(files, 'icn', (f) => f.p)).toHaveLength(1);
    expect(filterBy(files, '  ', (f) => f.p)).toHaveLength(2);
    expect(filterBy(files, 'zzz', (f) => f.p)).toHaveLength(0);
  });
  it('counts in plain words', () => {
    expect(plural(1, 'file')).toBe('1 file');
    expect(plural(0, 'file')).toBe('0 files');
    expect(plural(2, 'entry', 'entries')).toBe('2 entries');
  });
});

describe('placing the unassigned modules', () => {
  const u: Pick<Unassigned, 'targets' | 'subPublications'> = {
    targets: [
      { path: [0], title: 'Hydraulics', kind: 'folder', modules: 2, depth: 0 },
      { path: [0, 1], title: 'Pumps', kind: 'folder', modules: 1, depth: 1 },
      { path: [2], title: 'Annexure A', kind: 'pmRef', modules: 0, pmCode: 'TST-1671Y-00010-00', depth: 0 },
    ],
    subPublications: [
      { pmCode: 'TST-1671Y-00010-00', title: 'Annexure A', status: 'anchor-only', materialisedAs: null },
      { pmCode: 'TST-1671Y-00020-00', title: 'Annexure B', status: 'anchor-only', materialisedAs: 'Annexure B - Radar' },
    ],
  };
  it('offers the top of the publication, every chapter, and every sub-publication once', () => {
    const o = destinationOptions(u);
    expect(o.map((x) => x.value)).toEqual(['root', 'f:0', 'f:0.1', 's:TST-1671Y-00010-00', 's:TST-1671Y-00020-00']);
    expect(o[1].label).toBe('Hydraulics (2 modules)');
    expect(o[2].label.startsWith(' ')).toBe(true);                     // a nested chapter is indented
    expect(o[3].label).toMatch(/becomes a chapter, title page first/);
    expect(o[4].label).toMatch(/already|add to its chapter/);
  });
  it('turns the choice back into a destination, falling back to the top level', () => {
    const o = destinationOptions(u);
    expect(parseDestination('f:0.1', o)).toEqual({ kind: 'folder', path: [0, 1] });
    expect(parseDestination('s:TST-1671Y-00010-00', o)).toEqual({ kind: 'sub', pmCode: 'TST-1671Y-00010-00' });
    expect(parseDestination('f:9', o)).toEqual({ kind: 'root' });
  });
  it('builds the assign request the server expects', () => {
    expect(buildAssignBody(['a.xml'], { kind: 'root' })).toEqual({ files: ['a.xml'], to: { folderPath: [] } });
    expect(buildAssignBody(['a.xml'], { kind: 'folder', path: [0, 1] }, { newFolder: '  New  ', position: 'start' })).toEqual({ files: ['a.xml'], to: { folderPath: [0, 1], newFolder: 'New', position: 'start' } });
    expect(buildAssignBody(['a.xml', 'b.xml'], { kind: 'sub', pmCode: 'X-1' })).toEqual({ files: ['a.xml', 'b.xml'], to: { subPublication: 'X-1' } });
  });
  it('groups the pool by system, the ungrouped last', () => {
    const m = (file: string, group: string): PoolModule => ({ file, dmc: file, techName: file, infoName: '', infoCode: '040', reason: 'not-in-any-pmc', group });
    const g = groupPool([m('a', '20-10'), m('b', ''), m('c', '10-00'), m('d', '20-10')]);
    expect(g.map((x) => x.group)).toEqual(['10-00', '20-10', '']);
    expect(g[1].items.map((i) => i.file)).toEqual(['a', 'd']);
  });
});
