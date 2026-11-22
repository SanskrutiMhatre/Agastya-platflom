'use strict';
// Multi-project workspace management.
//
// Layout:
//   <workspace>/
//     workspace.json          { active: "<project-id>", emptyFolders: [...] }
//     templates/
//       default.house.json    reusable house styles
//     projects/
//       <id>/
//         project.json        publication data + front-matter + templateRef
//         publication.xml     the PM (input.pm)
//         csdb/               data modules + ICNs
//         Media/              logos, symbols
//         jss/frontmatter/    5 static + 7 generated front-matter pages
//         jss-output.pdf      last build
//
// A project is self-contained, so it can be zipped and moved. Stylesheets and
// tools stay in the app; only their relative path is handed to the build.

const fs = require('fs');
const path = require('path');

function projectsDir(ws) { return path.join(ws, 'projects'); }
function templatesDir(ws) { return path.join(ws, 'templates'); }
function statePath(ws) { return path.join(ws, 'workspace.json'); }
function projectDir(ws, id) { return path.join(projectsDir(ws), id); }

function ensureWorkspace(ws) {
    fs.mkdirSync(projectsDir(ws), { recursive: true });
    fs.mkdirSync(templatesDir(ws), { recursive: true });
    if (!fs.existsSync(statePath(ws))) fs.writeFileSync(statePath(ws), JSON.stringify({ active: null }, null, 2));
}

function readState(ws) {
    try { return JSON.parse(fs.readFileSync(statePath(ws), 'utf8')); }
    catch (e) { return { active: null }; }
}
function writeState(ws, st) { fs.writeFileSync(statePath(ws), JSON.stringify(st, null, 2) + '\n', 'utf8'); }

/*
  Dashboard folders that have no projects in them yet.

  Every other folder is DERIVED: it is the `group` string its projects carry,
  so it exists exactly as long as something is filed under it and needs no
  storage of its own. A folder with nothing in it has nothing to derive it
  from, so the name is remembered here — in the one workspace-wide file that
  already exists — until a project joins it.

  This is not a second folder system: these are names, not records. Nothing
  reads them to decide where a project lives, a project still carries its own
  `group`, and the moment one is filed under a name here the ordinary derived
  folder takes over and this entry stops being reported.
*/
const FOLDER_MAX = 60;

function normaliseFolder(name) {
    return String(name == null ? '' : name).trim();
}

function listEmptyFolders(ws) {
    const st = readState(ws);
    const raw = Array.isArray(st.emptyFolders) ? st.emptyFolders : [];
    const seen = new Set();
    const out = [];
    for (const n of raw) {
        const name = normaliseFolder(n);
        if (!name || name.length > FOLDER_MAX) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(name);
    }
    return out;
}

// Case-insensitive on the way in, so "CIWS" and "ciws" cannot become two
// folders that look like one. The casing first entered is the one kept.
function addEmptyFolder(ws, name) {
    const folder = normaliseFolder(name);
    if (!folder) throw new Error('A folder name is required');
    if (folder.length > FOLDER_MAX) throw new Error('That folder name is too long');
    ensureWorkspace(ws);
    const st = readState(ws);
    const current = listEmptyFolders(ws);
    if (!current.some((n) => n.toLowerCase() === folder.toLowerCase())) {
        st.emptyFolders = [...current, folder];
        writeState(ws, st);
    }
    return folder;
}

function removeEmptyFolder(ws, name) {
    const folder = normaliseFolder(name);
    if (!folder) return;
    ensureWorkspace(ws);
    const st = readState(ws);
    st.emptyFolders = listEmptyFolders(ws).filter((n) => n.toLowerCase() !== folder.toLowerCase());
    writeState(ws, st);
}

// A project id is a filesystem-safe slug.
function slug(name) {
    return String(name).trim().toLowerCase().replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}
function uniqueId(ws, base) {
    let id = base, n = 2;
    while (fs.existsSync(projectDir(ws, id))) id = `${base}-${n++}`;
    return id;
}

function listProjects(ws) {
    ensureWorkspace(ws);
    const dir = projectsDir(ws);
    const ids = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f =>
        fs.existsSync(path.join(dir, f, 'project.json'))) : [];
    return ids.map(id => {
        let name = id, hasPm = false, type = 'S1000D', templateRef = 'default', pipeline = 's1000dtojss', group = '';
        try {
            const p = JSON.parse(fs.readFileSync(path.join(dir, id, 'project.json'), 'utf8'));
            name = p.name || id;
            type = p.type || type;
            templateRef = p.templateRef || templateRef;
            pipeline = p.pipeline || pipeline;
            // Purely organizational — which folder the dashboard files this
            // project under. Lives here rather than in the SQLite registry,
            // same reasoning as pipeline just above: it is a book's own
            // setting, not something the app needs to query across projects.
            group = String(p.group || '').trim();
            hasPm = !!(p.input && p.input.pm && fs.existsSync(path.join(dir, id, p.input.pm)));
        } catch (e) {}
        return { id, name, hasPm, type, templateRef, pipeline, group };
    });
}

/*
  Whether another project already carries this display name.

  Two projects were able to both be named "CIWS": the id is a filesystem slug
  and uniqueId() only ever protected THAT ("ciws", "ciws-2", ...), never the
  human-readable `name` a project actually shows on its card. A user typing
  the same name back had no way to know, and no reason to expect, that the
  system would happily file it under a different id and call it done.

  Case-insensitive and trimmed, because "CIWS" and "ciws" read as the same
  project to a person choosing a name, whatever a filesystem thinks. excludeId
  lets a rename check every OTHER project without always colliding with its
  own current name.
*/
function nameTaken(ws, name, excludeId) {
    const wanted = String(name || '').trim().toLowerCase();
    if (!wanted) return false;
    return listProjects(ws).some((p) => p.id !== excludeId && String(p.name || '').trim().toLowerCase() === wanted);
}

function getActive(ws) {
    ensureWorkspace(ws);
    const st = readState(ws);
    const projects = listProjects(ws);
    if (st.active && projects.some(p => p.id === st.active)) return st.active;
    const first = projects[0] ? projects[0].id : null;
    if (first) { st.active = first; writeState(ws, st); }
    return first;
}

function setActive(ws, id) {
    if (!fs.existsSync(projectDir(ws, id))) throw new Error('No such project: ' + id);
    writeState(ws, Object.assign(readState(ws), { active: id }));
    return id;
}

function copyDir(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, e.name), d = path.join(dst, e.name);
        if (e.isDirectory()) copyDir(s, d);
        else fs.copyFileSync(s, d);
    }
}

// Create a project. With `fromId`, clone that project (data and all). Otherwise
// scaffold an empty project: project.json from the template, empty csdb/Media,
// and the static front-matter pages copied from the app.
function createProject(ws, { name, fromId, type, templateRef, staticFrontMatterDir, pipeline, group }) {
    ensureWorkspace(ws);
    const id = uniqueId(ws, slug(name || fromId || 'project'));
    const dst = projectDir(ws, id);

    if (fromId) {
        const src = projectDir(ws, fromId);
        if (!fs.existsSync(src)) throw new Error('No such source project: ' + fromId);
        copyDir(src, dst);
        const pj = JSON.parse(fs.readFileSync(path.join(dst, 'project.json'), 'utf8'));
        pj.name = name || (pj.name + ' (copy)');
        // An explicit group moves the clone into it; otherwise a clone stays
        // in whatever folder its source was already in.
        if (group !== undefined) pj.group = String(group || '').trim();
        fs.writeFileSync(path.join(dst, 'project.json'), JSON.stringify(pj, null, 2) + '\n');
    } else {
        fs.mkdirSync(path.join(dst, 'csdb'), { recursive: true });
        fs.mkdirSync(path.join(dst, 'Media'), { recursive: true });
        fs.mkdirSync(path.join(dst, 'jss', 'frontmatter'), { recursive: true });
        const project = {
            schemaVersion: 1,
            name: name || id,
            type: type || 'S1000D',
            // Which build engine renders this project's PDF. 's1000dtojss' (the
            // default) is the customizable pipeline: S1000D -> JSS -> FO, with
            // the two-layer settings system applied. 's1000dtofo' is the fixed,
            // native single-stage renderer (S1000D -> FO directly) — only
            // meaningful when type is 'S1000D'; a JSS-source project has no
            // S1000D content for it to render and always uses the JSS pipeline.
            pipeline: (type === 'S1000D' && pipeline === 's1000dtofo') ? 's1000dtofo' : 's1000dtojss',
            group: String(group || '').trim(),
            templateRef: templateRef || 'default',
            input: { pm: 'publication.xml', csdbDir: 'csdb', mediaDir: 'Media' },
            publication: {
                bookName: 'User Handbook', systemName: name || 'System',
                publicationNo: '', inbrNo: '', nsn: '', contractNo: '',
                projectCode: '', ltDocumentNo: '', month: '', year: '',
                securityClassification: 'RESTRICTED'
            },
            frontMatter: {},
            overrides: { layout: {} }
        };
        fs.writeFileSync(path.join(dst, 'project.json'), JSON.stringify(project, null, 2) + '\n');
        if (staticFrontMatterDir && fs.existsSync(staticFrontMatterDir)) {
            // Each engine reads its front matter from its own folder, so seed
            // the one this project will actually build from — otherwise the
            // Explorer's Front Matter section is empty until the first build.
            const fmTarget = project.pipeline === 's1000dtofo'
                ? path.join(dst, 's1000d', 'frontmatter')
                : path.join(dst, 'jss', 'frontmatter');
            fs.mkdirSync(fmTarget, { recursive: true });
            // 12-list-of-abbreviations.xml is hand-authored like the others:
            // nothing derives abbreviations from the document, so without the
            // stencil on disk that page can only ever render as the blank
            // pro-forma, with no file for the author to add entries to.
            const statics = ['05-record-of-changes.xml', '06-associated-handbooks.xml',
                '08-first-aid.xml', '10-demolition.xml', '11-change-notice.xml',
                '12-list-of-abbreviations.xml'];
            for (const f of statics) {
                const s = path.join(staticFrontMatterDir, f);
                if (fs.existsSync(s)) fs.copyFileSync(s, path.join(fmTarget, f));
            }
        }
    }
    return id;
}

function deleteProject(ws, id) {
    const dir = projectDir(ws, id);
    if (!fs.existsSync(dir)) return;
    fs.rmSync(dir, { recursive: true, force: true });
    const st = readState(ws);
    if (st.active === id) { st.active = null; writeState(ws, st); }
}

// Files never worth exporting: regenerable build output and the driver
// stylesheet build.js writes fresh on every generate. Exporting source only
// keeps the archive small and avoids shipping a stale PDF alongside its source.
const EXPORT_EXCLUDE = /^(jss-output\.(pdf|fo)|jss-preview\.pdf|jss-run\.xsl|_watermark\.svg)$/i;

// Recursively list a project's exportable files as [{abs, rel}], rel using
// forward slashes so the archive is portable across OSes.
function listExportFiles(dir, base) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!base && EXPORT_EXCLUDE.test(e.name)) continue;
        const abs = path.join(dir, e.name);
        const rel = (base ? base + '/' : '') + e.name;
        if (e.isDirectory()) out.push(...listExportFiles(abs, rel));
        else out.push({ abs, rel });
    }
    return out;
}

// A unique name for an incoming house template: if <name>.house.json already
// exists locally, suffix like uniqueId does for projects, so importing never
// silently overwrites someone else's customized template.
function uniqueTemplateName(ws, base) {
    let name = base, n = 2;
    while (fs.existsSync(path.join(templatesDir(ws), `${name}.house.json`))) name = `${base}-${n++}`;
    return name;
}

module.exports = {
    ensureWorkspace, listProjects, getActive, setActive,
    listEmptyFolders, addEmptyFolder, removeEmptyFolder,
    createProject, deleteProject, nameTaken,
    projectDir, templatesDir, projectsDir,
    listExportFiles, uniqueTemplateName, uniqueId, slug, copyDir,
};
