import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import type { DeriveResult, LearnProposal, MergeSummary, OrderingInfo, SnsProblem, SnsRow, StructModule } from '../api/sns';
import type { ProjectRole, User } from '../api';
import {
  CODE_PATTERNS, DEFAULT_DERIVE, DEFAULT_MIN_CONFIDENCE, ORDER_KEYS, acceptedKeys, ancestorIds, buildOrder, buildTree, changesNode, childForm, childrenRefused, confidenceTone, countDms,
  deriveBody, deriveConfirmation, deriveSignature, descendantsOf, displayCode, emptyForm, errorLines, flattenTree, formatRank, groupMerge, hasErrors, hiddenByThreshold, importBody,
  initialOpen, isAcceptable, learnApplyBody, learnPreviewBody, levelOf, matchesQuery, mergeOutcome, moveKey, orderFormFrom, orderProblems, parentIds, parseCodeList, parseRankLines,
  parseThreshold, pct, problemsByRow, rowBody, rowKey, sameOrder, sampleCodes, sortRows, structureTiles, summariseProblems, validateForm, visibleProposals, OPEN_ALL_UP_TO,
} from './sns';
import { canEditSns, canEditSnsDefaults } from './roles';

let n = 0;
const row = (o: Partial<SnsRow> & { title?: string }): SnsRow => ({
  id: o.id ?? `r${++n}`, systemDiffCode: '', systemCode: 'A05', subSystemCode: '', subSubSystemCode: '', assyCode: '', title: 'T', ...o,
});
const SYS = row({ id: 'sys', systemCode: '32', title: 'Landing gear' });
const SUB = row({ id: 'sub', systemCode: '32', subSystemCode: '1', title: 'Main gear' });
const SUBSUB = row({ id: 'ss', systemCode: '32', subSystemCode: '1', subSubSystemCode: '0', title: 'Main gear (general)' });
const ASSY = row({ id: 'asy', systemCode: '32', subSystemCode: '1', subSubSystemCode: '0', assyCode: '10', title: 'Shock strut' });
const OTHER = row({ id: 'oth', systemCode: '29', title: 'Hydraulic power' });

describe('codes and levels', () => {
  it('names the level a row sits at by the deepest code it carries', () => {
    expect(levelOf(SYS)).toBe('system');
    expect(levelOf(SUB)).toBe('subsystem');
    expect(levelOf(SUBSUB)).toBe('subsubsystem');
    expect(levelOf(ASSY)).toBe('assy');
  });
  it('writes a code the way the data module code spells it, and gives each node one key', () => {
    expect(displayCode(SYS)).toBe('32');
    expect(displayCode(SUB)).toBe('32-1');
    expect(displayCode(SUBSUB)).toBe('32-10');
    expect(displayCode(ASSY)).toBe('32-10-10');
    expect(rowKey(ASSY)).toBe('|32|1|0|10');
    expect(rowKey({ ...ASSY, systemDiffCode: 'B' })).not.toBe(rowKey(ASSY));
  });
  it('sorts by system, difference code, sub-system, sub-sub-system, assembly, then title', () => {
    const rows = [ASSY, row({ systemCode: '32', systemDiffCode: 'B', title: 'b' }), SUB, OTHER, SYS];
    expect(sortRows(rows).map((r) => `${r.systemCode}/${r.systemDiffCode}/${r.subSystemCode}`)).toEqual(['29//', '32//', '32//1', '32//1', '32/B/']);
  });
});

describe('the form\'s own checks (the server\'s rules and wording)', () => {
  const ok = { ...emptyForm(), systemCode: 'A05', title: 'Maintenance' };
  it('accepts a complete system, sub-system, sub-sub-system and assembly', () => {
    expect(hasErrors(validateForm(ok))).toBe(false);
    expect(hasErrors(validateForm({ ...ok, subSystemCode: '4', subSubSystemCode: '0', assyCode: '00' }))).toBe(false);
    expect(hasErrors(validateForm({ ...ok, subSystemCode: '4', subSubSystemCode: '0', assyCode: '0A0B', systemDiffCode: 'AB' }))).toBe(false);
  });
  it('treats lower case as upper case, as the server does', () => {
    expect(hasErrors(validateForm({ ...ok, systemCode: 'a05', subSystemCode: 'x' }))).toBe(false);
    expect(rowBody({ ...ok, systemCode: ' a05 ', subSystemCode: 'x' })).toMatchObject({ systemCode: 'A05', subSystemCode: 'X' });
  });
  it('says what is wrong with each code, quoting the rule', () => {
    expect(validateForm({ ...ok, systemCode: 'A' }).systemCode).toBe('System code "A" is not valid: it must be 2 or 3 letters or digits, upper case.');
    expect(validateForm({ ...ok, systemCode: 'ABCD' }).systemCode).toMatch(/not valid/);
    expect(validateForm({ ...ok, subSystemCode: '12', subSubSystemCode: '0' }).subSystemCode).toMatch(/Sub-system code "12"/);
    expect(validateForm({ ...ok, subSystemCode: '1', subSubSystemCode: '0', assyCode: '100' }).assyCode).toMatch(/2 or 4 letters or digits/);
    expect(validateForm({ ...ok, systemDiffCode: 'ABCDE' }).systemDiffCode).toMatch(/System difference code "ABCDE"/);
    expect(validateForm({ ...ok, systemCode: 'A-5' }).systemCode).toMatch(/not valid/);
  });
  it('uses the server\'s own wording of the rule when it sent one', () => {
    expect(validateForm({ ...ok, systemCode: 'A' }, { systemCode: 'two or three characters' }).systemCode).toContain('two or three characters');
  });
  it('needs the levels above a code', () => {
    expect(validateForm({ ...ok, subSubSystemCode: '0' }).subSubSystemCode).toBe('A sub-sub-system code needs a sub-system code.');
    expect(validateForm({ ...ok, assyCode: '00' }).assyCode).toMatch(/needs a sub-system code and a sub-sub-system code/);
    expect(validateForm({ ...ok, subSystemCode: '4', assyCode: '00' }).assyCode).toMatch(/needs a sub-system code and a sub-sub-system code/);
  });
  it('needs a system code and a title, and keeps the title within the limit', () => {
    expect(validateForm(emptyForm())).toMatchObject({ systemCode: 'System code is required.', title: 'A title is required.' });
    expect(validateForm({ ...ok, title: '   ' }).title).toBe('A title is required.');
    expect(validateForm({ ...ok, title: 'x'.repeat(256) }).title).toMatch(/longer than 255/);
    expect(validateForm({ ...ok, title: 'x'.repeat(255) }).title).toBeUndefined();
  });
  it('mirrors the patterns the server enforces', () => {
    expect(CODE_PATTERNS.assyCode.re.test('100')).toBe(false);
    expect(CODE_PATTERNS.assyCode.re.test('10')).toBe(true);
    expect(CODE_PATTERNS.assyCode.re.test('1000')).toBe(true);
    expect(CODE_PATTERNS.systemCode.re.test('A05')).toBe(true);
    expect(CODE_PATTERNS.subSystemCode.re.test('A')).toBe(true);
  });
  it('sends codes upper case and a title with its white space collapsed and control characters removed', () => {
    expect(rowBody({ systemDiffCode: ' b ', systemCode: 'a05', subSystemCode: '4', subSubSystemCode: '0', assyCode: '', title: '  Preventive \t maintenance\n ' })).toEqual({
      systemDiffCode: 'B', systemCode: 'A05', subSystemCode: '4', subSubSystemCode: '0', assyCode: '', title: 'Preventive maintenance',
    });
  });
  it('offers a row below a row, with the parent\'s codes filled in and the field to fill next; nothing below an assembly', () => {
    expect(childForm(SYS)).toEqual({ form: { ...rowBody(SYS), title: '' }, field: 'subSystemCode' });
    expect(childForm(SUB)!.field).toBe('subSubSystemCode');
    expect(childForm(SUBSUB)!.field).toBe('assyCode');
    expect(childForm(ASSY)).toBeNull();
    expect(childForm({ ...SYS, systemDiffCode: 'B' })!.form.systemDiffCode).toBe('B');
  });
  it('knows when a change moves the row to another node', () => {
    expect(changesNode(SYS, { ...SYS, title: 'Undercarriage' })).toBe(false);
    expect(changesNode(SYS, { ...SYS, systemCode: '33' })).toBe(true);
    expect(changesNode(SYS, { ...SYS, systemDiffCode: 'B' })).toBe(true);
  });
});

describe('the tree', () => {
  it('nests system > sub-system > sub-sub-system > assembly, in code order', () => {
    const tree = buildTree([ASSY, OTHER, SUBSUB, SYS, SUB]);
    expect(tree.map((t) => t.row.id)).toEqual(['oth', 'sys']);
    const sys = tree[1];
    expect(sys.children.map((c) => c.row.id)).toEqual(['sub']);
    expect(sys.children[0].children[0].children[0].row.id).toBe('asy');
    expect(sys.children[0].children[0].level).toBe('subsubsystem');
  });
  it('makes a row without a parent a root rather than losing it', () => {
    const tree = buildTree([SUB, OTHER]);
    expect(tree.map((t) => t.row.id).sort()).toEqual(['oth', 'sub']);
  });
  it('hangs a difference-coded row from its own parent, else from the one that applies to every difference code', () => {
    const b = row({ id: 'sysB', systemDiffCode: 'B', systemCode: '32', title: 'Gear B' });
    const subB = row({ id: 'subB', systemDiffCode: 'B', systemCode: '32', subSystemCode: '1', title: 'Main gear B' });
    const subC = row({ id: 'subC', systemDiffCode: 'C', systemCode: '32', subSystemCode: '1', title: 'Main gear C' });
    const tree = buildTree([SYS, b, subB, subC]);
    const byId = (id: string) => tree.find((t) => t.row.id === id)!;
    expect(byId('sysB').children.map((c) => c.row.id)).toEqual(['subB']);
    expect(byId('sys').children.map((c) => c.row.id)).toEqual(['subC']);        // C has no system of its own: the one for every difference code
  });
  it('keeps a duplicate as a row of its own, attached to the first of the pair', () => {
    const twin = row({ id: 'twin', systemCode: '32', title: 'Undercarriage' });
    const tree = buildTree([SYS, twin, SUB]);
    expect(tree).toHaveLength(2);
    expect(tree.flatMap((t) => t.children).map((c) => c.row.id)).toEqual(['sub']);
  });
  it('does not change its input', () => {
    const rows = [ASSY, SYS];
    const copy = JSON.stringify(rows);
    buildTree(rows);
    expect(JSON.stringify(rows)).toBe(copy);
  });
});

describe('which rows a change or a delete drags along (the server\'s rule)', () => {
  const rows = [SYS, SUB, SUBSUB, ASSY, OTHER, row({ id: 'sub2', systemCode: '32', subSystemCode: '2', title: 'Nose gear' }), row({ id: 'sysB', systemDiffCode: 'B', systemCode: '32', title: 'B' })];
  it('counts everything below a system with the same difference code', () => {
    expect(descendantsOf(rows, SYS).map((r) => r.id).sort()).toEqual(['asy', 'sub', 'sub2', 'ss'].sort());
  });
  it('counts what is below a sub-system and a sub-sub-system', () => {
    expect(descendantsOf(rows, SUB).map((r) => r.id).sort()).toEqual(['asy', 'ss']);
    expect(descendantsOf(rows, SUBSUB).map((r) => r.id)).toEqual(['asy']);
  });
  it('counts nothing below an assembly, and never the row itself', () => {
    expect(descendantsOf(rows, ASSY)).toEqual([]);
    expect(descendantsOf(rows, SYS).some((r) => r.id === 'sys')).toBe(false);
  });
  it('leaves another difference code alone', () => {
    expect(descendantsOf(rows, rows[6])).toEqual([]);
    expect(descendantsOf(rows, SYS).some((r) => r.id === 'sysB')).toBe(false);
  });
  it('writes a short list of codes', () => {
    expect(sampleCodes([SUB])).toBe('32-1');
    expect(sampleCodes([SUB, SYS])).toBe('32 and 32-1');
    expect(sampleCodes([ASSY, SUBSUB, SUB, SYS, OTHER], 3)).toBe('29, 32, 32-1 and 2 more');
    expect(sampleCodes([row({ systemDiffCode: 'B', systemCode: '32' })])).toBe('32 (B)');
  });
});

describe('what is shown of a long tree', () => {
  const tree = buildTree([SYS, SUB, SUBSUB, ASSY, OTHER]);
  it('lists the roots only while everything is closed, and the way down as rows are opened', () => {
    expect(flattenTree(tree, { open: new Set() }).map((f) => f.node.row.id)).toEqual(['oth', 'sys']);
    expect(flattenTree(tree, { open: new Set(['sys']) }).map((f) => f.node.row.id)).toEqual(['oth', 'sys', 'sub']);
    const all = flattenTree(tree, { open: parentIds(tree) });
    expect(all.map((f) => f.node.row.id)).toEqual(['oth', 'sys', 'sub', 'ss', 'asy']);
    expect(all.map((f) => f.depth)).toEqual([0, 0, 1, 2, 3]);
  });
  it('says how many rows hang below a closed one, and whether it has any', () => {
    const closed = flattenTree(tree, { open: new Set() });
    const sys = closed.find((f) => f.node.row.id === 'sys')!;
    expect(sys).toMatchObject({ hasChildren: true, open: false, below: 3 });
    expect(closed.find((f) => f.node.row.id === 'oth')).toMatchObject({ hasChildren: false, below: 0 });
  });
  it('a search shows the matches and the way to them, whatever was open', () => {
    const hit = flattenTree(tree, { open: new Set(), query: 'shock' });
    expect(hit.map((f) => f.node.row.id)).toEqual(['sys', 'sub', 'ss', 'asy']);
    expect(flattenTree(tree, { open: new Set(), query: 'hydraulic' }).map((f) => f.node.row.id)).toEqual(['oth']);
    expect(flattenTree(tree, { open: new Set(), query: 'nothing like this' })).toEqual([]);
  });
  it('matches on the code in either spelling, the difference code and the title, ignoring case', () => {
    expect(matchesQuery(ASSY, '32-10-10')).toBe(true);
    expect(matchesQuery(ASSY, '321010')).toBe(true);
    expect(matchesQuery(ASSY, 'SHOCK')).toBe(true);
    expect(matchesQuery({ ...ASSY, systemDiffCode: 'ZZ' }, 'zz')).toBe(true);
    expect(matchesQuery(ASSY, 'gear')).toBe(false);
    expect(matchesQuery(ASSY, '   ')).toBe(true);
  });
  it('opens a short SNS fully and a long one at its systems', () => {
    expect([...initialOpen(tree, 5)].sort()).toEqual(['ss', 'sub', 'sys']);
    expect(initialOpen(tree, OPEN_ALL_UP_TO).size).toBe(3);
    expect(initialOpen(tree, OPEN_ALL_UP_TO + 1).size).toBe(0);
  });
  it('finds the rows above one, so that a new row can be revealed', () => {
    expect(ancestorIds(tree, 'asy')).toEqual(['sys', 'sub', 'ss']);
    expect(ancestorIds(tree, 'sys')).toEqual([]);
    expect(ancestorIds(tree, 'nope')).toEqual([]);
  });
  it('copes with thousands of rows', () => {
    const rows: SnsRow[] = [];
    for (let i = 0; i < 40; i++) {
      const sys = `S${String(i).padStart(2, '0')}`;
      rows.push(row({ systemCode: sys, title: sys }));
      for (let j = 0; j < 10; j++) {
        rows.push(row({ systemCode: sys, subSystemCode: String(j), title: `${sys}${j}` }));
        for (let k = 0; k < 10; k++) rows.push(row({ systemCode: sys, subSystemCode: String(j), subSubSystemCode: String(k), title: `${sys}${j}${k}` }));
      }
    }
    expect(rows).toHaveLength(4440);
    const big = buildTree(rows);
    expect(big).toHaveLength(40);
    expect(flattenTree(big, { open: new Set() })).toHaveLength(40);
    expect(flattenTree(big, { open: parentIds(big) })).toHaveLength(4440);
    expect(flattenTree(big, { open: new Set(), query: 'S3905' }).map((f) => f.node.row.title)).toEqual(['S39', 'S390', 'S3905']);
  });
});

describe('problems', () => {
  const problems: SnsProblem[] = [
    { severity: 'warn', code: 'ORPHAN', message: '32-1 has no parent: 32 is not defined.', rowIds: ['sub'] },
    { severity: 'error', code: 'DUPLICATE', message: '32 is defined twice.', rowIds: ['a', 'b'] },
    { severity: 'error', code: 'INVALID', message: 'x', rowIds: ['c'] },
    { severity: 'warn', code: 'ORPHAN', message: 'y', rowIds: [] },
  ];
  it('lists each problem with the row it names, a duplicate with both', () => {
    const m = problemsByRow(problems);
    expect(m.get('sub')!.map((p) => p.code)).toEqual(['ORPHAN']);
    expect(m.get('a')![0]).toBe(m.get('b')![0]);
    expect(m.get('nothing')).toBeUndefined();
  });
  it('summarises them in words, with what names no row counted', () => {
    expect(summariseProblems(problems)).toMatchObject({ errors: 2, warnings: 2, duplicates: 1, orphans: 2, invalid: 1, unlocated: 1, text: '2 errors and 2 warnings' });
    expect(summariseProblems([problems[0]]).text).toBe('1 warning');
    expect(summariseProblems([]).text).toBe('No problems');
  });
  it('puts errors first and keeps the server\'s order otherwise', () => {
    expect(orderProblems(problems).map((p) => p.message)).toEqual(['32 is defined twice.', 'x', '32-1 has no parent: 32 is not defined.', 'y']);
  });
});

describe('what an import or a preview would do', () => {
  const merge = (o: Partial<MergeSummary>): MergeSummary => ({ added: [], same: 0, conflicts: [], rejected: [], counts: { added: 0, same: 0, conflicts: 0, rejected: 0 }, ...o });
  const conflict = (key: string, overwritten = false) => ({ key, code: key.replace(/\|/g, '-'), existing: 'Old', incoming: 'New', overwritten });
  it('groups into will add, already present, differs and not valid', () => {
    const v = groupMerge(merge({ added: [SUB, SYS], same: 4, conflicts: [conflict('b'), conflict('a')], rejected: [{ index: 0, code: 'Q', errors: ['bad'] }] }), false);
    expect(v.add.map((r) => r.id)).toEqual(['sys', 'sub']);
    expect(v.same).toBe(4);
    expect(v.differs.map((c) => c.key)).toEqual(['a', 'b']);
    expect(v.rejected).toHaveLength(1);
  });
  it('lists the rows already present in code order and counts the titles that differ only in capitals', () => {
    const v = groupMerge(merge({
      same: 2, present: [{ key: 'b', code: 'B', title: 'Bee' }, { key: 'a', code: 'A', title: 'Ay' }],
      conflicts: [{ ...conflict('a'), caseOnly: true }, conflict('b')],
    }), false);
    expect(v.present.map((p) => p.key)).toEqual(['a', 'b']);
    expect(v.caseOnly).toBe(1);
    expect(groupMerge(merge({ same: 3 }), false)).toMatchObject({ same: 3, present: [], caseOnly: 0 });   // an older server: a count only
  });
  it('a title that differs is kept, so it alone is nothing to apply', () => {
    const v = groupMerge(merge({ conflicts: [conflict('a')] }), false);
    expect(v).toMatchObject({ replace: 0, willChange: 0, canApply: false });
  });
  it('with "replace titles that differ" on, the differing titles are the change', () => {
    const v = groupMerge(merge({ conflicts: [conflict('a', true), conflict('b', true)] }), true);
    expect(v).toMatchObject({ replace: 2, willChange: 2, canApply: true });
    expect(groupMerge(merge({ added: [SYS], conflicts: [conflict('a', true)] }), true).willChange).toBe(2);
  });
  it('new rows alone can be applied', () => {
    expect(groupMerge(merge({ added: [SYS] }), false)).toMatchObject({ willChange: 1, canApply: true });
    expect(groupMerge(merge({ same: 9 }), false).canApply).toBe(false);
  });
  it('sends overwrite off unless it was chosen', () => {
    expect(importBody(false, false)).toEqual({ apply: false, overwrite: false });
    expect(importBody(true, true)).toEqual({ apply: true, overwrite: true });
  });
  it('says what an applied import did', () => {
    expect(mergeOutcome(merge({ added: [SYS, SUB] }))).toBe('Added 2 rows.');
    expect(mergeOutcome(merge({ added: [SYS], conflicts: [conflict('a', true), conflict('b', false)] }))).toBe('Added 1 row, replaced 1 title, kept 1 different title.');
    expect(mergeOutcome(merge({ rejected: [{ index: 0, code: '', errors: [] }] }))).toBe('Added 0 rows, 1 entry not valid.');
  });
});

describe('learning from the modules', () => {
  const prop = (key: string, o: Partial<LearnProposal> = {}): LearnProposal => ({
    key, level: 'system', row: { systemDiffCode: '', systemCode: key, subSystemCode: '', subSubSystemCode: '', assyCode: '', title: `T${key}` }, confidence: 0.9, basis: 'because',
    candidates: [], sources: [], moduleCount: 1, status: 'new', ...o,
  });
  const ps = [prop('A1', { confidence: 0.9 }), prop('B2', { confidence: 0.6 }), prop('C3', { confidence: 0.3 }), prop('D4', { status: 'exists' }), prop('E5', { status: 'conflict', confidence: 0.7 }), prop('F6', { confidence: 0.7, row: { ...prop('F6').row, title: '' } })];

  it('reads the threshold as a percentage, falling back to the default for anything else', () => {
    expect(parseThreshold('70')).toBe(0.7);
    expect(parseThreshold('70%')).toBe(0.7);
    expect(parseThreshold('')).toBe(DEFAULT_MIN_CONFIDENCE);
    expect(parseThreshold('abc')).toBe(DEFAULT_MIN_CONFIDENCE);
    expect(parseThreshold('150')).toBe(1);
    expect(parseThreshold('-5')).toBe(0);
    expect(parseThreshold('x', 0.2)).toBe(0.2);
  });
  it('shows what is at or above the threshold, in the chosen status', () => {
    expect(visibleProposals(ps, { minConfidence: 0.5, status: 'new' }).map((p) => p.key)).toEqual(['A1', 'B2', 'F6']);
    expect(visibleProposals(ps, { minConfidence: 0.7, status: 'new' }).map((p) => p.key)).toEqual(['A1', 'F6']);
    expect(visibleProposals(ps, { minConfidence: 0, status: 'all' })).toHaveLength(6);
    expect(visibleProposals(ps, { minConfidence: 0, status: 'conflict' }).map((p) => p.key)).toEqual(['E5']);
  });
  it('counts what the threshold hides', () => {
    expect(hiddenByThreshold(ps, { minConfidence: 0.5, status: 'new' })).toBe(1);
    expect(hiddenByThreshold(ps, { minConfidence: 0, status: 'new' })).toBe(0);
    expect(hiddenByThreshold(ps, { minConfidence: 0.8, status: 'all' })).toBe(4);
  });
  it('only a new proposal that has a title can be accepted', () => {
    expect(isAcceptable(ps[0])).toBe(true);
    expect(isAcceptable(ps[3])).toBe(false);
    expect(isAcceptable(ps[4])).toBe(false);
    expect(isAcceptable(ps[5])).toBe(false);
  });
  it('sends exactly what is ticked, shown and acceptable', () => {
    const visible = visibleProposals(ps, { minConfidence: 0.5, status: 'all' });
    expect(acceptedKeys(visible, new Set(['A1', 'B2', 'C3', 'D4', 'E5', 'F6']))).toEqual(['A1', 'B2']);      // C3 is hidden, D4/E5 exist, F6 has no title
    expect(acceptedKeys(visible, new Set())).toEqual([]);
    expect(acceptedKeys(visible, new Set(['B2']))).toEqual(['B2']);
  });
  it('previews with nothing to accept, and applies only an explicit list of keys', () => {
    expect(learnPreviewBody()).toEqual({ apply: false });
    const b = learnApplyBody(['A1', 'B2'], 0.5);
    expect(b).toEqual({ apply: true, accept: ['A1', 'B2'], minConfidence: 0.5 });
    expect('acceptAll' in b).toBe(false);
    expect(learnApplyBody([], 0.5).accept).toEqual([]);                      // an empty list accepts nothing, it is not "all"
  });
  it('labels a confidence', () => {
    expect(pct(0.904)).toBe(90);
    expect(pct(2)).toBe(100);
    expect(confidenceTone(0.9)).toBe('ok');
    expect(confidenceTone(0.6)).toBe('warn');
    expect(confidenceTone(0.2)).toBe('bad');
  });
});

describe('deriving the publication structure', () => {
  const mod = (id: string, children: StructModule['children'], level: StructModule['level'] = 'system'): StructModule => ({ kind: 'module', id, level, code: id, title: id, titleSource: 'sns', systemDiffCode: '', children });
  const dm = (file: string) => ({ kind: 'dm' as const, file, dmc: file, techName: '', infoName: '', title: file, infoCode: '040', infoGroup: '0xx', match: 'full' as const });
  const result = (o: Partial<DeriveResult> = {}): DeriveResult => ({
    applied: false, snsRows: 5, pm: { entries: 9, headerFrom: 'existing', placement: 'replace' }, hints: [],
    structure: { roots: [mod('a', [dm('1'), mod('b', [dm('2'), dm('3')], 'subsystem')])], counts: { dms: 3, modules: 2, full: 3, partial: 0, unclassified: 0, superseded: 0, skipped: 0 }, superseded: [], skipped: [], warnings: [] }, ...o,
  });

  it('sends the options, leaving out what is only a default of the server', () => {
    expect(deriveBody(DEFAULT_DERIVE, false)).toEqual({
      sns: 'project', apply: false, collapseZero: true, unmatched: 'deepest', excludeFrontMatter: true, placement: 'replace', unclassifiedTitle: 'Unclassified',
    });
    expect(deriveBody({ ...DEFAULT_DERIVE, sns: 'merged', titleFormat: 'code-title', pmTitle: '  Manual ', placement: 'unplaced', collapseZero: false }, true)).toEqual({
      sns: 'merged', apply: true, collapseZero: false, unmatched: 'deepest', excludeFrontMatter: true, placement: 'unplaced', unclassifiedTitle: 'Unclassified', titleFormat: 'code-title', pmTitle: 'Manual',
    });
    expect('titleFormat' in deriveBody(DEFAULT_DERIVE, false)).toBe(false);
    expect('pmTitle' in deriveBody(DEFAULT_DERIVE, false)).toBe(false);
    expect('unclassifiedTitle' in deriveBody({ ...DEFAULT_DERIVE, unclassifiedTitle: '   ' }, false)).toBe(false);
  });
  it('applies with the same options the preview was made with', () => {
    const o = { ...DEFAULT_DERIVE, unmatched: 'unclassified' as const };
    const { apply: a, ...rest } = deriveBody(o, true);
    const { apply: p, ...restP } = deriveBody(o, false);
    expect([a, p]).toEqual([true, false]);
    expect(rest).toEqual(restP);
  });
  it('a preview goes stale when any option changes, and not otherwise', () => {
    expect(deriveSignature(DEFAULT_DERIVE)).toBe(deriveSignature({ ...DEFAULT_DERIVE }));
    for (const change of [{ sns: 'defaults' }, { placement: 'unplaced' }, { unmatched: 'unclassified' }, { titleFormat: 'code-title' }, { collapseZero: false }, { excludeFrontMatter: false }, { pmTitle: 'x' }, { unclassifiedTitle: 'Other' }] as const) {
      expect(deriveSignature({ ...DEFAULT_DERIVE, ...change } as typeof DEFAULT_DERIVE), JSON.stringify(change)).not.toBe(deriveSignature(DEFAULT_DERIVE));
    }
  });
  it('the confirmation says that the publication structure changes, and how, by placement', () => {
    const replace = deriveConfirmation(DEFAULT_DERIVE, result());
    expect(replace.title).toBe('Change the publication structure?');
    expect(replace.lines.join(' ')).toMatch(/REPLACED/);
    expect(replace.lines.join(' ')).toMatch(/9 entries for 3 data modules/);
    expect(replace.lines.join(' ')).toMatch(/backup/);
    const add = deriveConfirmation({ ...DEFAULT_DERIVE, placement: 'unplaced' }, result({ pm: { entries: 12, headerFrom: 'existing', placement: 'unplaced' } }));
    expect(add.lines.join(' ')).toMatch(/EXTENDED/);
    expect(add.lines.join(' ')).toMatch(/appended/);
    expect(add.lines.join(' ')).not.toMatch(/REPLACED/);
    expect(deriveConfirmation(DEFAULT_DERIVE, result({ pm: { entries: 9, headerFrom: 'generated', placement: 'replace' } })).lines.join(' ')).toMatch(/no publication module yet/);
  });
  it('counts the data modules below a chapter', () => {
    const r = result().structure.roots[0];
    expect(countDms(r)).toBe(3);
    expect(countDms((r.children[1] as StructModule))).toBe(2);
    expect(countDms(dm('x'))).toBe(1);
  });
  it('tiles: the three that always matter, and the others only when they are not zero', () => {
    expect(structureTiles(result().structure, result()).map((t) => t.key)).toEqual(['dms', 'modules', 'full', 'rows', 'entries']);
    const s = result().structure;
    s.counts.unclassified = 2;
    expect(structureTiles(s, result()).map((t) => t.key)).toContain('unclassified');
  });
});

describe('the ordering form', () => {
  const info: Pick<OrderingInfo, 'keys' | 'override'> = { keys: [...ORDER_KEYS], override: null };
  it('reads codes separated by commas or spaces, upper-cased, once each, and says what is not a code', () => {
    expect(parseCodeList('720, 018 040;720')).toEqual({ codes: ['720', '018', '040'], errors: [] });
    expect(parseCodeList('')).toEqual({ codes: [], errors: [] });
    expect(parseCodeList('7a0 12').errors).toEqual(['"12" is not an information code (3 letters or digits).']);
    expect(parseCodeList('7a0').codes).toEqual(['7A0']);
  });
  it('reads ranks line by line', () => {
    expect(parseRankLines('018 = -1\n720: 5\n\n  0b0=3  ')).toEqual({ rank: { '018': -1, '720': 5, '0B0': 3 }, errors: [] });
    expect(parseRankLines('018').errors[0]).toMatch(/Line 1/);
    expect(parseRankLines('018 = 1.5').errors).toHaveLength(1);
    expect(parseRankLines('0188 = 1').errors).toHaveLength(1);
  });
  it('the form starts from the saved override, or the standard keys', () => {
    expect(orderFormFrom(info)).toEqual({ keys: [...ORDER_KEYS], pinFirst: '', pinLast: '', rank: '' });
    expect(orderFormFrom({ keys: info.keys, override: { pinFirst: ['720'], pinLast: ['941'], rank: { '018': -1 }, keys: ['info', 'sns', 'file'] } })).toEqual({
      keys: ['info', 'sns', 'file'], pinFirst: '720', pinLast: '941', rank: '018 = -1',
    });
    expect(formatRank(undefined)).toBe('');
  });
  it('the form equal to the standard is no override at all', () => {
    expect(buildOrder(orderFormFrom(info), info.keys, null)).toEqual({ order: null, errors: [] });
  });
  it('builds an override from what was changed, and only that', () => {
    const f = { ...orderFormFrom(info), pinFirst: '720, 018', rank: '941 = 3' };
    expect(buildOrder(f, info.keys, null)).toEqual({ order: { pinFirst: ['720', '018'], rank: { '941': 3 } }, errors: [] });
    const moved = { ...orderFormFrom(info), keys: moveKey(info.keys, 1, -1) };
    expect(buildOrder(moved, info.keys, null).order).toEqual({ keys: ['info', 'sns', ...info.keys.slice(2)] });
  });
  it('keeps a group table the project already has', () => {
    const groups = [{ id: 'x', label: 'X', from: '000', to: '0ZZ' }];
    expect(buildOrder({ ...orderFormFrom(info), pinFirst: '720' }, info.keys, { groups })).toEqual({ order: { groups, pinFirst: ['720'] }, errors: [] });
    expect(buildOrder(orderFormFrom(info), info.keys, { groups }).order).toEqual({ groups });
  });
  it('refuses what the server would sort wrongly', () => {
    expect(buildOrder({ ...orderFormFrom(info), pinFirst: '72' }, info.keys, null).errors[0]).toMatch(/Pinned first/);
    expect(buildOrder({ ...orderFormFrom(info), pinFirst: '720', pinLast: '720' }, info.keys, null).errors[0]).toMatch(/both first and last/);
    expect(buildOrder({ ...orderFormFrom(info), keys: ['sns', 'sns'] }, info.keys, null).errors).toEqual(['The sort keys must each appear once.']);
    expect(buildOrder({ ...orderFormFrom(info), keys: ['bogus' as never] }, info.keys, null).errors).toHaveLength(1);
    expect(buildOrder({ ...orderFormFrom(info), rank: 'oops' }, info.keys, null).order).toBeNull();
  });
  it('moves a sort key one place and stays put at the ends', () => {
    expect(moveKey(['sns', 'info', 'file'], 1, -1)).toEqual(['info', 'sns', 'file']);
    expect(moveKey(['sns', 'info', 'file'], 1, 1)).toEqual(['sns', 'file', 'info']);
    expect(moveKey(['sns', 'info'], 0, -1)).toEqual(['sns', 'info']);
    expect(moveKey(['sns', 'info'], 1, 1)).toEqual(['sns', 'info']);
  });
  it('compares overrides however their fields are ordered', () => {
    expect(sameOrder({ pinFirst: ['720'], rank: { a: 1, b: 2 } }, { rank: { b: 2, a: 1 }, pinFirst: ['720'] })).toBe(true);
    expect(sameOrder(null, undefined)).toBe(true);
    expect(sameOrder(null, {})).toBe(false);
    expect(sameOrder({ pinFirst: ['720'] }, { pinFirst: ['018'] })).toBe(false);
  });
});

describe('what the server said', () => {
  it('lists every problem of a refused row, or the message of any other error', () => {
    expect(errorLines(new ApiError(400, 'System code is required.', 'SNS_INVALID', { errors: ['System code is required.', 'A title is required.'] }))).toEqual(['System code is required.', 'A title is required.']);
    expect(errorLines(new ApiError(409, '32 is already defined as "X".', 'SNS_DUPLICATE'))).toEqual(['32 is already defined as "X".']);
    expect(errorLines(new Error('network down'))).toEqual(['network down']);
    expect(errorLines('text')).toEqual(['text']);
  });
  it('recognises a refusal because rows sit below, with the count', () => {
    expect(childrenRefused(new ApiError(409, 'x', 'SNS_HAS_CHILDREN', { children: 3 }))).toBe(3);
    expect(childrenRefused(new ApiError(409, 'x', 'SNS_HAS_CHILDREN'))).toBe(0);
    expect(childrenRefused(new ApiError(409, 'x', 'SNS_DUPLICATE'))).toBeNull();
    expect(childrenRefused(new ApiError(400, 'x', 'SNS_HAS_CHILDREN'))).toBeNull();
    expect(childrenRefused(new Error('x'))).toBeNull();
  });
});

describe('who sees the write controls', () => {
  const roles: ProjectRole[] = ['viewer', 'reviewer', 'editor', 'manager', 'owner'];
  it('an editor, manager or owner changes a project\'s SNS; a reviewer and a viewer only read', () => {
    expect(roles.filter(canEditSns)).toEqual(['editor', 'manager', 'owner']);
  });
  it('only a software administrator changes the organisation defaults', () => {
    const u = (role: User['role']): User => ({ id: '1', username: 'u', fullName: 'U', role });
    expect(canEditSnsDefaults(u('admin'))).toBe(true);
    expect(canEditSnsDefaults(u('project_manager'))).toBe(false);
    expect(canEditSnsDefaults(u('author'))).toBe(false);
    expect(canEditSnsDefaults(null)).toBe(false);
    expect(canEditSnsDefaults(undefined)).toBe(false);
  });
});
