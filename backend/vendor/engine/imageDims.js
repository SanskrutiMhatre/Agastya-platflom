'use strict';
// Builds a side-car index of every image's real pixel dimensions for the
// direct S1000D -> FO pipeline.
//
// The JSS pipeline stamps intrinsic-w/-h straight onto each <graphic> in the
// generated jssbook (see images.js). The direct pipeline has no such generated
// intermediate — it renders the author's data modules as they sit on disk, and
// those must never be modified. So instead of annotating the source, this
// writes a separate `_image-dims.xml` next to the project that figures.xsl
// reads with document(), giving the stylesheet the real aspect ratio it needs
// to size a viewport exactly (XSLT 1.0 cannot measure an image itself).
//
// Keyed by bare filename: the stylesheet resolves a graphic through
// unparsed-entity-uri(), whose exact prefix depends on how each data module
// declares its ICN entity, but the final path segment is always the file.
// ICN filenames are unique in a CSDB, so this is a safe key.

const fs = require('fs');
const path = require('path');
const { imagePixelSize } = require('./images');

/*
  Resolution an image file declares for itself, in dots per inch, or 0 when it declares none (or the format
  cannot). PNG: the pHYs chunk (pixels per metre); JPEG: the JFIF APP0 density. Read-only, bounded, never throws.
*/
function imageDpi(file) {
    let fd;
    try {
        fd = fs.openSync(file, 'r');
        const head = Buffer.alloc(24);
        const n = fs.readSync(fd, head, 0, 24, 0);
        if (n >= 24 && head.toString('latin1', 1, 4) === 'PNG') {
            // chunks: 4-byte length, 4-byte type, data, 4-byte CRC; pHYs must come before the first IDAT
            let off = 8;
            const chunk = Buffer.alloc(9 + 8);
            for (let guard = 0; guard < 64; guard++) {
                if (fs.readSync(fd, chunk, 0, 8, off) < 8) return 0;
                const len = chunk.readUInt32BE(0);
                const type = chunk.toString('latin1', 4, 8);
                if (type === 'IDAT' || type === 'IEND') return 0;
                if (type === 'pHYs' && len >= 9) {
                    if (fs.readSync(fd, chunk, 0, 9, off + 8) < 9) return 0;
                    const perM = chunk.readUInt32BE(0);
                    return chunk[8] === 1 && perM > 0 ? Math.round(perM * 0.0254 * 10) / 10 : 0;
                }
                off += 12 + len;
            }
            return 0;
        }
        if (n >= 4 && head[0] === 0xFF && head[1] === 0xD8) {
            // JFIF APP0 is the first segment when present: FF E0, len, "JFIF\0", ver(2), units, Xdens(2), Ydens(2)
            const app = Buffer.alloc(18);
            if (fs.readSync(fd, app, 0, 18, 2) < 18) return 0;
            if (app[0] !== 0xFF || app[1] !== 0xE0 || app.toString('latin1', 4, 8) !== 'JFIF') return 0;
            const units = app[11]; const x = app.readUInt16BE(12);
            if (!x) return 0;
            if (units === 1) return x;
            if (units === 2) return Math.round(x * 2.54 * 10) / 10;
            return 0;
        }
        return 0;
    } catch (e) {
        return 0;
    } finally {
        if (fd !== undefined) try { fs.closeSync(fd); } catch (e) {}
    }
}

const IMAGE_RE = /\.(png|jpe?g|gif|svg)$/i;

function collect(dir, rel, into) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
        if (!IMAGE_RE.test(name)) continue;
        const key = name.toLowerCase();
        if (into.has(key)) continue; // first directory scanned wins
        const size = imagePixelSize(path.join(dir, name));
        // `src` is the project-relative path the stylesheet can hand straight
        // to fo:external-graphic when the ICN has no usable unparsed entity.
        //
        // `stem` is the name without its extension, which is what an
        // @infoEntityIdent actually holds — an ICN is cited without one. The
        // stylesheet could otherwise only look a graphic up as "<icn>.png", so
        // an uploaded .jpg or .svg was indexed here and never found.
        if (size && size.w && size.h) {
            into.set(key, { ...size, dpi: imageDpi(path.join(dir, name)), src: rel + name, stem: key.replace(/\.[^.]+$/, '') });
        }
    }
}

function xmlEscape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/*
  Writes <outName> into projectDir and returns { count, file }.
  Always writes the file — even with zero entries — so the stylesheet's
  document() call resolves instead of erroring on a missing file.
*/
function writeImageDimIndex(projectDir, csdbDir, mediaDir, outName) {
    const found = new Map();
    const csdb = csdbDir || 'csdb';
    const media = mediaDir || 'Media';
    collect(path.join(projectDir, csdb), csdb.replace(/\/*$/, '/'), found);
    collect(path.join(projectDir, media), media.replace(/\/*$/, '/'), found);

    const rows = [...found.entries()]
        .map(([name, s]) => `  <img name="${xmlEscape(name)}" stem="${xmlEscape(s.stem)}"`
            + ` w="${s.w}" h="${s.h}" dpi="${s.dpi || 0}" src="${xmlEscape(s.src)}"/>`)
        .join('\n');
    const file = outName || '_image-dims.xml';
    fs.writeFileSync(
        path.join(projectDir, file),
        `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generated by engine/imageDims.js. Do not edit; rewritten on every build. -->\n<imageDims>\n${rows}\n</imageDims>\n`,
        'utf8',
    );
    return { count: found.size, file };
}

module.exports = { writeImageDimIndex, imageDpi };
