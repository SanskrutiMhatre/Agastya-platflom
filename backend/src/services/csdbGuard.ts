// The two content checks every CSDB object shares, behind one name (csdb.ts keeps its own data-module-specific wrapper).
import { bad } from './http';
import { wellFormedError } from './wellFormed';
const { checkXmlSafety } = require('../core/auth/xmlGuard');

/** Throws when the text could harm the server (entity bombs, external entities, empty input). Never lenient. */
export function checkXmlSafetyOf(xml: string): void {
  if (typeof xml !== 'string' || !xml.trim()) throw bad('The file is empty.', 'EMPTY');
  const g = checkXmlSafety(xml);
  if (!g.ok) throw bad(g.error, 'UNSAFE_XML');
}
/** A well-formedness problem, or null. */
export const contentCheck = (xml: string): string | null => wellFormedError(xml);
