import { describe, expect, it } from 'vitest';
import type { ValidationIssue } from '../../api';
import { dmcOf, messageOf, moduleShort, ruleOf, whereOf } from './validationView';

const FILE = 'DMC-S1KSTUDIO-A-29-10-00-00A-520A-A_001-00_EN-US.XML';
const issue = (o: Partial<ValidationIssue>): ValidationIssue =>
  ({ id: 'x', source: 'xsd', sev: 'error', title: 'Does not match the S1000D schema', rel: `csdb/${FILE}`, file: FILE, line: 12, loc: `${FILE}:12`, detail: '', ...o }) as ValidationIssue;

describe('the validation report shows a finding in the check\'s own words', () => {
  it('a schema error: the message without its source note, the schema file as the rule, the line as the location', () => {
    const i = issue({ detail: "Element 'foo': This element is not expected. Expected is ( techName ). (Issue 5.0, proced.xsd)" });
    expect(messageOf(i)).toBe("Element 'foo': This element is not expected. Expected is ( techName ).");
    expect(ruleOf(i)).toBe('proced.xsd');
    expect(whereOf(i)).toBe('line 12');
  });
  it('a BREX breach: the rule text as the message, the rule id as the rule, the context as the location', () => {
    const i = issue({ source: 'brex', title: 'BREX BREX-S1-00036', line: 1, loc: 'dmodule', detail: 'No change markers must appear if the issue type is not changed (Chap 3.9.5.2.1.1, Para 2.1.1). (from DMC-S1000D-G-04-10-0301-00A-022A-D)' });
    expect(messageOf(i)).toBe('No change markers must appear if the issue type is not changed (Chap 3.9.5.2.1.1, Para 2.1.1).');
    expect(ruleOf(i)).toBe('BREX-S1-00036');
    expect(whereOf(i)).toBe('dmodule');
  });
  it('other checks: a short message, the construct as the rule, "whole module" when nothing more precise is known', () => {
    expect(messageOf(issue({ source: 'ids', title: 'Same ID in several data modules', loc: 'par-0001', line: 1 }))).toBe('ID "par-0001" is declared in several data modules');
    expect(ruleOf(issue({ source: 'graphics', detail: 'ICN "ICN-X" has no entity declaration' }))).toBe('@infoEntityIdent');
    expect(ruleOf(issue({ source: 'graphics', detail: '<graphic src="a.png"> - file not found' }))).toBe('@src');
    expect(messageOf(issue({ source: 'icn', detail: '1 graphic reference ICNs this module never declares. The image is found on disk.' }))).toBe('1 graphic reference ICNs this module never declares.');
    expect(whereOf(issue({ source: 'icn', loc: FILE, line: 1 }))).toBe('whole module');
  });
  it('the module: its information code in the table, its code without issue and language in the detail', () => {
    expect(moduleShort(FILE)).toBe('520A');
    expect(moduleShort('DMC-S1KSTUDIO-A-29-10-00-00A-040A-D_001-00_EN-US.XML')).toBe('040A');
    expect(moduleShort('PMC-S1KSTUDIO-12345-00001-00_001-00_EN-US.XML')).toBe('PM');
    expect(dmcOf(FILE)).toBe('DMC-S1KSTUDIO-A-29-10-00-00A-520A-A');
  });
});
