/**
 * S1000D / CALS lengths ("148.7mm", "2in", "12pt"): one parser shared by the Design view, table editing and the PDF export,
 * so a `reproductionWidth` or `colwidth` means the same thing everywhere.
 */

/** Points per unit of the absolute length units S1000D allows. `px` is not a CALS/S1000D unit but is accepted when found. */
export const UNIT_PT: Record<string, number> = { mm: 72 / 25.4, cm: 72 / 2.54, in: 72, pt: 1, pc: 12, px: 0.75 };

/** CSS pixels per point (96 dpi). */
export const PX_PER_PT = 96 / 72;

/** "148.7mm" -> points; a bare number counts as pixels. null when absent, not positive or not a length. */
export function lengthToPt(v: string | null | undefined): number | null {
  if (!v) return null;
  const m = v.trim().match(/^([\d.]+)\s*(mm|cm|in|pt|pc|px)?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n * (UNIT_PT[(m[2] ?? 'px').toLowerCase()] ?? 0.75);
}

/** The same length in CSS pixels. */
export function lengthToPx(v: string | null | undefined): number | null {
  const pt = lengthToPt(v);
  return pt == null ? null : pt * PX_PER_PT;
}

/** The unit a length is written in ("" when it has none or is not a length). */
export function lengthUnit(v: string | null | undefined): string {
  const m = (v ?? '').trim().match(/^[\d.]+\s*(mm|cm|in|pt|pc|px)$/i);
  return m ? m[1].toLowerCase() : '';
}

/** Writes `px` CSS pixels as a length in `unit` (default mm) with a sensible number of decimals. */
export function formatLengthPx(px: number, unit = 'mm'): string {
  const u = UNIT_PT[unit] ? unit : 'mm';
  const value = (px / PX_PER_PT) / UNIT_PT[u];
  const decimals = u === 'in' ? 3 : u === 'cm' || u === 'pc' ? 2 : 1;
  const k = 10 ** decimals;
  return `${Math.round(value * k) / k}${u}`;
}

/** CALS `colwidth`: proportional "n*", an absolute length, or a mix ("1*+10pt"), which this editor leaves alone. */
export type ColWidthKind = 'flex' | 'abs' | 'mixed';

export function colWidthKind(v: string | null | undefined): ColWidthKind {
  const s = (v ?? '').trim();
  if (s === '' || /^[\d.]+\s*\*$/.test(s)) return 'flex';
  if (lengthToPt(s) != null) return 'abs';
  return 'mixed';
}

/** The weight of a proportional `colwidth` ("2*" -> 2; absent or anything else -> 1). */
export function colWeight(v: string | null | undefined): number {
  const m = (v ?? '').trim().match(/^([\d.]+)\s*\*$/);
  return m ? parseFloat(m[1]) || 1 : 1;
}

/**
 * A CALS `colwidth` as proportional weight plus fixed length in points: "2*" -> {star: 2, pt: 0}, "1.5in" -> {star: 0, pt: 108},
 * "1*+10pt" -> {star: 1, pt: 10}. null when empty or not understood (the caller then treats the column as "1*").
 */
export function parseColWidth(v: string | null | undefined): { star: number; pt: number } | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  let star = 0;
  let pt = 0;
  for (const part of s.split('+')) {
    const t = part.trim();
    const m = t.match(/^([\d.]+)\s*\*$/);
    if (m) {
      star += parseFloat(m[1]);
      continue;
    }
    const len = lengthToPt(t);
    if (len == null) return null;
    pt += len;
  }
  return star > 0 || pt > 0 ? { star, pt } : null;
}
