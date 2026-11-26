// "Import a package": what the upload is, as far as the server could tell, and whether what the person says it is can be imported as what they want.
//
// The server only guesses (a detection). The person confirms the guess or corrects it, and then chooses what the project is to become. The rules here say, before anything is
// sent, when a combination cannot work and why. They are the same rules the server enforces (services/xengine/convert.ts), so the person reads the reason here and not as an error afterwards.

import type { PackageDetection } from '../api';

export type SourceFormat = 's1000d' | 'jss' | 'jsg';
export type Target = 's1000d' | 'jss' | 'jsg';

export const SOURCE_CHOICES: Array<{ id: SourceFormat; label: string; hint: string }> = [
  { id: 's1000d', label: 'S1000D package', hint: 'A .zip of S1000D data modules and a publication module, including the older publishing tool\'s export.' },
  { id: 'jss', label: 'JSS document', hint: 'One JSS book: an .xml file.' },
  { id: 'jsg', label: 'JSG document', hint: 'One JSG User Handbook: an .xml file.' },
];

export const FORMAT_NAME: Record<SourceFormat, string> = { s1000d: 'S1000D', jss: 'JSS', jsg: 'JSG' };
export const isDocumentFile = (fileName: string): boolean => /\.xml$/i.test(fileName);

/** What the first guess found, in one sentence. */
export function detectionSentence(d: PackageDetection): string {
  const n = (k: number, one: string, many = `${one}s`): string => `${k} ${k === 1 ? one : many}`;
  if (d.kind === 'document') return d.format === 'unknown' ? 'This .xml file is neither a JSS book nor a JSG document (its root element is not <jssbook> or <jsgdoc>).' : `A ${FORMAT_NAME[d.format]} document${d.docType === 'ispl' ? ' (Illustrated Spare Parts List)' : ''}.`;
  if (d.format === 'unknown') return `No S1000D data modules or publication module were found among its ${n(d.entries, 'file')}.`;
  return `An S1000D package${d.olderTool ? ' in the older publishing tool\'s export layout' : ''}: ${n(d.dataModules, 'data module')}, ${n(d.publicationModules, 'publication module')}, ${n(d.graphics, 'graphic')}.`;
}

/** The source the first guess points at, or '' when it found nothing the person must not be left to assume. */
export const guessedSource = (d: PackageDetection): SourceFormat | '' => (d.format === 'unknown' ? '' : d.format);

/** Why `source` cannot be what this upload is ('' when it can). */
export function sourceProblem(fileName: string, source: SourceFormat | '', d: PackageDetection): string {
  if (!source) return 'Say what this file is.';
  const doc = isDocumentFile(fileName);
  if (source === 's1000d') {
    if (doc) return 'An .xml file is one document, not a package of S1000D data modules. Choose JSS document or JSG document, or upload the package (.zip).';
    if (!d.dataModules && !d.publicationModules) return 'No S1000D data modules (DMC-….xml) or publication module were found in this package, so there is nothing to import as S1000D. If it holds a JSS or JSG document, upload that document\'s .xml file.';
    return '';
  }
  const name = FORMAT_NAME[source];
  if (!doc) return `A .zip package holds S1000D documents; it is not a ${name} document. Choose S1000D package, or upload the ${name} document's .xml file.`;
  if (d.format === 'unknown') return `This file is not a ${name} document: its root element is neither <jssbook> nor <jsgdoc>.`;
  if (d.format !== source) return `This file is a ${FORMAT_NAME[d.format]} document, not a ${name} document. Choose ${FORMAT_NAME[d.format]} document.`;
  if (source === 'jsg' && d.docType && d.docType !== 'uhb') return 'Only a JSG User Handbook can be imported as another format: an Illustrated Spare Parts List (plates, parts) has no counterpart in JSS or S1000D.';
  return '';
}

/** Why the source cannot become `target` with this manual type ('' when it can). */
export function targetProblem(source: SourceFormat, target: Target, manualType: string): string {
  if (source !== 's1000d' && source === target) return `A ${FORMAT_NAME[source]} document is already ${FORMAT_NAME[source]}. Choose another manual type to import it as.`;
  if (target === 'jsg' && source !== 'jsg' && manualType && manualType !== 'uhb') return 'Only a JSG User Handbook can be made from an S1000D package or a JSS document: an Illustrated Spare Parts List has no counterpart there. Choose User Handbook.';
  return '';
}
