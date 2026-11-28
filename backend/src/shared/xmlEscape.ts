// =============================================================================
// The one XML escaper (audit WP-16, PUB-028 / S1K-007), in the shared folder so that both runtimes use the same source: the server
// (lib/xml.ts re-exports it, every service imports it from there) and the browser (the JSS and JSG serialisers in shared/jss, shared/jsg).
//   escText  for element content: & < >                (a `"` in text is legal and stays as it is)
//   escAttr  for a double-quoted attribute value: & < > "
// Both accept any value (null/undefined become '').
// =============================================================================

/** Escapes a value for element content (`&`, `<`, `>`). */
export function escText(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escapes a value for a double-quoted attribute (`&`, `<`, `>`, `"`). */
export function escAttr(s: unknown): string {
  return escText(s).replace(/"/g, '&quot;');
}
