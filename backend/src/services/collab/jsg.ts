// =============================================================================
// Live co-editing (Phase 3, P3-1): the JSG document (User Handbook, Illustrated Spare Parts List) as a room format. The binding contract of
// docs/phase3/COLLAB-CONTRACT.md for kind 'jsg': one room per JSG project, `<projectId>/jsg/document`, writing the project's one source file
// (services/jsg/service.ts, jsg-document.xml).
//
//   toY / reconcile  the file is read with the editor's own reader (shared/jsg/xml.ts readJsg) and written again with its serializer, so the room
//                    always holds the editor's canonical form (shared/collab/jsgForm.ts); an external change (a save by version, an import from
//                    Word, a restore, a GitLab pull) is merged with the keyed minimal reconcile, keeping what the people in the room typed
//   fromY            the room's document read into the model and written by serializeJsg: a write-back is byte for byte what a save from the
//                    editor writes (empty attributes such as title="" and item="" included, GAP-005)
//   writeBack        the checks of a save (PUT /api/projects/:id/jsg, writeSource): size, XML safety, no DOCTYPE, well-formed, the declared
//                    document type; then the atomic write (and the revision), and the document codes follow the text (syncIdentity)
// Registered by importing this module (src/index.ts). A check-out of any part (section, plate, appendix) or of the whole document locks the
// room for everyone but its holder (leasePart ''), which is what "Locked by" says.
// =============================================================================

import * as Y from 'yjs';
import { DOMParser, DOMImplementation } from '@xmldom/xmldom';
import { content } from '../../context';
import { bad, HttpError } from '../http';
import { checkXmlSafetyOf } from '../csdbGuard';
import { wellFormedError } from '../wellFormed';
import { saveRevisioned } from '../projectFiles';
import { isJsgProject, jsgTypeOfProject, sourceRel } from '../jsg/service';
import { syncIdentity } from '../xengine/project';
import { readJsg, serializeJsg, JsgParseError, type JsgElement } from '../../shared/jsg/xml';
import * as ydom from '../../shared/collab/ydom';
import { normalizeJsgDom, reconcileKeyed, fingerprintEq, JSG_DOC_PATH } from '../../shared/collab/jsgForm';
import type { XNode } from '../../shared/collab/xmlForm';
import { register, type CollabFormat } from './formats';

const MAX_BYTES = 50 * 1024 * 1024;                 // the limit of a save (writeSource)

type XDoc = XNode & ydom.XBuildParent & ydom.XFactory & { documentElement: (XNode & JsgElement) | null };

const notWellFormed = (message: string): Error => Object.assign(new Error(message), { code: 'NOT_WELL_FORMED' });

function parseXml(text: string): XDoc {
  const wf = wellFormedError(text);
  if (wf) throw notWellFormed(`The document is not well-formed XML: ${wf}`);
  const doc = new DOMParser({ onError: () => undefined }).parseFromString(text, 'text/xml') as unknown as XDoc;
  if (!doc?.documentElement) throw notWellFormed('The document has no root element.');
  return doc;
}

/** The editor's form of a file's text: read by the editor's reader, written by its serializer. Throws NOT_WELL_FORMED for what the editor cannot open. */
export function canonicalJsg(text: string): string {
  const doc = parseXml(text);
  try { return serializeJsg(readJsg(doc.documentElement!)); } catch (e) {
    if (e instanceof JsgParseError) throw notWellFormed(`The JSG editor cannot open this document: ${e.message}`);
    throw e;
  }
}

/** The canonical DOM of a file's text (the form the room holds). */
function canonicalDom(text: string): XDoc {
  const doc = parseXml(canonicalJsg(text));
  normalizeJsgDom(doc.documentElement!);
  return doc;
}

/** A DOM of what a Y document holds (child for child, as jsgForm.reconcileKeyed needs). */
function domOfY(ydoc: Y.Doc): XDoc {
  const doc = new DOMImplementation().createDocument(null, '', null) as unknown as XDoc;
  for (const n of Array.from(doc.childNodes)) doc.removeChild(n);
  ydom.buildInto(ydoc, doc);
  return doc;
}

/** Fill an empty Y document with a JSG file's content. */
export function jsgToY(text: string, ydoc: Y.Doc, origin?: unknown): void {
  const doc = canonicalDom(text);
  ydom.loadInto(ydoc, { doc, doctype: null, xmlDecl: null }, origin);
}

/** The file's text for a Y document: exactly what the editor's Save writes for the same content. */
export function jsgFromY(ydoc: Y.Doc): string {
  const doc = domOfY(ydoc);
  if (!doc.documentElement) throw notWellFormed('The live document is empty.');
  return serializeJsg(readJsg(doc.documentElement));
}

/** Bring a Y document to a changed file with the fewest changes. */
export function jsgReconcile(ydoc: Y.Doc, text: string, origin?: unknown): void {
  const next = canonicalDom(text);
  const cur = domOfY(ydoc);
  ydoc.transact(() => {
    reconcileKeyed(ydoc.getXmlFragment(ydom.ROOT), cur, next, fingerprintEq());
    ydom.writeXmlDecl(ydoc, null);
    ydom.writeDoctype(ydoc, null);
    if (ydoc.getMap(ydom.META).get('schema') !== ydom.SCHEMA_VERSION) ydoc.getMap(ydom.META).set('schema', ydom.SCHEMA_VERSION);
  }, origin);
}

/** What a save refuses (services/jsg/service.ts writeSource), for the text a room writes. */
export function assertJsgWritable(projectId: string, text: string): void {
  if (!text.trim()) throw bad('There is no document to save.', 'EMPTY');
  if (Buffer.byteLength(text) > MAX_BYTES) throw bad('The document is larger than 50 MB.', 'TOO_LARGE');
  checkXmlSafetyOf(text);
  if (/<!DOCTYPE/i.test(text.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ''))) throw bad('A JSG document may not declare a DOCTYPE: the engine needs none, and entities are not supported in it.', 'DOCTYPE_REFUSED');
  const wf = wellFormedError(text);
  if (wf) throw new HttpError(400, `The document is not well-formed XML: ${wf}`, 'MALFORMED_XML');
  const type = jsgTypeOfProject(projectId);
  const declared = /<jsgdoc\b[^>]*\btype="([^"]+)"/.exec(text)?.[1];
  if (type && declared && declared !== type.id) throw bad(`This project is a ${type.label}; the document says it is "${declared}".`, 'DOCTYPE_MISMATCH');
}

export const jsgFormat: CollabFormat = {
  kind: 'jsg',
  writeRole: 'editor',
  writeCap: 'dm.write',                                // the capability of PUT /api/projects/:id/jsg
  resolve(projectId, docPath) {
    if (docPath !== JSG_DOC_PATH) throw Object.assign(new Error('A JSG project has one document.'), { status: 404, code: 'NOT_FOUND' });
    let ok = false;
    try { ok = isJsgProject(projectId); } catch { ok = false; }
    if (!ok) throw Object.assign(new Error('This project is not a JSG document project.'), { status: 404, code: 'NOT_FOUND' });
    const rel = sourceRel(projectId).replace(/\\/g, '/');
    if (!content.exists(projectId, rel)) throw Object.assign(new Error('This project has no JSG document yet.'), { status: 404, code: 'NOT_FOUND' });
    return rel;
  },
  toY: jsgToY,
  fromY: jsgFromY,
  reconcile: jsgReconcile,
  async writeBack(projectId, rel, text, actor, revision) {
    assertJsgWritable(projectId, text);
    if (revision) await saveRevisioned(projectId, rel, text, actor, 'collab', { selfWritten: true });
    else content.writeText(projectId, rel, text);
    syncIdentity(projectId, 'jsg', text);              // the document codes kept in the backend follow the text, as after a save
  },
  leasePart: '',
};

register(jsgFormat);
