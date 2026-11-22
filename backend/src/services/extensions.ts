// =============================================================================
// Extension profiles: foreign-namespace content in S1000D modules.
//
// The bundled S1000D schemas have no xs:any, so content in another namespace fails the host schema by definition. The platform's rule (decided with
// the project owner, Phase 17):
//   - such content is NEVER dropped or rewritten: import, edit, save and export carry the text as it is;
//   - content in a namespace nobody registered is a validation ERROR (naming module, namespace, line, and the fix);
//   - an Administrator registers an extension PROFILE (namespace + one XSD file); a project must explicitly ENABLE the profile;
//   - for an enabled profile the foreign elements are validated against the profile's own XSD, and the REST of the module is validated against the
//     host S1000D schema with those elements taken out (line numbers are preserved, so findings point at the real lines).
// A profile's XSD must be a single self-contained file whose targetNamespace equals the registered namespace. Foreign ATTRIBUTES are preserved and
// reported as not validated (a global attribute cannot be checked on its own).
// =============================================================================

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config, nowIso } from '../config';
import { store } from '../context';
import { bad, conflict, notFound } from './http';
import { parseTree, walk, type MNode } from './miniXml';

const { validateXML } = require('xmllint-wasm');
const { newId } = require('../core/auth/crypto');

const STANDARD_NS = new Set([
  'http://www.w3.org/2001/XMLSchema-instance', 'http://www.w3.org/1999/xlink', 'http://www.purl.org/dc/elements/1.1/', 'http://purl.org/dc/elements/1.1/',
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#', 'http://www.w3.org/XML/1998/namespace', 'http://www.w3.org/2001/XInclude', 'http://www.w3.org/2000/xmlns/',
]);
export const MAX_XSD_BYTES = 2 * 1024 * 1024;

export interface Profile { id: string; name: string; namespace: string; xsdName: string; xsdSha256: string; description: string; createdAt: string }
const row = (r: any): Profile => ({ id: r.id, name: r.name, namespace: r.namespace, xsdName: r.xsd_name, xsdSha256: r.xsd_sha256, description: r.description ?? '', createdAt: r.created_at });
const dirOf = () => { const d = path.join(config.workspaceDir, 'extensions'); fs.mkdirSync(d, { recursive: true }); return d; };
const xsdFile = (id: string) => path.join(dirOf(), `${id}.xsd`);

export const listProfiles = (): Profile[] => store.stmt('SELECT * FROM ext_profiles ORDER BY name').all().map(row);
const byNamespace = (ns: string): Profile | undefined => { const r = store.stmt('SELECT * FROM ext_profiles WHERE namespace = ?').get(ns); return r ? row(r) : undefined; };
export const enabledFor = (projectId: string): Set<string> => new Set(store.stmt('SELECT profile_id FROM project_ext WHERE project_id = ?').all(projectId).map((r: any) => r.profile_id));

export async function registerProfile(by: string, input: { name: string; namespace: string; description?: string; xsd: string; xsdName?: string }): Promise<Profile> {
  const name = String(input.name ?? '').trim(); const ns = String(input.namespace ?? '').trim();
  if (!name) throw bad('A profile needs a name.', 'NAME_REQUIRED');
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/.test(ns)) throw bad('The namespace must be an absolute URI (for example http://example.com/ns/ext).', 'BAD_NAMESPACE');
  if (STANDARD_NS.has(ns) || /^http:\/\/www\.s1000d\.org\//i.test(ns)) throw bad('That namespace belongs to a standard the platform already handles.', 'RESERVED_NAMESPACE');
  const xsd = String(input.xsd ?? ''); if (!xsd.trim()) throw bad('The profile needs its XSD.', 'XSD_REQUIRED');
  if (Buffer.byteLength(xsd) > MAX_XSD_BYTES) throw bad('The XSD is larger than 2 MB.', 'XSD_TOO_LARGE');
  const guard = require('../core/auth/xmlGuard').checkXmlSafety(xsd); if (!guard.ok) throw bad(`The XSD was refused: ${guard.error}`, 'UNSAFE_XML');
  if (/<(?:xs|xsd)?:?(?:import|include|redefine)\b/.test(xsd)) throw bad('A profile XSD must be a single self-contained file (no import, include or redefine).', 'XSD_NOT_SELF_CONTAINED');
  const tns = /targetNamespace\s*=\s*"([^"]*)"/.exec(xsd)?.[1];
  if (tns !== ns) throw bad(`The XSD's targetNamespace (${tns ?? 'none'}) must equal the registered namespace (${ns}).`, 'NAMESPACE_MISMATCH');
  // the XSD must itself be a valid schema: validating a trivial document against it either works or reports "schema invalid"
  try { const probe = await validateXML({ xml: [{ fileName: 'p.xml', contents: `<p xmlns="${ns}"/>` }], schema: [{ fileName: 'p.xsd', contents: xsd }] }); const fatal = (probe.errors || []).find((e: any) => /parsing|compil|not a schema|failed to load/i.test(String(e.message))); if (fatal) throw bad(`The XSD is not a usable schema: ${String(fatal.message).slice(0, 200)}`, 'XSD_INVALID'); }
  catch (e) { if ((e as any).status) throw e; throw bad(`The XSD is not a usable schema: ${(e as Error).message.slice(0, 200)}`, 'XSD_INVALID'); }
  if (byNamespace(ns)) throw conflict('That namespace already has a profile.', 'DUPLICATE');
  if (store.stmt('SELECT 1 FROM ext_profiles WHERE name = ?').get(name)) throw conflict('A profile with that name exists.', 'DUPLICATE');
  const id = newId(); fs.writeFileSync(xsdFile(id), xsd, 'utf8');
  store.stmt('INSERT INTO ext_profiles (id, name, namespace, xsd_name, xsd_sha256, description, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, name, ns, path.basename(input.xsdName || `${name}.xsd`).slice(0, 120), crypto.createHash('sha256').update(xsd).digest('hex'), String(input.description ?? '').slice(0, 500), by, nowIso());
  return row(store.stmt('SELECT * FROM ext_profiles WHERE id = ?').get(id));
}

export function deleteProfile(id: string): void {
  if (!store.stmt('SELECT 1 FROM ext_profiles WHERE id = ?').get(id)) throw notFound('No such profile.');
  const n = store.stmt('SELECT COUNT(*) AS n FROM project_ext WHERE profile_id = ?').get(id).n;
  if (n) throw conflict(`${n} project${n === 1 ? ' has' : 's have'} this profile enabled; disable it there first.`, 'IN_USE');
  store.stmt('DELETE FROM ext_profiles WHERE id = ?').run(id); try { fs.unlinkSync(xsdFile(id)); } catch { /* gone */ }
}
export function setEnabled(projectId: string, profileId: string, enabled: boolean, by: string): void {
  if (!store.stmt('SELECT 1 FROM ext_profiles WHERE id = ?').get(profileId)) throw notFound('No such profile.');
  if (enabled) store.stmt('INSERT OR IGNORE INTO project_ext (project_id, profile_id, enabled_by, enabled_at) VALUES (?,?,?,?)').run(projectId, profileId, by, nowIso());
  else store.stmt('DELETE FROM project_ext WHERE project_id = ? AND profile_id = ?').run(projectId, profileId);
}

// ── scanning ────────────────────────────────────────────────────────────────

interface Scope { [prefix: string]: string }
function scopeOf(n: MNode): Scope {
  const chain: MNode[] = []; for (let c: MNode | null = n; c; c = c.parent) chain.unshift(c);
  const s: Scope = {}; for (const c of chain) for (const [k, v] of Object.entries(c.attrs)) { if (k === 'xmlns') s[''] = v; else if (k.startsWith('xmlns:')) s[k.slice(6)] = v; }
  return s;
}
const nsOfName = (name: string, scope: Scope, isAttr: boolean): string | null => { const i = name.indexOf(':'); if (i < 0) return isAttr ? null : (scope[''] ?? null); return scope[name.slice(0, i)] ?? null; };

export interface ForeignUse { namespace: string; kind: 'element' | 'attribute'; name: string; line: number; node: MNode }
/** Every use of a non-standard namespace in a document (outermost elements and attributes of host elements). */
export function foreignUses(xml: string): ForeignUse[] {
  let root: MNode; try { root = parseTree(xml); } catch { return []; }
  const out: ForeignUse[] = [];
  const visit = (n: MNode) => {
    const sc = scopeOf(n); const ns = nsOfName(n.name, sc, false);
    if (ns && !STANDARD_NS.has(ns) && !/^http:\/\/www\.s1000d\.org\//i.test(ns)) { out.push({ namespace: ns, kind: 'element', name: n.name, line: n.line, node: n }); return; }   // outermost foreign element: its subtree belongs to the extension
    for (const a of Object.keys(n.attrs)) { if (a === 'xmlns' || a.startsWith('xmlns:') || !a.includes(':')) continue; const an = nsOfName(a, sc, true); if (an && !STANDARD_NS.has(an) && !/^http:\/\/www\.s1000d\.org\//i.test(an)) out.push({ namespace: an, kind: 'attribute', name: a, line: n.line, node: n }); }
    n.children.forEach(visit);
  };
  visit(root); return out;
}
export const usesForeign = (xml: string): boolean => /\sxmlns(?::\w+)?\s*=\s*"(?!http:\/\/www\.w3\.org\/|http:\/\/www\.purl\.org\/|http:\/\/purl\.org\/|http:\/\/www\.s1000d\.org\/)[^"]+"/.test(xml.slice(0, 20000));

export interface ExtFinding { rule: 'UNREGISTERED_EXTENSION' | 'EXTENSION_NOT_ENABLED' | 'EXTENSION_INVALID' | 'EXTENSION_ATTRIBUTE_UNCHECKED'; severity: 'error' | 'info'; line: number; location: string; message: string; fix: string }

/**
 * The host-schema view of a module: enabled-extension elements and attributes removed, every line kept. `findings` are the extension rules
 * (unregistered / not enabled / invalid against the profile XSD). When nothing foreign is present `host === xml` and there are no findings.
 */
export async function analyse(projectId: string, xml: string): Promise<{ host: string; findings: ExtFinding[]; foreign: boolean }> {
  if (!usesForeign(xml)) return { host: xml, findings: [], foreign: false };
  const uses = foreignUses(xml); if (!uses.length) return { host: xml, findings: [], foreign: false };
  const enabled = enabledFor(projectId); const findings: ExtFinding[] = []; const strip: Array<{ start: number; end: number; replace: string }> = []; const attrStrip: ForeignUse[] = [];
  const seen = new Set<string>();
  for (const u of uses) {
    const prof = byNamespace(u.namespace); const key = `${u.namespace}|${u.kind}`;
    if (!prof) { if (!seen.has(key)) { seen.add(key); findings.push({ rule: 'UNREGISTERED_EXTENSION', severity: 'error', line: u.line, location: `<${u.name}>`, message: `<${u.name}> is in the namespace ${u.namespace}, which no extension profile registers; the S1000D schema does not allow it.`, fix: `Ask an administrator to register an extension profile for ${u.namespace} (with its XSD) and enable it for this project, or remove the content.` }); } continue; }
    if (!enabled.has(prof.id)) { if (!seen.has(key)) { seen.add(key); findings.push({ rule: 'EXTENSION_NOT_ENABLED', severity: 'error', line: u.line, location: `<${u.name}>`, message: `The extension profile “${prof.name}” (${u.namespace}) is registered but this project has not enabled it.`, fix: `Enable “${prof.name}” in the project's S1000D settings, or remove the content.` }); } continue; }
    if (u.kind === 'element') {
      strip.push({ start: u.node.start, end: u.node.end, replace: '\n'.repeat((xml.slice(u.node.start, u.node.end).match(/\n/g) || []).length) });
      // validate the subtree standalone, with the namespace declarations in scope
      const decls = Object.entries(scopeOf(u.node)).map(([k, v]) => `${k ? `xmlns:${k}` : 'xmlns'}="${v.replace(/"/g, '&quot;')}"`).join(' ');
      const frag = xml.slice(u.node.start, u.node.end).replace(/^<([^\s/>]+)/, `<$1 ${decls}`);
      const lead = '\n'.repeat(u.line - 1);                        // keep real line numbers in the report
      try {
        const res = await validateXML({ xml: [{ fileName: 'ext.xml', contents: lead + frag }], schema: [{ fileName: 'ext.xsd', contents: fs.readFileSync(xsdFile(prof.id), 'utf8') }] });
        for (const e of res.errors || []) findings.push({ rule: 'EXTENSION_INVALID', severity: 'error', line: (e.loc && e.loc.lineNumber) || u.line, location: `<${u.name}>`, message: `Invalid against the “${prof.name}” profile: ${String(e.message).replace(/^Schemas validity error\s*:\s*/, '')}`, fix: `Correct the element to match ${prof.xsdName}.` });
      } catch (e) { findings.push({ rule: 'EXTENSION_INVALID', severity: 'error', line: u.line, location: `<${u.name}>`, message: `The profile check could not run: ${(e as Error).message.slice(0, 200)}`, fix: 'Check the profile XSD.' }); }
    } else attrStrip.push(u);
  }
  // attributes: removed by their exact position inside the start tag (never by a search over the whole text)
  for (const u of attrStrip) {
    const tag = xml.slice(u.node.start, u.node.tagEnd + 1);
    const m = new RegExp(`\\s${u.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*("[^"]*"|'[^']*')`).exec(tag);
    if (m) strip.push({ start: u.node.start + m.index, end: u.node.start + m.index + m[0].length, replace: '\n'.repeat((m[0].match(/\n/g) || []).length) });
    findings.push({ rule: 'EXTENSION_ATTRIBUTE_UNCHECKED', severity: 'info', line: u.line, location: `@${u.name}`, message: `The attribute ${u.name} (an enabled extension namespace) is preserved but cannot be validated on its own.`, fix: 'None needed.' });
  }
  let host = xml;
  for (const s2 of strip.sort((x, y) => y.start - x.start)) host = host.slice(0, s2.start) + s2.replace + host.slice(s2.end);
  return { host, findings, foreign: true };
}
void walk;
