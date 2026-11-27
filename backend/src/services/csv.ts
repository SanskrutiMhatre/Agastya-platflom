// One CSV cell writer for every export (audit WP-07: SEC-015, ARC-020). Every cell is quoted with its quotes doubled, and a cell that
// begins with a character a spreadsheet reads as the start of a formula (= + - @, tab, carriage return) gets a leading apostrophe, so
// Excel and LibreOffice show it as text instead of evaluating it (OWASP "CSV injection"). The frontend has the same helper in lib/csv.ts.

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export const csvRow = (cells: unknown[]): string => cells.map(csvCell).join(',');

/** Header and rows, CRLF line ends (RFC 4180), a final line end. */
export const csvText = (header: string[], rows: unknown[][]): string => [header.join(','), ...rows.map(csvRow)].join('\r\n') + '\r\n';
