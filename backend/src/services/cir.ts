// =============================================================================
// Common Information Repository (CIR) - the platform's shared pool of common data modules.
//
// V1's CIR was only a per-project filter on the 0A* info codes. Here it is what the name says: one
// repository for the whole platform, and it is a WORKSPACE like any project's: a system project
// (type 'CIR') that opens in the normal editor, so a common module is created with the same wizard
// (type dropdown, enterprise and language lists), validated, versioned and given graphics the same way.
// The code of a data module is unique inside it, exactly as inside a project.
//
//   - everyone signed in can create, add and edit common data modules  (authz: editor / manager)
//   - only a Project Manager or an administrator can delete one          (route: dm delete)
//   - the workspace is never listed with the projects, renamed, copied, deleted, released or built
//   - a module is REUSED by copying it into a project, where it becomes that project's own data
//     module and remembers where it came from (`cirSources` in project.json)
//
// `cir_modules` keeps what the files cannot say: who added a module and why.
// =============================================================================

import { placeNewDm } from './pm';
import fs from 'fs';
import path from 'path';
import { config, nowIso } from '../config';
import { store, registryDb, workspace, workspaceDir, projectDirFor, docIndex } from '../context';
import { bad, conflict, forbidden, notFound, HttpError } from './http';
import * as csdb from './csdb';
import { checkDmEnterprises } from './enterprises';
import { readProjectJson, updateProjectJson } from './projects';

type Row = Record<string, any>;
interface Actor { id: string; username: string; role: string }

export const CIR_NAME = 'Common Information Repository';

/** S1000D's Common Information Repository modules carry info codes 0A1-0A9; anything else is a general common module. */
const CIR_KINDS: Record<string, string> = {
  '0A1': 'Functional items', '0A2': 'Circuit breakers', '0A3': 'Parts', '0A4': 'Access points', '0A5': 'Zones',
  '0A6': 'Enterprises', '0A7': 'Supplies', '0A8': 'Tools', '0A9': 'Applicability', '00L': 'Common information repository',
};

let creating: Promise<string> | null = null;

/** The id of the shared workspace; made the first time anyone needs it. */
export function workspaceId(): Promise<string> {
  const row = store.getCirProjectRow();
  if (row) return Promise.resolve(row.id as string);
  if (creating) return creating;
  creating = (async () => {
    const id: string = workspace.createProject(workspaceDir, {
      name: CIR_NAME, type: 'S1000D', templateRef: 'default', pipeline: 's1000dtofo', group: '',
      staticFrontMatterDir: path.join(config.pipelineDir, 'jss', 'frontmatter'),
    });
    const dir = projectDirFor(id);
    for (const sub of ['csdb', 'Media']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
    updateProjectJson(id, (pj) => { pj.type = 'CIR'; pj.system = 'cir'; pj.name = CIR_NAME; });
    const now = nowIso();
    registryDb.upsertProject({ id, name: CIR_NAME, type: 'CIR', template: 'default', now });
    store.setProjectRequestedBy(id, null, 'active', now);
    await docIndex.syncProject(id, dir, now);
    return id;
  })().finally(() => { creating = null; });
  return creating;
}

const view = (d: csdb.DmSummary, meta: Row | undefined) => {
  const infoCode = String(d.dmCodeAttrs.infoCode ?? '').toUpperCase();
  return {
    id: d.file, file: d.file, title: d.techName || d.title, infoName: d.infoName, dmc: d.dmc, infoCode,
    kind: CIR_KINDS[infoCode] ?? 'Common module', note: meta?.note ?? null,
    addedBy: meta?.added_by ?? null, addedByName: meta ? (meta.added_by_name ?? meta.added_by_username ?? null) : null,
    addedAt: meta?.added_at ?? d.modified,
  };
};

export async function list() {
  const id = await workspaceId();
  const meta = new Map<string, Row>(store.cirList().map((m: Row) => [m.file, m]));
  return { workspace: id, modules: csdb.listDms(id).map((d) => view(d, meta.get(d.file))) };
}

/** Remember who put a module in the repository (called when one is created through the editor or an upload). */
export function noteAdded(file: string, userId: string, note = ''): void {
  if (store.cirByFile(file)) return;
  store.cirUpsert({ id: file, file, note: note.slice(0, 300), addedBy: userId, now: nowIso() });
}
export const forget = (file: string): void => { const m = store.cirByFile(file); if (m) store.cirDelete(m.id); };

export async function read(file: string): Promise<{ file: string; xml: string }> {
  const id = await workspaceId();
  const out = csdb.readDm(id, file);
  return { file: out.file, xml: out.xml };
}

/** Add (or replace) modules from files, all or nothing. Everyone may; each is held to the same rules as an import. */
export async function add(actor: Actor, files: Array<{ name: string; xml: string }>, note: string) {
  if (!files.length) throw bad('No files uploaded.');
  const id = await workspaceId();
  const problems: string[] = [];
  const staged: Array<{ name: string; xml: string; exists: boolean }> = [];
  for (const f of files) {
    const name = path.basename(f.name).replace(/[^\w.\- ]/g, '_');
    if (!csdb.DM_FILE_RE.test(name)) { problems.push(`${f.name}: data module files are named DMC-<code>.xml`); continue; }
    try { csdb.validateContent(`cir/${name}`, f.xml); csdb.assertUnique(id, name, f.xml); } catch (e) { problems.push(`${name}: ${(e as Error).message}`); continue; }
    for (const p of checkDmEnterprises(f.xml)) problems.push(`${name}: ${p}`);
    staged.push({ name, xml: f.xml, exists: fs.existsSync(csdb.resolveDmFile(id, name)) });
  }
  if (problems.length) throw new HttpError(400, 'Nothing was added to the repository.', 'CIR_REFUSED', { problems });

  const role = actor.role === 'project_manager' ? 'manager' : 'editor';
  for (const s of staged) {
    if (s.exists) await csdb.writeDm(id, s.name, s.xml, undefined, actor, role);
    else await csdb.createDm(id, s.name, s.xml, actor);
    noteAdded(s.name, actor.id, note);
  }
  const all = await list();
  const names = new Set(staged.map((s) => s.name));
  return all.modules.filter((m: Row) => names.has(m.file));
}

/** Only a Project Manager or an administrator may delete a common module; everyone may add and edit. */
export async function remove(actor: Actor, file: string): Promise<string> {
  if (actor.role === 'author') throw forbidden('Only a Project Manager or an administrator can delete a common data module. Everyone can add and edit them.', 'CIR_DELETE_ROLE');
  const id = await workspaceId();
  if (!fs.existsSync(csdb.resolveDmFile(id, file))) throw notFound('No such common data module.');
  await csdb.deleteDm(id, file, actor, 'manager');
  forget(file);
  return file;
}

/** Copy a common module into a project. The project then owns its copy; the link is recorded for traceability. */
export async function copyToProject(actor: Actor, file: string, projectId: string) {
  const { xml } = await read(file);
  try {
    await csdb.createDm(projectId, file, xml, actor, false, { fromRepository: true });
  } catch (e) {
    if (e instanceof HttpError && e.code === 'ALREADY_EXISTS') throw conflict(`This project already has ${file}.`, 'ALREADY_EXISTS');
    throw e;
  }
  updateProjectJson(projectId, (pj) => { pj.cirSources = { ...(pj.cirSources || {}), [file]: { copiedAt: nowIso(), by: actor.username } }; });
  void readProjectJson;
  placeNewDm(projectId, file);                          // the copy joins the publication, like any new module
  // a LINKED copy: which CIR content it was taken from, so a later change in the repository can be noticed and, when a Project Manager approves, taken over
  store.stmt('INSERT OR REPLACE INTO cir_links (project_id, file, cir_file, cir_issue, cir_hash, local_hash, linked_at, linked_by, approved_issue, approved_by, approved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(projectId, file, file, issueOf(xml), csdb.sha(xml), csdb.sha(xml), nowIso(), actor.id, issueOf(xml), actor.id, nowIso());
  return { file, linked: true };
}


// ── linked copies: version tracking, update available, approval ─────────────

const issueOf = (xml: string): string => { const m = /<issueInfo\b[^>]*issueNumber="(\d+)"[^>]*inWork="(\d+)"/.exec(xml.slice(0, 20000)) || /<issueInfo\b[^>]*inWork="(\d+)"[^>]*issueNumber="(\d+)"/.exec(xml.slice(0, 20000)); return m ? `${m[1]}-${m[2]}` : ''; };
export type LinkState = 'up-to-date' | 'update-available' | 'locally-modified' | 'update-available-and-locally-modified' | 'source-removed';
export interface LinkView { file: string; cirFile: string; linkedIssue: string; cirIssue: string | null; state: LinkState; linkedAt: string; approvedBy: string | null; approvedAt: string | null }

export function linkOf(projectId: string, file: string): Row | undefined { return store.stmt('SELECT * FROM cir_links WHERE project_id = ? AND file = ?').get(projectId, file); }

/** A linked copy is changed in the repository, not in the project: the guard every write path calls. */
export function assertNotLinked(projectId: string, file: string): void {
  if (linkOf(projectId, file)) throw new HttpError(409, `${file} is a linked copy of a Common Information Repository module. Edit it in the repository (the Project Manager then approves the update), or detach the link first.`, 'CIR_LINKED');
}

export async function linksOf(projectId: string): Promise<LinkView[]> {
  const cirId = await workspaceId(); const out: LinkView[] = [];
  for (const l of store.stmt('SELECT * FROM cir_links WHERE project_id = ? ORDER BY file').all(projectId) as Row[]) {
    let cirXml: string | null = null; let localXml: string | null = null;
    try { cirXml = csdb.readDm(cirId, l.cir_file).xml; } catch { /* removed from the repository */ }
    try { localXml = csdb.readDm(projectId, l.file).xml; } catch { /* removed locally */ }
    const newer = cirXml !== null && csdb.sha(cirXml) !== l.cir_hash; const local = localXml !== null && csdb.sha(localXml) !== l.local_hash;
    const state: LinkState = cirXml === null ? 'source-removed' : newer && local ? 'update-available-and-locally-modified' : newer ? 'update-available' : local ? 'locally-modified' : 'up-to-date';
    out.push({ file: l.file, cirFile: l.cir_file, linkedIssue: l.cir_issue, cirIssue: cirXml ? issueOf(cirXml) : null, state, linkedAt: l.linked_at, approvedBy: l.approved_by, approvedAt: l.approved_at });
  }
  return out;
}

/** After a module in the repository changed: tell the Project Managers of every project that links it (once per change). */
export async function announceChange(file: string, actor: Actor): Promise<number> {
  const cirId = await workspaceId(); let xml: string; try { xml = csdb.readDm(cirId, file).xml; } catch { return 0; }
  const h = csdb.sha(xml); let n = 0;
  for (const l of store.stmt('SELECT * FROM cir_links WHERE cir_file = ? AND cir_hash != ?').all(file, h) as Row[]) {
    const { notify, approversOf } = require('./notifications');
    notify(approversOf(l.project_id), { kind: 'cir.update', title: 'Update available for a shared module', body: `${file} changed in the Common Information Repository (now issue ${issueOf(xml) || '?'}). Review and approve the update in the project.`, projectId: l.project_id, actorId: actor.id }); n++;
  }
  return n;
}

/** A Project Manager takes the repository's current content into the project's linked copy. A locally modified copy needs `force`. */
export async function approveUpdate(actor: Actor, projectId: string, file: string, force: boolean, role: string) {
  const l = linkOf(projectId, file); if (!l) throw notFound('That module is not a linked copy.');
  const cirId = await workspaceId(); let cirXml: string; try { cirXml = csdb.readDm(cirId, l.cir_file).xml; } catch { throw conflict('The module no longer exists in the repository.', 'SOURCE_REMOVED'); }
  const local = csdb.readDm(projectId, l.file);
  if (csdb.sha(local.xml) !== l.local_hash && !force) throw conflict('The project copy was changed after it was linked; taking the update would overwrite those changes. Confirm to overwrite.', 'LOCALLY_MODIFIED');
  if (csdb.sha(cirXml) === l.cir_hash && csdb.sha(local.xml) === l.local_hash) return { file, changed: false };
  await csdb.writeDm(projectId, l.file, cirXml, undefined, actor, role, false);
  store.stmt('UPDATE cir_links SET cir_issue = ?, cir_hash = ?, local_hash = ?, approved_issue = ?, approved_by = ?, approved_at = ? WHERE project_id = ? AND file = ?')
    .run(issueOf(cirXml), csdb.sha(cirXml), csdb.sha(cirXml), issueOf(cirXml), actor.id, nowIso(), projectId, file);
  return { file, changed: true, issue: issueOf(cirXml) };
}

export function detach(projectId: string, file: string): void { if (!store.stmt('DELETE FROM cir_links WHERE project_id = ? AND file = ?').run(projectId, file).changes) throw notFound('That module is not a linked copy.'); }
