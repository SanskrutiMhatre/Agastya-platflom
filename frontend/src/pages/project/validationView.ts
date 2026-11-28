// UI redesign screen 5 (mockup docs/audit/mockups/validation.html): how one finding of a validation run is shown in the report. The mockup's
// table has a message (what is wrong, in the check's own words), a location under it, the check (Source), the rule and the module's short
// code; the detail beside it names the module, the location, the rule's explanation. Everything here is derived from the finding the server
// reported (title, detail, loc, rel, line): nothing is invented.

import type { ValidationIssue } from '../../api';

const firstLine = (s: string): string => s.split(/\r?\n/)[0].trim();
const firstSentence = (s: string): string => { const m = /^(.+?[.!?])(\s|$)/.exec(s); return (m ? m[1] : s).trim(); };

/** The finding in the check's own words (the table's "Message"): the schema or BREX message without the trailing source note. */
export function messageOf(i: ValidationIssue): string {
  const d = firstLine(i.detail);
  switch (i.source) {
    case 'xsd': case 'xml': return d.replace(/\s*\((?:Issue|S1000D issue)\s[^)]*\)\s*$/i, '') || i.title;
    case 'brex': return d.replace(/\s*\(from [^)]*\)?\s*$/i, '') || i.title;
    case 'ids': return i.loc ? `ID "${i.loc}" is declared in several data modules` : i.title;
    case 'icn': case 'pm': return d ? firstSentence(d) : i.title;
    default: return d || i.title;
  }
}

/** The rule that found it (the table's "Rule"): the schema file, the BREX rule id, or the construct the check looks at. */
export function ruleOf(i: ValidationIssue): string {
  switch (i.source) {
    case 'xsd': return (/\(Issue [^,)]+,\s*([\w.-]+\.xsd)\)/i.exec(i.detail) || [])[1] ?? 'schema';
    case 'xml': return 'well-formed';
    case 'brex': return i.title.replace(/^BREX\s+/i, '') || 'BREX';
    case 'graphics': return /\bsrc=/.test(i.detail) ? '@src' : '@infoEntityIdent';
    case 'ids': return '@id';
    case 'icn': return 'ENTITY';
    case 'pm': return /not placed|not in the publication/i.test(i.title) ? 'pmEntry' : 'dmRef';
    default: return i.source;
  }
}

/** Where in the module (the grey line under the message): the location the check gave, and the line when it is more than the first. */
export function whereOf(i: ValidationIssue): string {
  const loc = i.loc && i.loc !== `${i.file}:${i.line}` && i.loc !== i.file && !/^\d+$/.test(i.loc) ? i.loc : '';
  return [loc, i.line > 1 ? `line ${i.line}` : ''].filter(Boolean).join(' · ') || 'whole module';
}

/** The data module code without issue, language and extension: DMC-AGSTY-A-29-10-00-00A-520A-A. */
export const dmcOf = (file: string): string => file.replace(/_\d{3}-\d{2}(?:_[A-Z]{2}-[A-Z]{2})?\.xml$/i, '');

/** The module's short code in the table (the mockup's "520A"): the information code and its variant; another file keeps its name. */
export function moduleShort(file: string): string {
  const m = /^DMC-.*-([0-9A-Z]{3}[0-9A-Z])-[0-9A-Z](?:_\d{3}-\d{2})?(?:_[A-Z]{2}-[A-Z]{2})?\.xml$/i.exec(file);
  if (m) return m[1].toUpperCase();
  if (/^PMC-/i.test(file)) return 'PM';
  return file || 'project';
}
