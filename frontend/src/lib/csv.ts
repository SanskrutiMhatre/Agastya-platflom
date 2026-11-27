// One CSV cell writer for the exports made in the browser (audit WP-07: SEC-015, ARC-020); the server has the same rule in
// backend/src/services/csv.ts. Every cell is quoted with its quotes doubled, and a cell that begins with a formula character
// (= + - @, tab, carriage return) gets a leading apostrophe so a spreadsheet shows it as text instead of evaluating it.

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export const csvRow = (cells: unknown[]): string => cells.map(csvCell).join(',');
