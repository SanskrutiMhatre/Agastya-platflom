/**
 * Page geometry, typography and spacing of the S1000D publication format.
 *
 * Every number here was measured from the reference publication (an Apache FOP
 * rendering of a complete S1000D publication): A4 portrait, mirrored
 * double-sided margins (inside 25 mm, outside 18 mm), Arial/Helvetica 11 pt
 * body text justified at a 1.35 line pitch, blue cross-reference links, bold
 * 9 pt running header/footer between 0.5 pt rules.
 *
 * pdfmake only supports one set of page margins per document, so the document
 * is laid out in a *nominal* symmetric frame (`NOMINAL_MARGIN` on both sides)
 * and `pdf-mirror.ts` then translates every page by ±`SHIFT`, which turns the
 * nominal frame into the real inside/outside margins. All x coordinates in the
 * builders are therefore nominal-frame coordinates.
 */

export const PAGE_W = 595.28;
export const PAGE_H = 841.89;
export const MM = 72 / 25.4;

export const INSIDE = 25 * MM; // 70.87 pt: binding side
export const OUTSIDE = 18 * MM; // 51.02 pt
export const NOMINAL_MARGIN = (INSIDE + OUTSIDE) / 2;
export const SHIFT = (INSIDE - OUTSIDE) / 2;
/**
 * pdfmake sets the first baseline 0.718 em below the line top, FOP 1.02 em; a top margin of 84.6 pt puts the first
 * baseline of 11-12 pt text where the reference has it (93-97 pt). The bottom limit is 770 pt for the same reason.
 */
export const MARGIN_TOP = 84.6;
export const MARGIN_BOTTOM = 72;
export const CONTENT_W = PAGE_W - INSIDE - OUTSIDE; // 473.39 pt
/**
 * Landscape pages (S1000D `orient="land"` / `foldout`): the same A4 sheet turned, with the same mirrored margins and
 * header/footer distances. `LAND_IMG_H` is the tallest picture that still leaves room for its ICN line and caption.
 */
export const LAND_W = PAGE_H - INSIDE - OUTSIDE; // 720.0 pt = 254 mm
export const LAND_H = PAGE_W - MARGIN_TOP - MARGIN_BOTTOM;
export const LAND_IMG_H = Math.floor(LAND_H - 60);
/** Left indent of nested content and of tables in descriptive text (2 cm). */
export const INDENT = 20 * MM;
/** Width of the number column of a first-level heading. */
export const NUM_COL_1 = 22.6;
/** Left/right inset of warning, caution and note text (1 cm). */
export const ADMON_INSET = 10 * MM;

export const FS = { body: 11, table: 11, toc: 10, small: 9, icn: 8, h1: 14, h2: 12, title: 16, sub: 7.7 } as const;

/**
 * pdfmake multiplies the font's own line height ((ascender - descender)/1000 em = 0.925 em for Helvetica) by
 * `lineHeight`; 1.4594 x 0.925 = 1.35 em, the reference's 14.85 pt pitch at 11 pt.
 */
export const LH = 1.35 / 0.925;
/** Roboto's line is 1.172 em tall, so a fallback-font run needs a smaller factor to keep the line pitch. */
export const LH_FALLBACK = (1.35 / 1.172) * 1;

export const COLOR = { text: '#000000', link: '#0000ff', rule: '#000000', watermark: '#c3410c', muted: '#444444' } as const;
export const WATERMARK_OPACITY = 0.3;
export const WATERMARK_SIZE = 69.79;

/**
 * Justified text: how far a word space may be narrowed (fraction of the space's own width) before a line is
 * considered full. Apache FOP shrinks spaces by about a third; with this value pdfmake breaks justified paragraphs
 * into the same number of lines as the reference (see `pdfmake-patch.ts`, patch `justify-shrink`).
 */
export const JUSTIFY = { shrink: 1 / 3 } as const;

/** Vertical rhythm (pt) between blocks, measured from the reference. */
export const GAP = {
  para: 12,
  listItem: 4.25,
  headBefore: 2.2,
  headAfter: 17.65,
  caption: 5.9,
  cellPara: 4,
  afterTable: 9.9,
} as const;

export const TABLE = {
  border: 0.75,
  borderColor: '#000000',
  /** Cell padding. Text starts 4.55 pt inside a cell edge in the reference (0.75 border + 3.8); a single-line row is 23.9 pt (14.85 line + 2 x 4.15 + 0.75 rule). */
  padX: 3.8,
  padY: 4.15,
  /** Vertical padding of the borderless front-matter list tables, and the extra space under their header row. */
  listPadY: 4.45,
  listHeadExtra: 0.6,
} as const;

/** Header baseline (pt from page top) and rule. */
export const HEADER = { baseline: 41.7, ruleY: 61.5, size: 9, logoH: 24 } as const;
/** Footer baselines when the footer has three / two lines, and the rule's distance above the first baseline. */
export const FOOTER = { base3: 783.2, base2: 794, step: 10.8, ruleGap: 8.2, size: 9 } as const;
