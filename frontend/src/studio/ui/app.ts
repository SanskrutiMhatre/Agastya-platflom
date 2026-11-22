/**
 * Application shell: layout, ribbon, document tabs, panels, status bar,
 * keyboard shortcuts, files, drafts and validation orchestration.
 */
import { EditorDocument, ChangeEvent } from '../core/document';
import { XmlParseError, internalEntityRefs, readXmlFile } from '../core/xml';
import { ISSUE_LABEL, SCHEMAS, readDmCode, find, formatDmc } from '../core/s1000d';
import { ATOMIC } from '../core/display';
import { DocumentEditor, ViewMode } from './editor';
import { Command, RIBBON, buildCommands } from './commands';
import { h, icon, clear, debounce, shortcutLabel, download, isMac, escapeHtml } from './dom';
import { OutlinePanel, AttributesPanel, ElementsPanel, ProblemsPanel, PdfPanel } from './panels';
import { Dialogs, modalOpen, modal } from './dialogs';
import { FindBar } from './findbar';
import { ValidationService } from './validator';
import { ImageStore, storage, storageAvailable, loadLocal, saveLocal, Draft, RecentFile } from './storage';
import * as T from '../core/table';
import * as ops from '../core/ops';

export interface Settings {
  defaultView: ViewMode;
  theme: 'system' | 'light' | 'dark';
  liveValidation: boolean;
  liveXsd: boolean;
  liveBrex: boolean;
  spellcheck: boolean;
  syncSelection: boolean;
  splitTags: boolean;
  drafts: boolean;
  declareEntitiesOnSave: boolean;
  defaultNotation: string;
  defaultIssue: string;
  xmlCommitDelay: number;
  zoom: number;
  modelIdentCode: string;
  enterpriseCode: string;
  enterpriseName: string;
  language: string;
  country: string;
}

const DEFAULT_SETTINGS: Settings = {
  defaultView: 'design', theme: 'system', liveValidation: true, liveXsd: true, liveBrex: true, spellcheck: true, syncSelection: true,
  splitTags: false, drafts: true, declareEntitiesOnSave: true, defaultNotation: 'png', defaultIssue: '5-0', xmlCommitDelay: 500, zoom: 1,
  modelIdentCode: '', enterpriseCode: '', enterpriseName: '', language: 'en', country: 'US',
};

export interface Sample { file: string; title: string; description: string; images?: string[] }

/**
 * Embedding contract. When the Studio is mounted inside Agastya Platform v2 the platform owns everything that is not
 * authoring: where documents live (the project's CSDB), publication settings, release and watermark. The host supplies
 * those hooks; without one the Studio behaves exactly as the standalone application.
 */
export interface StudioHost {
  /** Persist a document to the project. Resolve true when handled - the local file save is then skipped. */
  save(ed: DocumentEditor, text: string): Promise<boolean>;
  /** Fired whenever the open documents, the active document or a dirty flag changes. */
  changed(): void;
  /** The platform owns the theme (one switch for the whole page): whether it is dark now, and how to flip it. */
  isDark?(): boolean;
  toggleTheme?(): void;
  /** Called before the New data module wizard opens, so it sees the project's current data modules. */
  beforeNew?(): Promise<void>;
  /** The model identification code this project's data modules use, or null when it has none yet. */
  modelIdent?(): string | null;
  /** The Administrator's lists the wizard offers as dropdowns (languages, countries, DM types, enterprises ...), or null. */
  reference?(): import('../core/reference').ReferenceData | null;
  /** The project's own S1000D configuration (MIC, issue, SNS, enabled codes and types, applicability); null outside a project. */
  projectRefs?(): import('../core/reference').ProjectRefs | null;
  /** The file (or label) already holding this identity - "CODE|ISSUE-INWORK|LANG-COUNTRY", upper case - or null when it is free. */
  identityTaken?(key: string): string | null;
  /** What the PDF engine formats a quick preview with (title, classification...): owned by the project's settings. */
  pdfSettings(): Partial<import('../export/pdf-settings').PublicationSettings> | undefined;
}

export class App {
  settings: Settings = loadLocal('studio.settings', DEFAULT_SETTINGS);
  layout = loadLocal('studio.layout', { left: true, right: true, bottom: true, rightTab: 'attributes' as 'attributes' | 'elements' | 'pdf', ribbonTab: 'home' });
  readonly commands: Command[] = buildCommands();
  private byId = new Map(this.commands.map((c) => [c.id, c]));
  editors: DocumentEditor[] = [];
  active: DocumentEditor | null = null;
  readonly images = new ImageStore();
  readonly validator = new ValidationService();
  readonly dialogs = new Dialogs(this);
  readonly find = new FindBar(this);
  recent: RecentFile[] = loadLocal('studio.recent', { list: [] as RecentFile[] }).list;
  samples: Sample[] = [];
  timings: Record<string, number> = {};

  // DOM
  readonly root: HTMLElement;
  private tabsEl!: HTMLElement;
  private ribbonTabs!: HTMLElement;
  private ribbonBody!: HTMLElement;
  private editorHost!: HTMLElement;
  private startPage!: HTMLElement;
  private leftPane!: HTMLElement;
  private rightPane!: HTMLElement;
  private bottomPane!: HTMLElement;
  private statusLeft!: HTMLElement;
  private statusMsg!: HTMLElement;
  private statusRight!: HTMLElement;
  private toasts!: HTMLElement;
  private ctxMenu: HTMLElement | null = null;
  private fileMenu: HTMLElement | null = null;
  readonly outline: OutlinePanel;
  readonly attributes: AttributesPanel;
  readonly elements: ElementsPanel;
  readonly problems: ProblemsPanel;
  readonly pdf: PdfPanel;
  private ribbonButtons: { el: HTMLButtonElement; cmd: Command }[] = [];
  private selChrome = debounce(() => this.selectionChrome(), 40);
  private outlineSoon = debounce(() => this.outline.render(), 300);
  private elementsSoon = debounce(() => this.elements.render(), 120);
  private keymap = new Map<string, Command>();

  constructor(root: HTMLElement, readonly host?: StudioHost) {
    this.root = root;
    if (host) root.classList.add('app--embedded');
    this.outline = new OutlinePanel(this);
    this.attributes = new AttributesPanel(this);
    this.elements = new ElementsPanel(this);
    this.problems = new ProblemsPanel(this);
    this.pdf = new PdfPanel(this);
    for (const c of this.commands) for (const k of c.keys ?? []) this.keymap.set(normKey(k), c);
    this.build();
    this.applySettings();
    this.bindGlobal();
    (window as unknown as { studio: App }).studio = this;
  }

  async init() {
    if (!(await storageAvailable())) this.toast('Browser storage is not available (private window or blocked site data): drafts, linked images and the BREX will not be kept after this session.', 'warning');
    await this.images.load();
    if (!this.host) try {
      const r = await fetch('/samples/index.json');
      if (r.ok) this.samples = await r.json();
    } catch {
      /* no samples */
    }
    this.renderStart();
    if (!this.host) await this.restoreDrafts();
    const params = new URLSearchParams(location.search);
    const sample = params.get('sample');
    if (sample) await this.openSample(sample);
    if (params.get('new')) this.run('file.new');
    this.updateChrome();
  }

  // ------------------------------------------------------------- layout
  private build() {
    const logo = h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, icon('design', 18)), h('span', { class: 'brand-name' }, 'S1000D Studio'));
    this.tabsEl = h('div', { class: 'doc-tabs', role: 'tablist', 'aria-label': 'Open documents' });
    const quick = h('div', { class: 'quick' },
      this.quickBtn('file.save'), this.quickBtn('edit.undo'), this.quickBtn('edit.redo'), this.quickBtn('review.validate'),
      h('span', { class: 'quick-sep' }),
      this.quickBtn('tools.palette'), ...(this.host ? [] : [this.quickBtn('view.theme')]),
    );
    const header = h('header', { class: 'app-header' }, logo, this.tabsEl, quick);
    this.ribbonTabs = h('div', { class: 'ribbon-tabs', role: 'tablist', 'aria-label': 'Ribbon' });
    this.ribbonBody = h('div', { class: 'ribbon-body', role: 'toolbar' });
    const ribbon = h('div', { class: 'ribbon' }, this.ribbonTabs, this.ribbonBody);
    this.editorHost = h('div', { class: 'editor-host' });
    this.startPage = h('div', { class: 'start-page' });
    const center = h('main', { class: 'center' }, this.find.el, this.editorHost, this.startPage);
    this.leftPane = h('aside', { class: 'pane pane-left' }, this.outline.el, h('div', { class: 'pane-resize', 'data-pane': 'left' }));
    const rtabs = h('div', { class: 'panel-tabs pane-tabs', role: 'tablist' },
      h('button', { class: 'panel-tab', 'data-rtab': 'attributes', role: 'tab', on: { click: () => this.setRightTab('attributes') } }, 'Attributes'),
      h('button', { class: 'panel-tab', 'data-rtab': 'elements', role: 'tab', on: { click: () => this.setRightTab('elements') } }, 'Elements'),
      h('button', { class: 'panel-tab', 'data-rtab': 'pdf', role: 'tab', on: { click: () => this.setRightTab('pdf') } }, 'PDF'),
    );
    this.rightPane = h('aside', { class: 'pane pane-right' }, h('div', { class: 'pane-resize', 'data-pane': 'right' }), rtabs, this.attributes.el, this.elements.el, this.pdf.el);
    this.bottomPane = h('section', { class: 'pane pane-bottom' }, h('div', { class: 'pane-resize-h', 'data-pane': 'bottom' }), this.problems.el);
    const middle = h('div', { class: 'workspace' }, this.leftPane, center, this.rightPane);
    this.statusLeft = h('div', { class: 'status-left', 'aria-label': 'Element path' });
    this.statusMsg = h('div', { class: 'status-msg', 'aria-live': 'polite' });
    this.statusRight = h('div', { class: 'status-right' });
    const status = h('footer', { class: 'status-bar' }, this.statusLeft, this.statusMsg, this.statusRight);
    this.toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
    this.root.append(header, ribbon, middle, this.bottomPane, status, this.toasts);
    this.buildRibbon();
    this.setRightTab(this.layout.rightTab);
    this.applyLayout();
    this.bindResizers();
  }

  private quickBtn(id: string): HTMLButtonElement {
    const cmd = this.byId.get(id)!;
    const b = h('button', { class: 'icon-btn quick-btn', title: tooltip(cmd), 'aria-label': cmd.label, on: { click: () => this.run(id) } }, icon(cmd.icon ?? 'dot', 16));
    this.ribbonButtons.push({ el: b, cmd });
    return b;
  }

  private buildRibbon() {
    const fileBtn = h('button', { class: 'ribbon-tab file-tab', 'aria-haspopup': 'menu', on: { click: (e: Event) => { e.stopPropagation(); this.toggleFileMenu(); } } }, 'File');
    this.ribbonTabs.appendChild(fileBtn);
    for (const tab of RIBBON) {
      const t = h('button', { class: 'ribbon-tab' + (tab.contextual ? ' contextual' : ''), role: 'tab', 'data-tab': tab.id, on: { click: () => this.selectRibbonTab(tab.id) } }, tab.label);
      this.ribbonTabs.appendChild(t);
    }
    this.ribbonTabs.appendChild(h('span', { class: 'spacer' }));
    const viewSwitch = h('div', { class: 'ribbon-viewswitch', role: 'group', 'aria-label': 'View mode' }, ...['view.design', 'view.tags', 'view.split', 'view.xml'].map((id) => {
      const cmd = this.byId.get(id)!;
      const b = h('button', { class: 'vs-btn', title: tooltip(cmd), 'aria-label': cmd.label, on: { click: () => this.run(id) } }, icon(cmd.icon!, 15), h('span', null, cmd.label.replace(' view', '')));
      this.ribbonButtons.push({ el: b, cmd });
      return b;
    }));
    this.ribbonTabs.appendChild(viewSwitch);
    for (const tab of RIBBON) {
      const panel = h('div', { class: 'ribbon-panel', 'data-panel': tab.id, role: 'tabpanel' });
      for (const g of tab.groups) {
        const items = h('div', { class: 'rg-items' });
        const large = new Set(g.large ?? []);
        const smalls: HTMLElement[] = [];
        for (const it of g.items) {
          if (typeof it !== 'string') continue;
          const cmd = this.byId.get(it);
          if (!cmd) continue;
          const isLarge = large.has(it);
          const b = h('button', { class: isLarge ? 'rb rb-large' : 'rb rb-small', title: tooltip(cmd), 'aria-label': cmd.label, 'data-cmd': cmd.id, on: { click: () => this.run(cmd.id) } }, icon(cmd.icon ?? 'dot', isLarge ? 22 : 16), isLarge ? h('span', { class: 'rb-label' }, cmd.label.replace('…', '')) : h('span', { class: 'rb-label' }, shortLabel(cmd.label)));
          this.ribbonButtons.push({ el: b, cmd });
          if (isLarge) items.appendChild(b);
          else smalls.push(b);
        }
        if (smalls.length) {
          const col = h('div', { class: 'rg-smalls' + (smalls.length > 3 ? ' rg-smalls-grid' : '') }, ...smalls);
          items.appendChild(col);
        }
        panel.appendChild(h('div', { class: 'ribbon-group' }, items, h('div', { class: 'rg-label' }, g.label)));
      }
      this.ribbonBody.appendChild(panel);
    }
    this.selectRibbonTab(this.layout.ribbonTab);
  }

  selectRibbonTab(id: string) {
    this.layout.ribbonTab = id;
    this.ribbonTabs.querySelectorAll<HTMLElement>('.ribbon-tab[data-tab]').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === id);
      t.setAttribute('aria-selected', String(t.dataset.tab === id));
    });
    this.ribbonBody.querySelectorAll<HTMLElement>('.ribbon-panel').forEach((p) => (p.hidden = p.dataset.panel !== id));
    saveLocal('studio.layout', this.layout);
  }

  private toggleFileMenu() {
    if (this.fileMenu) {
      this.closeFileMenu();
      return;
    }
    const hidden = this.host ? new Set(['file.open', 'file.samples', 'file.saveAs', 'file.exportPdf']) : new Set<string>();
    const item = (id: string): HTMLElement | null => {
      if (hidden.has(id)) return null;
      const c = this.byId.get(id)!;
      const disabled = !c.global && !this.active;
      return h('button', { class: 'fm-item', role: 'menuitem', disabled, on: { click: () => { this.closeFileMenu(); this.run(id); } } }, icon(c.icon ?? 'dot', 16), h('span', null, c.label), h('span', { class: 'fm-key' }, c.keys?.[0] ? shortcutLabel(c.keys[0]) : ''));
    };
    const recent = this.host ? h('div', { class: 'fm-recent' }) : h('div', { class: 'fm-recent' }, h('div', { class: 'fm-head' }, 'Recent'), ...(this.recent.length ? this.recent.slice(0, 8).map((r) => h('button', { class: 'fm-recent-item', role: 'menuitem', title: r.name, on: { click: async () => { this.closeFileMenu(); if (!(await this.openRecent(r))) { this.toast(`"${r.name}" cannot be reopened automatically — select it in the Open dialog.`, 'info'); void this.openFiles(); } } } }, icon('file', 14), h('div', null, h('div', { class: 'fm-r-title' }, r.title || r.name), h('div', { class: 'fm-r-dmc' }, r.dmc || r.name)))) : [h('div', { class: 'panel-empty' }, 'No recent files')]));
    this.fileMenu = h('div', { class: 'file-menu', role: 'menu' },
      h('div', { class: 'fm-col' }, ...[item('file.new'), item('file.open'), item('file.samples'), h('div', { class: 'fm-sep' }), item('file.save'), item('file.saveAs'), item('file.exportXml'), item('file.exportHtml'), item('file.exportPdf'), h('div', { class: 'fm-sep' }), item('file.close'), h('div', { class: 'fm-sep' }), item('tools.settings'), item('tools.shortcuts'), item('tools.about')].filter((x): x is HTMLElement => !!x)),
      recent,
    );
    document.body.appendChild(this.fileMenu);
    menuKeys(this.fileMenu, () => Array.from(this.fileMenu?.querySelectorAll<HTMLElement>('.fm-item, .fm-recent-item') ?? []));
    this.fileMenu.querySelector<HTMLElement>('.fm-item:not(:disabled)')?.focus();
    const r = this.ribbonTabs.querySelector('.file-tab')!.getBoundingClientRect();
    this.fileMenu.style.left = r.left + 'px';
    this.fileMenu.style.top = r.bottom + 'px';
    setTimeout(() => document.addEventListener('mousedown', this.fileMenuOutside), 0);
  }

  private fileMenuOutside = (e: MouseEvent) => {
    const onFileTab = (e.target as Element | null)?.closest?.('.file-tab');
    if (this.fileMenu && !onFileTab && !this.fileMenu.contains(e.target as Node)) this.closeFileMenu();
  };

  private closeFileMenu() {
    this.fileMenu?.remove();
    this.fileMenu = null;
    document.removeEventListener('mousedown', this.fileMenuOutside);
  }

  setRightTab(t: 'attributes' | 'elements' | 'pdf') {
    if (this.host && t === 'pdf') t = 'attributes';
    this.layout.rightTab = t;
    this.rightPane.querySelectorAll<HTMLElement>('[data-rtab]').forEach((b) => b.classList.toggle('active', b.dataset.rtab === t));
    this.attributes.el.hidden = t !== 'attributes';
    this.elements.el.hidden = t !== 'elements';
    this.pdf.el.hidden = t !== 'pdf';
    if (t === 'elements') this.elements.render();
    if (t === 'pdf') this.pdf.render();
    saveLocal('studio.layout', this.layout);
  }

  togglePane(p: 'left' | 'right' | 'bottom') {
    this.layout[p] = !this.layout[p];
    this.applyLayout();
    saveLocal('studio.layout', this.layout);
    this.updateChrome();
  }

  private applyLayout() {
    this.leftPane.hidden = !this.layout.left;
    this.rightPane.hidden = !this.layout.right;
    this.bottomPane.hidden = !this.layout.bottom;
    this.active?.xml.view.requestMeasure();
  }

  private bindResizers() {
    this.root.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement;
      const pane = t.dataset.pane;
      if (!pane || (!t.classList.contains('pane-resize') && !t.classList.contains('pane-resize-h'))) return;
      e.preventDefault();
      t.setPointerCapture(e.pointerId);
      const el = pane === 'left' ? this.leftPane : pane === 'right' ? this.rightPane : this.bottomPane;
      const start = pane === 'bottom' ? e.clientY : e.clientX;
      const size = pane === 'bottom' ? el.offsetHeight : el.offsetWidth;
      const move = (ev: PointerEvent) => {
        const d = (pane === 'bottom' ? ev.clientY : ev.clientX) - start;
        const v = pane === 'left' ? size + d : size - d;
        if (pane === 'bottom') el.style.height = Math.max(80, Math.min(window.innerHeight * 0.6, v)) + 'px';
        else el.style.width = Math.max(180, Math.min(600, v)) + 'px';
      };
      const up = () => {
        t.removeEventListener('pointermove', move);
        t.removeEventListener('pointerup', up);
        this.active?.xml.view.requestMeasure();
      };
      t.addEventListener('pointermove', move);
      t.addEventListener('pointerup', up);
    });
  }

  private renderStart() {
    clear(this.startPage);
    if (this.host) {
      this.startPage.append(h('div', { class: 'start-inner' },
        h('h1', null, 'Select a data module'),
        h('p', { class: 'start-sub' }, 'Choose a data module from the project list on the left, or start a new one.'),
        h('div', { class: 'start-actions' },
          h('button', { class: 'start-action', on: { click: () => this.run('file.new') } }, icon('new', 26), h('div', null, h('div', { class: 'sa-title' }, 'New data module'), h('div', { class: 'sa-desc' }, 'Descriptive, procedural, fault, crew, IPD, BREX...'))))));
      return;
    }
    const action = (id: string, title: string, desc: string, ic: string) => h('button', { class: 'start-action', on: { click: () => this.run(id) } }, icon(ic, 26), h('div', null, h('div', { class: 'sa-title' }, title), h('div', { class: 'sa-desc' }, desc)));
    this.startPage.append(
      h('div', { class: 'start-inner' },
        h('h1', null, 'S1000D Studio'),
        h('p', { class: 'start-sub' }, 'Structured authoring for S1000D data modules — Issues 4.1, 4.2, 5.0, 6 and 7.'),
        h('div', { class: 'start-actions' },
          action('file.new', 'New data module', 'Descriptive, procedural, fault, crew, IPD, BREX…', 'new'),
          action('file.open', 'Open…', 'Open existing S1000D XML files', 'open'),
          action('file.samples', 'Open a sample', 'Explore the editor with ready-made data modules', 'sample'),
        ),
        this.samples.length ? h('div', { class: 'start-samples' }, h('h2', null, 'Samples'), ...this.samples.map((s) => h('button', { class: 'start-sample', on: { click: () => this.openSample(s.file) } }, icon('file', 16), h('span', { class: 'ss-title' }, s.title), h('span', { class: 'ss-desc' }, s.description)))) : null,
        h('p', { class: 'start-hint' }, 'Tip: drop S1000D XML files anywhere on this window to open them.'),
      ),
    );
  }

  // ------------------------------------------------------------- settings & theme
  saveSettings() { saveLocal('studio.settings', this.settings); }

  applySettings() {
    const dark = this.isDark();
    if (!this.host) document.documentElement.dataset.theme = dark ? 'dark' : 'light'; // embedded: the platform sets it
    document.documentElement.style.setProperty('--zoom', String(this.settings.zoom));
    for (const e of this.editors) {
      e.design.page.spellcheck = this.settings.spellcheck;
      e.xml.setDark(dark);
      e.applyViewSettings();
    }
    this.updateChrome();
  }

  isDark(): boolean {
    if (this.host?.isDark) return this.host.isDark();
    if (this.settings.theme === 'system') return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    return this.settings.theme === 'dark';
  }

  toggleTheme() {
    if (this.host?.toggleTheme) { this.host.toggleTheme(); return; }
    this.settings.theme = this.isDark() ? 'light' : 'dark';
    this.saveSettings();
    this.applySettings();
  }

  toggleSetting(k: 'liveValidation' | 'syncSelection' | 'splitTags') {
    this.settings[k] = !this.settings[k];
    this.saveSettings();
    if (k === 'liveValidation' && this.settings.liveValidation && this.active) this.validate(this.active, { live: true });
    for (const e of this.editors) e.applyViewSettings();
    this.updateChrome();
  }

  zoom(d: number) {
    this.settings.zoom = d === 0 ? 1 : Math.round(Math.min(2.5, Math.max(0.5, this.settings.zoom + d)) * 10) / 10;
    this.saveSettings();
    this.applySettings();
  }

  // ------------------------------------------------------------- commands
  run(id: string) {
    const c = this.byId.get(id);
    if (!c) return;
    const ed = this.active;
    if (!c.global && !ed) return this.toast('Open or create a data module first', 'info');
    if (ed && c.enabled && !c.enabled(this, ed)) {
      this.toast(`${c.label} is not available here`, 'info');
      return;
    }
    try {
      const r = c.run(this, ed);
      if (r instanceof Promise) r.catch((e) => this.toast(String(e?.message ?? e), 'error')).finally(() => this.updateChrome());
    } catch (e) {
      console.error(e);
      this.toast(String((e as Error).message ?? e), 'error');
    }
    this.updateChrome();
  }

  private bindGlobal() {
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    window.addEventListener('beforeunload', (e) => {
      if (this.editors.some((ed) => this.hasUnsavedWork(ed))) {
        for (const ed of this.editors) void this.saveDraft(ed);
        e.preventDefault();
        e.returnValue = '';
      }
    });
    document.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    });
    document.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.files.length || e.defaultPrevented) return; // the design view handles drops onto the page itself
      e.preventDefault();
      void this.dropFiles(e.dataTransfer.files, null);
    });
    document.addEventListener('mousedown', (e) => {
      if (this.ctxMenu && !this.ctxMenu.contains(e.target as Node)) this.closeContextMenu();
    });
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => this.applySettings());
    window.addEventListener('studio:modal-closed', () => this.active?.focus());
  }

  private onKey(e: KeyboardEvent) {
    if (modalOpen()) return;
    // AltGr (Ctrl+Alt on Windows) types characters such as @ { } ł ś on many layouts: never take those for a shortcut
    if (e.getModifierState?.('AltGraph') && e.key.length === 1 && !/^[a-z]$/i.test(e.key)) return;
    if (e.key === 'Escape') {
      if (this.ctxMenu) {
        this.closeContextMenu();
        e.preventDefault();
        return;
      }
      if (this.fileMenu) {
        this.closeFileMenu();
        e.preventDefault();
        return;
      }
      if (this.find.isOpen && !(this.active?.elementSelection)) {
        this.find.close();
        e.preventDefault();
        return;
      }
    }
    const k = keyOf(e);
    const cmd = this.keymap.get(k);
    if (!cmd) return;
    const t = e.target as HTMLElement;
    const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
    const inCm = !!t?.closest?.('.cm-editor');
    // let form fields and CodeMirror keep their own editing keys
    if (inField && !/^(Mod\+S|Mod\+Shift\+S|Mod\+O|F7|Shift\+F7|F1|Mod\+Shift\+P|F3|Shift\+F3|Mod\+Alt\+N)$/.test(k)) return;
    if (inCm && /^(Mod\+Z|Mod\+Y|Mod\+Shift\+Z|Mod\+F|Mod\+H|Mod\+G|Mod\+A|Alt\+Shift\+Arrow(Up|Down)|Mod\+Shift\+K|F3|Shift\+F3|Mod\+E|Mod\+B|Mod\+I|Mod\+U)$/.test(k)) {
      if (k === 'Mod+Z' || k === 'Mod+Y' || k === 'Mod+Shift+Z') return; // handled by CodeMirror keymap -> app
      if (k === 'Mod+H') {
        e.preventDefault();
        this.find.open(true);
      }
      return;
    }
    // Paste as plain text from the keyboard is left to the browser: its own paste event carries the clipboard without the permission
    // prompt the asynchronous clipboard API shows. The editor only notes that this paste is to be plain.
    if (k === 'Mod+Shift+V' && this.active && this.active.mode !== 'xml' && !!t?.closest?.('.design-page, [contenteditable]')) {
      this.active.plainPasteAt = performance.now();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    this.run(cmd.id);
  }

  // ------------------------------------------------------------- toasts / status
  toast(msg: string, kind: 'info' | 'warning' | 'error' = 'info') {
    const t = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, icon(kind === 'error' ? 'error' : kind === 'warning' ? 'warn' : 'info', 15), h('span', null, msg));
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 4) this.toasts.firstChild!.remove();
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 300);
    }, kind === 'info' ? 2600 : 4500);
    this.statusMsg.textContent = msg;
  }

  perf(label: string, ms: number) {
    this.timings[label] = Math.round(ms);
  }

  isEditorFocusIntended(): boolean {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body) return true;
    if (a.closest('.modal, .pane, .find-bar, .ribbon, .file-menu, .ctx-menu')) return false;
    return true;
  }

  // ------------------------------------------------------------- chrome updates
  updateChrome() {
    const ed = this.active;
    // ribbon states
    for (const { el, cmd } of this.ribbonButtons) {
      const disabled = (!cmd.global && !ed) || (!!ed && !!cmd.enabled && !safe(() => cmd.enabled!(this, ed)));
      el.disabled = disabled;
      const checked = cmd.checked ? safe(() => cmd.checked!(this, ed)) : false;
      el.classList.toggle('pressed', !!checked);
      if (cmd.checked) el.setAttribute('aria-pressed', String(!!checked));
    }
    // contextual tabs
    for (const tab of RIBBON) {
      if (!tab.contextual) continue;
      const on = safe(() => tab.contextual!(this, ed));
      const tEl = this.ribbonTabs.querySelector<HTMLElement>(`[data-tab="${tab.id}"]`);
      tEl?.classList.toggle('ctx-active', !!on);
      // a contextual tab that disappears while it is the selected one (caret left the table, document closed) must not leave an empty ribbon
      if (!on && this.layout.ribbonTab === tab.id) this.selectRibbonTab('home');
    }
    if (!this.host) document.title = `${ed?.doc.dirty ? '● ' : ''}${ed ? ed.doc.fileName + ' – ' : ''}S1000D Studio`;
    this.renderTabs();
    this.startPage.hidden = !!ed;
    this.editorHost.hidden = !ed;
    this.renderStatus();
    this.host?.changed();
  }

  private renderTabs() {
    // the strip is rebuilt on every update: a keyboard user who is on a tab must stay on it
    const hadFocus = this.tabsEl.contains(document.activeElement) && !!(document.activeElement as HTMLElement).classList.contains('doc-tab');
    clear(this.tabsEl);
    let activeTab: HTMLElement | null = null;
    const tabEls: HTMLElement[] = [];
    for (const ed of this.editors) {
      const id = ed.doc.ident;
      const label = ed.doc.fileName;
      const tab = h('div', {
        class: 'doc-tab' + (ed === this.active ? ' active' : ''), role: 'tab', tabindex: ed === this.active || (!this.active && ed === this.editors[0]) ? '0' : '-1',
        'aria-selected': String(ed === this.active), title: [id?.dmc, id?.techName && `${id.techName} – ${id.infoName}`].filter(Boolean).join('\n') || label,
        on: {
          mousedown: (e: Event) => { if ((e as MouseEvent).button === 1) { e.preventDefault(); void this.closeEditor(ed); } },
          click: () => this.activate(ed),
          keydown: (e: Event) => {
            const k = (e as KeyboardEvent).key;
            const i = tabEls.indexOf(tab);
            const go = (j: number) => {
              e.preventDefault();
              const target = this.editors[(j + this.editors.length) % this.editors.length];
              if (target) this.activate(target, false);
              const focusActive = () => (this.tabsEl.querySelector('.doc-tab.active') as HTMLElement | null)?.focus();
              focusActive();
            };
            if (k === 'ArrowRight') go(i + 1);
            else if (k === 'ArrowLeft') go(i - 1);
            else if (k === 'Home') go(0);
            else if (k === 'End') go(this.editors.length - 1);
            else if (k === 'Enter' || k === ' ') { e.preventDefault(); this.activate(ed); }
            else if (k === 'Delete') { e.preventDefault(); void this.closeEditor(ed); }
          },
        },
      },
        icon(ed.mode === 'xml' ? 'xml' : 'file', 14),
        h('span', { class: 'doc-tab-name' }, label),
        ed.doc.dirty ? h('span', { class: 'doc-tab-dirty', title: 'Unsaved changes' }, '●') : null,
        h('button', { class: 'doc-tab-close', 'aria-label': 'Close ' + label, tabindex: '-1', on: { click: (e: Event) => { e.stopPropagation(); void this.closeEditor(ed); } } }, icon('close', 12)),
      );
      tabEls.push(tab);
      if (ed === this.active) activeTab = tab;
      this.tabsEl.appendChild(tab);
    }
    if (activeTab) {
      activeTab.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      if (hadFocus) activeTab.focus();
    }
    this.tabsEl.appendChild(h('button', { class: 'icon-btn doc-tab-new', title: 'New data module', 'aria-label': 'New data module', on: { click: () => this.run('file.new') } }, icon('plus', 15)));
  }

  private renderStatus() {
    const ed = this.active;
    clear(this.statusLeft);
    clear(this.statusRight);
    if (!ed) {
      this.statusRight.textContent = 'No document';
      return;
    }
    const el = ed.currentElement();
    const chain: Element[] = [];
    for (let c: Node | null = el; c && c.nodeType === 1; c = c.parentNode) chain.unshift(c as Element);
    const shown = chain.length > 7 ? chain.slice(-7) : chain;
    if (chain.length > 7) this.statusLeft.appendChild(h('span', { class: 'crumb-sep' }, '…'));
    shown.forEach((c, i) => {
      this.statusLeft.appendChild(h('button', { class: 'crumb' + (c === el ? ' active' : ''), title: 'Select <' + c.nodeName + '>', on: { click: () => ed.selectElement(c, { scroll: true }) } }, c.nodeName));
      if (i < shown.length - 1) this.statusLeft.appendChild(h('span', { class: 'crumb-sep' }, '›'));
    });
    const ref = ed.doc.schemaRef;
    const r = ed.report;
    const errors = r?.issues.filter((i) => i.severity === 'error').length ?? 0;
    const warnings = r?.issues.filter((i) => i.severity === 'warning').length ?? 0;
    // without live validation nothing refreshes the report after an edit: it must not keep saying "Valid" for a changed document
    const stale = !!r && ed.reportVersion !== ed.doc.version && !this.settings.liveValidation;
    const badge = h('button', { class: 'status-badge ' + (ed.validating ? 'busy' : !r || (stale && !errors && !warnings) ? 'unknown' : errors ? 'bad' : warnings ? 'warn' : 'good'), title: stale ? 'The document changed since it was validated — run Validate again. Click to toggle the Problems pane.' : 'Problems (click to toggle the pane)', on: { click: () => this.togglePane('bottom') } },
      ed.validating ? h('span', { class: 'spinner' }) : icon(!r || (stale && !errors && !warnings) ? 'validate' : errors ? 'error' : warnings ? 'warn' : 'ok', 14),
      ed.validating ? ' Validating…' : !r ? ' Not validated' : errors || warnings ? ` ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}${stale ? ' (outdated)' : ''}` : stale ? ' Not re-validated' : ' Valid',
    );
    if (ed.xmlError) {
      badge.className = 'status-badge bad';
      badge.replaceChildren(icon('error', 14), ' XML not well-formed');
    }
    this.statusRight.append(
      h('span', { class: 'status-item', title: 'Words in content' }, `${wordCount(ed)} words`),
      h('span', { class: 'status-item', title: ref?.url ?? 'No schema reference' }, ref ? `S1000D ${ISSUE_LABEL[ref.issue] ?? ref.issue} · ${SCHEMAS[ref.schema] ?? ref.schema}${ed.grammar ? '' : ' (no grammar)'}` : 'No S1000D schema'),
      badge,
      h('span', { class: 'status-item', title: 'Zoom' }, `${Math.round(this.settings.zoom * 100)}%`),
    );
  }

  onSelectionChange(ed: DocumentEditor) {
    if (ed !== this.active) return;
    this.selChrome();
  }

  private selectionChrome() {
    this.attributes.update();
    this.outline.highlightCurrent();
    if (this.layout.rightTab === 'elements') this.elementsSoon();
    this.updateChrome();
  }

  onDocChanged(ed: DocumentEditor, ev: ChangeEvent) {
    if (ed !== this.active) return;
    this.outlineSoon();
    this.find.onDocChanged();
    this.attributes.update();
    if (this.layout.rightTab === 'elements') this.elementsSoon();
    void ev;
  }

  // ------------------------------------------------------------- documents
  /** `focusEditor` is false when the tab strip is driven from the keyboard: focus stays on the tab (roving tabindex). */
  activate(ed: DocumentEditor | null, focusEditor = true) {
    if (this.active === ed && ed) return;
    if (this.active) this.active.el.hidden = true;
    this.active = ed;
    if (ed) {
      if (!ed.el.isConnected) this.editorHost.appendChild(ed.el);
      ed.el.hidden = false;
      // re-apply mode so views measure correctly
      const m = ed.mode;
      ed.design.setVisible(m !== 'xml');
      ed.xml.setVisible(m === 'xml' || m === 'split');
      if (focusEditor) setTimeout(() => ed.focus(), 0);
    }
    this.outline.setEditor(ed);
    this.attributes.setEditor(ed);
    this.elements.setEditor(ed);
    this.problems.setEditor(ed);
    this.pdf.setEditor(ed);
    if (this.find.isOpen) this.find.close();
    this.updateChrome();
  }

  async openText(text: string, fileName: string, handle: FileSystemFileHandle | null, opts: { isNew?: boolean; draftId?: string } = {}): Promise<DocumentEditor | null> {
    let doc: EditorDocument;
    try {
      doc = await EditorDocument.fromText(text, fileName);
    } catch (e) {
      if (e instanceof XmlParseError) {
        const er = e.errors[0];
        const res = await this.dialogs.confirm('Cannot open as structured document', `"${fileName}" is not well-formed XML (line ${er.line}, column ${er.column}: ${er.message}). Open it in a raw XML editor to repair it?`, [{ id: 'cancel', label: 'Cancel' }, { id: 'raw', label: 'Open XML to repair', primary: true }]);
        if (res === 'raw') return this.openMalformed(text, fileName, handle);
        return null;
      }
      this.toast(`Cannot open ${fileName}: ${(e as Error).message}`, 'error');
      return null;
    }
    doc.fileHandle = handle;
    if (opts.isNew) doc.markDirty();
    const ed = new DocumentEditor(this, doc);
    if (opts.draftId) {
      // keep the draft identity so it is replaced on next autosave
      (doc as unknown as { id: string }).id = opts.draftId;
      doc.markDirty();
    }
    this.editors.push(ed);
    this.editorHost.appendChild(ed.el);
    ed.el.hidden = true;
    this.activate(ed);
    const id = doc.ident;
    this.addRecent({ name: fileName, dmc: id?.dmc ?? '', title: id ? [id.techName, id.infoName].filter(Boolean).join(' – ') : '', openedAt: Date.now() });
    // the handle belongs to this file: a later open of a different file with the same name (without a handle) must not leave the old one behind
    if (handle) void storage.put('kv', 'handle:' + fileName, handle);
    else storage.del('kv', 'handle:' + fileName).catch(() => undefined);
    if (!doc.schemaRef) this.toast('No S1000D schema reference found: structure-aware editing and XSD validation are limited.', 'warning');
    else if (!doc.grammar) this.toast(`S1000D issue ${doc.schemaRef.issue} schema "${doc.schemaRef.schema}" is not bundled; structured editing is limited.`, 'warning');
    const usedEntities = internalEntityRefs(text, doc.doctype);
    if (usedEntities.length) this.toast(`This file uses internal entities (${usedEntities.slice(0, 3).map((n) => '&' + n + ';').join(', ')}). The editor shows and saves their text, not the references.`, 'warning');
    if (this.settings.liveValidation) void this.validate(ed, { live: true });
    return ed;
  }

  /** Opens malformed XML in XML view so it can be repaired. */
  private async openMalformed(text: string, fileName: string, handle: FileSystemFileHandle | null): Promise<DocumentEditor | null> {
    const shell = '<?xml version="1.0" encoding="UTF-8"?>\n<dmodule/>';
    const doc = await EditorDocument.fromText(shell, fileName);
    doc.fileHandle = handle;
    const ed = new DocumentEditor(this, doc);
    this.editors.push(ed);
    this.editorHost.appendChild(ed.el);
    this.activate(ed);
    ed.setMode('xml');
    ed.xml.view.dispatch({ changes: { from: 0, to: ed.xml.view.state.doc.length, insert: text } });
    ed.xml.flush();
    doc.markDirty();
    return ed;
  }

  async openFiles() {
    const w = window as unknown as { showOpenFilePicker?: (o: unknown) => Promise<FileSystemFileHandle[]> };
    if (w.showOpenFilePicker) {
      try {
        const handles = await w.showOpenFilePicker({ multiple: true, types: [{ description: 'S1000D XML', accept: { 'application/xml': ['.xml', '.XML'] } }] });
        for (const hdl of handles) {
          const f = await hdl.getFile();
          await this.openText(await readXmlFile(f), f.name, hdl);
        }
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
    const inp = h('input', { type: 'file', accept: '.xml,.XML,application/xml,text/xml', multiple: true, style: 'display:none' }) as HTMLInputElement;
    inp.addEventListener('change', async () => {
      for (const f of Array.from(inp.files ?? [])) await this.openText(await readXmlFile(f), f.name, null);
      inp.remove();
    });
    document.body.appendChild(inp);
    inp.click();
  }

  async dropFiles(files: FileList, ed: DocumentEditor | null) {
    const list = Array.from(files);
    // an SVG is both "image/svg+xml" and XML: it is a picture to link, not a data module to open
    const isImage = (f: File) => f.type.startsWith('image/') || /\.(png|jpe?g|gif|svg|tiff?|cgm|bmp)$/i.test(f.name);
    const images = list.filter(isImage);
    const xmls = list.filter((f) => !isImage(f) && (/\.xml$/i.test(f.name) || f.type.includes('xml')));
    for (const f of xmls) await this.openText(await readXmlFile(f), f.name, null);
    if (images.length && (ed ?? this.active)) this.openFigureDialog((ed ?? this.active)!, images[0]);
    else if (images.length) {
      for (const f of images) await this.images.add(f, ImageStore.icnName(f.name));
      this.toast(`Linked ${images.length} image(s)`, 'info');
    }
  }

  async openSample(file: string) {
    const s = this.samples.find((x) => x.file === file) ?? { file, title: file, description: '' };
    try {
      for (const img of s.images ?? []) {
        if (this.images.has(ImageStore.icnName(img))) continue;
        const r = await fetch('/samples/' + img);
        if (r.ok) await this.images.add(await r.blob(), ImageStore.icnName(img));
      }
      const r = await fetch('/samples/' + file);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await this.openText(await r.text(), file, null);
    } catch (e) {
      this.toast(`Cannot open sample: ${(e as Error).message}`, 'error');
    }
  }

  async save(ed: DocumentEditor, saveAs = false) {
    if (!ed.xml.flush()) {
      const r = await this.dialogs.confirm('XML is not well-formed', 'The XML source contains errors. Save the raw XML text anyway?', [{ id: 'no', label: 'Cancel' }, { id: 'yes', label: 'Save anyway', danger: true }]);
      if (r !== 'yes') return;
      await this.writeFile(ed, ed.xml.text, saveAs);
      return;
    }
    if (this.settings.declareEntitiesOnSave) ed.declareMissingEntities();
    await this.writeFile(ed, ed.doc.toString(), saveAs);
  }

  private async writeFile(ed: DocumentEditor, text: string, saveAs: boolean) {
    const doc = ed.doc;
    if (this.host) {
      try {
        if (await this.host.save(ed, text)) {
          doc.markSaved();
          await storage.del('drafts', doc.id);
          this.toast(`Saved ${doc.fileName}`, 'info');
          this.updateChrome();
        }
      } catch (e) {
        this.toast(`Save failed: ${(e as Error).message}`, 'error');
      }
      return;
    }
    const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> };
    let handle = saveAs ? null : doc.fileHandle;
    const suggested = doc.fileName && !/^untitled/i.test(doc.fileName) && !saveAs ? doc.fileName : doc.suggestedFileName();
    try {
      if (!handle && w.showSaveFilePicker) {
        handle = await w.showSaveFilePicker({ suggestedName: suggested, types: [{ description: 'S1000D XML', accept: { 'application/xml': ['.XML', '.xml'] } }] });
      }
      if (handle) {
        const writable = await (handle as unknown as { createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> }).createWritable();
        await writable.write(text);
        await writable.close();
        doc.fileHandle = handle;
        doc.fileName = handle.name;
      } else {
        download(suggested, text);
        doc.fileName = suggested;
      }
      doc.markSaved();
      await storage.del('drafts', doc.id);
      this.toast(`Saved ${doc.fileName}`, 'info');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      this.toast(`Save failed: ${(e as Error).message}`, 'error');
    }
    this.updateChrome();
  }

  exportXml(ed: DocumentEditor) {
    if (!ed.xml.flush()) return this.toast('Fix the XML errors first', 'warning');
    if (this.settings.declareEntitiesOnSave) ed.declareMissingEntities(); // as in Save: an undeclared ICN entity would make the file invalid
    download(ed.doc.suggestedFileName(), ed.doc.toString());
  }

  async exportHtml(ed: DocumentEditor) {
    if (ed.mode === 'xml') ed.setMode('design');
    ed.design.render();
    const css = Array.from(document.styleSheets).map((s) => {
      try {
        return Array.from(s.cssRules).map((r) => r.cssText).join('\n');
      } catch {
        return '';
      }
    }).join('\n');
    const page = ed.design.page.cloneNode(true) as HTMLElement;
    page.removeAttribute('contenteditable');
    page.querySelectorAll('[contenteditable]').forEach((e) => e.removeAttribute('contenteditable'));
    page.querySelectorAll('.x-tag').forEach((e) => e.remove());
    // the Design view shows linked images through blob: URLs that die with this session: embed them so the file is self-contained
    for (const img of Array.from(page.querySelectorAll<HTMLImageElement>('img[src^="blob:"]'))) {
      try {
        const blob = await (await fetch(img.src)).blob();
        img.src = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => reject(r.error);
          r.readAsDataURL(blob);
        });
      } catch {
        img.removeAttribute('src');
      }
    }
    const id = ed.doc.ident;
    const title = id ? `${id.dmc} ${id.techName}` : ed.doc.fileName;
    const lang = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(id?.language ?? '') ? id!.language : 'en';
    const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${css}</style></head><body class="export"><div class="design-scroll export-scroll">${page.outerHTML}</div></body></html>`;
    download(ed.doc.suggestedFileName().replace(/\.xml$/i, '.html'), html, 'text/html');
  }

  async exportPdf(ed: DocumentEditor) {
    if (!ed.xml.flush()) return this.toast('Fix the XML errors first', 'warning');
    this.toast('Generating PDF…', 'info');
    try {
      // File > Export as PDF: the publication (title page, contents lists, data module) of this data module, with the
      // settings saved in the PDF panel.
      const settings = await storage.get<Partial<import('../export/pdf-settings').PublicationSettings>>('kv', 'pdf-settings');
      const { exportPdfBlob } = await import('../export/pdf');
      const { blob, warnings } = await exportPdfBlob([ed.doc], this.images, { mode: 'publication', settings: settings ?? undefined });
      const name = ed.doc.suggestedFileName().replace(/\.xml$/i, '.pdf');
      download(name, blob, 'application/pdf');
      this.toast(`Saved ${name}`, 'info');
      for (const w of warnings.slice(0, 4)) this.toast(w, 'warning');
      if (warnings.length > 4) this.toast(`…and ${warnings.length - 4} more.`, 'info');
    } catch (e) {
      console.error(e);
      this.toast(`PDF export failed: ${(e as Error).message}`, 'error');
    }
  }

  /**
   * Whether closing `ed` would lose work: model changes not saved, or XML-view text that never reached the model (malformed, so it
   * cannot be committed). Valid text still inside the commit delay is committed first, which marks the document modified.
   */
  /** Quick preview: the data module alone, in the publication page format, as a PDF Blob (formatted in the browser, no server). */
  async quickPreview(ed: DocumentEditor): Promise<{ blob: Blob; warnings: string[] }> {
    if (!ed.xml.flush()) throw new Error('Fix the XML errors first.');
    const { exportPdfBlob } = await import('../export/pdf');
    return exportPdfBlob([ed.doc], this.images, { mode: 'preview', settings: this.host?.pdfSettings() as never });
  }

  /** Show `line` of the XML source (used by the platform's error review to jump to a validation issue). */
  gotoLine(ed: DocumentEditor, line: number) {
    this.activate(ed, false);
    if (ed.mode !== 'xml' && ed.mode !== 'split') ed.setMode('split');
    const view = ed.xml.view;
    const n = Math.max(1, Math.min(line, view.state.doc.lines));
    const pos = view.state.doc.line(n).from;
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    view.focus();
  }

  /** Drops every open document without asking - the platform has already confirmed (for example when switching project). */
  async closeAll() {
    for (const ed of [...this.editors]) {
      await storage.del('drafts', ed.doc.id);
      ed.destroy();
    }
    this.editors.length = 0;
    this.active = null;
    this.activate(null);
    this.updateChrome();
  }

  hasUnsavedWork(ed: DocumentEditor): boolean {
    ed.xml.flush();
    return ed.doc.dirty || !!ed.xml.error;
  }

  async closeEditor(ed: DocumentEditor) {
    if (this.hasUnsavedWork(ed)) {
      const r = await this.dialogs.confirm('Unsaved changes', `Save changes to "${ed.doc.fileName}" before closing?`, [{ id: 'cancel', label: 'Cancel' }, { id: 'discard', label: "Don't save", danger: true }, { id: 'save', label: 'Save', primary: true }]);
      if (r === 'cancel' || r === null) return;
      if (r === 'save') {
        await this.save(ed);
        if (ed.doc.dirty) return;
      }
    }
    await storage.del('drafts', ed.doc.id);
    const i = this.editors.indexOf(ed);
    this.editors.splice(i, 1);
    ed.destroy();
    if (this.active === ed) {
      this.active = null;
      this.activate(this.editors[Math.min(i, this.editors.length - 1)] ?? null);
    }
    this.updateChrome();
    this.pdf.render(); // a non-active tab may have been closed: drop it from the "Data modules to generate" list
  }

  /** Reopens a recent file through its persisted File System Access handle (Chromium). */
  async openRecent(r: RecentFile): Promise<boolean> {
    const hdl = await storage.get<FileSystemFileHandle & { queryPermission?(o: unknown): Promise<string>; requestPermission?(o: unknown): Promise<string> }>('kv', 'handle:' + r.name);
    if (!hdl) return false;
    try {
      let perm = (await hdl.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
      if (perm !== 'granted') perm = (await hdl.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
      if (perm !== 'granted') return false;
      const f = await hdl.getFile();
      await this.openText(await readXmlFile(f), f.name, hdl);
      return true;
    } catch {
      return false;
    }
  }

  private addRecent(r: RecentFile) {
    const next = [r, ...this.recent.filter((x) => x.name !== r.name)];
    // entries that fall off the list take their persisted file handle with them
    for (const gone of next.slice(15)) storage.del('kv', 'handle:' + gone.name).catch(() => undefined);
    this.recent = next.slice(0, 15);
    saveLocal('studio.recent', { list: this.recent });
  }

  async saveDraft(ed: DocumentEditor) {
    if (!this.settings.drafts || !this.editors.includes(ed)) return;
    if (!ed.doc.dirty && !ed.xml.error) {
      await storage.del('drafts', ed.doc.id);
      return;
    }
    const text = ed.xml.hasPending && ed.xml.error ? ed.xml.text : ed.doc.toString();
    await storage.put('drafts', ed.doc.id, { id: ed.doc.id, fileName: ed.doc.fileName, text, savedAt: Date.now() } satisfies Draft);
  }

  private async restoreDrafts() {
    const drafts = ((await storage.all<Draft>('drafts')) ?? []).filter((d) => d && d.text);
    if (!drafts.length) return;
    const ids = await this.dialogs.restoreDrafts(drafts);
    // Escape / X / click outside the dialog is not a decision: the drafts stay for the next start (only "Discard" deletes them)
    if (ids === null) return;
    for (const d of drafts) {
      if (ids?.includes(d.id)) await this.openText(d.text, d.fileName, null, { draftId: d.id });
      else await storage.del('drafts', d.id);
    }
  }

  // ------------------------------------------------------------- validation
  async validate(ed: DocumentEditor, o: { live: boolean; xsd?: boolean; brex?: boolean }) {
    if (!this.editors.includes(ed)) return;
    if (ed.xmlError) {
      ed.report = { issues: [{ severity: 'error', source: 'xml', message: ed.xmlError.message, line: ed.xmlError.line, column: ed.xmlError.column }], time: 0 };
      this.problems.render();
      this.updateChrome();
      return;
    }
    if (ed.validating) {
      // an explicit request is kept and run next; a live one only needs to run again after the current run
      if (!o.live) ed.pendingValidation = { xsd: o.xsd, brex: o.brex };
      else ed.revalidate = true;
      return;
    }
    ed.validating = true;
    this.problems.render();
    this.updateChrome();
    const xsd = o.xsd ?? (o.live ? this.settings.liveXsd : true);
    const brex = o.brex ?? (o.live ? this.settings.liveBrex : true);
    const version = ed.doc.version;
    try {
      const report = await this.validator.validate(ed.doc, { xsd, brex });
      if (ed.doc.version === version || !o.live) {
        ed.report = report;
        ed.reportVersion = version;
        ed.xml.setValidation(report.issues);
      }
      if (!o.live) {
        const errors = report.issues.filter((i) => i.severity === 'error').length;
        const skipped = xsd && !report.xsd?.ran;
        this.toast(errors ? `Validation found ${errors} error${errors === 1 ? '' : 's'}` : skipped ? 'No errors found, but the schema (XSD) check could not run — see Problems' : 'The data module is valid', errors || skipped ? 'warning' : 'info');
        if (errors && !this.layout.bottom) this.togglePane('bottom');
      }
    } catch (e) {
      this.toast(`Validation failed: ${(e as Error).message}`, 'error');
    } finally {
      ed.validating = false;
      this.problems.render();
      this.updateChrome();
      const next = ed.pendingValidation;
      ed.pendingValidation = null;
      if (next) {
        ed.revalidate = false;
        setTimeout(() => this.validate(ed, { live: false, ...next }), 0);
      } else if (ed.revalidate || ed.doc.version !== version) {
        ed.revalidate = false;
        if (this.settings.liveValidation) setTimeout(() => this.validate(ed, { live: true }), 300);
      }
    }
  }

  // ------------------------------------------------------------- misc actions
  confirmMalformed(ed: DocumentEditor) {
    const err = ed.xmlError;
    modal('XML is not well-formed', h('p', { class: 'confirm-text' }, `The XML source has an error${err ? ` at line ${err.line}, column ${err.column}: ${err.message}` : ''}. Fix it to switch to the visual view, or discard your XML changes.`), [
      { label: 'Discard XML changes', danger: true, action: () => { ed.xml.revert(); ed.setMode('design'); } },
      { label: 'Go to error', primary: true, action: () => ed.gotoXmlError() },
    ], { width: '520px' });
  }

  openProperties(el: Element | null, fromPanel = false) {
    const ed = this.active;
    if (!ed || !el) return;
    const n = el.nodeName;
    if (n === 'dmRef') return this.dialogs.dmRef(ed, el);
    if (n === 'internalRef') return this.dialogs.internalRef(ed, el);
    if (n === 'externalPubRef') return this.dialogs.externalPubRef(ed, el);
    if (n === 'graphic' || n === 'figure') return this.dialogs.figure(ed, undefined, el);
    if (n === 'acronym') return this.dialogs.acronym(ed, el);
    if (n === 'definitionList') return this.dialogs.definitionList(ed, el);
    if (['dmCode', 'issueInfo', 'language', 'issueDate', 'security', 'unverified', 'firstVerification', 'secondVerification', 'brexDmRef'].includes(n) && find(ed.doc.xml, 'identAndStatusSection')?.contains(el)) return this.dialogs.dmProperties(ed);
    if (fromPanel) return this.toast(`<${n}> is edited through the attributes panel`, 'info');
    if (!this.layout.right) this.togglePane('right');
    this.setRightTab('attributes');
    if (ed.currentElement() !== el) ed.selectElement(el);
    setTimeout(() => this.attributes.focusFirst(), 50);
  }

  openFigureDialog(ed: DocumentEditor, file?: File) {
    this.dialogs.figure(ed, file);
  }

  openReferencedDm(ref: Element) {
    const code = readDmCode(find(ref, 'dmCode'));
    const dmc = code ? formatDmc(code) : '';
    const target = this.editors.find((e) => e.doc.ident?.dmc === dmc);
    if (target) this.activate(target);
    else this.toast(`${dmc} is not open. Open it with File › Open.`, 'info');
  }

  async clipboardAction(kind: 'cut' | 'copy' | 'paste' | 'pastePlain') {
    const ed = this.active;
    if (!ed) return;
    if (kind === 'cut' || kind === 'copy') {
      if (ed.mode === 'xml') {
        ed.xml.focus();
        document.execCommand(kind);
        return;
      }
      ed.design.page.focus({ preventScroll: true });
      ed.design.applySelection(ed.doc.selection, false);
      if (!document.execCommand(kind)) this.toast(`Use ${isMac() ? '⌘' : 'Ctrl+'}${kind === 'cut' ? 'X' : 'C'} to ${kind}`, 'info');
      return;
    }
    try {
      if (kind === 'pastePlain') {
        const text = await navigator.clipboard.readText();
        ed.pasteSource({ text }, true);
        return;
      }
      const items = await navigator.clipboard.read();
      const src: { html?: string; text?: string } = {};
      for (const it of items) {
        if (it.types.includes('text/html')) src.html = await (await it.getType('text/html')).text();
        if (it.types.includes('text/plain')) src.text = await (await it.getType('text/plain')).text();
      }
      ed.pasteSource(src);
    } catch {
      this.toast(`Clipboard access was denied — use ${isMac() ? '⌘V' : 'Ctrl+V'} to paste`, 'info');
    }
  }

  // ------------------------------------------------------------- context menu
  showContextMenu(x: number, y: number, fromKeyboard = false) {
    const ed = this.active;
    if (!ed) return;
    this.closeContextMenu();
    const el = ed.currentElement();
    const menu = h('div', { class: 'ctx-menu', role: 'menu' });
    const item = (id: string, labelOverride?: string) => {
      const c = this.byId.get(id)!;
      const enabled = !c.enabled || safe(() => c.enabled!(this, ed));
      return h('button', { class: 'ctx-item', role: 'menuitem', disabled: !enabled, on: { click: () => { this.closeContextMenu(); this.run(id); } } }, icon(c.icon ?? 'dot', 15), h('span', null, labelOverride ?? c.label), h('span', { class: 'ctx-key' }, c.keys?.[0] ? shortcutLabel(c.keys[0]) : c.description ?? ''));
    };
    const sep = () => h('div', { class: 'ctx-sep' });
    const sub = (label: string, ic: string, children: HTMLElement[]) => {
      const s = h('div', { class: 'ctx-sub' }, h('button', { class: 'ctx-item', role: 'menuitem', 'aria-haspopup': 'menu' }, icon(ic, 15), h('span', null, label), icon('chevronRight', 13)), h('div', { class: 'ctx-menu ctx-submenu' }, ...children)) as HTMLElement;
      // a submenu opens beside its parent item, but is moved up / to the left when it would run off the window, and scrolls if it is taller than the window
      const fit = () => {
        const m = s.querySelector(':scope > .ctx-submenu') as HTMLElement;
        m.style.maxHeight = `${window.innerHeight - 16}px`;
        m.style.overflowY = 'auto';
        m.style.top = '-5px';
        m.style.left = '100%';
        m.style.right = '';
        const parent = s.getBoundingClientRect();
        const r = m.getBoundingClientRect();
        const top = Math.max(8, Math.min(r.top, window.innerHeight - 8 - r.height));
        m.style.top = `${top - parent.top}px`;
        if (r.right > window.innerWidth - 8) {
          m.style.left = 'auto';
          m.style.right = '100%';
        }
      };
      s.addEventListener('mouseenter', fit);
      s.addEventListener('focusin', fit);
      return s;
    };
    menu.append(item('edit.undo'), item('edit.redo'), sep(), item('edit.cut'), item('edit.copy'), item('edit.paste'), item('edit.pastePlain'), item('edit.selectAll'), sep());
    // insert submenu with common + allowed elements
    const { inline, block } = ed.insertableElements();
    const allowed = [...inline, ...block];
    const quick = ['para', 'levelledPara', 'proceduralStep', 'warning', 'caution', 'note', 'randomList', 'sequentialList', 'table', 'figure', 'internalRef', 'dmRef', 'emphasis'].filter((n) => allowed.includes(n) || ed.canInsert(n));
    const insItems: HTMLElement[] = quick.map((n) => h('button', { class: 'ctx-item', role: 'menuitem', on: { click: () => { this.closeContextMenu(); if (n === 'table') this.run('insert.table'); else if (n === 'figure') this.run('insert.figure'); else if (n === 'internalRef') this.run('insert.internalRef'); else if (n === 'dmRef') this.run('insert.dmRef'); else ed.insertElementNamed(n); } } }, icon('element', 14), h('span', null, n)));
    insItems.push(h('div', { class: 'ctx-sep' }), item('struct.insert', 'More elements…'));
    menu.append(sub('Text', 'bold', ['format.bold', 'format.italic', 'format.underline', 'format.overline', 'format.strike', 'format.subscript', 'format.superscript'].map((id) => item(id))), sub('Insert', 'insert', insItems), item('struct.wrap'), item('struct.change'), item('struct.removeTag'), item('struct.delete'), sep());
    menu.append(item('struct.selectParent'), item('struct.moveUp'), item('struct.moveDown'), item('struct.demote'), item('struct.promote'));
    if (T.entryOf(ed.elementSelection ?? ed.currentPos().node)) {
      // the same groups as the Table ribbon tab, so the two never drift apart
      const tableGroups = [
        ['table.rowAbove', 'table.rowBelow', 'table.colLeft', 'table.colRight', 'table.deleteRow', 'table.deleteCol'],
        ['table.mergeRight', 'table.mergeDown', 'table.split'],
        ['table.alignLeft', 'table.alignCenter', 'table.alignRight', 'table.alignJustify', 'table.valignTop', 'table.valignMiddle', 'table.valignBottom'],
        ['table.header', 'table.properties', 'table.delete'],
      ];
      menu.append(sep(), sub('Table', 'table', tableGroups.flatMap((ids, i) => [...(i ? [sep()] : []), ...ids.map((id) => item(id))])));
    }
    menu.append(sep(), item('edit.find'), sub('Change mark', 'changeMark', ['review.markModify', 'review.markAdd', 'review.markDelete', 'review.markClear'].map((id) => item(id))));
    if (el && (el.nodeName === 'internalRef' || el.nodeName === 'dmRef')) {
      menu.append(h('button', { class: 'ctx-item', role: 'menuitem', on: { click: () => { this.closeContextMenu(); ed.followReference(el); } } }, icon('link', 15), h('span', null, 'Follow reference'), h('span', { class: 'ctx-key' }, 'Ctrl+Click')));
    }
    if (el && el !== ed.doc.root) {
      menu.append(h('button', { class: 'ctx-item', role: 'menuitem', on: { click: () => { this.closeContextMenu(); this.openProperties(el); } } }, icon('props', 15), h('span', null, `Properties of <${el.nodeName}>…`), h('span', { class: 'ctx-key' }, shortcutLabel('Alt+Enter'))));
    }
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
    this.ctxMenu = menu;
    menuKeys(menu, () => Array.from(menu.querySelectorAll<HTMLElement>(':scope > .ctx-item, :scope > .ctx-sub > .ctx-item')));
    if (fromKeyboard) menu.querySelector<HTMLElement>('.ctx-item:not(:disabled)')?.focus();
    void ATOMIC;
    void ops;
  }

  closeContextMenu() {
    this.ctxMenu?.remove();
    this.ctxMenu = null;
  }
}

/** Arrow-key navigation for a menu whose items are buttons: Up/Down/Home/End move, Right/Left enter and leave a submenu. */
function menuKeys(menu: HTMLElement, items: () => HTMLElement[]) {
  menu.addEventListener('keydown', (e) => {
    const list = items().filter((b) => !(b as HTMLButtonElement).disabled);
    const cur = document.activeElement as HTMLElement | null;
    if (e.key === 'ArrowRight') {
      const sub = cur?.parentElement?.querySelector<HTMLElement>(':scope > .ctx-submenu .ctx-item:not(:disabled)');
      if (sub) { e.preventDefault(); e.stopPropagation(); sub.focus(); }
      return;
    }
    if (e.key === 'ArrowLeft') {
      const trigger = cur?.closest('.ctx-submenu')?.parentElement?.querySelector<HTMLElement>(':scope > .ctx-item');
      if (trigger) { e.preventDefault(); e.stopPropagation(); trigger.focus(); }
      return;
    }
    if (!list.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    // inside a submenu the arrows move within it
    const scope = cur?.closest('.ctx-submenu');
    const pool = scope ? Array.from(scope.querySelectorAll<HTMLElement>('.ctx-item:not(:disabled)')) : list;
    const i = pool.indexOf(cur as HTMLElement);
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? pool.length - 1 : e.key === 'ArrowDown' ? (i + 1) % pool.length : (i < 0 ? pool.length - 1 : (i - 1 + pool.length) % pool.length);
    e.preventDefault();
    e.stopPropagation();
    pool[j]?.focus();
  });
}

function tooltip(c: Command): string {
  return c.label + (c.keys?.[0] ? ` (${shortcutLabel(c.keys[0])})` : c.description ? ` — ${c.description}` : '');
}

function shortLabel(s: string): string {
  return s.replace('…', '').replace(/ \(.*\)$/, '');
}

function safe<T>(f: () => T): T | false {
  try {
    return f();
  } catch {
    return false;
  }
}

/** Normalises "Mod+Shift+K" style shortcuts for lookup. */
function normKey(k: string): string {
  const parts = k.split('+');
  const key = parts.pop()!;
  const mods = new Set(parts);
  const out: string[] = [];
  if (mods.has('Mod')) out.push('Mod');
  if (mods.has('Ctrl')) out.push('Ctrl');
  if (mods.has('Alt')) out.push('Alt');
  if (mods.has('Shift')) out.push('Shift');
  out.push(key.length === 1 ? key.toUpperCase() : key);
  return out.join('+');
}

function keyOf(e: KeyboardEvent): string {
  const out: string[] = [];
  const mac = isMac();
  if (mac ? e.metaKey : e.ctrlKey) out.push('Mod');
  if (mac && e.ctrlKey) out.push('Ctrl');
  if (e.altKey) out.push('Alt');
  if (e.shiftKey) out.push('Shift');
  let key = e.key;
  // A letter or digit is what the layout says it is (Ctrl+Z is undo on QWERTZ too). The physical key only stands in where the key
  // value is no use: Option/AltGr compose other characters, Shift turns 1 into !, non-Latin layouts have no Latin letter.
  if (!/^[a-z0-9=,-]$/i.test(key)) {
    if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
    else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
    else if (e.code === 'Equal') key = '=';
    else if (e.code === 'Minus') key = '-';
    else if (e.code === 'Comma') key = ',';
    else if (key === ' ') key = 'Space';
  }
  out.push(key.length === 1 ? key.toUpperCase() : key);
  return out.join('+');
}

let wcCache: { ed: DocumentEditor | null; v: number; n: number } = { ed: null, v: -1, n: 0 };
function wordCount(ed: DocumentEditor): number {
  if (wcCache.ed === ed && wcCache.v === ed.doc.version) return wcCache.n;
  const content = ed.doc.xml.getElementsByTagName('content')[0];
  const t = content?.textContent ?? '';
  const n = (t.match(/[\p{L}\p{N}]+/gu) ?? []).length;
  wcCache = { ed, v: ed.doc.version, n };
  return n;
}
