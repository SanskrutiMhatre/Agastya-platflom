// =============================================================================
// XML text helpers shared by every service (audit WP-16, PUB-028 / S1K-007).
//
// There were 14 copies of the escaper. Which characters a copy escaped decided whether it was safe in an attribute, and that was implicit in
// which copy a caller happened to import. There are now two, with the difference in their names:
//   escText  for element content: & < >                (a `"` in text is legal and stays as it is)
//   escAttr  for a double-quoted attribute value: & < > "
// Both accept any value (null/undefined become ''), like the most lenient former copies.
//
// readAttrs: the attributes of a start tag's source text (`a="1" b="2"`), the "read the head without a full parse" helper that csdbIndex,
// csdbObjects, lifecycle, sns/dms, findings, packages, projectConfig and jssdm each carried. Double-quoted values only, as before; values are
// returned as written (entities are not decoded), as before. xmlHead.ts re-exports it.
// =============================================================================

/** Escapes a value for element content (`&`, `<`, `>`). */
export function escText(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escapes a value for a double-quoted attribute (`&`, `<`, `>`, `"`). */
export function escAttr(s: unknown): string {
  return escText(s).replace(/"/g, '&quot;');
}

/** The double-quoted attributes of a start tag's source text, by name (`modelIdentCode="S1000D" systemCode="00"`). */
export function readAttrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of String(src ?? '').matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}
