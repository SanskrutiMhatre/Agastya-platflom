// =============================================================================
// A pure-JS PNG encoder, just enough to draw the "missing graphic" placeholder.
//
// WHY: S1000D data modules declare their artwork as ICN entities. A package that declares a graphic it does
// not ship breaks the PDF build (FOP aborts on an unresolvable image) - and the author cannot fix a build that
// never starts. The importer therefore writes a small, valid, clearly-labelled PNG in the missing file's place.
// It is not a drawing a customer could mistake for the real figure: it says PLACEHOLDER / MISSING GRAPHIC and
// carries a tEXt chunk so tools (and `isPlaceholderPng`) can recognise it later and refuse to release a manual
// that still contains one.
//
// No dependency: zlib and CRC-32 are Node built-ins; the 5x7 bitmap font covers only the glyphs the label needs.
// =============================================================================

import zlib from 'zlib';

/** The tEXt keyword and value every placeholder carries. */
export const PLACEHOLDER_KEYWORD = 'AgastyaImport';
export const PLACEHOLDER_MARK = 'placeholder-for-missing-icn';

const GLYPHS: Record<string, string[]> = {
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};

type Rgb = [number, number, number];

class Canvas {
  readonly data: Buffer;
  constructor(readonly w: number, readonly h: number, bg: Rgb) {
    this.data = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) { this.data[i * 3] = bg[0]; this.data[i * 3 + 1] = bg[1]; this.data[i * 3 + 2] = bg[2]; }
  }
  px(x: number, y: number, c: Rgb): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 3;
    this.data[o] = c[0]; this.data[o + 1] = c[1]; this.data[o + 2] = c[2];
  }
  rect(x: number, y: number, w: number, h: number, c: Rgb): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c);
  }
  line(x0: number, y0: number, x1: number, y1: number, c: Rgb): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let s = 0; s <= steps; s++) this.px(Math.round(x0 + ((x1 - x0) * s) / steps), Math.round(y0 + ((y1 - y0) * s) / steps), c);
  }
  /** Text in the 5x7 font, centred on `cx`, top at `y`, each font pixel drawn `scale` pixels square. Unknown characters become spaces. */
  text(s: string, cx: number, y: number, scale: number, c: Rgb): void {
    const adv = 6 * scale;
    const total = s.length * adv - scale;
    let x = Math.round(cx - total / 2);
    for (const ch of s.toUpperCase()) {
      const g = GLYPHS[ch] ?? GLYPHS[' '];
      for (let r = 0; r < 7; r++) for (let q = 0; q < 5; q++) if (g[r][q] === '#') this.rect(x + q * scale, y + r * scale, scale, scale, c);
      x += adv;
    }
  }
}

function chunk(type: string, data: Buffer): Buffer {
  const t = Buffer.from(type, 'latin1');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0);
  return Buffer.concat([len, t, data, crc]);
}

/** Encode an 8-bit RGB image. `text` entries become tEXt chunks (keyword + value, Latin-1). */
export function encodePng(w: number, h: number, rgb: Buffer, text: Record<string, string> = {}): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);   // filter byte 0 (None) stays 0
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)];
  for (const [k, v] of Object.entries(text)) parts.push(chunk('tEXt', Buffer.concat([Buffer.from(k, 'latin1'), Buffer.from([0]), Buffer.from(v, 'latin1')])));
  parts.push(chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/**
 * The placeholder figure for a missing ICN. 480x320, grey with a crossed frame, labelled in plain capitals.
 * Deterministic: the same ICN name always yields the same bytes (a repair run twice must change nothing).
 */
export function placeholderPng(icn = ''): Buffer {
  const W = 480; const H = 320;
  const c = new Canvas(W, H, [236, 236, 236]);
  const dark: Rgb = [90, 90, 90]; const mid: Rgb = [185, 185, 185];
  c.line(0, 0, W - 1, H - 1, mid); c.line(0, H - 1, W - 1, 0, mid);
  c.rect(0, 0, W, 5, dark); c.rect(0, H - 5, W, 5, dark); c.rect(0, 0, 5, H, dark); c.rect(W - 5, 0, 5, H, dark);
  c.rect(30, 70, W - 60, 180, [255, 255, 255]);
  c.rect(30, 70, W - 60, 3, dark); c.rect(30, 247, W - 60, 3, dark); c.rect(30, 70, 3, 180, dark); c.rect(W - 33, 70, 3, 180, dark);
  c.text('PLACEHOLDER', W / 2, 90, 6, [20, 20, 20]);
  c.text('MISSING GRAPHIC', W / 2, 150, 4, [150, 20, 20]);
  // The figure's serial number (the 5 digits before the issue/variant suffix of an S1000D ICN), when it has one.
  const serial = /-(\d{5})-[A-Z0-9]-\d{3}-\d{2}(?:\.[a-z0-9]+)?$/i.exec(icn)?.[1] ?? /(\d{3,6})(?:[^\d]*)$/.exec(icn)?.[1] ?? '';
  if (serial) c.text(`ICN ${serial}`, W / 2, 200, 4, [60, 60, 60]);
  return encodePng(W, H, c.data, { [PLACEHOLDER_KEYWORD]: PLACEHOLDER_MARK, Comment: `Placeholder for missing graphic ${icn}`.slice(0, 200).replace(/[^\x20-\x7e]/g, '?') });
}

export interface PngInfo { width: number; height: number; placeholder: boolean }

/** Header facts of a PNG, or null when the bytes are not a PNG. Walks the chunks; checks CRCs only of the chunks it reads. */
export function pngInfo(b: Uint8Array): PngInfo | null {
  const buf = Buffer.from(b.buffer, b.byteOffset, b.length);
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  let width = 0; let height = 0; let placeholder = false; let p = 8; let sawEnd = false;
  while (p + 12 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    if (p + 12 + len > buf.length) return null;
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    if (type === 'tEXt' && data.toString('latin1').startsWith(`${PLACEHOLDER_KEYWORD}\0${PLACEHOLDER_MARK}`)) placeholder = true;
    if (type === 'IEND') { sawEnd = true; break; }
    p += 12 + len;
  }
  return sawEnd && width > 0 && height > 0 ? { width, height, placeholder } : null;
}

export const isPlaceholderPng = (b: Uint8Array): boolean => !!pngInfo(b)?.placeholder;
