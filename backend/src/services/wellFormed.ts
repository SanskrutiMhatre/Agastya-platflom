// Well-formedness guard for data modules entering the CSDB.
//
// The editor lets an author save the raw XML text anyway after a warning, and any API client can PUT whatever it likes, so the server must
// refuse text that is not XML at all: an unclosed or mismatched tag, a truncated file, an unquoted attribute, an undeclared entity.
// A data module that is well-formed but does not match the S1000D schema is still saved (work in progress); validation reports it.
import { DOMParser } from '@xmldom/xmldom';

/** null when the text is well-formed, otherwise a short description of the first problem (with line and column when known). */
export function wellFormedError(xml: string): string | null {
  const problems: string[] = [];
  try {
    new DOMParser({
      onError: (level: string, msg: string) => {
        // 'warning' is only a problem for the ways XML is commonly broken by hand: unquoted attribute values and unterminated constructs
        if (level === 'fatalError' || level === 'error' || /missed quot|unclosed|no end|unexpected end/i.test(msg)) problems.push(msg);
      },
    }).parseFromString(xml, 'text/xml');
  } catch (e) {
    problems.push(String((e as Error).message ?? e));
  }
  if (!problems.length) return null;
  return problems[0].replace(/\s+/g, ' ').replace(/@#\[line:(\d+),col:(\d+)\]/, '(line $1, column $2)').slice(0, 220);
}
