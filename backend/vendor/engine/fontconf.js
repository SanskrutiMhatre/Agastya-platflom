'use strict';
/*
  The font configuration FOP is actually given.

  fop.xconf lists every bundled font file. FOP does not tolerate a listed file that is missing: the moment a document
  asks for that family it aborts the WHOLE render ("Failed to read font file arial.ttf", exit 1, no PDF). That turns an
  optional font into a blocker. The case that matters is Arial: the four files are proprietary, and a delivery for which
  the publisher cannot show the licence simply leaves them out (see tools/fonts/README.md) - which must mean "Liberation
  Sans is used instead", not "nothing builds".

  So every consumer asks this module for the configuration to use:

    - all listed files exist  -> the real fop.xconf, untouched (the normal case; nothing is written);
    - some are missing        -> a copy of it without those <font> entries, `font-base` made absolute, written once to a
                                 content-addressed file in the temp folder (same content, same name: safe for concurrent
                                 builds, never rewritten, never read half-written), and one line saying what was left out.

  The families that lose all their faces are then simply unknown to FOP, and a comma-separated font-family
  ("Arial,Liberation Sans") falls through to the next name. Because Liberation Sans is metric-compatible with Arial,
  pagination does not change.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const warned = new Set();

/** The <font ... embed-url="..."> ... </font> blocks of an xconf. */
const FONT_BLOCK = /[ \t]*<font\b[^>]*\bembed-url="([^"]+)"[^>]*>[\s\S]*?<\/font>[ \t]*\r?\n?/g;

/**
 * @param {object} [o]
 * @param {string} [o.xconf]   the master configuration (default: paths.FOP_XCONF)
 * @param {string} [o.outDir]  where a pruned copy goes (default: the OS temp folder)
 * @param {(m: string) => void} [o.log]
 * @returns {string|null} the path to hand FOP, or null when there is no configuration at all
 */
function fopConf(o = {}) {
  const xconf = o.xconf || require('./paths').FOP_XCONF;
  const log = o.log || ((m) => console.warn(m));
  if (!fs.existsSync(xconf)) return null;
  const xml = fs.readFileSync(xconf, 'utf8');
  const baseText = (/<font-base>\s*([^<]*?)\s*<\/font-base>/.exec(xml) || [])[1] || '';
  // font-base is a path relative to the configuration file (or absolute / a file: URL)
  const baseDir = /^file:/i.test(baseText) ? decodeURIComponent(new URL(baseText).pathname.replace(/^\/([A-Za-z]:)/, '$1')) : path.resolve(path.dirname(xconf), baseText);

  const missing = [];
  const pruned = xml.replace(FONT_BLOCK, (block, file) => {
    if (/^[a-z]+:/i.test(file)) return block;                    // an absolute URL: not ours to judge
    if (fs.existsSync(path.resolve(baseDir, file))) return block;
    missing.push(file);
    return '';
  });
  if (!missing.length) return xconf;

  const out = pruned.replace(/<font-base>[^<]*<\/font-base>/, `<font-base>${pathToFileURL(baseDir + path.sep).href}</font-base>`);
  const name = `agastya-fop-${crypto.createHash('sha256').update(out).digest('hex').slice(0, 16)}.xconf`;
  const target = path.join(o.outDir || os.tmpdir(), name);
  if (!fs.existsSync(target)) {
    const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, out, 'utf8');
      try { fs.renameSync(tmp, target); } catch { if (!fs.existsSync(target)) throw new Error('could not place the font configuration'); }
    } finally { try { fs.rmSync(tmp, { force: true }); } catch { /* already renamed */ } }
  }
  const key = `${xconf}|${missing.join(',')}`;
  if (!warned.has(key)) { warned.add(key); log(`[fonts] ${missing.length} font file(s) listed in fop.xconf are not installed (${missing.join(', ')}); builds continue without them and use the next font in the stack.`); }
  return target;
}

/** Which listed font files are absent (for a status page / doctor); empty when the installation is complete. */
function missingFonts(o = {}) {
  const xconf = o.xconf || require('./paths').FOP_XCONF;
  if (!fs.existsSync(xconf)) return [];
  const xml = fs.readFileSync(xconf, 'utf8');
  const baseText = (/<font-base>\s*([^<]*?)\s*<\/font-base>/.exec(xml) || [])[1] || '';
  const baseDir = path.resolve(path.dirname(xconf), baseText);
  const out = [];
  for (const m of xml.matchAll(FONT_BLOCK)) if (!/^[a-z]+:/i.test(m[1]) && !fs.existsSync(path.resolve(baseDir, m[1]))) out.push(m[1]);
  return out;
}

module.exports = { fopConf, missingFonts };
