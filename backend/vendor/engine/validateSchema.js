'use strict';
/*
  Validate project XML against the S1000D schema issue each file DECLARES.

  Well-formedness (validateXml.js) answers "can this be parsed". This answers
  the question authors actually get wrong: whether the element they added is
  allowed where they put it, and whether the attributes a data module must
  carry are present. Neither the build nor any earlier check looked at that —
  xsltproc transforms whatever parses, so an invalid module produced a book
  with a quietly missing section rather than an error.

  Per declared issue, never a single fixed schema set. A project's modules can
  legitimately be written to different issues, and the schemas differ in ways
  that matter: schemas/PROVENANCE.md records descript.xsd carrying Issue 5.0
  while proced.xsd carried 4.2 in the folder this replaced, so every
  description module in that setup was checked against rules it was never
  written to. Reading the declaration is what makes the answer trustworthy.

  libxml2 again — the same engine as the build and as the well-formedness
  check, here as WebAssembly (xmllint-wasm, MIT). No native module to compile
  for the customer's machine, and no network: the schemas are read from disk
  and handed to the validator, so the http:// URL in a file's
  noNamespaceSchemaLocation is never fetched.
*/
const fs = require('fs');
const path = require('path');
const { validateXML } = require('xmllint-wasm');

const SCHEMA_ROOT = require('./paths').SCHEMAS;

/*
  "http://www.s1000d.org/S1000D_4-2/xml_schema_flat/descript.xsd"
    -> { issue: '4.2', file: 'descript.xsd' }

  The issue travels in the URL as 4-2; the directories are named 4.2, matching
  how the specification is written and how anyone would search for it.
*/
function declaredSchema(xml) {
    const m = /noNamespaceSchemaLocation\s*=\s*"([^"]+)"/.exec(xml);
    if (!m) return null;
    const loc = m[1];
    const file = loc.split(/[\/]/).pop();
    if (!/\.xsd$/i.test(file)) return null;
    // Issues 6 and 7 are written without a minor number (S1000D_6, S1000D_7); the schema folders are 6.0 and 7.0.
    const iss = /S1000D[_-]?(\d+)(?:[-._](\d+))?/i.exec(loc);
    return { issue: iss ? `${iss[1]}.${iss[2] ?? '0'}` : null, file, loc };
}

// Read once per issue: the schemas import one another, so the validator needs
// the whole set present, not just the one file the document names.
const preloadCache = new Map();
function preloadFor(issue) {
    if (preloadCache.has(issue)) return preloadCache.get(issue);
    const dir = path.join(SCHEMA_ROOT, issue);
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.xsd')); } catch { /* no such issue */ }
    const set = files.length
        ? files.map((f) => ({ fileName: f, contents: fs.readFileSync(path.join(dir, f), 'utf8') }))
        : null;
    preloadCache.set(issue, set);
    return set;
}

const installedIssues = () => {
    try { return fs.readdirSync(SCHEMA_ROOT).filter((d) => /^\d/.test(d)).sort(); }
    catch { return []; }
};

/*
  Files are validated in GROUPS — one call per (issue, schema) rather than one
  per document. The validator carries the whole schema set into WebAssembly on
  every call, and that setup, not the checking, is the cost: 21 real modules
  take 314ms together and 4.6s apart.
*/
async function validateProjectSchema(dir, relFiles, opts) {
    const o = opts || {};
    const groups = new Map();
    const notes = [];
    let checked = 0;

    for (const rel of relFiles) {
        let xml;
        try { xml = fs.readFileSync(path.join(dir, rel), 'utf8'); } catch { continue; }
        const decl = declaredSchema(xml);
        // No declaration: not an S1000D document (the generated front-matter
        // pages are ours, and answer to no schema). Silence is right here.
        if (!decl || !decl.issue) continue;

        /*
          A document with unresolved XIncludes cannot be schema-checked as
          authored, and this is not a shortcoming to work around: XInclude is
          resolved BEFORE validation by definition, so the schema sees an
          <xi:include> element where it expects the content, and rejects it.

          This project's publication modules legitimately carry them — the
          build resolves dmRef and xi:include into the real modules — so
          checking the file as it sits on disk produced twenty complaints about
          the one thing that is working correctly. A validator that is loudly
          wrong about normal input is worse than one that says nothing, so it
          says what it did not check, once, instead.
        */
        if (xml.indexOf('XInclude') !== -1 || xml.indexOf(':include ') !== -1) {
            notes.push({
                sev: 'info', title: 'Not checked against a schema', rel, line: 1,
                loc: rel.split('/').pop(),
                detail: 'This file uses XInclude to pull in other documents. A schema cannot see through'
                    + ' an unresolved include, so only its well-formedness was checked.',
            });
            continue;
        }

        /*
          Which issue to judge this file by.

          The file's own declaration is the default and the right answer almost
          always: a project can legitimately hold modules written to different
          issues, and checking them all against one set is the mistake
          PROVENANCE.md records. An explicit choice exists for the case the
          declaration cannot cover — content that says 4.2 but is being moved
          to 5.0, or a supplier's modules that declare an issue this
          installation does not have.

          The SCHEMA name still comes from the file: descript.xsd or proced.xsd
          is what kind of module it is, which no override should change.
        */
        const issue = o.issue && o.issue !== 'auto' ? o.issue : decl.issue;
        const preload = preloadFor(issue);
        if (!preload) {
            /*
              A declared issue we do not ship. Reported, not skipped: silence
              would read as "checked and fine", which is the one thing it is
              not.
            */
            notes.push({
                sev: 'info', title: 'Not checked against a schema', rel, line: 1,
                loc: rel.split('/').pop(),
                detail: (o.issue && o.issue !== 'auto'
                    ? `Validation was set to S1000D Issue ${issue}, and no schema set for it is installed`
                    : `This file declares S1000D Issue ${decl.issue}, and no schema set for that issue is installed`)
                    + ` (available: ${installedIssues().join(', ') || 'none'}).`,
            });
            continue;
        }
        if (!preload.some((p) => p.fileName === decl.file)) {
            notes.push({
                sev: 'info', title: 'Not checked against a schema', rel, line: 1,
                loc: rel.split('/').pop(),
                detail: `This file names "${decl.file}", which is not part of the Issue ${issue} schema set.`,
            });
            continue;
        }
        const key = `${issue}|${decl.file}`;
        if (!groups.has(key)) groups.set(key, { issue, file: decl.file, docs: [] });
        groups.get(key).docs.push({ rel, xml });
        checked++;
    }

    const issues = [];
    for (const g of groups.values()) {
        const preload = preloadFor(g.issue);
        const schema = [{ fileName: g.file, contents: preload.find((p) => p.fileName === g.file).contents }];
        const schemaBytes = preload.reduce((n, p) => n + Buffer.byteLength(p.contents, 'utf8'), 0);
        /*
          AGASTYA (audit WP-32, PERF-002): batches by BYTES, not one call per group. The validator's WebAssembly memory is fixed per call and
          also holds the schema set (6-8 MB); one call with every module of a 1000-module project (8.9 MB of text) died with "memory access
          out of bounds", the failure was reported once against the first module, and every module still counted as checked. Now: batches of
          at most BATCH_BYTES of module text, each with memory sized to its content; a batch that still fails is retried module by module, so
          exactly the module that cannot be checked is named; a module the validator cannot hold at all is reported as too large, with the
          limit. Only a module that was actually judged counts in `checked`.
        */
        for (const batch of byteBatches(g.docs)) {
            const failed = await validateBatch(batch, g, schema, preload, schemaBytes, issues);
            if (!failed) continue;
            if (batch.length === 1) { unjudged(batch[0], failed); continue; }
            for (const d of batch) {
                const one = await validateBatch([d], g, schema, preload, schemaBytes, issues);
                if (one) unjudged(d, one);
            }
        }
    }

    function unjudged(d, err) {
        checked--;
        const size = Buffer.byteLength(d.xml, 'utf8');
        const mb = (size / 1048576).toFixed(1);
        const tooLarge = size > MAX_MODULE_BYTES;
        const memory = /out of memory|memory access out of bounds|Cannot enlarge memory|Aborted/i.test(err);
        notes.push({
            sev: 'info', title: 'Schema check could not run', rel: d.rel, line: 1, loc: d.rel.split('/').pop(),
            detail: tooLarge
                ? `This module (${mb} MB) is too large for the schema validator (limit ${MAX_MODULE_BYTES / 1048576} MB of text per module); it was not checked against the schema.`
                : memory
                    ? `The schema validator ran out of memory on this module (${mb} MB); it was not checked against the schema.`
                    : `Validating against the schema failed for this module: ${err}`,
            tooLarge, memory,
        });
    }

    issues.sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line);
    notes.sort((a, b) => a.rel.localeCompare(b.rel));
    return { issues: [...issues, ...(o.includeNotes === false ? [] : notes)], checked };
}

// WP-32 (PERF-002): the measured ceiling of one call was about 7.2 MB of module text with the default 32 MiB; batches stay well under it and
// get memory sized to what they carry, so no project size reaches the ceiling. With sized memory a single module of 25, 60 and 120 MB was
// judged (measured 2026-11-27); MAX_MODULE_BYTES is what the 4 GiB WebAssembly maximum holds under memoryPagesFor, not a guess.
const BATCH_BYTES = 3.5 * 1048576;
const MAX_MODULE_BYTES = 256 * 1048576;
const PAGE = 65536;

/** Consecutive groups of documents of at most BATCH_BYTES of text each (a larger single document is a batch of its own). */
function byteBatches(docs) {
    const out = []; let cur = []; let bytes = 0;
    for (const d of docs) {
        const n = Buffer.byteLength(d.xml, 'utf8');
        if (cur.length && bytes + n > BATCH_BYTES) { out.push(cur); cur = []; bytes = 0; }
        cur.push(d); bytes += n;
    }
    if (cur.length) out.push(cur);
    return out;
}

/** Memory for one call: the schema set and the documents as text, their parsed trees (several times the text), and headroom. */
function memoryPagesFor(docBytes, schemaBytes) {
    const need = 48 * 1048576 + 6 * schemaBytes + 12 * docBytes;
    const max = Math.min(65536, Math.max(512, Math.ceil(need / PAGE)));        // at most 4 GiB, never below the library default
    return { initialMemoryPages: 256, maxMemoryPages: max };
}

/**
 * Validate one batch; push its schema errors onto `issues`. Returns null when the batch was judged, or the error message when the
 * validator could not run on it (then nothing of the batch was pushed).
 */
async function validateBatch(batch, g, schema, preload, schemaBytes, issues) {
    /*
      fileName is the project-relative path, so every diagnostic comes back
      naming the file it belongs to — the whole point of validating a batch
      in one call rather than losing track of which document failed.
    */
    const byName = new Map();
    let bytes = 0;
    const docs = batch.map((d, i) => {
        const flat = `${i}_${d.rel.split('/').pop()}`;
        byName.set(flat, d.rel); bytes += Buffer.byteLength(d.xml, 'utf8');
        return { fileName: flat, contents: d.xml };
    });
    if (batch.length === 1 && bytes > MAX_MODULE_BYTES) return 'too large';
    let res;
    try {
        res = await validateXML({ xml: docs, schema, preload, ...memoryPagesFor(bytes, schemaBytes) });
    } catch (e) {
        return (e && e.message) || String(e);
    }
    /*
      WP-32: xmllint ends each invalid document with "<name> fails to validate", a line with no location. It used to be pinned on the
      batch's FIRST module, which accused a clean module. The name is in the message; the line is dropped when that module already has
      its specific errors, and kept (on the right module) when it is all there is.
    */
    const errs = res.errors || [];
    const specific = new Set(errs.filter((e) => e.loc && byName.has(e.loc.fileName)).map((e) => e.loc.fileName));
    for (const err of errs) {
        let flat = err.loc && err.loc.fileName;
        if (!byName.has(flat)) {
            const m = /^(\S+) fails to validate/.exec(String(err.message || ''));
            flat = m && byName.has(m[1]) ? m[1] : null;
            if (flat && specific.has(flat)) continue;
        }
        const rel = (flat && byName.get(flat)) || batch[0].rel;
        issues.push({
            sev: 'crit',
            title: 'Does not match the S1000D schema',
            rel,
            line: (err.loc && err.loc.lineNumber) || 1,
            loc: `${rel.split('/').pop()}:${(err.loc && err.loc.lineNumber) || 1}`,
            // libxml prefixes every one with "Schemas validity error : ",
            // which is the same on all of them and so carries nothing.
            detail: String(err.message || '').replace(/^Schemas validity error\s*:\s*/, '')
                + ` (Issue ${g.issue}, ${g.file})`,
        });
    }
    return null;
}


/*
  One document, from memory, for the editor.

  The project-wide check reads files off disk; this one is handed the buffer as
  it currently stands, because the whole point is to answer before it is saved.
  The same schemas and the same engine, so a squiggle in the editor and a
  finding in the validation report can never contradict each other.

  Parse errors come back from the same call: xmllint reports a document it
  cannot read before it gets as far as the schema. Where a document declares no
  schema, or one we do not have, it is still parsed — that is the difference
  between "<par> is not allowed here" and "this file no longer parses", and
  both are worth knowing while typing.
*/
async function validateDocument(rel, xml, opts) {
    const o = opts || {};
    const decl = declaredSchema(xml);
    const issue = o.issue && o.issue !== 'auto' ? o.issue : (decl && decl.issue);
    const preload = issue ? preloadFor(issue) : null;
    const known = preload && decl && preload.some((p) => p.fileName === decl.file);

    // An unresolved include cannot be schema-checked; parse it and stop there.
    const hasInclude = xml.indexOf('XInclude') !== -1 || xml.indexOf(':include ') !== -1;

    const args = { xml: [{ fileName: 'doc.xml', contents: xml }] };
    if (known && !hasInclude) {
        args.schema = [{ fileName: decl.file, contents: preload.find((p) => p.fileName === decl.file).contents }];
        args.preload = preload;
    } else {
        // No schema to check against: --format still parses, so this reports
        // exactly the errors that stop the build.
        args.normalization = 'format';
    }

    let res;
    try { res = await validateXML(args); }
    catch (e) { return { diagnostics: [], note: (e && e.message) || String(e) }; }

    return {
        schema: known && !hasInclude ? `${decl.file} (Issue ${issue})` : null,
        diagnostics: (res.errors || []).map((err) => ({
            line: (err.loc && err.loc.lineNumber) || 1,
            message: String(err.message || '').replace(/^Schemas validity error\s*:\s*/, ''),
        })),
    };
}

module.exports = { validateProjectSchema, validateDocument, declaredSchema, installedIssues };
