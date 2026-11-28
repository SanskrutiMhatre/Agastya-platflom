// =============================================================================
// Live co-editing of a JSS document (Phase 3, P3-1): the JSS format of the collaboration core (docs/phase3/COLLAB-CONTRACT.md section 2).
//
//   room        <projectId>/jss/book   (a JSS project has one document: publication.xml, services/jss/service.ts)
//   Y schema    shared/jss/yjss.ts (the editor's model as an XML tree), the same file the browser binding uses
//   file text   serializeJss(model), the editor's own serializer (shared/jss/xml.ts): a write-back is byte for byte a normal save
//   write-back  refuses what a save refuses (assertJssText, assertJssType), writes atomically (a revision when asked), keeps the identity
//               record in step (syncIdentity) and checks the written text against the schema and the stencil's rules (validateJss), as a save does
//   check-out   the document's leases (WP-11 / D22): any check-out by another author makes the room read-only for the others ("Locked by")
//
// Rooms, access, persistence, external changes and limits are the core's (services/collab/rooms.ts); nothing here does them again.
// =============================================================================

import * as Y from 'yjs';
import { DOMParser } from '@xmldom/xmldom';
import { content } from '../../context';
import { register, type CollabFormat } from '../collab/formats';
import { saveRevisioned } from '../projectFiles';
import { syncIdentity } from '../xengine/project';
import { wellFormedError } from '../wellFormed';
import { parseJss, serializeJss, JssParseError, type JssDomParser } from '../../shared/jss/xml';
import type { JssDoc } from '../../shared/jss/model';
import { loadDoc, reconcileDoc, readDoc } from '../../shared/jss/yjss';
import { assertJssText, assertJssType, isJssAuthored, sourceRel, validateJss } from './service';

/** The one document of a JSS project, by its room name. */
export const JSS_DOC_PATH = 'book';

const notWellFormed = (message: string): Error => Object.assign(new Error(message), { code: 'NOT_WELL_FORMED' });

/** The editor's model of a file (the editor's own reader, on @xmldom/xmldom). Throws NOT_WELL_FORMED for what the editor cannot open. */
export function modelOf(text: string): JssDoc {
  if (!text.trim()) throw notWellFormed('The document is empty.');
  const wf = wellFormedError(text);
  if (wf) throw notWellFormed(`The document is not well-formed XML: ${wf}`);
  try {
    return parseJss(text, new DOMParser({ onError: () => undefined }) as unknown as JssDomParser);
  } catch (e) {
    throw notWellFormed(e instanceof JssParseError ? `The editor cannot open this document: ${e.message}` : (e as Error).message);
  }
}

/** The file text of a Y document: what a normal save of the same content writes. */
export function textOf(ydoc: Y.Doc): string {
  const d = readDoc(ydoc);
  if (!d) throw notWellFormed('The live document holds no JSS document.');
  return serializeJss(d);
}

export const jssFormat: CollabFormat = {
  kind: 'jss',
  writeRole: 'editor',
  writeCap: 'dm.write',                       // the same as PUT /api/projects/:id/jss
  resolve(projectId, docPath) {
    if (docPath !== JSS_DOC_PATH) throw Object.assign(new Error('No such JSS document.'), { status: 404, code: 'NOT_FOUND' });
    if (!isJssAuthored(projectId)) throw Object.assign(new Error('This project is not a JSS document project.'), { status: 404, code: 'NOT_FOUND' });
    const rel = sourceRel(projectId).replace(/\\/g, '/');
    if (!content.exists(projectId, rel)) throw Object.assign(new Error('This project has no JSS document yet.'), { status: 404, code: 'NOT_FOUND' });
    return rel;
  },
  toY: (text, ydoc, origin) => { loadDoc(ydoc, modelOf(text), origin); },
  fromY: (ydoc) => textOf(ydoc),
  reconcile: (ydoc, text, origin) => { reconcileDoc(ydoc, modelOf(text), origin); },
  async writeBack(projectId, rel, text, actor, revision) {
    assertJssText(text);                       // the same refusals as a save
    assertJssType(projectId, text);
    if (revision) await saveRevisioned(projectId, rel, text, actor, 'collab', { selfWritten: true });
    else content.writeText(projectId, rel, text);
    try { syncIdentity(projectId, 'jss', text); } catch { /* the identity record follows at the next save; never refuses a write */ }
    // the schema and the stencil's rules run on what was written (the kept report the editor, Generate and the release gate read)
    void validateJss(projectId, text).catch(() => undefined);
  },
  leasePart: '',
};

/** Make JSS documents editable live (called once by the JSS routes). */
export function registerJssCollab(): void { register(jssFormat); }
