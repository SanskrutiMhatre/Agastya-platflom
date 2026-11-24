// Reading an RWI project package: extraction, recognition and parsing of its XML files.
//
// The package is an S1000D Issue 4.2 publication: one publication module (<pm>), data modules (<dmodule>) and illustrations. This file only READS it - nothing here maps to JSS.
// Everything the JSS document cannot hold (identity, status, titles, DOCTYPE, the original text) is kept as written, so that the import can store it and the export can give it back.
//
// Isolation: it uses only the generic ZIP reader (services/zipio) and the XML parser dependency; it shares no code with the S1000D project importer or the S1000D engine.

import path from 'path';
import { DOMParser } from '@xmldom/xmldom';
import { ZipFileReader, ZipError, type ZipEntry } from '../../zipio';

export class RwiPackageError extends Error { constructor(message: string, public code = 'NOT_A_PACKAGE') { super(message); } }

export const PICTURE = /\.(png|jpe?g|gif|bmp|svg|tiff?)$/i;

/** The limits for reading an uploaded package (a project package is megabytes, not gigabytes). */
const LIMITS = { maxEntries: 20_000, maxTotalBytes: 1024 ** 3, maxEntryBytes: 256 * 1024 ** 2, maxRatio: 500 };

export interface SourceFile { name: string; rel: string; text: string }
export interface SourcePicture { name: string; rel: string; size: number; entry: ZipEntry }

export interface RwiPackage {
  /** The folder name inside the ZIP that holds the package ("RWI"), or ''. */
  root: string;
  modules: SourceFile[];
  publication: SourceFile | null;
  pictures: Map<string, SourcePicture>;
  /** Everything else that was in the archive (reported, never imported). */
  other: string[];
  readPicture(p: SourcePicture): Promise<Buffer>;
  close(): void;
}

const rootOf = (xml: string): string => /<([A-Za-z_][\w:.-]*)\b[^>]*>/.exec(xml.replace(/^﻿/, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[\s\S]*?(\[[\s\S]*?\]\s*)?>/i, ''))?.[1] ?? '';

/** Open the archive, read its XML files and recognise the package. Throws RwiPackageError (a plain message) when it is not one. */
export async function readPackage(zipFile: string): Promise<RwiPackage> {
  let zip: ZipFileReader;
  try { zip = ZipFileReader.open(zipFile, LIMITS); }
  catch (e) { throw new RwiPackageError(e instanceof ZipError ? `This is not a usable ZIP file: ${e.message}` : 'This is not a ZIP file.', 'BAD_ZIP'); }
  try {
    const modules: SourceFile[] = []; let publication: SourceFile | null = null; const pictures = new Map<string, SourcePicture>(); const other: string[] = [];
    for (const e of zip.entries) {
      if (e.isDirectory) continue;
      const rel = e.name.replace(/\\/g, '/'); const base = path.posix.basename(rel);
      if (rel.split('/').some((s) => s === '..') || base.startsWith('.') || /^__MACOSX\//.test(rel)) { if (!/^__MACOSX\//.test(rel)) other.push(rel); continue; }
      if (PICTURE.test(base) && /(^|\/)ICN\//i.test(rel) || /^ICN-/i.test(base) && PICTURE.test(base)) {
        if (pictures.has(base.toLowerCase())) other.push(`${rel} (a second file with the same name)`);
        else pictures.set(base.toLowerCase(), { name: base, rel, size: e.size, entry: e });
        continue;
      }
      if (/\.xml$/i.test(base)) {
        const text = (await zip.readBuffer(e)).toString('utf8').replace(/^﻿/, '');
        const root = rootOf(text);
        if (root === 'dmodule') modules.push({ name: base, rel, text });
        else if (root === 'pm') { if (publication) other.push(`${rel} (a second publication file)`); else publication = { name: base, rel, text }; }
        else other.push(rel);
        continue;
      }
      other.push(rel);
    }
    if (!modules.length) throw new RwiPackageError('No documents were found in this package: it needs a folder of data module XML files.', 'NO_MODULES');
    if (!publication) throw new RwiPackageError('This package has no publication file (the file that lists the documents and their order).', 'NO_PUBLICATION');
    modules.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    const root = path.posix.dirname(publication.rel) === '.' ? '' : path.posix.dirname(publication.rel);
    return {
      root, modules, publication, pictures, other,
      readPicture: (p) => zip.readBuffer(p.entry), close: () => zip.close(),
    };
  } catch (e) {
    zip.close();
    if (e instanceof RwiPackageError) throw e;
    if (e instanceof ZipError) throw new RwiPackageError(`The package could not be read: ${e.message}`, 'BAD_ZIP');
    throw e;
  }
}

// ── parsing ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const kids = (e: Element): Element[] => { const o: Element[] = []; for (let n = e.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) o.push(n as Element); return o; };
const child = (e: Element | null | undefined, name: string): Element | undefined => (e ? kids(e).find((c) => c.tagName === name) : undefined);
const textOf = (e: Element | null | undefined): string => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
const attrs = (e: Element | null | undefined): Record<string, string> => { const o: Record<string, string> = {}; if (e) for (let i = 0; i < e.attributes.length; i++) o[e.attributes[i].name] = e.attributes[i].value; return o; };

export function parseXml(text: string): Document {
  const errors: string[] = [];
  // The DOCTYPE (entity declarations) is read separately; the parser is given the document without it, so no external entity can ever be touched.
  const body = text.replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/i, '');
  const doc = new DOMParser({ onError: (level: string, m: string) => { if (level !== 'warning') errors.push(m); } }).parseFromString(body, 'text/xml') as unknown as Document;
  if (errors.length || !doc.documentElement) throw new RwiPackageError(errors[0] ?? 'The XML is not well-formed.', 'MALFORMED');
  return doc;
}

export interface CodeAttrs { modelIdentCode: string; systemDiffCode: string; systemCode: string; subSystemCode: string; subSubSystemCode: string; assyCode: string; disassyCode: string; disassyCodeVariant: string; infoCode: string; infoCodeVariant: string; itemLocationCode: string }

/** DMC-<model>-<diff>-<system>-<sub><subsub>-<assy>-<disassy><variant>-<info><variant>-<location> */
export const codeKey = (c: Partial<CodeAttrs>): string => [c.modelIdentCode, c.systemDiffCode, c.systemCode, `${c.subSystemCode ?? ''}${c.subSubSystemCode ?? ''}`, c.assyCode, `${c.disassyCode ?? ''}${c.disassyCodeVariant ?? ''}`, `${c.infoCode ?? ''}${c.infoCodeVariant ?? ''}`, c.itemLocationCode].join('-');

export interface SourceModule {
  file: string;
  /** the whole file as it was, byte for byte (as text) */
  raw: string;
  key: string;
  code: Record<string, string>;
  issue: Record<string, string>;
  language: Record<string, string>;
  issueDate: Record<string, string>;
  techName: string; infoName: string;
  /** the module's own heading: the title of its first levelledPara (what the document prints), which is NOT dmTitle */
  heading: string;
  /** declared pictures: entity name -> the file name the declaration points at */
  entities: Map<string, string>;
  doctype: string;
  rootStart: string;
  identAndStatus: string;
  content: Element;
  schemaLocation: string;
  contentType: string;
}

export function parseModule(f: SourceFile): SourceModule {
  const doc = parseXml(f.text); const root = doc.documentElement;
  const dt = /<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/i.exec(f.text);
  const entities = new Map<string, string>();
  for (const m of (dt?.[0] ?? '').matchAll(/<!ENTITY\s+(\S+)\s+SYSTEM\s+["']([^"']+)["']/g)) entities.set(m[1], m[2]);
  const ident = child(child(child(root, 'identAndStatusSection'), 'dmAddress'), 'dmIdent');
  const items = child(child(child(root, 'identAndStatusSection'), 'dmAddress'), 'dmAddressItems');
  const title = child(items, 'dmTitle'); const content = child(root, 'content');
  if (!content) throw new RwiPackageError('The document has no content.', 'NO_CONTENT');
  const code = attrs(child(ident, 'dmCode'));
  const top = child(content, 'description') ?? kids(content)[0];
  const first = top ? kids(top).find((c) => c.tagName === 'levelledPara') : undefined;
  return {
    file: f.name, raw: f.text, key: codeKey(code), code, issue: attrs(child(ident, 'issueInfo')), language: attrs(child(ident, 'language')), issueDate: attrs(child(items, 'issueDate')),
    techName: textOf(child(title, 'techName')), infoName: textOf(child(title, 'infoName')), heading: textOf(child(first, 'title')), entities, doctype: dt?.[0] ?? '',
    rootStart: /<dmodule\b[^>]*>/.exec(f.text)?.[0] ?? '<dmodule>', identAndStatus: /<identAndStatusSection[\s\S]*?<\/identAndStatusSection>/.exec(f.text)?.[0] ?? '',
    content, schemaLocation: root.getAttribute('xsi:noNamespaceSchemaLocation') || '', contentType: top?.tagName ?? '',
  };
}

export interface DmRefSource { key: string; techName: string; infoName: string; issue: Record<string, string>; language: Record<string, string>; code: Record<string, string> }
export interface PmEntrySource { title: string | null; refs: DmRefSource[]; children: PmEntrySource[]; order: Array<{ ref: DmRefSource } | { entry: PmEntrySource }> }
export interface SourcePublication {
  file: string; raw: string; code: Record<string, string>; language: Record<string, string>; issue: Record<string, string>; title: string; shortTitle: string;
  identAndStatus: string; rootStart: string; entries: PmEntrySource[]; entryCount: number; refCount: number;
}

export function parsePublication(f: SourceFile): SourcePublication {
  const doc = parseXml(f.text); const root = doc.documentElement;
  const ident = child(child(child(root, 'identAndStatusSection'), 'pmAddress'), 'pmIdent');
  const items = child(child(child(root, 'identAndStatusSection'), 'pmAddress'), 'pmAddressItems');
  let entryCount = 0; let refCount = 0;
  const refOf = (r: Element): DmRefSource => {
    const code = attrs(child(child(r, 'dmRefIdent'), 'dmCode')); const t = child(child(r, 'dmRefAddressItems'), 'dmTitle');
    return { key: codeKey(code), code, techName: textOf(child(t, 'techName')), infoName: textOf(child(t, 'infoName')), issue: attrs(child(child(r, 'dmRefIdent'), 'issueInfo')), language: attrs(child(child(r, 'dmRefIdent'), 'language')) };
  };
  const entryOf = (e: Element): PmEntrySource => {
    entryCount++;
    const out: PmEntrySource = { title: child(e, 'pmEntryTitle') ? textOf(child(e, 'pmEntryTitle')) : null, refs: [], children: [], order: [] };
    for (const c of kids(e)) {
      if (c.tagName === 'dmRef') { refCount++; const r = refOf(c); out.refs.push(r); out.order.push({ ref: r }); }
      else if (c.tagName === 'pmEntry') { const s = entryOf(c); out.children.push(s); out.order.push({ entry: s }); }
    }
    return out;
  };
  const content = child(root, 'content');
  return {
    file: f.name, raw: f.text, code: attrs(child(ident, 'pmCode')), language: attrs(child(ident, 'language')), issue: attrs(child(ident, 'issueInfo')),
    title: textOf(child(items, 'pmTitle')), shortTitle: textOf(child(items, 'shortPmTitle')),
    identAndStatus: /<identAndStatusSection[\s\S]*?<\/identAndStatusSection>/.exec(f.text)?.[0] ?? '', rootStart: /<pm\b[^>]*>/.exec(f.text)?.[0] ?? '<pm>',
    entries: content ? kids(content).filter((c) => c.tagName === 'pmEntry').map(entryOf) : [], entryCount, refCount,
  };
}
