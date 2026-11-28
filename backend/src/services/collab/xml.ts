// =============================================================================
// Live co-editing (Phase 3, P3-1): XML text <-> Y document on the server, in exactly the S1000D Studio's form.
//
// Parsing: @xmldom/xmldom, the DOCTYPE kept separately (shared/collab/xmlForm.ts reads its internal subset), the XML declaration kept as
// text, whitespace normalised the way the Studio normalises it when it opens a file (the same function, the same grammar). Writing: the
// Y document is built into an xmldom document and pretty-printed by the Studio's own serializer. So a file the Studio saved and a file a
// room wrote back are byte for byte the same for the same content, and validation, publishing, export, backup and history keep reading
// ordinary XML.
//
// The grammar answers two questions per element (is it declared, may it hold text). It is read from the same compiled grammar files the
// Studio fetches (frontend/public/grammar/<issue>/<schema>.json; in a built product <client dist>/grammar/), once per schema, and only
// that summary is kept in memory.
// =============================================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as Y from 'yjs';
import { DOMParser, DOMImplementation } from '@xmldom/xmldom';
import { config } from '../../config';
import { wellFormedError } from '../wellFormed';
import * as form from '../../shared/collab/xmlForm';
import * as ydom from '../../shared/collab/ydom';

export const sha256 = (s: string): string => crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');

// ---------------------------------------------------------------- grammar summaries

interface GrammarFile { elements?: Record<string, string>; types?: Record<string, { mixed?: number; text?: number }> }
class GrammarSummary implements form.GrammarLike {
  constructor(private readonly names: Set<string>, private readonly text: Set<string>) {}
  has(name: string): boolean { return this.names.has(name); }
  allowsText(name: string): boolean { return this.text.has(name); }
}
const grammars = new Map<string, GrammarSummary | null>();

/** Where the compiled grammars are: the built client's copy, else the source tree's (a development checkout). */
export function grammarDirs(): string[] {
  return [path.join(config.clientDist, 'grammar'), path.resolve(config.root, '..', 'frontend', 'public', 'grammar')];
}

export function grammarFor(ref: form.SchemaRef | null): form.GrammarLike | null {
  if (!ref || !/^[0-9A-Za-z-]{1,8}$/.test(ref.issue) || !/^[A-Za-z]{1,40}$/.test(ref.schema)) return null;
  const key = `${ref.issue}/${ref.schema}`;
  if (grammars.has(key)) return grammars.get(key) ?? null;
  let out: GrammarSummary | null = null;
  for (const dir of grammarDirs()) {
    const file = path.join(dir, ref.issue, `${ref.schema}.json`);
    if (!fs.existsSync(file)) continue;
    try {
      const g = JSON.parse(fs.readFileSync(file, 'utf8')) as GrammarFile;
      const names = new Set<string>(); const text = new Set<string>();
      for (const [name, tk] of Object.entries(g.elements ?? {})) {
        names.add(name);
        const t = g.types?.[tk];
        if (t && (t.mixed || t.text)) text.add(name);
      }
      out = new GrammarSummary(names, text);
      break;
    } catch { /* a damaged grammar file: the next location, or no grammar (the Studio's fallback rules) */ }
  }
  grammars.set(key, out);
  return out;
}

// ---------------------------------------------------------------- parse / serialize

export class NotWellFormedError extends Error { code = 'NOT_WELL_FORMED'; }

type XmlDoc = form.XDocument & ydom.XBuildParent & ydom.XFactory & { documentElement: form.XRoot | null };

export interface Parsed { doc: XmlDoc; doctype: form.Doctype | null; xmlDecl: string | null; grammar: form.GrammarLike | null }

/** Parse a file's text the way the Studio's parseXml + normalizeWhitespace do. Throws NotWellFormedError. */
export function parse(text: string): Parsed {
  if (!text.trim()) throw new NotWellFormedError('The document is empty.');
  const declMatch = text.match(/^﻿?\s*(<\?xml\s[^?]*\?>)/);
  const dtLoc = form.findDoctype(text);
  const malformed = wellFormedError(text);
  if (malformed) throw new NotWellFormedError(malformed);
  let doc: XmlDoc;
  try { doc = new DOMParser({ onError: () => undefined }).parseFromString(text, 'text/xml') as unknown as XmlDoc; } catch (e) { throw new NotWellFormedError((e as Error).message); }
  if (!doc || !doc.documentElement) throw new NotWellFormedError('The document has no root element.');
  // the DOCTYPE node and xmldom's XML-declaration node are not content: both are kept as text beside the tree
  for (const n of Array.from(doc.childNodes)) if (n.nodeType === 10 || (n.nodeType === 7 && n.nodeName.toLowerCase() === 'xml')) doc.removeChild(n);
  const xmlDecl = declMatch ? declMatch[1].replace(/encoding\s*=\s*(["'])(?!utf-8\1)[^"']*\1/i, 'encoding="UTF-8"') : null;
  const grammar = grammarFor(form.detectSchemaOf(doc.documentElement));
  form.normalizeWhitespace(doc, grammar);
  return { doc, doctype: dtLoc ? form.parseDoctype(dtLoc.raw) : null, xmlDecl, grammar };
}

/** The text a Y document stands for, written by the Studio's serializer. */
export function serializeY(ydoc: Y.Doc): string {
  const doc = new DOMImplementation().createDocument(null, '', null) as unknown as XmlDoc;
  for (const n of Array.from(doc.childNodes)) doc.removeChild(n);
  const { doctype, xmlDecl } = ydom.buildInto(ydoc, doc);
  const grammar = grammarFor(form.detectSchemaOf(doc.documentElement));
  return form.serialize(doc, { grammar, doctype, xmlDecl }).text;
}

/** A Y document holding a file's content. */
export function yFromText(text: string, ydoc: Y.Doc = new Y.Doc(), origin?: unknown): Y.Doc {
  const p = parse(text);
  ydom.loadInto(ydoc, p, origin);
  return ydoc;
}

/** Bring a Y document to a file's content with the fewest changes (an external change reaching a live room). */
export function reconcileText(ydoc: Y.Doc, text: string, origin?: unknown): void {
  const p = parse(text);
  ydom.reconcileDocument(ydoc, p, origin);
}
