'use strict';
/*
  Check every XML file in a project the way the BUILD will read it.

  Nothing in this application parsed the author's XML until the build did, so a
  stray "&" or a tag left open was invisible until Generate failed — at the
  point where the least context is available and the most work has been done.
  Validation existed, but only looked for missing graphics.

  The parser here is the bundled libxml2, the same one xsltproc uses when the
  book is built. That is the point: a second, different parser would sooner or
  later pass a file the build rejects, or flag one it accepts, and a validator
  that disagrees with the build is worse than none — it teaches people to
  ignore it.

  Well-formedness only. Schema validation needs the S1000D XSD set, which this
  application does not ship; when it does, it belongs here beside this.
*/
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { explainBuildFailure } = require('./buildErrors');
const { catalogEnv } = require('./catalog');
const toolPaths = require('./paths');

const PARSE_ONLY_XSL = path.join(__dirname, '..', 'pipeline', 'wellformed.xsl');

// Files worth reading. The generated build artefacts are rewritten every run
// and reporting them would blame the tool for the author's input.
const SKIP = /^_|[\/]_|node_modules/;

function collect(dir, rel, out, depth) {
    if (depth > 4) return out;                       // a project is not deep
    let entries = [];
    try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (SKIP.test(r)) continue;
        if (e.isDirectory()) collect(dir, r, out, depth + 1);
        else if (/\.xml$/i.test(e.name)) out.push(r);
    }
    return out;
}

function parseOne(xsltproc, dir, rel) {
    return new Promise((resolve) => {
        execFile(xsltproc, ['--noout', '--nonet', PARSE_ONLY_XSL, rel],
            // The same catalogue the build uses, so validation cannot report a
            // problem the build does not have, or miss one it does.
            { cwd: dir, maxBuffer: 1 << 20, env: toolPaths.childEnv(catalogEnv()) }, (err, stdout, stderr) => {
                /*
                  xsltproc reports a parse failure on stderr and still exits 0
                  in this mode, so the exit code cannot be the test — the
                  presence of a diagnostic is.
                */
                const text = String(stderr || '');
                if (!text.trim()) return resolve(null);
                const why = explainBuildFailure({ stderr: text }, { workDir: dir });
                // The bundled libxml2 opens files through the Windows API without long-path support: a file whose FULL path is 260 characters or more
                // "cannot be loaded", which reads as a malformed file. Say what it is (the workspace + project folder + file name add up too long).
                const full = path.join(dir, rel);
                if (process.platform === 'win32' && full.length >= 260) {
                    return resolve({ rel, line: 1, title: 'File path too long', summary: `The file's full path is ${full.length} characters`,
                        hint: 'Windows stops the bundled tools at 259 characters, so this file cannot be opened. Shorten the project name or move the workspace closer to the drive root (AGASTYA_WORKSPACE_DIR). The file itself is not necessarily malformed.', raw: text });
                }
                resolve({ rel, line: why.line || 1, summary: why.summary, hint: why.hint, raw: why.raw });
            });
    });
}

// Bounded concurrency: a project holds dozens of modules and each check is a
// process. Unbounded, a large CSDB would start sixty of them at once.
async function pool(items, limit, fn) {
    const out = [];
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (i < items.length) {
            const mine = i++;
            const r = await fn(items[mine]);
            if (r) out.push(r);
        }
    }));
    return out;
}

/*
  Returns issues in the shape the validation panel already renders, so a
  malformed file reads like any other finding and clicking it opens the file at
  the line.
*/
async function validateProjectXml(xsltproc, dir, { limit = 6 } = {}) {
    const files = collect(dir, '', [], 0);
    const bad = await pool(files, limit, (rel) => parseOne(xsltproc, dir, rel));
    bad.sort((a, b) => a.rel.localeCompare(b.rel));
    return {
        checked: files.length,
        // The caller schema-checks what parsed; it should not walk the tree again.
        files,
        issues: bad.map((b) => ({
            sev: 'crit',
            title: b.title || 'XML cannot be parsed',
            rel: b.rel,
            line: b.line,
            loc: `${b.rel.split('/').pop()}:${b.line}`,
            // The hint earns its place here: this panel is where someone looks
            // BEFORE building, so telling them what causes it is the whole job.
            detail: b.hint ? `${b.summary} — ${b.hint}` : b.summary,
        })),
    };
}

module.exports = { validateProjectXml };
