'use strict';
// Brand packs and the page "marking" text (margin marks, header logo).
//
// Nothing in a printed S1000D book's furniture is hard-coded. Every value is
// resolved here, ONCE per build, in a fixed order, and a value that cannot be
// resolved is simply left out with a note — a missing logo or company line must
// never stop a publication being built.
//
//   1. Settings              layout.marks.* / layout.header.* in the house
//                            template or the project's overrides - when FILLED
//                            IN. The visible, editable place: it wins.
//   2. Publication comments  directives written into the publication module
//                            (<?agastya key="value"?>, <!-- agastya: key=value -->
//                            or a pmStatus/remarks line "agastya.key: value").
//                            They fill what Settings leave blank; when Settings
//                            override one, the build log says so.
//   3. Brand pack            templates/brand/<id>/brand.json (+ logo file)
//   4. Derived from the data issue number and in-work number, the build clock
//   5. Off                   with a note in the build log
//
// Pure functions (no I/O except the two loaders), so they are easy to test.

const fs = require('fs');
const path = require('path');

const stripBom = (s) => String(s).replace(/^﻿/, '');
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function brandDir(templatesDir, id) {
    return SAFE_ID.test(String(id || '')) ? path.join(templatesDir, 'brand', String(id)) : null;
}

/** Reads templates/brand/<id>/brand.json; null when there is no such pack. */
function loadBrandPack(templatesDir, id) {
    const dir = brandDir(templatesDir, id);
    if (!dir) return null;
    let meta;
    try { meta = JSON.parse(stripBom(fs.readFileSync(path.join(dir, 'brand.json'), 'utf8'))); }
    catch { return null; }
    const logoRel = typeof meta.logo === 'string' ? meta.logo.trim() : '';
    const logoAbs = logoRel && SAFE_ID.test(logoRel) && fs.existsSync(path.join(dir, logoRel))
        ? path.join(dir, logoRel) : null;
    return {
        id: meta.id || id,
        name: meta.name || id,
        company: typeof meta.company === 'string' ? meta.company.trim() : '',
        logoAbs,
        logoMissing: !!logoRel && !logoAbs,
    };
}

/** All packs on disk, for pickers. */
function listBrandPacks(templatesDir) {
    const root = path.join(templatesDir, 'brand');
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root)
        .filter((n) => fs.existsSync(path.join(root, n, 'brand.json')))
        .map((n) => loadBrandPack(templatesDir, n))
        .filter(Boolean)
        .map((b) => ({ id: b.id, name: b.name, company: b.company, hasLogo: !!b.logoAbs }));
}

const unxml = (s) => String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/**
 * Directives written into the publication module itself. Values are plain
 * text; the key is case-insensitive. Later directives win.
 */
function pmDirectives(pmText) {
    const out = {};
    const text = String(pmText || '');
    const put = (k, v) => { if (k) out[String(k).trim().toLowerCase()] = unxml(String(v).trim()); };
    for (const m of text.matchAll(/<\?agastya\s+([^?]*?)\?>/g)) {
        for (const a of m[1].matchAll(/([A-Za-z][\w.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g)) put(a[1], a[2] ?? a[3] ?? a[4] ?? '');
    }
    for (const m of text.matchAll(/<!--\s*agastya:\s*([\s\S]*?)-->/g)) {
        for (const line of m[1].split(/\r?\n|;/)) {
            const kv = /^\s*([A-Za-z][\w.-]*)\s*=\s*(.*?)\s*$/.exec(line);
            if (kv) put(kv[1], kv[2]);
        }
    }
    for (const m of text.matchAll(/<(?:remarks|simplePara|commentPara)[^>]*>\s*agastya\.([\w.-]+)\s*:\s*([^<]*)</g)) put(m[1], m[2]);
    return out;
}

/** Issue and in-work numbers from the publication module's own identity. */
function issueOf(pmText) {
    const m = /<pmIdent>[\s\S]*?<issueInfo\b[^>]*?issueNumber="(\d+)"[^>]*?inWork="(\d+)"/.exec(String(pmText || ''))
        || /<issueInfo\b[^>]*?issueNumber="(\d+)"[^>]*?inWork="(\d+)"/.exec(String(pmText || ''));
    if (!m) return { number: '', inWork: '', issue: '', draft: false };
    return { number: m[1], inWork: m[2], issue: `${m[1]}-${m[2]}`, draft: m[2] !== '00' };
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** YYYY MM DD HH mm ss tokens, local time (the machine that prints the book). */
function formatStamp(d, fmt) {
    const map = { YYYY: pad(d.getFullYear(), 4), MM: pad(d.getMonth() + 1), DD: pad(d.getDate()),
        HH: pad(d.getHours()), mm: pad(d.getMinutes()), ss: pad(d.getSeconds()) };
    return String(fmt || 'YYYY-MM-DD HH:mm').replace(/YYYY|MM|DD|HH|mm|ss/g, (t) => map[t]);
}

function fill(template, tokens) {
    return String(template == null ? '' : template).replace(/\{(\w+)\}/g, (all, k) => (k in tokens ? tokens[k] : all));
}

const isOff = (v) => /^(off|false|no|none|0)$/i.test(String(v == null ? '' : v).trim());

/**
 * Work out the marking for one build.
 *
 * @param {object} o
 * @param {object} o.layout    effective.layout (house merged with project)
 * @param {string} o.pmText    the publication module source
 * @param {object|null} o.brand  result of loadBrandPack, or null
 * @param {Date}   o.now       the build clock
 * @returns {{ params: Array<[string,string]>, logo: {from:string, rel:string}|null, notes: string[], values: object }}
 */
function resolveMarkings(o) {
    const L = o.layout || {};
    const marks = L.marks || {};
    const header = L.header || {};
    const dir = pmDirectives(o.pmText);
    const issue = issueOf(o.pmText);
    const brand = o.brand || null;
    const now = o.now || new Date();
    const notes = [];
    const tokens = {
        issue: issue.issue, issueNumber: issue.number, inWork: issue.inWork,
        company: '', printed: '', date: formatStamp(now, 'YYYY-MM-DD'),
    };

    // Precedence, in this order, for every value: Settings that are FILLED IN, then the publication's own directive, then the
    // brand pack, then a derived default, else left out with a note. A directive therefore only fills what Settings leave blank,
    // and when Settings override one the build log says so (an imported file must never silently change what a controlled
    // document prints, and Settings is the visible, editable place).
    const isSet = (v) => v !== undefined && v !== null && String(v).trim() !== '';
    const overridden = (what, directive, used) => {
        if (directive && String(directive).trim() !== String(used).trim()) {
            notes.push(`Settings set the ${what} ("${used}"), so the publication comment (${isOff(directive) ? 'off' : `"${directive}"`}) is not used`);
        }
    };

    // --- company line -------------------------------------------------------
    let company = '';
    const cs = marks.company || {};
    if (cs.enabled !== false) {
        if (isSet(cs.text)) {
            company = fill(cs.text, tokens).trim();
            overridden('company line', dir.company, company);
        } else if (isOff(dir.company)) company = '';
        else if (dir.company) company = dir.company;
        else if (brand && brand.company) company = brand.company;
        if (!company && !isOff(dir.company)) notes.push('No company line for the margin mark (settings, publication comment and brand pack are all empty) - the second margin mark is left out');
    }
    tokens.company = company;

    // --- draft line ---------------------------------------------------------
    let draft = '';
    const ds = marks.draft || {};
    if (ds.enabled !== false) {
        const when = String(ds.showWhen || 'inWork');
        // "inWork": while the issue is in work (in-work number not 00) - or the build is not a released one, which is a draft copy whatever the
        // issue number says (the NOT RELEASED watermark is on the same pages). A caller that does not state the release state keeps the old rule.
        const show = when === 'always' || (when === 'inWork' && (issue.draft || o.released === false));
        if (isSet(ds.text)) {                       // Settings own the wording; showWhen still decides when it appears
            if (show) draft = fill(ds.text, tokens).trim();
            overridden('draft line', dir.draft, fill(ds.text, tokens).trim());
        } else if (isOff(dir.draft)) draft = '';
        else if (dir.draft) draft = fill(dir.draft, tokens);
        else if (show) draft = fill('This is a draft copy of Issue {issue}', tokens).trim();
    }

    // --- printed stamp ------------------------------------------------------
    let printed = '';
    const ps = marks.printed || {};
    if (ps.enabled !== false) {
        tokens.printed = formatStamp(now, ps.format);
        if (isSet(ps.text)) {
            printed = fill(ps.text, tokens).trim();
            overridden('printed line', dir.printed, printed);
        } else if (isOff(dir.printed)) printed = '';
        else if (dir.printed) printed = fill(dir.printed, tokens);
        else printed = fill('Printed {printed}', tokens).trim();
    }

    // --- header logo --------------------------------------------------------
    let logo = null;
    if (header.logoPath && String(header.logoPath).trim()) {
        logo = { from: null, rel: String(header.logoPath).trim().replace(/\\/g, '/') };      // a project file named in Settings, used as is
        if (isOff(dir.logo)) notes.push('Settings name a header logo file, so the publication comment that switches the logo off is not used');
    } else if (isOff(dir.logo)) {
        logo = null;
    } else if (brand && brand.logoAbs) {
        logo = { from: brand.logoAbs, rel: `_brand/${path.basename(brand.logoAbs)}` };
    } else {
        notes.push(brand && brand.logoMissing
            ? 'The brand pack names a logo file that is not in the pack - the header is built without a logo'
            : 'No header logo (no brand pack logo and no logo path set) - the header is built without one');
    }

    const params = [];
    const add = (n, v) => { if (v !== undefined && v !== null) params.push([n, String(v)]); };
    add('xs.mark.draft', draft);
    add('xs.mark.printed', printed);
    add('xs.mark.company', company);
    if (logo) add('header.logo.uri', logo.rel);
    return { params, logo, notes, values: { draft, printed, company, issue: issue.issue } };
}

module.exports = { loadBrandPack, listBrandPacks, brandDir, pmDirectives, issueOf, formatStamp, fill, resolveMarkings };
