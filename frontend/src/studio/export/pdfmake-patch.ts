/**
 * Targeted, verified patches to the pdfmake 0.3.13 browser bundle.
 *
 * pdfmake is a layout engine with a fixed set of behaviours; the publication format of the reference (Apache FOP
 * output) needs four things it cannot do through its public options:
 *
 *  1. `justify-shrink`   FOP sets justified lines with word spaces that may be narrowed by about a third of a space.
 *                        pdfmake only ever stretches, so every paragraph needed ~10 % more lines than the reference.
 *                        The patched fit test lets a *justified* line take one more word when the spaces on the line
 *                        can shrink enough to hold it; ragged text (table cells, headings, captions) and the final
 *                        line of a paragraph keep their natural spacing.
 *  2. `justify-gaps`     pdfmake spreads the justification slack over every inline boundary, so an emphasised run
 *                        in the middle of a word, a sub/superscript or a link next to punctuation opened a gap.
 *                        The patched `alignLine` hands the slack to the word spaces only.
 *  3. `page-break-batch` pdfmake re-lays out the *whole document* each time `pageBreakBefore` returns true
 *                        (once per orphaned heading), which made a 1 000-page publication ~7x slower than needed.
 *                        The patch collects at most one break per independent section (a node with
 *                        `pageBreak: 'beforeEven'/'beforeOdd'`, which always starts a fresh page) per round, and
 *                        reports the final node positions to `pageBreakBefore.onLayout(nodeInfos)`.
 *  4. `filler-orientation` the blank page pdfmake inserts to start a section on a right-hand page took the
 *                        orientation of the new section; FOP gives it the orientation of the section it ends.
 *  5. `measure-cache`    every layout round re-measured (UAX#14 line breaking + glyph widths) the whole document,
 *                        which was half of the generation time; a text node is now measured once and later rounds
 *                        start from a copy of that result.
 *  6. `defer-chrome`     headers, footers and backgrounds were rebuilt in every round although only the last
 *                        layout is kept; they are now added once, after the page breaks are settled.
 *
 * The patches are plain text replacements of *exact* source fragments, applied to the unminified bundle string
 * that Vite imports with `?raw` and evaluated once (`instantiatePdfmake`). Every fragment must occur exactly once;
 * a patch whose fragment is missing is skipped and reported (`missing`), so an upgraded pdfmake degrades to its
 * stock behaviour instead of failing - the unit tests fail loudly in that case.
 */

export type PatchId = 'justify-shrink' | 'justify-gaps' | 'page-break-batch' | 'filler-orientation' | 'measure-cache' | 'defer-chrome';

export interface PatchResult {
  source: string;
  applied: PatchId[];
  missing: PatchId[];
}

interface Replacement { from: string; to: string }
interface Patch { id: PatchId; replacements: Replacement[] }

const lines = (...l: string[]): string => l.join('\n');

function patches(shrink: number): Patch[] {
  const S = String(shrink);
  return [
    {
      id: 'justify-shrink',
      replacements: [
        {
          from: lines(
            '  getAvailableWidth() {',
            '    return this.maxWidth - this.getWidth();',
            '  }',
          ),
          to: lines(
            '  getAvailableWidth(inline) {',
            '    return this.maxWidth - this.getWidth() + (inline ? this.shrinkRoom(inline) : 0);',
            '  }',
            '  /** Width the word spaces already on a justified line can give up (patched: justified text may shrink its spaces). */',
            '  shrinkRoom(inline) {',
            "    if (!inline || inline.alignment !== 'justify') {",
            '      return 0;',
            '    }',
            '    let room = 0;',
            '    for (let i = 0; i < this.inlines.length; i++) {',
            `      room += (this.inlines[i].trailingCut || 0) * ${S};`,
            '    }',
            '    return room;',
            '  }',
          ),
        },
        {
          from: lines(
            '    let inlineTrailingCut = inline.trailingCut || 0;',
            '    if (inline.noNewLine) {',
            '      for (let i = 0, l = nextInlines.length; i < l; i++) {',
            '        let nextInline = nextInlines[i];',
            '        inlineWidth += nextInline.width;',
            '        inlineTrailingCut += nextInline.trailingCut || 0;',
            '        if (!nextInline.noNewLine) {',
            '          break;',
            '        }',
            '      }',
            '    }',
            '    return this.inlineWidths + inlineWidth - this.leadingCut - inlineTrailingCut <= this.maxWidth;',
          ),
          to: lines(
            '    let inlineTrailingCut = inline.trailingCut || 0;',
            '    let groupLength = 1;',
            '    if (inline.noNewLine) {',
            '      for (let i = 0, l = nextInlines.length; i < l; i++) {',
            '        let nextInline = nextInlines[i];',
            '        inlineWidth += nextInline.width;',
            '        inlineTrailingCut += nextInline.trailingCut || 0;',
            '        groupLength++;',
            '        if (!nextInline.noNewLine) {',
            '          break;',
            '        }',
            '      }',
            '    }',
            '    // patched: a justified line that is not the paragraph\'s last may narrow its word spaces to take one more word',
            '    const shrinkable = groupLength <= nextInlines.length ? this.shrinkRoom(inline) : 0;',
            '    return this.inlineWidths + inlineWidth - this.leadingCut - inlineTrailingCut - shrinkable <= this.maxWidth;',
          ),
        },
        {
          from: lines(
            '      if (!inline.noWrap && inline.text.length > 1 && inline.width > line.getAvailableWidth()) {',
            '        let maxChars = findMaxFitLength(inline.text, line.getAvailableWidth(), txt => textInlines.widthOfText(txt, inline));',
          ),
          to: lines(
            '      if (!inline.noWrap && inline.text.length > 1 && inline.width > line.getAvailableWidth(inline)) {',
            '        let maxChars = findMaxFitLength(inline.text, line.getAvailableWidth(inline), txt => textInlines.widthOfText(txt, inline));',
          ),
        },
      ],
    },
    {
      id: 'justify-gaps',
      replacements: [
        {
          from: lines(
            '      let additionalSpacing = (width - lineWidth) / (line.inlines.length - 1);',
            '      for (let i = 1, l = line.inlines.length; i < l; i++) {',
            '        offset = i * additionalSpacing;',
            '        line.inlines[i].x += offset;',
            '        line.inlines[i].justifyShift = additionalSpacing;',
            '      }',
          ),
          to: lines(
            '      // patched: the slack goes to the word spaces only (boundaries after an inline that ends in whitespace);',
            '      // a line without any space (one long word, hyphen breaks) falls back to every boundary',
            '      const gaps = [];',
            '      for (let i = 1, l = line.inlines.length; i < l; i++) {',
            '        if ((line.inlines[i - 1].trailingCut || 0) > 0) {',
            '          gaps.push(i);',
            '        }',
            '      }',
            '      const spread = gaps.length || line.inlines.length - 1;',
            '      const additionalSpacing = (width - lineWidth) / spread;',
            '      let shift = 0;',
            '      for (let i = 1, l = line.inlines.length; i < l; i++) {',
            '        const isGap = gaps.length === 0 || gaps.indexOf(i) !== -1;',
            '        if (isGap) {',
            '          shift += additionalSpacing;',
            '        }',
            '        line.inlines[i].x += shift;',
            '        line.inlines[i].justifyShift = isGap ? additionalSpacing : 0;',
            '      }',
          ),
        },
      ],
    },
    {
      id: 'page-break-batch',
      replacements: [
        {
          from: lines(
            '      for (let index = 0; index < linearNodeList.length; index++) {',
            '        let node = linearNodeList[index];',
            "        if (node.pageBreak !== 'before' && !node.pageBreakCalculated) {",
          ),
          to: lines(
            '      let anyPageBreak = false; // patched: see pdfmake-patch.ts (page-break-batch)',
            '      let skipRestOfSection = false;',
            '      for (let index = 0; index < linearNodeList.length; index++) {',
            '        let node = linearNodeList[index];',
            '        if (skipRestOfSection) {',
            "          // positions after a new break are stale until the next layout, except in a section that starts a fresh page",
            "          if (node.nodeInfo.pageBreak === 'beforeEven' || node.nodeInfo.pageBreak === 'beforeOdd') {",
            '            skipRestOfSection = false;',
            '          } else {',
            '            continue;',
            '          }',
            '        }',
            "        if (node.pageBreak !== 'before' && !node.pageBreakCalculated) {",
          ),
        },
        {
          from: lines(
            "            node.pageBreak = 'before';",
            '            return true;',
            '          }',
            '        }',
            '      }',
            '      return false;',
            '    }',
          ),
          to: lines(
            "            node.pageBreak = 'before';",
            '            anyPageBreak = true;',
            '            skipRestOfSection = true;',
            '          }',
            '        }',
            '      }',
            "      if (!anyPageBreak && typeof pageBreakBeforeFct.onLayout === 'function') {",
            '        pageBreakBeforeFct.onLayout(linearNodeList.map(n => n.nodeInfo));',
            '      }',
            '      return anyPageBreak;',
            '    }',
          ),
        },
      ],
    },
    {
      id: 'measure-cache',
      replacements: [
        {
          from: lines(
            '    styleStack.push(node);',
            '    let data = this.textInlines.buildInlines(node.text, styleStack);',
            '    node._inlines = data.items;',
            '    node._minWidth = data.minWidth;',
            '    node._maxWidth = data.maxWidth;',
          ),
          to: lines(
            '    styleStack.push(node);',
            '    // patched: a static text node is measured once; layout consumes and edits its inlines, so every round gets copies',
            '    const cacheable = !node._textRef && !node._pageRef;',
            '    let measured = cacheable && node._measured && node._measured.text === node.text ? node._measured : null;',
            '    if (!measured) {',
            '      const built = this.textInlines.buildInlines(node.text, styleStack);',
            '      measured = { text: node.text, items: built.items, minWidth: built.minWidth, maxWidth: built.maxWidth };',
            '      if (cacheable) {',
            '        node._measured = measured;',
            '      }',
            '    }',
            '    node._inlines = cacheable ? measured.items.map(inline => Object.assign({}, inline)) : measured.items;',
            '    node._minWidth = measured.minWidth;',
            '    node._maxWidth = measured.maxWidth;',
          ),
        },
      ],
    },
    {
      id: 'defer-chrome',
      replacements: [
        {
          from: lines(
            '    this.processNode(docStructure);',
            '    this.addHeadersAndFooters(header, footer);',
            '    this.addWatermark(watermark, pdfDocument, defaultStyle);',
          ),
          to: lines(
            '    this.processNode(docStructure);',
            '    if (!this._deferChrome) {',
            '      this.addHeadersAndFooters(header, footer);',
            '    }',
            '    this.addWatermark(watermark, pdfDocument, defaultStyle);',
          ),
        },
        {
          from: lines(
            '    let result = this.tryLayoutDocument(docStructure, pdfDocument, styleDictionary, defaultStyle, background, header, footer, watermark);',
            '    while (addPageBreaksIfNecessary(result.linearNodeList, result.pages)) {',
            '      resetXYs(result);',
            '      result = this.tryLayoutDocument(docStructure, pdfDocument, styleDictionary, defaultStyle, background, header, footer, watermark);',
            '    }',
            '    return result.pages;',
          ),
          to: lines(
            '    // patched: headers and footers are only needed on the layout that is kept',
            '    this._deferChrome = true;',
            '    let result = this.tryLayoutDocument(docStructure, pdfDocument, styleDictionary, defaultStyle, background, header, footer, watermark);',
            '    while (addPageBreaksIfNecessary(result.linearNodeList, result.pages)) {',
            '      resetXYs(result);',
            '      result = this.tryLayoutDocument(docStructure, pdfDocument, styleDictionary, defaultStyle, background, header, footer, watermark);',
            '    }',
            '    this._deferChrome = false;',
            '    this.addHeadersAndFooters(header, footer);',
            '    return result.pages;',
          ),
        },
      ],
    },
    {
      id: 'filler-orientation',
      replacements: [
        {
          from: lines(
            "      } else if (node.pageBreak === 'beforeEven') {",
            '        this.writer.moveToNextPage(node.pageOrientation);',
            '        if ((this.writer.context().page + 1) % 2 === 0) {',
            '          this.writer.moveToNextPage(node.pageOrientation);',
            '        }',
            '      }',
          ),
          to: lines(
            "      } else if (node.pageBreak === 'beforeEven') {",
            '        // patched: the filler page that lets a section start on a right-hand page keeps the orientation of the page before it',
            '        if ((this.writer.context().page + 2) % 2 === 0) {',
            '          this.writer.moveToNextPage(this.writer.context().getCurrentPage().pageSize.orientation);',
            '        }',
            '        this.writer.moveToNextPage(node.pageOrientation);',
            '      }',
          ),
        },
      ],
    },
  ];
}

const count = (haystack: string, needle: string): number => {
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
};

/** Applies every patch whose source fragments are all present exactly once; the others are skipped and listed. */
export function patchPdfmakeSource(original: string, shrink: number): PatchResult {
  let source = original.replace(/\r\n/g, '\n');
  const applied: PatchId[] = [];
  const missing: PatchId[] = [];
  for (const p of patches(shrink)) {
    if (!p.replacements.every((r) => count(source, r.from) === 1)) {
      missing.push(p.id);
      continue;
    }
    for (const r of p.replacements) source = source.replace(r.from, () => r.to);
    applied.push(p.id);
  }
  return { source, applied, missing };
}

/** Evaluates the (patched) UMD bundle and returns what it exports (`createPdf`, `addFontContainer`, ...). */
export function instantiatePdfmake(source: string): unknown {
  const mod: { exports: unknown } = { exports: {} };
  // the bundle is a webpack UMD wrapper: with `module` + `exports` in scope it assigns `module.exports = factory()`
  const run = new Function('module', 'exports', `${source}\n//# sourceURL=pdfmake-patched.js`);
  run.call(globalThis, mod, mod.exports);
  return mod.exports;
}
