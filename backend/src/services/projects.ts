// =============================================================================
// Projects and folders (the workspace).
//
// Content lives on disk (workspace/projects/<id>/); the registry in
// publisher.db indexes it and carries governance (membership, folder mirror).
// This is JSS Publisher's model with one deliberate simplification: JSS routes
// every structural change (create/rename/delete of a folder or project)
// through an approval queue for non-administrators. This platform ships the
// "core workspace first" scope, so the person who creates a folder or project
// owns it and manages it directly; administrators manage everything. The
// approval queue can be layered on later without changing the data model,
// because the store already carries change_requests.
// =============================================================================

import { resolveFormat, type ResolvedFormat } from './formats';
import fs from 'fs';
import path from 'path';
import { config, nowIso, vendor } from '../config';
import { store, registryDb, workspace, projectDirFor, workspaceDir, docIndex, audit } from '../context';
import { bad, conflict, forbidden, notFound } from './http';
import { chapterEntries, profileById } from './profiles';
import * as PC from './projectConfig';
import * as SNS from './sns';

const { newId } = require('../core/auth/crypto');

export interface User { id: string; username: string; fullName: string; role: string }

export const folderKey = (name: unknown): string => String(name == null ? '' : name).trim().toLowerCase();
const FOLDER_MAX = 60;

// ── project.json ──────────────────────────────────────────────────────────

/** The Common Information Repository's workspace is a system project: it is never renamed, copied, deleted, published or released. */
export const isCirProject = (id: string): boolean => store.getProjectRow(id)?.type === 'CIR';
export function assertNotCir(id: string, what = 'do that to'): void {
  if (isCirProject(id)) throw forbidden(`The Common Information Repository is a shared workspace: you cannot ${what} it.`, 'CIR_WORKSPACE');
}

export function projectJsonPath(id: string): string {
  return path.join(projectDirFor(id), 'project.json');
}

export function readProjectJson(id: string): any {
  try { return JSON.parse(fs.readFileSync(projectJsonPath(id), 'utf8')) || {}; } catch { return {}; }
}

/** Read-modify-write so every setting the caller does not touch survives. */
export function updateProjectJson(id: string, mutate: (pj: any) => void): any {
  const pj = readProjectJson(id);
  mutate(pj);
  fs.writeFileSync(projectJsonPath(id), JSON.stringify(pj, null, 2) + '\n', 'utf8');
  return pj;
}

export const csdbRel = (pj: any): string => (pj.input && pj.input.csdbDir) || 'csdb';
/** Is this an S1000D project? Business rules (BREX), the S1000D configuration and the CSDB belong to S1000D only; JSS and JSG projects have none of them. */
export function isS1000dProject(projectId: string): boolean {
  const pj = readProjectJson(projectId);
  const format = pj.format ?? (pj.type === 'JSS' || pj.templateRef === 'uhb' ? 'jss' : 's1000d');
  return format === 's1000d';
}
export const mediaRel = (pj: any): string => (pj.input && pj.input.mediaDir) || 'Media';
export const pmRel = (pj: any): string => (pj.input && pj.input.pm) || 'publication.xml';

// ── Project cards ─────────────────────────────────────────────────────────

export interface ProjectCard {
  id: string; name: string; type: string; pipeline: string; templateRef: string;
  /** s1000d | jss | jsg, and for the document formats the domain (land / naval) and manual type (uhb ...). Projects made before formats existed: s1000d, or jss for a document-type project. */
  format: string; domain: string | null; manualType: string | null;
  /** 'jss-xml' when the project's source is a JSS document written in the JSS editor (services/jss); null otherwise. */
  authoring: 'jss-xml' | null; jssDocType: string | null;
  /** New data modules join the publication automatically (default true). */
  autoAddToPublication: boolean;
  /** Page furniture of S1000D publications: rotated side text in the left margin, and the default header logo. On by default. */
  sideText: { enabled: boolean; publisher: string; draftNote: boolean }; headerLogo: boolean; publisherLogo: boolean;
  folder: string; status: string; role: string; accessVia: 'project' | 'folder' | 'admin';
  dmCount: number; hasPdf: boolean; createdAt: string; updatedAt: string; lastOpened: string | null;
  owners: string[];
}

function countDms(id: string, pj: any): number {
  try {
    return fs.readdirSync(path.join(projectDirFor(id), csdbRel(pj))).filter((f) => /^DMC-.*\.xml$/i.test(f)).length;
  } catch { return 0; }
}

export function projectCard(row: any, role: string, via: ProjectCard['accessVia']): ProjectCard {
  const pj = readProjectJson(row.id);
  return {
    id: row.id,
    name: pj.name || row.name || row.id,
    type: pj.type || row.type || 'S1000D',
    pipeline: pj.pipeline || 's1000dtojss',
    templateRef: pj.templateRef || row.template || 'default',
    autoAddToPublication: pj.autoAddToPublication !== false,
    sideText: { enabled: pj.sideText?.enabled !== false, publisher: pj.sideText?.publisher ?? '', draftNote: pj.sideText?.draftNote !== false },
    headerLogo: pj.headerLogo !== false,
    publisherLogo: pj.publisherLogo !== false,
    format: pj.format || ((pj.type || row.type) === 'JSS' || pj.templateRef === 'uhb' ? 'jss' : 's1000d'),
    domain: pj.domain ?? null,
    manualType: pj.manualType ?? (pj.templateRef === 'uhb' ? 'uhb' : null),
    authoring: pj.authoring === 'jss-xml' ? 'jss-xml' : null,
    jssDocType: pj.authoring === 'jss-xml' ? (pj.jssDocType ?? null) : null,
    folder: String(pj.group || '').trim(),
    status: row.status || 'active',
    role, accessVia: via,
    dmCount: countDms(row.id, pj),
    hasPdf: fs.existsSync(path.join(projectDirFor(row.id), 'jss-output.pdf')),
    createdAt: row.created_at, updatedAt: row.updated_at, lastOpened: row.last_opened || null,
    owners: store.listOwners(row.id).map((o: any) => o.full_name || o.username),
  };
}

/** Every project this user may open - administrators see all of them. */
export function listProjectsFor(user: User): ProjectCard[] {
  if (user.role === 'admin') {
    return store.listAllProjects().map((r: any) => projectCard(r, 'owner', 'admin'));
  }
  return store.listProjectsForUser(user.id)
    .filter((r: any) => (r.status || 'active') === 'active')
    .map((r: any) => projectCard(r, r.member_role, r.access_via === 'folder' ? 'folder' : 'project'));
}

// ── Create / copy / rename / delete ───────────────────────────────────────

const EMPTY_PM = (title: string, entries = ''): string => {
  const d = new Date();
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<pm xmlns:xi="http://www.w3.org/2001/XInclude" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xlink="http://www.w3.org/1999/xlink">
  <identAndStatusSection>
    <pmAddress>
      <pmIdent>
        <pmCode modelIdentCode="MODEL" pmIssuer="00000" pmNumber="00000" pmVolume="00"/>
        <language countryIsoCode="IN" languageIsoCode="en"/>
        <issueInfo issueNumber="001" inWork="00"/>
      </pmIdent>
      <pmAddressItems>
        <issueDate year="${d.getFullYear()}" month="${String(d.getMonth() + 1).padStart(2, '0')}" day="${String(d.getDate()).padStart(2, '0')}"/>
        <pmTitle>${esc(title)}</pmTitle>
      </pmAddressItems>
    </pmAddress>
    <pmStatus>
      <security securityClassification="01"/>
      <responsiblePartnerCompany enterpriseCode="00000"/>
      <qualityAssurance><unverified/></qualityAssurance>
    </pmStatus>
  </identAndStatusSection>
  <content>
${entries ? `${entries}\n` : ''}  </content>
</pm>
`;
};

export interface CreateProjectInput {
  name?: string; folder?: string; type?: string; pipeline?: string; templateRef?: string; from?: string;
  /** The format chosen in the wizard: 's1000d' | 'jss' | 'jsg', with the domain and manual type of the document formats (services/formats). Without it the older `pipeline` / `profile` inputs apply. */
  format?: string; domain?: string; manualType?: string;
  /** A document profile (see services/profiles): house template and starting chapters. */
  profile?: string;
  /**
   * The project's S1000D configuration (see services/projectConfig): mic, issue, language, country, responsiblePartner, originator, security, brex,
   * codeMode, snsEnforced; plus `snsPreset` (+ `snsSystems`), `enabledCodes` (info codes, when codeMode is "selected") and `dmTypes` (the schemas offered).
   * Omitted entirely = an unconstrained project (no issue, no MIC): nothing is enforced until the owner configures it.
   */
  s1000d?: Record<string, any>;
}

export async function createProject(user: User, input: CreateProjectInput): Promise<ProjectCard> {
  if (user.role === 'admin') throw forbidden('Administrators oversee the platform; a Project Manager or an Author creates projects.', 'ADMIN_NO_PROJECTS');
  const name = String(input.name ?? '').trim();
  if (!name) throw bad('A project name is required.');
  if (name.length > 80) throw bad('That project name is too long.');
  if (workspace.nameTaken(workspaceDir, name)) throw conflict(`A project named "${name}" already exists. Please use another name.`, 'name_taken');

  const group = String(input.folder ?? '').trim();
  if (group.length > FOLDER_MAX) throw bad('That folder name is too long.');
  const folder = group ? resolveFolderForFiling(user, group) : '';

  let fmt: ResolvedFormat | null = null;
  if (!input.from && input.format !== undefined) { try { fmt = resolveFormat(input); } catch (e) { throw bad((e as Error).message, 'FORMAT_NOT_READY'); } }
  const profile = input.from ? undefined : fmt ? profileById(fmt.profile) : profileById(input.profile);
  if (!fmt && input.profile && !input.from && !profile) throw bad('Unknown document type.');

  let fromId: string | undefined;
  if (input.from) {
    fromId = String(input.from);
    const v = require('../context').authz.evaluate(user, fromId, { minRole: 'viewer', cap: 'project.clone' });
    if (!v.ok) throw notFound('No such source project.');
    assertNotCir(fromId, 'copy');
  }

  // The S1000D configuration is validated BEFORE anything is created, so a bad value leaves no half-made project behind.
  let cfgPatch: Record<string, any> | null = null;
  if (!input.from && (!fmt || fmt.format === 's1000d') && input.s1000d && typeof input.s1000d === 'object') {
    cfgPatch = input.s1000d;
    PC.applyPatch(PC.defaultConfig(), cfgPatch);
  }

  const id: string = workspace.createProject(workspaceDir, {
    name, fromId, type: fmt ? fmt.type : input.type === 'JSS' ? 'JSS' : 'S1000D',
    templateRef: fmt?.jssType ? 'jss-stencil' : profile?.templateRef || input.templateRef || 'default',
    // the format wizard decides first; otherwise the starting-outline profile may name its own engine (the xignal-s1000d document type uses the direct S1000D one)
    pipeline: fmt ? fmt.pipeline : profile ? (profile.pipeline ?? 's1000dtojss') : input.pipeline === 's1000dtofo' ? 's1000dtofo' : 's1000dtojss',
    group: folder,
    staticFrontMatterDir: path.join(config.pipelineDir, 'jss', 'frontmatter'),
  });

  if (fmt) updateProjectJson(id, (p) => { p.format = fmt!.format; p.domain = fmt!.domain; p.manualType = fmt!.manualType; });
  const dir = projectDirFor(id);
  const pj = readProjectJson(id);
  const pmFile = path.join(dir, pmRel(pj));
  if (!fromId && fmt?.jssType) {
    // a JSS document is authored as JSS XML (services/jss): the stencil's chapters, not an S1000D publication module
    const { createInitialDocument } = require('./jss/service');
    const { jssTypeById } = require('./jss/registry');
    createInitialDocument(id, jssTypeById(fmt.jssType), {});
  } else if (!fromId && fmt?.jsgType) {
    // a JSG document is authored as JSG XML (services/jsg), in its own file: no S1000D publication module
    const { createInitialDocument } = require('./jsg/service');
    const { jsgTypeById } = require('./jsg/registry');
    createInitialDocument(id, jsgTypeById(fmt.jsgType), { projectName: name.toUpperCase() });
  } else if (!fromId && !fs.existsSync(pmFile)) fs.writeFileSync(pmFile, EMPTY_PM(name, profile ? chapterEntries(profile) : ''), 'utf8');
  if (!fromId && cfgPatch?.mic && fs.existsSync(pmFile)) {
    // the publication module's own code: model code - issuer (the responsible partner) - number - volume, and the language and partner it names
    const rpcCode = String(cfgPatch.responsiblePartner?.code ?? '').toUpperCase(); const rpcName = String(cfgPatch.responsiblePartner?.name ?? '');
    let pm = fs.readFileSync(pmFile, 'utf8');
    pm = pm.replace('modelIdentCode="MODEL" pmIssuer="00000" pmNumber="00000"', `modelIdentCode="${String(cfgPatch.mic).toUpperCase()}" pmIssuer="${rpcCode || '00000'}" pmNumber="00001"`)
      .replace('<language countryIsoCode="IN" languageIsoCode="en"/>', `<language countryIsoCode="${String(cfgPatch.country ?? 'IN').toUpperCase()}" languageIsoCode="${String(cfgPatch.language ?? 'en').toLowerCase()}"/>`)
      .replace('<responsiblePartnerCompany enterpriseCode="00000"/>', rpcCode ? `<responsiblePartnerCompany enterpriseCode="${rpcCode}">${rpcName ? `<enterpriseName>${rpcName.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</enterpriseName>` : ''}</responsiblePartnerCompany>` : '<responsiblePartnerCompany enterpriseCode="00000"/>');
    fs.writeFileSync(pmFile, pm, 'utf8');
  }
  for (const sub of ['csdb', 'Media']) fs.mkdirSync(path.join(dir, sub), { recursive: true });

  const now = nowIso();
  registryDb.upsertProject({ id, name, type: pj.type, template: pj.templateRef, now });
  store.setProjectRequestedBy(id, user.id, 'active', now);
  store.setProjectFolder(id, folderKey(folder) || null);
  store.upsertMember(id, user.id, 'owner', user.id, now);
  if (folder) {
    workspace.removeEmptyFolder(workspaceDir, folder);
    store.setFolderOwnerIfAbsent(folderKey(folder), folder, user.id, now);
  }
  // S1000D configuration: a copy carries its source's; a new project gets what the wizard chose (or an unconstrained default).
  try {
    if (fromId) PC.copyConfig(fromId, id, user.id);
    else {
      const base = cfgPatch ?? {};
      const row = PC.createConfig(id, { ...(cfgPatch ? {} : { }), ...base, ...(profile && base.pmTemplate === undefined ? { pmTemplate: profile.id } : {}) }, user.id, cfgPatch ? 'wizard' : 'api');
      if (!cfgPatch) {                                   // no configuration given: leave the project unconstrained (no issue, no MIC)
        const c = row.config; c.issue = null; c.snsEnforced = false;
        PC.updateConfigRaw(id, c, user.id);
      }
      if (cfgPatch?.snsPreset) SNS.applyPreset(id, String(cfgPatch.snsPreset), { systems: Array.isArray(cfgPatch.snsSystems) ? cfgPatch.snsSystems : undefined });
      if (Array.isArray(cfgPatch?.enabledCodes) && cfgPatch!.enabledCodes.length) PC.setSelectedCodes(id, 'infoCode', cfgPatch!.enabledCodes);
      if (Array.isArray(cfgPatch?.dmTypes) && cfgPatch!.dmTypes.length) PC.setDmTypes(id, cfgPatch!.dmTypes);
    }
  } catch (e) {
    // roll the half-made project back: its folder, its registry row, its configuration
    try { workspace.deleteProject(workspaceDir, id); registryDb.deleteProject(id); store.clearProjectGovernance(id); PC.deleteProjectConfig(id); } catch { /* best effort */ }
    throw e;
  }
  await docIndex.syncProject(id, dir, now);
  audit({ actorId: user.id, actorUsername: user.username, action: 'project.created', projectId: id, targetType: 'project', targetId: id, meta: { name, folder, from: fromId } });

  return projectCard(store.getProjectRow(id), 'owner', user.role === 'admin' ? 'admin' : 'project');
}

export async function updateProject(user: User, id: string, patch: { name?: string; folder?: string; pipeline?: string; autoAddToPublication?: boolean; sideText?: { enabled?: boolean; publisher?: string; draftNote?: boolean }; headerLogo?: boolean; publisherLogo?: boolean }): Promise<ProjectCard> {
  const row = store.getProjectRow(id);
  if (!row) throw notFound();
  assertNotCir(id, 'change');
  const now = nowIso();

  if (patch.name !== undefined) {
    const name = String(patch.name).trim();
    if (!name) throw bad('A project name is required.');
    if (name.length > 80) throw bad('That project name is too long.');
    if (workspace.nameTaken(workspaceDir, name, id)) throw conflict(`A project named "${name}" already exists.`, 'name_taken');
    updateProjectJson(id, (pj) => { pj.name = name; });
    registryDb.upsertProject({ id, name, type: row.type, template: row.template, now });
  }
  if (patch.sideText && typeof patch.sideText === 'object') updateProjectJson(id, (pj) => { const s = patch.sideText!; pj.sideText = { ...(pj.sideText ?? {}), ...(s.enabled !== undefined ? { enabled: s.enabled === true } : {}), ...(s.draftNote !== undefined ? { draftNote: s.draftNote === true } : {}), ...(s.publisher !== undefined ? { publisher: String(s.publisher).slice(0, 120) } : {}) }; });
  if (patch.headerLogo !== undefined) updateProjectJson(id, (pj) => { pj.headerLogo = patch.headerLogo === true; });
  if (patch.publisherLogo !== undefined) updateProjectJson(id, (pj) => { pj.publisherLogo = patch.publisherLogo === true; });
  if (patch.autoAddToPublication !== undefined) updateProjectJson(id, (pj) => { pj.autoAddToPublication = patch.autoAddToPublication === true; });
  if (patch.pipeline !== undefined) {
    updateProjectJson(id, (pj) => { pj.pipeline = patch.pipeline === 's1000dtofo' ? 's1000dtofo' : 's1000dtojss'; });
  }
  if (patch.folder !== undefined) {
    const group = String(patch.folder || '').trim();
    const folder = group ? resolveFolderForFiling(user, group) : '';
    updateProjectJson(id, (pj) => { pj.group = folder; });
    store.setProjectFolder(id, folderKey(folder) || null);
    if (folder) {
      workspace.removeEmptyFolder(workspaceDir, folder);
      store.setFolderOwnerIfAbsent(folderKey(folder), folder, user.id, now);
    }
  }
  audit({ actorId: user.id, actorUsername: user.username, action: 'project.updated', projectId: id, targetType: 'project', targetId: id, meta: patch });
  return projectCard(store.getProjectRow(id), 'owner', user.role === 'admin' ? 'admin' : 'project');
}

export function deleteProject(user: User, id: string): void {
  const row = store.getProjectRow(id);
  if (!row) throw notFound();
  assertNotCir(id, 'delete');
  workspace.deleteProject(workspaceDir, id);
  registryDb.deleteProject(id);
  store.clearProjectGovernance(id);
  PC.deleteProjectConfig(id);
  audit({ actorId: user.id, actorUsername: user.username, action: 'project.deleted', projectId: id, targetType: 'project', targetId: id, meta: { name: row.name } });
}

export function touchOpened(id: string): void {
  registryDb.touchOpened(id, nowIso());
}

// ── Folders ───────────────────────────────────────────────────────────────

/** key -> display name, from project.json groups, remembered empty folders and the ownership table. */
export function allFolders(): Map<string, string> {
  const byKey = new Map<string, string>();
  for (const p of workspace.listProjects(workspaceDir)) {
    const n = String(p.group || '').trim();
    if (n && !byKey.has(n.toLowerCase())) byKey.set(n.toLowerCase(), n);
  }
  for (const n of workspace.listEmptyFolders(workspaceDir)) {
    if (!byKey.has(n.toLowerCase())) byKey.set(n.toLowerCase(), n);
  }
  for (const f of store.listFolderOwners()) {
    if (!byKey.has(f.folder_key)) byKey.set(f.folder_key, f.name);
  }
  return byKey;
}

/** May this person administer the folder (rename, delete, set access)? Its owner and any administrator. */
export function canManageFolder(user: User, key: string): boolean {
  if (user.role === 'admin') return true;
  const owner = store.getFolderOwner(key);
  return !!owner && owner.owner_id === user.id;
}

/*
  Where a project is being filed. An existing folder is usable by anyone who
  can already see it (owner, holder of a grant, or someone with a project in
  it); a new name creates the folder and the filer becomes its owner.
*/
function resolveFolderForFiling(user: User, name: string): string {
  const existing = allFolders().get(folderKey(name));
  if (!existing) return name;
  if (user.role === 'admin' || folderVisibleTo(user, existing)) return existing;
  throw notFound('No such folder');
}

export function folderVisibleTo(user: User, name: string): boolean {
  const key = folderKey(name);
  if (!key) return false;
  if (user.role === 'admin' || canManageFolder(user, key)) return true;
  if (store.getFolderGrant(key, user.id)) return true;
  const mine = new Set<string>(store.listProjectsForUser(user.id).map((r: any) => r.id));
  return workspace.listProjects(workspaceDir).some((p: any) => mine.has(p.id) && folderKey(p.group) === key);
}

export interface FolderView {
  key: string; name: string; owner: { id: string; username: string; fullName: string } | null;
  canManage: boolean; accessRole: string | null; projects: ProjectCard[];
}

/** The dashboard's view: folders the caller can see, with the projects they can open inside each. */
export function workspaceFor(user: User): { folders: FolderView[]; ungrouped: ProjectCard[] } {
  const cards = listProjectsFor(user);
  const names = allFolders();
  const folders: FolderView[] = [];
  for (const [key, name] of names) {
    if (!folderVisibleTo(user, name)) continue;
    const owner = store.getFolderOwner(key);
    const grant = store.getFolderGrant(key, user.id);
    folders.push({
      key, name,
      owner: owner ? { id: owner.owner_id, username: owner.username, fullName: owner.full_name } : null,
      canManage: canManageFolder(user, key),
      accessRole: grant ? grant.access_role : null,
      projects: cards.filter((c) => folderKey(c.folder) === key),
    });
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));
  return { folders, ungrouped: cards.filter((c) => !c.folder) };
}

export function createFolder(user: User, rawName: unknown): string {
  const name = String(rawName ?? '').trim();
  if (!name) throw bad('A folder name is required.');
  if (name.length > FOLDER_MAX) throw bad('That folder name is too long.');
  if (allFolders().has(folderKey(name))) throw conflict(`A folder named "${name}" already exists. Please use another name.`, 'folder_exists');
  const created = workspace.addEmptyFolder(workspaceDir, name);
  store.setFolderOwnerIfAbsent(folderKey(created), created, user.id, nowIso());
  audit({ actorId: user.id, actorUsername: user.username, action: 'folder.created', meta: { name: created } });
  return created;
}

function refile(fromKey: string, toName: string): number {
  let n = 0;
  for (const p of workspace.listProjects(workspaceDir)) {
    if (folderKey(p.group) !== fromKey) continue;
    updateProjectJson(p.id, (pj) => { pj.group = toName; });
    store.setProjectFolder(p.id, folderKey(toName) || null);
    n++;
  }
  return n;
}

export function renameFolder(user: User, keyOrName: string, rawTo: unknown): string {
  const from = allFolders().get(folderKey(keyOrName));
  if (!from || !folderVisibleTo(user, from)) throw notFound('No such folder');
  if (!canManageFolder(user, folderKey(from))) throw forbidden('Only the folder owner or an administrator can rename it.');
  const to = String(rawTo ?? '').trim();
  if (!to) throw bad('A folder name is required.');
  if (to.length > FOLDER_MAX) throw bad('That folder name is too long.');
  if (folderKey(to) !== folderKey(from) && allFolders().has(folderKey(to))) {
    throw conflict(`A folder named "${to}" already exists. Please use another name.`, 'folder_exists');
  }
  const fromKey = folderKey(from);
  const moved = refile(fromKey, to);
  const wasEmpty = workspace.listEmptyFolders(workspaceDir).some((n: string) => folderKey(n) === fromKey);
  if (wasEmpty) { workspace.removeEmptyFolder(workspaceDir, from); workspace.addEmptyFolder(workspaceDir, to); }
  store.rekeyFolder(fromKey, folderKey(to), to);
  audit({ actorId: user.id, actorUsername: user.username, action: 'folder.renamed', meta: { from, to, moved } });
  return to;
}

/** Delete a folder. Its projects move to "no folder" unless `withProjects`, which only an administrator may ask for. */
export function deleteFolder(user: User, keyOrName: string, withProjects: boolean): { removedProjects: number } {
  const name = allFolders().get(folderKey(keyOrName));
  if (!name || !folderVisibleTo(user, name)) throw notFound('No such folder');
  const key = folderKey(name);
  if (!canManageFolder(user, key)) throw forbidden('Only the folder owner or an administrator can delete it.');
  if (withProjects && user.role !== 'admin') throw forbidden('Only an administrator can delete a folder together with its projects.');

  let removed = 0;
  if (withProjects) {
    for (const p of workspace.listProjects(workspaceDir)) {
      if (folderKey(p.group) !== key) continue;
      deleteProject(user, p.id);
      removed++;
    }
  } else {
    refile(key, '');
  }
  workspace.removeEmptyFolder(workspaceDir, name);
  store.dropFolder(key);
  audit({ actorId: user.id, actorUsername: user.username, action: 'folder.deleted', meta: { name, withProjects, removedProjects: removed } });
  return { removedProjects: removed };
}

export function folderAccess(user: User, keyOrName: string) {
  const name = allFolders().get(folderKey(keyOrName));
  if (!name || !folderVisibleTo(user, name)) throw notFound('No such folder');
  const key = folderKey(name);
  if (!canManageFolder(user, key)) throw forbidden('Only the folder owner or an administrator can see who has access.');
  return {
    name, key,
    grants: store.listFolderGrants(key).map((g: any) => ({ userId: g.user_id, username: g.username, fullName: g.full_name, role: g.access_role })),
  };
}

export function setFolderAccess(user: User, keyOrName: string, grants: Array<{ userId: string; role: string }>): void {
  const name = allFolders().get(folderKey(keyOrName));
  if (!name || !folderVisibleTo(user, name)) throw notFound('No such folder');
  const key = folderKey(name);
  if (!canManageFolder(user, key)) throw forbidden('Only the folder owner or an administrator can change access.');
  const valid = new Set(['viewer', 'reviewer', 'editor', 'owner']);
  const clean = (Array.isArray(grants) ? grants : [])
    .filter((g) => g && typeof g.userId === 'string' && valid.has(g.role) && store.getUser(g.userId));
  store.replaceFolderGrants(key, clean, user.id, nowIso());
  audit({ actorId: user.id, actorUsername: user.username, action: 'folder.access_changed', meta: { name, count: clean.length } });
}

// ── Startup reconciliation (registry vs disk) ─────────────────────────────

/** Import projects found on disk, drop rows whose folder is gone, restate the folder mirror. Mirrors JSS reconcileRegistry. */
export async function reconcileRegistry(): Promise<void> {
  const fsProjects: any[] = workspace.listProjects(workspaceDir);
  const ids = new Set<string>(fsProjects.map((p) => p.id));
  const now = nowIso();
  for (const p of fsProjects) {
    if (!registryDb.getProject(p.id)) registryDb.upsertProject({ id: p.id, name: p.name, type: p.type, template: p.templateRef, now });
    store.setProjectFolder(p.id, folderKey(p.group) || null);
  }
  for (const row of registryDb.listProjects()) {
    if (ids.has(row.id)) continue;
    if (fs.existsSync(workspace.projectDir(workspaceDir, row.id))) continue;
    registryDb.deleteProject(row.id);
    store.clearProjectGovernance(row.id);
  }
  await docIndex.reconcileAll(workspaceDir, [...ids], projectDirFor, now);
  void vendor;
}
