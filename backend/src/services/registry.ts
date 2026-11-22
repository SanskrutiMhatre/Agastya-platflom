// =============================================================================
// Central document-type registry.
//
// ONE place that says which S1000D document types AGASTYA knows, and what is known about each of them:
//   - identity: the schema (XSD file stem == the root element's schema), the root element, the file-name TYPE prefix;
//   - category: data module / publication module / data management list / data dispatch note / comment / update /
//     SCORM content package / illustration metadata / support;
//   - the default information code (data modules only);
//   - which issues have the XSD installed (read from backend/schemas/<issue>/ - never typed in).
//
// Adding a type that has a verified schema is: drop the XSD into backend/schemas/<issue>/, add ONE entry to DOC_TYPES below
// (plus a template in the editor and an XSL rendering rule if it must render), and every consumer - the admin "DM types" seed,
// the coverage matrix, the project type filter, validation - picks it up. Nothing here INVENTS a type: an entry whose XSD is
// not installed for an issue is reported as MISSING for that issue.
// =============================================================================

import fs from 'fs';
import path from 'path';
import { config } from '../config';

export type DocCategory = 'dm' | 'pm' | 'dml' | 'ddn' | 'comment' | 'update' | 'scorm' | 'imf' | 'support';
export interface DocType {
  /** XSD file stem: descript -> descript.xsd. Also the key an administrator enables for a project. */
  schema: string; name: string; category: DocCategory;
  /** The file-name TYPE prefix S1000D Chap 7.5.1 gives this object (DMC, PMC, DML, DDN, COM, UPF, SMC, IMF). */
  filePrefix: string | null;
  /** Default information code for a new data module of this type (dm only). */
  infoCode?: string;
  /** Opens in the structured editor with a template. */
  authored: boolean;
}

const dm = (schema: string, name: string, infoCode: string): DocType => ({ schema, name, category: 'dm', filePrefix: 'DMC', infoCode, authored: true });

export const DOC_TYPES: DocType[] = [
  dm('descript', 'Descriptive', '040'), dm('proced', 'Procedural', '520'), dm('fault', 'Fault isolation', '421'), dm('crew', 'Crew / operator', '131'), dm('ipd', 'Illustrated parts data', '941'),
  dm('brex', 'Business rules exchange', '022'), dm('comrep', 'Common information repository', '00L'), dm('appliccrossreftable', 'Applicability cross-reference table', '00W'),
  dm('condcrossreftable', 'Conditions cross-reference table', '00Q'), dm('prdcrossreftable', 'Products cross-reference table', '00P'), dm('brdoc', 'Business rules document', '024'),
  dm('checklist', 'Checklist', '135'), dm('container', 'Container', '914'), dm('frontmatter', 'Front matter', '001'), dm('learning', 'Learning', '952'), dm('process', 'Process', '951'),
  dm('sb', 'Service bulletin', '930'), dm('schedul', 'Maintenance schedule', '000'), dm('scocontent', 'SCORM content', '000'), dm('wrngdata', 'Wiring data', '000'), dm('wrngflds', 'Wiring fields', '029'),
  { schema: 'pm', name: 'Publication module', category: 'pm', filePrefix: 'PMC', authored: true },
  { schema: 'dml', name: 'Data management list', category: 'dml', filePrefix: 'DML', authored: true },
  { schema: 'ddn', name: 'Data dispatch note', category: 'ddn', filePrefix: 'DDN', authored: true },
  { schema: 'comment', name: 'Comment', category: 'comment', filePrefix: 'COM', authored: true },
  { schema: 'update', name: 'Data update file', category: 'update', filePrefix: 'UPF', authored: true },
  { schema: 'scormcontentpackage', name: 'SCORM content package', category: 'scorm', filePrefix: 'SMC', authored: false },
  { schema: 'icnmetadata', name: 'Illustration / multimedia metadata (IMF)', category: 'imf', filePrefix: 'IMF', authored: true },
];

export const dmTypes = (): DocType[] => DOC_TYPES.filter((t) => t.category === 'dm');
export const typeOf = (schema: string): DocType | undefined => DOC_TYPES.find((t) => t.schema === schema);
/** The seed of the Administrator "DM types" table: derived, not a second list. */
export const dmTypeSeed = () => dmTypes().map((t) => ({ schema: t.schema, name: t.name, infoCode: t.infoCode }));

/** Issue key -> directory name under backend/schemas. */
export const SCHEMA_DIR: Record<string, string> = { '4-2': '4.2', '5-0': '5.0', '6': '6.0', '7': '7.0' };
export const ISSUES = Object.keys(SCHEMA_DIR);

export const xsdPath = (issue: string, schema: string): string => path.join(config.schemasDir, SCHEMA_DIR[issue] ?? '?', `${schema}.xsd`);
export const hasSchema = (issue: string, schema: string): boolean => fs.existsSync(xsdPath(issue, schema));

/** Root element name of an installed XSD (first top-level xs:element), so "root element" is read, not assumed. */
export function rootElementOf(issue: string, schema: string): string | null {
  try {
    const x = fs.readFileSync(xsdPath(issue, schema), 'utf8');
    const m = /<xsd?:element\s+name="([^"]+)"/.exec(x) || /<xs:element\s+name="([^"]+)"/.exec(x);
    return m ? m[1] : null;
  } catch { return null; }
}

export type Support = 'PASS' | 'PARTIAL' | 'MISSING' | 'UNVERIFIED' | 'NOT APPLICABLE';
export interface CoverageRow {
  schema: string; name: string; category: DocCategory; filePrefix: string | null; root: Record<string, string | null>;
  xsd: Record<string, boolean>; authored: boolean;
}

/** The registry view the coverage matrix is generated from. */
export function coverage(): CoverageRow[] {
  return DOC_TYPES.map((t) => ({
    schema: t.schema, name: t.name, category: t.category, filePrefix: t.filePrefix, authored: t.authored,
    root: Object.fromEntries(ISSUES.map((i) => [i, hasSchema(i, t.schema) ? rootElementOf(i, t.schema) : null])),
    xsd: Object.fromEntries(ISSUES.map((i) => [i, hasSchema(i, t.schema)])),
  }));
}
