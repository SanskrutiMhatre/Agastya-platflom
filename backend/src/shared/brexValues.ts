// =============================================================================
// The pure parts of BREX checking (S1000D Chap 4.10) that the server (backend/src/services/brex.ts, the engine that blocks publication) and the
// Studio (frontend/src/studio/validation/brex.ts, the check while editing) must answer identically: whether a value satisfies an `objectValue`,
// whether a rule group's `rulesContext` applies to a schema, and which XPath expressions are XPath 2.0.
//
// ONE source for both runtimes (audit WP-16, ARC-008): these functions were byte-identical twins kept equal by hand and by the parity suite
// (frontend/src/studio/__tests__/verify/brex-parity.test.ts, which stays as the regression guard). The two engines still differ in how they
// parse a BREX and walk the document (xmldom + the `xpath` package on the server, the browser DOM in the Studio); that is not shared.
// No Node or DOM dependency here (see shared/xsdRegex.ts).
// =============================================================================

import { xsdRegex } from './xsdRegex';

/** An `objectValue`: `form` is single | range | pattern, `allowed` its `@valueAllowed`. */
export interface BrexValueForm { form: string; allowed: string }

function splitNum(s: string): [string, number] | null {
  const m = s.match(/^(.*?)(\d+)$/);
  return m ? [m[1], parseInt(m[2], 10)] : null;
}
const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

/** Does `value` satisfy one `objectValue`? (single: one value or `a|b|c`; range: `lo~hi`; pattern: an XSD regular expression.) */
export function valueMatches(value: string, v: BrexValueForm): boolean {
  switch (v.form) {
    case 'range': {
      const [lo, hi] = v.allowed.split('~');
      if (hi == null) return value === lo;
      // decimal bounds ("0.5~2.5") compare as numbers; code-like ranges ("A01~A09", "001~999") by their number part
      if (DECIMAL.test(lo) && DECIMAL.test(hi) && (lo.includes('.') || hi.includes('.') || value.includes('.'))) {
        if (!DECIMAL.test(value)) return false;
        const n = parseFloat(value);
        return n >= parseFloat(lo) && n <= parseFloat(hi);
      }
      const a = splitNum(lo);
      const b = splitNum(hi);
      const x = splitNum(value);
      if (a && b && x && a[0] === b[0] && x[0] === a[0]) return x[1] >= a[1] && x[1] <= b[1];
      return value >= lo && value <= hi && value.length === lo.length;
    }
    case 'pattern': {
      const re = xsdRegex(v.allowed);
      return re ? re.test(value) : true; // a pattern that cannot be translated is reported by the caller; here it cannot reject anything
    }
    default:
      return v.allowed.split('|').some((a) => a === value);
  }
}

/** Does a rule group's `rulesContext` (`.../descript.xsd`) apply to a module of `schema` (`descript`)? No context, or no schema known: yes. */
export function contextApplies(context: string | null, schema: string | null): boolean {
  if (!context) return true;
  const m = context.match(/([a-zA-Z]+)\.xsd\s*$/);
  return !m || !schema || m[1] === schema;
}

/** XPath 2.0 constructs an XPath 1.0 engine does not have: such a rule is reported as not enforced, not as invalid. */
export function isXPath2(p: string): boolean {
  return /\b(for|some|every)\s+\$|\bif\s*\(|\b(matches|tokenize|replace|ends-with|lower-case|upper-case|exists|empty|distinct-values|string-join)\s*\(|\s(eq|ne|lt|le|gt|ge)\s/.test(p);
}
