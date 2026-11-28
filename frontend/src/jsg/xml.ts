// Reading and writing a JSG document in the browser: <jsgdoc> XML <-> the model.
//
// Phase 3 (P3-1): the reader and the serializer are backend/src/shared/jsg/xml.ts (shared with the server, which writes a live document back with
// exactly this serializer). Only the parse of the text, with the browser's DOMParser, is here.

import { JsgParseError, readJsg, type JsgElement } from '../../../backend/src/shared/jsg/xml';
import type { JsgDoc } from './model';

export * from '../../../backend/src/shared/jsg/xml';

export function parseJsg(xml: string): JsgDoc {
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  const err = dom.getElementsByTagName('parsererror')[0];
  if (err) throw new JsgParseError(`not well-formed XML: ${(err.textContent ?? '').split('\n')[0]}`);
  return readJsg(dom.documentElement as unknown as JsgElement);
}
