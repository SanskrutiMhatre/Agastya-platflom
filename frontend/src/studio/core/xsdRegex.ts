/**
 * XML Schema regular expressions (the `pattern` facet, BREX value patterns) as JavaScript ones. They differ in small ways that
 * matter: patterns are anchored, `\i` / `\c` (name characters) exist only in XSD, and `\-` is a legal escape outside a class
 * (which a JavaScript pattern with the `u` flag rejects). What cannot be translated faithfully yields `null`: callers must treat
 * that as "cannot tell", never as "matches" or "does not match" silently.
 */
const cache = new Map<string, RegExp | null>();

const NAME_START = 'A-Za-z_:';
const NAME_CHAR = 'A-Za-z0-9_.:-';

function translate(p: string): string | null {
  let out = '';
  let inClass = false;
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === '\\') {
      const n = p[++i];
      if (n === undefined) return null;
      if (n === 'i') out += inClass ? NAME_START : `[${NAME_START}]`;
      else if (n === 'c') out += inClass ? NAME_CHAR : `[${NAME_CHAR}]`;
      else if (n === 'I' || n === 'C') {
        if (inClass) return null; // a negated multi-character escape inside a class cannot be expressed
        out += `[^${n === 'I' ? NAME_START : NAME_CHAR}]`;
      } else out += '\\' + n;
      continue;
    }
    if (inClass) {
      if (ch === '-' && p[i + 1] === '[') return null; // character class subtraction
      if (ch === ']') inClass = false;
      out += ch;
      continue;
    }
    if (ch === '[') inClass = true;
    out += ch;
  }
  return out;
}

/** The anchored JavaScript equivalent of an XSD pattern, or null when it cannot be evaluated here. */
export function xsdRegex(pattern: string): RegExp | null {
  const hit = cache.get(pattern);
  if (hit !== undefined) return hit;
  let re: RegExp | null = null;
  const src = translate(pattern);
  if (src != null) {
    const anchored = '^(?:' + src + ')$';
    try {
      re = new RegExp(anchored, 'u');
    } catch {
      // `\-`, `\_`… are plain escapes in XSD but errors under /u; retry without it, unless Unicode properties are used
      if (!/\\[pP]\{/.test(src)) {
        try {
          re = new RegExp(anchored);
        } catch {
          re = null;
        }
      }
    }
  }
  cache.set(pattern, re);
  return re;
}
