'use strict';
// Resource confinement for the XSL-FO, run on the FO file after the stylesheets and before FOP renders it
// (audit WP-02 / SEC-003 / SEC-011; vendor exception "foGuard", docs/JSS_VENDOR_EXCEPTIONS.md).
//
// Apache FOP fetches whatever an fo:external-graphic, an fo:color-profile, a background-image or an SVG <image> names:
// an http(s) URL (server-side request forgery: the audit saw the bundled Java make requests to an attacker's address
// during an ordinary build), or any file of this machine. The source documents are checked when they are saved, but
// the FO is assembled from several places (project settings, brand packs, stylesheet parameters, generated front
// matter), so this is the one point every build of every format passes through.
//
// Rule: a reference is kept when it is a data: image, or a local file inside one of the allowed folders (the build
// folder, the project, the vendored engine with its default artwork, the shared templates and brand packs). Anything
// else is replaced by a 1x1 transparent PNG and reported; the build goes on. For content that only references allowed
// files the FO is not touched at all (byte-identical), so builds of legitimate documents are unchanged.

const fs = require('fs');
const path = require('path');

const BLANK_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const VENDOR_DIR = path.resolve(__dirname, '..');

/** A local path for a reference, or null when it is not a local file (a URL of another scheme). */
function localPathOf(ref, baseDir) {
    let s = String(ref || '').trim();
    if (!s || s.startsWith('#')) return { kind: 'empty' };
    if (/^data:/i.test(s)) return /^data:image\//i.test(s) ? { kind: 'data' } : { kind: 'bad' };
    s = s.replace(/&amp;/g, '&');
    try { s = decodeURIComponent(s); } catch { /* keep as written */ }
    let m;
    if ((m = /^file:(\/\/\/?|\/)?(.*)$/i.exec(s))) {
        let rest = m[2];
        if (m[1] === '//' && !/^[a-zA-Z]:/.test(rest)) return { kind: 'bad' };       // file://host/share: a UNC path
        if (/^\/[a-zA-Z]:/.test(rest)) rest = rest.slice(1);
        return { kind: 'file', abs: path.resolve(/^[a-zA-Z]:/.test(rest) || rest.startsWith('/') ? rest : path.join(baseDir, rest)) };
    }
    if (/^\\\\|^\/\//.test(s)) return { kind: 'bad' };                                 // UNC
    if (/^[a-zA-Z]:[\\/]/.test(s)) return { kind: 'file', abs: path.resolve(s) };
    if (/^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(s)) return { kind: 'bad' };                  // http:, https:, jar:, ftp: ...
    return { kind: 'file', abs: path.resolve(baseDir, s) };
}

const inside = (abs, roots) => roots.some((r) => { const rel = path.relative(r, abs); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); });

function normRoots(baseDir, extra) {
    return [baseDir, VENDOR_DIR, ...(extra || [])].filter(Boolean).map((r) => path.resolve(r));
}

/** Is an SVG file safe to hand to FOP (Batik): every href it carries is a fragment, a data: image or an allowed file? */
function svgProblem(abs, roots) {
    let text;
    try { text = fs.readFileSync(abs, 'utf8'); } catch { return null; }      // a missing file is reported by checkImages
    if (/<!ENTITY[^>]*\bSYSTEM\b/i.test(text)) return 'declares an external entity';
    for (const m of text.matchAll(/\b(?:xlink:)?href\s*=\s*(["'])([\s\S]*?)\1/g)) {
        const r = localPathOf(m[2], path.dirname(abs));
        if (r.kind === 'empty' || r.kind === 'data') continue;
        if (r.kind === 'bad' || !inside(r.abs, roots)) return `references ${m[2].slice(0, 80)}`;
    }
    for (const m of text.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/g)) {
        const r = localPathOf(m[2], path.dirname(abs));
        if (r.kind === 'empty' || r.kind === 'data') continue;
        if (r.kind === 'bad' || !inside(r.abs, roots)) return `references ${m[2].slice(0, 80)}`;
    }
    return null;
}

/**
 * Confine the resources of the FO file at foPath. Returns { removed: [{ ref, why }] }; rewrites the file only when
 * something was removed.
 */
function confineFo(foPath, opts = {}) {
    if (!fs.existsSync(foPath)) return { removed: [] };
    const baseDir = path.resolve(opts.baseDir || path.dirname(foPath));
    const roots = normRoots(baseDir, opts.roots);
    const text = fs.readFileSync(foPath, 'utf8');
    const removed = [];
    const judge = (ref) => {
        const r = localPathOf(ref, baseDir);
        if (r.kind === 'empty' || r.kind === 'data') return null;
        if (r.kind === 'bad') return 'not a local file';
        if (!inside(r.abs, roots)) return 'outside the project and the engine';
        if (/\.svgz?$/i.test(r.abs)) { const p = svgProblem(r.abs, roots); if (p) return `an SVG that ${p}`; }
        return null;
    };
    // src="..." (bare or url('...')) on any element, url(...) in any other attribute (background-image), and the hrefs of
    // inline SVG (fo:instream-foreign-object).
    let out = text.replace(/(\bsrc\s*=\s*")(?:url\((['"]?)([^'")]*)\2\)|([^"]*))(")/g, (all, pre, q, inUrl, bare, post) => {
        const ref = inUrl !== undefined ? inUrl : bare;
        const why = judge(ref);
        if (!why) return all;
        removed.push({ ref, why });
        return `${pre}url('${BLANK_PNG}')${post}`;
    });
    out = out.replace(/(\b(?:background-image|fox:[\w-]+)\s*=\s*")url\((['"]?)([^'")]*)\2\)(")/g, (all, pre, q, ref, post) => {
        const why = judge(ref);
        if (!why) return all;
        removed.push({ ref, why });
        return `${pre}url('${BLANK_PNG}')${post}`;
    });
    out = out.replace(/(\b(?:xlink:)?href\s*=\s*")([^"]*)(")/g, (all, pre, ref, post, offset, whole) => {
        // fo:basic-link external-destination is a link in the PDF, never fetched; only SVG image hrefs are resources.
        const tagStart = whole.lastIndexOf('<', offset);
        const tag = whole.slice(tagStart, offset);
        if (!/^<(?:svg:)?(image|use|feImage|tref|pattern|filter|linearGradient|radialGradient|script|font-face-uri|color-profile|cursor)\b/i.test(tag)) return all;
        const r = localPathOf(ref, baseDir);
        if (r.kind === 'empty' || (r.kind === 'data' && !/^<(?:svg:)?script/i.test(tag))) return all;
        const why = r.kind === 'bad' ? 'not a local file' : !inside(r.abs, roots) ? 'outside the project and the engine' : null;
        if (!why) return all;
        removed.push({ ref, why });
        return `${pre}${BLANK_PNG}${post}`;
    });
    if (removed.length) fs.writeFileSync(foPath, out, 'utf8');
    return { removed };
}

/** One line for the build log, or '' when nothing was removed. */
function formatConfine(r) {
    if (!r || !r.removed.length) return '';
    const shown = r.removed.slice(0, 5).map((x) => `${x.ref.slice(0, 80)} (${x.why})`);
    return `${r.removed.length} picture reference(s) refused and left blank: ${shown.join('; ')}${r.removed.length > 5 ? `, +${r.removed.length - 5} more` : ''}`;
}

module.exports = { confineFo, formatConfine, localPathOf, BLANK_PNG };
