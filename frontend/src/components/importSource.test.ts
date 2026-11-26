// What the first look says an upload is, and the rules that stop a wrong answer before anything is sent.
import { describe, expect, it } from 'vitest';
import type { PackageDetection } from '../api';
import { detectionSentence, guessedSource, sourceProblem, targetProblem } from './importSource';

const det = (over: Partial<PackageDetection>): PackageDetection => ({ token: 't', name: 'x', format: 's1000d', kind: 'package', dataModules: 6, publicationModules: 1, graphics: 0, other: 0, entries: 7, olderTool: false, ...over });

describe('the first look', () => {
  it('says what it found, and what it could not tell', () => {
    expect(detectionSentence(det({}))).toBe('An S1000D package: 6 data modules, 1 publication module, 0 graphics.');
    expect(detectionSentence(det({ olderTool: true, dataModules: 1, graphics: 1 }))).toContain('older publishing tool\'s export layout');
    expect(detectionSentence(det({ format: 'unknown', dataModules: 0, publicationModules: 0, entries: 3 }))).toBe('No S1000D data modules or publication module were found among its 3 files.');
    expect(detectionSentence(det({ format: 'jss', kind: 'document' }))).toBe('A JSS document.');
    expect(detectionSentence(det({ format: 'jsg', kind: 'document', docType: 'ispl' }))).toContain('Illustrated Spare Parts List');
    expect(detectionSentence(det({ format: 'unknown', kind: 'document' }))).toContain('neither a JSS book nor a JSG document');
  });
  it('is only a guess: nothing is chosen for the person when it found nothing', () => {
    expect(guessedSource(det({}))).toBe('s1000d');
    expect(guessedSource(det({ format: 'jsg', kind: 'document' }))).toBe('jsg');
    expect(guessedSource(det({ format: 'unknown' }))).toBe('');
  });
});

describe('what the person says the file is', () => {
  it('must be said at all', () => { expect(sourceProblem('a.zip', '', det({}))).toBe('Say what this file is.'); });
  it('accepts what fits: a package as S1000D, a document as the format its root element names', () => {
    expect(sourceProblem('a.zip', 's1000d', det({}))).toBe('');
    expect(sourceProblem('book.xml', 'jss', det({ format: 'jss', kind: 'document' }))).toBe('');
    expect(sourceProblem('doc.xml', 'jsg', det({ format: 'jsg', kind: 'document', docType: 'uhb' }))).toBe('');
  });
  it('says why a wrong choice cannot work, so a wrong guess can be corrected without an error afterwards', () => {
    expect(sourceProblem('a.zip', 'jss', det({}))).toMatch(/not a JSS document\. Choose S1000D package/);
    expect(sourceProblem('book.xml', 's1000d', det({ format: 'jss', kind: 'document' }))).toMatch(/one document, not a package/);
    expect(sourceProblem('book.xml', 'jsg', det({ format: 'jss', kind: 'document' }))).toMatch(/This file is a JSS document, not a JSG document\. Choose JSS document/);
    expect(sourceProblem('other.xml', 'jss', det({ format: 'unknown', kind: 'document' }))).toMatch(/root element is neither/);
    expect(sourceProblem('readme.zip', 's1000d', det({ format: 'unknown', dataModules: 0, publicationModules: 0 }))).toMatch(/nothing to import as S1000D/);
    expect(sourceProblem('doc.xml', 'jsg', det({ format: 'jsg', kind: 'document', docType: 'ispl' }))).toMatch(/Illustrated Spare Parts List/);
  });
  it('lets the person override a first look that found nothing, when the file can still be what they say', () => {
    expect(sourceProblem('odd.zip', 's1000d', det({ format: 'unknown', dataModules: 0, publicationModules: 1 }))).toBe('');
  });
});

describe('what it is to become', () => {
  it('a document is not imported as its own format; a package may be imported as S1000D, JSS or JSG', () => {
    expect(targetProblem('jss', 'jss', 'uhb')).toMatch(/already JSS/);
    expect(targetProblem('jss', 'jsg', 'uhb')).toBe('');
    expect(targetProblem('s1000d', 's1000d', '')).toBe('');
    expect(targetProblem('s1000d', 'jss', 'uhb')).toBe(''); expect(targetProblem('jsg', 's1000d', '')).toBe('');
  });
  it('only a JSG User Handbook can be made from another format', () => {
    expect(targetProblem('s1000d', 'jsg', 'ispl')).toMatch(/Only a JSG User Handbook/);
    expect(targetProblem('jss', 'jsg', 'ispl')).toMatch(/Only a JSG User Handbook/);
    expect(targetProblem('s1000d', 'jsg', 'uhb')).toBe('');
  });
});
