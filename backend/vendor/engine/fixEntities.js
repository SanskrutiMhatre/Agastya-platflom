'use strict';
/*
  Declare the ICN entities a data module references but never declares.

  WHY THIS EXISTS

  S1000D addresses artwork indirectly: <graphic infoEntityIdent="ICN-..."/>
  names an ENTITY, and the entity says where the file actually is:

    <!ENTITY ICN-FOO SYSTEM "ICN-FOO.png" NDATA png>

  Modules exported from an authoring tool routinely arrive with the graphic
  reference but no declaration — measured on a real workspace, 48 such
  references across 13 modules, every one of them with the .png sitting in
  csdb/ right beside the data module.

  Those figures still PRINT here, because both pipelines learned to fall back
  to a side-car index of the files actually on disk (figures.xsl's $image.dims,
  images.js's buildFileIndex). So this is not a rendering fix. It matters for
  two other reasons:

    - The fallback is this application's private convention. A module handed to
      any other S1000D tool, or delivered as part of a CSDB, carries a graphic
      reference that resolves to nothing. Declaring the entity makes the module
      say where its own artwork is.
    - The Validation report counts an undeclared ICN as a missing graphic. Those
      48 false alarms outnumbered the 25 genuinely missing files two to one,
      which is how a real missing graphic stayed invisible.

  WHAT IT DOES

  For every ICN a module references and does not declare, and whose file can
  actually be found, it appends a declaration to the module's DOCTYPE internal
  subset — and a <!NOTATION> for the file's format if the module hasn't got one.

  NDATA is not optional. unparsed-entity-uri(), which is how both stylesheets
  read these, returns a value only for an UNPARSED entity. Declared without
  NDATA the entity is a parsed one: silently invisible to the stylesheet, and a
  parse error the moment anything references it as text.

  Notation NAMES are taken from the module itself wherever possible. The same
  workspace declares png, PNG, jpg, jpeg, gif and even "anything" for the same
  handful of formats; picking a house style would mean rewriting 1426 DOCTYPEs
  to settle a question none of them actually asks. So: reuse whatever this
  module already uses for that extension, and only invent a name when it has
  none.

  WHAT IT DELIBERATELY DOES NOT DO

  An ICN whose file is nowhere on disk is left undeclared and reported. Writing
  a declaration that points at a file that does not exist would turn a warning
  the Validation page shows today into a reference that merely fails later, in
  the build log — trading a visible problem for a quiet one.
*/

const fs = require('fs');
const path = require('path');
const { rewriteTags } = require('./fixIds');
const { buildFileIndex } = require('./images');

// Only these two elements carry infoEntityIdent in S1000D, and only these two
// appear in the corpus (graphic 1949, symbol 553).
const ENTITY_REF_ELEMENTS = new Set(['graphic', 'symbol']);

/*
  A default notation declaration per format, used ONLY when the module declares
  nothing usable for that extension. The public identifiers are the ones the
  existing hand-authored modules in this workspace already use, so a generated
  declaration is indistinguishable from an authored one.
*/
const DEFAULT_NOTATIONS = {
    png: '<!NOTATION png PUBLIC "-//W3C//NOTATION Portable Network Graphics//EN" >',
    jpg: '<!NOTATION jpg PUBLIC "+//ISBN 0-7923-9432-1::Graphic Notation//NOTATION Joint Photographic Experts Group//EN" >',
    gif: '<!NOTATION gif PUBLIC "gif graphic" >',
    svg: '<!NOTATION svg PUBLIC "-//W3C//NOTATION Scalable Vector Graphics//EN" >',
    tif: '<!NOTATION tif PUBLIC "+//ISBN 0-7923-9432-1::Graphic Notation//NOTATION Tag Image File Format//EN" >',
    cgm: '<!NOTATION cgm PUBLIC "ISO 8632/2//NOTATION Computer Graphics Metafile//EN" >',
};

// The notation name a given file extension should use, before consulting what
// the module already declares. ".jpeg" and ".jpg" are one format with two
// spellings, so they normalise together.
function formatOf(fileName) {
    const ext = path.extname(fileName).replace(/^\./, '').toLowerCase();
    if (ext === 'jpeg') return 'jpg';
    if (ext === 'tiff') return 'tif';
    return ext;
}

/*
  Locate the DOCTYPE and its internal subset.

  Scanned rather than matched with a regex because the subset legitimately
  contains '>' inside system literals and comments, so "up to the first >" is
  wrong — which is exactly the kind of near-miss that silently truncates a
  DOCTYPE and takes every entity in it with it.

  Returns null when there is no DOCTYPE at all (523 modules in this workspace,
  none of which reference a graphic).
*/
function findDoctype(xml) {
    const start = xml.indexOf('<!DOCTYPE');
    if (start < 0) return null;
    let i = start + 9, quote = null, subsetStart = -1, subsetEnd = -1, depth = 0;
    for (; i < xml.length; i++) {
        const c = xml[i];
        if (quote) { if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'") { quote = c; continue; }
        if (c === '[') { if (depth === 0) subsetStart = i; depth++; continue; }
        if (c === ']') { depth--; if (depth === 0) subsetEnd = i; continue; }
        if (c === '>' && depth <= 0) { i++; break; }
    }
    return { start, end: i, subsetStart, subsetEnd, hasSubset: subsetStart >= 0 && subsetEnd > subsetStart };
}

// The root element name the DOCTYPE declares, so a synthesised one names the
// same root rather than assuming "dmodule".
function rootElementOf(xml) {
    const m = /<\s*([\w.:-]+)/.exec(
        xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[\s\S]*?\]?\s*>/, ''),
    );
    return m ? m[1] : 'dmodule';
}

/*
  Read one data module: what it declares, and what it references.

  References are collected by walking TAGS rather than by scanning the whole
  text, so an ICN quoted in a procedure's prose or left inside a commented-out
  block is not mistaken for a live reference.
*/
function scanModule(absPath) {
    const xml = fs.readFileSync(absPath, 'utf8');
    const doctype = findDoctype(xml);
    const subset = doctype && doctype.hasSubset
        ? xml.slice(doctype.subsetStart + 1, doctype.subsetEnd)
        : '';

    // name -> { file, notation }
    const entities = new Map();
    for (const m of subset.matchAll(/<!ENTITY\s+([\w.-]+)\s+SYSTEM\s+"([^"]*)"(?:\s+NDATA\s+([\w.-]+))?/g)) {
        entities.set(m[1], { file: m[2], notation: m[3] || null });
    }
    const notations = new Set(
        [...subset.matchAll(/<!NOTATION\s+([\w.-]+)/g)].map((m) => m[1]),
    );

    // Referenced ICNs, in document order, de-duplicated: one module routinely
    // points several graphics at the same ICN, and that needs ONE declaration.
    const referenced = [];
    const seen = new Set();
    rewriteTags(xml, (tag) => {
        if (/^<\s*\//.test(tag)) return tag;
        const name = (/^<\s*([\w.:-]+)/.exec(tag) || [])[1];
        if (!ENTITY_REF_ELEMENTS.has(name)) return tag;
        // A graphic with an explicit @src addresses its file directly and needs
        // no entity — that is how the generated front-matter pages work.
        if (/\bsrc\s*=\s*"[^"]*[^\s"][^"]*"/.test(tag)) return tag;
        const icn = ((/\binfoEntityIdent\s*=\s*"([^"]*)"/.exec(tag) || [])[1] || '').trim();
        if (!icn || seen.has(icn)) return tag;
        seen.add(icn);
        referenced.push(icn);
        return tag;
    });

    return { xml, doctype, entities, notations, referenced };
}

/*
  The notation name to use for a file of this format in this module.

  Preference order, most specific first:
    1. what an existing ENTITY in this module already uses for the same format
       — the module's own established answer;
    2. a declared NOTATION whose name matches the format;
    3. the default, which also has to be DECLARED (returned in `add`).
*/
function notationFor(format, mod, indexByFormat) {
    const fromEntity = indexByFormat.get(format);
    if (fromEntity) return { name: fromEntity, add: null };

    for (const n of mod.notations) {
        const norm = formatOf('x.' + n.toLowerCase());
        if (norm === format || n.toLowerCase() === format) return { name: n, add: null };
    }
    const decl = DEFAULT_NOTATIONS[format];
    if (!decl) return null; // a format with no known notation — not ours to invent
    return { name: format, add: decl };
}

// Which notation each already-declared entity uses, keyed by the format of the
// file it points at, so a new PNG in a module that already declares one is
// declared exactly the same way.
function notationsByFormat(mod) {
    const byFormat = new Map();
    for (const { file, notation } of mod.entities.values()) {
        if (!notation || !file) continue;
        const f = formatOf(file);
        if (f && !byFormat.has(f)) byFormat.set(f, notation);
    }
    return byFormat;
}

/*
  Plan the change across the whole CSDB without writing anything.
*/
function planFixEntities(projectAbsDir, csdbDir, mediaDir) {
    const csdbAbs = path.join(projectAbsDir, csdbDir);
    const files = fs.existsSync(csdbAbs)
        ? fs.readdirSync(csdbAbs).filter((f) => /^DMC-.*\.xml$/i.test(f)).sort()
        : [];

    // Exactly the index the build resolves images through, so a declaration is
    // only ever written for a file the build would itself have found.
    const index = buildFileIndex(projectAbsDir, [csdbDir, mediaDir]);

    const modules = [];
    const plan = [];
    const skipped = [];
    const unresolved = [];
    let entityTotal = 0, notationTotal = 0;

    for (const file of files) {
        let mod;
        try { mod = scanModule(path.join(csdbAbs, file)); }
        catch (e) { skipped.push({ file, reason: e.message }); continue; }

        const missing = mod.referenced.filter((icn) => !mod.entities.has(icn));
        if (!missing.length) continue;

        const byFormat = notationsByFormat(mod);
        const additions = [];
        const newNotations = [];

        for (const icn of missing) {
            const rel = index.get(icn.toLowerCase())
                || index.get((icn + '.png').toLowerCase());
            if (!rel) { unresolved.push({ file, icn }); continue; }

            const format = formatOf(rel);
            const notation = notationFor(format, mod, byFormat);
            if (!notation) { unresolved.push({ file, icn, reason: 'unknown image format .' + format }); continue; }
            if (notation.add && !newNotations.some((n) => n.name === notation.name)) {
                newNotations.push({ name: notation.name, decl: notation.add });
            }
            /*
              The SYSTEM path is resolved against the data module's own
              location, i.e. csdb/ — so a file sitting beside it is named
              bare (matching every hand-authored declaration in this
              workspace) and one in Media/ has to climb out first.
            */
            const inCsdb = rel.replace(/\\/g, '/').startsWith(csdbDir.replace(/\/*$/, '') + '/');
            const system = inCsdb ? path.basename(rel) : '../' + rel.replace(/\\/g, '/');
            additions.push({ icn, system, notation: notation.name });
            // Recorded so a second ICN of the same format in this same module
            // reuses the notation just chosen rather than declaring it twice.
            if (!byFormat.has(format)) byFormat.set(format, notation.name);
        }

        if (!additions.length) continue;
        entityTotal += additions.length;
        notationTotal += newNotations.length;
        plan.push({ file, entities: additions.length, notations: newNotations.length, icns: additions.map((a) => a.icn) });
        modules.push({ file, abs: path.join(csdbAbs, file), mod, additions, newNotations });
    }

    return {
        files: files.length,
        skipped,
        plan,
        unresolved,
        totals: { entities: entityTotal, notations: notationTotal, filesChanged: plan.length },
        _modules: modules,
    };
}

/*
  Produce the rewritten text for one module. Pure — returns a string and leaves
  the decision to write it to the caller.

  Only the DOCTYPE is touched. The document body is returned byte for byte as
  it was read, which is what makes this safe to run over a whole CSDB: whatever
  else is wrong with a module, this cannot have caused it.
*/
function rewriteModuleEntities(entry, rootHint) {
    const { mod, additions, newNotations } = entry;
    if (!additions.length) return mod.xml;

    const entityDecls = additions
        .map((a) => `<!ENTITY ${a.icn} SYSTEM "${a.system}" NDATA ${a.notation}>`)
        .join('\n');
    const notationDecls = newNotations.map((n) => n.decl).join('\n');

    const dt = mod.doctype;

    /*
      No DOCTYPE at all: one has to be created. Does not arise in this
      workspace (the 523 modules without a DOCTYPE reference no graphics) but a
      module that referenced one and had nowhere to declare it would otherwise
      be silently skipped.

      Placed after the XML declaration, which must stay first in the document.
    */
    if (!dt) {
        const root = rootHint || rootElementOf(mod.xml);
        const decl = `<!DOCTYPE ${root} [${notationDecls ? '\n' + notationDecls : ''}\n${entityDecls}\n]>`;
        const xmlDecl = /^\s*<\?xml[^>]*\?>\s*/.exec(mod.xml);
        return xmlDecl
            ? mod.xml.slice(0, xmlDecl[0].length) + decl + '\n' + mod.xml.slice(xmlDecl[0].length)
            : decl + '\n' + mod.xml;
    }

    /*
      A DOCTYPE with no internal subset — <!DOCTYPE dmodule SYSTEM "x.dtd"> —
      gains one, inserted before the closing '>'.
    */
    if (!dt.hasSubset) {
        const at = dt.end - 1; // the '>' itself
        const block = ` [${notationDecls ? '\n' + notationDecls : ''}\n${entityDecls}\n]`;
        return mod.xml.slice(0, at) + block + mod.xml.slice(at);
    }

    /*
      The ordinary case. Notations go at the HEAD of the subset and entities at
      its TAIL, which is where the hand-authored modules put them, and which
      keeps a notation declared ahead of the NDATA that names it — required by
      a validating parser, and the convention every existing module follows.
    */
    let out = mod.xml;
    // Tail first: inserting at the head would shift subsetEnd.
    out = out.slice(0, dt.subsetEnd) + entityDecls + '\n' + out.slice(dt.subsetEnd);
    if (notationDecls) {
        out = out.slice(0, dt.subsetStart + 1) + notationDecls + '\n' + out.slice(dt.subsetStart + 1);
    }
    return out;
}

module.exports = {
    planFixEntities, rewriteModuleEntities, scanModule,
    findDoctype, formatOf, DEFAULT_NOTATIONS,
};
