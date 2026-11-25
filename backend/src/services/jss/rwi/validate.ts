// Validation of the source package: its XML against the shipped schemas, and its references against each other.
//
// Findings are RECORDED, never fatal: a package with defects in its source must still be importable (the sample's own publication file is not schema-valid and names only 23 of its 33
// documents). The import maps what it can and the report says what it found.
//
// Schemas: the S1000D Issue 4.2 XSD set the platform already ships (backend/schemas/4.2), read here and checked with the same libxml2 build (xmllint-wasm). The S1000D validators and
// engine are not called or changed.

import fs from 'fs';
import path from 'path';
import { config } from '../../../config';
import { Findings } from './report';
import type { RwiPackage, SourceModule, SourcePublication } from './source';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { validateXML } = require('xmllint-wasm');

const schemaCache = new Map<string, Array<{ fileName: string; contents: string }> | null>();
function schemaSet(issue: string): Array<{ fileName: string; contents: string }> | null {
  if (schemaCache.has(issue)) return schemaCache.get(issue) ?? null;
  const dir = path.join(config.schemasDir, issue); let set: Array<{ fileName: string; contents: string }> | null = null;
  try { set = fs.readdirSync(dir).filter((f) => f.endsWith('.xsd')).map((f) => ({ fileName: f, contents: fs.readFileSync(path.join(dir, f), 'utf8') })); } catch { set = null; }
  if (set && !set.length) set = null;
  schemaCache.set(issue, set);
  return set;
}

/** "http://www.s1000d.org/S1000D_4-2/xml_schema_flat/descript.xsd" -> { issue: "4.2", file: "descript.xsd" } */
export function declaredSchema(location: string): { issue: string; file: string } | null {
  const m = /S1000D[_-]?(\d+)(?:[-._](\d+))?[^/]*\/[^/]*\/([\w.-]+\.xsd)\s*$/i.exec(location.trim());
  if (!m) return null;
  return { issue: `${m[1]}.${m[2] ?? '0'}`, file: m[3] };
}

/** The DOCTYPE is kept only when it declares nothing but unparsed picture entities (NDATA): the schema needs them to accept picture references, and the checker never opens them. Anything else is removed. */
export function safeDoctype(xml: string): string {
  const m = /<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/i.exec(xml);
  if (!m) return xml;
  const decls = m[1] ? [...m[1].matchAll(/<!(\w+)[^>]*>/g)] : [];
  const ok = decls.length > 0 && decls.every((d) => d[1] === 'ENTITY' && /\bNDATA\b/.test(d[0]) && !/%/.test(d[0]));
  return ok ? xml : xml.replace(m[0], '');
}

/** Validate one XML text against one schema of an installed issue; returns the schema messages (empty = valid) or a note when it cannot be checked. */
export async function schemaCheck(xml: string, issue: string, schemaFile: string): Promise<{ errors: Array<{ message: string; line: number }>; unchecked?: string }> {
  const set = schemaSet(issue);
  if (!set) return { errors: [], unchecked: `no schema set for issue ${issue} is installed` };
  const main = set.find((s) => s.fileName === schemaFile);
  if (!main) return { errors: [], unchecked: `schema ${schemaFile} is not part of issue ${issue}` };
  try {
    const r = await validateXML({ xml: [{ fileName: 'document.xml', contents: safeDoctype(xml) }], schema: [main], preload: set.filter((s) => s.fileName !== schemaFile) });
    return { errors: (r.errors ?? []).map((e: { message: string; loc?: { lineNumber?: number } }) => ({ message: String(e.message).replace(/^Schemas validity error\s*:\s*/, '').slice(0, 300), line: e.loc?.lineNumber ?? 0 })) };
  } catch (e) { return { errors: [], unchecked: `the schema check could not run: ${(e as Error).message.slice(0, 120)}` }; }
}

const sectionWord = (m: SourceModule): string => m.heading || m.file;

export async function validateSource(pkg: RwiPackage, modules: SourceModule[], pub: SourcePublication, findings: Findings): Promise<void> {
  // 1. the XML against its schema
  for (const m of modules) {
    const decl = declaredSchema(m.schemaLocation);
    if (!decl) { findings.add('info', 'schema-undeclared', `"${sectionWord(m)}" does not say which standard it is written to, so its structure was not checked.`, m.file); continue; }
    const r = await schemaCheck(m.raw, decl.issue, decl.file);
    if (r.unchecked) findings.add('info', 'schema-unchecked', `"${sectionWord(m)}" could not be checked against its standard (${r.unchecked}).`, m.file);
    for (const e of r.errors.slice(0, 5)) findings.add('warning', 'schema-error', `"${sectionWord(m)}" has a structure problem in the source: ${e.message}`, m.file, `line ${e.line}`);
  }
  const pr = await schemaCheck(pub.raw, '4.2', 'pm.xsd');
  if (pr.unchecked) findings.add('info', 'schema-unchecked', `The list of documents could not be checked against its standard (${pr.unchecked}).`, pub.file);
  for (const e of pr.errors.slice(0, 6)) findings.add('warning', 'publication-schema-error', `The package's contents list has a structure problem in the source: ${e.message}`, pub.file, `line ${e.line}`);

  // 2. references between the files
  const byKey = new Map(modules.map((m) => [m.key, m]));
  const listed = new Set<string>();
  const walkEntries = (entries: SourcePublication['entries'], trail: string): void => {
    for (const e of entries) {
      const here = e.title ? (trail ? `${trail} > ${e.title}` : e.title) : trail;
      if (!e.refs.length && !e.children.length) findings.add('warning', 'entry-empty', `The contents list has an empty heading${e.title ? ` "${e.title}"` : ''}; it was left out.`, here || pub.file);
      for (const r of e.refs) {
        const m = byKey.get(r.key);
        if (!m) { findings.add('warning', 'reference-unresolved', `The contents list names a document (${r.techName || r.key}) that is not in the package.`, here); continue; }
        listed.add(r.key);
        const lang = (a: Record<string, string>): string => `${a.languageIsoCode ?? ''}-${a.countryIsoCode ?? ''}`;
        if (r.language.languageIsoCode && lang(r.language) !== lang(m.language)) findings.add('info', 'reference-language', `The contents list gives a different language/country for "${sectionWord(m)}" than the document itself; the document was found by its code.`, m.file, `${lang(r.language)} vs ${lang(m.language)}`);
      }
      walkEntries(e.children, here);
    }
  };
  walkEntries(pub.entries, '');
  const orphans = modules.filter((m) => !listed.has(m.key));
  for (const m of orphans) findings.add('warning', 'document-unlisted', `"${sectionWord(m)}" is in the package but not in its contents list.`, m.file);

  // 3. pictures are checked where they are used (map.ts reports each missing one against its section)
  void pkg;
  // 4. unusual identity
  const seen = new Map<string, string>();
  for (const m of modules) { const k = m.key; if (seen.has(k)) findings.add('warning', 'document-duplicate', `Two documents have the same code (${m.file} and ${seen.get(k)}); both were imported.`, m.file); seen.set(k, m.file); }
  const mic = new Set(modules.map((m) => m.code.modelIdentCode)); if (mic.size > 1) findings.add('info', 'mixed-model-codes', `The documents carry ${mic.size} different model codes.`);
  if (modules.some((m) => m.contentType && m.contentType !== 'description')) findings.add('warning', 'content-type', 'Some documents are not plain descriptions; only descriptive text is imported from them.');
}
