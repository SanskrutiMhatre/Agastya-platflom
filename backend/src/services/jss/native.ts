// The JSS document's native structure: `publication.xml` of a JSS document project is ONE <jssbook> document, never an S1000D publication module (<pm>) and never a package's
// contents list. Everything that writes that file for a JSS project goes through here first, so a legacy importer, a restore or a hand-made request cannot replace the book with
// something else. (The S1000D importer and engine are untouched: they are kept out of JSS projects by routes/jss-guard.ts, and the JSS side checks what it is about to write and what it finds.)

import fs from 'fs';
import path from 'path';
import { projectDirFor } from '../../context';
import { bad } from '../http';
import { pmRel, readProjectJson } from '../projects';

/** The root element of an XML text, skipping the declaration, comments, a DOCTYPE and processing instructions. */
export function rootElementOf(xml: string): string | null {
  const stripped = xml.replace(/^﻿/, '').replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/gi, ' ');
  return /<([A-Za-z_][\w.-]*)/.exec(stripped)?.[1] ?? null;
}

export const isNativeJssXml = (xml: string): boolean => rootElementOf(xml) === 'jssbook';

/** What is wrong with a text that is about to become a JSS project's publication.xml, or null. */
export function nativeProblemOf(xml: string): string | null {
  const root = rootElementOf(xml);
  if (root === 'jssbook') return null;
  if (root === 'pm') return 'This is an S1000D publication module (<pm>), not a JSS document (<jssbook>). A JSS project\'s publication.xml must stay the JSS document.';
  return `The root element is ${root ? `<${root}>` : 'missing'}; a JSS project\'s publication.xml must be a JSS document (<jssbook>), not a package contents list or any other file.`;
}

export function assertNativeJssXml(xml: string): void {
  const p = nativeProblemOf(xml);
  if (p) throw bad(p, 'NOT_NATIVE_JSS');
}

/** The problem with the file a JSS project has today, or null when it is a JSS document (or not there yet). */
export function nativeProblemOfProject(projectId: string): string | null {
  const abs = path.join(projectDirFor(projectId), pmRel(readProjectJson(projectId)));
  if (!fs.existsSync(abs)) return null;
  return nativeProblemOf(fs.readFileSync(abs, 'utf8'));
}
