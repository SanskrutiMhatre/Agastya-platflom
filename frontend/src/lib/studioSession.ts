// =============================================================================
// StudioSession - the platform's host for the embedded S1000D Studio editor.
//
// The Studio is an imperative, framework-free application that binds global
// listeners when it is constructed, so exactly ONE instance lives for the page
// and React only moves its root element in and out of the editor route. That is
// also what keeps open documents (and their undo history) alive while the author
// looks at Explore or Validation and comes back.
//
// What the host adds, and the Studio did not have:
//   - documents come from and go to the project's CSDB (server), not local files
//   - saves carry the hash the author loaded, so a concurrent change is refused (409)
//   - ICN artwork is supplied from the project's graphics
//   - quick preview formats with the project's own publication settings
//   - open/dirty state is published to React for the sidebar
// =============================================================================

import { create } from 'zustand';
import { contentApi, referenceApi, s1000dApi, type DmSummary } from '../api';
import { csdbApi } from '../api/csdb';
import type { ProjectRefs, ReferenceData } from '../studio/core/reference';
import { ApiError } from '../api/client';
import { useUi } from '../store/ui';
import { onSignedOut, useSession } from '../store/session';
import { downloadText } from './localDraft';
import { setGrammarBase } from '../studio/core/grammar';
import type { EditorDocument } from '../studio/core/document';
import { App, type HostCommand, type StudioHost } from '../studio/ui/app';
import { DesignView } from '../studio/view/design';
import { formatDmc } from '../studio/core/s1000d';
import type { DocumentEditor } from '../studio/ui/editor';
import { toPublicationSettings } from './publicationSettings';
import type { PublicationSettings } from '../studio/export/pdf-settings';

export interface OpenDoc { key: string; file: string | null; title: string; dirty: boolean; active: boolean }

/** `panes`: whether the Studio's Properties (right) and Problems (bottom) panes are open (the editor page's top-bar toggles show it). */
interface StudioState { docs: OpenDoc[]; ready: boolean; projectId: string | null; panes: { right: boolean; bottom: boolean } }
export const useStudio = create<StudioState>(() => ({ docs: [], ready: false, projectId: null, panes: { right: true, bottom: true } }));

/** `object` = a CSDB object (comment, update file, ICN metadata, SCORM package) rather than a data module: saved through the objects API. */
interface Ref { file: string; hash: string; object?: boolean; /** WP-21 (PRD-004): the text the hash stands for, the base of a compare-and-merge */ base?: string }

/** WP-21 (PRD-004): a refused save the author chose to compare: their text, the text both started from, and the module. */
export interface StudioConflict { file: string; base: string; mine: string }
const DM_FILE = /^DMC-[A-Za-z0-9._-]+\.xml$/i;

class StudioSession {
  private app: App | null = null;
  private readonly root = document.createElement('div');
  private refs = new WeakMap<EditorDocument, Ref>();
  private projectId: string | null = null;
  private media: Array<{ name: string; dir: string }> = [];
  private settingsCache: Partial<PublicationSettings> | undefined;
  /** The project's data modules as the server last listed them (identity checks for the New data module wizard). */
  private serverDms: DmSummary[] = [];
  /** Reports user-facing messages (toast) and lets the page reload counts after a save. */
  notify: (msg: string, kind?: 'info' | 'error' | 'success') => void = () => undefined;
  /** `created`: the save made a new data module (it may have joined the publication), not a new version of an open one. */
  onSaved: (created: boolean) => void = () => undefined;
  /** WP-21: the page's focus mode (the editor page sets these while it is shown) and the compare-and-merge dialog of a refused save. */
  focus: { toggle: () => void; isOn: () => boolean } | null = null;
  onConflict: ((c: StudioConflict) => void) | null = null;

  constructor() {
    this.root.className = 'app s1k-studio';   // s1k-studio: the platform shell's .app grid (styles/components.css) is not the Studio's
    this.root.style.height = '100%';
    // FE-024: the next person at this computer finds nothing of the previous one: no open document, no cached artwork and, after a
    // sign-out they chose, no draft. When the session merely ended, the drafts stay under the person who wrote them (FE-006).
    onSignedOut((explicit) => { void this.reset(explicit); });
  }

  private themeObserver: MutationObserver | null = null;

  /** Draft scope: the signed-in person and the open project (FE-006). */
  private draftScope(): string | null {
    const u = useSession.getState().user;
    return u && this.projectId ? `${u.id}/${this.projectId}` : null;
  }

  /** Close everything and drop the Studio instance; the next editor visit builds a fresh one. */
  async reset(discardDrafts: boolean): Promise<void> {
    const pending = this.starting;
    const app = this.app ?? (pending ? await pending.catch(() => null) : null);
    this.app = null; this.starting = null;
    this.themeObserver?.disconnect(); this.themeObserver = null;
    if (app) {
      const u = useSession.getState().user;
      if (discardDrafts && u) await app.discardDraftsOf(u.id).catch(() => undefined);
      for (const icn of app.images.names()) await app.images.remove(icn).catch(() => undefined);
      app.dispose();
    }
    this.root.remove();
    this.refs = new WeakMap();
    this.projectId = null; this.media = []; this.serverDms = []; this.settingsCache = undefined; this.projectRefs = null; this.reference = null;
    useStudio.setState({ docs: [], ready: false, projectId: null, panes: { right: true, bottom: true } });
  }

  private host(): StudioHost {
    return {
      save: (ed, text) => this.save(ed, text),
      isDark: () => document.documentElement.dataset.theme === 'dark',
      toggleTheme: () => useUi.getState().setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'),
      beforeNew: async () => { await Promise.all([this.refreshProjectData(), this.loadReference()]); },
      reference: () => this.reference,
      projectRefs: () => this.projectRefs,
      modelIdent: () => this.modelIdent(),
      identityTaken: (key) => this.identityTaken(key),
      changed: () => this.publish(),
      pdfSettings: () => this.settingsCache,
      draftScope: () => this.draftScope(),
      toggleFocus: () => this.focus?.toggle(),
      isFocus: () => !!this.focus?.isOn(),
      panesChanged: (p) => { const was = useStudio.getState().panes; if (was.right !== p.right || was.bottom !== p.bottom) useStudio.setState({ panes: { right: p.right, bottom: p.bottom } }); },
      commands: () => this.pageCommands?.() ?? [],
    };
  }

  /** UI redesign: the editor page's own commands (panel toggles, Editor / Split / PDF), for the Studio's palette and shortcuts dialog. */
  pageCommands: (() => HostCommand[]) | null = null;

  /** Open or close the Studio's Properties (right) or Problems (bottom) pane: the top bar's toggles, their keys and the palette. */
  setPane(p: 'right' | 'bottom', open: boolean): void {
    const app = this.app; if (!app) return;
    if (app.layout[p] !== open) app.togglePane(p);
  }

  /** Run a Studio command by id (the page header's palette and shortcuts buttons; WP-21). */
  run(id: string): void { this.app?.run(id); }

  /** The ribbon is folded to its tab strip (WP-21). */
  get ribbonCollapsed(): boolean { return !!this.app?.ribbonCollapsed; }

  /** UI redesign: the Properties panel's Comments tab body, which the editor page fills with the review comments, and its badge. */
  get commentsEl(): HTMLElement | null { return this.app?.commentsEl ?? null; }
  setCommentCount(n: number): void { this.app?.setCommentCount(n); }

  /** WP-21 (PRD-004): the saved version of a module now (someone else's), to compare with the author's. */
  async serverVersion(file: string): Promise<{ xml: string; hash: string }> {
    const pid = this.projectId; if (!pid) throw new Error('No project is open.');
    const d = await contentApi.readDm(pid, file);
    return { xml: d.xml, hash: d.hash ?? '' };
  }

  /** WP-21 (PRD-004): check a merged text with the Studio's own validation (schema and BREX), without touching the open document. */
  async checkText(xml: string, file: string): Promise<{ errors: number; messages: string[] }> {
    const app = await this.ensure();
    const { EditorDocument } = await import('../studio/core/document');
    let doc;
    try { doc = await EditorDocument.fromText(xml, file); } catch (e) { return { errors: 1, messages: [e instanceof Error ? e.message : String(e)] }; }
    const r = await app.validator.validate(doc, { xsd: true, brex: true });
    const errs = r.issues.filter((i) => i.severity === 'error');
    return { errors: errs.length, messages: errs.map((i) => (i.line ? `Line ${i.line}: ${i.message}` : i.message)) };
  }

  /** WP-21 (PRD-004): put the merged text into the open module and save it over the other version (`hash`: the version the merge was made against). */
  async saveMerged(file: string, xml: string, hash: string): Promise<boolean> {
    const app = this.app; const ed = this.editorFor(file); const ref = ed ? this.refs.get(ed.doc) : undefined;
    if (!app || !ed || !ref) throw new Error(`${file} is no longer open in the editor.`);
    ed.commitXmlText(xml);
    if (ed.xmlError) throw new Error(`The merged text is not well-formed XML: ${ed.xmlError.message}`);
    this.refs.set(ed.doc, { ...ref, hash });
    await app.save(ed);
    return !app.hasUnsavedWork(ed);
  }

  /** The Administrator's lists for the New data module wizard (languages, countries, DM types, enterprises ...); refreshed each time the wizard opens. */
  private reference: ReferenceData | null = null;
  private projectRefs: ProjectRefs | null = null;
  private async loadReference(): Promise<void> {
    const id = this.projectId;
    try { const ref = await referenceApi.get(); if (this.projectId === id) this.reference = ref; } catch { /* keep the last lists (or none): the wizard falls back to text boxes */ }
    if (!id) { this.projectRefs = null; return; }
    try {
      const b = await s1000dApi.project(id);
      if (this.projectId !== id) return;                  // the author moved to another project while this was loading
      const c = b.config;
      const brief = (k: 'infoCode' | 'learnCode' | 'learnEventCode' | 'itemLocationCode') => b.codes[k].map((x) => ({ code: x.code, title: x.title }));
      this.projectRefs = {
        mic: c.mic, issue: c.issue, language: c.language, country: c.country, responsiblePartner: c.responsiblePartner, originator: c.originator, security: c.security, brex: c.brex,
        codes: { infoCode: brief('infoCode'), learnCode: brief('learnCode'), learnEventCode: brief('learnEventCode'), itemLocationCode: brief('itemLocationCode') },
        dmTypes: b.dmTypes.map((t) => ({ schema: t.schema, name: t.name, enabled: t.enabled, defaultCode: t.infoCode ?? '', recommended: t.advice?.recommended ?? [], unresolved: t.advice?.unresolved ?? null })),
        sns: b.sns, snsEnforced: c.snsEnforced,
      };
    } catch { this.projectRefs = null; }
  }

  private starting: Promise<App> | null = null;
  /** Create the Studio once, on first use. Concurrent callers (StrictMode, the side panel, ?file=) all wait for the same initialisation. */
  private ensure(): Promise<App> {
    this.starting ??= this.create().catch((e) => { this.starting = null; this.app = null; throw e; });
    return this.starting;
  }

  private async create(): Promise<App> {
    setGrammarBase('/grammar');
    // The first view is the owner-approved mockup's (docs/audit/mockups/editor.html, UI redesign 2026-11-28; it replaces the earlier
    // "panes closed" default of WP-21): the Properties panel (right) and the Problems panel (under the document) are open, the Studio's own
    // Navigation pane (the document outline) is closed because the platform's Explorer is beside it, and the Identification section starts
    // folded. The author's own choice is remembered from then on; the one-time reset below also applies to layouts saved before this default.
    DesignView.defaultIdentCollapsed = true;
    try {
      if (!localStorage.getItem('agastya.editor.panes.v2')) {
        const saved = JSON.parse(localStorage.getItem('studio.layout') ?? '{}');
        localStorage.setItem('studio.layout', JSON.stringify({ ...saved, left: false, right: true, bottom: true, rightTab: 'attributes' }));
        localStorage.setItem('agastya.editor.panes.v2', '1');
      }
    } catch { /* private mode */ }
    const app = new App(this.root, this.host());
    this.app = app;
    // The page theme changes from the platform's own switch or the OS; the editor's views (CodeMirror) must follow.
    this.themeObserver?.disconnect();
    this.themeObserver = new MutationObserver(() => app.applySettings());
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    await app.init();
    useStudio.setState({ ready: true });
    return app;
  }

  /** Put the editor into `container` (the editor route), creating it the first time. */
  async mount(container: HTMLElement): Promise<void> {
    const app = await this.ensure();
    if (this.root.parentElement !== container) container.appendChild(this.root);
    // Views measure themselves against their container: tell them it has one now.
    requestAnimationFrame(() => { app.active?.xml.view.requestMeasure(); window.dispatchEvent(new Event('resize')); });
  }

  unmount(): void { this.root.remove(); }

  get currentProject(): string | null { return this.projectId; }

  /** Open or close the Studio's own side panes (outline on the left, attributes/elements on the right). */
  setPanes(left: boolean, right: boolean): void {
    const app = this.app;
    if (!app) return;
    if (app.layout.left !== left) app.togglePane('left');
    if (app.layout.right !== right) app.togglePane('right');
  }

  /** Views measure themselves against their container: call after the container changes size or visibility. */
  relayout(): void {
    requestAnimationFrame(() => { this.app?.active?.xml.view.requestMeasure(); window.dispatchEvent(new Event('resize')); });
  }

  hasUnsaved(): boolean {
    return !!this.app && this.app.editors.some((ed) => this.app!.hasUnsavedWork(ed));
  }

  /** Bind the editor to a project. A different project closes the previous project's documents. */
  async setProject(projectId: string): Promise<void> {
    const app = await this.ensure();
    if (this.projectId !== projectId) {
      await app.closeAll();
      // Linked artwork is cached per browser by ICN; a different project must not see the previous one's figures.
      for (const icn of app.images.names()) await app.images.remove(icn);
      this.projectId = projectId;
      this.media = [];
      this.serverDms = [];
      this.settingsCache = undefined;
      this.projectRefs = null;
      useStudio.setState({ projectId });
    }
    await this.refreshProjectData();
  }

  /** Media list (for ICN artwork) and publication settings (for quick preview). */
  async refreshProjectData(opts: { dmsOnly?: boolean } = {}): Promise<void> {
    if (!this.projectId) return;
    const id = this.projectId;
    // WP-18 (FE-029): a save changes the module list, never the pictures or the publication settings, so after a save only the list is asked for
    // (and the editor's side list asks for the same /dms at the same moment: the query layer sends one request for both).
    if (opts.dmsOnly) {
      const dms = await contentApi.dms(id).catch(() => null);
      if (id === this.projectId && dms) this.serverDms = dms;
      return;
    }
    const [media, settings, dms] = await Promise.all([contentApi.media(id).catch(() => []), contentApi.settings(id).catch(() => null), contentApi.dms(id).catch(() => null)]);
    if (id !== this.projectId) return;
    this.media = media;
    if (dms) this.serverDms = dms;
    if (settings) this.settingsCache = toPublicationSettings(settings.project, settings.house);
  }

  // ── Identity (New data module wizard) ───────────────────────────────────

  /** Documents open in the editor that are not in the project yet: their identity is spoken for too. */
  private unsavedIdentities(): Array<{ key: string; label: string; model: string }> {
    const out: Array<{ key: string; label: string; model: string }> = [];
    for (const ed of this.app?.editors ?? []) {
      if (this.refs.get(ed.doc)) continue;
      const i = ed.doc.ident;
      if (!i?.parts) continue;
      out.push({ key: `${formatDmc(i.parts, false)}|${i.issueNumber}-${i.inWork}|${i.language}-${i.country}`.toUpperCase(), label: `${ed.doc.fileName} (open, not saved yet)`, model: i.parts.modelIdentCode });
    }
    return out;
  }

  /** The model identification code most of the project's data modules use. */
  private modelIdent(): string | null {
    const count = new Map<string, number>();
    for (const d of this.serverDms) { const m = d.dmCodeAttrs?.modelIdentCode; if (m) count.set(m, (count.get(m) ?? 0) + 1); }
    for (const u of this.unsavedIdentities()) count.set(u.model, (count.get(u.model) ?? 0) + 1);
    let best: string | null = null;
    for (const [m, n] of count) if (best === null || n > (count.get(best) ?? 0)) best = m;
    return best;
  }

  /** The module already holding this identity (code + issue + language), or null. Mirrors the server's rule. */
  private identityTaken(key: string): string | null {
    const hit = this.serverDms.find((d) => `${d.dmc}|${d.issueNumber}-${d.inWork}|${d.language}`.toUpperCase() === key);
    if (hit) return hit.file;
    return this.unsavedIdentities().find((u) => u.key === key)?.label ?? null;
  }

  // ── Documents ───────────────────────────────────────────────────────────

  private editorFor(file: string): DocumentEditor | null {
    return this.app?.editors.find((ed) => this.refs.get(ed.doc)?.file === file) ?? null;
  }

  /** Open a data module, or (`object`) a CSDB object: comment, data update file, ICN metadata, SCORM package. Both use the same structured editor. */
  private async openFile(file: string, read: (pid: string) => Promise<{ xml: string; hash?: string }>, object: boolean, line?: number): Promise<void> {
    const app = await this.ensure();
    if (!this.projectId) return;
    let ed = this.editorFor(file);
    if (!ed) {
      const pid = this.projectId;
      const doc = await read(pid);
      if (this.projectId !== pid) return;                 // the author switched project while it loaded: never open it into the other one
      // FE-006 / S1K-004: unsaved changes this person made to this module (a crash, a closed tab, an ended session) are offered back.
      const scope = this.draftScope();
      const draft = scope ? await app.draftFor(scope, file) : null;
      let restore = false;
      if (draft && draft.text !== doc.xml) {
        const when = new Date(draft.savedAt).toLocaleString();
        const choice = await app.dialogs.confirm('Recover unsaved changes?', `You changed ${file} on ${when} and the changes were not saved. Recover them, or open the saved version and discard them?`,
          [{ id: 'discard', label: 'Discard them', danger: true }, { id: 'restore', label: 'Recover my changes', primary: true }]);
        if (this.projectId !== pid) return;
        if (choice === 'restore') restore = true;
        else if (choice === 'discard' && scope) await app.discardDrafts(scope, file);
        // Escape / close: open the saved version and keep the draft for next time
      }
      ed = restore && draft ? await app.openText(draft.text, file, null, { draftId: draft.id }) : await app.openText(doc.xml, file, null);
      if (!ed) return;
      this.refs.set(ed.doc, object ? { file, hash: doc.hash ?? '', object: true } : { file, hash: doc.hash ?? '', base: doc.xml });
      if (!restore) ed.doc.markSaved();
      else this.notify('Your unsaved changes are back. Save to keep them.', 'info');
      if (!object) await this.linkArtwork(doc.xml);
      app.updateChrome();
    } else {
      app.activate(ed);
    }
    if (line && ed) app.gotoLine(ed, line);
    this.publish();
  }

  openDm(file: string, line?: number): Promise<void> { return this.openFile(file, (pid) => contentApi.readDm(pid, file), false, line); }
  openObject(file: string): Promise<void> { return this.openFile(file, (pid) => csdbApi.readObject(pid, file), true); }

  /** After graphics are added to the project: refresh the list and re-link every open document. */
  async relinkArtwork(): Promise<void> {
    const app = this.app;
    if (!app) return;
    await this.refreshProjectData();
    for (const ed of app.editors) { await this.linkArtwork(ed.doc.toString()); ed.design.render(); }
    app.updateChrome();
  }

  /** Make the project's graphics available to the document by ICN, by entity declaration or by file name. */
  private async linkArtwork(xml: string): Promise<void> {
    const app = this.app; const id = this.projectId;
    if (!app || !id || !this.media.length) return;
    const entities = new Map<string, string>();
    for (const m of xml.matchAll(/<!ENTITY\s+([\w.\-]+)\s+SYSTEM\s+"([^"]+)"/g)) entities.set(m[1], m[2].split('/').pop() ?? m[2]);
    const byName = new Map(this.media.map((m) => [m.name.toLowerCase(), m]));
    const byStem = new Map(this.media.map((m) => [m.name.replace(/\.[^.]+$/, '').toLowerCase(), m]));
    for (const m of xml.matchAll(/infoEntityIdent\s*=\s*"([^"]+)"/g)) {
      const icn = m[1];
      if (app.images.has(icn)) continue;
      const declared = entities.get(icn);
      const hit = (declared && byName.get(declared.toLowerCase())) || byStem.get(icn.toLowerCase());
      if (!hit) continue;
      try {
        const res = await fetch(contentApi.mediaUrl(id, hit.name), { credentials: 'same-origin' });
        if (res.ok) await app.images.add(await res.blob(), icn);
      } catch { /* the editor shows a placeholder for artwork it cannot load */ }
    }
  }

  /** Persist to the project. Existing modules are saved against the hash the author loaded; new ones are created. */
  private async save(ed: DocumentEditor, text: string): Promise<boolean> {
    const id = this.projectId;
    if (!id) return false;
    const ref = this.refs.get(ed.doc);
    try {
      if (ref?.object) {
        const out = await csdbApi.saveObject(id, ref.file, text, ref.hash);       // WP-11: saved over the version that was opened
        this.refs.set(ed.doc, { ...ref, hash: out.hash });
      } else if (ref) {
        const out = await contentApi.saveDm(id, ref.file, text, ref.hash);
        this.refs.set(ed.doc, { file: ref.file, hash: out.hash, base: text });
      } else {
        const suggested = ed.doc.suggestedFileName();
        if (!DM_FILE.test(suggested)) {
          this.notify('Give this data module a data module code first (File → Properties) so it can be named DMC-….XML.', 'error');
          return false;
        }
        const out = await contentApi.createDm(id, suggested, text);
        this.refs.set(ed.doc, { file: suggested, hash: out.hash, base: text });
        ed.doc.fileName = suggested;
      }
      void this.refreshProjectData({ dmsOnly: true });   // first, so the side list's request (started by onSaved's render) joins it
      this.onSaved(!ref);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'EDIT_CONFLICT') {
        // FE-007: the author keeps their version: as a file now, and as the draft (kept until they save or discard it).
        const app = this.app;
        const name = ref?.file ?? ed.doc.fileName;
        // WP-21 (PRD-004): or compare the two versions and keep what is wanted from each (the platform's dialog, the same in the three editors)
        const canCompare = !!this.onConflict && !!ref?.base;
        const choice = app ? await app.dialogs.confirm('Not saved: someone else changed this data module',
          `${name} was saved by someone else after you opened it, so your save was refused. Your changes are still in the editor. ${canCompare ? 'Compare your version with theirs and keep what you want from each, or download' : 'Download'} your version to keep a copy, then reopen the module to see theirs and re-apply what you need.`,
          [{ id: 'keep', label: 'Keep editing' }, { id: 'download', label: 'Download my version', primary: !canCompare }, ...(canCompare ? [{ id: 'compare', label: 'Compare and merge…', primary: true }] : [])]) : null;
        if (choice === 'download') downloadText(name.replace(/\.xml$/i, '') + ' (my version).xml', text);
        if (choice === 'compare' && ref?.base) this.onConflict?.({ file: ref.file, base: ref.base, mine: text });
      } else if (e instanceof ApiError && e.status === 403) {
        this.notify(e.message || 'You do not have permission to change this data module.', 'error');
      } else {
        this.notify(e instanceof Error ? e.message : String(e), 'error');
      }
      return false;
    }
  }

  // ── What the sidebar and PDF pane need ──────────────────────────────────

  get activeFile(): string | null {
    const ed = this.app?.active;
    return ed ? this.refs.get(ed.doc)?.file ?? null : null;
  }

  /** Save the active document (if it has unsaved work) so the server renders what the author sees. */
  async saveActive(): Promise<boolean> {
    const app = this.app; const ed = app?.active;
    if (!app || !ed) return false;
    if (app.hasUnsavedWork(ed)) await app.save(ed);
    return !app.hasUnsavedWork(ed);
  }

  /** Browser-side quick preview of the active data module. */
  async quickPreview(): Promise<{ blob: Blob; warnings: string[] } | null> {
    const ed = this.app?.active;
    if (!this.app || !ed) return null;
    return this.app.quickPreview(ed);
  }

  newDocument(): void { this.app?.run('file.new'); }
  focusEditor(): void { this.app?.active?.focus(); }

  private publish(): void {
    const app = this.app;
    if (!app) return;
    const docs: OpenDoc[] = app.editors.map((ed, i) => ({
      key: `${i}:${ed.doc.id}`,
      file: this.refs.get(ed.doc)?.file ?? null,
      title: ed.doc.fileName,
      dirty: ed.doc.dirty,
      active: ed === app.active,
    }));
    const prev = useStudio.getState().docs;
    if (prev.length === docs.length && prev.every((d, i) => d.key === docs[i].key && d.dirty === docs[i].dirty && d.active === docs[i].active && d.file === docs[i].file)) return;
    useStudio.setState({ docs });
  }

  /** Reflect a module deleted or renamed elsewhere. */
  forget(file: string): void {
    const ed = this.editorFor(file);
    if (ed) this.refs.delete(ed.doc);
    this.publish();
  }
}

export const studio = new StudioSession();
export type { DmSummary };
