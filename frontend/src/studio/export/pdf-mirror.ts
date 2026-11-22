/**
 * Mirrored (double-sided) page margins.
 *
 * pdfmake lays every page out in one fixed frame, but a double-sided
 * publication has a wider inside margin: odd (recto) pages sit further right,
 * even (verso) pages further left. The document is laid out in a symmetric
 * nominal frame; this module then translates each page's content by +shift
 * (recto) or -shift (verso) so the nominal frame becomes the real one.
 *
 * It works as a standard PDF *incremental update*: the original bytes are left
 * untouched and appended to with three tiny content streams (`q 1 0 0 1 dx 0
 * cm`, its mirror and `Q`), replacement page dictionaries whose /Contents wrap
 * the original stream between them, replacement link annotations whose /Rect
 * follows the shifted text, and a new cross-reference section. pdfkit (which
 * pdfmake uses) writes a classic xref table and plain page dictionaries, which
 * is all this needs; anything else is detected and the input is returned
 * unchanged (`null`) so the caller can fall back to the symmetric layout.
 */

function toLatin1(b: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH) as unknown as number[]);
  return s;
}

function fromLatin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

const num = (n: number) => String(Math.round(n * 1000) / 1000);

/** Reads the classic xref table at `offset`: object number -> byte offset (in-use entries only). */
function readXref(text: string, offset: number): Map<number, number> | null {
  let p = text.indexOf('xref', offset);
  if (p < 0 || p > offset + 8) return null;
  p += 4;
  const map = new Map<number, number>();
  const re = /\s*(\d+)\s+(\d+)\s*/y;
  for (;;) {
    re.lastIndex = p;
    const m = re.exec(text);
    if (!m) break;
    const start = parseInt(m[1], 10);
    const count = parseInt(m[2], 10);
    p = re.lastIndex;
    const entry = /(\d{10}) (\d{5}) ([nf])\s*/y;
    for (let i = 0; i < count; i++) {
      entry.lastIndex = p;
      const e = entry.exec(text);
      if (!e) return null;
      if (e[3] === 'n') map.set(start + i, parseInt(e[1], 10));
      p = entry.lastIndex;
    }
  }
  return map;
}

/**
 * Returns a copy of `pdf` whose odd pages are shifted right by `shift` points and even pages left by `shift`,
 * or `null` when the file is not in the plain layout this understands.
 */
export function mirrorPages(pdf: Uint8Array, shift: number): Uint8Array | null {
  try {
    const text = toLatin1(pdf);
    const sx = text.lastIndexOf('startxref');
    if (sx < 0) return null;
    const prev = parseInt(text.slice(sx + 9).trim(), 10);
    const tr = text.lastIndexOf('trailer', sx);
    if (!Number.isFinite(prev) || tr < 0) return null;
    const trailer = text.slice(tr, sx);
    const size = parseInt(/\/Size\s+(\d+)/.exec(trailer)?.[1] ?? '', 10);
    const root = /\/Root\s+(\d+)\s+(\d+)\s+R/.exec(trailer);
    if (!Number.isFinite(size) || !root) return null;
    const info = /\/Info\s+(\d+)\s+(\d+)\s+R/.exec(trailer);
    const id = /\/ID\s*\[[^\]]*\]/.exec(trailer);
    const xref = readXref(text, prev);
    if (!xref) return null;

    const objBody = (n: number): string | null => {
      const off = xref.get(n);
      if (off == null) return null;
      const head = new RegExp(`^${n}\\s+0\\s+obj`).exec(text.slice(off, off + 24));
      if (!head) return null;
      const end = text.indexOf('endobj', off);
      return end < 0 ? null : text.slice(off + head[0].length, end).trim();
    };

    // page tree -> page object numbers in order
    const catalog = objBody(parseInt(root[1], 10));
    const pagesRef = catalog && /\/Pages\s+(\d+)\s+0\s+R/.exec(catalog);
    if (!pagesRef) return null;
    const pageNums: number[] = [];
    const walk = (n: number, depth: number): boolean => {
      const b = objBody(n);
      if (!b || depth > 8) return false;
      if (/\/Type\s*\/Pages\b/.test(b)) {
        const kids = /\/Kids\s*\[([^\]]*)\]/.exec(b);
        if (!kids) return false;
        for (const m of kids[1].matchAll(/(\d+)\s+0\s+R/g)) if (!walk(parseInt(m[1], 10), depth + 1)) return false;
        return true;
      }
      pageNums.push(n);
      return true;
    };
    if (!walk(parseInt(pagesRef[1], 10), 0) || pageNums.length === 0) return null;

    let next = size;
    const preRecto = next++;
    const preVerso = next++;
    const post = next++;
    const base = pdf.length;
    let out = '\n';
    const entries: [number, number][] = [];
    const put = (n: number, content: string) => {
      entries.push([n, base + out.length]);
      out += `${n} 0 obj\n${content}\nendobj\n`;
    };
    const stream = (n: number, data: string) => put(n, `<< /Length ${data.length} >>\nstream\n${data}\nendstream`);
    stream(preRecto, `q 1 0 0 1 ${num(shift)} 0 cm`);
    stream(preVerso, `q 1 0 0 1 ${num(-shift)} 0 cm`);
    stream(post, 'Q');

    const doneAnnots = new Set<number>();
    pageNums.forEach((pn, i) => {
      const recto = (i + 1) % 2 === 1;
      const dx = recto ? shift : -shift;
      let body = objBody(pn)!;
      const c1 = /\/Contents\s+(\d+)\s+0\s+R/.exec(body);
      const cA = /\/Contents\s*\[([^\]]*)\]/.exec(body);
      const wrap = (inner: string) => `[${recto ? preRecto : preVerso} 0 R ${inner.trim()} ${post} 0 R]`;
      if (c1) body = body.replace(c1[0], `/Contents ${wrap(`${c1[1]} 0 R`)}`);
      else if (cA) body = body.replace(cA[0], `/Contents ${wrap(cA[1])}`);
      else return; // empty page: nothing to shift
      // link annotations follow the text
      const an = /\/Annots\s*\[([^\]]*)\]/.exec(body);
      if (an) {
        for (const m of an[1].matchAll(/(\d+)\s+0\s+R/g)) {
          const a = parseInt(m[1], 10);
          if (doneAnnots.has(a)) continue;
          doneAnnots.add(a);
          const ab = objBody(a);
          if (!ab) continue;
          const rect = /\/Rect\s*\[\s*([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s*\]/.exec(ab);
          if (!rect) continue;
          const r = `/Rect [${num(parseFloat(rect[1]) + dx)} ${rect[2]} ${num(parseFloat(rect[3]) + dx)} ${rect[4]}]`;
          put(a, ab.replace(rect[0], r));
        }
      }
      put(pn, body);
    });

    const xrefAt = base + out.length;
    entries.sort((a, b) => a[0] - b[0]);
    let x = 'xref\n';
    for (let i = 0; i < entries.length; ) {
      let j = i;
      while (j + 1 < entries.length && entries[j + 1][0] === entries[j][0] + 1) j++;
      x += `${entries[i][0]} ${j - i + 1}\n`;
      for (let k = i; k <= j; k++) x += `${String(entries[k][1]).padStart(10, '0')} 00000 n \n`;
      i = j + 1;
    }
    x += `trailer\n<< /Size ${next} /Root ${root[1]} ${root[2]} R${info ? ` /Info ${info[1]} ${info[2]} R` : ''} /Prev ${prev}${id ? ` ${id[0]}` : ''} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
    out += x;

    const tail = fromLatin1(out);
    const merged = new Uint8Array(pdf.length + tail.length);
    merged.set(pdf, 0);
    merged.set(tail, pdf.length);
    return merged;
  } catch {
    return null;
  }
}
