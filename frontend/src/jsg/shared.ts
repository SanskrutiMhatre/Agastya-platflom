// Pieces both JSG editors use (the User Handbook editor and the Illustrated Spare Parts List editor): the host interface, the common look, the picture chooser, the cover card.
//
// JSG-only: nothing here is shared with the JSS editor (src/jss) or the S1000D Studio (src/studio).

import { META_FIELDS, type JsgDoc } from './model';

export interface GraphicInfo { src: string; name: string; url: string }
export interface JsgFinding { severity: 'error' | 'warning'; rule: string; message: string; line: number; location: string }
export interface JsgHost {
  graphics(): Promise<GraphicInfo[]>;
  uploadGraphic(file: File): Promise<GraphicInfo>;
  imageUrl(src: string): string;
  onDirty(dirty: boolean): void;
  onSaveRequested(): void;
  onCheckRequested(): void;
  notify(message: string, kind: 'info' | 'error'): void;
}
/** The text shown beside a section's (or appendix's) heading: its document code. `chapter` is the number the section's chapter has in the document's outline (appendices count on after the chapters). */
export type SectionBadge = (s: { id?: string; title: string }, chapter: number) => string | null;
export interface JsgEditorOptions { doc: JsgDoc; readOnly: boolean; host: JsgHost; sectionBadge?: SectionBadge }

/** What the editor page needs from either editor. */
export interface JsgEditorLike {
  destroy(): void;
  isDirty(): boolean;
  markSaved(): void;
  markDirty(): void;
  getXml(): string;
  setFindings(f: JsgFinding[]): void;
  /** Show (or stop showing) a document code beside each section heading; the document itself is not touched. */
  setSectionBadge?(fn: SectionBadge | undefined): void;
  /** Scroll to a section or appendix by the key the server gives its data module ("id:..." or "t:<number>:<title>"); false when nothing matches. */
  goToModule?(key: string): boolean;
}

// ── Phase 3 (P3-1): live co-editing (frontend/src/collab/jsg.ts binds an editor to its room through these; the editing logic is unchanged, D16) ──

/** A field an editor drew from the model: a live document puts another person's change into it in place, and maps carets through it. */
export interface JsgSlot {
  el: HTMLElement;
  /** the model object the field edits, and the property (for a field held in an XML attribute, the attribute's name; 'inline' for rich text) */
  owner: object;
  key: string | number;
  /** rich: a run of rich text (contenteditable); title: plain text in a contenteditable; input: a form field; cell: an ISPL appendix cell (no caret mapping) */
  kind: 'rich' | 'title' | 'input' | 'cell';
  /** draw the model's current value into the element */
  show(): void;
}
/** What a live editor reports and delegates: every change (the binding brings the room to the model), undo and redo, and what "unsaved" means. */
export interface JsgCollab {
  changed(typing: boolean): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  dirty(): boolean;
}
/** What the live binding needs of either editor. */
export interface JsgLiveSurface {
  getDoc(): JsgDoc;
  setCollab(c: JsgCollab | null): void;
  /** the fields drawn now (connected ones) */
  liveSlots(): JsgSlot[];
  /** draw the whole sheet again from the model (another person's structural change), keeping the scroll position */
  liveRedraw(): void;
  /** after a change from the room: the outline, the counts, the undo buttons and the preview follow the model */
  afterRemote(): void;
  /** the editor's parts the binding draws on: its root, the sheet, its scroll box and its outline */
  liveParts(): { root: HTMLElement; sheet: HTMLElement; scroll: HTMLElement; nav: HTMLElement };
}

export const escH = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function injectCss(id: string, css: string): void {
  if (document.getElementById(id)) return;
  const s = document.createElement('style'); s.id = id; s.textContent = css; document.head.appendChild(s);
}

export function mk(tag: string, cls = '', txt = ''): HTMLElement {
  const e = document.createElement(tag); if (cls) e.className = cls; if (txt) e.textContent = txt; return e;
}
export function button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (cls) b.className = cls;
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', onClick); return b;
}

/** The look both editors share: the outline on the left, a toolbar, and a white sheet (Times New Roman, as the stencils set it). */
export const BASE_CSS = `
/* WP-19 (TH-001): one tokenised sheet. The chrome (outline, toolbar, status, find, menu) follows the theme; the sheet uses the themed --sheet-* tokens, like the S1000D Studio page (--doc-*): white with black ink in light, the dark page with light ink in dark (the PDF stays white). */
.jsg-ed{display:flex;height:100%;min-height:0;background:var(--bg);color:var(--text);font-size:13px}
.jsg-nav{flex:0 0 232px;overflow:auto;border-right:1px solid var(--border);background:var(--bg-elev);color:var(--text);padding:8px 6px;font-size:12px}
.jsg-nav h4{margin:8px 4px 4px;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--text-secondary)}
.jsg-nav a{display:block;padding:2px 6px;border-radius:3px;color:var(--text);cursor:pointer;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.jsg-nav a:hover{background:var(--accent-soft)}.jsg-nav a.l2{padding-left:16px}.jsg-nav a.l3{padding-left:26px}
.jsg-nav .jsg-find{margin:2px 4px;padding:3px 6px;border-radius:3px;font-size:11px;cursor:pointer}
.jsg-nav .jsg-find.error{background:var(--danger-soft);color:var(--danger)}.jsg-nav .jsg-find.warning{background:var(--warning-soft);color:var(--warning)}
.jsg-main{flex:1;display:flex;flex-direction:column;min-width:0}
.jsg-bar{display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding:6px 8px;border-bottom:1px solid var(--border);background:var(--bg-elev)}
.jsg-bar:not(.jsg-tabbed) button{border:1px solid var(--border);background:var(--bg-elev);border-radius:4px;padding:3px 8px;cursor:pointer;font-size:12px;color:var(--text)}
.jsg-bar:not(.jsg-tabbed) button:hover:not(:disabled){background:var(--accent-soft)}
.jsg-bar:not(.jsg-tabbed) button:disabled{background:var(--surface-disabled);color:var(--text-disabled);cursor:not-allowed}
.jsg-bar .sep{width:1px;height:18px;background:var(--border);margin:0 4px}
.jsg-scroll{flex:1;overflow:auto;padding:18px}
.jsg-sheet{margin:0 auto;max-width:794px;background:var(--sheet);color:var(--sheet-ink);padding:56px 56px 72px 94px;box-shadow:var(--paper-sheet-shadow);font:12pt/1.15 var(--font-paper-serif);caret-color:var(--sel)}
.jsg-sheet ::selection,.jsg-isplsheet ::selection{background:color-mix(in srgb,var(--sel) 25%,transparent)}
.jsg-sheet [contenteditable]{outline:none}.jsg-sheet [contenteditable]:focus{background:var(--sheet-jsg-focus)}
.jsg-sheet [contenteditable]:empty:before{content:attr(data-ph);color:var(--sheet-jsg-placeholder)}
.jsg-card{border:1px dashed var(--sheet-jsg-card-border);border-radius:4px;margin:14px -18px 18px;padding:10px 14px;background:var(--sheet-jsg-card-bg);font:13px/1.35 system-ui,sans-serif}
.jsg-card h3{margin:0 0 8px;font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--sheet-jsg-card-head)}
.jsg-card label{display:grid;grid-template-columns:170px 1fr;gap:8px;align-items:center;margin:3px 0}
.jsg-card input{font:13px system-ui,sans-serif;padding:3px 6px;border:1px solid var(--sheet-jsg-line);border-radius:3px;width:100%;box-sizing:border-box;background:var(--sheet);color:var(--sheet-ink)}
.jsg-card .jsg-row{display:flex;gap:6px;margin:3px 0;align-items:flex-start}.jsg-card .jsg-row>span{flex:0 0 22px;color:var(--sheet-jsg-muted)}
.jsg-card .jsg-row>[contenteditable],.jsg-card .jsg-row>input{flex:1;border:1px solid var(--sheet-jsg-line);border-radius:3px;padding:3px 6px;background:var(--sheet);min-height:20px}
.jsg-card button{border:1px solid var(--sheet-jsg-line);background:var(--sheet);color:var(--sheet-ink);border-radius:3px;padding:1px 7px;cursor:pointer;font-size:12px}
.jsg-chapter{color:var(--sheet-heading);font-weight:bold;text-transform:uppercase;font-size:22pt;line-height:1.15;text-align:center;margin:60px 0 6px}
.jsg-sectionh{color:var(--sheet-heading);font-weight:bold;text-transform:uppercase;font-size:22pt;text-align:center;margin:36px 0 12px}
.jsg-num{display:block;font-size:22pt}
.jsg-code{display:block;width:fit-content;margin:4px auto 0;padding:0 6px;border:1px solid var(--sheet-code-border);border-radius:3px;background:var(--sheet-code-bg);color:var(--sheet-code-text);font:400 9pt/1.5 ui-monospace,Consolas,monospace;text-transform:none;user-select:none}
.jsg-flash{animation:jsg-flash 1.6s ease-out}@keyframes jsg-flash{0%{background:var(--sheet-flash)}100%{background:transparent}}
.jsg-clause{color:var(--sheet-heading);font-weight:bold;text-transform:uppercase;margin:12pt 0 6pt;display:flex;gap:10px}
.jsg-clause .n{flex:0 0 auto;min-width:34px}.jsg-clause .t{flex:1}
.jsg-p{text-align:justify;margin:3pt 0}
.jsg-list{margin:3pt 0}.jsg-li{display:flex;gap:8px;margin:3pt 0;text-align:justify}.jsg-li .m{flex:0 0 40px}.jsg-li .b{flex:1}
.jsg-cap{font-weight:bold;text-align:center;margin:6pt 0}
.jsg-fig{text-align:center;margin:6pt 0}.jsg-fig img{max-width:100%;max-height:340px}
.jsg-fig .empty{border:1px dashed var(--sheet-jsg-placeholder);color:var(--sheet-jsg-muted);padding:26px;font:12px system-ui,sans-serif}
.jsg-table{border-collapse:collapse;width:100%;font-size:10pt;margin:4pt 0}
.jsg-table td,.jsg-table th{border:1px solid var(--sheet-rule-strong);padding:2px 4px;vertical-align:middle}.jsg-table th{font-weight:bold;text-align:center}
.jsg-notice{border:1px solid var(--sheet-ink);padding:4px 8px;margin:6pt 0}.jsg-notice b{display:block;text-transform:uppercase}
.jsg-break{border-top:1px dashed var(--sheet-jsg-placeholder);color:var(--sheet-jsg-placeholder);font:10px system-ui,sans-serif;text-align:center;margin:8px 0}
.jsg-tag{font:10px system-ui,sans-serif;color:var(--sheet-jsg-muted);margin:10px 0 0;text-transform:uppercase}
.jsg-ro .jsg-bar button.edit{display:none}
.jsg-app{text-align:center;font-weight:bold;font-size:14pt;margin:34px 0 10px}

/* ---- the toolbar in tabs (both JSG editors): Write, Insert, Table, Arrange, Document; every button stays in the page, a tab only hides its panel ---- */
.jsg-bar.jsg-tabbed{display:block;padding:0}
.jsg-tabs{display:flex;align-items:flex-end;gap:2px;padding:4px 10px 0;border-bottom:1px solid var(--border)}
.jsg-quick{display:inline-flex;gap:1px;margin:0 10px 3px 0;padding-right:10px;border-right:1px solid var(--border)}
.jsg-tab{height:30px;padding:0 14px;border:1px solid transparent;border-bottom:0;border-radius:6px 6px 0 0;background:none;color:var(--text-muted);font:inherit;font-size:12.5px;cursor:pointer;margin-bottom:-1px}
.jsg-tab:hover{color:var(--text);background:var(--bg-hover)}
.jsg-tab.on{background:var(--bg);color:var(--text-link);font-weight:600;border-color:var(--border);border-bottom:1px solid var(--bg)}
.jsg-tab:focus-visible{outline:2px solid var(--focus-ring);outline-offset:1px}
.jsg-panels{background:var(--bg)}
.jsg-panel{display:flex;flex-wrap:wrap;align-items:stretch;gap:2px 0;padding:6px 10px 4px;min-height:60px}
.jsg-panel[hidden]{display:none}
.jsg-tgroup{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:0 10px;border-right:1px solid var(--border)}
.jsg-tgroup:first-child{padding-left:0}.jsg-tgroup:last-of-type{border-right:0}
.jsg-tbtns{display:flex;align-items:center;flex-wrap:wrap;gap:1px}
.jsg-tlabel{font-size:10.5px;color:var(--text-faint);letter-spacing:.03em}
.jsg-bar .jsg-tb{min-width:28px;height:28px;padding:0 8px;border:1px solid transparent;border-radius:6px;background:none;color:var(--text);cursor:pointer;font:inherit;font-size:12.5px;display:inline-flex;align-items:center;justify-content:center;gap:4px;white-space:nowrap}
.jsg-bar .jsg-tb:hover:not(:disabled){background:var(--bg-hover)}
.jsg-bar .jsg-tb:active:not(:disabled){background:var(--bg-active)}
.jsg-bar .jsg-tb:disabled{color:var(--text-disabled);cursor:not-allowed}
.jsg-bar .jsg-tb.on{background:var(--accent-soft);color:var(--text-link);border-color:var(--accent)}
.jsg-bar .jsg-tb:focus-visible{outline:2px solid var(--focus-ring);outline-offset:1px}
.jsg-thint{align-self:center;max-width:52ch;font-size:11.5px;color:var(--text-faint);padding:0 12px}
.jsg-menu{position:fixed;z-index:60;min-width:210px;background:var(--bg-elev);border:1px solid var(--border-strong);border-radius:8px;box-shadow:var(--shadow-menu);padding:4px;font:13px system-ui,sans-serif}
.jsg-menu button{display:flex;width:100%;align-items:center;gap:8px;padding:7px 10px;border:0;background:none;border-radius:5px;color:var(--text);font:inherit;cursor:pointer;text-align:left}
.jsg-menu button:hover:not(:disabled){background:var(--bg-hover)}.jsg-menu button:disabled{color:var(--text-disabled);cursor:not-allowed}
.jsg-menu .k{margin-left:auto;color:var(--text-faint);font-size:11.5px}
.jsg-menu hr{border:0;border-top:1px solid var(--border);margin:4px 2px}
@media (max-width:900px){.jsg-nav{display:none}.jsg-tabs{overflow-x:auto}.jsg-panel{flex-wrap:nowrap;overflow-x:auto}.jsg-scroll{padding:10px 6px}.jsg-sheet{padding:28px 20px 40px 28px}}
.jsg-sel{box-shadow:-4px 0 0 var(--accent)}
.jsg-status{display:flex;align-items:center;gap:14px;padding:3px 12px;border-top:1px solid var(--border);background:var(--bg-elev);color:var(--text-muted);font:11.5px system-ui,sans-serif;flex:none;white-space:nowrap;overflow:hidden}
.jsg-status .grow{flex:1;overflow:hidden;text-overflow:ellipsis}.jsg-status select{font:inherit;border:1px solid var(--border-control);border-radius:4px;background:var(--bg);color:inherit;padding:0 2px}
.jsg-find{display:none;align-items:center;flex-wrap:wrap;gap:6px;padding:6px 10px;border-bottom:1px solid var(--border);background:var(--bg-elev);font:12.5px system-ui,sans-serif}
.jsg-find.open{display:flex}.jsg-find input[type=text]{height:26px;padding:0 8px;border:1px solid var(--border-control);border-radius:5px;background:var(--bg);color:inherit;min-width:150px}
.jsg-find button{height:26px;border:1px solid var(--border-strong);border-radius:5px;background:var(--bg-elev);color:inherit;padding:0 9px;cursor:pointer;font:inherit}.jsg-find button:hover:not(:disabled){background:var(--bg-hover)}.jsg-find button:disabled{background:var(--surface-disabled);color:var(--text-disabled);border-color:var(--border);cursor:not-allowed}
.jsg-find .cnt{color:var(--text-faint);min-width:70px}
::highlight(jsg-hit){background:var(--find-match);color:inherit}::highlight(jsg-cur){background:var(--find-current);color:var(--find-current-text)}
.jsg-orient{font:10px system-ui,sans-serif;color:var(--sheet-hint);text-align:center;margin:6px 0;border-top:1px dashed var(--sheet-jsg-placeholder);padding-top:2px}
.jsg-picker{max-width:560px;width:90%;border:1px solid var(--border-strong);border-radius:6px;padding:12px;font:13px system-ui,sans-serif;background:var(--bg-elev);color:var(--text)}
.jsg-picker::backdrop{background:var(--scrim)}
.jsg-picker .jsg-pick{border:1px solid var(--border);background:var(--image-backdrop);color:var(--sheet-ink);padding:4px;cursor:pointer}
`;

// ── The toolbar in tabs ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface MenuItem { label: string; hint?: string; run: () => void; disabled?: boolean; separator?: boolean }

/** A small menu under a button: closes on a click away, on Escape, or when an item runs. */
export function openMenu(anchor: HTMLElement, items: MenuItem[]): void {
  document.querySelectorAll('.jsg-menu').forEach((m) => m.remove());
  const r = anchor.getBoundingClientRect();
  const menu = mk('div', 'jsg-menu'); menu.setAttribute('role', 'menu');
  menu.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - 240))}px`; menu.style.top = `${r.bottom + 4}px`;
  const close = (): void => { menu.remove(); document.removeEventListener('mousedown', away, true); document.removeEventListener('keydown', esc, true); };
  const away = (e: Event): void => { if (!menu.contains(e.target as Node)) close(); };
  const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); close(); anchor.focus(); } };
  for (const it of items) {
    if (it.separator) { menu.appendChild(document.createElement('hr')); continue; }
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.disabled = !!it.disabled; b.textContent = it.label;
    if (it.hint) { const k = mk('span', 'k', it.hint); b.appendChild(k); }
    b.addEventListener('mousedown', (e) => e.preventDefault());                    // keep the caret where it is
    b.addEventListener('click', () => { close(); it.run(); });
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  setTimeout(() => { document.addEventListener('mousedown', away, true); document.addEventListener('keydown', esc, true); (menu.querySelector('button:not(:disabled)') as HTMLElement | null)?.focus(); }, 0);
}

export interface BarButton { id: string; label: string; title: string; run: (btn: HTMLButtonElement) => void; /** false for a button that does not change the document (Check, Outline) */ edit?: boolean }
export interface BarGroup { label: string; buttons: BarButton[] }
export interface BarTab { id: string; label: string; groups: BarGroup[]; /** a line of advice at the end of the panel */ hint?: string }

/**
 * Fill `bar` with tabs, each holding labelled groups of buttons. Every button is in the page whichever tab is open (a tab only hides its panel), so the commands are reachable
 * by tests and by script; in a read-only view only the buttons that do not edit are offered. The last tab used is remembered. Returns the buttons by id.
 */
export function tabbedBar(bar: HTMLElement, tabs: BarTab[], opts: { readOnly: boolean; storageKey: string; /** buttons always in reach, left of the tabs (Undo, Redo) */ quick?: BarButton[] }): Map<string, HTMLButtonElement> {
  const buttons = new Map<string, HTMLButtonElement>();
  bar.classList.add('jsg-tabbed');
  const strip = mk('div', 'jsg-tabs'); strip.setAttribute('role', 'tablist'); strip.setAttribute('aria-label', 'Toolbar sections');
  const panels = mk('div', 'jsg-panels'); bar.append(strip, panels);
  const made: Array<{ id: string; panel: HTMLElement; tab: HTMLButtonElement }> = [];
  const quick = (opts.quick ?? []).filter((b) => !opts.readOnly || b.edit === false);
  if (quick.length) {
    const box = mk('div', 'jsg-quick');
    for (const b of quick) {
      const el = document.createElement('button'); el.type = 'button'; el.className = `jsg-tb${b.edit === false ? '' : ' edit'}`; el.textContent = b.label; el.title = b.title; el.setAttribute('aria-label', b.title); el.dataset.cmd = b.id;
      el.addEventListener('mousedown', (e) => e.preventDefault()); el.addEventListener('click', () => b.run(el)); buttons.set(b.id, el); box.appendChild(el);
    }
    strip.appendChild(box);
  }
  const pick = (id: string): void => {
    for (const t of made) { const on = t.id === id; t.panel.hidden = !on; t.tab.classList.toggle('on', on); t.tab.setAttribute('aria-selected', String(on)); }
    try { localStorage.setItem(opts.storageKey, id); } catch { /* private mode */ }
  };
  for (const t of tabs) {
    const groups = t.groups.map((g) => ({ ...g, buttons: g.buttons.filter((b) => !opts.readOnly || b.edit === false) })).filter((g) => g.buttons.length);
    if (!groups.length) continue;
    const panel = mk('div', 'jsg-panel'); panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-label', t.label);
    const tab = document.createElement('button'); tab.type = 'button'; tab.className = 'jsg-tab'; tab.setAttribute('role', 'tab'); tab.dataset.tab = t.id; tab.textContent = t.label;
    tab.addEventListener('click', () => pick(t.id));
    for (const g of groups) {
      const row = mk('div', 'jsg-tbtns');
      for (const b of g.buttons) {
        const el = document.createElement('button'); el.type = 'button'; el.className = `jsg-tb${b.edit === false ? '' : ' edit'}`; el.textContent = b.label; el.title = b.title; el.setAttribute('aria-label', b.title); el.dataset.cmd = b.id;
        el.addEventListener('mousedown', (e) => e.preventDefault());              // keep the text selection
        el.addEventListener('click', () => b.run(el));
        buttons.set(b.id, el); row.appendChild(el);
      }
      const grp = mk('div', 'jsg-tgroup'); grp.setAttribute('role', 'group'); grp.setAttribute('aria-label', g.label); grp.append(row, mk('span', 'jsg-tlabel', g.label)); panel.appendChild(grp);
    }
    if (t.hint && !opts.readOnly) panel.appendChild(mk('span', 'jsg-thint', t.hint));
    strip.appendChild(tab); panels.appendChild(panel); made.push({ id: t.id, panel, tab });
  }
  let saved: string | null = null; try { saved = localStorage.getItem(opts.storageKey); } catch { /* private mode */ }
  if (made.length) pick(made.some((m) => m.id === saved) ? (saved as string) : made[0].id);
  return buttons;
}

/** The chooser of a project picture, with an upload; resolves to the picture or null. */
export async function pickGraphic(host: JsgHost): Promise<GraphicInfo | null> {
  const list = await host.graphics().catch(() => [] as GraphicInfo[]);
  const dlg = document.createElement('dialog'); dlg.className = 'jsg-picker';
  dlg.innerHTML = `<h3 style="margin:0 0 8px">Choose a picture</h3><div class="jsg-picks" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;max-height:320px;overflow:auto"></div>
    <p style="margin:8px 0 0"><label>Upload a new one: <input type="file" accept="image/*"></label></p><p style="text-align:right;margin:8px 0 0"><button type="button" class="x">Cancel</button></p>`;
  document.body.appendChild(dlg);
  return new Promise((resolve) => {
    const done = (g: GraphicInfo | null): void => { dlg.close(); dlg.remove(); resolve(g); };
    const box = dlg.querySelector('.jsg-picks') as HTMLElement;
    for (const g of list) { const b = document.createElement('button'); b.type = 'button'; b.className = 'jsg-pick'; b.innerHTML = `<img src="${escH(g.url)}" alt="" style="max-width:100%;max-height:70px"><div style="font-size:10px;overflow:hidden;text-overflow:ellipsis">${escH(g.name)}</div>`; b.onclick = () => done(g); box.appendChild(b); }
    if (!list.length) box.textContent = 'This project has no pictures yet: upload one below.';
    (dlg.querySelector('input[type=file]') as HTMLInputElement).onchange = (ev) => { const f = (ev.target as HTMLInputElement).files?.[0]; if (f) void host.uploadGraphic(f).then(done, (e) => { host.notify(String(e?.message ?? e), 'error'); done(null); }); };
    (dlg.querySelector('.x') as HTMLElement).onclick = () => done(null);
    dlg.addEventListener('cancel', () => done(null));
    dlg.showModal();
  });
}

/** Rows of single-line text (the supplier's and the issuing authority's lines on the cover). */
export function linesEditor(parent: HTMLElement, label: string, arr: string[], readOnly: boolean, touch: () => void): void {
  const box = mk('div'); box.append(mk('div', 'jsg-tag', label)); parent.appendChild(box);
  const draw = (): void => {
    box.querySelectorAll('.jsg-row').forEach((r) => r.remove());
    arr.forEach((v, i) => {
      const r = mk('div', 'jsg-row'); const inp = document.createElement('input'); inp.value = v; inp.disabled = readOnly;
      inp.addEventListener('input', () => { arr[i] = inp.value; touch(); }); r.appendChild(inp);
      if (!readOnly) r.appendChild(button('×', () => { arr.splice(i, 1); touch(); draw(); }));
      box.insertBefore(r, box.querySelector('button.add'));
    });
  };
  if (!readOnly) { const a = button('+ line', () => { arr.push(''); touch(); draw(); }, 'add'); box.appendChild(a); }
  draw();
}

/** The cover card: one input per cover field, then the supplier and issuer lines. `skip` leaves out the fields a document type does not have. */
export function coverCard(parent: HTMLElement, doc: JsgDoc, readOnly: boolean, touch: () => void, skip: string[] = []): HTMLElement {
  const c = mk('div', 'jsg-card'); c.append(mk('h3', '', 'Cover')); parent.appendChild(c);
  for (const f of META_FIELDS) {
    if (skip.includes(f.key)) continue;
    const l = document.createElement('label'); l.append(document.createTextNode(f.label));
    const i = document.createElement('input'); i.value = doc.meta[f.key] ?? ''; if (f.hint) i.placeholder = f.hint; i.disabled = readOnly;
    i.addEventListener('input', () => { doc.meta[f.key] = i.value; touch(); }); l.appendChild(i); c.appendChild(l);
  }
  linesEditor(c, 'Supplied by (lines)', doc.supplier, readOnly, touch); linesEditor(c, 'Issued by (lines)', doc.issuedBy, readOnly, touch);
  return c;
}
